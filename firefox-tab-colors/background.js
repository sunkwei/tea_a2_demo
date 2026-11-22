/**
 * 彩色标签 · 后台脚本
 *
 * 背景：Firefox 的 WebExtension API 没有「单个标签页颜色 / 标题」的能力
 *   - tabs.update() 不支持 color / title
 *   - 只有 tabGroups.update({color}) 能改「整组」颜色（原生分组层）
 * 所以这里的做法是：
 *   - 分组层：直接调用原生 tabGroups.update()，得到 Firefox 原生的组颜色
 *   - 单标签层：用内容脚本改写 document.title（强制标题前缀）+
 *     替换 <link rel="icon">（彩色图标），标签栏里立刻可见
 */

const api = globalThis.browser ?? globalThis.chrome;

const HOST_ORIGIN = '<all_urls>';
const CONTENT_SCRIPT_ID = 'tc-marker';

const DEFAULT_SETTINGS = {
  titlePrefix: true,       // 是否强制加标题前缀
  colorFavicon: true,      // 是否用彩色图标
  iconMode: 'ring',        // ring = 色环包住站点图标；solid = 纯色块
  prefixText: '',          // 自定义标记文字（为空则只显示 emoji）
  prefixTemplate: '{emoji} {text}',
  scope: 'tab',            // 默认作用域：tab = 仅此标签；site = 整个站点
};

let writeLock = Promise.resolve();
function withLock(fn) {
  const run = writeLock.then(fn, fn);
  writeLock = run.then(() => {}, () => {});
  return run;
}

async function readState() {
  const raw = await api.storage.local.get('tc');
  const s = raw.tc || {};
  return {
    tabs: s.tabs || {},      // tabId -> { color, label, scope, url }
    urls: s.urls || {},      // 完整 url -> { color, label }（tab 作用域的持久化）
    domains: s.domains || {},// host -> { color, label }
    settings: Object.assign({}, DEFAULT_SETTINGS, s.settings || {}),
  };
}

async function writeState(state) {
  await api.storage.local.set({ tc: state });
}

function hostOf(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname : '';
  } catch {
    return '';
  }
}

/** 计算某个标签最终生效的标记：标签级 > 站点级 > URL 级 */
function findMarker(state, tab) {
  if (!tab) return null;
  const byTab = state.tabs[tab.id];
  if (byTab) return byTab;
  const url = tab.url || '';
  const host = hostOf(url);
  if (host && state.domains[host]) return state.domains[host];
  if (url && state.urls[url]) return state.urls[url];
  return null;
}

/* ------------------------------------------------------------------ */
/* 权限 + 内容脚本注册                                                */
/* ------------------------------------------------------------------ */

async function hasHostPermission() {
  try {
    if (await api.permissions.contains({ origins: [HOST_ORIGIN] })) return true;
    // 兜底：某些情况下 contains 反映不及时，用 getAll 再确认一次
    const all = await api.permissions.getAll();
    const origins = all.origins || [];
    return origins.includes(HOST_ORIGIN) || origins.includes('*://*/*');
  } catch {
    return false;
  }
}

/** 注册动态内容脚本（需要在拿到 <all_urls> 主机权限之后） */
async function ensureContentScript() {
  if (!(await hasHostPermission())) return false;
  try {
    const regs = await api.scripting.getRegisteredContentScripts({ ids: [CONTENT_SCRIPT_ID] });
    if (!regs.length) {
      await api.scripting.registerContentScripts([
        {
          id: CONTENT_SCRIPT_ID,
          js: ['common.js', 'content.js'],
          matches: [HOST_ORIGIN],
          runAt: 'document_start',
          allFrames: false,
          persistAcrossSessions: true,
        },
      ]);
    }
    return true;
  } catch (e) {
    console.warn('[TC] 注册内容脚本失败：', e);
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* 应用 / 撤销标记                                                     */
/* ------------------------------------------------------------------ */

async function applyMarkerToTab(tab, marker) {
  if (!tab || tab.id == null) return;
  const settings = (await readState()).settings;
  const payload = {
    type: 'tc:apply',
    marker,
    settings,
    favIconUrl: tab.favIconUrl || '',
  };
  try {
    await api.tabs.sendMessage(tab.id, payload);
  } catch {
    // 内容脚本还没注入（例如页面在授权之前就打开了）→ 先注入再发
    if (await hasHostPermission()) {
      try {
        await api.scripting.executeScript({ target: { tabId: tab.id }, files: ['common.js', 'content.js'] });
        await api.tabs.sendMessage(tab.id, payload);
      } catch (e) {
        console.warn('[TC] 注入失败：', e);
      }
    }
  }
  await updateBadge(tab.id, marker);
}

async function restoreTab(tabId) {
  try {
    await api.tabs.sendMessage(tabId, { type: 'tc:restore' });
  } catch { /* 页面没有内容脚本，忽略 */ }
  await updateBadge(tabId, null);
}

async function updateBadge(tabId, marker) {
  try {
    if (!marker) {
      await api.action.setBadgeText({ tabId, text: '' });
      return;
    }
    const c = TC.color(marker.color);
    const text = marker.label ? Array.from(marker.label)[0] : '●';
    await api.action.setBadgeText({ tabId, text });
    await api.action.setBadgeBackgroundColor({ tabId, color: c.hex });
  } catch { /* 标签可能已关闭 */ }
}

/** 重新把当前所有标签与规则对齐（有标记→上色，无标记→还原） */
async function syncAllTabs() {
  const state = await readState();
  let tabs = [];
  try {
    tabs = await api.tabs.query({});
  } catch {
    return;
  }
  for (const tab of tabs) {
    if (tab.id == null) continue;
    const marker = findMarker(state, tab);
    if (marker) await applyMarkerToTab(tab, marker);
    else await restoreTab(tab.id);
  }
}

/* ------------------------------------------------------------------ */
/* 标记的增删改                                                        */
/* ------------------------------------------------------------------ */

async function setMarker(tabId, color, scope, label) {
  return withLock(async () => {
    const state = await readState();
    let tab = null;
    try {
      tab = await api.tabs.get(tabId);
    } catch {
      return { ok: false, error: '标签页不存在' };
    }
    const url = tab.url || '';
    const host = hostOf(url);
    let finalScope = scope === 'site' ? 'site' : 'tab';

    if (finalScope === 'site' && !host) {
      // 内部页面等没有域名，退化成「仅此标签」
      finalScope = 'tab';
    }

    if (finalScope === 'site') {
      state.domains[host] = { color, label: label || '', scope: 'site' };
      delete state.tabs[tabId];
      delete state.urls[url];
    } else {
      state.tabs[tabId] = { color, label: label || '', scope: 'tab', url };
      if (url) state.urls[url] = { color, label: label || '', scope: 'tab' };
      // 标签级优先：如果之前有站点级规则，删掉它，避免「改了没反应」
      if (host && state.domains[host]) delete state.domains[host];
    }
    await writeState(state);
    await syncAllTabs();
    return { ok: true, scope: finalScope };
  });
}

async function clearMarker(tabId) {
  return withLock(async () => {
    const state = await readState();
    const existed = !!state.tabs[tabId];
    delete state.tabs[tabId];
    if (existed) {
      let tab = null;
      try {
        tab = await api.tabs.get(tabId);
      } catch { /* ignore */ }
      const url = tab ? tab.url || '' : '';
      if (url && state.urls[url]) delete state.urls[url];
    }
    await writeState(state);
    await syncAllTabs();
    return { ok: true };
  });
}

/** 把一个颜色套用到整个分组（组内每个标签都打上独立标记） */
async function applyToGroup(groupId, color) {
  return withLock(async () => {
    const state = await readState();
    const tabs = await api.tabs.query({});
    const members = tabs.filter((t) => t.groupId === groupId);
    for (const tab of members) {
      const url = tab.url || '';
      state.tabs[tab.id] = { color, label: '', scope: 'tab', url };
      if (url) state.urls[url] = { color, label: '', scope: 'tab' };
      const host = hostOf(url);
      if (host && state.domains[host]) delete state.domains[host];
    }
    await writeState(state);
    await syncAllTabs();
    return { ok: true, count: members.length };
  });
}

/** 原生分组颜色（Firefox 自带的组颜色） */
async function setGroupColor(groupId, color) {
  if (!api.tabGroups || !api.tabGroups.update) {
    return { ok: false, error: '当前 Firefox 不支持原生分组颜色（需要 139+）' };
  }
  try {
    await api.tabGroups.update(groupId, { color });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

/* ------------------------------------------------------------------ */
/* 右键菜单                                                            */
/* ------------------------------------------------------------------ */

async function setupMenus() {
  try {
    await api.menus.removeAll();
  } catch { /* ignore */ }
  const mk = (opts) => { try { api.menus.create(opts); } catch (e) { console.warn(e); } };

  mk({ id: 'tc-root', title: '🎨 彩色标签', contexts: ['tab'] });
  mk({ id: 'tc-sep-1', type: 'separator', contexts: ['tab'] });
  mk({ id: 'tc-color', title: '此标签颜色', contexts: ['tab'] });
  for (const c of TC.COLORS) {
    mk({ id: `tc-color-${c.name}`, parentId: 'tc-color', title: `${c.emoji} ${c.cn}`, contexts: ['tab'] });
  }
  mk({ id: 'tc-color-none', parentId: 'tc-color', title: '清除颜色', contexts: ['tab'] });
  mk({ id: 'tc-sep-2', type: 'separator', contexts: ['tab'] });
  mk({ id: 'tc-group', title: '整组染色（组内每个标签）', contexts: ['tab'] });
  for (const c of TC.COLORS) {
    mk({ id: `tc-group-${c.name}`, parentId: 'tc-group', title: `${c.emoji} ${c.cn}`, contexts: ['tab'] });
  }
  mk({ id: 'tc-sep-3', type: 'separator', contexts: ['tab'] });
  mk({ id: 'tc-native', title: '分组颜色（Firefox 原生）', contexts: ['tab'] });
  for (const c of TC.COLORS) {
    mk({ id: `tc-native-${c.name}`, parentId: 'tc-native', title: `${c.emoji} ${c.cn}`, contexts: ['tab'] });
  }
  mk({ id: 'tc-sep-4', type: 'separator', contexts: ['tab'] });
  mk({ id: 'tc-clear', title: '清除此标签颜色', contexts: ['tab'] });
}

async function groupIdOfTab(tabId) {
  try {
    const tab = await api.tabs.get(tabId);
    return tab.groupId == null ? -1 : tab.groupId;
  } catch {
    return -1;
  }
}

/* ------------------------------------------------------------------ */
/* 消息路由                                                            */
/* ------------------------------------------------------------------ */

api.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || typeof msg !== 'object') return undefined;
  const type = msg.type;

  // 内容脚本自报家门：问自己该显示成什么样
  if (type === 'tc:hello') {
    return (async () => {
      const state = await readState();
      const tab = sender && sender.tab ? sender.tab : null;
      const marker = findMarker(state, tab);
      return {
        marker,
        settings: state.settings,
        favIconUrl: (tab && tab.favIconUrl) || '',
      };
    })();
  }

  if (type === 'tc:getState') {
    return (async () => {
      const state = await readState();
      const markers = {};
      let tabs = [];
      try {
        tabs = await api.tabs.query({});
      } catch { /* ignore */ }
      for (const tab of tabs) {
        const m = findMarker(state, tab);
        if (m) markers[tab.id] = m;
      }
      return {
        state,
        markers,
        hasPermission: await hasHostPermission(),
        supportsGroupColors: !!(api.tabGroups && api.tabGroups.update),
      };
    })();
  }

  if (type === 'tc:setColor') {
    return setMarker(msg.tabId, msg.color, msg.scope, msg.label);
  }
  if (type === 'tc:clear') {
    return clearMarker(msg.tabId);
  }
  if (type === 'tc:applyToGroup') {
    return applyToGroup(msg.groupId, msg.color);
  }
  if (type === 'tc:setGroupColor') {
    return setGroupColor(msg.groupId, msg.color);
  }
  if (type === 'tc:setSettings') {
    return withLock(async () => {
      const state = await readState();
      state.settings = Object.assign({}, state.settings, msg.patch || {});
      await writeState(state);
      await syncAllTabs();
      return { ok: true, settings: state.settings };
    });
  }
  if (type === 'tc:restoreAll') {
    return (async () => {
      const tabs = await api.tabs.query({ currentWindow: true });
      for (const tab of tabs) {
        if (tab.id != null) await restoreTab(tab.id);
      }
      return { ok: true };
    })();
  }
  if (type === 'tc:ensureScript') {
    return (async () => {
      const ok = await ensureContentScript();
      if (ok) await syncAllTabs();
      return { ok, hasPermission: await hasHostPermission() };
    })();
  }
  return undefined;
});

api.menus.onClicked.addListener(async (info, tab) => {
  const id = String(info.menuItemId || '');
  const tabId = tab && tab.id;
  if (tabId == null) return;
  const state = await readState();

  if (id.startsWith('tc-color-')) {
    const name = id.slice('tc-color-'.length);
    if (name === 'none') {
      await clearMarker(tabId);
      return;
    }
    const prev = findMarker(state, tab);
    await setMarker(tabId, name, state.settings.scope, prev && prev.label ? prev.label : '');
    return;
  }
  if (id.startsWith('tc-group-')) {
    const name = id.slice('tc-group-'.length);
    const gid = await groupIdOfTab(tabId);
    if (gid < 0) return;
    await applyToGroup(gid, name);
    return;
  }
  if (id.startsWith('tc-native-')) {
    const name = id.slice('tc-native-'.length);
    const gid = await groupIdOfTab(tabId);
    if (gid < 0) return;
    await setGroupColor(gid, name);
    return;
  }
  if (id === 'tc-clear') {
    await clearMarker(tabId);
  }
});

/* ------------------------------------------------------------------ */
/* 标签页生命周期                                                      */
/* ------------------------------------------------------------------ */

api.tabs.onRemoved.addListener(async (tabId) => {
  await withLock(async () => {
    const state = await readState();
    if (state.tabs[tabId]) {
      delete state.tabs[tabId];
      await writeState(state);
    }
  });
});

api.tabs.onCreated.addListener(async (tab) => {
  const state = await readState();
  const marker = findMarker(state, tab);
  if (marker) await applyMarkerToTab(tab, marker);
});

api.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // 标题变化（changeInfo.title）也要重新应用标记，
  // 这样即便内容脚本没观察到 DOM 变化，标签标题也保持带前缀
  if (!changeInfo.status && !changeInfo.url && !changeInfo.title) return;
  const state = await readState();
  const marker = findMarker(state, tab);
  if (marker) await applyMarkerToTab(tab, marker);
});

/** 浏览器重启后 tabId 会变：用 URL 规则把颜色重新绑定到新标签上 */
async function rebindByUrl() {
  await withLock(async () => {
    const state = await readState();
    const tabs = await api.tabs.query({});
    let changed = false;
    for (const tab of tabs) {
      if (state.tabs[tab.id]) continue;
      const url = tab.url || '';
      const rule = url && state.urls[url];
      if (rule) {
        state.tabs[tab.id] = Object.assign({}, rule, { url });
        changed = true;
      }
    }
    if (changed) await writeState(state);
  });
}

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

api.runtime.onInstalled.addListener(async () => {
  await setupMenus();
  await ensureContentScript();
  await rebindByUrl();
  await syncAllTabs();
});

api.runtime.onStartup.addListener(async () => {
  await setupMenus();
  await ensureContentScript();
  await rebindByUrl();
  await syncAllTabs();
});

api.permissions.onAdded.addListener(async () => {
  await ensureContentScript();
  await syncAllTabs();
});

api.permissions.onRemoved.addListener(async () => {
  try {
    const regs = await api.scripting.getRegisteredContentScripts({ ids: [CONTENT_SCRIPT_ID] });
    if (regs.length) await api.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
  } catch { /* ignore */ }
});

// 后台脚本被加载时（事件页启动）也要把菜单建好
setupMenus();
ensureContentScript();
