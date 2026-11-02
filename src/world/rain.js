import * as THREE from 'three';
import { rand } from '../util/rng.js';

/**
 * 下雨：斜向的雨丝 + 落在地上的水花涟漪
 */
export function createRain({ count = 1500, areaX = 44, areaZ = 38, top = 15 } = {}) {
  const group = new THREE.Group();
  group.name = 'rain';

  const positions = new Float32Array(count * 2 * 3);
  const drops = [];

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.LineBasicMaterial({
    color: 0xbcd6ef,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    fog: false,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  group.add(lines);

  for (let i = 0; i < count; i++) {
    drops.push({
      x: rand(-areaX / 2, areaX / 2),
      y: rand(0, top),
      z: rand(-4, -4 + areaZ),
      len: rand(0.3, 0.85),
      speed: rand(16, 26),
    });
  }

  /* ---------------- 水花涟漪 ---------------- */
  const ringGeo = new THREE.RingGeometry(0.04, 0.07, 12);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xcfe2f5,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const ripples = [];
  for (let i = 0; i < 70; i++) {
    const m = new THREE.Mesh(ringGeo, ringMat.clone());
    m.rotation.x = -Math.PI / 2;
    m.visible = false;
    m.renderOrder = 3;
    group.add(m);
    ripples.push({ mesh: m, life: 0 });
  }

  const wind = -1.6;
  let enabled = true;

  function resetDrop(d) {
    d.y = rand(10, 16);
    d.x = rand(-areaX / 2, areaX / 2);
    d.z = rand(-4, -4 + areaZ);
  }

  return {
    group,
    get enabled() {
      return enabled;
    },
    setEnabled(v) {
      enabled = v;
      group.visible = v;
    },
    update(dt) {
      if (!enabled) return;
      const arr = geo.attributes.position.array;
      for (let i = 0; i < count; i++) {
        const d = drops[i];
        d.y -= d.speed * dt;
        d.x += wind * dt;
        if (d.y < -0.2) {
          resetDrop(d);
          // 随机触发一个水花
          if (chanceSafe(0.35)) {
            const r = ripples[Math.floor(Math.random() * ripples.length)];
            if (r.life <= 0) {
              r.life = 0.42;
              r.mesh.visible = true;
              r.mesh.position.set(d.x, 0.045, d.z);
              r.mesh.scale.setScalar(1);
            }
          }
        }
        const j = i * 6;
        arr[j] = d.x;
        arr[j + 1] = d.y;
        arr[j + 2] = d.z;
        arr[j + 3] = d.x - wind * 0.045;
        arr[j + 4] = d.y + d.len;
        arr[j + 5] = d.z;
      }
      geo.attributes.position.needsUpdate = true;

      for (const r of ripples) {
        if (r.life <= 0) continue;
        r.life -= dt;
        const k = 1 - r.life / 0.42;
        r.mesh.scale.setScalar(1 + k * 5);
        r.mesh.material.opacity = Math.max(0, (1 - k) * 0.45);
        if (r.life <= 0) r.mesh.visible = false;
      }
    },
  };
}

function chanceSafe(p) {
  return Math.random() < p;
}
