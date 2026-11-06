import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9900 + (process.pid % 60);
const PAGE_URL = pathToFileURL(path.join(ROOT, 'index.html')).href;
const OUT = path.join(ROOT, 'tools', 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws; this.seq = 0; this.pending = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id); this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error))); else resolve(msg.result);
      }
    };
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws fail')); });
    return new CDP(ws);
  }
  send(method, params) {
    const id = ++this.seq;
    this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout ' + method)); } }, 60000);
    });
  }
  on(method, fn) { if (!this.listeners) this.listeners = {}; }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression: `(async () => { ${expression} })()`, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('页面异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
  async shot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  }
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rubik-shot-'));
const child = spawn(EDGE, [
  '--headless=new', '--no-first-run', '--disable-extensions', '--enable-unsafe-swiftshader',
  '--use-gl=angle', '--use-angle=swiftshader', '--hide-scrollbars', '--window-size=1600,1000',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

let cdp;
try {
  let target = null;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page'); if (target) break;
    } catch (e) { }
    await sleep(250);
  }
  cdp = await CDP.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: PAGE_URL });
  await sleep(2500);
  await cdp.shot(path.join(OUT, '01-initial.png'));

  // 打乱 + 提示：拍一张「有提示公式」的图
  await cdp.eval(`
    const app = window.__rubik;
    app.scramble(25);
    const deadline = Date.now() + 40000;
    while (app.queue.length && Date.now() < deadline) await new Promise(r => setTimeout(r, 150));
    app.hint();
    await new Promise(r => setTimeout(r, 600));
    return true;
  `);
  await sleep(800);
  await cdp.shot(path.join(OUT, '03-scrambled.png'));

  // 拧一层后的样子
  await cdp.eval(`
    const app = window.__rubik;
    app.camera.preset('front');
    app.applyMove('R');
    await new Promise(r => setTimeout(r, 900));
    return true;
  `);
  await sleep(600);
  await cdp.shot(path.join(OUT, '02-twisted.png'));
  console.log('截图已更新');
} finally {
  try { cdp && cdp.ws.close(); } catch (e) { }
  child.kill();
  await sleep(200);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { }
}
