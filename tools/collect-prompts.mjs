// tools/collect-prompts.mjs —— 把「用户输入」归档成每个项目的一部分
//
//   npm run prompts:build      （= node tools/collect-prompts.mjs [--dry-run]）
//
// 输入：.tea_agent_run/sessions/*.json（本工作区的会话记录，不入库）
// 输出：
//   <项目>/PROMPT.md   该项目自己的用户输入（原始需求 + 后续调整，按时间顺序）
//   docs/PROMPTS.md    全仓库总索引：谁有留档、谁没有、仓库级输入、过滤规则
//
// 过滤原则：只留「有信息量的输入」。纯确认（继续 / 嗯 / 好的）、纯夸奖（不错 / 很好）、
// 纯提交指令（提交,推送）、工具回填的系统消息（Images loaded by …）、
// 以及一句话都匹配不到任何项目的闲聊，全部丢掉；长日志只留前几行。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SESSIONS = path.join(ROOT, '.tea_agent_run/sessions');
const DRY = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');

// ── 项目表 ────────────────────────────────────────────────────────────────
// keys：归类关键词（小写）；origin：'local' = 这台机器上用 tea_a2 做出来的，
//       'imported' = 从别处搬进来的（本机没有它的创建提示词，最多只有搬进来之后的改动输入）。
// origin 依据 git 首次入库的提交，写在 from 里，方便日后核对。
const PROJECTS = [
  { dir: 'bilibili', name: '📺 B 站 digest', origin: 'imported', from: '2026-11-04 `feat(bili/zhihu): …搬进这个仓库`',
    keys: ['bilibili', 'bili.py', 'bv1', 'b站', '稍后观看', '稍后再看', '字幕', 'asr', 'sensevoice'] },
  { dir: 'zhihu', name: '📚 知乎 digest', origin: 'imported', from: '2026-11-04 `feat(bili/zhihu): …搬进这个仓库`',
    keys: ['zhihu', '知乎'] },
  { dir: 'tea-select', name: '🦊 tea_a2 划词助手', origin: 'local', from: '2026-11-03 `feat(tea-select): Firefox 划词扩展`',
    keys: ['tea-select', '划词', 'firefox', 'addon', '识图'] },
  { dir: 'pottery', name: '🏺 中国陶器史', origin: 'local', from: '2026-11-22 `feat(pottery): 新增「中国陶器史」`',
    keys: ['pottery', '陶器'] },
  { dir: 'meow-mart', name: '🐱 喵屋便利店', origin: 'imported', from: '2026-11-02 `feat: 提交 demo 全部代码`（随首批 `src/` 入库）',
    keys: ['喵屋', 'meow-mart', 'meow mart'] },
  { dir: 'tcm-herb', name: '🌿 中药大全', origin: 'local', from: '2026-11-21 `feat(tcm-herb): 新增「中药大全」`',
    keys: ['tcm', '中药', '药材'] },
  { dir: 'sticky-notes', name: '📌 便笺', origin: 'local', from: '2026-11-03 `feat(sticky-notes)`',
    keys: ['便笺', 'sticky'] },
  { dir: 'snake-race', name: '🐍 贪吃蛇竞赛', origin: 'imported', from: '2026-11-02 `feat: 提交 demo 全部代码`',
    keys: ['贪吃蛇', 'snake-race', 'snake arena'] },
  { dir: 'attention-film', name: '🎬 Self-Attention 短片', origin: 'imported', from: '2026-11-02 `feat: 提交 demo 全部代码`',
    keys: ['attention', '自注意力', '短片'] },
  { dir: 'iptv-player', name: '📺 IPTV 剧场', origin: 'imported', from: '2026-11-02 `feat: 提交 demo 全部代码`',
    keys: ['iptv', '直播源'] },
  { dir: 'rubiks-cube', name: '🧊 三阶魔方教程', origin: 'local', from: '2026-11-06 `feat(rubiks-cube)`',
    keys: ['魔方', 'rubik'] },
  { dir: 'endfield-ship', name: '🚀 终末地 · 舰桥观测舱', origin: 'local', from: '2026-11-17 `feat(endfield-ship)`',
    keys: ['终末地', 'endfield', '舰桥'] },
  { dir: 'ai-town', name: '🏘️ AI 小镇', origin: 'local', from: '2026-11-03 `feat(ai-town)`',
    keys: ['ai 小镇', 'ai-town', 'ai小镇'] },
  { dir: 'sanguosha-ai', name: '⚔️ AI 三国杀', origin: 'local', from: '2026-11-05 `feat(sanguosha-ai)`',
    keys: ['三国杀', 'sanguosha'] },
  { dir: 'video_analysis', name: '📼 本地视频分析', origin: 'local', from: '2026-11-08 `feat(video-analysis)`',
    keys: ['video_analysis', '视频分析', '抽帧'] },
  { dir: 'GoDot', name: '🎮 GoDot · 三国肉鸽', origin: 'imported', from: '2026-11-02 `feat: 提交 demo 全部代码`',
    keys: ['godot'] },
  { dir: 'zhanqiao', name: '🏗️ 青岛栈桥建模', origin: 'local', from: '2026-11-04 `feat(zhanqiao)`',
    keys: ['栈桥', 'zhanqiao'] },
];

// 仓库级：这些消息讲的是整个 a2_demo（索引、README、目录结构…），不归属某个子项目
const REPO_KEYS = ['a2_demo', 'a2 demo', '仓库', 'readme', '索引', '根目录', '项目总览', '子项目', '每个项目'];

// 纯确认 / 纯夸奖 / 纯提交，正常化（去空白与标点、转小写）后整句比对
const ACK = new Set([
  '继续', '继续吧', '嗯', '嗯嗯', '嗯嗯嗯', '好', '好的', '好啊', '好吧', '行', '可以', '可以了', '收到', '明白',
  '没问题', '对', '是的', 'ok', 'okay', 'ok了', '提交', '推送', '提交推送', '推送提交', '合并', '提交合并',
  '提交并推送', '这些不需要', '不需要', '不用了', '来吧', '不错', '很好', '太棒', '完美', '谢谢', '感谢', '好棒', '真棒',
]);

const SPLIT_CAP = /([，,、；;\n]+)/;      // 分句并保留分隔符（句号不切，避免把一句话拆散）
const PUNCT = /[\s，,。、；;：:！!？?…·~～"'“”‘’（）()【】\[\]]/g;
const norm = (s) => s.replace(PUNCT, '').toLowerCase();

const isAck = (clause) => {
  const n = norm(clause);
  if (!n) return true;
  if (ACK.has(n)) return true;
  // 「不错，继续」「好的，继续做」这种整句都是套话
  const parts = clause.split(/[，,、；;\n]+/).map(norm).filter(Boolean);
  return parts.length > 0 && parts.every((p) => ACK.has(p));
};

const isToolNoise = (text) =>
  /^Images loaded by toolkit_load_image/i.test(text) ||
  /^\(toolkit_load_image: per-turn image limit/i.test(text) ||
  /^\[shell: /i.test(text);

const fmtTime = (iso) => {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso || '');
  return m ? { day: m[1], hm: m[2] } : { day: '', hm: '' };
};

/** 从一条用户消息里剔除无效分句，返回清洗后的文本（可能为空） */
function cleanInput(raw) {
  let text = String(raw).replace(/\r\n/g, '\n').trim();
  if (!text || isToolNoise(text)) return '';

  // 用户粘贴的长日志：只留前 8 行
  const lines = text.split('\n');
  if (lines.length > 10) {
    const clip = (l) => (l.length > 200 ? l.slice(0, 200) + ' …' : l);
    const head = lines.slice(0, 8).map(clip).join('\n');
    text = `${head}\n…（粘贴内容后略，原 ${lines.length} 行）`;
    return text; // 日志不是套话，不再分句清洗
  }

  // 分句时带分隔符一起切，只删掉无效分句，其余分隔符原样保留
  const parts = text.split(SPLIT_CAP);
  let out = '';
  let sepBefore = '';
  for (let i = 0; i < parts.length; i += 2) {
    const clause = (parts[i] || '').trim();
    const sep = parts[i + 1] || '';
    if (!clause || isAck(clause)) continue;
    if (out) out += sepBefore || '，';
    out += clause;
    sepBefore = sep;
  }
  return out;
}

function classify(text) {
  const low = text.toLowerCase();
  // 先看具体项目，再看仓库级；都没命中就丢弃（一次性问答之类）
  let best = null;
  let bestHits = 0;
  for (const p of PROJECTS) {
    const hits = p.keys.filter((k) => low.includes(k)).length;
    if (hits > bestHits) {
      best = p;
      bestHits = hits;
    }
  }
  if (best) return best.dir;
  if (REPO_KEYS.some((k) => low.includes(k))) return '__repo__';
  return null;
}

// ── 读会话 ────────────────────────────────────────────────────────────────
const entries = []; // { project, session, day, hm, text }
const stats = { sessions: 0, raw: 0, dropped: 0, kept: 0 };
const dropLog = []; // --verbose 时打印，方便核查过滤规则有没有误杀

if (fs.existsSync(SESSIONS)) {
  const files = fs.readdirSync(SESSIONS).filter((f) => f.startsWith('s_') && f.endsWith('.json')).sort();
  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(SESSIONS, file), 'utf8'));
    const id = data.id || file.replace(/\.json$/, '');
    const title = (data.title || '').trim();
    const createdAt = data.created_at || '';
    const messages = data.messages || [];
    stats.sessions++;

    let last = '';
    let current = null; // 本会话最近一次命中的项目：没关键词的后续输入跟着上下文走
    for (const m of messages) {
      if (m.role !== 'user') continue;
      let raw = m.content;
      if (Array.isArray(raw)) {
        raw = raw.map((c) => (typeof c === 'object' && c ? c.text || '' : String(c))).join('\n');
      }
      raw = String(raw || '');
      if (!raw.trim() || isToolNoise(raw.trim())) {
        stats.raw++;
        stats.dropped++;
        dropLog.push({ text: raw.trim(), reason: '工具消息' });
        continue;
      }
      stats.raw++;
      const text = cleanInput(raw);
      if (!text) {
        stats.dropped++;
        dropLog.push({ text: raw.trim(), reason: '整条都是套话' });
        continue;
      }
      let project = classify(text);
      if (!project) project = current; // 例如「图片点击放大有问题」——项目名没出现，但上下文还是它
      if (!project) {
        stats.dropped++;
        dropLog.push({ text: raw.trim(), reason: '归不到任何项目' });
        continue;
      }
      current = project;
      if (text === last) {
        stats.dropped++;
        dropLog.push({ text: raw.trim(), reason: '与上一条重复' });
        continue;
      }
      last = text;
      const { day, hm } = fmtTime(m.ts || m.timestamp || m.created_at || createdAt);
      entries.push({ project, session: { id, title, day: day || (createdAt || '').slice(0, 10), createdAt }, day, hm, text });
      stats.kept++;
    }
  }
}

// ── 写 <项目>/PROMPT.md ──────────────────────────────────────────────────
const byProject = new Map();
for (const e of entries) {
  if (!byProject.has(e.project)) byProject.set(e.project, []);
  byProject.get(e.project).push(e);
}

const indent = (text) => text.split('\n').map((l) => `   ${l}`).join('\n');

function renderProjectPrompt(project) {
  const list = byProject.get(project.dir) || [];
  const bySession = new Map();
  for (const e of list) {
    if (!bySession.has(e.session.id)) bySession.set(e.session.id, { session: e.session, items: [] });
    bySession.get(e.session.id).items.push(e);
  }
  const lines = [];
  lines.push('# 🧾 用户输入（原始需求）', '');
  if (project.origin === 'local') {
    lines.push('> 本项目是**这台机器上用 [tea_a2](https://github.com/sunkwei/tea_a2) 从头做出来的**。');
    lines.push('> 下面是把它做出来、以及后来改动它的**用户输入原文**，按时间顺序摘自本工作区的会话记录（`.tea_agent_run/sessions/`）。');
  } else {
    lines.push('> ⚠️ 本项目**不是在本机创建的**，是搬进本仓库的（' + project.from + '）。');
    lines.push('> 本机没有「创建它的提示词」，下面只是**搬进来之后在本机改动它**的用户输入原文，');
    lines.push('> 按时间顺序摘自本工作区的会话记录（`.tea_agent_run/sessions/`）。');
  }
  lines.push('> 已剔除「继续」「嗯」「提交,推送」这类没有信息量的指令、纯夸奖和工具回填的系统消息，');
  lines.push('> 保留的句子未改动措辞。全仓库的收录情况见 [`docs/PROMPTS.md`](../docs/PROMPTS.md)。', '');
  lines.push(`项目目录：\`${project.dir}/\` · 来源：${project.origin === 'local' ? '本机创建' : '外部引入'} · ` +
    `收录 **${list.length}** 条输入 · 来自 **${bySession.size}** 个会话`, '');
  const groups = [...bySession.values()].sort((a, b) => a.session.createdAt.localeCompare(b.session.createdAt));
  for (const { session, items } of groups) {
    lines.push('---', '');
    lines.push(`## ${session.day} · ${session.title || '（无标题会话）'}`, '');
    lines.push(`<sub>会话 \`${session.id}\`</sub>`, '');
    let i = 1;
    for (const it of items) {
      lines.push(`${i}. ${it.hm ? `**${it.hm}** ` : ''}${indent(it.text).trimStart()}`);
      if (it.text.includes('\n')) lines.push('');
      i++;
    }
    lines.push('');
  }
  lines.push('---', '');
  lines.push('<sub>想补充更早的输入？把原文追加到本文件，或改 `tools/collect-prompts.mjs` 后重跑 `npm run prompts:build`。</sub>', '');
  return lines.join('\n');
}

const written = [];
for (const project of PROJECTS) {
  const list = byProject.get(project.dir) || [];
  if (!list.length) continue;
  const file = path.join(ROOT, project.dir, 'PROMPT.md');
  const content = renderProjectPrompt(project);
  if (!DRY) fs.writeFileSync(file, content, 'utf8');
  written.push({ dir: project.dir, name: project.name, count: list.length, sessions: new Set(list.map((e) => e.session.id)).size });
}

// ── 写 docs/PROMPTS.md ──────────────────────────────────────────────────
// 三类项目分开写清楚：本机创建且留档 / 本机创建但会话已清理 / 外部引入（本机没有创建提示词）
const repoInputs = entries.filter((e) => e.project === '__repo__');
const local = PROJECTS.filter((p) => p.origin === 'local');
const imported = PROJECTS.filter((p) => p.origin === 'imported');
const localDone = local.filter((p) => (byProject.get(p.dir) || []).length);
const localMissing = local.filter((p) => !(byProject.get(p.dir) || []).length);
const importedDone = imported.filter((p) => (byProject.get(p.dir) || []).length);

const rows = PROJECTS.map((p) => {
  const w = written.find((x) => x.dir === p.dir);
  const cell = w ? `[\`${p.dir}/PROMPT.md\`](../${p.dir}/PROMPT.md)` : '—';
  const origin = p.origin === 'local' ? '本机创建' : '外部引入';
  return `| ${p.name} | \`${p.dir}/\` | ${origin} | ${cell} | ${w ? w.count : 0} | ${w ? w.sessions : 0} |`;
}).join('\n');

const bullet = (list, withFrom) =>
  list.map((p) => `- ${p.name}（\`${p.dir}/\`）${withFrom ? ' —— ' + p.from : ''}`).join('\n');

const promptIndex = [
  '# 🧾 用户输入归档（PROMPT）',
  '',
  '本仓库里**本机创建**的项目，都是 tea_a2 按用户一段段输入做出来的；',
  '每个项目目录下的 **`PROMPT.md`** 存着它自己那份输入，不放在别处、也不靠回忆。',
  '',
  '有几种情况要分清：',
  '',
  '- **本机创建 + 有留档**：创建与后续改动的输入都在，`PROMPT.md` 是完整的；',
  '- **本机创建 + 会话已清理**：项目确实是在这台机器上做的，但当时的会话记录被轮转掉了，只能补录；',
  '- **外部引入**：项目不是在本机创建的（随某次提交搬进仓库），**本机根本没有「创建它的提示词」**；',
  `  这类项目不承诺有 \`PROMPT.md\`，即便有，也只记搬进来之后在本机的改动。`,
  '',
  `> 生成方式：\`npm run prompts:build\`（[\`tools/collect-prompts.mjs\`](../tools/collect-prompts.mjs)），` +
    `从 \`.tea_agent_run/sessions/\` 的会话记录里抽取、过滤、按项目归档。`,
  '',
  '## 收录情况',
  '',
  '| 项目 | 目录 | 来源 | 输入归档 | 条数 | 会话 |',
  '|------|------|------|---------|-----:|-----:|',
  rows,
  '',
  '## 外部引入的项目（本机没有创建提示词）',
  '',
  '这些项目随早期提交搬进仓库，创建过程不在这台机器上，下面标了它首次入库的提交：',
  '',
  bullet(imported, true),
  '',
  importedDone.length
    ? `其中 ${importedDone.map((p) => `\`${p.dir}/\``).join('、')} 在本机做过改动，所以有 \`PROMPT.md\`，` +
      '但文件开头写明了「只含搬进来之后的改动」——别把它当成原始需求。'
    : '它们都没有本机改动记录，因此也都没有 `PROMPT.md`。',
  '',
  '## 本机创建、但会话已清理的项目',
  '',
  '这些项目确实是在这台机器上做出来的，但 `.tea_agent_run/sessions/` 只留了本工作区的一部分会话',
  '（2026-11-08 起的几次；另有项目是在别的 workspace 里做的，记录不在这个目录），所以现在抽不到输入：',
  '',
  bullet(localMissing, true),
  '',
  '补录办法：把当时的输入原文写进 `<项目>/PROMPT.md`（格式照抄已有文件），或补进 `tools/collect-prompts.mjs` 的解析逻辑后重跑。',
  '',
  '## 仓库级输入',
  '',
  '讲整个 a2_demo（目录结构、README、索引页）而不是某个子项目的输入，记在这里：',
  '',
  ...repoInputs.map((e, i) => `${i + 1}. ${e.day} — ${indent(e.text).trimStart()}`),
  '',
  '## 过滤规则（哪些输入不算数）',
  '',
  '- **纯确认 / 纯提交指令**：`继续`、`嗯`、`好的`、`可以`、`提交,推送`、`提交 推送`、`合并` —— 对整个分句直接丢弃；',
  '  一句话里混着有效内容时按分句剔除，例如 `不错, 提交, 推送` 整条丢掉，`将 xxx.zip 加入 git, 提交, 推送` 只留前半句。',
  '- **纯夸奖**：`不错`、`很好`、`完美` 之类，没有可执行信息。',
  '- **工具回填的系统消息**：`Images loaded by toolkit_load_image …`、`[shell: …]` 这类不是用户说的话。',
  '- **无归属的闲聊 / 一次性问答**：例如「这张图里写的是什么？只回答图片里的文字」——既没提项目也没提仓库。',
  '- **超长粘贴**：用户贴的日志只留前 8 行，其余标「后略」，避免把整段报错塞进项目文档。',
  '',
  '一句话同时提到项目和仓库时，归到它**具体动到的项目**（例如「将 喵屋便利店 移到子目录，重排 README」落在 `meow-mart/PROMPT.md`）；',
  '没提任何项目名、但接着同一会话往下说的（例如「图片点击放大有问题」），按上下文归到当前项目。',
  '',
  `统计：扫描 ${stats.sessions} 个会话、${stats.raw} 条用户消息，收录 ${stats.kept} 条，丢弃 ${stats.dropped} 条。`,
  '',
].join('\n');

if (!entries.length) {
  console.error('❌ 一条输入都没抽到（会话记录被清理了？），不覆盖已有 PROMPT.md / docs/PROMPTS.md');
  process.exit(1);
}
if (!DRY) fs.writeFileSync(path.join(ROOT, 'docs/PROMPTS.md'), promptIndex, 'utf8');

console.log(`扫描 ${stats.sessions} 个会话 / ${stats.raw} 条用户消息 → 收录 ${stats.kept} 条，丢弃 ${stats.dropped} 条`);
for (const w of written) console.log(`  ✅ ${w.dir}/PROMPT.md  ${w.count} 条 / ${w.sessions} 个会话`);
console.log(`  📇 docs/PROMPTS.md （仓库级输入 ${repoInputs.length} 条；` +
  `本机创建未留档 ${localMissing.length} 个；外部引入 ${imported.length} 个，其中 ${importedDone.length} 个只有本地改动输入）`);
if (VERBOSE) {
  console.log('\n丢弃明细：');
  for (const d of dropLog) console.log(`  ✗ [${d.reason}] ${d.text.replace(/\s+/g, ' ').slice(0, 90)}`);
}
if (DRY) console.log('（--dry-run：没有写文件）');
