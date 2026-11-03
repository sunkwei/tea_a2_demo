/**
 * 便笺 · 交互层
 * 职责：DOM 渲染、增删改查、检索过滤、提醒调度、通知申请、设置面板、导入导出。
 */
(function () {
  'use strict';

  const C = window.StickyCore;
  if (!C) {
    console.error('[sticky-notes] core.js 未加载，功能不可用');
    return;
  }

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const el = {};

  const DEFAULT_SETTINGS = {
    leadMinutes: C.DEFAULT_LEAD_MINUTES,
    sound: true,
    notifyAsked: false,
    rules: C.DEFAULT_RULES.map((r) => Object.assign({}, r)),
    ai: { enabled: false, base: 'http://localhost:8383', model: '', timeoutMs: 45000, thinking: 'auto' },
  };

  let state = { notes: [], settings: Object.assign({}, DEFAULT_SETTINGS) };
  let ui = {
    query: '',
    regex: false,
    category: 'all',
    color: 'all',
    reminder: 'all',
    date: 'all',
    sort: 'created-desc',
    pinnedOnly: false,
  };

  let editingId = null;
  let timers = [];
  let titleTimer = null;
  let audioCtx = null;
  let storageOK = true;

  /* ================================================================== *
   * 存储
   * ================================================================== */

  function load() {
    let raw = null;
    try {
      raw = localStorage.getItem(C.STORAGE_KEY);
    } catch (e) {
      storageOK = false;
    }
    const parsed = C.deserialize(raw);
    state.notes = parsed.notes;
    state.settings = Object.assign({}, DEFAULT_SETTINGS, parsed.settings || {});
    state.settings.rules =
      parsed.settings && Array.isArray(parsed.settings.rules) && parsed.settings.rules.length
        ? parsed.settings.rules.map((r) => Object.assign({}, r))
        : DEFAULT_SETTINGS.rules.map((r) => Object.assign({}, r));
    if (!Number.isFinite(Number(state.settings.leadMinutes))) state.settings.leadMinutes = C.DEFAULT_LEAD_MINUTES;
    state.settings.ai = Object.assign(
      { enabled: false, base: 'http://localhost:8383', model: '', timeoutMs: 45000, thinking: 'auto' },
      state.settings.ai || {}
    );
  }

  function save() {
    try {
      localStorage.setItem(C.STORAGE_KEY, C.serialize(state));
      storageOK = true;
    } catch (e) {
      if (storageOK) toast('本地存储不可用，数据仅保留在内存中', 'err', 8000);
      storageOK = false;
    }
  }

  /* ================================================================== *
   * 渲染
   * ================================================================== */

  function render() {
    const now = Date.now();
    const { list, matcher } = C.filterNotes(state.notes, ui, now);

    // 搜索提示
    if (!matcher.ok) {
      el.searchInfo.textContent = `正则无效：${matcher.error}`;
      el.searchInfo.classList.add('err');
      el.searchWrap.classList.add('invalid');
    } else if (matcher.empty) {
      el.searchInfo.textContent = `共 ${state.notes.length} 条便笺`;
      el.searchInfo.classList.remove('err');
      el.searchWrap.classList.remove('invalid');
    } else {
      const hits = list.reduce((acc, n) => acc + C.countMatches(matcher, n.text), 0);
      el.searchInfo.textContent = `命中 ${list.length} 条便笺 / ${hits} 处匹配${matcher.isRegex ? '（正则）' : ''}`;
      el.searchInfo.classList.remove('err');
      el.searchWrap.classList.remove('invalid');
    }

    renderChips();
    syncCategoryFilter();
    renderStats(list, now);

    if (!list.length) {
      el.grid.innerHTML = '';
      el.empty.hidden = false;
      el.empty.querySelector('.msg').textContent = state.notes.length
        ? '没有符合条件的便笺，换个筛选条件试试。'
        : '还没有便笺，点右上角「＋ 新建」写第一条。';
    } else {
      el.empty.hidden = true;
      el.grid.innerHTML = list.map((n) => noteCard(n, matcher, now)).join('');
    }
  }

  function noteCard(n, matcher, now) {
    const catColor = categoryColor(n.category);
    const catFg = C.bestTextColor(catColor).color;
    const st = C.reminderStatus(n, now);
    return `
<article class="note${n.pinned ? ' pinned' : ''}" data-id="${n.id}" style="--bg:${n.bg};--fg:${n.fg}">
  <div class="note-head">
    <span class="note-cat" style="background:${catColor};color:${catFg}">${C.escapeHtml(n.category)}</span>
    ${n.autoCategory && n.autoCategory !== n.category ? `<span class="note-cat" style="background:transparent;color:inherit;border:1px dashed rgba(127,127,127,.6)" title="自动识别为 ${C.escapeHtml(n.autoCategory)}">自动:${C.escapeHtml(n.autoCategory)}</span>` : ''}
    <span class="spacer"></span>
    <button class="icon-btn" data-act="pin" title="${n.pinned ? '取消置顶' : '置顶'}">${n.pinned ? '★' : '☆'}</button>
  </div>
  <div class="note-body">${C.highlight(n.text, matcher)}</div>
  <div class="note-foot">
    <span title="创建于 ${C.formatDateTimeSeconds(n.createdAt)}">🕒 ${C.formatDateTime(n.createdAt)}</span>
    ${reminderBadge(n, now)}
  </div>
  <div class="note-acts">
    <button data-act="edit">编辑</button>
    <button data-act="remind">提醒</button>
    <button data-act="copy">复制</button>
    <button data-act="del">删除</button>
  </div>
</article>`;
  }

  function reminderBadge(n, now) {
    const st = C.reminderStatus(n, now);
    if (st.status === 'none') return '';
    return `<span class="rm" data-rm="${n.id}">${reminderText(st)}</span>`;
  }

  function reminderText(st) {
    switch (st.status) {
      case 'pending':
        return `⏰ 还有 ${C.formatCountdown(st.msLeft)}提醒`;
      case 'due':
        return '⏰ 正在提醒';
      case 'fired':
        return '✅ 已提醒';
      case 'expired':
        return '⏰ 已过期';
      default:
        return '';
    }
  }

  function updateReminderBadges(now) {
    for (const n of state.notes) {
      const node = el.grid.querySelector(`[data-rm="${CSS.escape(n.id)}"]`);
      if (!node) continue;
      const st = C.reminderStatus(n, now);
      node.textContent = reminderText(st);
      node.className = 'rm ' + st.status;
    }
  }

  function categoryColor(name) {
    const rule = state.settings.rules.find((r) => r.name === name);
    if (rule && rule.color) return rule.color;
    const map = {
      待办: '#FFD93D',
      工作: '#6EC6FF',
      学习: '#B39DFF',
      财务: '#7FE3C2',
      健康: '#7FE3C2',
      购物: '#FFB4A2',
      旅行: '#FF9F68',
      想法: '#FF6B81',
      生活: '#F4EFE3',
      私密: '#6B46C1',
      其他: '#94A3B8',
    };
    return map[name] || '#94A3B8';
  }

  function allCategories() {
    const set = new Set();
    state.notes.forEach((n) => set.add(n.category));
    state.settings.rules.forEach((r) => r.name && set.add(r.name));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  }

/** 让「全部分类」下拉与现有分类保持同步（保留用户选择） */
  function syncCategoryFilter() {
    if (!el.filterCat) return;
    const cats = allCategories();
    const current = ui.category && ui.category !== 'all' ? ui.category : el.filterCat.value;
    const html =
      '<option value="all">全部分类</option>' +
      cats.map((c) => '<option value="' + C.escapeHtml(c) + '">' + C.escapeHtml(c) + '</option>').join('');
    if (el.filterCat.dataset.sig !== html) {
      el.filterCat.dataset.sig = html;
      el.filterCat.innerHTML = html;
    }
    const keep = cats.includes(current) ? current : 'all';
    el.filterCat.value = keep;
    if (keep !== current) ui.category = keep;
  }


  function renderChips() {
    const counts = C.categoryCounts(state.notes);
    const cats = allCategories().slice().sort((x, y) => {
      const dx = counts.get(y) || 0;
      const cx = counts.get(x) || 0;
      return dx - cx || x.localeCompare(y, 'zh-Hans-CN');
    });
    const parts = [
      `<button class="chip${ui.category === 'all' ? ' on' : ''}" data-cat="all" style="${
        ui.category === 'all' ? 'background:var(--brand);color:#fff' : ''
      }">全部 <span class="n">${state.notes.length}</span></button>`,
    ];
    for (const c of cats) {
      const on = ui.category === c;
      const color = categoryColor(c);
      const fg = C.bestTextColor(color).color;
      parts.push(
        `<button class="chip${on ? ' on' : ''}" data-cat="${C.escapeHtml(c)}" style="${
          on ? `background:${color};color:${fg}` : ''
        }"><span class="dot" style="background:${color}"></span>${C.escapeHtml(c)} <span class="n">${
          counts.get(c) || 0
        }</span></button>`
      );
    }
    el.chips.innerHTML = parts.join('');
  }

  function renderStats(list, now) {
    const pending = state.notes.filter((n) => {
      const s = C.reminderStatus(n, now).status;
      return s === 'pending' || s === 'due';
    }).length;
    const today = state.notes.filter((n) => now - n.createdAt < 86400000).length;
    const cats = new Set(state.notes.map((n) => n.category)).size;
    el.stats.innerHTML = [
      `<span class="stat">共 <b>${state.notes.length}</b> 条</span>`,
      `<span class="stat">当前显示 <b>${list.length}</b> 条</span>`,
      `<span class="stat">待提醒 <b>${pending}</b> 条</span>`,
      `<span class="stat">24 小时内新增 <b>${today}</b> 条</span>`,
      `<span class="stat">分类 <b>${cats}</b> 个</span>`,
      `<span class="stat">数据存储：<b>${storageOK ? 'localStorage 已启用' : '仅内存（不可持久化）'}</b></span>`,
    ].join('');
  }

  /* ================================================================== *
   * 提醒调度
   * ================================================================== */

  function scheduleReminders() {
    timers.forEach((t) => clearTimeout(t));
    timers = [];
    const now = Date.now();
    let needReschedule = false;

    for (const n of state.notes) {
      if (!n.reminder || n.reminder.firedAt) continue;
      const st = C.reminderStatus(n, now);
      if (st.status === 'expired') {
        n.reminder.missed = true;
        continue;
      }
      if (st.status === 'due') {
        timers.push(setTimeout(() => fireReminder(n), 300));
        continue;
      }
      const delay = n.reminder.fireAt - now;
      if (delay >= 2147483647) {
        needReschedule = true;
        continue;
      }
      if (delay > 0) timers.push(setTimeout(() => fireReminder(n), delay));
    }
    if (needReschedule) timers.push(setTimeout(scheduleReminders, 60000));
    save();
  }

  function fireReminder(note) {
    if (!note || !note.reminder || note.reminder.firedAt) return;
    const st = C.reminderStatus(note, Date.now());
    if (st.status === 'expired') {
      note.reminder.missed = true;
      save();
      render();
      return;
    }
    note.reminder.firedAt = Date.now();
    note.reminder.missed = false;
    save();

    const head = firstLine(note.text) || '（空便笺）';
    const body = `${head}\n提醒时间 ${C.formatDateTime(note.reminder.at)}（提前 ${note.reminder.leadMinutes} 分钟发出）`;
    const usedSystem = notify('⏰ 便笺提醒', body, note.id);
    toast(
      `${usedSystem ? '🔔 提醒已发出' : '⏰ 应用内提醒'}：${head}`,
      'ok',
      9000
    );
    if (state.settings.sound) beep();
    flashTitle();
    render();
  }

  function firstLine(text) {
    const line = String(text || '')
      .split('\n')
      .map((s) => s.trim())
      .find(Boolean);
    return line ? line.slice(0, 60) : '';
  }

  /* ---------------------------- 通知 ---------------------------- */

  function notifySupported() {
    return typeof window !== 'undefined' && 'Notification' in window;
  }

  function notifyPermission() {
    if (!notifySupported()) return 'unsupported';
    return Notification.permission;
  }

  function notify(title, body, tag) {
    try {
      if (!notifySupported() || Notification.permission !== 'granted') return false;
      const icon =
        'data:image/svg+xml;utf8,' +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="%234f46e5"/><text x="32" y="45" font-size="34" text-anchor="middle">⏰</text></svg>'
        );
      const n = new Notification(title, { body, tag: 'sticky-' + tag, icon });
      n.onclick = () => {
        window.focus();
        n.close();
      };
      return true;
    } catch (e) {
      return false;
    }
  }

  async function ensureNotifyPermission(ask) {
    if (!notifySupported()) {
      updateNotifyState();
      toast('当前环境不支持系统通知 API，已启用应用内提醒（横幅 + 提示音 + 标题闪烁）', 'warn', 9000);
      return 'unsupported';
    }
    let p = Notification.permission;
    if (p === 'default' && ask) {
      try {
        p = await Notification.requestPermission();
      } catch (e) {
        p = Notification.permission;
      }
      state.settings.notifyAsked = true;
      save();
    }
    updateNotifyState();
    if (p === 'granted') {
      toast('✅ 已获得系统通知权限，提醒会弹出桌面通知', 'ok');
    } else if (p === 'denied') {
      toast(
        '⚠️ 系统通知被拒绝：改用应用内提醒（横幅 + 提示音 + 标题闪烁）。浏览器在 file:// 下通常直接拒绝通知，改用 http:// 打开即可获得桌面通知。',
        'warn',
        12000
      );
    }
    return p;
  }

  function updateNotifyState() {
    if (!el.notifyState) return;
    const p = notifyPermission();
    const map = {
      granted: ['ok', '已授权'],
      denied: ['bad', '已拒绝（使用应用内提醒）'],
      default: ['', '未申请'],
      unsupported: ['bad', '浏览器不支持 Notification API'],
    };
    const [cls, text] = map[p] || ['', p];
    el.notifyState.innerHTML = `<span class="status-dot ${cls}"></span>系统通知权限：<b>${text}</b>`;
  }

  function beep() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const base = audioCtx.currentTime;
      [
        [880, 0],
        [1174, 0.18],
        [1567, 0.36],
      ].forEach(([freq, t]) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, base + t);
        gain.gain.exponentialRampToValueAtTime(0.3, base + t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, base + t + 0.17);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(base + t);
        osc.stop(base + t + 0.2);
      });
    } catch (e) {
      /* 忽略 */
    }
  }

  function flashTitle() {
    if (titleTimer) return;
    const base = document.title;
    let n = 0;
    titleTimer = setInterval(() => {
      n++;
      document.title = n % 2 ? '🔔 便笺提醒！' : base;
      if (n >= 14) {
        clearInterval(titleTimer);
        titleTimer = null;
        document.title = base;
      }
    }, 700);
  }

  /* ================================================================== *
   * 编辑器
   * ================================================================== */

  function openEditor(id) {
    editingId = id || null;
    const note = id ? state.notes.find((n) => n.id === id) : null;

    el.nmTitle.textContent = note ? '编辑便笺' : '新建便笺';
    el.nmText.value = note ? note.text : '';
    el.nmDelete.hidden = !note;

    const bg = note ? note.bg : C.PALETTE[Math.floor(Math.random() * C.PALETTE.length)].bg;
    const fgAuto = note ? !note.fgLocked : true;
    el.nmBg.value = bg;
    el.nmFgAuto.checked = fgAuto;
    el.nmFg.value = note ? note.fg : C.bestTextColor(bg).color;

    renderSwatches(bg);

    // 分类
    const auto = C.classify(el.nmText.value, state.settings.rules);
    const cats = allCategories();
    el.nmCat.innerHTML =
      `<option value="__auto__">🤖 自动识别（建议：${C.escapeHtml(auto.category)}）</option>` +
      cats.map((c) => `<option value="${C.escapeHtml(c)}">${C.escapeHtml(c)}</option>`).join('');
    el.nmCat.value = note && note.category ? note.category : '__auto__';
    if (note && note.category && !cats.includes(note.category)) {
      const opt = document.createElement('option');
      opt.value = note.category;
      opt.textContent = note.category;
      el.nmCat.appendChild(opt);
      el.nmCat.value = note.category;
    }
    el.nmCatNew.value = '';

    // 提醒
    el.nmRemind.checked = !!(note && note.reminder);
    el.nmRemindAt.value = note && note.reminder ? C.toLocalInputValue(note.reminder.at) : '';
    el.nmRemindAt.disabled = !el.nmRemind.checked;
    el.nmLead.textContent = state.settings.leadMinutes;

    updateCatHint();
    updateContrast();
    updatePreview();

    el.noteModal.hidden = false;
    setTimeout(() => el.nmText.focus(), 30);
  }

  function closeEditor() {
    el.noteModal.hidden = true;
    editingId = null;
  }

  function renderSwatches(current) {
    el.nmSwatches.innerHTML = C.PALETTE.map(
      (p) =>
        `<button class="swatch${p.bg.toLowerCase() === String(current).toLowerCase() ? ' on' : ''}" data-bg="${
          p.bg
        }" style="background:${p.bg}" title="${p.name} ${p.bg}"></button>`
    ).join('');
  }

  function currentBg() {
    return el.nmBg.value;
  }

  function currentFg() {
    if (el.nmFgAuto.checked) return C.bestTextColor(currentBg()).color;
    return el.nmFg.value;
  }

  function updateContrast() {
    const bg = currentBg();
    const fg = currentFg();
    const ratio = C.contrastRatio(fg, bg);
    const grade = C.contrastGrade(ratio);
    const cls = grade === 'AAA' ? 'aaa' : grade === 'AA' ? 'aa' : grade === 'AA-Large' ? 'aal' : 'bad';
    const label = grade === 'AA-Large' ? 'AA（仅大字）' : grade;
    const advice =
      ratio < 4.5
        ? '　建议提高对比度：可勾选「自动」由系统挑选最高对比文字色。'
        : '　满足 WCAG AA 正文对比度要求。';
    el.nmContrast.innerHTML = `<span class="ratio">${ratio.toFixed(2)}:1</span><span class="badge ${cls}">${label}</span>${advice}`;
  }

  function updatePreview() {
    const bg = currentBg();
    const fg = currentFg();
    el.nmPreview.style.background = bg;
    el.nmPreview.style.color = fg;
    el.nmPreview.textContent = el.nmText.value || '（预览效果）';
  }

  function updateCatHint() {
    const auto = C.classify(el.nmText.value, state.settings.rules);
    const chosen = el.nmCatNew.value.trim() || el.nmCat.value;
    const kws = (auto.keywords && auto.keywords.length ? auto.keywords : auto.keyword ? [auto.keyword] : []);
    let hint = `按内容自动识别为「${auto.category}」${kws.length ? `（命中「${kws.join('、')}」）` : ''}`;
    if (auto.category === '私密') hint += '　⚠️ 检测到可能的敏感信息，请勿在便笺里保存密码/密钥。';
    if (chosen && chosen !== '__auto__' && chosen !== auto.category) hint += `　→ 已手动指定为「${chosen}」`;
    el.nmCatHint.textContent = hint;
    el.nmCatHint.className = 'hint' + (auto.category === '私密' ? ' warn' : '');
  }

  function saveNote() {
    const text = el.nmText.value.trim();
    if (!text) {
      toast('便笺内容不能为空', 'warn');
      el.nmText.focus();
      return;
    }
    const bg = currentBg();
    const fg = currentFg();
    const auto = C.classify(text, state.settings.rules);

    let category = auto.category;
    const custom = el.nmCatNew.value.trim();
    if (custom) category = custom;
    else if (el.nmCat.value && el.nmCat.value !== '__auto__') category = el.nmCat.value;

    let reminder = null;
    if (el.nmRemind.checked) {
      const at = C.fromLocalInputValue(el.nmRemindAt.value);
      if (!at) {
        toast('请选择提醒时间', 'warn');
        el.nmRemindAt.focus();
        return;
      }
      reminder = C.computeReminder(at, state.settings.leadMinutes);
    }

    const now = Date.now();
    if (editingId) {
      const n = state.notes.find((x) => x.id === editingId);
      if (n) {
        n.text = text;
        n.bg = bg;
        n.fg = fg;
        n.fgLocked = !el.nmFgAuto.checked;
        n.category = category;
        n.autoCategory = auto.category;
        n.manual = category !== auto.category;
        n.updatedAt = now;
        if (reminder) {
          const keepFired = n.reminder && n.reminder.at === reminder.at ? n.reminder.firedAt : null;
          n.reminder = Object.assign({}, reminder, { firedAt: keepFired });
        } else {
          n.reminder = null;
        }
      }
    } else {
      const note = C.createNote({
        text,
        bg,
        fg,
        category,
        reminderAt: reminder ? reminder.at : null,
        leadMinutes: state.settings.leadMinutes,
        rules: state.settings.rules,
        now,
      });
      note.fgLocked = !el.nmFgAuto.checked;
      note.manual = category !== auto.category;
      if (reminder) note.reminder = reminder;
      state.notes.push(note);
    }

    const wasEdit = !!editingId;
    save();
    closeEditor();
    render();
    scheduleReminders();
    toast(wasEdit ? '便笺已更新' : '便笺已创建', 'ok');
  }

  function deleteNote(id) {
    const n = state.notes.find((x) => x.id === id);
    if (!n) return;
    if (!confirm(`删除这条便笺？\n\n${firstLine(n.text) || '(空便笺)'}`)) return;
    state.notes = state.notes.filter((x) => x.id !== id);
    save();
    closeEditor();
    render();
    scheduleReminders();
    toast('便笺已删除');
  }

  /* ================================================================== *
   * 设置面板
   * ================================================================== */

  function openSettings() {
    el.setLead.value = state.settings.leadMinutes;
    el.setSound.checked = !!state.settings.sound;
    renderRules();
    updateNotifyState();
    if (window.StickyAIUI) window.StickyAIUI.syncSettingsUi();
    el.settingsModal.hidden = false;
  }

  function renderRules() {
    const rules = state.settings.rules
      .slice()
      .sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0));
    el.rules.innerHTML = rules
      .map(
        (r, i) => `
<div class="rule-row" data-id="${C.escapeHtml(r.id || 'r' + i)}">
  <input type="text" data-f="name" value="${C.escapeHtml(r.name || '')}" placeholder="分类名">
  <input type="text" data-f="pattern" value="${C.escapeHtml(r.pattern || '')}" placeholder="正则，如 会议|需求">
  <input type="number" data-f="priority" value="${Number(r.priority) || 0}" title="优先级（大者优先）">
  <input type="color" data-f="color" value="${C.normalizeHex(r.color || '#94A3B8')}" title="分类颜色">
  <button class="del" data-act="del-rule" title="删除规则">✕</button>
</div>`
      )
      .join('');
  }

  function collectRules() {
    const out = [];
    $$('.rule-row', el.rules).forEach((row) => {
      const id = row.dataset.id;
      const get = (f) => $(`[data-f="${f}"]`, row).value;
      const rule = {
        id,
        name: get('name').trim(),
        pattern: get('pattern'),
        priority: Number(get('priority')) || 0,
        color: C.normalizeHex(get('color')),
        enabled: true,
      };
      const check = C.validateRule(rule);
      if (!check.ok) {
        toast(`规则「${rule.name || '未命名'}」无效：${check.error}`, 'err', 7000);
        return;
      }
      out.push(rule);
    });
    return out;
  }

  function saveRules() {
    const rules = collectRules();
    if (!rules.length) {
      toast('至少保留一条规则', 'warn');
      return;
    }
    state.settings.rules = rules;
    save();
    // 重新自动归类（保留用户手动指定的分类）
    state.notes.forEach((n) => {
      const auto = C.classify(n.text, rules);
      n.autoCategory = auto.category;
      if (!n.manual) n.category = auto.category;
    });
    save();
    render();
    toast('分类规则已保存，便笺已重新归类', 'ok');
  }

  /* ================================================================== *
   * 导入导出
   * ================================================================== */

  function exportData() {
    const payload = { v: 1, exportedAt: Date.now(), notes: state.notes, settings: state.settings };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `便笺-${C.formatDateTime(Date.now()).replace(/[: ]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1000);
    toast('已导出 JSON 备份', 'ok');
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = C.deserialize(String(reader.result));
        if (!parsed.notes.length) {
          toast('文件中没有便笺数据', 'warn');
          return;
        }
        let added = 0;
        parsed.notes.forEach((n) => {
          const idx = state.notes.findIndex((x) => x.id === n.id);
          if (idx >= 0) state.notes[idx] = n;
          else {
            state.notes.push(n);
            added++;
          }
        });
        save();
        render();
        scheduleReminders();
        toast(`导入完成：新增 ${added} 条，更新 ${parsed.notes.length - added} 条`, 'ok');
      } catch (e) {
        toast('导入失败：文件不是有效的便笺 JSON', 'err');
      }
    };
    reader.onerror = () => toast('读取文件失败', 'err');
    reader.readAsText(file);
  }

  /* ================================================================== *
   * 提示条
   * ================================================================== */

  function toast(msg, kind, ms) {
    const div = document.createElement('div');
    div.className = 'toast ' + (kind || '');
    div.textContent = msg;
    el.toasts.appendChild(div);
    const life = ms || 4200;
    setTimeout(() => {
      div.style.opacity = '0';
      div.style.transform = 'translateX(16px)';
      setTimeout(() => div.remove(), 220);
    }, life);
  }

  /* ================================================================== *
   * 事件绑定
   * ================================================================== */

  function bind() {
    el.btnNew.addEventListener('click', () => openEditor(null));
    el.fab.addEventListener('click', () => openEditor(null));
    el.btnSettings.addEventListener('click', openSettings);

    // 弹窗关闭按钮（[data-close]）
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-close]');
      if (!btn) return;
      const modal = btn.closest('.modal');
      if (!modal) return;
      modal.hidden = true;
      if (modal === el.noteModal) editingId = null;
    });

    // 搜索
    el.search.addEventListener('input', () => {
      ui.query = el.search.value;
      render();
    });
    el.btnRegex.addEventListener('click', () => {
      ui.regex = !ui.regex;
      el.btnRegex.classList.toggle('on', ui.regex);
      el.btnRegex.textContent = ui.regex ? '.*' : '.*';
      el.btnRegex.title = ui.regex ? '正则模式：开（再次点击关闭）' : '正则模式：关';
      render();
    });

    // 筛选
    el.filterCat.addEventListener('change', () => {
      ui.category = el.filterCat.value;
      render();
    });
    el.filterColor.addEventListener('change', () => {
      ui.color = el.filterColor.value;
      render();
    });
    el.filterReminder.addEventListener('change', () => {
      ui.reminder = el.filterReminder.value;
      render();
    });
    el.filterDate.addEventListener('change', () => {
      ui.date = el.filterDate.value;
      render();
    });
    el.sort.addEventListener('change', () => {
      ui.sort = el.sort.value;
      render();
    });
    el.filterPinned.addEventListener('change', () => {
      ui.pinnedOnly = el.filterPinned.checked;
      render();
    });
    el.btnReset.addEventListener('click', () => {
      ui.query = '';
      ui.regex = false;
      ui.category = 'all';
      ui.color = 'all';
      ui.reminder = 'all';
      ui.date = 'all';
      ui.sort = 'created-desc';
      ui.pinnedOnly = false;
      el.search.value = '';
      el.btnRegex.classList.remove('on');
      el.filterCat.value = 'all';
      el.filterColor.value = 'all';
      el.filterReminder.value = 'all';
      el.filterDate.value = 'all';
      el.sort.value = 'created-desc';
      el.filterPinned.checked = false;
      render();
    });

    // 分类 chip
    el.chips.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      ui.category = chip.dataset.cat;
      el.filterCat.value = ui.category;
      render();
    });

    // 便笺卡片操作
    el.grid.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      const card = e.target.closest('.note');
      if (!card) return;
      const id = card.dataset.id;
      const note = state.notes.find((n) => n.id === id);
      if (!note) return;

      if (!btn) {
        openEditor(id);
        return;
      }
      switch (btn.dataset.act) {
        case 'edit':
          openEditor(id);
          break;
        case 'pin':
          note.pinned = !note.pinned;
          note.updatedAt = Date.now();
          save();
          render();
          break;
        case 'remind':
          openEditor(id);
          el.nmRemind.checked = true;
          el.nmRemindAt.disabled = false;
          if (!el.nmRemindAt.value) el.nmRemindAt.value = C.toLocalInputValue(Date.now() + 30 * C.MINUTE);
          el.nmRemindAt.focus();
          break;
        case 'copy': {
          const copy = C.createNote({
            text: note.text,
            bg: note.bg,
            fg: note.fg,
            category: note.category,
            rules: state.settings.rules,
          });
          copy.autoCategory = note.autoCategory;
          state.notes.push(copy);
          save();
          render();
          toast('已复制一条便笺', 'ok');
          break;
        }
        case 'del':
          deleteNote(id);
          break;
        default:
          break;
      }
    });

    // 编辑器
    el.nmText.addEventListener('input', () => {
      updateCatHint();
      updatePreview();
    });
    el.nmBg.addEventListener('input', () => {
      renderSwatches(currentBg());
      updateContrast();
      updatePreview();
    });
    el.nmFg.addEventListener('input', () => {
      el.nmFgAuto.checked = false;
      updateContrast();
      updatePreview();
    });
    el.nmFgAuto.addEventListener('change', () => {
      if (el.nmFgAuto.checked) el.nmFg.value = C.bestTextColor(currentBg()).color;
      updateContrast();
      updatePreview();
    });
    el.nmSwatches.addEventListener('click', (e) => {
      const sw = e.target.closest('.swatch');
      if (!sw) return;
      el.nmBg.value = sw.dataset.bg;
      if (el.nmFgAuto.checked) el.nmFg.value = C.bestTextColor(sw.dataset.bg).color;
      renderSwatches(sw.dataset.bg);
      updateContrast();
      updatePreview();
    });
    el.nmCat.addEventListener('change', updateCatHint);
    el.nmCatNew.addEventListener('input', updateCatHint);
    el.nmRemind.addEventListener('change', async () => {
      el.nmRemindAt.disabled = !el.nmRemind.checked;
      if (el.nmRemind.checked) {
        if (!el.nmRemindAt.value) el.nmRemindAt.value = C.toLocalInputValue(Date.now() + 30 * C.MINUTE);
        await ensureNotifyPermission(true);
      }
    });
    el.noteModal.addEventListener('click', (e) => {
      if (e.target.closest('[data-quick]')) {
        const kind = e.target.closest('[data-quick]').dataset.quick;
        const base = new Date();
        if (kind === 'tomorrow9') base.setDate(base.getDate() + 1), base.setHours(9, 0, 0, 0);
        else if (kind === 'tomorrow8') base.setDate(base.getDate() + 1), base.setHours(8, 0, 0, 0);
        else base.setTime(base.getTime() + Number(kind) * C.MINUTE);
        el.nmRemindAt.value = C.toLocalInputValue(base.getTime());
        el.nmRemind.checked = true;
        el.nmRemindAt.disabled = false;
      }
      if (e.target === el.noteModal) closeEditor();
    });
    el.nmSave.addEventListener('click', saveNote);
    el.nmDelete.addEventListener('click', () => editingId && deleteNote(editingId));

    // 设置
    el.setLead.addEventListener('change', () => {
      const v = Math.max(0, Math.min(120, Math.round(Number(el.setLead.value) || 0)));
      el.setLead.value = v;
      state.settings.leadMinutes = v;
      save();
      toast(`提醒提前量已设为 ${v} 分钟（仅对新建/编辑后的提醒生效）`, 'ok');
    });
    el.setSound.addEventListener('change', () => {
      state.settings.sound = el.setSound.checked;
      save();
    });
    el.btnAskNotify.addEventListener('click', () => ensureNotifyPermission(true));
    el.btnTestNotify.addEventListener('click', () => {
      const used = notify('⏰ 测试通知', '这是一条测试提醒，通知功能正常。', 'test');
      if (used) toast('系统通知已发出', 'ok');
      else toast('系统通知不可用（file:// 或权限被拒），已改用应用内提醒', 'warn', 7000);
      if (state.settings.sound) beep();
    });
    el.rules.addEventListener('click', (e) => {
      if (!e.target.closest('[data-act="del-rule"]')) return;
      const row = e.target.closest('.rule-row');
      row.remove();
    });
    el.btnAddRule.addEventListener('click', () => {
      const row = document.createElement('div');
      row.className = 'rule-row';
      row.dataset.id = C.makeId();
      row.innerHTML = `
<input type="text" data-f="name" placeholder="分类名">
<input type="text" data-f="pattern" placeholder="正则，如 会议|需求">
<input type="number" data-f="priority" value="50" title="优先级">
<input type="color" data-f="color" value="#94A3B8" title="分类颜色">
<button class="del" data-act="del-rule" title="删除规则">✕</button>`;
      el.rules.appendChild(row);
      $('[data-f="name"]', row).focus();
    });
    el.btnSaveRules.addEventListener('click', saveRules);
    el.btnExport.addEventListener('click', exportData);
    el.btnExport2.addEventListener('click', exportData);
    el.btnImport.addEventListener('click', () => el.fileImport.click());
    el.btnImport2.addEventListener('click', () => el.fileImport.click());
    el.fileImport.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) importData(f);
      e.target.value = '';
    });
    el.btnClear.addEventListener('click', () => {
      if (!confirm('清空全部便笺？此操作不可撤销。')) return;
      state.notes = [];
      save();
      render();
      scheduleReminders();
      toast('已清空全部便笺');
    });
    el.settingsModal.addEventListener('click', (e) => {
      if (e.target === el.settingsModal) el.settingsModal.hidden = true;
    });

    // 键盘快捷键
    document.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        openEditor(null);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        el.search.focus();
        el.search.select();
        return;
      }
      if (e.key === 'Escape') {
        if (!el.noteModal.hidden) closeEditor();
        else if (!el.settingsModal.hidden) el.settingsModal.hidden = true;
        return;
      }
      if (!typing && e.key === '/') {
        e.preventDefault();
        el.search.focus();
        return;
      }
      if (!typing && e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey) {
        el.btnRegex.click();
      }
    });
  }

  /* ================================================================== *
   * AI 能力（供 StickyAIUI 调用）
   * ================================================================== */

  /** 当前可见（已筛选）的便笺 —— AI 问答以此为上下文 */
  function visibleNotes() {
    return C.filterNotes(state.notes, ui, Date.now()).list;
  }

  /** 所有分类名 */
  function aiCategories() {
    return allCategories();
  }

  /** 把 AI 产出的要点批量存成便笺 */
  function saveNotesFromAI(list) {
    const now = Date.now();
    let created = 0;
    (list || []).forEach((item, i) => {
      if (!item || !item.text) return;
      const bg = C.PALETTE[(state.notes.length + i) % C.PALETTE.length].bg;
      const note = C.createNote({
        text: String(item.text),
        bg,
        category: item.category,
        reminderAt: item.remind_at || null,
        leadMinutes: state.settings.leadMinutes,
        rules: state.settings.rules,
        now,
      });
      if (item.remind_at) note.reminder = C.computeReminder(item.remind_at, state.settings.leadMinutes);
      state.notes.push(note);
      created++;
    });
    if (created) {
      save();
      render();
      scheduleReminders();
    }
    return created;
  }

  /* ================================================================== *
   * 启动
   * ================================================================== */

  function init() {
    el.grid = $('#grid');
    el.empty = $('#empty');
    el.stats = $('#stats');
    el.chips = $('#chips');
    el.toasts = $('#toasts');
    el.clock = $('#clock');
    el.search = $('#search');
    el.searchInfo = $('#search-info');
    el.searchWrap = $('#search-wrap');
    el.btnRegex = $('#btn-regex');
    el.btnNew = $('#btn-new');
    el.fab = $('#fab');
    el.btnSettings = $('#btn-settings');
    el.btnExport = $('#btn-export');
    el.btnExport2 = $('#btn-export2');
    el.btnImport = $('#btn-import');
    el.btnImport2 = $('#btn-import2');
    el.fileImport = $('#file-import');
    el.filterCat = $('#filter-cat');
    el.filterColor = $('#filter-color');
    el.filterReminder = $('#filter-reminder');
    el.filterDate = $('#filter-date');
    el.sort = $('#sort');
    el.filterPinned = $('#filter-pinned');
    el.btnReset = $('#btn-reset');

    el.noteModal = $('#note-modal');
    el.nmTitle = $('#nm-title');
    el.nmText = $('#nm-text');
    el.nmSwatches = $('#nm-swatches');
    el.nmBg = $('#nm-bg');
    el.nmFg = $('#nm-fg');
    el.nmFgAuto = $('#nm-fg-auto');
    el.nmContrast = $('#nm-contrast');
    el.nmCat = $('#nm-cat');
    el.nmCatNew = $('#nm-cat-new');
    el.nmCatHint = $('#nm-cat-hint');
    el.nmRemind = $('#nm-remind');
    el.nmRemindAt = $('#nm-remind-at');
    el.nmLead = $('#nm-lead');
    el.nmPreview = $('#nm-preview');
    el.nmDelete = $('#nm-delete');
    el.nmSave = $('#nm-save');

    el.settingsModal = $('#settings-modal');
    el.setLead = $('#set-lead');
    el.setSound = $('#set-sound');
    el.notifyState = $('#notify-state');
    el.btnAskNotify = $('#btn-ask-notify');
    el.btnTestNotify = $('#btn-test-notify');
    el.rules = $('#rules');
    el.btnAddRule = $('#btn-add-rule');
    el.btnSaveRules = $('#btn-save-rules');
    el.btnClear = $('#btn-clear');

    // 筛选项
    el.filterCat.innerHTML =
      '<option value="all">全部分类</option>' +
      allCategories()
        .map((c) => `<option value="${C.escapeHtml(c)}">${C.escapeHtml(c)}</option>`)
        .join('');
    el.filterColor.innerHTML =
      '<option value="all">全部底色</option>' +
      C.PALETTE.map((p) => `<option value="${p.bg}">${p.name}</option>`).join('');
    el.filterReminder.innerHTML = `
<option value="all">全部提醒状态</option>
<option value="has">有待提醒</option>
<option value="fired">已提醒</option>
<option value="expired">已过期</option>
<option value="none">未设提醒</option>`;
    el.filterDate.innerHTML = `
<option value="all">全部时间</option>
<option value="today">今天创建</option>
<option value="week">近 7 天</option>
<option value="month">近 30 天</option>`;
    el.sort.innerHTML = `
<option value="created-desc">最近创建</option>
<option value="created-asc">最早创建</option>
<option value="updated-desc">最近更新</option>
<option value="reminder-asc">提醒时间最近</option>
<option value="title">按内容排序</option>`;

    load();
    bind();
    render();

    // 把应用能力交给 AI 交互层
    if (window.StickyAIUI) {
      window.StickyAIUI.init({
        getNotes: () => state.notes,
        getSettings: () => state.settings,
        saveSettings: (patch) => {
          Object.assign(state.settings, patch);
          save();
        },
        saveNotes: saveNotesFromAI,
        toast,
        categories: aiCategories,
        visibleNotes,
        refreshCategoryHint: () => {
          updateCatHint();
          updatePreview();
        },
      });
      window.StickyAIUI.syncSettingsUi();
    }

    const about = $('#about-protocol');
    if (about) {
      about.innerHTML =
        location.protocol === 'file:'
          ? '<b>file://</b>（双击 index.html 即可运行）'
          : '<b>' + location.protocol + '//</b> ' + location.host;
    }
    scheduleReminders();
    updateNotifyState();

    // 时钟 + 倒计时刷新
    setInterval(() => {
      const now = Date.now();
      el.clock.textContent = C.formatDateTimeSeconds(now);
      updateReminderBadges(now);
    }, 1000);

    // file:// 环境的提示
    if (location.protocol === 'file:') {
      const banner = $('#banner');
      banner.hidden = false;
      banner.innerHTML =
        '<span>ℹ️</span><span>当前以 <b>file://</b> 方式运行：数据保存在本机 localStorage 中；' +
        '浏览器通常会拒绝 file:// 页面的系统通知请求，因此提醒会自动降级为「应用内横幅 + 提示音 + 标题闪烁」。' +
        '需要真正的桌面通知时，用 <code>npm run sticky:serve</code> 以 http:// 打开同一份文件。</span>' +
        '<button class="icon-btn x" title="知道了">✕</button>';
      banner.querySelector('.x').addEventListener('click', () => (banner.hidden = true));
    }

    // 首次访问给一条示例便笺
    let firstRun = false;
    try {
      firstRun = !state.notes.length && !localStorage.getItem('sticky-notes/seen');
      if (firstRun) localStorage.setItem('sticky-notes/seen', '1');
    } catch (e) {
      firstRun = !state.notes.length;
    }
    if (firstRun) {
      const demo = C.createNote({
        text:
          '欢迎使用便笺 ✍️\n· 点右上角「＋ 新建」写便笺\n· 勾选「提醒」可设定时间，默认提前 5 分钟通知\n· 搜索框支持正则（点 .* 切换），例如 会议|需求\n· 内容会自动归类，分类规则可在「设置」里改',
        bg: '#FFD93D',
        rules: state.settings.rules,
      });
      state.notes.push(demo);
      save();
      render();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.__sticky = { state, ui, render, scheduleReminders, fireReminder, visibleNotes, saveNotesFromAI, C };
})();
