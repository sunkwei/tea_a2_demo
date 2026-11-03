/**
 * 便笺 · 离线自测（纯逻辑层）
 *
 *   node sticky-notes/tools/selftest.mjs
 *
 * 直接在 Node 里加载 src/core.js（不依赖 DOM），对配色对比度、自动分类、
 * 正则检索、提醒计算、过滤排序等逻辑做断言。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(HERE, '../src/core.js'), 'utf8');
// eslint-disable-next-line no-new-func
new Function(src)();
const C = globalThis.StickyCore;

if (!C) {
  console.error('✗ 未能加载 StickyCore');
  process.exit(1);
}

// AI 层（同样是纯逻辑，可离线断言）
const aiSrc = fs.readFileSync(path.join(HERE, '../src/ai.js'), 'utf8');
// eslint-disable-next-line no-new-func
new Function(aiSrc)();
const AI = globalThis.StickyAI;

if (!AI) {
  console.error('✗ 未能加载 StickyAI');
  process.exit(1);
}

let pass = 0;
const failures = [];

function t(name, fn) {
  try {
    fn();
    pass++;
    console.log('  ✓ ' + name);
  } catch (e) {
    failures.push(name + ' → ' + e.message);
    console.log('  ✗ ' + name + ' → ' + e.message);
  }
}
function group(name) {
  console.log('\n' + name);
}
function eq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error((msg ? msg + '：' : '') + '期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual));
  }
}
function near(actual, expected, tol, msg) {
  if (Math.abs(actual - expected) > (tol == null ? 0.01 : tol)) {
    throw new Error((msg ? msg + '：' : '') + '期望 ≈' + expected + '，实际 ' + actual);
  }
}
function ok(v, msg) {
  if (!v) throw new Error(msg || '断言失败');
}

/* ------------------------------------------------------------------ */
group('颜色与对比度');

t('黑底白字对比度 = 21', () => eq(C.contrastRatio('#ffffff', '#000000'), 21));

t('同色对比度 = 1', () => eq(C.contrastRatio('#123456', '#123456'), 1));

t('调色板 12 种底色都能选出 ≥4.5:1 的文字色（WCAG AA）', () => {
  for (const p of C.PALETTE) {
    const best = C.bestTextColor(p.bg);
    ok(best.ratio >= 4.5, `${p.name} ${p.bg} 只有 ${best.ratio}:1`);
  }
});

t('调色板里绝大多数底色达到 AAA(≥7:1)', () => {
  const aaa = C.PALETTE.filter((p) => C.bestTextColor(p.bg).ratio >= 7).length;
  ok(aaa >= 8, `只有 ${aaa}/12 种达到 AAA`);
});

t('浅色底选深字、深色底选浅字', () => {
  eq(C.bestTextColor('#FFD93D').color, '#000000');
  eq(C.bestTextColor('#2E7D5B').color, '#ffffff');
});

t('对比度等级判定', () => {
  eq(C.contrastGrade(21), 'AAA');
  eq(C.contrastGrade(7), 'AAA');
  eq(C.contrastGrade(4.5), 'AA');
  eq(C.contrastGrade(3.2), 'AA-Large');
  eq(C.contrastGrade(1.2), '不合格');
});

t('十六进制颜色规范化', () => {
  eq(C.normalizeHex('#ABC'), '#aabbcc');
  eq(C.normalizeHex('FFD93D'), '#ffd93d');
  eq(C.normalizeHex('zzz'), '#000000');
});

/* ------------------------------------------------------------------ */
group('自动分类');

t('会议/需求 → 工作', () => eq(C.classify('明天开需求评审会议').category, '工作'));
t('- [ ] 打勾项 → 待办', () => eq(C.classify('- [ ] 写周报').category, '待办'));
t('关键词「记得」→ 待办', () => eq(C.classify('记得交房租').category, '待办'));
t('房租 → 财务（优先级高于生活）', () => eq(C.classify('房租 2000').category, '财务'));
t('密码 → 私密（最高优先级）', () => eq(C.classify('服务器密码是 abc').category, '私密'));
t('英语单词 → 学习', () => eq(C.classify('背 100 个英语单词').category, '学习'));
t('机票酒店 → 旅行', () => eq(C.classify('订机票和酒店').category, '旅行'));
t('无命中 → 其他', () => eq(C.classify('随便写点什么').category, '其他'));
t('返回命中关键词', () => eq(C.classify('今天要开客户会议').keyword, '客户'));
t('命中关键词多的规则优先于命中少的', () => {
  // 工作命中「客户/需求/评审/会议」4 次，待办只命中「记得」1 次 → 归为工作
  eq(C.classify('客户需求评审会议，记得准备材料').category, '工作');
});
t('sticky 规则（私密）一旦命中直接锁定分类', () => {
  eq(C.classify('会议纪要里写了服务器密码').category, '私密');
});
t('返回命中的关键词列表', () => {
  const r = C.classify('客户需求评审会议');
  ok(r.keywords.length >= 2, '关键词数量 ' + r.keywords.length);
  ok(r.keywords.includes('客户'), JSON.stringify(r.keywords));
});
t('自定义规则生效', () => {
  const rules = [{ id: 'x', name: '足球', priority: 1, pattern: '世界杯|联赛', enabled: true }];
  eq(C.classify('看世界杯', rules).category, '足球');
});
t('非法正则的规则被跳过而不报错', () => {
  const rules = [
    { id: 'bad', name: '坏规则', priority: 99, pattern: '([', enabled: true },
    { id: 'ok', name: '好规则', priority: 1, pattern: '会议', enabled: true },
  ];
  eq(C.classify('开会议', rules).category, '好规则');
});
t('规则校验器', () => {
  eq(C.validateRule({ name: 'a', pattern: 'x' }).ok, true);
  eq(C.validateRule({ name: '', pattern: 'x' }).ok, false);
  eq(C.validateRule({ name: 'a', pattern: '([' }).ok, false);
});

/* ------------------------------------------------------------------ */
group('检索（普通 / 正则）');

t('普通检索：忽略大小写的子串匹配', () => {
  const m = C.buildMatcher('会议', { regex: false });
  eq(m.ok, true);
  eq(C.matcherTest(m, '开一个会议'), true);
  eq(C.matcherTest(m, 'MEETING'), false);
});

t('普通检索：特殊字符被转义，不会当成正则', () => {
  const m = C.buildMatcher('a+b', { regex: false });
  eq(C.matcherTest(m, 'a+b'), true);
  eq(C.matcherTest(m, 'aab'), false);
});

t('正则检索：交替匹配', () => {
  const m = C.buildMatcher('会议|需求', { regex: true });
  eq(m.ok, true);
  eq(C.matcherTest(m, '讨论需求文档'), true);
  eq(C.matcherTest(m, '开客户会议'), true);
  eq(C.matcherTest(m, '无关内容'), false);
});

t('正则检索：非法正则返回错误而不是抛异常', () => {
  const m = C.buildMatcher('([', { regex: true });
  eq(m.ok, false);
  ok(typeof m.error === 'string' && m.error.length > 0);
});

t('高亮：命中处包 <mark>，其余做 HTML 转义', () => {
  const m = C.buildMatcher('会议', { regex: false });
  eq(C.highlight('开会 <b>会议</b>', m), '开会 &lt;b&gt;<mark>会议</mark>&lt;/b&gt;');
});

t('高亮：正则可高亮多处', () => {
  const m = C.buildMatcher('a', { regex: true });
  eq(C.highlight('banana', m), 'b<mark>a</mark>n<mark>a</mark>n<mark>a</mark>');
});

t('匹配计数', () => {
  const m = C.buildMatcher('会议', { regex: false });
  eq(C.countMatches(m, '会议 会议 会议'), 3);
});

t('空查询不产生匹配器', () => {
  const m = C.buildMatcher('   ', { regex: true });
  eq(m.empty, true);
});

/* ------------------------------------------------------------------ */
group('提醒');

t('提醒触发时刻 = 指定时间前 5 分钟', () => {
  const at = new Date(2026, 0, 1, 10, 0, 0).getTime();
  const r = C.computeReminder(at, 5);
  eq(r.fireAt, at - 5 * 60 * 1000);
  eq(r.leadMinutes, 5);
});

t('提前量可配置', () => {
  const at = 1000000;
  eq(C.computeReminder(at, 30).fireAt, at - 30 * 60000);
  eq(C.computeReminder(at, 0).fireAt, at);
});

t('状态流转：待提醒 → 该响 → 已提醒 → 已过期', () => {
  const at = 1000 * 60 * 60 * 1000; // 未来 1 小时
  const note = { reminder: C.computeReminder(at, 5) };
  eq(C.reminderStatus(note, at - 10 * 60000).status, 'pending');
  eq(C.reminderStatus(note, at - 5 * 60000).status, 'due');
  note.reminder.firedAt = at - 4 * 60000;
  eq(C.reminderStatus(note, at - 4 * 60000).status, 'fired');
  const late = { reminder: C.computeReminder(at, 5) };
  eq(C.reminderStatus(late, at + 3 * 3600000).status, 'expired');
});

t('pending 状态给出剩余毫秒数', () => {
  const at = 1000 * 60 * 60 * 1000;
  const note = { reminder: C.computeReminder(at, 5) };
  const st = C.reminderStatus(note, at - 10 * 60000);
  eq(st.msLeft, 5 * 60000);
});

t('无提醒时状态为 none', () => eq(C.reminderStatus({ reminder: null }, Date.now()).status, 'none'));

/* ------------------------------------------------------------------ */
group('时间格式化');

t('倒计时文案', () => {
  eq(C.formatCountdown(5000), '5 秒');
  eq(C.formatCountdown(65000), '1 分 05 秒');
  eq(C.formatCountdown(3600000), '1 小时 0 分');
  eq(C.formatCountdown(90000000), '1 天 1 小时');
});

t('相对时间', () => {
  const now = new Date(2026, 0, 1, 12, 0, 0).getTime();
  eq(C.formatRelative(now - 30000, now), '刚刚');
  eq(C.formatRelative(now - 5 * 60000, now), '5 分钟前');
  eq(C.formatRelative(now - 3 * 3600000, now), '3 小时前');
});

t('datetime-local 双向转换', () => {
  const ms = new Date(2026, 4, 6, 7, 8, 0).getTime();
  const v = C.toLocalInputValue(ms);
  eq(v, '2026-05-06T07:08');
  eq(C.fromLocalInputValue(v), ms);
  eq(C.fromLocalInputValue(''), null);
  eq(C.fromLocalInputValue('乱写'), null);
});

/* ------------------------------------------------------------------ */
group('数据模型');

t('新建便笺自动记录创建时间并自动归类', () => {
  const n = C.createNote({ text: '明天开客户会议', now: 1700000000000, rules: C.DEFAULT_RULES });
  eq(n.createdAt, 1700000000000);
  eq(n.updatedAt, 1700000000000);
  eq(n.category, '工作');
  eq(n.autoCategory, '工作');
  eq(n.reminder, null);
});

t('新建便笺自动配高对比文字色', () => {
  const n = C.createNote({ text: 'x', bg: '#2E7D5B', rules: C.DEFAULT_RULES });
  ok(C.contrastRatio(n.fg, n.bg) >= 4.5);
});

t('带提醒创建时按提前量计算 fireAt', () => {
  const at = 1700000000000;
  const n = C.createNote({ text: 'x', reminderAt: at, leadMinutes: 5, rules: C.DEFAULT_RULES });
  eq(n.reminder.fireAt, at - 300000);
  eq(n.reminder.firedAt, null);
});

t('序列化 / 反序列化可往返', () => {
  const notes = [C.createNote({ text: '会议纪要', bg: '#FFD93D', rules: C.DEFAULT_RULES })];
  const s = C.serialize({ notes, settings: { leadMinutes: 5 } });
  const back = C.deserialize(s);
  eq(back.notes.length, 1);
  eq(back.notes[0].text, '会议纪要');
  eq(back.notes[0].bg, '#ffd93d');
  eq(back.settings.leadMinutes, 5);
});

t('损坏的 JSON 不会抛异常', () => {
  const r = C.deserialize('{不是 json');
  eq(r.notes.length, 0);
  eq(C.deserialize(null).notes.length, 0);
  eq(C.deserialize({ notes: 'x' }).notes.length, 0);
});

t('旧数据补全默认字段', () => {
  const n = C.normalizeNote({ text: '老便笺' });
  eq(n.bg, '#ffd93d');
  ok(n.fg);
  eq(n.category, '其他');
  ok(n.createdAt > 0);
});

/* ------------------------------------------------------------------ */
group('过滤与排序');

const now = new Date(2026, 0, 10, 12, 0, 0).getTime();
const mk = (over) =>
  Object.assign(
    {
      id: Math.random().toString(36).slice(2),
      text: '',
      bg: '#ffd93d',
      fg: '#111827',
      fgLocked: false,
      category: '其他',
      autoCategory: '其他',
      manual: false,
      createdAt: now - 1000,
      updatedAt: now - 1000,
      pinned: false,
      reminder: null,
    },
    over
  );

const sample = [
  mk({ id: 'a', text: '需求评审会议', category: '工作', createdAt: now - 5000 }),
  mk({ id: 'b', text: '买菜清单', category: '购物', createdAt: now - 10 * 86400000 }),
  mk({ id: 'c', text: '明天开客户会议', category: '工作', createdAt: now - 1000, pinned: true }),
  mk({
    id: 'd',
    text: '记得交房租',
    category: '待办',
    createdAt: now - 2000,
    reminder: C.computeReminder(now + 3600000, 5),
  }),
];

t('按内容检索', () => {
  const r = C.filterNotes(sample, { query: '会议', regex: false, sort: 'created-desc' }, now);
  eq(r.list.length, 2);
  eq(r.matcher.ok, true);
});

t('正则检索', () => {
  const r = C.filterNotes(sample, { query: '买|租', regex: true, sort: 'created-desc' }, now);
  eq(r.list.length, 2);
});

t('非法正则时不筛掉任何便笺，但标记为错误', () => {
  const r = C.filterNotes(sample, { query: '([', regex: true, sort: 'created-desc' }, now);
  eq(r.matcher.ok, false);
  eq(r.list.length, sample.length);
});

t('按分类过滤', () => {
  const r = C.filterNotes(sample, { query: '', category: '工作', sort: 'created-desc' }, now);
  eq(r.list.length, 2);
});

t('按提醒状态过滤', () => {
  const r = C.filterNotes(sample, { query: '', reminder: 'has', sort: 'created-desc' }, now);
  eq(r.list.length, 1);
  eq(r.list[0].id, 'd');
});

t('按时间范围过滤（今天 / 近 7 天）', () => {
  const today = C.filterNotes(sample, { query: '', date: 'today', sort: 'created-desc' }, now);
  eq(today.list.length, 3);
  const week = C.filterNotes(sample, { query: '', date: 'week', sort: 'created-desc' }, now);
  eq(week.list.length, 3);
});

t('置顶优先，其次按创建时间倒序', () => {
  const r = C.filterNotes(sample, { query: '', sort: 'created-desc' }, now);
  eq(r.list[0].id, 'c');
  eq(r.list[1].id, 'd');
  eq(r.list[2].id, 'a');
});

t('按提醒时间排序，未设提醒的排在最后', () => {
  const r = C.filterNotes(sample, { query: '', sort: 'reminder-asc' }, now);
  eq(r.list[r.list.length - 1].id, 'b');
});

t('分类统计', () => {
  const m = C.categoryCounts(sample);
  eq(m.get('工作'), 2);
  eq(m.get('购物'), 1);
});

/* ------------------------------------------------------------------ */
group('AI 层：JSON 抽取');

t('纯 JSON 直接解析', () => {
  eq(AI.extractJson('{"a":1}').a, 1);
});

t('去掉 markdown 代码围栏', () => {
  eq(AI.extractJson('```json\n{"a":2}\n```').a, 2);
});

t('前后夹着解释文字也能捞出 JSON', () => {
  const o = AI.extractJson('好的，结果如下：\n{"category":"工作"}\n希望有帮助。');
  eq(o.category, '工作');
});

t('数组也能解析', () => {
  eq(AI.extractJson('[{"text":"x"}]').length, 1);
});

t('不是 JSON 就返回 null', () => {
  eq(AI.extractJson('完全不是 JSON'), null);
  eq(AI.extractJson(''), null);
});

t('字符串里的花括号不会打断扫描', () => {
  const o = AI.extractJson('{"reason":"这里有个 } 符号","a":3}');
  eq(o.a, 3);
});

/* ------------------------------------------------------------------ */
group('AI 层：提示词');

t('分类提示词包含内容与分类清单', () => {
  const p = AI.buildCategorizePrompt('明天开客户评审会', ['工作', '生活'], 1700000000000);
  ok(p.includes('明天开客户评审会'));
  ok(p.includes('工作、生活'));
  ok(p.includes('category'));
});

t('摘要提示词要求输出 notes 数组', () => {
  const p = AI.buildSummarizePrompt('一段很长的材料……', ['工作'], Date.now());
  ok(p.includes('remind_at'));
  ok(p.includes('notes'));
});

t('时间提示词要求 ISO 8601', () => {
  const p = AI.buildTimePrompt('明天下午三点开会', Date.now());
  ok(p.includes('明天下午三点开会'));
  ok(p.includes('remind_at'));
});

t('问答提示词带便笺上下文', () => {
  const p = AI.buildAskPrompt('我这周要开什么会', AI.notesToContext([{ text: '客户评审会', category: '工作', createdAt: Date.now() }]), Date.now());
  ok(p.includes('[1]'));
  ok(p.includes('客户评审会'));
  ok(p.includes('我这周要开什么会'));
});

t('便笺上下文按 [编号] 递增，没有便笺时给出提示', () => {
  const ctx = AI.notesToContext([
    { text: '一', category: '工作' },
    { text: '二', category: '生活' },
  ]);
  ok(ctx.includes('[1]'));
  ok(ctx.includes('[2]'));
  eq(AI.notesToContext([]), '（当前没有任何便笺）');
});

t('联网整理提示词带上主题', () => {
  ok(AI.buildSearchPrompt('本地大模型部署', ['想法'], Date.now()).includes('本地大模型部署'));
});

/* ------------------------------------------------------------------ */
group('AI 层：输出解析');

t('分类结果解析', () => {
  const r = AI.parseCategorize('{"category":"工作","keywords":["客户","评审"],"reason":"会议纪要","confidence":0.9}', ['工作', '生活']);
  eq(r.category, '工作');
  eq(r.keywords.length, 2);
  eq(r.confidence, 0.9);
});

t('模型自创分类时退回「其他」而不是硬塞', () => {
  const r = AI.parseCategorize('{"category":"修仙"}', ['工作', '生活']);
  eq(r.category, '其他');
});

t('便笺列表解析（对象与裸数组都支持）', () => {
  const a = AI.parseNotes('{"notes":[{"text":"要点一","category":"工作"}]}', ['工作']);
  eq(a.length, 1);
  eq(a[0].text, '要点一');
  const b = AI.parseNotes('[{"text":"要点二","category":"生活"}]', ['工作', '生活']);
  eq(b.length, 1);
  eq(b[0].category, '生活');
});

t('便笺列表里的 remind_at 能转成时间戳', () => {
  const list = AI.parseNotes('{"notes":[{"text":"开会","remind_at":"2026-11-04T15:00:00"}]}', ['工作']);
  ok(list[0].remind_at > 0);
  eq(new Date(list[0].remind_at).getHours(), 15);
});

t('解析不出就返回空数组', () => {
  eq(AI.parseNotes('完全不是 JSON', ['工作']).length, 0);
});

t('时间建议解析', () => {
  const t = AI.parseTime('{"has_time":true,"remind_at":"2026-11-04T15:00:00","text":"明天下午三点","reason":"明确时间"}');
  eq(t.hasTime, true);
  eq(new Date(t.at).getHours(), 15);
  eq(t.text, '明天下午三点');
});

t('没有时间时 hasTime 为 false', () => {
  const t = AI.parseTime('{"has_time":false,"remind_at":"","text":"","reason":"没提到时间"}');
  eq(t.hasTime, false);
  eq(t.at, null);
});

t('问答结果解析（引用编号只留正整数）', () => {
  const a = AI.parseAnswer('{"answer":"要开客户评审会 [1]","refs":[1,0,-2,"x",3],"notes":["记得带材料"]}');
  eq(a.answer.includes('客户评审会'), true);
  eq(JSON.stringify(a.refs), '[1,3]');
  eq(a.notes.length, 1);
});

t('问答结果不是 JSON 时退回纯文本', () => {
  const a = AI.parseAnswer('就是一段普通回答');
  eq(a.answer, '就是一段普通回答');
  eq(a.refs.length, 0);
});

t('ISO 时间解析', () => {
  ok(AI.parseIsoToMs('2026-11-04T15:00:00') > 0);
  ok(AI.parseIsoToMs('2026-11-04T15:00:00+08:00') > 0);
  eq(AI.parseIsoToMs(''), null);
  eq(AI.parseIsoToMs('乱写'), null);
});

/* ------------------------------------------------------------------ */
group('AI 层：请求体');

t('API 基址规范化', () => {
  eq(AI.normalizeBase('localhost:8383'), 'http://localhost:8383');
  eq(AI.normalizeBase('http://localhost:8383/'), 'http://localhost:8383');
  eq(AI.normalizeBase(''), 'http://localhost:8383');
  eq(AI.normalizeBase('https://x.dev/api/'), 'https://x.dev/api');
});

t('请求体只带需要的旋钮，不带 reasoning_effort', () => {
  const b = AI.buildRequestBody({ prompt: 'hi', system: 's', model: 'm', maxTokens: 100, webTools: true });
  eq(b.prompt, 'hi');
  eq(b.system, 's');
  eq(b.model, 'm');
  eq(b.max_tokens, 100);
  eq(b.web_tools, true);
  eq('reasoning_effort' in b, false);
});

t('没给 model 时不带 model（用服务端默认）', () => {
  const b = AI.buildRequestBody({ prompt: 'hi' });
  eq('model' in b, false);
});

t('思考强度阶梯：自动 → 先 none 再逐级放开', () => {
  eq(JSON.stringify(AI.effortLadder('auto')), JSON.stringify(['none', 'minimal', 'low', null]));
});

t('思考强度阶梯：指定档位时只用那一档', () => {
  eq(JSON.stringify(AI.effortLadder('none')), JSON.stringify(['none']));
  eq(JSON.stringify(AI.effortLadder('full')), JSON.stringify([null]));
});

t('明确指定思考强度时才带上 reasoning_effort', () => {
  const b = AI.buildRequestBody({ prompt: 'hi', reasoningEffort: 'none' });
  eq(b.reasoning_effort, 'none');
});

/* ------------------------------------------------------------------ */
console.log('\n' + '─'.repeat(46));
if (failures.length) {
  console.log(`✗ ${pass} 项通过，${failures.length} 项失败`);
  failures.forEach((f) => console.log('   · ' + f));
  process.exit(1);
}
console.log(`✓ 全部 ${pass} 项断言通过`);
