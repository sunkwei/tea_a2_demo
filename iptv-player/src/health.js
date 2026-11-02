/**
 * 频道可用性探测（尽力而为的「在线 / 失效」判定）。
 *
 * 现实约束：绝大多数直播服务器不带 CORS 头，浏览器拿不到状态码。
 * 因此分三档：
 *   online    —— 拿到了 m3u8 清单且能解析（有 CORS 或同源）
 *   reachable —— 服务器有响应（no-cors 拿到 opaque 响应），但内容无法校验
 *   offline   —— DNS / 连接 / 超时失败
 */

const DEFAULT_TIMEOUT = 8000;

function withTimeout(ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(timer) };
}

function isManifest(url) {
  return /\.(m3u8|m3u)(\?|$)/i.test(url) || /\/manifest/i.test(url);
}

/**
 * 探测单个频道
 * @returns {Promise<'online'|'reachable'|'offline'>}
 */
export async function probeChannel(entry, opts = {}) {
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT;
  const url = entry?.url;
  if (!url) return 'offline';

  // 1) 尝试带 CORS 读清单
  const t1 = withTimeout(timeoutMs);
  try {
    const res = await fetch(url, { signal: t1.signal, cache: 'no-store', redirect: 'follow' });
    if (res.ok) {
      const text = await res.text();
      if (text.includes('#EXTM3U')) return 'online';
      // 非 HLS 直链（mp4 等）：能下到内容即算在线
      if (text.length > 0) return 'online';
    }
    if (res.status === 403 || res.status === 401) return 'offline';
    if (res.status >= 400) return 'offline';
  } catch {
    /* 落到 no-cors 探测 */
  } finally {
    t1.done();
  }

  // 同源代理已经能拿到明确结果，失败即视为失效
  if (String(url).startsWith('/')) return 'offline';

  // 2) no-cors 探测：只要服务器有响应就说明地址可达
  const t2 = withTimeout(timeoutMs);
  try {
    await fetch(url, { mode: 'no-cors', signal: t2.signal, cache: 'no-store', redirect: 'follow' });
    return 'reachable';
  } catch {
    return 'offline';
  } finally {
    t2.done();
  }
}

/**
 * 并发受限的批量探测
 * @param {Array} items
 * @param {(item, status)=>void} onResult
 */
export async function probeMany(items, onResult, opts = {}) {
  const concurrency = opts.concurrency || 6;
  const limit = opts.limit || Infinity;
  const list = items.slice(0, limit);
  let idx = 0;
  const workers = new Array(Math.min(concurrency, list.length)).fill(0).map(async () => {
    while (idx < list.length) {
      const item = list[idx++];
      let status = 'offline';
      try {
        status = await probeChannel(item, opts);
      } catch {
        status = 'offline';
      }
      onResult?.(item, status);
    }
  });
  await Promise.all(workers);
  return list.length;
}

/**
 * 播放过程中由播放器回报的真实可用性（比探测更准）：
 * 清单加载成功 → online；媒体错误 → offline。
 */
export function statusFromPlayback(event) {
  switch (event) {
    case 'manifest-loaded':
    case 'manifest-parsed':
    case 'playing':
      return 'online';
    case 'fatal':
      return 'offline';
    default:
      return 'unknown';
  }
}
