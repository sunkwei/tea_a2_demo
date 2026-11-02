// scenes/heads.js — 多头注意力
import { W, H, C, text, panel, arrow, curveArrow, heat, fillRR, strokeRR, MONO } from '../draw.js';
import { seq, easeOut, easeOutBack, clamp } from '../ease.js';
import { HEADS, TOKENS } from '../data.js';

const CELL = 50;
const GAP = 5;
const PW = 330;
const PH = 424;
const PY = 300;
const X0 = 246;

export default {
  id: 'heads',
  dur: 8.0,
  title: '多头 · 四个角度同时看',
  subs: [
    { t0: 0.3, t1: 2.3, s: '只做一次注意力不够：Transformer 同时跑好几个头。' },
    { t0: 2.5, t1: 4.8, s: '每个头有独立的参数，所以关注不同的关系：语法、指代、语义、邻接。' },
    { t0: 5.0, t1: 7.4, s: '多个头的输出拼起来再线性变换一次——这就是多头注意力。' },
  ],
  draw(ctx, lt) {
    const aTitle = seq(lt, 0.05, 0.5);
    text(ctx, '多头注意力', W / 2, 210, {
      size: 48,
      weight: 800,
      align: 'center',
      baseline: 'middle',
      alpha: aTitle,
    });
    text(ctx, 'MULTI-HEAD ATTENTION', W / 2, 254, {
      size: 19,
      weight: 600,
      align: 'center',
      baseline: 'middle',
      alpha: aTitle * 0.7,
      color: C.faint,
    });

    HEADS.forEach((head, i) => {
      const appear = seq(lt, 0.5 + i * 0.32, 0.55, easeOutBack);
      if (appear <= 0.01) return;
      const x = X0 + i * (PW + 36);
      const y = PY + (1 - appear) * 26;
      ctx.save();
      ctx.globalAlpha *= appear;
      panel(ctx, x, y, PW, PH, { fill: 'rgba(16,24,42,0.85)', stroke: head.color, radius: 18, lw: 2 });
      text(ctx, head.name, x + 20, y + 32, { size: 24, weight: 800, color: head.color, baseline: 'middle' });
      text(ctx, head.idea, x + PW - 20, y + 32, {
        size: 21,
        weight: 600,
        color: C.dim,
        align: 'right',
        baseline: 'middle',
      });
      const mx = x + (PW - (CELL * 5 + GAP * 4)) / 2;
      const my = y + 64;
      const base = ctx.globalAlpha;
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          const p = seq(lt, 0.85 + i * 0.32 + r * 0.05 + c * 0.02, 0.35, easeOut);
          if (p <= 0.01) continue;
          ctx.globalAlpha = base * p;
          fillRR(ctx, mx + c * (CELL + GAP), my + r * (CELL + GAP), CELL, CELL, 6, heat(head.m[r][c]));
        }
      }
      ctx.globalAlpha = base;
      text(ctx, '输出向量', x + PW / 2, y + PH - 26, {
        size: 20,
        weight: 600,
        color: C.faint,
        align: 'center',
        baseline: 'middle',
      });
      ctx.restore();
    });

    /* 汇聚 */
    const aFlow = seq(lt, 2.4, 0.6);
    const CONCAT = { x: 720, y: 800, w: 240, h: 64 };
    if (aFlow > 0.01) {
      HEADS.forEach((head, i) => {
        const p = seq(lt, 2.6 + i * 0.14, 0.5);
        if (p <= 0.01) return;
        const x = X0 + i * (PW + 36) + PW / 2;
        curveArrow(ctx, x, PY + PH, (x + CONCAT.x + CONCAT.w / 2) / 2, PY + PH + 60, CONCAT.x + CONCAT.w / 2, CONCAT.y - 4, {
          color: head.color,
          width: 2.2,
          size: 11,
          alpha: p * 0.8,
          progress: p,
        });
      });
    }

    const aCat = seq(lt, 3.2, 0.5);
    if (aCat > 0.01) {
      ctx.save();
      ctx.globalAlpha *= aCat;
      panel(ctx, CONCAT.x, CONCAT.y, CONCAT.w, CONCAT.h, { fill: 'rgba(167,139,250,0.12)', stroke: C.purple, radius: 16, lw: 2 });
      text(ctx, 'Concat 拼接', CONCAT.x + CONCAT.w / 2, CONCAT.y + CONCAT.h / 2, {
        size: 24,
        weight: 800,
        color: C.purple,
        align: 'center',
        baseline: 'middle',
      });
      ctx.restore();
    }

    const aWO = seq(lt, 4.0, 0.5);
    if (aWO > 0.01) {
      ctx.save();
      ctx.globalAlpha *= aWO;
      arrow(ctx, CONCAT.x + CONCAT.w + 14, CONCAT.y + CONCAT.h / 2, 1080, CONCAT.y + CONCAT.h / 2, {
        color: C.purple,
        width: 3,
        size: 14,
      });
      panel(ctx, 1080, CONCAT.y - 22, 250, CONCAT.h + 44, { fill: 'rgba(16,24,42,0.85)', stroke: C.purple, radius: 16, lw: 2 });
      text(ctx, '线性变换 W_O', 1205, CONCAT.y + CONCAT.h / 2, {
        size: 24,
        weight: 700,
        color: C.text,
        align: 'center',
        baseline: 'middle',
      });
      ctx.restore();
    }

    const aOut = seq(lt, 4.8, 0.5);
    if (aOut > 0.01) {
      ctx.save();
      ctx.globalAlpha *= aOut;
      arrow(ctx, 1344, CONCAT.y + CONCAT.h / 2, 1404, CONCAT.y + CONCAT.h / 2, { color: C.purple, width: 3, size: 14 });
      panel(ctx, 1404, CONCAT.y - 22, 300, CONCAT.h + 44, { fill: 'rgba(34,211,238,0.10)', stroke: C.cyan, radius: 16, lw: 2 });
      text(ctx, '多头注意力的输出', 1554, CONCAT.y + CONCAT.h / 2, {
        size: 24,
        weight: 700,
        color: C.cyan,
        align: 'center',
        baseline: 'middle',
      });
      ctx.restore();
    }

    const aNote = seq(lt, 5.4, 0.6);
    text(ctx, '论文里是 8 个头：8 组各自独立的 Q / K / V 参数', W / 2, 902, {
      size: 26,
      weight: 600,
      align: 'center',
      baseline: 'middle',
      alpha: aNote,
      color: C.dim,
    });
  },
};
