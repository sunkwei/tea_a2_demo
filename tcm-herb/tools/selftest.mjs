/**
 * 中药大全 · 离线断言（纯 Node，不开浏览器、不联网）
 *
 * 用法：node tcm-herb/tools/selftest.mjs
 *
 * 覆盖：
 *   1. 数据完整性（86 味药 / 39 病症 / 22 方剂，引用可达、字段齐全、无剂量）
 *   2. 图片与署名（覆盖全部药材、许可白名单、文件存在、实物图占比）
 *   3. 归一化与检索（全角/标点/繁简/拼音/首字母/功效/容错/多词）
 *   4. 索引派生（药材↔病症、方剂组成→药材、君臣佐使角色）
 *   5. 历史存储（合并计次、上限、删除、清空、refId 采纳）
 *   6. 联网层（来源解析、去重、提示词合规、探活与错误分类——用桩 fetch）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

function loadScript(rel) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const m = { exports: {} };
  new Function('module', 'exports', src)(m, m.exports);
  return m.exports;
}

const Core = loadScript('src/core.js');
const Store = loadScript('src/storage.js');
const Online = loadScript('src/online.js');
const HERBS = loadScript('src/data-herbs.js');
const SYMPTOMS = loadScript('src/data-symptoms.js');
const FORMULAS = loadScript('src/data-formulas.js');

let pass = 0;
const fails = [];

function t(name, fn) {
  try {
    const r = fn();
    if (r === false) throw new Error('断言返回 false');
    pass++;
  } catch (e) {
    fails.push(name + ' → ' + (e && e.message));
  }
}

async function ta(name, fn) {
  try {
    const r = await fn();
    if (r === false) throw new Error('断言返回 false');
    pass++;
  } catch (e) {
    fails.push(name + ' → ' + (e && e.message));
  }
}

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error((label || '') + ' 期望 ' + b + '，实际 ' + a);
}

/* ------------------------------------------------------------------ *
 * 1. 数据完整性
 * ------------------------------------------------------------------ */

t('药材 86 味', () => eq(HERBS.length, 86));
t('病症 39 条', () => eq(SYMPTOMS.length, 39));
t('方剂 22 首', () => eq(FORMULAS.length, 22));

t('药材 id / 名称无重复', () => {
  const ids = HERBS.map((h) => h.id);
  const names = HERBS.map((h) => h.name);
  if (new Set(ids).size !== ids.length) throw new Error('id 重复');
  if (new Set(names).size !== names.length) throw new Error('名称重复');
});

t('药材必填字段齐全', () => {
  const req = ['id', 'name', 'pinyin', 'initial', 'category', 'nature', 'flavor', 'meridians',
    'efficacy', 'indications', 'usage', 'toxicity', 'image', 'source'];
  const bad = [];
  HERBS.forEach((h) => {
    req.forEach((k) => {
      const v = h[k];
      if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) bad.push(h.id + '.' + k);
    });
  });
  if (bad.length) throw new Error(bad.join(', '));
});

t('毒性取值合法', () => {
  const ok = ['无毒', '小毒', '有毒', '大毒'];
  const bad = HERBS.filter((h) => !ok.includes(h.toxicity)).map((h) => h.name + ':' + h.toxicity);
  if (bad.length) throw new Error(bad.join(', '));
});

t('含毒药材都有禁忌说明', () => {
  const bad = HERBS.filter((h) => h.toxicity !== '无毒' && !(h.contraindication || []).length);
  if (bad.length) throw new Error(bad.map((h) => h.name).join(', '));
});

t('病症 id / 名称无重复', () => {
  const ids = SYMPTOMS.map((s) => s.id);
  if (new Set(ids).size !== ids.length) throw new Error('id 重复');
});

t('病症分组只有 常见 / 老年', () => {
  const bad = [];
  SYMPTOMS.forEach((s) => {
    if (!Array.isArray(s.groups) || !s.groups.length) bad.push(s.id + '(空)');
    (s.groups || []).forEach((g) => { if (g !== '常见' && g !== '老年') bad.push(s.id + ':' + g); });
  });
  if (bad.length) throw new Error(bad.join(', '));
});

t('老年病种已收录（帕金森/胃酸过多/骨质疏松等）', () => {
  const names = SYMPTOMS.filter((s) => (s.groups || []).includes('老年')).map((s) => s.name);
  ['帕金森病', '胃酸过多', '骨质疏松', '前列腺增生', '老年性皮肤瘙痒', '耳鸣听力下降', '视物模糊', '夜尿频多', '阿尔茨海默病']
    .forEach((n) => { if (!names.includes(n)) throw new Error('缺 ' + n); });
});

t('老年病种都带就医提示（严重疾病类）', () => {
  ['帕金森病', '阿尔茨海默病', '胃酸过多', '高血压', '糖尿病', '骨质疏松', '前列腺增生']
    .forEach((n) => {
      const s = SYMPTOMS.find((x) => x.name === n);
      if (!s || !s.warning) throw new Error(n + ' 缺 warning');
    });
});

t('病症的药材/搭配引用都存在', () => {
  const ids = new Set(HERBS.map((h) => h.id));
  const bad = [];
  SYMPTOMS.forEach((s) => {
    (s.herbs || []).forEach((r) => { if (!ids.has(r.id)) bad.push(s.id + '→' + r.id); });
    (s.pairs || []).forEach((p) => (p.herbs || []).forEach((h) => { if (!ids.has(h)) bad.push(s.id + ' 搭配→' + h); }));
  });
  if (bad.length) throw new Error(bad.join(', '));
});

t('病症的方剂引用都存在', () => {
  const fids = new Set(FORMULAS.map((f) => f.id));
  const bad = [];
  SYMPTOMS.forEach((s) => (s.formulas || []).forEach((f) => { if (!fids.has(f)) bad.push(s.id + '→' + f); }));
  if (bad.length) throw new Error(bad.join(', '));
});

t('方剂无剂量、无煎服法', () => {
  FORMULAS.forEach((f) => {
    if ('usage' in f) throw new Error(f.name + ' 含 usage');
    (f.composition || []).forEach((c) => {
      if ('dose' in c || 'grams' in c) throw new Error(f.name + ' 含剂量');
      if (/[0-9]+\s*(g|克)/.test(c.name)) throw new Error(f.name + ' 药名含剂量');
    });
  });
});

t('方剂都有出处/功效/主治/注意', () => {
  FORMULAS.forEach((f) => {
    ['source', 'efficacy', 'indications', 'note'].forEach((k) => {
      if (!f[k]) throw new Error(f.id + '.' + k);
    });
    if (!/仅供研习/.test(f.note)) throw new Error(f.id + ' note 缺少「仅供研习」');
    if (!(f.composition || []).length) throw new Error(f.id + ' 组成空');
  });
});

/* ------------------------------------------------------------------ *
 * 2. 图片与署名
 * ------------------------------------------------------------------ */

const CREDITS = (() => {
  const src = fs.readFileSync(path.join(ROOT, 'assets/herbs/sources.js'), 'utf8');
  const fake = {};
  new Function('window', src)(fake);
  return fake.TCM_IMAGE_CREDITS || {};
})();

t('每味药都有图片署名条目', () => {
  const missing = HERBS.filter((h) => !CREDITS[h.id]).map((h) => h.id);
  if (missing.length) throw new Error(missing.join(', '));
});

t('图片文件都存在', () => {
  const missing = HERBS.filter((h) => !fs.existsSync(path.join(ROOT, CREDITS[h.id].file)));
  if (missing.length) throw new Error(missing.map((h) => h.id).join(', '));
});

t('许可都在白名单（CC0 / PD / CC BY / CC BY-SA）', () => {
  const bad = Object.entries(CREDITS).filter(([, c]) =>
    !/^(cc0|public domain|pd\b|cc[- ]by)/i.test(String(c.license || ''))
  );
  if (bad.length) throw new Error(bad.map(([id, c]) => id + ':' + c.license).join(', '));
});

t('实物图占比 ≥ 85%', () => {
  const real = Object.values(CREDITS).filter((c) => /\.jpg$/i.test(c.file)).length;
  const ratio = real / HERBS.length;
  if (ratio < 0.85) throw new Error('实际 ' + (ratio * 100).toFixed(1) + '%');
});

t('CC BY 类图片都带作者与许可链接', () => {
  const bad = Object.entries(CREDITS).filter(([, c]) =>
    /^cc[- ]by/i.test(c.license) && (!c.author || !c.licenseUrl || !c.sourceUrl)
  );
  if (bad.length) throw new Error(bad.map(([id]) => id).join(', '));
});

/* ------------------------------------------------------------------ *
 * 3. 归一化与检索
 * ------------------------------------------------------------------ */

const index = Core.buildIndex({ herbs: HERBS, symptoms: SYMPTOMS, formulas: FORMULAS });

t('繁简表无错位项', () => eq(Core.T2S_BAD, []));

t('归一化：空白/标点/全角', () => {
  eq(Core.normalize(' 甘 草。'), '甘草');
  eq(Core.normalize('ＧＣ'), 'gc');
  eq(Core.normalize('当 归！'), '当归');
});

t('归一化：繁→简', () => {
  eq(Core.normalize('當歸'), '当归');
  eq(Core.normalize('黃連'), '黄连');
  eq(Core.normalize('金銀花'), '金银花');
});

t('检索：拼音首字母 gc → 甘草排第一', () => {
  const r = Core.search(index, 'gc');
  if (!r.herbs.length) throw new Error('无结果');
  eq(r.herbs[0].item.name, '甘草');
});

t('检索：拼音全拼 → 甘草', () => {
  const r = Core.search(index, 'gancao');
  eq(r.herbs[0].item.name, '甘草');
});

t('检索：正名精确命中且不夹带别名噪音', () => {
  const r = Core.search(index, '甘草');
  eq(r.herbs.map((h) => h.item.name), ['甘草']);
});

t('检索：错别字容错（甘冒 → 甘草，标疑似）', () => {
  const r = Core.search(index, '甘冒');
  const hit = r.herbs.find((h) => h.item.name === '甘草');
  if (!hit) throw new Error('未命中');
  if (!hit.fuzzy) throw new Error('未标疑似');
});

t('检索：繁体输入可命中', () => {
  const r = Core.search(index, '當歸');
  eq(r.herbs[0].item.name, '当归');
});

t('检索：功效反查（补气 → 黄芪）', () => {
  const r = Core.search(index, '补气');
  const hit = r.herbs.find((h) => h.item.name === '黄芪');
  if (!hit) throw new Error('未命中黄芪');
  eq(hit.field, 'efficacy');
});

t('检索：分类反查（清热药 → 全部该类）', () => {
  const r = Core.search(index, '清热药');
  const expect = HERBS.filter((h) => h.category === '清热药').length;
  eq(r.herbs.length, expect);
});

t('检索：「咳嗽」三类都有结果', () => {
  const r = Core.search(index, '咳嗽');
  if (!r.herbs.length) throw new Error('无药材');
  if (!r.symptoms.length) throw new Error('无病症');
  if (!r.formulas.length) throw new Error('无方剂');
});

t('检索：老年病种可搜到（帕金森）', () => {
  const r = Core.search(index, '帕金森');
  eq(r.symptoms[0].item.name, '帕金森病');
});

t('检索：多词 AND（咳嗽 痰）', () => {
  const r = Core.search(index, '咳嗽 痰');
  if (!r.herbs.length) throw new Error('无结果');
  r.herbs.forEach((h) => {
    const text = [h.item.name, (h.item.alias || []).join(''), (h.item.efficacy || []).join(''),
      h.item.indications, h.item.category].join('');
    if (!/咳嗽/.test(text) || !/痰/.test(text)) throw new Error(h.item.name + ' 不满足 AND');
  });
});

t('检索：无结果时返回空且不报错', () => {
  const r = Core.search(index, 'zzzzzz');
  eq(r.total, 0);
});

t('检索：空查询返回空', () => {
  eq(Core.search(index, '   ').total, 0);
});

t('高亮：转义 + 命中标记', () => {
  const html = Core.highlight('<甘草>', '甘草');
  if (!/&lt;/.test(html)) throw new Error('未转义');
  if (!/<mark>甘草<\/mark>/.test(html)) throw new Error('未高亮');
});

/* ------------------------------------------------------------------ *
 * 4. 索引派生
 * ------------------------------------------------------------------ */

t('药材 → 病症反查（甘草有关联病症）', () => {
  const h = index.byId.herb['gan-cao'];
  if (!h.symptoms.length) throw new Error('无关联病症');
  const names = h.symptoms.map((id) => index.byId.symptom[id].name);
  if (!names.includes('乏力气短')) throw new Error('缺 乏力气短');
});

t('方剂组成 → 药材（炙甘草回退到甘草）', () => {
  const f = index.byId.formula['gui-zhi-tang'];
  const row = f.composition.find((c) => c.name === '炙甘草');
  eq(row.herbId, 'gan-cao');
});

t('方剂组成药名都能给出链接或明确未收录', () => {
  const bad = [];
  FORMULAS.forEach((f) => (f.composition || []).forEach((c) => {
    if (c.herbId == null && !/大枣|白芷|大腹皮|牛蒡子|淡豆豉|淡竹叶|桑叶|芦根|紫菀|百部|白前|升麻|龙眼肉|茯神|枳壳|芒硝|生地黄|赤芍|牛膝|山药|牡丹皮|川牛膝|荆芥穗/.test(c.name)) {
      bad.push(f.id + ':' + c.name);
    }
  }));
  if (bad.length) throw new Error(bad.join(', '));
});

t('君臣佐使角色可查（桂枝汤里甘草=使）', () => {
  const f = index.byId.formula['gui-zhi-tang'];
  eq(Core.roleOfHerbInFormula(f, 'gan-cao'), '使');
});

t('药材 → 方剂反查（甘草出现在多个方剂）', () => {
  const list = Core.formulaListForHerb(index, 'gan-cao');
  if (list.length < 5) throw new Error('只有 ' + list.length + ' 首');
});

t('病症 → 药材按主/辅分组', () => {
  const g = Core.symptomHerbs(index, 'pa-jin-sen-bing');
  if (!g.primary.length || !g.secondary.length) throw new Error('分组为空');
  if (!g.primary.some((r) => r.herb.name === '天麻')) throw new Error('缺天麻');
});

/* ------------------------------------------------------------------ *
 * 5. 历史存储
 * ------------------------------------------------------------------ */

function memStore() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
}

t('历史：同词合并并累加次数', () => {
  const s = Store.createStore(memStore());
  s.add({ kind: 'keyword', text: '甘草' });
  s.add({ kind: 'herb', text: '甘草', refId: 'gan-cao' });
  const list = s.list();
  eq(list.length, 1);
  eq(list[0].hitCount, 2);
  eq(list[0].refId, 'gan-cao');
});

t('历史：最新在前', () => {
  const s = Store.createStore(memStore());
  s.add({ kind: 'keyword', text: 'A', ts: 1 });
  s.add({ kind: 'keyword', text: 'B', ts: 2 });
  eq(s.list().map((x) => x.text), ['B', 'A']);
});

t('历史：上限 50 条', () => {
  const s = Store.createStore(memStore());
  for (let i = 0; i < 60; i++) s.add({ kind: 'keyword', text: 'k' + i, ts: i + 1 });
  eq(s.list().length, 50);
  eq(s.list()[0].text, 'k59');
});

t('历史：单条删除 / 清空', () => {
  const s = Store.createStore(memStore());
  s.add({ kind: 'keyword', text: 'A' });
  s.add({ kind: 'keyword', text: 'B' });
  const id = s.list()[0].id;
  s.remove(id);
  eq(s.list().length, 1);
  s.clear();
  eq(s.list().length, 0);
});

t('历史：脏数据不炸（sanitize）', () => {
  const list = Store.sanitize([null, {}, { text: '' }, { text: 'ok', ts: 'x' }, 'bad']);
  eq(list.length, 1);
  eq(list[0].text, 'ok');
  eq(list[0].hitCount, 1);
});

/* ------------------------------------------------------------------ *
 * 6. 联网层（桩 fetch）
 * ------------------------------------------------------------------ */

const SAMPLE_OUTPUT = [
  '2 result(s) for: 甘草 功效',
  '',
  '[1] 甘草 - 维基百科',
  '    url: https://zh.wikipedia.org/wiki/甘草',
  '    score: 1.47',
  '    authority: 3',
  '    summary: 甘草是豆科甘草属植物。',
  '',
  '[2] Licorice - Wikipedia',
  '    url: https://en.wikipedia.org/wiki/Licorice',
  '    score: 0.92',
  '    authority: 2',
  '    summary: Liquorice is the root of Glycyrrhiza glabra.',
].join('\n');

t('联网：解析 web_tool_calls 输出为来源', () => {
  const list = Online.parseSearchOutput(SAMPLE_OUTPUT);
  eq(list.length, 2);
  eq(list[0].url, 'https://zh.wikipedia.org/wiki/甘草');
  eq(list[0].title, '甘草 - 维基百科');
  eq(list[0].authority, 3);
  if (!list[1].summary.includes('Liquorice')) throw new Error('summary 解析失败');
});

t('联网：多轮调用的来源去重', () => {
  const list = Online.parseSources([
    { ok: true, output: SAMPLE_OUTPUT },
    { ok: true, output: SAMPLE_OUTPUT },
  ]);
  eq(list.length, 2);
});

t('联网：正文链接兜底提取', () => {
  const urls = Online.extractUrls('参考 https://a.example/x 和 https://b.example/y。');
  eq(urls.length, 2);
});

t('联网：提示词禁用剂量并要来源', () => {
  const p = Online.buildPrompt('甘草');
  if (!/不写剂量/.test(p)) throw new Error('缺剂量约束');
  if (!/不做诊断/.test(p)) throw new Error('缺诊断约束');
  if (!/来源/.test(p)) throw new Error('缺来源要求');
});

t('联网：启动指引给出可执行命令', () => {
  const h = Online.startHint('localhost:8383');
  if (!/tea_agent --port 8383/.test(h)) throw new Error('缺启动命令');
});

t('联网：错误分类文案', () => {
  eq(Online.errorText('offline'), '连不上本机 a2（可能未启动）。');
  if (!/502/.test(Online.errorText('upstream'))) throw new Error('upstream 文案缺失');
});

await ta('联网：探活成功（桩 fetch）', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, version: '1.7.0', provider: 'minimax', model: 'MiniMax-M3.1-Flash' }), { status: 200 });
  try {
    const r = await Online.probe('http://127.0.0.1:8383', { timeout: 1000 });
    if (!r.ok) throw new Error('probe 失败');
    eq(r.version, '1.7.0');
  } finally { globalThis.fetch = orig; }
});

await ta('联网：探活失败（网络错误）', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  try {
    const r = await Online.probe('http://127.0.0.1:8383', { timeout: 1000 });
    if (r.ok) throw new Error('应失败');
    eq(r.error, 'offline');
  } finally { globalThis.fetch = orig; }
});

await ta('联网：查询请求体符合 a2 契约', async () => {
  const orig = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), body: JSON.parse(init.body) };
    return new Response(JSON.stringify({
      ok: true, content: '甘草味甘性平。', elapsed_ms: 1200, provider: 'deepseek', model: 'deepseek-flash',
      web_tool_calls: [{ ok: true, output: SAMPLE_OUTPUT }],
    }), { status: 200 });
  };
  try {
    const r = await Online.search('甘草', { base: 'http://127.0.0.1:8383' });
    if (!r.ok) throw new Error('search 失败');
    if (!captured.url.endsWith('/api/llm/chat')) throw new Error('URL 不对：' + captured.url);
    eq(captured.body.web_tools, true);
    eq(captured.body.reasoning_effort, 'none');
    eq(captured.body.provider, 'deepseek');
    eq(captured.body.model, 'deepseek-flash');
    eq(r.sources.length, 2);
  } finally { globalThis.fetch = orig; }
});

await ta('联网：502 归类为 upstream', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 502 });
  try {
    const r = await Online.search('甘草', { base: 'http://127.0.0.1:8383' });
    if (r.ok) throw new Error('应失败');
    eq(r.kind, 'upstream');
  } finally { globalThis.fetch = orig; }
});

/* ------------------------------------------------------------------ *
 * 汇总
 * ------------------------------------------------------------------ */

console.log('\n' + pass + ' 项通过' + (fails.length ? '，' + fails.length + ' 项失败' : ''));
if (fails.length) {
  fails.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
