import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { rand, randInt, chance } from '../util/rng.js';
import {
  makeTileTexture,
  makeNeonSign,
  makePosterTexture,
  createCanvas,
  toTexture,
} from '../util/textures.js';

const W = 9; // 店宽 (x)
const D = 6; // 店深 (z)
const H = 4.0; // 墙高
const FRONT = D / 2; // 正面所在 z

/** 遮阳棚的条纹贴图 */
function makeStripeTexture() {
  const { canvas, ctx } = createCanvas(256, 64);
  const colors = ['#e8506b', '#f2f0e8', '#e8506b', '#f2f0e8'];
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = colors[i % 4];
    ctx.fillRect(i * 32, 0, 32, 64);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.fillRect(0, 52, 256, 12);
  return toTexture(canvas, { repeat: [8, 1] });
}

/** 店内地面：棋盘格瓷砖 */
function makeFloorTexture() {
  const S = 256;
  const { canvas, ctx } = createCanvas(S, S);
  const n = 4;
  const step = S / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const light = (x + y) % 2 === 0;
      ctx.fillStyle = light ? '#e8e4d8' : '#b9b3a6';
      ctx.fillRect(x * step, y * step, step, step);
    }
  }
  ctx.strokeStyle = 'rgba(90,86,78,0.5)';
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
  return toTexture(canvas, { repeat: [6, 4] });
}

export function createStore() {
  RectAreaLightUniformsLib.init();

  const group = new THREE.Group();
  group.name = 'store';

  const MAT = {
    wall: new THREE.MeshStandardMaterial({
      map: makeTileTexture(),
      color: 0xbfbcb4,
      roughness: 0.62,
      metalness: 0.04,
    }),
    concrete: new THREE.MeshStandardMaterial({ color: 0x54585f, roughness: 0.95 }),
    frame: new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.45, metalness: 0.6 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x1c2028, roughness: 0.5, metalness: 0.7 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: 0.9 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.85 }),
  };

  const add = (mesh, cast = true, receive = true) => {
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    group.add(mesh);
    return mesh;
  };

  /* ================================================================
   *  1. 主体结构
   * ================================================================ */
  const slab = new THREE.Mesh(new THREE.BoxGeometry(W + 0.6, 0.18, D + 0.6), MAT.concrete);
  slab.position.set(0, 0.09, 0);
  add(slab);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(W - 0.4, D - 0.4),
    new THREE.MeshStandardMaterial({ map: makeFloorTexture(), roughness: 0.42, metalness: 0.05 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.19;
  floor.receiveShadow = true;
  group.add(floor);

  // 背墙 / 侧墙
  const back = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.22), MAT.wall);
  back.position.set(0, 0.18 + H / 2, -FRONT + 0.11);
  add(back);

  const left = new THREE.Mesh(new THREE.BoxGeometry(0.22, H, D), MAT.wall);
  left.position.set(-W / 2 + 0.11, 0.18 + H / 2, 0);
  add(left);

  const right = new THREE.Mesh(new THREE.BoxGeometry(0.22, H, D), MAT.wall);
  right.position.set(W / 2 - 0.11, 0.18 + H / 2, 0);
  add(right);

  /* ---------- 正面：带窗洞的立面 ---------- */
  const shape = new THREE.Shape();
  shape.moveTo(-W / 2, 0);
  shape.lineTo(W / 2, 0);
  shape.lineTo(W / 2, H);
  shape.lineTo(-W / 2, H);
  shape.closePath();

  const holes = [
    { x0: -4.0, x1: -0.9, y0: 1.0, y1: 2.72 }, // 大橱窗
    { x0: -0.45, x1: 1.55, y0: 1.0, y1: 2.72 }, // 第二扇
    { x0: 2.35, x1: 3.95, y0: 0.02, y1: 2.72 }, // 门
  ];
  for (const h of holes) {
    const p = new THREE.Path();
    p.moveTo(h.x0, h.y0);
    p.lineTo(h.x1, h.y0);
    p.lineTo(h.x1, h.y1);
    p.lineTo(h.x0, h.y1);
    p.closePath();
    shape.holes.push(p);
  }

  const facadeTex = makeTileTexture();
  facadeTex.repeat.set(0.25, 0.25);
  const facadeMat = new THREE.MeshStandardMaterial({
    map: facadeTex,
    color: 0xc9c6bd,
    roughness: 0.6,
    metalness: 0.04,
  });
  const facadeGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.24, bevelEnabled: false });
  const facade = new THREE.Mesh(facadeGeo, facadeMat);
  facade.position.set(0, 0.18, FRONT - 0.24);
  add(facade);

  // 窗框
  const frameMat = MAT.frame;
  const frameOf = (w, h, x, y) => {
    const t = 0.09;
    const hbar = new THREE.Mesh(new THREE.BoxGeometry(w + t * 2, t, 0.2), frameMat);
    hbar.position.set(x, y + h / 2, FRONT - 0.12);
    add(hbar);
    const hbar2 = hbar.clone();
    hbar2.position.y = y - h / 2;
    add(hbar2);
    const vbar = new THREE.Mesh(new THREE.BoxGeometry(t, h, 0.2), frameMat);
    vbar.position.set(x - w / 2, y, FRONT - 0.12);
    add(vbar);
    const vbar2 = vbar.clone();
    vbar2.position.x = x + w / 2;
    add(vbar2);
  };
  frameOf(3.1, 1.72, -2.45, 1.86);
  frameOf(2.0, 1.72, 0.55, 1.86);

  // 橱窗的竖向中挺
  for (const x of [-3.4, -1.5, 0.55]) {
    const mull = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.72, 0.16), frameMat);
    mull.position.set(x, 1.86, FRONT - 0.12);
    add(mull);
  }

  /* ---------- 玻璃 ---------- */
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xbfe6f2,
    roughness: 0.04,
    metalness: 0.0,
    transparent: true,
    opacity: 0.16,
    transmission: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    side: THREE.DoubleSide,
    envMapIntensity: 1.6,
  });
  const glassA = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 1.72), glassMat);
  glassA.position.set(-2.45, 1.86, FRONT - 0.16);
  group.add(glassA);
  const glassB = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.72), glassMat);
  glassB.position.set(0.55, 1.86, FRONT - 0.16);
  group.add(glassB);

  /* ---------- 玻璃门（会微微晃动） ---------- */
  const doorPivot = new THREE.Group();
  doorPivot.position.set(2.35, 0.18, FRONT - 0.18);
  group.add(doorPivot);

  const doorFrameMat = MAT.frame;
  const doorW = 1.6;
  const doorH = 2.7;
  const doorParts = [];
  const dTop = new THREE.Mesh(new THREE.BoxGeometry(doorW, 0.1, 0.12), doorFrameMat);
  dTop.position.set(doorW / 2, doorH - 0.05, 0);
  doorParts.push(dTop);
  const dBot = new THREE.Mesh(new THREE.BoxGeometry(doorW, 0.22, 0.12), doorFrameMat);
  dBot.position.set(doorW / 2, 0.11, 0);
  doorParts.push(dBot);
  const dL = new THREE.Mesh(new THREE.BoxGeometry(0.1, doorH, 0.12), doorFrameMat);
  dL.position.set(0.05, doorH / 2, 0);
  doorParts.push(dL);
  const dR = dL.clone();
  dR.position.x = doorW - 0.05;
  doorParts.push(dR);
  const dMid = new THREE.Mesh(new THREE.BoxGeometry(doorW, 0.07, 0.12), doorFrameMat);
  dMid.position.set(doorW / 2, 1.05, 0);
  doorParts.push(dMid);
  const doorGlass = new THREE.Mesh(new THREE.PlaneGeometry(doorW - 0.2, doorH - 0.45), glassMat);
  doorGlass.position.set(doorW / 2, 1.42, 0);
  doorParts.push(doorGlass);
  doorParts.forEach((m) => {
    m.castShadow = true;
    doorPivot.add(m);
  });

  // 把手
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, 0.75, 10),
    new THREE.MeshStandardMaterial({ color: 0xd8c48a, roughness: 0.28, metalness: 0.9 })
  );
  handle.position.set(doorW - 0.22, 1.35, 0.1);
  doorPivot.add(handle);

  // 猫洞（小小的）：给猫进出用的
  const catDoor = new THREE.Mesh(
    new THREE.BoxGeometry(0.52, 0.42, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x3b2f28, roughness: 0.8 })
  );
  catDoor.position.set(doorW / 2, 0.32, 0.07);
  doorPivot.add(catDoor);
  const catFace = new THREE.Mesh(
    new THREE.CircleGeometry(0.13, 20),
    new THREE.MeshBasicMaterial({ color: 0xffc27a })
  );
  catFace.position.set(doorW / 2, 0.32, 0.105);
  doorPivot.add(catFace);

  /* ================================================================
   *  2. 屋顶
   * ================================================================ */
  const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 0.7, 0.34, D + 0.7), MAT.roof);
  roof.position.set(0, 0.18 + H + 0.17, 0);
  add(roof);

  const parapet = new THREE.Mesh(new THREE.BoxGeometry(W + 0.7, 0.3, D + 0.7), MAT.roof);
  parapet.position.set(0, 0.18 + H + 0.49, 0);
  add(parapet);

  // 屋顶空调外机
  const acMat = new THREE.MeshStandardMaterial({ color: 0x8d9199, roughness: 0.6, metalness: 0.5 });
  for (const [x, z, s] of [
    [-2.4, -1.3, 1.0],
    [1.6, -1.8, 0.85],
  ]) {
    const ac = new THREE.Mesh(new THREE.BoxGeometry(1.5 * s, 0.9 * s, 1.0 * s), acMat);
    ac.position.set(x, 0.18 + H + 0.34 + 0.45 * s, z);
    add(ac);
    const fan = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32 * s, 0.32 * s, 0.06, 20),
      new THREE.MeshStandardMaterial({ color: 0x15181e, roughness: 0.7, metalness: 0.4 })
    );
    fan.rotation.x = Math.PI / 2;
    fan.position.set(x, 0.18 + H + 0.34 + 0.45 * s, z + 0.52 * s);
    group.add(fan);
    ac.userData.fan = fan;
  }

  // 水塔
  const tankStand = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.7, 1.4), MAT.darkMetal);
  tankStand.position.set(3.1, 0.18 + H + 0.34 + 0.35, 1.4);
  add(tankStand);
  const tank = new THREE.Mesh(
    new THREE.CylinderGeometry(0.72, 0.72, 1.3, 18),
    new THREE.MeshStandardMaterial({ color: 0x6e5a4a, roughness: 0.85 })
  );
  tank.position.set(3.1, 0.18 + H + 0.34 + 0.7 + 0.65, 1.4);
  add(tank);
  const tankTop = new THREE.Mesh(new THREE.ConeGeometry(0.78, 0.35, 18), MAT.darkMetal);
  tankTop.position.set(3.1, 0.18 + H + 0.34 + 0.7 + 1.3 + 0.17, 1.4);
  add(tankTop);

  // 通风管 & 天线
  for (const [x, z, h] of [
    [-0.4, 1.6, 1.1],
    [0.6, 2.0, 0.8],
  ]) {
    const pipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.13, h, 12),
      new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.5, metalness: 0.6 })
    );
    pipe.position.set(x, 0.18 + H + 0.34 + h / 2, z);
    add(pipe);
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.15, 0.16, 12),
      new THREE.MeshStandardMaterial({ color: 0x7d838b, roughness: 0.5, metalness: 0.6 })
    );
    cap.position.set(x, 0.18 + H + 0.34 + h + 0.08, z);
    add(cap);
  }
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 3.4, 6), MAT.darkMetal);
  antenna.position.set(-3.6, 0.18 + H + 0.34 + 1.7, 2.0);
  add(antenna);
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.9 - i * 0.15, 0.03, 0.03), MAT.darkMetal);
    arm.position.set(-3.6, 0.18 + H + 0.34 + 1.2 + i * 0.5, 2.0);
    group.add(arm);
  }
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.1, 10, 10),
    new THREE.MeshBasicMaterial({ color: 0xff3a4e, fog: false })
  );
  beacon.position.set(-3.6, 0.18 + H + 0.34 + 3.4, 2.0);
  group.add(beacon);

  /* ================================================================
   *  3. 招牌
   * ================================================================ */
  const signTex = makeNeonSign({
    width: 1024,
    height: 300,
    bg: '#120a16',
    border: { color: '#54e8ff', width: 9, pad: 16, radius: 22 },
    lines: [
      { text: '喵屋便利店', size: 132, color: '#ff59b0', y: 112, glow: 46 },
      { text: 'MAOW MART · 24H', size: 54, color: '#7ef0ff', y: 222, glow: 26 },
    ],
  });
  const neonMat = new THREE.MeshStandardMaterial({
    map: signTex.map,
    emissiveMap: signTex.emissiveMap,
    emissive: 0xffffff,
    emissiveIntensity: 1.5,
    roughness: 0.4,
    metalness: 0.1,
  });
  const signDark = new THREE.MeshStandardMaterial({ color: 0x14121a, roughness: 0.7, metalness: 0.3 });

  const fascia = new THREE.Mesh(
    new THREE.BoxGeometry(7.8, 1.3, 0.3),
    [signDark, signDark, signDark, signDark, neonMat, signDark]
  );
  fascia.name = 'fascia';
  fascia.position.set(0, 0.18 + 3.3, FRONT + 0.12);
  add(fascia);

  // 招牌外圈的霓虹管
  const tubeMat = new THREE.MeshBasicMaterial({ color: 0x9df6ff, fog: false });
  const tube = (w, h, x, y, z) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, w, 8), tubeMat);
    m.rotation.z = Math.PI / 2;
    m.position.set(x, y + h / 2, z);
    group.add(m);
    const m2 = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, w, 8), tubeMat);
    m2.rotation.z = Math.PI / 2;
    m2.position.set(x, y - h / 2, z);
    group.add(m2);
  };
  tube(8.0, 1.42, 0, 3.3, FRONT + 0.28);

  // 侧面竖招牌（刀旗）
  const bladeTex = makeNeonSign({
    width: 256,
    height: 768,
    bg: '#120a16',
    lines: [
      { text: '喵', size: 150, color: '#ffd166', y: 190, glow: 40 },
      { text: '屋', size: 150, color: '#ffd166', y: 370, glow: 40 },
      { text: '24H', size: 84, color: '#ff59b0', y: 560, glow: 34 },
      { text: '营业中', size: 76, color: '#7ef0ff', y: 680, glow: 30 },
    ],
  });
  const bladeMat = new THREE.MeshStandardMaterial({
    map: bladeTex.map,
    emissiveMap: bladeTex.emissiveMap,
    emissive: 0xffffff,
    emissiveIntensity: 0.6,
    roughness: 0.45,
    metalness: 0.1,
  });
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 2.9, 1.05),
    [bladeMat, bladeMat, signDark, signDark, signDark, signDark]
  );
  blade.position.set(W / 2 + 0.16, 0.18 + 2.9, FRONT - 0.9);
  blade.name = 'blade';
  add(blade);
  const bladeArm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.08), MAT.darkMetal);
  bladeArm.position.set(W / 2 + 0.05, 0.18 + 4.1, FRONT - 0.9);
  group.add(bladeArm);

  /* ---------- 遮阳棚 ---------- */
  const awning = new THREE.Mesh(
    new THREE.BoxGeometry(8.0, 0.1, 1.5),
    new THREE.MeshStandardMaterial({ map: makeStripeTexture(), roughness: 0.85 })
  );
  awning.position.set(0, 0.18 + 2.62, FRONT + 0.72);
  awning.rotation.x = -0.16;
  add(awning);
  const awningEdge = new THREE.Mesh(
    new THREE.BoxGeometry(8.0, 0.22, 0.08),
    new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.8 })
  );
  awningEdge.position.set(0, 0.18 + 2.36, FRONT + 1.44);
  add(awningEdge);
  for (const x of [-3.6, 3.6]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.7, 8), MAT.darkMetal);
    pole.position.set(x, 0.18 + 1.25, FRONT + 1.38);
    add(pole);
  }

  /* ---------- 橱窗海报 ---------- */
  const posterDefs = [
    { title: '热汤', sub: '500ml', bg: '#e8465f', pos: [-3.62, 1.32, FRONT - 0.14], rot: 0 },
    { title: '喵特卖', sub: '半价', bg: '#2f8f6b', pos: [-1.28, 1.26, FRONT - 0.14], rot: 0.12 },
    { title: '深夜咖啡', sub: '第二杯半价', bg: '#3a4f9e', pos: [0.22, 1.34, FRONT - 0.14], rot: -0.1 },
    { title: '喵特卖', sub: '新品', bg: '#b0512f', pos: [1.22, 1.24, FRONT - 0.14], rot: 0.16 },
  ];
  for (const p of posterDefs) {
    const poster = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.63),
      new THREE.MeshBasicMaterial({ map: makePosterTexture(p), transparent: false })
    );
    poster.position.set(...p.pos);
    poster.rotation.z = p.rot;
    group.add(poster);
  }

  // 门上"营业中"的小灯牌
  const openSign = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.34),
    new THREE.MeshBasicMaterial({
      map: makePosterTexture({ title: '営業中', sub: 'OPEN 24H', bg: '#0e1b14', fg: '#6bffb0', accent: '#6bffb0' }),
      transparent: false,
    })
  );
  openSign.position.set(doorW / 2, 2.15, 0.09);
  doorPivot.add(openSign);

  /* ================================================================
   *  4. 店内陈设
   * ================================================================ */
  const interior = new THREE.Group();
  group.add(interior);

  const shelfColors = [0xff6b6b, 0xffc857, 0x6bcB77, 0x4dabf7, 0xb197fc, 0xff922b, 0x38d9a9];

  // 冷柜（背靠左墙）
  const fridgeMat = new THREE.MeshStandardMaterial({ color: 0xd8dde4, roughness: 0.35, metalness: 0.5 });
  const fridgeGlass = new THREE.MeshStandardMaterial({
    color: 0xbfe9ff,
    emissive: 0x8fd8ff,
    emissiveIntensity: 0.9,
    roughness: 0.15,
    metalness: 0.2,
  });
  for (let i = 0; i < 3; i++) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(1.05, 2.1, 0.85), fridgeMat);
    f.position.set(-3.5 + i * 1.12, 0.19 + 1.05, -FRONT + 0.62);
    interior.add(f);
    const g = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.75), fridgeGlass);
    g.position.set(-3.5 + i * 1.12, 0.19 + 1.05, -FRONT + 1.05);
    interior.add(g);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.5, 0.06), MAT.darkMetal);
    handle.position.set(-3.5 + i * 1.12 + 0.45, 0.19 + 1.05, -FRONT + 1.08);
    interior.add(handle);
  }

  // 货架（靠背墙右侧 + 两排中岛）
  const makeShelf = (x, z, width, rot = 0, levels = 3) => {
    const g = new THREE.Group();
    g.position.set(x, 0.19, z);
    g.rotation.y = rot;
    const body = new THREE.Mesh(new THREE.BoxGeometry(width, 1.7, 0.55), MAT.wood);
    body.position.y = 0.85;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);
    const backPanel = new THREE.Mesh(
      new THREE.BoxGeometry(width, 1.7, 0.06),
      new THREE.MeshStandardMaterial({ color: 0xd8d3c6, roughness: 0.8 })
    );
    backPanel.position.set(0, 0.85, -0.26);
    g.add(backPanel);

    const prodGeo = new THREE.BoxGeometry(0.16, 0.3, 0.16);
    const prodMat = new THREE.MeshStandardMaterial({ roughness: 0.55 });
    const prod = new THREE.InstancedMesh(prodGeo, prodMat, levels * Math.floor(width / 0.22));
    prod.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const dummy = new THREE.Object3D();
    const colors = [];
    let idx = 0;
    for (let l = 0; l < levels; l++) {
      const shelfY = 0.42 + l * 0.5;
      // 隔板
      const board = new THREE.Mesh(new THREE.BoxGeometry(width, 0.05, 0.5), MAT.wood);
      board.position.set(0, shelfY, 0.02);
      g.add(board);
      for (let i = 0; i < Math.floor(width / 0.22); i++) {
        dummy.position.set(-width / 2 + 0.14 + i * 0.22, shelfY + 0.18, 0.06);
        dummy.rotation.set(0, rand(-0.2, 0.2), 0);
        dummy.scale.setScalar(rand(0.85, 1.1));
        dummy.updateMatrix();
        prod.setMatrixAt(idx, dummy.matrix);
        colors.push(shelfColors[randInt(0, shelfColors.length - 1)]);
        idx++;
      }
    }
    prod.count = idx;
    prod.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(colors), 3);
    const c = new THREE.Color();
    colors.forEach((col, i) => {
      c.setHex(col);
      prod.setColorAt(i, c);
    });
    prod.instanceColor.needsUpdate = true;
    prod.castShadow = true;
    g.add(prod);
    interior.add(g);
    return g;
  };

  makeShelf(2.35, -FRONT + 0.5, 2.6, 0, 3);
  makeShelf(-1.0, -0.5, 2.4, 0, 3);
  makeShelf(-1.0, 1.3, 2.4, 0, 3);

  // 收银台
  const counter = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.0, 0.75), MAT.wood);
  counter.position.set(3.1, 0.19 + 0.5, 1.3);
  counter.castShadow = true;
  interior.add(counter);
  const counterTop = new THREE.Mesh(
    new THREE.BoxGeometry(2.55, 0.09, 0.9),
    new THREE.MeshStandardMaterial({ color: 0xe6e2d8, roughness: 0.3, metalness: 0.1 })
  );
  counterTop.position.set(3.1, 0.19 + 1.04, 1.3);
  interior.add(counterTop);
  const register = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.34, 0.36),
    new THREE.MeshStandardMaterial({ color: 0x2c3038, roughness: 0.5 })
  );
  register.position.set(3.4, 0.19 + 1.25, 1.15);
  interior.add(register);
  const registerScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.34, 0.2),
    new THREE.MeshBasicMaterial({ color: 0x6bffb0 })
  );
  registerScreen.position.set(3.4, 0.19 + 1.3, 1.33);
  interior.add(registerScreen);

  // 咖啡机
  const coffee = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.75, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x22262e, roughness: 0.35, metalness: 0.7 })
  );
  coffee.position.set(-3.5, 0.19 + 0.38, 1.9);
  interior.add(coffee);
  const coffeeLight = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.06, 0.04),
    new THREE.MeshBasicMaterial({ color: 0xff9a4d })
  );
  coffeeLight.position.set(-3.5, 0.19 + 0.62, 2.14);
  interior.add(coffeeLight);

  // 吊灯
  const lampShade = new THREE.MeshStandardMaterial({ color: 0x1e222a, roughness: 0.4, metalness: 0.6 });
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfff0cf, fog: false });
  for (const [lx, lz] of [
    [-2.6, 0.3],
    [0.2, 0.3],
    [2.8, 0.3],
  ]) {
    const cord = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.75, 6),
      new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.9 })
    );
    cord.position.set(lx, 0.18 + H - 0.38, lz);
    interior.add(cord);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.3, 20, 1, true), lampShade);
    shade.position.set(lx, 0.18 + H - 0.85, lz);
    shade.rotation.x = Math.PI;
    interior.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 12), bulbMat);
    bulb.position.set(lx, 0.18 + H - 0.98, lz);
    interior.add(bulb);
    const pl = new THREE.PointLight(0xffd9a0, 8, 7.5, 2);
    pl.position.set(lx, 0.18 + H - 1.05, lz);
    interior.add(pl);
  }

  // 天花板
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(W - 0.4, D - 0.4),
    new THREE.MeshStandardMaterial({ color: 0xf0ece2, roughness: 0.9 })
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = 0.18 + H - 0.02;
  interior.add(ceiling);

  // 店内的小盆栽
  const potMat = new THREE.MeshStandardMaterial({ color: 0xb56a4a, roughness: 0.8 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f8f52, roughness: 0.7 });
  for (const [px, pz] of [
    [-3.9, 2.2],
    [4.0, -1.2],
  ]) {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.28, 12), potMat);
    pot.position.set(px, 0.19 + 0.14, pz);
    interior.add(pot);
    for (let i = 0; i < 5; i++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.55, 6), leafMat);
      leaf.position.set(px + rand(-0.12, 0.12), 0.19 + 0.5, pz + rand(-0.12, 0.12));
      leaf.rotation.set(rand(-0.4, 0.4), rand(0, 6.28), rand(-0.4, 0.4));
      interior.add(leaf);
    }
  }

  /* ================================================================
   *  5. 灯光
   * ================================================================ */
  const interiorLight = new THREE.PointLight(0xffe3b8, 13, 9, 2);
  interiorLight.position.set(0.2, 0.18 + 2.2, 0.3);
  group.add(interiorLight);

  const signLight = new THREE.PointLight(0xff59b0, 7, 11, 2);
  signLight.position.set(0, 0.18 + 3.3, FRONT + 1.1);
  group.add(signLight);

  const bladeLight = new THREE.PointLight(0xffd166, 4, 8, 2);
  bladeLight.position.set(W / 2 + 0.6, 0.18 + 2.9, FRONT - 0.9);
  group.add(bladeLight);

  // 从橱窗洒到街上的柔光（RectAreaLight）
  const spill = new THREE.RectAreaLight(0xffd9a0, 2.2, 5.6, 1.6);
  spill.position.set(-1.2, 0.18 + 1.7, FRONT + 0.06);
  spill.lookAt(-1.2, 0, FRONT + 3);
  group.add(spill);

  /* ================================================================
   *  6. 侧墙的小细节
   * ================================================================ */
  const sideAC = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.8), acMat);
  sideAC.position.set(-W / 2 + 0.4, 0.18 + 2.6, -0.6);
  add(sideAC);
  const pipe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 3.4, 8),
    new THREE.MeshStandardMaterial({ color: 0x7b8087, roughness: 0.6, metalness: 0.5 })
  );
  pipe.position.set(-W / 2 + 0.28, 0.18 + 1.7, 2.0);
  add(pipe);
  const junction = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.4, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x59606b, roughness: 0.6, metalness: 0.5 })
  );
  junction.position.set(-W / 2 + 0.22, 0.18 + 1.5, 2.0);
  add(junction);

  /* ================================================================
   *  动画
   * ================================================================ */
  const fans = [];
  group.traverse((o) => {
    if (o.userData && o.userData.fan) fans.push(o.userData.fan);
  });

  let neonOn = true;
  let flicker = 0;

  return {
    group,
    /** 开关霓虹招牌（点击招牌时调用） */
    toggleSign() {
      neonOn = !neonOn;
      flicker = 0.45;
      return neonOn;
    },
    get neonOn() {
      return neonOn;
    },
    update(t, dt) {
      // 门轻轻晃动
      doorPivot.rotation.y = Math.sin(t * 0.6) * 0.035 + Math.sin(t * 0.23) * 0.02;
      // 空调风扇转
      for (const f of fans) f.rotation.z += dt * 5;
      // 航空警示灯闪烁
      beacon.material.color.setRGB(
        Math.abs(Math.sin(t * 1.7)) > 0.55 ? 1 : 0.25,
        0.05,
        0.08
      );
      // 霓虹：偶尔自己闪一下；被点击开关时会有接触不良的抽搐
      if (flicker > 0) {
        flicker -= dt;
        const f = Math.random() < 0.45 ? 0.08 : 1;
        neonMat.emissiveIntensity = 1.45 * f;
        signLight.intensity = 6.5 * f;
        tubeMat.color.setHex(f > 0.5 ? 0x9df6ff : 0x16202a);
      } else if (!neonOn) {
        neonMat.emissiveIntensity = 0;
        signLight.intensity = 0;
        tubeMat.color.setHex(0x16202a);
      } else {
        const glitch = chance(0.004) ? 0.2 : 1;
        neonMat.emissiveIntensity = (1.45 + Math.sin(t * 9) * 0.18) * glitch;
        signLight.intensity = (6.5 + Math.sin(t * 3.1) * 1.4) * glitch;
        tubeMat.color.setHex(0x9df6ff);
      }
    },
  };
}
