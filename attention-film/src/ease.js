// ease.js — 极小缓动库，所有动画都是"时间的纯函数"，保证可拖拽/可逐帧渲染
export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const inv = (a, b, v) => (b === a ? 0 : clamp((v - a) / (b - a)));
export const smooth = (a, b, v) => {
  const t = inv(a, b, v);
  return t * t * (3 - 2 * t);
};

export const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);
export const easeIn = (t) => Math.pow(clamp(t), 3);
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const easeOutElastic = (t) => {
  const c4 = (2 * Math.PI) / 3;
  return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
};

/** 归一化进度：t 在 [start, start+dur] 之间线性走完 0→1 */
export const seq = (t, start, dur, fn = easeOut) => fn(clamp((t - start) / dur));

/** 0→1→0 的脉冲 */
export const pulse = (t, start, dur) => Math.sin(clamp((t - start) / dur) * Math.PI);

/** 区间内为 1，区间外线性衰减 */
export const win = (t, a, b, fade = 0.3) =>
  clamp(inv(a - fade, a, t), 0, 1) * clamp(1 - inv(b, b + fade, t), 0, 1);
