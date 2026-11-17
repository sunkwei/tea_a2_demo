/**
 * 终末地 · 舰桥观测舱 —— 主入口
 *
 * 场景：泰拉II 轨道站「长明号」的舰桥观测舱。
 * 面向前方的大面积舷窗外，是泰拉II 行星与贯穿行星与轨道的天梯缆索。
 *
 * 注意：样式是用 <link> 引的（见 index.html），不是 import —— 这样不依赖打包器。
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { ShipTelemetry, EventLog, HOTSPOTS, SHIP, HOME_VIEW } from './core.js';
import { liveScreen } from './textures.js';
import { createSpace } from './world/space.js';
import { createCabin, ROOM } from './world/cabin.js';
import { createLightShafts } from './world/shafts.js';
import {
  createHologramTable,
  createCrates,
  createEquipment,
  createSignage,
  createDrone,
} from './world/props.js';
import { createPostFX } from './world/postfx.js';
import { Hud, runBootSequence } from './ui/hud.js';
import { Terminal } from './ui/terminal.js';

/* ================================================================== *
 *  渲染器
 * ================================================================== */

const stage = document.getElementById('stage');

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
  stencil: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
// three 0.186 已移除 PCFSoftShadowMap，这里用 PCF + 更大 shadow map
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.outputColorSpace = THREE.SRGBColorSpace;
// 后期链有多趟 render，每趟都会 reset info；关掉自动重置，
// 改为每帧手动 reset，这样 info.render 统计的是整帧的 draw call / 三角形数
renderer.info.autoReset = false;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02040a);

const camera = new THREE.PerspectiveCamera(
  46,
  window.innerWidth / window.innerHeight,
  0.08,
  6000
);
camera.position.set(...HOME_VIEW.pos);

/* ================================================================== *
 *  环境光（PMREM）
 * ================================================================== */

function buildEnvironment() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext('2d');

  // 上半：舱顶的冷白灯带
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0.0, '#1b2735');
  g.addColorStop(0.28, '#141e29');
  g.addColorStop(0.5, '#0d141c');
  g.addColorStop(0.72, '#10161d');
  g.addColorStop(1.0, '#06080c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 256);

  // 舷窗方向的冷色高光
  const win = ctx.createRadialGradient(256, 118, 8, 256, 118, 190);
  win.addColorStop(0, 'rgba(160, 200, 255, 0.95)');
  win.addColorStop(0.4, 'rgba(80, 120, 190, 0.45)');
  win.addColorStop(1, 'rgba(20, 30, 50, 0)');
  ctx.fillStyle = win;
  ctx.fillRect(0, 0, 512, 256);

  // 侧壁青色灯条
  for (const x of [58, 454]) {
    const strip = ctx.createRadialGradient(x, 128, 2, x, 128, 110);
    strip.addColorStop(0, 'rgba(95, 240, 228, 0.6)');
    strip.addColorStop(1, 'rgba(20, 60, 60, 0)');
    ctx.fillStyle = strip;
    ctx.fillRect(0, 0, 512, 256);
  }

  // 暖色工作灯
  const warm = ctx.createRadialGradient(180, 150, 4, 180, 150, 120);
  warm.addColorStop(0, 'rgba(255, 175, 95, 0.5)');
  warm.addColorStop(1, 'rgba(60, 30, 10, 0)');
  ctx.fillStyle = warm;
  ctx.fillRect(0, 0, 512, 256);

  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const env = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
  tex.dispose();
  return env;
}
scene.environment = buildEnvironment();
scene.environmentIntensity = 0.72;

/* ================================================================== *
 *  场景内容
 * ================================================================== */

// 屏幕贴图：liveScreen 返回 { texture, update }
const screens = [
  liveScreen('radar', { title: 'PROXIMITY / 近距扫描', accent: '#5ff0e4' }),
  liveScreen('wave', { title: 'REACTOR OUTPUT / 反应堆波形', accent: '#f2c230' }),
  liveScreen('bars', { title: 'POWER DISTRIBUTION / 能源分配', accent: '#5ff0e4' }),
  liveScreen('text', { title: 'LIFE SUPPORT / 生命维持', accent: '#8fe6a8' }),
];

const space = createSpace();
scene.add(space.group);

const cabin = createCabin(screens);
scene.add(cabin.group);

const shafts = createLightShafts();
scene.add(shafts.group);

const holo = createHologramTable();
scene.add(holo.group);

const crates = createCrates();
scene.add(crates.group);

const equipment = createEquipment();
scene.add(equipment.group);

const signage = createSignage();
scene.add(signage.group);

const drone = createDrone();
scene.add(drone.group);

// 舷窗热点用的不可见代理
const viewportProxy = new THREE.Mesh(
  new THREE.PlaneGeometry(8.4, 3.1),
  new THREE.MeshBasicMaterial({ visible: false })
);
viewportProxy.position.set(0, 3.0, -ROOM.halfD + 0.05);
viewportProxy.userData.hotspot = 'viewport';
scene.add(viewportProxy);

/* ================================================================== *
 *  后期
 * ================================================================== */

const postfx = createPostFX(renderer, scene, camera);

/* ================================================================== *
 *  相机控制
 * ================================================================== */

const HOME_POS = new THREE.Vector3(...HOME_VIEW.pos);
const HOME_TARGET = new THREE.Vector3(...HOME_VIEW.target);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(HOME_TARGET);
controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.minDistance = 1.2;
controls.maxDistance = 10;
controls.maxPolarAngle = Math.PI * 0.55;
controls.minPolarAngle = Math.PI * 0.16;
controls.enablePan = false;
controls.rotateSpeed = 0.4;
controls.zoomSpeed = 0.7;

let idleTimer = 0;
controls.addEventListener('start', () => {
  idleTimer = 0;
  camAnim.active = false;
});

/* ---------------- 相机运镜 ----------------
 *
 * 关键点：运镜进度用「墙钟时间」算，而不是累加的 dt。
 * 因为 dt 为了物理稳定被夹在 0.05s 以内，在低帧率机器（软件渲染）上
 * 累加 dt 会让一次 1.7 秒的运镜拖成几十秒。
 * 墙钟时间保证任何帧率下运镜都是 1.7 秒。
 */
const camAnim = {
  active: false,
  start: 0,
  dur: 1600,
  fromPos: new THREE.Vector3(),
  toPos: new THREE.Vector3(),
  fromTarget: new THREE.Vector3(),
  toTarget: new THREE.Vector3(),
};

const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

function flyTo(pos, target, dur = 1.6) {
  camAnim.active = true;
  camAnim.start = performance.now();
  camAnim.dur = dur * 1000;
  camAnim.fromPos.copy(camera.position);
  camAnim.toPos.copy(pos);
  camAnim.fromTarget.copy(controls.target);
  camAnim.toTarget.copy(target);
}

/** 立刻把相机放到某个机位（不做过渡） */
function snapTo(pos, target) {
  camAnim.active = false;
  camera.position.copy(pos);
  controls.target.copy(target);
  controls.update();
}

/* ================================================================== *
 *  状态
 * ================================================================== */

const telemetry = new ShipTelemetry(20261117);
const eventLog = new EventLog(60);

const BOOT_SEED = [
  ['info', '舰载总线', '主控台联机，管理员权限已确认。'],
  ['info', '导航', '当前航路：泰拉II 轨道中继站 · 泊位 07。'],
  ['info', '生命维持', '舱内环境参数已稳定在标准区间。'],
  ['info', '遥测', '偏导护盾阵列转入常规巡检模式。'],
  ['info', '通讯', '与轨道中继站的握手完成，延迟 0.42s。'],
];
for (const [level, source, text] of BOOT_SEED) {
  eventLog.push(level, source, text, 0);
}

/* ================================================================== *
 *  UI
 * ================================================================== */

const uiRoot = document.getElementById('ui');

const hud = new Hud(uiRoot, {
  onFocus: (spot) => {
    const cam = spot.camera;
    flyTo(new THREE.Vector3(...cam.pos), new THREE.Vector3(...cam.target), 1.7);
    hud.toast(`已聚焦：${spot.label}`, 'info', spot.subtitle);
  },
  onHotspot: () => {},
  onCommand: (type, payload) => {
    if (type === 'open-terminal') terminal.show();
    else if (type === 'close-focus') flyTo(HOME_POS, HOME_TARGET, 1.5);
    else if (type === 'lock-focus') {
      hud.toast('观测焦点已锁定', 'info', 'LOCKED');
    } else if (type === 'radar') {
      hud.toast('近距扫描已展开至右侧面板', 'info', 'RADAR');
    } else if (type === 'toggle-log') {
      const c = document.getElementById('comms');
      c.style.display = c.style.display === 'none' ? '' : 'none';
    } else if (type === 'drone') {
      drone.group.visible = payload.value;
      hud.toast(payload.value ? '巡检无人机已唤醒' : '巡检无人机已返航', 'info', 'ODIN-07');
    } else if (type === 'autopilot') {
      hud.toast(payload.value ? '自动姿态控制已接管' : '已切换至手动姿态', 'info', 'AUTOPILOT');
    } else if (type === 'focus') {
      const spot = HOTSPOTS.find((h) => h.id === payload.id);
      if (spot) {
        hud.openFocus(payload.id);
        flyTo(new THREE.Vector3(...spot.camera.pos), new THREE.Vector3(...spot.camera.target), 1.7);
      }
    } else if (type === 'clear') {
      terminal.body.innerHTML = '';
    } else if (type === 'rail') {
      hud.toast(`${payload.zh}模块：当前为演示版本`, 'info', payload.en);
    }
  },
});

const terminal = new Terminal(uiRoot, {
  telemetry,
  log: eventLog,
  onAction: (action) => {
    hud.onCommand(action.type, action);
  },
});

for (const e of eventLog.entries) hud.pushLog(e);

/* ================================================================== *
 *  拾取交互
 * ================================================================== */

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerDown = null;
let hovered = null;

const pickables = [];
cabin.group.traverse((o) => {
  if (o.userData && o.userData.hotspot) pickables.push(o);
});
pickables.push(viewportProxy);

function pickHotspot() {
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(pickables, true);
  if (!hit.length) return null;
  let obj = hit[0].object;
  while (obj && !(obj.userData && obj.userData.hotspot)) obj = obj.parent;
  return obj ? obj.userData.hotspot : null;
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  pointerDown = { x: e.clientX, y: e.clientY };
});

renderer.domElement.addEventListener('pointerup', (e) => {
  if (!pointerDown) return;
  const moved = Math.hypot(e.clientX - pointerDown.x, e.clientY - pointerDown.y);
  pointerDown = null;
  if (moved > 6) return;

  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  const id = pickHotspot();
  if (id) hud.openFocus(id);
  else hud.closeFocus();
});

renderer.domElement.addEventListener('pointermove', (e) => {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  const id = pickHotspot();
  if (id !== hovered) {
    hovered = id;
    hud.setHover(id);
    renderer.domElement.style.cursor = id ? 'pointer' : 'default';
  }
});

/* ================================================================== *
 *  键盘
 * ================================================================== */

window.addEventListener('keydown', (e) => {
  if (terminal.open) return;
  const k = e.key.toLowerCase();
  if (k === 't') {
    terminal.toggle();
    e.preventDefault();
  } else if (k === 'h') {
    hud.hud.classList.toggle('live');
  } else if (k === 'escape') {
    hud.closeFocus();
    flyTo(HOME_POS, HOME_TARGET, 1.5);
  } else if (k >= '1' && k <= '5') {
    const spot = HOTSPOTS[Number(k) - 1];
    if (spot) {
      hud.openFocus(spot.id);
      flyTo(new THREE.Vector3(...spot.camera.pos), new THREE.Vector3(...spot.camera.target), 1.6);
    }
  }
});

/* ================================================================== *
 *  事件注入：把遥测事件同步到通讯日志
 * ================================================================== */

let lastEventCount = 0;
function syncEvents() {
  while (lastEventCount < telemetry.events.length) {
    const e = telemetry.events[lastEventCount++];
    eventLog.push(e.level, e.source, e.text, e.t);
    hud.pushLog(e);
    if (e.level !== 'info') {
      hud.toast(e.text, e.level, e.source);
    }
  }
}

/* ================================================================== *
 *  主循环
 * ================================================================== */

let last = -1; // 第一帧用 rAF 时间戳初始化
let elapsed = 0;
let frames = 0;
let fpsTimer = 0;
let fps = 60;

function animate(now) {
  requestAnimationFrame(animate);
  // rAF 的时间戳可能略小于 performance.now()（两者时钟基准略有差异），
  // 因此 dt 必须夹紧下界，否则会变成负数把 elapsed 带成负数，
  // 之后用负数去取曲线采样点就会越界（points[-1] → undefined）。
  if (last < 0) last = now;
  const dt = Math.min(Math.max((now - last) / 1000, 0), 0.05);
  last = now;
  elapsed += dt;

  // FPS 自适应：低帧率时降分辨率
  frames++;
  fpsTimer += dt;
  if (fpsTimer > 1.5) {
    fps = frames / fpsTimer;
    frames = 0;
    fpsTimer = 0;
    if (fps < 26 && renderer.getPixelRatio() > 1) {
      renderer.setPixelRatio(1);
      postfx.setSize(window.innerWidth, window.innerHeight);
    }
  }

  // 遥测
  telemetry.step(dt);
  syncEvents();
  hud.update(telemetry, elapsed);

  // 场景更新
  space.update(dt, elapsed);
  cabin.update(dt, elapsed);
  shafts.update(dt, elapsed);
  holo.update(dt, elapsed);
  drone.update(dt, elapsed);
  for (const s of screens) s.update(elapsed);

  // 相机运镜（用墙钟时间，低帧率下也是 1.6 秒走完）
  if (camAnim.active) {
    const k = easeInOut(Math.min(1, (performance.now() - camAnim.start) / camAnim.dur));
    camera.position.lerpVectors(camAnim.fromPos, camAnim.toPos, k);
    controls.target.lerpVectors(camAnim.fromTarget, camAnim.toTarget, k);
    if (k >= 1) camAnim.active = false;
  } else {
    idleTimer += dt;
    if (idleTimer > 14) {
      // 长时间无操作：缓慢环绕
      const ang = dt * 0.028;
      const p = camera.position.clone().sub(controls.target);
      p.applyAxisAngle(new THREE.Vector3(0, 1, 0), ang);
      camera.position.copy(controls.target).add(p);
      camera.position.y += Math.sin(elapsed * 0.25) * 0.0009;
    }
  }
  controls.update();

  // 后期
  const alert = telemetry.severity === 'critical' ? 1 : telemetry.severity === 'warning' ? 0.3 : 0;
  postfx.update(elapsed, alert);

  renderer.info.reset();
  postfx.composer.render();
}

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  postfx.setSize(w, h);
}
window.addEventListener('resize', onResize);

/* ================================================================== *
 *  启动
 * ================================================================== */

const boot = runBootSequence(uiRoot);
boot.promise.then(() => {
  hud.setLive(true);
  hud.toast(`${SHIP.hullCn} · 观测舱已就绪`, 'info', SHIP.hullEn);
});

requestAnimationFrame(animate);

/* ================================================================== *
 *  暴露给自动化测试
 * ================================================================== */

window.__endfield = {
  scene,
  camera,
  controls,
  renderer,
  postfx,
  space,
  cabin,
  holo,
  shafts,
  telemetry,
  eventLog,
  hud,
  terminal,
  hotspots: HOTSPOTS,
  homeView: HOME_VIEW,
  get fps() {
    return fps;
  },
  get elapsed() {
    return elapsed;
  },
  get camAnimating() {
    return camAnim.active;
  },
  openFocus: (id) => hud.openFocus(id),
  closeFocus: () => hud.closeFocus(),
  flyHome: () => flyTo(HOME_POS, HOME_TARGET, 1.2),
  snapHome: () => snapTo(HOME_POS, HOME_TARGET),
  runCommand: (c) => terminal.run(c),

  /** 立刻切到某个热点的机位（跳过过渡），供测试用 */
  snapToFocus(id) {
    const spot = HOTSPOTS.find((h) => h.id === id);
    if (!spot) return false;
    snapTo(new THREE.Vector3(...spot.camera.pos), new THREE.Vector3(...spot.camera.target));
    return true;
  },

  /**
   * 在同一帧里渲染并读回像素，用来判断「真的画出了东西」。
   * readPixels 必须紧跟在 render 之后，否则后缓冲已经被清掉。
   */
  samplePixels(step = 37) {
    postfx.composer.render();
    const gl = renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let nonBlack = 0;
    let sum = 0;
    let maxV = 0;
    let sampled = 0;
    for (let i = 0; i < px.length; i += 4 * step) {
      const v = Math.max(px[i], px[i + 1], px[i + 2]);
      if (v > 12) nonBlack++;
      sum += v;
      if (v > maxV) maxV = v;
      sampled++;
    }
    return {
      width: w,
      height: h,
      nonBlackPct: +((nonBlack / sampled) * 100).toFixed(1),
      avg: +(sum / sampled).toFixed(1),
      maxV,
    };
  },
};
