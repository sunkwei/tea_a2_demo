/**
 * 终末地 · 舰桥观测舱 —— 无头浏览器端到端验证（Edge / Chromium，零依赖，直接跑 CDP）
 *
 *   node endfield-ship/tools/verify.mjs
 *
 * 做的事：
 *   1. 拉起本地静态服务器，用 http:// 打开页面（ESM + importmap 需要 http）
 *   2. 等启动序列跑完 → 点「进入舰桥」→ 检查 HUD 全部挂载
 *   3. 检查 3D 场景真的渲染出来了（非黑像素、峰值亮度、draw call）
 *   4. 走 UI：点击热点 → 聚焦面板弹出；数字键切换；终端指令 help/status/focus/未知
 *   5. 截图输出到 tools/shots/
 *
 * 注意：headless 用的是 SwiftShader 软件渲染，帧率很低（约 1-5 fps），
 * 所以所有「等一会儿」都用「轮询直到状态成立」而不是固定 sleep。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');
const ROOT = path.resolve(PROJECT, '..');
const OUT = path.join(HERE, 'shots');
const EDGE =
  process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

// 两个端口必须分开：一个是静态服务器，一个是 DevTools 调试端口
const HTTP_PORT = 9600 + (process.pid % 200);
const CDP_PORT = 9800 + (process.pid % 200);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------ 静态服务器 ------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '');
      if (!rel) rel = 'endfield-ship/index.html';
      if (rel.endsWith('/')) rel += 'index.html';
      const file = path.resolve(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404).end('404');
        return;
      }
      res.writeHead(200, {
        'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-cache',
      });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(HTTP_PORT, '127.0.0.1', () => resolve(server));
  });
}

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
      }, 240000);
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
}

/* ------------------------------ 断言 ------------------------------ */

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${detail ? '  ' + detail : ''}`);
}

/** 轮询直到条件成立（软件渲染很慢，不能靠固定 sleep） */
async function waitFor(cdp, expr, { timeout = 120000, interval = 300 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const v = await cdp.eval(`return (${expr});`);
    if (v) return v;
    await sleep(interval);
  }
  return null;
}

/* ------------------------------ 主流程 ------------------------------ */

async function main() {
  if (!fs.existsSync(EDGE)) {
    console.error('✗ 找不到 Edge：' + EDGE + '\n  可用 EDGE_PATH 环境变量指定浏览器路径。');
    process.exit(2);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'endfield-edge-'));
  const server = await startServer();

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
      '--hide-scrollbars',
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

  let cdp;
  try {
    let target = null;
    const deadline = Date.now() + 40000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
        const list = await res.json();
        target = list.find((t) => t.type === 'page');
        if (target) break;
      } catch {
        /* 还没起来 */
      }
      await sleep(250);
    }
    if (!target) throw new Error('Edge DevTools 未就绪');

    cdp = await CDP.connect(target.webSocketDebuggerUrl);

    const pageErrors = [];
    const consoleErrors = [];
    cdp.on('Runtime.exceptionThrown', (p) => {
      pageErrors.push(
        p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || 'unknown'
      );
    });
    cdp.on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error') {
        consoleErrors.push(
          (p.args || []).map((a) => a.value ?? a.description ?? '').join(' ')
        );
      }
    });
    cdp.on('Log.entryAdded', (p) => {
      if (p.entry && p.entry.level === 'error') consoleErrors.push(p.entry.text);
    });

    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1600,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const loaded = new Promise((resolve) => cdp.on('Page.loadEventFired', resolve));
    await cdp.send('Page.navigate', {
      url: `http://127.0.0.1:${HTTP_PORT}/endfield-ship/index.html`,
    });
    await Promise.race([loaded, sleep(20000)]);

    /* ---------------- 1. 启动序列 ---------------- */
    console.log('\n启动序列');

    // 等应用真正加载完（three.js 体积不小）
    const ready = await waitFor(cdp, '!!window.__endfield', { timeout: 90000 });
    check('应用模块加载完成', !!ready);

    // 等自检日志逐行输出
    await waitFor(cdp, 'document.querySelectorAll(".boot__line").length >= 4', {
      timeout: 60000,
    });
    const boot = await cdp.eval(`
      return {
        hasBoot: !!document.querySelector('#boot'),
        logLines: document.querySelectorAll('.boot__line').length,
        zh: (document.querySelector('.boot__mark .zh')||{}).textContent || '',
        en: (document.querySelector('.boot__mark .en')||{}).textContent || '',
      };
    `);
    check('启动序列存在', boot.hasBoot);
    check(
      '有终末地 / ENDFIELD 标题',
      boot.zh.trim() === '终末地' && boot.en.trim() === 'ENDFIELD'
    );
    check('自检日志逐行输出', boot.logLines >= 4, `${boot.logLines} 行`);

    await cdp.shot(path.join(OUT, '01-boot.png'));

    // 等「进入舰桥」按钮就绪
    await waitFor(cdp, 'document.querySelector(".boot__enter").classList.contains("ready")', {
      timeout: 60000,
    });
    await cdp.shot(path.join(OUT, '02-boot-ready.png'));

    const entered = await cdp.eval(`
      const btn = document.querySelector('.boot__enter');
      if (!btn) return { ok:false, reason:'no button' };
      btn.click();
      await new Promise(r => setTimeout(r, 1200));
      const b = document.querySelector('#boot');
      return { ok: !b || b.classList.contains('done'), hud: !!document.querySelector('#hud.live') };
    `);
    check('进入舰桥后启动层淡出', entered.ok);
    check('HUD 进入 live 状态', entered.hud);

    /* ---------------- 2. 3D 场景 ---------------- */
    console.log('\n3D 场景');
    // 等遥测跑起来（说明主循环在跑）
    await waitFor(cdp, 'window.__endfield.elapsed > 0.4', { timeout: 60000 });
    await sleep(800);

    const scene = await cdp.eval(`
      const app = window.__endfield;
      if (!app) return { ok:false };
      const r = app.renderer.info.render;
      const px = app.samplePixels();
      return {
        ok:true, calls:r.calls, tris:r.triangles,
        fps: Math.round(app.fps),
        nonBlackPct: px.nonBlackPct, avg: px.avg, maxV: px.maxV,
        children: app.scene.children.length,
        programs: app.renderer.info.programs.length,
        textures: app.renderer.info.memory.textures,
        geometries: app.renderer.info.memory.geometries,
      };
    `);
    check('场景已挂载', scene.ok);
    check('渲染出了非黑像素', scene.nonBlackPct > 55, `非黑像素 ${scene.nonBlackPct}%`);
    check('画面亮度不是全黑', scene.avg > 6, `平均亮度 ${scene.avg}`);
    check('存在高光（自发光/行星）', scene.maxV > 90, `峰值 ${scene.maxV}`);
    check(
      '有实际绘制调用',
      scene.calls > 20,
      `${scene.calls} calls / ${scene.tris} tris`
    );
    check(
      '几何体与贴图已上传',
      scene.geometries > 10 && scene.textures > 3,
      `${scene.geometries} geo / ${scene.textures} tex`
    );
    check('着色器程序已编译', scene.programs > 3, `${scene.programs} programs`);

    /* ---------------- 3. HUD 结构 ---------------- */
    console.log('\nHUD 结构');
    const hud = await cdp.eval(`
      const q = (s) => document.querySelector(s);
      return {
        unit: !!q('#unit .unit__name'),
        unitName: (q('#unit .unit__name')||{}).textContent||'',
        shipbar: !!q('#shipbar'),
        shipSegs: document.querySelectorAll('#shipbar .shipbar__seg').length,
        clock: (q('#clock-t')||{}).textContent||'',
        clockMatches: /^\\d{2}:\\d{2}:\\d{2}$/.test((q('#clock-t')||{}).textContent||''),
        rail: document.querySelectorAll('#rail .rail__item').length,
        telRows: document.querySelectorAll('#telemetry .tel-row').length,
        telValues: Array.from(document.querySelectorAll('#telemetry .tel-row__v')).map(e=>e.textContent),
        bars: Array.from(document.querySelectorAll('#telemetry .bar > i')).map(e=>e.style.width),
        comms: document.querySelectorAll('#comms .comms__line').length,
        reticle: !!q('#reticle'),
        hints: document.querySelectorAll('#hints span').length,
        focus: !!q('#focus'),
        severity: (q('#sev')||{}).textContent||'',
      };
    `);
    check('左上单位铭牌', hud.unit && hud.unitName.includes('终末地'), hud.unitName);
    check('顶部舰名条分段', hud.shipbar && hud.shipSegs >= 4, `${hud.shipSegs} 段`);
    check('时钟格式正确', hud.clockMatches, hud.clock);
    check('右侧导航按钮', hud.rail === 6, `${hud.rail} 个`);
    check('遥测面板 8 行', hud.telRows === 8, `${hud.telRows} 行`);
    check(
      '遥测数值已填充',
      hud.telValues.length === 8 && hud.telValues.every((v) => v && v !== '--'),
      hud.telValues.slice(0, 3).join(' / ')
    );
    check(
      '遥测进度条有宽度',
      hud.bars.length === 8 && hud.bars.every((w) => parseFloat(w) > 0),
      hud.bars.slice(0, 3).join(' / ')
    );
    check('通讯日志有内容', hud.comms >= 5, `${hud.comms} 行`);
    check('准星存在', hud.reticle);
    check('底部操作提示', hud.hints >= 5, `${hud.hints} 条`);
    check('聚焦面板已挂载', hud.focus);
    check('严重度标签有值', !!hud.severity, hud.severity);

    /* ---------------- 4. 交互 ---------------- */
    console.log('\n交互');
    const focusRes = await cdp.eval(`
      window.__endfield.openFocus('console');
      await new Promise(r => setTimeout(r, 900));
      const p = document.querySelector('#focus');
      return {
        shown: p.classList.contains('show'),
        title: (p.querySelector('.focus__title')||{}).textContent||'',
        kind: (p.querySelector('.focus__kind')||{}).textContent||'',
        sub: (p.querySelector('.focus__sub')||{}).textContent||'',
        body: (p.querySelector('.focus__body')||{}).textContent||'',
        facts: p.querySelectorAll('.focus__facts .row').length,
        hasArt: !!p.querySelector('.focus__hero svg'),
      };
    `);
    check('聚焦面板弹出', focusRes.shown);
    check('聚焦面板有标题', focusRes.title === '舰桥主控台', focusRes.title);
    check('聚焦面板有英文副标题', focusRes.sub === 'PRIMARY CONSOLE', focusRes.sub);
    check('聚焦面板有正文', focusRes.body.length > 30, `${focusRes.body.length} 字`);
    check('聚焦面板有参数表', focusRes.facts >= 3, `${focusRes.facts} 行`);
    check('聚焦面板有插画', focusRes.hasArt);

    // 相机运镜：开始动画 → 走完 → 落到目标机位
    // 期望机位直接读页面里的热点数据，避免测试里写死数值后与场景脱节
    const camMoved = await cdp.eval(`
      const app = window.__endfield;
      const spot = app.hotspots.find(h => h.id === 'hologram');
      const before = app.camera.position.clone();
      app.openFocus('hologram');
      const started = app.camAnimating;
      // 等运镜走完（软件渲染帧率低，用状态轮询）
      const t0 = Date.now();
      while (Date.now() - t0 < 30000 && app.camAnimating) {
        await new Promise(r => setTimeout(r, 200));
      }
      const after = app.camera.position;
      const err = Math.max(
        Math.abs(after.x - spot.camera.pos[0]),
        Math.abs(after.y - spot.camera.pos[1]),
        Math.abs(after.z - spot.camera.pos[2])
      );
      return {
        started,
        dist: before.distanceTo(after),
        pos: after.toArray(),
        err,
        expect: spot.camera.pos,
      };
    `);
    check('点击热点后相机开始运镜', camMoved.started);
    check('相机确实移动了', camMoved.dist > 0.4, `位移 ${camMoved.dist.toFixed(2)}`);
    check(
      '相机落在目标机位',
      camMoved.err < 0.05,
      `误差 ${camMoved.err.toFixed(3)}（期望 ${camMoved.expect.join(', ')}）`
    );

    await cdp.shot(path.join(OUT, '03-focus.png'));

    // 终端
    const term = await cdp.eval(`
      const app = window.__endfield;
      app.terminal.show();
      await new Promise(r => setTimeout(r, 400));
      app.runCommand('help');
      await new Promise(r => setTimeout(r, 250));
      app.runCommand('status');
      await new Promise(r => setTimeout(r, 250));
      app.runCommand('focus viewport');
      await new Promise(r => setTimeout(r, 250));
      app.runCommand('frobnicate');
      await new Promise(r => setTimeout(r, 250));
      const body = document.querySelector('.term__body');
      const lines = Array.from(body.querySelectorAll('.term__line')).map(e=>e.textContent);
      return {
        visible: document.querySelector('#terminal').classList.contains('show'),
        count: lines.length,
        hasHelp: lines.some(l=>l.includes('可用指令')),
        hasStatus: lines.some(l=>l.includes('舰体遥测')),
        hasFocus: lines.some(l=>l.includes('观测焦点')),
        hasErr: !!body.querySelector('.term__line.err'),
        errText: (body.querySelector('.term__line.err')||{}).textContent||'',
      };
    `);
    check('终端可打开', term.visible);
    check('help 输出可用指令', term.hasHelp);
    check('status 输出遥测摘要', term.hasStatus);
    check('focus 输出切换提示', term.hasFocus);
    check('未知指令报错', term.hasErr, term.errText.trim());

    await cdp.shot(path.join(OUT, '04-terminal.png'));

    // 关闭终端 + 数字键聚焦 + 返回全景
    const nav = await cdp.eval(`
      const app = window.__endfield;
      document.querySelector('.term__head .x').click();
      await new Promise(r => setTimeout(r, 500));
      const closed = !document.querySelector('#terminal').classList.contains('show');
      window.dispatchEvent(new KeyboardEvent('keydown', { key:'2' }));
      await new Promise(r => setTimeout(r, 1200));
      const focusTitle = (document.querySelector('#focus .focus__title')||{}).textContent||'';
      window.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape' }));
      await new Promise(r => setTimeout(r, 1200));
      const focusHidden = !document.querySelector('#focus').classList.contains('show');
      return { closed, focusTitle, focusHidden };
    `);
    check('终端可关闭', nav.closed);
    check('数字键切换焦点', nav.focusTitle === '全息战术台', nav.focusTitle);
    check('Esc 关闭聚焦面板', nav.focusHidden);

    // 隐藏 HUD
    const hide = await cdp.eval(`
      window.dispatchEvent(new KeyboardEvent('keydown', { key:'h' }));
      await new Promise(r => setTimeout(r, 400));
      const hidden = !document.querySelector('#hud').classList.contains('live');
      window.dispatchEvent(new KeyboardEvent('keydown', { key:'h' }));
      await new Promise(r => setTimeout(r, 400));
      return { hidden, back: document.querySelector('#hud').classList.contains('live') };
    `);
    check('H 键可隐藏界面', hide.hidden);
    check('H 键可恢复界面', hide.back);

    /* ---------------- 5. 截图 ---------------- */
    await cdp.eval(`
      const app = window.__endfield;
      app.closeFocus();
      app.snapHome();
      await new Promise(r => setTimeout(r, 1600));
      return true;
    `);
    await sleep(1200);
    await cdp.shot(path.join(OUT, '05-overview.png'));

    // 舷窗机位
    await cdp.eval(`
      const app = window.__endfield;
      app.snapToFocus('viewport');
      await new Promise(r => setTimeout(r, 1400));
      return true;
    `);
    await sleep(1000);
    await cdp.shot(path.join(OUT, '06-viewport.png'));

    // 全息台机位
    await cdp.eval(`
      const app = window.__endfield;
      app.snapToFocus('hologram');
      await new Promise(r => setTimeout(r, 1400));
      return true;
    `);
    await sleep(1000);
    await cdp.shot(path.join(OUT, '07-hologram.png'));

    // 终端全景
    await cdp.eval(`
      const app = window.__endfield;
      app.snapHome();
      await new Promise(r => setTimeout(r, 1400));
      app.terminal.show();
      await new Promise(r => setTimeout(r, 600));
      return true;
    `);
    await sleep(1000);
    await cdp.shot(path.join(OUT, '08-terminal-full.png'));

    /* ---------------- 6. 无 JS 异常 ---------------- */
    console.log('\n运行时健康度');
    const realErrors = consoleErrors.filter(
      (e) => !/favicon|Failed to load resource|WebGL.*deprecated/i.test(e)
    );
    check(
      '没有未捕获的 JS 异常',
      pageErrors.length === 0,
      pageErrors.join(' | ').slice(0, 300)
    );
    check(
      '控制台没有 error 级输出',
      realErrors.length === 0,
      realErrors.join(' | ').slice(0, 300)
    );

    /* ---------------- 汇总 ---------------- */
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
    console.error(e.stack);
    process.exitCode = 1;
  } finally {
    try {
      if (cdp) cdp.ws.close();
    } catch {
      /* ignore */
    }
    child.kill();
    server.close();
    await sleep(300);
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

main();
