/*
 * 内容脚本：监听划词 → 在鼠标位置弹出横幅（翻译 / 搜索 / 总结）→ 展示结果。
 * 只跟后台脚本说话，页面本身拿不到 tea_a2 的地址和返回内容。
 */
(function () {
  'use strict';

  const ext = globalThis.browser || globalThis.chrome;
  const Core = globalThis.TeaCore;

  const HOST_ID = 'tea-select-banner-host';
  let host = null;
  let shadow = null;
  let bar = null;
  let panel = null;
  let panelBody = null;
  let panelTitle = null;
  let wrap = null;
  let settings = Core.normalizeSettings(null);
  let currentText = '';
  let currentUrl = '';
  let busy = false;
  let lastX = 0;
  let lastY = 0;
  let hideTimer = null;
  let visionPreview = '';

  // ────────────────────────── 与后台通信 ──────────────────────────

  function send(msg) {
    return new Promise((resolve, reject) => {
      let ret;
      try {
        ret = ext.runtime.sendMessage(msg);
      } catch (e) {
        reject(e);
        return;
      }
      if (ret && typeof ret.then === 'function') {
        ret.then(resolve, reject);
      } else {
        try {
          ext.runtime.sendMessage(msg, (res) => {
            const err = ext.runtime.lastError;
            if (err) reject(new Error(err.message));
            else resolve(res);
          });
        } catch (e) {
          reject(e);
        }
      }
    });
  }

  async function loadSettings() {
    try {
      const res = await send({ type: 'getSettings' });
      if (res && res.ok) settings = Core.normalizeSettings(res.settings);
    } catch (e) {
      /* 用默认值 */
    }
  }

  if (ext.storage && ext.storage.onChanged) {
    ext.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.settings) {
        settings = Core.normalizeSettings(changes.settings.newValue);
      }
    });
  }

  // ────────────────────────── DOM ──────────────────────────

  function ensureDom() {
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.id = HOST_ID;
    shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = globalThis.TeaBannerCSS || '';
    shadow.appendChild(style);

    wrap = document.createElement('div');
    wrap.className = 'wrap';
    shadow.appendChild(wrap);

    bar = document.createElement('div');
    bar.className = 'bar';
    for (const task of ['translate', 'search', 'summarize']) {
      const btn = document.createElement('button');
      btn.className = 'task';
      btn.type = 'button';
      btn.dataset.task = task;
      btn.textContent = Core.TASKS[task].name;
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        runTask(task);
      });
      bar.appendChild(btn);
    }
    const sep = document.createElement('div');
    sep.className = 'sep';
    bar.appendChild(sep);
    const close = document.createElement('button');
    close.className = 'close';
    close.type = 'button';
    close.title = '关闭';
    close.textContent = '×';
    close.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      hide();
    });
    bar.appendChild((close));
    wrap.appendChild(bar);

    panel = document.createElement('div');
    panel.className = 'panel';
    const head = document.createElement('div');
    head.className = 'panel-head';
    panelTitle = document.createElement('div');
    panelTitle.className = 'panel-title';
    head.appendChild(panelTitle);

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.textContent = '复制';
    copyBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      copyResult(copyBtn);
    });
    head.appendChild(copyBtn);

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.textContent = '在浏览器打开';
    openBtn.style.display = 'none';
    openBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (currentUrl) send({ type: 'openUrl', url: currentUrl }).catch(() => {});
    });
    head.appendChild(openBtn);

    const panelClose = document.createElement('button');
    panelClose.type = 'button';
    panelClose.className = 'close-btn';
    panelClose.textContent = '关闭';
    panelClose.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      hide();
    });
    head.appendChild(panelClose);
    panel.appendChild(head);

    panelBody = document.createElement('div');
    panelBody.className = 'panel-body';
    panel.appendChild(panelBody);
    wrap.appendChild(panel);

    (document.body || document.documentElement).appendChild(host);
  }

  // ────────────────────────── 位置 ──────────────────────────

  function place(x, y) {
    if (!wrap) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = bar.getBoundingClientRect();
    const width = rect.width || 180;
    const height = rect.height || 36;

    let left = x;
    left = Math.min(Math.max(left, 8 + width / 2), vw - 8 - width / 2);

    let top = y - height - 12;
    let below = false;
    if (top < 8) {
      top = y + 16;
      below = true;
    }
    if (top + height > vh - 8) top = Math.max(8, vh - height - 8);
    wrap.style.transform = 'translate(' + Math.round(left) + 'px, ' + Math.round(top) + 'px) translateX(-50%)';
    wrap.dataset.below = below ? '1' : '0';
  }

  // ────────────────────────── 横幅 ──────────────────────────

  function show(text, x, y) {
    ensureDom();
    currentText = text;
    currentUrl = '';
    busy = false;
    lastX = x;
    lastY = y;
    panel.classList.remove('open');
    panelBody.textContent = '';
    panelTitle.textContent = '';
    setButtonsEnabled(true);
    place(x, y);
    host.style.display = '';
  }

  function hide() {
    if (!host) return;
    if (wrap) wrap.classList.remove('vision-mode');
    host.style.display = 'none';
    currentText = '';
    currentUrl = '';
    busy = false;
  }

  function scheduleHide() {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 4000);
  }

  function setButtonsEnabled(on) {
    bar.querySelectorAll('button.task').forEach((b) => {
      b.classList.toggle('busy', !on);
    });
  }

  function selectedText() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return '';
    return sel.toString().trim();
  }

  function inBanner(node) {
    if (!host) return false;
    return node === host || host.contains(node);
  }

  function onPointerUp(ev) {
    if (pickerActive) return; // 正在划图，别弹划词横幅
    if (inBanner(ev.target)) return;
    const x = ev.clientX;
    const y = ev.clientY;
    setTimeout(() => {
      const text = selectedText();
      if (!text) {
        if (!busy) hide();
        return;
      }
      if (text.length < Math.max(1, Number(settings.minChars) || 1)) return;
      show(text, x, y);
    }, 0);
  }

  function onKeyUp(ev) {
    if (ev.key && ev.key !== 'Shift' && ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight' && ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
    setTimeout(() => {
      const text = selectedText();
      if (!text) return;
      if (text.length < Math.max(1, Number(settings.minChars) || 1)) return;
      const sel = window.getSelection();
      let x = window.innerWidth / 2;
      let y = 120;
      if (sel && sel.rangeCount) {
        const r = sel.getRangeAt(0).getBoundingClientRect();
        if (r && (r.left || r.top)) {
          x = r.left + r.width / 2;
          y = r.top;
        }
      }
      show(text, x, y);
    }, 0);
  }

  // 结果面板是「常驻」的：滚动、点页面别处都不收起，只有关闭按钮（或 Esc）才关。
  function onResize() {
    if (!host || host.style.display === 'none') return;
    place(lastX, lastY);
  }

  function onKeyDown(ev) {
    // 划图快捷键：页面里按就直接进入选区模式（浏览器级快捷键另有 manifest 那条）
    if (Core.matchChord(settings.regionKey, ev)) {
      ev.preventDefault();
      ev.stopPropagation();
      startPicker();
      return;
    }
    if (ev.key === 'Escape') {
      if (pickerActive) stopPicker();
      else hide();
    }
    // Alt+Shift+T：打开扩展设置页
    if (ev.altKey && ev.shiftKey && (ev.key === 'T' || ev.key === 't')) {
      send({ type: 'openOptions' }).catch(() => {});
    }
  }


  // ────────────────────────── 划图（选区） ──────────────────────────
  //
  // 「划图」= 在页面上拖出一个矩形。做法：
  //   1) 内容脚本盖一层全屏的半透明层（shadow DOM，不受页面样式影响）；
  //   2) 拖动时用 box-shadow 挖出一个洞，就是选区；
  //   3) 松手后把覆盖层藏掉（截图必须干净），等两帧，再让后台抓图。

  const PICKER_ID = 'tea-select-picker-host';
  let pickerHost = null;
  let pickerLayer = null;
  let pickerBox = null;
  let pickerHint = null;
  let pickerActive = false;
  let dragStart = null;

  function ensurePickerDom() {
    if (pickerHost && pickerHost.isConnected) return;
    pickerHost = document.createElement('div');
    pickerHost.id = PICKER_ID;
    const shadow = pickerHost.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = globalThis.TeaPickerCSS || '';
    shadow.appendChild(style);

    pickerLayer = document.createElement('div');
    pickerLayer.className = 'pick-layer';
    shadow.appendChild(pickerLayer);

    pickerBox = document.createElement('div');
    pickerBox.className = 'pick-box';
    pickerLayer.appendChild(pickerBox);

    pickerHint = document.createElement('div');
    pickerHint.className = 'pick-hint';
    pickerHint.textContent = '拖动选择要识别的区域 · Esc 取消';
    pickerLayer.appendChild(pickerHint);

    (document.body || document.documentElement).appendChild(pickerHost);
  }

  function startPicker() {
    ensureDom();
    ensurePickerDom();
    pickerActive = true;
    dragStart = null;
    pickerBox.classList.remove('on');
    pickerHint.textContent = '拖动选择要识别的区域 · Esc 取消';
    pickerHost.style.display = '';
    hide();
    document.addEventListener('mousedown', onPickDown, true);
    document.addEventListener('mousemove', onPickMove, true);
    document.addEventListener('mouseup', onPickUp, true);
  }

  function stopPicker() {
    if (!pickerActive) return;
    pickerActive = false;
    dragStart = null;
    document.removeEventListener('mousedown', onPickDown, true);
    document.removeEventListener('mousemove', onPickMove, true);
    document.removeEventListener('mouseup', onPickUp, true);
    if (pickerHost) pickerHost.style.display = 'none';
    if (pickerBox) pickerBox.classList.remove('on');
  }

  function onPickDown(ev) {
    if (!pickerActive) return;
    if (inBanner(ev.target)) return;
    ev.preventDefault(); // 别让页面开始选文字
    ev.stopPropagation();
    dragStart = { x: ev.clientX, y: ev.clientY };
    pickerBox.classList.add('on');
    updatePickBox(dragStart, dragStart);
  }

  function onPickMove(ev) {
    if (!pickerActive || !dragStart) return;
    updatePickBox(dragStart, { x: ev.clientX, y: ev.clientY });
  }

  function onPickUp(ev) {
    if (!pickerActive || !dragStart) return;
    const start = dragStart;
    dragStart = null;
    const rect = Core.normalizeRect(start, { x: ev.clientX, y: ev.clientY });
    stopPicker();
    if (rect.w < 10 || rect.h < 10) return; // 划得太小，当误触
    void finishPick(rect);
  }

  function updatePickBox(a, b) {
    const r = Core.normalizeRect(a, b);
    pickerBox.style.left = r.x + 'px';
    pickerBox.style.top = r.y + 'px';
    pickerBox.style.width = r.w + 'px';
    pickerBox.style.height = r.h + 'px';
    pickerHint.textContent =
      Math.round(r.w) + ' × ' + Math.round(r.h) + ' · 松开识图 · Esc 取消';
  }

  /** 选区正好盖住一张 <img> 时，用原图比用截图清楚得多 */
  function imageUnderRect(rect) {
    const cx = Math.round(rect.x + rect.w / 2);
    const cy = Math.round(rect.y + rect.h / 2);
    if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) return '';
    const el = document.elementFromPoint(cx, cy);
    if (!el) return '';
    const img = el.tagName === 'IMG' ? el : el.closest ? el.closest('img') : null;
    if (!img) return '';
    const src = img.currentSrc || img.src || '';
    if (!src || src.startsWith('blob:')) return '';
    const box = img.getBoundingClientRect();
    if (!box.width || !box.height) return '';
    const ix = Math.max(
      0,
      Math.min(box.left + box.width, rect.x + rect.w) - Math.max(box.left, rect.x)
    );
    const iy = Math.max(
      0,
      Math.min(box.top + box.height, rect.y + rect.h) - Math.max(box.top, rect.y)
    );
    if ((ix * iy) / (box.width * box.height) < 0.8) return ''; // 只盖住一小块，还是截图
    return src;
  }

  /** 等画面真的刷新完（覆盖层刚藏起来，截图才干净） */
  function nextPaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 40)));
    });
  }

  async function finishPick(rect) {
    const view = {
      w: window.innerWidth,
      h: window.innerHeight,
      cw: document.documentElement.clientWidth,
      ch: document.documentElement.clientHeight,
    };
    const imgSrc = imageUnderRect(rect);

    // 先抓图、后弹面板：面板要是先出现，它自己会被截进图里。
    await nextPaint();
    let cap;
    try {
      cap = await send({
        type: 'captureRegion',
        rect,
        view,
        dpr: window.devicePixelRatio,
        imgSrc,
      });
    } catch (e) {
      cap = { ok: false, error: String(e && e.message ? e.message : e) };
    }
    if (!cap || !cap.ok) {
      showVisionError(rect, (cap && cap.error) || '抓图失败');
      return;
    }

    const image = cap.image || {};
    visionPreview = cap.preview || '';
    showVisionPending(rect, cap.preview, image);

    let res;
    try {
      res = await send({
        type: 'runVision',
        imageBase64: image.base64,
        mime: image.mime,
        imageW: image.w,
        imageH: image.h,
        cropW: image.cropW,
        cropH: image.cropH,
        source: image.source,
      });
    } catch (e) {
      res = { ok: false, error: String(e && e.message ? e.message : e) };
    }
    renderVisionResult(res);
  }

  function showVisionError(rect, message) {
    ensureDom();
    busy = false;
    wrap.classList.add('vision-mode');
    panel.classList.add('open');
    panelTitle.textContent = '识图 · 失败';
    panelBody.textContent = '';
    const err = document.createElement('div');
    err.className = 'error';
    err.textContent = message || '未知错误';
    panelBody.appendChild(err);
    place(rect.x + rect.w / 2, rect.y + rect.h);
    host.style.display = '';
  }

  function showVisionPending(rect, preview, image) {
    ensureDom();
    busy = true;
    setButtonsEnabled(false);
    wrap.classList.add('vision-mode');
    panel.classList.add('open');
    panelTitle.textContent = '识图 · 处理中…';
    panelBody.textContent = '';
    if (preview) {
      const img = document.createElement('img');
      img.className = 'shot';
      img.alt = '截取的区域';
      img.src = preview;
      panelBody.appendChild(img);
    }
    if (image && image.cropW) {
      const note = document.createElement('div');
      note.className = 'loading';
      note.textContent =
        (image.source || '截图') + ' ' + image.cropW + '×' + image.cropH + ' 像素';
      panelBody.appendChild(note);
    }
    const loading = document.createElement('div');
    loading.className = 'loading';
    loading.textContent = '正在请求 tea_a2…';
    panelBody.appendChild(loading);
    place(rect.x + rect.w / 2, rect.y + rect.h);
    host.style.display = '';
  }

  function renderVisionResult(res) {
    busy = false;
    setButtonsEnabled(true);
    panelBody.textContent = '';
    if (!res || !res.ok) {
      panelTitle.textContent = '识图 · 失败';
      const err = document.createElement('div');
      err.className = 'error';
      err.textContent = (res && res.error) || '未知错误';
      panelBody.appendChild(err);
      return;
    }
    panelTitle.textContent =
      '识图' +
      (res.provider ? ' · ' + res.provider + '/' + res.model : '') +
      (res.image && res.image.source ? ' · ' + res.image.source : '') +
      (res.image && res.image.cropW ? ' · ' + res.image.cropW + '×' + res.image.cropH : '') +
      (res.elapsed_ms ? ' · ' + Math.round(res.elapsed_ms) + 'ms' : '');
    const preview = res.preview || visionPreview;
    if (preview) {
      const img = document.createElement('img');
      img.className = 'shot';
      img.alt = '截取的区域';
      img.src = preview;
      panelBody.appendChild(img);
    }
    const body = document.createElement('div');
    body.textContent = res.content || '(空)';
    panelBody.appendChild(body);
  }

  // ────────────────────────── 执行任务 ──────────────────────────

  async function runTask(task) {
    if (busy || !currentText) return;
    busy = true;
    setButtonsEnabled(false);
    panel.classList.add('open');
    panelTitle.textContent = Core.TASKS[task].name + ' · 处理中…';
    panelBody.textContent = '';
    const loading = document.createElement('div');
    loading.className = 'loading';
    loading.textContent = '正在请求 tea_a2…';
    panelBody.appendChild(loading);

    let res;
    try {
      res = await send({ type: 'run', task, text: currentText });
    } catch (e) {
      res = { ok: false, error: String(e && e.message ? e.message : e) };
    }
    busy = false;
    setButtonsEnabled(true);

    panelBody.textContent = '';
    if (!res || !res.ok) {
      panelTitle.textContent = Core.TASKS[task].name + ' · 失败';
      const err = document.createElement('div');
      err.className = 'error';
      err.textContent = (res && res.error) || '未知错误';
      panelBody.appendChild(err);
      return;
    }

    panelTitle.textContent =
      Core.TASKS[task].name +
      (res.provider ? ' · ' + res.provider + '/' + res.model : '') +
      (res.elapsed_ms ? ' · ' + Math.round(res.elapsed_ms) + 'ms' : '');

    const body = document.createElement('div');
    body.textContent = res.content || '(空)';
    panelBody.appendChild(body);

    if (res.note) {
      const note = document.createElement('div');
      note.className = 'loading';
      note.style.marginTop = '8px';
      note.textContent = res.note;
      panelBody.appendChild(note);
    }

    if (settings.showReasoning && res.reasoning) {
      const det = document.createElement('details');
      const sum = document.createElement('summary');
      sum.textContent = '思考过程';
      const pre = document.createElement('pre');
      pre.textContent = res.reasoning;
      det.appendChild(sum);
      det.appendChild(pre);
      panelBody.appendChild(det);
    }

    currentUrl = res.openUrl || '';
    const openBtn = panel.querySelector('.panel-head button:nth-of-type(2)');
    if (openBtn) openBtn.style.display = currentUrl ? '' : 'none';

    if (res.results && res.results.length) {
      const src = document.createElement('div');
      src.className = 'panel-sources';
      const title = document.createElement('div');
      title.textContent = '搜索结果';
      src.appendChild(title);
      res.results.forEach((r, i) => {
        const a = document.createElement('a');
        a.href = r.url;
        a.target = '_blank';
        a.rel = 'noreferrer';
        a.textContent = '[' + (i + 1) + '] ' + (r.title || r.url);
        src.appendChild(a);
      });
      panelBody.appendChild(src);
    }
  }

  async function copyResult(btn) {
    const text = panelBody.textContent || '';
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (e2) {
        ok = false;
      }
    }
    const old = btn.textContent;
    btn.textContent = ok ? '已复制' : '复制失败';
    setTimeout(() => {
      btn.textContent = old;
    }, 1200);
  }

  // ────────────────────────── 启动 ──────────────────────────

  document.addEventListener('mouseup', onPointerUp, true);
  if (ext.runtime && ext.runtime.onMessage) {
    ext.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'startRegionSelect') startPicker();
    });
  }
  document.addEventListener('keyup', onKeyUp, true);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('resize', onResize);

  // 长请求（比如带联网搜索的总结）时，MV3 的事件页可能被回收；
  // 挂一条长连接把后台页钉住，消息才不会丢。
  function keepBackgroundAlive() {
    try {
      const port = ext.runtime.connect({ name: 'tea-select-keepalive' });
      port.onDisconnect.addListener(() => {
        setTimeout(keepBackgroundAlive, 1000);
      });
    } catch (e) {
      setTimeout(keepBackgroundAlive, 3000);
    }
  }

  keepBackgroundAlive();

  loadSettings();
})();
