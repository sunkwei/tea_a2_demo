/**
 * IPTV 剧场 —— 主逻辑。
 *
 * 数据流：
 *   源目录(sources.js) → 拉取(playlist.js) → 解析(m3u.js) → 合并 → 渲染
 *                                            ↘ 缓存(store.js, IndexedDB)
 *   播放(player.js, hls.js) → 真实可用性回报 → health.js → 频道状态点
 */

import { builtinSources, DEFAULT_ENABLED, sourceGroups } from './sources.js';
import { mergeChannels, sortChannels, normalizeName } from './m3u.js';
import * as store from './store.js';
import { updateSources, updateSource, githubLatestCommit } from './playlist.js';
import { probeMany } from './health.js';
import { createPlayer } from './player.js';
import { loadEpg, nowNext } from './epg.js';

/** iptv-org 的 group-title 是英文，这里映射成中文显示（过滤仍用原始值） */
const GROUP_LABELS = {
  news: '新闻',
  sports: '体育',
  movies: '电影',
  music: '音乐',
  kids: '少儿',
  general: '综合',
  entertainment: '娱乐',
  documentary: '纪录片',
  series: '剧集',
  culture: '文化',
  education: '教育',
  lifestyle: '生活',
  science: '科技',
  travel: '旅行',
  weather: '天气',
  business: '商业',
  religious: '宗教',
  classic: '经典',
  comedy: '喜剧',
  family: '家庭',
  animation: '动画',
  cooking: '美食',
  shop: '购物',
  relax: '休闲',
  outdoor: '户外',
  public: '公共',
  interactive: '互动',
  legislative: '政务',
  auto: '汽车',
  undefined: '未分类',
};

function groupLabel(group) {
  const raw = String(group || '').trim();
  const key = raw.toLowerCase();
  if (GROUP_LABELS[key]) return GROUP_LABELS[key];
  // "News;Sports" 这种多标签只翻译第一段
  const head = raw.split(/[;/]/)[0].trim().toLowerCase();
  if (head && GROUP_LABELS[head]) return GROUP_LABELS[head];
  return raw || '未分类';
}

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

/** 本地流代理前缀（/api/proxy），用于解决直播服务器不带 CORS 头的问题 */
let streamProxy = '';
let renderToken = 0;

const state = {
  settings: store.getSettings(),
  sources: [],
  enabled: new Set(),
  sourceEntries: new Map(), // sourceId -> entries[]
  channels: [],
  byKey: new Map(),
  health: new Map(), // key -> { status, at }
  view: 'all',
  group: '',
  country: '',
  search: '',
  sort: 'name',
  playing: null,
  epg: null,
  updating: false,
  lastUpdateAt: 0,
  timer: null,
  favorites: new Set(store.getFavorites()),
  recent: store.getRecent(),
};

/* =======================================================================
 * 启动
 * ===================================================================== */

const video = $('#video');
const player = createPlayer(video, {
  onState: handlePlayerState,
  onLevels: (levels, current) => fillQuality(levels, current),
  onError: (data) => {
    toast(`播放失败：${data?.reason || data?.details || '未知错误'}`, 'bad');
    markHealth(state.playing?.key, 'offline');
  },
  onStats: (s) => {
    const badge = $('#player-badge');
    if (badge && s.height) badge.textContent = `当前画质 ${s.height}p · ${Math.round(s.bitrate / 1000)} kbps`;
  },
});

/** 探测同源是否挂了本地流代理（vite 插件 / serve.mjs 提供） */
async function detectStreamProxy() {
  // file:// 下没有同源后端，别去探测（否则控制台一堆 CORS 报错）
  if (!/^https?:$/.test(location.protocol)) return '';
  try {
    const res = await fetch('/api/proxy?ping=1', { cache: 'no-store' });
    if (res.ok) streamProxy = '/api/proxy';
  } catch {
    streamProxy = '';
  }
  return streamProxy;
}

/** 同源代理前缀（列表拉取用，可以带条件请求） */
function sameOriginPrefix() {
  return streamProxy ? `${streamProxy}?url=` : '';
}

function withProxy(url) {
  if (!url || !streamProxy) return url;
  if (url.startsWith('/')) return url;
  return `${streamProxy}?url=${encodeURIComponent(url)}`;
}

function init() {
  state.settings = store.getSettings();
  detectStreamProxy().then(() => {
    if (streamProxy) {
      updateStatusBar('本地流代理已启用（解决直播源 CORS 限制）');
    }
  });
  buildSources();
  bindUI();
  applyTheme();
  renderChannelList();
  updateStatusBar('正在加载缓存…');

  // 先用缓存把界面点亮（秒开），再后台拉最新
  loadCachedChannels().then(() => {
    renderChannelList();
    updateStatusBar();
    maybeAutoUpdate();
  });
  loadEpgIfConfigured();
}

function buildSources() {
  const custom = store.getCustomSources();
  state.sources = [...builtinSources(), ...custom];
  const saved = store.getEnabledIds();
  const enabled = Array.isArray(saved) ? saved : DEFAULT_ENABLED;
  state.enabled = new Set(enabled);
  // 兼容：自定义源若被删除但仍在启用列表里，剔除
  for (const id of [...state.enabled]) {
    if (!state.sources.some((s) => s.id === id)) state.enabled.delete(id);
  }
}

function enabledSources() {
  return state.sources.filter((s) => state.enabled.has(s.id));
}

async function loadCachedChannels() {
  const list = enabledSources();
  await Promise.all(
    list.map(async (s) => {
      const cached = await store.readChannels(s.id);
      if (cached && cached.length) {
        state.sourceEntries.set(s.id, cached);
      }
    })
  );
  rebuildChannels();
}

/* =======================================================================
 * 自动更新
 * ===================================================================== */

function isStale() {
  if (!state.lastUpdateAt) return true;
  const interval = Math.max(5, state.settings.updateIntervalMin) * 60000;
  return Date.now() - state.lastUpdateAt > interval;
}

function maybeAutoUpdate() {
  clearTimeout(state.timer);
  if (!state.settings.autoUpdate) return;
  if (!isStale()) {
    scheduleNext();
    return;
  }
  runUpdate({ silent: true });
}

function scheduleNext() {
  clearTimeout(state.timer);
  const interval = Math.max(5, state.settings.updateIntervalMin) * 60000;
  state.timer = setTimeout(() => runUpdate({ silent: true }), interval);
}

async function runUpdate(opts = {}) {
  if (state.updating) return;
  const sources = enabledSources();
  if (!sources.length) {
    updateStatusBar();
    return;
  }
  state.updating = true;
  const started = Date.now();
  const fill = $('#progress-fill');
  const btn = $('#btn-update');
  btn.textContent = '⟳ 更新中';
  btn.disabled = true;
  fill.style.width = '0%';

  const states = store.getSourceState();
  // 把内存里的旧条目挂上去，增量比对才准确（也不必把 key 列表写进 localStorage）
  for (const src of sources) {
    const old = state.sourceEntries.get(src.id);
    if (old) states[src.id] = { ...(states[src.id] || {}), entries: old };
  }
  let done = 0;
  const results = await updateSources(
    sources,
    states,
    {
      proxy: state.settings.proxy,
      sameOrigin: state.settings.useProxyStreams === false ? '' : sameOriginPrefix(),
      timeoutMs: 30000,
    },
    (ev) => {
      if (ev.phase === 'fetch') {
        updateStatusBar(`正在更新：${ev.source.name}`);
      } else {
        done++;
        fill.style.width = `${Math.round((done / sources.length) * 100)}%`;
      }
    }
  );

  let added = 0;
  let removed = 0;
  let failed = 0;
  let changed = 0;
  for (const r of results) {
    const prev = states[r.source.id] || {};
    if (!r.ok) {
      failed++;
      store.setSourceState(r.source.id, { error: r.error, lastChecked: Date.now() });
      continue;
    }
    if (r.notModified) {
      store.setSourceState(r.source.id, { ...prev, lastChecked: Date.now(), error: '' });
      continue;
    }
    changed++;
    added += r.added;
    removed += r.removed;
    state.sourceEntries.set(r.source.id, r.entries);
    await store.cacheChannels(r.source.id, r.entries);
    store.setSourceState(r.source.id, {
      etag: r.etag,
      lastModified: r.lastModified,
      hash: r.hash,
      lastChecked: Date.now(),
      lastChanged: Date.now(),
      count: r.count,
      error: '',
      viaProxy: r.viaProxy,
    });
  }

  state.lastUpdateAt = Date.now();
  rebuildChannels();
  renderChannelList();
  renderFilters();
  updateStatusBar();
  state.updating = false;
  btn.textContent = '⟳ 更新';
  btn.disabled = false;
  fill.style.width = '0%';

  const secs = Math.round((Date.now() - started) / 1000);
  if (!opts.silent) {
    if (failed && !changed) toast(`更新失败：${failed} 个源出错`, 'bad');
    else if (changed) toast(`更新完成：${changed} 个源有变化，新增 ${added} / 移除 ${removed} 个频道（${secs}s）`, 'ok');
    else toast('所有源均无变化（已用 ETag 跳过下载）');
  } else if (changed) {
    toast(`自动更新：新增 ${added} / 移除 ${removed} 个频道`, 'ok');
  }
  scheduleNext();
}

/* =======================================================================
 * 频道合并与筛选
 * ===================================================================== */

function rebuildChannels() {
  const lists = [];
  for (const s of enabledSources()) {
    const entries = state.sourceEntries.get(s.id);
    if (entries && entries.length) lists.push(entries);
  }
  state.channels = mergeChannels(lists);
  state.byKey = new Map(state.channels.map((c) => [c.key, c]));
  // 收藏/最近引用的频道若已消失，补一份快照，避免收藏列表变空
  for (const snap of state.recent) {
    if (!state.byKey.has(snap.key)) state.byKey.set(snap.key, { ...snap, key: snap.key, alts: [] });
  }
}

function filteredChannels() {
  const q = state.search.trim().toLowerCase();
  const qn = normalizeName(state.search);
  let list = state.channels;

  if (state.view === 'fav') list = list.filter((c) => state.favorites.has(c.key));
  else if (state.view === 'recent') {
    const order = new Map(state.recent.map((r, i) => [r.key, i]));
    list = list.filter((c) => order.has(c.key)).sort((a, b) => order.get(a.key) - order.get(b.key));
  } else if (state.view === 'offline') list = list.filter((c) => healthOf(c.key) === 'offline');

  if (state.settings.hideOffline) list = list.filter((c) => healthOf(c.key) !== 'offline');
  if (state.group) list = list.filter((c) => c.group === state.group);
  if (state.country) list = list.filter((c) => c.country === state.country);
  if (q) {
    list = list.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        normalizeName(c.name).includes(qn) ||
        (c.tvgId || '').toLowerCase().includes(q) ||
        (c.group || '').toLowerCase().includes(q)
    );
  }

  if (state.sort === 'name') list = sortChannels(list);
  else if (state.sort === 'group') list = sortChannels(list);
  else list = [...list].sort((a, b) => (a.sourceName || '').localeCompare(b.sourceName || '') || a.name.localeCompare(b.name, 'zh-Hans-CN'));
  return list;
}

function healthOf(key) {
  return state.health.get(key)?.status || 'unknown';
}

/* =======================================================================
 * 渲染
 * ===================================================================== */

const RENDER_CHUNK = 120;

function renderChannelList() {
  const grid = $('#channels');
  const list = filteredChannels();
  $('#channel-title').textContent = `频道 · ${list.length}`;
  $('#search-count').textContent = state.search ? `${list.length}` : '';
  $('#empty').hidden = list.length > 0;
  grid.innerHTML = '';

  const token = ++renderToken;
  let i = 0;
  const step = () => {
    if (token !== renderToken) return; // 已有更新的渲染任务，丢弃本次
    const frag = document.createDocumentFragment();
    const end = Math.min(i + RENDER_CHUNK, list.length);
    for (; i < end; i++) frag.appendChild(channelCard(list[i]));
    grid.appendChild(frag);
    if (i < list.length) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function channelCard(c) {
  const node = el('div', 'ch');
  node.dataset.key = c.key;
  if (state.playing && state.playing.key === c.key) node.classList.add('active');

  const logo = el('div', 'ch-logo');
  if (c.logo) {
    const img = el('img');
    img.src = c.logo;
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    logo.appendChild(img);
  } else {
    logo.textContent = '📺';
  }
  node.appendChild(logo);

  const info = el('div', 'ch-info');
  info.appendChild(el('div', 'ch-name', c.name));
  const bits = [groupLabel(c.group)];
  if (c.country) bits.push(c.country.toUpperCase());
  if (c.feed) bits.push(c.feed);
  info.appendChild(el('div', 'ch-sub', bits.filter(Boolean).join(' · ')));
  node.appendChild(info);

  const st = healthOf(c.key);
  if (st !== 'unknown') {
    const dot = el('i', `ch-dot ${st}`);
    dot.title = st === 'online' ? '可播放' : st === 'reachable' ? '地址可达' : '失效';
    node.appendChild(dot);
  }
  if (state.favorites.has(c.key)) node.appendChild(el('span', 'ch-star', '★'));

  node.addEventListener('click', () => playChannel(c));
  return node;
}

function renderFilters() {
  const groups = new Map();
  const countries = new Map();
  for (const c of state.channels) {
    groups.set(c.group, (groups.get(c.group) || 0) + 1);
    if (c.country) countries.set(c.country, (countries.get(c.country) || 0) + 1);
  }
  fillFilterList($('#group-filters'), [...groups.entries()].sort((a, b) => b[1] - a[1]), state.group, (v) => {
    state.group = v;
    renderChannelList();
  });
  fillFilterList($('#country-filters'), [...countries.entries()].sort((a, b) => b[1] - a[1]), state.country, (v) => {
    state.country = v;
    renderChannelList();
  });
}

function fillFilterList(ul, entries, active, onPick) {
  ul.innerHTML = '';
  const all = el('li');
  const allBtn = el('button', 'filter' + (active ? '' : ' active'), '全部');
  allBtn.innerHTML = '全部<span class="n"></span>';
  allBtn.addEventListener('click', () => onPick(''));
  all.appendChild(allBtn);
  ul.appendChild(all);
  for (const [name, n] of entries) {
    const li = el('li');
    const btn = el('button', 'filter' + (name === active ? ' active' : ''));
    btn.innerHTML = `<span>${escapeHtml(groupLabel(name))}</span><span class="n">${n}</span>`;
    btn.addEventListener('click', () => onPick(name));
    li.appendChild(btn);
    ul.appendChild(li);
  }
}

function updateStatusBar(text) {
  const node = $('#status-text');
  if (text) {
    node.textContent = text;
    return;
  }
  const srcCount = enabledSources().length;
  const chCount = state.channels.length;
  const t = state.lastUpdateAt;
  const when = t ? `${Math.round((Date.now() - t) / 60000)} 分钟前` : '尚未更新';
  const offline = [...state.health.values()].filter((h) => h.status === 'offline').length;
  node.textContent = `已启用 ${srcCount} 个源 · ${chCount} 个频道 · 上次更新 ${when}${offline ? ` · ${offline} 个失效` : ''}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/* =======================================================================
 * 播放
 * ===================================================================== */

function playChannel(c) {
  const entry = state.byKey.get(c.key) || c;
  state.playing = entry;
  $('#now-title').textContent = entry.name;
  $('#now-sub').textContent = [groupLabel(entry.group), entry.country ? entry.country.toUpperCase() : '', entry.sourceName].filter(Boolean).join(' · ');
  $('#player-badge').textContent = `正在连接：${entry.name}`;
  $('#player-spinner').hidden = false;
  player.play({
    ...entry,
    url: state.settings.useProxyStreams === false ? entry.url : withProxy(entry.url),
    alts: (entry.alts || []).map((a) => ({ ...a, url: state.settings.useProxyStreams === false ? a.url : withProxy(a.url) })),
  });
  store.pushRecent({ key: entry.key, name: entry.name, logo: entry.logo, group: entry.group, url: entry.url });
  state.recent = store.getRecent();
  updateFavButton();
  renderChannelList();
  showEpgFor(entry);
  if (state.settings.checkHealth) markHealth(entry.key, 'unknown');
}

function handlePlayerState(kind, payload) {
  const badge = $('#player-badge');
  if (kind === 'manifest-parsed' || kind === 'manifest-loaded') {
    $('#player-spinner').hidden = true;
    markHealth(state.playing?.key, 'online');
    badge.textContent = `${state.playing?.name || ''} · ${player.mode}`;
  } else if (kind === 'retry') {
    badge.textContent = payload?.reason || '重试中…';
  } else if (kind === 'alt') {
    badge.textContent = `切换备用线路：${payload?.sourceName || ''}`;
  } else if (kind === 'fatal') {
    $('#player-spinner').hidden = true;
    markHealth(state.playing?.key, 'offline');
    badge.textContent = '播放失败';
  } else if (kind === 'loading') {
    $('#player-spinner').hidden = false;
  } else if (kind === 'stopped') {
    $('#player-spinner').hidden = true;
  }
}

function markHealth(key, status, rerender = true) {
  if (!key) return;
  const prev = state.health.get(key);
  if (prev?.status === status) return;
  state.health.set(key, { status, at: Date.now() });
  if (rerender) {
    renderChannelList();
    updateStatusBar();
  }
}

function fillQuality(levels, current) {
  const sel = $('#quality');
  if (!levels || !levels.length) {
    sel.hidden = true;
    return;
  }
  sel.hidden = false;
  sel.innerHTML = '';
  const auto = el('option', '', '自动画质');
  auto.value = '-1';
  sel.appendChild(auto);
  levels.forEach((l) => {
    const o = el('option', '', l.name);
    o.value = String(l.index);
    sel.appendChild(o);
  });
  sel.value = String(current ?? -1);
  sel.onchange = () => player.setLevel(Number(sel.value));
}

function stepChannel(delta) {
  const list = filteredChannels();
  if (!list.length) return;
  const idx = state.playing ? list.findIndex((c) => c.key === state.playing.key) : -1;
  const next = list[(idx + delta + list.length) % list.length] || list[0];
  playChannel(next);
}

/** 批量体检：对当前列表里的频道并发探测可用性 */
async function runHealthCheck() {
  const list = filteredChannels().slice(0, 40);
  // 有本地代理时走代理：能读到 m3u8 清单，判定才准确
  const probeList = list.map((c) => ({
    ...c,
    url: state.settings.useProxyStreams === false ? c.url : withProxy(c.url),
  }));
  if (!list.length) return toast('当前列表为空', 'bad');
  const btn = $('#btn-health');
  btn.disabled = true;
  let done = 0;
  try {
    await probeMany(
      probeList,
      (item, status) => {
        done++;
        markHealth(item.key, status, false);
        updateStatusBar(`检测中 ${done}/${probeList.length}`);
      },
      { concurrency: 4, timeoutMs: 5000 }
    );
    renderChannelList();
    const bad = list.filter((c) => healthOf(c.key) === 'offline').length;
    toast(`体检完成：${list.length} 个频道中 ${bad} 个失效`, bad ? 'bad' : 'ok');
  } finally {
    btn.disabled = false;
    updateStatusBar();
  }
}

function toggleFavorite() {
  if (!state.playing) return;
  const key = state.playing.key;
  if (state.favorites.has(key)) {
    state.favorites.delete(key);
    store.toggleFavorite(key);
    toast('已取消收藏');
  } else {
    state.favorites.add(key);
    store.toggleFavorite(key);
    toast('已收藏');
  }
  updateFavButton();
  renderChannelList();
}

function updateFavButton() {
  const btn = $('#btn-fav');
  const on = state.playing && state.favorites.has(state.playing.key);
  btn.textContent = on ? '★ 已收藏' : '☆ 收藏';
}

/* =======================================================================
 * EPG
 * ===================================================================== */

async function loadEpgIfConfigured() {
  const url = state.settings.epgUrl?.trim();
  if (!url) return;
  try {
    state.epg = await loadEpg(url);
    if (state.playing) showEpgFor(state.playing);
  } catch (err) {
    toast(`EPG 加载失败：${err.message}`, 'bad');
  }
}

function showEpgFor(entry) {
  const strip = $('#epg-strip');
  if (!state.epg || !entry) {
    strip.hidden = true;
    return;
  }
  const ids = [entry.tvgId, entry.channelId].filter(Boolean);
  const info = nowNext(state.epg, ids);
  if (!info) {
    strip.hidden = true;
    return;
  }
  const fmt = (t) =>
    t
      ? new Date(t).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      : '';
  strip.hidden = false;
  strip.innerHTML = `正在播出：<b>${escapeHtml(info.now?.title || '—')}</b> ${fmt(info.now?.start)} · 稍后：<b>${escapeHtml(info.next?.title || '—')}</b> ${fmt(info.next?.start)}`;
}

/* =======================================================================
 * 抽屉：源管理 / 设置
 * ===================================================================== */

function openDrawer(mode) {
  $('#drawer').hidden = false;
  $('#scrim').hidden = false;
  $('#btn-drawer-close').hidden = false;
  $('#drawer-title').textContent = mode === 'sources' ? '直播源管理' : '设置';
  if (mode === 'sources') renderSourceDrawer();
  else renderSettingsDrawer();
}

function closeDrawer() {
  $('#drawer').hidden = true;
  $('#scrim').hidden = true;
  $('#btn-drawer-close').hidden = true;
}

function renderSourceDrawer() {
  const body = $('#drawer-body');
  body.innerHTML = '';
  const states = store.getSourceState();

  const bar = el('div', 'row');
  const upd = el('button', 'btn primary', '⟳ 立即更新全部');
  upd.addEventListener('click', () => runUpdate({}));
  bar.appendChild(upd);
  const addAll = el('button', 'btn', '启用全部内置源');
  addAll.addEventListener('click', () => {
    state.enabled = new Set(state.sources.filter((s) => s.kind === 'builtin').map((s) => s.id));
    store.setEnabledIds([...state.enabled]);
    renderSourceDrawer();
    rebuildChannels();
    renderChannelList();
    renderFilters();
    runUpdate({});
  });
  bar.appendChild(addAll);
  body.appendChild(bar);

  body.appendChild(el('h3', '', '内置源（GitHub）'));
  const groups = sourceGroups(state.sources.filter((s) => s.kind === 'builtin'));
  for (const g of groups) {
    const details = el('details', 'src-group');
    const sum = el('summary', '', `${g.name}（${g.items.length}）`);
    details.appendChild(sum);
    for (const s of g.items) details.appendChild(sourceRow(s, states[s.id]));
    body.appendChild(details);
  }

  const customs = state.sources.filter((s) => s.kind === 'custom');
  body.appendChild(el('h3', '', '自定义源'));
  if (!customs.length) body.appendChild(el('p', 'hint', '还没有自定义源。'));
  for (const s of customs) body.appendChild(sourceRow(s, states[s.id]));

  body.appendChild(el('h3', '', '添加自定义 M3U'));
  const form = el('div', 'field');
  const nameIn = el('input');
  nameIn.type = 'text';
  nameIn.placeholder = '名称，例如：我的直播源';
  const urlIn = el('input');
  urlIn.type = 'url';
  urlIn.placeholder = 'https://example.com/playlist.m3u';
  form.appendChild(nameIn);
  form.appendChild(urlIn);
  const addBtn = el('button', 'btn primary', '添加');
  addBtn.addEventListener('click', () => {
    const url = urlIn.value.trim();
    if (!url) return toast('请填写地址', 'bad');
    const list = store.getCustomSources();
    const id = `custom:${Date.now()}`;
    list.push({ id, name: nameIn.value.trim() || '自定义源', url, group: '自定义源', kind: 'custom' });
    store.saveCustomSources(list);
    state.enabled.add(id);
    store.setEnabledIds([...state.enabled]);
    buildSources();
    renderSourceDrawer();
    runUpdate({});
    toast('已添加并开始更新');
  });
  form.appendChild(addBtn);
  body.appendChild(form);
  body.appendChild(
    el(
      'p',
      'hint',
      '提示：直播服务器大多不带 CORS 头，若直连失败，可在「设置」里填 CORS 代理模板（用 {url} 占位）。'
    )
  );
}

function sourceRow(s, st) {
  const row = el('div', 'src-item');
  const cb = el('input');
  cb.type = 'checkbox';
  cb.checked = state.enabled.has(s.id);
  cb.addEventListener('change', () => {
    if (cb.checked) state.enabled.add(s.id);
    else state.enabled.delete(s.id);
    store.setEnabledIds([...state.enabled]);
    rebuildChannels();
    renderChannelList();
    renderFilters();
    if (cb.checked) runUpdate({});
  });
  row.appendChild(cb);

  const grow = el('div', 'grow');
  grow.appendChild(el('span', 'nm', s.name));
  const info = st?.lastChecked
    ? `${st.count ?? '?'} 频道 · 更新于 ${new Date(st.lastChecked).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`
    : '尚未更新';
  const status = el('span', 'st' + (st?.error ? ' bad' : st?.lastChecked ? ' ok' : ''), st?.error ? `失败：${st.error}` : info);
  grow.appendChild(status);
  row.appendChild(grow);

  const refresh = el('button', 'btn small', '⟳');
  refresh.title = '立即更新该源';
  refresh.addEventListener('click', async () => {
    refresh.disabled = true;
    const states = store.getSourceState();
    const r = await updateSource(s, states[s.id] || {}, {
      proxy: state.settings.proxy,
      sameOrigin: state.settings.useProxyStreams === false ? '' : sameOriginPrefix(),
    });
    if (r.ok && !r.notModified) {
      state.sourceEntries.set(s.id, r.entries);
      await store.cacheChannels(s.id, r.entries);
      store.setSourceState(s.id, {
        etag: r.etag,
        lastModified: r.lastModified,
        hash: r.hash,
        lastChecked: Date.now(),
        lastChanged: Date.now(),
        count: r.count,
      });
      rebuildChannels();
      renderChannelList();
      renderFilters();
      toast(`${s.name}：+${r.added} / -${r.removed}`, 'ok');
    } else if (r.ok) {
      toast(`${s.name}：无变化`);
    } else {
      toast(`${s.name}：更新失败 ${r.error}`, 'bad');
    }
    refresh.disabled = false;
    renderSourceDrawer();
  });
  row.appendChild(refresh);

  if (s.repo) {
    const gh = el('button', 'btn small', '🐙');
    gh.title = `查看 GitHub 仓库 ${s.repo} 的最新提交`;
    gh.addEventListener('click', async () => {
      gh.disabled = true;
      const info2 = await githubLatestCommit(s.repo, s.path);
      gh.disabled = false;
      if (!info2.ok) return toast(`GitHub 查询失败：${info2.error}`, 'bad');
      const d = info2.date ? new Date(info2.date).toLocaleString('zh-CN') : '—';
      toast(`${s.repo} 最新提交：${d}\n${info2.message}`, 'ok');
    });
    row.appendChild(gh);
  }

  if (s.kind === 'custom') {
    const del = el('button', 'btn small', '🗑');
    del.title = '删除';
    del.addEventListener('click', () => {
      const list = store.getCustomSources().filter((x) => x.id !== s.id);
      store.saveCustomSources(list);
      state.enabled.delete(s.id);
      store.setEnabledIds([...state.enabled]);
      buildSources();
      renderSourceDrawer();
      rebuildChannels();
      renderChannelList();
    });
    row.appendChild(del);
  }
  return row;
}

function renderSettingsDrawer() {
  const body = $('#drawer-body');
  body.innerHTML = '';
  const s = state.settings;

  body.appendChild(el('h3', '', '自动更新'));
  body.appendChild(
    toggleField('启用自动更新', s.autoUpdate, (v) => {
      state.settings = store.setSettings({ autoUpdate: v });
      if (v) scheduleNext();
      else clearTimeout(state.timer);
    })
  );
  body.appendChild(
    numberField('更新间隔（分钟）', s.updateIntervalMin, 5, 1440, (v) => {
      state.settings = store.setSettings({ updateIntervalMin: v });
      scheduleNext();
    })
  );
  body.appendChild(
    el(
      'p',
      'hint',
      '更新使用 ETag / Last-Modified 条件请求：服务端返回 304 时不会重复下载，流量几乎为零。'
    )
  );

  body.appendChild(el('h3', '', '播放'));
  body.appendChild(
    toggleField('隐藏失效频道', s.hideOffline, (v) => {
      state.settings = store.setSettings({ hideOffline: v });
      $('#chk-hide-offline').checked = v;
      renderChannelList();
    })
  );
  body.appendChild(
    toggleField('播放时检查频道可用性', s.checkHealth, (v) => {
      state.settings = store.setSettings({ checkHealth: v });
    })
  );

  body.appendChild(el('h3', '', '网络'));
  body.appendChild(
    toggleField(`通过本地代理播放${streamProxy ? '（已检测到）' : '（未检测到，仅在 vite/serve 启动时可用）'}`, state.settings.useProxyStreams !== false, (v) => {
      state.settings = store.setSettings({ useProxyStreams: v });
      toast(v ? '已启用代理播放' : '已关闭代理播放');
    })
  );
  body.appendChild(
    textField('CORS 代理模板（可选）', s.proxy, 'https://api.allorigins.win/raw?url={url}', (v) => {
      state.settings = store.setSettings({ proxy: v });
    })
  );
  body.appendChild(el('p', 'hint', '仅在直连被浏览器 CORS 策略拦截时才使用代理；{url} 会被替换成源地址。'));

  body.appendChild(el('h3', '', '节目单（EPG）'));
  body.appendChild(
    textField('XMLTV 地址（可选）', s.epgUrl, 'https://example.com/epg.xml.gz', (v) => {
      state.settings = store.setSettings({ epgUrl: v });
      state.epg = null;
      loadEpgIfConfigured();
    })
  );

  body.appendChild(el('h3', '', '维护'));
  const row = el('div', 'row');
  const clear = el('button', 'btn', '清除本地缓存');
  clear.addEventListener('click', async () => {
    await store.clearCache();
    state.sourceEntries.clear();
    rebuildChannels();
    renderChannelList();
    toast('缓存已清除');
  });
  row.appendChild(clear);
  const reset = el('button', 'btn', '恢复默认源');
  reset.addEventListener('click', () => {
    store.setEnabledIds(DEFAULT_ENABLED);
    buildSources();
    renderSettingsDrawer();
    rebuildChannels();
    renderChannelList();
    runUpdate({});
  });
  row.appendChild(reset);
  body.appendChild(row);

  body.appendChild(el('h3', '', '关于'));
  body.appendChild(
    el(
      'p',
      'hint',
      'IPTV 剧场 · 频道数据来自 GitHub 上的公开项目（iptv-org/iptv、Free-TV/IPTV 等），仅用于技术演示，请遵守各源的使用条款。'
    )
  );
}

function toggleField(label, value, onChange) {
  const f = el('div', 'field');
  const l = el('label', 'switch');
  const i = el('input');
  i.type = 'checkbox';
  i.checked = !!value;
  i.addEventListener('change', () => onChange(i.checked));
  l.appendChild(i);
  l.appendChild(el('span', '', label));
  f.appendChild(l);
  return f;
}

function numberField(label, value, min, max, onChange) {
  const f = el('div', 'field');
  f.appendChild(el('label', '', label));
  const i = el('input');
  i.type = 'number';
  i.min = min;
  i.max = max;
  i.value = value;
  i.addEventListener('change', () => onChange(Math.max(min, Math.min(max, Number(i.value) || min))));
  f.appendChild(i);
  return f;
}

function textField(label, value, placeholder, onChange) {
  const f = el('div', 'field');
  f.appendChild(el('label', '', label));
  const i = el('input');
  i.type = 'text';
  i.value = value || '';
  i.placeholder = placeholder;
  i.addEventListener('change', () => onChange(i.value.trim()));
  f.appendChild(i);
  return f;
}

/* =======================================================================
 * 交互绑定
 * ===================================================================== */

function bindUI() {
  $('#btn-update').addEventListener('click', () => runUpdate({}));
  $('#btn-sources').addEventListener('click', () => openDrawer('sources'));
  $('#btn-settings').addEventListener('click', () => openDrawer('settings'));
  $('#btn-drawer-close').addEventListener('click', closeDrawer);
  $('#scrim').addEventListener('click', closeDrawer);

  $('#search').addEventListener('input', (e) => {
    state.search = e.target.value;
    renderChannelList();
  });

  $('#view-filters').addEventListener('click', (e) => {
    const btn = e.target.closest('.filter');
    if (!btn) return;
    state.view = btn.dataset.view;
    for (const b of document.querySelectorAll('#view-filters .filter')) b.classList.toggle('active', b === btn);
    renderChannelList();
  });

  $('#sort').addEventListener('change', (e) => {
    state.sort = e.target.value;
    renderChannelList();
  });

  $('#chk-hide-offline').checked = !!state.settings.hideOffline;
  $('#chk-hide-offline').addEventListener('change', (e) => {
    state.settings = store.setSettings({ hideOffline: e.target.checked });
    renderChannelList();
  });

  $('#btn-fav').addEventListener('click', toggleFavorite);
  $('#btn-health').addEventListener('click', runHealthCheck);
  $('#btn-prev').addEventListener('click', () => stepChannel(-1));
  $('#btn-next').addEventListener('click', () => stepChannel(1));

  // 图片加载失败 → 回退到 📺
  $('#channels').addEventListener('error', (e) => {
    const img = e.target;
    if (img.tagName === 'IMG') {
      img.remove();
      const box = img.parentElement;
      if (box && !box.textContent) box.textContent = '📺';
    }
  }, true);

  video.volume = Math.max(0, Math.min(1, state.settings.volume ?? 1));
  video.addEventListener('volumechange', () => {
    state.settings = store.setSettings({ volume: video.volume });
  });

  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    switch (e.key) {
      case '/':
        e.preventDefault();
        $('#search').focus();
        break;
      case ' ':
        e.preventDefault();
        video.paused ? video.play() : video.pause();
        break;
      case 'ArrowRight':
        stepChannel(1);
        break;
      case 'ArrowLeft':
        stepChannel(-1);
        break;
      case 'f':
        toggleFavorite();
        break;
      case 'm':
        video.muted = !video.muted;
        break;
      case 'Escape':
        closeDrawer();
        break;
      default:
        break;
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.settings.autoUpdate && isStale()) runUpdate({ silent: true });
  });
}

function applyTheme() {
  document.documentElement.dataset.theme = state.settings.theme || 'dark';
}

function toast(msg, kind = '') {
  const node = el('div', `toast ${kind}`, msg);
  node.style.whiteSpace = 'pre-line';
  $('#toasts').appendChild(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transition = 'opacity .4s';
    setTimeout(() => node.remove(), 400);
  }, 4200);
}

/* 暴露给无头测试用 */
window.__iptv = {
  state,
  runUpdate,
  playChannel,
  filteredChannels,
  store,
  getStreamProxy: () => streamProxy,
  withProxy,
  stop: () => player.stop(),
  health: () => [...state.health.entries()],
  get player() {
    return player;
  },
};

init();
