/**
 * 中药大全 · 核心逻辑层（纯函数，不依赖 DOM）
 *
 * 浏览器：普通 <script> 引入后挂到 window.TCMCore
 * Node  ：new Function(src)() 之后取 globalThis.TCMCore
 *
 * 职责：
 *   · 输入归一化（全角→半角、去标点空白、繁→简、小写）
 *   · 索引构建（药材 / 病症 / 方剂，含多字段关键词与反向关联）
 *   · 检索与打分（精确 > 别名 > 前缀 > 包含 > 拼音 > 首字母 > 编辑距离容错）
 *   · 高亮、分组统计等展示辅助
 *
 * 不在这里做的事：任何 DOM、任何网络、任何存储。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TCMCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 繁简对照（只收本项目数据 + 常见输入里会出现的字，够用即止）
   * ------------------------------------------------------------------ */

  /**
   * 繁简对照：每项固定两个字符（繁, 简）。
   * 用「一项一对」而不是一长串，避免奇偶错位（曾经把「當歸」拆成了「當→当、归→歸」）。
   */
  const T2S_TABLE = [
    '藥药', '參参', '蔘参', '黃黄', '連连', '翹翘', '銀银', '貝贝', '陳陈', '當当', '歸归', '澤泽', '瀉泻', '車车', '錢钱', '麥麦', '蘇苏', '葉叶', '荊荆', '風风', '梔栀', '獨独', '靈灵', '蒼苍', '術术', '朮术', '豬猪', '實实', '烏乌', '紅红', '決决', '龍龙', '黨党', '貞贞', '續续', '斷断', '遠远', '質质', '鬆松', '癢痒', '鳴鸣', '聽听', '視视', '頻频', '爾尔', '見见', '熱热', '濕湿', '陰阴', '陽阳', '虛虚', '氣气', '頭头', '暈晕', '膽胆', '髮发', '麯曲', '薑姜', '棗枣', '鹽盐', '醫医', '診诊', '療疗', '劑剂', '錄录', '點点', '線线', '務务', '體体', '節节', '廠厂', '場场', '電电', '腦脑', '網网', '頁页', '數数', '據据', '後后', '臺台', '灣湾', '繡绣', '蘿萝', '蔔卜', '蔥葱', '臟脏', '腸肠', '腎肾', '營营', '衛卫', '補补', '溫温', '裏里', '這这', '們们', '個个', '為为', '與与', '會会', '還还', '過过', '開开', '關关', '無无', '檢检', '驗验', '單单', '雙双', '圖图', '鑑鉴', '龐庞', '雜杂', '詳详', '細细', '課课', '練练', '習习', '題题', '錯错', '誤误', '別别', '稱称', '號号', '碼码', '標标', '準准', '確确', '認认', '識识', '讀读', '寫写', '語语', '詞词', '彙汇', '譯译', '註注', '釋释', '義义', '說说', '種种', '樣样', '麼么', '幾几', '長长', '時时', '間间', '問问', '題题', '題题', '決决', '斷断', '續续', '藥药', '湯汤', '癥症', '顫颤', '噴喷', '嚨咙', '癡痴', '獃呆', '噯嗳', '噁恶', '燒烧', '脹胀', '嘔呕', '潰溃', '瘍疡', '瘡疮', '調调', '盜盗', '腫肿', '壓压', '關关', '臟脏', '髮发', '鬱郁', '鹼碱', '鈣钙', '鐵铁', '維维', '劑剂', '復复', '製制', '產产', '來来', '說说', '據据', '準准', '乾干', '瞭了', '麼么', '著着', '著着', '鬥斗', '穀谷', '醃腌', '薑姜', '鹵卤'
  ];

  const T2S = Object.create(null);
  const T2S_BAD = [];
  T2S_TABLE.forEach(function (pair) {
    if (typeof pair !== 'string' || pair.length !== 2) {
      T2S_BAD.push(String(pair));
      return;
    }
    T2S[pair.charAt(0)] = pair.charAt(1);
  });

  const PUNCT_RE = /[\s\u3000,，.。、;；:：!！?？'‘’"“”`()（）\[\]【】{}<>《》|=+*~^$@#%&_\\/\\|·•\-–—]+/g;

  /** 全角字符 → 半角字符（ASCII 区间） */
  function toHalfWidth(s) {
    return String(s).replace(/[\uFF01-\uFF5E]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
    });
  }

  /** 繁 → 简（逐字查表，查不到的保持原样） */
  function toSimplified(s) {
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      out += T2S[ch] || ch;
    }
    return out;
  }

  /** 输入归一化：半角、小写、去标点空白、繁→简 */
  function normalize(input) {
    if (input == null) return '';
    let s = toHalfWidth(String(input)).toLowerCase();
    s = s.replace(PUNCT_RE, '');
    return toSimplified(s);
  }

  /* ------------------------------------------------------------------ *
   * 编辑距离（带上限，超了提前返回 max+1）
   * ------------------------------------------------------------------ */

  function editDistance(a, b, max) {
    const la = a.length;
    const lb = b.length;
    if (a === b) return 0;
    if (!la) return lb;
    if (!lb) return la;
    const cap = max == null ? 3 : max;
    if (Math.abs(la - lb) > cap) return cap + 1;

    let prev = new Array(lb + 1);
    let cur = new Array(lb + 1);
    for (let j = 0; j <= lb; j++) prev[j] = j;

    for (let i = 1; i <= la; i++) {
      cur[0] = i;
      let best = cur[0];
      for (let j = 1; j <= lb; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (cur[j] < best) best = cur[j];
      }
      if (best > cap) return cap + 1;
      const tmp = prev;
      prev = cur;
      cur = tmp;
    }
    return prev[lb] > cap ? cap + 1 : prev[lb];
  }

  /* ------------------------------------------------------------------ *
   * 索引
   * ------------------------------------------------------------------ */

  const HERB_FIELDS = [
    { field: 'name', weight: 120, fuzzy: true },
    { field: 'alias', weight: 95, fuzzy: false },
    { field: 'pinyin', weight: 85, fuzzy: false },
    { field: 'initial', weight: 70, fuzzy: false },
    { field: 'efficacy', weight: 55, fuzzy: false },
    { field: 'category', weight: 45, fuzzy: false },
    { field: 'indications', weight: 30, fuzzy: false },
    { field: 'origin', weight: 18, fuzzy: false },
  ];

  const SYMPTOM_FIELDS = [
    { field: 'name', weight: 120, fuzzy: false },
    { field: 'alias', weight: 95, fuzzy: false },
    { field: 'desc', weight: 40, fuzzy: false },
    { field: 'system', weight: 25, fuzzy: false },
  ];

  const FORMULA_FIELDS = [
    { field: 'name', weight: 120, fuzzy: false },
    { field: 'source', weight: 55, fuzzy: false },
    { field: 'efficacy', weight: 60, fuzzy: false },
    { field: 'indications', weight: 45, fuzzy: false },
    { field: 'note', weight: 15, fuzzy: false },
  ];

  function asArray(v) {
    if (v == null) return [];
    return Array.isArray(v) ? v : [v];
  }

  function makeKeys(item, fields) {
    const keys = [];
    fields.forEach(function (f) {
      asArray(item[f.field]).forEach(function (raw) {
        if (raw == null || raw === '') return;
        const text = String(raw);
        const norm = normalize(text);
        if (!norm) return;
        keys.push({ field: f.field, text: text, norm: norm, weight: f.weight, fuzzy: f.fuzzy });
      });
    });
    return keys;
  }

  /**
   * 构建索引。
   * @param {{herbs:Array, symptoms:Array, formulas:Array}} data
   */
  function buildIndex(data) {
    const herbs = asArray(data && data.herbs);
    const symptoms = asArray(data && data.symptoms);
    const formulas = asArray(data && data.formulas);

    const herbById = Object.create(null);
    const symptomById = Object.create(null);
    const formulaById = Object.create(null);

    herbs.forEach(function (h, i) {
      h.rank = i;
      herbById[h.id] = h;
    });
    symptoms.forEach(function (s, i) {
      s.rank = i;
      symptomById[s.id] = s;
    });
    formulas.forEach(function (f, i) {
      f.rank = i;
      formulaById[f.id] = f;
    });

    /* 反向关联：药材 ↔ 病症（以病症定义为唯一事实来源，避免两处漂移） */
    Object.keys(herbById).forEach(function (id) {
      herbById[id].symptoms = [];
    });
    symptoms.forEach(function (s) {
      (s.herbs || []).forEach(function (ref) {
        const h = herbById[ref.id];
        if (!h) return;
        if (h.symptoms.indexOf(s.id) < 0) h.symptoms.push(s.id);
      });
    });

    /* 方剂 ↔ 药材（按组成药名匹配；支持「炙甘草 / 生甘草 / 炒白术 / 荆芥穗」这类炮制前后缀回退） */
    const herbByName = Object.create(null);
    herbs.forEach(function (h) { herbByName[normalize(h.name)] = h; });

    const PREFIXES = ['生', '炙', '炒', '煅', '酒', '醋', '盐', '姜', '蜜', '焦', '制', '炮', '煨', '麸'];
    const SUFFIXES = ['炭', '粉', '片', '心', '梢', '尖', '穗'];

    function resolveHerbName(rawName) {
      const base = normalize(rawName);
      if (!base) return null;
      if (herbByName[base]) return herbByName[base];
      let cur = base;
      for (let pass = 0; pass < 2; pass += 1) {
        const head = cur.charAt(0);
        if (PREFIXES.indexOf(head) >= 0 && cur.length > 1) {
          cur = cur.slice(1);
          if (herbByName[cur]) return herbByName[cur];
        }
      }
      const tail = cur.charAt(cur.length - 1);
      if (SUFFIXES.indexOf(tail) >= 0 && cur.length > 1) {
        const trimmed = cur.slice(0, -1);
        if (herbByName[trimmed]) return herbByName[trimmed];
      }
      return null;
    }

    formulas.forEach(function (f) {
      f.symptomIds = (f.relatedSymptoms || []).filter(function (id) { return !!symptomById[id]; });
      f.herbIds = [];
      (f.composition || []).forEach(function (c) {
        const h = resolveHerbName(c.name);
        c.herbId = h ? h.id : null;
        if (h && f.herbIds.indexOf(h.id) < 0) f.herbIds.push(h.id);
      });
    });

    /* 药材 → 方剂（合并显式 relatedFormulas 与方剂组成反查） */
    herbs.forEach(function (h) {
      const ids = (h.relatedFormulas || []).filter(function (id) { return !!formulaById[id]; });
      h.formulaIds = ids.slice();
    });
    formulas.forEach(function (f) {
      (f.herbIds || []).forEach(function (hid) {
        const h = herbById[hid];
        if (h && h.formulaIds.indexOf(f.id) < 0) h.formulaIds.push(f.id);
      });
    });

    const herbEntries = herbs.map(function (h) {
      return { kind: 'herb', id: h.id, item: h, rank: h.rank, keys: makeKeys(h, HERB_FIELDS) };
    });
    const symptomEntries = symptoms.map(function (s) {
      return { kind: 'symptom', id: s.id, item: s, rank: s.rank, keys: makeKeys(s, SYMPTOM_FIELDS) };
    });
    const formulaEntries = formulas.map(function (f) {
      const entry = { kind: 'formula', id: f.id, item: f, rank: f.rank, keys: makeKeys(f, FORMULA_FIELDS) };
      /* 组成药名也参与检索（低权重） */
      (f.composition || []).forEach(function (c) {
        const norm = normalize(c.name);
        if (norm) entry.keys.push({ field: 'composition', text: c.name, norm: norm, weight: 35, fuzzy: false });
      });
      return entry;
    });

    return {
      herbs: herbs,
      symptoms: symptoms,
      formulas: formulas,
      byId: { herb: herbById, symptom: symptomById, formula: formulaById },
      entries: { herb: herbEntries, symptom: symptomEntries, formula: formulaEntries },
      categories: categoryStats(herbs),
      symptomGroups: groupStats(symptoms),
    };
  }

  function categoryStats(herbs) {
    const out = [];
    const map = Object.create(null);
    herbs.forEach(function (h) {
      const key = h.category || '其他';
      if (!map[key]) {
        map[key] = { name: key, count: 0 };
        out.push(map[key]);
      }
      map[key].count += 1;
    });
    return out;
  }

  function groupStats(symptoms) {
    let common = 0;
    let elderly = 0;
    symptoms.forEach(function (s) {
      const g = asArray(s.groups);
      if (g.indexOf('老年') >= 0) elderly += 1;
      if (g.indexOf('常见') >= 0 || (g.length === 0 && g.indexOf('老年') < 0)) common += 1;
    });
    return { common: common, elderly: elderly, total: symptoms.length };
  }

  /* ------------------------------------------------------------------ *
   * 打分与检索
   * ------------------------------------------------------------------ */

  /**
   * 单字段打分。
   * @returns {{score:number, kind:'exact'|'prefix'|'contains'|'initial'|'fuzzy'}|null}
   */
  function scoreKey(key, q, qLen) {
    const n = key.norm;
    if (!n) return null;

    if (n === q) return { score: key.weight * 12 + 40, kind: 'exact' };
    if (n.indexOf(q) === 0) {
      return { score: key.weight * 8 + 20, kind: key.field === 'initial' ? 'initial' : 'prefix' };
    }
    /* 中文单字是有意义的过滤条件（「痰」「咳」），英文/拼音仍要求 2 个字符以上 */
    const isCjk = /[\u4e00-\u9fa5]/.test(q);
    if (n.indexOf(q) >= 0 && (isCjk || q.length >= 2)) {
      return { score: key.weight * (qLen === 1 ? 3 : 5), kind: 'contains' };
    }

    if (key.field === 'initial' && q.length >= 1 && q.length <= 4) {
      if (n.indexOf(q) === 0) return { score: key.weight * 6, kind: 'initial' };
    }

    /* 编辑距离容错：只对正名；2 字词要求首字相同，否则误伤太狠 */
    if (!key.fuzzy) return null;
    if (qLen < 2 || qLen > 8) return null;

    const lengthGap = Math.abs(n.length - q.length);
    if (qLen <= 2 && lengthGap > 0) return null;
    if (qLen > 2 && lengthGap > 1) return null;

    const max = qLen >= 5 ? 2 : 1;
    const d = editDistance(n, q, max);
    if (d < 1 || d > max) return null;
    if (qLen === 2 && n.charAt(0) !== q.charAt(0)) return null;
    return { score: key.weight * (d === 1 ? 2.4 : 1.4), kind: 'fuzzy' };
  }

  function searchEntries(entries, q) {
    if (!q) return [];
    const qLen = q.length;
    const hits = [];

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      let best = null;

      for (let k = 0; k < e.keys.length; k++) {
        const r = scoreKey(e.keys[k], q, qLen);
        if (r && (!best || r.score > best.score)) {
          best = { score: r.score, kind: r.kind, field: e.keys[k].field };
        }
      }

      if (best) {
        hits.push({
          kind: e.kind, id: e.id, item: e.item, score: best.score,
          field: best.field, match: best.kind, fuzzy: best.kind === 'fuzzy', rank: e.rank,
        });
      }
    }

    hits.sort(function (a, b) {
      if (a.fuzzy !== b.fuzzy) return a.fuzzy ? 1 : -1;
      if (b.score !== a.score) return b.score - a.score;
      return a.rank - b.rank;
    });

    /* 疑似（错别字容错）最多保留 3 条，避免长尾噪音 */
    const strong = hits.filter(function (h) { return !h.fuzzy; });
    const fuzzy = hits.filter(function (h) { return h.fuzzy; }).slice(0, 3);
    return strong.concat(fuzzy);
  }

  /**
   * 全站检索。
   * @returns {{query:string, herbs:Array, symptoms:Array, formulas:Array, total:number}}
   */
  function search(index, rawQuery, opts) {
    const options = opts || {};
    const raw = String(rawQuery == null ? '' : rawQuery).trim();
    const q = normalize(raw);

    if (!q) {
      return { query: '', rawQuery: raw, herbs: [], symptoms: [], formulas: [], total: 0 };
    }

    /* 多词查询：空白分隔后逐个归一化，要求每个词都命中（AND），分数取和 */
    const tokens = raw.split(/\s+/).map(normalize).filter(Boolean);
    const list = tokens.length > 1 ? tokens : [q];

    function collect(kind) {
      if (list.length === 1) return searchEntries(index.entries[kind], list[0]);
      let acc = searchEntries(index.entries[kind], list[0]);
      for (let t = 1; t < list.length; t++) {
        const next = searchEntries(index.entries[kind], list[t]);
        const map = Object.create(null);
        next.forEach(function (h) { map[h.id] = h; });
        acc = acc
          .filter(function (h) { return !!map[h.id]; })
          .map(function (h) {
            const other = map[h.id];
            return {
              kind: h.kind, id: h.id, item: h.item, rank: h.rank,
              score: h.score + other.score,
              field: h.field, match: h.fuzzy && other.fuzzy ? 'fuzzy' : (h.match || 'exact'),
              fuzzy: h.fuzzy && other.fuzzy,
            };
          })
          .sort(function (a, b) { return b.score - a.score || a.rank - b.rank; });
      }
      return acc;
    }

    const herbs = options.kind && options.kind !== 'herb' ? [] : collect('herb');
    const symptoms = options.kind && options.kind !== 'symptom' ? [] : collect('symptom');
    const formulas = options.kind && options.kind !== 'formula' ? [] : collect('formula');

    return {
      query: q,
      rawQuery: raw,
      herbs: herbs,
      symptoms: symptoms,
      formulas: formulas,
      total: herbs.length + symptoms.length + formulas.length,
    };
  }

  /* ------------------------------------------------------------------ *
   * 展示辅助
   * ------------------------------------------------------------------ */

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** 在原文里高亮命中的查询串（只对中文/英文原文做子串高亮，拼音不处理） */
  function highlight(text, rawQuery) {
    const src = String(text == null ? '' : text);
    const q = String(rawQuery == null ? '' : rawQuery).trim();
    if (!q) return escapeHtml(src);

    const escaped = escapeHtml(src);
    const needle = escapeHtml(q);
    if (!needle) return escaped;

    try {
      const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      return escaped.replace(re, function (m) { return '<mark>' + m + '</mark>'; });
    } catch (e) {
      return escaped;
    }
  }

  function searchQueryForUi(raw) {
    return String(raw == null ? '' : raw).trim();
  }

  /**
   * 病症 → 药材（带角色），并补齐一句话依据缺失的情况。
   */
  function symptomHerbs(index, symptomId) {
    const s = index.byId.symptom[symptomId];
    if (!s) return { primary: [], secondary: [] };
    const out = { primary: [], secondary: [] };
    (s.herbs || []).forEach(function (ref) {
      const h = index.byId.herb[ref.id];
      if (!h) return;
      const row = { herb: h, role: ref.role === 'secondary' ? 'secondary' : 'primary', note: ref.note || '' };
      (row.role === 'primary' ? out.primary : out.secondary).push(row);
    });
    return out;
  }

  function formulasForSymptom(index, symptomId) {
    return (index.byId.symptom[symptomId] && index.byId.symptom[symptomId].formulas || [])
      .map(function (id) { return index.byId.formula[id]; })
      .filter(Boolean);
  }

  function symptomListForHerb(index, herbId) {
    const h = index.byId.herb[herbId];
    if (!h) return [];
    return (h.symptoms || []).map(function (id) { return index.byId.symptom[id]; }).filter(Boolean);
  }

  function formulaListForHerb(index, herbId) {
    const h = index.byId.herb[herbId];
    if (!h) return [];
    return (h.formulaIds || []).map(function (id) { return index.byId.formula[id]; }).filter(Boolean);
  }

  /** 方剂里某味药的角色（没有就返回空串） */
  function roleOfHerbInFormula(formula, herbId) {
    const row = (formula.composition || []).find(function (c) { return c.herbId === herbId; });
    return row ? row.role || '' : '';
  }

  return {
    normalize: normalize,
    toSimplified: toSimplified,
    toHalfWidth: toHalfWidth,
    editDistance: editDistance,
    T2S_BAD: T2S_BAD,
    buildIndex: buildIndex,
    search: search,
    escapeHtml: escapeHtml,
    highlight: highlight,
    searchQueryForUi: searchQueryForUi,
    symptomHerbs: symptomHerbs,
    formulasForSymptom: formulasForSymptom,
    symptomListForHerb: symptomListForHerb,
    formulaListForHerb: formulaListForHerb,
    roleOfHerbInFormula: roleOfHerbInFormula,
  };
});
