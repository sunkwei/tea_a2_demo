/**
 * 回合调度器 —— 负责「每轮计算 ≤ 50ms」的硬性预算
 * ------------------------------------------------------------------
 * · 每条蛇有独立的思考预算（默认 10ms），搜索算法在 deadline 前主动放弃；
 * · 整轮还有一个全局软截止（50ms 的 75%），超时后剩余的蛇直接用快速兜底策略；
 * · 统计每轮耗时、最慢单蛇耗时、越界次数，UI 与 bench 都会读取。
 */

import { stepGame } from './engine.js';
import { STRATEGIES, fallbackDir } from './ai/bots.js';

export const TICK_BUDGET_MS = 50; // 需求：每轮计算不能超过 50ms
export const BOT_BUDGET_MS = 10; // 单条蛇的思考预算
const GLOBAL_SOFT_RATIO = 0.75; // 整轮软截止 = 50ms * 0.75

const now = () => performance.now();

export function runTick(game, options = {}) {
  const botBudget = options.botBudgetMs ?? BOT_BUDGET_MS;
  const t0 = now();
  const globalDeadline = t0 + TICK_BUDGET_MS * GLOBAL_SOFT_RATIO;

  const decisions = {};
  let worstBot = 0;
  let overBudget = 0;
  let usedFallback = 0;

  for (const s of game.snakes) {
    if (!s.alive) continue;
    const b0 = now();
    const strategy = STRATEGIES[s.strategy] || STRATEGIES.safe;
    let dir;
    if (now() > globalDeadline) {
      dir = fallbackDir(game, s); // 整轮预算快用完 → 快速兜底
      usedFallback++;
    } else {
      try {
        dir = strategy.decide(game, s, {
          deadline: Math.min(b0 + botBudget, globalDeadline),
          budgetMs: botBudget,
        });
      } catch (err) {
        dir = fallbackDir(game, s);
        usedFallback++;
        if (options.onError) options.onError(err, s);
      }
    }
    const dt = now() - b0;
    if (dt > worstBot) worstBot = dt;
    if (dt > botBudget) overBudget++;
    decisions[s.id] = dir;
  }

  const tDecide = now() - t0;
  stepGame(game, decisions);
  const total = now() - t0;

  const st = game.stats;
  st.lastTickMs = total;
  st.lastBotMs = worstBot;
  st.lastDecideMs = tDecide;
  st.ticks++;
  st.totalMs += total;
  if (total > st.maxTickMs) st.maxTickMs = total;
  if (worstBot > st.maxBotMs) st.maxBotMs = worstBot;
  st.budgetViolations += overBudget;
  st.fallbacks += usedFallback;
  if (total > TICK_BUDGET_MS) st.overBudgetTicks++;

  return {
    total,
    decide: tDecide,
    worstBot,
    overBudget,
    usedFallback,
  };
}
