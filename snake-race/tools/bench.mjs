/**
 * 无头基准测试：统计各策略胜率、平均局长与每轮耗时
 * 用法： node snake-race/tools/bench.mjs [对局数] [每局最大回合] [蛇数量]
 */

import { createGame } from '../src/engine.js';
import { runTick, TICK_BUDGET_MS } from '../src/runner.js';
import { STRATEGIES } from '../src/ai/bots.js';

const matches = Number(process.argv[2] || 60);
const maxTicks = Number(process.argv[3] || 3000);
const snakeCount = Number(process.argv[4] || 4);

const COLORS = ['#4ade80', '#f472b6', '#60a5fa', '#fbbf24'];
const ALL = Object.keys(STRATEGIES);

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

const rng = mulberry32(20240601);
const stats = {};
for (const id of ALL) stats[id] = { plays: 0, wins: 0, ticks: 0, len: 0, food: 0 };
let timeouts = 0;
let drawGames = 0;
const tickTimes = [];
let maxTick = 0;
let maxBot = 0;
let overBudget = 0;
let totalTicks = 0;

const t0 = performance.now();
for (let m = 0; m < matches; m++) {
  // 每局随机抽策略组合（必定包含一条「随机避障」蛇）
  const pool = [...ALL];
  const picked = ['random'];
  while (picked.length < snakeCount && pool.length) {
    const i = Math.floor(rng() * pool.length);
    const s = pool.splice(i, 1)[0];
    if (s && !picked.includes(s)) picked.push(s);
  }
  picked.forEach((s) => (stats[s].plays += 1));

  const game = createGame({
    width: 32,
    height: 20,
    seed: (rng() * 1e9) >>> 0,
    maxTicks,
    snakes: picked.map((sid, i) => ({ id: i, name: sid, color: COLORS[i], strategy: sid })),
  });

  while (game.status === 'running') {
    const r = runTick(game);
    tickTimes.push(r.total);
    totalTicks++;
    if (r.total > maxTick) maxTick = r.total;
    if (r.worstBot > maxBot) maxBot = r.worstBot;
    if (r.total > TICK_BUDGET_MS) overBudget++;
  }
  if (game.result === 'timeout') timeouts++;
  if (game.winnerId === null) drawGames++;

  const winner = game.snakes.find((s) => s.id === game.winnerId);
  if (winner) {
    stats[winner.strategy].wins += 1;
    stats[winner.strategy].len += winner.body.length;
    stats[winner.strategy].food += winner.foodEaten;
  }
  for (const s of game.snakes) {
    stats[s.strategy].ticks += s.alive ? game.ticks : s.diedAtTick ?? game.ticks;
  }
}
const wall = performance.now() - t0;

tickTimes.sort((a, b) => a - b);
const pct = (p) =>
  tickTimes.length ? tickTimes[Math.min(tickTimes.length - 1, Math.floor((p / 100) * tickTimes.length))] : 0;

console.log('\n=== 贪吃蛇竞赛 · 基准测试 ===');
console.log(`对局 ${matches} 局 · 每局最多 ${maxTicks} 回合 · ${snakeCount} 条蛇 · 合计 ${totalTicks} 回合`);
console.log(`耗时 ${(wall / 1000).toFixed(1)}s · 平均每回合 ${(wall / Math.max(1, totalTicks)).toFixed(3)}ms\n`);

console.log('策略            出场   胜场   胜率    平均存活回合  终局平均长度  终局食物');
console.log('─'.repeat(78));
for (const id of ALL) {
  const s = stats[id];
  if (!s.plays) continue;
  const rate = ((s.wins / s.plays) * 100).toFixed(1);
  const life = (s.ticks / s.plays).toFixed(0);
  const len = s.wins ? (s.len / s.wins).toFixed(1) : '—';
  const food = s.wins ? (s.food / s.wins).toFixed(1) : '—';
  console.log(
    `${STRATEGIES[id].name.padEnd(12, ' ')}  ${String(s.plays).padStart(4)}  ${String(s.wins).padStart(5)}  ${rate.padStart(6)}%  ${life.padStart(12)}  ${len.padStart(12)}  ${food.padStart(8)}`
  );
}

console.log('\n--- 性能 ---');
console.log(`最慢一轮      ${maxTick.toFixed(3)} ms  (预算 ${TICK_BUDGET_MS} ms)`);
console.log(`最慢单蛇      ${maxBot.toFixed(3)} ms`);
console.log(`p50 / p95 / p99 ${pct(50).toFixed(3)} / ${pct(95).toFixed(3)} / ${pct(99).toFixed(3)} ms`);
console.log(`超预算轮次    ${overBudget} / ${totalTicks}`);
console.log(`超时局数      ${timeouts} · 无胜者 ${drawGames}\n`);
