// tools/shot.mjs — 无头截图：从 dist 里的影片页抓取指定时间点的画面
// 用法: node tools/shot.mjs 1.5,7,14,24  (输出到 tools/shots/)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../dist');
const OUT = path.join(HERE, 'shots');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const times = (process.argv[2] || '1.5,7,14,24,30,40,50,57')
  .split(',')
  .map(Number);
const W = Number(process.argv[3] || 1920);
const H = Number(process.argv[4] || 1080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
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
  args: ['--headless=new', '--no-sandbox', '--disable-gpu', `--window-size=${W},${H}`],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack || ''}`));

await page.goto(`http://127.0.0.1:${port}/attention-film/index.html?clean=1`, {
  waitUntil: 'load',
  timeout: 60000,
});
await page.waitForFunction('window.__filmReady === true', { timeout: 20000 });

fs.mkdirSync(OUT, { recursive: true });
for (const t of times) {
  await page.evaluate((tt) => window.__film.setTime(tt), t);
  await new Promise((r) => setTimeout(r, 120));
  const name = `t${String(t).padStart(5, '0').replace('.', '_')}.png`;
  await page.screenshot({ path: path.join(OUT, name) });
  console.log('shot', name);
}

if (logs.length) console.log('--- console ---\n' + logs.join('\n'));
await browser.close();
server.close();
process.exit(0);
