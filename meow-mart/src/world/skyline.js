import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rand, randInt, chance } from '../util/rng.js';
import { makeBuildingTexture } from '../util/textures.js';

/** 远景城市天际线：剪影楼群 + 亮着的窗户 + 红色航空警示灯 */
export function createSkyline() {
  const group = new THREE.Group();
  group.name = 'skyline';

  const tex = makeBuildingTexture();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x0b0f1c,
    roughness: 0.95,
    metalness: 0.0,
    map: tex,
    emissiveMap: tex,
    emissive: 0xffffff,
    emissiveIntensity: 0.55,
  });
  const plainMat = new THREE.MeshStandardMaterial({ color: 0x090d18, roughness: 1 });

  const clusters = [
    { z: -78, spread: 150, count: 26, base: 12 },
    { z: -48, spread: 110, count: 18, base: 9 },
    { z: -110, spread: 230, count: 22, base: 18 },
    { z: 78, spread: 170, count: 14, base: 10 },
    { x: -95, spread: 90, count: 12, base: 12, axis: 'x' },
    { x: 98, spread: 90, count: 12, base: 14, axis: 'x' },
  ];

  const beacons = [];
  // 把所有楼体按材质合并成两个 Mesh，省下上百个 draw call
  const buckets = { body: [], plain: [] };

  for (const cl of clusters) {
    for (let i = 0; i < cl.count; i++) {
      const w = rand(5, 13);
      const d = rand(5, 13);
      const h = rand(cl.base, cl.base * 3.1);
      let x;
      let z;
      if (cl.axis === 'x') {
        z = rand(-cl.spread, cl.spread);
        x = cl.x + rand(-18, 18);
      } else {
        x = rand(-cl.spread, cl.spread);
        z = cl.z + rand(-16, 16);
      }
      const rotY = rand(-0.3, 0.3);

      const geo = new THREE.BoxGeometry(w, h, d);
      const m = new THREE.Matrix4()
        .makeRotationY(rotY)
        .setPosition(x, h / 2, z);
      geo.applyMatrix4(m);
      buckets[chance(0.72) ? 'body' : 'plain'].push(geo);

      // 楼顶天线 / 警示灯
      if (chance(0.35)) {
        const pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.22, 0.3, rand(3, 9), 6),
          plainMat
        );
        pole.position.set(x, h + 2, z);
        group.add(pole);
        const beacon = new THREE.Mesh(
          new THREE.SphereGeometry(0.7, 8, 8),
          new THREE.MeshBasicMaterial({ color: 0xff3344, fog: false })
        );
        beacon.position.set(x, h + rand(4, 7), z);
        beacon.userData.phase = rand(0, Math.PI * 2);
        group.add(beacon);
        beacons.push(beacon);
      }
    }
  }

  for (const [key, list] of Object.entries(buckets)) {
    if (!list.length) continue;
    const merged = mergeGeometries(list, false);
    list.forEach((g) => g.dispose());
    const mesh = new THREE.Mesh(merged, key === 'body' ? bodyMat : plainMat);
    mesh.frustumCulled = false;
    group.add(mesh);
  }

  return {
    group,
    update(t) {
      for (const b of beacons) {
        const on = Math.sin(t * 1.6 + b.userData.phase) > 0.55;
        b.material.color.setRGB(on ? 1 : 0.22, on ? 0.16 : 0.03, on ? 0.2 : 0.04);
      }
    },
  };
}
