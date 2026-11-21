/**
 * 中药大全 · 历史查询存储层（不依赖 DOM）
 *
 * 浏览器：普通 <script> 引入后挂到 window.TCMStorage
 * Node  ：new Function(src)() 之后取 globalThis.TCMStorage
 *
 * 规则（需求定稿 Q6）：
 *   · 上限 50 条；超出淘汰最旧
 *   · 同一关键词合并为一条（按文本去重），hitCount 累加，并移到最前
 *   · 若这次是从详情页进来的（带 refId），把 refId 记上，之后点历史可直接回到详情
 *   · 支持单条删除、一键清空；只存本机 localStorage，无云端
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TCMStorage = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function () {
  'use strict';

  const KEY = 'tcm-herb/history/v1';
  const LIMIT = 50;
  const KINDS = ['herb', 'symptom', 'formula', 'keyword', 'online'];

  function cleanText(v) {
    return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 60);
  }

  function cleanKind(v) {
    return KINDS.indexOf(v) >= 0 ? v : 'keyword';
  }

  function makeId(text) {
    return String(text).toLowerCase();
  }

  function sanitize(list) {
    if (!Array.isArray(list)) return [];
    const seen = Object.create(null);
    const out = [];
    list.forEach(function (raw) {
      if (!raw || typeof raw !== 'object') return;
      const text = cleanText(raw.text);
      if (!text) return;
      const id = makeId(text);
      if (seen[id]) {
        // 同文本的多条：合并次数与时间，保留更具体的 refId
        const prev = seen[id];
        prev.hitCount += Math.max(1, Number(raw.hitCount) || 1);
        prev.ts = Math.max(prev.ts, Number(raw.ts) || 0);
        if (!prev.refId && raw.refId) {
          prev.refId = String(raw.refId);
          prev.kind = cleanKind(raw.kind);
          prev.label = cleanText(raw.label) || prev.label;
        }
        return;
      }
      const item = {
        id: id,
        kind: cleanKind(raw.kind),
        text: text,
        label: cleanText(raw.label) || text,
        refId: raw.refId ? String(raw.refId) : '',
        ts: Number(raw.ts) || 0,
        hitCount: Math.max(1, Number(raw.hitCount) || 1),
      };
      seen[id] = item;
      out.push(item);
    });
    out.sort(function (a, b) { return b.ts - a.ts; });
    return out.slice(0, LIMIT);
  }

  /**
   * @param {{getItem:Function, setItem:Function, removeItem:Function}|null} backing
   */
  function createStore(backing) {
    const memory = [];

    function load() {
      if (!backing) return sanitize(memory);
      try {
        const raw = backing.getItem(KEY);
        if (!raw) return [];
        return sanitize(JSON.parse(raw));
      } catch (e) {
        return [];
      }
    }

    function save(list) {
      const clean = sanitize(list);
      if (!backing) {
        memory.length = 0;
        clean.forEach(function (x) { memory.push(x); });
        return clean;
      }
      try {
        backing.setItem(KEY, JSON.stringify(clean));
      } catch (e) {
        memory.length = 0;
        clean.forEach(function (x) { memory.push(x); });
      }
      return clean;
    }

    function list() {
      return load();
    }

    /**
     * @param {{kind?:string, text:string, label?:string, refId?:string, ts?:number}} entry
     * @returns {{entry:object|null, list:Array}}
     */
    function add(entry) {
      const text = cleanText(entry && entry.text);
      if (!text) return { entry: null, list: load() };
      const now = entry.ts != null && entry.ts !== '' ? Number(entry.ts) : Date.now();
      const current = load();
      const id = makeId(text);
      const found = current.find(function (x) { return x.id === id; });
      const incomingKind = cleanKind(entry.kind);
      const incomingRef = entry.refId ? String(entry.refId) : '';

      let next;
      if (found) {
        found.hitCount += 1;
        found.ts = now;
        found.label = cleanText(entry.label) || found.label;
        if (incomingRef) {
          found.refId = incomingRef;
          found.kind = incomingKind;
        }
        next = [found].concat(current.filter(function (x) { return x.id !== id; }));
      } else {
        next = [{
          id: id,
          kind: incomingKind,
          text: text,
          label: cleanText(entry.label) || text,
          refId: incomingRef,
          ts: now,
          hitCount: 1,
        }].concat(current);
      }
      const saved = save(next);
      return { entry: saved.find(function (x) { return x.id === id; }) || null, list: saved };
    }

    function remove(id) {
      return save(load().filter(function (x) { return x.id !== id; }));
    }

    function clear() {
      return save([]);
    }

    return { KEY: KEY, LIMIT: LIMIT, list: list, add: add, remove: remove, clear: clear };
  }

  function defaultBacking() {
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        const probe = '__tcm_probe__';
        localStorage.setItem(probe, '1');
        localStorage.removeItem(probe);
        return localStorage;
      }
    } catch (e) {
      /* 隐私模式 / file:// 限制：退化为内存 */
    }
    return null;
  }

  let shared = null;
  function store() {
    if (!shared) shared = createStore(defaultBacking());
    return shared;
  }

  return {
    KEY: KEY,
    LIMIT: LIMIT,
    createStore: createStore,
    store: store,
    sanitize: sanitize,
  };
});
