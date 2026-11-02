/**
 * 贪吃蛇竞赛 · 规则引擎（纯逻辑，无 DOM 依赖，可在 Node 中直接跑）
 * ------------------------------------------------------------------
 * 采用标准贪吃蛇 / Battle-Snake 规则：
 *   1. 蛇在矩形网格上每 tick 前进一格，只能走上下左右；
 *   2. 不可 180° 掉头（不能反向进入自己的脖子）；
 *   3. 吃到食物身体 +1，食物随机刷新到空位；
 *   4. 撞墙 / 撞自己的身体 / 撞到别人的身体 → 出局；
 *   5. 头对头（同时进入同一格）：较短者死，长度相同则同归于尽；
 *   6. 尾巴在下一 tick 会让位（除非刚吃到食物），所以可以合法进入对方正在腾出的尾格；
 *   7. 生存到最后者获胜；棋盘填满或超时则按身体长度（再按食物数）判定。
 */

export const DIRECTIONS = {
  up: { id: 'up', x: 0, y: -1 },
  right: { id: 'right', x: 1, y: 0 },
  down: { id: 'down', x: 0, y: 1 },
  left: { id: 'left', x: -1, y: 0 },
};

export const DIR_ORDER = ['up', 'right', 'down', 'left'];
export const REVERSE = { up: 'down', down: 'up', left: 'right', right: 'left' };

export const DEFAULT_WIDTH = 32;
export const DEFAULT_HEIGHT = 20;

/** 线性索引工具：index = y * width + x */
export const idx = (w, x, y) => y * w + x;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 出生点：按对角/四角分布，保证互不重叠且头朝场内 */
function spawnSpots(width, height, n) {
  const spots = [
    { x: 2, y: 2, dir: 'right' },
    { x: width - 3, y: height - 3, dir: 'left' },
    { x: 2, y: height - 3, dir: 'up' },
    { x: width - 3, y: 2, dir: 'down' },
  ];
  return spots.slice(0, n);
}

export function createGame(options = {}) {
  const {
    width = DEFAULT_WIDTH,
    height = DEFAULT_HEIGHT,
    snakes = [],
    seed = 20240601,
    foodCount = null, // null → 与蛇数量一致；1 → 标准单食物模式
    maxTicks = 20000,
    startLength = 3,
  } = options;

  const rng = mulberry32(seed);
  const game = {
    width,
    height,
    ticks: 0,
    snakes: [],
    foods: [],
    rng,
    seed: seed >>> 0,
    status: 'running', // running | over
    winnerId: null,
    result: null, // survivor | longest | draw | timeout | board-full
    events: [],
    maxTicks,
    foodTarget: foodCount == null ? Math.max(1, snakes.length) : Math.max(1, foodCount),
    stats: {
      lastTickMs: 0,
      maxTickMs: 0,
      lastBotMs: 0,
      maxBotMs: 0,
      lastDecideMs: 0,
      totalMs: 0,
      ticks: 0,
      budgetViolations: 0,
      overBudgetTicks: 0,
      fallbacks: 0,
    },
  };

  const spots = spawnSpots(width, height, snakes.length);
  snakes.forEach((cfg, i) => {
    const spot = spots[i % spots.length];
    const dir = cfg.dir || spot.dir;
    const d = DIRECTIONS[dir];
    const body = [];
    let x = spot.x;
    let y = spot.y;
    for (let k = 0; k < startLength; k++) {
      body.push({ x, y });
      x -= d.x;
      y -= d.y;
    }
    game.snakes.push({
      id: cfg.id ?? i,
      name: cfg.name ?? `蛇 ${i + 1}`,
      color: cfg.color ?? '#4ade80',
      strategy: cfg.strategy ?? 'safe',
      bot: cfg.bot ?? null,
      body,
      dir,
      alive: true,
      foodEaten: 0,
      diedAtTick: null,
      deathCause: null,
      bornTick: 0,
    });
  });

  refillFood(game);
  return game;
}

/* ---------------- 占位与食物（全部使用复用缓冲，避免每回合产生垃圾） ---------------- */

let maskCache = { size: 0, arr: null };

function occupancyBuffer(game) {
  const size = game.width * game.height;
  if (maskCache.size !== size) {
    maskCache = { size, arr: new Uint8Array(size) };
  }
  const mask = maskCache.arr;
  mask.fill(0);
  for (const s of game.snakes) {
    if (!s.alive) continue;
    for (const c of s.body) mask[idx(game.width, c.x, c.y)] = 1;
  }
  return mask;
}

/** 存活蛇的身体占位掩码（1 = 被占据） */
export function occupancyMask(game) {
  return occupancyBuffer(game);
}

/** 所有空格坐标（工具函数，勿放在热路径上） */
export function freeCells(game) {
  const mask = occupancyBuffer(game);
  const out = [];
  for (let y = 0; y < game.height; y++) {
    for (let x = 0; x < game.width; x++) {
      if (!mask[idx(game.width, x, y)]) out.push({ x, y });
    }
  }
  return out;
}

/** 补充食物到目标数量；返回 false 表示棋盘已填满 */
export function refillFood(game) {
  const w = game.width;
  const h = game.height;
  const mask = occupancyBuffer(game);

  let free = 0;
  for (let i = 0; i < mask.length; i++) if (!mask[i]) free++;
  if (free === 0) return false;

  let guard = 0;
  while (game.foods.length < game.foodTarget && guard++ < 40) {
    let placed = false;
    // 先随机探测（绝大多数情况一次命中）
    for (let tries = 0; tries < 24 && !placed; tries++) {
      const x = (game.rng() * w) | 0;
      const y = (game.rng() * h) | 0;
      if (!mask[idx(w, x, y)] && !game.foods.some((f) => f.x === x && f.y === y)) {
        game.foods.push({ x, y });
        placed = true;
      }
    }
    // 兜底：线性扫描
    if (!placed) {
      for (let y = 0; y < h && !placed; y++) {
        for (let x = 0; x < w && !placed; x++) {
          if (!mask[idx(w, x, y)] && !game.foods.some((f) => f.x === x && f.y === y)) {
            game.foods.push({ x, y });
            placed = true;
          }
        }
      }
    }
    if (!placed) break;
  }
  return true;
}

export function isFoodAt(game, x, y) {
  for (const f of game.foods) if (f.x === x && f.y === y) return true;
  return false;
}

/**
 * 推进一个 tick。
 * @param {object} game
 * @param {Record<string,string>} decisions 每条蛇的方向（id -> 'up'|'down'|'left'|'right'）
 * @returns {Array} 本 tick 产生的事件
 */
export function stepGame(game, decisions = {}) {
  if (game.status !== 'running') return game.events;

  const w = game.width;
  const h = game.height;
  const byId = new Map(game.snakes.map((s) => [s.id, s]));
  const alive = game.snakes.filter((s) => s.alive);
  const events = [];

  // 1) 规整移动方向：非法方向或掉头 → 沿用当前方向（规则：不可掉头）
  const moves = new Map();
  for (const s of alive) {
    let dir = decisions[s.id] ?? s.dir;
    if (!DIRECTIONS[dir] || dir === REVERSE[s.dir]) dir = s.dir;
    moves.set(s.id, dir);
  }

  // 2) 计算新头 / 是否吃到食物
  const newHead = new Map();
  const willEat = new Map();
  for (const s of alive) {
    const d = DIRECTIONS[moves.get(s.id)];
    const head = { x: s.body[0].x + d.x, y: s.body[0].y + d.y };
    newHead.set(s.id, head);
    willEat.set(s.id, isFoodAt(game, head.x, head.y));
  }

  // 3) 计算移动后的身体（吃食物则尾巴不动，否则尾巴前移让位）
  const newBody = new Map();
  for (const s of alive) {
    const body = [newHead.get(s.id), ...s.body.map((c) => ({ x: c.x, y: c.y }))];
    if (!willEat.get(s.id)) body.pop();
    newBody.set(s.id, body);
  }

  // 4) 占位表：cell -> 占据它的蛇 id 列表
  const occ = new Map();
  for (const s of alive) {
    for (const c of newBody.get(s.id)) {
      const k = idx(w, c.x, c.y);
      let arr = occ.get(k);
      if (!arr) occ.set(k, (arr = []));
      arr.push(s.id);
    }
  }

  // 5) 头对头分组
  const groups = new Map();
  for (const s of alive) {
    const h = newHead.get(s.id);
    const k = idx(w, h.x, h.y);
    let arr = groups.get(k);
    if (!arr) groups.set(k, (arr = []));
    arr.push(s.id);
  }

  const death = new Map();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    let minLen = Infinity;
    for (const id of group) minLen = Math.min(minLen, byId.get(id).body.length);
    for (const id of group) {
      if (byId.get(id).body.length === minLen) death.set(id, 'head-on');
    }
  }

  // 6) 撞墙 / 撞身体 / 撞自己
  for (const s of alive) {
    if (death.has(s.id)) continue;
    const head = newHead.get(s.id);
    if (head.x < 0 || head.x >= w || head.y < 0 || head.y >= h) {
      death.set(s.id, 'wall');
      continue;
    }
    const k = idx(w, head.x, head.y);
    const owners = occ.get(k) || [];
    const group = groups.get(k) || [];
    let selfHits = 0;
    for (const oid of owners) {
      if (oid === s.id) {
        selfHits++;
        continue;
      }
      if (group.includes(oid)) continue; // 头对头已单独判定
      death.set(s.id, 'body');
      break;
    }
    if (!death.has(s.id) && selfHits > 1) death.set(s.id, 'self');
  }

  // 7) 应用结果
  const eaten = [];
  for (const s of alive) {
    if (death.has(s.id)) {
      s.alive = false;
      s.deathCause = death.get(s.id);
      s.diedAtTick = game.ticks;
      events.push({ type: 'death', id: s.id, cause: s.deathCause, x: s.body[0].x, y: s.body[0].y });
      continue;
    }
    s.dir = moves.get(s.id);
    s.body = newBody.get(s.id);
    if (willEat.get(s.id)) {
      s.foodEaten++;
      const f = game.foods.find((ff) => ff.x === s.body[0].x && ff.y === s.body[0].y);
      if (f) eaten.push(f);
      events.push({ type: 'eat', id: s.id, x: s.body[0].x, y: s.body[0].y });
    }
  }

  for (const f of eaten) {
    const i = game.foods.indexOf(f);
    if (i >= 0) game.foods.splice(i, 1);
  }

  game.ticks++;
  game.events = events;

  // 8) 胜负判定
  const survivors = game.snakes.filter((s) => s.alive);
  const boardFull = !refillFood(game);
  if (survivors.length === 1) {
    game.status = 'over';
    game.winnerId = survivors[0].id;
    game.result = 'survivor';
    events.push({ type: 'win', id: survivors[0].id });
  } else if (survivors.length === 0) {
    game.status = 'over';
    const best = pickLongest(game.snakes);
    game.winnerId = best ? best.id : null;
    game.result = best && best.foodEaten > 0 ? 'survivor' : 'draw';
    if (best) events.push({ type: 'win', id: best.id });
  } else if (boardFull) {
    game.status = 'over';
    const best = pickLongest(survivors);
    game.winnerId = best.id;
    game.result = 'board-full';
    events.push({ type: 'win', id: best.id });
  } else if (game.ticks >= game.maxTicks) {
    game.status = 'over';
    const best = pickLongest(survivors);
    game.winnerId = best.id;
    game.result = 'timeout';
    events.push({ type: 'win', id: best.id });
  }

  return events;
}

function pickLongest(snakes) {
  let best = null;
  for (const s of snakes) {
    if (!best) {
      best = s;
      continue;
    }
    const bl = best.body.length;
    const sl = s.body.length;
    if (sl > bl || (sl === bl && s.foodEaten > best.foodEaten)) best = s;
  }
  return best;
}

export const DEATH_LABEL = {
  wall: '撞墙',
  body: '撞到身体',
  self: '咬到自己',
  'head-on': '头对头',
};
