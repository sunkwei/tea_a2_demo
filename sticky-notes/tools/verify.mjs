/**
 * 便笺 · 无头浏览器端到端验证（Edge / Chromium，零依赖，直接跑 CDP）
 *
 *   node sticky-notes/tools/verify.mjs
 *
 * 做的事：
 *   1. 用 file:// 协议打开 index.html（真实「双击本地文件」场景）
 *   2. 走真实 UI：新建便笺 → 自动归类 → 选底色 → 看对比度 → 开提醒 → 保存
 *   3. 验证提醒在「指定时间前 5 分钟」触发、且有应用内兜底提示
 *   4. 验证普通检索 / 正则检索 / 非法正则的容错
 *   5. 验证 localStorage 持久化（刷新后便笺还在）
 *   6. 截图输出到 tools/shots/
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
const PORT = 9400 + (process.pid % 300);
const PAGE_FILE = process.argv[2] || 'index.html';
const PAGE_URL = pathToFileURL(path.join(ROOT, PAGE_FILE)).href;

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
      }, 240000); // AI 调用可能跑几十秒，给足时间
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sticky-edge-'));

  const child = spawn(
    EDGE,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
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
    // 等 DevTools 端口就绪
    let target = null;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
        const list = await res.json();
        target = list.find((t) => t.type === 'page');
        if (target) break;
      } catch (e) {
        /* 还没起来 */
      }
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
      width: 1600,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const loaded = new Promise((resolve) => cdp.on('Page.loadEventFired', resolve));
    await cdp.send('Page.navigate', { url: PAGE_URL });
    await Promise.race([loaded, sleep(15000)]);
    await sleep(600);

    /* ---------------- 1. 启动 & file:// 环境 ---------------- */
    console.log('\n启动与运行环境');
    const boot = await cdp.eval(`
      return {
        hasCore: !!window.StickyCore,
        hasApp: !!window.__sticky,
        notes: document.querySelectorAll('.note').length,
        protocol: location.protocol,
        banner: !document.querySelector('#banner').hidden,
        bannerText: (document.querySelector('#banner').textContent || '').slice(0, 40),
        storage: (function(){ try { localStorage.setItem('__t','1'); localStorage.removeItem('__t'); return 'ok'; } catch(e) { return 'blocked'; } })(),
      };
    `);
    check('core.js 加载成功', boot.hasCore);
    check('app.js 加载成功', boot.hasApp);
    check('以 file:// 协议运行', boot.protocol === 'file:', boot.protocol);
    check('file:// 下 localStorage 可用', boot.storage === 'ok', boot.storage);
    check('首次访问有示例便笺', boot.notes >= 1, `${boot.notes} 条`);
    check('展示 file:// 通知限制提示', boot.banner);

    const clock = await cdp.eval(`
      const before = document.querySelector('#clock').textContent;
      await new Promise(r => setTimeout(r, 1600));
      return { before, after: document.querySelector('#clock').textContent, hidden: document.hidden };
    `);
    check('顶栏时钟每秒刷新', clock.after !== clock.before && /\d{2}:\d{2}:\d{2}/.test(clock.after), clock.after);

    /* ---------------- 2. 新建便笺（走真实 UI） ---------------- */
    console.log('\n新建便笺（真实点击）');
    const created = await cdp.eval(`
      document.querySelector('#btn-new').click();
      const t = document.querySelector('#nm-text');
      t.value = '下周一 10:00 客户需求评审会议，记得准备材料';
      t.dispatchEvent(new Event('input', { bubbles: true }));
      return {
        modalOpen: !document.querySelector('#note-modal').hidden,
        hint: document.querySelector('#nm-cat-hint').textContent,
      };
    `);
    check('编辑器弹窗打开', created.modalOpen);
    check('内容自动归类为「工作」', created.hint.includes('工作'), created.hint.trim());

    /* ---------------- 3. 底色 + 对比度 ---------------- */
    console.log('\n配色与对比度');
    const colorInfo = await cdp.eval(`
      const sw = [...document.querySelectorAll('#nm-swatches .swatch')].find(b => b.title.indexOf('天空蓝') === 0);
      sw.click();
      const bg = document.querySelector('#nm-bg').value;
      const fg = document.querySelector('#nm-fg').value;
      const ratio = window.StickyCore.contrastRatio(fg, bg);
      return {
        bg, fg,
        ratio: Math.round(ratio * 100) / 100,
        meter: document.querySelector('#nm-contrast').textContent.trim(),
        previewBg: getComputedStyle(document.querySelector('#nm-preview')).backgroundColor,
        previewFg: getComputedStyle(document.querySelector('#nm-preview')).color,
      };
    `);
    check('底色切换生效', colorInfo.bg.toLowerCase() === '#6ec6ff', colorInfo.bg);
    check('文字色自动取高对比值', colorInfo.ratio >= 4.5, `${colorInfo.ratio}:1`);
    check('对比度仪表显示等级', /AAA|AA/.test(colorInfo.meter), colorInfo.meter.slice(0, 40));

    /* ---------------- 4. 提醒（提前 5 分钟触发） ---------------- */
    console.log('\n提醒');
    const remind = await cdp.eval(`
      const at = document.querySelector('#nm-remind-at');
      at.value = window.StickyCore.toLocalInputValue(Date.now() + 5 * 60000);
      const cb = document.querySelector('#nm-remind');
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
      return {
        at: at.value,
        lead: document.querySelector('#nm-lead').textContent,
        checked: cb.checked,
      };
    `);
    check('提醒开关可勾选', remind.checked);
    check('默认提前量为 5 分钟', remind.lead.trim() === '5', remind.lead);

    const saved = await cdp.eval(`
      document.querySelector('#nm-save').click();
      await new Promise(r => setTimeout(r, 1200));
      const notes = window.__sticky.state.notes;
      const n = notes[notes.length - 1];
      const card = document.querySelector('.note[data-id="' + n.id + '"]');
      return {
        count: notes.length,
        text: n.text,
        category: n.category,
        autoCategory: n.autoCategory,
        createdAt: n.createdAt,
        lead: n.reminder && n.reminder.leadMinutes,
        fireAt: n.reminder && n.reminder.fireAt,
        at: n.reminder && n.reminder.at,
        badge: card ? (card.querySelector('.rm') || {}).textContent : '',
        toasts: [...document.querySelectorAll('.toast')].map(t => t.textContent),
        stored: !!localStorage.getItem('sticky-notes/v1'),
      };
    `);
    check('便笺已保存', saved.count >= 2, `${saved.count} 条`);
    check('自动记录创建时间', saved.createdAt > 0, new Date(saved.createdAt).toLocaleString('zh-CN'));
    check('分类写入正确', saved.category === '工作', saved.category);
    check('提醒提前 5 分钟计算正确', saved.fireAt === saved.at - 5 * 60000, `at=${saved.at} fireAt=${saved.fireAt}`);
    check('到点后提醒已触发（状态已提醒）', /已提醒/.test(saved.badge), saved.badge);
    check('触发时有应用内提醒横幅', saved.toasts.some((t) => /提醒/.test(t)), JSON.stringify(saved.toasts).slice(0, 120));
    check('数据写入 localStorage', saved.stored);

    /* ---------------- 5. 待提醒倒计时 ---------------- */
    const pending = await cdp.eval(`
      const now = Date.now();
      const C = window.StickyCore;
      const n = C.createNote({
        text: '待办：明早 8 点给老板发周报',
        bg: '#FFD93D',
        rules: window.__sticky.state.settings.rules,
        reminderAt: now + 40 * 60000,
        leadMinutes: 5,
      });
      window.__sticky.state.notes.push(n);
      window.__sticky.state.notes[window.__sticky.state.notes.length - 1].reminder = C.computeReminder(now + 40 * 60000, 5);
      localStorage.setItem('sticky-notes/v1', C.serialize(window.__sticky.state));
      window.__sticky.render();
      await new Promise(r => setTimeout(r, 300));
      const card = document.querySelector('.note[data-id="' + n.id + '"]');
      return { badge: card ? (card.querySelector('.rm') || {}).textContent : '', cat: card ? card.querySelector('.note-cat').textContent : '' };
    `);
    check('未到点的提醒显示倒计时', /还有/.test(pending.badge), pending.badge);
    check('「待办」内容归入待办分类', pending.cat.includes('待办'), pending.cat);

    /* ---------------- 6. 检索：普通 + 正则 + 非法正则 ---------------- */
    console.log('\n检索');
    const plain = await cdp.eval(`
      const s = document.querySelector('#search');
      s.value = '会议';
      s.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 200));
      return {
        cards: document.querySelectorAll('.note').length,
        marks: document.querySelectorAll('.note-body mark').length,
        info: document.querySelector('#search-info').textContent,
      };
    `);
    check('普通检索命中便笺', plain.cards >= 1, `${plain.cards} 条`);
    check('命中处有高亮', plain.marks >= 1, `${plain.marks} 处`);

    const regex = await cdp.eval(`
      document.querySelector('#btn-regex').click();
      const s = document.querySelector('#search');
      s.value = '会议|周报';
      s.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 200));
      return {
        on: document.querySelector('#btn-regex').classList.contains('on'),
        cards: document.querySelectorAll('.note').length,
        marks: document.querySelectorAll('.note-body mark').length,
        info: document.querySelector('#search-info').textContent,
      };
    `);
    check('正则模式已开启', regex.on);
    check('正则命中多条', regex.cards >= 2, `${regex.cards} 条`);
    check('正则命中处高亮', regex.marks >= 2, `${regex.marks} 处`);

    const bad = await cdp.eval(`
      const s = document.querySelector('#search');
      s.value = '([';
      s.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 200));
      const info = document.querySelector('#search-info');
      return { err: info.classList.contains('err'), text: info.textContent, cards: document.querySelectorAll('.note').length };
    `);
    check('非法正则给出错误提示而不崩溃', bad.err && /无效/.test(bad.text), bad.text);
    check('非法正则时仍展示全部便笺', bad.cards >= 3, `${bad.cards} 条`);

    await cdp.shot(path.join(OUT, '02-regex-search.png'));

    // 复原搜索
    await cdp.eval(`
      document.querySelector('#btn-reset').click();
      await new Promise(r => setTimeout(r, 200));
      return true;
    `);

    /* ---------------- 7. 刷新后仍存在（localStorage 持久化） ---------------- */
    console.log('\n持久化');
    const beforeReload = await cdp.eval(`return window.__sticky.state.notes.length;`);
    const reloaded = new Promise((resolve) => cdp.on('Page.loadEventFired', resolve));
    await cdp.send('Page.reload', { ignoreCache: false });
    await Promise.race([reloaded, sleep(15000)]);
    await sleep(800);
    const afterReload = await cdp.eval(`
      return {
        notes: window.__sticky.state.notes.length,
        cards: document.querySelectorAll('.note').length,
        demo: !!document.querySelector('.note'),
      };
    `);
    check('刷新后便笺数量不变', afterReload.notes === beforeReload, `${beforeReload} → ${afterReload.notes}`);
    check('刷新后便笺正常渲染', afterReload.cards === afterReload.notes, `${afterReload.cards} 张卡片`);

    /* ---------------- 7.5 AI 增强（打真实 tea_a2 接口） ---------------- */
    console.log('\nAI 增强');
    const aiOn = await cdp.eval(`
      // 在设置里打开 AI 开关并填好地址
      document.querySelector('#btn-settings').click();
      const cb = document.querySelector('#set-ai');
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
      const base = document.querySelector('#set-ai-base');
      base.value = 'http://localhost:8383';
      base.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('#settings-modal').hidden = true;
      return { enabled: window.__sticky.state.settings.ai.enabled, base: window.__sticky.state.settings.ai.base };
    `);
    check('设置里能开启 AI 增强', aiOn.enabled === true, JSON.stringify(aiOn));

    const aiConn = await cdp.eval(`
      document.querySelector('#btn-settings').click();
      document.querySelector('#btn-ai-test').click();
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        const t = document.querySelector('#ai-conn').textContent;
        if (t && t.indexOf('已连接') >= 0) return { ok: true, text: t.trim().slice(0, 80) };
        if (t && t.indexOf('连不上') >= 0) return { ok: false, text: t.trim().slice(0, 120) };
        await new Promise(r => setTimeout(r, 250));
      }
      return { ok: false, text: '超时' };
    `);
    check('能连上本地 tea_a2', aiConn.ok, aiConn.text);
    await cdp.eval(`document.querySelector('#settings-modal').hidden = true; return true;`);

    const aiCat = await cdp.eval(`
      document.querySelector('#btn-new').click();
      const t = document.querySelector('#nm-text');
      t.value = '明天下午三点和客户开需求评审会，顺便确认报价';
      t.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#nm-ai-cat').click();
      const deadline = Date.now() + 90000;
      while (Date.now() < deadline) {
        const hint = document.querySelector('#nm-cat-hint').textContent;
        if (hint.indexOf('AI 建议') >= 0) {
          return { ok: true, hint, cat: document.querySelector('#nm-cat').value };
        }
        await new Promise(r => setTimeout(r, 300));
      }
      return { ok: false, hint: document.querySelector('#nm-cat-hint').textContent };
    `);
    check('AI 归类给出建议', aiCat.ok, aiCat.hint);
    check('AI 归类结果落在合法分类里', aiCat.ok && ['工作', '待办', '学习', '财务', '生活', '想法', '健康', '购物', '旅行', '私密', '其他'].includes(aiCat.cat), aiCat.cat);

    const aiTime = await cdp.eval(`
      document.querySelector('#nm-ai-time').click();
      const deadline = Date.now() + 90000;
      while (Date.now() < deadline) {
        const at = document.querySelector('#nm-remind-at').value;
        if (at) {
          return { ok: true, at, checked: document.querySelector('#nm-remind').checked };
        }
        await new Promise(r => setTimeout(r, 300));
      }
      return { ok: false, at: '' };
    `);
    check('AI 能从便笺里抽出提醒时间', aiTime.ok, aiTime.at);
    check('抽到时间后自动勾选提醒', aiTime.ok && aiTime.checked === true);

    // 关掉编辑器（不保存这条半成品）
    await cdp.eval(`document.querySelector('#note-modal').hidden = true; return true;`);

    const aiAsk = await cdp.eval(`
      document.querySelector('#btn-ai').click();
      const q = document.querySelector('#ai-ask-q');
      q.value = '我这周有哪些会议要参加？';
      document.querySelector('#ai-ask-run').click();
      const deadline = Date.now() + 90000;
      while (Date.now() < deadline) {
        const out = document.querySelector('#ai-ask-out').textContent;
        if (out.indexOf('思考中') < 0 && out.length > 10) {
          return { ok: true, out: out.trim().slice(0, 160), refs: document.querySelectorAll('#ai-ask-out .ai-ref').length };
        }
        await new Promise(r => setTimeout(r, 300));
      }
      return { ok: false, out: document.querySelector('#ai-ask-out').textContent.slice(0, 120) };
    `);
    check('AI 问答能返回答案', aiAsk.ok, aiAsk.out);
    check('答案里有可点击的引用', aiAsk.ok && aiAsk.refs > 0, aiAsk.refs + ' 处');

    const beforeCount = await cdp.eval(`return window.__sticky.state.notes.length;`);
    const aiSum = await cdp.eval(`
      document.querySelector('[data-tab="summarize"]').click();
      const ta = document.querySelector('#ai-sum-text');
      ta.value = ['周会纪要：', '1. 需求评审改到周四上午十点，会议室 3 楼，要提前准备 PPT。', '2. 报价单由商务同学出，本周内给客户。', '3. 下周三之前把测试环境准备好。'].join(String.fromCharCode(10));
      document.querySelector('#ai-sum-run').click();
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        const picks = document.querySelectorAll('#ai-sum-out .ai-list.pick li').length;
        if (picks > 0) {
          document.querySelector('#ai-sum-out [data-act="save-all"]').click();
          await new Promise(r => setTimeout(r, 400));
          return { ok: true, picks, count: window.__sticky.state.notes.length };
        }
        await new Promise(r => setTimeout(r, 300));
      }
      return {
        ok: false,
        picks: 0,
        count: window.__sticky.state.notes.length,
        out: (document.querySelector('#ai-sum-out').textContent || '').trim().slice(0, 240),
      };
    `);
    check('AI 能把长文拆成多条便笺', aiSum.ok, aiSum.picks + ' 条' + (aiSum.out ? '｜' + aiSum.out : ''));
    check('拆出来的便笺能批量保存', aiSum.ok && aiSum.count > beforeCount, beforeCount + ' → ' + aiSum.count);
    await cdp.shot(path.join(OUT, '05-ai-panel.png'));
    await cdp.eval(`document.querySelector('#ai-modal').hidden = true; return true;`);

    /* ---------------- 8. 截图 ---------------- */
    await sleep(1300); // 等顶栏时钟走一拍再截图
    await cdp.shot(path.join(OUT, '01-overview.png'));
    await cdp.eval(`
      document.querySelector('#btn-new').click();
      await new Promise(r => setTimeout(r, 300));
      return true;
    `);
    await cdp.shot(path.join(OUT, '03-editor.png'));
    await cdp.eval(`
      document.querySelector('#note-modal').hidden = true;
      document.querySelector('#btn-settings').click();
      await new Promise(r => setTimeout(r, 300));
      return true;
    `);
    await cdp.shot(path.join(OUT, '04-settings.png'));

    /* ---------------- 9. 无 JS 异常 ---------------- */
    console.log('\n运行时健康度');
    const realErrors = consoleErrors.filter((e) => !/favicon|Failed to load resource/i.test(e));
    check('没有未捕获的 JS 异常', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 200));
    check('控制台没有 error 级输出', realErrors.length === 0, realErrors.join(' | ').slice(0, 200));

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
    try {
      if (cdp) cdp.ws.close();
    } catch (e) {
      /* ignore */
    }
    child.kill();
    await sleep(300);
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch (e) {
      /* ignore */
    }
  }
}

main();
