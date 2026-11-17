/**
 * 舷窗外的深空：泰拉II 行星、大气层、天梯缆索、空间站、星野、星云
 *
 * 全部用着色器 + 程序化几何生成，不依赖贴图资源。
 *
 * 构图要点（改了这里要同步改 core.js 里 HOTSPOTS 的机位）：
 *   舷窗朝 -Z，开口约在 z = -7.5、宽 8m、高 1.45~4.6m。
 *   行星放在左前方远处（屏幕约 1/3 宽、略低于舷窗中心），
 *   天梯缆索从行星边缘斜向右上延伸、穿过舷窗再出画 ——
 *   这是《终末地》最有辨识度的画面。
 *
 * 穿梭机剪影要避开行星所在的屏幕区域，
 * 否则会看起来像一根尖刺插在星球上（实测踩过）。
 */

import * as THREE from 'three';
import { dotSprite } from '../textures.js';

const NOISE_GLSL = /* glsl */ `
  vec3 hash33(vec3 p){
    p = vec3(dot(p,vec3(127.1,311.7,74.7)),
             dot(p,vec3(269.5,183.3,246.1)),
             dot(p,vec3(113.5,271.9,124.6)));
    return fract(sin(p)*43758.5453123);
  }
  float snoise(vec3 p){
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f*f*(3.0-2.0*f);
    float n000 = hash33(i+vec3(0,0,0)).x;
    float n100 = hash33(i+vec3(1,0,0)).x;
    float n010 = hash33(i+vec3(0,1,0)).x;
    float n110 = hash33(i+vec3(1,1,0)).x;
    float n001 = hash33(i+vec3(0,0,1)).x;
    float n101 = hash33(i+vec3(1,0,1)).x;
    float n011 = hash33(i+vec3(0,1,1)).x;
    float n111 = hash33(i+vec3(1,1,1)).x;
    return mix(mix(mix(n000,n100,u.x),mix(n010,n110,u.x),u.y),
               mix(mix(n001,n101,u.x),mix(n011,n111,u.x),u.y),u.z);
  }
  float fbm(vec3 p){
    float v = 0.0;
    float a = 0.5;
    for(int i=0;i<5;i++){
      v += a*snoise(p);
      p *= 2.03;
      a *= 0.5;
    }
    return v;
  }
`;

/** 行星在场景里的位置 */
export const PLANET_POS = new THREE.Vector3(-403, 27, -1400);
export const PLANET_RADIUS = 158;
/** 天梯缆索的朝向（从行星表面径向伸向宇宙） */
export const ELEVATOR_DIR = new THREE.Vector3(0.46, 0.87, 0.18).normalize();

/** 泰拉II 行星：程序化大陆 + 云层 + 晨昏线 */
function makePlanet() {
  const geo = new THREE.SphereGeometry(PLANET_RADIUS, 128, 96);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSun: { value: new THREE.Vector3(0.68, 0.30, 0.67).normalize() },
      uTime: { value: 0 },
      uSea: { value: new THREE.Color('#0a2036') },
      uShallow: { value: new THREE.Color('#14485c') },
      uLand: { value: new THREE.Color('#4a5738') },
      uLandHigh: { value: new THREE.Color('#7a7458') },
      uIce: { value: new THREE.Color('#d7e4ec') },
      uCloud: { value: new THREE.Color('#e6eef5') },
    },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      varying vec3 vNormalW;
      void main(){
        vPos = position;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uSun, uSea, uShallow, uLand, uLandHigh, uIce, uCloud;
      uniform float uTime;
      varying vec3 vPos;
      varying vec3 vNormalW;
      ${NOISE_GLSL}
      void main(){
        vec3 n = normalize(vPos);
        vec3 p = n * 2.4;
        float land = fbm(p + vec3(11.3, 4.7, 2.9));
        float detail = fbm(p * 6.0) * 0.22;
        float h = land + detail - 0.5;

        vec3 col;
        float lat = abs(n.y);
        if (h < 0.02) {
          float shelf = smoothstep(-0.02, 0.02, h);
          col = mix(uSea, uShallow, shelf);
        } else {
          float alt = smoothstep(0.02, 0.34, h);
          col = mix(uLand, uLandHigh, alt);
        }
        col = mix(col, uIce, smoothstep(0.68, 0.9, lat));

        // 云（覆盖率压低，别把地表糊掉）
        float cl = fbm(p * 1.9 + vec3(uTime * 0.006, 0.0, uTime * 0.004));
        float cloud = smoothstep(0.56, 0.82, cl) * (1.0 - smoothstep(0.7, 0.94, lat) * 0.6);
        col = mix(col, uCloud, cloud * 0.7);

        // 光照：保留明显的晨昏线，不要整体压平
        float ndl = dot(normalize(vNormalW), normalize(uSun));
        float lambert = smoothstep(-0.05, 0.55, ndl);
        vec3 night = col * 0.06 + vec3(0.015, 0.022, 0.045);
        // 夜面城市灯
        float city = smoothstep(0.5, 0.82, land) * (1.0 - cloud) * smoothstep(0.05, -0.35, ndl);
        night += vec3(1.0, 0.66, 0.34) * city * 0.28;
        col = mix(night, col, lambert);

        // 边缘散射（只在受光面）
        float fres = pow(1.0 - max(dot(normalize(vNormalW), vec3(0.0,0.0,1.0)), 0.0), 3.0);
        col += vec3(0.20, 0.42, 0.78) * fres * lambert * 0.55;

        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(PLANET_POS);
  mesh.rotation.z = 0.22;
  mesh.renderOrder = -10;
  return mesh;
}

/** 大气层：背面 fresnel 辉光 */
function makeAtmosphere() {
  const geo = new THREE.SphereGeometry(PLANET_RADIUS * 1.06, 96, 64);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSun: { value: new THREE.Vector3(0.68, 0.30, 0.67).normalize() },
      uColor: { value: new THREE.Color('#4f9dff') },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      void main(){
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position,1.0);
        vViewDir = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun, uColor;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      void main(){
        float rim = pow(1.0 - abs(dot(normalize(vNormalW), normalize(vViewDir))), 4.0);
        float sun = smoothstep(-0.35, 0.6, dot(normalize(vNormalW), normalize(uSun)));
        float a = rim * (0.12 + sun * 0.85);
        gl_FragColor = vec4(uColor * (0.55 + sun * 0.85), a * 0.8);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(PLANET_POS);
  mesh.renderOrder = -9;
  return mesh;
}

/** 星云背景球 */
function makeNebula() {
  const geo = new THREE.SphereGeometry(4200, 48, 32);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      varying vec3 vDir;
      ${NOISE_GLSL}
      void main(){
        vec3 d = normalize(vDir);
        float n1 = fbm(d * 1.6 + vec3(0.0, uTime * 0.002, 0.0));
        float n2 = fbm(d * 3.4 + vec3(5.0, 1.0, -3.0));
        float band = smoothstep(0.42, 0.86, n1 * 0.75 + n2 * 0.35);

        vec3 deep = vec3(0.006, 0.009, 0.020);
        vec3 a = vec3(0.060, 0.030, 0.140);
        vec3 b = vec3(0.022, 0.070, 0.165);
        vec3 col = mix(deep, mix(a, b, n2), band * 0.8);

        // 银河带
        float gal = pow(max(0.0, 1.0 - abs(d.y * 1.4 + d.x * 0.55)), 5.0);
        col += vec3(0.070, 0.078, 0.110) * gal * (0.3 + n2 * 0.45);

        // 稀疏暗尘
        col *= 0.86 + 0.24 * fbm(d * 8.0);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -20;
  return mesh;
}

/** 星野 */
function makeStars(count = 3000) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const c = new THREE.Color();
  let seed = 1337;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    const u = rnd() * 2 - 1;
    const th = rnd() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const r = 1500 + rnd() * 1600;
    pos[i * 3] = Math.cos(th) * s * r;
    pos[i * 3 + 1] = u * r * 0.75;
    pos[i * 3 + 2] = Math.sin(th) * s * r;
    const temp = rnd();
    c.setHSL(temp < 0.72 ? 0.58 : 0.08, 0.35 + rnd() * 0.35, 0.72 + rnd() * 0.28);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
    size[i] = 1.2 + Math.pow(rnd(), 3.2) * 10;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: dotSprite() },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      varying vec3 vColor;
      varying float vTwinkle;
      uniform float uTime;
      void main(){
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position,1.0);
        vTwinkle = 0.75 + 0.25 * sin(uTime * 1.6 + position.x * 0.07 + position.y * 0.05);
        gl_PointSize = aSize * vTwinkle * (900.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying vec3 vColor;
      varying float vTwinkle;
      void main(){
        vec4 t = texture2D(uMap, gl_PointCoord);
        gl_FragColor = vec4(vColor * vTwinkle, t.a);
        if (gl_FragColor.a < 0.01) discard;
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
  });

  const pts = new THREE.Points(geo, mat);
  pts.renderOrder = -15;
  return pts;
}

/**
 * 天梯：贯穿行星与轨道的长缆索 + 顶端配重舱。
 * 从行星表面笔直升起、斜穿过舷窗再出画，是《终末地》的标志性画面。
 *
 * 缆索用 Basic 材质（不吃光照），否则在漆黑的星空背景下会变成一条看不见的黑线。
 */
function makeElevator() {
  const group = new THREE.Group();

  const dir = ELEVATOR_DIR;
  const base = PLANET_POS.clone().add(dir.clone().multiplyScalar(PLANET_RADIUS * 0.97));
  const top = PLANET_POS.clone().add(dir.clone().multiplyScalar(2600));

  const length = base.distanceTo(top);
  const mid = base.clone().add(top).multiplyScalar(0.5);

  const geo = new THREE.CylinderGeometry(4.2, 6.0, length, 10, 1, true);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x8794a4,
    side: THREE.DoubleSide,
    fog: false,
  });
  const ribbon = new THREE.Mesh(geo, mat);
  ribbon.position.copy(mid);
  ribbon.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  group.add(ribbon);

  // 分节环（青色自发光）
  const ringGeo = new THREE.TorusGeometry(6.4, 1.2, 6, 16);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x5fe6ea });
  const ringCount = 44;
  const rings = new THREE.InstancedMesh(ringGeo, ringMat, ringCount);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < ringCount; i++) {
    const t = (i + 0.5) / ringCount;
    dummy.position.copy(base.clone().lerp(top, t));
    dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    dummy.rotateX(Math.PI / 2);
    dummy.updateMatrix();
    rings.setMatrixAt(i, dummy.matrix);
  }
  group.add(rings);

  // 缆索上的航标灯（沿缆索排布的小亮点）
  const beaconGeo = new THREE.SphereGeometry(2.6, 8, 6);
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xffe2a8 });
  const beaconCount = 60;
  const beacons = new THREE.InstancedMesh(beaconGeo, beaconMat, beaconCount);
  for (let i = 0; i < beaconCount; i++) {
    const t = (i + 0.5) / beaconCount;
    dummy.position.copy(base.clone().lerp(top, t));
    dummy.quaternion.identity();
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    beacons.setMatrixAt(i, dummy.matrix);
  }
  group.add(beacons);

  // 顶端配重舱
  const station = new THREE.Group();
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(14, 14, 46, 16),
    new THREE.MeshBasicMaterial({ color: 0x55606e })
  );
  station.add(hub);
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(26 - i * 5, 1.8, 8, 28),
      new THREE.MeshBasicMaterial({ color: 0x3a4552 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = (i - 1) * 16;
    station.add(ring);
  }
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(6, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffd27a })
  );
  glow.position.y = 27;
  station.add(glow);
  station.position.copy(top);
  station.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  group.add(station);

  group.userData.glow = glow;
  return group;
}

/**
 * 远处的小型穿梭机剪影。
 *
 * 位置要避开行星所在的屏幕区域 —— 行星大致落在画面左中 1/3 处，
 * 穿梭机如果压在那儿就会像一根尖刺插在星球上（实测踩过）。
 */
function makeDistantShips() {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x39424f });

  const specs = [
    // 画面右上，远离行星
    { pos: [340, 130, -980], s: 0.85, ry: 0.6 },
    // 画面上中偏右，与行星拉开距离
    { pos: [-20, 205, -1150], s: 0.45, ry: -1.1 },
    // 画面右下远处
    { pos: [470, -60, -820], s: 0.3, ry: 2.2 },
  ];

  for (const sp of specs) {
    const ship = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(3.2, 12, 6, 12), mat);
    body.rotation.z = Math.PI / 2;
    ship.add(body);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(5, 0.7, 14), mat);
    ship.add(wing);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(2.4, 5, 4), mat);
    tail.position.x = -8;
    ship.add(tail);
    const nav = new THREE.Mesh(
      new THREE.SphereGeometry(0.9, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xff6a4a })
    );
    nav.position.set(-10, 2.6, 0);
    ship.add(nav);
    ship.position.set(...sp.pos);
    ship.scale.setScalar(sp.s);
    ship.rotation.y = sp.ry;
    group.add(ship);
  }
  return group;
}

/**
 * 构建深空环境。
 * @returns {{group: THREE.Group, update: (dt:number, t:number)=>void}}
 */
export function createSpace() {
  const group = new THREE.Group();

  const nebula = makeNebula();
  const stars = makeStars();
  const planet = makePlanet();
  const atmo = makeAtmosphere();
  const elevator = makeElevator();
  const ships = makeDistantShips();

  group.add(nebula, stars, planet, atmo, elevator, ships);

  const update = (dt, t) => {
    nebula.material.uniforms.uTime.value = t;
    stars.material.uniforms.uTime.value = t;
    planet.material.uniforms.uTime.value = t;
    planet.rotation.y += dt * 0.004;
    atmo.rotation.y = planet.rotation.y;
    elevator.userData.glow.material.color.setHSL(0.11, 0.85, 0.62 + Math.sin(t * 1.7) * 0.12);
    ships.children.forEach((s, i) => {
      s.rotation.z = Math.sin(t * 0.2 + i) * 0.05;
    });
  };

  return { group, update, planet };
}
