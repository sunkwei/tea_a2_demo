import * as THREE from 'three';
import { rand, randInt } from './rng.js';

export function createCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d') };
}

export function toTexture(canvas, opts = {}) {
  const {
    repeat = [1, 1],
    srgb = true,
    wrap = THREE.RepeatWrapping,
    aniso = 8,
    flipY = true,
  } = opts;
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = wrap;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = aniso;
  tex.flipY = flipY;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/* ------------------------------------------------------------------ */
/*  路面：湿沥青                                                      */
/* ------------------------------------------------------------------ */
export function makeAsphaltTextures() {
  const S = 512;
  const { canvas: c, ctx } = createCanvas(S, S);
  ctx.fillStyle = '#191b21';
  ctx.fillRect(0, 0, S, S);

  for (let i = 0; i < 14000; i++) {
    const g = 26 + Math.floor(rand() * 46);
    ctx.fillStyle = `rgba(${g},${g + 2},${g + 8},${rand(0.1, 0.5)})`;
    ctx.fillRect(rand(0, S), rand(0, S), rand(1, 2.4), rand(1, 2.4));
  }
  // 裂缝
  ctx.strokeStyle = 'rgba(8,9,12,0.75)';
  for (let i = 0; i < 26; i++) {
    ctx.lineWidth = rand(0.7, 2.1);
    ctx.beginPath();
    let x = rand(0, S);
    let y = rand(0, S);
    ctx.moveTo(x, y);
    for (let j = 0; j < 6; j++) {
      x += rand(-45, 45);
      y += rand(-45, 45);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // 淡淡的油渍
  for (let i = 0; i < 14; i++) {
    ctx.save();
    ctx.translate(rand(0, S), rand(0, S));
    const r = rand(30, 90);
    const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, r);
    grad.addColorStop(0, 'rgba(6,7,10,0.5)');
    grad.addColorStop(1, 'rgba(6,7,10,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 粗糙度：大部分粗糙，少量湿润的深色块
  const { canvas: rc, ctx: rctx } = createCanvas(S, S);
  rctx.fillStyle = '#d2d2d2';
  rctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) {
    const g = Math.floor(rand(120, 235));
    rctx.fillStyle = `rgba(${g},${g},${g},0.5)`;
    rctx.fillRect(rand(0, S), rand(0, S), 2, 2);
  }
  for (let i = 0; i < 20; i++) {
    const x = rand(0, S);
    const y = rand(0, S);
    const r = rand(40, 120);
    const grad = rctx.createRadialGradient(x, y, 1, x, y, r);
    grad.addColorStop(0, 'rgba(60,60,60,0.85)');
    grad.addColorStop(1, 'rgba(210,210,210,0)');
    rctx.fillStyle = grad;
    rctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  return {
    map: toTexture(c, { repeat: [10, 10] }),
    roughnessMap: toTexture(rc, { repeat: [10, 10], srgb: false }),
  };
}

/* ------------------------------------------------------------------ */
/*  人行道 / 水泥                                                     */
/* ------------------------------------------------------------------ */
export function makeConcreteTexture(repeat = [6, 3]) {
  const S = 512;
  const { canvas: c, ctx } = createCanvas(S, S);
  ctx.fillStyle = '#4a4c55';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 12000; i++) {
    const g = Math.floor(rand(50, 110));
    ctx.fillStyle = `rgba(${g},${g},${g + 4},${rand(0.06, 0.28)})`;
    ctx.fillRect(rand(0, S), rand(0, S), rand(1, 3), rand(1, 3));
  }
  // 分格缝
  ctx.strokeStyle = 'rgba(18,19,24,0.85)';
  ctx.lineWidth = 3;
  const step = S / 4;
  for (let i = 0; i <= 4; i++) {
    ctx.beginPath();
    ctx.moveTo(i * step, 0);
    ctx.lineTo(i * step, S);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * step);
    ctx.lineTo(S, i * step);
    ctx.stroke();
  }
  return toTexture(c, { repeat });
}

/* ------------------------------------------------------------------ */
/*  便利店外墙白瓷砖                                                  */
/* ------------------------------------------------------------------ */
export function makeTileTexture() {
  const S = 512;
  const { canvas: c, ctx } = createCanvas(S, S);
  ctx.fillStyle = '#e7e4dc';
  ctx.fillRect(0, 0, S, S);
  const n = 8;
  const step = S / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const shade = rand(-9, 9);
      ctx.fillStyle = `rgb(${231 + shade},${228 + shade},${219 + shade})`;
      ctx.fillRect(x * step + 1.5, y * step + 1.5, step - 3, step - 3);
      if (rand() < 0.12) {
        ctx.fillStyle = `rgba(150,146,136,${rand(0.05, 0.16)})`;
        ctx.fillRect(x * step + 1.5, y * step + 1.5, step - 3, step - 3);
      }
    }
  }
  ctx.strokeStyle = 'rgba(120,116,108,0.55)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= n; i++) {
    ctx.beginPath();
    ctx.moveTo(i * step, 0);
    ctx.lineTo(i * step, S);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * step);
    ctx.lineTo(S, i * step);
    ctx.stroke();
  }
  return toTexture(c, { repeat: [3, 1.4] });
}

/* ------------------------------------------------------------------ */
/*  霓虹招牌（同时产出 map 与 emissiveMap）                            */
/* ------------------------------------------------------------------ */
export function makeNeonSign({
  width = 1024,
  height = 320,
  bg = '#0b0710',
  lines = [],
  border = null,
}) {
  const { canvas: mapC, ctx } = createCanvas(width, height);
  const { canvas: emisC, ctx: ectx } = createCanvas(width, height);

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  ectx.fillStyle = '#000000';
  ectx.fillRect(0, 0, width, height);

  const drawLine = (target, glowOnly) => {
    target.textAlign = 'center';
    target.textBaseline = 'middle';
    for (const line of lines) {
      const size = line.size ?? 90;
      target.font = `${line.weight ?? 'bold'} ${size}px ${line.font ?? '"Microsoft YaHei", "PingFang SC", sans-serif'}`;
      target.shadowColor = line.color;
      target.shadowBlur = glowOnly ? (line.glow ?? 40) : (line.glow ?? 26);
      target.fillStyle = line.color;
      const y = line.y ?? height / 2;
      if (!glowOnly) {
        // 先画一层厚光晕，再叠一层白芯，更像真实霓虹管
        target.shadowBlur = (line.glow ?? 26) * 1.5;
        target.fillStyle = line.color;
        target.fillText(line.text, width / 2, y);
        target.shadowBlur = 10;
        target.fillStyle = '#fff8ff';
        target.globalAlpha = 0.42;
        target.fillText(line.text, width / 2, y);
        target.globalAlpha = 1;
      } else {
        target.fillText(line.text, width / 2, y);
      }
    }
    target.shadowBlur = 0;
  };

  if (border) {
    for (const [target, glowOnly] of [
      [ctx, false],
      [ectx, true],
    ]) {
      target.save();
      target.strokeStyle = border.color;
      target.shadowColor = border.color;
      target.shadowBlur = glowOnly ? 34 : 22;
      target.lineWidth = border.width ?? 8;
      const p = border.pad ?? 18;
      const r = border.radius ?? 18;
      target.beginPath();
      target.moveTo(p + r, p);
      target.lineTo(width - p - r, p);
      target.quadraticCurveTo(width - p, p, width - p, p + r);
      target.lineTo(width - p, height - p - r);
      target.quadraticCurveTo(width - p, height - p, width - p - r, height - p);
      target.lineTo(p + r, height - p);
      target.quadraticCurveTo(p, height - p, p, height - p - r);
      target.lineTo(p, p + r);
      target.quadraticCurveTo(p, p, p + r, p);
      target.stroke();
      target.restore();
    }
  }

  drawLine(ctx, false);
  drawLine(ectx, true);

  return {
    map: toTexture(mapC, { wrap: THREE.ClampToEdgeWrapping }),
    emissiveMap: toTexture(emisC, { wrap: THREE.ClampToEdgeWrapping }),
  };
}

/* ------------------------------------------------------------------ */
/*  海报 / 灯箱                                                        */
/* ------------------------------------------------------------------ */
export function makePosterTexture({
  title = '热汤',
  sub = '500ml',
  bg = '#ff3f7f',
  fg = '#fff6d8',
  accent = '#ffe27a',
  vertical = false,
}) {
  const W = vertical ? 256 : 512;
  const H = vertical ? 512 : 256;
  const { canvas, ctx } = createCanvas(W, H);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = accent;
  ctx.fillRect(0, H - 14, W, 14);
  ctx.fillRect(0, 0, W, 14);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = fg;
  ctx.font = `bold ${vertical ? 92 : 120}px "Microsoft YaHei", sans-serif`;
  ctx.fillText(title, W / 2, H / 2 - 18);
  ctx.font = `bold ${vertical ? 44 : 52}px "Microsoft YaHei", sans-serif`;
  ctx.globalAlpha = 0.85;
  ctx.fillText(sub, W / 2, H / 2 + 62);
  ctx.globalAlpha = 1;
  return toTexture(canvas, { wrap: THREE.ClampToEdgeWrapping });
}

/* ------------------------------------------------------------------ */
/*  自动售货机面板                                                    */
/* ------------------------------------------------------------------ */
export function makeVendingTexture() {
  const W = 512;
  const H = 768;
  const { canvas, ctx } = createCanvas(W, H);
  ctx.fillStyle = '#101319';
  ctx.fillRect(0, 0, W, H);

  const colors = ['#ff5f6d', '#ffb03a', '#4fd1c5', '#5b8cff', '#c86bff', '#7bed9f', '#ff8fab'];
  for (let row = 0; row < 5; row++) {
    const y = 118 + row * 118;
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(28, y - 48, W - 56, 96);
    for (let i = 0; i < 6; i++) {
      const x = 46 + i * 72;
      const c = colors[(row * 3 + i) % colors.length];
      ctx.fillStyle = c;
      ctx.fillRect(x, y - 40, 52, 74);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillRect(x + 8, y - 26, 36, 8);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(x + 8, y + 2, 36, 22);
    }
  }
  // 顶部灯箱
  ctx.fillStyle = '#d9b45c';
  ctx.fillRect(0, 0, W, 92);
  ctx.fillStyle = '#1b1b1b';
  ctx.font = 'bold 56px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('喵の自动贩卖机', W / 2, 48);
  // 取货口
  ctx.fillStyle = '#05060a';
  ctx.fillRect(40, H - 120, W - 80, 90);
  ctx.fillStyle = '#2a2f3d';
  ctx.fillRect(48, H - 112, W - 96, 16);

  // 整体压暗一点，避免自发光面板在夜色里过于刺眼
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.fillRect(0, 0, W, H);

  return {
    map: toTexture(canvas, { wrap: THREE.ClampToEdgeWrapping }),
    emissiveMap: toTexture(canvas, { wrap: THREE.ClampToEdgeWrapping }),
  };
}

/* ------------------------------------------------------------------ */
/*  远景楼房窗户                                                       */
/* ------------------------------------------------------------------ */
export function makeBuildingTexture() {
  const W = 256;
  const H = 512;
  const { canvas, ctx } = createCanvas(W, H);
  ctx.fillStyle = '#0a0d18';
  ctx.fillRect(0, 0, W, H);
  const cols = 8;
  const rows = 22;
  const cw = W / cols;
  const ch = H / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (rand() < 0.42) {
        const warm = rand() < 0.72;
        const c = warm
          ? `rgba(${randInt(230, 255)},${randInt(190, 225)},${randInt(120, 170)},${rand(0.5, 1)})`
          : `rgba(${randInt(120, 170)},${randInt(200, 255)},${randInt(240, 255)},${rand(0.4, 0.9)})`;
        ctx.fillStyle = c;
        ctx.fillRect(x * cw + cw * 0.22, y * ch + ch * 0.25, cw * 0.5, ch * 0.45);
      }
    }
  }
  return toTexture(canvas, { repeat: [1, 1] });
}

/* ------------------------------------------------------------------ */
/*  光斑 / 爱心贴图                                                   */
/* ------------------------------------------------------------------ */
export function makeGlowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const S = 128;
  const { canvas, ctx } = createCanvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.28, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return toTexture(canvas, { wrap: THREE.ClampToEdgeWrapping });
}

export function makeHeartTexture() {
  const S = 128;
  const { canvas, ctx } = createCanvas(S, S);
  ctx.fillStyle = '#ff4f9a';
  ctx.beginPath();
  const x = S / 2;
  const y = S * 0.34;
  const w = S * 0.4;
  ctx.moveTo(x, y + w * 1.1);
  ctx.bezierCurveTo(x - w * 1.6, y - w * 0.4, x - w * 0.35, y - w * 1.15, x, y - w * 0.25);
  ctx.bezierCurveTo(x + w * 0.35, y - w * 1.15, x + w * 1.6, y - w * 0.4, x, y + w * 1.1);
  ctx.closePath();
  ctx.fill();
  return toTexture(canvas, { wrap: THREE.ClampToEdgeWrapping });
}
