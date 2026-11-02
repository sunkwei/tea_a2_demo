// tools/music.mjs — 在页面里离线渲染背景音乐并保存为 WAV
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../dist');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = path.resolve(HERE, '../release/music.wav');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/save-music') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      fs.writeFileSync(OUT, buf);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      console.log(`音乐已保存：${OUT}  (${(buf.length / 1024 / 1024).toFixed(2)} MB)`);
    });
    return;
  }
  const url = decodeURIComponent(req.url.split('?')[0]);
  let file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--headless=new', '--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${port}/attention-film/index.html?clean=1`, { waitUntil: 'load' });
await page.waitForFunction('window.__filmReady === true');

await page.evaluate(async () => {
  const ab = await window.__film.music();
  await fetch('/save-music', { method: 'POST', body: ab });
});

await new Promise((r) => setTimeout(r, 500));
await browser.close();
server.close();
process.exit(fs.existsSync(OUT) ? 0 : 1);
