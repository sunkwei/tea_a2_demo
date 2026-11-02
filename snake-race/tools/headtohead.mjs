/**
 * 一对一擂台：每种自研算法 vs 随机避障，统计胜率与压制强度
 * 用法： node snake-race/tools/headtohead.mjs [每组对局数]
 */

import { createGame } from '../src/engine.js';
import { runTick, TICK_BUDGET_MS } from '../src/runner.js';
import { STRATEGIES } from '../src/ai/bots.js';

const games = Number(process.argv[2] || 150);
const maxTicks = 4000;
const COLORS = ['#4ade80', '#f472b6'];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 跑完一局，返回胜者、终局长度与各蛇战绩 */
function play(strategies, seed) {
  const game = createGame({
    width: 32,
    height: 20,
    seed,
    maxTicks,
    snakes: strategies.map((sid, i) => ({ id: i, name: sid, color: COLORS[i], strategy: sid })),
  });
  let maxTick = 0;
  while (game.status === 'running') {
    const r = runTick(game);
    if (r.total > maxTick) maxTick = r.total;
  }
  const winner = game.snakes.find((s) => s.id === game.winnerId);
  const stat = {};
  for (const s of game.snakes) {
    stat[s.strategy] = {
      len: s.body.length,
      food: s.foodEaten,
      diedAt: s.diedAtTick,
      cause: s.deathCause,
    };
  }
  return {
    winner: winner ? winner.strategy : null,
    ticks: game.ticks,
    stat,
    maxTick,
  };
}

const opponents = ['safe', 'hunter', 'territorial', 'cautious'];
const rng = mulberry32(777);
let worstTick = 0;
const rows = [];

console.log('\n=== 一对一擂台：自研算法 vs 随机避障 ===');
console.log(`每组 ${games} 局 · 32×20 棋盘 · 两条蛇同场 · 生存到最后者获胜\n`);
console.log('自研算法        对随机胜率    随机胜率   胜者终局平均长度  随机蛇平均吃到食物');
console.log('─'.repeat(82));

for (const op of opponents) {
  let opWin = 0;
  let rndWin = 0;
  let draw = 0;
  let winLen = 0;
  let rndFood = 0;
  let rndLen = 0;
  const causes = {};
  for (let i = 0; i < games; i++) {
    const r = play([op, 'random'], (rng() * 1e9) >>> 0);
    if (r.winner === op) opWin++;
    else if (r.winner === 'random') rndWin++;
    else draw++;
    if (r.winner) winLen += r.stat[r.winner].len;
    rndFood += r.stat.random.food;
    rndLen += r.stat.random.len;
    const c = r.stat.random.cause || '存活到终局';
    causes[c] = (causes[c] || 0) + 1;
    if (r.maxTick > worstTick) worstTick = r.maxTick;
  }
  rows.push({ op, opWin, rndWin, draw });
  const deathSummary = Object.entries(causes)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}×${v}`)
    .join(' ');
  console.log(
    `${STRATEGIES[op].name.padEnd(12, ' ')}  ${((opWin / games) * 100).toFixed(1).padStart(10)}%  ${((rndWin / games) * 100)
      .toFixed(1)
      .padStart(8)}%  ${(winLen / Math.max(1, opWin)).toFixed(1).padStart(14)}  ${(rndFood / games).toFixed(1).padStart(16)}`
  );
  console.log(`             随机蛇死因：${deathSummary}`);
}

const totalOp = rows.reduce((a, r) => a + r.opWin, 0);
const totalRnd = rows.reduce((a, r) => a + r.rndWin, 0);
const totalDraw = rows.reduce((a, r) => a + r.draw, 0);
const total = rows.length * games;
console.log('─'.repeat(82));
console.log(
  `合计            ${((totalOp / total) * 100).toFixed(1).padStart(10)}%  ${((totalRnd / total) * 100).toFixed(1).padStart(8)}%   （共 ${total} 局，同归于尽 ${totalDraw} 局）`
);
console.log(`\n最慢一轮 ${worstTick.toFixed(2)} ms / 预算 ${TICK_BUDGET_MS} ms\n`);
