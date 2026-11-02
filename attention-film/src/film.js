// film.js — 时间轴调度：任何一帧都由 t 唯一决定（可拖拽、可逐帧渲染）
import { W, H, C, SANS, text, background, fillRR } from './draw.js';
import { clamp } from './ease.js';
import scenes from './scenes/index.js';

export const SCENES = scenes;
export const STARTS = [];
export const DURATION = scenes.reduce((acc, s) => {
  STARTS.push(acc);
  return acc + s.dur;
}, 0);

export function sceneIndexAt(t) {
  for (let i = STARTS.length - 1; i >= 0; i--) if (t >= STARTS[i]) return i;
  return 0;
}

function drawHud(ctx, t) {
  const i = sceneIndexAt(t);
  const s = scenes[i];

  // 章节标签
  ctx.save();
  ctx.globalAlpha *= 0.9;
  fillRR(ctx, 90, 66, 10, 10, 3, C.cyan);
  ctx.restore();
  text(ctx, `${String(i + 1).padStart(2, '0')} · ${s.title}`, 114, 71, {
    size: 22,
    weight: 600,
    color: '#9fb3d9',
    baseline: 'middle',
  });
  text(ctx, 'SELF-ATTENTION → TRANSFORMER', 1830, 71, {
    size: 17,
    weight: 600,
    color: 'rgba(147,165,196,0.5)',
    align: 'right',
    baseline: 'middle',
  });

  // 进度条
  const bx = 90;
  const bw = 1740;
  const by = 1040;
  fillRR(ctx, bx, by, bw, 3, 2, 'rgba(255,255,255,0.08)');
  const p = clamp(t / DURATION, 0, 1);
  fillRR(ctx, bx, by, bw * p, 3, 2, C.cyan);
  for (let k = 1; k < scenes.length; k++) {
    const x = bx + bw * (STARTS[k] / DURATION);
    fillRR(ctx, x - 1, by - 4, 2, 11, 1, 'rgba(255,255,255,0.22)');
  }
  // 章节进度
  const local = clamp((t - STARTS[i]) / s.dur, 0, 1);
  fillRR(ctx, bx, by + 8, bw * local, 2, 1, 'rgba(34,211,238,0.35)');
}

function drawSubs(ctx, t) {
  let cur = null;
  for (let i = 0; i < scenes.length; i++) {
    const subs = scenes[i].subs;
    if (!subs) continue;
    for (const sub of subs) {
      const t0 = STARTS[i] + sub.t0;
      const t1 = STARTS[i] + sub.t1;
      if (t >= t0 && t <= t1) cur = { sub, t0, t1 };
    }
  }
  if (!cur) return;
  const { sub, t0, t1 } = cur;
  const a = Math.min(clamp((t - t0) / 0.22, 0, 1), clamp((t1 - t) / 0.22, 0, 1));
  if (a <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.font = `600 32px ${SANS}`;
  const w = Math.min(ctx.measureText(sub.s).width + 76, W - 120);
  fillRR(ctx, (W - w) / 2, 936, w, 66, 22, 'rgba(6,10,18,0.78)');
  ctx.restore();
  text(ctx, sub.s, W / 2, 969, {
    size: 32,
    weight: 600,
    align: 'center',
    baseline: 'middle',
    color: '#dde7fb',
    alpha: a,
  });
}

export function renderFrame(ctx, t) {
  const tt = clamp(t, 0, DURATION);
  background(ctx, tt);
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    const local = tt - STARTS[i];
    if (local < 0 || local >= s.dur) continue;
    const fadeOut = clamp((s.dur - local) / 0.45, 0, 1);
    ctx.save();
    ctx.globalAlpha = fadeOut;
    s.draw(ctx, local, tt);
    ctx.restore();
  }
  drawHud(ctx, tt);
  drawSubs(ctx, tt);
}
