// 用**有头**浏览器打开网站登录页，等你登录完（把窗口关掉即可），把 storageState 存下来，
// 之后就能用无头方式做抓取/发布。
//
//   node sched/login_state.mjs --url https://www.zhihu.com/signin \
//        --out C:\Users\Hetin\Documents\pw_zhihu.json --cookie z_c0 --label zhihu
//
//   node sched/login_state.mjs --url https://passport.bilibili.com/login \
//        --out C:\Users\Hetin\Documents\pw_bilibili.json --cookie SESSDATA --label bili
//
// 可选参数：
//   --headless      不用有头窗口（没有图形界面时用；会自动把二维码截图出来）
//   --qr <png>      无头模式下二维码截到这里（默认 <out 同目录>/<label>_qr.png）
//   --timeout <秒>  等登录的最长时间，默认 600
//
// 说明：
//   * 必须用**干净的 context**：已登录的 context 打开登录页会直接跳走，根本没有二维码。
//   * playwright-core 不带浏览器，脚本自己找（也可以用 CHROME_BIN 指定）：
//     CHROME_BIN > playwright 自己下的 >
//     Windows: %LOCALAPPDATA%\ms-playwright\chromium-*\chrome-win64\chrome.exe
//     macOS:   ~/Library/Caches/ms-playwright/chromium-*/chrome-mac*/Chromium.app/...
//     Linux:   ~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome
//     其它：    系统装的 google-chrome / chromium / edge（/usr/bin/… 和 PATH）
//   * playwright-core 从这些地方找：PLAYWRIGHT_CORE_PATH 环境变量 → NODE_PATH →
//     当前目录/脚本同级的 node_modules。找不到就提示 `npm i playwright-core`。
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(import.meta.url);

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const has = (name) => process.argv.includes('--' + name);

const URL_ = arg('url');
const OUT = arg('out');
const COOKIE = arg('cookie');
const LABEL = arg('label', 'site');
const QR = arg('qr', OUT ? path.join(path.dirname(OUT), LABEL + '_qr.png') : null);
const TIMEOUT = Number(arg('timeout', 600));
const HEADLESS = has('headless');

if (!URL_ || !OUT || !COOKIE) {
  console.error('用法: node login_state.mjs --url <登录页> --out <storageState 路径> --cookie <cookie 名>');
  process.exit(2);
}

// ---- 找 playwright-core -------------------------------------------------
function loadPlaywright() {
  const here = path.dirname(new URL(import.meta.url).pathname);
  const tries = [
    process.env.PLAYWRIGHT_CORE_PATH,
    'playwright-core',                                    // NODE_PATH / 常规解析
    path.join(process.cwd(), 'node_modules', 'playwright-core'),
    path.join(here, 'node_modules', 'playwright-core'),
    path.join(here, '..', 'node_modules', 'playwright-core'),
    path.join(here, '..', '.tea_agent_run', 'node_modules', 'playwright-core'),
  ].filter(Boolean);
  for (const t of tries) {
    try { return require(t); } catch (e) { /* 试下一个 */ }
  }
  console.error('[login] 找不到 playwright-core。在仓库目录跑一次：npm i playwright-core');
  console.error('[login] （或者设 PLAYWRIGHT_CORE_PATH / NODE_PATH 指向已安装的目录）');
  process.exit(3);
}

// ---- 找浏览器 ------------------------------------------------------------
// 顺序：CHROME_BIN > playwright 自己下的（ms-playwright）> 系统装的常见路径 > PATH 里找。
function isFile(p) {
  try { return fs.existsSync(p) && fs.statSync(p).isFile(); } catch (e) { return false; }
}

function findOnPath(names) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const name of names) {
    for (const dir of dirs) {
      const full = path.join(dir, name);
      if (isFile(full)) return full;
    }
  }
  return null;
}

function findChrome() {
  if (process.env.CHROME_BIN && isFile(process.env.CHROME_BIN)) return process.env.CHROME_BIN;

  const roots = [];
  if (process.env.LOCALAPPDATA) roots.push(path.join(process.env.LOCALAPPDATA, 'ms-playwright'));
  roots.push(path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright'));
  roots.push(path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'));
  roots.push(path.join(os.homedir(), '.cache', 'ms-playwright'));
  const pats = [
    'chrome-win64/chrome.exe', 'chrome-win/chrome.exe',
    'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-mac-x64/Chromium.app/Contents/MacOS/Chromium',
    'chrome-linux64/chrome',
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const d of fs.readdirSync(root)) {
      for (const p of pats) {
        const full = path.join(root, d, p);
        if (isFile(full)) return full;
      }
    }
  }

  // 系统装的 Chrome / Chromium / Edge（发行版装法太多，干脆多试几个常见位置）
  const wellknown = [
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/snap/bin/chromium', '/opt/google/chrome/chrome',
    '/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable',
    '/usr/bin/brave-browser',
  ];
  for (const p of wellknown) if (isFile(p)) return p;

  // 最后翻 PATH
  return findOnPath([
    'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser',
    'microsoft-edge', 'brave-browser',
  ]);
}

const { chromium } = loadPlaywright();
const exe = findChrome();
console.log(`[login:${LABEL}] 浏览器: ${exe || '(没找到，见下面的提示)'}`);
console.log(`[login:${LABEL}] 登录页: ${URL_}`);

function launchOpts(headless) {
  return {
    executablePath: exe || undefined,
    headless,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  };
}

function noBrowser(e) {
  const first = String((e && e.message) || e).split('\n')[0];
  console.error(`[login] 浏览器起不来：${first}`);
  if (!exe) {
    console.error('[login] 没找到可用的浏览器。任选一种：');
    console.error('  1) 用系统装的 Chrome/Chromium：');
    console.error('     CHROME_BIN=/usr/bin/google-chrome python3 bilibili/bili.py --login');
    console.error('  2) 让 playwright 自己装一份：');
    console.error('     npx playwright install chromium');
  } else {
    console.error(`[login] 用的就是 ${exe}，还是起不来的话检查下它能不能单独跑。`);
  }
  process.exit(1);
}

let browser;
try {
  browser = await chromium.launch(launchOpts(HEADLESS));
} catch (e) {
  if (!HEADLESS) {
    console.log('[login] 有头模式起不来（多半是没有图形界面 / DISPLAY 没设），退回无头 + 扫码。');
    console.log('[login] ' + String(e.message).split('\n').slice(0, 4).join(' '));
    try {
      browser = await chromium.launch(launchOpts(true));
    } catch (e2) {
      noBrowser(e2);
    }
  } else {
    noBrowser(e);
  }
}

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();

let closedByUser = false;
ctx.on('close', () => { closedByUser = true; });
browser.on('disconnected', () => { closedByUser = true; });

await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(2500);

const gotCookie = async () => {
  const cs = await ctx.cookies();
  return cs.find((c) => c.name === COOKIE && c.value);
};

if (!HEADLESS) {
  console.log('[login] 浏览器窗口已打开：在窗口里登录，登录完直接把窗口关掉即可。');
} else {
  const el = await page.$('.Qrcode, .Login-qrcode, [class*="Qrcode"], .login-scan-box, .qrcode, canvas');
  if (el && QR) { try { await el.screenshot({ path: QR }); } catch (e) { /* ignore */ } }
  if (QR) { try { await page.screenshot({ path: QR }); } catch (e) { /* ignore */ } }
  console.log(`[login] 无头模式，二维码截图在：${QR}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const deadline = Date.now() + TIMEOUT * 1000;

let ok = false;
while (Date.now() < deadline) {
  if (await gotCookie()) { ok = true; break; }
  if (closedByUser) {
    await sleep(800);               // 窗口刚关，cookie 可能刚写上
    ok = !!(await gotCookie());
    break;
  }
  await sleep(2000);
}

if (ok) {
  // 再访问一次站点，让服务器刷新一批 cookie（如 z_c0 / b_lsid）
  try { await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch (e) { /* ignore */ }
  await sleep(1500);
  await ctx.storageState({ path: OUT });
  const cs = await ctx.cookies();
  const key = cs.find((c) => c.name === COOKIE);
  const exp = key && key.expires > 0 ? new Date(key.expires * 1000).toISOString().slice(0, 10) : '会话 cookie';
  console.log(`[login] 登录成功，storageState → ${OUT}`);
  console.log(`[login] cookie ${cs.length} 个，${COOKIE} 到期 ${exp}`);
} else {
  console.log(`[login] 没等到 ${COOKIE}，没有写 ${OUT}。`);
}

try { await browser.close(); } catch (e) { /* ignore */ }
process.exit(ok ? 0 : 1);
