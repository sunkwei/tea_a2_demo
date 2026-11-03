/**
 * 便笺 · AI 联调（打真实的 tea_a2 接口）
 *
 *   node sticky-notes/tools/ai-check.mjs            # 不含联网搜索
 *   node sticky-notes/tools/ai-check.mjs --search   # 额外跑一次联网整理（会联网、按次计费）
 *
 * 接口没起来时跳过并退出码 0（属于环境问题，不是代码问题）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(HERE, '../src/ai.js'), 'utf8');
// eslint-disable-next-line no-new-func
new Function(src)();
const AI = globalThis.StickyAI;

const BASE = process.env.STICKY_AI_BASE || AI.DEFAULT_BASE;
const WITH_SEARCH = process.argv.includes('--search');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log('  ✓ ' + name + (detail ? '  ' + detail : ''));
  } else {
    failures.push(name + (detail ? '  ' + detail : ''));
    console.log('  ✗ ' + name + (detail ? '  ' + detail : ''));
  }
}
function group(n) {
  console.log('\n' + n);
}

const CATEGORIES = ['私密', '待办', '财务', '工作', '学习', '健康', '购物', '旅行', '想法', '生活', '其他'];

async function chat(prompt, extra) {
  return AI.chat(Object.assign({ base: BASE, prompt, timeoutMs: 90000 }, extra || {}));
}

async function main() {
  group('连通性');
  const conn = await AI.testConnection(BASE);
  if (!conn.ok) {
    console.log('  ⚠ ' + conn.error + '（跳过 AI 联调；这是环境问题，不是代码问题）');
    process.exit(0);
  }
  check('tea_a2 可达', true, `${conn.base} v${conn.version}`);
  check('能拿到模型清单', conn.models.length > 0, conn.models.map((m) => m.provider + '/' + m.model).join('、'));

  group('AI 归类');
  try {
    const r = await chat(AI.buildCategorizePrompt('明天下午要跟客户开需求评审会，顺便确认报价', CATEGORIES, Date.now()));
    const p = AI.parseCategorize(r.content, CATEGORIES);
    check('能解析出分类结果', !!p, p ? `${p.category}（${p.keywords.join('、')}）` : r.content.slice(0, 120));
    if (p) {
      check('分类在允许的清单内', CATEGORIES.includes(p.category), p.category);
      check('会议类内容归到「工作」', p.category === '工作', p.category);
      check('给出了关键词', p.keywords.length > 0, p.keywords.join('、'));
    }
  } catch (e) {
    check('AI 归类请求成功', false, e.message);
  }

  group('AI 时间抽取');
  try {
    const r = await chat(AI.buildTimePrompt('明天下午三点提醒我给客户发合同', Date.now()));
    const t = AI.parseTime(r.content);
    check('能解析出时间建议', !!t, t ? `${t.text} → ${t.at ? new Date(t.at).toLocaleString('zh-CN') : '无'}` : r.content.slice(0, 120));
    if (t) {
      check('判定为有明确时间', t.hasTime === true);
      check('时间在未来 3 天内', t.at && t.at > Date.now() && t.at < Date.now() + 3 * 86400000, t.at ? new Date(t.at).toLocaleString('zh-CN') : '');
    }
  } catch (e) {
    check('AI 时间请求成功', false, e.message);
  }

  group('AI 长文拆条');
  try {
    const material = [
      '周会纪要 2026-11-02',
      '1. 需求评审改到周四上午十点，会议室 3 楼，需要提前准备 PPT。',
      '2. 报价单由商务同学出，本周内给到客户。',
      '3. 客户希望下个月上线，需要排期表。',
      '4. 下周三之前把测试环境准备好。',
    ].join('\n');
    const r = await chat(AI.buildSummarizePrompt(material, CATEGORIES, Date.now()));
    const list = AI.parseNotes(r.content, CATEGORIES);
    check('能解析出要点列表', list.length > 0, `${list.length} 条`);
    check('要点条数合理（1-10 条）', list.length >= 1 && list.length <= 10, String(list.length));
    if (list.length) {
      check('每条都有内容', list.every((n) => n.text && n.text.length > 2));
      check('分类都合法', list.every((n) => CATEGORIES.includes(n.category)), list.map((n) => n.category).join('、'));
      check('抽到了至少一个提醒时间', list.some((n) => n.remind_at > 0), list.filter((n) => n.remind_at).map((n) => new Date(n.remind_at).toLocaleString('zh-CN')).join(' | '));
    }
  } catch (e) {
    check('AI 拆条请求成功', false, e.message);
  }

  group('AI 问答（基于本机便笺）');
  try {
    const notes = [
      { text: '周四上午十点和客户开需求评审会，会议室 3 楼', category: '工作', createdAt: Date.now() },
      { text: '买牛奶和鸡蛋', category: '购物', createdAt: Date.now() },
    ];
    const r = await chat(AI.buildAskPrompt('我这周有哪些会议？在哪开？', AI.notesToContext(notes), Date.now()));
    const a = AI.parseAnswer(r.content);
    check('能解析出回答', !!a && a.answer.length > 0, a ? a.answer.slice(0, 80) : r.content.slice(0, 120));
    if (a) {
      check('引用了便笺编号', a.refs.includes(1), JSON.stringify(a.refs));
      check('回答提到了会议', /评审|会议|十点|10:00/.test(a.answer), a.answer.slice(0, 80));
    }
  } catch (e) {
    check('AI 问答请求成功', false, e.message);
  }

  if (WITH_SEARCH) {
    group('AI 联网整理（web_tools，会联网计费）');
    try {
      const r = await chat(AI.buildSearchPrompt('浏览器 localStorage 的容量限制', CATEGORIES, Date.now()), {
        webTools: true,
      });
      const list = AI.parseNotes(r.content, CATEGORIES);
      check('联网后能解析出要点', list.length > 0, `${list.length} 条`);
      check('有联网工具调用记录', (r.web_tool_calls || []).length > 0, `${(r.web_tool_calls || []).length} 次`);
      if (list.length) check('来源链接非空', list.some((n) => n.source), list.map((n) => n.source).join(' | ').slice(0, 100));
    } catch (e) {
      check('联网整理请求成功', false, e.message);
    }
  } else {
    console.log('\n（跳过联网整理：加 --search 参数可跑，会联网并按次计费）');
  }

  console.log('\n' + '─'.repeat(52));
  if (failures.length) {
    console.log(`✗ ${pass} 项通过，${failures.length} 项失败`);
    failures.forEach((f) => console.log('   · ' + f));
    process.exit(1);
  }
  console.log(`✓ 全部 ${pass} 项通过（接口：${BASE}）`);
}

main().catch((e) => {
  console.error('✗ AI 联调出错：' + (e.message || e));
  process.exit(1);
});
