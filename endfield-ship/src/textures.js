/**
 * 程序化贴图工厂
 *
 * 全部用 Canvas 2D 现场画出来，不依赖任何外部图片资源：
 *  - 船体装甲板（albedo + 法线 + 粗糙度）
 *  - 地板格栅
 *  - 黄黑警示斜纹
 *  - 丝印文字 / 编号
 *  - 屏幕动态贴图（雷达 / 波形 / 文本）
 */

import * as THREE from 'three';

const cache = new Map();

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function tex(c, { repeat = [1, 1], srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/* --------------------------- 噪声 --------------------------- */

function hash2(x, y, seed = 0) {
  let h = x * 374761393 + y * 668265263 + seed * 1442695040888963407;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

function valueNoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

function fbm(x, y, octaves = 4, seed = 0) {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/**
 * 由灰度高度图生成法线贴图（Sobel）。
 * @param {HTMLCanvasElement} src 高度图（黑白）
 */
export function heightToNormal(src, strength = 2.2) {
  const w = src.width;
  const h = src.height;
  const sctx = src.getContext('2d');
  const data = sctx.getImageData(0, 0, w, h).data;
  const out = canvas(w, h);
  const octx = out.getContext('2d');
  const img = octx.createImageData(w, h);
  const at = (x, y) => {
    const xx = (x + w) % w;
    const yy = (y + h) % h;
    return data[(yy * w + xx) * 4] / 255;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1);
      const l = at(x - 1, y), r = at(x + 1, y);
      const bl = at(x - 1, y + 1), b = at(x, y + 1), br = at(x + 1, y + 1);
      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);
      let nx = -dx * strength;
      let ny = -dy * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len;
      const i = (y * w + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz / len) * 0.5 * 255 + 127;
      img.data[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/* --------------------------- 通用工具 --------------------------- */

/** 在画布上叠加颗粒噪声 */
function grain(ctx, w, h, amount = 14, alpha = 0.06) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
  if (alpha > 0) {
    ctx.globalAlpha = alpha;
    ctx.globalAlpha = 1;
  }
}

/** 划痕 */
function scratches(ctx, w, h, count, alpha = 0.05, color = '#ffffff') {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const len = 8 + Math.random() * 90;
    const ang = Math.random() * Math.PI * 2;
    ctx.globalAlpha = alpha * (0.3 + Math.random() * 0.7);
    ctx.lineWidth = Math.random() < 0.85 ? 0.6 : 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  }
  ctx.restore();
}

/** 边缘油污 / 锈迹 */
function grime(ctx, w, h, count = 18, color = 'rgba(24,18,12,0.5)') {
  ctx.save();
  for (let i = 0; i < count; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const r = 12 + Math.random() * 70;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(24,18,12,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* --------------------------- 船体装甲板 --------------------------- */

/**
 * 分块装甲板贴图。
 * @param {object} o
 * @param {string} o.base 底色
 * @param {string} o.accent 分隔线颜色
 * @param {number} o.cells 横向分块数
 * @param {number} o.rows 纵向分块数
 * @param {string} o.label 丝印文字
 */
export function hullPanel({
  base = '#5b6270',
  accent = '#2a2f38',
  cells = 4,
  rows = 2,
  label = 'EVERBRIGHT',
  sub = 'DECK 04 / OBS',
  size = 1024,
  rivets = true,
} = {}) {
  const key = `hull:${base}:${accent}:${cells}:${rows}:${label}:${size}`;
  if (cache.has(key)) return cache.get(key);

  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const hgt = canvas(size, size);
  const hctx = hgt.getContext('2d');

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  hctx.fillStyle = '#808080';
  hctx.fillRect(0, 0, size, size);

  // 大面积色斑（喷漆不均）
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 40 + Math.random() * 160;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.05)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  const cw = size / cells;
  const ch = size / rows;
  const gap = Math.max(3, size / 220);

  for (let ry = 0; ry < rows; ry++) {
    for (let cx = 0; cx < cells; cx++) {
      const x = cx * cw;
      const y = ry * ch;
      const inset = gap * 1.6;

      // 每块板子略微不同的亮度
      const tone = 0.86 + Math.random() * 0.28;
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillStyle = `rgba(${Math.round(255 * tone)},${Math.round(255 * tone)},${Math.round(255 * tone)},0.5)`;
      ctx.fillRect(x, y, cw, ch);
      ctx.restore();

      // 板面
      const g = ctx.createLinearGradient(x, y, x, y + ch);
      g.addColorStop(0, 'rgba(255,255,255,0.10)');
      g.addColorStop(0.45, 'rgba(255,255,255,0.0)');
      g.addColorStop(1, 'rgba(0,0,0,0.16)');
      ctx.fillStyle = g;
      ctx.fillRect(x + inset, y + inset, cw - inset * 2, ch - inset * 2);

      // 缝
      ctx.strokeStyle = accent;
      ctx.lineWidth = gap;
      ctx.strokeRect(x + inset * 0.5, y + inset * 0.5, cw - inset, ch - inset);
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + inset * 1.4, y + inset * 1.4, cw - inset * 2.8, ch - inset * 2.8);

      // 高度图：板面凸起、缝凹陷
      hctx.fillStyle = '#b4b4b4';
      hctx.fillRect(x + inset, y + inset, cw - inset * 2, ch - inset * 2);
      hctx.fillStyle = '#3a3a3a';
      hctx.fillRect(x, y, cw, gap * 1.6);
      hctx.fillRect(x, y, gap * 1.6, ch);

      if (rivets) {
        const rr = Math.max(2, size / 300);
        const step = Math.max(26, size / 16);
        for (let px = x + inset * 2.4; px < x + cw - inset * 2; px += step) {
          for (const py of [y + inset * 2.6, y + ch - inset * 2.6]) {
            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            ctx.beginPath();
            ctx.arc(px, py + rr * 0.35, rr, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.22)';
            ctx.beginPath();
            ctx.arc(px, py, rr * 0.8, 0, Math.PI * 2);
            ctx.fill();
            hctx.fillStyle = '#d8d8d8';
            hctx.beginPath();
            hctx.arc(px, py, rr, 0, Math.PI * 2);
            hctx.fill();
          }
        }
      }
    }
  }

  // 丝印
  ctx.save();
  ctx.globalAlpha = 0.34;
  ctx.fillStyle = '#e8e4d8';
  ctx.font = `600 ${Math.round(size / 26)}px "Arial Narrow", "Helvetica Neue", sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText(label, cw * 0.12, ch * 0.24);
  ctx.font = `500 ${Math.round(size / 34)}px "Arial Narrow", monospace`;
  ctx.globalAlpha = 0.22;
  ctx.fillText(sub, cw * 0.12, ch * 0.38);
  ctx.restore();

  grime(ctx, size, size, 14);
  scratches(ctx, size, size, 90, 0.05);
  grain(ctx, size, size, 12);

  const result = {
    map: tex(c, { repeat: [1, 1] }),
    normalMap: tex(heightToNormal(hgt, 1.6), { srgb: false }),
  };
  cache.set(key, result);
  return result;
}

/* --------------------------- 地板格栅 --------------------------- */

export function floorGrate(size = 1024) {
  const key = `grate:${size}`;
  if (cache.has(key)) return cache.get(key);

  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const hgt = canvas(size, size);
  const hctx = hgt.getContext('2d');

  ctx.fillStyle = '#23262c';
  ctx.fillRect(0, 0, size, size);
  hctx.fillStyle = '#2a2a2a';
  hctx.fillRect(0, 0, size, size);

  const cells = 8;
  const step = size / cells;
  const bar = step * 0.34;

  for (let i = 0; i < cells; i++) {
    const x = i * step;
    // 承重横条
    const g = ctx.createLinearGradient(x, 0, x + bar, 0);
    g.addColorStop(0, '#4c525c');
    g.addColorStop(0.4, '#6a717c');
    g.addColorStop(1, '#3c414a');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, bar, size);
    hctx.fillStyle = '#d0d0d0';
    hctx.fillRect(x, 0, bar, size);
  }
  // 中间横向连条
  for (let j = 0; j < cells; j++) {
    const y = j * step + step * 0.5;
    ctx.fillStyle = '#4a505a';
    ctx.fillRect(0, y, size, bar * 0.5);
    hctx.fillStyle = '#a8a8a8';
    hctx.fillRect(0, y, size, bar * 0.5);
  }
  // 镂空阴影
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      ctx.fillRect(i * step + bar, j * step + step * 0.5 + bar * 0.5, step - bar, step * 0.5 - bar * 0.5);
    }
  }

  scratches(ctx, size, size, 160, 0.06);
  grime(ctx, size, size, 22);
  grain(ctx, size, size, 16);

  const result = {
    map: tex(c),
    normalMap: tex(heightToNormal(hgt, 2.6), { srgb: false }),
  };
  cache.set(key, result);
  return result;
}

/* --------------------------- 警示斜纹 --------------------------- */

export function hazardStripe({ a = '#f2c230', b = '#16181c', size = 512, angle = 45, stripe = 34 } = {}) {
  const key = `hazard:${a}:${b}:${angle}:${stripe}`;
  if (cache.has(key)) return cache.get(key);

  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = a;
  ctx.fillRect(0, 0, size, size);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.translate(-size, -size);
  ctx.fillStyle = b;
  for (let i = 0; i < (size * 2) / stripe; i++) {
    ctx.fillRect(i * stripe * 2, 0, stripe, size * 2);
  }
  ctx.restore();

  scratches(ctx, size, size, 70, 0.08, '#000000');
  grain(ctx, size, size, 18);

  const t = tex(c);
  cache.set(key, t);
  return t;
}

/* --------------------------- 丝印标签 --------------------------- */

/**
 * 生成一块「贴在墙上的标签」贴图（透明背景）。
 */
export function decalLabel({
  lines = ['DECK 04', 'OBSERVATION'],
  width = 512,
  height = 128,
  color = '#d8dde6',
  accent = '#f2c230',
  bar = true,
} = {}) {
  const c = canvas(width, height);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, width, height);

  if (bar) {
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, 8, height);
  }
  ctx.textBaseline = 'middle';
  const lh = height / (lines.length + 0.6);
  lines.forEach((ln, i) => {
    ctx.fillStyle = i === 0 ? color : 'rgba(216,221,230,0.55)';
    ctx.font = `${i === 0 ? 700 : 500} ${Math.round(lh * (i === 0 ? 0.72 : 0.44))}px "Arial Narrow", "Microsoft YaHei", sans-serif`;
    ctx.fillText(ln, 24, lh * (0.9 + i * 0.85));
  });
  return tex(c);
}

/* --------------------------- 屏幕动态贴图 --------------------------- */

/**
 * 一块「会动的屏幕」：返回 { texture, update(t) }。
 * kind: 'radar' | 'wave' | 'bars' | 'text' | 'grid'
 */
export function liveScreen(kind, { w = 512, h = 320, title = 'SYS', accent = '#57e0d6', warn = '#f2c230' } = {}) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const texture = tex(c);
  texture.repeat.set(1, 1);
  const data = [];
  const N = 64;
  for (let i = 0; i < N; i++) data.push(Math.random());

  function update(t) {
    ctx.fillStyle = '#050a0d';
    ctx.fillRect(0, 0, w, h);

    // 扫描线
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);

    // 标题栏
    ctx.fillStyle = 'rgba(87,224,214,0.14)';
    ctx.fillRect(0, 0, w, 26);
    ctx.fillStyle = accent;
    ctx.font = '600 15px "Arial Narrow", "Microsoft YaHei", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, 12, 14);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 26, w, h - 26);
    ctx.clip();

    if (kind === 'radar') {
      const cx = w * 0.5;
      const cy = (h + 26) * 0.5;
      const R = Math.min(w, h - 26) * 0.42;
      ctx.strokeStyle = 'rgba(87,224,214,0.35)';
      ctx.lineWidth = 1;
      for (let i = 1; i <= 4; i++) {
        ctx.beginPath();
        ctx.arc(cx, cy, (R * i) / 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        ctx.stroke();
      }
      // 扫描扇
      const ang = (t * 1.1) % (Math.PI * 2);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      g.addColorStop(0, 'rgba(87,224,214,0.42)');
      g.addColorStop(1, 'rgba(87,224,214,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, ang - 0.5, ang);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = accent;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R);
      ctx.stroke();
      // 目标点
      for (let i = 0; i < 5; i++) {
        const a = data[i] * Math.PI * 2 + t * 0.2 * (i % 2 ? 1 : -1);
        const rr = R * (0.25 + data[i + 10] * 0.6);
        const px = cx + Math.cos(a) * rr;
        const py = cy + Math.sin(a) * rr;
        ctx.fillStyle = i === 2 ? warn : accent;
        ctx.fillRect(px - 2, py - 2, 4, 4);
      }
    } else if (kind === 'wave') {
      ctx.strokeStyle = 'rgba(87,224,214,0.16)';
      for (let i = 1; i < 5; i++) {
        ctx.beginPath();
        ctx.moveTo(0, (h * i) / 5);
        ctx.lineTo(w, (h * i) / 5);
        ctx.stroke();
      }
      for (let k = 0; k < 3; k++) {
        ctx.strokeStyle = k === 1 ? warn : accent;
        ctx.lineWidth = k === 0 ? 2.2 : 1.3;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 4) {
          const p = x / w;
          const y =
            h * 0.55 +
            Math.sin(p * 12 + t * 3 + k) * (26 - k * 6) +
            Math.sin(p * 31 - t * 2.2) * 8 +
            (data[Math.floor(p * N)] - 0.5) * 14;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    } else if (kind === 'bars') {
      const n = 12;
      const bw = (w - 24) / n;
      for (let i = 0; i < n; i++) {
        const v = 0.15 + 0.85 * (0.5 + 0.5 * Math.sin(t * 1.4 + i * 0.6 + data[i]));
        const bh = v * (h - 70);
        const g2 = ctx.createLinearGradient(0, h - 30 - bh, 0, h - 30);
        g2.addColorStop(0, accent);
        g2.addColorStop(1, 'rgba(87,224,214,0.15)');
        ctx.fillStyle = g2;
        ctx.fillRect(12 + i * bw, h - 30 - bh, bw - 4, bh);
      }
      ctx.strokeStyle = 'rgba(87,224,214,0.3)';
      ctx.beginPath();
      ctx.moveTo(0, h - 30);
      ctx.lineTo(w, h - 30);
      ctx.stroke();
    } else if (kind === 'text') {
      const rows = 8;
      ctx.font = '500 13px "Consolas", "Courier New", monospace';
      for (let i = 0; i < rows; i++) {
        const phase = (t * 1.6 + i) % rows;
        const active = phase < 1;
        const y = 46 + i * 20;
        ctx.fillStyle = active ? accent : 'rgba(150,200,205,0.42)';
        const n = data[i] * 100;
        ctx.fillText(
          `${String(i + 1).padStart(2, '0')} ${['VECT', 'GYRO', 'THRM', 'PWR', 'AUX ', 'RSRC', 'COMM', 'SAFE'][i]} ${n.toFixed(2).padStart(6, '0')}`,
          12,
          y
        );
      }
    } else {
      ctx.strokeStyle = 'rgba(87,224,214,0.22)';
      for (let x = 0; x < w; x += 26) {
        ctx.beginPath();
        ctx.moveTo(x, 26);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 26; y < h; y += 26) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 0.55, 34 + Math.sin(t * 2) * 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // 玻璃反光
    const gr = ctx.createLinearGradient(0, 0, w * 0.6, h);
    gr.addColorStop(0, 'rgba(255,255,255,0.06)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, w, h);

    texture.needsUpdate = true;
  }

  update(0);
  return { texture, update };
}

/* --------------------------- 星点 --------------------------- */

/** 圆点精灵（给 Points 用） */
export function dotSprite(size = 64) {
  const key = `dot:${size}`;
  if (cache.has(key)) return cache.get(key);
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.28, 'rgba(255,255,255,0.72)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = tex(c);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

/** 舱内浮尘精灵 */
export function dustSprite(size = 32) {
  const key = `dust:${size}`;
  if (cache.has(key)) return cache.get(key);
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,244,220,0.9)');
  g.addColorStop(1, 'rgba(255,244,220,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = tex(c);
  cache.set(key, t);
  return t;
}
