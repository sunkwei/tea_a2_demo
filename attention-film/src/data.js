// data.js — 影片用到的固定数据与共享布局
import { W } from './draw.js';

export const TOKENS = ['小猫', '追着', '蝴蝶', '飞过', '草地'];
export const SENTENCE = '小猫 追着 蝴蝶 飞过 草地';
export const FOCUS = 2; // 「蝴蝶」

/* 共享的 token 行布局（S2/S3 共用，保证叠化时画面不跳） */
export const ROW = { y: 262, h: 84, w: 172, gap: 30 };
export const ROW_TOTAL = TOKENS.length * ROW.w + (TOKENS.length - 1) * ROW.gap;
export const ROW_X0 = (W - ROW_TOTAL) / 2;
export const rowX = (i) => ROW_X0 + i * (ROW.w + ROW.gap);
export const rowCX = (i) => rowX(i) + ROW.w / 2;

/* Query(蝴蝶) 与各 Key 的相似度分数 → softmax 得到注意力权重 */
export const SCORES = [1.1, 3.6, 2.0, 2.3, 0.3];
export function softmax(arr) {
  const m = Math.max(...arr);
  const e = arr.map((v) => Math.exp(v - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}
export const WEIGHTS = softmax(SCORES); // [0.052, 0.628, 0.127, 0.171, 0.023]

/* 四个注意力头：不同的关注模式（第 1 头第 3 行 = 上面算出的权重） */
export const HEADS = [
  {
    name: 'Head 1',
    idea: '语法结构',
    color: '#ffb347',
    m: [
      [0.45, 0.35, 0.08, 0.05, 0.07],
      [0.3, 0.3, 0.25, 0.08, 0.07],
      [0.05, 0.63, 0.13, 0.17, 0.02],
      [0.08, 0.18, 0.32, 0.3, 0.12],
      [0.1, 0.1, 0.12, 0.33, 0.35],
    ],
  },
  {
    name: 'Head 2',
    idea: '指代关系',
    color: '#45c8f5',
    m: [
      [0.4, 0.15, 0.15, 0.12, 0.18],
      [0.18, 0.25, 0.32, 0.13, 0.12],
      [0.38, 0.22, 0.18, 0.12, 0.1],
      [0.12, 0.18, 0.3, 0.25, 0.15],
      [0.14, 0.14, 0.16, 0.3, 0.26],
    ],
  },
  {
    name: 'Head 3',
    idea: '语义关联',
    color: '#a78bfa',
    m: [
      [0.28, 0.14, 0.3, 0.1, 0.18],
      [0.16, 0.2, 0.28, 0.12, 0.24],
      [0.3, 0.18, 0.2, 0.12, 0.2],
      [0.12, 0.14, 0.28, 0.16, 0.3],
      [0.2, 0.14, 0.2, 0.16, 0.3],
    ],
  },
  {
    name: 'Head 4',
    idea: '邻接依赖',
    color: '#4ade80',
    m: [
      [0.42, 0.3, 0.12, 0.08, 0.08],
      [0.22, 0.28, 0.3, 0.12, 0.08],
      [0.08, 0.3, 0.24, 0.3, 0.08],
      [0.08, 0.12, 0.3, 0.28, 0.22],
      [0.08, 0.08, 0.14, 0.28, 0.42],
    ],
  },
];

/* 演示用的向量（6 维，确定性伪随机） */
export function pseudoVec(seed, n = 6) {
  const out = [];
  let s = seed * 9301 + 49297;
  for (let i = 0; i < n; i++) {
    s = (s * 9301 + 49297) % 233280;
    const r = s / 233280;
    out.push(0.25 + r * 0.75);
  }
  return out;
}

export const VEC = {
  q: pseudoVec(3),
  k: TOKENS.map((_, i) => pseudoVec(i + 11)),
  v: TOKENS.map((_, i) => pseudoVec(i + 29)),
  out: pseudoVec(71),
};
