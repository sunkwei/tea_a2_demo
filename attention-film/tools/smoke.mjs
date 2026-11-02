// tools/smoke.mjs — 播放器冒烟测试：加载页面 → 自动播放 → 拖进度 → 静音按钮 → 无报错
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../dist');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

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
  args: ['--headless=new', '--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 810 });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});

await page.goto(`http://127.0.0.1:${port}/attention-film/index.html`, { waitUntil: 'load' });
await page.waitForFunction('window.__filmReady === true');
const duration = await page.evaluate(() => window.__film.duration);

// 1) 自动播放
await new Promise((r) => setTimeout(r, 1200));
const t1 = await page.evaluate(() => window.__film.time);
console.log(`播放中：t=${t1.toFixed(2)}s / ${duration}s`, t1 > 0.2 ? 'OK' : 'FAIL');

// 2) 暂停
await page.click('#play');
await new Promise((r) => setTimeout(r, 400));
const t2 = await page.evaluate(() => window.__film.time);
console.log('暂停后仍可定位：', Math.abs(t2 - t1) < 1.5 ? 'OK' : `FAIL (${t1} -> ${t2})`);

// 3) 拖进度条到 30s
await page.evaluate(() => {
  const s = document.getElementById('seek');
  s.value = '30';
  s.dispatchEvent(new Event('input', { bubbles: true }));
});
const t3 = await page.evaluate(() => window.__film.time);
console.log(`拖动进度到 30s：t=${t3.toFixed(2)}`, Math.abs(t3 - 30) < 0.5 ? 'OK' : 'FAIL');

// 4) 画面确实变了（比较两帧像素）
const diff = await page.evaluate(async () => {
  const c = document.getElementById('film');
  const ctx = c.getContext('2d');
  const grab = () => ctx.getImageData(300, 200, 400, 300).data;
  window.__film.setTime(5);
  const a = grab();
  window.__film.setTime(30);
  const b = grab();
  let d = 0;
  for (let i = 0; i < a.length; i += 4) d += Math.abs(a[i] - b[i]);
  return d / (a.length / 4);
});
console.log(`两帧画面差异：${diff.toFixed(1)}`, diff > 5 ? 'OK' : 'FAIL');

// 5) 音乐按钮
await page.click('#mute');
await new Promise((r) => setTimeout(r, 1500));
console.log('音乐按钮：OK');

console.log(errors.length ? '报错：\n' + errors.join('\n') : '无 JS 报错');
await browser.close();
server.close();
process.exit(errors.length ? 1 : 0);
