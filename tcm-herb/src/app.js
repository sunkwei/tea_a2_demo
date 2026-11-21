/**
 * 中药大全 · 交互层
 *
 * 只做 DOM 与路由；检索、归一化、排序在 core.js，历史在 storage.js，联网在 online.js。
 *
 * 路由（hash，file:// 下同样可用）：
 *   #/                      药材图鉴（默认）
 *   #/herbs  #/symptoms  #/formulas
 *   #/herb/<id>  #/symptom/<id>  #/formula/<id>
 *   #/search/<关键词>
 */
(function () {
  'use strict';

  var C = window.TCMCore;
  var S = window.TCMStorage;
  var O = window.TCMOnline;
  var HERBS = window.TCM_HERBS || [];
  var SYMPTOMS = window.TCM_SYMPTOMS || [];
  var FORMULAS = window.TCM_FORMULAS || [];

  if (!C || !S || !O) {
    document.body.innerHTML = '<main style="padding:40px"><h1>加载失败</h1><p>核心脚本未加载，请确认 src/ 目录完整。</p></main>';
    return;
  }

  var state = {
    index: null,
    store: null,
    tab: 'herbs',
    category: '',
    group: 'all',
    theme: 'auto',
    base: O.DEFAULT_BASE,
    online: { ok: null, at: 0, info: null },
    onlineBusy: false,
  };

  var dom = {};
  var HISTORY_SHOW = 8;

  /* ------------------------------------------------------------------ *
   * 初始化
   * ------------------------------------------------------------------ */

  function init() {
    dom.view = document.getElementById('view');
    dom.q = document.getElementById('q');
    dom.form = document.getElementById('searchForm');
    dom.history = document.getElementById('history');
    dom.toast = document.getElementById('toast');
    dom.dialog = document.getElementById('dialog');
    dom.themeBtn = document.getElementById('themeBtn');

    if (!HERBS.length) {
      dom.view.innerHTML = '<div class="empty"><div class="big">🌿</div><h3>数据未加载</h3><p>请确认 src/data-herbs.js 等文件存在。</p></div>';
      return;
    }

    state.index = C.buildIndex({ herbs: HERBS, symptoms: SYMPTOMS, formulas: FORMULAS });
    state.store = S.store();

    initTheme();
    bindEvents();
    renderHistory();
    handleRoute();
    probeOnline();
  }

  function bindEvents() {
    dom.form.addEventListener('submit', function (e) {
      e.preventDefault();
      var q = dom.q.value.trim();
      if (!q) {
        dom.q.focus();
        return;
      }
      goSearch(q);
    });

    dom.themeBtn.addEventListener('click', function () {
      var next = effectiveTheme() === 'dark' ? 'light' : 'dark';
      setTheme(next);
    });

    window.addEventListener('hashchange', handleRoute);

    document.querySelectorAll('.tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tab = btn.getAttribute('data-tab');
        location.hash = '#/' + tab;
      });
    });

    dom.view.addEventListener('click', function (e) {
      var target = e.target.closest ? e.target.closest('[data-go]') : null;
      if (!target) return;
      var kind = target.getAttribute('data-go');
      var ref = target.getAttribute('data-ref') || '';
      if (kind === 'search') {
        goSearch(ref);
      } else if (kind === 'tab') {
        location.hash = '#/' + ref;
      } else if (kind === 'online') {
        runOnline(ref);
      } else {
        navigate(kind, ref);
      }
    });

    dom.history.addEventListener('click', function (e) {
      var del = e.target.closest ? e.target.closest('[data-del]') : null;
      if (del) {
        e.stopPropagation();
        state.store.remove(del.getAttribute('data-del'));
        renderHistory();
        return;
      }
      var chip = e.target.closest ? e.target.closest('[data-href]') : null;
      if (!chip) return;
      var kind = chip.getAttribute('data-kind');
      var ref = chip.getAttribute('data-href');
      if (ref && (kind === 'herb' || kind === 'symptom' || kind === 'formula')) {
        navigate(kind, ref);
      } else {
        goSearch(chip.getAttribute('data-text') || '');
      }
    });

    dom.dialog.addEventListener('click', function (e) {
      if (e.target === dom.dialog) closeDialog();
      var act = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!act) return;
      var a = act.getAttribute('data-act');
      if (a === 'close') closeDialog();
      if (a === 'clear-history') {
        state.store.clear();
        renderHistory();
        closeDialog();
        toast('查询历史已清空');
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!dom.dialog.hidden) closeDialog();
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * 主题
   * ------------------------------------------------------------------ */

  function initTheme() {
    var saved = '';
    try { saved = localStorage.getItem('tcm-herb/theme') || ''; } catch (e) { saved = ''; }
    setTheme(saved === 'dark' || saved === 'light' ? saved : 'auto', true);
  }

  function effectiveTheme() {
    var attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'dark' || attr === 'light') return attr;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function setTheme(theme, silent) {
    state.theme = theme;
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('tcm-herb/theme', theme); } catch (e) { /* 忽略 */ }
    if (dom.themeBtn) {
      dom.themeBtn.textContent = theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '◐';
      dom.themeBtn.title = theme === 'auto' ? '跟随系统（点击切深色）' : theme === 'dark' ? '深色（点击切浅色）' : '浅色（点击跟随系统）';
      dom.themeBtn.setAttribute('aria-label', dom.themeBtn.title);
    }
    if (!silent) toast(theme === 'auto' ? '已跟随系统深浅色' : theme === 'dark' ? '已切换深色' : '已切换浅色');
  }

  /* ------------------------------------------------------------------ *
   * 路由
   * ------------------------------------------------------------------ */

  function parseHash() {
    var raw = location.hash.replace(/^#\/?/, '');
    var parts = raw.split('/').filter(Boolean);
    function dec(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
    if (!parts.length) return { name: 'herbs' };
    var head = dec(parts[0]);
    if (head === 'search') {
      return { name: 'search', q: dec(parts.slice(1).join('/')) };
    }
    if ((head === 'herb' || head === 'symptom' || head === 'formula') && parts[1]) {
      return { name: head, id: dec(parts[1]) };
    }
    if (head === 'herbs' || head === 'symptoms' || head === 'formulas') {
      return { name: head };
    }
    return { name: 'herbs' };
  }

  function handleRoute() {
    var route = parseHash();
    window.scrollTo(0, 0);

    if (route.name === 'herbs' || route.name === 'symptoms' || route.name === 'formulas') {
      state.tab = route.name;
    } else if (route.name === 'herb') {
      state.tab = 'herbs';
    } else if (route.name === 'symptom') {
      state.tab = 'symptoms';
    } else if (route.name === 'formula') {
      state.tab = 'formulas';
    }

    var tabBtns = document.querySelectorAll('.tab');
    for (var i = 0; i < tabBtns.length; i++) {
      var t = tabBtns[i];
      var isActive = t.getAttribute('data-tab') === state.tab;
      t.classList.toggle('active', isActive);
      t.setAttribute('aria-selected', isActive ? 'true' : 'false');
    }

    if (route.name === 'herbs') return renderHerbs();
    if (route.name === 'symptoms') return renderSymptoms();
    if (route.name === 'formulas') return renderFormulas();
    if (route.name === 'herb') return renderHerb(route.id);
    if (route.name === 'symptom') return renderSymptom(route.id);
    if (route.name === 'formula') return renderFormula(route.id);
    if (route.name === 'search') return renderSearch(route.q);
    renderHerbs();
  }

  function navigate(kind, id) {
    var item = state.index.byId[kind] && state.index.byId[kind][id];
    if (!item) {
      toast('没有找到这条内容');
      return;
    }
    var labels = { herb: '药材', symptom: '病症', formula: '方剂' };
    state.store.add({ kind: kind, text: item.name, label: labels[kind] + ' · ' + item.name, refId: item.id });
    renderHistory();
    location.hash = '#/' + kind + '/' + encodeURIComponent(id);
  }

  function goSearch(q) {
    var text = String(q || '').trim();
    if (!text) return;
    state.store.add({ kind: 'keyword', text: text });
    renderHistory();
    dom.q.value = text;
    location.hash = '#/search/' + encodeURIComponent(text);
  }

  /* ------------------------------------------------------------------ *
   * 历史
   * ------------------------------------------------------------------ */

  function renderHistory() {
    var list = state.store.list();
    if (!list.length) {
      dom.history.hidden = true;
      dom.history.innerHTML = '';
      return;
    }
    var shown = list.slice(0, HISTORY_SHOW);
    var html = '<span class="h-label">最近</span>';
    shown.forEach(function (item) {
      var isRef = !!item.refId;
      html += '<span class="chip" data-href="' + esc(item.refId || '') + '" data-kind="' + esc(item.kind) +
        '" data-text="' + esc(item.text) + '" title="' + esc(item.label) + '">' +
        '<span class="h-text">' + esc(item.text) + '</span>' +
        (item.hitCount > 1 ? '<span class="h-count">×' + item.hitCount + '</span>' : '') +
        '<button class="h-del" type="button" data-del="' + esc(item.id) + '" aria-label="删除这条历史">×</button>' +
        '</span>';
    });
    if (list.length > 1) {
      html += '<button class="ghost" type="button" data-act="open-clear" style="flex:none">清空</button>';
    }
    dom.history.innerHTML = html;
    dom.history.hidden = false;

    var clearBtn = dom.history.querySelector('[data-act="open-clear"]');
    if (clearBtn) {
      clearBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openDialog('清空查询历史？', '共 ' + list.length + ' 条记录，清空后不可恢复。', [
          { text: '取消', act: 'close', ghost: true },
          { text: '清空', act: 'clear-history' },
        ]);
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * 图鉴
   * ------------------------------------------------------------------ */

  function renderHerbs() {
    var herbs = state.index.herbs;
    var cats = state.index.categories;
    var elderly = state.index.symptoms.filter(function (s) { return (s.groups || []).indexOf('老年') >= 0; });
    var elderlyOnly = elderly.filter(function (s) { return (s.groups || []).indexOf('常见') < 0; });

    var list = state.category ? herbs.filter(function (h) { return h.category === state.category; }) : herbs;

    var html = '';
    html += '<div class="online-card">' +
      '<h3>👵 老年常见</h3>' +
      '<p class="hint">共 ' + elderly.length + ' 个病症适合老年调理，其中 ' + elderlyOnly.length + ' 个为老年特有：' +
      elderlyOnly.slice(0, 6).map(function (s) { return esc(s.name); }).join(' · ') + ' 等。</p>' +
      '<div class="row">' +
      '<button class="ghost" type="button" data-go="tab" data-ref="symptoms">查看全部病症 →</button>' +
      '<button class="ghost" type="button" data-go="search" data-ref="帕金森病">先看帕金森病 →</button>' +
      '</div></div>';

    html += '<div class="section-head"><h2>药材图鉴</h2><span class="count">' + list.length + ' / ' + herbs.length + ' 味</span></div>';

    html += '<div class="filters" role="group" aria-label="按功效分类筛选">';
    html += filterChip('', '全部', herbs.length);
    cats.forEach(function (c) {
      html += filterChip(c.name, c.name, c.count);
    });
    html += '</div>';

    if (!list.length) {
      html += emptyBlock('这个分类下还没有药材', '换一个分类看看。');
    } else {
      html += '<div class="grid">' + list.map(herbCard).join('') + '</div>';
    }

    dom.view.innerHTML = html;
    bindFilters();
  }

  function filterChip(value, label, count) {
    var active = state.category === value;
    return '<button class="fchip" type="button" data-cat="' + esc(value) + '" aria-pressed="' + (active ? 'true' : 'false') + '">' +
      esc(label) + '<span class="n">' + count + '</span></button>';
  }

  function bindFilters() {
    var chips = dom.view.querySelectorAll('[data-cat]');
    for (var i = 0; i < chips.length; i++) {
      chips[i].addEventListener('click', function () {
        state.category = this.getAttribute('data-cat') || '';
        renderHerbs();
      });
    }
  }

  function herbCard(h) {
    return '<button class="herb-card" type="button" data-go="herb" data-ref="' + esc(h.id) + '">' +
      '<img class="thumb" src="' + esc(imgSrc(h)) + '" alt="' + esc(h.name) + '图片" loading="lazy" onerror="window.__tcmImgFallback(this)">' +
      '<span class="body">' +
      '<span class="nm">' + esc(h.name) + '</span>' +
      '<span class="eff">' + esc(h.efficacy.join(' · ')) + '</span>' +
      '<span class="tags">' + natureTag(h) + '<span class="tag plain">' + esc(h.category) + '</span></span>' +
      '</span></button>';
  }

  function natureTag(h) {
    var warm = ['温', '热', '微温', '大热'];
    var cls = warm.indexOf(h.nature) >= 0 ? 'tag warm' : 'tag';
    return '<span class="' + cls + '">' + esc(h.nature === '微温' ? '温' : h.nature === '大热' ? '热' : h.nature) + '</span>';
  }

  /* ------------------------------------------------------------------ *
   * 病症
   * ------------------------------------------------------------------ */

  function renderSymptoms() {
    var all = state.index.symptoms;
    var list = all.filter(function (s) {
      if (state.group === 'all') return true;
      return (s.groups || []).indexOf(state.group) >= 0;
    });

    var html = '<div class="section-head"><h2>按病症查药</h2><span class="count">' + list.length + ' 个</span></div>' +
      '<p class="section-note">按现代症状描述归类；「老年常见」包含帕金森病、胃酸过多、骨质疏松、前列腺增生等。</p>';

    html += '<div class="filters" role="group" aria-label="病症分组">';
    html += groupChip('all', '全部', all.length);
    html += groupChip('常见', '常见', state.index.symptomGroups.common);
    html += groupChip('老年', '老年常见', state.index.symptomGroups.elderly);
    html += '</div>';

    html += '<div class="cards two">';
    list.forEach(function (s) {
      html += '<button class="formula-card" type="button" data-go="symptom" data-ref="' + esc(s.id) + '">' +
        '<span class="fn">' + esc(s.name) + (s.groups && s.groups.indexOf('老年') >= 0 ? ' <span class="tag old">老年常见</span>' : '') + '</span>' +
        '<span class="src">' + esc(s.system) + ' · ' + (s.herbs || []).length + ' 味药 · ' + (s.formulas || []).length + ' 首验方</span>' +
        '<span class="ind">' + esc(s.desc) + '</span>' +
        (s.warning ? '<span class="tags" style="margin-top:8px"><span class="tag warn">需就医提示</span></span>' : '') +
        '</button>';
    });
    html += '</div>';

    dom.view.innerHTML = html;

    var chips = dom.view.querySelectorAll('[data-group]');
    for (var i = 0; i < chips.length; i++) {
      chips[i].addEventListener('click', function () {
        state.group = this.getAttribute('data-group');
        renderSymptoms();
      });
    }
  }

  function groupChip(value, label, count) {
    var active = state.group === value;
    return '<button class="fchip" type="button" data-group="' + esc(value) + '" aria-pressed="' + (active ? 'true' : 'false') + '">' +
      esc(label) + '<span class="n">' + count + '</span></button>';
  }

  /* ------------------------------------------------------------------ *
   * 方剂
   * ------------------------------------------------------------------ */

  function renderFormulas() {
    var list = state.index.formulas;
    var html = '<div class="section-head"><h2>历史验方</h2><span class="count">' + list.length + ' 首</span></div>' +
      '<p class="section-note">只列方名、出处、功效、主治与组成药名；<b>不提供剂量与煎服法</b>，仅供研习。</p>';
    html += '<div class="cards two">';
    list.forEach(function (f) {
      html += '<button class="formula-card" type="button" data-go="formula" data-ref="' + esc(f.id) + '">' +
        '<span class="fn">' + esc(f.name) + '</span>' +
        '<span class="src">' + esc(f.source) + '</span>' +
        '<span class="ind">' + esc(f.indications) + '</span>' +
        '</button>';
    });
    html += '</div>';
    dom.view.innerHTML = html;
  }

  /* ------------------------------------------------------------------ *
   * 详情
   * ------------------------------------------------------------------ */

  function crumbs(tableLabel, tableHash, name) {
    return '<div class="crumbs"><a href="#/' + tableHash + '">' + esc(tableLabel) + '</a>' +
      '<span class="sep">/</span><span>' + esc(name) + '</span></div>';
  }

  function renderHerb(id) {
    var h = state.index.byId.herb[id];
    if (!h) return notFound('药材');

    var symptoms = C.symptomListForHerb(state.index, id);
    var formulas = C.formulaListForHerb(state.index, id);
    var credit = (window.TCM_IMAGE_CREDITS || {})[id] || null;

    var html = crumbs('药材图鉴', 'herbs', h.name);
    html += '<div class="detail-hero">' +
      '<img class="pic" src="' + esc(imgSrc(h)) + '" alt="' + esc(h.name) + '图片" onerror="window.__tcmImgFallback(this)">' +
      '<div class="head">' +
      '<h2>' + esc(h.name) + '</h2>' +
      (h.alias && h.alias.length ? '<p class="alias">别名：' + esc(h.alias.join('、')) + '</p>' : '') +
      '<p class="py">' + esc(h.pinyin) + ' · ' + esc(h.initial.toUpperCase()) + ' · ' + esc(h.category) + '</p>' +
      '<div class="badges">' + natureTag(h) + h.flavor.map(function (f) { return '<span class="tag plain">' + esc(f) + '</span>'; }).join('') +
      '<span class="tag ' + (h.toxicity === '无毒' ? '' : 'warn') + '">' + esc(h.toxicity) + '</span></div>' +
      '</div></div>';

    if (h.toxicity !== '无毒') {
      html += '<div class="notice"><strong>⚠ ' + esc(h.toxicity) + '药材</strong>：须炮制并在医师指导下使用，不可自行加大用量或久服。</div>';
    }

    html += '<div class="card"><h3>简介</h3><p>' + esc(h.indications) + '</p></div>';

    html += '<div class="card"><h3>功效</h3><div class="eff-list">' +
      h.efficacy.map(function (e) { return '<span class="tag">' + esc(e) + '</span>'; }).join('') + '</div></div>';

    html += '<div class="card"><h3>属性</h3><dl class="kv">' +
      kv('性味', h.nature + '，' + h.flavor.join('、')) +
      kv('归经', h.meridians.join('、')) +
      (h.ascending ? kv('升降浮沉', h.ascending) : '') +
      kv('功效分类', h.category) +
      kv('用法用量', h.usage) +
      kv('炮制', (h.processing || []).join('、') || '—') +
      kv('毒性', h.toxicity) +
      kv('产地', h.origin || '—') +
      kv('来源', h.source) +
      '</dl></div>';

    if (h.contraindication && h.contraindication.length) {
      html += '<div class="card"><h3>禁忌与注意</h3><div class="notice mild"><strong>请注意</strong><ul style="margin:8px 0 0 18px;padding:0">' +
        h.contraindication.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul></div></div>';
    }

    if (symptoms.length) {
      html += '<div class="card"><h3>相关病症</h3><div class="link-row">' +
        symptoms.map(function (s) {
          return '<button class="link-pill" type="button" data-go="symptom" data-ref="' + esc(s.id) + '">' + esc(s.name) + '</button>';
        }).join('') + '</div></div>';
    }

    if (formulas.length) {
      html += '<div class="card"><h3>相关验方</h3><div class="link-row">' +
        formulas.map(function (f) {
          var role = C.roleOfHerbInFormula(f, id);
          return '<button class="link-pill" type="button" data-go="formula" data-ref="' + esc(f.id) + '">' +
            esc(f.name) + (role ? ' <small>' + esc(role) + '</small>' : '') + '</button>';
        }).join('') + '</div></div>';
    }

    html += '<div class="credit">' +
      (credit
        ? '图片来源：<a href="' + esc(credit.sourceUrl || 'https://commons.wikimedia.org/') + '" target="_blank" rel="noopener">Wikimedia Commons</a>' +
          ' · 「' + esc(credit.title || '未命名') + '」' +
          ' · 作者 ' + esc(credit.author || '未署名') +
          ' · ' + esc(credit.license || '') +
          (credit.licenseUrl ? '（<a href="' + esc(credit.licenseUrl) + '" target="_blank" rel="noopener">许可原文</a>）' : '')
        : '图片：程序化生成的示意图（未取得可自由使用的实物图）') +
      '</div>';

    dom.view.innerHTML = html;
  }

  function renderSymptom(id) {
    var s = state.index.byId.symptom[id];
    if (!s) return notFound('病症');

    var groups = C.symptomHerbs(state.index, id);
    var formulas = C.formulasForSymptom(state.index, id);

    var html = crumbs('按病症', 'symptoms', s.name);
    html += '<div class="sym-head">' +
      '<h2>' + esc(s.name) + ' ' + (s.groups && s.groups.indexOf('老年') >= 0 ? '<span class="tag old">老年常见</span>' : '') + '</h2>' +
      '<p class="desc">' + esc(s.desc) + '</p>' +
      (s.alias && s.alias.length ? '<p class="desc" style="font-size:13px;color:var(--ink-3)">又叫：' + esc(s.alias.join('、')) + '</p>' : '') +
      '</div>';

    if (s.warning) {
      html += '<div class="notice"><strong>⚠ 就医提示</strong>：' + esc(s.warning) + '</div>';
    }

    html += '<div class="card"><h3>常用药材</h3>';
    if (groups.primary.length) {
      html += '<p class="section-note">主要药材</p>' + groups.primary.map(herbLine('primary')).join('');
    }
    if (groups.secondary.length) {
      html += '<p class="section-note">辅助药材</p>' + groups.secondary.map(herbLine('secondary')).join('');
    }
    if (!groups.primary.length && !groups.secondary.length) {
      html += '<p>暂无收录。</p>';
    }
    html += '</div>';

    if (s.pairs && s.pairs.length) {
      html += '<div class="card"><h3>常用搭配</h3><div class="pairs">';
      s.pairs.forEach(function (p) {
        var names = (p.herbs || []).map(function (hid) {
          var h = state.index.byId.herb[hid];
          return h ? '<button class="link-pill" type="button" data-go="herb" data-ref="' + esc(h.id) + '">' + esc(h.name) + '</button>' : '';
        }).filter(Boolean);
        html += '<div class="pair"><div class="combo">' + names.join('<span class="plus">+</span>') + '</div>' +
          '<p class="why">' + esc(p.desc) + '</p></div>';
      });
      html += '</div></div>';
    }

    if (formulas.length) {
      html += '<div class="card"><h3>历史验方</h3><div class="cards">';
      formulas.forEach(function (f) {
        html += '<button class="formula-card" type="button" data-go="formula" data-ref="' + esc(f.id) + '">' +
          '<span class="fn">' + esc(f.name) + '</span>' +
          '<span class="src">' + esc(f.source) + '</span>' +
          '<span class="ind">' + esc(f.indications) + '</span></button>';
      });
      html += '</div><p class="section-note">方剂仅列组成，不提供剂量与煎服法。</p></div>';
    }

    html += '<div class="credit">以上为中医科普信息，不构成诊疗建议；症状持续或加重请就医。</div>';
    dom.view.innerHTML = html;
  }

  function herbLine(role) {
    return function (row) {
      return '<div class="herb-line">' +
        '<span class="who" data-go="herb" data-ref="' + esc(row.herb.id) + '">' + esc(row.herb.name) + '</span>' +
        '<span class="why">' + esc(row.note || row.herb.efficacy.join('、')) + '</span>' +
        '<span class="role tag ' + (role === 'primary' ? '' : 'plain') + '">' + (role === 'primary' ? '主' : '辅') + '</span>' +
        '</div>';
    };
  }

  function renderFormula(id) {
    var f = state.index.byId.formula[id];
    if (!f) return notFound('方剂');

    var html = crumbs('历史验方', 'formulas', f.name);
    html += '<div class="sym-head"><h2>' + esc(f.name) + '</h2>' +
      '<p class="desc">' + esc(f.source) + '</p></div>';

    html += '<div class="notice mild"><strong>仅供研习</strong>：本页不提供剂量与煎服法，不作为处方依据；用药请遵医嘱。</div>';

    html += '<div class="card"><h3>功效</h3><p>' + esc(f.efficacy) + '</p></div>';
    html += '<div class="card"><h3>主治</h3><p>' + esc(f.indications) + '</p></div>';

    html += '<div class="card"><h3>组成</h3><div class="comp">';
    (f.composition || []).forEach(function (c) {
      var linked = c.herbId && state.index.byId.herb[c.herbId];
      html += '<div class="row"><span>' +
        (linked
          ? '<button class="link-pill" type="button" data-go="herb" data-ref="' + esc(c.herbId) + '">' + esc(c.name) + '</button>'
          : esc(c.name) + ' <span class="role-tag">（未收录）</span>') +
        '</span><span class="role-tag">' + esc(c.role || '') + '</span></div>';
    });
    html += '</div><p class="section-note">标「未收录」的药味不在本站 86 味图鉴内，仅列名以便对照原方。</p></div>';

    if (f.note) {
      html += '<div class="card"><h3>使用注意</h3><p>' + esc(f.note) + '</p></div>';
    }

    var syms = (f.relatedSymptoms || []).map(function (sid) { return state.index.byId.symptom[sid]; }).filter(Boolean);
    if (syms.length) {
      html += '<div class="card"><h3>相关病症</h3><div class="link-row">' +
        syms.map(function (s) { return '<button class="link-pill" type="button" data-go="symptom" data-ref="' + esc(s.id) + '">' + esc(s.name) + '</button>'; }).join('') +
        '</div></div>';
    }

    dom.view.innerHTML = html;
  }

  /* ------------------------------------------------------------------ *
   * 搜索
   * ------------------------------------------------------------------ */

  function renderSearch(rawQuery) {
    var q = String(rawQuery || '').trim();
    dom.q.value = q;

    if (!q) {
      dom.view.innerHTML = emptyBlock('输入点什么吧', '药材名、拼音首字母（如 gc）、病症或功效都可以。');
      return;
    }

    var r = C.search(state.index, q);
    var total = r.total;

    var html = '<div class="section-head"><h2>「' + esc(q) + '」</h2><span class="count">共命中 ' + total + ' 条</span></div>';

    if (!total) {
      html += emptyBlock('本地没有找到「' + q + '」', '可以换个说法，或试试拼音首字母（如 gc = 甘草）。');
    }

    if (r.herbs.length) {
      html += '<div class="section-head"><h2>药材</h2><span class="count">' + r.herbs.length + ' 味</span></div>';
      html += '<div class="grid">' + r.herbs.map(function (hit) {
        var note = '';
        if (hit.fuzzy) note = '疑似：可能是错别字';
        else if (hit.field && hit.field !== 'name') note = '命中：' + fieldLabel(hit.field);
        return '<div class="res-cell">' + herbCard(hit.item) +
          (note ? '<span class="res-note' + (hit.fuzzy ? ' warn' : '') + '">' + esc(note) + '</span>' : '') +
          '</div>';
      }).join('') + '</div>';
    }

    if (r.symptoms.length) {
      html += '<div class="section-head"><h2>病症</h2><span class="count">' + r.symptoms.length + ' 个</span></div>';
      html += '<div class="cards two">';
      r.symptoms.forEach(function (hit) {
        var s = hit.item;
        html += '<button class="formula-card" type="button" data-go="symptom" data-ref="' + esc(s.id) + '">' +
          '<span class="fn">' + esc(s.name) + (s.groups && s.groups.indexOf('老年') >= 0 ? ' <span class="tag old">老年常见</span>' : '') +
          (hit.fuzzy ? ' <span class="tag warn">疑似</span>' : '') + '</span>' +
          '<span class="src">' + esc(s.system) + ' · ' + (s.herbs || []).length + ' 味药</span>' +
          '<span class="ind">' + esc(s.desc) + '</span></button>';
      });
      html += '</div>';
    }

    if (r.formulas.length) {
      html += '<div class="section-head"><h2>方剂</h2><span class="count">' + r.formulas.length + ' 首</span></div>';
      html += '<div class="cards two">';
      r.formulas.forEach(function (hit) {
        var f = hit.item;
        html += '<button class="formula-card" type="button" data-go="formula" data-ref="' + esc(f.id) + '">' +
          '<span class="fn">' + esc(f.name) + '</span><span class="src">' + esc(f.source) + '</span>' +
          '<span class="ind">' + esc(f.indications) + '</span></button>';
      });
      html += '</div>';
    }

    html += onlineCard(q);
    dom.view.innerHTML = html;
    bindOnline(q);
  }

  function fieldLabel(field) {
    var map = {
      alias: '别名', pinyin: '拼音', initial: '拼音首字母', efficacy: '功效',
      category: '分类', indications: '主治', origin: '产地', desc: '说明',
      system: '系统', source: '出处', note: '注意', composition: '组成',
    };
    return map[field] || field;
  }

  /* ------------------------------------------------------------------ *
   * 联网
   * ------------------------------------------------------------------ */

  function onlineCard(q) {
    var st = state.online;
    var status = '';
    if (st.ok === true) {
      status = '<span class="tag">已连接本机 a2' + (st.info && st.info.model ? ' · ' + esc(st.info.model) : '') + '</span>';
    } else if (st.ok === false) {
      status = '<span class="tag warn">未连接本机 a2</span>';
    }
    return '<div class="online-card" id="onlineCard">' +
      '<h3>🌐 联网查询 ' + status + '</h3>' +
      '<p class="hint">本地没有或结果太少时，用本机 a2（localhost:8383）联网检索并由模型整理；' +
      '结果仅供参考，不写入本地药材库。</p>' +
      '<div class="row"><button class="primary" type="button" data-go="online" data-ref="' + esc(q) + '">联网查「' + esc(q) + '」</button></div>' +
      '<div id="onlineBody"></div>' +
      '</div>';
  }

  function bindOnline(q) {
    // 如果启动时已探测到不可用，直接把启动指引铺开，省一次点击
    if (state.online.ok === false) {
      var body = document.getElementById('onlineBody');
      if (body) body.innerHTML = startHelpHtml();
    }
    if (state.online.ok === null) probeOnline();
  }

  async function probeOnline(force) {
    var st = state.online;
    if (!force && st.ok !== null && Date.now() - st.at < 30000) return st;
    var res = await O.probe(state.base);
    state.online = { ok: res.ok, at: Date.now(), info: res };
    updateOnlineStatus();
    return state.online;
  }

  function updateOnlineStatus() {
    var card = document.getElementById('onlineCard');
    if (!card) return;
    var h3 = card.querySelector('h3');
    if (!h3) return;
    var st = state.online;
    var tag = st.ok === true
      ? '<span class="tag">已连接本机 a2' + (st.info && st.info.model ? ' · ' + esc(st.info.model) : '') + '</span>'
      : st.ok === false ? '<span class="tag warn">未连接本机 a2</span>' : '';
    h3.innerHTML = '🌐 联网查询 ' + tag;

    var body = document.getElementById('onlineBody');
    if (st.ok === false && body && !body.innerHTML) body.innerHTML = startHelpHtml();
  }

  function startHelpHtml() {
    return '<div class="boot-help">' +
      '<div>未连接本机 a2（' + esc(state.base) + '）。在终端执行：</div>' +
      '<code>tea_agent --port 8383 --workspace &lt;工作区目录&gt;</code>' +
      '<div>Windows 上 <code style="display:inline;padding:1px 5px">tea_agent.exe</code> 通常在 <code style="display:inline;padding:1px 5px">C:\\Users\\&lt;你&gt;\\bin</code>（已在 PATH）。端口必须是 8383。</div>' +
      '<div class="row" style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">' +
      '<button class="ghost" type="button" data-retry="1">重试连接</button>' +
      '<button class="ghost" type="button" data-copy="1">复制启动命令</button>' +
      '</div></div>';
  }

  function bindStartHelp(q) {
    var body = document.getElementById('onlineBody');
    if (!body) return;
    var retry = body.querySelector('[data-retry]');
    if (retry) {
      retry.addEventListener('click', function () {
        probeOnline(true).then(function (st) {
          if (st.ok) runOnline(q);
          else toast('仍然连不上，请确认 a2 已启动');
        });
      });
    }
    var copy = body.querySelector('[data-copy]');
    if (copy) {
      copy.addEventListener('click', function () {
        var text = 'tea_agent --port 8383 --workspace .';
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { toast('已复制启动命令'); }, function () { toast(text); });
        } else {
          toast(text);
        }
      });
    }
  }

  async function runOnline(q) {
    if (state.onlineBusy) return;
    var body = document.getElementById('onlineBody');
    if (!body) return;

    state.onlineBusy = true;
    body.innerHTML = '<div class="online-result"><p class="section-note">正在联网检索并整理，请稍候…</p></div>';

    var st = await probeOnline(true);
    if (!st.ok) {
      body.innerHTML = startHelpHtml();
      bindStartHelp(q);
      state.onlineBusy = false;
      return;
    }

    var res = await O.search(q, { base: state.base });
    state.onlineBusy = false;

    if (!res.ok) {
      body.innerHTML = '<div class="online-result"><p class="section-note">' + esc(O.errorText(res.kind)) + '</p>' +
        '<div class="row" style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">' +
        '<button class="ghost" type="button" data-retry-online="1">重试</button></div>' +
        (res.kind === 'offline' ? startHelpHtml() : '') + '</div>';
      var retry = body.querySelector('[data-retry-online]');
      if (retry) retry.addEventListener('click', function () { runOnline(q); });
      bindStartHelp(q);
      return;
    }

    var html = '<div class="online-result">';
    html += '<div class="notice mild"><strong>未经审核</strong>：以下内容由本机 a2 联网检索并由模型整理，仅供参考，不构成诊疗建议；查询内容已发送至模型服务商。</div>';

    if (res.content) {
      html += '<div class="llm" style="margin-top:10px">' + esc(res.content) + '</div>';
    }

    if (res.sources && res.sources.length) {
      html += '<div class="section-head" style="margin:14px 0 6px"><h2 style="font-size:15px">来源</h2><span class="count">' + res.sources.length + ' 条</span></div>';
      html += '<ul class="sources">';
      res.sources.slice(0, 12).forEach(function (s) {
        html += '<li>' +
          '<div class="st">' + esc(s.title || s.url) + '</div>' +
          '<a class="su" href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.url) + '</a>' +
          (s.summary ? '<div class="sm">' + esc(s.summary) + '</div>' : '') +
          '<div class="meta">' + (s.authority != null ? '权威度 ' + s.authority + ' · ' : '') +
          (s.score != null ? '相关度 ' + s.score : '') + '</div>' +
          '</li>';
      });
      html += '</ul>';
    }

    html += '<div class="row" style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">' +
      '<button class="ghost" type="button" data-save-online="1">记入历史</button>' +
      '<button class="ghost" type="button" data-retry-online="1">重新查询</button>' +
      '</div>';
    html += '<p class="section-note">耗时 ' + (res.elapsedMs ? (res.elapsedMs / 1000).toFixed(1) + ' 秒' : '—') +
      (res.provider ? ' · ' + esc(res.provider) + '/' + esc(res.model) : '') + '</p>';
    html += '</div>';
    body.innerHTML = html;

    var save = body.querySelector('[data-save-online]');
    if (save) {
      save.addEventListener('click', function () {
        state.store.add({ kind: 'online', text: q, label: '联网 · ' + q });
        renderHistory();
        toast('已记入查询历史');
      });
    }
    var retry2 = body.querySelector('[data-retry-online]');
    if (retry2) retry2.addEventListener('click', function () { runOnline(q); });
  }

  /* ------------------------------------------------------------------ *
   * 杂项
   * ------------------------------------------------------------------ */

  function imgSrc(h) {
    var credits = window.TCM_IMAGE_CREDITS || {};
    var c = credits[h.id];
    return (c && c.file) || h.image;
  }

  function kv(k, v) {
    return '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>';
  }

  function esc(s) { return C.escapeHtml(s); }

  function emptyBlock(title, text) {
    return '<div class="empty"><div class="big">🌿</div><h3>' + esc(title) + '</h3><p>' + esc(text) + '</p></div>';
  }

  function notFound(kind) {
    dom.view.innerHTML = emptyBlock('没有找到这个' + kind, '它可能已被删除，返回列表看看。') +
      '<div class="link-row"><button class="link-pill" type="button" data-go="tab" data-ref="herbs">回到药材图鉴</button></div>';
  }

  var toastTimer = null;
  function toast(msg) {
    if (!dom.toast) return;
    dom.toast.textContent = msg;
    dom.toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { dom.toast.hidden = true; }, 2400);
  }

  function openDialog(title, text, actions) {
    var html = '<div class="box" role="dialog" aria-modal="true"><h3>' + esc(title) + '</h3><p>' + esc(text) + '</p><div class="row">';
    actions.forEach(function (a) {
      html += '<button type="button" class="' + (a.ghost ? 'ghost' : 'primary') + '" data-act="' + esc(a.act) + '">' + esc(a.text) + '</button>';
    });
    html += '</div></div>';
    dom.dialog.innerHTML = html;
    dom.dialog.hidden = false;
  }

  function closeDialog() {
    dom.dialog.hidden = true;
    dom.dialog.innerHTML = '';
  }

  window.__tcmImgFallback = function (img) {
    if (!img || img.dataset.fallback) return;
    img.dataset.fallback = '1';
    var label = (img.getAttribute('alt') || '').replace(/图片$/, '').slice(0, 1) || '药';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 90">' +
      '<rect width="120" height="90" fill="#e8e0cd"/>' +
      '<text x="60" y="58" font-size="36" text-anchor="middle" fill="#2f6b57" font-family="serif">' + label + '</text></svg>';
    img.src = 'data:image/svg+xml,' + encodeURIComponent(svg);
  };

  init();
})();
