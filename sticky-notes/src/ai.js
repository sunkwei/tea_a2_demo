/**
 * 便笺 · AI 增强层（tea_a2 /api/llm/chat）
 *
 * 浏览器：普通 <script> 标签引入本文件后挂到 window.StickyAI
 * Node  ：new Function(src)() 之后取 globalThis.StickyAI
 *
 * 这一层分两块：
 *   · 纯函数（提示词构造、模型输出解析）——不依赖 DOM，可以离线断言；
 *   · 网络调用（chat / testConnection）——只用到 fetch。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StickyAI = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function () {
  'use strict';

  const DEFAULT_BASE = 'http://localhost:8383';
  const DEFAULT_TIMEOUT = 45000;
  const DEFAULT_MAX_TOKENS = 2000;

  /* ------------------------------------------------------------------ *
   * 基础工具
   * ------------------------------------------------------------------ */

  /** 规范化 API 基址：补 http://、去掉尾部斜杠 */
  function normalizeBase(url) {
    let s = String(url == null ? '' : url).trim();
    if (!s) s = DEFAULT_BASE;
    if (!/^https?:\/\//i.test(s)) s = 'http://' + s.replace(/^\/+/, '');
    return s.replace(/\/+$/, '');
  }

  /** 补 0 的两位数 */
  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  /** 本地时间 YYYY-MM-DD HH:mm */
  function localStamp(ms) {
    const d = new Date(ms == null ? Date.now() : ms);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(
      d.getMinutes()
    )}`;
  }

  /**
   * 从模型输出里抠出 JSON。
   * 模型可能返回 ```json 围栏、前后带解释文字、甚至多个段落——都尽量捞出第一段合法 JSON。
   * @returns {any|null}
   */
  function extractJson(raw) {
    const text = String(raw == null ? '' : raw).trim();
    if (!text) return null;

    // 1) 去掉 markdown 代码围栏
    let body = text.replace(/```(?:json|JSON)?\s*([\s\S]*?)```/g, '$1').trim();
    if (!body) body = text;

    // 2) 直接整段解析
    try {
      return JSON.parse(body);
    } catch (e) {
      /* 继续尝试 */
    }

    // 3) 扫描第一个平衡的 { } 或 [ ] 片段
    for (const [open, close] of [
      ['{', '}'],
      ['[', ']'],
    ]) {
      const start = body.indexOf(open);
      if (start < 0) continue;
      let depth = 0;
      let inStr = false;
      let esc = false;
      for (let i = start; i < body.length; i++) {
        const ch = body[i];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === '\\') esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === open) depth++;
        else if (ch === close) {
          depth--;
          if (depth === 0) {
            try {
              return JSON.parse(body.slice(start, i + 1));
            } catch (e) {
              break;
            }
          }
        }
      }
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * 提示词
   * ------------------------------------------------------------------ */

  const JSON_RULE = '只输出一个 JSON 对象，不要输出任何解释文字，也不要用 markdown 代码块围栏。';

  function categoryList(categories) {
    const list = (categories && categories.length ? categories : ['其他']).map((c) =>
      typeof c === 'string' ? c : c.name
    );
    return list.join('、');
  }

  /** 分类 */
  function buildCategorizePrompt(text, categories, now) {
    return [
      `给下面这条便笺挑一个最贴切的分类。`,
      ``,
      `可用分类（必须原样使用其中一个，不能自创）：${categoryList(categories)}`,
      ``,
      `便笺内容：`,
      '"""',
      String(text || '').slice(0, 4000),
      '"""',
      ``,
      `当前时间：${localStamp(now)}`,
      ``,
      JSON_RULE,
      `格式：{"category":"<分类名>","keywords":["<关键词1>","<关键词2>"],"reason":"<一句话理由>","confidence":0.0}`,
    ].join('\n');
  }

  /** 长文 → 若干条便笺 */
  function buildSummarizePrompt(text, categories, now) {
    return [
      `把下面这段材料拆成若干条**可以单独放进便笺**的要点，每条 1-2 句，具体、可执行。`,
      `要点数量按材料的信息量决定（通常 2-6 条）；不要复述原文，要提炼。`,
      ``,
      `可用分类（必须原样使用其中一个）：${categoryList(categories)}`,
      ``,
      `材料：`,
      '"""',
      String(text || '').slice(0, 12000),
      '"""',
      ``,
      `当前时间：${localStamp(now)}`,
      `如果材料里出现了明确的时间安排（例如"明天下午三点开会"），就把它写进 remind_at，`,
      `用本机本地时间的 ISO 8601 格式（例如 2026-11-04T15:00:00+08:00）；没有时间就留空字符串。`,
      ``,
      JSON_RULE,
      `格式：{"notes":[{"text":"<要点>","category":"<分类名>","remind_at":"<ISO 时间或空串>"}]}`,
    ].join('\n');
  }

  /** 从便笺里抽时间 */
  function buildTimePrompt(text, now) {
    return [
      `从下面这条便笺里找出「需要提醒的时间」——也就是某个应该准时去做的事情的时间点。`,
      ``,
      `便笺内容：`,
      '"""',
      String(text || '').slice(0, 4000),
      '"""',
      ``,
      `当前时间：${localStamp(now)}（本机本地时间）`,
      `相对时间（明天、下周三、3 分钟后）请换算成绝对时间。`,
      `只在这条便笺确实提到时间时才输出 has_time=true；提到日期但没有钟点（例如"下周一交材料"）`,
      `就按当天的 09:00 作为提醒时间，并在 reason 里说明这是默认时间。`,
      ``,
      JSON_RULE,
      `格式：{"has_time":true,"remind_at":"2026-11-04T15:00:00+08:00","text":"<原文里的时间表达>","reason":"<一句话>"}`,
    ].join('\n');
  }

  /** 基于本机便笺问答 */
  function buildAskPrompt(question, notesContext, now) {
    return [
      `下面是我本机便笺应用里的全部（或筛选后的）便笺。每条前面的 [编号] 是它的引用编号。`,
      ``,
      notesContext,
      ``,
      `问题：${String(question || '').slice(0, 2000)}`,
      ``,
      `当前时间：${localStamp(now)}`,
      `只依据上面这些便笺回答；便笺里没有的信息就说"没找到"，不要编。`,
      `引用来源时在句子里写 [编号]。`,
      `如果你觉得这个问题值得单独记一条便笺，可以在 notes 里给出建议。`,
      ``,
      JSON_RULE,
      `格式：{"answer":"<回答>","refs":[1,3],"notes":["<值得记下的点>"]}`,
    ].join('\n');
  }

  /** 联网搜索并整理成便笺 */
  function buildSearchPrompt(query, categories, now) {
    return [
      `请联网搜索下面的主题，并把结果整理成若干条便于随手记的便笺。`,
      `每条 1-2 句，写清事实与来源；不要写空话。`,
      ``,
      `主题：${String(query || '').slice(0, 1000)}`,
      ``,
      `可用分类（必须原样使用其中一个）：${categoryList(categories)}`,
      ``,
      `当前时间：${localStamp(now)}`,
      ``,
      JSON_RULE,
      `格式：{"notes":[{"text":"<要点>","category":"<分类名>","source":"<来源网址或空串>"}]}`,
    ].join('\n');
  }

  /** 把便笺列表拼成给模型看的上下文 */
  function notesToContext(notes, limit) {
    const max = limit || 120;
    const lines = [];
    for (let i = 0; i < (notes || []).length && lines.length < max; i++) {
      const n = notes[i];
      const text = String(n.text || '').replace(/\s+/g, ' ').slice(0, 300);
      const stamp = n.createdAt ? localStamp(n.createdAt) : '';
      lines.push(`[${i + 1}] (${n.category || '其他'}${stamp ? '，' + stamp : ''}) ${text}`);
    }
    if (!lines.length) return '（当前没有任何便笺）';
    return lines.join('\n');
  }

  /* ------------------------------------------------------------------ *
   * 解析模型输出
   * ------------------------------------------------------------------ */

  /** 分类结果 */
  function parseCategorize(content, categories) {
    const obj = extractJson(content);
    if (!obj || typeof obj !== 'object') return null;
    const valid = (categories || []).map((c) => (typeof c === 'string' ? c : c.name));
    let category = String(obj.category || '').trim();
    // 模型自创了分类名时，退回「其他」，不硬塞
    if (valid.length && valid.indexOf(category) < 0) {
      const alias = valid.find((c) => category && (c.indexOf(category) >= 0 || category.indexOf(c) >= 0));
      category = alias || '其他';
    }
    if (!category) category = '其他';
    const keywords = Array.isArray(obj.keywords)
      ? obj.keywords.map((k) => String(k).trim()).filter(Boolean).slice(0, 6)
      : [];
    return {
      category,
      keywords,
      reason: String(obj.reason || '').trim(),
      confidence: typeof obj.confidence === 'number' ? Math.max(0, Math.min(1, obj.confidence)) : null,
    };
  }

  /** 便笺列表（{notes:[...]} 或裸数组） */
  function parseNotes(content, categories) {
    const obj = extractJson(content);
    let arr = null;
    if (Array.isArray(obj)) arr = obj;
    else if (obj && Array.isArray(obj.notes)) arr = obj.notes;
    if (!arr) return [];
    const valid = (categories || []).map((c) => (typeof c === 'string' ? c : c.name));
    const out = [];
    for (const item of arr.slice(0, 20)) {
      if (!item) continue;
      const text = String(item.text || item.content || '').trim();
      if (!text) continue;
      let category = String(item.category || '').trim();
      if (valid.length && valid.indexOf(category) < 0) {
        const alias = valid.find((c) => category && (c.indexOf(category) >= 0 || category.indexOf(c) >= 0));
        category = alias || '其他';
      }
      if (!category) category = '其他';
      out.push({
        text,
        category,
        remind_at: parseIsoToMs(item.remind_at || item.remindAt || ''),
        source: String(item.source || '').trim(),
      });
    }
    return out;
  }

  /** 时间建议 */
  function parseTime(content) {
    const obj = extractJson(content);
    if (!obj || typeof obj !== 'object') return null;
    const hasTime = obj.has_time === true || obj.hasTime === true || !!obj.remind_at || !!obj.remindAt;
    const at = parseIsoToMs(obj.remind_at || obj.remindAt || '');
    return {
      hasTime: hasTime && !!at,
      at,
      text: String(obj.text || '').trim(),
      reason: String(obj.reason || '').trim(),
    };
  }

  /** 问答结果 */
  function parseAnswer(content) {
    const obj = extractJson(content);
    if (!obj || typeof obj !== 'object') {
      const text = String(content || '').trim();
      return text ? { answer: text, refs: [], notes: [] } : null;
    }
    const refs = Array.isArray(obj.refs)
      ? obj.refs.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
      : [];
    const notes = Array.isArray(obj.notes) ? obj.notes.map((s) => String(s).trim()).filter(Boolean) : [];
    return { answer: String(obj.answer || '').trim(), refs, notes };
  }

  /** ISO 字符串 → 时间戳；解析不了返回 null */
  function parseIsoToMs(str) {
    const s = String(str == null ? '' : str).trim();
    if (!s) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
    if (m) {
      const ms = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0), 0).getTime();
      return Number.isFinite(ms) ? ms : null;
    }
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : null;
  }

  /* ------------------------------------------------------------------ *
   * 网络
   * ------------------------------------------------------------------ */

  /** 构造请求体（只放真正需要的旋钮，避免网关回 400） */
  function buildRequestBody(opts) {
    const o = opts || {};
    const body = {};
    if (o.messages) body.messages = o.messages;
    else body.prompt = String(o.prompt || '');
    if (o.system) body.system = o.system;
    if (o.provider) body.provider = o.provider;
    if (o.model) body.model = o.model;
    if (typeof o.temperature === 'number') body.temperature = o.temperature;
    if (o.maxTokens) body.max_tokens = o.maxTokens;
    if (o.webTools) body.web_tools = true;
    // reasoning_effort 只在明确指定时才带上：各网关支持的档位并不一致（见 effortLadder）
    if (o.reasoningEffort) body.reasoning_effort = o.reasoningEffort;
    return body;
  }

  /**
   * 思考强度阶梯。
   *
   * 实测（tea_a2 0.18.4 / deepseek-flash）：不传 reasoning_effort 或传 low/medium 时，
   * 模型会把输出预算全部花在 reasoning 上（finish_reason=length、正文为空）；
   * 传 none 则 1.8 秒就给出正文。但不是所有模型都认 none —— MiniMax 会以
   * "requires adaptive thinking" 拒绝，mimo 不认 minimal。所以按阶梯降级，
   * 并记住每个 provider/model 实际能用哪一档。
   */
  const EFFORT_LADDERS = {
    // 自动：先试不思考，再逐级放开，最后退到「不传这个字段」
    auto: ['none', 'minimal', 'low', null],
    none: ['none'],
    full: [null],
  };

  /** 已经验证可用的档位：base|model → effort */
  const effortCache = new Map();

  function effortLadder(thinking) {
    const key = thinking || 'auto';
    return (EFFORT_LADDERS[key] || EFFORT_LADDERS.auto).slice();
  }

  /** 上游抱怨 reasoning_effort 的典型措辞 */
  const REASONING_ERROR_RE = /(reasoning_effort|unknown variant|not allowed|adaptive thinking|invalid.*effort)/i;

  function retryable(msg) {
    const e = new Error(msg);
    e.retryable = true;
    return e;
  }

  /** 发一次请求，返回解析好的结果；不可重试的错误直接抛 */
  async function postChat(base, o, effort, timeout) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const body = buildRequestBody(Object.assign({}, o, { reasoningEffort: effort }));
      const res = await fetch(base + '/api/llm/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const raw = await res.text();
      let data = null;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        /* 不是 JSON */
      }
      if (!res.ok) {
        const msg =
          (data && ((data.error && data.error.message) || data.message)) || raw.slice(0, 200) || res.statusText;
        const text = `HTTP ${res.status}：${msg}`;
        // 模型不支持这一档思考强度 → 换下一档重试
        if (REASONING_ERROR_RE.test(msg)) throw retryable(text);
        throw new Error(text);
      }
      if (!data || typeof data.content !== 'string') {
        throw new Error('响应里没有 content 字段（可能不是 tea_a2 的 /api/llm/chat）');
      }
      // 正文为空 + finish_reason=length → 思考把预算吃光了，换低一档思考强度重试
      if (!data.content.trim() && data.finish_reason === 'length') {
        throw retryable('模型把输出预算全花在思考上（正文为空），换一档思考强度重试');
      }
      return {
        ok: true,
        content: data.content,
        reasoning: data.reasoning || '',
        model: data.model || o.model || '',
        provider: data.provider || '',
        usage: data.usage || null,
        elapsed_ms: data.elapsed_ms || 0,
        finish_reason: data.finish_reason || '',
        reasoning_effort: (data.knobs && data.knobs.reasoning_effort) || effort || 'auto',
        web_tool_calls: Array.isArray(data.web_tool_calls) ? data.web_tool_calls : [],
      };
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error(`请求超时（${Math.round(timeout / 1000)} 秒）`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 调一次 /api/llm/chat
   * @returns {Promise<{ok:true, content:string, reasoning:string, model:string, provider:string, usage:object, elapsed_ms:number}>}
   */
  async function chat(opts) {
    const o = opts || {};
    const base = normalizeBase(o.base);
    const timeout = o.timeoutMs || DEFAULT_TIMEOUT;
    const ladder = effortLadder(o.thinking);
    const cacheKey = base + '|' + (o.model || 'default');
    const cached = effortCache.get(cacheKey);
    const order =
      cached !== undefined ? [cached].concat(ladder.filter((x) => x !== cached)) : ladder.slice();

    let lastError = null;
    for (const effort of order) {
      try {
        const r = await postChat(base, o, effort, timeout);
        effortCache.set(cacheKey, effort);
        return r;
      } catch (e) {
        if (e && e.retryable) {
          lastError = e;
          continue;
        }
        throw e;
      }
    }
    throw lastError || new Error('请求失败');
  }

  /** 连通性测试：探活 + 列 provider */
  async function testConnection(base) {
    const b = normalizeBase(base);
    const out = { ok: false, base: b, version: '', provider: '', model: '', models: [], error: '' };
    try {
      const h = await fetch(b + '/api/health', { method: 'GET' });
      if (h.ok) {
        const j = await h.json();
        out.version = j.version || '';
        out.provider = j.provider || '';
        out.model = j.model || '';
      }
    } catch (e) {
      out.error = '连不上 ' + b + '（' + (e.message || e) + '）';
      return out;
    }
    try {
      const p = await fetch(b + '/api/providers', { method: 'GET' });
      if (p.ok) {
        const j = await p.json();
        out.models = (j.providers || []).map((x) => ({
          provider: x.name,
          model: x.default_model || (x.models || [])[0] || '',
          models: x.models || [],
        }));
      }
    } catch (e) {
      /* 模型列表拿不到不影响主流程 */
    }
    out.ok = true;
    return out;
  }

  return {
    DEFAULT_BASE,
    DEFAULT_TIMEOUT,
    DEFAULT_MAX_TOKENS,
    normalizeBase,
    localStamp,
    extractJson,
    buildCategorizePrompt,
    buildSummarizePrompt,
    buildTimePrompt,
    buildAskPrompt,
    buildSearchPrompt,
    notesToContext,
    parseCategorize,
    parseNotes,
    parseTime,
    parseAnswer,
    parseIsoToMs,
    buildRequestBody,
    effortLadder,
    effortCache,
    chat,
    testConnection,
  };
});
