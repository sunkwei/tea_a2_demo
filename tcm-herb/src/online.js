/**
 * 中药大全 · 联网查询层（本机 a2，不依赖 DOM）
 *
 * 浏览器：普通 <script> 引入后挂到 window.TCMOnline
 * Node  ：new Function(src)() 之后取 globalThis.TCMOnline
 *
 * 设计（需求 Q4/Q5）：
 *   · 不设开关：启动时静默探测 GET /api/health，能用就用
 *   · 不能用：返回可复制的启动指引（不弹确认框、不打断本地功能）
 *   · 用 POST /api/llm/chat + web_tools:true（服务端代模型调搜索端点）
 *   · 实测坑：默认 provider 是 minimax，配 reasoning_effort:"none" 会 502；
 *     因此显式指定 provider=deepseek + model=deepseek-flash（该 provider supports_search）
 *   · CORS 为 *，file:// 页面可直接 fetch
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TCMOnline = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function () {
  'use strict';

  const DEFAULT_BASE = 'http://localhost:8383';
  const PROVIDER = 'deepseek';
  const MODEL = 'deepseek-flash';
  const HEALTH_TIMEOUT = 3500;
  const CHAT_TIMEOUT = 60000;
  const MAX_TOKENS = 1400;

  function normalizeBase(url) {
    let s = String(url == null ? '' : url).trim();
    if (!s) s = DEFAULT_BASE;
    if (!/^https?:\/\//i.test(s)) s = 'http://' + s.replace(/^\/+/, '');
    return s.replace(/\/+$/, '');
  }

  function healthUrl(base) { return normalizeBase(base) + '/api/health'; }
  function chatUrl(base) { return normalizeBase(base) + '/api/llm/chat'; }

  function withTimeout(ms, external) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (external && typeof external.then === 'function') {
      external.then(function () { if (ctrl) ctrl.abort(); });
    }
    let timer = null;
    const signal = ctrl ? ctrl.signal : undefined;
    const guard = new Promise(function (_, reject) {
      timer = setTimeout(function () {
        if (ctrl) ctrl.abort();
        const err = new Error('timeout');
        err.code = 'timeout';
        reject(err);
      }, ms);
    });
    return { signal: signal, guard: guard, clear: function () { if (timer) clearTimeout(timer); } };
  }

  async function requestJson(url, options, timeoutMs) {
    const t = withTimeout(timeoutMs, options && options.externalSignal);
    const init = Object.assign({}, options, { signal: t.signal });
    delete init.externalSignal;
    try {
      if (typeof fetch !== 'function') throw Object.assign(new Error('fetch unavailable'), { code: 'no_fetch' });
      const res = await Promise.race([fetch(url, init), t.guard]);
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
      return { res: res, status: res.status, json: json, text: text };
    } finally {
      t.clear();
    }
  }

  /* ------------------------------------------------------------------ *
   * 探测
   * ------------------------------------------------------------------ */

  /**
   * @returns {Promise<{ok:boolean, base:string, version?:string, provider?:string, model?:string, error?:string}>}
   */
  async function probe(base, opts) {
    const options = opts || {};
    const url = healthUrl(base);
    try {
      const r = await requestJson(url, { method: 'GET', cache: 'no-store' }, options.timeout || HEALTH_TIMEOUT);
      if (!r.res.ok) {
        return { ok: false, base: normalizeBase(base), error: 'http_' + r.status };
      }
      const j = r.json || {};
      if (j.ok === false) return { ok: false, base: normalizeBase(base), error: 'not_ready' };
      return {
        ok: true,
        base: normalizeBase(base),
        version: j.version || '',
        provider: j.provider || '',
        model: j.model || '',
      };
    } catch (e) {
      const code = e && e.code === 'timeout' ? 'timeout' : 'offline';
      return { ok: false, base: normalizeBase(base), error: code };
    }
  }

  /* ------------------------------------------------------------------ *
   * 提示词
   * ------------------------------------------------------------------ */

  function buildPrompt(query) {
    return [
      '你是中医药科普助手。请根据联网检索到的资料，用通俗的现代汉语回答用户关于「' + String(query || '').trim() + '」的查询。',
      '',
      '硬性要求：',
      '1. 只做科普，不做诊断、不推荐个体化处方、不写剂量与煎服法；',
      '2. 讲清：是什么、常见功效或作用、常见应用场景、注意事项与禁忌；',
      '3. 资料不足或说法不一致时，直接写「资料有限，建议咨询医师或药师」，不要编造；',
      '4. 300 字以内，分 3–5 点陈述，不要 markdown 表格；',
      '5. 最后另起一行以「来源：」开头列出参考链接。',
    ].join('\n');
  }

  /* ------------------------------------------------------------------ *
   * 结果解析
   * ------------------------------------------------------------------ */

  /** 把一段 "N result(s) for: q\n\n[1] 标题\n    url: ...\n    score: ...\n..." 解析成来源数组 */
  function parseSearchOutput(text) {
    const src = String(text == null ? '' : text);
    const out = [];
    const blocks = src.split(/\n(?=\[\d+\]\s)/);
    blocks.forEach(function (block) {
      const head = block.match(/^\[(\d+)\]\s*(.*)$/m);
      if (!head) return;
      const urlM = block.match(/\n\s*url:\s*(\S+)/);
      if (!urlM) return;
      const scoreM = block.match(/\n\s*score:\s*([\d.]+)/);
      const authM = block.match(/\n\s*authority:\s*(\d+)/);
      const sumM = block.match(/\n\s*summary:\s*([\s\S]*)$/);
      out.push({
        index: Number(head[1]) || out.length + 1,
        title: (head[2] || '').trim() || urlM[1],
        url: urlM[1].trim(),
        score: scoreM ? Number(scoreM[1]) : null,
        authority: authM ? Number(authM[1]) : null,
        summary: sumM ? sumM[1].trim().replace(/\s+\n/g, '\n').slice(0, 400) : '',
      });
    });
    return out;
  }

  /** 从 web_tool_calls[] 汇总来源 */
  function parseSources(webToolCalls) {
    const list = [];
    const seen = Object.create(null);
    (Array.isArray(webToolCalls) ? webToolCalls : []).forEach(function (call) {
      if (!call || call.ok === false) return;
      parseSearchOutput(call.output || '').forEach(function (item) {
        if (!item.url || seen[item.url]) return;
        seen[item.url] = true;
        list.push(item);
      });
    });
    return list;
  }

  /** 正文里出现的链接（模型自己写的「来源」），作为补充 */
  function extractUrls(text) {
    const out = [];
    const seen = Object.create(null);
    const re = /https?:\/\/[^\s<>"')，。；]+/g;
    let m;
    const src = String(text == null ? '' : text);
    while ((m = re.exec(src)) !== null) {
      const url = m[0].replace(/[.,;:]+$/, '');
      if (seen[url]) continue;
      seen[url] = true;
      out.push({ url: url, title: '', summary: '', score: null, authority: null, index: null });
    }
    return out;
  }

  function mergeSources(primary, extra) {
    const out = (primary || []).slice();
    const seen = Object.create(null);
    out.forEach(function (s) { seen[s.url] = true; });
    (extra || []).forEach(function (s) {
      if (s.url && !seen[s.url]) {
        seen[s.url] = true;
        out.push(s);
      }
    });
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 查询
   * ------------------------------------------------------------------ */

  /**
   * @returns {Promise<{ok:boolean, kind?:string, content?:string, sources?:Array,
   *                   error?:string, elapsedMs?:number, provider?:string, model?:string}>}
   */
  async function search(query, opts) {
    const options = opts || {};
    const started = Date.now();
    const body = {
      prompt: buildPrompt(query),
      provider: options.provider || PROVIDER,
      model: options.model || MODEL,
      web_tools: true,
      reasoning_effort: 'none',
      max_tokens: MAX_TOKENS,
    };

    try {
      const r = await requestJson(
        chatUrl(options.base),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          cache: 'no-store',
        },
        options.timeout || CHAT_TIMEOUT
      );

      if (!r.res.ok) {
        return {
          ok: false,
          kind: r.status === 502 ? 'upstream' : 'http',
          error: 'http_' + r.status,
          detail: (r.text || '').slice(0, 300),
        };
      }

      const j = r.json || {};
      const content = String(j.content || '').trim();
      const sources = mergeSources(parseSources(j.web_tool_calls), extractUrls(content));

      if (!content && !sources.length) {
        return { ok: false, kind: 'empty', error: 'empty', elapsedMs: Date.now() - started };
      }

      return {
        ok: true,
        kind: 'ok',
        content: content,
        sources: sources,
        elapsedMs: typeof j.elapsed_ms === 'number' ? j.elapsed_ms : Date.now() - started,
        provider: j.provider || body.provider,
        model: j.model || body.model,
        webCalls: Array.isArray(j.web_tool_calls) ? j.web_tool_calls.length : 0,
      };
    } catch (e) {
      const timeout = e && e.code === 'timeout';
      return {
        ok: false,
        kind: timeout ? 'timeout' : 'offline',
        error: timeout ? 'timeout' : 'offline',
      };
    }
  }

  /** 启动指引（可直接复制执行；不假设工作区路径） */
  function startHint(base) {
    const b = normalizeBase(base);
    return [
      '未连接本机 a2（' + b + '）。',
      '在终端执行：',
      'tea_agent --port 8383 --workspace <你的工作区目录>',
      '（Windows 上 tea_agent.exe 通常在 C:\\Users\\<你>\\bin，已加入 PATH；',
      ' 也可用 brew/二进制路径直接启动，端口必须是 8383）',
      '启动后回到本页，点「重试」。',
    ].join('\n');
  }

  function errorText(kind) {
    if (kind === 'offline') return '连不上本机 a2（可能未启动）。';
    if (kind === 'timeout') return '本机 a2 响应超时（模型或搜索较慢）。';
    if (kind === 'upstream') return '本机 a2 的模型或搜索服务报错（502），请查看 a2 日志或换 provider。';
    if (kind === 'empty') return '联网返回为空，请换个关键词再试。';
    if (kind === 'http') return '本机 a2 返回了错误状态。';
    return '联网查询失败。';
  }

  return {
    DEFAULT_BASE: DEFAULT_BASE,
    PROVIDER: PROVIDER,
    MODEL: MODEL,
    normalizeBase: normalizeBase,
    healthUrl: healthUrl,
    chatUrl: chatUrl,
    probe: probe,
    buildPrompt: buildPrompt,
    parseSearchOutput: parseSearchOutput,
    parseSources: parseSources,
    extractUrls: extractUrls,
    mergeSources: mergeSources,
    search: search,
    startHint: startHint,
    errorText: errorText,
  };
});
