/**
 * 舰桥观测舱内部结构
 *
 * 布局：前方（-Z）是大面积梯形观景舷窗，正对泰拉II 与天梯；
 * 中部是主控台与全息战术台；右侧是货舱闸门；左侧是生命维持机柜。
 *
 * 构图要点：
 *   1. 舷窗下沿抬到主控台屏幕之上 —— 主控台是画面下方的剪影，舷窗里完整看到行星与天梯。
 *   2. 舱室高度 5m、舷窗开口 1.45~4.6m —— 舷窗在画面上占约 1/3 高度，
 *      这样行星和向上延伸的天梯缆索才有伸展空间。
 *   3. 窗棂**不对称**布置：左侧是完整的观测净空（行星与天梯都在这里），
 *      竖向窗棂全部集中在右侧。行星直径在屏幕上约 230px，
 *      而两根窗棂之间的净空只有 258px —— 对称窗棂一定会把行星切成两半，
 *      所以干脆做成「一大扇观测窗 + 右侧结构框」。
 *
 * 光照要点（都是实测踩出来的）：
 *   - 环境光/环境贴图给太高 → 画面糊成一片灰奶白；给太低 → 天花板死黑（实测 avg 5.7）。
 *     折中：hemi 0.55 + environmentIntensity 0.72。
 *   - 金属度高的表面在暗环境里只剩反射，会变成黑块。
 *     墙/天花板金属度压到 0.3 左右，靠 diffuse 接住点光源。
 *   - 舷窗主光（平行光模拟行星反照）直接照在抛光金属上会过曝成白条，
 *     所以窗台/窗棂/台面单独用哑光材质。
 *   - 天花板灯槽不能给太亮：它是画面最靠上的位置，
 *     一旦过曝就会在顶部糊出一大团泛光，把视线从行星上抢走。
 *     所以天花灯条用暗一档的自发光材质，点光源也往下挪。
 */

import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { hullPanel, floorGrate, hazardStripe, decalLabel, dustSprite } from '../textures.js';

export const ROOM = {
  width: 11,
  height: 5.0,
  depth: 15,
  halfW: 5.5,
  halfD: 7.5,
};

/** 舷窗开口的下沿 / 上沿（世界坐标 Y） */
const WIN_BOTTOM = 1.45;
const WIN_TOP = 4.6;

/** 竖向窗棂的世界 X（全部集中在右侧，左侧留出完整观测净空） */
const MULLIONS = [1.7, 3.8];

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

/* ------------------------- 材质库 ------------------------- */

function buildMaterials() {
  const wallTex = hullPanel({
    base: '#6b7480',
    accent: '#1c212a',
    cells: 4,
    rows: 3,
    label: 'EVERBRIGHT',
    sub: 'OBSERVATION DECK / 04',
    size: 1024,
  });
  wallTex.map.repeat.set(3, 2);
  wallTex.normalMap.repeat.set(3, 2);

  const ceilTex = hullPanel({
    base: '#404852',
    accent: '#161b22',
    cells: 3,
    rows: 2,
    label: '',
    sub: '',
    size: 512,
    rivets: false,
  });
  ceilTex.map.repeat.set(4, 4);
  ceilTex.normalMap.repeat.set(4, 4);

  const grate = floorGrate(1024);
  grate.map.repeat.set(6, 8);
  grate.normalMap.repeat.set(6, 8);

  const dark = new THREE.MeshStandardMaterial({
    color: 0x333a44,
    roughness: 0.58,
    metalness: 0.55,
  });
  const darkRough = new THREE.MeshStandardMaterial({
    color: 0x232830,
    roughness: 0.85,
    metalness: 0.3,
  });
  const steel = new THREE.MeshStandardMaterial({
    color: 0x8b939f,
    roughness: 0.45,
    metalness: 0.7,
  });
  // 舷窗饰条 / 台面：哑光，避免被舷窗主光烤成白条
  const trim = new THREE.MeshStandardMaterial({
    color: 0x4b525d,
    roughness: 0.72,
    metalness: 0.3,
  });
  // 主控台台面：哑光但比饰条亮一档。
  // 抛光钢会被舷窗主光烤成一整片白（实测地面前景亮度冲到 82、过曝 2.8%），
  // 全换成饰条又太暗（掉到 37），所以单独给一档中间值。
  const desk = new THREE.MeshStandardMaterial({
    color: 0x737c88,
    roughness: 0.66,
    metalness: 0.22,
  });
  const rubber = new THREE.MeshStandardMaterial({
    color: 0x1a1e24,
    roughness: 0.94,
    metalness: 0.05,
  });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x9fc4d8,
    roughness: 0.06,
    metalness: 0,
    transparent: true,
    opacity: 0.08,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const hazard = new THREE.MeshStandardMaterial({
    map: hazardStripe({ a: '#f2c230', b: '#15171b', stripe: 26 }),
    roughness: 0.78,
    metalness: 0.2,
  });

  const stripCyan = new THREE.MeshBasicMaterial({ color: 0x64e6dc });
  // 天花灯条：暗一档，避免在画面顶部糊出泛光
  const stripCyanDim = new THREE.MeshBasicMaterial({ color: 0x2e8f92 });
  const stripAmber = new THREE.MeshBasicMaterial({ color: 0xffb347 });

  return {
    wall: new THREE.MeshStandardMaterial({
      map: wallTex.map,
      normalMap: wallTex.normalMap,
      normalScale: new THREE.Vector2(1.15, 1.15),
      roughness: 0.62,
      metalness: 0.32,
    }),
    ceil: new THREE.MeshStandardMaterial({
      map: ceilTex.map,
      normalMap: ceilTex.normalMap,
      roughness: 0.8,
      metalness: 0.16,
    }),
    floor: new THREE.MeshStandardMaterial({
      map: grate.map,
      normalMap: grate.normalMap,
      normalScale: new THREE.Vector2(1.5, 1.5),
      roughness: 0.5,
      metalness: 0.62,
    }),
    dark,
    darkRough,
    steel,
    trim,
    desk,
    rubber,
    glass,
    hazard,
    stripCyan,
    stripCyanDim,
    stripAmber,
  };
}

/* ------------------------- 小工具 ------------------------- */

function addBox(group, w, h, d, x, y, z, mat, opts = {}) {
  const m = new THREE.Mesh(box(w, h, d), mat);
  m.position.set(x, y, z);
  if (opts.rot) m.rotation.set(...opts.rot);
  if (opts.cast) m.castShadow = true;
  if (opts.receive) m.receiveShadow = true;
  group.add(m);
  return m;
}

/** 沿 Y 方向的管线束 */
function pipeRun(group, mats, { from, to, radius = 0.08, count = 3, spread = 0.22, mat }) {
  for (let i = 0; i < count; i++) {
    const off = (i - (count - 1) / 2) * spread;
    const g = new THREE.CylinderGeometry(radius, radius, Math.abs(to[1] - from[1]), 8);
    const m = new THREE.Mesh(g, mat || mats.steel);
    m.position.set(from[0] + off, (from[1] + to[1]) / 2, from[2] + off * 0.4);
    m.castShadow = true;
    group.add(m);
  }
}

/**
 * 屏幕材质：liveScreen 返回 { texture, update }。
 * 这里包一层自发光材质，并额外叠一层加性辉光。
 */
function screenMaterial(screen) {
  const base = new THREE.MeshBasicMaterial({ map: screen.texture, toneMapped: false });
  const glow = new THREE.MeshBasicMaterial({
    map: screen.texture,
    transparent: true,
    opacity: 0.28,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  return { base, glow };
}

/* ------------------------- 舱体 ------------------------- */

function buildShell(group, M) {
  const { halfW, halfD, height } = ROOM;

  // 地板
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 2, halfD * 2), M.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // 天花板
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 2, halfD * 2), M.ceil);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = height;
  ceil.receiveShadow = true;
  group.add(ceil);

  // 侧墙
  for (const s of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(halfD * 2, height), M.wall);
    wall.position.set(s * halfW, height / 2, 0);
    wall.rotation.y = -s * Math.PI * 0.5;
    wall.receiveShadow = true;
    group.add(wall);
  }

  // 后墙（货舱方向）
  const aft = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 2, height), M.wall);
  aft.position.set(0, height / 2, halfD);
  aft.rotation.y = Math.PI;
  group.add(aft);

  // 结构肋：拱形肋每隔 3 米一道
  const ribShape = new THREE.Shape();
  ribShape.moveTo(-halfW, 0);
  ribShape.lineTo(-halfW, height - 0.9);
  ribShape.lineTo(-halfW + 0.55, height);
  ribShape.lineTo(halfW - 0.55, height);
  ribShape.lineTo(halfW, height - 0.9);
  ribShape.lineTo(halfW, 0);
  ribShape.lineTo(halfW - 0.34, 0);
  ribShape.lineTo(halfW - 0.34, height - 1.0);
  ribShape.lineTo(-halfW + 0.34, height - 1.0);
  ribShape.lineTo(-halfW + 0.34, 0);
  ribShape.closePath();
  const ribGeo = new THREE.ExtrudeGeometry(ribShape, { depth: 0.42, bevelEnabled: false });
  ribGeo.translate(0, 0, -0.21);

  for (let i = 0; i < 6; i++) {
    const rib = new THREE.Mesh(ribGeo, M.dark);
    rib.position.z = -halfD + 1.1 + i * 2.9;
    rib.castShadow = true;
    rib.receiveShadow = true;
    group.add(rib);
  }

  // 侧壁竖直设备柱
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const z = -halfD + 2.4 + i * 3.4;
      addBox(group, 0.34, height - 0.5, 0.5, s * (halfW - 0.2), (height - 0.5) / 2, z, M.dark, {
        cast: true,
      });
      // 柱上的灯条
      addBox(group, 0.06, 1.7, 0.09, s * (halfW - 0.38), 1.6, z, M.stripCyan);
    }
  }

  // 踢脚线 / 顶角线
  for (const s of [-1, 1]) {
    addBox(group, 0.16, 0.22, halfD * 2, s * (halfW - 0.08), 0.11, 0, M.steel);
    addBox(group, 0.16, 0.18, halfD * 2, s * (halfW - 0.08), height - 0.14, 0, M.steel);
  }
}

/* ------------------------- 前端舷窗 ------------------------- */

function buildViewport(group, M) {
  const { halfW, height } = ROOM;
  const z = -ROOM.halfD;

  // 窗框外轮廓
  const frameShape = new THREE.Shape();
  frameShape.moveTo(-halfW + 0.2, 0.75);
  frameShape.lineTo(-halfW + 0.75, 0.35);
  frameShape.lineTo(halfW - 0.75, 0.35);
  frameShape.lineTo(halfW - 0.2, 0.75);
  frameShape.lineTo(halfW - 0.2, height - 0.6);
  frameShape.lineTo(halfW - 0.85, height - 0.22);
  frameShape.lineTo(-halfW + 0.85, height - 0.22);
  frameShape.lineTo(-halfW + 0.2, height - 0.6);
  frameShape.closePath();

  // 开口（梯形 + 斜切上沿）
  const hole = new THREE.Path();
  hole.moveTo(-halfW + 0.72, WIN_BOTTOM);
  hole.lineTo(-halfW + 1.25, WIN_BOTTOM - 0.4);
  hole.lineTo(halfW - 1.25, WIN_BOTTOM - 0.4);
  hole.lineTo(halfW - 0.72, WIN_BOTTOM);
  hole.lineTo(halfW - 0.72, WIN_TOP - 0.34);
  hole.lineTo(halfW - 1.28, WIN_TOP);
  hole.lineTo(-halfW + 1.28, WIN_TOP);
  hole.lineTo(-halfW + 0.72, WIN_TOP - 0.34);
  hole.closePath();
  frameShape.holes.push(hole);

  const frameGeo = new THREE.ExtrudeGeometry(frameShape, { depth: 0.5, bevelEnabled: false });
  frameGeo.translate(0, 0, -0.25);
  const frame = new THREE.Mesh(frameGeo, M.dark);
  frame.castShadow = true;
  frame.receiveShadow = true;
  group.add(frame);

  // 玻璃
  const glassShape = new THREE.Shape();
  glassShape.moveTo(-halfW + 0.74, WIN_BOTTOM - 0.02);
  glassShape.lineTo(-halfW + 1.26, WIN_BOTTOM - 0.38);
  glassShape.lineTo(halfW - 1.26, WIN_BOTTOM - 0.38);
  glassShape.lineTo(halfW - 0.74, WIN_BOTTOM - 0.02);
  glassShape.lineTo(halfW - 0.74, WIN_TOP - 0.36);
  glassShape.lineTo(halfW - 1.3, WIN_TOP + 0.02);
  glassShape.lineTo(-halfW + 1.3, WIN_TOP + 0.02);
  glassShape.lineTo(-halfW + 0.74, WIN_TOP - 0.36);
  glassShape.closePath();
  const glassGeo = new THREE.ShapeGeometry(glassShape);
  const glass = new THREE.Mesh(glassGeo, M.glass);
  glass.position.z = z - 0.05;
  glass.renderOrder = 2;
  group.add(glass);

  // 竖向窗棂（哑光饰条）—— 只在右侧，左侧留给行星
  for (const mx of MULLIONS) {
    addBox(
      group,
      0.12,
      WIN_TOP - WIN_BOTTOM,
      0.26,
      mx,
      (WIN_TOP + WIN_BOTTOM) / 2,
      z - 0.02,
      M.trim,
      { cast: true }
    );
  }
  // 横向窗棂
  addBox(group, halfW * 2 - 2.2, 0.09, 0.24, 0, WIN_TOP - 0.34, z - 0.02, M.trim);

  // 窗台（哑光，避免过曝）
  addBox(group, halfW * 2 - 1.4, 0.14, 0.42, 0, WIN_BOTTOM - 0.46, z + 0.32, M.trim, {
    cast: true,
  });
  for (const x of [-4.2, -1.4, 1.4, 4.2]) {
    addBox(group, 0.09, 0.38, 0.09, x, WIN_BOTTOM - 0.7, z + 0.32, M.trim, { cast: true });
  }

  return glass;
}

/* ------------------------- 主控台 ------------------------- */

function buildConsole(group, M, screens) {
  const console3d = new THREE.Group();
  console3d.position.set(-0.3, 0, -2.2);
  console3d.rotation.y = 0.06;
  group.add(console3d);

  // 台体
  const body = new THREE.Mesh(box(4.6, 0.82, 1.4), M.dark);
  body.position.y = 0.41;
  body.castShadow = true;
  body.receiveShadow = true;
  console3d.add(body);

  // 台面（哑光：抛光台面在舷窗主光下会整片过曝）
  const top = new THREE.Mesh(box(4.7, 0.08, 1.5), M.desk);
  top.position.y = 0.85;
  top.castShadow = true;
  top.receiveShadow = true;
  console3d.add(top);

  // 前脸灯带
  const fascia = new THREE.Mesh(box(4.4, 0.1, 0.06), M.stripCyan);
  fascia.position.set(0, 0.68, 0.71);
  console3d.add(fascia);

  // 三块倾斜屏幕（整体压低，避免挡住舷窗）
  for (let i = 0; i < 3; i++) {
    const sm = screenMaterial(screens[i]);
    const scr = new THREE.Group();
    scr.position.set((i - 1) * 1.42, 1.24, -0.2);
    scr.rotation.x = -0.5 + (i === 1 ? 0.08 : 0);
    scr.rotation.y = (i - 1) * -0.24;

    const bezel = new THREE.Mesh(box(1.2, 0.72, 0.07), M.darkRough);
    bezel.castShadow = true;
    scr.add(bezel);

    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.06, 0.58), sm.base);
    screen.position.z = 0.041;
    scr.add(screen);

    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.06, 0.58), sm.glow);
    glow.position.z = 0.043;
    scr.add(glow);

    console3d.add(scr);
  }

  // 键盘区（斜面）
  const kb = new THREE.Mesh(box(1.1, 0.06, 0.48), M.darkRough);
  kb.position.set(-1.2, 0.9, 0.32);
  kb.rotation.x = -0.18;
  console3d.add(kb);

  // 按键阵列（InstancedMesh）
  const keyGeo = new THREE.BoxGeometry(0.042, 0.02, 0.042);
  const keyMat = new THREE.MeshStandardMaterial({
    color: 0x2a3038,
    roughness: 0.5,
    metalness: 0.4,
    emissive: 0x0d2b30,
    emissiveIntensity: 0.6,
  });
  const cols = 12;
  const rows = 4;
  const keys = new THREE.InstancedMesh(keyGeo, keyMat, cols * rows);
  const dummy = new THREE.Object3D();
  let n = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      dummy.position.set(-1.2 - 0.24 + c * 0.042, 0.94 + r * 0.006, 0.16 + r * 0.046);
      dummy.rotation.set(-0.18, 0, 0);
      dummy.updateMatrix();
      keys.setMatrixAt(n++, dummy.matrix);
    }
  }
  console3d.add(keys);

  // 台面上的小物件：终端、杯子
  addBox(console3d, 0.16, 0.2, 0.16, 1.85, 0.98, 0.28, M.steel, { cast: true });
  addBox(console3d, 0.34, 0.04, 0.24, 0.55, 0.9, 0.38, M.darkRough, { cast: true });
  const cup = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.042, 0.12, 12),
    new THREE.MeshStandardMaterial({ color: 0xd8d3c6, roughness: 0.65 })
  );
  cup.position.set(1.85, 0.99, 0.28);
  cup.castShadow = true;
  console3d.add(cup);

  // 椅子
  const chair = new THREE.Group();
  chair.position.set(-0.3, 0, 0.95);
  const seat = new THREE.Mesh(box(0.62, 0.12, 0.58), M.rubber);
  seat.position.y = 0.5;
  seat.castShadow = true;
  chair.add(seat);
  const back = new THREE.Mesh(box(0.6, 0.66, 0.12), M.rubber);
  back.position.set(0, 0.88, 0.28);
  back.rotation.x = -0.16;
  back.castShadow = true;
  chair.add(back);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.44, 10), M.steel);
  stem.position.y = 0.24;
  chair.add(stem);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.07, 14), M.dark);
  foot.position.y = 0.04;
  foot.castShadow = true;
  chair.add(foot);
  console3d.add(chair);

  return console3d;
}

/* ------------------------- 生命维持机柜 ------------------------- */

function buildLifeRack(group, M, screen) {
  const rack = new THREE.Group();
  rack.position.set(-4.55, 0, 1.6);
  rack.rotation.y = Math.PI / 2;
  group.add(rack);

  addBox(rack, 1.5, 2.6, 0.85, 0, 1.3, 0, M.dark, { cast: true, receive: true });
  // 通风百叶
  for (let i = 0; i < 14; i++) {
    addBox(rack, 1.1, 0.035, 0.04, 0, 0.5 + i * 0.055, 0.44, M.darkRough);
  }
  // 青色灯条
  addBox(rack, 0.07, 1.9, 0.05, 0.6, 1.45, 0.44, M.stripCyan);
  // 小屏
  const sm = screenMaterial(screen);
  const s = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.46), sm.base);
  s.position.set(-0.2, 2.1, 0.44);
  rack.add(s);
  // 顶部管道
  pipeRun(rack, M, {
    from: [-0.4, 2.6, 0],
    to: [-0.4, 4.6, 0],
    radius: 0.07,
    count: 3,
    spread: 0.16,
  });

  return rack;
}

/* ------------------------- 货舱闸门 ------------------------- */

function buildCargoDoor(group, M) {
  const door = new THREE.Group();
  door.position.set(4.5, 0, 1.2);
  door.rotation.y = -Math.PI / 2;
  group.add(door);

  addBox(door, 3.4, 2.7, 0.3, 0, 1.35, 0, M.dark, { cast: true, receive: true });
  // 斜纹危险框
  const frame = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 2.8), M.hazard);
  frame.position.set(0, 1.35, -0.16);
  door.add(frame);
  // 门板
  addBox(door, 2.9, 2.2, 0.24, 0, 1.35, 0.08, M.darkRough, { cast: true });
  // 中央分割线
  addBox(door, 0.06, 2.2, 0.02, 0, 1.35, 0.21, M.steel);
  // 锁止机构
  for (const y of [0.6, 1.35, 2.1]) {
    addBox(door, 0.5, 0.16, 0.12, 0.85, y, 0.22, M.steel, { cast: true });
  }
  // 状态绿灯
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.075, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0x6effa8 })
  );
  lamp.position.set(-1.15, 2.42, 0.2);
  door.add(lamp);
  // 警告贴标
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 0.28),
    new THREE.MeshBasicMaterial({
      map: decalLabel({ lines: ['货舱闸门', 'CARGO BULKHEAD'], accent: '#f2c230' }),
      transparent: true,
    })
  );
  label.position.set(0, 2.5, 0.2);
  door.add(label);

  return door;
}

/* ------------------------- 顶部设施 ------------------------- */

function buildCeilingRig(group, M) {
  // 灯槽（用暗一档的自发光，避免顶部糊出泛光）
  for (const z of [-4.6, -1.0, 2.6]) {
    addBox(group, 6.2, 0.1, 0.26, 0, ROOM.height - 0.14, z, M.darkRough);
    addBox(group, 5.9, 0.045, 0.16, 0, ROOM.height - 0.2, z, M.stripCyanDim);
  }
  // 走线架
  for (const s of [-1, 1]) {
    const rail = new THREE.Mesh(box(0.1, 0.16, 12.4), M.steel);
    rail.position.set(s * 3.6, ROOM.height - 0.55, -0.6);
    rail.castShadow = true;
    group.add(rail);
    // 吊挂线缆
    for (let i = 0; i < 9; i++) {
      const z = -6.2 + i * 1.4;
      const pts = [];
      for (let k = 0; k <= 8; k++) {
        const t = k / 8;
        pts.push(
          new THREE.Vector3(
            s * (3.6 + Math.sin(t * 3 + i) * 0.12),
            ROOM.height - 0.62 - t * 0.55,
            z + Math.sin(t * 2.4 + i) * 0.22
          )
        );
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 14, 0.028, 5, false), M.darkRough);
      group.add(tube);
    }
  }
  // 中央管道
  pipeRun(group, M, {
    from: [0.9, ROOM.height - 0.35, -7],
    to: [0.9, ROOM.height - 0.35, 7],
    radius: 0.13,
    count: 3,
    spread: 0.3,
    mat: M.darkRough,
  });
}

/* ------------------------- 地面标识 ------------------------- */

function buildFloorMarks(group, M) {
  // 中央通道黄线
  const lineMat = new THREE.MeshStandardMaterial({
    color: 0xd8a83a,
    roughness: 0.8,
    metalness: 0.1,
    emissive: 0x3a2a08,
    emissiveIntensity: 0.4,
  });
  for (const s of [-1, 1]) {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 11.5), lineMat);
    l.rotation.x = -Math.PI / 2;
    l.position.set(s * 1.35, 0.006, -1.2);
    group.add(l);
  }
  // 危险区斜纹
  const haz = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.7), M.hazard);
  haz.rotation.x = -Math.PI / 2;
  haz.rotation.z = Math.PI / 2;
  haz.position.set(0, 0.007, 5.4);
  group.add(haz);

  // 地面编号
  const num = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 0.75),
    new THREE.MeshBasicMaterial({
      map: decalLabel({ lines: ['DECK 04'], accent: '#7d8794', bar: false }),
      transparent: true,
      opacity: 0.5,
    })
  );
  num.rotation.x = -Math.PI / 2;
  num.rotation.z = Math.PI;
  num.position.set(-3.1, 0.008, 3.2);
  group.add(num);
}

/* ------------------------- 浮尘 ------------------------- */

function buildDust(group) {
  const count = 260;
  const pos = new Float32Array(count * 3);
  const seedArr = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * ROOM.width * 0.95;
    pos[i * 3 + 1] = Math.random() * ROOM.height;
    pos[i * 3 + 2] = (Math.random() - 0.5) * ROOM.depth * 0.95;
    seedArr[i] = Math.random() * 100;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seedArr, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: dustSprite() },
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime;
      uniform float uPixelRatio;
      varying float vAlpha;
      void main(){
        vec3 p = position;
        p.y += sin(uTime * 0.18 + aSeed) * 0.5;
        p.x += cos(uTime * 0.13 + aSeed * 1.7) * 0.4;
        p.z += sin(uTime * 0.09 + aSeed * 2.3) * 0.4;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float d = -mv.z;
        // 只在舷窗附近（前方）才明显可见
        float front = smoothstep(4.0, -4.0, p.z);
        vAlpha = smoothstep(14.0, 4.0, d) * 0.14 * (0.3 + front * 0.7);
        gl_PointSize = clamp((4.0 + mod(aSeed, 5.0)) * uPixelRatio * 26.0 / max(d, 1.0), 0.6, 4.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying float vAlpha;
      void main(){
        vec4 t = texture2D(uMap, gl_PointCoord);
        gl_FragColor = vec4(vec3(1.0, 0.94, 0.82), t.a * vAlpha);
        if (gl_FragColor.a < 0.004) discard;
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  group.add(pts);
  return pts;
}

/* ------------------------- 灯光 ------------------------- */

function buildLights(group, M) {
  RectAreaLightUniformsLib.init();

  // 舷窗主光（平行光模拟行星反照）—— 从窗外打进来
  const sun = new THREE.DirectionalLight(0xc8dcff, 2.1);
  sun.position.set(-7, 6, -18);
  sun.target.position.set(1.5, 0.6, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -10;
  sun.shadow.camera.right = 10;
  sun.shadow.camera.top = 10;
  sun.shadow.camera.bottom = -10;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 44;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.028;
  group.add(sun, sun.target);

  // 窗面区域光（柔和的冷色补光）
  const winLight = new THREE.RectAreaLight(0xa8ccff, 1.5, 8.6, 2.6);
  winLight.position.set(0, 2.9, -ROOM.halfD + 0.3);
  winLight.lookAt(0, 1.6, 4);
  group.add(winLight);

  // 室内环境光
  const hemi = new THREE.HemisphereLight(0x6a86b4, 0x1b1f26, 0.55);
  group.add(hemi);

  // 天花照明：多而弱地铺，且离天花板远一点，避免顶部出现热斑
  for (const z of [-5.8, -3.2, -0.6, 2.0, 4.6]) {
    const p = new THREE.PointLight(0xcfeaff, 10, 11, 2);
    p.position.set(0, ROOM.height - 2.0, z);
    group.add(p);
  }
  // 侧壁灯条补光
  for (const s of [-1, 1]) {
    const p = new THREE.PointLight(0x5fe4da, 5, 8, 2);
    p.position.set(s * (ROOM.halfW - 0.6), 1.7, 0.5);
    group.add(p);
  }
  // 暖色工作灯（主控台）
  const warm = new THREE.PointLight(0xffb060, 6, 7, 2);
  warm.position.set(-0.3, 1.7, -1.6);
  group.add(warm);
  // 后舱补光，避免后景死黑
  const back = new THREE.PointLight(0x88a8d0, 5, 10, 2);
  back.position.set(0, 2.8, 5.6);
  group.add(back);

  return { sun, winLight };
}

/* ------------------------- 组装 ------------------------- */

/**
 * @param {{texture: THREE.Texture, update: Function}[]} screens
 */
export function createCabin(screens) {
  const group = new THREE.Group();
  const M = buildMaterials();

  buildShell(group, M);
  buildViewport(group, M);
  const console3d = buildConsole(group, M, screens.slice(0, 3));
  const life = buildLifeRack(group, M, screens[3]);
  const cargo = buildCargoDoor(group, M);
  buildCeilingRig(group, M);
  buildFloorMarks(group, M);
  const dust = buildDust(group);
  buildLights(group, M);

  // 热点标记
  console3d.userData.hotspot = 'console';
  life.userData.hotspot = 'life';
  cargo.userData.hotspot = 'cargo';
  group.userData.viewportAnchor = new THREE.Vector3(0, 3.0, -ROOM.halfD + 0.6);

  const update = (dt, t) => {
    dust.material.uniforms.uTime.value = t;
  };

  return {
    group,
    update,
    dust,
    materials: M,
    anchors: {
      console: console3d,
      life,
      cargo,
    },
  };
}
