// tools/colorascii.mjs — 彩色字符画：按色相把画面映射成字符，用来回看构图（不看图片也能核对）
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../dist');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const times = (process.argv[2] || '40').split(',').map(Number);
const COLS = Number(process.argv[3] || 128);

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

for (const t of times) {
  const art = await page.evaluate((tt, cols) => {
    window.__film.setTime(tt);
    const c = document.getElementById('film');
    const W = c.width;
    const H = c.height;
    const rows = Math.round((cols * H) / W / 2.0);
    const off = document.createElement('canvas');
    off.width = cols;
    off.height = rows;
    const octx = off.getContext('2d');
    octx.drawImage(c, 0, 0, cols, rows);
    const d = octx.getImageData(0, 0, cols, rows).data;
    const cls = (r, g, b) => {
      const mx = Math.max(r, g, b);
      if (mx < 40) return ' ';
      if (r > 210 && g > 130 && g < 205 && b < 120) return 'Q'; // 琥珀
      if (b > 170 && g > 140 && r < 130) return 'K'; // 青
      if (g > 165 && r < 140 && b < 170) return 'V'; // 绿
      if (r > 110 && b > 160 && g < 150) return 'P'; // 紫
      if (r > 180 && g > 180 && b > 180) return '#'; // 白字
      if (mx > 120) return '+';
      return '.';
    };
    let s = '';
    for (let y = 0; y < rows; y++) {
      let line = '';
      for (let x = 0; x < cols; x++) {
        const i = (y * cols + x) * 4;
        line += cls(d[i], d[i + 1], d[i + 2]);
      }
      s += line + '\n';
    }
    return s;
  }, t, COLS);
  console.log(`\n===== t=${t}s =====\n${art}`);
}
await browser.close();
server.close();
process.exit(0);
