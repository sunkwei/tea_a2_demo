/**
 * 李清照 · 漱玉词 —— 本地静态服务器
 *
 *   node li-qingzhao/tools/serve.mjs [端口=5179]
 *   node li-qingzhao/tools/serve.mjs --open
 *
 * 为什么还需要它：file:// 下请求 tea_a2 会被某些浏览器的 CORS/Private Network 策略拦，
 * http://127.0.0.1 下更稳；verify.mjs 也自己起一个同类服务器。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = Number(process.argv.find((a) => /^\d+$/.test(a))) || 5179;
const OPEN = process.argv.includes('--open');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.mp3': 'audio/mpeg',
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }
  const stat = fs.statSync(file);
  const mime = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
  if (m && stat.size) {
    let start = m[1] === '' ? stat.size - Number(m[2]) : Number(m[1]);
    let end = m[2] === '' || m[1] === '' ? stat.size - 1 : Number(m[2]);
    start = Math.max(0, start);
    end = Math.min(stat.size - 1, end);
    if (start > end) {
      res.writeHead(416, { 'content-range': 'bytes */' + stat.size });
      res.end();
      return;
    }
    res.writeHead(206, {
      'content-type': mime,
      'content-length': end - start + 1,
      'content-range': 'bytes ' + start + '-' + end + '/' + stat.size,
      'accept-ranges': 'bytes',
      'cache-control': 'no-cache',
    });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, {
    'content-type': mime,
    'content-length': stat.size,
    'accept-ranges': 'bytes',
    'cache-control': 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('李清照 · 漱玉词：http://127.0.0.1:' + PORT + '/');
  console.log('（Ctrl+C 停止）');
  if (OPEN) {
    const url = 'http://127.0.0.1:' + PORT + '/';
    execFile('xdg-open', [url], () => {});
  }
});
