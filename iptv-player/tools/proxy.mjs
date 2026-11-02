/**
 * 本地流代理 + 静态服务器（dev server 插件与独立 serve 脚本共用）。
 *
 * 为什么需要：
 *  1) 绝大多数直播服务器不返回 `Access-Control-Allow-Origin`，
 *     浏览器里的 hls.js 直接拉清单会被 CORS 拦掉（表现为「网络错误」）；
 *  2) 跨域发 If-None-Match 会触发 CORS 预检，GitHub Pages 之类不处理预检，
 *     所以条件请求只能走同源代理；
 *  3) 直播源经常 302 跳转到别处 —— 跳转必须由代理自己跟完，
 *     否则浏览器会拿着 302 去访问外域，再次被 CORS 拦掉；
 *  4) HLS 清单里常用相对路径，必须改写成代理地址，否则 hls.js 会解析错；
 *  5) 代理侧带一份 ETag 缓存，上游返回 304 时可以直接回放内容，省一次往返。
 */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.m3u': 'audio/x-mpegurl',
  '.ts': 'video/mp2t',
};

/** 允许代理的目标（默认放行；服务只监听 127.0.0.1） */
const ALLOWED_HOSTS = [
  'iptv-org.github.io',
  'raw.githubusercontent.com',
  'github.com',
  'objects.githubusercontent.com',
  'api.allorigins.win',
  'localhost',
  '127.0.0.1',
];

function hostAllowed(hostname) {
  if (process.env.IPTV_PROXY_ALLOW_LIST !== '1') return true;
  return ALLOWED_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));
}

/** 清单重写时使用的同源代理前缀 */
const PROXY_PREFIX = '/api/proxy?url=';

/** 条件请求缓存：url -> { etag, body, contentType } */
const condCache = new Map();
const COND_CACHE_MAX = 64 * 1024 * 1024;

function cacheGet(key, etag) {
  const hit = condCache.get(key);
  if (!hit) return null;
  if (etag && hit.etag && hit.etag === etag) return hit;
  return null;
}

function cacheSet(key, etag, body, contentType) {
  if (!etag || body.length > 8 * 1024 * 1024) return;
  condCache.set(key, { etag, body, contentType });
  let total = 0;
  for (const v of condCache.values()) total += v.body.length;
  while (total > COND_CACHE_MAX && condCache.size > 1) {
    const first = condCache.keys().next().value;
    total -= condCache.get(first).body.length;
    condCache.delete(first);
  }
}

/** 判断内容是否像 HLS 清单 */
function looksLikeManifest(contentType, head) {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('mpegurl') || ct.includes('x-mpegurl')) return true;
  return typeof head === 'string' && head.trimStart().startsWith('#EXTM3U');
}

/** 把清单里的相对 URI 改写成「代理地址」 */
function rewriteUri(uri, baseUrl) {
  if (!uri) return uri;
  if (/^(https?:)?\/\//i.test(uri) || uri.startsWith('data:') || uri.startsWith('/api/proxy')) return uri;
  let abs;
  try {
    abs = new URL(uri, baseUrl).toString();
  } catch {
    return uri;
  }
  return PROXY_PREFIX + encodeURIComponent(abs);
}

function rewriteManifest(text, baseUrl) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith('#')) {
        return line.replace(/URI="([^"]*)"/g, (_m, u) => `URI="${rewriteUri(u, baseUrl)}"`);
      }
      return rewriteUri(t, baseUrl);
    })
    .join('\n');
}

/**
 * 处理一条 /api/proxy 请求（自动跟随 3xx 跳转）
 */
export function handleProxy(req, res, targetRaw, depth = 0) {
  let target;
  try {
    target = new URL(targetRaw);
  } catch {
    res.writeHead(400, { 'access-control-allow-origin': '*' });
    res.end('bad url');
    return;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    res.writeHead(400, { 'access-control-allow-origin': '*' });
    res.end('unsupported protocol');
    return;
  }
  if (!hostAllowed(target.hostname)) {
    res.writeHead(403, { 'access-control-allow-origin': '*' });
    res.end('host not allowed');
    return;
  }
  if (depth > 5) {
    res.writeHead(508, { 'access-control-allow-origin': '*' });
    res.end('too many redirects');
    return;
  }

  const key = target.toString();
  const reqEtag = req.headers['if-none-match'];

  // 代理侧 ETag 缓存命中 → 直接回放
  if (reqEtag) {
    const hit = cacheGet(key, reqEtag);
    if (hit) {
      res.writeHead(200, {
        'content-type': hit.contentType || 'application/octet-stream',
        'content-length': hit.body.length,
        etag: hit.etag,
        'access-control-allow-origin': '*',
        'x-iptv-cache': 'HIT',
      });
      res.end(hit.body);
      return;
    }
  }

  const client = target.protocol === 'https:' ? https : http;
  const headers = { ...req.headers, host: target.host };
  delete headers['accept-encoding']; // 保持 body 长度与 Content-Length 一致
  delete headers.connection;

  const upstream = client.request(target, { method: req.method, headers }, (up) => {
    const out = { ...up.headers };
    out['access-control-allow-origin'] = '*';
    out['access-control-allow-headers'] = '*';
    out['access-control-expose-headers'] = '*';

    // 3xx：代理自己跟完，别把跳转甩给浏览器（否则又变成跨域）
    if ([301, 302, 303, 307, 308].includes(up.statusCode) && up.headers.location) {
      up.resume();
      let nextUrl;
      try {
        nextUrl = new URL(up.headers.location, target).toString();
      } catch {
        res.writeHead(502, out);
        res.end('bad redirect');
        return;
      }
      handleProxy(req, res, nextUrl, depth + 1);
      return;
    }

    // 上游说「没变」：有缓存就回放内容，没有就把 304 透传给浏览器
    if (up.statusCode === 304) {
      const hit = condCache.get(key);
      if (hit) {
        out['content-length'] = hit.body.length;
        out['content-type'] = hit.contentType || out['content-type'];
        out['x-iptv-cache'] = 'REPLAY';
        res.writeHead(200, out);
        res.end(hit.body);
      } else {
        res.writeHead(304, out);
        res.end();
      }
      return;
    }

    const len = Number(up.headers['content-length'] || 0);
    const ct = String(up.headers['content-type'] || '');
    const shouldBuffer =
      up.statusCode === 200 && !req.headers.range && (len === 0 || len <= 4 * 1024 * 1024) && /mpegurl|text\/plain|application\/octet-stream|application\/vnd/i.test(ct);

    if (shouldBuffer) {
      const chunks = [];
      up.on('data', (c) => chunks.push(c));
      up.on('end', () => {
        let body = Buffer.concat(chunks);
        const head = body.slice(0, 32).toString('utf8');
        if (looksLikeManifest(ct, head)) {
          // 关键：清单里的相对 URI 必须改写成代理地址，否则 hls.js 会解析错
          body = Buffer.from(rewriteManifest(body.toString('utf8'), key), 'utf8');
          out['content-type'] = 'application/vnd.apple.mpegurl';
          out['x-iptv-rewritten'] = '1';
        }
        if (reqEtag && up.statusCode === 200) {
          cacheSet(key, up.headers.etag, body, ct);
        }
        res.writeHead(up.statusCode || 502, { ...out, 'content-length': body.length });
        res.end(body);
      });
      return;
    }

    res.writeHead(up.statusCode || 502, out);
    up.pipe(res);
  });
  upstream.setTimeout(15000, () => upstream.destroy(new Error('upstream timeout')));
  upstream.on('error', (err) => {
    if (res.headersSent) return res.end();
    res.writeHead(502, { 'access-control-allow-origin': '*', 'content-type': 'text/plain; charset=utf-8' });
    res.end(`proxy error: ${err.message}`);
  });
  upstream.end();
}

/** connect 风格中间件：命中 /api/proxy 就转发，其余交给 next */
export function proxyMiddleware(req, res, next) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/api/proxy') return next();
  if (url.searchParams.get('ping') === '1') {
    res.writeHead(200, { 'access-control-allow-origin': '*', 'content-type': 'text/plain' });
    res.end('pong');
    return;
  }
  const target = url.searchParams.get('url');
  if (!target) {
    res.writeHead(400, { 'access-control-allow-origin': '*' });
    res.end('missing url');
    return;
  }
  handleProxy(req, res, target);
}

/** 简单静态服务器（dist 目录） */
export function createStaticServer(root) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/proxy') {
      if (url.searchParams.get('ping') === '1') {
        res.writeHead(200, { 'access-control-allow-origin': '*', 'content-type': 'text/plain' });
        return res.end('pong');
      }
      return handleProxy(req, res, url.searchParams.get('url') || '');
    }
    let file = path.join(root, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(root, 'index.html');
    }
    if (!fs.existsSync(file)) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
    });
    fs.createReadStream(file).pipe(res);
  });
}

export { hostAllowed };
