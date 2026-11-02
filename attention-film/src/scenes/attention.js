// scenes/attention.js — 核心：一次注意力计算的全过程
import {
  W,
  H,
  C,
  text,
  panel,
  curveArrow,
  vectorBars,
  vectorWidth,
  fillRR,
  strokeRR,
  MONO,
} from '../draw.js';
import { seq, easeOut, clamp, lerp } from '../ease.js';
import { TOKENS, ROW, rowX, rowCX, FOCUS, SCORES, WEIGHTS, VEC } from '../data.js';

const HEAD_Y = 392; // 列标题基线
const SCORE_Y = 452; // 分数基线
const W_BASE = 606; // 权重条基线
const W_MAX = 116;
const V_BASE = 724; // w·v 基线
const V_MAX = 58;
const OUT = { x: 690, y: 772, w: 540, h: 132 };

function chip(ctx, i, alpha) {
  const x = rowX(i);
  const focus = i === FOCUS;
  ctx.save();
  ctx.globalAlpha *= alpha;
  fillRR(ctx, x, ROW.y, ROW.w, ROW.h, 18, focus ? 'rgba(255,179,71,0.14)' : 'rgba(255,255,255,0.05)');
  strokeRR(ctx, x, ROW.y, ROW.w, ROW.h, 18, focus ? C.q : 'rgba(143,180,255,0.45)', focus ? 2.5 : 1.5);
  text(ctx, TOKENS[i], x + ROW.w / 2, ROW.y + ROW.h / 2, {
    size: 38,
    weight: 700,
    align: 'center',
    baseline: 'middle',
    color: focus ? '#ffd9a1' : '#cfdcf2',
  });
  ctx.restore();
}

export default {
  id: 'calc',
  dur: 9.0,
  title: '计算 · 一次注意力是怎么算出来的',
  subs: [
    { t0: 0.3, t1: 2.3, s: '以「蝴蝶」为例：它的 Query 挨个去和别人的 Key 比对。' },
    { t0: 2.5, t1: 4.2, s: '比出来的分数做 softmax，就变成了「我该看谁」的权重。' },
    { t0: 4.4, t1: 6.4, s: '用权重去加权别人的 Value，汇总成「蝴蝶」的新表示。' },
    { t0: 6.8, t1: 8.9, s: '这就是 Self-Attention：一个词的新含义，来自它和上下文的关系。' },
  ],
  draw(ctx, lt) {
    /* --- 顶部：Q(蝴蝶) --- */
    const aQ = seq(lt, 0.1, 0.5);
    if (aQ > 0.01) {
      const cw = 300;
      const x = rowCX(FOCUS) - cw / 2;
      const y = 122;
      ctx.save();
      ctx.globalAlpha *= aQ;
      panel(ctx, x, y, cw, 92, { fill: 'rgba(255,179,71,0.10)', stroke: C.q, radius: 16, lw: 2 });
      text(ctx, 'Q', x + 24, y + 46, { size: 40, weight: 800, color: C.q, baseline: 'middle' });
      text(ctx, '「蝴蝶」的 Query', x + 64, y + 34, { size: 21, weight: 700, color: C.text, baseline: 'middle' });
      vectorBars(ctx, x + 64, y + 76, VEC.q, { cellW: 10, barH: 26, gap: 5, color: C.q });
      ctx.restore();
    }

    /* --- 词行 --- */
    TOKENS.forEach((_, i) => {
      const appear = seq(lt, 0.05 + Math.abs(i - FOCUS) * 0.05, 0.4);
      chip(ctx, i, appear);
    });

    /* --- 聚焦列高亮 --- */
    const aCol = seq(lt, 0.6, 0.5);
    if (aCol > 0.01) {
      ctx.save();
      ctx.globalAlpha *= aCol * 0.9;
      const g = ctx.createLinearGradient(0, HEAD_Y - 30, 0, V_BASE + 10);
      g.addColorStop(0, 'rgba(255,179,71,0.16)');
      g.addColorStop(1, 'rgba(255,179,71,0.02)');
      fillRR(ctx, rowCX(FOCUS) - ROW.w / 2 - 6, HEAD_Y - 30, ROW.w + 12, V_BASE - HEAD_Y + 46, 16, g);
      ctx.restore();
    }

    /* --- 列标题 --- */
    const aHead = seq(lt, 0.5, 0.5);
    TOKENS.forEach((tk, i) => {
      text(ctx, tk, rowCX(i), HEAD_Y, {
        size: 24,
        weight: 600,
        align: 'center',
        baseline: 'middle',
        alpha: aHead * (i === FOCUS ? 1 : 0.75),
        color: i === FOCUS ? C.q : C.dim,
      });
    });

    /* --- 扫描光束 + 分数 --- */
    const sweepStart = 0.9;
    const sweepDur = 1.7;
    const beamA = seq(lt, sweepStart, 0.25) * (1 - seq(lt, sweepStart + sweepDur, 0.35));
    if (beamA > 0.01) {
      const p = clamp((lt - sweepStart) / sweepDur);
      const x = lerp(rowCX(0) - 60, rowCX(4) + 60, p);
      const g = ctx.createLinearGradient(x - 90, 0, x + 90, 0);
      g.addColorStop(0, 'rgba(255,179,71,0)');
      g.addColorStop(0.5, 'rgba(255,179,71,0.20)');
      g.addColorStop(1, 'rgba(255,179,71,0)');
      ctx.save();
      ctx.globalAlpha *= beamA;
      fillRR(ctx, x - 90, SCORE_Y - 46, 180, 74, 12, g);
      ctx.restore();
    }

    TOKENS.forEach((_, i) => {
      const t0 = sweepStart + i * 0.34;
      const p = seq(lt, t0, 0.3);
      if (p <= 0.01) return;
      const val = SCORES[i] * p;
      text(ctx, val.toFixed(1), rowCX(i), SCORE_Y, {
        size: 40,
        weight: 800,
        family: MONO,
        align: 'center',
        baseline: 'middle',
        alpha: p,
        color: C.q,
      });
    });
    text(ctx, 'q · k 相似度分数', 250, SCORE_Y, {
      size: 24,
      weight: 600,
      align: 'right',
      baseline: 'middle',
      alpha: seq(lt, 0.8, 0.5),
      color: C.dim,
    });

    /* --- softmax 权重 --- */
    const aSoft = seq(lt, 2.5, 0.5);
    text(ctx, 'softmax → 权重', 250, 552, {
      size: 24,
      weight: 700,
      align: 'right',
      baseline: 'middle',
      alpha: aSoft,
      color: C.purple,
    });
    if (aSoft > 0.01) {
      const g = ctx.createLinearGradient(0, W_BASE - W_MAX, 0, W_BASE);
      g.addColorStop(0, 'rgba(34,211,238,0.95)');
      g.addColorStop(1, 'rgba(34,211,238,0.25)');
      TOKENS.forEach((_, i) => {
        const p = seq(lt, 2.9 + i * 0.12, 0.55, easeOut);
        if (p <= 0.01) return;
        const h = WEIGHTS[i] * W_MAX * p;
        const w = 74;
        ctx.save();
        ctx.globalAlpha *= p;
        fillRR(ctx, rowCX(i) - w / 2, W_BASE - h, w, h, 8, g);
        text(ctx, (WEIGHTS[i] * 100 * p).toFixed(0) + '%', rowCX(i), W_BASE - h - 18, {
          size: 22,
          weight: 700,
          family: MONO,
          align: 'center',
          baseline: 'middle',
          color: C.cyan,
        });
        ctx.restore();
      });
    }

    /* --- 加权 Value --- */
    const aV = seq(lt, 3.8, 0.5);
    text(ctx, '权重 × Value', 250, 690, {
      size: 24,
      weight: 600,
      align: 'right',
      baseline: 'middle',
      alpha: aV,
      color: C.dim,
    });
    TOKENS.forEach((_, i) => {
      const p = seq(lt, 4.0 + i * 0.1, 0.5);
      if (p <= 0.01) return;
      const bw = vectorWidth(6, 10, 5);
      const x = rowCX(i) - bw / 2;
      ctx.save();
      ctx.globalAlpha *= p;
      vectorBars(ctx, x, V_BASE, VEC.v[i], {
        cellW: 10,
        barH: V_MAX,
        gap: 5,
        color: C.v,
        scale: WEIGHTS[i] * 2.1,
        dim: 0.18,
      });
      ctx.restore();
    });

    /* --- 汇聚成输出 --- */
    const aOut = seq(lt, 5.0, 0.6);
    TOKENS.forEach((_, i) => {
      const p = seq(lt, 4.7 + i * 0.1, 0.6);
      if (p <= 0.01) return;
      curveArrow(ctx, rowCX(i), V_BASE + 6, (rowCX(i) + OUT.x + OUT.w / 2) / 2, V_BASE + 46, OUT.x + OUT.w / 2, OUT.y - 6, {
        color: C.v,
        width: 2.2,
        size: 11,
        alpha: p * 0.85,
        progress: p,
      });
    });
    if (aOut > 0.01) {
      ctx.save();
      ctx.globalAlpha *= aOut;
      panel(ctx, OUT.x, OUT.y, OUT.w, OUT.h, { fill: 'rgba(74,222,128,0.08)', stroke: C.v, radius: 18, lw: 2 });
      text(ctx, '「蝴蝶」的新表示', OUT.x + 28, OUT.y + 38, { size: 26, weight: 700, color: '#bbf7d0' });
      text(ctx, '= Σ wᵢ · vᵢ', OUT.x + 28, OUT.y + 78, { size: 24, weight: 600, family: MONO, color: C.dim });
      const bw = vectorWidth(6, 16, 7);
      vectorBars(ctx, OUT.x + OUT.w - 28 - bw, OUT.y + OUT.h - 26, VEC.out, {
        cellW: 16,
        barH: 74,
        gap: 7,
        color: C.v,
      });
      ctx.restore();
    }

    /* --- 公式（放左上角，避开顶部的 Q 卡片） --- */
    const aF = seq(lt, 6.4, 0.7);
    if (aF > 0.01) {
      const parts = [
        ['Attention', C.dim],
        ['(', C.dim],
        ['Q', C.q],
        [',', C.dim],
        ['K', C.k],
        [',', C.dim],
        ['V', C.v],
        [') = ', C.dim],
        ['softmax', C.purple],
        ['(', C.dim],
        ['QK', C.text],
        ['^T', C.dim],
        ['/√d', C.dim],
        ['_k', C.dim],
        [')·', C.dim],
        ['V', C.v],
      ];
      ctx.save();
      ctx.globalAlpha *= aF;
      ctx.font = `700 26px ${MONO}`;
      let x = 130;
      for (const [s, col] of parts) {
        text(ctx, s, x, 176, { size: 26, weight: 700, family: MONO, color: col, baseline: 'middle' });
        x += ctx.measureText(s).width;
      }
      ctx.restore();
    }
  },
};
