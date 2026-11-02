// draw.js — Canvas 2D 绘图原语
import { clamp, lerp } from './ease.js';

export const W = 1920;
export const H = 1080;

export const SANS = '"PingFang SC","Microsoft YaHei","Noto Sans SC","Hiragino Sans GB",system-ui,-apple-system,sans-serif';
export const MONO = '"JetBrains Mono","Cascadia Code","SF Mono",Consolas,"Courier New",monospace';

export const C = {
  bg: '#070b14',
  text: '#e8eefb',
  dim: '#93a5c4',
  faint: '#5d6d8c',
  q: '#ffb347',
  k: '#45c8f5',
  v: '#4ade80',
  hot: '#ff7a7a',
  purple: '#a78bfa',
  cyan: '#22d3ee',
  line: 'rgba(130,160,205,0.30)',
};

/* 排版体检用：globalThis.__trace 存在时记录每个矩形，供 tools/layout.mjs 检查 */
function trace(type, ctx, x, y, w, h, extra) {
  if (!globalThis.__trace) return;
  const m = ctx.getTransform();
  globalThis.__trace.push({
    type,
    x,
    y,
    w,
    h,
    m: [m.a, m.b, m.c, m.d, m.e, m.f],
    ...extra,
  });
}

/* ---------------------------------------------------------------- 路径 */
export function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function fillRR(ctx, x, y, w, h, r, fill) {
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  trace('fill', ctx, x, y, w, h, { fill });
}

export function strokeRR(ctx, x, y, w, h, r, stroke, lw = 2) {
  roundRectPath(ctx, x, y, w, h, r);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lw;
  ctx.stroke();
  trace('stroke', ctx, x, y, w, h, { stroke });
}

export function panel(ctx, x, y, w, h, o = {}) {
  const { fill = 'rgba(16,24,42,0.78)', stroke = C.line, radius = 20, alpha = 1, lw = 2, glow = 0 } = o;
  ctx.save();
  ctx.globalAlpha *= alpha;
  if (glow) {
    ctx.shadowColor = o.glowColor || stroke;
    ctx.shadowBlur = glow;
  }
  fillRR(ctx, x, y, w, h, radius, fill);
  ctx.shadowBlur = 0;
  if (stroke) strokeRR(ctx, x, y, w, h, radius, stroke, lw);
  ctx.restore();
}

/* ---------------------------------------------------------------- 文字 */
export function text(ctx, str, x, y, o = {}) {
  const {
    size = 32,
    weight = 500,
    color = C.text,
    align = 'left',
    baseline = 'alphabetic',
    alpha = 1,
    family = SANS,
    glow = 0,
    glowColor = null,
    letter = 0,
  } = o;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.font = `${weight} ${size}px ${family}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  if (letter && 'letterSpacing' in ctx) ctx.letterSpacing = `${letter}px`;
  if (glow) {
    ctx.shadowColor = glowColor || color;
    ctx.shadowBlur = glow;
  }
  ctx.fillText(str, x, y);
  const w = ctx.measureText(str).width;
  trace('text', ctx, x, y, w, size * 1.12, { str, align, baseline, alpha, size });
  ctx.restore();
}

/** 带小标签的圆角卡片 */
export function tag(ctx, x, y, label, o = {}) {
  const { color = C.cyan, size = 22, padX = 16, h = 38, fill = 'rgba(34,211,238,0.10)', alpha = 1, radius = 10 } = o;
  ctx.save();
  ctx.font = `700 ${size}px ${SANS}`;
  const w = ctx.measureText(label).width + padX * 2;
  ctx.globalAlpha *= alpha;
  fillRR(ctx, x, y, w, h, radius, fill);
  strokeRR(ctx, x, y, w, h, radius, color, 1.5);
  ctx.restore();
  text(ctx, label, x + w / 2, y + h / 2, { size, weight: 700, color, align: 'center', baseline: 'middle', alpha });
  return w;
}

/* ---------------------------------------------------------------- 箭头 */
function head(ctx, x, y, angle, size) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - size * Math.cos(angle - 0.4), y - size * Math.sin(angle - 0.4));
  ctx.lineTo(x - size * Math.cos(angle + 0.4), y - size * Math.sin(angle + 0.4));
  ctx.closePath();
  ctx.fill();
}

export function arrow(ctx, x1, y1, x2, y2, o = {}) {
  const { color = C.dim, width = 3, size = 15, alpha = 1, dash = null, headFill = null } = o;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.strokeStyle = color;
  ctx.fillStyle = headFill || color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.setLineDash([]);
  head(ctx, x2, y2, Math.atan2(y2 - y1, x2 - x1), size);
  ctx.restore();
}

export function curveArrow(ctx, x1, y1, cx, cy, x2, y2, o = {}) {
  const { color = C.dim, width = 3, size = 15, alpha = 1, dash = null, progress = 1 } = o;
  const p = clamp(progress, 0, 1);
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(cx, cy, x2, y2);
  ctx.stroke();
  ctx.setLineDash([]);
  const t = p;
  const ex = (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * cx + t * t * x2;
  const ey = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * cy + t * t * y2;
  const dx = 2 * (1 - t) * (cx - x1) + 2 * t * (x2 - cx);
  const dy = 2 * (1 - t) * (cy - y1) + 2 * t * (y2 - cy);
  head(ctx, ex, ey, Math.atan2(dy, dx), size);
  ctx.restore();
}

/** 沿直线移动的小圆点（用于"信号飞行"） */
export function mover(ctx, x1, y1, x2, y2, p, o = {}) {
  const { color = C.cyan, r = 9, alpha = 1, glow = 18 } = o;
  const x = lerp(x1, x2, p);
  const y = lerp(y1, y2, p);
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.shadowColor = color;
  ctx.shadowBlur = glow;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/* ---------------------------------------------------------------- 颜色 */
const HEAT = [
  [16, 26, 58],
  [30, 96, 200],
  [34, 196, 220],
  [250, 204, 40],
  [244, 74, 94],
];

export function heat(t) {
  const v = clamp(t, 0, 1);
  const s = v * (HEAT.length - 1);
  const i = Math.min(Math.floor(s), HEAT.length - 2);
  const f = s - i;
  const a = HEAT[i];
  const b = HEAT[i + 1];
  return `rgb(${Math.round(lerp(a[0], b[0], f))},${Math.round(lerp(a[1], b[1], f))},${Math.round(
    lerp(a[2], b[2], f)
  )})`;
}

export function heatAlpha(t) {
  return 0.12 + 0.88 * clamp(t, 0, 1);
}

/* ---------------------------------------------------------------- 向量 */
export function vectorBars(ctx, x, baseY, values, o = {}) {
  const {
    cellW = 16,
    barH = 70,
    gap = 8,
    color = C.cyan,
    alpha = 1,
    scale = 1,
    radius = 4,
    dim = 0.25,
  } = o;
  const n = values.length;
  const totalW = n * cellW + (n - 1) * gap;
  ctx.save();
  ctx.globalAlpha *= alpha;
  values.forEach((v, i) => {
    const bx = x + i * (cellW + gap);
    const h = Math.max(3, Math.abs(v) * barH * scale);
    const bv = v >= 0 ? baseY - h : baseY;
    fillRR(ctx, bx, bv, cellW, h, radius, color);
    ctx.globalAlpha = alpha * dim;
    fillRR(ctx, bx - 2, baseY, cellW + 4, 2, 1, 'rgba(255,255,255,0.35)');
    ctx.globalAlpha = alpha;
  });
  ctx.restore();
  return totalW;
}

export function vectorWidth(n, cellW = 16, gap = 8) {
  return n * cellW + (n - 1) * gap;
}

/* ---------------------------------------------------------------- 背景 */
export function background(ctx, t = 0) {
  ctx.save();
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  const g = ctx.createRadialGradient(W * 0.5, H * 0.38, 60, W * 0.5, H * 0.38, W * 0.78);
  g.addColorStop(0, 'rgba(46,86,160,0.26)');
  g.addColorStop(0.55, 'rgba(20,38,80,0.10)');
  g.addColorStop(1, 'rgba(7,11,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.globalAlpha = 0.045;
  ctx.strokeStyle = '#8fb4ff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= W; x += 60) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, H);
  }
  for (let y = 0; y <= H; y += 60) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(W, y + 0.5);
  }
  ctx.stroke();
  ctx.restore();
}
