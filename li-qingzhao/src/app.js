/**
 * 李清照 · 漱玉词 —— 页面逻辑
 * 依赖：LI_QINGZHAO_DATA（data-life.js）、LI_QINGZHAO_CREDITS（sources.js）、
 *       LI_QINGZHAO_CORE（core.js）、LI_QINGZHAO_ONLINE（online.js）、
 *       LI_QINGZHAO_AUDIO_PLAYER（audio.js）
 */
(function () {
  'use strict';

  const DATA = window.LI_QINGZHAO_DATA || { meta: {}, stages: [], journey: [], entries: [] };
  const CREDITS = window.LI_QINGZHAO_CREDITS || {};
  const AUDIO_META = window.LI_QINGZHAO_AUDIO || {};
  const core = window.LI_QINGZHAO_CORE;
  const online = window.LI_QINGZHAO_ONLINE;
  const audioApi = window.LI_QINGZHAO_AUDIO_PLAYER;

  const entries = core.sortByOrder(core.withImages(DATA.entries));
  const stages = core.stagesOf(entries, DATA.stages);
  const meta = DATA.meta || {};
  const byId = Object.create(null);
  entries.forEach(function (e) { byId[e.id] = e; });

  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  const $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

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
    toastTimer = setTimeout(function () { el.hidden = true; }, 2800);
  }

  function safeStorage() {
    try {
      if (!window.localStorage) return null;
      const k = '__lq_probe__';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return window.localStorage;
    } catch (e) {
      return null;
    }
  }
  const storage = safeStorage();

  function imageOf(src) {
    const map = window.LI_QINGZHAO_IMAGE_DATA || {};
    return map[src] || src;
  }

  function creditOf(id) { return CREDITS[id] || null; }

  function creditLine(id) {
    const c = creditOf(id);
    if (!c) return '图片来源：Wikimedia Commons';
    const bits = [];
    if (c.author) bits.push(c.author);
    if (c.license) bits.push(c.license);
    if (c.note) bits.push(c.note);
    return bits.length ? bits.join(' · ') : 'Wikimedia Commons';
  }

  function creditHtml(id) {
    const c = creditOf(id);
    if (!c) return '图 · Wikimedia Commons';
    const link = c.sourceUrl
      ? ' · <a href="' + core.escapeHtml(c.sourceUrl) + '" target="_blank" rel="noopener noreferrer">Commons</a>'
      : '';
    return '图 · ' + core.escapeHtml(creditLine(id)) + link;
  }

  function fallbackSrc(label) {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">' +
      '<rect width="800" height="600" fill="#ece2d0"/>' +
      '<rect x="330" y="120" width="140" height="360" rx="8" fill="#fbf7ec" stroke="#c9b795"/>' +
      '<text x="400" y="250" text-anchor="middle" font-family="serif" font-size="66" fill="#a53a2a">词</text>' +
      '<text x="400" y="330" text-anchor="middle" font-family="serif" font-size="22" fill="#80735f">图片暂缺</text>' +
      '<text x="400" y="540" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#80735f">' +
      core.escapeHtml(String(label || '').slice(0, 24)) + '</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  /* 竖幅古画的取景：默认居中偏上，避免裁掉主体 */
  const IMG_POS = {
    shaonv: 'center 50%',
    yijianmei: 'center 46%',
    shengshengman: 'center 40%',
    jinshilu: 'center 40%',
    'qingzhou-book': 'center 36%',
    'bayonglou-dama': 'center 30%',
    guyan: 'center 34%',
    wulingchun: 'center 50%',
    dianjiangchun: 'center 46%',
  };

  /* ---------------------------------------------------------------- *
   * Hero / 五段 / 行迹
   * ---------------------------------------------------------------- */
  function renderHero() {
    const st = core.stats(entries, meta);
    $('#heroIntro').textContent = meta.intro || '';
    $('#heroSub').textContent = meta.sub || '';
    const years = meta.span ? meta.span.split('—') : ['1084', '1155'];
    $('#heroStats').innerHTML = [
      '<li><b>' + st.works + '</b><span>篇作品</span></li>',
      '<li><b>' + st.stages + '</b><span>段人生</span></li>',
      '<li><b>' + (Number(years[1]) - Number(years[0]) || 71) + '</b><span>年</span></li>',
      '<li><b>' + st.places + '</b><span>座城</span></li>',
    ].join('');

    $('#stageGrid').innerHTML = stages.map(function (s) {
      return '<li class="stage-card">' +
        '<span class="stage-no">第 ' + ['一', '二', '三', '四', '五'][s.no - 1] + ' 段</span>' +
        '<h3>' + core.escapeHtml(String(s.title).split('：').pop()) + '</h3>' +
        '<p class="stage-years">' + core.escapeHtml(s.years) + '</p>' +
        '<p class="stage-places">' + core.escapeHtml(s.places) + '</p>' +
        '<p class="stage-blurb">' + core.escapeHtml(s.blurb) + '</p>' +
        '<p class="stage-count">' + s.count + ' 条</p>' +
        '</li>';
    }).join('');

    $('#journeyTrack').innerHTML = (DATA.journey || []).map(function (j) {
      return '<div class="journey-item">' +
        '<b>' + core.escapeHtml(j.city) + '</b>' +
        '<i></i>' +
        '<span>' + core.escapeHtml(j.year) + '</span>' +
        '<em>' + core.escapeHtml(j.note) + '</em>' +
        '</div>';
    }).join('');

    const st2 = core.stats(entries, meta);
    $('#footerMeta').textContent =
      '共 ' + entries.length + ' 条 · ' + st2.works + ' 篇作品（' + core.kindsText(entries) + '）· ' +
      '图片 ' + Object.keys(CREDITS).length + ' 张，来自 Wikimedia Commons · ' +
      '古琴《' + (AUDIO_META.title || '阳关三叠') + '》' + (AUDIO_META.license || 'CC BY-SA 3.0') + ' · ' +
      '页面生成于 2026-11';
  }

  /* ---------------------------------------------------------------- *
   * 时间线
   * ---------------------------------------------------------------- */
  function verseHtml(e) {
    if (e.kind === '余响') {
      return '<blockquote class="quote"><p>' + core.escapeHtml(e.quote) + '</p>' +
        '<cite>' + core.escapeHtml(e.quoteFrom || '') + '</cite></blockquote>';
    }
    if (!e.poem || !e.poem.length) return '';
    const t = core.splitTitle(e.title);
    const filled = e.poem.filter(function (x) { return x; });
    const long = filled.length > 6;
    const lines = e.poem.map(function (line) {
      if (!line) return e.prose ? '' : '<p class="verse-line gap"></p>';
      if (e.prose) return '<p class="prose-p">' + core.poemLineHtml(line) + '</p>';
      return '<p class="verse-line">' + core.poemLineHtml(line) + '</p>';
    }).join('');
    const intro = e.poemIntro
      ? '<p class="verse-intro">小序：' + core.escapeHtml(e.poemIntro) + '</p>'
      : '';
    const seal = e.kind === '词' ? '漱玉' : e.kind === '诗' ? '七绝' : '文';
    return '<div class="verse-card' + (long ? ' long' : '') + '">' +
      '<div class="verse-head"><span class="tune">' + core.escapeHtml(t.tune || e.kind) + '</span>' +
        '<span>' + core.escapeHtml(e.kind) + ' · ' + core.escapeHtml(e.written || '') + '</span></div>' +
      intro +
      '<div class="verse-body' + (e.prose ? ' prose' : '') + '">' + lines + '</div>' +
      '<span class="verse-seal">' + seal + '</span>' +
      '</div>';
  }

  function rowHtml(e, i) {
    const title = core.splitTitle(e.title);
    const caption = e.imageCaption || '';
    const imgPos = IMG_POS[e.id] || 'center 50%';
    const extras = (e.extra || []).map(function (x, k) {
      return '<button type="button" class="thumb" data-slide="' + e.id + ':' + k + '" ' +
        'aria-label="放大查看：' + core.escapeHtml(x.label) + '">' +
        '<img src="' + core.escapeHtml(imageOf(x.src)) + '" alt="' + core.escapeHtml(x.label) + '" loading="lazy" decoding="async" />' +
        '<span>' + core.escapeHtml(x.label) + '</span></button>';
    }).join('');

    const notes = (e.notes || []).map(function (n) {
      return '<dt>' + core.escapeHtml(n.term) + '</dt><dd>' + core.escapeHtml(n.text) + '</dd>';
    }).join('');

    const body = (e.body || []).map(function (p) {
      return '<p>' + core.escapeHtml(p) + '</p>';
    }).join('');

    const points = (e.points || []).map(function (p) {
      return '<li>' + core.escapeHtml(p) + '</li>';
    }).join('');

    const tags = (e.tags || []).map(function (t) {
      return '<span>' + core.escapeHtml(t) + '</span>';
    }).join('');

    const metaBits = [];
    if (e.written) metaBits.push('<span><b>作年</b> ' + core.escapeHtml(e.written) + '</span>');
    if (e.source) metaBits.push('<span><b>出处</b> ' + core.escapeHtml(e.source) + '</span>');
    if (e.place) metaBits.push('<span><b>地点</b> ' + core.escapeHtml(e.place) + '</span>');

    return (
      '<article class="row reveal" id="c-' + e.id + '" data-id="' + e.id + '" data-index="' + i + '">' +
        '<div class="col-era">' +
          '<p class="stage-tag">第 ' + ['一', '二', '三', '四', '五'][e.stage - 1] + ' 段</p>' +
          '<h3 class="era-name">' + core.escapeHtml(e.place) + '</h3>' +
          '<p class="era-years">' + core.escapeHtml(e.years) + '</p>' +
          '<p class="era-age">' + core.escapeHtml(e.age || '') + '</p>' +
          '<p class="era-count">第 ' + (i + 1) + ' / ' + entries.length + ' 条</p>' +
        '</div>' +
        '<figure class="col-media">' +
          '<button class="shot" type="button" data-open="' + e.id + '" aria-label="放大查看：' + core.escapeHtml(e.title) + '">' +
            '<img src="' + core.escapeHtml(imageOf(e.image)) + '" alt="' + core.escapeHtml(e.title + '（' + e.place + '，' + e.years + '）') + '" ' +
              'decoding="async" loading="' + (i < 2 ? 'eager' : 'lazy') + '" style="object-position:' + imgPos + '" data-title="' + core.escapeHtml(e.title) + '" />' +
            '<span class="zoom-badge">⤢ 点击放大</span>' +
          '</button>' +
          (extras ? '<div class="thumbs">' + extras + '</div>' : '') +
          (e.keyLine
            ? '<blockquote class="media-quote"><p>“' + core.escapeHtml(e.keyLine) + '”</p>' +
              '<cite>' + core.escapeHtml((core.splitTitle(e.title).title || e.title)) + (e.written ? ' · ' + core.escapeHtml(e.written) : '') + '</cite></blockquote>'
            : '') +
          '<figcaption><span class="cap">' + core.escapeHtml(caption) + '</span>' +
            '<span class="credit">' + creditHtml(e.creditId || e.id) + '</span></figcaption>' +
        '</figure>' +
        '<div class="col-text">' +
          '<div class="title-row">' +
            '<span class="kind-badge" data-kind="' + core.escapeHtml(e.kind) + '">' + core.escapeHtml(e.kind) + '</span>' +
            '<h2>' + core.escapeHtml(title.tune ? title.tune + ' · ' + title.title : title.title) + '</h2>' +
          '</div>' +
          '<p class="subtitle">' + core.escapeHtml(e.subtitle || '') + '</p>' +
          '<p class="lead">' + core.escapeHtml(e.lead || '') + '</p>' +
          verseHtml(e) +
          '<details class="notes"><summary>词语注释 · ' + (e.notes || []).length + ' 条</summary><dl>' + notes + '</dl></details>' +
          '<div class="body">' + body + '</div>' +
          '<ul class="points">' + points + '</ul>' +
          '<div class="tags">' + tags + '</div>' +
          '<div class="meta">' + metaBits.join('') + '</div>' +
          '<div class="row-actions">' +
            '<button class="btn ask-ai" type="button" data-ask="' + e.id + '">✦ 问 AI：' + core.escapeHtml(title.title) + '</button>' +
          '</div>' +
        '</div>' +
      '</article>'
    );
  }

  function renderTimeline() {
    $('#timelineList').innerHTML = entries.map(rowHtml).join('');

    $$('#timelineList img').forEach(function (img) {
      img.addEventListener('error', function () {
        if (img.dataset.fallback) return;
        img.dataset.fallback = '1';
        img.src = fallbackSrc(img.dataset.title || '');
      });
      // 竖幅古画（挂轴）换成更高的画框，避免把主体裁掉
      const markTall = function () {
        if (!img.naturalWidth || !img.naturalHeight) return;
        if (img.naturalHeight / img.naturalWidth > 1.2) {
          const box = img.closest('.shot');
          if (box) box.classList.add('tall');
        }
      };
      if (img.complete) markTall();
      else img.addEventListener('load', markTall, { once: true });
    });

    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(function (list) {
        list.forEach(function (it) {
          if (it.isIntersecting) {
            it.target.classList.add('in');
            io.unobserve(it.target);
          }
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
      $$('.reveal').forEach(function (el) { io.observe(el); });
    } else {
      $$('.reveal').forEach(function (el) { el.classList.add('in'); });
    }
  }

  function renderRail() {
    $('#railList').innerHTML = core.eraNav(entries).map(function (n) {
      return '<a href="#c-' + n.id + '" data-rail="' + n.id + '">' + core.escapeHtml(n.label) + '</a>';
    }).join('');
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
      if (bar) bar.style.width = (p * 100).toFixed(2) + '%';
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
    const map = Object.create(null);
    links.forEach(function (a) { map[a.dataset.rail] = a; });
    if ('IntersectionObserver' in window) {
      const spy = new IntersectionObserver(function (list) {
        list.forEach(function (it) {
          if (!it.isIntersecting) return;
          links.forEach(function (a) { a.removeAttribute('aria-current'); });
          const a = map[it.target.dataset.id];
          if (a) {
            a.setAttribute('aria-current', 'true');
            const rail = $('#railList');
            const left = a.offsetLeft - rail.clientWidth / 2 + a.clientWidth / 2;
            rail.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
          }
        });
      }, { rootMargin: '-46% 0px -48% 0px', threshold: 0 });
      $$('.row').forEach(function (r) { spy.observe(r); });
    }
  }

  /* ---------------------------------------------------------------- *
   * 灯箱
   * ---------------------------------------------------------------- */
  const slides = [];
  const slideStart = Object.create(null);
  entries.forEach(function (e) {
    slideStart[e.id] = slides.length;
    slides.push({
      src: imageOf(e.image),
      title: e.title,
      sub: e.place + ' · ' + e.years + ' · ' + e.kind,
      creditId: e.creditId || e.id,
    });
    (e.extra || []).forEach(function (x) {
      slides.push({
        src: imageOf(x.src),
        title: x.label,
        sub: e.title + ' · 附图',
        creditId: x.id || e.id,
      });
    });
  });

  const lb = {
    index: -1, scale: 1, tx: 0, ty: 0, originX: '50%', originY: '50%',
    dragging: false, moved: false, startX: 0, startY: 0, baseX: 0, baseY: 0, lastFocus: null,
  };

  function lbApply() {
    const img = $('#lbImg');
    img.style.transformOrigin = lb.originX + ' ' + lb.originY;
    img.style.transform = 'translate(' + lb.tx + 'px,' + lb.ty + 'px) scale(' + lb.scale + ')';
    $('#lbStage').classList.toggle('zoomed', lb.scale > 1.01);
  }

  function lbReset() {
    lb.scale = 1; lb.tx = 0; lb.ty = 0; lb.originX = '50%'; lb.originY = '50%';
    lbApply();
  }

  function lbRender() {
    const s = slides[lb.index];
    if (!s) return;
    const c = creditOf(s.creditId);
    const img = $('#lbImg');
    img.dataset.fallback = '';
    img.src = s.src;
    img.alt = s.title;
    $('#lbTitle').textContent = s.title;
    $('#lbSub').textContent = s.sub;
    $('#lbCredit').innerHTML = c
      ? '图片：' + core.escapeHtml(creditLine(s.creditId)) +
        (c.sourceUrl ? ' · <a href="' + core.escapeHtml(c.sourceUrl) + '" target="_blank" rel="noopener noreferrer">在 Commons 查看原图 / 许可</a>' : '')
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
        lb.scale = 2.2; lb.tx = 0; lb.ty = 0;
        lbApply();
      }
    });

    img.addEventListener('dblclick', function (ev) { ev.preventDefault(); lbReset(); });

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
      lb.dragging = true; lb.moved = false;
      lb.startX = ev.clientX; lb.startY = ev.clientY;
      lb.baseX = lb.tx; lb.baseY = lb.ty;
      stage.classList.add('dragging');
      stage.setPointerCapture(ev.pointerId);
    });
    stage.addEventListener('pointermove', function (ev) {
      if (!lb.dragging) return;
      const dx = ev.clientX - lb.startX;
      const dy = ev.clientY - lb.startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) lb.moved = true;
      lb.tx = lb.baseX + dx; lb.ty = lb.baseY + dy;
      lbApply();
    });
    function endDrag() { lb.dragging = false; stage.classList.remove('dragging'); }
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);

    document.addEventListener('keydown', function (ev) {
      if (!box.hidden) {
        if (ev.key === 'Escape') { ev.preventDefault(); lbClose(); }
        else if (ev.key === 'ArrowLeft') { ev.preventDefault(); lbGo(-1); }
        else if (ev.key === 'ArrowRight') { ev.preventDefault(); lbGo(1); }
        else if (ev.key === '+' || ev.key === '=') { ev.preventDefault(); lb.scale = Math.min(4, lb.scale * 1.2); lbApply(); }
        else if (ev.key === '-') { ev.preventDefault(); lb.scale = Math.max(1, lb.scale / 1.2); if (lb.scale <= 1.01) lbReset(); else lbApply(); }
        return;
      }
      if (ev.key === 'Escape') closeAi();
    });

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
      if (btn) {
        ev.preventDefault();
        lbOpen(btn.dataset.open);
      }
    });
  }

  /* ---------------------------------------------------------------- *
   * 背景音乐
   * ---------------------------------------------------------------- */
  let player = null;
  let musicErrorShown = false;

  function initAudio() {
    const audioEl = $('#bgm');
    const btn = $('#musicBtn');
    const pop = $('#musicPop');
    const more = $('#musicMore');
    const vol = $('#musicVol');
    const out = $('#musicVolOut');
    if (!audioEl || !audioApi) return;

    const src = window.LI_QINGZHAO_AUDIO_DATA || AUDIO_META.src || 'assets/audio/yangguan-sandie.mp3';
    $('#musicTitle').textContent = AUDIO_META.title || '阳关三叠';
    const by = [];
    if (AUDIO_META.performer) by.push('演奏：' + core.escapeHtml(AUDIO_META.performer));
    if (AUDIO_META.instrument) by.push(core.escapeHtml(AUDIO_META.instrument));
    if (AUDIO_META.recorded) by.push(core.escapeHtml(AUDIO_META.recorded));
    $('#musicBy').innerHTML = by.join('<br>');
    const credit = [];
    if (AUDIO_META.score) credit.push('打谱：' + core.escapeHtml(AUDIO_META.score));
    if (AUDIO_META.license) credit.push('授权：' + core.escapeHtml(AUDIO_META.license));
    const link = AUDIO_META.sourceUrl
      ? '<a href="' + core.escapeHtml(AUDIO_META.sourceUrl) + '" target="_blank" rel="noopener noreferrer">Wikimedia Commons</a>'
      : 'Wikimedia Commons';
    $('#musicCredit').innerHTML = credit.join('<br>') + '<br>来源：' + link +
      (AUDIO_META.note ? '<br><span class="music-fine">' + core.escapeHtml(AUDIO_META.note) + '</span>' : '');

    player = audioApi.createPlayer({
      audio: audioEl,
      src: src,
      storage: storage,
      fadeMs: 1600,
      onState: function (s) {
        btn.setAttribute('aria-pressed', s.playing ? 'true' : 'false');
        const ico = btn.querySelector('.play-ico');
        if (ico) ico.textContent = s.playing ? '❚❚' : '▶';
        const panelPlay = $('#musicPlay');
        if (panelPlay) {
          panelPlay.textContent = s.playing ? '❚❚' : '▶';
          panelPlay.setAttribute('aria-label', s.playing ? '暂停古琴' : '播放古琴');
          panelPlay.title = s.playing ? '暂停古琴' : '播放古琴';
          panelPlay.setAttribute('aria-pressed', s.playing ? 'true' : 'false');
        }
        btn.classList.toggle('is-loading', !!s.loading);
        if (document.activeElement !== vol) {
          if (Number(vol.value) !== s.volume) vol.value = s.volume;
        }
        out.textContent = s.volume + '%';
        if (s.error && !musicErrorShown) {
          musicErrorShown = true;
          toast(s.error);
        }
      },
    });

    if (player && player.shouldResume()) {
      const resume = function (ev) {
        // 点在音乐按钮上时交给按钮自己处理，避免刚续播又被 toggle 暂停
        if (ev && ev.target && ev.target.closest && ev.target.closest('#audioDock')) return;
        if (player && !player.getState().playing) player.play().catch(function () {});
        document.removeEventListener('pointerdown', resume);
        document.removeEventListener('keydown', resume);
      };
      document.addEventListener('pointerdown', resume);
      document.addEventListener('keydown', resume);
    }

    btn.addEventListener('click', function () {
      if (!player) return;
      player.toggle().catch(function () {
        toast('浏览器要求先点一下页面才能出声');
      });
    });

    const panelPlay = $('#musicPlay');
    if (panelPlay) {
      panelPlay.addEventListener('click', function () {
        if (!player) return;
        player.toggle().catch(function () {
          toast('浏览器要求先点一下页面才能出声');
        });
      });
    }

    more.addEventListener('click', function (ev) {
      ev.stopPropagation();
      const open = pop.hidden;
      pop.hidden = !open;
      more.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    vol.addEventListener('input', function () {
      if (player) player.setVolume(Number(vol.value));
    });

    $('#musicHintClose').addEventListener('click', function () {
      pop.hidden = true;
      more.setAttribute('aria-expanded', 'false');
    });

    document.addEventListener('click', function (ev) {
      if (pop.hidden) return;
      if (ev.target.closest('#audioDock')) return;
      pop.hidden = true;
      more.setAttribute('aria-expanded', 'false');
    });

    document.addEventListener('visibilitychange', function () {
      if (!player) return;
      player.setDucked(document.hidden);
    });

    // 首屏静音准备：不自动播放，避免被浏览器拦
    out.textContent = (player ? player.getState().volume : 45) + '%';
  }

  /* ---------------------------------------------------------------- *
   * AI 问答
   * ---------------------------------------------------------------- */
  const CFG_KEY = 'lq.a2.config.v1';
  const DEFAULT_CFG = {
    base: (online && online.DEFAULT_BASE) || 'http://localhost:8383',
    provider: (online && online.PROVIDER) || 'deepseek',
    model: (online && online.MODEL) || 'deepseek-flash',
  };
  let cfg = loadCfg();
  let aiEntry = null;
  let aiBusy = false;
  let lastAsk = null;
  let aiStatus = { state: 'unknown', text: '检测中…' };

  function loadCfg() {
    const out = Object.assign({}, DEFAULT_CFG);
    try {
      const raw = storage && storage.getItem(CFG_KEY);
      if (raw) {
        const j = JSON.parse(raw);
        if (j && typeof j.base === 'string' && j.base.trim()) out.base = j.base.trim();
        if (j && typeof j.provider === 'string' && j.provider.trim()) out.provider = j.provider.trim();
        if (j && typeof j.model === 'string' && j.model.trim()) out.model = j.model.trim();
      }
    } catch (e) { /* ignore */ }
    if (online) out.base = online.normalizeBase(out.base);
    return out;
  }

  function syncSettingsSummary() {
    const d = $('#aiSettings');
    if (!d) return;
    const summary = d.querySelector('summary');
    if (summary) summary.textContent = '连接设置 · ' + cfg.base.replace(/^https?:\/\//, '');
  }

  function saveCfg() {
    try {
      if (storage) storage.setItem(CFG_KEY, JSON.stringify(cfg));
    } catch (e) { /* ignore */ }
  }

  function setAiStatus(state, text) {
    aiStatus = { state: state, text: text };
    const el = $('#aiStatus');
    el.dataset.state = state;
    el.textContent = text;
  }

  function probe() {
    if (!online) {
      setAiStatus('bad', '离线');
      return Promise.resolve({ ok: false, error: 'offline' });
    }
    setAiStatus('busy', '检测中…');
    return online.probe(cfg.base).then(function (r) {
      if (r.ok) setAiStatus('ok', '在线' + (r.version ? ' ' + r.version : ''));
      else if (r.error === 'timeout') setAiStatus('bad', '超时');
      else setAiStatus('bad', '离线');
      return r;
    });
  }

  function emptyAiBody(entry) {
    if (entry) {
      $('#aiBody').innerHTML =
        '<div class="ai-empty">' +
        '<p>关于《' + core.escapeHtml(entry.title) + '》</p>' +
        '<p>可以直接修改上面的问题，或从下面挑一个。回答会带上检索到的来源链接。</p>' +
        '</div>';
      return;
    }
    $('#aiBody').innerHTML =
      '<div class="ai-empty">' +
      '<p>问一首词、一个人物，或一个「为什么」。</p>' +
      '<p>回答来自本机 tea_a2（默认 <code>localhost:8383</code>），会带上检索到的来源链接。</p>' +
      '</div>';
  }

  function openAi(entry) {
    aiEntry = entry || null;
    const q = $('#aiQuery');
    q.value = entry ? entry.question : '';
    $('#ai').hidden = false;
    document.body.style.overflow = 'hidden';
    emptyAiBody(entry);
    $('#aiMeta').textContent = entry ? '当前：' + entry.title : 'AI 生成 · 未经审核';
    if (aiStatus.state === 'unknown' || aiStatus.state === 'bad') probe();
    setTimeout(function () {
      q.focus();
      q.setSelectionRange(q.value.length, q.value.length);
    }, 60);
  }

  function closeAi() {
    if ($('#ai').hidden) return;
    $('#ai').hidden = true;
    if ($('#lightbox').hidden) document.body.style.overflow = '';
  }

  function answerHtml(content) {
    return core.renderAnswer(content);
  }

  function sourcesHtml(sources) {
    if (!sources || !sources.length) return '';
    return '<div class="ai-sources"><h3>来源 · ' + sources.length + '</h3><ol>' +
      sources.map(function (s) {
        const label = core.escapeHtml(s.title || s.url);
        return '<li><a href="' + core.escapeHtml(s.url) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>' +
          (s.summary ? '<br>' + core.escapeHtml(String(s.summary).slice(0, 160)) : '') + '</li>';
      }).join('') + '</ol></div>';
  }

  function renderAnswer(result) {
    if (result.ok) {
      $('#aiBody').innerHTML = '<div class="ai-answer">' + answerHtml(result.content) + '</div>' +
        sourcesHtml(result.sources);
      const bits = [
        (result.provider || cfg.provider) + ' / ' + (result.model || cfg.model),
        (result.elapsedMs ? (result.elapsedMs / 1000).toFixed(1) + 's' : ''),
        (result.sources && result.sources.length ? result.sources.length + ' 条来源' : ''),
      ].filter(Boolean);
      $('#aiMeta').textContent = bits.join(' · ') + ' · AI 生成，未经审核';
      setAiStatus('ok', '在线' + (aiStatus.text.indexOf(' ') > 0 ? aiStatus.text.slice(2) : ''));
    } else {
      const msg = (online && online.errorText(result.kind)) || '联网查询失败。';
      let hint = '';
      if (result.kind === 'offline' || result.kind === 'timeout') {
        hint = '<pre class="ai-hint">' + core.escapeHtml(online.startHint(cfg.base)) + '</pre>';
      }
      $('#aiBody').innerHTML = '<div class="ai-answer"><p>' + core.escapeHtml(msg) + '</p>' + hint + '</div>';
      $('#aiMeta').textContent = '失败 · ' + (result.error || 'unknown');
      setAiStatus('bad', result.kind === 'timeout' ? '超时' : '离线');
    }
    aiBusy = false;
    $('#aiSubmit').disabled = false;
  }

  function ask(text) {
    const q = String(text == null ? '' : text).trim();
    const problem = core.validateQuestion(q);
    if (problem) {
      toast(problem);
      return;
    }
    if (aiBusy) return;
    if (!online) {
      aiBusy = false;
      toast('online.js 未加载');
      return;
    }
    aiBusy = true;
    lastAsk = q;
    $('#aiSubmit').disabled = true;
    setAiStatus('busy', '检索中…');
    $('#aiBody').innerHTML = '<div class="ai-empty"><p>正在让本机 tea_a2 检索并回答…</p><p class="muted">通常 10—40 秒。</p></div>';
    $('#aiMeta').textContent = '检索中…';

    online.search(q, {
      entry: aiEntry,
      meta: meta,
      base: cfg.base,
      provider: cfg.provider,
      model: cfg.model,
    }).then(renderAnswer).catch(function (e) {
      aiBusy = false;
      $('#aiSubmit').disabled = false;
      setAiStatus('bad', '失败');
      $('#aiBody').innerHTML = '<div class="ai-answer"><p>请求出错：' + core.escapeHtml(e.message || 'unknown') + '</p></div>';
    });
  }

  function initAi() {
    if (!online) return;

    $('#aiBase').value = cfg.base;
    $('#aiProvider').value = cfg.provider;
    $('#aiModel').value = cfg.model;
    syncSettingsSummary();

    $('#aiFab').addEventListener('click', function () {
      openAi(aiEntry || null);
    });

    document.addEventListener('click', function (ev) {
      const closer = ev.target.closest('[data-ai="close"]');
      if (closer) { closeAi(); return; }
      const askBtn = ev.target.closest('[data-ask]');
      if (askBtn) {
        ev.preventDefault();
        openAi(byId[askBtn.dataset.ask] || null);
        return;
      }
    });

    $('#aiForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      ask($('#aiQuery').value);
    });

    $('#aiQuery').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        ask(this.value);
      }
    });

    $('#aiClear').addEventListener('click', function () {
      emptyAiBody(aiEntry);
      $('#aiMeta').textContent = aiEntry ? '当前：' + aiEntry.title : 'AI 生成 · 未经审核';
    });

    const settingsBtn = $('#aiSettingsBtn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', function () {
        const d = $('#aiSettings');
        d.open = !d.open;
        this.setAttribute('aria-expanded', d.open ? 'true' : 'false');
        if (d.open) d.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    }

    $('#aiSaveSettings').addEventListener('click', function () {
      cfg = {
        base: online.normalizeBase($('#aiBase').value),
        provider: $('#aiProvider').value.trim() || DEFAULT_CFG.provider,
        model: $('#aiModel').value.trim() || DEFAULT_CFG.model,
      };
      $('#aiBase').value = cfg.base;
      syncSettingsSummary();
      saveCfg();
      probe();
      toast('设置已保存，正在探测');
    });

    $('#aiResetSettings').addEventListener('click', function () {
      cfg = Object.assign({}, DEFAULT_CFG);
      $('#aiBase').value = cfg.base;
      $('#aiProvider').value = cfg.provider;
      $('#aiModel').value = cfg.model;
      saveCfg();
      probe();
      toast('已恢复默认设置');
    });

    // 静默探测一次；失败不打扰
    probe();
  }

  /* ---------------------------------------------------------------- *
   * 启动
   * ---------------------------------------------------------------- */
  function boot() {
    document.body.classList.add('has-reveal');
    renderHero();
    renderRail();
    renderTimeline();
    initScroll();
    initLightbox();
    initAudio();
    initAi();

    const problems = core.validate(DATA.entries);
    if (problems.length) console.warn('[李清照] 数据问题：', problems);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
