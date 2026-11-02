// scenes/block.js — 一个 Transformer Block（残差 + LayerNorm + FFN），再堆叠成 6 层
import { W, H, C, text, panel, arrow, curveArrow, fillRR, strokeRR, MONO } from '../draw.js';
import { seq, easeOut, easeOutBack, clamp } from '../ease.js';

const STAGES = [0.35, 0.8, 1.6, 2.2, 2.8, 3.5, 4.0, 4.6];

function box(ctx, x, y, w, h, title, sub, color, alpha) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  panel(ctx, x, y, w, h, { fill: 'rgba(16,24,42,0.88)', stroke: color, radius: 16, lw: 2 });
  text(ctx, title, x + w / 2, y + h / 2 - (sub ? 14 : 0), {
    size: 27,
    weight: 700,
    color: C.text,
    align: 'center',
    baseline: 'middle',
  });
  if (sub) {
    text(ctx, sub, x + w / 2, y + h / 2 + 22, {
      size: 18,
      weight: 500,
      color: C.faint,
      align: 'center',
      baseline: 'middle',
    });
  }
  ctx.restore();
}

function plus(ctx, cx, cy, r, alpha) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.strokeStyle = C.q;
  ctx.lineWidth = 3;
  ctx.fillStyle = 'rgba(255,179,71,0.12)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.45, cy);
  ctx.lineTo(cx + r * 0.45, cy);
  ctx.moveTo(cx, cy - r * 0.45);
  ctx.lineTo(cx, cy + r * 0.45);
  ctx.stroke();
  ctx.restore();
}

function drawDiagram(ctx, alphaOf, lineAlpha) {
  const a = alphaOf;
  // 输入
  if (a(0) > 0.01) {
    ctx.save();
    ctx.globalAlpha *= a(0);
    panel(ctx, 70, 390, 80, 80, { fill: 'rgba(255,255,255,0.05)', stroke: 'rgba(143,180,255,0.5)', radius: 14, lw: 1.5 });
    text(ctx, 'x', 110, 430, { size: 34, weight: 800, family: MONO, align: 'center', baseline: 'middle' });
    ctx.restore();
    arrow(ctx, 150, 430, 232, 430, { color: C.dim, width: 2.5, size: 12, alpha: a(0) });
  }
  // Multi-Head Attention
  box(ctx, 240, 358, 330, 144, '多头注意力', 'Multi-Head Attention', C.cyan, a(1));
  if (a(1) > 0.01) arrow(ctx, 570, 430, 640, 430, { color: C.dim, width: 2.5, size: 12, alpha: a(1) });

  // 残差 1
  curveArrow(ctx, 110, 386, 420, 150, 690, 386, {
    color: C.q,
    width: 2.5,
    size: 13,
    alpha: lineAlpha * 0.9,
    dash: [10, 8],
    progress: a(2),
  });
  plus(ctx, 690, 430, 40, a(2));
  text(ctx, '残差连接', 420, 132, {
    size: 20,
    weight: 700,
    align: 'center',
    baseline: 'middle',
    color: C.q,
    alpha: a(2),
  });
  if (a(2) > 0.01) arrow(ctx, 730, 430, 782, 430, { color: C.dim, width: 2.5, size: 12, alpha: a(2) });

  // LayerNorm
  box(ctx, 790, 380, 150, 100, 'LayerNorm', null, C.purple, a(3));
  if (a(3) > 0.01) arrow(ctx, 940, 430, 992, 430, { color: C.dim, width: 2.5, size: 12, alpha: a(3) });

  // FFN
  box(ctx, 1000, 358, 300, 144, '前馈网络', 'Feed Forward Network', C.v, a(4));
  if (a(4) > 0.01) arrow(ctx, 1300, 430, 1362, 430, { color: C.dim, width: 2.5, size: 12, alpha: a(4) });

  // 残差 2
  curveArrow(ctx, 940, 376, 1180, 210, 1410, 386, {
    color: C.q,
    width: 2.5,
    size: 13,
    alpha: lineAlpha * 0.9,
    dash: [10, 8],
    progress: a(5),
  });
  plus(ctx, 1410, 430, 40, a(5));
  if (a(5) > 0.01) arrow(ctx, 1450, 430, 1502, 430, { color: C.dim, width: 2.5, size: 12, alpha: a(5) });

  // LayerNorm 2
  box(ctx, 1510, 380, 150, 100, 'LayerNorm', null, C.purple, a(6));
  if (a(6) > 0.01) arrow(ctx, 1660, 430, 1712, 430, { color: C.dim, width: 2.5, size: 12, alpha: a(6) });
  if (a(7) > 0.01) {
    text(ctx, '输出', 1730, 430, { size: 28, weight: 700, color: C.text, baseline: 'middle', alpha: a(7) });
  }
}

export default {
  id: 'block',
  dur: 10.0,
  title: '模块 · 一个 Transformer Block',
  subs: [
    { t0: 0.4, t1: 2.2, s: '注意力外面，还包着残差连接和层归一化。' },
    { t0: 2.4, t1: 4.4, s: '再加一个逐位置的前馈网络：注意力负责「交流」，FFN 负责「消化」。' },
    { t0: 4.8, t1: 6.4, s: '这样一个模块，就叫一个 Transformer Block。' },
    { t0: 6.8, t1: 9.4, s: '把它堆叠 6 层，一层一层地加深对句子的理解。' },
  ],
  draw(ctx, lt) {
    const phaseB = seq(lt, 5.4, 0.8);

    if (phaseB < 0.999) {
      const fade = 1 - phaseB;
      ctx.save();
      ctx.globalAlpha *= fade;
      const alphaOf = (i) => (lt < 5.2 ? seq(lt, STAGES[i], 0.55) : 1);
      drawDiagram(ctx, alphaOf, 1);
      ctx.restore();
    }

    if (phaseB > 0.01) {
      const a = phaseB;
      ctx.save();
      ctx.globalAlpha *= a;
      ctx.translate(130, 150);
      ctx.scale(0.62, 0.62);
      drawDiagram(ctx, () => 0.42, 0.42);
      ctx.restore();

      // 标题
      text(ctx, '堆叠 6 层', 1520, 250, {
        size: 40,
        weight: 800,
        align: 'center',
        baseline: 'middle',
        color: C.text,
        alpha: a,
      });
      text(ctx, '每一层都把表示抽象一层', 1520, 296, {
        size: 22,
        weight: 500,
        align: 'center',
        baseline: 'middle',
        color: C.dim,
        alpha: a,
      });

      // 层塔
      const TX = 1300;
      const TW = 440;
      const BH = 62;
      const BG = 12;
      for (let i = 0; i < 6; i++) {
        const p = seq(lt, 5.8 + i * 0.16, 0.5, easeOutBack);
        if (p <= 0.01) continue;
        const y = 340 + i * (BH + BG) + (1 - p) * 18;
        ctx.save();
        ctx.globalAlpha *= p;
        fillRR(ctx, TX, y, TW, BH, 12, 'rgba(16,24,42,0.88)');
        strokeRR(ctx, TX, y, TW, BH, 12, i === 5 ? C.q : 'rgba(143,180,255,0.35)', i === 5 ? 2 : 1.4);
        text(ctx, `第 ${i + 1} 层`, TX + 22, y + BH / 2, {
          size: 20,
          weight: 700,
          color: i === 5 ? C.q : C.dim,
          baseline: 'middle',
        });
        fillRR(ctx, TX + 116, y + 16, 250, 12, 6, 'rgba(34,211,238,0.55)');
        fillRR(ctx, TX + 116, y + 34, 250, 12, 6, 'rgba(74,222,128,0.55)');
        text(ctx, 'MHA', TX + 382, y + 22, { size: 15, weight: 700, color: C.faint, baseline: 'middle' });
        text(ctx, 'FFN', TX + 382, y + 40, { size: 15, weight: 700, color: C.faint, baseline: 'middle' });
        ctx.restore();
      }
      text(ctx, '词 → 短语 → 句意 → 更抽象的表示', 1520, 800, {
        size: 24,
        weight: 600,
        align: 'center',
        baseline: 'middle',
        color: C.dim,
        alpha: a,
      });
    }
  },
};
