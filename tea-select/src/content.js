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
  let hideTimer = null;

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
    panelClose.textContent = '×';
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
    panel.classList.remove('open');
    panelBody.textContent = '';
    panelTitle.textContent = '';
    setButtonsEnabled(true);
    place(x, y);
    host.style.display = '';
  }

  function hide() {
    if (!host) return;
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

  function onMouseDown(ev) {
    if (inBanner(ev.target)) return;
    if (busy) return;
    hide();
  }

  function onScroll() {
    if (!busy) hide();
  }

  function onKeyDown(ev) {
    if (ev.key === 'Escape') hide();
    // Alt+Shift+T：打开扩展设置页
    if (ev.altKey && ev.shiftKey && (ev.key === 'T' || ev.key === 't')) {
      send({ type: 'openOptions' }).catch(() => {});
    }
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
  document.addEventListener('keyup', onKeyUp, true);
  document.addEventListener('mousedown', onMouseDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onScroll);

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
