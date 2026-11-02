// scenes/intro.js — 开场：标题 + 「词 → Transformer → 新词」预告
import { W, H, C, text, fillRR, strokeRR, arrow, mover } from '../draw.js';
import { seq, easeOutBack, easeOut, clamp } from '../ease.js';
import { TOKENS } from '../data.js';

const CHIP_W = 118;
const CHIP_H = 64;
const CHIP_GAP = 22;
const IN_X0 = 250;
const BOX_X = 1030;
const BOX_W = 330;
const OUT_X0 = 1440;

export default {
  id: 'intro',
  dur: 5.0,
  title: '开场 · 一句话的前情提要',
  subs: [
    { t0: 0.3, t1: 2.4, s: '一分钟，看懂 Self-Attention 到 Transformer 的全部原理。' },
    { t0: 2.6, t1: 4.9, s: '先记住一句话：每个字，都会同时看到其他所有的字。' },
  ],
  draw(ctx, lt) {
    const a1 = seq(lt, 0.1, 0.8);
    const a2 = seq(lt, 0.5, 0.7);

    text(ctx, 'Self-Attention → Transformer', W / 2, 196, {
      size: 92,
      weight: 800,
      align: 'center',
      baseline: 'middle',
      alpha: a1,
    });
    const lw = 470 * seq(lt, 0.7, 0.9);
    ctx.save();
    ctx.globalAlpha *= a1;
    fillRR(ctx, W / 2 - lw / 2, 254, lw, 3, 2, C.cyan);
    ctx.restore();
    text(ctx, '60 秒图解注意力机制', W / 2, 316, {
      size: 36,
      weight: 500,
      align: 'center',
      baseline: 'middle',
      alpha: a2,
      color: C.dim,
    });

    /* ---------------- 预告小动画 ---------------- */
    const rowY = 612;
    const boxY = rowY - 55;
    const aBox = seq(lt, 3.0, 0.5);

    // 输入词（整排一起滑进 Transformer）
    const flow = seq(lt, 3.45, 0.7);
    TOKENS.forEach((tk, i) => {
      const appear = seq(lt, 2.3 + i * 0.13, 0.55, easeOutBack);
      const x = IN_X0 + i * (CHIP_W + CHIP_GAP) + flow * 700;
      const alpha = appear * (1 - flow);
      if (alpha <= 0.01) return;
      ctx.save();
      ctx.globalAlpha *= alpha;
      fillRR(ctx, x, rowY, CHIP_W, CHIP_H, 14, 'rgba(255,255,255,0.05)');
      strokeRR(ctx, x, rowY, CHIP_W, CHIP_H, 14, 'rgba(143,180,255,0.5)', 1.5);
      text(ctx, tk, x + CHIP_W / 2, rowY + CHIP_H / 2, {
        size: 30,
        weight: 600,
        align: 'center',
        baseline: 'middle',
        color: '#cfe0ff',
      });
      ctx.restore();
    });

    // 箭头 + 流动光点
    const aArrow = seq(lt, 3.0, 0.5);
    arrow(ctx, IN_X0 + 5 * (CHIP_W + CHIP_GAP) - CHIP_GAP + 6, rowY + CHIP_H / 2, BOX_X - 12, rowY + CHIP_H / 2, {
      color: C.dim,
      width: 2.5,
      size: 12,
      alpha: aArrow,
    });
    for (let i = 0; i < 3; i++) {
      const p = ((lt - 3.2 - i * 0.22) / 0.9) % 1;
      if (p > 0 && p < 1) {
        mover(ctx, IN_X0 + 5 * (CHIP_W + CHIP_GAP) + 6, rowY + CHIP_H / 2, BOX_X - 12, rowY + CHIP_H / 2, p, {
          color: C.cyan,
          r: 5,
          alpha: 0.8,
          glow: 12,
        });
      }
    }

    // Transformer 黑盒（不透明：进去的词被它吞掉）
    ctx.save();
    ctx.globalAlpha *= aBox;
    fillRR(ctx, BOX_X, boxY, BOX_W, 110, 18, '#08101e');
    strokeRR(ctx, BOX_X, boxY, BOX_W, 110, 18, C.cyan, 2);
    text(ctx, 'Transformer', BOX_X + BOX_W / 2, boxY + 42, {
      size: 34,
      weight: 800,
      align: 'center',
      baseline: 'middle',
      color: C.cyan,
    });
    text(ctx, '一堆会算矩阵的层', BOX_X + BOX_W / 2, boxY + 78, {
      size: 20,
      weight: 500,
      align: 'center',
      baseline: 'middle',
      color: C.dim,
    });
    ctx.restore();

    // 输出词
    arrow(ctx, BOX_X + BOX_W + 12, rowY + CHIP_H / 2, OUT_X0 - 12, rowY + CHIP_H / 2, {
      color: C.dim,
      width: 2.5,
      size: 12,
      alpha: aArrow,
    });
    ['小猫', '追着', '蝴蝶'].forEach((tk, i) => {
      const appear = seq(lt, 4.05 + i * 0.16, 0.5, easeOutBack);
      if (appear <= 0.01) return;
      const x = OUT_X0 + i * (CHIP_W + CHIP_GAP);
      ctx.save();
      ctx.globalAlpha *= appear;
      fillRR(ctx, x, rowY, CHIP_W, CHIP_H, 14, 'rgba(74,222,128,0.10)');
      strokeRR(ctx, x, rowY, CHIP_W, CHIP_H, 14, 'rgba(74,222,128,0.6)', 1.5);
      text(ctx, tk, x + CHIP_W / 2, rowY + CHIP_H / 2, {
        size: 30,
        weight: 600,
        align: 'center',
        baseline: 'middle',
        color: '#bbf7d0',
      });
      ctx.restore();
    });

    // 底部注释
    const aNote = seq(lt, 4.1, 0.6);
    text(ctx, '输入一句话 → 换一个角度看这句话 → 输出新的一句话', W / 2, 830, {
      size: 30,
      weight: 500,
      align: 'center',
      baseline: 'middle',
      alpha: aNote,
      color: C.dim,
    });
  },
};
