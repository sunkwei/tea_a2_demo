/*!
 * 三阶魔方 · 轨道相机
 *   - 方位角 theta / 仰角 phi / 距离 dist
 *   - 视角预设：前 / 后 / 左 / 右 / 上 / 下 / 复位
 */
(function (global) {
  'use strict';

  function Camera() {
    this.theta = 0.72;
    this.phi = 0.92;
    this.dist = 7.4;
    this.target = [0, 0, 0];
    this.eye = [0, 0, 5];
    this.update();
  }

  /** 当前视角的 view 矩阵（世界 → 相机） */
  Camera.prototype.viewMatrix = function () {
    var G = global.RubiksGL;
    if (!G) return null;
    return G.lookAt(G.mat4(), this.eye, this.target, [0, 1, 0]);
  };

  Camera.prototype.update = function () {
    var sp = Math.sin(this.phi);
    var cp = Math.cos(this.phi);
    this.eye = [
      this.target[0] + this.dist * sp * Math.sin(this.theta),
      this.target[1] + this.dist * cp,
      this.target[2] + this.dist * sp * Math.cos(this.theta),
    ];
    if (this.eye[1] < -this.dist * 0.95) this.eye[1] = -this.dist * 0.95;
  };

  Camera.prototype.preset = function (name) {
    var presets = {
      front: [0, 0.92, 7.4],
      back: [Math.PI, 0.92, 7.4],
      left: [-Math.PI / 2, 0.92, 7.4],
      right: [Math.PI / 2, 0.92, 7.4],
      top: [0.001, 0.06, 7.4],
      bottom: [0.001, Math.PI - 0.06, 7.4],
      reset: [0.72, 0.92, 7.4],
    };
    var p = presets[name] || presets.reset;
    this.theta = p[0];
    this.phi = p[1];
    this.dist = p[2];
    this.update();
  };

  Camera.prototype.rotate = function (dx, dy) {
    this.theta -= dx * 0.008;
    this.phi -= dy * 0.008;
    if (this.phi < 0.06) this.phi = 0.06;
    if (this.phi > Math.PI - 0.06) this.phi = Math.PI - 0.06;
    this.update();
  };

  Camera.prototype.zoom = function (delta) {
    this.dist *= (1 + delta * 0.0016);
    if (this.dist < 3.6) this.dist = 3.6;
    if (this.dist > 16) this.dist = 16;
    this.update();
  };

  global.RubiksCamera = { Camera: Camera };
})(typeof globalThis !== 'undefined' ? globalThis : this);
