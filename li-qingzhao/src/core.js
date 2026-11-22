/**
 * 李清照 · 漱玉词 —— 纯逻辑（不碰 DOM / fetch）
 *
 * 浏览器：<script> 引入后挂到 window.LI_QINGZHAO_CORE
 * Node  ：tools/selftest.mjs 用 vm 加载
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LI_QINGZHAO_CORE = api;
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
      if (!e.years) problems.push(where + ' 缺 years');
      if (!e.place) problems.push(where + ' 缺 place');
      if (!e.kind) problems.push(where + ' 缺 kind');
      if (!Array.isArray(e.body) || !e.body.length) problems.push(where + ' 缺 body');
      if (!Array.isArray(e.notes) || !e.notes.length) problems.push(where + ' 缺 notes');
      if (!Array.isArray(e.tags) || !e.tags.length) problems.push(where + ' 缺 tags');
      if (!e.question) problems.push(where + ' 缺 question');
      if (e.order == null) problems.push(where + ' 缺 order');
      else if (orders[e.order]) problems.push(where + ' order 重复：' + e.order);
      else orders[e.order] = true;
      if (e.stage == null) problems.push(where + ' 缺 stage');
      if (e.kind !== '生平' && e.kind !== '余响') {
        if (!Array.isArray(e.poem) || !e.poem.length) problems.push(where + ' 缺 poem');
      }
      if (e.kind === '余响' && !e.quote) problems.push(where + ' 余响缺 quote');
    });
    return problems;
  }

  /** 统一补上图片路径（数据里只写 id，路径由约定生成） */
  function withImages(entries, dir) {
    const base = dir || 'assets/images/';
    return (Array.isArray(entries) ? entries : []).map(function (e) {
      const copy = Object.assign({}, e);
      if (!copy.image && copy.id) copy.image = base + copy.id + '.jpg';
      if (!copy.creditId && copy.image) {
        copy.creditId = String(copy.image).split('/').pop().replace(/\.[a-z0-9]+$/i, '');
      }
      if (Array.isArray(copy.extra)) {
        copy.extra = copy.extra.map(function (x) {
          return Object.assign({}, x, { src: x.src || base + (x.id || x.creditId) + '.jpg' });
        });
      }
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

  function neighbor(entries, id, delta) {
    const list = sortByOrder(entries);
    if (!list.length) return null;
    let i = indexOfId(list, id);
    if (i < 0) i = 0;
    return list[(i + (delta || 0) + list.length) % list.length];
  }

  /** 左栏年代简写：去掉括号里的补充说明 */
  function shortYears(years) {
    return String(years == null ? '' : years).split(/[（(]/)[0].trim();
  }

  /** 顶部导航用短年份：区间只取起始年，避免胶囊过长 */
  function railYear(years) {
    const s = shortYears(years).replace(/\s+/g, '');
    const m = s.match(/\d{3,4}/);
    return m ? m[0] : s;
  }

  const SHORT_PLACE = { '齐州章丘': '章丘', '和州乌江': '乌江' };

  /** 顶部导航：作品名 + 起始年（没有 nav 的老数据退回地点） */
  function eraNav(entries) {
    return sortByOrder(entries).map(function (e) {
      let place = String(e.place || '').split(/[·→]/)[0].replace(/（.*?）/g, '').trim();
      if (SHORT_PLACE[place]) place = SHORT_PLACE[place];
      const name = e.nav || place;
      return {
        id: e.id,
        place: place,
        years: railYear(e.years),
        label: name + ' ' + railYear(e.years),
      };
    });
  }

  /** 按 stage 汇总，count 用实际数据算，避免写死 */
  function stagesOf(entries, stages) {
    const list = sortByOrder(entries);
    return (Array.isArray(stages) ? stages : []).map(function (s) {
      const works = list.filter(function (e) { return e.stage === s.no; });
      return Object.assign({}, s, { count: works.length, works: works.map(function (e) { return e.id; }) });
    });
  }

  function stats(entries, meta) {
    const list = Array.isArray(entries) ? entries : [];
    const places = Object.create(null);
    list.forEach(function (e) {
      String(e.place || '').split(/[·→]/).forEach(function (p) {
        const name = p.replace(/（.*?）/g, '').trim();
        if (name) places[name] = true;
      });
    });
    const kinds = { 词: 0, 诗: 0, 文: 0, 其他: 0 };
    list.forEach(function (e) {
      if (kinds[e.kind] != null) kinds[e.kind] += 1;
      else kinds.其他 += 1;
    });
    return {
      count: list.length,
      works: (meta && meta.works) || list.filter(function (e) { return e.kind !== '余响'; }).length,
      stages: (meta && meta.stages) || 5,
      places: (meta && meta.places) || Object.keys(places).length,
      kinds: kinds,
      span: (meta && meta.span) || '1084—1155',
    };
  }

  /** 词/诗/文 的篇数统计文案 */
  function kindsText(entries) {
    const s = stats(entries);
    const bits = [];
    if (s.kinds.词) bits.push(s.kinds.词 + ' 首词');
    if (s.kinds.诗) bits.push(s.kinds.诗 + ' 首诗');
    if (s.kinds.文) bits.push(s.kinds.文 + ' 篇文');
    return bits.join(' · ');
  }

  /* ------------------------------------------------------------------ *
   * 文本
   * ------------------------------------------------------------------ */

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** 把诗句里的标点包一层，便于排版时弱化 */
  function poemLineHtml(line) {
    const safe = escapeHtml(line);
    return safe.replace(/([，。、；：？！“”‘’《》（）—…·])/g, '<i class="punct">$1</i>');
  }

  /** 词牌 / 诗题拆开：返回 { tune, title } */
  function splitTitle(title) {
    const t = String(title || '');
    const m = t.match(/^(.+?)\s*[·・]\s*(.+)$/);
    if (m) return { tune: m[1].trim(), title: m[2].trim() };
    return { tune: '', title: t };
  }

  /** 只保留「词牌」部分，用于卡片角标 */
  function tuneOf(entry) {
    const t = splitTitle(entry && entry.title);
    if (t.tune) return t.tune;
    return entry && entry.kind ? entry.kind : '';
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

  function buildAskPrompt(entry, question, meta) {
    const q = String(question == null ? '' : question).trim().slice(0, MAX_QUERY);
    const m = meta || {};
    const lines = [
      '你是一位严谨的宋代文学与历史普及作者。请用中文回答，先给结论，再给依据；',
      '涉及年份、作者归属、异说时要说明「通行说法」与「存疑」，不要编造诗句或史料。',
      '',
      '【作品】' + (entry ? entry.title : ''),
    ];
    if (entry) {
      if (entry.written) lines.push('【作年】' + entry.written + '（如为推定，请说明）');
      if (entry.place) lines.push('【地点】' + entry.place);
      if (entry.kind) lines.push('【体裁】' + entry.kind);
      if (entry.poem && entry.poem.length) {
        lines.push('【原文】');
        entry.poem.forEach(function (l) { if (l) lines.push(l); });
      }
      if (entry.notes && entry.notes.length) {
        lines.push('【已注词语】' + entry.notes.map(function (n) { return n.term; }).join('、'));
      }
    }
    if (m.title) lines.push('【背景】' + m.title + '（' + (m.span || '') + '）生平与作品的年代串联页面。');
    lines.push('', '【用户问题】' + (q || '这首词好在哪里？'));
    lines.push('', '回答控制在 500 字以内，可分点；最后如引用了来源，请给出可核查的出处。');
    return lines.join('\n');
  }

  function normalizeQuery(q) {
    let s = String(q == null ? '' : q).replace(/\s+/g, ' ').trim();
    if (s.length > MAX_QUERY) s = s.slice(0, MAX_QUERY);
    return s;
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

  /** 校验用户输入，返回问题（空 = 通过） */
  function validateQuestion(text) {
    const q = String(text == null ? '' : text).trim();
    if (!q) return '请先写一个问题';
    if (q.length > MAX_QUERY) return '问题太长（最多 ' + MAX_QUERY + ' 字）';
    return '';
  }

  /* ------------------------------------------------------------------ *
   * AI 回答渲染（先转义，再做有限的 Markdown 处理）
   * ------------------------------------------------------------------ */

  /** 行内标记：**粗体**、`代码`、[文字](https 链接) */
  function inlineMarkup(s) {
    let t = escapeHtml(s);
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return t;
  }

  /**
   * 把模型回答渲染成安全 HTML：段落、有序/无序列表、标题行。
   * 内容先整体转义，只放行我们自己的标签，链接只允许 http(s)。
   */
  function renderAnswer(text) {
    const lines = String(text == null ? '' : text).split(/\r?\n/);
    const out = [];
    let para = [];
    let list = null;

    function flushPara() {
      if (!para.length) return;
      out.push('<p>' + para.map(inlineMarkup).join('<br>') + '</p>');
      para = [];
    }
    function flushList() {
      if (!list) return;
      out.push('<' + list.tag + '>' + list.items.map(function (i) { return '<li>' + i + '</li>'; }).join('') + '</' + list.tag + '>');
      list = null;
    }
    function flushAll() { flushPara(); flushList(); }

    lines.forEach(function (raw) {
      const line = String(raw).replace(/\s+$/, '');
      const trimmed = line.trim();
      let m;
      if (!trimmed) { flushAll(); return; }
      if ((m = trimmed.match(/^#{1,4}\s+(.*)$/))) {
        flushAll();
        out.push('<p class="ai-h">' + inlineMarkup(m[1]) + '</p>');
        return;
      }
      if ((m = trimmed.match(/^(\d{1,2})[.)]\s+(.*)$/))) {
        flushPara();
        if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; }
        list.items.push(inlineMarkup(m[2]));
        return;
      }
      if ((m = trimmed.match(/^[-*•]\s+(.*)$/))) {
        flushPara();
        if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; }
        list.items.push(inlineMarkup(m[1]));
        return;
      }
      flushList();
      para.push(trimmed);
    });
    flushAll();
    return out.join('');
  }

  return {
    sortByOrder: sortByOrder,
    validate: validate,
    withImages: withImages,
    byId: byId,
    indexOfId: indexOfId,
    neighbor: neighbor,
    shortYears: shortYears,
    railYear: railYear,
    eraNav: eraNav,
    stagesOf: stagesOf,
    stats: stats,
    kindsText: kindsText,
    escapeHtml: escapeHtml,
    poemLineHtml: poemLineHtml,
    splitTitle: splitTitle,
    tuneOf: tuneOf,
    creditText: creditText,
    buildAskPrompt: buildAskPrompt,
    inlineMarkup: inlineMarkup,
    renderAnswer: renderAnswer,
    normalizeQuery: normalizeQuery,
    parseSearchOutput: parseSearchOutput,
    parseSources: parseSources,
    extractUrls: extractUrls,
    mergeSources: mergeSources,
    validateQuestion: validateQuestion,
    MAX_QUERY: MAX_QUERY,
  };
});
