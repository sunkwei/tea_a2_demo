import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import { createSky } from './world/sky.js';
import { createSkyline } from './world/skyline.js';
import { createStreet } from './world/street.js';
import { createStore } from './world/store.js';
import { createCat } from './world/cat.js';
import { createProps } from './world/props.js';
import { createRain } from './world/rain.js';

import './style.css';

/* ==================================================================
 *  渲染器
 * ================================================================== */
const container = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04060d);
scene.fog = new THREE.FogExp2(0x080c16, 0.019);

const camera = new THREE.PerspectiveCamera(
  38,
  window.innerWidth / window.innerHeight,
  0.1,
  800
);
camera.position.set(9.2, 5.0, 19.5);

/* ==================================================================
 *  环境反射（用一张渐变天空做 IBL）
 * ================================================================== */
function buildEnvironmentMap() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0.0, '#070c1c');
  g.addColorStop(0.44, '#111423');
  g.addColorStop(0.56, '#241c26');
  g.addColorStop(0.7, '#2c1e18');
  g.addColorStop(1.0, '#0a0c12');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 128);
  // 一块暖色的"城市光"
  const warm = ctx.createRadialGradient(64, 78, 4, 64, 78, 70);
  warm.addColorStop(0, 'rgba(255,150,90,0.4)');
  warm.addColorStop(1, 'rgba(255,150,90,0)');
  ctx.fillStyle = warm;
  ctx.fillRect(0, 0, 256, 128);

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
scene.environment = buildEnvironmentMap();
scene.environmentIntensity = 0.3;

/* ==================================================================
 *  灯光
 * ================================================================== */
const hemi = new THREE.HemisphereLight(0x3d5a8c, 0x07090e, 0.22);
scene.add(hemi);

const moon = new THREE.DirectionalLight(0x9fbaff, 0.55);
moon.position.set(-9, 16, 7);
moon.castShadow = true;
moon.shadow.mapSize.set(1536, 1536);
moon.shadow.camera.left = -20;
moon.shadow.camera.right = 20;
moon.shadow.camera.top = 18;
moon.shadow.camera.bottom = -12;
moon.shadow.camera.near = 1;
moon.shadow.camera.far = 60;
moon.shadow.bias = -0.0006;
moon.shadow.normalBias = 0.025;
scene.add(moon);

const fill = new THREE.DirectionalLight(0xffb48a, 0.1);
fill.position.set(6, 5, -8);
scene.add(fill);

/* ==================================================================
 *  场景内容
 * ================================================================== */
const sky = createSky();
scene.add(sky.group);

const skyline = createSkyline();
scene.add(skyline.group);

const street = createStreet();
scene.add(street.group);

const store = createStore();
scene.add(store.group);

const props = createProps();
scene.add(props.group);

const cat = createCat();
scene.add(cat.group);

const rain = createRain();
scene.add(rain.group);

/* ==================================================================
 *  相机控制
 * ================================================================== */
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(-0.4, 1.9, 1.4);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 6;
controls.maxDistance = 36;
controls.maxPolarAngle = 1.5;
controls.minPolarAngle = 0.15;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.28;
controls.enablePan = false;

let idleTimer = 0;
controls.addEventListener('start', () => {
  controls.autoRotate = false;
  idleTimer = 0;
});

/* ==================================================================
 *  后处理
 * ================================================================== */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.45, // strength
  0.55, // radius
  0.88 // threshold
);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* ==================================================================
 *  交互
 * ================================================================== */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const meowEl = document.getElementById('meow');
const hudEl = document.getElementById('hud');

let pointerDown = null;

renderer.domElement.addEventListener('pointerdown', (e) => {
  pointerDown = { x: e.clientX, y: e.clientY };
});

renderer.domElement.addEventListener('pointerup', (e) => {
  if (!pointerDown) return;
  const moved = Math.hypot(e.clientX - pointerDown.x, e.clientY - pointerDown.y);
  pointerDown = null;
  if (moved > 6) return; // 拖拽视角不算点击

  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  const hit = raycaster.intersectObject(cat.group, true);
  if (hit.length > 0) {
    cat.happy();
    showMeow(e.clientX, e.clientY);
    return;
  }

  // 其它可点的东西：招牌 / 路灯 / 售货机
  const named = raycaster
    .intersectObjects(scene.children, true)
    .find((h) => h.object.name && ACTIONS[h.object.name]);
  if (named) {
    ACTIONS[named.object.name](e);
  }
});

const ACTIONS = {
  fascia: () => {
    const on = store.toggleSign();
    showToast(on ? '招牌亮起来啦 ✨' : '招牌灭了一下…');
  },
  blade: () => {
    const on = store.toggleSign();
    showToast(on ? '竖招牌亮起来啦 ✨' : '竖招牌灭了一下…');
  },
  lampHead: () => {
    const on = props.toggleLamp();
    showToast(on ? '路灯亮啦 💡' : '路灯关掉了…');
  },
  vendingFront: () => {
    props.pokeVending();
    showToast('哐当！掉出一罐猫罐头 🥫');
  },
};

function showToast(text) {
  meowEl.textContent = text;
  meowEl.style.left = '50%';
  meowEl.style.top = '26%';
  meowEl.classList.remove('show');
  void meowEl.offsetWidth;
  meowEl.classList.add('show');
}

function showMeow(x, y) {
  meowEl.textContent = '喵～！';
  meowEl.style.left = `${x}px`;
  meowEl.style.top = `${y}px`;
  meowEl.classList.remove('show');
  void meowEl.offsetWidth; // 重启动画
  meowEl.classList.add('show');
}

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'h') {
    hudEl.classList.toggle('hidden');
  } else if (k === 'r') {
    rain.setEnabled(!rain.enabled);
  }
});

/* ==================================================================
 *  尺寸自适应
 * ================================================================== */
function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloom.setSize(w, h);
}
window.addEventListener('resize', onResize);

/* ==================================================================
 *  自适应画质：弱机器上自动降级（软件渲染器不算）
 * ================================================================== */
const glCtx = renderer.getContext();
const dbgInfo = glCtx.getExtension('WEBGL_debug_renderer_info');
const gpuName = dbgInfo ? String(glCtx.getParameter(dbgInfo.UNMASKED_RENDERER_WEBGL)) : '';
const isSoftwareRenderer = /swiftshader|llvmpipe|software|basic render/i.test(gpuName);

let qualityTimer = 0;
let qualityFrames = 0;
let qualityLocked = false;
function adaptQuality(dt) {
  if (qualityLocked || isSoftwareRenderer) return;
  qualityTimer += dt;
  qualityFrames++;
  if (qualityTimer < 4) return;
  const fps = qualityFrames / qualityTimer;
  if (fps < 24) {
    street.setLowQuality();
    moon.castShadow = false;
    renderer.setPixelRatio(1);
    composer.setSize(window.innerWidth, window.innerHeight);
    console.info('[喵屋] 检测到帧率偏低，已自动关闭水洼反射与阴影');
  }
  qualityLocked = true;
}

/* ==================================================================
 *  主循环
 * ================================================================== */
let last = performance.now();
let elapsed = 0;

function animate(now = performance.now()) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  elapsed += dt;

  // 闲置一会儿就自动转起来
  idleTimer += dt;
  if (idleTimer > 9 && !controls.autoRotate) controls.autoRotate = true;

  controls.update();
  adaptQuality(dt);

  sky.update(dt, elapsed);
  street.update(dt, elapsed);
  skyline.update(elapsed);
  store.update(elapsed, dt);
  props.update(dt, elapsed);
  cat.update(dt, elapsed);
  rain.update(dt);

  composer.render();
}

// 方便在控制台里调试
window.__app = { scene, camera, controls, renderer, cat, store, props, rain, raycaster };

// 首帧渲染完成后隐藏 loading
requestAnimationFrame((t) => {
  last = t;
  animate(t);
  setTimeout(() => {
    document.getElementById('loader').classList.add('hide');
  }, 250);
});
