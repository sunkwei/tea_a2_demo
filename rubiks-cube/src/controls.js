/*!
 * 三阶魔方 · 鼠标 / 触摸交互
 *   - 在贴纸上按住拖动 = 拧那一层（方向由拖动方向决定）
 *   - 在空白处拖动 = 轨道旋转视角
 *   - 滚轮 / 双指 = 缩放
 * 浏览器：<script src="src/controls.js"></script>
 */
(function (global) {
  'use strict';

  var C = global.RubiksCore;

  var HALF = 0.47;

  /** 射线 vs 轴对齐盒子，返回 {t, point, normal} */
  function rayBox(origin, dir, center, half) {
    var tmin = -Infinity, tmax = Infinity;
    var axis = -1, sign = 0;
    for (var i = 0; i < 3; i++) {
      var lo = center[i] - half, hi = center[i] + half;
      if (Math.abs(dir[i]) < 1e-8) {
        if (origin[i] < lo || origin[i] > hi) return null;
        continue;
      }
      var inv = 1 / dir[i];
      var t1 = (lo - origin[i]) * inv;
      var t2 = (hi - origin[i]) * inv;
      var s = -1;
      if (t1 > t2) { var tmp = t1; t1 = t2; t2 = tmp; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    if (tmax < 0) return null;
    var t = tmin >= 0 ? tmin : tmax;
    if (axis < 0) {
      // 射线起点在盒内：取较近的面
      return { t: t, point: null, normal: null };
    }
    return {
      t: t,
      point: [
        origin[0] + dir[0] * t,
        origin[1] + dir[1] * t,
        origin[2] + dir[2] * t,
      ],
      normal: (function () { var n = [0, 0, 0]; n[axis] = sign; return n; })(),
    };
  }

  /** 射线与平面求交 */
  function rayPlane(origin, dir, planePoint, planeNormal) {
    var denom = dir[0] * planeNormal[0] + dir[1] * planeNormal[1] + dir[2] * planeNormal[2];
    if (Math.abs(denom) < 1e-6) return null;
    var t = ((planePoint[0] - origin[0]) * planeNormal[0] +
      (planePoint[1] - origin[1]) * planeNormal[1] +
      (planePoint[2] - origin[2]) * planeNormal[2]) / denom;
    if (t < 0) return null;
    return [
      origin[0] + dir[0] * t,
      origin[1] + dir[1] * t,
      origin[2] + dir[2] * t,
    ];
  }

  function Controls(canvas, camera, app) {
    this.canvas = canvas;
    this.camera = camera;
    this.app = app;
    this.mode = null;         // 'twist' | 'orbit'
    this.pointerId = null;
    this.last = [0, 0];
    this.touchDist = 0;

    var self = this;
    canvas.addEventListener('pointerdown', function (e) { self.onDown(e); });
    canvas.addEventListener('pointermove', function (e) { self.onMove(e); });
    canvas.addEventListener('pointerup', function (e) { self.onUp(e); });
    canvas.addEventListener('pointercancel', function (e) { self.onUp(e); });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      camera.zoom(e.deltaY);
    }, { passive: false });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  Controls.prototype.ndc = function (e) {
    var rect = this.canvas.getBoundingClientRect();
    var x = (e.clientX - rect.left) / rect.width * 2 - 1;
    var y = -((e.clientY - rect.top) / rect.height * 2 - 1);
    return [x, y];
  };

  Controls.prototype.pick = function (e) {
    var app = this.app;
    if (app.isAnimating()) return null;
    var ndc = this.ndc(e);
    var ray = app.renderer.ray(this.camera, ndc[0], ndc[1]);
    var best = null;
    var pieces = app.state.pieces;
    for (var i = 0; i < pieces.length; i++) {
      var p = pieces[i];
      var hit = rayBox(ray.origin, ray.dir, p.pos, HALF);
      if (!hit || !hit.point) continue;
      if (!best || hit.t < best.t) {
        best = { t: hit.t, point: hit.point, normal: hit.normal, piece: p };
      }
    }
    return best;
  };

  Controls.prototype.onDown = function (e) {
    if (this.pointerId !== null) return;
    this.pointerId = e.pointerId;
    this.canvas.setPointerCapture(e.pointerId);
    this.last = [e.clientX, e.clientY];
    var hit = this.pick(e);
    if (hit && hit.normal) {
      this.mode = 'twist';
      this.hit = hit;
      this.angle = 0;
      this.touchPlane = {
        point: hit.point,
        normal: hit.normal,
      };
      this.axis = -1;
      for (var i = 0; i < 3; i++) if (hit.normal[i] !== 0) this.axis = i;
      this.sign = hit.normal[this.axis];
      this.layer = hit.piece.pos[this.axis];
      this.app.setAnim({ axis: this.axis, layer: this.layer, angle: 0 });
    } else {
      this.mode = 'orbit';
    }
  };

  Controls.prototype.onMove = function (e) {
    if (this.pointerId !== e.pointerId) return;
    var dx = e.clientX - this.last[0];
    var dy = e.clientY - this.last[1];
    this.last = [e.clientX, e.clientY];
    if (this.mode === 'orbit') {
      this.camera.rotate(dx, dy);
      return;
    }
    if (this.mode !== 'twist') return;

    var ndc = this.ndc(e);
    var ray = this.app.renderer.ray(this.camera, ndc[0], ndc[1]);
    var p = rayPlane(ray.origin, ray.dir, this.touchPlane.point, this.touchPlane.normal);
    if (!p) return;
    // 相对层中心的位移
    var center = [0, 0, 0];
    center[this.axis] = this.layer;
    var rel = [p[0] - center[0], p[1] - center[1], p[2] - center[2]];
    // 切向速度 = n × rel
    var n = this.touchPlane.normal;
    var tangent = [
      n[1] * rel[2] - n[2] * rel[1],
      n[2] * rel[0] - n[0] * rel[2],
      n[0] * rel[1] - n[1] * rel[0],
    ];
    var len = Math.hypot(tangent[0], tangent[1], tangent[2]);
    if (len < 1e-4) return;
    // 拖动方向与切向的投影
    var mv = this.lastMove || [p[0], p[1], p[2]];
    var d = [p[0] - mv[0], p[1] - mv[1], p[2] - mv[2]];
    var dot = (d[0] * tangent[0] + d[1] * tangent[1] + d[2] * tangent[2]) / len;
    this.lastMove = p;
    this.angle += dot / Math.max(0.25, len);
    this.app.setAnim({ axis: this.axis, layer: this.layer, angle: this.angle });
  };

  Controls.prototype.onUp = function (e) {
    if (this.pointerId !== e.pointerId) return;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    this.pointerId = null;
    if (this.mode === 'twist') {
      var quarter = Math.PI / 2;
      var k = Math.round(this.angle / quarter);
      if (k === 0) {
        this.app.setAnim(null);
        this.app.animateBack({ axis: this.axis, layer: this.layer, angle: this.angle });
      } else {
        k = Math.max(-3, Math.min(3, k));
        this.app.commitTwist(this.axis, this.layer, k * this.sign, this.angle - k * quarter);
      }
    }
    this.mode = null;
    this.lastMove = null;
  };

  global.RubiksControls = { Controls: Controls, rayBox: rayBox, rayPlane: rayPlane };
})(typeof globalThis !== 'undefined' ? globalThis : this);
