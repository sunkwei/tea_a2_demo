import * as THREE from 'three';
import { rand } from './rng.js';
import { createCanvas, toTexture } from './textures.js';

/**
 * 水洼遮罩：黑色 = 路面完全透明（露出下面的镜面），白色 = 普通沥青。
 * 画布坐标已对齐到 40x40 的路面平面（世界坐标 x: -20~20, z: -8~32）。
 */
export function makePuddleMask() {
  const S = 512;
  const { canvas, ctx } = createCanvas(S, S);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, S, S);

  const blob = (cx, cy, r, squash, rot) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.scale(1, squash);
    const g = ctx.createRadialGradient(0, 0, r * 0.12, 0, 0, r);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.62, 'rgba(0,0,0,0.95)');
    g.addColorStop(0.85, 'rgba(0,0,0,0.45)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  // 主水洼（店门口正前方）
  blob(256, 210, 62, 0.7, 0.12);
  // 几块零散的小水洼
  blob(168, 262, 32, 0.7, -0.3);
  blob(340, 158, 34, 0.6, 0.25);
  blob(292, 292, 24, 0.75, 0.5);
  blob(196, 160, 22, 0.8, -0.6);
  blob(392, 258, 19, 0.7, 0.1);
  // 细碎的水点
  for (let i = 0; i < 16; i++) {
    blob(rand(120, 400), rand(140, 330), rand(7, 17), rand(0.6, 1), rand(0, Math.PI));
  }

  return toTexture(canvas, { wrap: THREE.ClampToEdgeWrapping, srgb: false });
}
