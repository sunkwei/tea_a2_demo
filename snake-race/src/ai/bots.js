/**
 * 贪吃蛇 AI 策略库
 * ------------------------------------------------------------------
 * 1) random        —— 随机简单避障（只做 1 步合法性判断，撞不死就随机走）
 * 2) safe          —— 空间安全优先：洪水填充算「生存空间」，最大化可达面积
 * 3) hunter        —— 猎手：安全优先 + 主动封锁（压对手活动空间 / 头对头压制）
 * 4) territorial   —— 围堵：堵住对手逃生路线 / 切尾追击
 * 5) cautious      —— 谨慎：与所有对手保持距离，稳健进食
 *
 * 所有策略都受 ctx.deadline 约束，搜索到点即放弃，保证单次决策 ≤ 预算。
 */

import { DIRECTIONS, DIR_ORDER, REVERSE, isFoodAt } from '../engine.js';
import { explore, buildMaskAfterMove, buildMaskForEnemy, getMask, idx, now } from './grid.js';

const EMPTY = new Set();

/* ------------------------------------------------------------------ */
/* 基础工具                                                            */
/* ------------------------------------------------------------------ */

/** 兜底方向：没有合法走法时随便选一个非掉头方向（大概率会死，但符合规则） */
export function fallbackDir(game, s) {
  const dirs = DIR_ORDER.filter((d) => d !== REVERSE[s.dir]);
  return dirs[Math.floor(game.rng() * dirs.length)] || s.dir;
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

/** 合法候选（不可掉头、不撞墙、不撞身体；自己的尾格在会让位时允许进入） */
function legalMoves(game, s) {
  const out = [];
  const head = s.body[0];
  for (const dir of DIR_ORDER) {
    if (dir === REVERSE[s.dir]) continue; // 规则：不可掉头
    const d = DIRECTIONS[dir];
    const nx = head.x + d.x;
    const ny = head.y + d.y;
    if (nx < 0 || nx >= game.width || ny < 0 || ny >= game.height) continue; // 撞墙

    let hit = false;
    for (const o of game.snakes) {
      if (!o.alive || o.id === s.id) continue;
      for (const c of o.body) {
        if (c.x === nx && c.y === ny) {
          hit = true;
          break;
        }
      }
      if (hit) break;
    }
    if (hit) continue; // 撞到别人身体

    const willEat = isFoodAt(game, nx, ny);

    let selfHit = false;
    for (let i = 0; i < s.body.length - 1; i++) {
      const c = s.body[i];
      if (c.x === nx && c.y === ny) {
        selfHit = true;
        break;
      }
    }
    if (selfHit) continue; // 撞到自己（头/脖子）

    const tail = s.body[s.body.length - 1];
    if (willEat && tail.x === nx && tail.y === ny) continue; // 吃食物时尾巴不让位

    out.push({ dir, x: nx, y: ny, willEat });
  }
  return out;
}

/** 最近对手头部（切比雪夫距离）与它的长度 */
function nearestEnemy(game, s, x, y) {
  let best = null;
  let bestDist = Infinity;
  for (const o of game.snakes) {
    if (!o.alive || o.id === s.id) continue;
    const dx = Math.abs(o.body[0].x - x);
    const dy = Math.abs(o.body[0].y - y);
    const d = Math.max(dx, dy);
    if (d < bestDist) {
      bestDist = d;
      best = o;
    }
  }
  return { dist: bestDist, snake: best };
}

/** 对手的逃生路线：头部四周的空格（它下一步可能走的地方） */
function escapeOptions(game, target) {
  const head = target.body[0];
  const out = [];
  for (const dir of DIR_ORDER) {
    const d = DIRECTIONS[dir];
    const nx = head.x + d.x;
    const ny = head.y + d.y;
    if (nx < 0 || nx >= game.width || ny < 0 || ny >= game.height) continue;
    let blocked = false;
    for (const o of game.snakes) {
      if (!o.alive) continue;
      for (const c of o.body) {
        if (c.x === nx && c.y === ny) {
          blocked = true;
          break;
        }
      }
      if (blocked) break;
    }
    if (!blocked) out.push({ x: nx, y: ny, dir });
  }
  return out;
}

/** 计算候选落点移动之后的生存空间 / 食物距离 */
function analyze(game, s, cand, ctx) {
  const w = game.width;
  const h = game.height;
  const blocked = buildMaskAfterMove(game, s, cand);
  const foodSet = new Set(game.foods.map((f) => idx(w, f.x, f.y)));
  const res = explore(w, h, blocked, idx(w, cand.x, cand.y), foodSet, ctx.deadline);
  return { ...cand, area: res.area, foodDist: res.foodDist, truncated: res.truncated };
}

/* ------------------------------------------------------------------ */
/* 基础评分（safe / hunter / territorial / cautious 共用）              */
/* ------------------------------------------------------------------ */

function baseScore(game, s, a) {
  const need = s.body.length + (a.willEat ? 1 : 0);
  let score = a.area; // 生存空间越大越好

  if (a.area < need) score -= (need - a.area) * 60; // 钻进装不下自己的死角
  if (a.willEat) score += 55; // 吃到食物
  else if (a.foodDist >= 0) score -= a.foodDist * 0.8; // 靠近食物
  else score -= 40; // 食物不可达

  const th = nearestEnemy(game, s, a.x, a.y);
  if (th.snake) {
    if (th.dist === 1) {
      if (th.snake.body.length >= s.body.length) score -= 75; // 头对头我会死
      else score += 30; // 头对头对方死
    } else if (th.dist === 2) {
      score -= 8;
    }
  }
  return score;
}

function bestOf(cands) {
  let best = null;
  for (const c of cands) {
    if (!best || c.score > best.score || (c.score === best.score && c.dir < best.dir)) best = c;
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* 策略 1：随机简单避障                                                */
/* ------------------------------------------------------------------ */

function randomBot(game, s, ctx) {
  const moves = legalMoves(game, s);
  if (!moves.length) return fallbackDir(game, s);
  const food = moves.filter((m) => m.willEat);
  if (food.length && game.rng() < 0.6) return pick(game.rng, food).dir; // 食物就在旁边时大概率去吃
  return pick(game.rng, moves).dir;
}

/* ------------------------------------------------------------------ */
/* 策略 2：空间安全优先                                                */
/* ------------------------------------------------------------------ */

function safeBot(game, s, ctx) {
  const moves = legalMoves(game, s);
  if (!moves.length) return fallbackDir(game, s);

  const scored = [];
  for (const m of moves) {
    if (now() > ctx.deadline) break;
    const a = analyze(game, s, m, ctx);
    scored.push({ ...a, score: baseScore(game, s, a) });
  }
  if (!scored.length) return fallbackDir(game, s);
  const best = bestOf(scored);
  return best ? best.dir : fallbackDir(game, s);
}

/* ------------------------------------------------------------------ */
/* 策略 3：猎手（封锁 + 头对头压制）                                    */
/* ------------------------------------------------------------------ */

function hunterBot(game, s, ctx) {
  const moves = legalMoves(game, s);
  if (!moves.length) return fallbackDir(game, s);

  const enemies = game.snakes.filter((o) => o.alive && o.id !== s.id);
  const scored = [];
  for (const m of moves) {
    if (now() > ctx.deadline) break;
    const a = analyze(game, s, m, ctx);
    let score = baseScore(game, s, a);

    for (const e of enemies) {
      if (now() > ctx.deadline) break;
      const w = game.width;
      const h = game.height;
      const mask = buildMaskForEnemy(game, e, { ownerId: s.id, x: a.x, y: a.y });
      const res = explore(w, h, mask, idx(w, e.body[0].x, e.body[0].y), EMPTY, ctx.deadline);
      const area = res.area;
      if (area < e.body.length) score += 90; // 对手快被堵死了 → 加分
      else if (area < e.body.length * 2) score += 25;
      else score -= Math.min(20, (area - e.body.length * 2) * 0.05);
    }

    // 头对头压制：我更长时可以主动迎上去
    const th = nearestEnemy(game, s, a.x, a.y);
    if (th.snake && th.dist === 1 && s.body.length > th.snake.body.length) score += 45;

    scored.push({ ...a, score });
  }
  if (!scored.length) return fallbackDir(game, s);
  const best = bestOf(scored);
  return best ? best.dir : fallbackDir(game, s);
}

/* ------------------------------------------------------------------ */
/* 策略 4：围堵（堵逃生路线 / 切尾）                                    */
/* ------------------------------------------------------------------ */

function territorialBot(game, s, ctx) {
  const moves = legalMoves(game, s);
  if (!moves.length) return fallbackDir(game, s);

  // 目标：体型最大的对手（活着）
  let target = null;
  for (const o of game.snakes) {
    if (!o.alive || o.id === s.id) continue;
    if (!target || o.body.length > target.body.length) target = o;
  }
  if (!target) return safeBot(game, s, ctx);

  const w = game.width;
  const h = game.height;

  // 目标可用的逃生格
  const escapes = escapeOptions(game, target);
  const escapeSet = new Set(escapes.map((e) => idx(w, e.x, e.y)));

  // 目标尾巴的距离场（用于切尾）
  let tailDist = null;
  const tailCell = target.body[target.body.length - 1];
  if (now() <= ctx.deadline) {
    const blocked = getMask(w * h);
    for (const o of game.snakes) {
      if (!o.alive) continue;
      for (const c of o.body) blocked[idx(w, c.x, c.y)] = 1;
    }
    const tIdx = idx(w, tailCell.x, tailCell.y);
    blocked[tIdx] = 0;
    tailDist = explore(w, h, blocked, tIdx, EMPTY, ctx.deadline, true).dist;
  }

  // 目标比我壮才值得死缠烂打
  const chase = target.body.length > s.body.length ? 1 : 0.35;

  const scored = [];
  for (const m of moves) {
    if (now() > ctx.deadline) break;
    const a = analyze(game, s, m, ctx);
    let score = baseScore(game, s, a);

    const k = idx(w, a.x, a.y);
    if (escapeSet.has(k)) {
      // 站到对手的逃生路线上：对手逃路越少越好
      score += 40 + Math.max(0, 24 - escapes.length * 8);
    }
    if (tailDist && tailDist[k] >= 0) {
      score -= tailDist[k] * 0.9 * chase; // 越靠近对方尾巴越好（切尾）
    }
    scored.push({ ...a, score });
  }
  if (!scored.length) return fallbackDir(game, s);
  const best = bestOf(scored);
  return best ? best.dir : fallbackDir(game, s);
}

/* ------------------------------------------------------------------ */
/* 策略 5：谨慎（保持距离，稳健进食）                                   */
/* ------------------------------------------------------------------ */

function cautiousBot(game, s, ctx) {
  const moves = legalMoves(game, s);
  if (!moves.length) return fallbackDir(game, s);

  const scored = [];
  for (const m of moves) {
    if (now() > ctx.deadline) break;
    const a = analyze(game, s, m, ctx);
    const th = nearestEnemy(game, s, a.x, a.y);
    let score = a.area * 0.3;
    if (th.snake) {
      score += Math.min(th.dist, 8) * 4; // 离对手越远越好（8 以外不再加分）
      if (th.dist === 1) score -= th.snake.body.length >= s.body.length ? 90 : 25;
    }
    if (a.willEat) score += 45;
    else if (a.foodDist >= 0) score -= a.foodDist * 0.7;
    // 空间不足时不要乱吃
    if (a.area < s.body.length + 2) score -= 60;
    scored.push({ ...a, score });
  }
  if (!scored.length) return fallbackDir(game, s);
  const best = bestOf(scored);
  return best ? best.dir : fallbackDir(game, s);
}

/* ------------------------------------------------------------------ */

export const STRATEGIES = {
  random: {
    id: 'random',
    name: '随机避障',
    short: '随机',
    desc: '只判断下一步是否立刻撞死，其余随机选择；食物在嘴边时有一定概率去吃。',
    decide: randomBot,
  },
  safe: {
    id: 'safe',
    name: '空间安全',
    short: '安全',
    desc: '洪水填充计算移动后的可达空间，优先进入开阔区域，避免把自己挤进死角。',
    decide: safeBot,
  },
  hunter: {
    id: 'hunter',
    name: '猎手封锁',
    short: '猎手',
    desc: '在安全基础上主动压缩对手活动空间，制造围死，并伺机头对头压制。',
    decide: hunterBot,
  },
  territorial: {
    id: 'territorial',
    name: '围堵切尾',
    short: '围堵',
    desc: '站在对手的逃生路线上压缩其空间，并沿最短路径切向对手尾部。',
    decide: territorialBot,
  },
  cautious: {
    id: 'cautious',
    name: '谨慎拉扯',
    short: '谨慎',
    desc: '与所有对手保持距离，空间充裕时才进食，擅长拖到别人先死。',
    decide: cautiousBot,
  },
};

export const STRATEGY_IDS = Object.keys(STRATEGIES);
