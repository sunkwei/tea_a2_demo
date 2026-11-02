// tools/probe.mjs — 像素探针：渲染某一帧并采样指定坐标的颜色，用来客观确认元素是否真的画出来了
// 用法: node tools/probe.mjs 40 "240,430=左边界框" "1000,430=FFN框" ...
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../dist');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const t = Number(process.argv[2] || 40);
const points = process.argv.slice(3).map((a) => {
  const [xy, label] = a.split('=');
  const [x, y] = xy.split(',').map(Number);
  return { x, y, label: label || xy };
});

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };
const server = http.createServer((req, res) => {
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
  args: ['--headless=new', '--no-sandbox', '--disable-gpu', '--window-size=1920,1080'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
await page.goto(`http://127.0.0.1:${port}/attention-film/index.html?clean=1`, { waitUntil: 'load' });
await page.waitForFunction('window.__filmReady === true');

const out = await page.evaluate(
  (tt, pts) => {
    window.__film.setTime(tt);
    const c = document.getElementById('film');
    const ctx = c.getContext('2d');
    return pts.map((p) => {
      const d = ctx.getImageData(p.x, p.y, 1, 1).data;
      const hex = '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
      return `${p.x},${p.y} ${hex}  ${p.label}`;
    });
  },
  t,
  points
);
console.log(`t=${t}s 像素探针：`);
for (const line of out) console.log('  ' + line);
await browser.close();
server.close();
process.exit(0);
