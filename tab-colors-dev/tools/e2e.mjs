/**
 * 端到端验证：用 RDP 驱动真实 Firefox（web-ext run 启动的实例）。
 *
 * 关键点：后台是 MV3 事件页，chrome 作用域拿不到它的 window，
 * 所以统一用「扩展页面（popup 标签页）」作为驱动端——它有完整的 browser API，
 * 可以直接 browser.runtime.sendMessage 给后台，走的正是真实调用路径。
 *
 * 用法：node tools/e2e.mjs <rdp-port>
 */
import fs from 'node:fs';
import { RdpClient, evalInChrome, evalInTab } from './rdp.mjs';

const port = Number(process.argv[2]);
const EXT_ID = 'tab-colors@local';
const TEST_ORIGIN = 'http://127.0.0.1:8787';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const client = new RdpClient(20000);
await client.connect(port);

async function listTabs() {
  const res = await client.request({ to: 'root', type: 'listTabs' });
  return res.tabs || [];
}

async function tabActorFor(urlPart) {
  const tabs = await listTabs();
  const hit = tabs.find((t) => (t.url || '').includes(urlPart));
  if (!hit) throw new Error(`找不到 URL 含 "${urlPart}" 的标签页（现有：${tabs.map((t) => t.url).join(', ')}）`);
  return hit.actor;
}

async function pageState(actor) {
  const raw = await evalInTab(
    client,
    actor,
    `JSON.stringify({
       title: document.title,
       icon: (() => { const l = document.querySelector('link[rel~="icon"]'); return l ? l.getAttribute('href') : null; })(),
     })`
  );
  return JSON.parse(raw);
}

/* ---------------- 在扩展页面里执行异步代码并取回结果 ---------------- */

let driverActor = null;

/** 保证有一个可用的扩展页面（popup 标签页）作为驱动端；插件重载会把它关掉 */
async function ensureDriver() {
  const tabs = await listTabs();
  const hit = tabs.find((t) => (t.url || '').includes('popup/popup.html'));
  if (hit) {
    driverActor = hit.actor;
    return driverActor;
  }
  await evalInChrome(
    client,
    `(() => {
      const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
      const ext = ExtensionParent.GlobalManager.getExtension("${EXT_ID}");
      const win = Services.wm.getMostRecentWindow("navigator:browser");
      win.gBrowser.addTab(ext.baseURL + "popup/popup.html", { triggeringPrincipal: ext.principal });
      return "ok";
    })()`
  );
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    const tabs2 = await listTabs();
    const h2 = tabs2.find((t) => (t.url || '').includes('popup/popup.html'));
    if (h2) {
      driverActor = h2.actor;
      await sleep(1200); // 等 popup.js 首次渲染
      return driverActor;
    }
  }
  throw new Error('扩展页面打不开');
}

async function drive(body, { timeout = 20000 } = {}) {
  try {
    return await driveOnce(body, { timeout });
  } catch (e) {
    if (!/noSuchActor|Could not find|Connection closed/.test(String(e && e.message))) throw e;
    console.log('   (驱动页失效，重连后重试)', String(e.message).slice(0, 60));
    await ensureDriver();
    return driveOnce(body, { timeout });
  }
}

async function driveOnce(body, { timeout = 20000 } = {}) {
  await evalInTab(
    client,
    driverActor,
    `(() => {
       window.__tcDone = false; window.__tcOut = null; window.__tcErr = null;
       (async () => {
         try { window.__tcOut = await (async () => { ${body} })(); }
         catch (e) { window.__tcErr = String((e && e.stack) || e); }
         finally { window.__tcDone = true; }
       })();
       return 'started';
     })()`
  );
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const raw = await evalInTab(
      client,
      driverActor,
      `JSON.stringify({ done: window.__tcDone, out: window.__tcOut, err: window.__tcErr })`
    );
    const st = JSON.parse(raw);
    if (st.done) {
      if (st.err) throw new Error('扩展页面执行失败: ' + st.err);
      return st.out;
    }
    await sleep(150);
  }
  throw new Error('扩展页面执行超时');
}

/* ============================================================ */

console.log('\n=== 彩色标签 · 端到端验证（真实 Firefox） ===\n');
await sleep(3000); // 等插件可能触发的重载结束

const env = JSON.parse(
  await evalInChrome(
    client,
    `(() => {
      const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
      const ext = ExtensionParent.GlobalManager.getExtension("${EXT_ID}");
      return JSON.stringify({ hasExt: !!ext, baseURL: ext && ext.baseURL });
    })()`
  )
);
check('扩展已安装到真实 Firefox', env.hasExt, `baseURL=${env.baseURL}`);

// 0) 打开 popup 页作为驱动端（顺带验证 popup 能正常加载）
await evalInChrome(
  client,
  `(() => {
    const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
    const ext = ExtensionParent.GlobalManager.getExtension("${EXT_ID}");
    const win = Services.wm.getMostRecentWindow("navigator:browser");
    win.gBrowser.addTab(ext.baseURL + "popup/popup.html", { triggeringPrincipal: ext.principal });
    return "ok";
  })()`
);
await ensureDriver();

const driverInfo = await drive(`
  return {
    hasBrowser: typeof browser,
    tabs: (await browser.tabs.query({})).length,
  };
`);
check('扩展页面可驱动（browser API 可用）', driverInfo.hasBrowser === 'object', JSON.stringify(driverInfo));

// 重置状态，保证可重复运行
await drive(`
  await browser.storage.local.clear();
  await browser.runtime.sendMessage({ type: "tc:restoreAll" });
  return true;
`);

// 1) 授予 <all_urls> 主机权限（等价于用户在弹窗点「启用」→ 允许）
let hasOrigin = await drive(`return await browser.permissions.contains({ origins: ["<all_urls>"] });`);
if (!hasOrigin) {
  // 从 chrome 作用域授予（异步结果拿不到返回值，改为事后轮询状态）
  for (let attempt = 0; attempt < 8 && !hasOrigin; attempt++) {
    await evalInChrome(
      client,
      `(() => {
        const { ExtensionPermissions } = ChromeUtils.importESModule("resource://gre/modules/ExtensionPermissions.sys.mjs");
        const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
        const ext = ExtensionParent.GlobalManager.getExtension("${EXT_ID}");
        ExtensionPermissions.add("${EXT_ID}", { permissions: ["<all_urls>"], origins: ["<all_urls>"] }, ext)
          .then(() => { globalThis.__tcPerm = "ok"; })
          .catch((e) => { globalThis.__tcPerm = "err:" + e.message; });
        return "started";
      })()`
    );
    for (let i = 0; i < 15; i++) {
      await sleep(300);
      hasOrigin = await drive(`return await browser.permissions.contains({ origins: ["<all_urls>"] });`);
      if (hasOrigin) break;
    }
  }
}
const permMsg = await evalInChrome(client, 'String(globalThis.__tcPerm || "none")');

// 外部写入权限存储后，扩展需要重载才会感知到（真实用户走 permissions.request 会实时通知）
if (!hasOrigin) {
  const manifest = new URL('../../firefox-tab-colors/manifest.json', import.meta.url);
  const now = new Date();
  fs.utimesSync(manifest, now, now);
  await sleep(6000);
  await ensureDriver();
  hasOrigin = await drive(`return await browser.permissions.contains({ origins: ["<all_urls>"] });`);
}
check('主机权限已授予', !!hasOrigin, `hasOrigin=${hasOrigin} ${permMsg}`);

await drive(`return await browser.runtime.sendMessage({ type: "tc:ensureScript" });`);
let registered = 0;
for (let i = 0; i < 40; i++) {
  registered = await drive(`
    const regs = await browser.scripting.getRegisteredContentScripts({ ids: ["tc-marker"] });
    return regs.length;
  `);
  if (registered === 1) break;
  await sleep(300);
}
check('内容脚本已动态注册', registered === 1, `registered=${registered}`);

// 2) 清理旧测试页，再打开三个新的
await evalInChrome(
  client,
  `(() => {
    const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
    const ext = ExtensionParent.GlobalManager.getExtension("${EXT_ID}");
    const win = Services.wm.getMostRecentWindow("navigator:browser");
    for (const t of [...win.gBrowser.tabs]) {
      const spec = (t.linkedBrowser.currentURI && t.linkedBrowser.currentURI.spec) || "";
      if (spec.startsWith("${TEST_ORIGIN}")) win.gBrowser.removeTab(t);
    }
    for (const p of ["", "page2.html", "page3.html"]) {
      win.gBrowser.addTab("${TEST_ORIGIN}/" + p, { triggeringPrincipal: ext.principal });
    }
    return "ok";
  })()`
);
await sleep(2500);
check('测试页已打开', (await listTabs()).filter((t) => (t.url || '').startsWith(TEST_ORIGIN)).length >= 3);

// 3) 单标签上色 → 标题前缀 + 彩色图标
const tabIds = await drive(`
  const tabs = await browser.tabs.query({});
  return tabs.filter(t => (t.url || "").startsWith("${TEST_ORIGIN}")).map(t => ({ id: t.id, url: t.url }));
`);
console.log('   测试标签:', JSON.stringify(tabIds));
const tab1 = tabIds.find((t) => t.url === TEST_ORIGIN + '/');
const tab2 = tabIds.find((t) => (t.url || '').includes('page2.html'));
const tab3 = tabIds.find((t) => (t.url || '').includes('page3.html'));

await drive(`
  return await browser.runtime.sendMessage({ type: "tc:setColor", tabId: ${tab1.id}, color: "red", scope: "tab", label: "工作" });
`);
await sleep(1200);

const actor1 = await tabActorFor(TEST_ORIGIN + '/');
let st1 = await pageState(actor1);
for (let i = 0; i < 20 && !(/🔴/.test(st1.title) && /工作/.test(st1.title)); i++) {
  await sleep(300);
  st1 = await pageState(actor1);
}
check('标题前缀已强制写入', /🔴/.test(st1.title) && /工作/.test(st1.title), `title="${st1.title}"`);
check('图标已替换为彩色 data URI', typeof st1.icon === 'string' && st1.icon.startsWith('data:image/'),
  `icon=${String(st1.icon).slice(0, 40)}...`);

// 4) 页面自己改标题后自动补前缀
await evalInTab(client, actor1, `document.title = "页面自己改的标题"; "ok"`);
await sleep(900);
const st1b = await pageState(actor1);
if (!/🔴/.test(st1b.title)) {
  const ping = await drive(`return await browser.tabs.sendMessage(${tab1.id}, { type: "tc:ping" });`);
  console.log('   内容脚本状态:', JSON.stringify(ping));
}
check('页面改标题后自动补前缀', /🔴/.test(st1b.title) && /页面自己改的标题/.test(st1b.title), `title="${st1b.title}"`);

// 5) 站点作用域
await drive(`
  return await browser.runtime.sendMessage({ type: "tc:setColor", tabId: ${tab2.id}, color: "green", scope: "site", label: "" });
`);
await sleep(1200);
const actor2 = await tabActorFor('page2.html');
const st2 = await pageState(actor2);
check('站点作用域生效', /🟢/.test(st2.title), `title="${st2.title}"`);
const st1c = await pageState(actor1);
check('标签级优先级高于站点级', /🔴/.test(st1c.title), `title="${st1c.title}"`);

// 6) 标签分组 + 原生组颜色 + 整组染色
const groupInfo = await evalInChrome(
  client,
  `(() => {
    const win = Services.wm.getMostRecentWindow("navigator:browser");
    const g = win.gBrowser;
    const tabs = g.tabs.filter(t => ((t.linkedBrowser.currentURI && t.linkedBrowser.currentURI.spec) || "").startsWith("${TEST_ORIGIN}"));
    try {
      const res = g.addTabGroup(tabs.slice(1), { label: "测试组", color: "cyan" });
      const gid = res && typeof res === "object" ? res.id : res;
      return JSON.stringify({ gid: gid === undefined ? null : gid, n: tabs.length });
    } catch (e) { return JSON.stringify({ error: e.message }); }
  })()`
);
console.log('   分组结果:', groupInfo);
let gid = null;
try { gid = JSON.parse(groupInfo).gid; } catch { /* ignore */ }

if (gid) {
  const groups = await drive(`return await browser.tabGroups.query({});`);
  const g0 = groups.find((g) => g.title === "测试组") || groups.find((g) => String(g.id) === String(gid));
  check('原生标签组已创建', !!g0, JSON.stringify(groups));
  gid = g0 ? g0.id : gid;

  const upd = await drive(`return await browser.runtime.sendMessage({ type: "tc:setGroupColor", groupId: ${gid}, color: "purple" });`);
  check('原生组颜色可设置', upd && upd.ok === true, JSON.stringify(upd));
  const groups2 = await drive(`return await browser.tabGroups.query({});`);
  const g1 = groups2.find((g) => g.id === gid);
  check('原生组颜色已生效', g1 && g1.color === 'purple', `color=${g1 && g1.color}`);

  const bulk = await drive(`return await browser.runtime.sendMessage({ type: "tc:applyToGroup", groupId: ${gid}, color: "orange" });`);
  check('整组染色（每个标签独立标记）', bulk && bulk.ok === true, JSON.stringify(bulk));
  await sleep(1200);
  const st2b = await pageState(await tabActorFor('page2.html'));
  check('组内标签标题带橙色标记', /🟠/.test(st2b.title), `title="${st2b.title}"`);
} else {
  check('原生标签组已创建', false, groupInfo);
}

// 7) popup 界面：真实渲染 + 点击色块（先重载 popup 让它拿到最新分组）
await evalInTab(client, driverActor, 'location.reload(); "reloading"');
await sleep(2500);
await ensureDriver();
await sleep(500);
const pop = JSON.parse(
  await evalInTab(
    client,
    driverActor,
    `JSON.stringify({
       rows: document.querySelectorAll('.row').length,
       swatches: document.querySelectorAll('.row .sw').length,
       groups: document.querySelectorAll('section.group').length,
       groupTitle: (document.querySelector('.gname') || {}).textContent || null,
     })`
  )
);
check('popup 渲染出标签列表', pop.rows >= 3, `rows=${pop.rows} swatches=${pop.swatches}`);
check('popup 显示分组区块', pop.groups >= 1, `groups=${pop.groups} title=${pop.groupTitle}`);

const clicked = await evalInTab(
  client,
  driverActor,
  `(() => {
     const rows = [...document.querySelectorAll('.row')];
     const row = rows.find(r => ((r.querySelector('.ttl')||{}).textContent||'').includes('工作'));
     if (!row) return JSON.stringify({ ok: false, reason: 'no-row', titles: rows.map(r => (r.querySelector('.ttl')||{}).textContent) });
     const scope = row.querySelector('.scope');
     if (scope && scope.textContent.trim() === '站') scope.click();  // 切成「仅此标签」
     const sws = [...row.querySelectorAll('.sw')];
     sws[6].click();
     return JSON.stringify({ ok: true, n: sws.length, scope: (row.querySelector('.scope')||{}).textContent });
   })()`
);
console.log('   popup 点击:', clicked);
await sleep(1500);
const st3 = await pageState(actor1);
check('popup 点击色块 → 标签变色', /🟪/.test(st3.title), `title="${st3.title}"`);

// 8) 撤销
await drive(`return await browser.runtime.sendMessage({ type: "tc:clear", tabId: ${tab1.id} });`);
await sleep(1200);
const st1d = await pageState(actor1);
check('清除颜色后标题还原（无前缀残留）', !/[🔴🟠🟡🟢🔵🟦🟪🌸⚪]/.test(st1d.title), `title="${st1d.title}"`);

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===\n`);
client.disconnect();
process.exit(fail ? 1 : 0);
