/**
 * 本地持久化：设置 / 收藏 / 最近观看 / 源状态 / 频道缓存。
 *
 * - 小数据（设置、收藏、最近）放 localStorage
 * - 大数据（解析后的频道列表）放 IndexedDB，localStorage 只做兜底
 */

const NS = 'iptv-player';
const LS = {
  settings: `${NS}.settings`,
  favorites: `${NS}.favorites`,
  recent: `${NS}.recent`,
  sources: `${NS}.sources`, // 自定义源 + 启用状态
  sourceState: `${NS}.sourceState`, // 每个源的 etag / 最后更新时间
};

export const DEFAULT_SETTINGS = {
  autoUpdate: true,
  updateIntervalMin: 30, // 自动更新间隔（分钟）
  hideOffline: false, // 隐藏检测为失效的频道
  checkHealth: true, // 播放时顺便做健康检查
  proxy: '', // CORS 代理模板，如 https://api.allorigins.win/raw?url={url}
  epgUrl: '', // XMLTV 节目单地址（可空）
  theme: 'dark',
  volume: 1,
  lastChannel: '',
};

function readLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeLS(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/* ---------------- IndexedDB（频道缓存） ---------------- */

const DB_NAME = 'iptv-player';
const STORE = 'kv';
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    let req;
    try {
      req = indexedDB.open(DB_NAME, 1);
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

async function idbPut(key, value) {
  const db = await openDB();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function idbGet(key) {
  const db = await openDB();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

async function idbDel(key) {
  const db = await openDB();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/* ---------------- 对外 API ---------------- */

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...readLS(LS.settings, {}) };
}

export function setSettings(patch) {
  const next = { ...getSettings(), ...patch };
  writeLS(LS.settings, next);
  return next;
}

export function getFavorites() {
  return readLS(LS.favorites, []);
}

export function toggleFavorite(key) {
  const list = getFavorites();
  const i = list.indexOf(key);
  if (i >= 0) list.splice(i, 1);
  else list.unshift(key);
  writeLS(LS.favorites, list);
  return list;
}

export function isFavorite(key) {
  return getFavorites().includes(key);
}

export function getRecent() {
  return readLS(LS.recent, []);
}

export function pushRecent(entry, limit = 40) {
  const list = getRecent().filter((e) => e.key !== entry.key);
  list.unshift({ key: entry.key, name: entry.name, logo: entry.logo, group: entry.group, url: entry.url, at: Date.now() });
  writeLS(LS.recent, list.slice(0, limit));
  return list;
}

export function getCustomSources() {
  return readLS(LS.sources, []);
}

export function saveCustomSources(list) {
  writeLS(LS.sources, list);
  return list;
}

export function getEnabledIds() {
  return readLS(`${NS}.enabled`, null);
}

export function setEnabledIds(ids) {
  writeLS(`${NS}.enabled`, ids);
  return ids;
}

export function getSourceState() {
  return readLS(LS.sourceState, {});
}

export function setSourceState(id, patch) {
  const all = getSourceState();
  all[id] = { ...(all[id] || {}), ...patch };
  writeLS(LS.sourceState, all);
  return all[id];
}

/** 缓存某个源解析后的频道 */
export async function cacheChannels(sourceId, entries) {
  const ok = await idbPut(`ch:${sourceId}`, entries);
  if (!ok) {
    // 兜底：只缓存小列表，避免撑爆 localStorage
    if (entries.length < 400) writeLS(`${NS}.cache.${sourceId}`, entries);
  }
  return ok;
}

export async function readChannels(sourceId) {
  const fromIdb = await idbGet(`ch:${sourceId}`);
  if (fromIdb) return fromIdb;
  return readLS(`${NS}.cache.${sourceId}`, null);
}

export async function clearCache() {
  const db = await openDB();
  if (db) {
    await new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(`${NS}.cache.`)) localStorage.removeItem(key);
  }
  writeLS(LS.sourceState, {});
}
