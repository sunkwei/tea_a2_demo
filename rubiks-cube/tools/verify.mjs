/**
 * 三阶魔方 · 无头浏览器端到端验证（Edge / Chromium，零依赖，直接跑 CDP）
 *
 *   node rubiks-cube/tools/verify.mjs
 *
 * 做的事：
 *   1. 用 file:// 协议打开 index.html（真实「双击本地文件」场景）
 *   2. 检查 WebGL 是否真的渲染出画面（读像素 + 截图）
 *   3. 走真实交互：鼠标拖动贴纸 → 拧动一层；拖动空白 → 转视角；滚轮 → 缩放
 *   4. 检查教程：阶段判定、提示公式（且用模拟校验过）、演示动画
 *   5. 检查打乱 / 复位 / 撤销 / 计时 / 六面展开图
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(HERE, 'shots');
const EDGE =
  process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9500 + (process.pid % 300);
const PAGE_URL = pathToFileURL(path.join(ROOT, 'index.html')).href;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------ CDP 客户端 ------------------------------ */

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        (this.listeners.get(msg.method) || []).forEach((fn) => fn(msg.params));
      }
    };
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error('WebSocket 连接失败'));
    });
    return new CDP(ws);
  }

  send(method, params) {
    const id = ++this.seq;
    this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('CDP 超时: ' + method));
        }
      }, 120000);
    });
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('页面异常: ' + (d.exception?.description || d.text || JSON.stringify(d)));
    }
    return r.result.value;
  }

  async shot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  }

  async mouse(type, x, y, button = 'left', extra = {}) {
    await this.send('Input.dispatchMouseEvent', {
      type, x, y, button,
      buttons: type === 'mouseMoved' && extra.down ? 1 : (type === 'mouseReleased' ? 0 : 1),
      clickCount: type === 'mouseMoved' ? 0 : 1,
      ...extra,
    });
  }
}

/* ------------------------------ 断言收集 ------------------------------ */

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${detail ? '  ' + detail : ''}`);
}

/* ------------------------------ 主流程 ------------------------------ */

async function main() {
  if (!fs.existsSync(EDGE)) {
    console.error('✗ 找不到 Edge：' + EDGE + '\n  可用 EDGE_PATH 环境变量指定浏览器路径。');
    process.exit(2);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rubik-edge-'));

  const child = spawn(
    EDGE,
    [
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--enable-unsafe-swiftshader',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--hide-scrollbars',
      '--window-size=1600,1000',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  let cdp;
  try {
    let target = null;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
        const list = await res.json();
        target = list.find((t) => t.type === 'page');
        if (target) break;
      } catch (e) { /* 还没起来 */ }
      await sleep(250);
    }
    if (!target) throw new Error('Edge DevTools 未就绪');

    cdp = await CDP.connect(target.webSocketDebuggerUrl);

    const pageErrors = [];
    const consoleErrors = [];
    cdp.on('Runtime.exceptionThrown', (p) => {
      pageErrors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || 'unknown');
    });
    cdp.on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error') {
        consoleErrors.push((p.args || []).map((a) => a.value ?? a.description ?? '').join(' '));
      }
    });
    cdp.on('Log.entryAdded', (p) => {
      if (p.entry && p.entry.level === 'error') consoleErrors.push(p.entry.text);
    });

    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false,
    });

    const loaded = new Promise((resolve) => cdp.on('Page.loadEventFired', resolve));
    await cdp.send('Page.navigate', { url: PAGE_URL });
    await Promise.race([loaded, sleep(15000)]);
    // 等应用真正初始化好
    for (let i = 0; i < 60; i++) {
      const ready = await cdp.eval(`return !!window.__rubik && !!window.__rubikUI;`);
      if (ready) break;
      await sleep(200);
    }
    await sleep(600);

    /* ---------------- 1. 启动 & 环境 ---------------- */
    console.log('\n启动与运行环境');
    const boot = await cdp.eval(`
      const canvas = document.getElementById('gl');
      const gl = canvas.getContext('webgl');
      return {
        protocol: location.protocol,
        hasCore: !!window.RubiksCore,
        hasSolver: !!window.RubiksSolver,
        hasApp: !!window.__rubik,
        hasUI: !!window.__rubikUI,
        canvasW: canvas.width, canvasH: canvas.height,
        webgl: !!gl,
        steps: document.querySelectorAll('#steps .step').length,
        netCells: document.querySelectorAll('#net .cell').length,
        state: document.getElementById('stat-state').textContent,
      };
    `);
    check('以 file:// 协议运行（零后端）', boot.protocol === 'file:', boot.protocol);
    check('core.js / solver.js 加载成功', boot.hasCore && boot.hasSolver);
    check('应用与界面初始化成功', boot.hasApp && boot.hasUI);
    check('拿到 WebGL 上下文', boot.webgl);
    check('画布尺寸正确', boot.canvasW > 400 && boot.canvasH > 300, `${boot.canvasW}x${boot.canvasH}`);
    check('教程渲染 7 个步骤', boot.steps === 7, String(boot.steps));
    check('六面展开图有 54 个格子', boot.netCells === 54, String(boot.netCells));
    check('初始状态显示已还原', boot.state.includes('已还原'), boot.state);

    /* ---------------- 2. 渲染出画面 ---------------- */
    console.log('\nWebGL 渲染');
    await sleep(600);
    const pixels = await cdp.eval(`
      const app = window.__rubik;
      const canvas = document.getElementById('gl');
      const gl = app.renderer.gl;
      // 立刻重绘一帧再读像素（默认 drawing buffer 在合成后会被清空）
      app.renderer.buildScene(app.state, { anim: app.anim, highlight: app.highlight });
      app.renderer.render(app.camera, {});
      const w = canvas.width, h = canvas.height;
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      let nonBg = 0, bright = 0;
      for (let i = 0; i < buf.length; i += 4) {
        const r = buf[i], g = buf[i+1], b = buf[i+2];
        if (Math.abs(r-14) > 12 || Math.abs(g-16) > 12 || Math.abs(b-22) > 12) nonBg++;
        if (r + g + b > 260) bright++;
      }
      return { total: w * h, nonBg, bright };
    `);
    check('画面不是纯背景色（模型已绘制）', pixels.nonBg > pixels.total * 0.02,
      `${(pixels.nonBg / pixels.total * 100).toFixed(1)}% 像素有内容`);
    check('画面有亮色（贴纸）', pixels.bright > 2000, `${pixels.bright} 个亮像素`);
    await cdp.shot(path.join(OUT, '01-initial.png'));

    /* ---------------- 3. 鼠标拧层 ---------------- */
    console.log('\n鼠标拧层（真实拖动）');
    const twist = await cdp.eval(`
      const app = window.__rubik;
      const before = app.state.pieces.map(p => p.pos.join(',')).join('|');
      // 找一个屏幕上的贴纸位置：把某个角块的中心投影到屏幕
      const piece = app.state.pieces.find(p => p.id === 'UFR');
      const cam = app.camera;
      const G = window.RubiksGL;
      const cv = document.getElementById('gl');
      const view = cam.viewMatrix();
      const proj = G.perspective(G.mat4(), 42*Math.PI/180, cv.clientWidth/cv.clientHeight, 0.1, 100);
      const world = [piece.pos[0]+0.35, piece.pos[1]+0.35, piece.pos[2]+0.35];
      const p = G.transformPoint(proj, G.transformPoint(view, world));
      const rect = document.getElementById('gl').getBoundingClientRect();
      return {
        before,
        x: rect.left + (p[0]*0.5+0.5)*rect.width,
        y: rect.top + (-p[1]*0.5+0.5)*rect.height,
      };
    `);
    await cdp.mouse('mousePressed', twist.x, twist.y);
    for (let i = 1; i <= 16; i++) {
      await cdp.mouse('mouseMoved', twist.x + i * 12, twist.y + i * 4, 'left', { down: true });
      await sleep(16);
    }
    await cdp.mouse('mouseReleased', twist.x + 192, twist.y + 64);
    await sleep(800);
    const afterTwist = await cdp.eval(`
      const app = window.__rubik;
      return {
        after: app.state.pieces.map(p => p.pos.join(',')).join('|'),
        moves: app.moveCount,
        history: app.history.length,
      };
    `);
    check('拖动贴纸后魔方状态改变了', afterTwist.after !== twist.before);
    check('拧层被记入步数', afterTwist.moves >= 1, '步数=' + afterTwist.moves);
    check('拧层进入撤销历史', afterTwist.history >= 1, '历史=' + afterTwist.history);
    await cdp.shot(path.join(OUT, '02-twisted.png'));

    /* ---------------- 4. 撤销 / 打乱 / 复位 ---------------- */
    console.log('\n撤销 / 打乱 / 复位');
    const undo = await cdp.eval(`
      const app = window.__rubik;
      const before = app.state.pieces.map(p => p.pos.join(',')).join('|');
      app.undo();
      await new Promise(r => setTimeout(r, 300));
      const after = app.state.pieces.map(p => p.pos.join(',')).join('|');
      return { changed: before !== after, moves: app.moveCount };
    `);
    check('撤销把状态还原了', undo.changed, '剩余步数=' + undo.moves);

    const scr = await cdp.eval(`
      const app = window.__rubik;
      app.scramble(25);
      const queued = app.queue.length;
      const deadline = Date.now() + 40000;
      while (app.queue.length && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 200));
      }
      await new Promise(r => setTimeout(r, 500));
      return {
        queued,
        solved: window.RubiksCore.isSolved(app.state),
        moves: app.moveCount,
        stage: app.stageIndex,
        state: document.getElementById('stat-state').textContent,
        badge: document.getElementById('stat-stage').textContent,
      };
    `);
    check('打乱后不是还原态', !scr.solved);
    check('打乱产生 25 步', scr.queued === 25 && scr.moves === 25, '队列=' + scr.queued + ' 步数=' + scr.moves);
    check('打乱后阶段判定为第 1 步', scr.stage === 0, 'stage=' + scr.stage);
    check('状态徽标变为「进行中」', scr.state.includes('进行中'), scr.state);
    await cdp.shot(path.join(OUT, '03-scrambled.png'));

    /* ---------------- 5. 教程提示 ---------------- */
    console.log('\n教程提示（模拟校验）');
    const hint = await cdp.eval(`
      const app = window.__rubik;
      const tasks = app.hint();
      const C = window.RubiksCore;
      const S = window.RubiksSolver;
      // 用求解器自己再算一遍，确认提示真的能把当前阶段做对
      const stage = S.STAGES[app.stageIndex];
      let work = C.cloneState(app.state);
      const seqs = [];
      for (const t of tasks) if (t.moves) { work = C.applySequence(work, t.moves); seqs.push(t.moves.join(' ')); }
      return {
        count: tasks.length,
        seqs,
        stageId: stage.id,
        goalReached: stage.goal(work),
        firstTask: tasks[0] ? tasks[0].text : '',
        hasCode: !!document.querySelector('#steps .step.active code'),
        detail: document.querySelector('#steps .step.active .body p')?.textContent?.slice(0, 40) || '',
      };
    `);
    check('提示给出了可执行的公式', hint.count > 0 && hint.seqs.length > 0, JSON.stringify(hint.seqs));
    check('提示经过模拟校验：执行后阶段目标达成', hint.goalReached, '阶段=' + hint.stageId);
    check('界面显示当前步骤的公式', hint.hasCode);
    check('界面显示当前步骤说明', hint.detail.length > 0, hint.detail);

    /* ---------------- 6. 演示动画 ---------------- */
    console.log('\n演示动画');
    const demo = await cdp.eval(`
      const app = window.__rubik;
      const before = app.moveCount;
      const ok = app.demo();
      await new Promise(r => setTimeout(r, 300));
      const animating = app.isAnimating();
      await new Promise(r => setTimeout(r, 5000));
      return { ok, animating, before, after: app.moveCount, solved: window.RubiksCore.isSolved(app.state) };
    `);
    check('演示按钮启动了动画', demo.ok && demo.animating);
    check('演示执行了公式', demo.after > demo.before, `步数 ${demo.before} → ${demo.after}`);
    await cdp.shot(path.join(OUT, '04-demo.png'));

    /* ---------------- 7. 视角 / 缩放 ---------------- */
    console.log('\n视角与缩放');
    const view = await cdp.eval(`
      const app = window.__rubik;
      const t0 = app.camera.theta, p0 = app.camera.phi, d0 = app.camera.dist;
      document.querySelector('[data-view="top"]').click();
      const t1 = app.camera.theta, p1 = app.camera.phi;
      document.querySelector('[data-view="front"]').click();
      const t2 = app.camera.theta;
      app.camera.zoom(-400);
      const d2 = app.camera.dist;
      app.camera.preset('reset');
      return { changed: t0 !== t1 && p0 !== p1, front: Math.abs(t2) < 0.01, zoomed: d2 < d0, d2 };
    `);
    check('视角预设按钮切换了相机', view.changed);
    check('「前」视角正对正面', view.front);
    check('滚轮/滑块可以缩放', view.zoomed, '距离=' + view.d2.toFixed(2));

    const orbit = await cdp.eval(`
      const app = window.__rubik;
      const t0 = app.camera.theta, p0 = app.camera.phi;
      return { t0, p0 };
    `);
    // 选一个明确在魔方之外的空白点（左上角）
    await cdp.mouse('mousePressed', 80, 130);
    for (let i = 1; i <= 8; i++) {
      await cdp.mouse('mouseMoved', 80 + i * 14, 130 + i * 5, 'left', { down: true });
      await sleep(16);
    }
    await cdp.mouse('mouseReleased', 192, 170);
    await sleep(300);
    const orbit2 = await cdp.eval(`
      const app = window.__rubik;
      return { t: app.camera.theta, p: app.camera.phi };
    `);
    check('空白处拖动可以旋转视角', Math.abs(orbit2.t - orbit.t0) > 0.05,
      `theta ${orbit.t0.toFixed(2)} → ${orbit2.t.toFixed(2)}`);

    /* ---------------- 8. 键盘 & 计时 ---------------- */
    console.log('\n键盘与计时');
    const key = await cdp.eval(`
      const app = window.__rubik;
      const before = app.moveCount;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
      await new Promise(r => setTimeout(r, 600));
      return { before, after: app.moveCount, timerRunning: app.timer.running };
    `);
    check('键盘 R 可以转动右面', key.after > key.before, `步数 ${key.before} → ${key.after}`);
    check('转动后计时开始', key.timerRunning);

    /* ---------------- 9. 复位 ---------------- */
    console.log('\n复位');
    const reset = await cdp.eval(`
      const app = window.__rubik;
      document.getElementById('btn-reset').click();
      await new Promise(r => setTimeout(r, 400));
      return {
        solved: window.RubiksCore.isSolved(app.state),
        moves: app.moveCount,
        state: document.getElementById('stat-state').textContent,
        netYellow: document.querySelector('#net .cell').style.background,
      };
    `);
    check('复位后回到还原态', reset.solved);
    check('复位后步数归零', reset.moves === 0);
    check('复位后徽标变「已还原」', reset.state.includes('已还原'), reset.state);

    /* ---------------- 10. 无异常 ---------------- */
    console.log('\n运行时健康度');
    const realErrors = consoleErrors.filter((e) => !/favicon|Failed to load resource/i.test(e));
    check('没有未捕获的 JS 异常', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 200));
    check('控制台没有 error 级输出', realErrors.length === 0, realErrors.join(' | ').slice(0, 200));

    await cdp.shot(path.join(OUT, '05-final.png'));

    /* ------------------------------ 汇总 ------------------------------ */
    const failed = results.filter((r) => !r.ok);
    console.log('\n' + '─'.repeat(52));
    console.log(`通过 ${results.length - failed.length} / ${results.length} 项`);
    if (failed.length) {
      failed.forEach((f) => console.log('  ✗ ' + f.name + (f.detail ? '  ' + f.detail : '')));
      console.log('截图目录：' + OUT);
      process.exitCode = 1;
    } else {
      console.log('✓ 全部通过，截图已保存到 ' + OUT);
    }
  } catch (e) {
    console.error('\n✗ 验证过程出错：' + e.message);
    process.exitCode = 1;
  } finally {
    try { if (cdp) cdp.ws.close(); } catch (e) { /* ignore */ }
    child.kill();
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
}

main();
