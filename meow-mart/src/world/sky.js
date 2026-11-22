import * as THREE from 'three';
import { rand, randInt } from '../util/rng.js';
import { makeGlowTexture } from '../util/textures.js';

/** 渐变夜空穹顶 + 星空 + 月亮 */
export function createSky() {
  const group = new THREE.Group();
  group.name = 'sky';

  /* ---------------- 天穹 ---------------- */
  const skyGeo = new THREE.SphereGeometry(320, 48, 24);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uZenith: { value: new THREE.Color(0x04060f) },
      uHorizon: { value: new THREE.Color(0x141526) },
      uGlow: { value: new THREE.Color(0x2a1712) },
      uGlowDir: { value: new THREE.Vector3(0.15, 0.06, 1).normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uGlow;
      uniform vec3 uGlowDir;
      varying vec3 vWorld;
      void main() {
        vec3 dir = normalize(vWorld);
        float h = dir.y;
        vec3 col = mix(uHorizon, uZenith, smoothstep(-0.05, 0.55, h));
        // 城市光污染：地平线附近的一圈暖光
        float band = pow(max(0.0, 1.0 - abs(h) * 3.4), 3.0);
        float dirAmt = 0.25 + 0.75 * max(0.0, dot(normalize(vec3(dir.x, 0.0, dir.z)), normalize(vec3(uGlowDir.x, 0.0, uGlowDir.z))));
        col += uGlow * band * dirAmt;
        // 一点点噪声，避免大面积色带
        col += (fract(sin(dot(dir.xy * 512.0, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.003;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const dome = new THREE.Mesh(skyGeo, skyMat);
  dome.renderOrder = -10;
  group.add(dome);

  /* ---------------- 星星 ---------------- */
  const starCount = 1400;
  const pos = new Float32Array(starCount * 3);
  const col = new Float32Array(starCount * 3);
  const c = new THREE.Color();
  for (let i = 0; i < starCount; i++) {
    const theta = rand(0, Math.PI * 2);
    const phi = Math.acos(rand(0.02, 1)); // 上半球
    const r = 280;
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.cos(phi);
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    c.setHSL(rand(0.5, 0.68), rand(0.05, 0.45), rand(0.62, 1.0));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const starMat = new THREE.PointsMaterial({
    size: 2.0,
    sizeAttenuation: false,
    map: makeGlowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)'),
    transparent: true,
    opacity: 0.85,
    vertexColors: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.renderOrder = -9;
  group.add(stars);

  /* ---------------- 月亮 ---------------- */
  const moonGroup = new THREE.Group();
  moonGroup.position.set(-120, 86, -180);
  const moon = new THREE.Mesh(
    new THREE.CircleGeometry(9, 48),
    new THREE.MeshBasicMaterial({ color: 0xeef3ff, fog: false })
  );
  moonGroup.add(moon);
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeGlowTexture('rgba(190,215,255,0.9)', 'rgba(190,215,255,0)'),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      opacity: 0.45,
    })
  );
  halo.scale.setScalar(70);
  moonGroup.add(halo);
  moonGroup.lookAt(0, 20, 0);
  group.add(moonGroup);

  /* ---------------- 稀薄的云 ---------------- */
  const cloudGroup = new THREE.Group();
  for (let i = 0; i < 12; i++) {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeGlowTexture('rgba(150,130,170,0.30)', 'rgba(150,130,170,0)'),
        transparent: true,
        depthWrite: false,
        fog: false,
        opacity: rand(0.14, 0.34),
      })
    );
    const sc = rand(70, 160);
    s.scale.set(sc, sc * rand(0.22, 0.4), 1);
    s.position.set(rand(-240, 240), rand(50, 120), rand(-260, -60));
    s.userData.drift = rand(0.25, 0.8);
    cloudGroup.add(s);
  }
  group.add(cloudGroup);

  return {
    group,
    update(dt, t) {
      starMat.opacity = 0.7 + Math.sin(t * 1.6) * 0.1 + Math.sin(t * 0.53) * 0.06;
      cloudGroup.children.forEach((s) => {
        s.position.x += s.userData.drift * dt;
        if (s.position.x > 260) s.position.x = -260;
      });
    },
  };
}
