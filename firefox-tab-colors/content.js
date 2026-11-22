/**
 * 彩色标签 · 内容脚本
 *
 * 作用（Firefox 没有原生 per-tab 颜色/标题 API，只能靠改页面）：
 *   1. 强制标题前缀：document.title = "🔴 [工作] 原标题" → 标签栏立刻可见
 *   2. 彩色图标：把 <link rel="icon"> 换成彩色图标（色环包住站点 favicon，或纯色块）
 * 并监听页面后续对标题/图标的改动，随时补上前缀。
 *
 * 注意：本脚本可能被重复注入（动态注册 + executeScript 兜底），
 * 所以必须做单例保护，否则多个实例会互相叠加标题前缀。
 */
(function () {
  const api = globalThis.browser ?? globalThis.chrome;
  const TC = globalThis.TC;

  // 单例保护：同一扩展在同一文档里共享同一个 sandbox
  if (globalThis.__tcMarkerInstalled) {
    console.debug('[TC] 内容脚本已安装，跳过重复注入');
    return;
  }
  globalThis.__tcMarkerInstalled = true;

  const ALL_EMOJIS = ['🔴', '🟠', '🟡', '🟢', '🔵', '🟦', '🟪', '🌸', '⚪'];

  let marker = null;
  let settings = { titlePrefix: true, colorFavicon: true, iconMode: 'ring', prefixText: '', prefixTemplate: '{emoji} {text}' };
  let favIconUrl = '';

  let lastAppliedTitle = null;   // 我们最后一次写入的标题
  let lastOriginalTitle = '';    // 页面原始标题
  const usedPrefixes = new Set();// 用过的前缀（完整形态，如 "🔴 工作"），剥离时需要
  let currentIconUri = '';       // 当前生效的图标 data URI
  const iconOrigins = [];         // [{link, href}] 记录原始图标以便还原
  let timer = 0;

  /* ---------------------------------------------------------------- */
  /* 标题                                                              */
  /* ---------------------------------------------------------------- */

  /** 去掉（可能叠加了多层的）标题前缀，还原出页面原始标题 */
  function stripPrefix(text) {
    let t = text;
    for (let round = 0; round < 8; round++) {
      let hit = false;
      for (const p of usedPrefixes) {
        if (p && t.startsWith(p)) {
          t = t.slice(p.length).trimStart();
          hit = true;
          break;
        }
      }
      if (!hit) {
        for (const e of ALL_EMOJIS) {
          if (t.startsWith(e)) {
            t = t.slice(e.length).trimStart();
            hit = true;
            break;
          }
        }
      }
      if (!hit) break;
    }
    return t;
  }

  function updateTitle() {
    stats.update++;
    if (!marker || !settings.titlePrefix) {
      // 不需要前缀：如果之前加过，先还原
      if (lastAppliedTitle !== null && document.title === lastAppliedTitle) {
        document.title = lastOriginalTitle;
        lastAppliedTitle = null;
      }
      return;
    }
    const raw = document.title;
    if (!raw) return; // 页面还没设置标题
    let original;
    if (lastAppliedTitle !== null && raw === lastAppliedTitle) {
      original = lastOriginalTitle; // 页面没动标题
    } else {
      original = stripPrefix(raw);  // 页面自己改了标题（或别的前缀残留）
    }
    lastOriginalTitle = original;
    const prefix = TC.buildPrefix(marker, settings);
    if (!prefix) return;
    usedPrefixes.add(prefix);
    const next = prefix + original;
    if (raw !== next) {
      stats.applied++;
      lastAppliedTitle = next;
      try {
        document.title = next;
      } catch { /* ignore */ }
    }
  }

  /* ---------------------------------------------------------------- */
  /* 图标                                                              */
  /* ---------------------------------------------------------------- */

  function solidSvg(hex) {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
      `<rect x="1" y="1" width="30" height="30" rx="9" fill="${hex}"/>` +
      `<circle cx="16" cy="16" r="6" fill="#ffffff" fill-opacity="0.92"/>` +
      `</svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  /** 用 canvas 把「彩色圆环 + 站点 favicon」合成一张图 */
  function composeWithFavicon(hex, dataUri) {
    return new Promise((resolve) => {
      try {
        const img = new Image();
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = 32;
            canvas.height = 32;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, 32, 32);
            // 外圈颜色
            ctx.fillStyle = hex;
            ctx.beginPath();
            ctx.arc(16, 16, 15, 0, Math.PI * 2);
            ctx.fill();
            // 内圈白底（站点图标常常是透明的）
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(16, 16, 11.5, 0, Math.PI * 2);
            ctx.fill();
            // 站点图标
            const size = 18;
            ctx.drawImage(img, (32 - size) / 2, (32 - size) / 2, size, size);
            resolve(canvas.toDataURL('image/png'));
          } catch {
            resolve(null);
          }
        };
        img.onerror = () => resolve(null);
        img.src = dataUri;
      } catch {
        resolve(null);
      }
    });
  }

  async function buildIconUri() {
    const hex = TC.color(marker.color).hex;
    if (settings.iconMode === 'ring' && favIconUrl && favIconUrl.startsWith('data:')) {
      const composed = await composeWithFavicon(hex, favIconUrl);
      if (composed) return composed;
    }
    return solidSvg(hex);
  }

  function iconLinks() {
    let links = Array.from(document.querySelectorAll('link[rel~="icon"]'));
    if (!links.length) {
      const host = document.head || document.documentElement;
      if (!host) return [];
      const link = document.createElement('link');
      link.rel = 'icon';
      link.type = 'image/png';
      host.appendChild(link);
      links = [link];
    }
    return links;
  }

  async function updateIcon() {
    if (!marker || !settings.colorFavicon) return;
    const uri = await buildIconUri();
    if (!uri) return;
    currentIconUri = uri;
    for (const link of iconLinks()) {
      if (!iconOrigins.some((e) => e.link === link)) {
        iconOrigins.push({ link, href: link.getAttribute('href') });
      }
      if (link.getAttribute('href') !== uri) {
        try {
          link.setAttribute('href', uri);
        } catch { /* ignore */ }
      }
    }
  }

  function restoreIcons() {
    for (const entry of iconOrigins) {
      try {
        if (entry.href == null) entry.link.remove();
        else entry.link.setAttribute('href', entry.href);
      } catch { /* ignore */ }
    }
    iconOrigins.length = 0;
    currentIconUri = '';
  }

  /* ---------------------------------------------------------------- */
  /* 应用 / 还原                                                       */
  /* ---------------------------------------------------------------- */

  function applyMarker(nextMarker, nextSettings, nextFavIconUrl) {
    marker = nextMarker || null;
    if (nextSettings) settings = Object.assign(settings, nextSettings);
    if (nextFavIconUrl !== undefined) favIconUrl = nextFavIconUrl || '';
    if (!marker) {
      restore();
      return;
    }
    updateTitle();
    updateIcon();
    schedule();
  }

  function restore() {
    if (lastAppliedTitle !== null && document.title === lastAppliedTitle) {
      try {
        document.title = lastOriginalTitle;
      } catch { /* ignore */ }
    }
    lastAppliedTitle = null;
    lastOriginalTitle = '';
    usedPrefixes.clear();
    restoreIcons();
    marker = null;
  }

  /* ---------------------------------------------------------------- */
  /* 监听页面改动                                                      */
  /* ---------------------------------------------------------------- */

  function schedule() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = 0;
      updateTitle();
      // 图标被页面换掉了才重画，避免频繁 canvas 合成
      const links = document.querySelectorAll('link[rel~="icon"]');
      let hijacked = false;
      for (const link of links) {
        const href = link.getAttribute('href');
        if (href && href !== currentIconUri) {
          hijacked = true;
          break;
        }
      }
      if (hijacked) updateIcon();
    }, 60);
  }

  let observer = null;
  const stats = { obs: 0, update: 0, applied: 0 };

  function startObserver() {
    if (!document.documentElement) return;
    try {
      observer = new MutationObserver(() => { stats.obs++; schedule(); });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['href', 'rel'],
      });
    } catch (e) {
      console.warn('[TC] observer 失败', e);
    }
  }

  /* ---------------------------------------------------------------- */
  /* 与后台通信                                                        */
  /* ---------------------------------------------------------------- */

  api.runtime.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== 'object') return undefined;
    if (msg.type === 'tc:apply') {
      applyMarker(msg.marker, msg.settings, msg.favIconUrl);
      return Promise.resolve({ ok: true });
    }
    if (msg.type === 'tc:restore') {
      restore();
      return Promise.resolve({ ok: true });
    }
    if (msg.type === 'tc:ping') {
      return Promise.resolve({
        ok: true,
        marker,
        lastAppliedTitle,
        lastOriginalTitle,
        usedPrefixes: [...usedPrefixes],
        hasObserver: !!observer,
        stats,
        hasTC: !!TC,
        titlePrefix: settings.titlePrefix,
      });
    }
    return undefined;
  });

  api.runtime.sendMessage({ type: 'tc:hello' })
    .then((res) => {
      if (!res) return;
      if (res.settings) settings = Object.assign(settings, res.settings);
      if (res.favIconUrl) favIconUrl = res.favIconUrl;
      if (res.marker) applyMarker(res.marker, res.settings, res.favIconUrl);
    })
    .catch(() => { /* 后台还没起来，忽略 */ });

  if (document.documentElement) {
    startObserver();
  } else {
    document.addEventListener('readystatechange', function onReady() {
      if (document.documentElement) {
        document.removeEventListener('readystatechange', onReady);
        startObserver();
      }
    });
  }
})();
