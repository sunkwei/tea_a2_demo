/**
 * 网格搜索工具：带时间预算的 BFS / 洪水填充
 * 所有搜索都在 deadline 之前主动放弃，保证单次决策不会超出预算。
 * 内部复用固定大小的临时缓冲，避免每回合产生大量垃圾导致 GC 抖动。
 */

export const idx = (w, x, y) => y * w + x;
export const now = () => performance.now();

const EMPTY = new Set();

/* ---------------- 临时缓冲（按棋盘大小复用） ---------------- */
const distScratch = new Map();
const queueScratch = new Map();
const maskScratch = new Map();

function getDist(size, keep) {
  if (keep) {
    const arr = new Int32Array(size);
    arr.fill(-1);
    return arr;
  }
  let arr = distScratch.get(size);
  if (!arr) {
    arr = new Int32Array(size);
    distScratch.set(size, arr);
  }
  arr.fill(-1);
  return arr;
}

function getQueue(size) {
  let arr = queueScratch.get(size);
  if (!arr) {
    arr = new Int32Array(size);
    queueScratch.set(size, arr);
  }
  return arr;
}

/** 取一块可复用的占位掩码（调用方用完即可，不应跨调用持有） */
export function getMask(size) {
  let arr = maskScratch.get(size);
  if (!arr) {
    arr = new Uint8Array(size);
    maskScratch.set(size, arr);
  }
  arr.fill(0);
  return arr;
}

/**
 * 从 start 出发在 blocked 之外做 BFS。
 * @param {boolean} keepDist 是否需要保留距离场（true 时单独分配，false 时复用缓冲）
 * @returns {{area:number, foodDist:number, dist:Int32Array|null, truncated:boolean}}
 *   area     —— 可达空格数量（生存空间指标）
 *   foodDist —— 最近食物的距离（-1 表示不可达）
 */
export function explore(w, h, blocked, start, foodSet = EMPTY, deadline = Infinity, keepDist = false) {
  const total = w * h;
  const dist = getDist(total, keepDist);
  const queue = getQueue(total);
  let head = 0;
  let tail = 0;
  let area = 0;
  let foodDist = -1;
  let truncated = false;

  if (start < 0 || start >= total || blocked[start]) {
    return { area: 0, foodDist: -1, dist: keepDist ? dist : null, truncated: false };
  }

  dist[start] = 0;
  queue[tail++] = start;

  while (head < tail) {
    if ((head & 127) === 0 && now() > deadline) {
      truncated = true;
      break;
    }
    const cur = queue[head++];
    area++;
    const d = dist[cur];
    if (foodSet.has(cur) && (foodDist < 0 || d < foodDist)) foodDist = d;
    const cx = cur % w;
    const cy = (cur / w) | 0;

    // 上
    if (cy > 0) {
      const n = cur - w;
      if (!blocked[n] && dist[n] === -1) {
        dist[n] = d + 1;
        queue[tail++] = n;
      }
    }
    // 下
    if (cy < h - 1) {
      const n = cur + w;
      if (!blocked[n] && dist[n] === -1) {
        dist[n] = d + 1;
        queue[tail++] = n;
      }
    }
    // 左
    if (cx > 0) {
      const n = cur - 1;
      if (!blocked[n] && dist[n] === -1) {
        dist[n] = d + 1;
        queue[tail++] = n;
      }
    }
    // 右
    if (cx < w - 1) {
      const n = cur + 1;
      if (!blocked[n] && dist[n] === -1) {
        dist[n] = d + 1;
        queue[tail++] = n;
      }
    }
  }

  return { area, foodDist, dist: keepDist ? dist : null, truncated };
}

/**
 * 构造「本回合移动之后」的占位掩码。
 * @param {object} game
 * @param {object} me       当前决策的蛇
 * @param {{x:number,y:number,willEat:boolean}} cand 候选落点
 */
export function buildMaskAfterMove(game, me, cand) {
  const w = game.width;
  const h = game.height;
  const blocked = getMask(w * h);

  for (const s of game.snakes) {
    if (!s.alive) continue;
    if (s.id === me.id) {
      for (let i = 0; i < s.body.length; i++) {
        const c = s.body[i];
        const isTail = i === s.body.length - 1;
        if (isTail && !cand.willEat) continue; // 自己的尾巴这一步会让位
        blocked[idx(w, c.x, c.y)] = 1;
      }
    } else {
      for (const c of s.body) blocked[idx(w, c.x, c.y)] = 1;
    }
  }

  blocked[idx(w, cand.x, cand.y)] = 0; // 新头所在的格子属于自己
  return blocked;
}

/**
 * 构造「对手视角」的占位掩码：用于估算对手还能剩下多少活动空间。
 */
export function buildMaskForEnemy(game, target, myHead) {
  const w = game.width;
  const h = game.height;
  const blocked = getMask(w * h);

  for (const s of game.snakes) {
    if (!s.alive) continue;
    if (s.id === target.id) {
      for (let i = 0; i < s.body.length; i++) {
        const c = s.body[i];
        if (i === s.body.length - 1) continue; // 尾巴乐观地让位
        blocked[idx(w, c.x, c.y)] = 1;
      }
      blocked[idx(w, s.body[0].x, s.body[0].y)] = 0; // 头会离开原位
    } else if (myHead && s.id === myHead.ownerId) {
      for (const c of s.body) blocked[idx(w, c.x, c.y)] = 1;
      blocked[idx(w, myHead.x, myHead.y)] = 0; // 我们移动后的新头
    } else {
      for (const c of s.body) blocked[idx(w, c.x, c.y)] = 1;
    }
  }
  return blocked;
}
