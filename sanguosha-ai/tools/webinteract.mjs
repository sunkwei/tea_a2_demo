/**
 * 网页版交互验收：点「开新局」按钮，确认能重开一局。
 * 用法： node tools/webinteract.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, '..');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 8767;

const server = spawn('python', ['main.py', '--web', '--no-browser', '--port', String(port)], {
  cwd: projectDir, shell: true, stdio: 'ignore',
});

let code = 0;
try {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/api/state`); if (r.ok) break; } catch {}
    await sleep(500);
  }
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--use-angle=swiftshader', '--disable-gpu', '--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 950 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle2' });
  await sleep(25000);
  const before = await page.evaluate(() => ({
    turn: document.getElementById('turnBadge').textContent,
    logs: document.querySelectorAll('.log-line').length,
  }));
  console.log('开局状态：', JSON.stringify(before));

  await page.evaluate(() => document.getElementById('btnStart').click());
  await sleep(20000);
  const after = await page.evaluate(() => ({
    turn: document.getElementById('turnBadge').textContent,
    logs: document.querySelectorAll('.log-line').length,
    seats: document.querySelectorAll('.seat').length,
    cards: document.querySelectorAll('.hand .card').length,
  }));
  console.log('重开后状态：', JSON.stringify(after));
  if (errors.length) console.log('页面报错：', errors.slice(0, 5));
  if (!after.seats || !after.cards) code = 1;
  await browser.close();
} catch (e) {
  console.error('交互验收失败：', e);
  code = 1;
} finally {
  server.kill();
}
process.exit(code);
