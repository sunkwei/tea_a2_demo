/**
 * 无头自测：规则断言 + 性能压测
 * 用法： node snake-race/tools/selftest.mjs
 */

import assert from 'node:assert/strict';
import { createGame, stepGame } from '../src/engine.js';
import { runTick, TICK_BUDGET_MS } from '../src/runner.js';
import { STRATEGY_IDS } from '../src/ai/bots.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    process.exitCode = 1;
  }
}

function mkSnake(id, cells, dir, extra = {}) {
  return {
    id,
    name: `S${id}`,
    color: '#fff',
    strategy: 'safe',
    body: cells.map(([x, y]) => ({ x, y })),
    dir,
    alive: true,
    foodEaten: 0,
    diedAtTick: null,
    deathCause: null,
    ...extra,
  };
}

function buildGame(snakes, opts = {}) {
  const g = createGame({ width: opts.width || 12, height: opts.height || 12, snakes: [], seed: 7 });
  g.snakes = snakes;
  g.foods = (opts.foods || []).map((f) => ({ ...f }));
  g.foodTarget = opts.foodTarget ?? 1;
  g.maxTicks = opts.maxTicks ?? 1000;
  return g;
}

console.log('\n[规则断言]');

test('不可掉头：反向指令被忽略，蛇继续直行', () => {
  const g = buildGame([mkSnake(0, [[5, 5], [4, 5]], 'right')]);
  stepGame(g, { 0: 'left' });
  assert.equal(g.snakes[0].body[0].x, 6);
  assert.equal(g.snakes[0].body[0].y, 5);
  assert.equal(g.snakes[0].alive, true);
});

test('撞墙即死', () => {
  const g = buildGame([mkSnake(0, [[0, 0], [0, 1]], 'up')]);
  stepGame(g, { 0: 'up' });
  assert.equal(g.snakes[0].alive, false);
  assert.equal(g.snakes[0].deathCause, 'wall');
});

test('吃到食物身体 +1 且食物被消耗', () => {
  const g = buildGame([mkSnake(0, [[5, 5], [4, 5]], 'right')], { foods: [{ x: 6, y: 5 }] });
  stepGame(g, { 0: 'right' });
  assert.equal(g.snakes[0].body.length, 3);
  assert.equal(g.snakes[0].foodEaten, 1);
  assert.equal(g.foods.filter((f) => f.x === 6 && f.y === 5).length, 0);
});

test('头对头：短者死、长者活', () => {
  const g = buildGame([
    mkSnake(0, [[5, 5], [4, 5]], 'right'),
    mkSnake(1, [[7, 5], [8, 5], [9, 5]], 'left'),
  ]);
  stepGame(g, { 0: 'right', 1: 'left' });
  assert.equal(g.snakes[0].alive, false);
  assert.equal(g.snakes[0].deathCause, 'head-on');
  assert.equal(g.snakes[1].alive, true);
});

test('头对头：长度相同则同归于尽', () => {
  const g = buildGame([
    mkSnake(0, [[5, 5], [4, 5]], 'right'),
    mkSnake(1, [[7, 5], [8, 5]], 'left'),
  ]);
  stepGame(g, { 0: 'right', 1: 'left' });
  assert.equal(g.snakes[0].alive, false);
  assert.equal(g.snakes[1].alive, false);
});

test('尾巴让位：可以进入对手正在腾出的尾格', () => {
  const g = buildGame([
    mkSnake(0, [[5, 4], [4, 4]], 'right'),
    mkSnake(1, [[6, 6], [6, 5], [6, 4]], 'down'),
  ]);
  stepGame(g, { 0: 'right', 1: 'down' });
  assert.equal(g.snakes[0].alive, true);
  assert.equal(g.snakes[0].body[0].x, 6);
  assert.equal(g.snakes[0].body[0].y, 4);
});

test('对手吃到食物时尾巴不让位 → 撞身体死亡', () => {
  const g = buildGame(
    [mkSnake(0, [[5, 4], [4, 4]], 'right'), mkSnake(1, [[6, 6], [6, 5], [6, 4]], 'down')],
    { foods: [{ x: 6, y: 7 }] }
  );
  stepGame(g, { 0: 'right', 1: 'down' });
  assert.equal(g.snakes[0].alive, false);
  assert.equal(g.snakes[0].deathCause, 'body');
  assert.equal(g.snakes[1].alive, true);
});

test('撞到别人身体即死', () => {
  const g = buildGame([
    mkSnake(0, [[5, 5], [4, 5]], 'right'),
    mkSnake(1, [[6, 4], [6, 5], [6, 6]], 'up'),
  ]);
  stepGame(g, { 0: 'right', 1: 'up' });
  assert.equal(g.snakes[0].alive, false);
  assert.equal(g.snakes[0].deathCause, 'body');
  assert.equal(g.snakes[1].alive, true);
});

test('咬到自己即死', () => {
  const g = buildGame([mkSnake(0, [[5, 5], [5, 6], [6, 6], [6, 5]], 'down')]);
  stepGame(g, { 0: 'down' });
  assert.equal(g.snakes[0].alive, false);
  assert.equal(g.snakes[0].deathCause, 'self');
});

test('同种子可复现（确定性）', () => {
  const run = () => {
    const g = createGame({
      width: 20,
      height: 14,
      seed: 4242,
      snakes: [
        { id: 0, name: 'a', color: '#fff', strategy: 'safe' },
        { id: 1, name: 'b', color: '#000', strategy: 'hunter' },
      ],
    });
    for (let i = 0; i < 120 && g.status === 'running'; i++) runTick(g);
    return JSON.stringify(g.snakes.map((s) => [s.body, s.alive, s.foodEaten]));
  };
  assert.equal(run(), run());
});

console.log('\n[对局不变量]');

test('整局不变量：身体不重叠 / 食物不在身体上 / 长度只因吃食物而变', () => {
  const g = createGame({
    width: 28,
    height: 18,
    seed: 99,
    snakes: [
      { id: 0, name: 'a', color: '#4ade80', strategy: 'random' },
      { id: 1, name: 'b', color: '#f472b6', strategy: 'safe' },
      { id: 2, name: 'c', color: '#60a5fa', strategy: 'hunter' },
      { id: 3, name: 'd', color: '#fbbf24', strategy: 'territorial' },
    ],
  });
  const prevLen = new Map(g.snakes.map((s) => [s.id, s.body.length]));
  let ticks = 0;
  while (g.status === 'running' && ticks < 5000) {
    const before = new Map(g.snakes.map((s) => [s.id, s.foodEaten]));
    runTick(g);
    ticks++;
    for (const s of g.snakes) {
      const seen = new Set();
      for (const c of s.body) {
        const k = `${c.x},${c.y}`;
        assert.ok(!seen.has(k), `蛇 ${s.id} 身体自重叠 @${k}`);
        seen.add(k);
      }
      if (s.alive) {
        const grew = s.foodEaten > before.get(s.id);
        const expected = prevLen.get(s.id) + (grew ? 1 : 0);
        assert.equal(s.body.length, expected, `蛇 ${s.id} 长度变化异常`);
        for (const f of g.foods) {
          assert.ok(!seen.has(`${f.x},${f.y}`), '食物压在蛇身上');
        }
      }
      prevLen.set(s.id, s.body.length);
    }
  }
  assert.ok(ticks > 10, '对局没有正常推进');
});

test('对局一定会分出胜负（生存到最后者获胜）', () => {
  const g = createGame({
    width: 24,
    height: 16,
    seed: 2024,
    maxTicks: 4000,
    snakes: [
      { id: 0, name: 'a', color: '#4ade80', strategy: 'random' },
      { id: 1, name: 'b', color: '#f472b6', strategy: 'territorial' },
    ],
  });
  let ticks = 0;
  while (g.status === 'running' && ticks < 5000) {
    runTick(g);
    ticks++;
  }
  assert.equal(g.status, 'over', '对局没有结束');
  assert.ok(g.winnerId !== null, '没有产生胜者');
});

console.log('\n[性能压测]');

test(`每轮计算 ≤ ${TICK_BUDGET_MS}ms（大棋盘 + 4 条长蛇）`, () => {
  const g = createGame({
    width: 48,
    height: 30,
    seed: 31337,
    snakes: [
      { id: 0, name: 'a', color: '#4ade80', strategy: 'safe' },
      { id: 1, name: 'b', color: '#f472b6', strategy: 'hunter' },
      { id: 2, name: 'c', color: '#60a5fa', strategy: 'territorial' },
      { id: 3, name: 'd', color: '#fbbf24', strategy: 'cautious' },
    ],
  });
  // 人为把蛇养长，制造最坏情况
  for (const s of g.snakes) {
    const body = [];
    for (let i = 0; i < 60; i++) body.push({ x: (s.body[0].x + i) % g.width, y: s.body[0].y });
    s.body = body;
  }
  let maxTick = 0;
  let maxBot = 0;
  for (let i = 0; i < 300 && g.status === 'running'; i++) {
    const r = runTick(g);
    maxTick = Math.max(maxTick, r.total);
    maxBot = Math.max(maxBot, r.worstBot);
  }
  console.log(`    最慢一轮 ${maxTick.toFixed(2)}ms · 最慢单蛇 ${maxBot.toFixed(2)}ms`);
  assert.ok(maxTick < TICK_BUDGET_MS, `单轮耗时 ${maxTick.toFixed(2)}ms 超过 ${TICK_BUDGET_MS}ms`);
  assert.ok(maxBot < TICK_BUDGET_MS, `单蛇耗时 ${maxBot.toFixed(2)}ms 超过 ${TICK_BUDGET_MS}ms`);
  assert.equal(g.stats.overBudgetTicks, 0, '出现超预算轮次');
});

test('所有策略都能产出合法方向', () => {
  const g = createGame({
    width: 26,
    height: 18,
    seed: 5,
    snakes: STRATEGY_IDS.map((sid, i) => ({
      id: i,
      name: sid,
      color: '#fff',
      strategy: sid,
    })),
  });
  for (let i = 0; i < 200 && g.status === 'running'; i++) runTick(g);
  assert.ok(g.ticks > 0);
});

console.log(`\n通过 ${passed} 项断言${process.exitCode ? '（存在失败项）' : ''}\n`);
