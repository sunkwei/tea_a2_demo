/** 量一下网页各元素的高度，找出手牌被裁切的原因。 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, '..');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn('python', ['main.py', '--web', '--no-browser', '--port', '8766'], {
  cwd: projectDir, shell: true, stdio: 'ignore',
});
try {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch('http://127.0.0.1:8766/api/state'); if (r.ok) break; } catch {}
    await sleep(500);
  }
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--use-angle=swiftshader', '--disable-gpu', '--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 950 });
  await page.goto('http://127.0.0.1:8766/', { waitUntil: 'networkidle2' });
  await sleep(3000);
  const info = await page.evaluate(() => {
    const pick = (sel) => {
      const e = document.querySelector(sel);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { sel, top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) };
    };
    return {
      innerHeight: window.innerHeight,
      scrollHeight: document.documentElement.scrollHeight,
      els: ['#app', '.stage', '.table-wrap', '.table', '.hand-area', '.hand', '.card', '.sidebar', '.panel.log'].map(pick),
    };
  });
  console.log(JSON.stringify(info, null, 1));
  await browser.close();
} finally {
  server.kill();
}
