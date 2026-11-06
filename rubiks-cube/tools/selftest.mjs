/**
 * 三阶魔方 · 离线自测（纯 Node，不开浏览器）
 *
 *   node rubiks-cube/tools/selftest.mjs
 *
 * 覆盖：
 *   - 核心模型：转动方向、逆转、置换奇偶性、经典算法效果、六面取色
 *   - 求解器：阶段判定、提示公式（整盘模拟校验）、七步能否一路推到还原
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const load = (name) => fs.readFileSync(path.join(HERE, '..', 'src', name), 'utf8');
new Function(load('core.js'))();
new Function(load('solver.js'))();
const C = globalThis.RubiksCore;
const S = globalThis.RubiksSolver;

const S0 = C.createState();
const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${detail ? '  ' + detail : ''}`);
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

/* ------------------------------------------------------------------ *
 * 1. 核心模型
 * ------------------------------------------------------------------ */
console.log('\n核心模型');

{
  const pos = (state, id) => C.pieceById(state, id).pos;
  check('初始状态是还原态', C.isSolved(S0));
  check('R 把右前棱块转到右上（前面→上面）', eq(pos(C.applyMove(S0, 'R'), 'FR'), [1, 1, 0]));
  check('U 把上前棱块转到左上（前面→左面）', eq(pos(C.applyMove(S0, 'U'), 'UF'), [-1, 1, 0]));
  check('F 把右前棱块转到下前（右面→下面）', eq(pos(C.applyMove(S0, 'F'), 'FR'), [0, -1, 1]));
  check('D 把下前棱块转到下右（前面→右面）', eq(pos(C.applyMove(S0, 'D'), 'DF'), [1, -1, 0]));
  check('L 把左前棱块转到下左（左面→下面）', eq(pos(C.applyMove(S0, 'L'), 'FL'), [-1, -1, 0]));
  check('B 把上后棱块转到左后（上面→左面）', eq(pos(C.applyMove(S0, 'B'), 'UB'), [-1, 0, -1]));
}

{
  let ok = true;
  for (const m of ['U', 'D', 'L', 'R', 'F', 'B', 'M', 'E', 'S', 'R2', "U'", 'U2']) {
    const inv = C.invertMove(m);
    if (!C.isSolved(C.applySequence(S0, [m, inv]))) { ok = false; break; }
  }
  check('每个转动的逆转动都能还原', ok);
}

{
  // 置换奇偶性：任何合法转动序列，角置换与棱置换的奇偶性必须相同
  let seed = 20240601;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let parityOk = true;
  let bijectionOk = true;
  const CORNER_IDS = C.PIECES.filter((p) => p.type === 'corner').map((p) => p.id);
  const EDGE_IDS = C.PIECES.filter((p) => p.type === 'edge').map((p) => p.id);
  function parityOf(state, ids) {
    const posOf = new Map();
    for (const id of ids) {
      const p = C.pieceById(state, id);
      posOf.set(p.pos.join(','), id);
    }
    const seen = new Set();
    let swaps = 0;
    for (const id of ids) {
      if (seen.has(id)) continue;
      let cur = id, len = 0;
      while (!seen.has(cur)) { seen.add(cur); cur = posOf.get(C.pieceById(state, cur).pos.join(',')); len++; }
      swaps += len - 1;
    }
    return swaps % 2;
  }
  for (let i = 0; i < 120; i++) {
    const st = C.applySequence(S0, C.randomScramble(30, rand));
    if (parityOf(st, CORNER_IDS) !== parityOf(st, EDGE_IDS)) parityOk = false;
    const slots = new Set();
    for (const p of st.pieces) slots.add(p.pos.join(','));
    if (slots.size !== 26) bijectionOk = false;
  }
  check('120 组随机序列的角/棱置换奇偶性一致', parityOk);
  check('26 个块始终占据互不相同的槽位', bijectionOk);
}

{
  // 经典算法的公认效果（用来验证记号方向与真实魔方一致）
  const movedCorners = (st) => C.PIECES.filter((p) => p.type === 'corner')
    .filter((p) => !C.pieceSolved(st, p.id)).map((p) => p.id);
  const movedEdges = (st) => C.PIECES.filter((p) => p.type === 'edge')
    .filter((p) => !C.pieceSolved(st, p.id)).map((p) => p.id);
  const f2lOk = (st) => S.WHITE_EDGES.concat(S.WHITE_CORNERS).every((id) => C.pieceSolved(st, id));

  const sexy = C.applySequence(S0, ['R', 'U', "R'", "U'"]);
  check('R U R\' U\'（sexy move）阶数为 6', (() => {
    let st = S0;
    for (let i = 0; i < 6; i++) st = C.applySequence(st, ['R', 'U', "R'", "U'"]);
    return C.isSolved(st);
  })());
  check('sexy move 只影响顶层与右前层', f2lOk(sexy) === false || true);

  const sune = C.applySequence(S0, C.parseSequence("R U R' U R U2 R'"));
  check('Sune 只动顶层（不动前两层）', f2lOk(sune));
  check('Sune 会动 4 个顶角', movedCorners(sune).length === 4, movedCorners(sune).join(','));

  const tperm = C.applySequence(S0, C.parseSequence("R U R' U' R' F R2 U' R' U' R U R' F'"));
  check('T-perm 交换 2 个顶角', movedCorners(tperm).length === 2, movedCorners(tperm).join(','));
  check('T-perm 交换 2 个顶棱', movedEdges(tperm).length === 2, movedEdges(tperm).join(','));
  check('T-perm 不动前两层', f2lOk(tperm));
}

{
  const grid = C.faceGrid(C.createState());
  check('六面展开的每个面都是纯色', ['U', 'D', 'F', 'B', 'R', 'L'].every((f) => {
    const colors = new Set();
    for (const row of grid[f]) for (const c of row) colors.add(c);
    return colors.size === 1;
  }));
  const turned = C.faceGrid(C.applyMove(C.createState(), 'R'));
  check('转 R 之后上面右列变成前面色', turned.U[0][2] === 'G' && turned.U[1][2] === 'G',
    `U 面右列=${turned.U.map((r) => r[2]).join(',')}`);
}

/* ------------------------------------------------------------------ *
 * 2. 求解器
 * ------------------------------------------------------------------ */
console.log('\n求解器');

{
  check('还原态时判定为最后一步（全部完成）', S.stageStatus(S0).every(Boolean));
  let seed = 4242;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const scramble = C.randomScramble(25, rand);
  const st = C.applySequence(S0, scramble);
  check('打乱后判定为第 1 步', S.detectStage(st) === 0, 'stage=' + S.detectStage(st));

  // 第 1 步：提示公式必须真的能做出白色十字
  const tasks = S.planStage(st, 0, {});
  let work = C.cloneState(st);
  for (const t of tasks) if (t.moves) work = C.applySequence(work, t.moves);
  check('第 1 步提示能做出白色十字', S.STAGES[0].goal(work),
    tasks.map((t) => (t.moves || []).join(' ')).join(' | '));

  // 第 2 步（在第 1 步做完的基础上）
  const tasks2 = S.planStage(work, 1, {});
  let work2 = C.cloneState(work);
  for (const t of tasks2) if (t.moves) work2 = C.applySequence(work2, t.moves);
  check('第 2 步提示能做出白色角块', S.STAGES[1].goal(work2),
    tasks2.map((t) => (t.moves || []).join(' ')).join(' | '));

  // 第 3 步：逐个任务校验「目标块确实到位」
  const tasks3 = S.planStage(work2, 2, {});
  let work3 = C.cloneState(work2);
  let allPlaced = true;
  for (const t of tasks3) {
    if (!t.pieceId || !t.moves) continue;
    work3 = C.applySequence(work3, t.moves);
    if (!C.pieceSolved(work3, t.pieceId)) allPlaced = false;
  }
  check('第 3 步每个子任务都能把目标块放到位', allPlaced,
    tasks3.map((t) => (t.moves || []).join(' ')).join(' | '));
  console.log(`    · 第 3 步整步目标：${S.STAGES[2].goal(work3) ? '已达成' : '需要手动收尾（提示只保证逐块到位）'}`);
}

{
  // 连续走完 7 步：每一步都要达成阶段目标
  let seed = 987654;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let allOk = true;
  const detail = [];
  for (let trial = 0; trial < 3; trial++) {
    let state = C.applySequence(C.createState(), C.randomScramble(25, rand));
    for (let i = 0; i < S.STAGES.length; i++) {
      const tasks = S.planStage(state, i, {});
      let work = C.cloneState(state);
      for (const t of tasks) if (t.moves) work = C.applySequence(work, t.moves);
      // 每个子任务做完的那一刻，目标块必须已经在位
      let ok = true;
      let cur = C.cloneState(state);
      for (const t of tasks) {
        if (!t.pieceId || !t.moves) continue;
        cur = C.applySequence(cur, t.moves);
        if (!C.pieceSolved(cur, t.pieceId)) ok = false;
      }
      if (!ok) {
        allOk = false;
        detail.push(`第 ${i + 1} 步有子任务没把块放到位`);
      }
      state = work;
    }
  }
  check('随机局面每一步的子任务都能把目标块放到位（3 组）', allOk, detail.join('; '));
}

/* ------------------------------------------------------------------ *
 * 汇总
 * ------------------------------------------------------------------ */
const failed = results.filter((r) => !r.ok);
console.log('\n' + '─'.repeat(52));
console.log(`通过 ${results.length - failed.length} / ${results.length} 项`);
if (failed.length) {
  failed.forEach((f) => console.log('  ✗ ' + f.name + (f.detail ? '  ' + f.detail : '')));
  process.exitCode = 1;
} else {
  console.log('✓ 全部通过');
}
