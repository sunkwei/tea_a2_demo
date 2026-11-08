/*
 * 后台脚本：所有跨域请求都放在这里做（内容脚本不直接连 tea_a2）。
 */
(function () {
  'use strict';

  const ext = globalThis.browser || globalThis.chrome;
  const Core = globalThis.TeaCore;
  const SETTINGS_KEY = 'settings';

  // ────────────────────────── 设置存取 ──────────────────────────

  async function getSettings() {
    const data = await ext.storage.local.get(SETTINGS_KEY);
    return Core.normalizeSettings(data && data[SETTINGS_KEY]);
  }

  async function saveSettings(settings) {
    const clean = Core.normalizeSettings(settings);
    await ext.storage.local.set({ [SETTINGS_KEY]: clean });
    return clean;
  }

  // ────────────────────────── tea_a2 调用 ──────────────────────────

  // 有些模型不收某个思考强度：minimax 拒 none、mimo 拒 minimal/xhigh/max。
  // 这类报错就沿阶梯换一个档位重试，并记住这个 provider/model 能用哪一档。
  const effortChoice = new Map();
  let effortLoaded = false;

  async function loadEffortChoice() {
    if (effortLoaded) return;
    effortLoaded = true;
    try {
      const data = await ext.storage.local.get('effortChoice');
      if (data && data.effortChoice && typeof data.effortChoice === 'object') {
        for (const k of Object.keys(data.effortChoice)) effortChoice.set(k, data.effortChoice[k]);
      }
    } catch (e) {
      /* 没有就算了 */
    }
  }

  async function saveEffortChoice() {
    try {
      const obj = {};
      for (const [k, v] of effortChoice) obj[k] = v;
      await ext.storage.local.set({ effortChoice: obj });
    } catch (e) {
      /* 存不住也只是下次再试一次 */
    }
  }

  async function chat(body, settings, tried) {
    const s = Core.normalizeSettings(settings);
    await loadEffortChoice();
    const key = (body.provider || s.provider) + '/' + (body.model || s.model);
    const payload = Object.assign({}, body);
    const chosen = effortChoice.get(key);
    if (chosen === 'omit') delete payload.reasoning_effort;
    else if (chosen) payload.reasoning_effort = chosen;
    const url = s.apiBase + '/api/llm/chat';
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      throw new Error('连不上 tea_a2（' + url + '）：' + (e && e.message ? e.message : e));
    }
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (e) {
      /* 非 JSON，后面统一当错误处理 */
    }
    if (!res.ok || !data || data.error) {
      const msg = data && data.error ? data.error.message || data.error.code : text.slice(0, 300);
      const used = tried || [];
      if (payload.reasoning_effort && used.length < 3 && Core.isReasoningError(msg)) {
        const next = Core.nextEffort(payload.reasoning_effort, used);
        if (next) {
          effortChoice.set(key, next);
          await saveEffortChoice();
          const again = await chat(payload, s, used.concat([payload.reasoning_effort]));
          again.effortFallback =
            payload.reasoning_effort + ' → ' + (next === 'omit' ? '不指定' : next);
          return again;
        }
      }
      throw new Error('tea_a2 返回错误：' + msg);
    }
    return data;
  }

  // ────────────────────────── 搜索 ──────────────────────────

  async function fetchSearchResults(query, settings) {
    const s = Core.normalizeSettings(settings);
    const engine = Core.ENGINES[s.searchEngine] || Core.ENGINES.bing;
    if (!engine.parse) return { results: [], url: Core.buildSearchUrl(query, s) };
    const url = Core.buildSearchFetchUrl(query, s) || Core.buildSearchUrl(query, s);
    if (!url) return { results: [], url: '' };
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
          Accept: 'text/html,application/xhtml+xml',
        },
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const html = await res.text();
      const results = Core.parseSearchResults(html, s.searchEngine);
      return { results, url };
    } catch (e) {
      return { results: [], url, error: String(e && e.message ? e.message : e) };
    }
  }

  async function runSearch(text, settings) {
    const s = Core.normalizeSettings(settings);
    const query = String(text || '').trim();
    const useExtension = s.searchMode !== 'api';
    let results = [];
    let error = '';
    const url = Core.buildSearchUrl(query, s);
    if (useExtension) {
      const fetched = await fetchSearchResults(query, s);
      results = fetched.results;
      error = fetched.error || '';
    }

    if (!s.searchAiSummary) {
      return {
        ok: true,
        task: 'search',
        content: results.length ? '已抓到 ' + results.length + ' 条搜索结果。' : '已准备打开搜索结果页。',
        results,
        openUrl: url,
        note: error ? '抓取搜索结果失败（' + error + '），已改为直接打开搜索页。' : '',
      };
    }

    const body = Core.buildSearchBody(query, results, s);
    let data = await chat(body, s);
    // 上游把内部工具调用/搜索计划当正文吐出来时，换个问法再试（最多两次）
    for (const form of [1, 2]) {
      if (!Core.hasSearchArtifact(data.content)) break;
      try {
        const again = await chat(Core.buildSearchBody(query, results, s, { form }), s);
        if (again && again.content && !Core.hasSearchArtifact(again.content)) {
          data = again;
          break;
        }
        if (again && again.content) data = again;
      } catch (e) {
        /* 保持上一次的结果 */
      }
    }
    const content = Core.cleanSearchArtifacts(data.content || '');
    return {
      ok: true,
      task: 'search',
      content,
      reasoning: data.reasoning || '',
      results,
      openUrl: url,
      usage: data.usage || null,
      note:
        (error ? '扩展抓取搜索结果失败（' + error + '），已改用接口作答。' : '') +
        (Core.hasSearchArtifact(data.content)
          ? '（tea_a2 这次只返回了搜索工具调用、没有执行；可在设置里把「搜索方式」改成 extension）'
          : '') +
        (data.effortFallback
          ? '这个模型不接受思考强度「' + data.effortFallback.split(' → ')[0] + '」，已自动降到「' +
            data.effortFallback.split(' → ')[1] + '」。'
          : ''),
    };
  }


  // ────────────────────────── 划图：抓图 + 识图 ──────────────────────────

  function dataUrlToBytes(dataUrl) {
    const parsed = Core.parseDataUrl(dataUrl);
    const bin = atob(parsed.base64 || '');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function bytesToBase64(bytes) {
    let out = '';
    const chunk = 0x8000; // 分块转，避免 apply 的参数上限
    for (let i = 0; i < bytes.length; i += chunk) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(out);
  }

  async function blobToBase64(blob) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    return { base64: bytesToBase64(buf), mime: blob.type || 'image/png' };
  }

  function newCanvas(w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w));
    canvas.height = Math.max(1, Math.round(h));
    return canvas;
  }

  /** 把位图的一块画到画布上，返回 data URL */
  function drawCrop(bmp, px, dw, dh) {
    const canvas = newCanvas(dw, dh);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, px.x, px.y, px.w, px.h, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  }

  /** 抓当前标签页的可视区域 */
  async function captureVisibleBitmap(windowId, tabId) {
    // captureVisibleTab 抓的是「当前活动标签页」，不是我们发消息的那个：
    // 万一用户中途切走了，先把它切回来，否则会截到别的页面。
    if (tabId) {
      try {
        const tab = await ext.tabs.get(tabId);
        if (!tab.active) {
          await ext.tabs.update(tabId, { active: true });
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch (e) {
        /* 标签页没了就算了 */
      }
    }
    const dataUrl = await ext.tabs.captureVisibleTab(windowId, { format: 'png' });
    const bytes = dataUrlToBytes(dataUrl);
    const blob = new Blob([bytes], { type: 'image/png' });
    return createImageBitmap(blob);
  }

  /** 把一张网络图片取下来（后台有 host 权限，跨域也能取） */
  async function fetchImageAsDataUrl(url) {
    const s = String(url || '');
    if (!s) return '';
    if (s.startsWith('data:')) return s;
    const res = await fetch(s, { credentials: 'omit' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    const { base64, mime } = await blobToBase64(blob);
    return 'data:' + (mime || 'image/png') + ';base64,' + base64;
  }

  /** 选区 → 图片（base64 + 一张小预览） */
  async function grabRegionImage(msg, settings) {
    const s = Core.normalizeSettings(settings);
    const maxSide = Number(s.visionMaxSide) || 1600;

    // 1) 选区正好是一张 <img>：直接用原图。比截图清晰，也不受滚动条换算的影响。
    if (msg && msg.imgSrc) {
      try {
        const dataUrl = await fetchImageAsDataUrl(msg.imgSrc);
        if (dataUrl) {
          const parsed = Core.parseDataUrl(dataUrl);
          const bmp = await createImageBitmap(
            new Blob([dataUrlToBytes(dataUrl)], { type: parsed.mime || 'image/png' })
          );
          const fit = Core.fitSide(bmp.width, bmp.height, maxSide);
          const preview = drawCrop(bmp, { x: 0, y: 0, w: bmp.width, h: bmp.height },
            Core.fitSide(bmp.width, bmp.height, 480).w, Core.fitSide(bmp.width, bmp.height, 480).h);
          return {
            base64: parsed.base64,
            mime: parsed.mime || 'image/png',
            w: fit.w,
            h: fit.h,
            preview,
            source: '原图',
            cropW: bmp.width,
            cropH: bmp.height,
          };
        }
      } catch (e) {
        /* 原图拿不到就退回截图 */
      }
    }

    // 2) 抓可视区域，按比例裁出选区
    const bmp = await captureVisibleBitmap(msg.windowId, msg.tabId);
    const scale = Core.computeCaptureScale(bmp.width, bmp.height, msg.view || {}, msg.dpr);
    const px = Core.cropRectToPixels(msg.rect, scale, bmp.width, bmp.height);
    const fit = Core.fitSide(px.w, px.h, maxSide);
    const dataUrl = drawCrop(bmp, px, fit.w, fit.h);
    const parsed = Core.parseDataUrl(dataUrl);
    const prev = Core.fitSide(px.w, px.h, 480);
    const preview = drawCrop(bmp, px, prev.w, prev.h);
    return {
      base64: parsed.base64,
      mime: 'image/png',
      w: fit.w,
      h: fit.h,
      preview,
      source: '截图',
      cropW: px.w,
      cropH: px.h,
    };
  }

  /** tea_a2 上自动挑一个工作区 */
  async function autoWorkspaceId(settings) {
    const s = Core.normalizeSettings(settings);
    const res = await fetch(s.apiBase + '/api/workspaces');
    const data = await res.json().catch(() => null);
    const id = Core.pickWorkspaceId(data);
    if (!id) throw new Error('tea_a2 上没有可用的工作区（GET /api/workspaces 是空的）');
    return id;
  }

  /** 轮询回合状态直到结束 */
  async function pollTurn(apiBase, turnId, timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 180000);
    while (Date.now() < deadline) {
      const res = await fetch(apiBase + '/api/turns/' + encodeURIComponent(turnId));
      const data = await res.json().catch(() => null);
      if (!data) throw new Error('读回合状态失败');
      if (data.state && data.state !== 'running') return data;
      await new Promise((r) => setTimeout(r, 600));
    }
    throw new Error('识图超时（180 秒）');
  }

  /**
   * 识图：tea_a2 里唯一吃图片的是 POST /api/chat（agent loop 那条路）。
   * /api/llm/chat 只收字符串 content，收不了图片。
   */
  async function runVision(msg) {
    const s = await getSettings();
    const grab = {
      base64: String((msg && msg.imageBase64) || ''),
      mime: String((msg && msg.mime) || 'image/png'),
      w: Number(msg && msg.imageW) || 0,
      h: Number(msg && msg.imageH) || 0,
      cropW: Number(msg && msg.cropW) || 0,
      cropH: Number(msg && msg.cropH) || 0,
      source: String((msg && msg.source) || '截图'),
    };
    if (!grab.base64) throw new Error('没有图片');
    const workspaceId = s.visionWorkspace || (await autoWorkspaceId(s));
    const body = Core.buildVisionBody({
      settings: s,
      workspaceId,
      imageBase64: grab.base64,
    });

    const res = await fetch(s.apiBase + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (e) {
      /* 非 JSON */
    }
    if (!res.ok || !data || data.error) {
      const err =
        data && data.error ? data.error.message || data.error.code : text.slice(0, 300);
      throw new Error('tea_a2 返回错误：' + err);
    }
    if (!data.turn_id) throw new Error('tea_a2 没有返回回合句柄');

    const turn = await pollTurn(s.apiBase, data.turn_id);
    if (turn.state !== 'done') {
      throw new Error('识图没跑完（状态：' + (turn.state || '未知') + '）');
    }
    return {
      ok: true,
      task: 'vision',
      content: turn.result || '',
      preview: grab.preview,
      image: {
        w: grab.w,
        h: grab.h,
        cropW: grab.cropW,
        cropH: grab.cropH,
        source: grab.source,
      },
      elapsed_ms: turn.elapsed_ms,
      provider: body.provider,
      model: body.model,
    };
  }

  // ────────────────────────── 三个任务 ──────────────────────────

  async function runTask(task, text, settings) {
    const s = Core.normalizeSettings(settings);
    if (task === 'search') return runSearch(text, s);

    const body = Core.buildChatBody(task, text, s);
    const data = await chat(body, s);
    return {
      ok: true,
      task,
      note: data.effortFallback
        ? '这个模型不接受思考强度「' + data.effortFallback.split(' → ')[0] + '」，已自动降到「' +
          data.effortFallback.split(' → ')[1] + '」。'
        : '',
      content: data.content || '',
      reasoning: data.reasoning || '',
      usage: data.usage || null,
      elapsed_ms: data.elapsed_ms,
      provider: data.provider || body.provider,
      model: data.model || body.model,
    };
  }

  // ────────────────────────── 标签页 ──────────────────────────

  // 设置页（工具栏弹出的就是它）不是网页，划图要落到「最近一个网页标签页」上。
  let lastContentTabId = null;

  function isContentTab(tab) {
    return !!(tab && /^https?:/i.test(tab.url || ''));
  }

  if (ext.tabs && ext.tabs.onActivated) {
    ext.tabs.onActivated.addListener(async (info) => {
      try {
        const tab = await ext.tabs.get(info.tabId);
        if (isContentTab(tab)) lastContentTabId = tab.id;
      } catch (e) {
        /* 标签页没了就算了 */
      }
    });
  }

  if (ext.tabs && ext.tabs.onUpdated) {
    ext.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      if (!changeInfo.url && !changeInfo.status) return;
      if (isContentTab(tab)) lastContentTabId = tabId;
    });
  }

  async function findTargetTab(tabId) {
    if (typeof tabId === 'number' && tabId >= 0) return tabId;
    if (lastContentTabId !== null) {
      try {
        const tab = await ext.tabs.get(lastContentTabId);
        if (isContentTab(tab)) return tab.id;
      } catch (e) {
        /* 落到下面的查询 */
      }
    }
    const tabs = await ext.tabs.query({ active: true, currentWindow: true });
    return tabs && tabs[0] ? tabs[0].id : null;
  }

  // ────────────────────────── 消息路由 ──────────────────────────

  async function handle(msg, sender) {
    if (sender && sender.tab && msg && typeof msg === 'object') msg.tabId = sender.tab.id;
    switch (msg && msg.type) {
      case 'getSettings':
        return { ok: true, settings: await getSettings() };

      case 'saveSettings':
        return { ok: true, settings: await saveSettings(msg.settings) };

      case 'run':
        return runTask(msg.task, msg.text, await getSettings());

      case 'providers': {
        const s = await getSettings();
        const res = await fetch(s.apiBase + '/api/providers');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return { ok: true, providers: await res.json() };
      }

      case 'test': {
        const s = await getSettings();
        const body = {
          provider: s.provider,
          model: s.model,
          stream: false,
          messages: [{ role: 'user', content: '只回复：连接成功' }],
        };
        const data = await chat(body, s);
        return { ok: true, content: data.content || '', providers: null };
      }

      case 'captureRegion': {
        const s = await getSettings();
        const grab = await grabRegionImage(msg, s);
        return {
          ok: true,
          task: 'capture',
          preview: grab.preview,
          image: {
            base64: grab.base64,
            mime: grab.mime,
            w: grab.w,
            h: grab.h,
            cropW: grab.cropW,
            cropH: grab.cropH,
            source: grab.source,
          },
        };
      }

      case 'runVision':
        return runVision(msg);

      case 'startRegionSelect': {
        const tabId = await findTargetTab(msg.tabId);
        if (tabId === null) return { ok: false, error: '找不到网页标签页' };
        await ext.tabs.sendMessage(tabId, { type: 'startRegionSelect' });
        return { ok: true, tabId };
      }

      case 'openOptions':
        await ext.tabs.create({ url: ext.runtime.getURL('src/options.html') });
        return { ok: true };
      case 'openUrl':
        if (msg.url) await ext.tabs.create({ url: msg.url, active: true });
        return { ok: true };

      default:
        return { ok: false, error: '未知消息：' + (msg && msg.type) };
    }
  }

  // keep-alive 连接：只要页面还开着，就别回收这个事件页
  if (ext.runtime.onConnect) {
    ext.runtime.onConnect.addListener((port) => {
      if (port.name !== 'tea-select-keepalive') return;
      port.onDisconnect.addListener(() => {});
    });
  }

  ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    handle(msg)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));
    return true; // 异步响应
  });

  // 快捷键：打开设置页
  if (ext.commands && ext.commands.onCommand) {
    ext.commands.onCommand.addListener((command) => {
      if (command === 'open-options') {
        const url = ext.runtime.getURL('src/options.html');
        ext.tabs.create({ url });
      } else if (command === 'region-select') {
        // 划图：让当前标签页的内容脚本进入「选区」模式
        ext.tabs
          .query({ active: true, currentWindow: true })
          .then((tabs) => {
            const tab = tabs && tabs[0];
            if (!tab) return;
            return ext.tabs.sendMessage(tab.id, { type: 'startRegionSelect' }).catch(() => {});
          })
          .catch(() => {});
      }
    });
  }

  ext.runtime.onInstalled.addListener(async () => {
    const data = await ext.storage.local.get(SETTINGS_KEY);
    if (!data || !data[SETTINGS_KEY]) await saveSettings(Core.DEFAULT_SETTINGS);
  });
})();
