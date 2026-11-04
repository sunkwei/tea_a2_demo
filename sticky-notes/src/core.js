/**
 * 便笺 · 纯逻辑层（不依赖 DOM，可在 Node 里直接做单元测试）
 *
 * 浏览器：普通 <script> 标签引入本文件后挂到 window.StickyCore
 * Node  ：new Function(src)() 之后取 globalThis.StickyCore
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StickyCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function () {
  'use strict';

  const STORAGE_KEY = 'sticky-notes/v1';
  const MINUTE = 60000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  /* ------------------------------------------------------------------ *
   * 颜色与对比度（WCAG 2.1）
   * ------------------------------------------------------------------ */

  /** 便笺底色调色板：每个底色都配自动计算的高对比文字色 */
  const PALETTE = [
    { name: '柠檬黄', bg: '#FFD93D' },
    { name: '蜜桃橙', bg: '#FF9F68' },
    { name: '玫瑰红', bg: '#FF6B81' },
    { name: '樱花粉', bg: '#FFB3C6' },
    { name: '薄荷绿', bg: '#7FE3C2' },
    { name: '森林绿', bg: '#2E7D5B' },
    { name: '天空蓝', bg: '#6EC6FF' },
    { name: '靛青蓝', bg: '#2B5FD9' },
    { name: '薰衣草', bg: '#B39DFF' },
    { name: '紫罗兰', bg: '#6B46C1' },
    { name: '石墨灰', bg: '#3A3F4B' },
    { name: '米白', bg: '#F4EFE3' },
  ];

  function normalizeHex(hex) {
    if (typeof hex !== 'string') return '#000000';
    let h = hex.trim().replace(/^#/, '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return '#000000';
    return '#' + h.toLowerCase();
  }

  function hexToRgb(hex) {
    const h = normalizeHex(hex).slice(1);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  function rgbToHex(rgb) {
    return (
      '#' +
      rgb
        .map((v) => {
          const n = Math.max(0, Math.min(255, Math.round(v)));
          return n < 16 ? '0' + n.toString(16) : n.toString(16);
        })
        .join('')
    );
  }

  function relativeLuminance(hex) {
    const [r, g, b] = hexToRgb(hex).map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  /** WCAG 对比度，返回 1 ~ 21 */
  function contrastRatio(a, b) {
    const l1 = relativeLuminance(a);
    const l2 = relativeLuminance(b);
    const hi = Math.max(l1, l2);
    const lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  /** 给定底色，挑一个对比度最高的文字色（近黑 / 白 / 纯黑） */
  function bestTextColor(bg) {
    const candidates = ['#111827', '#ffffff', '#000000'];
    let best = candidates[0];
    let bestRatio = -1;
    for (const c of candidates) {
      const r = contrastRatio(c, bg);
      if (r > bestRatio) {
        bestRatio = r;
        best = c;
      }
    }
    return { color: best, ratio: round2(bestRatio) };
  }

  /** 对比度等级：AAA ≥ 7、AA ≥ 4.5、AA-Large ≥ 3、不合格 */
  function contrastGrade(ratio) {
    if (ratio >= 7) return 'AAA';
    if (ratio >= 4.5) return 'AA';
    if (ratio >= 3) return 'AA-Large';
    return '不合格';
  }

  /* ------------------------------------------------------------------ *
   * 自动分类规则
   * ------------------------------------------------------------------ */

  const DEFAULT_RULES = [
    {
      id: 'r-secret',
      name: '私密',
      priority: 100,
      color: '#6B46C1',
      enabled: true,
      sticky: true,
      pattern: '(密码|口令|密钥|token|secret|身份证|银行卡|api[_\\s-]?key|私钥)',
    },
    {
      id: 'r-todo',
      name: '待办',
      priority: 90,
      color: '#FFD93D',
      enabled: true,
      pattern: '(\\[\\s*[ xX√]?\\s*\\]|待办|要做|记得|别忘|todo|需要处理|安排一下)',
    },
    {
      id: 'r-money',
      name: '财务',
      priority: 80,
      color: '#7FE3C2',
      enabled: true,
      pattern: '(预算|记账|房租|工资|投资|基金|保险|账单|报销|发票|付款|收款|支出)',
    },
    {
      id: 'r-work',
      name: '工作',
      priority: 70,
      color: '#6EC6FF',
      enabled: true,
      pattern: '(会议|项目|需求|客户|汇报|周报|日报|绩效|面试|合同|方案|评审|上线|排期|okr|kpi|迭代)',
    },
    {
      id: 'r-study',
      name: '学习',
      priority: 60,
      color: '#B39DFF',
      enabled: true,
      pattern: '(学习|课程|复习|考试|论文|读书|教程|英语|单词|刷题|作业|章节|算法|源码|公开课)',
    },
    {
      id: 'r-health',
      name: '健康',
      priority: 50,
      color: '#7FE3C2',
      enabled: true,
      pattern: '(健身|跑步|运动|体检|医院|吃药|早睡|喝水|减肥|瑜伽|血压|复查)',
    },
    {
      id: 'r-shopping',
      name: '购物',
      priority: 40,
      color: '#FFB4A2',
      enabled: true,
      pattern: '(购物|超市|下单|采购|日用品|买菜|囤货|补货)',
    },
    {
      id: 'r-travel',
      name: '旅行',
      priority: 30,
      color: '#FF9F68',
      enabled: true,
      pattern: '(旅行|机票|酒店|攻略|行程|签证|高铁|门票|出差|景区)',
    },
    {
      id: 'r-idea',
      name: '想法',
      priority: 20,
      color: '#FF6B81',
      enabled: true,
      pattern: '(想法|灵感|思考|点子|创意|设想|idea|脑洞|值得做)',
    },
    {
      id: 'r-life',
      name: '生活',
      priority: 10,
      color: '#F4EFE3',
      enabled: true,
      pattern: '(家里|水电|物业|宠物|家人|晚饭|做饭|缴费|快递)',
    },
  ];

  const FALLBACK_CATEGORY = '其他';

  function compileRule(rule) {
    if (!rule || !rule.pattern) return null;
    try {
      return new RegExp(rule.pattern, 'im');
    } catch (e) {
      return null;
    }
  }

  /** 规则合法性检查（设置面板用） */
  function validateRule(rule) {
    if (!rule || !rule.name || !String(rule.name).trim()) return { ok: false, error: '分类名不能为空' };
    if (!rule.pattern) return { ok: false, error: '正则不能为空' };
    try {
      new RegExp(rule.pattern, 'im');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /**
   * 根据内容自动归类：优先级高的规则先命中。
   * @returns {{category:string, ruleId:string|null, keyword:string, color:string|null}}
   */
  /** 统计一条规则在文本里命中的次数与命中的关键词 */
  function matchRule(rule, src) {
    let re;
    try {
      re = new RegExp(rule.pattern, 'gim');
    } catch (e) {
      return null;
    }
    const hits = [];
    let m;
    let guard = 0;
    while ((m = re.exec(src)) !== null && guard++ < 500) {
      if (m[0] === '') {
        re.lastIndex++;
        continue;
      }
      hits.push(String(m[0]).trim());
    }
    if (!hits.length) return null;
    return { rule, count: hits.length, hits };
  }

  /**
   * 根据内容自动归类：
   *   · sticky 规则（默认「私密」）一旦命中直接锁定；
   *   · 其余规则按「命中关键词数量」多者胜，数量相同再比优先级。
   * @returns {{category:string, ruleId:string|null, keyword:string, keywords:string[], color:string|null, count:number}}
   */
  function classify(text, rules) {
    const src = String(text || '');
    const list = (rules && rules.length ? rules : DEFAULT_RULES)
      .filter((r) => r && r.enabled !== false && r.pattern)
      .slice()
      .sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0));

    let best = null;
    for (const r of list) {
      const hit = matchRule(r, src);
      if (!hit) continue;
      if (r.sticky) {
        return {
          category: r.name,
          ruleId: r.id || null,
          keyword: hit.hits[0],
          keywords: hit.hits.slice(0, 3),
          color: r.color || null,
          count: hit.count,
        };
      }
      const priority = Number(r.priority) || 0;
      if (
        !best ||
        hit.count > best.count ||
        (hit.count === best.count && priority > best.priority)
      ) {
        best = { rule: r, count: hit.count, priority, hits: hit.hits };
      }
    }
    if (best) {
      return {
        category: best.rule.name,
        ruleId: best.rule.id || null,
        keyword: best.hits[0],
        keywords: best.hits.slice(0, 3),
        color: best.rule.color || null,
        count: best.count,
      };
    }
    return { category: FALLBACK_CATEGORY, ruleId: null, keyword: '', keywords: [], color: null, count: 0 };
  }

  /* ------------------------------------------------------------------ *
   * 检索（普通子串 / 正则）
   * ------------------------------------------------------------------ */

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  }

  /**
   * 构造匹配器
   * @param {string} query
   * @param {{regex?:boolean}} opts
   * @returns {{ok:boolean, empty:boolean, error?:string, regex?:RegExp, source:string, isRegex:boolean}}
   */
  function buildMatcher(query, opts) {
    const q = String(query == null ? '' : query);
    const isRegex = !!(opts && opts.regex);
    if (!q.trim()) {
      return { ok: true, empty: true, regex: null, source: q, isRegex };
    }
    if (isRegex) {
      try {
        return { ok: true, empty: false, regex: new RegExp(q, 'gim'), source: q, isRegex: true };
      } catch (e) {
        return { ok: false, empty: false, error: e.message, regex: null, source: q, isRegex: true };
      }
    }
    return {
      ok: true,
      empty: false,
      regex: new RegExp(escapeRegExp(q), 'gi'),
      source: q,
      isRegex: false,
    };
  }

  /** 匹配器是否命中这段文本 */
  function matcherTest(matcher, text) {
    if (!matcher || !matcher.ok || matcher.empty || !matcher.regex) return false;
    const re = new RegExp(matcher.regex.source, matcher.regex.flags.replace('g', ''));
    return re.test(String(text == null ? '' : text));
  }

  /** 生成带 <mark> 高亮的 HTML（内部已转义，可安全插入） */
  function highlight(text, matcher) {
    const raw = String(text == null ? '' : text);
    if (!matcher || !matcher.ok || matcher.empty || !matcher.regex) return escapeHtml(raw);
    const re = new RegExp(matcher.regex.source, matcher.regex.flags);
    let out = '';
    let last = 0;
    let m;
    let guard = 0;
    while ((m = re.exec(raw)) !== null && guard++ < 5000) {
      if (m[0] === '') {
        re.lastIndex++;
        continue;
      }
      out += escapeHtml(raw.slice(last, m.index)) + '<mark>' + escapeHtml(m[0]) + '</mark>';
      last = m.index + m[0].length;
      if (re.lastIndex <= m.index) re.lastIndex = m.index + 1;
    }
    return out + escapeHtml(raw.slice(last));
  }

  /** 统计匹配次数 */
  function countMatches(matcher, text) {
    if (!matcher || !matcher.ok || matcher.empty || !matcher.regex) return 0;
    const re = new RegExp(matcher.regex.source, matcher.regex.flags);
    let n = 0;
    let m;
    let guard = 0;
    while ((m = re.exec(text == null ? '' : String(text))) !== null && guard++ < 5000) {
      if (m[0] === '') {
        re.lastIndex++;
        continue;
      }
      n++;
    }
    return n;
  }

  /* ------------------------------------------------------------------ *
   * 提醒
   * ------------------------------------------------------------------ */

  const DEFAULT_LEAD_MINUTES = 5;
  const MISS_GRACE = 60 * MINUTE; // 错过提醒后的宽限窗口

  /** 计算提醒的触发时刻：指定时间前 leadMinutes 分钟 */
  function computeReminder(at, leadMinutes) {
    const atMs = Number(at);
    const lead = Math.max(0, Math.round(Number(leadMinutes) || 0));
    return { at: atMs, leadMinutes: lead, fireAt: atMs - lead * MINUTE, firedAt: null };
  }

  /**
   * 提醒状态
   * none 无提醒 / pending 待提醒 / due 该响了 / fired 已提醒 / expired 已过期
   */
  function reminderStatus(note, now, graceMs) {
    const r = note && note.reminder;
    if (!r || !r.at) return { status: 'none', label: '' };
    const nowMs = now == null ? Date.now() : now;
    const grace = graceMs == null ? MISS_GRACE : graceMs;
    if (r.firedAt) return { status: 'fired', label: '已提醒', firedAt: r.firedAt, at: r.at };
    if (nowMs < r.fireAt) {
      return { status: 'pending', label: '', msLeft: r.fireAt - nowMs, fireAt: r.fireAt, at: r.at };
    }
    if (nowMs <= r.at + grace) {
      return { status: 'due', label: '', msLeft: 0, fireAt: r.fireAt, at: r.at };
    }
    return { status: 'expired', label: '已过期', at: r.at };
  }

  /* ------------------------------------------------------------------ *
   * 时间格式化
   * ------------------------------------------------------------------ */

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function formatDateTime(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(
      d.getMinutes()
    )}`;
  }

  function formatDateTimeSeconds(ms) {
    const d = new Date(ms);
    return `${formatDateTime(ms)}:${pad2(d.getSeconds())}`;
  }

  function formatClock(ms) {
    const d = new Date(ms);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }

  /** 倒计时文案 */
  function formatCountdown(ms) {
    if (ms <= 0) return '现在';
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (d > 0) return `${d} 天 ${h} 小时`;
    if (h > 0) return `${h} 小时 ${m} 分`;
    if (m > 0) return `${m} 分 ${pad2(sec)} 秒`;
    return `${sec} 秒`;
  }

  /** 相对时间（过去用「x 前」，未来用「x 后」） */
  function formatRelative(ms, now) {
    const nowMs = now == null ? Date.now() : now;
    const diff = nowMs - ms;
    if (diff < 0) return formatCountdown(-diff) + '后';
    if (diff < MINUTE) return '刚刚';
    if (diff < HOUR) return Math.floor(diff / MINUTE) + ' 分钟前';
    if (diff < DAY) return Math.floor(diff / HOUR) + ' 小时前';
    if (diff < 7 * DAY) return Math.floor(diff / DAY) + ' 天前';
    return formatDateTime(ms);
  }

  /** <input type="datetime-local"> 的值 */
  function toLocalInputValue(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(
      d.getMinutes()
    )}`;
  }

  /** 解析 <input type="datetime-local"> 的值 → 时间戳 */
  function fromLocalInputValue(str) {
    if (!str) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(str).trim());
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0).getTime();
  }

  /* ------------------------------------------------------------------ *
   * 数据模型
   * ------------------------------------------------------------------ */

  function makeId() {
    return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function normalizeNote(n) {
    if (!n || typeof n.text !== 'string') return null;
    const bg = normalizeHex(n.bg || PALETTE[0].bg);
    const fg = n.fg ? normalizeHex(n.fg) : bestTextColor(bg).color;
    let reminder = null;
    if (n.reminder && Number(n.reminder.at)) {
      const lead = Number.isFinite(Number(n.reminder.leadMinutes))
        ? Math.max(0, Math.round(Number(n.reminder.leadMinutes)))
        : DEFAULT_LEAD_MINUTES;
      reminder = {
        at: Number(n.reminder.at),
        leadMinutes: lead,
        fireAt: Number(n.reminder.at) - lead * MINUTE,
        firedAt: n.reminder.firedAt ? Number(n.reminder.firedAt) : null,
        missed: !!n.reminder.missed,
      };
    }
    const createdAt = Number(n.createdAt) || Date.now();
    return {
      id: n.id || makeId(),
      text: n.text,
      bg,
      fg,
      fgLocked: !!n.fgLocked,
      category: n.category || FALLBACK_CATEGORY,
      autoCategory: n.autoCategory || n.category || FALLBACK_CATEGORY,
      manual: !!n.manual,
      createdAt,
      updatedAt: Number(n.updatedAt) || createdAt,
      pinned: !!n.pinned,
      reminder,
      deletedAt: n.deletedAt ? Number(n.deletedAt) : null,
      trashedReminder: n.trashedReminder || null,
    };
  }

  function createNote(input) {
    const now = Number(input.now) || Date.now();
    const bg = normalizeHex(input.bg || PALETTE[0].bg);
    const auto = classify(input.text, input.rules);
    const fg = input.fg ? normalizeHex(input.fg) : bestTextColor(bg).color;
    return {
      id: input.id || makeId(),
      text: String(input.text || ''),
      bg,
      fg,
      fgLocked: !!input.fgLocked,
      category: input.category || auto.category,
      autoCategory: auto.category,
      manual: !!(input.category && input.category !== auto.category),
      createdAt: now,
      updatedAt: now,
      pinned: !!input.pinned,
      deletedAt: null,
      trashedReminder: null,
      reminder: input.reminderAt
        ? computeReminder(
            Number(input.reminderAt),
            input.leadMinutes == null ? DEFAULT_LEAD_MINUTES : input.leadMinutes
          )
        : null,
    };
  }

  function serialize(state) {
    return JSON.stringify({
      v: 1,
      savedAt: Date.now(),
      notes: state.notes || [],
      settings: state.settings || {},
    });
  }

  function deserialize(raw) {
    try {
      const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!obj || !Array.isArray(obj.notes)) return { notes: [], settings: null };
      const notes = obj.notes.map(normalizeNote).filter(Boolean);
      return { notes, settings: obj.settings && typeof obj.settings === 'object' ? obj.settings : null };
    } catch (e) {
      return { notes: [], settings: null };
    }
  }

  /* ------------------------------------------------------------------ *
   * 过滤 / 排序
   * ------------------------------------------------------------------ */

  /** 时间区间（传时间戳，不传便笺） */
  const DATE_RANGES = {
    all: () => true,
    today: (ts, now) => {
      const d = new Date(now);
      const c = new Date(ts);
      return d.getFullYear() === c.getFullYear() && d.getMonth() === c.getMonth() && d.getDate() === c.getDate();
    },
    week: (ts, now) => now - ts <= 7 * DAY,
    month: (ts, now) => now - ts <= 30 * DAY,
  };

  const SORTS = {
    'created-desc': (a, b) => b.createdAt - a.createdAt,
    'created-asc': (a, b) => a.createdAt - b.createdAt,
    'updated-desc': (a, b) => b.updatedAt - a.updatedAt,
    'reminder-asc': (a, b) => {
      const av = a.reminder ? a.reminder.fireAt : Infinity;
      const bv = b.reminder ? b.reminder.fireAt : Infinity;
      return av - bv;
    },
    title: (a, b) => String(a.text).localeCompare(String(b.text), 'zh-Hans-CN'),
    'deleted-desc': (a, b) => (b.deletedAt || 0) - (a.deletedAt || 0),
    'deleted-asc': (a, b) => (a.deletedAt || 0) - (b.deletedAt || 0),
  };

  /**
   * 过滤 + 排序 + 检索
   * @param {Array} notes
   * @param {object} ui {query, regex, category, color, reminder, date, sort, pinnedOnly}
   * @param {number} now
   */
  function filterNotes(notes, ui, now) {
    const nowMs = now == null ? Date.now() : now;
    const matcher = buildMatcher(ui.query, { regex: !!ui.regex });
    const range = DATE_RANGES[ui.date] || DATE_RANGES.all;
    const scope = ui.scope || 'active';
    const out = (notes || []).filter((n) => {
      // 回收站：只看已删除 / 只看未删除
      if (scope === 'active' && n.deletedAt) return false;
      if (scope === 'trash' && !n.deletedAt) return false;
      if (!matcher.ok) return true; // 正则非法时不筛，展示全部 + 错误提示
      if (!matcher.empty) {
        const hitText = matcherTest(matcher, n.text);
        const hitCat = matcherTest(matcher, n.category);
        if (!hitText && !hitCat) return false;
      }
      if (ui.category && ui.category !== 'all' && n.category !== ui.category) return false;
      if (ui.color && ui.color !== 'all' && n.bg.toLowerCase() !== String(ui.color).toLowerCase()) return false;
      if (ui.pinnedOnly && !n.pinned) return false;
      if (ui.reminder && ui.reminder !== 'all') {
        const st = reminderStatus(n, nowMs).status;
        const want = ui.reminder;
        if (want === 'has' && st !== 'pending' && st !== 'due') return false;
        if (want === 'fired' && st !== 'fired') return false;
        if (want === 'expired' && st !== 'expired') return false;
        if (want === 'none' && st !== 'none') return false;
      }
      if (!range(scope === 'trash' ? n.deletedAt : n.createdAt, nowMs)) return false;
      return true;
    });
    const sorter = SORTS[ui.sort] || SORTS['created-desc'];
    out.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || sorter(a, b));
    return { list: out, matcher };
  }

  /** 分类统计（scope 同 filterNotes：active 只算未删除的，trash 只算已删除的） */
  function categoryCounts(notes, scope) {
    const scopeName = scope || 'active';
    const map = new Map();
    for (const n of notes || []) {
      if (scopeName === 'active' && n.deletedAt) continue;
      if (scopeName === 'trash' && !n.deletedAt) continue;
      map.set(n.category, (map.get(n.category) || 0) + 1);
    }
    return map;
  }

  /** 回收站里的条数 */
  function trashCount(notes) {
    let n = 0;
    for (const x of notes || []) if (x && x.deletedAt) n++;
    return n;
  }

  /** 软删除：移进回收站（提醒先收起来，免得它在回收站里响） */
  function moveToTrash(note, now) {
    const n = Object.assign({}, note);
    n.deletedAt = now == null ? Date.now() : now;
    n.updatedAt = Date.now();
    if (n.reminder) {
      n.trashedReminder = n.reminder;
      n.reminder = null;
    }
    return n;
  }

  /** 从回收站还原（提醒一并恢复） */
  function restoreFromTrash(note) {
    const n = Object.assign({}, note);
    n.deletedAt = null;
    n.updatedAt = Date.now();
    if (n.trashedReminder) {
      n.reminder = n.trashedReminder;
      n.trashedReminder = null;
    }
    return n;
  }

  return {
    STORAGE_KEY,
    MINUTE,
    HOUR,
    DAY,
    DEFAULT_LEAD_MINUTES,
    MISS_GRACE,
    PALETTE,
    DEFAULT_RULES,
    FALLBACK_CATEGORY,
    normalizeHex,
    hexToRgb,
    rgbToHex,
    relativeLuminance,
    contrastRatio,
    contrastGrade,
    bestTextColor,
    compileRule,
    matchRule,
    validateRule,
    classify,
    escapeRegExp,
    escapeHtml,
    buildMatcher,
    matcherTest,
    highlight,
    countMatches,
    computeReminder,
    reminderStatus,
    pad2,
    formatDateTime,
    formatDateTimeSeconds,
    formatClock,
    formatCountdown,
    formatRelative,
    toLocalInputValue,
    fromLocalInputValue,
    makeId,
    normalizeNote,
    createNote,
    serialize,
    deserialize,
    filterNotes,
    categoryCounts,
    trashCount,
    moveToTrash,
    restoreFromTrash,
  };
});
