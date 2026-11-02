// scenes/outro.js — 收尾：公式 + 三句话总结
import { W, H, C, text, panel, fillRR, strokeRR, MONO } from '../draw.js';
import { seq, easeOutBack, clamp } from '../ease.js';

const FORMULA = [
  ['Attention(', '#93a5c4'],
  ['Q', C.q],
  [', ', '#93a5c4'],
  ['K', C.k],
  [', ', '#93a5c4'],
  ['V', C.v],
  [') = ', '#93a5c4'],
  ['softmax', C.purple],
  ['(', '#93a5c4'],
  ['Q', C.q],
  ['K', C.k],
  ['^T', '#93a5c4'],
  [' / √d_k', '#93a5c4'],
  [')', '#93a5c4'],
  ['V', C.v],
];

const POINTS = [
  ['每个词，同时看所有词', C.cyan],
  ['权重由内容决定，所以可以被解释', C.q],
  ['多头并行 + 层层堆叠 = 表达力', C.v],
];

export default {
  id: 'outro',
  dur: 6.0,
  title: '收尾 · 一行公式，三句话',
  subs: [
    { t0: 0.4, t1: 2.4, s: '最后，把这一切压缩成这一行公式。' },
    { t0: 2.6, t1: 4.2, s: '查询、比对、归一化、加权求和——四步，就是全部的秘密。' },
    { t0: 4.4, t1: 5.9, s: 'Attention Is All You Need，2017。' },
  ],
  draw(ctx, lt) {
    const aF = seq(lt, 0.2, 0.7);
    if (aF > 0.01) {
      ctx.save();
      ctx.globalAlpha *= aF;
      ctx.font = `800 62px ${MONO}`;
      let total = 0;
      for (const [s] of FORMULA) total += ctx.measureText(s).width;
      let x = (W - total) / 2;
      for (const [s, col] of FORMULA) {
        text(ctx, s, x, 300, { size: 62, weight: 800, family: MONO, color: col, baseline: 'middle' });
        x += ctx.measureText(s).width;
      }
      ctx.restore();
    }
    const aLine = seq(lt, 0.7, 0.8);
    if (aLine > 0.01) {
      const lw = 1180 * aLine;
      ctx.save();
      ctx.globalAlpha *= aLine;
      fillRR(ctx, (W - lw) / 2, 356, lw, 3, 2, 'rgba(147,165,196,0.5)');
      ctx.restore();
    }

    POINTS.forEach((p, i) => {
      const t0 = 1.5 + i * 0.85;
      const a = seq(lt, t0, 0.6, easeOutBack);
      if (a <= 0.01) return;
      const y = 470 + i * 118;
      ctx.save();
      ctx.globalAlpha *= a;
      fillRR(ctx, W / 2 - 420, y - 34, 840, 68, 20, 'rgba(16,24,42,0.8)');
      strokeRR(ctx, W / 2 - 420, y - 34, 840, 68, 20, p[1], 1.6);
      fillRR(ctx, W / 2 - 390, y - 8, 16, 16, 8, p[1]);
      text(ctx, p[0], W / 2 - 340, y, {
        size: 30,
        weight: 700,
        color: C.text,
        baseline: 'middle',
      });
      ctx.restore();
    });

    const aEnd = seq(lt, 4.2, 0.8);
    text(ctx, 'Attention Is All You Need', W / 2, 862, {
      size: 30,
      weight: 700,
      align: 'center',
      baseline: 'middle',
      alpha: aEnd,
      color: C.dim,
    });
    text(ctx, 'Vaswani et al., 2017', W / 2, 902, {
      size: 20,
      weight: 500,
      align: 'center',
      baseline: 'middle',
      alpha: aEnd * 0.8,
      color: C.faint,
    });
  },
};
