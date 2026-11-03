/*
 * tea_a2 划词助手 —— 纯逻辑层（不依赖 DOM，也不依赖 browser API）
 * background.js / content.js / options.js 共用；tools/selftest.mjs 也直接加载它做单测。
 */
(function (root) {
  'use strict';

  const DEFAULT_SETTINGS = {
    // —— 接口 ——
    apiBase: 'http://localhost:8383', // 0.18.4 这台带联网 search；想用本机那台改成 http://localhost:8282
    provider: 'deepseek',
    model: 'deepseek-flash',

    // —— 分任务的覆盖（留空 = 用上面的默认）——
    translateProvider: '',
    translateModel: '',
    searchProvider: '',
    searchModel: '',
    summarizeProvider: '',
    summarizeModel: '',

    // —— 思考强度 ——
    translateReasoning: 'none',   // 翻译：不思考
    searchReasoning: 'low',       // 搜索：轻思考
    summarizeReasoning: 'medium', // 总结：使用思考

    // —— 搜索 ——
    searchEngine: 'bing', // bing | duckduckgo | google | custom
    // auto = 扩展抓一份结果当材料 + 同时请求接口联网（接口支持后由接口主导）
    // api  = 只请求接口联网（等 tea_a2 的 /api/llm/chat 支持 search 之后用这个）
    // extension = 只用扩展抓到的搜索结果
    searchMode: 'api',
    searchUrlTemplate: 'https://www.bing.com/search?q={q}',
    searchAiSummary: true, // 把抓到的搜索结果交给 tea_a2 归纳

    // —— 交互 ——
    minChars: 2,
    maxTextChars: 4000,
    showReasoning: false,
  };

  const ENGINES = {
    bing: {
      name: 'Bing',
      url: 'https://www.bing.com/search?q={q}',
      fetchUrl: 'https://www.bing.com/search?q={q}&format=rss',
      parse: 'bing',
    },
    duckduckgo: {
      name: 'DuckDuckGo',
      url: 'https://html.duckduckgo.com/html/?q={q}',
      fetchUrl: 'https://html.duckduckgo.com/html/?q={q}',
      parse: 'duckduckgo',
    },
    google: { name: 'Google', url: 'https://www.google.com/search?q={q}', fetchUrl: null, parse: null },
    custom: { name: '自定义', url: '', fetchUrl: null, parse: null },
  };

  const TASKS = {
    translate: { name: '翻译' },
    search: { name: '搜索' },
    summarize: { name: '总结' },
  };

  const REASONING_LEVELS = ['auto', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

  // ────────────────────────── 基础工具 ──────────────────────────

  // 注意：源码里不要直接写 < / > / & / " 这些实体名，
  // 用 AMP 拼出来，避免被工具链/编辑器提前解码成真字符。
  const AMP = String.fromCharCode(38);
  const LT = String.fromCharCode(60);
  const GT = String.fromCharCode(62);
  const QUOT = String.fromCharCode(34);

  function clampText(text, max) {
    const s = String(text == null ? '' : text);
    const limit = Number(max) > 0 ? Number(max) : DEFAULT_SETTINGS.maxTextChars;
    return s.length > limit ? s.slice(0, limit) : s;
  }

  function decodeEntities(s) {
    return String(s == null ? '' : s)
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(new RegExp(AMP + 'nbsp;', 'gi'), ' ')
      .replace(new RegExp(AMP + 'lt;', 'gi'), LT)
      .replace(new RegExp(AMP + 'gt;', 'gi'), GT)
      .replace(new RegExp(AMP + 'quot;', 'gi'), QUOT)
      .replace(new RegExp(AMP + '#39;', 'g'), "'")
      .replace(new RegExp(AMP + 'amp;', 'gi'), AMP);
  }

  function stripTags(html) {
    return decodeEntities(
      String(html == null ? '' : html)
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
    )
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ────────────────────────── 语言判断 ──────────────────────────

  const CJK_RE = /[㐀-䶿一-鿿豈-﫿぀-ゟ゠-ヿ]/g;

  /**
   * 判断一段文本主要是中文还是其它语言。
   * 返回 'zh' | 'en' | 'unknown'
   */
  function detectLanguage(text) {
    const s = String(text == null ? '' : text);
    const cjk = (s.match(CJK_RE) || []).length;
    const latin = (s.match(/[A-Za-z]/g) || []).length;
    const total = cjk + latin;
    if (total === 0) return 'unknown';
    return cjk / total >= 0.2 ? 'zh' : 'en';
  }

  /** 选中的是中文 → 译成英文；否则 → 译成中文 */
  function translateTarget(text) {
    return detectLanguage(text) === 'zh' ? '英文' : '中文';
  }

  /** 翻译用的系统提示词 */
  function translateSystemPrompt(text) {
    return '将下面内容翻译为' + translateTarget(text) + '，不思考';
  }

  // ────────────────────────── 设置 ──────────────────────────

  function toBool(value, def) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const s = String(value).trim().toLowerCase();
    if (['false', '0', 'no', 'off', ''].indexOf(s) >= 0) return false;
    if (['true', '1', 'yes', 'on'].indexOf(s) >= 0) return true;
    return def;
  }

  // 上游说「这个模型不接受这个思考强度」时，用它判断要不要降级重试
  function isReasoningError(message) {
    return /reasoning[ _]effort|adaptive thinking|requires adaptive/i.test(String(message == null ? '' : message));
  }

  // 实测：minimax 拒 none（必须自适应思考），mimo 只认 none/low/medium/high，
  // deepseek 全档都收。所以「要的那个档位被拒」时按阶梯往下换。
  const EFFORT_FALLBACKS = {
    none: ['minimal', 'low', 'omit'],
    minimal: ['low', 'omit'],
    low: ['omit'],
    medium: ['low', 'omit'],
    high: ['medium', 'low', 'omit'],
    xhigh: ['high', 'medium', 'low', 'omit'],
    max: ['xhigh', 'high', 'medium', 'low', 'omit'],
  };

  function nextEffort(current, tried) {
    const list = EFFORT_FALLBACKS[current] || [];
    const seen = tried || [];
    for (const c of list) if (seen.indexOf(c) < 0) return c;
    return null;
  }

  function normalizeSettings(input) {
    const src = input && typeof input === 'object' ? input : {};
    const out = Object.assign({}, DEFAULT_SETTINGS);
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (src[key] === undefined || src[key] === null) continue;
      const def = DEFAULT_SETTINGS[key];
      if (typeof def === 'boolean') out[key] = toBool(src[key], def);
      else if (typeof def === 'number') {
        const n = Number(src[key]);
        out[key] = Number.isFinite(n) ? n : def;
      } else out[key] = String(src[key]);
    }
    out.apiBase = String(out.apiBase || DEFAULT_SETTINGS.apiBase).replace(/\/+$/, '');
    if (!ENGINES[out.searchEngine]) out.searchEngine = DEFAULT_SETTINGS.searchEngine;
    if (['auto', 'api', 'extension'].indexOf(out.searchMode) < 0) out.searchMode = DEFAULT_SETTINGS.searchMode;
    if (!REASONING_LEVELS.includes(out.summarizeReasoning)) out.summarizeReasoning = DEFAULT_SETTINGS.summarizeReasoning;
    if (!REASONING_LEVELS.includes(out.translateReasoning)) out.translateReasoning = DEFAULT_SETTINGS.translateReasoning;
    if (!REASONING_LEVELS.includes(out.searchReasoning)) out.searchReasoning = DEFAULT_SETTINGS.searchReasoning;
    return out;
  }

  function providerFor(task, settings) {
    const s = normalizeSettings(settings);
    const map = {
      translate: s.translateProvider,
      search: s.searchProvider,
      summarize: s.summarizeProvider,
    };
    return (map[task] || '').trim() || s.provider;
  }

  function modelFor(task, settings) {
    const s = normalizeSettings(settings);
    const map = {
      translate: s.translateModel,
      search: s.searchModel,
      summarize: s.summarizeModel,
    };
    return (map[task] || '').trim() || s.model;
  }

  // ────────────────────────── 请求体构造 ──────────────────────────

  // 扩展把搜索结果塞进提示词时用这套
  const SEARCH_SYSTEM_PROMPT =
    '你是一个联网搜索助手。根据给定的搜索结果回答问题，用中文作答，并在结论后用 [1]、[2] 标注信息来源。' +
    '如果搜索结果不足以回答，请明确说明「搜索结果中没有找到答案」，不要编造。';

  // 让 tea_a2 自己联网时用这套：不要说「给定的搜索结果」，不然模型会当成没有结果
  const SEARCH_SYSTEM_PROMPT_API =
    '你是一个联网搜索助手。用户会给出一个词或短语。请先联网搜索，再用中文回答，' +
    '并在结论后用 [1]、[2] 标注来源链接；如果没搜到，就直说没有搜到，不要编造。';

  /**
   * 构造一次 /api/llm/chat 的请求体。
   * task: 'translate' | 'search' | 'summarize'
   */
  function buildChatBody(task, text, settings, extra) {
    const s = normalizeSettings(settings);
    const content = clampText(text, s.maxTextChars);
    const body = {
      provider: providerFor(task, s),
      model: modelFor(task, s),
      stream: false,
      messages: [{ role: 'user', content: content }],
    };
    if (extra && extra.system) body.system = extra.system;
    if (extra && extra.messages) body.messages = extra.messages;

    if (task === 'translate') {
      body.system = '将下面内容翻译为' + translateTarget(text) + '，不思考';
      if (s.translateReasoning && s.translateReasoning !== 'auto') body.reasoning_effort = s.translateReasoning;
    } else if (task === 'summarize') {
      body.system = '请用中文总结下面的内容，先给一句话总览，再分条列出要点。';
      if (s.summarizeReasoning && s.summarizeReasoning !== 'auto') body.reasoning_effort = s.summarizeReasoning;
    } else if (task === 'search') {
      body.system = extra && extra.system ? extra.system : SEARCH_SYSTEM_PROMPT;
      if (s.searchReasoning && s.searchReasoning !== 'auto') body.reasoning_effort = s.searchReasoning;
    }
    return body;
  }

  // ────────────────────────── 搜索 ──────────────────────────

  function buildSearchUrl(query, settings) {
    const s = normalizeSettings(settings);
    const engine = ENGINES[s.searchEngine] || ENGINES.bing;
    const template = (s.searchEngine === 'custom' ? s.searchUrlTemplate : engine.url) || s.searchUrlTemplate;
    const q = encodeURIComponent(String(query == null ? '' : query).trim());
    if (!template) return '';
    return template.split('{q}').join(q);
  }

  /** 抓取用的地址（Bing 走 RSS，解析更稳）；浏览器打开还是用普通搜索页 */
  function buildSearchFetchUrl(query, settings) {
    const s = normalizeSettings(settings);
    const engine = ENGINES[s.searchEngine] || ENGINES.bing;
    const template = (s.searchEngine === 'custom' ? s.searchUrlTemplate : engine.fetchUrl) || s.searchUrlTemplate;
    const q = encodeURIComponent(String(query == null ? '' : query).trim());
    if (!template) return '';
    return template.split('{q}').join(q);
  }

  function parseBingRss(xml) {
    const out = [];
    const text = String(xml || '');
    const items = text.split(/<item>/i).slice(1);
    for (const item of items) {
      const chunk = item.slice(0, 8000);
      const title = stripTags((chunk.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '');
      const url = decodeEntities(((chunk.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '').trim());
      const snippet = stripTags((chunk.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '');
      if (!url) continue;
      out.push({ title: title || url, url, snippet });
      if (out.length >= 6) break;
    }
    return out;
  }

  function parseBingResults(html) {
    const out = [];
    const text = String(html || '');
    const blocks = text.split(/<li[^>]*class="[^"]*b_algo[^"]*"/i).slice(1);
    for (const block of blocks) {
      const chunk = block.slice(0, 4000);
      let m = chunk.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
      let title = '';
      let url = '';
      if (m) {
        const a = m[1].match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
        if (a) {
          url = a[1];
          title = stripTags(a[2]);
        } else {
          title = stripTags(m[1]);
        }
      }
      // 只要 <h2><a> 形式的正经结果；侧栏、语言版本之类的散链接不要
      if (!url) continue;
      if (!url || /^javascript:/i.test(url)) continue;
      const p = chunk.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      const snippet = p ? stripTags(p[1]) : '';
      if (!title && !snippet) continue;
      out.push({ title: title || url, url, snippet });
      if (out.length >= 6) break;
    }
    return out;
  }

  function parseDuckduckgoResults(html) {
    const out = [];
    const text = String(html || '');
    const re = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(text)) !== null && out.length < 6) {
      const url = decodeEntities(m[1]);
      const title = stripTags(m[2]);
      if (!/^https?:/i.test(url)) continue;
      const tail = text.slice(m.index, m.index + 3000);
      const sn = tail.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
      out.push({ title, url, snippet: sn ? stripTags(sn[1]) : '' });
    }
    return out;
  }

  function parseSearchResults(html, engine) {
    const s = normalizeSettings({ searchEngine: engine });
    const key = ENGINES[s.searchEngine] ? ENGINES[s.searchEngine].parse : null;
    if (key === 'bing') {
      const rss = parseBingRss(html);
      return rss.length ? rss : parseBingResults(html);
    }
    if (key === 'duckduckgo') return parseDuckduckgoResults(html);
    return [];
  }

  /** 把搜索结果拼成给模型看的材料 */
  function formatSearchResults(results) {
    return (results || [])
      .map((r, i) => '[' + (i + 1) + '] ' + (r.title || r.url) + '\n' + r.url + '\n' + (r.snippet || ''))
      .join('\n\n');
  }

  // 上游偶尔把内部工具调用/安全分类当成正文吐出来（tool_call、ds_safety）
  function hasSearchArtifact(text) {
    const s = String(text == null ? '' : text);
    // tool_call：内部工具调用被当成正文；ds_safety：上游安全分类；search_query：搜索计划 JSON
    return /tool_call|ds_safety|search_query|web_search/.test(s);
  }

  function cleanSearchArtifacts(text) {
    return String(text == null ? '' : text)
      .replace(/<[\u200b]*tool_call>[\s\S]*?<\/[\u200b]*tool_call>/g, '')
      .replace(/<ds_safety>[\s\S]*?<\/ds_safety>/g, '')
      .replace(/<\/?ds_safety[^>]*>/g, '')
      .replace(/<\/?tool_result>/g, '')
      .replace(/<\/?result>/g, '')
      .replace(/\{\s*"search_query"[\s\S]*\}/g, '')
      .trim();
  }

  function buildSearchBody(query, results, settings, opts) {
    const s = normalizeSettings(settings);
    const q = String(query || '').trim();
    const list = results || [];
    let prompt;
    if (s.searchMode === 'api') {
      const form = opts && opts.form ? opts.form : 0;
      prompt =
        form === 1
          ? '搜索：' + q
          : form === 2
            ? '请联网搜索「' + q + '」并用中文回答。'
            : '问题：' + q;
    } else if (list.length) {
      prompt = '问题：' + q + '\n\n搜索结果：\n' + formatSearchResults(list);
    } else {
      prompt =
        '问题：' + q +
        '\n\n（这次没有拿到搜索结果，请直接回答；' +
        '如果问题依赖最新信息，请说明你无法联网核实。）';
    }
    const body = buildChatBody('search', prompt, s, {
      system: s.searchMode === 'api' ? SEARCH_SYSTEM_PROMPT_API : SEARCH_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });
    if (s.searchMode !== 'extension') body.search = true; // tea_a2 支持 search 之后自动生效
    return body;
  }

  // ────────────────────────── 导出 ──────────────────────────

  const api = {
    DEFAULT_SETTINGS,
    ENGINES,
    TASKS,
    REASONING_LEVELS,
    SEARCH_SYSTEM_PROMPT,
    SEARCH_SYSTEM_PROMPT_API,
    clampText,
    decodeEntities,
    stripTags,
    detectLanguage,
    translateTarget,
    translateSystemPrompt,
    normalizeSettings,
    isReasoningError,
    EFFORT_FALLBACKS,
    nextEffort,
    providerFor,
    modelFor,
    buildChatBody,
    buildSearchUrl,
    parseBingResults,
    parseBingRss,
    buildSearchFetchUrl,
    parseDuckduckgoResults,
    parseSearchResults,
    formatSearchResults,
    buildSearchBody,
    hasSearchArtifact,
    cleanSearchArtifacts,
  };

  root.TeaCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
