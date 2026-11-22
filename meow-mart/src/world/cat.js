import * as THREE from 'three';
import { rand, chance } from '../util/rng.js';
import { makeHeartTexture } from '../util/textures.js';

/**
 * 一只完全由程序化几何体拼出来的橘猫：
 *   走路 / 坐下 / 发呆 / 被摸头时开心地跳起来
 */
export function createCat() {
  const root = new THREE.Group();
  root.name = 'cat';

  const MAT = {
    fur: new THREE.MeshStandardMaterial({ color: 0xf2a04a, roughness: 0.8, metalness: 0.0 }),
    furLight: new THREE.MeshStandardMaterial({ color: 0xfbeed4, roughness: 0.85 }),
    furDark: new THREE.MeshStandardMaterial({ color: 0xc1651d, roughness: 0.8 }),
    pink: new THREE.MeshStandardMaterial({ color: 0xf0a0a0, roughness: 0.7 }),
    black: new THREE.MeshStandardMaterial({ color: 0x14100f, roughness: 0.25 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xf3cd72, roughness: 0.25, metalness: 0.95 }),
    red: new THREE.MeshStandardMaterial({ color: 0xd63b4e, roughness: 0.6 }),
  };

  const bodyPivot = new THREE.Group();
  bodyPivot.position.y = 0.58;
  root.add(bodyPivot);

  // 跟着猫走的柔光，让主角在夜色里不会糊成一团
  const fillLight = new THREE.PointLight(0xbcd4ff, 3.4, 4.6, 2);
  fillLight.position.set(0, 1.55, 0.25);
  root.add(fillLight);

  /* ---------------- 身体 ---------------- */
  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.5, 26, 20), MAT.fur);
  torso.scale.set(0.78, 0.62, 1.06);
  bodyPivot.add(torso);

  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.36, 20, 16), MAT.furLight);
  chest.scale.set(0.78, 0.86, 0.7);
  chest.position.set(0, -0.14, 0.3);
  bodyPivot.add(chest);

  const rump = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 16), MAT.fur);
  rump.scale.set(0.82, 0.7, 0.9);
  rump.position.set(0, -0.02, -0.28);
  bodyPivot.add(rump);

  // 虎斑纹（半环贴在背上）
  for (let i = 0; i < 4; i++) {
    const stripe = new THREE.Mesh(
      new THREE.TorusGeometry(0.5, 0.036, 8, 22, Math.PI),
      MAT.furDark
    );
    stripe.scale.set(0.8, 0.72, 1);
    stripe.position.set(0, 0.0, 0.34 - i * 0.26);
    stripe.rotation.z = Math.PI;
    bodyPivot.add(stripe);
  }
  // 尾巴上的环
  const tailRingMat = MAT.furDark;

  /* ---------------- 头 ---------------- */
  const head = new THREE.Group();
  head.position.set(0, 0.3, 0.55);
  bodyPivot.add(head);

  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.32, 26, 20), MAT.fur);
  skull.scale.set(1, 0.94, 0.96);
  head.add(skull);

  // 耳朵
  const ears = [];
  for (const s of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(0.19 * s, 0.24, -0.04);
    ear.rotation.z = -0.28 * s;
    ear.rotation.x = -0.18;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.125, 0.27, 16), MAT.fur);
    cone.position.y = 0.13;
    ear.add(cone);
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.072, 0.17, 14), MAT.pink);
    inner.position.set(0, 0.13, 0.035);
    ear.add(inner);
    head.add(ear);
    ears.push(ear);
  }

  // 眼睛
  const eyes = [];
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.072, 16, 14), MAT.black);
    eye.position.set(0.125 * s, 0.045, 0.255);
    eye.scale.set(1, 1.05, 0.7);
    head.add(eye);
    eyes.push(eye);
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 10), MAT.furLight);
    shine.position.set(0.155 * s, 0.075, 0.295);
    head.add(shine);
    // 眼皮（眨眼时压下来）
    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.078, 14, 12), MAT.fur);
    lid.position.set(0.125 * s, 0.045, 0.245);
    lid.scale.set(1, 0.001, 0.72);
    head.add(lid);
    eye.userData.lid = lid;
  }

  // 鼻子 / 嘴 / 胡须
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.06, 4), MAT.pink);
  nose.position.set(0, -0.045, 0.29);
  nose.rotation.x = Math.PI / 2;
  nose.rotation.z = Math.PI / 4;
  head.add(nose);

  for (const s of [-1, 1]) {
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 12), MAT.furLight);
    muzzle.scale.set(1, 0.72, 0.8);
    muzzle.position.set(0.055 * s, -0.085, 0.235);
    head.add(muzzle);
  }

  const whiskerPoints = [];
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      whiskerPoints.push(
        new THREE.Vector3(0.08 * s, -0.07 + i * 0.035, 0.24),
        new THREE.Vector3(0.42 * s, -0.05 + i * 0.07, 0.16)
      );
    }
  }
  const whiskers = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(whiskerPoints),
    new THREE.LineBasicMaterial({ color: 0xfff4e2, transparent: true, opacity: 0.75 })
  );
  head.add(whiskers);

  // 围巾铃铛
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 8, 20), MAT.red);
  collar.position.set(0, 0.16, 0.3);
  collar.rotation.x = Math.PI / 2 - 0.35;
  bodyPivot.add(collar);
  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.055, 14, 12), MAT.gold);
  bell.position.set(0, 0.1, 0.4);
  bodyPivot.add(bell);

  /* ---------------- 四条腿 ---------------- */
  const legs = [];
  const legDefs = [
    { x: -0.21, z: 0.3, front: true, phase: 0 },
    { x: 0.21, z: 0.3, front: true, phase: Math.PI },
    { x: -0.21, z: -0.28, front: false, phase: Math.PI },
    { x: 0.21, z: -0.28, front: false, phase: 0 },
  ];
  for (const def of legDefs) {
    const pivot = new THREE.Group();
    pivot.position.set(def.x, -0.08, def.z);
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.098, 0.08, 0.26, 12), MAT.fur);
    upper.position.y = -0.13;
    pivot.add(upper);
    const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.058, 0.26, 12), MAT.fur);
    lower.position.y = -0.38;
    pivot.add(lower);
    const paw = new THREE.Mesh(new THREE.SphereGeometry(0.085, 14, 12), MAT.furLight);
    paw.scale.set(1, 0.6, 1.25);
    paw.position.set(0, -0.5, 0.03);
    pivot.add(paw);
    bodyPivot.add(pivot);
    legs.push({ pivot, ...def });
  }

  /* ---------------- 尾巴 ---------------- */
  const tail = new THREE.Group();
  tail.position.set(0, 0.16, -0.46);
  tail.rotation.x = 0.4;
  bodyPivot.add(tail);
  const tailSegs = [];
  let parent = tail;
  for (let i = 0; i < 6; i++) {
    const seg = new THREE.Group();
    seg.position.set(0, i === 0 ? 0 : 0.012, i === 0 ? 0 : -0.155);
    const r = 0.095 - i * 0.007;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r, 0.19, 10), MAT.fur);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.z = -0.095;
    seg.add(mesh);
    if (i % 2 === 1) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.98, 0.016, 6, 14), tailRingMat);
      ring.position.z = -0.095;
      seg.add(ring);
    }
    parent.add(seg);
    parent = seg;
    tailSegs.push(seg);
  }

  /* ---------------- 爱心粒子 ---------------- */
  const heartTex = makeHeartTexture();
  const hearts = [];
  const heartGroup = new THREE.Group();
  root.add(heartGroup);
  for (let i = 0; i < 10; i++) {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: heartTex,
        transparent: true,
        depthWrite: false,
        opacity: 0,
      })
    );
    s.visible = false;
    heartGroup.add(s);
    hearts.push({ sprite: s, life: 0, vel: new THREE.Vector3() });
  }

  /* ================================================================
   *  行为状态机
   * ================================================================ */
  const STATE = { WALK: 'walk', SIT: 'sit', IDLE: 'idle', HAPPY: 'happy' };
  let state = STATE.WALK;
  let stateTimer = 0;
  let dir = 1;
  let speed = 0.95;
  let walkPhase = 0;
  let position = new THREE.Vector3(-5.5, 0, 5.0);
  let targetYaw = Math.PI / 2;
  let yaw = Math.PI / 2;
  let blinkTimer = 2;
  let blink = 0;
  let jump = 0;
  let lookTimer = 0;
  let lookTarget = 0;
  let headTilt = 0;
  let tailUp = 0;

  root.position.copy(position);
  root.rotation.y = yaw;

  function setState(next, time) {
    state = next;
    stateTimer = time;
  }

  function spawnHearts() {
    let spawned = 0;
    for (const h of hearts) {
      if (h.life > 0) continue;
      h.life = 1.1;
      h.sprite.visible = true;
      h.sprite.position.set(rand(-0.25, 0.25), 0.8 + rand(0, 0.2), rand(-0.2, 0.2));
      h.vel.set(rand(-0.5, 0.5), rand(1.2, 2.1), rand(-0.5, 0.5));
      h.sprite.scale.setScalar(rand(0.28, 0.44));
      if (++spawned > 5) break;
    }
  }

  const api = {
    group: root,
    /** 摸摸头 */
    happy() {
      setState(STATE.HAPPY, 1.6);
      jump = 1.0;
      tailUp = 1;
      spawnHearts();
      return true;
    },
    get state() {
      return state;
    },
    update(dt, t) {
      dt = Math.min(dt, 0.05);

      /* ---------- 状态推进 ---------- */
      stateTimer -= dt;
      if (stateTimer <= 0) {
        if (state === STATE.WALK) {
          // 走到头了就掉头，或者坐下来发发呆
          if (Math.abs(position.x) > 7.2) {
            dir *= -1;
            setState(STATE.IDLE, rand(0.4, 1.2));
          } else if (chance(0.35)) {
            setState(STATE.SIT, rand(2.2, 5.0));
          } else {
            setState(STATE.WALK, rand(3, 8));
          }
        } else if (state === STATE.SIT) {
          setState(STATE.IDLE, rand(0.5, 1.4));
        } else if (state === STATE.IDLE) {
          setState(chance(0.5) ? STATE.SIT : STATE.WALK, rand(1.5, 4));
        } else if (state === STATE.HAPPY) {
          setState(STATE.IDLE, rand(0.6, 1.6));
        }
      }

      const walking = state === STATE.WALK;
      const sitting = state === STATE.SIT;

      /* ---------- 移动 ---------- */
      if (walking) {
        position.x += dir * speed * dt;
        // 走到头就掉头（每帧判断，不然会冲过头）
        if (Math.abs(position.x) > 7.0) {
          position.x = Math.sign(position.x) * 7.0;
          dir *= -1;
          targetYaw = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
          setState(STATE.IDLE, rand(0.3, 1.0));
        }
        const wander = Math.sin(t * 0.35) * 0.35;
        position.z += (5.0 + wander - position.z) * Math.min(1, dt * 1.2);
        targetYaw = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
        walkPhase += dt * speed * 6.2;
      } else {
        walkPhase += dt * 0.6;
      }

      // 转向
      let diff = ((targetYaw - yaw + Math.PI) % (Math.PI * 2)) - Math.PI;
      if (diff < -Math.PI) diff += Math.PI * 2;
      yaw += diff * Math.min(1, dt * 4.5);
      root.rotation.y = yaw;
      root.position.x = position.x;
      root.position.z = position.z;

      /* ---------- 身体姿态 ---------- */
      let bodyY = 0.58;
      let bodyRx = 0;
      let bodyRoll = 0;

      if (walking) {
        bodyY += Math.abs(Math.sin(walkPhase)) * 0.035;
        bodyRoll = Math.sin(walkPhase) * 0.06;
      }
      if (sitting) {
        bodyY -= 0.13;
        bodyRx = -0.26;
      }
      if (state === STATE.HAPPY) {
        bodyY += Math.sin((1 - jump) * Math.PI) * 0.0;
      }
      // 跳跃
      if (jump > 0) {
        jump = Math.max(0, jump - dt * 1.5);
        bodyY += Math.sin((1 - jump) * Math.PI) * 0.5;
      }
      bodyPivot.position.y = bodyY;
      bodyPivot.rotation.x = bodyRx;
      bodyPivot.rotation.z = bodyRoll;

      /* ---------- 腿 ---------- */
      for (const leg of legs) {
        let target;
        if (sitting) {
          target = leg.front ? 0.06 : -1.35;
        } else if (walking) {
          target = Math.sin(walkPhase + leg.phase) * 0.62;
        } else {
          target = Math.sin(t * 1.2 + leg.phase) * 0.05;
        }
        leg.pivot.rotation.x += (target - leg.pivot.rotation.x) * Math.min(1, dt * 12);
      }

      /* ---------- 尾巴 ---------- */
      tailUp += (0 - tailUp) * Math.min(1, dt * 2.2);
      for (let i = 0; i < tailSegs.length; i++) {
        const seg = tailSegs[i];
        const wave = Math.sin(t * 3.2 + i * 0.55) * (0.14 + i * 0.03);
        seg.rotation.y = wave;
        const lift = walking ? 0.2 - i * 0.035 : 0.26 - i * 0.03;
        seg.rotation.x = lift + tailUp * (0.14 + i * 0.08);
      }

      /* ---------- 头 ---------- */
      lookTimer -= dt;
      if (lookTimer <= 0) {
        lookTimer = rand(1.2, 3.4);
        lookTarget = rand(-0.6, 0.6);
      }
      const curious = state === STATE.HAPPY ? 1 : 0;
      headTilt += (curious - headTilt) * Math.min(1, dt * 4);
      head.rotation.y += (lookTarget * (0.6 + headTilt) - head.rotation.y) * Math.min(1, dt * 3);
      head.rotation.x =
        (walking ? Math.sin(walkPhase * 2) * 0.04 : 0) -
        headTilt * 0.45 +
        (sitting ? 0.08 : 0);
      head.rotation.z = Math.sin(t * 1.4) * 0.03;

      // 耳朵：开心时立起来
      for (let i = 0; i < ears.length; i++) {
        const s = i === 0 ? -1 : 1;
        ears[i].rotation.x = -0.18 - headTilt * 0.25 + Math.sin(t * 2.6 + i) * 0.03;
        ears[i].rotation.z = -0.28 * s;
      }

      /* ---------- 眨眼 ---------- */
      blinkTimer -= dt;
      if (blinkTimer <= 0) {
        blinkTimer = rand(1.8, 5.5);
        blink = 0.16;
      }
      if (blink > 0) {
        blink -= dt;
        const k = Math.max(0.02, Math.abs(blink - 0.08) / 0.08);
        for (const eye of eyes) eye.userData.lid.scale.y = 0.001 + k * 0.001;
      } else {
        for (const eye of eyes) eye.userData.lid.scale.y = 0.001;
      }

      /* ---------- 爱心 ---------- */
      for (const h of hearts) {
        if (h.life <= 0) continue;
        h.life -= dt;
        h.vel.y -= 1.6 * dt;
        h.sprite.position.addScaledVector(h.vel, dt);
        h.sprite.material.opacity = Math.max(0, h.life / 1.1);
        if (h.life <= 0) h.sprite.visible = false;
      }

      // 铃铛跟着身体晃
      bell.position.x = Math.sin(walkPhase) * 0.02;
    },
  };

  return api;
}
