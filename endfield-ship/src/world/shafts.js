/**
 * 体积光：从舷窗与顶部灯槽投出的光束
 *
 * 用加性混合的锥体 + 沿轴向的软衰减 + 缓慢流动的噪声模拟。
 *
 * 注意强度：这类加性几何很容易把整个画面糊成一层奶白。
 * 这里的强度都压得很低（0.02 上下），只保留「空气里有光」的暗示。
 *
 * 坐标约定：光束的局部 +Y 是「光源端」（半径小、亮度高），
 * -Y 是远端（半径大、亮度低）。
 */

import * as THREE from 'three';

const ROOM_HEIGHT = 4.3;

/**
 * 造一段光束。
 * @param {object} o
 * @param {number} o.len  长度（沿局部 Y 轴）
 * @param {number} o.rSrc 光源端半径
 * @param {number} o.rFar 远端半径
 * @param {string} o.color 颜色
 * @param {number} o.intensity 强度
 * @param {number[]} o.position 位置
 * @param {number[]} o.rotation 欧拉角
 */
function makeShaft({ len, rSrc, rFar, color, intensity, position, rotation }) {
  const geo = new THREE.CylinderGeometry(rSrc, rFar, len, 20, 1, true);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: intensity },
      uTime: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      void main(){
        vUv = uv;
        vNormalV = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewDir = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uColor;
      uniform float uIntensity;
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewDir;

      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p); vec2 f = fract(p);
        vec2 u = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), u.x),
                   mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
      }

      void main(){
        // 沿轴向衰减：光源端（uv.y = 1）最亮，向远端淡出
        float along = smoothstep(0.0, 0.6, vUv.y);
        // 侧壁软化：正对相机的部分更透（避免整体发白）
        float facing = abs(dot(normalize(vNormalV), normalize(vViewDir)));
        float soft = pow(facing, 2.2);
        // 缓慢流动的尘埃纹理
        float n = noise(vec2(vUv.x * 6.0, vUv.y * 3.0 - uTime * 0.05));
        float dust = 0.7 + 0.5 * n;

        float a = along * soft * dust * uIntensity;
        gl_FragColor = vec4(uColor * (0.7 + dust * 0.45), a);
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  mesh.renderOrder = 4;
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * 创建舱内的体积光。
 * @returns {{group: THREE.Group, update: Function}}
 */
export function createLightShafts() {
  const group = new THREE.Group();

  // 主光束：从舷窗（z = -7.5）斜射向舱内。
  // 光源端朝 -Z ⇒ 绕 X 轴转 -90°，让局部 +Y 指向 -Z。
  // 长度只取 8m，让光束停在相机前方，不要把相机罩进去。
  group.add(
    makeShaft({
      len: 8,
      rSrc: 1.6,
      rFar: 3.0,
      color: '#a8c8ff',
      intensity: 0.022,
      position: [-1.1, 2.6, -3.4],
      rotation: [-Math.PI * 0.5 + 0.14, 0, 0.16],
    })
  );

  // 左翼较窄的一束
  group.add(
    makeShaft({
      len: 6,
      rSrc: 0.8,
      rFar: 1.6,
      color: '#8fb4ee',
      intensity: 0.016,
      position: [-3.1, 2.75, -4.4],
      rotation: [-Math.PI * 0.5 + 0.1, 0, 0.14],
    })
  );

  const shafts = [];
  group.traverse((o) => {
    if (o.isMesh) shafts.push(o);
  });

  const update = (dt, t) => {
    for (const s of shafts) s.material.uniforms.uTime.value = t;
  };

  return { group, update };
}
