// tools/capture.mjs — 无头渲染整部短片的帧序列（确定性时间轴，逐帧可复现）
// 用法: node tools/capture.mjs [fps] [outDir]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../dist');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FPS = Number(process.argv[2] || 30);
const OUT = path.resolve(HERE, process.argv[3] || '../release/frames');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

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
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${port}/attention-film/index.html?clean=1`, { waitUntil: 'load' });
await page.waitForFunction('window.__filmReady === true');

const duration = await page.evaluate(() => window.__film.duration);
const total = Math.round(duration * FPS);
fs.mkdirSync(OUT, { recursive: true });

const t0 = Date.now();
for (let i = 0; i < total; i++) {
  const name = `f${String(i).padStart(5, '0')}.jpg`;
  const dest = path.join(OUT, name);
  if (fs.existsSync(dest)) continue; // 断点续渲
  const t = i / FPS;
  await page.evaluate((tt) => window.__film.setTime(tt), t);
  await page.screenshot({ path: dest, type: 'jpeg', quality: 92, optimizeForSpeed: true });
  if (i % 30 === 0 || i === total - 1) {
    const done = i + 1;
    const rate = done / ((Date.now() - t0) / 1000);
    const eta = Math.round((total - done) / Math.max(rate, 0.01));
    process.stdout.write(
      `\r  ${done}/${total} 帧  ${rate.toFixed(1)} 帧/秒  预计剩余 ${eta}s   `
    );
  }
}
console.log(`\n完成：${total} 帧 → ${OUT}`);
await browser.close();
server.close();
process.exit(0);
