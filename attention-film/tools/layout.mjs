// tools/layout.mjs — 自动排版体检：抓取每帧所有文字/图形的包围盒
//   检查项：文字互相重叠、文字出界、图形出界、文字被后绘制图形遮挡
// 用法: node tools/layout.mjs 1,5,12,18,24,30,38,44,48,53,56
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../dist');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const times = (process.argv[2] || '1,5,12,18,24,30,38,44,48,53,56').split(',').map(Number);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
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
await page.goto(`http://127.0.0.1:${port}/attention-film/index.html?clean=1`, { waitUntil: 'load' });
await page.waitForFunction('window.__filmReady === true');

let problems = 0;
for (const t of times) {
  const res = await page.evaluate((tt) => {
    window.__trace = [];
    window.__film.setTime(tt);
    const tr = window.__trace;

    const map = (x, y, m) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    const bbox = (x, y, w, h, m) => {
      const pts = [
        [x, y],
        [x + w, y],
        [x, y + h],
        [x + w, y + h],
      ].map(([px, py]) => map(px, py, m));
      return {
        x0: Math.min(...pts.map((p) => p[0])),
        y0: Math.min(...pts.map((p) => p[1])),
        x1: Math.max(...pts.map((p) => p[0])),
        y1: Math.max(...pts.map((p) => p[1])),
      };
    };

    const items = tr.map((s, i) => {
      if (s.type !== 'text') return { ...s, i, b: bbox(s.x, s.y, s.w, s.h, s.m) };
      let x0 = s.x;
      if (s.align === 'center') x0 = s.x - s.w / 2;
      else if (s.align === 'right' || s.align === 'end') x0 = s.x - s.w;
      let y0 = s.y - s.h / 2;
      if (s.baseline === 'alphabetic') y0 = s.y - s.h * 0.8;
      else if (s.baseline === 'top' || s.baseline === 'hanging') y0 = s.y;
      return { ...s, i, b: bbox(x0, y0, s.w, s.h, s.m) };
    });

    const texts = items.filter((s) => s.type === 'text' && s.alpha >= 0.15);
    const shapes = items.filter((s) => s.type !== 'text');

    const ov = (a, b) => {
      const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      return ox > 0 && oy > 0 ? ox * oy : 0;
    };

    // 先算"被后绘制的图形盖住"的文字——它们看不见，不算重叠问题
    const hidden = new Set();
    const covered = [];
    for (const t of texts) {
      const area = Math.max(1, (t.b.x1 - t.b.x0) * (t.b.y1 - t.b.y0));
      for (const s of shapes) {
        if (s.i <= t.i || s.type === 'stroke') continue;
        const a = ov(t.b, s.b);
        if (a / area > 0.55) {
          hidden.add(t);
          covered.push({
            str: t.str,
            ratio: Math.round((a / area) * 100),
            ax: Math.round(t.b.x0),
            ay: Math.round(t.b.y0),
            fill: s.fill || '',
          });
          break;
        }
      }
    }

    const hits = [];
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i].b;
        const b = texts[j].b;
        if (hidden.has(texts[i]) || hidden.has(texts[j])) continue;
        const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
        if (ox > 6 && oy > 6) {
          hits.push({
            a: texts[i].str,
            b: texts[j].str,
            ox: Math.round(ox),
            oy: Math.round(oy),
            ax: Math.round(a.x0),
            ay: Math.round(a.y0),
            bx: Math.round(b.x0),
            by: Math.round(b.y0),
          });
        }
      }
    }

    const outText = texts.filter((b) => b.b.x0 < -4 || b.b.x1 > 1924 || b.b.y0 < -4 || b.b.y1 > 1084);
    const outShape = shapes.filter((b) => b.b.x0 < -6 || b.b.x1 > 1926 || b.b.y0 < -6 || b.b.y1 > 1086);
    return {
      hits,
      covered,
      outText: outText.map((b) => ({ str: b.str, x0: Math.round(b.b.x0), y0: Math.round(b.b.y0), x1: Math.round(b.b.x1), y1: Math.round(b.b.y1) })),
      outShape: outShape.map((b) => ({ type: b.type, x0: Math.round(b.b.x0), y0: Math.round(b.b.y0), x1: Math.round(b.b.x1), y1: Math.round(b.b.y1) })),
      count: texts.length,
      shapes: shapes.length,
    };
  }, t);

  console.log(`\n=== t=${t}s  (文字 ${res.count} / 图形 ${res.shapes}) ===`);
  if (!res.hits.length) console.log('  文字重叠：无');
  for (const h of res.hits) {
    problems++;
    console.log(`  重叠 ${h.ox}x${h.oy}px  "${h.a}" @(${h.ax},${h.ay})  x  "${h.b}" @(${h.bx},${h.by})`);
  }
  if (!res.outText.length) console.log('  文字出界：无');
  for (const o of res.outText) {
    problems++;
    console.log(`  文字出界 "${o.str}" (${o.x0},${o.y0})-(${o.x1},${o.y1})`);
  }
  if (!res.outShape.length) console.log('  图形出界：无');
  for (const o of res.outShape) {
    problems++;
    console.log(`  图形出界 ${o.type} (${o.x0},${o.y0})-(${o.x1},${o.y1})`);
  }
  if (!res.covered.length) console.log('  文字遮挡：无');
  for (const c of res.covered) {
    console.log(`  [i] 被后绘制的图形盖住 ${c.ratio}%  "${c.str}" @(${c.ax},${c.ay})  <- ${c.fill}`);
  }
}
console.log(`\n共 ${problems} 处硬问题`);
await browser.close();
server.close();
process.exit(0);
