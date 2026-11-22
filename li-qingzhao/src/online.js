/**
 * 李清照 · 漱玉词 —— 联网问答层（本机 tea_a2，不依赖 DOM）
 *
 * 浏览器：<script> 引入后挂到 window.LI_QINGZHAO_ONLINE（需要先加载 core.js）
 * Node  ：vm 加载后取 module.exports（tools/selftest.mjs 用）
 *
 * 设计：
 *   · 不设开关：启动时静默探测 GET /api/health，能用就用
 *   · 用 POST /api/llm/chat + web_tools:true（服务端代模型调搜索端点）
 *   · 默认 deepseek / deepseek-flash：该 provider 支持服务端联网检索
 *   · CORS 为 *，file:// 页面可直接 fetch（仍建议用 tools/serve.mjs 起 http）
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LI_QINGZHAO_ONLINE = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function (root) {
  'use strict';

  const DEFAULT_BASE = 'http://localhost:8383';
  const PROVIDER = 'deepseek';
  const MODEL = 'deepseek-flash';
  const HEALTH_TIMEOUT = 3500;
  const CHAT_TIMEOUT = 90000;
  const MAX_TOKENS = 1600;

  function core() {
    const c = root && root.LI_QINGZHAO_CORE;
    if (!c) throw new Error('LI_QINGZHAO_CORE 未加载');
    return c;
  }

  function normalizeBase(url) {
    let s = String(url == null ? '' : url).trim();
    if (!s) s = DEFAULT_BASE;
    if (!/^https?:\/\//i.test(s)) s = 'http://' + s.replace(/^\/+/, '');
    return s.replace(/\/+$/, '');
  }

  function healthUrl(base) { return normalizeBase(base) + '/api/health'; }
  function chatUrl(base) { return normalizeBase(base) + '/api/llm/chat'; }

  function withTimeout(ms) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timer = null;
    const guard = new Promise(function (_, reject) {
      timer = setTimeout(function () {
        if (ctrl) ctrl.abort();
        const err = new Error('timeout');
        err.code = 'timeout';
        reject(err);
      }, ms);
    });
    return { signal: ctrl ? ctrl.signal : undefined, guard: guard, clear: function () { if (timer) clearTimeout(timer); } };
  }

  async function requestJson(url, options, timeoutMs) {
    const t = withTimeout(timeoutMs);
    const init = Object.assign({}, options, { signal: t.signal });
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

  async function probe(base, opts) {
    const options = opts || {};
    try {
      const r = await requestJson(healthUrl(base), { method: 'GET', cache: 'no-store' }, options.timeout || HEALTH_TIMEOUT);
      if (!r.res.ok) return { ok: false, base: normalizeBase(base), error: 'http_' + r.status };
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

  /**
   * @returns {Promise<{ok:boolean, kind?:string, content?:string, sources?:Array,
   *                   error?:string, elapsedMs?:number, provider?:string, model?:string, webCalls?:number}>}
   */
  async function search(query, opts) {
    const options = opts || {};
    const started = Date.now();
    const body = {
      prompt: core().buildAskPrompt(options.entry || null, query, options.meta || null),
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
      const c = core();
      const sources = c.mergeSources(c.parseSources(j.web_tool_calls), c.extractUrls(content));

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
      return { ok: false, kind: timeout ? 'timeout' : 'offline', error: timeout ? 'timeout' : 'offline' };
    }
  }

  /** 启动指引（可直接复制执行） */
  function startHint(base) {
    const b = normalizeBase(base);
    return [
      '未连接本机 tea_a2（' + b + '）。',
      '在终端执行：',
      'tea_agent --port 8383 --workspace <你的工作区目录>',
      '（Windows 上通常是 C:\\Users\\<你>\\bin\\tea_agent.exe，已加入 PATH）',
      '启动后回到本页，点「重试」。',
      '注意：浏览器从 file:// 直接请求可能被 CORS 拦，起个本地服务器更稳：',
      'node li-qingzhao/tools/serve.mjs',
    ].join('\n');
  }

  function errorText(kind) {
    if (kind === 'offline') return '连不上本机 tea_a2（可能未启动）。';
    if (kind === 'timeout') return '本机 tea_a2 响应超时（模型或检索较慢）。';
    if (kind === 'upstream') return 'tea_a2 的模型或检索服务报错（502），请查看 a2 日志或换 provider。';
    if (kind === 'empty') return '联网返回为空，请换个问法再试。';
    if (kind === 'http') return 'tea_a2 返回了错误状态。';
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
    search: search,
    startHint: startHint,
    errorText: errorText,
  };
});
