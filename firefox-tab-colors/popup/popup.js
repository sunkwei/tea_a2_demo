/**
 * 彩色标签 · 弹窗
 * 上半部分：Firefox 原生分组（可改原生组颜色，可一键套用到组内标签）
 * 下半部分：逐个标签上色（9 色 + 清除 + 作用域：仅此标签 / 整个站点）
 */

const api = globalThis.browser ?? globalThis.chrome;
const TC = globalThis.TC;

let state = null;
let markers = {};
let tabs = [];
let groups = [];
let groupColorSupport = true;
let hasPermission = false;
const rowScope = new Map(); // tabId -> 'tab' | 'site'（本次弹窗内的临时选择）

const $ = (sel) => document.querySelector(sel);

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

async function refresh() {
  let res = null;
  try {
    res = await api.runtime.sendMessage({ type: 'tc:getState' });
    state = res.state;
    markers = res.markers || {};
    groupColorSupport = !!res.supportsGroupColors;
    hasPermission = !!res.hasPermission;
  } catch (e) {
    console.warn('[TC] 读取状态失败', e);
  }
  try {
    const win = await api.windows.getCurrent();
    tabs = await api.tabs.query({ windowId: win.id });
    if (api.tabGroups && api.tabGroups.query) {
      groups = await api.tabGroups.query({ windowId: win.id });
    } else {
      groups = [];
    }
  } catch {
    tabs = [];
    groups = [];
  }
  render();
  const permBar = $('#perm');
  if (permBar) permBar.classList.toggle('hidden', hasPermission);
}

/* ------------------------------------------------------------------ */
/* 渲染                                                                */
/* ------------------------------------------------------------------ */

function render() {
  const list = $('#list');
  list.textContent = '';
  if (!tabs.length) {
    list.appendChild(el('div', 'empty', '当前窗口没有标签页'));
    syncSettings();
    return;
  }

  const byGroup = new Map();
  const loose = [];
  for (const tab of tabs) {
    const gid = tab.groupId == null ? -1 : tab.groupId;
    if (gid === -1) {
      loose.push(tab);
      continue;
    }
    if (!byGroup.has(gid)) byGroup.set(gid, []);
    byGroup.get(gid).push(tab);
  }

  // 分组（按组内第一个标签的顺序）
  for (const group of groups) {
    const members = byGroup.get(group.id);
    if (!members || !members.length) continue;
    byGroup.delete(group.id);
    list.appendChild(renderGroup(group, members));
  }
  // 拿不到详情的组
  for (const [gid, members] of byGroup) {
    list.appendChild(renderGroup({ id: gid, title: `分组 ${gid}`, color: 'gray' }, members));
  }

  if (loose.length) {
    const sec = el('section', 'loose');
    const head = el('div', 'ghead');
    head.appendChild(el('span', 'gname', '未分组'));
    head.appendChild(el('span', 'gcount', `${loose.length} 个标签`));
    sec.appendChild(head);
    for (const tab of loose) sec.appendChild(renderRow(tab));
    list.appendChild(sec);
  }
  syncSettings();
}

function renderGroup(group, members) {
  const sec = el('section', 'group');
  const head = el('div', 'ghead');

  const dot = el('span', 'gdot');
  dot.style.background = TC.color(group.color).hex;
  head.appendChild(dot);
  head.appendChild(el('span', 'gname', group.title || '未命名组'));
  head.appendChild(el('span', 'gcount', `${members.length} 个标签`));
  head.appendChild(el('span', 'spacer'));

  // 原生组颜色（Firefox 自带的那层）
  if (groupColorSupport) {
    const sw = el('div', 'swatches');
    for (const c of TC.COLORS) {
      const b = el('button', 'sw');
      b.style.background = c.hex;
      b.style.color = c.hex;
      b.title = `组颜色：${c.cn}`;
      if (group.color === c.name) b.classList.add('cur');
      b.addEventListener('click', async () => {
        await api.runtime.sendMessage({ type: 'tc:setGroupColor', groupId: group.id, color: c.name });
        await refresh();
      });
      sw.appendChild(b);
    }
    head.appendChild(sw);

    const apply = el('button', 'gapply', '套用到组内');
    apply.title = '把该组颜色同时作为组内每个标签的独立标记';
    apply.addEventListener('click', async () => {
      await api.runtime.sendMessage({ type: 'tc:applyToGroup', groupId: group.id, color: group.color });
      await refresh();
    });
    head.appendChild(apply);
  }

  sec.appendChild(head);
  for (const tab of members) sec.appendChild(renderRow(tab));
  return sec;
}

function renderRow(tab) {
  const row = el('div', 'row');
  if (tab.active) row.classList.add('active');

  const marker = markers[tab.id];
  const color = marker ? TC.color(marker.color) : null;

  // 第一行：图标 + 标题
  const line1 = el('div', 'line1');
  if (tab.favIconUrl) {
    const fav = el('img', 'fav');
    fav.src = tab.favIconUrl;
    fav.alt = '';
    line1.appendChild(fav);
  } else {
    const dot = el('span', 'fav');
    if (color) dot.style.background = color.hex;
    line1.appendChild(dot);
  }

  const ttl = el('span', 'ttl');
  const base = tab.title || tab.url || '(无标题)';
  ttl.title = base;
  if (marker) {
    ttl.classList.add('marked');
    ttl.textContent = `${color.emoji} ${marker.label ? marker.label + ' ' : ''}${base}`;
  } else {
    ttl.textContent = base;
  }
  line1.appendChild(ttl);

  // 作用域：仅此标签 / 整个站点
  const defaultScope = state && state.settings ? state.settings.scope : 'tab';
  const scope = rowScope.get(tab.id) || (marker && marker.scope === 'site' ? 'site' : defaultScope);
  const scopeBtn = el('button', 'scope', scope === 'site' ? '站' : '单');
  scopeBtn.title = scope === 'site'
    ? '作用于整个站点（点击切换为仅此标签）'
    : '仅作用于此标签（点击切换为整个站点）';
  if (scope === 'site') scopeBtn.classList.add('site');
  scopeBtn.addEventListener('click', () => {
    rowScope.set(tab.id, scope === 'site' ? 'tab' : 'site');
    render();
  });
  line1.appendChild(scopeBtn);
  row.appendChild(line1);

  // 第二行：色板
  const line2 = el('div', 'line2');
  line2.appendChild(el('span', 'spacer'));

  // 颜色
  const sw = el('div', 'swatches');
  for (const c of TC.COLORS) {
    const b = el('button', 'sw');
    b.style.background = c.hex;
    b.style.color = c.hex;
    b.title = c.cn;
    if (marker && marker.color === c.name) b.classList.add('cur');
    b.addEventListener('click', async () => {
      await api.runtime.sendMessage({
        type: 'tc:setColor',
        tabId: tab.id,
        color: c.name,
        scope: rowScope.get(tab.id) || scope,
        label: marker && marker.label ? marker.label : '',
      });
      await refresh();
    });
    sw.appendChild(b);
  }
  const none = el('button', 'sw none');
  none.title = '清除颜色';
  none.addEventListener('click', async () => {
    await api.runtime.sendMessage({ type: 'tc:clear', tabId: tab.id });
    await refresh();
  });
  sw.appendChild(none);
  line2.appendChild(sw);
  row.appendChild(line2);

  return row;
}

/* ------------------------------------------------------------------ */
/* 交互                                                                */
/* ------------------------------------------------------------------ */

$('#refresh').addEventListener('click', refresh);

$('#grant').addEventListener('click', async () => {
  const ok = await api.permissions.request({ origins: ['<all_urls>'] });
  if (ok) {
    await api.runtime.sendMessage({ type: 'tc:ensureScript' });
  }
  await refresh();
});

$('#restore').addEventListener('click', async () => {
  await api.runtime.sendMessage({ type: 'tc:restoreAll' });
  await refresh();
});

function bindOption(id, key, transform) {
  const node = $(id);
  if (!node) return;
  node.addEventListener('change', async () => {
    const value = transform ? transform(node) : node.checked;
    await api.runtime.sendMessage({ type: 'tc:setSettings', patch: { [key]: value } });
    await refresh();
  });
}

function syncSettings() {
  if (!state) return;
  const s = state.settings;
  $('#opt-title').checked = !!s.titlePrefix;
  $('#opt-favicon').checked = !!s.colorFavicon;
  $('#opt-iconmode').value = s.iconMode || 'ring';
  $('#opt-text').value = s.prefixText || '';
  $('#opt-scope').value = s.scope || 'tab';
}

bindOption('#opt-title', 'titlePrefix');
bindOption('#opt-favicon', 'colorFavicon');
bindOption('#opt-iconmode', 'iconMode', (n) => n.value);
bindOption('#opt-text', 'prefixText', (n) => n.value.trim());
bindOption('#opt-scope', 'scope', (n) => n.value);

refresh();
