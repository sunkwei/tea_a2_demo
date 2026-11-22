/**
 * 中国陶器史 · 纯逻辑（不碰 DOM / fetch）
 *
 * 浏览器：<script> 引入后挂到 window.POTTERY_CORE
 * Node  ：new Function(...) 或 require 后取 module.exports（tools/selftest.mjs 用）
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.POTTERY_CORE = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 数据整形
   * ------------------------------------------------------------------ */

  function sortByOrder(entries) {
    return (Array.isArray(entries) ? entries.slice() : []).sort(function (a, b) {
      return (a.order || 0) - (b.order || 0);
    });
  }

  /** 数据体检：返回问题列表（空数组 = 没问题） */
  function validate(entries) {
    const list = Array.isArray(entries) ? entries : [];
    const problems = [];
    const ids = Object.create(null);
    const orders = Object.create(null);
    if (!list.length) problems.push('entries 为空');
    list.forEach(function (e, i) {
      const where = '#' + (i + 1) + (e && e.id ? '(' + e.id + ')' : '');
      if (!e || typeof e !== 'object') { problems.push(where + ' 不是对象'); return; }
      if (!e.id) problems.push(where + ' 缺 id');
      else if (ids[e.id]) problems.push(where + ' id 重复：' + e.id);
      else ids[e.id] = true;
      if (!e.title) problems.push(where + ' 缺 title');
      if (!e.era) problems.push(where + ' 缺 era');
      if (!e.years) problems.push(where + ' 缺 years');
      if (!e.image) problems.push(where + ' 缺 image');
      if (!Array.isArray(e.body) || !e.body.length) problems.push(where + ' 缺 body');
      if (!Array.isArray(e.points) || !e.points.length) problems.push(where + ' 缺 points');
      if (!e.question) problems.push(where + ' 缺 question');
      if (e.order == null) problems.push(where + ' 缺 order');
      else if (orders[e.order]) problems.push(where + ' order 重复：' + e.order);
      else orders[e.order] = true;
    });
    return problems;
  }

  /** 统一补上图片路径（数据里只写 id，路径由约定生成） */
  function withImages(entries) {
    return (Array.isArray(entries) ? entries : []).map(function (e) {
      const copy = Object.assign({}, e);
      if (!copy.image && copy.id) copy.image = 'assets/ceramics/' + copy.id + '.jpg';
      return copy;
    });
  }

  function byId(entries, id) {
    const list = Array.isArray(entries) ? entries : [];
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function indexOfId(entries, id) {
    const list = Array.isArray(entries) ? entries : [];
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return i;
    return -1;
  }

  /** 前后切换（循环），delta = +1 / -1 */
  function neighbor(entries, id, delta) {
    const list = sortByOrder(entries);
    if (!list.length) return null;
    let i = indexOfId(list, id);
    if (i < 0) i = 0;
    const n = (i + (delta || 0) + list.length) % list.length;
    return list[n];
  }

  /** 左栏年代简写：去掉括号里的补充说明 */
  function shortYears(years) {
    return String(years == null ? '' : years).split(/[（(]/)[0].trim();
  }

  /** 顶部时代导航 */
  function eraNav(entries) {
    return sortByOrder(entries).map(function (e) {
      return { id: e.id, era: e.era, years: shortYears(e.years), label: e.era + ' · ' + shortYears(e.years) };
    });
  }

  /** 首屏统计 */
  function stats(entries) {
    const list = Array.isArray(entries) ? entries : [];
    const cultures = Object.create(null);
    list.forEach(function (e) { if (e.culture) cultures[e.culture] = true; });
    return {
      count: list.length,
      cultures: Object.keys(cultures).length,
      span: '约 2 万年',
    };
  }

  function creditText(credit) {
    if (!credit) return '图片来源：Wikimedia Commons';
    const parts = [];
    if (credit.author) parts.push(credit.author);
    if (credit.license) parts.push(credit.license);
    if (credit.note) parts.push(credit.note);
    const s = parts.join(' · ');
    return s ? '图片：' + s : '图片：Wikimedia Commons';
  }

  /* ------------------------------------------------------------------ *
   * 提问
   * ------------------------------------------------------------------ */

  const MAX_QUERY = 300;

  function normalizeQuery(q) {
    let s = String(q == null ? '' : q).replace(/\s+/g, ' ').trim();
    if (s.length > MAX_QUERY) s = s.slice(0, MAX_QUERY);
    return s;
  }

  function buildPrompt(query, entry) {
    const q = normalizeQuery(query);
    const lines = [
      '你是中国陶瓷史科普助手。请用通俗的现代汉语回答用户的问题，并优先采用考古发掘与博物馆的通行结论。',
      '',
      '用户问题：' + q,
    ];
    if (entry && entry.title) {
      lines.push(
        '',
        '用户正在看时间线上的这一条：',
        '· 器物：' + entry.title + (entry.subtitle ? '（' + entry.subtitle + '）' : ''),
        '· 年代：' + entry.era + '，' + entry.years,
        '· 文化/窑口：' + (entry.culture || '—'),
        '· 出土/收藏：' + [entry.site, entry.museum].filter(Boolean).join('；')
      );
    }
    lines.push(
      '',
      '硬性要求：',
      '1. 先直接回答，再补充必要的背景；不要写成百科条目式的空话。',
      '2. 讲清材料与工艺（胎料、釉、温度、气氛、装烧方式）与历史意义，能对比就对比。',
      '3. 年代、窑口、馆藏若有争议或不确定，明确写「学界尚有不同说法」，不要编造细节；涉及具体年份、展览、考古新发现时，先用检索工具核对。',
      '4. 300—500 字，分 3—5 点陈述；不要用 markdown 表格，不要写「作为 AI」。',
      '5. 最后另起一行，以「来源：」开头列出这次实际用到的链接（没有就写「来源：暂无」）。'
    );
    return lines.join('\n');
  }

  /* ------------------------------------------------------------------ *
   * 检索结果解析（tea_a2 的 web_tool_calls 输出格式）
   * ------------------------------------------------------------------ */

  /** "N result(s) for: q\n\n[1] 标题\n    url: ...\n    score: ...\n..." → 来源数组 */
  function parseSearchOutput(text) {
    const src = String(text == null ? '' : text);
    const out = [];
    const blocks = src.split(/\n(?=\[\d+\]\s)/);
    blocks.forEach(function (block) {
      const head = block.match(/^\[(\d+)\]\s*(.*)$/m);
      if (!head) return;
      const urlM = block.match(/\n\s*url:\s*(\S+)/);
      if (!urlM) return;
      const scoreM = block.match(/\n\s*score:\s*([\d.]+)/);
      const authM = block.match(/\n\s*authority:\s*(\d+)/);
      const sumM = block.match(/\n\s*summary:\s*([\s\S]*)$/);
      out.push({
        index: Number(head[1]) || out.length + 1,
        title: (head[2] || '').trim() || urlM[1],
        url: urlM[1].trim(),
        score: scoreM ? Number(scoreM[1]) : null,
        authority: authM ? Number(authM[1]) : null,
        summary: sumM ? sumM[1].trim().replace(/\s+\n/g, '\n').slice(0, 400) : '',
      });
    });
    return out;
  }

  /** 从 web_tool_calls[] 汇总来源 */
  function parseSources(webToolCalls) {
    const list = [];
    const seen = Object.create(null);
    (Array.isArray(webToolCalls) ? webToolCalls : []).forEach(function (call) {
      if (!call || call.ok === false) return;
      parseSearchOutput(call.output || '').forEach(function (item) {
        if (!item.url || seen[item.url]) return;
        seen[item.url] = true;
        list.push(item);
      });
    });
    return list;
  }

  /** 正文里出现的链接（模型自己写的「来源」） */
  function extractUrls(text) {
    const out = [];
    const seen = Object.create(null);
    const re = /https?:\/\/[^\s<>"')，。；]+/g;
    const src = String(text == null ? '' : text);
    let m;
    while ((m = re.exec(src)) !== null) {
      const url = m[0].replace(/[.,;:]+$/, '');
      if (seen[url]) continue;
      seen[url] = true;
      out.push({ url: url, title: '', summary: '', score: null, authority: null, index: null });
    }
    return out;
  }

  function mergeSources(primary, extra) {
    const out = (primary || []).slice();
    const seen = Object.create(null);
    out.forEach(function (s) { seen[s.url] = true; });
    (extra || []).forEach(function (s) {
      if (s.url && !seen[s.url]) {
        seen[s.url] = true;
        out.push(s);
      }
    });
    return out;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  return {
    MAX_QUERY: MAX_QUERY,
    sortByOrder: sortByOrder,
    validate: validate,
    withImages: withImages,
    byId: byId,
    indexOfId: indexOfId,
    neighbor: neighbor,
    shortYears: shortYears,
    eraNav: eraNav,
    stats: stats,
    creditText: creditText,
    normalizeQuery: normalizeQuery,
    buildPrompt: buildPrompt,
    parseSearchOutput: parseSearchOutput,
    parseSources: parseSources,
    extractUrls: extractUrls,
    mergeSources: mergeSources,
    escapeHtml: escapeHtml,
  };
});
