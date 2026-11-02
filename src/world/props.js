import * as THREE from 'three';
import { rand } from '../util/rng.js';
import { makeVendingTexture, makeGlowTexture } from '../util/textures.js';

const strut = (a, b, r, mat) => {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(r, r, len, 8);
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return m;
};

export function createProps() {
  const group = new THREE.Group();
  group.name = 'props';

  const metal = new THREE.MeshStandardMaterial({ color: 0x3a3f48, roughness: 0.5, metalness: 0.75 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x1e222a, roughness: 0.55, metalness: 0.7 });

  /* ================================================================
   *  路灯
   * ================================================================ */
  const lampGroup = new THREE.Group();
  lampGroup.position.set(-6.6, 0.18, 5.7);
  group.add(lampGroup);

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 5.2, 12), metal);
  pole.position.y = 2.6;
  pole.castShadow = false;
  lampGroup.add(pole);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.4, 12), darkMetal);
  base.position.y = 0.2;
  lampGroup.add(base);
  const armCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 5.1, 0),
    new THREE.Vector3(0, 5.5, 0.35),
    new THREE.Vector3(0, 5.45, 1.0),
    new THREE.Vector3(0, 5.25, 1.35),
  ]);
  const arm = new THREE.Mesh(new THREE.TubeGeometry(armCurve, 24, 0.07, 8, false), metal);
  arm.castShadow = false;
  lampGroup.add(arm);
  const headMat = new THREE.MeshStandardMaterial({ color: 0x22262e, roughness: 0.5, metalness: 0.6 });
  const lampHead = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.95), headMat);
  lampHead.position.set(0, 5.16, 1.35);
  lampHead.castShadow = false;
  lampHead.name = 'lampHead';
  lampGroup.add(lampHead);
  const lampGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.42, 0.85),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0, fog: false })
  );
  lampGlow.rotation.x = Math.PI / 2;
  lampGlow.position.set(0, 5.03, 1.35);
  lampGroup.add(lampGlow);

  const lampLight = new THREE.PointLight(0xffcf94, 30, 22, 2);
  lampLight.position.set(-6.6, 5.1, 7.05);
  lampLight.castShadow = false; // 立方体阴影要渲 6 遍，代价太大
  group.add(lampLight);

  // 灯罩周围的一圈柔光（用精灵贴图代替锥体，避免出现生硬的几何边缘）
  const lampHalo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeGlowTexture('rgba(255,214,150,0.85)', 'rgba(255,214,150,0)'),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      opacity: 0.42,
    })
  );
  lampHalo.scale.set(1.9, 1.4, 1);
  lampHalo.position.set(-6.6, 5.05, 7.05);
  group.add(lampHalo);

  const lampHalo2 = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeGlowTexture('rgba(255,214,150,0.5)', 'rgba(255,214,150,0)'),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      opacity: 0.16,
    })
  );
  lampHalo2.scale.set(4.2, 3.2, 1);
  lampHalo2.position.set(-6.6, 4.6, 7.05);
  group.add(lampHalo2);

  /* ================================================================
   *  自动售货机
   * ================================================================ */
  const vendTex = makeVendingTexture();
  const vendGroup = new THREE.Group();
  vendGroup.position.set(6.05, 0.18, 3.55);
  vendGroup.rotation.y = -0.12;
  group.add(vendGroup);

  const vendBody = new THREE.Mesh(
    new THREE.BoxGeometry(1.12, 1.95, 0.72),
    new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.45, metalness: 0.5 })
  );
  vendBody.position.y = 0.98;
  vendBody.castShadow = true;
  vendBody.receiveShadow = true;
  vendGroup.add(vendBody);

  const vendFront = new THREE.Mesh(
    new THREE.PlaneGeometry(1.0, 1.85),
    new THREE.MeshStandardMaterial({
      map: vendTex.map,
      emissiveMap: vendTex.emissiveMap,
      emissive: 0xffffff,
      emissiveIntensity: 0.28,
      roughness: 0.35,
    })
  );
  vendFront.position.set(0, 1.0, 0.37);
  vendFront.name = 'vendingFront';
  vendGroup.add(vendFront);

  const vendLight = new THREE.PointLight(0xffd070, 3, 6, 2);
  vendLight.position.set(6.05, 1.6, 4.2);
  group.add(vendLight);

  /* ================================================================
   *  自行车
   * ================================================================ */
  const bike = new THREE.Group();
  bike.position.set(-4.55, 0.18, 3.35);
  bike.rotation.set(0, 0.35, 0.1);
  group.add(bike);

  const bikeMat = new THREE.MeshStandardMaterial({ color: 0x2f7d8c, roughness: 0.35, metalness: 0.55 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x17191e, roughness: 0.85 });
  const spokeMat = new THREE.MeshStandardMaterial({ color: 0xa8b0bb, roughness: 0.3, metalness: 0.9 });

  for (const x of [-0.46, 0.46]) {
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.035, 8, 28), rubber);
    wheel.position.set(x, 0.34, 0);
    bike.add(wheel);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.012, 6, 26), spokeMat);
    rim.position.set(x, 0.34, 0);
    bike.add(rim);
    for (let i = 0; i < 6; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.58, 0.006), spokeMat);
      spoke.position.set(x, 0.34, 0);
      spoke.rotation.z = (i / 6) * Math.PI;
      bike.add(spoke);
    }
  }
  const rearHub = new THREE.Vector3(-0.46, 0.34, 0);
  const frontHub = new THREE.Vector3(0.46, 0.34, 0);
  const bb = new THREE.Vector3(-0.06, 0.28, 0);
  const seatTop = new THREE.Vector3(-0.16, 0.72, 0);
  const headTop = new THREE.Vector3(0.3, 0.72, 0);
  bike.add(strut(rearHub, bb, 0.022, bikeMat));
  bike.add(strut(bb, seatTop, 0.022, bikeMat));
  bike.add(strut(seatTop, rearHub, 0.022, bikeMat));
  bike.add(strut(bb, headTop, 0.024, bikeMat));
  bike.add(strut(headTop, frontHub, 0.022, bikeMat));
  bike.add(strut(seatTop, headTop, 0.022, bikeMat));
  const bikeSeat = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.07, 0.13), rubber);
  bikeSeat.position.set(-0.18, 0.76, 0);
  bike.add(bikeSeat);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.44, 8), spokeMat);
  bar.rotation.x = Math.PI / 2;
  bar.position.set(0.3, 0.78, 0);
  bike.add(bar);
  const basket = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.24, 0.26),
    new THREE.MeshStandardMaterial({ color: 0x9aa2ad, roughness: 0.6, metalness: 0.4, wireframe: true })
  );
  basket.position.set(0.42, 0.62, 0);
  bike.add(basket);
  const bikeLamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), new THREE.MeshBasicMaterial({ color: 0xfff0c0 }));
  bikeLamp.position.set(0.44, 0.92, 0);
  bike.add(bikeLamp);

  /* ================================================================
   *  盆栽 / 垃圾桶 / 交通锥 / 长椅
   * ================================================================ */
  const potMat = new THREE.MeshStandardMaterial({ color: 0xb4704d, roughness: 0.85 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3d8b52, roughness: 0.75 });
  const makePlant = (x, z, s = 1) => {
    const g = new THREE.Group();
    g.position.set(x, 0.18, z);
    g.scale.setScalar(s);
    group.add(g);
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.17, 0.32, 14), potMat);
    pot.position.y = 0.16;
    pot.castShadow = true;
    g.add(pot);
    for (let i = 0; i < 7; i++) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), leafMat);
      leaf.scale.set(0.55, 1.5, 0.55);
      leaf.position.set(rand(-0.16, 0.16), 0.5 + rand(0, 0.22), rand(-0.16, 0.16));
      leaf.rotation.set(rand(-0.5, 0.5), rand(0, 6.28), rand(-0.5, 0.5));
      leaf.castShadow = true;
      g.add(leaf);
    }
    return g;
  };
  makePlant(5.0, 5.4, 1.1);
  makePlant(-8.1, 5.2, 0.9);
  makePlant(8.6, 4.6, 1.0);

  // 垃圾桶
  const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.24, 0.8, 14), metal);
  bin.position.set(-7.4, 0.58, 4.2);
  bin.castShadow = true;
  group.add(bin);
  const binLid = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.29, 0.08, 14), darkMetal);
  binLid.position.set(-7.4, 1.0, 4.2);
  binLid.castShadow = true;
  group.add(binLid);

  // 交通锥
  const coneMat = new THREE.MeshStandardMaterial({ color: 0xe2622f, roughness: 0.65 });
  for (const [x, z] of [
    [3.3, 6.0],
    [4.6, 6.15],
  ]) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.62, 12), coneMat);
    c.position.set(x, 0.49, z);
    c.castShadow = true;
    group.add(c);
    const coneBase = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.42), coneMat);
    coneBase.position.set(x, 0.21, z);
    group.add(coneBase);
  }

  // 长椅
  const bench = new THREE.Group();
  bench.position.set(9.4, 0.18, 5.0);
  bench.rotation.y = -0.25;
  group.add(bench);
  const benchSeat = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 0.08, 0.48),
    new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.85 })
  );
  benchSeat.position.y = 0.44;
  benchSeat.castShadow = true;
  bench.add(benchSeat);
  const backRest = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 0.4, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.85 })
  );
  backRest.position.set(0, 0.68, -0.2);
  bench.add(backRest);
  for (const x of [-0.8, 0.8]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.44, 0.42), darkMetal);
    leg.position.set(x, 0.22, 0);
    bench.add(leg);
  }

  // 消防栓
  const hydrant = new THREE.Group();
  hydrant.position.set(-2.0, 0.18, 6.05);
  group.add(hydrant);
  const hydMat = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.6, metalness: 0.2 });
  const hBody = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.17, 0.6, 12), hydMat);
  hBody.position.y = 0.3;
  hBody.castShadow = true;
  hydrant.add(hBody);
  const hTop = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), hydMat);
  hTop.position.y = 0.62;
  hydrant.add(hTop);
  for (const s of [-1, 1]) {
    const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 8), hydMat);
    noz.rotation.z = Math.PI / 2;
    noz.position.set(0.16 * s, 0.36, 0);
    hydrant.add(noz);
  }

  // 倒地的伞
  const umbrella = new THREE.Group();
  umbrella.position.set(1.6, 0.2, 7.1);
  umbrella.rotation.set(0, 0.6, 1.35);
  group.add(umbrella);
  const umbMat = new THREE.MeshStandardMaterial({ color: 0x3f6fb5, roughness: 0.7 });
  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    umbMat
  );
  canopy.castShadow = true;
  umbrella.add(canopy);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 8), darkMetal);
  shaft.position.y = -0.35;
  umbrella.add(shaft);

  /* ================================================================
   *  电线杆 + 电线 + 鸟
   * ================================================================ */
  const wireGroup = new THREE.Group();
  group.add(wireGroup);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x4b4038, roughness: 0.9 });
  for (const x of [-15.5, 15.5]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 8.4, 10), poleMat);
    p.position.set(x, 4.2, 8.4);
    p.castShadow = true;
    wireGroup.add(p);
    const armBar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 2.0), poleMat);
    armBar.position.set(x, 7.6, 8.4);
    wireGroup.add(armBar);
  }
  const wireMat = new THREE.LineBasicMaterial({ color: 0x0e1118, transparent: true, opacity: 0.9 });
  for (let i = 0; i < 3; i++) {
    const z = 8.4 - 0.8 + i * 0.8;
    const y = 7.55 - i * 0.12;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-15.5, y, z),
      new THREE.Vector3(-7, y - 0.7, z),
      new THREE.Vector3(0, y - 1.0, z),
      new THREE.Vector3(7, y - 0.7, z),
      new THREE.Vector3(15.5, y, z),
    ]);
    const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(40));
    wireGroup.add(new THREE.Line(geo, wireMat));
  }

  // 电线上的一只鸟
  const bird = new THREE.Group();
  bird.position.set(1.4, 6.42, 8.0);
  wireGroup.add(bird);
  const birdMat = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.8 });
  const birdBody = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), birdMat);
  birdBody.scale.set(1, 0.85, 1.3);
  bird.add(birdBody);
  const birdHead = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), birdMat);
  birdHead.position.set(0, 0.09, 0.11);
  bird.add(birdHead);
  const beak = new THREE.Mesh(
    new THREE.ConeGeometry(0.022, 0.08, 6),
    new THREE.MeshStandardMaterial({ color: 0xe8a33d, roughness: 0.5 })
  );
  beak.position.set(0, 0.08, 0.2);
  beak.rotation.x = Math.PI / 2;
  bird.add(beak);
  const birdTail = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.22, 6), birdMat);
  birdTail.position.set(0, 0.02, -0.2);
  birdTail.rotation.x = -Math.PI / 2;
  bird.add(birdTail);

  /* ================================================================
   *  井盖冒出的蒸汽 + 绕着路灯飞的飞蛾
   * ================================================================ */
  const steamTex = makeGlowTexture('rgba(200,215,235,0.55)', 'rgba(200,215,235,0)');
  const steam = [];
  for (let i = 0; i < 9; i++) {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: steamTex,
        transparent: true,
        depthWrite: false,
        opacity: 0,
        fog: false,
      })
    );
    s.position.set(-4.6, 0.1, 8.4);
    s.userData.t = rand(0, 3);
    group.add(s);
    steam.push(s);
  }

  const moth = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeGlowTexture('rgba(255,240,200,0.9)', 'rgba(255,240,200,0)'),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    })
  );
  moth.scale.setScalar(0.22);
  group.add(moth);

  let lampOn = true;
  let vendFlash = 0;

  return {
    group,
    /** 开关路灯 */
    toggleLamp() {
      lampOn = !lampOn;
      return lampOn;
    },
    /** 售货机吐货（闪一下） */
    pokeVending() {
      vendFlash = 0.6;
      return true;
    },
    update(dt, t) {
      const base = lampOn ? 28 + Math.sin(t * 7.3) * 1.2 + Math.sin(t * 1.7) * 0.9 : 0;
      lampLight.intensity = base;
      lampGlow.material.color.setHex(lampOn ? 0xffd9a0 : 0x2a2a2e);
      lampHalo.material.opacity = lampOn ? 0.42 + Math.sin(t * 5.1) * 0.06 : 0;
      lampHalo2.material.opacity = lampOn ? 0.16 : 0;

      if (vendFlash > 0) {
        vendFlash -= dt;
        vendFront.material.emissiveIntensity = 0.28 + Math.abs(Math.sin(vendFlash * 40)) * 0.9;
      } else {
        vendFront.material.emissiveIntensity = 0.28;
      }

      for (const s of steam) {
        s.userData.t += dt * 0.32;
        const life = s.userData.t % 1;
        s.position.y = 0.1 + life * 3.4;
        s.position.x = -4.6 + Math.sin(life * 6 + s.userData.t) * 0.35;
        s.position.z = 8.4 + Math.cos(life * 5) * 0.3;
        const sc = 0.5 + life * 2.4;
        s.scale.set(sc, sc, 1);
        s.material.opacity = Math.sin(life * Math.PI) * 0.16;
      }

      // 飞蛾绕灯
      const a = t * 1.6;
      moth.position.set(
        -6.6 + Math.cos(a) * (0.6 + Math.sin(t * 0.7) * 0.35),
        5.0 + Math.sin(a * 2.3) * 0.3,
        7.05 + Math.sin(a) * (0.6 + Math.cos(t * 0.9) * 0.3)
      );
      moth.material.opacity = 0.55 + Math.sin(t * 12) * 0.35;

      // 鸟偶尔抖一下
      bird.rotation.z = Math.sin(t * 1.2) * 0.03;
    },
  };
}
