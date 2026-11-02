/**
 * 无头验证：启动构建产物里的 IPTV 页面，跑一遍「加载 → 搜索 → 播放 → 源管理」流程并截图。
 *
 *   node iptv-player/tools/shot.mjs            用 dist/ 产物
 *   node iptv-player/tools/shot.mjs --dev      起 vite dev server 再测
 */

import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from './proxy.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../dist');
const OUT = path.join(HERE, 'shots');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const USE_DEV = process.argv.includes('--dev');

let server;
let baseUrl;

if (USE_DEV) {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { port: 5199, host: '127.0.0.1' } });
  await vite.listen();
  baseUrl = 'http://127.0.0.1:5199';
} else {
  server = createStaticServer(ROOT);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-gpu',
    '--autoplay-policy=no-user-gesture-required',
    '--window-size=1600,1000',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => {
  const u = r.url();
  if (u.startsWith('data:')) return;
  logs.push(`[reqfail] ${r.failure()?.errorText} ${u.slice(0, 120)}`);
});

const report = { steps: [], errors: [] };

function step(name, data) {
  report.steps.push({ name, ...data });
  console.log(`• ${name}`, JSON.stringify(data));
}

await page.goto(`${baseUrl}/iptv-player/index.html`, { waitUntil: 'load', timeout: 60000 });

// 1) 等频道加载完成
try {
  await page.waitForFunction('window.__iptv && window.__iptv.state.channels.length > 0', { timeout: 90000 });
} catch {
  report.errors.push('频道列表未在 90s 内加载出来');
}
const loaded = await page.evaluate(() => ({
  channels: window.__iptv?.state.channels.length ?? 0,
  sources: window.__iptv?.state.sources.length ?? 0,
  enabled: window.__iptv?.state.enabled.size ?? 0,
  entries: [...(window.__iptv?.state.sourceEntries.values() || [])].map((v) => v.length),
  status: document.querySelector('#status-text')?.textContent,
}));
step('频道加载', loaded);
await page.screenshot({ path: path.join(OUT, '01-list.png'), fullPage: false });

// 2) 搜索
await page.type('#search', 'CCTV');
await new Promise((r) => setTimeout(r, 400));
const searched = await page.evaluate(() => ({
  visible: document.querySelectorAll('#channels .ch').length,
  count: window.__iptv.filteredChannels().length,
  title: document.querySelector('#channel-title')?.textContent,
}));
step('搜索 CCTV', searched);
await page.screenshot({ path: path.join(OUT, '02-search.png') });
await page.evaluate(() => {
  document.querySelector('#search').value = '';
  document.querySelector('#search').dispatchEvent(new Event('input'));
});

// 3) 播放第一个频道
const clicked = await page.evaluate(() => {
  const first = document.querySelector('#channels .ch');
  if (!first) return null;
  const name = first.querySelector('.ch-name')?.textContent;
  first.click();
  return name;
});
await new Promise((r) => setTimeout(r, 8000));
const playing = await page.evaluate(() => {
  const v = document.querySelector('#video');
  return {
    title: document.querySelector('#now-title')?.textContent,
    badge: document.querySelector('#player-badge')?.textContent,
    readyState: v?.readyState,
    networkState: v?.networkState,
    currentTime: Number(v?.currentTime?.toFixed(2)),
    paused: v?.paused,
    error: v?.error ? `${v.error.code}:${v.error.message}` : null,
    videoWidth: v?.videoWidth,
    videoHeight: v?.videoHeight,
    mode: window.__iptv?.state?.playing ? 'has-playing' : 'none',
  };
});
step('播放第一个频道', { clicked, ...playing });
await page.screenshot({ path: path.join(OUT, '03-playing.png') });

// 3b) 用内置测试流验证播放链路（hls.js → 分片 → 解码）
await page.evaluate(() =>
  window.__iptv.playChannel({
    key: 'test:stream',
    name: '测试流（Mux 官方样例）',
    url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    logo: '',
    group: '测试',
    country: '',
    alts: [],
  })
);
await new Promise((r) => setTimeout(r, 12000));
const testStream = await page.evaluate(() => {
  const v = document.querySelector('#video');
  return {
    title: document.querySelector('#now-title')?.textContent,
    badge: document.querySelector('#player-badge')?.textContent,
    readyState: v?.readyState,
    currentTime: Number(v?.currentTime?.toFixed(2)),
    videoWidth: v?.videoWidth,
    videoHeight: v?.videoHeight,
    paused: v?.paused,
    error: v?.error ? `${v.error.code}` : null,
  };
});
step('播放测试流', testStream);
if (!(testStream.videoWidth > 0 && testStream.currentTime > 0)) {
  report.errors.push('测试流未能正常播放（videoWidth/currentTime 为 0）');
}
await page.screenshot({ path: path.join(OUT, '03b-test-stream.png') });


// 3d) 试播几个真实频道（记录哪些能播）
const realResults = [];
for (const name of ['CCTV-1', 'CGTN', 'BBC', 'NASA']) {
  const ok = await page.evaluate((n) => {
    const list = window.__iptv.filteredChannels();
    const hit = list.find((c) => c.name.toLowerCase().includes(n.toLowerCase()));
    if (!hit) return { name: n, found: false };
    window.__iptv.playChannel(hit);
    return { name: n, found: true, title: hit.name, group: hit.group };
  }, name);
  await new Promise((r) => setTimeout(r, 12000));
  let st = await page.evaluate(() => {
    const v = document.querySelector('#video');
    return {
      readyState: v?.readyState,
      currentTime: Number(v?.currentTime?.toFixed(2)),
      videoWidth: v?.videoWidth,
      badge: document.querySelector('#player-badge')?.textContent,
    };
  });
  // 首片可能 404（直播切片会过期），再给 10s 重试
  if (!(st.videoWidth > 0 && st.currentTime > 0)) {
    await new Promise((r) => setTimeout(r, 10000));
    st = await page.evaluate(() => {
      const v = document.querySelector('#video');
      return {
        readyState: v?.readyState,
        currentTime: Number(v?.currentTime?.toFixed(2)),
        videoWidth: v?.videoWidth,
        badge: document.querySelector('#player-badge')?.textContent,
      };
    });
  }
  realResults.push({ ...ok, ...st, played: st.videoWidth > 0 && st.currentTime > 0 });
}
step('真实频道试播', realResults);
await page.evaluate(() => window.__iptv.stop());
await new Promise((r) => setTimeout(r, 500));
// 3c) 代理自检：经代理拉一份真实清单
const proxyCheck = await page.evaluate(async () => {
  const prefix = window.__iptv.getStreamProxy();
  if (!prefix) return { proxy: false };
  const url = 'https://iptv-org.github.io/iptv/countries/cn.m3u';
  const res = await fetch(window.__iptv.withProxy(url));
  const text = await res.text();
  return {
    proxy: true,
    status: res.status,
    isM3U: text.includes('#EXTM3U'),
    bytes: text.length,
  };
});
step('本地流代理自检', proxyCheck);
if (proxyCheck.proxy && !proxyCheck.isM3U) report.errors.push('代理拉取播放列表失败');

// 4) 源管理抽屉
await page.evaluate(() => document.querySelector('#btn-sources').click());
await new Promise((r) => setTimeout(r, 500));
const drawer = await page.evaluate(() => ({
  open: !document.querySelector('#drawer')?.hidden,
  title: document.querySelector('#drawer-title')?.textContent,
  groups: document.querySelectorAll('#drawer-body .src-group').length,
  items: document.querySelectorAll('#drawer-body .src-item').length,
}));
step('源管理抽屉', drawer);
await page.screenshot({ path: path.join(OUT, '04-sources.png') });
await page.evaluate(() => document.querySelector('#btn-drawer-close').click());

// 5) 再点一次更新 → 应走条件请求（无变化）
await page.evaluate(() => document.querySelector('#btn-update').click());
await page.waitForFunction('window.__iptv.state.updating === false', { timeout: 60000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 1500));
const second = await page.evaluate(() => ({
  toast: [...document.querySelectorAll('.toast')].map((t) => t.textContent),
  status: document.querySelector('#status-text')?.textContent,
}));
step('二次更新（条件请求）', second);

// 6) 体检（先停播，释放浏览器到本源的连接）
await page.evaluate(() => window.__iptv.stop());
await new Promise((r) => setTimeout(r, 800));
await page.evaluate(() => document.querySelector('#btn-health').click());
await page
  .waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('体检完成')), { timeout: 120000 })
  .catch(() => report.errors.push('体检未在 120s 内完成'));
const health = await page.evaluate(() => ({
  dots: [...document.querySelectorAll('.ch-dot')].reduce((acc, d) => {
    acc[d.className.replace('ch-dot ', '')] = (acc[d.className.replace('ch-dot ', '')] || 0) + 1;
    return acc;
  }, {}),
}));
step('频道体检', health);
await page.screenshot({ path: path.join(OUT, '05-health.png') });

// 只把「应用自身」的报错算作错误：第三方台标图片 404/ORB 不算
// 7) 收藏 + 视图切换
await page.evaluate(() => {
  const c = document.querySelector('#channels .ch');
  if (c) c.click();
});
await new Promise((r) => setTimeout(r, 1500));
await page.evaluate(() => document.querySelector('#btn-fav').click());
await page.evaluate(() => document.querySelector('[data-view="fav"]').click());
await new Promise((r) => setTimeout(r, 400));
const fav = await page.evaluate(() => ({
  favorites: JSON.parse(localStorage.getItem('iptv-player.favorites') || '[]').length,
  cards: document.querySelectorAll('#channels .ch').length,
  title: document.querySelector('#channel-title')?.textContent,
}));
step('收藏 + 收藏视图', fav);
await page.evaluate(() => document.querySelector('[data-view="all"]').click());

// 8) 设置抽屉
await page.evaluate(() => document.querySelector('#btn-settings').click());
await new Promise((r) => setTimeout(r, 300));
const settings = await page.evaluate(() => ({
  open: !document.querySelector('#drawer')?.hidden,
  title: document.querySelector('#drawer-title')?.textContent,
  fields: document.querySelectorAll('#drawer-body .field').length,
  toggles: document.querySelectorAll('#drawer-body input[type=checkbox]').length,
}));
step('设置抽屉', settings);
await page.screenshot({ path: path.join(OUT, '06-settings.png') });
await page.evaluate(() => document.querySelector('#btn-drawer-close').click());

// 9) GitHub 最新提交检测
await page.evaluate(() => document.querySelector('#btn-sources').click());
await new Promise((r) => setTimeout(r, 300));
await page.evaluate(() => {
  const g = document.querySelector('#drawer-body .src-group');
  if (g) g.open = true;
});
await page.evaluate(() => {
  const b = [...document.querySelectorAll('#drawer-body .src-item button')].find((x) => x.textContent.includes('🐙'));
  if (b) b.click();
});
await new Promise((r) => setTimeout(r, 4000));
const gh = await page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent.replace(/\n/g, ' | ')));
step('GitHub 最新提交检测', gh);

// 10) 添加自定义源
await page.evaluate(() => {
  const inputs = document.querySelectorAll('#drawer-body .field input');
  inputs[0].value = '澳门台';
  inputs[1].value = 'https://iptv-org.github.io/iptv/countries/mo.m3u';
  const add = [...document.querySelectorAll('#drawer-body button')].find((b) => b.textContent.trim() === '添加');
  if (add) add.click();
});
await new Promise((r) => setTimeout(r, 6000));
const custom = await page.evaluate(() => ({
  custom: JSON.parse(localStorage.getItem('iptv-player.sources') || '[]').length,
  enabled: window.__iptv.state.enabled.size,
  channels: window.__iptv.state.channels.length,
  hasMo: window.__iptv.filteredChannels().some((c) => c.country === 'mo'),
}));
step('添加自定义源', custom);
await page.screenshot({ path: path.join(OUT, '07-custom-source.png') });

const consoleErrors = logs.filter(
  (l) => l.startsWith('[pageerror]') || (l.startsWith('[error]') && !/Failed to load resource/.test(l))
);
report.errors.push(...consoleErrors);
report.logs = logs.slice(-40);

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log('\n--- console (末 40 条) ---');
console.log(report.logs.join('\n'));
console.log('\n错误数：', report.errors.length);

await browser.close();
if (server) server.close();
process.exit(report.errors.length ? 1 : 0);
