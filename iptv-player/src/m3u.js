/**
 * M3U / M3U8 解析器 —— 纯函数，无 DOM 依赖，Node 与浏览器通用。
 *
 * 支持的标签：
 *   #EXTM3U
 *   #EXTINF:<时长> [属性] ,<标题>
 *   #EXTGRP:<分组>
 *   #EXTVLCOPT:<key>=<value>
 *   #EXT-X-... / #PLAYLIST ... （忽略）
 *
 * 典型条目：
 *   #EXTINF:-1 tvg-id="CGTNChina.us@SD" tvg-logo="https://x/y.png" group-title="News",CGTN 中文
 *   https://example.com/live/stream.m3u8
 */

const ATTR_RE = /([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"|([A-Za-z0-9_-]+)\s*=\s*'([^']*)'/g;

/** 解析 `#EXTINF:` 后面的属性串 */
export function parseAttributes(str) {
  const attrs = {};
  if (!str) return attrs;
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(str))) {
    const key = (m[1] || m[3] || '').toLowerCase();
    const val = m[2] !== undefined ? m[2] : m[4] || '';
    if (key) attrs[key] = val;
  }
  return attrs;
}

/** 找到第一个不在引号内的逗号，返回其下标；找不到返回 -1 */
function splitAtComma(str) {
  let quote = null;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ',') {
      return i;
    }
  }
  return -1;
}

/** iptv-org 的 tvg-id 形如 `CGTNChina.us@SD` → { channel:'CGTNChina', country:'us', feed:'SD' } */
export function parseTvgId(tvgId) {
  if (!tvgId) return { channel: '', country: '', feed: '' };
  let rest = tvgId;
  const at = rest.lastIndexOf('@');
  const feed = at >= 0 ? rest.slice(at + 1) : '';
  if (at >= 0) rest = rest.slice(0, at);
  const dot = rest.lastIndexOf('.');
  const country = dot >= 0 ? rest.slice(dot + 1) : '';
  const channel = dot >= 0 ? rest.slice(0, dot) : rest;
  return { channel, country, feed };
}

/** 归一化频道名，便于搜索与去重 */
export function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[\(\[][^\)\]]*[\)\]]/g, ' ') // 去掉 (1080p) [HD] 之类后缀
    .replace(/[_\-–—·・]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 解析 M3U 文本。
 * @param {string} text
 * @param {{id?:string,name?:string}} sourceMeta 该列表的来源信息
 * @returns {{entries:Array, stats:object}}
 */
export function parseM3U(text, sourceMeta = {}) {
  const entries = [];
  const stats = { total: 0, skipped: 0, groups: new Set() };
  if (!text) return { entries, stats };

  const lines = String(text).split(/\r?\n/);
  let pending = null; // 等待 URL 的条目
  let pendingGroup = '';
  let pendingOpts = {};

  const flush = () => {
    if (!pending) return;
    const attrs = pending.attrs || {};
    const tvg = parseTvgId(attrs['tvg-id'] || '');
    const group = pending.group || pendingGroup || attrs['group-title'] || '未分类';
    const name = (pending.name || '').trim() || attrs['tvg-name'] || tvg.channel || pending.url;
    const entry = {
      key: '',
      sourceId: sourceMeta.id || '',
      sourceName: sourceMeta.name || '',
      name,
      url: pending.url,
      logo: attrs['tvg-logo'] || '',
      group: String(group).trim() || '未分类',
      tvgId: attrs['tvg-id'] || '',
      tvgName: attrs['tvg-name'] || '',
      country: tvg.country || attrs['tvg-country'] || '',
      feed: tvg.feed || '',
      channelId: tvg.channel || '',
      attrs,
      headers: {
        'user-agent': attrs['http-user-agent'] || pendingOpts['http-user-agent'] || '',
        referrer: attrs['http-referrer'] || pendingOpts['http-referrer'] || '',
      },
    };
    entry.key = channelKey(entry);
    entries.push(entry);
    stats.total++;
    stats.groups.add(entry.group);
    pending = null;
    pendingGroup = '';
    pendingOpts = {};
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF:')) {
      flush();
      const body = line.slice('#EXTINF:'.length);
      const comma = splitAtComma(body);
      const head = comma >= 0 ? body.slice(0, comma) : body;
      const title = comma >= 0 ? body.slice(comma + 1).trim() : '';
      const sp = head.indexOf(' ');
      const duration = sp >= 0 ? head.slice(0, sp) : head;
      const attrStr = sp >= 0 ? head.slice(sp + 1) : '';
      pending = {
        duration: Number(duration),
        attrs: parseAttributes(attrStr),
        name: title,
        url: '',
        group: '',
      };
      continue;
    }

    if (line.startsWith('#EXTGRP:')) {
      pendingGroup = line.slice('#EXTGRP:'.length).trim();
      if (pending) pending.group = pendingGroup;
      continue;
    }

    if (line.startsWith('#EXTVLCOPT:')) {
      const opt = line.slice('#EXTVLCOPT:'.length).trim();
      const eq = opt.indexOf('=');
      if (eq > 0) pendingOpts[opt.slice(0, eq).trim().toLowerCase()] = opt.slice(eq + 1).trim();
      continue;
    }

    if (line.startsWith('#')) continue; // #EXTM3U / #EXT-X-... / 注释

    // 普通行 = 流地址
    if (pending) {
      pending.url = line;
      flush();
    } else {
      // 没有 #EXTINF 的裸地址
      pending = { duration: -1, attrs: {}, name: '', url: line, group: '' };
      flush();
    }
  }
  flush();

  stats.skipped = lines.length && !entries.length ? 1 : 0;
  return { entries, stats };
}

/** 频道唯一键：优先 tvg-id，其次 url */
export function channelKey(entry) {
  const tvg = (entry.tvgId || '').trim().toLowerCase();
  if (tvg) return 'tvg:' + tvg;
  const url = (entry.url || '').trim().toLowerCase();
  if (url) return 'url:' + url;
  return 'name:' + normalizeName(entry.name);
}

/**
 * 合并多个源的频道：同 key 只保留一条，但记录其它源提供的备用地址。
 * @param {Array<Array>} lists
 */
export function mergeChannels(lists) {
  const map = new Map();
  for (const list of lists) {
    for (const entry of list) {
      const key = entry.key || channelKey(entry);
      const exist = map.get(key);
      if (!exist) {
        map.set(key, { ...entry, key, alts: [] });
        continue;
      }
      // 合并备用地址，保留信息更全的一条作为主条目
      exist.alts.push({ url: entry.url, sourceId: entry.sourceId, sourceName: entry.sourceName, logo: entry.logo });
      if (!exist.logo && entry.logo) exist.logo = entry.logo;
      if (!exist.tvgId && entry.tvgId) {
        exist.tvgId = entry.tvgId;
        exist.key = key;
      }
    }
  }
  return [...map.values()];
}

/** 排序：按分组 → 名称 */
export function sortChannels(list) {
  return [...list].sort((a, b) => {
    const g = a.group.localeCompare(b.group, 'zh-Hans-CN');
    if (g !== 0) return g;
    return a.name.localeCompare(b.name, 'zh-Hans-CN');
  });
}
