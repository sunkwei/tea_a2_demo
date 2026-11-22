/**
 * 李清照 · 漱玉词 —— 无头浏览器端到端验证
 *
 *   node li-qingzhao/tools/verify.mjs             # 本地功能 + AI 离线降级
 *   node li-qingzhao/tools/verify.mjs --online    # 额外跑一次真实 tea_a2（需 8383 在跑）
 *
 * 依赖：puppeteer-core（仓库 devDependencies 里已有）+ 本机 Chrome / Edge。
 * 浏览器路径可用 CHROME_PATH / EDGE_PATH 指定。
 * 截屏输出：li-qingzhao/tools/shots/（不入库）
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SHOTS = path.join(HERE, 'shots');
const WANT_ONLINE = process.argv.includes('--online');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
};

function findBrowser() {
  const env = process.env.CHROME_PATH || process.env.EDGE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
  const candidates = [
    env,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/snap/bin/chromium',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent((req.url || '/').split('?')[0]);
      const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('404');
        return;
      }
      const stat = fs.statSync(file);
      const mime = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      const range = req.headers.range;
      const m = range && /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
      if (m && stat.size) {
        let start = m[1] === '' ? stat.size - Number(m[2]) : Number(m[1]);
        let end = m[2] === '' || m[1] === '' ? stat.size - 1 : Number(m[2]);
        start = Math.max(0, start);
        end = Math.min(stat.size - 1, end);
        if (start > end) {
          res.writeHead(416, { 'content-range': 'bytes */' + stat.size });
          res.end();
          return;
        }
        res.writeHead(206, {
          'content-type': mime,
          'content-length': end - start + 1,
          'content-range': 'bytes ' + start + '-' + end + '/' + stat.size,
          'accept-ranges': 'bytes',
          'cache-control': 'no-cache',
        });
        fs.createReadStream(file, { start, end }).pipe(res);
        return;
      }
      res.writeHead(200, {
        'content-type': mime,
        'content-length': stat.size,
        'accept-ranges': 'bytes',
        'cache-control': 'no-cache',
      });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const checks = [];
function check(name, ok, extra) {
  checks.push({ name, ok: !!ok });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (!ok && extra != null ? '  → ' + extra : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadAllImages(page) {
  await page.evaluate(async () => {
    const imgs = Array.prototype.slice.call(document.querySelectorAll('img'));
    imgs.forEach((im) => { im.loading = 'eager'; });
    await Promise.all(imgs.map((im) => {
      if (im.complete && im.naturalWidth > 0) return Promise.resolve();
      return new Promise((resolve) => {
        const done = () => resolve();
        im.addEventListener('load', done, { once: true });
        im.addEventListener('error', done, { once: true });
        setTimeout(done, 5000);
      });
    }));
  });
}

async function triggerReveal(page) {
  await page.evaluate(async () => {
    const h = document.documentElement.scrollHeight;
    for (let y = 0; y < h; y += 500) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 40));
    }
    window.scrollTo(0, 0);
  });
  await sleep(900);
}

async function main() {
  const browserPath = findBrowser();
  if (!browserPath) {
    console.error('找不到 Chrome / Edge，可设置 CHROME_PATH 后重试。');
    process.exit(1);
  }
  fs.mkdirSync(SHOTS, { recursive: true });
  const { server, port } = await startServer();
  const base = 'http://127.0.0.1:' + port + '/';
  console.log('李清照 · 漱玉词 —— 端到端验证');
  console.log('页面：' + base + '\n');

  const browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--font-render-hinting=none'],
    defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });

  await page.goto(base, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(900);
  await triggerReveal(page);
  await loadAllImages(page);

  /* ---------------- 首屏 / 数据 ---------------- */
  const shell = await page.evaluate(() => ({
    title: document.title,
    h1: document.querySelector('.hero h1') ? document.querySelector('.hero h1').textContent.trim() : '',
    stats: document.querySelectorAll('#heroStats li').length,
    stages: document.querySelectorAll('.stage-card').length,
    journey: document.querySelectorAll('.journey-item').length,
    rail: document.querySelectorAll('#railList a').length,
    rows: document.querySelectorAll('.row').length,
    verse: document.querySelectorAll('.verse-card').length,
    prose: document.querySelectorAll('.verse-body.prose').length,
    quote: document.querySelectorAll('.quote').length,
    notes: document.querySelectorAll('.notes').length,
    imgs: document.querySelectorAll('#timelineList img').length,
    credits: document.querySelectorAll('.col-media figcaption .credit').length,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    playerSrc: document.querySelector('#bgm').getAttribute('src') || '',
    scrollH: document.documentElement.scrollHeight,
  }));
  check('标题含「李清照」', /李清照/.test(shell.title), shell.title);
  check('首屏 h1 = 李清照', /^李清照/.test(shell.h1), shell.h1);
  check('首屏统计 4 项', shell.stats === 4, shell.stats);
  check('五段人生 5 张卡片', shell.stages === 5, shell.stages);
  check('行迹 11 个地点', shell.journey === 11, shell.journey);
  check('顶部导航 16 个入口', shell.rail === 16, shell.rail);
  check('时间线 16 条', shell.rows === 16, shell.rows);
  check('词笺卡 14 张（11 词 + 2 诗 + 1 文）', shell.verse === 14, shell.verse);
  check('散文卡 1 张（金石录后序）', shell.prose === 1, shell.prose);
  check('余响引文 1 处', shell.quote === 1, shell.quote);
  check('词语注释 16 组', shell.notes === 16, shell.notes);
  check('图片 21 张（16 主图 + 5 附图）', shell.imgs === 21, shell.imgs);
  check('每条都有图片署名', shell.credits === 16, shell.credits);
  check('桌面无横向溢出', shell.overflow <= 1, shell.overflow);
  check('页面足够长（> 12000px）', shell.scrollH > 12000, shell.scrollH);
  check('音频 src 已就绪', /assets\/audio\/yangguan-sandie\.mp3/.test(shell.playerSrc), shell.playerSrc);

  const loaded = await page.evaluate(() => {
    const imgs = Array.prototype.slice.call(document.querySelectorAll('#timelineList img'));
    return {
      total: imgs.length,
      bad: imgs.filter((im) => !(im.complete && im.naturalWidth > 0)).map((im) => im.getAttribute('src')),
      tall: document.querySelectorAll('.shot.tall').length,
    };
  });
  check('时间线图片全部加载成功', loaded.bad.length === 0, loaded.bad.join(','));
  check('竖幅画自动用 contain 画框（>= 3 张）', loaded.tall >= 3, loaded.tall);

  const content = await page.evaluate(() => {
    const row = document.querySelector('#c-shaonv');
    const text = row ? row.textContent : '';
    const d = document.querySelector('#c-jinshilu');
    return {
      hasTitle: text.includes('如梦令'),
      hasLine: text.includes('误入藕花深处'),
      hasNotes: !!row.querySelector('.notes'),
      proseHasP: d ? d.querySelectorAll('.prose-p').length : 0,
      altMissing: Array.prototype.slice.call(document.querySelectorAll('#timelineList img')).filter((im) => !im.alt).length,
      figcaptionLinks: document.querySelectorAll('.col-media figcaption a').length,
    };
  });
  check('《如梦令》条目含标题与词句', content.hasTitle && content.hasLine);
  check('条目含词语注释', content.hasNotes);
  check('散文条目使用 prose-p（3+ 段）', content.proseHasP >= 3, content.proseHasP);
  check('所有图片都有 alt', content.altMissing === 0, content.altMissing);
  check('图注带 Commons 链接', content.figcaptionLinks >= 16, content.figcaptionLinks);

  /* ---------------- 词笺展开 ---------------- */
  const notes = await page.evaluate(() => {
    const d = document.querySelector('#c-shaonv .notes');
    if (!d) return null;
    d.open = true;
    return { open: d.open, items: d.querySelectorAll('dt').length };
  });
  check('注释可展开且有条目', notes && notes.open && notes.items >= 2, notes);

  /* ---------------- 灯箱 ---------------- */
  await page.click('[data-open="shaonv"]');
  await sleep(500);
  const lb1 = await page.evaluate(() => ({
    hidden: document.querySelector('#lightbox').hidden,
    title: document.querySelector('#lbTitle').textContent,
    count: document.querySelector('#lbCount').textContent,
    credit: document.querySelector('#lbCredit').textContent,
    imgOk: (() => { const im = document.querySelector('#lbImg'); return im.complete && im.naturalWidth > 0; })(),
    overflow: document.body.style.overflow,
  }));
  check('灯箱打开', lb1.hidden === false);
  check('灯箱标题与计数', /如梦令/.test(lb1.title) && /\d+ \/ \d+/.test(lb1.count), lb1.title + ' / ' + lb1.count);
  check('灯箱图片加载', lb1.imgOk);
  check('灯箱带署名', /Public domain|CC|Wikimedia/.test(lb1.credit), lb1.credit);
  check('灯箱打开时锁滚动', lb1.overflow === 'hidden', lb1.overflow);

  await page.click('[data-lb="next"]');
  await sleep(300);
  const lb2 = await page.evaluate(() => ({
    title: document.querySelector('#lbTitle').textContent,
    count: document.querySelector('#lbCount').textContent,
  }));
  check('灯箱可切到下一张', lb2.title !== lb1.title || lb2.count !== lb1.count, lb2.title);

  await page.click('#lbImg');
  await sleep(250);
  const zoomed = await page.evaluate(() => document.querySelector('#lbImg').style.transform);
  check('点击图片放大 2.2×', /scale\(2\.2/.test(zoomed), zoomed);
  await page.keyboard.press('Escape');
  await sleep(250);
  const lbClosed = await page.evaluate(() => ({
    hidden: document.querySelector('#lightbox').hidden,
    overflow: document.body.style.overflow,
  }));
  check('Esc 关闭灯箱并恢复滚动', lbClosed.hidden === true && lbClosed.overflow === '', lbClosed);

  /* ---------------- 音频 ---------------- */
  const audioInfo = await page.evaluate(async () => {
    const a = document.querySelector('#bgm');
    try { await a.play(); } catch (e) { /* ignore */ }
    await new Promise((r) => setTimeout(r, 400));
    return { paused: a.paused, duration: a.duration, loop: a.loop, volume: a.volume };
  });
  check('音频可以播放（loop）', audioInfo.loop === true && audioInfo.duration > 60, audioInfo);
  check('音频时长约 5:50', Math.abs(audioInfo.duration - 350) < 10, audioInfo.duration);

  await page.click('#musicBtn');
  await sleep(300);
  const afterBtn = await page.evaluate(() => ({
    pressed: document.querySelector('#musicBtn').getAttribute('aria-pressed'),
    paused: document.querySelector('#bgm').paused,
  }));
  check('「古琴」按钮进入播放状态', afterBtn.pressed === 'true' && afterBtn.paused === false, afterBtn);

  await page.click('#musicMore');
  await sleep(250);
  const popOpen = await page.evaluate(() => !document.querySelector('#musicPop').hidden);
  check('音量面板可以打开', popOpen);

  const vol = await page.evaluate(() => {
    const v = document.querySelector('#musicVol');
    v.value = 70;
    v.dispatchEvent(new Event('input', { bubbles: true }));
    return {
      out: document.querySelector('#musicVolOut').textContent,
      saved: localStorage.getItem('lq.audio.v1'),
      credit: document.querySelector('#musicCredit').textContent,
    };
  });
  check('音量滑杆更新为 70%', vol.out === '70%', vol.out);
  check('音量写入 localStorage', /"volume":70/.test(vol.saved || ''), vol.saved);
  check('音乐面板含 CC BY-SA 与 Commons', /CC BY-SA 3\.0/.test(vol.credit) && /Commons/.test(vol.credit), vol.credit.slice(0, 120));
  await page.evaluate(() => { document.querySelector('#musicPop').hidden = true; });

  /* ---------------- AI 抽屉 ---------------- */
  await page.click('[data-ask="shaonv"]');
  await sleep(500);
  const ai1 = await page.evaluate(() => ({
    hidden: document.querySelector('#ai').hidden,
    q: document.querySelector('#aiQuery').value,
    presets: document.querySelectorAll('#aiPresets button').length,
    hasPresets: !!document.querySelector('#aiPresets'),
    status: document.querySelector('#aiStatus').textContent,
    summary: document.querySelector('#aiSettings summary').textContent,
    settingsOpen: document.querySelector('#aiSettings').open,
  }));
  check('AI 抽屉打开', ai1.hidden === false);
  check('AI 输入框带入当前作品问题', ai1.q.includes('如梦令') || ai1.q.length > 8, ai1.q);
  check('已移除「试试问」', ai1.presets === 0 && ai1.hasPresets === false, ai1.presets + '/' + ai1.hasPresets);
  check('AI 状态徽标有文案', ai1.status.length > 0, ai1.status);
  check('连接设置显示地址', /localhost|127\.0\.0\.1/.test(ai1.summary), ai1.summary);

  const ratio = await page.evaluate(() => {
    const panel = document.querySelector('.ai-panel').getBoundingClientRect();
    const body = document.querySelector('.ai-body').getBoundingClientRect();
    return { panel: panel.height, body: body.height, ratio: body.height / panel.height };
  });
  check('回答区至少占抽屉高度的 50%', ratio.ratio >= 0.5, (ratio.ratio * 100).toFixed(1) + '% (' + Math.round(ratio.body) + '/' + Math.round(ratio.panel) + ')');

  const md = await page.evaluate(() => {
    const html = window.LI_QINGZHAO_CORE.renderAnswer('**结论先说：** 家世影响大。\n\n1. **家世**，主要是\"文化课本\"\n\n结尾');
    return { html, escaped: window.LI_QINGZHAO_CORE.renderAnswer('<img src=x onerror=alert(1)>') };
  });
  check('回答按 Markdown 渲染（粗体/列表）', /<strong>结论先说：<\/strong>/.test(md.html) && /<ol><li>/.test(md.html), md.html.slice(0, 120));
  check('回答内容先转义，不放行原始 HTML', !/<img/i.test(md.escaped), md.escaped);

  await page.keyboard.press('Escape');
  await sleep(250);
  check('Esc 关闭 AI 抽屉', await page.evaluate(() => document.querySelector('#ai').hidden === true));

  const offline = await page.evaluate(async () => {
    const p = await window.LI_QINGZHAO_ONLINE.probe('http://127.0.0.1:59999', { timeout: 1200 });
    const s = await window.LI_QINGZHAO_ONLINE.search('《声声慢》好在哪里？', {
      base: 'http://127.0.0.1:59999',
      entry: window.LI_QINGZHAO_CORE.byId(window.LI_QINGZHAO_DATA.entries, 'shengshengman'),
      meta: window.LI_QINGZHAO_DATA.meta,
      timeout: 1500,
    });
    return { probe: p, search: s };
  });
  check('tea_a2 离线探测降级', offline.probe.ok === false, JSON.stringify(offline.probe));
  check('tea_a2 离线问答降级', offline.search.ok === false && /offline|timeout/.test(offline.search.kind), JSON.stringify(offline.search));

  /* ---------------- 截图 ---------------- */
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(600);
  await page.screenshot({ path: path.join(SHOTS, '01-hero.png') });
  await page.evaluate(() => {
    const el = document.querySelector('#c-shaonv');
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 70);
  });
  await sleep(800);
  await page.screenshot({ path: path.join(SHOTS, '02-timeline.png') });
  await page.click('[data-open="shaonv"]');
  await sleep(500);
  await page.screenshot({ path: path.join(SHOTS, '03-lightbox.png') });
  await page.keyboard.press('Escape');

  /* ---------------- 移动端 ---------------- */
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(800);
  await triggerReveal(page);
  const mobile = await page.evaluate(() => {
    const heroScroll = getComputedStyle(document.querySelector('.hero-scroll')).display;
    const row = document.querySelector('#c-shaonv');
    const grid = getComputedStyle(row).gridTemplateColumns;
    const rail = document.querySelector('#railList');
    const btn = document.querySelector('#musicBtn').getBoundingClientRect();
    const fab = document.querySelector('#aiFab').getBoundingClientRect();
    const fabDisplay = getComputedStyle(document.querySelector('#aiFab')).display;
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      heroScroll,
      grid,
      railScroll: rail.scrollWidth > rail.clientWidth,
      btnH: Math.round(btn.height),
      fabW: Math.round(fab.width),
      fabDisplay,
      font: getComputedStyle(document.querySelector('.body')).fontSize,
    };
  });
  check('移动端无横向溢出', mobile.overflow <= 1, mobile.overflow);
  check('移动端隐藏竖排词笺', mobile.heroScroll === 'none', mobile.heroScroll);
  check('移动端单列堆叠', mobile.grid.split(' ').length === 1, mobile.grid);
  check('移动端导航可横向滚动', mobile.railScroll === true);
  check('古琴按钮触控高度 >= 44', mobile.btnH >= 44, mobile.btnH);
  check('移动端隐藏浮动 AI 按钮（条目内仍有问 AI）', mobile.fabDisplay === 'none', mobile.fabDisplay);
  check('移动端正文 15px', mobile.font === '15px', mobile.font);
  await page.screenshot({ path: path.join(SHOTS, '04-mobile.png') });

  /* ---------------- 深色模式 ---------------- */
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(800);
  const dark = await page.evaluate(() => ({
    bg: getComputedStyle(document.body).backgroundColor,
    ink: getComputedStyle(document.querySelector('.col-text h2')).color,
  }));
  check('深色模式生效', dark.bg === 'rgb(20, 17, 14)', dark.bg);
  check('深色模式文字为浅色', dark.ink !== 'rgb(33, 28, 23)', dark.ink);
  await page.screenshot({ path: path.join(SHOTS, '05-dark.png') });

  const unexpected = errors.filter((e) => !/ERR_CONNECTION_REFUSED|ERR_UNSAFE_PORT/.test(e));
  check('无意外 JS 运行错误', unexpected.length === 0, unexpected.slice(0, 3).join(' | '));

  /* ---------------- 可选：真实 tea_a2 ---------------- */
  if (WANT_ONLINE) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(800);
    const online = await page.evaluate(async () => {
      const p = await window.LI_QINGZHAO_ONLINE.probe('http://localhost:8383', { timeout: 5000 });
      if (!p.ok) return { p };
      const s = await window.LI_QINGZHAO_ONLINE.search('用一句话说说《如梦令·常记溪亭日暮》的画面。', {
        base: 'http://localhost:8383',
        entry: window.LI_QINGZHAO_CORE.byId(window.LI_QINGZHAO_DATA.entries, 'shaonv'),
        meta: window.LI_QINGZHAO_DATA.meta,
        timeout: 75000,
      });
      return { p, s };
    });
    check('真实 tea_a2 在线', online.p && online.p.ok, JSON.stringify(online.p));
    check('真实 tea_a2 有回答', online.s && online.s.ok && online.s.content.length > 20, online.s && (online.s.error || online.s.content));
  }

  await browser.close();
  server.close();

  console.log('\n通过 ' + checks.filter((c) => c.ok).length + ' 项，失败 ' + checks.filter((c) => !c.ok).length + ' 项');
  console.log('截图：' + path.relative(process.cwd(), SHOTS) + '/');
  if (checks.some((c) => !c.ok)) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
