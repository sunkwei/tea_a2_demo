/**
 * 直播源拉取与自动更新。
 *
 * 更新策略（关键点）：
 *  1. 条件请求：走同源代理时带上 If-None-Match / If-Modified-Since，
 *     代理侧带缓存（上游 304 时直接回放缓存内容）；
 *  2. 跨域直连时不发自定义头（会触发 CORS 预检，多数静态站点不支持预检），
 *     改用「内容哈希」判断是否真的有变化；
 *  3. 代理兜底：直连被 CORS 拦下时，按设置里的外部代理模板重试；
 *  4. 增量比对：解析后对比频道 key 集合，得到「新增 / 移除」数量；
 *  5. GitHub 提交检测：查仓库最新 commit，发现新提交时提示强制刷新。
 */

import { parseM3U, channelKey } from './m3u.js';

const DEFAULT_TIMEOUT = 30000;

/** FNV-1a 32bit → 用于判断列表内容是否变化 */
export function hashText(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function applyProxy(url, proxy) {
  if (!proxy) return url;
  if (proxy.includes('{url}')) return proxy.replace('{url}', encodeURIComponent(url));
  return proxy + encodeURIComponent(url);
}

/**
 * 拉取文本。
 * @param {string} url
 * @param {{etag?:string,lastModified?:string,proxy?:string,sameOrigin?:string,timeoutMs?:number,signal?:AbortSignal}} opts
 *        sameOrigin：同源代理前缀（如 '/api/proxy?url='），走它可以带条件请求且不触发预检
 */
export async function fetchText(url, opts = {}) {
  const { etag, lastModified, proxy = '', sameOrigin = '', timeoutMs = DEFAULT_TIMEOUT, signal } = opts;

  const attempt = async (target, withConditional) => {
    const headers = {};
    if (withConditional) {
      if (etag) headers['If-None-Match'] = etag;
      if (lastModified) headers['If-Modified-Since'] = lastModified;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const onAbort = () => ctrl.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await fetch(target, { headers, signal: ctrl.signal, cache: 'no-store', redirect: 'follow' });
      if (res.status === 304) {
        return {
          ok: true,
          notModified: true,
          status: 304,
          etag: res.headers.get('etag') || etag || '',
          lastModified: res.headers.get('last-modified') || lastModified || '',
        };
      }
      if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
      const text = await res.text();
      return {
        ok: true,
        notModified: false,
        status: res.status,
        text,
        etag: res.headers.get('etag') || '',
        lastModified: res.headers.get('last-modified') || '',
        viaProxy: target !== url,
      };
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  };

  const tryTarget = async (target, withConditional) => {
    try {
      return await attempt(target, withConditional);
    } catch (err) {
      return {
        ok: false,
        status: 0,
        error: err?.name === 'AbortError' ? '请求超时' : err?.message || '网络错误',
      };
    }
  };

  // 1) 同源代理：可带条件请求（不触发预检）
  if (sameOrigin) {
    const r = await tryTarget(sameOrigin + encodeURIComponent(url), true);
    if (r.ok) return r;
    // 同源代理失败 → 退回直连
  }

  // 2) 直连：不要带自定义头（会触发预检，多数站点不支持）
  const direct = await tryTarget(url, false);
  if (direct.ok) return direct;

  // 3) 外部 CORS 代理兜底
  if (proxy) {
    const p = await tryTarget(applyProxy(url, proxy), false);
    if (p.ok) return p;
  }
  return direct;
}

/**
 * 更新单个源：拉取 → 解析 → 与旧数据比对
 * @param {object} source
 * @param {object} state 上次的 { etag, lastModified, hash, keys }
 */
export async function updateSource(source, state = {}, opts = {}) {
  const started = Date.now();
  const res = await fetchText(source.url, {
    etag: state.etag,
    lastModified: state.lastModified,
    proxy: opts.proxy,
    sameOrigin: opts.sameOrigin,
    timeoutMs: opts.timeoutMs,
    signal: opts.signal,
  });

  if (!res.ok) {
    return { source, ok: false, error: res.error, status: res.status, ms: Date.now() - started };
  }

  const hash = res.text !== undefined ? hashText(res.text) : '';
  const base = {
    source,
    ok: true,
    etag: res.etag || state.etag || '',
    lastModified: res.lastModified || state.lastModified || '',
    hash,
    ms: Date.now() - started,
  };

  if (res.notModified) {
    return { ...base, notModified: true, entries: null, count: state.count || 0 };
  }

  // 内容哈希一致 → 视为无变化（省掉解析与 diff）
  if (state.hash && hash && state.hash === hash) {
    return { ...base, notModified: true, entries: null, count: state.count || 0, sameContent: true };
  }

  const { entries, stats } = parseM3U(res.text, { id: source.id, name: source.name });
  const keys = new Set(entries.map((e) => e.key));
  // 优先用内存中的旧条目做 diff；没有再退回上次持久化的 key 列表
  const oldKeys = new Set(state.entries ? state.entries.map((e) => e.key) : state.keys || []);
  let added = 0;
  let removed = 0;
  for (const k of keys) if (!oldKeys.has(k)) added++;
  for (const k of oldKeys) if (!keys.has(k)) removed++;

  return {
    ...base,
    notModified: false,
    entries,
    count: entries.length,
    groups: stats.groups.size,
    added,
    removed,
    viaProxy: !!res.viaProxy,
  };
}

/**
 * 依次更新多个源（串行，避免同时打满带宽；单个源失败不阻塞其它源）
 */
export async function updateSources(sources, states, opts = {}, onProgress) {
  const results = [];
  for (const source of sources) {
    const state = states[source.id] || {};
    if (onProgress) onProgress({ phase: 'fetch', source });
    const r = await updateSource(source, state, opts);
    results.push(r);
    if (onProgress) onProgress({ phase: 'done', result: r, source });
    if (opts.signal?.aborted) break;
  }
  return results;
}

/**
 * 查 GitHub 仓库某个路径的最新提交（用于「仓库有新提交」提示）
 */
export async function githubLatestCommit(repo, path) {
  const url = `https://api.github.com/repos/${repo}/commits?path=${encodeURIComponent(path)}&per_page=1`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) return { ok: true, sha: '', date: '', message: '无提交记录' };
    const c = data[0];
    return {
      ok: true,
      sha: c.sha,
      date: c.commit?.committer?.date || '',
      message: (c.commit?.message || '').split('\n')[0],
      url: c.html_url || '',
    };
  } catch (err) {
    return { ok: false, error: err?.message || '网络错误' };
  }
}

export { channelKey };
