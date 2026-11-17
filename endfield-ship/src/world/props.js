/**
 * 场景道具：全息战术台、货箱、设备柜、无人机、警示牌
 */

import * as THREE from 'three';
import { decalLabel, hazardStripe } from '../textures.js';

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

const ROOM_BACK = 7.42;

/* ------------------------- 全息战术台 ------------------------- */

/**
 * 圆形全息沙盘：底座 + 玻璃罩 + 体积光锥 + 旋转的全息投影
 *
 * 亮度注意：投影盘用加性混合，近距离会层层叠加再被 Bloom 放大，
 * 实测从 2m 内看整个沙盘会糊成一团白。所以亮度压得很低，
 * 靠「体积光锥 + 地面投影纹理」而不是靠亮度来表达全息感。
 */
export function createHologramTable() {
  const group = new THREE.Group();
  group.position.set(1.9, 0, 1.35);

  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x2a3038,
    roughness: 0.45,
    metalness: 0.88,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0x7e8794,
    roughness: 0.32,
    metalness: 0.95,
  });

  // 底座（三段式）
  const b1 = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.72, 0.1, 32), baseMat);
  b1.position.y = 0.05;
  b1.castShadow = true;
  b1.receiveShadow = true;
  group.add(b1);

  const b2 = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.58, 0.62, 32), baseMat);
  b2.position.y = 0.4;
  b2.castShadow = true;
  group.add(b2);

  const b3 = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.07, 32), trimMat);
  b3.position.y = 0.74;
  b3.castShadow = true;
  group.add(b3);

  // 发光环
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x2f8f8a });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.022, 8, 48), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.78;
  group.add(ring);

  const ring2 = new THREE.Mesh(
    new THREE.TorusGeometry(0.4, 0.012, 6, 40),
    new THREE.MeshBasicMaterial({ color: 0x8a6a20 })
  );
  ring2.rotation.x = Math.PI / 2;
  ring2.position.y = 0.79;
  group.add(ring2);

  // 顶部投影盘（加性混合的自定义着色器）
  const projUniforms = {
    uTime: { value: 0 },
    uColor: { value: new THREE.Color('#5ff0e4') },
    uColor2: { value: new THREE.Color('#f2c230') },
  };
  const projMat = new THREE.ShaderMaterial({
    uniforms: projUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main(){
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      uniform vec3 uColor, uColor2;
      varying vec2 vUv;

      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p); vec2 f = fract(p);
        vec2 u = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), u.x),
                   mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
      }
      float fbm(vec2 p){
        float v=0.0, a=0.5;
        for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.07; a*=0.5; }
        return v;
      }

      void main(){
        vec2 p = vUv - 0.5;
        float r = length(p) * 2.0;
        if (r > 1.0) discard;

        float ang = atan(p.y, p.x);

        // 旋转雷达网格
        float spin = uTime * 0.35;
        vec2 rp = mat2(cos(spin), -sin(spin), sin(spin), cos(spin)) * p * 6.0;
        float grid = smoothstep(0.94, 1.0, max(
            abs(fract(rp.x) - 0.5),
            abs(fract(rp.y) - 0.5)));

        // 同心环
        float rings = smoothstep(0.86, 1.0, abs(fract(r * 6.0 - uTime * 0.12) - 0.5) * 2.0);

        // 扇形扫描
        float sweep = smoothstep(0.86, 1.0, cos(ang - uTime * 1.1) * 0.5 + 0.5) * (1.0 - r * 0.5);

        // 地形高度场
        float terr = fbm(p * 5.0 + vec2(uTime * 0.05, 0.0));
        float terrain = smoothstep(0.52, 0.78, terr) * (1.0 - smoothstep(0.55, 1.0, r));

        // 边缘衰减
        float edge = smoothstep(1.0, 0.86, r);

        vec3 col = uColor * (grid * 0.5 + rings * 0.7) * edge;
        col += uColor * sweep * 0.55 * edge;
        col += uColor2 * terrain * 0.45 * edge;
        col += uColor * 0.1 * edge;

        float a = clamp(grid * 0.55 + rings * 0.6 + sweep * 0.5 + terrain * 0.45, 0.0, 1.0) * edge;
        gl_FragColor = vec4(col, a * 0.42);
      }
    `,
  });
  const proj = new THREE.Mesh(new THREE.CircleGeometry(0.47, 64), projMat);
  proj.rotation.x = -Math.PI / 2;
  proj.position.y = 0.79;
  proj.renderOrder = 3;
  group.add(proj);

  // 体积光锥
  const coneMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color('#5ff0e4') },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vPos;
      void main(){
        vUv = uv;
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      uniform vec3 uColor;
      varying vec2 vUv;
      varying vec3 vPos;
      void main(){
        float fade = smoothstep(1.0, 0.0, vUv.y);
        float flick = 0.86 + 0.14 * sin(uTime * 7.0 + vPos.y * 3.0);
        float band = smoothstep(0.9, 1.0, sin(vUv.y * 40.0 - uTime * 2.4) * 0.5 + 0.5);
        float a = fade * 0.075 * flick + band * fade * 0.025;
        gl_FragColor = vec4(uColor * (0.7 + band * 0.5), a);
      }
    `,
  });
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.30, 0.9, 40, 1, true), coneMat);
  cone.position.y = 1.24;
  cone.renderOrder = 3;
  group.add(cone);

  // 全息光源（够照亮底座即可，太亮会跟着 Bloom 炸开）
  const light = new THREE.PointLight(0x5ff0e4, 2.2, 3.0, 2);
  light.position.y = 1.05;
  group.add(light);

  // 底座上的铭牌（平躺在台面上，俯视时能读出来）
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(0.44, 0.11),
    new THREE.MeshBasicMaterial({
      map: decalLabel({
        lines: ['TACTICAL TABLE'],
        accent: '#5ff0e4',
        width: 640,
        height: 160,
        bar: true,
      }),
      transparent: true,
      opacity: 0.85,
    })
  );
  panel.rotation.x = -Math.PI / 2;
  panel.position.set(0, 0.79, 0.42);
  group.add(panel);

  const update = (dt, t) => {
    projUniforms.uTime.value = t;
    coneMat.uniforms.uTime.value = t;
    light.intensity = 2.0 + Math.sin(t * 3.1) * 0.2;
    ring2.rotation.z += dt * 0.6;
  };

  return { group, update };
}

/* ------------------------- 货箱 ------------------------- */

export function createCrates() {
  const group = new THREE.Group();

  const crateMat = new THREE.MeshStandardMaterial({
    color: 0x4d5a52,
    roughness: 0.82,
    metalness: 0.35,
  });
  const crateMat2 = new THREE.MeshStandardMaterial({
    color: 0x6b6252,
    roughness: 0.88,
    metalness: 0.25,
  });
  const bandMat = new THREE.MeshStandardMaterial({
    color: 0xd8a83a,
    roughness: 0.7,
    metalness: 0.3,
  });
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x33393f,
    roughness: 0.5,
    metalness: 0.8,
  });

  function crate(w, h, d, x, y, z, ry, mat) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = ry;
    const body = new THREE.Mesh(box(w, h, d), mat);
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);
    // 边框
    const t = 0.05;
    for (const sy of [-1, 1]) {
      const e = new THREE.Mesh(box(w + 0.02, t, d + 0.02), frameMat);
      e.position.y = (sy * h) / 2;
      g.add(e);
    }
    for (const sx of [-1, 1]) {
      const e = new THREE.Mesh(box(t, h, d + 0.02), frameMat);
      e.position.x = (sx * w) / 2;
      g.add(e);
    }
    // 警示带
    const band = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.9, 0.12), bandMat);
    band.position.set(0, h * 0.22, d / 2 + 0.005);
    g.add(band);
    // 标签
    const lab = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 0.5, h * 0.16),
      new THREE.MeshBasicMaterial({
        map: decalLabel({
          lines: ['长明号 · 物资'],
          accent: '#f2c230',
          width: 400,
          height: 120,
        }),
        transparent: true,
      })
    );
    lab.position.set(-w * 0.16, -h * 0.2, d / 2 + 0.006);
    g.add(lab);
    group.add(g);
    return g;
  }

  crate(0.9, 0.7, 0.7, -3.55, 0.35, 4.6, 0.14, crateMat);
  crate(0.7, 0.55, 0.6, -3.5, 0.98, 4.5, -0.3, crateMat2);
  crate(1.1, 0.85, 0.8, -3.3, 0.43, 5.5, 0.42, crateMat2);
  crate(0.8, 0.6, 0.65, 3.9, 0.3, 4.9, -0.5, crateMat);

  return { group };
}

/* ------------------------- 设备柜 ------------------------- */

export function createEquipment() {
  const group = new THREE.Group();

  const shellMat = new THREE.MeshStandardMaterial({
    color: 0x394049,
    roughness: 0.55,
    metalness: 0.82,
  });
  const ventMat = new THREE.MeshStandardMaterial({
    color: 0x191d22,
    roughness: 0.9,
    metalness: 0.4,
  });

  // 右侧设备墙
  const cab = new THREE.Group();
  cab.position.set(4.85, 0, -4.4);
  cab.rotation.y = -Math.PI / 2;

  const body = new THREE.Mesh(box(3.6, 2.3, 0.7), shellMat);
  body.position.y = 1.15;
  body.castShadow = true;
  body.receiveShadow = true;
  cab.add(body);

  for (let i = 0; i < 5; i++) {
    const unit = new THREE.Mesh(box(3.3, 0.36, 0.1), ventMat);
    unit.position.set(0, 0.45 + i * 0.42, 0.37);
    cab.add(unit);
    const led = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.03, 0.02),
      new THREE.MeshBasicMaterial({ color: i % 3 === 0 ? 0xf2c230 : 0x5ff0e4 })
    );
    led.position.set(1.5, 0.45 + i * 0.42, 0.43);
    cab.add(led);
  }
  group.add(cab);

  // 左侧工具台
  const bench = new THREE.Group();
  bench.position.set(-4.9, 0, -3.6);
  bench.rotation.y = Math.PI / 2;
  const top = new THREE.Mesh(box(2.4, 0.08, 0.75), shellMat);
  top.position.y = 0.92;
  top.castShadow = true;
  bench.add(top);
  for (const x of [-1.05, 1.05]) {
    const leg = new THREE.Mesh(box(0.08, 0.9, 0.08), shellMat);
    leg.position.set(x, 0.45, 0);
    bench.add(leg);
  }
  // 台面抽屉
  const drawer = new THREE.Mesh(box(2.2, 0.5, 0.6), ventMat);
  drawer.position.set(0, 0.62, 0);
  bench.add(drawer);
  // 工具盒
  const tool = new THREE.Mesh(
    box(0.5, 0.16, 0.3),
    new THREE.MeshStandardMaterial({ color: 0xb8452f, roughness: 0.7, metalness: 0.2 })
  );
  tool.position.set(-0.7, 1.04, 0);
  tool.castShadow = true;
  bench.add(tool);
  group.add(bench);

  return { group };
}

/* ------------------------- 警示牌 ------------------------- */

export function createSignage() {
  const group = new THREE.Group();

  const signMat = new THREE.MeshStandardMaterial({
    map: hazardStripe({ a: '#f2c230', b: '#15171b', stripe: 20 }),
    roughness: 0.75,
    metalness: 0.2,
  });

  // 门框旁的危险标识
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), signMat);
  sign.position.set(4.42, 2.7, -1.4);
  sign.rotation.y = -Math.PI / 2;
  group.add(sign);

  const warn = new THREE.Mesh(
    new THREE.PlaneGeometry(0.68, 0.2),
    new THREE.MeshBasicMaterial({
      map: decalLabel({ lines: ['高压危险'], accent: '#f2c230', width: 420, height: 120 }),
      transparent: true,
    })
  );
  warn.position.set(4.4, 2.7, -1.4);
  warn.rotation.y = -Math.PI / 2;
  group.add(warn);

  // 后墙的舰名铭牌
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 0.66),
    new THREE.MeshBasicMaterial({
      map: decalLabel({
        lines: ['长 明 号', 'EVERBRIGHT / OBSERVATION DECK 04'],
        accent: '#f2c230',
        width: 780,
        height: 200,
      }),
      transparent: true,
    })
  );
  plate.position.set(-2.6, 2.55, ROOM_BACK);
  plate.rotation.y = Math.PI;
  group.add(plate);

  return { group };
}

/* ------------------------- 巡检无人机 ------------------------- */

/**
 * 一台小型巡检无人机：在舱内缓慢巡航。
 *
 * 尺寸与航线都要注意：
 *   - 太大 → 靠近相机时变成画面里的「大飞碟」，喧宾夺主；
 *   - 航线压到舷窗的行星上 → 看起来像插在星球上的尖刺。
 * 所以机体做小，航线整体抬高并偏到画面右侧。
 */
export function createDrone() {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xd8dde4,
    roughness: 0.42,
    metalness: 0.6,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x24282e,
    roughness: 0.55,
    metalness: 0.7,
  });

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.105, 20, 14), bodyMat);
  body.scale.set(1, 0.72, 1.25);
  body.castShadow = true;
  group.add(body);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.016, 6, 24), darkMat);
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  const lens = new THREE.Mesh(
    new THREE.SphereGeometry(0.034, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0x5ff0e4 })
  );
  lens.position.set(0, -0.038, 0.118);
  group.add(lens);

  const light = new THREE.PointLight(0x8ff0e6, 0.9, 2.0, 2);
  light.position.set(0, -0.06, 0.12);
  group.add(light);

  // 螺旋桨
  const prop = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.008, 0.03), darkMat);
  prop.position.y = 0.055;
  group.add(prop);

  // 航线：整体抬高并偏右，避开舷窗里行星所在的画面区域
  const path = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(1.6, 3.35, -3.2),
      new THREE.Vector3(3.4, 3.15, -0.6),
      new THREE.Vector3(2.6, 3.45, 2.4),
      new THREE.Vector3(-0.6, 3.25, 3.6),
      new THREE.Vector3(-2.4, 3.0, 1.6),
    ],
    true,
    'catmullrom',
    0.5
  );

  const _p = new THREE.Vector3();
  const _tan = new THREE.Vector3();

  const update = (dt, t) => {
    // 采样参数必须夹在 [0,1]：越界会让 CatmullRomCurve3 取到 points[-1]（undefined）
    const u = (((t * 0.035) % 1) + 1) % 1;
    path.getPointAt(u, _p);
    path.getTangentAt(u, _tan);
    group.position.copy(_p);
    group.position.y += Math.sin(t * 1.7) * 0.06;
    group.lookAt(_p.x + _tan.x, _p.y + _tan.y + Math.sin(t * 1.7) * 0.06, _p.z + _tan.z);
    prop.rotation.y += dt * 26;
    ring.rotation.y += dt * 1.2;
  };

  return { group, update };
}
