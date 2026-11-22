import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { rand } from '../util/rng.js';
import { makeAsphaltTextures, makeConcreteTexture } from '../util/textures.js';
import { makePuddleMask } from '../util/puddle.js';

/**
 * 街道：湿沥青路面 + 人行道 + 路缘 + 真实镜面反射的水洼
 *
 * 反射的实现方式：
 *   1. Reflector 放在 y = 0.008 的位置（它会把 y 以下的物体裁掉，所以反射里不会出现路面）
 *   2. 路面平面放在 y = 0.03，材质带一张 alphaMap（黑色 = 全透），水洼中心镂空
 *   3. 于是水洼处能直接看到下面那面镜子，边缘则渐变回普通沥青
 */
export function createStreet() {
  const group = new THREE.Group();
  group.name = 'street';

  const asphalt = makeAsphaltTextures();

  /* ---------- 远处的暗地面 ---------- */
  const farGround = new THREE.Mesh(
    new THREE.PlaneGeometry(500, 500),
    new THREE.MeshStandardMaterial({ color: 0x171a22, roughness: 0.92, metalness: 0.02 })
  );
  farGround.rotation.x = -Math.PI / 2;
  farGround.position.y = -0.02;
  farGround.receiveShadow = true;
  group.add(farGround);

  /* ---------- 水洼镜面 ---------- */
  const mirror = new Reflector(new THREE.PlaneGeometry(40, 40), {
    clipBias: 0.003,
    textureWidth: 768,
    textureHeight: 768,
    color: 0x5c6579,
  });
  mirror.rotation.x = -Math.PI / 2;
  mirror.position.set(0, 0.008, 12);
  group.add(mirror);

  // 给镜面加一点水波扰动，让倒影不那么"死板"
  const mirrorMat = mirror.material;
  mirrorMat.uniforms.uTime = { value: 0 };
  mirrorMat.fragmentShader = mirrorMat.fragmentShader
    .replace('void main() {', 'uniform float uTime;\nvoid main() {')
    .replace(
      'vec4 base = texture2DProj( tDiffuse, vUv );',
      [
        'vec2 uvv = vUv.xy / vUv.w;',
        'uvv += vec2( sin( uvv.y * 24.0 + uTime * 1.1 ),',
        '             cos( uvv.x * 19.0 + uTime * 0.9 ) ) * 0.0035;',
        'vec4 base = texture2DProj( tDiffuse, vec4( uvv * vUv.w, vUv.zw ) );',
      ].join('\n')
    );
  mirrorMat.needsUpdate = true;

  /* ---------- 带镂空的路面 ---------- */
  const roadMat = new THREE.MeshStandardMaterial({
    map: asphalt.map,
    roughnessMap: asphalt.roughnessMap,
    color: 0x8f93a0,
    roughness: 0.82,
    metalness: 0.22,
    alphaMap: makePuddleMask(),
    transparent: true,
    depthWrite: false,
  });
  const road = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), roadMat);
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.03, 12);
  road.receiveShadow = true;
  road.renderOrder = 1;
  group.add(road);

  /* ---------- 人行道 ---------- */
  const sidewalkTex = makeConcreteTexture([10, 1]);
  const sidewalk = new THREE.Mesh(
    new THREE.BoxGeometry(38, 0.18, 3.6),
    new THREE.MeshStandardMaterial({ map: sidewalkTex, color: 0x9aa0ad, roughness: 0.94 })
  );
  sidewalk.position.set(0, 0.09, 4.5);
  sidewalk.receiveShadow = true;
  sidewalk.castShadow = true;
  group.add(sidewalk);

  const curb = new THREE.Mesh(
    new THREE.BoxGeometry(38, 0.26, 0.28),
    new THREE.MeshStandardMaterial({ color: 0x8d93a0, roughness: 0.9 })
  );
  curb.position.set(0, 0.13, 6.42);
  curb.receiveShadow = true;
  curb.castShadow = true;
  group.add(curb);

  // 人行道上的分割缝
  const seamMat = new THREE.MeshStandardMaterial({ color: 0x555a66, roughness: 1 });
  for (let i = -9; i <= 9; i++) {
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 3.5), seamMat);
    seam.position.set(i * 2.0, 0.09, 4.5);
    group.add(seam);
  }

  /* ---------- 井盖 / 排水口 / 斑马线 ---------- */
  const metal = new THREE.MeshStandardMaterial({ color: 0x3b3f4a, roughness: 0.55, metalness: 0.75 });
  const manhole = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.04, 24), metal);
  manhole.position.set(-4.6, 0.05, 8.4);
  manhole.receiveShadow = true;
  group.add(manhole);

  const drain = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.5), metal);
  drain.position.set(7.4, 0.05, 6.9);
  group.add(drain);
  for (let i = 0; i < 5; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.5), metal);
    bar.position.set(6.95 + i * 0.22, 0.06, 6.9);
    group.add(bar);
  }

  const paint = new THREE.MeshStandardMaterial({
    color: 0xcfd4dd,
    roughness: 0.75,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  for (let i = 0; i < 7; i++) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 5.2), paint);
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(11.5 + i * 1.0, 0.035, 9.6);
    stripe.renderOrder = 2;
    group.add(stripe);
  }
  const dashMat = new THREE.MeshStandardMaterial({
    color: 0xd8c98a,
    roughness: 0.8,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  });
  for (let i = -8; i <= 8; i++) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.22), dashMat);
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(i * 3.4, 0.035, 17.5);
    dash.renderOrder = 2;
    group.add(dash);
  }

  /* ---------- 散落的小垃圾 ---------- */
  const trashMat = new THREE.MeshStandardMaterial({ color: 0xb9bdc4, roughness: 0.9 });
  for (let i = 0; i < 14; i++) {
    const w = rand(0.1, 0.26);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, w * rand(0.7, 1.4)), trashMat);
    p.rotation.x = -Math.PI / 2;
    p.rotation.z = rand(0, Math.PI * 2);
    p.position.set(rand(-16, 16), 0.035, rand(6.6, 17));
    p.renderOrder = 2;
    group.add(p);
  }

  return {
    group,
    mirror,
    /** 低配模式：关掉镜面反射，水洼变成普通湿地面 */
    setLowQuality() {
      mirror.visible = false;
      roadMat.alphaMap = null;
      roadMat.transparent = false;
      roadMat.depthWrite = true;
      roadMat.color.setHex(0x6d7078);
      roadMat.needsUpdate = true;
    },
    update(dt, t) {
      mirrorMat.uniforms.uTime.value = t;
    },
  };
}
