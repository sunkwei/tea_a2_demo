/**
 * 中药大全 · 无头 Edge 端到端验证（file:// 真实场景）
 *
 * 用法：
 *   node tcm-herb/tools/verify.mjs            # 本地功能 + 离线降级路径
 *   node tcm-herb/tools/verify.mjs --online   # 额外跑一次真实联网（需要本机 a2 在 8383）
 *
 * 依赖：puppeteer-core（仓库已有）+ 本机 Edge。
 * 截图输出：tcm-herb/tools/shots/（已 gitignore）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SHOTS = path.join(HERE, 'shots');
const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const WANT_ONLINE = process.argv.includes('--online');

const checks = [];
function check(name, ok, extra) {
  checks.push({ name, ok: !!ok, extra: extra == null ? '' : String(extra) });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra != null && !ok ? '  → ' + extra : ''));
}

function fileUrl(p) {
  return pathToFileURL(p).href;
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  if (!fs.existsSync(EDGE)) {
    console.error('找不到 Edge：' + EDGE + '\n可用 EDGE_PATH 环境变量指定。');
    process.exit(2);
  }

  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    args: ['--allow-file-access-from-files', '--no-first-run', '--disable-extensions', '--hide-scrollbars'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });

  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const t = msg.text();
      // 图片/资源 404 由 onerror 兜底，不算致命；其余 console.error 记下来
      if (!/Failed to load resource/i.test(t)) errors.push('console: ' + t);
    }
  });

  const PAGE = process.argv.includes('--single') ? path.join(ROOT, 'tcm-herb.html') : path.join(ROOT, 'index.html');
  const url = fileUrl(PAGE);
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('.herb-card', { timeout: 10000 });

  /* ---------------------------------------------------------------- 首屏 */
  check('file:// 打开成功，标题正确', (await page.title()).includes('中药大全'));

  const cards = await page.$$eval('.herb-card', (els) => els.length);
  check('图鉴渲染 86 味药材', cards === 86, '实际 ' + cards);

  const firstImgOk = await page.$eval('.herb-card img', (img) => img.complete && img.naturalWidth > 0);
  check('首屏药材图片可显示（非破图）', firstImgOk);

  check('页脚免责声明存在', /不构成诊疗建议/.test(await page.$eval('.footer', (el) => el.textContent)));

  check('老年常见入口存在', (await page.$$eval('[data-go="tab"][data-ref="symptoms"]', (e) => e.length)) > 0);

  await page.screenshot({ path: path.join(SHOTS, '01-herbs.png'), fullPage: false });

  /* ------------------------------------------------------------ 药材详情 */
  await page.evaluate(() => {
    const card = Array.from(document.querySelectorAll('.herb-card')).find((c) => c.textContent.includes('甘草'));
    card.click();
  });
  await page.waitForSelector('.detail-hero', { timeout: 5000 });
  const herbText = await page.$eval('#view', (el) => el.textContent);
  check('甘草详情：简介/功效/属性齐全', /补脾益气/.test(herbText) && /归经/.test(herbText) && /性味/.test(herbText));
  check('甘草详情：有图片来源署名', /Wikimedia|示意图/.test(await page.$eval('.credit', (el) => el.textContent)));
  const detailImgOk = await page.$eval('.detail-hero img', (img) => img.complete && img.naturalWidth > 0);
  check('详情图片加载成功', detailImgOk);
  await page.screenshot({ path: path.join(SHOTS, '02-herb-detail.png'), fullPage: false });

  /* ------------------------------------------------------------ 拼音搜索 */
  await page.click('.tab[data-tab="herbs"]');
  await page.waitForSelector('#q');
  await page.type('#q', 'gc');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => location.hash.startsWith('#/search/'), { timeout: 5000 });
  await page.waitForSelector('.herb-card', { timeout: 5000 });
  const gcNames = await page.$$eval('.herb-card .nm', (els) => els.map((e) => e.textContent));
  check('拼音首字母 gc → 命中甘草', gcNames.includes('甘草'), gcNames.join(','));

  /* ------------------------------------------------------------ 病症搜索 */
  await page.evaluate(() => { document.getElementById('q').value = ''; });
  await page.type('#q', '咳嗽');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#view').textContent.includes('「咳嗽」'), { timeout: 5000 });
  const secTitles = await page.$$eval('.section-head h2', (els) => els.map((e) => e.textContent));
  check('「咳嗽」结果分三段（药材/病症/方剂）',
    secTitles.includes('药材') && secTitles.includes('病症') && secTitles.includes('方剂'), secTitles.join('|'));
  await page.screenshot({ path: path.join(SHOTS, '03-search.png'), fullPage: false });

  /* ------------------------------------------------------ 老年病种与警示 */
  await page.goto(url + '#/symptom/pa-jin-sen-bing', { waitUntil: 'load' });
  await page.waitForSelector('.sym-head', { timeout: 8000 });
  const parkText = await page.$eval('#view', (el) => el.textContent);
  check('帕金森病：有就医警示', /就医提示/.test(parkText) && /不能替代/.test(parkText));
  check('帕金森病：列出药材与验方', /天麻/.test(parkText) && /天麻钩藤饮/.test(parkText));
  check('帕金森病：有常用搭配', /常用搭配/.test(parkText));
  await page.screenshot({ path: path.join(SHOTS, '04-elderly-symptom.png'), fullPage: false });

  /* -------------------------------------------------------------- 方剂 */
  await page.goto(url + '#/formula/gui-zhi-tang', { waitUntil: 'load' });
  await page.waitForSelector('.sym-head', { timeout: 8000 });
  const fText = await page.$eval('#view', (el) => el.textContent);
  check('桂枝汤：出处与组成角色齐全', /伤寒论/.test(fText) && /君/.test(fText) && /炙甘草/.test(fText));
  check('桂枝汤：明确不含剂量与煎服法', !/克|g\b|煎服|水煎服/.test(fText.replace(/不提供剂量与煎服法/g, '')), '出现剂量词');
  const linked = await page.$$eval('.comp .link-pill', (els) => els.map((e) => e.textContent));
  check('组成药名可跳转（炙甘草→甘草已链接）', linked.length >= 3, linked.join(','));

  /* -------------------------------------------------------------- 历史 */
  const histChips = await page.$$eval('#history .chip', (els) => els.map((e) => e.textContent));
  check('查询历史已记录（含搜索词与详情）', histChips.length >= 2, histChips.join('|'));

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('.herb-card', { timeout: 8000 });
  const persisted = await page.$$eval('#history .chip .h-text', (els) => els.map((e) => e.textContent));
  check('刷新后历史仍在（localStorage）', persisted.length >= 2, persisted.join('|'));

  /* 点历史回详情 */
  await page.evaluate(() => {
    const chip = Array.from(document.querySelectorAll('#history .chip')).find((c) => c.textContent.includes('甘草'));
    if (chip) chip.click();
  });
  await page.waitForFunction(() => location.hash.startsWith('#/herb/'), { timeout: 5000 }).catch(() => {});
  check('点历史条目可直接回到详情', (await page.evaluate(() => location.hash)).startsWith('#/herb/'));

  /* 删除单条 + 清空 */
  const before = await page.$$eval('#history .chip', (e) => e.length);
  await page.evaluate(() => document.querySelector('#history .chip .h-del').click());
  const after = await page.$$eval('#history .chip', (e) => e.length);
  check('单条历史可删除', after === before - 1, before + '→' + after);

  /* -------------------------------------------------------------- 主题 */
  const themeBefore = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await page.click('#themeBtn');
  const themeAfter = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  check('深浅色可切换并落到 data-theme', themeBefore !== themeAfter, themeBefore + '→' + themeAfter);
  await page.screenshot({ path: path.join(SHOTS, '05-theme-' + themeAfter + '.png'), fullPage: false });
  await page.click('#themeBtn');

  /* ------------------------------------------------- 联网：不可用降级 */
  await page.setRequestInterception(true);
  const blocker = (req) => {
    if (req.url().includes('8383')) req.abort();
    else req.continue();
  };
  page.on('request', blocker);

  await page.goto(url + '#/search/甘草', { waitUntil: 'load' });
  await page.waitForSelector('[data-go="online"]', { timeout: 8000 });
  await page.evaluate(() => document.querySelector('[data-go="online"]').click());
  await page.waitForSelector('.boot-help', { timeout: 12000 });
  const bootText = await page.$eval('.boot-help', (el) => el.textContent);
  check('a2 不可用时给出启动指引', /tea_agent --port 8383/.test(bootText));
  check('降级不打断本地功能（结果仍在）', (await page.$$eval('.herb-card', (e) => e.length)) > 0);
  await page.screenshot({ path: path.join(SHOTS, '06-online-guide.png'), fullPage: false });

  page.off('request', blocker);
  await page.setRequestInterception(false);

  /* --------------------------------------------------------- 真实联网 */
  if (WANT_ONLINE) {
    const health = await page.evaluate(async () => {
      try {
        const r = await fetch('http://localhost:8383/api/health', { cache: 'no-store' });
        return r.ok;
      } catch (e) { return false; }
    });
    if (!health) {
      console.log('  · 跳过真实联网：本机 a2 未运行');
    } else {
      await page.goto(url + '#/search/甘草', { waitUntil: 'load' });
      await page.waitForSelector('[data-go="online"]', { timeout: 8000 });
      await page.evaluate(() => document.querySelector('[data-go="online"]').click());
      await page.waitForSelector('.online-result .llm, .online-result .notice', { timeout: 90000 });
      await page.waitForFunction(() => {
        const b = document.getElementById('onlineBody');
        return b && (b.querySelector('.llm') || b.textContent.includes('联网查询失败') || b.textContent.includes('超时'));
      }, { timeout: 90000 });
      const bodyText = await page.$eval('#onlineBody', (el) => el.textContent);
      const srcCount = await page.$$eval('.sources li', (e) => e.length);
      check('联网返回内容（非空）', bodyText.length > 40, bodyText.slice(0, 60));
      check('联网结果带来源列表', srcCount > 0, '来源 ' + srcCount + ' 条');
      check('联网结果标注「未经审核」', /未经审核/.test(bodyText));
      await page.screenshot({ path: path.join(SHOTS, '07-online-result.png'), fullPage: false });
    }
  }

  /* -------------------------------------------------------------- 收尾 */
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
