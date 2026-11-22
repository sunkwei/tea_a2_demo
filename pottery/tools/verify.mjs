/**
 * 中国陶器史 · 无头浏览器端到端验证
 *
 *   node pottery/tools/verify.mjs             # 本地功能 + AI 离线降级
 *   node pottery/tools/verify.mjs --online    # 额外跑一次真实 tea_a2（需 8383 在跑）
 *
 * 依赖：puppeteer-core（仓库 devDependencies 里已有）+ 本机 Chrome / Edge。
 * 浏览器路径可用 CHROME_PATH / EDGE_PATH 指定。
 * 截屏输出：pottery/tools/shots/（已 gitignore）
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
      res.writeHead(200, {
        'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
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
    const rows = Array.prototype.slice.call(document.querySelectorAll('.row'));
    for (const r of rows) {
      r.scrollIntoView({ block: 'center' });
      await new Promise((res) => setTimeout(res, 80));
    }
    document.querySelectorAll('.reveal').forEach((e) => e.classList.add('in'));
  });
  await page.waitForFunction(
    () => Array.prototype.every.call(document.querySelectorAll('#timelineList img'), (i) => i.complete && i.naturalWidth > 0),
    { timeout: 20000 }
  ).catch(() => {});
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const exe = findBrowser();
  if (!exe) {
    console.error('找不到 Chrome / Edge。用 CHROME_PATH=/path/to/chrome 指定。');
    process.exit(2);
  }
  console.log('浏览器：' + exe);

  const { server, port } = await startServer();
  const base = 'http://127.0.0.1:' + port + '/';
  console.log('本地服务：' + base);

  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: 'new',
    args: ['--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=1', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
    defaultViewport: { width: 1440, height: 1000 },
  });
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource|net::ERR_FAILED|ERR_CONNECTION/i.test(t)) return;
    errors.push('console: ' + t);
  });

  try {
    await page.goto(base, { waitUntil: 'networkidle2', timeout: 60000 });
    await loadAllImages(page);

    /* ---------------------------------------------------------- 页面结构 */
    check('标题正确', (await page.title()).includes('中国陶器史'));
    const rows = await page.$$eval('.row', (els) => els.length);
    check('渲染 20 条时间线', rows === 20, '实际 ' + rows);
    check('首屏统计显示 20 件', (await page.$eval('#heroStats', (e) => e.textContent)).includes('20'));
    const compareRows = await page.$$eval('#compareBody .compare-row', (e) => e.length);
    check('陶 / 瓷对照表 5 行', compareRows === 5, '实际 ' + compareRows);
    const railCount = await page.$$eval('#railList a', (e) => e.length);
    check('时代导航 20 个入口', railCount === 20, '实际 ' + railCount);

    /* ---------------------------------------------------------- 三栏布局 */
    const cols = await page.$eval('#c-xianrendong', (row) => {
      const r = (sel) => Math.round(row.querySelector(sel).getBoundingClientRect().width);
      return { era: r('.col-era'), media: r('.col-media'), text: r('.col-text') };
    });
    check('桌面三栏：年代 < 实物图 < 点评', cols.era < cols.media && cols.media < cols.text, JSON.stringify(cols));

    /* ---------------------------------------------------------- 图片 */
    const imgs = await page.$$eval('#timelineList img', (els) =>
      els.map((i) => ({ w: i.naturalWidth, src: i.getAttribute('src') }))
    );
    check('全部实物图加载成功（' + imgs.length + ' 张）', imgs.every((i) => i.w > 0), imgs.filter((i) => !i.w).map((i) => i.src).join(','));
    const captions = await page.$$eval('#timelineList figcaption', (els) => els.map((e) => e.textContent));
    check('每张图都有作者 / 许可署名', captions.every((t) => /CC|Public domain/i.test(t) && t.length > 8), captions.filter((t) => !/CC|Public domain/i.test(t)).join('|'));
    const commonsLinks = await page.$$eval('#timelineList figcaption a', (els) => els.filter((a) => /commons\.wikimedia\.org/.test(a.href)).length);
    check('署名里有 Commons 原链', commonsLinks >= 20, '实际 ' + commonsLinks);

    /* ---------------------------------------------------------- 导航 */
    await page.evaluate(() => {
      document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
      window.scrollTo(0, 0);
    });
    await page.waitForFunction(() => window.scrollY === 0, { timeout: 5000 });
    await sleep(200);
    await page.evaluate(() => document.querySelector('#railList a[data-rail="ru"]').click());
    await page.waitForFunction(() => {
      const r = document.getElementById('c-ru').getBoundingClientRect();
      return Math.abs(r.top) < 320;
    }, { timeout: 8000 }).catch(() => {});
    await sleep(300);
    const navOk = await page.evaluate(() => {
      const row = document.getElementById('c-ru');
      const r = row.getBoundingClientRect();
      return { hash: location.hash, top: Math.round(r.top) };
    });
    check('点时代导航定位到汝窑', navOk.hash === '#c-ru' && Math.abs(navOk.top) < 300, JSON.stringify(navOk));

    /* ---------------------------------------------------------- 灯箱 */
    await page.evaluate(() => document.querySelector('#c-ru [data-open]').click());
    await sleep(500);
    check('点图片打开灯箱', (await page.$eval('#lightbox', (e) => e.hidden)) === false);
    const lbTitle = await page.$eval('#lbTitle', (e) => e.textContent);
    check('灯箱标题是当前器物', /天青釉洗/.test(lbTitle), lbTitle);
    const lbBox = await page.evaluate(() => {
      const rect = (sel) => {
        const b = document.querySelector(sel).getBoundingClientRect();
        return { w: Math.round(b.width), h: Math.round(b.height), top: Math.round(b.top), bottom: Math.round(b.bottom) };
      };
      return {
        img: rect('#lbImg'),
        cap: rect('.lb-figure figcaption'),
        vw: window.innerWidth,
        vh: window.innerHeight,
        bg: getComputedStyle(document.getElementById('lightbox')).backgroundColor,
      };
    });
    check(
      '灯箱大图铺满可用区域（不是缩在小角落）',
      lbBox.img.w > lbBox.vw * 0.55 && lbBox.img.h > lbBox.vh * 0.45,
      JSON.stringify(lbBox.img)
    );
    check('大图与图注都完整落在视口内', lbBox.img.top >= 0 && lbBox.cap.bottom <= lbBox.vh && lbBox.cap.top >= lbBox.img.bottom, JSON.stringify(lbBox));
    check('灯箱背景不透明（不露页面文字）', lbBox.bg === 'rgb(8, 6, 5)', lbBox.bg);
    check('灯箱有署名与许可', /CC|Public domain/i.test(await page.$eval('#lbCredit', (e) => e.textContent)));
    const lbCount1 = await page.$eval('#lbCount', (e) => e.textContent.trim());
    check('灯箱计数形如 n / 22', /^\d+ \/ 22$/.test(lbCount1), lbCount1);
    await page.keyboard.press('ArrowRight');
    await sleep(350);
    const lbCount2 = await page.$eval('#lbCount', (e) => e.textContent.trim());
    check('→ 切到下一张', lbCount2 !== lbCount1 && /^\d+ \/ 22$/.test(lbCount2), lbCount1 + ' → ' + lbCount2);
    await page.keyboard.press('Escape');
    await sleep(250);
    check('Esc 关闭灯箱', (await page.$eval('#lightbox', (e) => e.hidden)) === true);

    /* 放大 / 拖动 */
    await page.evaluate(() => document.querySelector('#c-ru [data-open]').click());
    await sleep(400);
    await page.click('#lbImg');
    await sleep(300);
    const zoomed = await page.evaluate(() => ({
      cls: document.getElementById('lbStage').classList.contains('zoomed'),
      tf: document.getElementById('lbImg').style.transform,
    }));
    check('点击图片放大（scale > 2）', zoomed.cls && /scale\(2\.2\)/.test(zoomed.tf), JSON.stringify(zoomed));
    await page.keyboard.press('Escape');
    await sleep(200);

    /* ---------------------------------------------------------- 补充图 */
    const thumbs = await page.$$eval('#c-modern .thumb', (e) => e.length);
    check('现代工业陶瓷有 2 张补充图', thumbs === 2, '实际 ' + thumbs);
    if (thumbs) {
      await page.evaluate(() => document.querySelectorAll('#c-modern .thumb')[1].click());
      await sleep(400);
      const t = await page.$eval('#lbTitle', (e) => e.textContent);
      check('补充图能在灯箱打开（MLCC）', /MLCC/.test(t), t);
      await page.keyboard.press('Escape');
      await sleep(200);
    }

    /* ---------------------------------------------------------- 背景音乐 */
    const offline = await page.evaluate(async () => {
      const Ctx = function () { return new OfflineAudioContext(2, 44100 * 4, 44100); };
      const eng = window.POTTERY_AUDIO.createEngine({ audioContext: Ctx });
      if (!eng) return null;
      eng.setVolume(100);
      eng.start();
      const buf = await eng.getContext().startRendering();
      const d = buf.getChannelData(0);
      let sum = 0;
      let peak = 0;
      for (let i = 0; i < d.length; i++) {
        const v = Math.abs(d[i]);
        sum += v * v;
        if (v > peak) peak = v;
      }
      eng.dispose();
      return { rms: Math.sqrt(sum / d.length), peak, len: d.length };
    });
    check(
      '离线渲染：合成的声音不是静音，也没削波',
      !!offline && offline.rms > 0.002 && offline.peak < 1 && offline.len > 0,
      JSON.stringify(offline)
    );
    check('音乐按钮存在且默认未播放', (await page.$eval('#musicBtn', (e) => e.getAttribute('aria-pressed'))) === 'false');
    await page.click('#musicBtn');
    await sleep(900);
    const music1 = await page.evaluate(() => {
      const eng = window.POTTERY_AUDIO.getLastEngine();
      return {
        pressed: document.getElementById('musicBtn').getAttribute('aria-pressed'),
        playing: !!(eng && eng.isPlaying()),
        ctx: eng ? eng.contextState() : '',
        nodes: eng ? eng.nodeCount() : 0,
      };
    });
    check('点击后开始播放（AudioContext running）', music1.pressed === 'true' && music1.playing && music1.ctx === 'running', JSON.stringify(music1));
    check('合成图建了足够多的音频节点', music1.nodes > 10, String(music1.nodes));

    await page.click('#musicMore');
    await sleep(300);
    check('音量面板可打开', (await page.$eval('#musicPop', (e) => e.hidden)) === false);
    await page.evaluate(() => {
      const v = document.getElementById('musicVol');
      v.value = '20';
      v.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(250);
    const music2 = await page.evaluate(() => ({
      out: document.getElementById('musicVolOut').textContent,
      stored: JSON.parse(localStorage.getItem('pottery.audio.v1') || '{}').volume,
      engineVol: window.POTTERY_AUDIO.getLastEngine().getVolume(),
    }));
    check('音量滑块生效并写入 localStorage', music2.out === '20%' && music2.stored === 20 && music2.engineVol === 20, JSON.stringify(music2));
    await page.click('#musicHintClose');
    await sleep(200);
    check('「知道了」收起音量面板', (await page.$eval('#musicPop', (e) => e.hidden)) === true);

    await page.click('#musicBtn');
    await sleep(700);
    const music3 = await page.evaluate(() => ({
      pressed: document.getElementById('musicBtn').getAttribute('aria-pressed'),
      playing: window.POTTERY_AUDIO.getLastEngine().isPlaying(),
    }));
    check('再次点击暂停', music3.pressed === 'false' && music3.playing === false, JSON.stringify(music3));

    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(600);
    check('刷新后保留音量（20%）', (await page.$eval('#musicVol', (e) => e.value)) === '20');
    check('刷新后默认仍是暂停（不自动出声）', (await page.$eval('#musicBtn', (e) => e.getAttribute('aria-pressed'))) === 'false');

    /* 上次开着音乐：首次触摸页面后续播 */
    await page.evaluate(() => localStorage.setItem('pottery.audio.v1', JSON.stringify({ enabled: true, volume: 30, hintSeen: true })));
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(600);
    check('上次开着 → 按钮显示「继续」', (await page.$eval('#musicBtn .music-label', (e) => e.textContent)) === '继续');
    await page.mouse.click(1300, 300);
    await sleep(1000);
    const resumed = await page.evaluate(() => ({
      pressed: document.getElementById('musicBtn').getAttribute('aria-pressed'),
      playing: window.POTTERY_AUDIO.getLastEngine() ? window.POTTERY_AUDIO.getLastEngine().isPlaying() : false,
    }));
    check('首次点击页面后自动续播', resumed.pressed === 'true' && resumed.playing === true, JSON.stringify(resumed));
    await page.click('#musicBtn');
    await sleep(500);

    /* ---------------------------------------------------------- 截图（浅色） */
    await page.evaluate(() => {
      document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
      window.scrollTo(0, 0);
    });
    await page.waitForFunction(() => window.scrollY === 0, { timeout: 5000 });
    await sleep(200);
    await page.screenshot({ path: path.join(SHOTS, '01-hero.png') });
    await page.evaluate(() => document.getElementById('c-yuan-qinghua').scrollIntoView({ block: 'center' }));
    await sleep(500);
    await page.screenshot({ path: path.join(SHOTS, '02-timeline.png') });
    await page.evaluate(() => document.querySelector('#c-yuan-qinghua [data-open]').click());
    await sleep(600);
    await page.screenshot({ path: path.join(SHOTS, '03-lightbox.png') });
    await page.keyboard.press('Escape');

    /* ---------------------------------------------------------- 深色 */
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await sleep(300);
    const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check('深色模式生效', /rgb\((1[0-9]|2[0-9]|3[0-9]),/.test(darkBg) || darkBg === 'rgb(23, 20, 15)', darkBg);
    await page.evaluate(() => document.getElementById('c-mise').scrollIntoView({ block: 'center' }));
    await sleep(400);
    await page.screenshot({ path: path.join(SHOTS, '04-dark.png') });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

    /* ---------------------------------------------------------- 移动端 */
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(800);
    const mobile = await page.evaluate(() => {
      const row = document.getElementById('c-ru');
      const rect = (sel) => row.querySelector(sel).getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        stacked: rect('.col-text').top > rect('.col-media').top && rect('.col-media').top > rect('.col-era').bottom - 8,
        imgW: Math.round(rect('.col-media').width),
      };
    });
    check('移动端无横向溢出', mobile.overflow <= 1, '溢出 ' + mobile.overflow + 'px');
    check('移动端改为单列堆叠', mobile.stacked, JSON.stringify(mobile));
    await page.evaluate(() => document.getElementById('c-ru').scrollIntoView({ block: 'start' }));
    await sleep(500);
    await page.screenshot({ path: path.join(SHOTS, '05-mobile.png') });

    await page.evaluate(() => document.querySelector('#c-ru [data-open]').click());
    await sleep(500);
    const mobileLb = await page.evaluate(() => {
      const b = document.getElementById('lbImg').getBoundingClientRect();
      const c = document.querySelector('.lb-figure figcaption').getBoundingClientRect();
      return { w: Math.round(b.width), h: Math.round(b.height), top: Math.round(b.top), bottom: Math.round(b.bottom), capBottom: Math.round(c.bottom), vw: innerWidth, vh: innerHeight };
    });
    check('移动端灯箱图铺满宽度（横图按比例）', mobileLb.w > mobileLb.vw * 0.7 && mobileLb.h > 120, JSON.stringify(mobileLb));
    check('移动端图注不溢出屏幕', mobileLb.capBottom <= mobileLb.vh && mobileLb.top >= 0, JSON.stringify(mobileLb));
    await page.screenshot({ path: path.join(SHOTS, '05b-mobile-lightbox.png') });
    await page.keyboard.press('Escape');
    await sleep(300);

    /* ---------------------------------------------------------- AI 离线 */
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    const blocker = (req) => {
      if (req.url().includes(':8383')) req.abort();
      else req.continue();
    };
    page.on('request', blocker);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(600);
    check('a2 不可用时状态显示离线', (await page.$eval('#aiStatus', (e) => e.dataset.state)) === 'offline');
    await page.click('#aiFab');
    await sleep(400);
    await page.evaluate(() => {
      document.getElementById('aiQuery').value = '汝窑为什么难烧？';
      document.getElementById('aiSubmit').click();
    });
    await page.waitForFunction(() => !!document.querySelector('.ai-error'), { timeout: 20000 });
    const errText = await page.$eval('.ai-error', (e) => e.textContent);
    check('离线时给出可复制的启动指引', errText.includes('tea_agent --port 8383'));
    check('离线不打断本地页面（20 条仍在）', (await page.$$eval('.row', (e) => e.length)) === 20);
    await page.screenshot({ path: path.join(SHOTS, '06-ai-offline.png') });

    /* ------------------------------------------- AI 请求体 / 渲染（打桩，不联网） */
    const captured = [];
    page.off('request', blocker);
    const stub = (req) => {
      if (req.url().includes('/api/llm/chat')) {
        const cors = {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'content-type',
        };
        if (req.method() === 'OPTIONS') {
          req.respond({ status: 204, headers: cors });
          return;
        }
        try { captured.push(JSON.parse(req.postData() || '{}')); } catch (e) { captured.push({}); }
        req.respond({
          status: 200,
          contentType: 'application/json',
          headers: cors,
          body: JSON.stringify({
            content: '第一点：天青釉对还原气氛极敏感。\n\n- 釉中微量铁\n- 窑温窗口很窄\n\n来源：https://example.org/ru',
            provider: 'deepseek',
            model: 'deepseek-flash',
            elapsed_ms: 1200,
            web_tool_calls: [
              { ok: true, output: '1 result(s) for: 汝窑\n\n[1] 汝窑 - 故宫\n    url: https://example.org/ru\n    score: 2.1\n    authority: 5\n    summary: 汝窑为北宋宫廷烧造。' },
            ],
          }),
        });
        return;
      }
      if (req.url().includes(':8383')) req.abort();
      else req.continue();
    };
    page.on('request', stub);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(500);
    await page.evaluate(() => document.querySelector('#c-ru [data-ask]').click());
    await sleep(300);
    const prefilled = await page.$eval('#aiQuery', (e) => e.value);
    check('行内「问 AI」会带入该条目的问题', /汝窑/.test(prefilled), prefilled);
    await page.evaluate(() => document.getElementById('aiSubmit').click());
    await page.waitForSelector('.ai-answer', { timeout: 15000 });
    const stubAns = await page.evaluate(() => ({
      text: document.querySelector('.ai-answer').innerText,
      meta: document.getElementById('aiMeta').textContent,
      sources: document.querySelectorAll('.ai-sources li a').length,
      href: document.querySelector('.ai-sources li a') ? document.querySelector('.ai-sources li a').href : '',
    }));
    const body = captured[0] || {};
    check('请求体带当前器物上下文', /天青釉洗/.test(body.prompt || '') && /约 1086—1106 年/.test(body.prompt || ''), (body.prompt || '').slice(0, 80));
    check('请求体用 deepseek + web_tools', body.provider === 'deepseek' && body.web_tools === true, JSON.stringify({ p: body.provider, w: body.web_tools }));
    check('正文按段落/列表渲染', stubAns.text.includes('第一点') && /釉中微量铁/.test(stubAns.text));
    check('来源链接被渲染（去重后 1 条）', stubAns.sources === 1 && stubAns.href.includes('example.org'), stubAns.href);
    check('显示耗时与模型', /deepseek/.test(stubAns.meta) && /1\.[0-9] s/.test(stubAns.meta), stubAns.meta);
    await page.screenshot({ path: path.join(SHOTS, '06b-ai-stub.png') });
    page.off('request', stub);
    await page.setRequestInterception(false);

    /* ---------------------------------------------------------- AI 在线 */
    if (WANT_ONLINE) {
      await page.reload({ waitUntil: 'networkidle2' });
      await sleep(1200);
      const st = await page.$eval('#aiStatus', (e) => e.dataset.state);
      if (st !== 'online') {
        console.log('  · 跳过真实联网：a2 未连接（' + st + '）');
      } else {
        await page.click('#aiFab');
        await sleep(300);
        await page.evaluate(() => {
          const b = Array.prototype.find.call(document.querySelectorAll('#aiPresets button'), (x) => x.dataset.preset === 'ru');
          b.click();
        });
        await page.waitForFunction(
          () => document.querySelector('.ai-answer') || document.querySelector('.ai-error'),
          { timeout: 150000 }
        );
        const ans = await page.evaluate(() => ({
          err: !!document.querySelector('.ai-error'),
          text: document.querySelector('.ai-answer') ? document.querySelector('.ai-answer').innerText : '',
          meta: document.getElementById('aiMeta').textContent,
          sources: document.querySelectorAll('.ai-sources li').length,
        }));
        check('在线提问返回答案（> 80 字）', !ans.err && ans.text.length > 80, ans.err ? '返回错误' : ans.text.slice(0, 60));
        check('答案标注「未经审核」', /未经审核/.test(ans.text));
        check('显示 provider / model', /deepseek/.test(ans.meta), ans.meta);
        check('联网结果有来源区块', ans.sources >= 0);
        await page.screenshot({ path: path.join(SHOTS, '07-ai-online.png') });
      }
    }

    /* ---------------------------------------------------------- 控制台 */
    check('全程无 JS 异常', errors.length === 0, errors.slice(0, 3).join(' || '));
  } finally {
    await browser.close();
    server.close();
  }

  const passed = checks.filter((c) => c.ok).length;
  console.log('\n' + passed + '/' + checks.length + ' 项通过');
  if (passed !== checks.length) {
    console.log('失败项：');
    checks.filter((c) => !c.ok).forEach((c) => console.log('  · ' + c.name));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
