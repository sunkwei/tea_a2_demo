/**
 * 快速出图：只截图，不跑断言（用于视觉迭代）
 *   node endfield-ship/tools/shoot.mjs [机位...]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.join(HERE, 'shots');
const EDGE =
  process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HTTP_PORT = 9931;
const CDP_PORT = 9932;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VIEWS = process.argv.slice(2).length ? process.argv.slice(2) : ['home', 'viewport'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '');
  if (!rel) rel = 'endfield-ship/index.html';
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) {
    res.writeHead(404).end('404');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
  });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(HTTP_PORT, '127.0.0.1', r));
fs.mkdirSync(OUT, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'shoot-'));
const child = spawn(
  EDGE,
  [
    '--headless=new',
    '--no-first-run',
    '--disable-extensions',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--window-size=1600,900',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' }
);

let target = null;
const deadline = Date.now() + 30000;
while (Date.now() < deadline) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
    target = list.find((t) => t.type === 'page');
    if (target) break;
  } catch {
    /* retry */
  }
  await sleep(250);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
const send = (method, params = {}) =>
  new Promise((r) => {
    const id = ++seq;
    pending.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', {
    expression: `(async () => { ${expr} })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.result?.exceptionDetails) {
    throw new Error(r.result.exceptionDetails.exception?.description || 'eval error');
  }
  return r.result?.result?.value;
};
const shot = async (file) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
};

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1600,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
await send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/endfield-ship/index.html` });

for (let i = 0; i < 250; i++) {
  if (await evaluate('return !!window.__endfield')) break;
  await sleep(300);
}
await evaluate('document.querySelector(".boot__enter")?.click(); return true;');
await sleep(1800);

for (const v of VIEWS) {
  const label = v === 'home' ? '00-home' : v;
  await evaluate(`
    const app = window.__endfield;
    if (${JSON.stringify(v)} === 'home') app.snapHome();
    else app.snapToFocus(${JSON.stringify(v)});
    await new Promise(r => setTimeout(r, 900));
    return true;
  `);
  await sleep(1200);
  await shot(path.join(OUT, `iter-${label}.png`));
  const px = await evaluate('return window.__endfield.samplePixels();');
  console.log(label.padEnd(12), JSON.stringify(px));
}

ws.close();
child.kill();
server.close();
await sleep(300);
fs.rmSync(profile, { recursive: true, force: true });
console.log('→', OUT);
