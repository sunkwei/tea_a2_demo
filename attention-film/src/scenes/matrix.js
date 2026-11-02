// scenes/matrix.js — 注意力矩阵
import { W, H, C, text, panel, arrow, heat, fillRR, strokeRR, MONO } from '../draw.js';
import { seq, easeOut, clamp, lerp } from '../ease.js';
import { TOKENS, HEADS, FOCUS } from '../data.js';

const CELL = 92;
const GAP = 8;
const MX = 360;
const MY = 372;
const SIZE = CELL * 5 + GAP * 4;
const M = HEADS[0].m;

export default {
  id: 'matrix',
  dur: 7.0,
  title: '矩阵 · 所有词对之间的注意力',
  subs: [
    { t0: 0.4, t1: 2.8, s: '把两两比较的结果摆在一起，就是注意力矩阵。' },
    { t0: 3.0, t1: 4.8, s: '每一行，是一个词对整句话的注意力分布。' },
    { t0: 5.0, t1: 6.8, s: '权重是算出来的，所以模型能解释「它看了谁」。' },
  ],
  draw(ctx, lt) {
    const aTitle = seq(lt, 0.1, 0.5);
    text(ctx, '注意力矩阵', W / 2, 236, {
      size: 52,
      weight: 800,
      align: 'center',
      baseline: 'middle',
      alpha: aTitle,
    });
    text(ctx, 'ATTENTION MATRIX', W / 2, 286, {
      size: 20,
      weight: 600,
      align: 'center',
      baseline: 'middle',
      alpha: aTitle * 0.7,
      color: C.faint,
    });

    /* 列标题 */
    const aHead = seq(lt, 0.4, 0.5);
    TOKENS.forEach((tk, i) => {
      text(ctx, tk, MX + i * (CELL + GAP) + CELL / 2, MY - 26, {
        size: 22,
        weight: 600,
        align: 'center',
        baseline: 'middle',
        alpha: aHead,
        color: C.dim,
      });
    });

    /* 单元格逐个点亮 */
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        const t0 = 0.9 + (r * 5 + c) * 0.055;
        const p = seq(lt, t0, 0.4, easeOut);
        if (p <= 0.01) continue;
        const v = M[r][c];
        const x = MX + c * (CELL + GAP);
        const y = MY + r * (CELL + GAP);
        ctx.save();
        ctx.globalAlpha *= p;
        fillRR(ctx, x, y, CELL, CELL, 10, heat(v));
        if (v > 0.28) {
          text(ctx, (v * 100).toFixed(0), x + CELL / 2, y + CELL / 2, {
            size: 26,
            weight: 800,
            family: MONO,
            align: 'center',
            baseline: 'middle',
            color: v > 0.5 ? '#0b1020' : 'rgba(255,255,255,0.92)',
          });
        }
        ctx.restore();
      }
    }

    /* 行标题 */
    TOKENS.forEach((tk, r) => {
      const p = seq(lt, 0.9 + r * 0.12, 0.4);
      text(ctx, tk, MX - 26, MY + r * (CELL + GAP) + CELL / 2, {
        size: 24,
        weight: 600,
        align: 'right',
        baseline: 'middle',
        alpha: p * (r === FOCUS ? 1 : 0.72),
        color: r === FOCUS ? C.q : C.dim,
      });
    });

    /* 聚焦行 */
    const aRow = seq(lt, 1.9, 0.5);
    if (aRow > 0.01) {
      ctx.save();
      ctx.globalAlpha *= aRow;
      strokeRR(ctx, MX - 7, MY + FOCUS * (CELL + GAP) - 7, SIZE + 14, CELL + 14, 15, C.q, 3);
      text(ctx, '↑ 第 3 行 = 「蝴蝶」在看谁', MX, MY + SIZE + 46, {
        size: 24,
        weight: 700,
        align: 'left',
        baseline: 'middle',
        color: C.q,
      });
      ctx.restore();
    }

    /* 右侧：这一行的权重条 */
    const aBar = seq(lt, 2.6, 0.6);
    const PX = MX + SIZE + 80;
    const PW = 1790 - PX;
    if (aBar > 0.01) {
      panel(ctx, PX, MY - 20, PW, SIZE + 40, { fill: 'rgba(16,24,42,0.82)', stroke: C.line, radius: 18, lw: 1.5 });
      text(ctx, '「蝴蝶」的注意力分布', PX + 26, MY + 16, {
        size: 26,
        weight: 700,
        color: C.text,
        baseline: 'middle',
      });
      TOKENS.forEach((tk, i) => {
        const p = seq(lt, 3.0 + i * 0.12, 0.5);
        if (p <= 0.01) return;
        const w = M[FOCUS][i] * p;
        const y = MY + 62 + i * 58;
        text(ctx, tk, PX + 26, y + 14, { size: 22, weight: 600, color: C.dim, baseline: 'middle' });
        const bw = (PW - 190) * w;
        fillRR(ctx, PX + 110, y, Math.max(3, bw), 28, 8, heat(0.25 + w));
        text(ctx, (w * 100).toFixed(0) + '%', PX + 126 + Math.max(3, bw), y + 14, {
          size: 20,
          weight: 700,
          family: MONO,
          color: i === 1 ? C.q : C.dim,
          baseline: 'middle',
        });
      });
      text(ctx, '每一行加起来 = 1  ｜  权重不是设定的，是算出来的', PX + 26, MY + SIZE - 6, {
        size: 20,
        weight: 500,
        color: C.faint,
        baseline: 'middle',
      });
    }
  },
};
