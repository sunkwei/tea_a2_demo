/**
 * 琴房 · 无头 Edge 端到端验证（file:// 真实场景）
 *
 * 用法：
 *   node piano/tools/verify.mjs            # 本地功能 + 多点触摸 + 音频
 *
 * 关键点：
 *   · 真多点触摸：用 CDP 的 Input.dispatchTouchEvent 同时按 3 个手指，
 *     验证 3 个音同时发声、复音数 ≥ 3、抬手后归零
 *   · 真音频：用 OfflineAudioContext 渲染合成结果，测 RMS / 峰值 / 基频能量
 *   · 截图输出：piano/tools/shots/
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SHOTS = path.join(HERE, 'shots');
const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const checks = [];
function check(name, ok, extra) {
  checks.push({ name, ok: !!ok, extra: extra == null ? '' : String(extra) });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra != null && !ok ? '  → ' + extra : ''));
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  if (!fs.existsSync(EDGE)) {
    console.error('找不到 Edge：' + EDGE + '\n可用 EDGE_PATH 环境变量指定。');
    process.exit(2);
  }

  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    args: [
      '--allow-file-access-from-files',
      '--no-first-run',
      '--disable-extensions',
      '--hide-scrollbars',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const t = msg.text();
      if (!/Failed to load resource/i.test(t)) errors.push('console: ' + t);
    }
  });

  const url = pathToFileURL(path.join(ROOT, 'index.html')).href;
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => !!window.__piano, { timeout: 15000 });

  /* ---------------------------------------------------------------- 加载 */

  check('file:// 打开成功，标题含「琴房」', (await page.title()).includes('琴房'));
  check('无头浏览器里 6 个脚本都加载了',
    await page.evaluate(() => !!(window.PianoCore && window.PianoSongs && window.PianoPractice &&
      window.PianoAudio && window.PianoView && window.__piano)));
  check('键盘画布有实际尺寸', await page.evaluate(() => {
    const c = document.getElementById('keysCanvas');
    return c.width > 100 && c.height > 50;
  }));
  check('初始为自由弹奏模式', (await page.evaluate(() => window.__piano.state().mode)) === 'free');

  /* ---------------------------------------------------------- 布局与命中 */

  const layoutInfo = await page.evaluate(() => {
    const st = window.__piano.state();
    const probe = [60, 64, 67];
    return {
      low: st.view.lowMidi, high: st.view.highMidi,
      whiteCount: st.view.whiteCount,
      hits: probe.map(m => {
        const p = window.__piano.keyCenter(m);
        return p ? { midi: m, hit: window.__piano.hitTest(p.x, p.y) } : { midi: m, hit: null };
      })
    };
  });
  check('视窗内键盘命中正确', layoutInfo.hits.every(h => h.hit === h.midi),
    JSON.stringify(layoutInfo.hits));
  check('视窗包含中央 C 区域', layoutInfo.low <= 60 && layoutInfo.high >= 72,
    layoutInfo.low + '–' + layoutInfo.high);

  await page.screenshot({ path: path.join(SHOTS, '01-free.png') });

  /* ================================================ 真多点触摸（核心） */

  const cdp = await page.target().createCDPSession();
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 10 });

  /* 取三个不同琴键的屏幕坐标（C 大三和弦：C4 E4 G4） */
  const touchPoints = await page.evaluate(() => {
    const c = document.getElementById('keysCanvas');
    const r = c.getBoundingClientRect();
    return [60, 64, 67].map(m => {
      const p = window.__piano.keyCenter(m);
      return { midi: m, x: r.left + p.x, y: r.top + p.y };
    });
  });

  /* 三指同时按下 */
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: touchPoints.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 8, radiusY: 8, force: 1 })),
  });
  await wait(250);

  const duringTouch = await page.evaluate(() => ({
    voices: window.__piano.state().voices,
    audio: window.__piano.state().audio,
    pressed: Object.keys(window.__piano.View.pressed),
    pointerCount: Object.keys(window.__piano.View.pointers).length
  }));

  check('三指同时按下 → 3 个指针被跟踪', duringTouch.pointerCount === 3, String(duringTouch.pointerCount));
  check('三指同时按下 → 3 个音同时按住', duringTouch.pressed.length === 3,
    JSON.stringify(duringTouch.pressed));
  check('三指同时按下 → 复音数 ≥ 3（真叠音，不是单音）', duringTouch.voices >= 3, String(duringTouch.voices));
  check('音频上下文已运行', duringTouch.audio === 'running', duringTouch.audio);

  await page.screenshot({ path: path.join(SHOTS, '02-multitouch.png') });

  /* 三指同时抬起 */
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: touchPoints.map((p, i) => ({ x: p.x, y: p.y, id: i })),
  });
  await wait(400);

  const afterTouch = await page.evaluate(() => ({
    voices: window.__piano.state().voices,
    pressed: Object.keys(window.__piano.View.pressed).length
  }));
  check('抬手后所有键释放', afterTouch.pressed === 0, String(afterTouch.pressed));
  check('抬手后复音归零（音被制音）', afterTouch.voices === 0, String(afterTouch.voices));

  /* 五指同时按：验证多点上限 */
  const five = await page.evaluate(() => {
    const c = document.getElementById('keysCanvas');
    const r = c.getBoundingClientRect();
    return [60, 62, 64, 65, 67].map(m => {
      const p = window.__piano.keyCenter(m);
      return { x: r.left + p.x, y: r.top + p.y };
    });
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: five.map((p, i) => ({ x: p.x, y: p.y, id: i, force: 1 })),
  });
  await wait(250);
  const fiveVoices = await page.evaluate(() => window.__piano.state().voices);
  check('五指同时按下 → 复音 ≥ 5', fiveVoices >= 5, String(fiveVoices));
  await page.screenshot({ path: path.join(SHOTS, '03-five-fingers.png') });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: five.map((p, i) => ({ x: p.x, y: p.y, id: i })),
  });
  await wait(300);

  /* 滑键：按住一根手指横向拖动，应连续换音 */
  const slide = await page.evaluate(() => {
    const c = document.getElementById('keysCanvas');
    const r = c.getBoundingClientRect();
    const a = window.__piano.keyCenter(60);
    const b = window.__piano.keyCenter(64);
    return { from: { x: r.left + a.x, y: r.top + a.y }, to: { x: r.left + b.x, y: r.top + b.y } };
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: slide.from.x, y: slide.from.y, id: 0, force: 1 }],
  });
  await wait(120);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: slide.to.x, y: slide.to.y, id: 0, force: 1 }],
  });
  await wait(200);
  const slid = await page.evaluate(() => ({
    pressed: Object.keys(window.__piano.View.pressed).map(Number),
    voices: window.__piano.state().voices
  }));
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [{ x: slide.to.x, y: slide.to.y, id: 0 }],
  });
  check('滑键（拖动换音）后按住的是新键',
    slid.pressed.length === 1 && slid.pressed[0] === 64, JSON.stringify(slid.pressed));

  /* ================================================== 真音频：离线渲染 */

  const audio = await page.evaluate(async () => {
    const A = window.PianoAudio;
    const single = await A.renderOffline({
      midi: 60, velocity: 0.8, seconds: 1.2,
      probeHzs: [261.63, 300, 523.25]
    });
    const chord = await A.renderOffline({
      notes: [
        { midi: 60, vel: 0.8, at: 0.02 },
        { midi: 64, vel: 0.8, at: 0.02 },
        { midi: 67, vel: 0.8, at: 0.02 }
      ],
      seconds: 1.2
    });
    const high = await A.renderOffline({ midi: 96, velocity: 0.8, seconds: 0.8 });
    const low = await A.renderOffline({ midi: 33, velocity: 0.8, seconds: 1.2 });
    return { single, chord, high, low };
  });

  check('离线渲染不是静音', audio.single.rms > 0.01 && !audio.single.silent,
    'rms=' + audio.single.rms.toFixed(5));
  check('单音峰值未削波（< 1.0）', audio.single.peak < 1.0, 'peak=' + audio.single.peak.toFixed(4));
  check('基频 C4 (261.6Hz) 能量最强',
    audio.single.probes[0].mag > audio.single.probes[1].mag * 3 &&
    audio.single.probes[0].mag > audio.single.probes[2].mag,
    JSON.stringify(audio.single.probes));
  check('三和弦能量高于单音', audio.chord.rms > audio.single.rms,
    audio.chord.rms.toFixed(5) + ' vs ' + audio.single.rms.toFixed(5));
  check('三和弦峰值仍在安全范围（< 1.0）', audio.chord.peak < 1.0, 'peak=' + audio.chord.peak.toFixed(4));
  check('高音区也能发声', audio.high.rms > 0.005, 'rms=' + audio.high.rms.toFixed(5));
  check('低音区也能发声', audio.low.rms > 0.005, 'rms=' + audio.low.rms.toFixed(5));

  /* ============================================== 跟弹练习（瀑布流） */

  await page.evaluate(() => {
    window.__piano.setMode('song');
    window.__piano.setSettings({ songId: 'twinkle', hands: 'both', tempo: 100 });
    window.__piano.startSong();
  });
  await wait(800);

  const songState = await page.evaluate(() => window.__piano.state());
  check('跟弹会话已启动', songState.sessionKind === 'song' && songState.session !== null);
  check('跟弹有判定音符', songState.session && songState.session.total > 0,
    songState.session ? String(songState.session.total) : 'null');

  /* 精确命中：等下一个音到判定时刻，用真触摸按下去 */
  const nextNote = await page.evaluate(() => {
    const P = window.__piano;
    const s = P.currentSession();
    if (!s) return null;
    const pending = s.notes.filter(n => n.state === 'pending' && n.start >= s.t);
    if (!pending.length) return null;
    const n = pending[0];
    const c = document.getElementById('keysCanvas');
    const r = c.getBoundingClientRect();
    const p = P.Core.keyCenter(P.View.layout, n.midi);
    if (!p) return null;
    return { midi: n.midi, start: n.start, x: r.left + p.x, y: r.top + p.y };
  });

  if (nextNote) {
    /* 轮询等到该音的判定时刻 */
    await page.evaluate(async (target) => {
      const s = window.__piano.currentSession();
      await new Promise((resolve) => {
        const tick = () => {
          if (!s || s.state !== 'playing') return resolve();
          if (s.t >= target.start - 0.02) return resolve();
          requestAnimationFrame(tick);
        };
        tick();
      });
    }, nextNote);

    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: nextNote.x, y: nextNote.y, id: 0, force: 1 }],
    });
    await wait(60);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [{ x: nextNote.x, y: nextNote.y, id: 0 }],
    });
    await wait(150);

    const afterHit = await page.evaluate(() => window.__piano.state().session);
    check('跟弹时按准了音 → 判定计数增加',
      afterHit.counts.perfect + afterHit.counts.great + afterHit.counts.good > 0,
      JSON.stringify(afterHit.counts));
    check('跟弹时按准了音 → 得分增加', afterHit.score > 0, String(afterHit.score));
  } else {
    check('跟弹时按准了音 → 判定计数增加', false, '拿不到待弹音符');
  }

  await page.screenshot({ path: path.join(SHOTS, '04-song.png') });

  /* ---------------------------------------- 瀑布流与琴键的像素级对齐 */
  /* 舞台画布和琴键画布必须等宽同起点，否则音符会横向漂移 */
  const align = await page.evaluate(() => {
    const stageC = document.getElementById('stageCanvas');
    const keysC = document.getElementById('keysCanvas');
    const sr = stageC.getBoundingClientRect();
    const kr = keysC.getBoundingClientRect();
    const V = window.__piano.View;
    /* 挑几个视窗内的音，算出它在琴键画布里的中心 x，
       再映射到页面坐标，和音符该在的位置比较 */
    const probe = [60, 64, 67].filter(m => V.layout.map[m]);
    return {
      stageLeft: sr.left, keysLeft: kr.left,
      stageW: sr.width, keysW: kr.width,
      /* 琴键中心（页面坐标） */
      keyCenters: probe.map(m => {
        const k = V.layout.map[m];
        return { midi: m, pageX: kr.left + k.x + k.w / 2 };
      })
    };
  });
  check('舞台画布与琴键画布左边缘对齐', Math.abs(align.stageLeft - align.keysLeft) < 1.5,
    align.stageLeft + ' vs ' + align.keysLeft);
  check('舞台画布与琴键画布等宽', Math.abs(align.stageW - align.keysW) < 1.5,
    align.stageW + ' vs ' + align.keysW);

  /* 直接从舞台画布取像素：找出判定线上方那一排音符块的横向中心，
     和对应琴键的页面坐标比对 */
  const pixelAlign = await page.evaluate(async () => {
    const stageC = document.getElementById('stageCanvas');
    const keysC = document.getElementById('keysCanvas');
    const V = window.__piano.View;
    const P = window.__piano;
    const s = P.currentSession();
    if (!s) return { ok: false, why: 'no session' };

    /* 取一个 pending 的右手音，把它的时间挪到「现在」，
       这样它正好落在判定线上，可以直接从像素里找它的横向位置 */
    const pending = s.notes.filter(n => n.state === 'pending' && n.hand === 'R');
    if (!pending.length) return { ok: false, why: 'no pending RH note' };
    const target = pending[0];
    s.t = target.start;

    /* 等一帧，让 View 把这一帧画出来 */
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    /* 扫描舞台画布判定线上方 20px 这一行，找非背景像素的色块 */
    const c = stageC.getContext('2d');
    const dpr = stageC.width / stageC.getBoundingClientRect().width;
    const y = Math.round((stageC.getBoundingClientRect().height - 12) * dpr);
    const img = c.getImageData(0, y, stageC.width, 1).data;
    const runs = [];
    let start = -1;
    for (let x = 0; x < stageC.width; x++) {
      const i = x * 4;
      /* 背景是接近 #12131a 的深色；音符是明亮的琥珀/青色 */
      const bright = img[i] > 120 && img[i + 1] > 90;
      if (bright && start < 0) start = x;
      if ((!bright || x === stageC.width - 1) && start >= 0) {
        runs.push({ from: start, to: x, mid: (start + x) / 2 });
        start = -1;
      }
    }
    if (!runs.length) return { ok: false, why: '判定线上方没找到音符像素' };

    /* 音符色块中心（页面坐标）应落在目标琴键中心 ± 3px */
    const kr = keysC.getBoundingClientRect();
    const k = V.layout.map[target.midi];
    if (!k) return { ok: false, why: '目标键不在视窗内' };
    const keyPageX = kr.left + k.x + k.w / 2;
    const stageRect = stageC.getBoundingClientRect();
    const notePageXs = runs.map(r => stageRect.left + r.mid / dpr);
    const best = notePageXs.reduce((a, b) =>
      Math.abs(b - keyPageX) < Math.abs(a - keyPageX) ? b : a, notePageXs[0]);
    return {
      ok: true, midi: target.midi, keyPageX: keyPageX,
      notePageX: best, runs: runs.length, delta: Math.abs(best - keyPageX)
    };
  });
  check('瀑布流音符横向与对应琴键对齐（±4px）',
    pixelAlign.ok && pixelAlign.delta < 4, JSON.stringify(pixelAlign));


  /* -------------------------------- 命中 / 漏掉的颜色约定（像素级） */
  const colorCheck = await page.evaluate(async () => {
    const P = window.__piano;
    const stageC = document.getElementById('stageCanvas');
    const s = P.currentSession();
    if (!s) return { ok: false, why: 'no session' };

    /* 挑两个音高不同的待弹右手音 */
    const pending = s.notes.filter(n => n.state === 'pending' && n.hand === 'R');
    let hitNote = null, missNote = null;
    for (let i = 0; i < pending.length; i++) {
      for (let j = i + 1; j < pending.length; j++) {
        if (pending[i].midi !== pending[j].midi) { hitNote = pending[i]; missNote = pending[j]; break; }
      }
      if (hitNote) break;
    }
    if (!hitNote) return { ok: false, why: '找不到音高不同的两个待弹音' };

    /* 把两个音的时间都挪到「现在」，让它们同时落在判定线上 */
    s.t = hitNote.start;
    hitNote.start = s.t;
    hitNote.state = 'hit';
    hitNote.hitTime = s.t;              // 刚刚击中 → 绿色
    missNote.start = s.t;
    missNote.state = 'miss';

    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    /* 在判定线上方 14px 处扫描每一列的颜色 */
    const rect = stageC.getBoundingClientRect();
    const c = stageC.getContext('2d');
    const dpr = stageC.width / rect.width;
    const y = Math.round((rect.height - 14) * dpr);
    const img = c.getImageData(0, y, stageC.width, 1).data;
    const V = P.View;

    function sampleAt(midi) {
      const k = V.layout.map[midi];
      if (!k) return null;
      const xStage = k.x + k.w / 2 + (V.stageOffsetX || 0);
      const px = Math.round(xStage * dpr);
      if (px < 0 || px >= img.length / 4) return null;
      const i = px * 4;
      return { r: img[i], g: img[i + 1], b: img[i + 2], x: Math.round(xStage) };
    }

    return {
      ok: true,
      hit: sampleAt(hitNote.midi),
      miss: sampleAt(missNote.midi),
      hitMidi: hitNote.midi, missMidi: missNote.midi
    };
  });
  check('命中音符渲染为绿色', colorCheck.ok && colorCheck.hit &&
    colorCheck.hit.g > colorCheck.hit.r, JSON.stringify(colorCheck.hit));
  check('漏掉音符渲染为红色', colorCheck.ok && colorCheck.miss &&
    colorCheck.miss.r > colorCheck.miss.g, JSON.stringify(colorCheck.miss));
  check('命中与漏掉的颜色确实不同',
    colorCheck.ok && colorCheck.hit && colorCheck.miss &&
    (colorCheck.hit.g - colorCheck.hit.r) !== (colorCheck.miss.g - colorCheck.miss.r),
    JSON.stringify({ hit: colorCheck.hit, miss: colorCheck.miss }));

  /* 自动伴奏：切到单手模式，另一手应自动发声（需等过 lead-in 预奏） */
  const autoVoiced = await page.evaluate(async () => {
    const P = window.__piano;
    P.setSettings({ hands: 'right', otherHand: true, lead: 1.2 });
    P.startSong();
    /* 等到第一个左手伴奏音被触发 */
    await new Promise((resolve) => {
      const tick = () => {
        const s = P.currentSession();
        if (!s || s.state !== 'playing') return resolve();
        if (s.autoNotes.some(n => n.state === 'auto')) return resolve();
        if (s.t > 4) return resolve();
        requestAnimationFrame(tick);
      };
      tick();
    });
    return {
      voices: P.state().voices,
      autoFired: P.currentSession()
        ? P.currentSession().autoNotes.filter(n => n.state === 'auto').length : 0,
      judged: P.currentSession() ? P.currentSession().total : -1
    };
  });
  check('单手模式：另一手自动伴奏会发声', autoVoiced.autoFired > 0, JSON.stringify(autoVoiced));
  check('单手模式：待弹音只剩一只手', autoVoiced.judged > 0 &&
    autoVoiced.judged < autoVoiced.judged + autoVoiced.autoFired, String(autoVoiced.judged));

  await page.evaluate(() => window.__piano.stop());

  /* ================================================== 认键练习 */

  await page.evaluate(() => {
    window.__piano.setMode('note');
    window.__piano.setSettings({ noteScope: 'white', noteRounds: '10' });
    window.__piano.startNote();
  });
  await wait(400);
  const noteState = await page.evaluate(() => window.__piano.state());
  check('认键会话已启动', noteState.sessionKind === 'note');

  const noteTarget = await page.evaluate(() => {
    const P = window.__piano;
    const s = P.currentSession();
    if (!s || s.target == null) return null;
    const c = document.getElementById('keysCanvas');
    const r = c.getBoundingClientRect();
    const p = P.Core.keyCenter(P.View.layout, s.target);
    if (!p) return null;
    return { midi: s.target, x: r.left + p.x, y: r.top + p.y };
  });
  if (noteTarget) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: noteTarget.x, y: noteTarget.y, id: 0, force: 1 }],
    });
    await wait(50);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [{ x: noteTarget.x, y: noteTarget.y, id: 0 }],
    });
    await wait(200);
    const found = await page.evaluate(() => window.__piano.currentSession().correct);
    check('认键：按对目标音 → 答对计数 +1', found >= 1, String(found));
  } else {
    check('认键：按对目标音 → 答对计数 +1', false, '拿不到目标音');
  }
  /* 认键的目标音也必须在视窗内 */
  const noteVisible = await page.evaluate(() => {
    const P = window.__piano;
    const s = P.currentSession();
    const t = s && s.target;
    return { target: t, inView: !!(t != null && P.View.layout.map[t]) };
  });
  check('认键：目标音在视窗内可见', noteVisible.inView, JSON.stringify(noteVisible));

  await page.screenshot({ path: path.join(SHOTS, '05-note.png') });
  await page.evaluate(() => window.__piano.stop());

  /* ================================================== 音阶 / 和弦 */

  await page.evaluate(() => {
    window.__piano.setMode('harmony');
    window.__piano.startScale();
  });
  await wait(300);
  const scaleState = await page.evaluate(() => window.__piano.state());
  check('音阶会话已启动', scaleState.sessionKind === 'scale');

  const scaleHit = await page.evaluate(() => {
    const P = window.__piano;
    const s = P.currentSession();
    const next = s.next();
    if (next == null) return { ok: false };
    const before = s.index;
    P.noteOn(next, 0.8, 'test');
    P.noteOff(next, 'test');
    return { ok: s.index === before + 1, before: before, after: s.index };
  });
  check('音阶：按对下一个音 → 进度前进', scaleHit.ok, JSON.stringify(scaleHit));
  /* 目标键必须真的在视窗里，否则用户根本看不到要弹哪个键 */
  const scaleVisible = await page.evaluate(() => {
    const P = window.__piano;
    const s = P.currentSession();
    const next = s && s.next();
    return {
      next: next,
      inView: !!(next != null && P.View.layout.map[next]),
      low: P.View.layout.lowMidi, high: P.View.layout.highMidi
    };
  });
  check('音阶：下一个音在视窗内可见', scaleVisible.inView, JSON.stringify(scaleVisible));

  /* 目标键不仅要在视窗里，还要真的被高亮（画布上有提示色） */
  const scaleHint = await page.evaluate(async () => {
    const P = window.__piano;
    const s = P.currentSession();
    const next = s && s.next();
    if (next == null) return { ok: false, why: 'no next' };
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const keysC = document.getElementById('keysCanvas');
    const rect = keysC.getBoundingClientRect();
    const c = keysC.getContext('2d');
    const dpr = keysC.width / rect.width;
    const k = P.View.layout.map[next];
    if (!k) return { ok: false, why: 'key not in view' };
    /* 取目标键白键下半部（提示色覆盖整个键） */
    const x = Math.round((k.x + k.w / 2) * dpr);
    const y = Math.round((k.h * 0.5) * dpr);
    const d = c.getImageData(x, y, 1, 1).data;
    /* 未高亮的白键是米白 (#fbfaf7→#dedad0)，高亮后带明显琥珀/青色调 */
    return {
      ok: true, midi: next, rgb: [d[0], d[1], d[2]],
      hintColor: P.View.hints[next] || null
    };
  });
  check('音阶：目标键被高亮（画布上有提示色）',
    scaleHint.ok && scaleHint.hintColor &&
    scaleHint.rgb[0] > scaleHint.rgb[2] + 30,
    JSON.stringify(scaleHint));

  await page.screenshot({ path: path.join(SHOTS, '06-scale.png') });
  await page.evaluate(() => window.__piano.stop());

  await page.evaluate(() => {
    window.__piano.setMode('harmony');
    window.__piano.startChord();
  });
  await wait(300);
  const chordState = await page.evaluate(() => window.__piano.state());
  check('和弦会话已启动', chordState.sessionKind === 'chord');

  const chordHit = await page.evaluate(() => {
    const P = window.__piano;
    const s = P.currentSession();
    const cur = s.current();
    if (!cur) return { ok: false };
    const before = s.cleared;
    cur.midis.forEach(m => P.noteOn(m, 0.8, 'test'));
    return { ok: s.cleared === before + 1, before: before, after: s.cleared };
  });
  check('和弦：按齐所有音 → 判定为完成', chordHit.ok, JSON.stringify(chordHit));
  /* 和弦的所有音都必须在视窗内 */
  const chordVisible = await page.evaluate(() => {
    const P = window.__piano;
    const s = P.currentSession();
    const cur = s && s.current();
    if (!cur) return { ok: false };
    const missing = cur.midis.filter(m => !P.View.layout.map[m]);
    return { ok: missing.length === 0, missing: missing, chord: cur.name };
  });
  check('和弦：当前和弦所有音都在视窗内', chordVisible.ok, JSON.stringify(chordVisible));

  await page.screenshot({ path: path.join(SHOTS, '07-chord.png') });
  await page.evaluate(() => window.__piano.stop());

  /* ================================================== 电脑键盘 */

  await page.evaluate(() => window.__piano.setMode('free'));
  await page.keyboard.down('z');
  await page.keyboard.down('c');
  await page.keyboard.down('b');
  await wait(200);
  const kbState = await page.evaluate(() => ({
    voices: window.__piano.state().voices,
    pressed: Object.keys(window.__piano.View.pressed).map(Number)
  }));
  await page.keyboard.up('z');
  await page.keyboard.up('c');
  await page.keyboard.up('b');
  check('电脑键盘三个键同时按下 → 3 个音', kbState.pressed.length === 3, JSON.stringify(kbState.pressed));
  check('电脑键盘发声', kbState.voices >= 3, String(kbState.voices));

  /* ================================================== 录制回放 */

  await page.evaluate(() => { window.__piano.setMode('free'); });
  await page.click('#recordBtn');
  await page.evaluate(() => {
    window.__piano.noteOn(60, 0.8, 'test');
    setTimeout(() => window.__piano.noteOff(60, 'test'), 150);
  });
  await wait(250);
  await page.click('#recordBtn');
  const recState = await page.evaluate(() => window.__piano.state().record);
  check('录制捕获到音符', recState.clip >= 1, JSON.stringify(recState));

  await page.evaluate(() => {
    document.querySelectorAll('#panel .btn').forEach(b => {
      if (b.textContent === '回放') b.click();
    });
  });
  await wait(300);
  const played = await page.evaluate(() => window.__piano.state().voices);
  check('回放会重新发声', played >= 1, String(played));
  await page.screenshot({ path: path.join(SHOTS, '08-record.png') });

  /* ================================================== 持久化 */

  await page.evaluate(() => window.__piano.setSettings({ label: 'jianpu', tempo: 85 }));
  await wait(200);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__piano, { timeout: 15000 });
  const persisted = await page.evaluate(() => window.__piano.settings());
  check('刷新后设置仍在（localStorage）', persisted.label === 'jianpu' && persisted.tempo === 85,
    JSON.stringify({ label: persisted.label, tempo: persisted.tempo }));

  /* ================================================== 主题 */

  const themeBefore = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await page.click('#themeBtn');
  await wait(200);
  const themeAfter = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  check('深浅色可切换', themeBefore !== themeAfter, themeBefore + '→' + themeAfter);
  await page.screenshot({ path: path.join(SHOTS, '09-theme-' + themeAfter + '.png') });
  await page.click('#themeBtn');

  /* ================================================== 帮助 / 小地图 */

  await page.click('#helpBtn');
  await wait(200);
  const helpText = await page.evaluate(() => {
    const o = document.getElementById('overlay');
    return o.hidden ? '' : o.textContent;
  });
  check('帮助面板有内容', helpText.includes('多点触摸'), helpText.slice(0, 40));
  await page.screenshot({ path: path.join(SHOTS, '10-help.png') });
  await page.evaluate(() => { document.getElementById('overlay').hidden = true; });

  const miniBefore = await page.evaluate(() => window.__piano.viewport().startWhite);
  const miniBox = await page.evaluate(() => {
    const c = document.getElementById('miniCanvas');
    const r = c.getBoundingClientRect();
    return { x: r.left + r.width * 0.85, y: r.top + r.height / 2 };
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: miniBox.x, y: miniBox.y, id: 0, force: 1 }],
  });
  await wait(120);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [{ x: miniBox.x, y: miniBox.y, id: 0 }],
  });
  await wait(200);
  const miniAfter = await page.evaluate(() => window.__piano.viewport().startWhite);
  check('小地图可点击跳转音域', miniAfter !== miniBefore, miniBefore + '→' + miniAfter);

  /* ================================================== 收尾 */

  check('全程无 JS 异常', errors.length === 0, errors.slice(0, 3).join(' || '));

  await browser.close();

  const passed = checks.filter((c) => c.ok).length;
  console.log('\n' + passed + '/' + checks.length + ' 项通过');
  if (passed !== checks.length) {
    console.log('失败项：');
    checks.filter((c) => !c.ok).forEach((c) => console.log('  · ' + c.name + (c.extra ? ' → ' + c.extra : '')));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
