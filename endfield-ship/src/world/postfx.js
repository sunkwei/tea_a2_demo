/**
 * 后期处理：Bloom + 调色（暗角 / 色差 / 颗粒 / 扫描线）
 *
 * 顺序：RenderPass → Bloom → OutputPass(色调映射) → Grade(在 sRGB 空间做画面级处理)
 *
 * 泛光要克制：舱内已经有大量自发光灯条，
 * strength 一高整幅画面就会糊成一片白（实测平均值从 36 飙到 96）。
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uVignette: { value: 1.18 },
    uAberration: { value: 0.0015 },
    uGrain: { value: 0.03 },
    uScanline: { value: 0.02 },
    uSaturation: { value: 1.14 },
    uContrast: { value: 1.12 },
    uLift: { value: new THREE.Vector3(0.0, 0.002, 0.008) },
    uGain: { value: new THREE.Vector3(1.04, 1.0, 0.97) },
    uAlert: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uResolution;
    uniform float uVignette;
    uniform float uAberration;
    uniform float uGrain;
    uniform float uScanline;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uAlert;
    uniform vec3 uLift;
    uniform vec3 uGain;
    varying vec2 vUv;

    float hash(vec2 p){
      p = fract(p * vec2(443.897, 441.423));
      p += dot(p, p.yx + 19.19);
      return fract((p.x + p.y) * p.x);
    }

    void main(){
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);

      // 桶形色差：越靠边越明显
      float amt = uAberration * (0.35 + r2 * 2.4);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * amt).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * amt).b;

      // Lift / Gain 调色：暗部偏冷蓝，高光偏暖
      col = col * uGain + uLift;

      // 对比度与饱和度（围绕 0.5 拉伸，让暗部更暗）
      col = (col - 0.5) * uContrast + 0.5;
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(lum), col, uSaturation);

      // 暗角
      float vig = 1.0 - uVignette * r2 * (0.55 + r2 * 0.9);
      vig = clamp(vig, 0.0, 1.0);
      col *= vig;

      // 扫描线
      float sl = sin(uv.y * uResolution.y * 1.35) * 0.5 + 0.5;
      col *= 1.0 - uScanline * sl;

      // 胶片颗粒
      float g = hash(uv * uResolution + fract(uTime) * 137.0);
      col += (g - 0.5) * uGrain;

      // 危急状态：边缘泛红
      if (uAlert > 0.001) {
        float edge = smoothstep(0.12, 0.52, r2);
        float pulse = 0.5 + 0.5 * sin(uTime * 4.2);
        col = mix(col, vec3(0.85, 0.1, 0.12), edge * uAlert * (0.22 + pulse * 0.24));
      }

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

/**
 * 建立后期链。
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera
 */
export function createPostFX(renderer, scene, camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());

  const composer = new EffectComposer(renderer);
  composer.setSize(size.x, size.y);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // 阈值调高、强度调低：只让真正的自发光体（屏幕 / 灯条 / 行星边缘）发光
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(size.x, size.y),
    0.32, // strength
    0.4, // radius
    0.92 // threshold
  );
  composer.addPass(bloom);

  const output = new OutputPass();
  composer.addPass(output);

  const grade = new ShaderPass(GradeShader);
  grade.uniforms.uResolution.value.set(size.x, size.y);
  grade.renderToScreen = true;
  composer.addPass(grade);

  return {
    composer,
    bloom,
    grade,
    setSize(w, h) {
      composer.setSize(w, h);
      bloom.setSize(w, h);
      const dpr = renderer.getPixelRatio();
      grade.uniforms.uResolution.value.set(w * dpr, h * dpr);
    },
    update(t, alert) {
      grade.uniforms.uTime.value = t;
      grade.uniforms.uAlert.value = alert;
    },
  };
}
