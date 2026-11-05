/**
 * 网页版自动验收：起后端 → 用 Edge 打开 → 截图。
 * 用法：
 *   node tools/webcheck.mjs [--wait 60] [--out web_shot.png] [--url http://127.0.0.1:8765/]
 *   node tools/webcheck.mjs --vite          额外起 vite dev，走 /sanguosha-ai/web/ 页面 + /api 代理
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(projectDir, '..');

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const wait = Number(arg('wait', 60));
const out = path.resolve(projectDir, arg('out', 'web_shot.png'));
const useVite = argv.includes('--vite');
const port = Number(arg('port', 8765));
const url = arg('url', useVite ? 'http://127.0.0.1:5173/sanguosha-ai/web/index.html' : `http://127.0.0.1:${port}/`);

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
if (!existsSync(EDGE)) {
  console.error('找不到 Edge：' + EDGE);
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn('python', ['main.py', '--web', '--no-browser', '--port', String(port)], {
  cwd: projectDir,
  shell: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (d) => process.stdout.write('[server] ' + d));
server.stderr.on('data', (d) => process.stderr.write('[server!] ' + d));

let vite = null;
if (useVite) {
  vite = spawn('npm', ['run', 'dev'], { cwd: repoRoot, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  vite.stdout.on('data', (d) => process.stdout.write('[vite] ' + d));
  vite.stderr.on('data', (d) => process.stderr.write('[vite!] ' + d));
}

async function waitPort(tries = 60, target = port) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${target}/api/state`);
      if (res.ok) return true;
    } catch (e) {
      /* 还没起来 */
    }
    await sleep(500);
  }
  return false;
}

let code = 0;
try {
  if (!(await waitPort())) throw new Error('后端没起来');
  console.log('后端就绪');
  if (useVite) {
    for (let i = 0; i < 40; i++) {
      try {
        const r = await fetch('http://127.0.0.1:5173/');
        if (r.ok) break;
      } catch {}
      await sleep(500);
    }
    console.log('vite 就绪');
  }

  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    args: ['--use-angle=swiftshader', '--disable-gpu', '--no-sandbox', '--window-size=1600,950'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 950, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  console.log('页面已打开，等待对局推进 ' + wait + 's');
  await sleep(wait * 1000);

  const info = await page.evaluate(() => ({
    seats: document.querySelectorAll('.seat').length,
    cards: document.querySelectorAll('.hand .card').length,
    logs: document.querySelectorAll('.log-line').length,
    turn: document.getElementById('turnBadge')?.textContent,
    models: document.querySelectorAll('.model-item').length,
  }));
  console.log('页面状态：', JSON.stringify(info));

  await page.screenshot({ path: out });
  console.log('截图：' + out);
  if (errors.length) console.log('页面报错：', errors.slice(0, 5));
  if (!info.seats) code = 1;
  await browser.close();
} catch (e) {
  console.error('验收失败：', e);
  code = 1;
} finally {
  server.kill();
  if (vite) vite.kill();
  if (!code) console.log('OK');
}
process.exit(code);
