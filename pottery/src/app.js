/**
 * 中国陶器史 · 页面逻辑
 * 依赖：POTTERY_DATA（data-ceramics.js）、POTTERY_IMAGE_CREDITS（sources.js）、
 *       POTTERY_CORE（core.js）、POTTERY_ONLINE（online.js）
 */
(function () {
  'use strict';

  const DATA = window.POTTERY_DATA || { meta: {}, compare: [], entries: [] };
  const CREDITS = window.POTTERY_IMAGE_CREDITS || {};
  const core = window.POTTERY_CORE;
  const online = window.POTTERY_ONLINE;

  const entries = core.sortByOrder(core.withImages(DATA.entries));
  // 单文件版（tools/build-single.mjs）会把图片内联成 data URI 放进来
  const INLINE_IMAGES = window.POTTERY_IMAGE_DATA || {};
  function imageOf(id, fallback) {
    return INLINE_IMAGES[id] || fallback;
  }
  const meta = DATA.meta || {};

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  /* ---------------------------------------------------------------- *
   * 小工具
   * ---------------------------------------------------------------- */
  let toastTimer = null;
  function toast(text) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  function fallbackSrc(title) {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="#e8dcc6"/><stop offset="1" stop-color="#cbb99a"/></linearGradient></defs>' +
      '<rect width="800" height="600" fill="url(#g)"/>' +
      '<g fill="none" stroke="#8c7a5e" stroke-width="3">' +
      '<path d="M400 170c40 0 70 26 70 60s-30 60-70 60-70-26-70-60 30-60 70-60z"/>' +
      '<path d="M330 300h140l-18 150H348z"/></g>' +
      '<text x="400" y="520" text-anchor="middle" font-family="serif" font-size="26" fill="#6f6047">' +
      core.escapeHtml(String(title || '').slice(0, 18)) + ' · 图片暂缺</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function creditOf(id) {
    return CREDITS[id] || null;
  }

  function creditLine(id) {
    const c = creditOf(id);
    if (!c) return '图片来自 Wikimedia Commons';
    const bits = [];
    if (c.author) bits.push(c.author);
    if (c.license) bits.push(c.license);
    if (c.note) bits.push(c.note);
    return bits.join(' · ');
  }

  /* ---------------------------------------------------------------- *
   * Hero / 陶与瓷
   * ---------------------------------------------------------------- */
  function renderHero() {
    $('#heroIntro').textContent = meta.intro || '';
    const st = core.stats(entries);
    $('#heroStats').innerHTML = [
      '<li><b>' + st.count + '</b><span>件器物</span></li>',
      '<li><b>' + st.span + '</b><span>时间跨度</span></li>',
      '<li><b>' + st.cultures + '</b><span>文化 / 窑口</span></li>',
    ].join('');
    $('#footerMeta').textContent =
      '共 ' + st.count + ' 件器物 · 图片 ' + Object.keys(CREDITS).length + ' 张，来自 Wikimedia Commons（CC0 / CC BY / CC BY-SA / Public domain）· 生成于 2026-11';

    $('#compareBody').innerHTML = (DATA.compare || [])
      .map(
        (row) =>
          '<div class="compare-row" role="row">' +
          '<span role="cell">' + core.escapeHtml(row.key) + '</span>' +
          '<span role="cell">' + core.escapeHtml(row.pottery) + '</span>' +
          '<span role="cell">' + core.escapeHtml(row.porcelain) + '</span>' +
          '</div>'
      )
      .join('');
  }

  /* ---------------------------------------------------------------- *
   * 时间线
   * ---------------------------------------------------------------- */
  function rowHtml(e, i) {
    const credit = creditOf(e.id);
    const mainSrc = imageOf(e.id, e.image);
    const creditHtml = credit
      ? '<b>图</b> ' + core.escapeHtml(creditLine(e.id)) +
        (credit.sourceUrl
          ? ' · <a href="' + core.escapeHtml(credit.sourceUrl) + '" target="_blank" rel="noopener noreferrer">Commons</a>'
          : '')
      : '<b>图</b> Wikimedia Commons';

    const points = (e.points || []).map((p) => '<li>' + core.escapeHtml(p) + '</li>').join('');
    const tags = (e.tags || []).map((t) => '<span>' + core.escapeHtml(t) + '</span>').join('');
    const body = (e.body || []).map((p) => '<p>' + core.escapeHtml(p) + '</p>').join('');
    const metaBits = [];
    if (e.site) metaBits.push('<span><b>出土 / 发现</b> ' + core.escapeHtml(e.site) + '</span>');
    if (e.museum) metaBits.push('<span><b>收藏</b> ' + core.escapeHtml(e.museum) + '</span>');

    return (
      '<article class="row reveal" id="c-' + e.id + '" data-id="' + e.id + '" data-index="' + i + '">' +
        '<div class="col-era">' +
          '<p class="era-tag">' + core.escapeHtml(e.era) + '</p>' +
          '<h3 class="era-name">' + core.escapeHtml(e.culture || e.era) + '</h3>' +
          '<p class="era-years">' + core.escapeHtml(e.years) + '</p>' +
          '<p class="era-culture">第 ' + (i + 1) + ' / ' + entries.length + ' 件</p>' +
        '</div>' +
        '<figure class="col-media">' +
          '<button class="shot" type="button" data-open="' + e.id + '" aria-label="放大查看：' + core.escapeHtml(e.title) + '">' +
            '<img src="' + core.escapeHtml(mainSrc) + '" alt="' + core.escapeHtml(e.title + '（' + e.era + '，' + e.years + '）') + '" ' +
              'decoding="async" loading="' + (i < 2 ? 'eager' : 'lazy') + '" data-title="' + core.escapeHtml(e.title) + '" />' +
            '<span class="zoom-badge">⤢ 点击放大</span>' +
          '</button>' +
          (e.extra && e.extra.length
            ? '<div class="thumbs">' + e.extra.map(function (x, k) {
                return '<button type="button" class="thumb" data-slide="' + e.id + ':' + k + '" aria-label="放大查看：' + core.escapeHtml(x.label) + '">' +
                  '<img src="' + core.escapeHtml(imageOf(x.creditId, x.src)) + '" alt="' + core.escapeHtml(x.label) + '" loading="lazy" decoding="async" />' +
                  '<span>' + core.escapeHtml(x.label) + '</span></button>';
              }).join('') + '</div>'
            : '') +
          '<figcaption>' + creditHtml + '</figcaption>' +
        '</figure>' +
        '<div class="col-text">' +
          '<h2>' + core.escapeHtml(e.title) + '</h2>' +
          '<p class="subtitle">' + core.escapeHtml(e.subtitle || '') + '</p>' +
          '<p class="lead">' + core.escapeHtml(e.lead || '') + '</p>' +
          '<div class="body">' + body + '</div>' +
          '<ul class="points">' + points + '</ul>' +
          '<div class="tags">' + tags + '</div>' +
          '<div class="meta">' + metaBits.join('') + '</div>' +
          '<div class="row-actions">' +
            '<button class="btn ask-ai" type="button" data-ask="' + e.id + '">✦ 问 AI：' + core.escapeHtml(e.title) + '</button>' +
          '</div>' +
        '</div>' +
      '</article>'
    );
  }

  function renderTimeline() {
    $('#timelineList').innerHTML = entries.map(rowHtml).join('');

    // 破图兜底（主图与补充图都覆盖）
    $$('#timelineList img').forEach((img) => {
      img.addEventListener('error', function () {
        if (img.dataset.fallback) return;
        img.dataset.fallback = '1';
        img.src = fallbackSrc(img.dataset.title || '');
      });
    });

    // 入场动画
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(
        (list) => {
          list.forEach((it) => {
            if (it.isIntersecting) {
              it.target.classList.add('in');
              io.unobserve(it.target);
            }
          });
        },
        { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
      );
      $$('.reveal').forEach((el) => io.observe(el));
    } else {
      $$('.reveal').forEach((el) => el.classList.add('in'));
    }
  }

  function renderRail() {
    const nav = core.eraNav(entries);
    $('#railList').innerHTML = nav
      .map((n) => '<a href="#c-' + n.id + '" data-rail="' + n.id + '">' + core.escapeHtml(n.label) + '</a>')
      .join('');
  }

  /* ---------------------------------------------------------------- *
   * 滚动：进度、导航高亮
   * ---------------------------------------------------------------- */
  function initScroll() {
    const bar = $('#progressBar');
    let ticking = false;
    function update() {
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      bar.style.width = (p * 100).toFixed(2) + '%';
      ticking = false;
    }
    window.addEventListener('scroll', function () {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    }, { passive: true });
    update();

    const links = $$('#railList a');
    const byId = {};
    links.forEach((a) => { byId[a.dataset.rail] = a; });
    if ('IntersectionObserver' in window) {
      const spy = new IntersectionObserver(
        (list) => {
          list.forEach((it) => {
            if (!it.isIntersecting) return;
            links.forEach((a) => a.removeAttribute('aria-current'));
            const a = byId[it.target.dataset.id];
            if (a) {
              a.setAttribute('aria-current', 'true');
              const rail = $('#railList');
              const left = a.offsetLeft - rail.clientWidth / 2 + a.clientWidth / 2;
              rail.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
            }
          });
        },
        { rootMargin: '-46% 0px -48% 0px', threshold: 0 }
      );
      $$('.row').forEach((r) => spy.observe(r));
    }
  }

  /* ---------------------------------------------------------------- *
   * 灯箱
   * ---------------------------------------------------------------- */
  const slides = [];
  const slideStart = Object.create(null);
  entries.forEach(function (e) {
    slideStart[e.id] = slides.length;
    slides.push({ src: imageOf(e.id, e.image), title: e.title, sub: e.era + ' · ' + e.years + ' · ' + (e.culture || ''), creditId: e.id, entryId: e.id });
    (e.extra || []).forEach(function (x) {
      slides.push({ src: imageOf(x.creditId, x.src), title: x.label, sub: e.title + ' · 工艺补充图', creditId: x.creditId || e.id, entryId: e.id });
    });
  });

  const lb = {
    index: -1,
    scale: 1,
    tx: 0,
    ty: 0,
    originX: '50%',
    originY: '50%',
    dragging: false,
    moved: false,
    startX: 0,
    startY: 0,
    baseX: 0,
    baseY: 0,
    lastFocus: null,
  };

  function lbApply() {
    const img = $('#lbImg');
    img.style.transformOrigin = lb.originX + ' ' + lb.originY;
    img.style.transform = 'translate(' + lb.tx + 'px,' + lb.ty + 'px) scale(' + lb.scale + ')';
    const stage = $('#lbStage');
    stage.classList.toggle('zoomed', lb.scale > 1.01);
  }

  function lbReset() {
    lb.scale = 1;
    lb.tx = 0;
    lb.ty = 0;
    lb.originX = '50%';
    lb.originY = '50%';
    lbApply();
  }

  function lbRender() {
    const s = slides[lb.index];
    if (!s) return;
    const credit = creditOf(s.creditId);
    const img = $('#lbImg');
    img.dataset.fallback = '';
    img.src = s.src;
    img.alt = s.title;
    $('#lbTitle').textContent = s.title;
    $('#lbSub').textContent = s.sub;
    $('#lbCredit').innerHTML = credit
      ? '图片：' + core.escapeHtml(creditLine(s.creditId)) +
        (credit.sourceUrl
          ? ' · <a href="' + core.escapeHtml(credit.sourceUrl) + '" target="_blank" rel="noopener noreferrer">在 Commons 查看原图 / 许可</a>'
          : '')
      : '图片来源：Wikimedia Commons';
    $('#lbCount').textContent = (lb.index + 1) + ' / ' + slides.length;
    $('[data-lb="prev"]').disabled = slides.length < 2;
    $('[data-lb="next"]').disabled = slides.length < 2;
    lbReset();
  }

  function lbOpen(id) {
    const i = slideStart[id];
    if (i == null) return;
    lb.index = i;
    lb.lastFocus = document.activeElement;
    $('#lightbox').hidden = false;
    document.body.style.overflow = 'hidden';
    lbRender();
    $('[data-lb="close"]').focus();
  }

  function lbClose() {
    $('#lightbox').hidden = true;
    document.body.style.overflow = '';
    if (lb.lastFocus && lb.lastFocus.focus) lb.lastFocus.focus();
  }

  function lbGo(delta) {
    if (!slides.length) return;
    lb.index = (lb.index + delta + slides.length) % slides.length;
    lbRender();
  }

  function initLightbox() {
    const box = $('#lightbox');
    const stage = $('#lbStage');
    const img = $('#lbImg');

    box.addEventListener('click', function (ev) {
      const act = ev.target.closest('[data-lb]');
      if (act) {
        const what = act.dataset.lb;
        if (what === 'close') lbClose();
        else if (what === 'prev') lbGo(-1);
        else if (what === 'next') lbGo(1);
        return;
      }
      if (ev.target === box) lbClose();
    });

    img.addEventListener('error', function () {
      if (img.dataset.fallback) return;
      img.dataset.fallback = '1';
      img.src = fallbackSrc($('#lbTitle').textContent || '');
    });

    img.addEventListener('click', function (ev) {
      if (lb.moved) { lb.moved = false; return; }
      if (lb.scale > 1.01) {
        lbReset();
      } else {
        const rect = stage.getBoundingClientRect();
        lb.originX = ((ev.clientX - rect.left) / rect.width) * 100 + '%';
        lb.originY = ((ev.clientY - rect.top) / rect.height) * 100 + '%';
        lb.scale = 2.2;
        lb.tx = 0;
        lb.ty = 0;
        lbApply();
      }
    });

    img.addEventListener('dblclick', function (ev) {
      ev.preventDefault();
      lbReset();
    });

    stage.addEventListener('wheel', function (ev) {
      if (box.hidden) return;
      ev.preventDefault();
      const next = Math.min(4, Math.max(1, lb.scale * (ev.deltaY < 0 ? 1.18 : 0.85)));
      if (next <= 1.01) { lbReset(); return; }
      const rect = stage.getBoundingClientRect();
      if (lb.scale <= 1.01) {
        lb.originX = ((ev.clientX - rect.left) / rect.width) * 100 + '%';
        lb.originY = ((ev.clientY - rect.top) / rect.height) * 100 + '%';
      }
      lb.scale = next;
      lbApply();
    }, { passive: false });

    stage.addEventListener('pointerdown', function (ev) {
      if (lb.scale <= 1.01) return;
      lb.dragging = true;
      lb.moved = false;
      lb.startX = ev.clientX;
      lb.startY = ev.clientY;
      lb.baseX = lb.tx;
      lb.baseY = lb.ty;
      stage.classList.add('dragging');
      stage.setPointerCapture(ev.pointerId);
    });
    stage.addEventListener('pointermove', function (ev) {
      if (!lb.dragging) return;
      const dx = ev.clientX - lb.startX;
      const dy = ev.clientY - lb.startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) lb.moved = true;
      lb.tx = lb.baseX + dx;
      lb.ty = lb.baseY + dy;
      lbApply();
    });
    function endDrag() {
      lb.dragging = false;
      stage.classList.remove('dragging');
    }
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);

    document.addEventListener('keydown', function (ev) {
      if (!box.hidden) {
        if (ev.key === 'Escape') { ev.preventDefault(); lbClose(); }
        else if (ev.key === 'ArrowLeft') { ev.preventDefault(); lbGo(-1); }
        else if (ev.key === 'ArrowRight') { ev.preventDefault(); lbGo(1); }
        else if (ev.key === '+' || ev.key === '=') { ev.preventDefault(); lb.scale = Math.min(4, lb.scale * 1.2); lbApply(); }
        else if (ev.key === '-') { ev.preventDefault(); lb.scale = Math.max(1, lb.scale / 1.2); if (lb.scale <= 1.01) lbReset(); else lbApply(); }
      }
    });

    // 打开：事件委托
    document.addEventListener('click', function (ev) {
      const thumb = ev.target.closest('[data-slide]');
      if (thumb) {
        ev.preventDefault();
        const pair = thumb.dataset.slide.split(':');
        const k = Number(pair[1]) || 0;
        const base = slideStart[pair[0]];
        const hit = base == null ? -1 : base + 1 + k;
        if (hit >= 0 && slides[hit]) {
          lb.index = hit;
          lb.lastFocus = document.activeElement;
          $('#lightbox').hidden = false;
          document.body.style.overflow = 'hidden';
          lbRender();
          $('[data-lb="close"]').focus();
        }
        return;
      }
      const btn = ev.target.closest('[data-open]');
      if (!btn) return;
      ev.preventDefault();
      lbOpen(btn.dataset.open);
    });
  }

  /* ---------------------------------------------------------------- *
   * AI 搜索
   * ---------------------------------------------------------------- */
  const CFG_KEY = 'pottery.a2.config.v1';
  const DEFAULT_CFG = { base: online.DEFAULT_BASE, provider: online.PROVIDER, model: online.MODEL };
  let cfg = loadCfg();
  let aiEntry = null;
  let lastStatus = { state: 'unknown', at: 0, info: null };
  let busy = false;

  function loadCfg() {
    const out = Object.assign({}, DEFAULT_CFG);
    try {
      const raw = localStorage.getItem(CFG_KEY);
      if (raw) {
        const j = JSON.parse(raw);
        if (j && typeof j.base === 'string' && j.base.trim()) out.base = j.base.trim();
        if (j && typeof j.provider === 'string' && j.provider.trim()) out.provider = j.provider.trim();
        if (j && typeof j.model === 'string' && j.model.trim()) out.model = j.model.trim();
      }
    } catch (e) { /* 无痕模式 / file:// 下 localStorage 可能不可用 */ }
    out.base = online.normalizeBase(out.base);
    return out;
  }

  function saveCfg() {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) {}
  }

  function setStatus(state, text, title) {
    const el = $('#aiStatus');
    el.dataset.state = state;
    el.textContent = text;
    el.title = title || '';
    lastStatus = { state: state, at: Date.now(), info: null };
  }

  async function refreshStatus(force) {
    if (!force && lastStatus.state === 'online' && Date.now() - lastStatus.at < 60000) return lastStatus;
    setStatus('checking', '检测中…');
    const r = await online.probe(cfg.base);
    if (r.ok) {
      setStatus('online', '在线 ' + (r.version || ''), cfg.base + ' · ' + (r.provider || '') + ' / ' + (r.model || ''));
      lastStatus.info = r;
    } else {
      setStatus('offline', r.error === 'timeout' ? '超时' : '离线', cfg.base + ' · ' + (r.error || ''));
    }
    return lastStatus;
  }

  function aiBodyReset() {
    $('#aiBody').innerHTML =
      '<div class="ai-empty">' +
        '<p>问一件器物、一种釉色，或一个「为什么」。</p>' +
        '<p class="muted">回答来自本机 tea_a2（<code>' + core.escapeHtml(cfg.base) + '</code>），会带上检索到的来源链接。</p>' +
      '</div>';
    $('#aiMeta').textContent = '';
  }

  function skeleton() {
    $('#aiBody').innerHTML =
      '<div class="ai-skel" aria-label="正在生成">' +
        '<i></i><i></i><i></i><i></i><i style="width:64%"></i>' +
      '</div>' +
      '<p class="muted" style="font-size:12.5px;margin-top:14px">正在让 a2 检索并组织答案，通常 10—40 秒…</p>';
    $('#aiMeta').textContent = '';
  }

  /* 轻量 markdown：标题 / 列表 / 粗体 / 段落 */
  function renderAnswerText(text) {
    const lines = String(text || '').split(/\r?\n/);
    let html = '';
    let list = [];
    let para = [];

    function flushPara() {
      if (!para.length) return;
      html += '<p>' + inline(para.join(' ')) + '</p>';
      para = [];
    }
    function flushList() {
      if (!list.length) return;
      html += '<ul>' + list.map((li) => '<li>' + inline(li) + '</li>').join('') + '</ul>';
      list = [];
    }
    function inline(s) {
      return core.escapeHtml(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    }

    lines.forEach((raw) => {
      const t = raw.trim();
      if (!t) { flushPara(); flushList(); return; }
      if (/^来源\s*[:：]/.test(t)) { flushPara(); flushList(); return; }
      const h = t.match(/^#{1,4}\s+(.*)$/);
      if (h) { flushPara(); flushList(); html += '<h3>' + inline(h[1]) + '</h3>'; return; }
      const li = t.match(/^(?:[-*•]|\d+[.、)])\s+(.*)$/);
      if (li) { flushPara(); list.push(li[1]); return; }
      flushList();
      para.push(t);
    });
    flushPara();
    flushList();
    return html || '<p class="muted">（返回内容为空）</p>';
  }

  function renderSources(sources) {
    if (!sources || !sources.length) {
      return '<div class="ai-sources"><h3>来源</h3><p class="muted" style="font-size:12.5px">这次没有检索到可列出的链接。</p></div>';
    }
    const items = sources
      .slice(0, 8)
      .map((s) => {
        const title = s.title || s.url;
        const sum = s.summary ? '<span class="src-sum">' + core.escapeHtml(s.summary.slice(0, 150)) + '</span>' : '';
        return (
          '<li><a href="' + core.escapeHtml(s.url) + '" target="_blank" rel="noopener noreferrer">' +
          core.escapeHtml(title) + '</a>' + sum + '</li>'
        );
      })
      .join('');
    return '<div class="ai-sources"><h3>来源 · ' + sources.length + ' 条</h3><ol>' + items + '</ol></div>';
  }

  function renderAnswer(q, res) {
    const meta = [];
    meta.push((res.provider || cfg.provider) + ' / ' + (res.model || cfg.model));
    if (res.elapsedMs) meta.push((res.elapsedMs / 1000).toFixed(1) + ' s');
    if (res.webCalls) meta.push('检索 ' + res.webCalls + ' 次');
    $('#aiMeta').textContent = meta.join(' · ');
    $('#aiBody').innerHTML =
      '<div class="ai-answer">' +
        '<span class="badge">AI 生成 · 未经审核</span>' +
        '<p class="muted" style="font-size:12.5px;margin-bottom:12px">问：' + core.escapeHtml(q) + '</p>' +
        renderAnswerText(res.content) +
        renderSources(res.sources) +
      '</div>';
    $('#aiBody').scrollTop = 0;
  }

  function renderAiError(q, kind, detail) {
    const offline = kind === 'offline' || kind === 'timeout';
    $('#aiMeta').textContent = '';
    $('#aiBody').innerHTML =
      '<div class="ai-error">' +
        '<h3>' + core.escapeHtml(online.errorText(kind)) + '</h3>' +
        (detail ? '<p class="muted" style="font-size:12px">' + core.escapeHtml(String(detail).slice(0, 300)) + '</p>' : '') +
        (offline ? '<pre>' + core.escapeHtml(online.startHint(cfg.base)) + '</pre>' : '') +
        '<div class="ai-actions" style="margin-top:12px">' +
          '<button class="btn small" type="button" data-ai-action="retry">重试</button>' +
          (offline ? '<button class="btn small" type="button" data-ai-action="probe">重新检测</button>' : '') +
          '<button class="btn small" type="button" data-ai-action="settings">连接设置</button>' +
        '</div>' +
        '<p class="muted" style="font-size:11.5px;margin:10px 0 0">问：' + core.escapeHtml(q) + '</p>' +
      '</div>';
  }

  async function ask(q, entry) {
    const query = core.normalizeQuery(q);
    if (!query) { toast('先写一句想问的话'); return; }
    if (busy) return;
    busy = true;
    $('#aiSubmit').disabled = true;
    $('#aiSubmit').textContent = '检索中…';
    skeleton();
    try {
      const res = await online.search(query, {
        base: cfg.base,
        provider: cfg.provider,
        model: cfg.model,
        entry: entry || null,
      });
      if (res.ok) {
        renderAnswer(query, res);
        if (lastStatus.state !== 'online') setStatus('online', '在线', cfg.base);
      } else {
        if (res.kind === 'offline' || res.kind === 'timeout') setStatus('offline', res.kind === 'timeout' ? '超时' : '离线', cfg.base);
        renderAiError(query, res.kind || 'http', res.detail || res.error || '');
      }
    } finally {
      busy = false;
      $('#aiSubmit').disabled = false;
      $('#aiSubmit').textContent = '提问';
    }
  }

  function openAi(entry, question) {
    aiEntry = entry || null;
    $('#ai').hidden = false;
    document.body.style.overflow = 'hidden';
    if (question) $('#aiQuery').value = question;
    else if (entry && entry.question) $('#aiQuery').value = entry.question;
    $('#aiSettings').open = false;
    refreshStatus(false);
    setTimeout(function () {
      const q = $('#aiQuery');
      q.focus();
      q.setSelectionRange(q.value.length, q.value.length);
    }, 60);
  }

  function closeAi() {
    $('#ai').hidden = true;
    if ($('#lightbox').hidden) document.body.style.overflow = '';
  }

  function renderPresets() {
    const presets = [
      { id: 'ru', label: '汝窑天青为什么难烧' },
      { id: 'mise', label: '秘色瓷的「秘」指什么' },
      { id: 'tang-sancai', label: '唐三彩为什么不算瓷' },
      { id: 'longshan', label: '蛋壳黑陶怎么这么薄' },
      { id: 'modern', label: '现代陶瓷和古代陶器什么关系' },
      { id: '', label: '陶和瓷的分界到底是什么' },
    ];
    $('#aiPresets').innerHTML = presets
      .map((p) => '<button type="button" data-preset="' + p.id + '">' + core.escapeHtml(p.label) + '</button>')
      .join('');
  }

  function initAi() {
    renderPresets();
    $('#aiBase').value = cfg.base;
    $('#aiProvider').value = cfg.provider;
    $('#aiModel').value = cfg.model;

    refreshStatus(true);

    $('#aiFab').addEventListener('click', function () { openAi(null); });
    $('#ai').addEventListener('click', function (ev) {
      const t = ev.target.closest('[data-ai]');
      if (t && t.dataset.ai === 'close') closeAi();
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && !$('#ai').hidden) closeAi();
    });

    $('#aiForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      ask($('#aiQuery').value, aiEntry);
    });

    $('#aiPresets').addEventListener('click', function (ev) {
      const btn = ev.target.closest('[data-preset]');
      if (!btn) return;
      const id = btn.dataset.preset;
      const entry = id ? core.byId(entries, id) : null;
      aiEntry = entry;
      const q = entry ? entry.question : '陶和瓷的分界到底是什么？为什么有的陶器也能烧得很薄很硬？';
      $('#aiQuery').value = q;
      ask(q, entry);
    });

    $('#aiSettingsBtn').addEventListener('click', function () {
      const d = $('#aiSettings');
      d.open = !d.open;
      this.setAttribute('aria-expanded', d.open ? 'true' : 'false');
    });

    $('#aiSaveSettings').addEventListener('click', async function () {
      cfg.base = online.normalizeBase($('#aiBase').value);
      cfg.provider = $('#aiProvider').value.trim() || DEFAULT_CFG.provider;
      cfg.model = $('#aiModel').value.trim() || DEFAULT_CFG.model;
      $('#aiBase').value = cfg.base;
      saveCfg();
      const st = await refreshStatus(true);
      toast(st.state === 'online' ? '已连接 ' + cfg.base : '还连不上 ' + cfg.base);
    });

    $('#aiResetSettings').addEventListener('click', async function () {
      cfg = Object.assign({}, DEFAULT_CFG);
      saveCfg();
      $('#aiBase').value = cfg.base;
      $('#aiProvider').value = cfg.provider;
      $('#aiModel').value = cfg.model;
      aiBodyReset();
      await refreshStatus(true);
      toast('已恢复默认设置');
    });

    $('#aiClear').addEventListener('click', function () {
      aiEntry = null;
      $('#aiQuery').value = '';
      aiBodyReset();
      $('#aiQuery').focus();
    });

    $('#aiBody').addEventListener('click', async function (ev) {
      const btn = ev.target.closest('[data-ai-action]');
      if (!btn) return;
      const act = btn.dataset.aiAction;
      if (act === 'retry') ask($('#aiQuery').value, aiEntry);
      else if (act === 'probe') { await refreshStatus(true); toast(lastStatus.state === 'online' ? '已连接' : '仍然连不上'); }
      else if (act === 'settings') { $('#aiSettings').open = true; $('#aiBase').focus(); }
    });

    // 每行的「问 AI」
    document.addEventListener('click', function (ev) {
      const btn = ev.target.closest('[data-ask]');
      if (!btn) return;
      const entry = core.byId(entries, btn.dataset.ask);
      openAi(entry);
    });
  }

  /* ---------------------------------------------------------------- *
   * 背景音乐
   * ---------------------------------------------------------------- */
  const AUDIO_KEY = 'pottery.audio.v1';
  let audioEngine = null;
  let audioPref = loadAudioPref();
  let lastResumeAt = 0;

  function loadAudioPref() {
    const out = { enabled: false, volume: 45, hintSeen: false };
    try {
      const raw = localStorage.getItem(AUDIO_KEY);
      if (raw) {
        const j = JSON.parse(raw);
        if (j) {
          out.enabled = !!j.enabled;
          if (isFinite(Number(j.volume))) out.volume = Math.max(0, Math.min(100, Math.round(Number(j.volume))));
          out.hintSeen = !!j.hintSeen;
        }
      }
    } catch (e) {}
    return out;
  }

  function saveAudioPref() {
    try { localStorage.setItem(AUDIO_KEY, JSON.stringify(audioPref)); } catch (e) {}
  }

  function ensureAudioEngine() {
    if (audioEngine) return audioEngine;
    if (!window.POTTERY_AUDIO || !window.POTTERY_AUDIO.isSupported) return null;
    audioEngine = window.POTTERY_AUDIO.createEngine();
    if (audioEngine) audioEngine.setVolume(audioPref.volume);
    return audioEngine;
  }

  function updateMusicUi() {
    const btn = $('#musicBtn');
    if (!btn) return;
    const playing = !!(audioEngine && audioEngine.isPlaying());
    const pending = !playing && audioPref.enabled;
    btn.setAttribute('aria-pressed', playing ? 'true' : 'false');
    const labelText = playing ? '背景音乐：播放中，点击暂停' : pending ? '继续背景音乐（窑火）' : '播放背景音乐：窑火';
    btn.title = labelText;
    btn.setAttribute('aria-label', labelText);
    const label = btn.querySelector('.music-label');
    if (label) label.textContent = pending ? '继续' : '窑火';
    const out = $('#musicVolOut');
    if (out) out.textContent = audioPref.volume + '%';
    const vol = $('#musicVol');
    if (vol) vol.value = String(audioPref.volume);
  }

  function startMusic() {
    const engine = ensureAudioEngine();
    if (!engine) {
      toast('这个浏览器不支持 Web Audio，听不了背景音乐');
      return false;
    }
    audioPref.enabled = true;
    saveAudioPref();
    engine.setVolume(audioPref.volume);
    const ok = engine.start();
    updateMusicUi();
    if (!ok) toast('音频没能启动，检查一下浏览器的声音权限');
    return ok;
  }

  function stopMusic() {
    audioPref.enabled = false;
    saveAudioPref();
    if (audioEngine) audioEngine.stop();
    updateMusicUi();
  }

  function initAudio() {
    const btn = $('#musicBtn');
    if (!btn) return;

    updateMusicUi();

    btn.addEventListener('click', function () {
      if (Date.now() - lastResumeAt < 450) return;
      if (audioEngine && audioEngine.isPlaying()) stopMusic();
      else startMusic();
    });

    const more = $('#musicMore');
    const pop = $('#musicPop');
    function closePop() {
      if (!pop || pop.hidden) return;
      pop.hidden = true;
      if (more) more.setAttribute('aria-expanded', 'false');
    }
    if (more && pop) {
      more.addEventListener('click', function (ev) {
        ev.stopPropagation();
        pop.hidden = !pop.hidden;
        more.setAttribute('aria-expanded', pop.hidden ? 'false' : 'true');
        if (!pop.hidden) {
          audioPref.hintSeen = true;
          saveAudioPref();
        }
      });
      document.addEventListener('click', function (ev) {
        if (!pop.hidden && !ev.target.closest('#audioDock')) closePop();
      });
      document.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape') closePop();
      });
      const hintClose = $('#musicHintClose');
      if (hintClose) hintClose.addEventListener('click', closePop);
    }

    const vol = $('#musicVol');
    if (vol) {
      vol.addEventListener('input', function () {
        audioPref.volume = Math.max(0, Math.min(100, Math.round(Number(vol.value) || 0)));
        audioPref.hintSeen = true;
        saveAudioPref();
        if (audioEngine) audioEngine.setVolume(audioPref.volume);
        updateMusicUi();
      });
    }

    // 第一次来：轻轻提示一下按钮在哪（不自动出声）
    if (!audioPref.enabled && !audioPref.hintSeen) {
      setTimeout(function () {
        if (audioEngine && audioEngine.isPlaying()) return;
        toast('右下角的「♪ 窑火」可以打开背景音乐');
        audioPref.hintSeen = true;
        saveAudioPref();
      }, 4200);
    }

    // 上次开着音乐：等用户第一次摸页面时再恢复（浏览器自动播放策略）
    if (audioPref.enabled) {
      const resume = function (ev) {
        if (ev && ev.target && ev.target.closest && ev.target.closest('#audioDock')) return;
        window.removeEventListener('pointerdown', resume, true);
        window.removeEventListener('keydown', resume, true);
        if (!audioPref.enabled) return;
        lastResumeAt = Date.now();
        if (startMusic()) toast('背景音乐已继续');
      };
      window.addEventListener('pointerdown', resume, true);
      window.addEventListener('keydown', resume, true);
    }
  }

  /* ---------------------------------------------------------------- *
   * 启动
   * ---------------------------------------------------------------- */
  const problems = core.validate(entries);
  if (problems.length && window.console) console.warn('[pottery] 数据问题：', problems);

  renderHero();
  renderRail();
  renderTimeline();
  initScroll();
  initLightbox();
  initAi();
  initAudio();

  if (window.location.hash && /^#c-/.test(window.location.hash)) {
    const el = document.querySelector(window.location.hash);
    if (el) setTimeout(() => el.scrollIntoView(), 80);
  }
})();
