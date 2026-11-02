// scenes/arch.js — Encoder / Decoder 整体架构
import { W, H, C, text, panel, arrow, curveArrow, fillRR, strokeRR, heat, MONO } from '../draw.js';
import { seq, easeOut, clamp } from '../ease.js';

const EX = 340;
const EW = 300;
const DE = 1280;
const DW = 300;
const BY = 300;
const BH = 88;
const BG = 12;

function subBar(ctx, x, y, w, label, color, alpha) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  fillRR(ctx, x, y, w, 20, 6, color);
  text(ctx, label, x + 10, y + 10, {
    size: 14,
    weight: 700,
    color: 'rgba(8,12,24,0.85)',
    baseline: 'middle',
  });
  ctx.restore();
}

export default {
  id: 'arch',
  dur: 8.0,
  title: '架构 · 编码器与解码器',
  subs: [
    { t0: 0.4, t1: 2.6, s: '编码器把输入读懂，解码器再一个词一个词地写出来。' },
    { t0: 2.8, t1: 4.6, s: '解码器的自注意力带掩码，只能看左边已经生成的词。' },
    { t0: 4.8, t1: 7.2, s: '同时通过交叉注意力，读取编码器理解好的结果。' },
  ],
  draw(ctx, lt) {
    const aTitle = seq(lt, 0.05, 0.5);
    text(ctx, 'Transformer 整体架构', W / 2, 176, {
      size: 44,
      weight: 800,
      align: 'center',
      baseline: 'middle',
      alpha: aTitle,
    });

    /* 编码器 */
    const aEx = seq(lt, 0.5, 0.6);
    text(ctx, 'Encoder 编码器', EX + EW / 2, 240, {
      size: 30,
      weight: 800,
      align: 'center',
      baseline: 'middle',
      color: C.cyan,
      alpha: aEx,
    });
    text(ctx, '理解输入', EX + EW / 2, 274, {
      size: 19,
      weight: 500,
      align: 'center',
      baseline: 'middle',
      color: C.faint,
      alpha: aEx,
    });
    for (let i = 0; i < 6; i++) {
      const p = seq(lt, 0.8 + i * 0.12, 0.45, easeOut);
      if (p <= 0.01) continue;
      const y = BY + i * (BH + BG);
      ctx.save();
      ctx.globalAlpha *= p;
      fillRR(ctx, EX, y, EW, BH, 12, 'rgba(16,24,42,0.88)');
      strokeRR(ctx, EX, y, EW, BH, 12, 'rgba(34,211,238,0.4)', 1.5);
      text(ctx, `Block ${i + 1}`, EX + 16, y + 20, { size: 17, weight: 700, color: C.faint, baseline: 'middle' });
      subBar(ctx, EX + 16, y + 32, 268, 'Multi-Head Attention', 'rgba(34,211,238,0.6)', 1);
      subBar(ctx, EX + 16, y + 56, 268, 'Feed Forward', 'rgba(74,222,128,0.6)', 1);
      ctx.restore();
    }
    text(ctx, '输入：', EX - 20, BY + BH / 2, {
      size: 22,
      weight: 700,
      align: 'right',
      baseline: 'middle',
      color: C.dim,
      alpha: aEx,
    });
    arrow(ctx, EX - 16, BY + BH / 2, EX + 10, BY + BH / 2, { color: C.dim, width: 2.5, size: 12, alpha: aEx });

    /* 解码器 */
    const aDe = seq(lt, 1.4, 0.6);
    text(ctx, 'Decoder 解码器', DE + DW / 2, 240, {
      size: 30,
      weight: 800,
      align: 'center',
      baseline: 'middle',
      color: C.purple,
      alpha: aDe,
    });
    text(ctx, '生成输出', DE + DW / 2, 274, {
      size: 19,
      weight: 500,
      align: 'center',
      baseline: 'middle',
      color: C.faint,
      alpha: aDe,
    });
    for (let i = 0; i < 6; i++) {
      const p = seq(lt, 1.7 + i * 0.12, 0.45, easeOut);
      if (p <= 0.01) continue;
      const y = BY + i * (BH + BG);
      ctx.save();
      ctx.globalAlpha *= p;
      fillRR(ctx, DE, y, DW, BH, 12, 'rgba(16,24,42,0.88)');
      strokeRR(ctx, DE, y, DW, BH, 12, 'rgba(167,139,250,0.45)', 1.5);
      text(ctx, `Block ${i + 1}`, DE + 16, y + 18, { size: 17, weight: 700, color: C.faint, baseline: 'middle' });
      subBar(ctx, DE + 16, y + 28, 268, 'Masked Multi-Head Attention', 'rgba(167,139,250,0.6)', 1);
      subBar(ctx, DE + 16, y + 50, 268, 'Cross-Attention', 'rgba(255,179,71,0.65)', 1);
      subBar(ctx, DE + 16, y + 70, 268, 'Feed Forward', 'rgba(74,222,128,0.6)', 1);
      ctx.restore();
    }

    /* 交叉注意力连线 */
    const aCross = seq(lt, 3.0, 0.7);
    if (aCross > 0.01) {
      const ey = BY + 2 * (BH + BG) + 30;
      const dy = BY + 2 * (BH + BG) + 56;
      curveArrow(ctx, EX + EW, ey, EX + EW + 300, (ey + dy) / 2 - 60, DE, dy, {
        color: C.q,
        width: 3,
        size: 15,
        alpha: aCross,
        progress: aCross,
      });
      text(ctx, '交叉注意力', EX + EW + 150, 236, {
        size: 24,
        weight: 700,
        align: 'center',
        baseline: 'middle',
        color: C.q,
        alpha: aCross,
      });
    }

    /* 掩码示意 */
    const aMask = seq(lt, 2.9, 0.6);
    if (aMask > 0.01) {
      const mx = 1620;
      const my = 300;
      const c = 26;
      panel(ctx, mx - 14, my - 46, 4 * c + 28 + 28, 4 * c + 92, {
        fill: 'rgba(16,24,42,0.8)',
        stroke: C.line,
        radius: 14,
        lw: 1.5,
        alpha: aMask,
      });
      text(ctx, 'Masked 自注意力', mx, my - 18, {
        size: 21,
        weight: 700,
        color: C.purple,
        baseline: 'middle',
        alpha: aMask,
      });
      for (let r = 0; r < 4; r++) {
        for (let cIdx = 0; cIdx < 4; cIdx++) {
          const blocked = cIdx > r;
          const p = seq(lt, 3.2 + (r * 4 + cIdx) * 0.04, 0.3);
          if (p <= 0.01) continue;
          ctx.save();
          ctx.globalAlpha *= p;
          fillRR(
            ctx,
            mx + cIdx * (c + 3),
            my + 8 + r * (c + 3),
            c,
            c,
            4,
            blocked ? 'rgba(120,140,175,0.18)' : heat(0.75 - r * 0.12)
          );
          ctx.restore();
        }
      }
      text(ctx, '只能看左边', mx, my + 4 * (c + 3) + 30, {
        size: 19,
        weight: 600,
        color: C.dim,
        baseline: 'middle',
        alpha: aMask,
      });
    }

    /* 生成循环 */
    const aLoop = seq(lt, 4.6, 0.7);
    if (aLoop > 0.01) {
      const bx = DE + DW / 2;
      const by = BY + 6 * (BH + BG) + 20;
      panel(ctx, bx - 190, by, 380, 74, {
        fill: 'rgba(34,211,238,0.10)',
        stroke: C.cyan,
        radius: 16,
        lw: 2,
        alpha: aLoop,
      });
      text(ctx, '输出概率 → 选一个词', bx, by + 26, {
        size: 23,
        weight: 700,
        color: C.cyan,
        align: 'center',
        baseline: 'middle',
        alpha: aLoop,
      });
      text(ctx, '→ 作为下一个输入', bx, by + 54, {
        size: 19,
        weight: 500,
        color: C.dim,
        align: 'center',
        baseline: 'middle',
        alpha: aLoop,
      });
      curveArrow(ctx, DE - 6, by + 37, DE - 200, by + 37, DE - 6, BY + 6 * (BH + BG) - 10, {
        color: C.cyan,
        width: 2.5,
        size: 13,
        alpha: aLoop * 0.8,
        dash: [9, 7],
        progress: aLoop,
      });
    }

    const aNote = seq(lt, 5.6, 0.6);
    text(ctx, '整件事可以并行完成：所有位置的注意力一次算完', W / 2, 920, {
      size: 27,
      weight: 600,
      align: 'center',
      baseline: 'middle',
      color: C.dim,
      alpha: aNote,
    });
  },
};
