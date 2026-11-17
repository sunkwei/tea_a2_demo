/**
 * 终末地 · 舰桥观测舱 —— 本地静态服务器
 *
 *   node endfield-ship/tools/serve.mjs [端口=5178]
 *
 * 之所以需要服务器：页面用原生 ES Module + importmap，
 * file:// 协议下浏览器会拦截模块加载。
 *
 * 服务器以「仓库根目录」为站点根，这样页面里的
 *   ../node_modules/three/...
 * 才能解析到 three.js（也方便同时访问仓库里其它 demo）。
 *
 * 打开：http://127.0.0.1:5178/endfield-ship/
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..'); // endfield-ship/
const ROOT = path.resolve(PROJECT, '..'); // 仓库根
const PORT = Number(process.argv[2]) || 5178;

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
};

const server = http.createServer((req, res) => {
  let url;
  try {
    url = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('400 Bad Request');
    return;
  }

  let rel = url.replace(/^\/+/, '');
  // 根路径 → endfield-ship/
  if (!rel) rel = 'endfield-ship/index.html';
  // 目录 → index.html
  if (rel.endsWith('/')) rel += 'index.html';

  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found: ' + rel);
    return;
  }

  res.writeHead(200, {
    'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'cache-control': 'no-cache',
    // three 的 addons 里没有裸 import 之外的跨域需求，但加上更稳
    'access-control-allow-origin': '*',
  });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`终末地 · 舰桥观测舱已启动：`);
  console.log(`  → http://127.0.0.1:${PORT}/endfield-ship/`);
  console.log(`（Ctrl+C 停止）`);
});
