// scenes/qkv.js — Q / K / V 三个角色
import {
  W,
  H,
  C,
  text,
  panel,
  arrow,
  vectorBars,
  vectorWidth,
  fillRR,
  strokeRR,
  MONO,
} from '../draw.js';
import { seq, easeOutBack } from '../ease.js';
import { TOKENS, ROW, rowX, rowCX, FOCUS, VEC } from '../data.js';

const CARDS = [
  { key: 'Q', name: 'Query', cn: '我想找什么？', color: C.q, vec: VEC.q, proj: 'x · W_Q' },
  { key: 'K', name: 'Key', cn: '我是谁？', color: C.k, vec: VEC.k[FOCUS], proj: 'x · W_K' },
  { key: 'V', name: 'Value', cn: '我能贡献什么？', color: C.v, vec: VEC.v[FOCUS], proj: 'x · W_V' },
];
const CARD_W = 380;
const CARD_H = 250;
const CARD_Y = 486;
const CARD_X = [268, 770, 1272];

function tokenChip(ctx, i, o = {}) {
  const { alpha = 1, glow = 0 } = o;
  const x = rowX(i);
  const y = ROW.y;
  const cx = x + ROW.w / 2;
  const focus = i === FOCUS;
  ctx.save();
  ctx.globalAlpha *= alpha;
  if (glow) {
    ctx.shadowColor = C.q;
    ctx.shadowBlur = glow;
  }
  fillRR(ctx, x, y, ROW.w, ROW.h, 18, focus ? 'rgba(255,179,71,0.14)' : 'rgba(255,255,255,0.05)');
  ctx.shadowBlur = 0;
  strokeRR(ctx, x, y, ROW.w, ROW.h, 18, focus ? C.q : 'rgba(143,180,255,0.45)', focus ? 2.5 : 1.5);
  text(ctx, TOKENS[i], cx, y + ROW.h / 2, {
    size: 38,
    weight: 700,
    align: 'center',
    baseline: 'middle',
    color: focus ? '#ffd9a1' : '#cfdcf2',
  });
  ctx.restore();
}

export default {
  id: 'qkv',
  dur: 7.0,
  title: '角色 · Query / Key / Value',
  subs: [
    { t0: 0.2, t1: 2.4, s: '要让一个字「看见」别的字，先给它三个角色。' },
    { t0: 2.8, t1: 5.0, s: 'Query 是我想找什么，Key 是我是谁，Value 是我能贡献什么。' },
    { t0: 5.3, t1: 6.9, s: '每个字都带着自己的一整套 Q、K、V。' },
  ],
  draw(ctx, lt) {
    // 词行
    TOKENS.forEach((_, i) => {
      const appear = seq(lt, 0.15 + Math.abs(i - FOCUS) * 0.08, 0.5, easeOutBack);
      tokenChip(ctx, i, { alpha: appear, glow: i === FOCUS ? 22 : 0 });
    });

    // 聚焦提示
    const aFocus = seq(lt, 0.5, 0.4);
    text(ctx, '↓ 以「蝴蝶」为例', rowCX(FOCUS), ROW.y + ROW.h + 44, {
      size: 26,
      weight: 600,
      align: 'center',
      baseline: 'middle',
      alpha: aFocus,
      color: C.q,
    });

    // 三张角色卡
    CARDS.forEach((card, i) => {
      const appear = seq(lt, 1.3 + i * 0.35, 0.6, easeOutBack);
      if (appear <= 0.01) return;
      const x = CARD_X[i];
      const y = CARD_Y + (1 - appear) * 30;
      ctx.save();
      ctx.globalAlpha *= appear;
      panel(ctx, x, y, CARD_W, CARD_H, {
        fill: 'rgba(16,24,42,0.85)',
        stroke: card.color,
        radius: 20,
        lw: 2,
      });
      text(ctx, card.key, x + 28, y + 52, { size: 58, weight: 800, color: card.color, baseline: 'middle' });
      text(ctx, card.name, x + 98, y + 40, { size: 26, weight: 700, color: C.text });
      text(ctx, card.cn, x + 98, y + 72, { size: 21, weight: 500, color: C.dim });
      text(ctx, card.proj, x + CARD_W - 28, y + 52, {
        size: 19,
        weight: 600,
        family: MONO,
        color: C.faint,
        align: 'right',
        baseline: 'middle',
      });
      text(ctx, `${card.vec.length} 维向量`, x + 28, y + 100, {
        size: 17,
        weight: 500,
        color: C.faint,
        baseline: 'middle',
      });
      vectorBars(ctx, x + 28, y + 224, card.vec, {
        cellW: 22,
        barH: 110,
        gap: 12,
        color: card.color,
        scale: 0.98,
      });
      ctx.restore();

      // 从焦点词到卡片的连线
      const lineA = seq(lt, 1.5 + i * 0.35, 0.5);
      if (lineA > 0.01) {
        const sx = rowCX(FOCUS);
        const sy = ROW.y + ROW.h;
        const tx = x + CARD_W / 2;
        const ty = y;
        ctx.save();
        ctx.globalAlpha *= lineA;
        ctx.strokeStyle = card.color;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([9, 9]);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(sx, (sy + ty) / 2 + 20, tx, ty);
        ctx.stroke();
        ctx.restore();
        arrow(ctx, tx - 1, ty - 22, tx, ty - 2, { color: card.color, width: 2.5, size: 13, alpha: lineA });
      }
    });

    // 其他词的 Key 小向量
    const aKeys = seq(lt, 5.0, 0.7);
    if (aKeys > 0.01) {
      TOKENS.forEach((_, i) => {
        if (i === FOCUS) return;
        const bw = vectorWidth(6, 11, 5);
        const x = rowCX(i) - bw / 2;
        vectorBars(ctx, x, ROW.y + ROW.h + 56, VEC.k[i], {
          cellW: 11,
          barH: 34,
          gap: 5,
          color: C.k,
          alpha: aKeys * 0.9,
        });
      });
      text(ctx, '每个词都带着自己的 Key', W / 2, ROW.y + ROW.h + 112, {
        size: 26,
        weight: 600,
        align: 'center',
        baseline: 'middle',
        alpha: aKeys,
        color: C.k,
      });
    }
  },
};
