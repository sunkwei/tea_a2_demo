/*!
 * 三阶魔方 · 场景渲染
 *   - 26 个块本体（带倒角感的深色塑料）
 *   - 54 张贴纸（按颜色着色，带高光）
 *   - 目标块高亮（发光边框）
 *   - 三维坐标轴 gizmo（X 红 / Y 绿 / Z 蓝，画在画面角落）
 * 浏览器：<script src="src/gl.js"></script><script src="src/renderer.js"></script>
 */
(function (global) {
  'use strict';

  var C = global.RubiksCore;
  var G = global.RubiksGL;

  var BODY_HALF = 0.47;
  var STICKER_HALF = 0.385;
  var STICKER_OUT = 0.492;

  var AXIS_COLORS = {
    x: [0.95, 0.29, 0.33],
    y: [0.36, 0.83, 0.44],
    z: [0.35, 0.60, 0.95],
  };

  /** 绕任意轴的旋转矩阵（罗德里格斯公式），返回 9 元数组 */
  function rotAxisAngle(axis, angle) {
    var c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
    var v = [0, 0, 0];
    v[axis] = 1;
    var x = v[0], y = v[1], z = v[2];
    return [
      t * x * x + c, t * x * y + s * z, t * x * z - s * y,
      t * x * y - s * z, t * y * y + c, t * y * z + s * x,
      t * x * z + s * y, t * y * z - s * x, t * z * z + c,
    ];
  }

  /** 取与法线垂直的两个切向 */
  function basisFor(n) {
    var up = Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    var u = [
      up[1] * n[2] - up[2] * n[1],
      up[2] * n[0] - up[0] * n[2],
      up[0] * n[1] - up[1] * n[0],
    ];
    var len = Math.hypot(u[0], u[1], u[2]) || 1;
    u = [u[0] / len, u[1] / len, u[2] / len];
    var v = [
      n[1] * u[2] - n[2] * u[1],
      n[2] * u[0] - n[0] * u[2],
      n[0] * u[1] - n[1] * u[0],
    ];
    return [u, v];
  }

  function hexToRgb(hex) {
    var h = hex.replace('#', '');
    return [
      parseInt(h.slice(0, 2), 16) / 255,
      parseInt(h.slice(2, 4), 16) / 255,
      parseInt(h.slice(4, 6), 16) / 255,
    ];
  }

  /* ------------------------------------------------------------------ *
   * 渲染器
   * ------------------------------------------------------------------ */
  function Renderer(canvas) {
    var gl = canvas.getContext('webgl', { antialias: true, alpha: false }) ||
      canvas.getContext('experimental-webgl');
    if (!gl) throw new Error('此浏览器不支持 WebGL');
    this.canvas = canvas;
    this.gl = gl;
    this.prog = G.createProgram(gl);
    this.bodyMesh = G.createMesh(gl, 26 * 36);
    this.stickerMesh = G.createMesh(gl, 60 * 6);
    this.markMesh = G.createMesh(gl, 12 * 6);
    this.gizmoMesh = G.createMesh(gl, 3 * 36 + 3 * 18);
    this.proj = G.mat4();
    this.view = G.mat4();
    this.model = G.mat4();
    this.gizmoModel = G.mat4();
    this.projInv = G.mat4();
    this.viewInv = G.mat4();
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0.055, 0.063, 0.086, 1);
  }

  /** 把块的状态（位置 + 朝向）算出来，动画层再叠加一次旋转 */
  function pieceTransform(piece, anim) {
    var pos = piece.pos.slice();
    var rot = piece.rot.slice();
    if (anim && anim.angle !== 0 && pos[anim.axis] === anim.layer) {
      var m = rotAxisAngle(anim.axis, anim.angle);
      var center = [0, 0, 0];
      center[anim.axis] = anim.layer;
      var rel = [pos[0] - center[0], pos[1] - center[1], pos[2] - center[2]];
      var r2 = [
        m[0] * rel[0] + m[1] * rel[1] + m[2] * rel[2],
        m[3] * rel[0] + m[4] * rel[1] + m[5] * rel[2],
        m[6] * rel[0] + m[7] * rel[1] + m[8] * rel[2],
      ];
      pos = [r2[0] + center[0], r2[1] + center[1], r2[2] + center[2]];
      rot = C.matMul(m, rot);
    }
    return { pos: pos, rot: rot };
  }

  function pushBox(mesh, center, half, rot, color) {
    var d = mesh.data;
    var n = mesh.count;
    // 8 个角点
    var signs = [
      [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
      [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
    ];
    var verts = [];
    for (var i = 0; i < 8; i++) {
      var p = [
        center[0] + signs[i][0] * half[0],
        center[1] + signs[i][1] * half[1],
        center[2] + signs[i][2] * half[2],
      ];
      verts.push(C.matApply(rot, p));
    }
    var faces = [
      [0, 1, 2, 3, [0, 0, -1]],
      [5, 4, 7, 6, [0, 0, 1]],
      [4, 0, 3, 7, [-1, 0, 0]],
      [1, 5, 6, 2, [1, 0, 0]],
      [3, 2, 6, 7, [0, 1, 0]],
      [4, 5, 1, 0, [0, -1, 0]],
    ];
    for (var f = 0; f < faces.length; f++) {
      var face = faces[f];
      var nrm = C.matApply(rot, face[4]);
      var quad = [face[0], face[1], face[2], face[0], face[2], face[3]];
      for (var q = 0; q < 6; q++) {
        var vi = quad[q] * 3;
        d[n * 9] = verts[quad[q]][0];
        d[n * 9 + 1] = verts[quad[q]][1];
        d[n * 9 + 2] = verts[quad[q]][2];
        d[n * 9 + 3] = nrm[0];
        d[n * 9 + 4] = nrm[1];
        d[n * 9 + 5] = nrm[2];
        d[n * 9 + 6] = color[0];
        d[n * 9 + 7] = color[1];
        d[n * 9 + 8] = color[2];
        n++;
      }
    }
    mesh.count = n;
  }

  function pushQuad(mesh, a, b, c, dd, nrm, color) {
    var d = mesh.data;
    var n = mesh.count;
    var pts = [a, b, c, a, c, dd];
    for (var i = 0; i < 6; i++) {
      d[n * 9] = pts[i][0];
      d[n * 9 + 1] = pts[i][1];
      d[n * 9 + 2] = pts[i][2];
      d[n * 9 + 3] = nrm[0];
      d[n * 9 + 4] = nrm[1];
      d[n * 9 + 5] = nrm[2];
      d[n * 9 + 6] = color[0];
      d[n * 9 + 7] = color[1];
      d[n * 9 + 8] = color[2];
      n++;
    }
    mesh.count = n;
  }

  function pushLine3(mesh, p0, p1, thickness, color) {
    var dir = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    var len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    dir = [dir[0] / len, dir[1] / len, dir[2] / len];
    var up = Math.abs(dir[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    var side = [
      dir[1] * up[2] - dir[2] * up[1],
      dir[2] * up[0] - dir[0] * up[2],
      dir[0] * up[1] - dir[1] * up[0],
    ];
    var l = Math.hypot(side[0], side[1], side[2]) || 1;
    side = [side[0] / l * thickness, side[1] / l * thickness, side[2] / l * thickness];
    var nrm = [
      side[1] * dir[2] - side[2] * dir[1],
      side[2] * dir[0] - side[0] * dir[2],
      side[0] * dir[1] - side[1] * dir[0],
    ];
    pushQuad(mesh,
      [p0[0] - side[0], p0[1] - side[1], p0[2] - side[2]],
      [p1[0] - side[0], p1[1] - side[1], p1[2] - side[2]],
      [p1[0] + side[0], p1[1] + side[1], p1[2] + side[2]],
      [p0[0] + side[0], p0[1] + side[1], p0[2] + side[2]],
      nrm, color);
  }

  /* ------------------------------------------------------------------ *
   * 场景构建
   * ------------------------------------------------------------------ */
  Renderer.prototype.buildScene = function (state, opts) {
    opts = opts || {};
    var anim = opts.anim || null;
    var highlight = opts.highlight || null;   // 目标块 id
    var body = this.bodyMesh, sticker = this.stickerMesh, mark = this.markMesh;
    body.count = 0; sticker.count = 0; mark.count = 0;

    var bodyColor = [0.085, 0.09, 0.105];
    var pieces = state.pieces;
    for (var i = 0; i < pieces.length; i++) {
      var piece = pieces[i];
      var tf = pieceTransform(piece, anim);
      var isTarget = highlight && piece.id === highlight;
      pushBox(body, tf.pos, [BODY_HALF, BODY_HALF, BODY_HALF], tf.rot,
        isTarget ? [0.30, 0.42, 0.55] : bodyColor);

      // 贴纸：只有朝外的才画
      for (var s = 0; s < piece.stickers.length; s++) {
        var st = piece.stickers[s];
        var dir = C.matApply(tf.rot, st.dir);
        var axis = -1, sign = 0;
        for (var k = 0; k < 3; k++) {
          if (dir[k] === 1) { axis = k; sign = 1; break; }
          if (dir[k] === -1) { axis = k; sign = -1; break; }
        }
        if (axis < 0) continue;
        var outward = tf.pos[axis] === sign;
        if (!outward) continue;
        var b = basisFor(dir);
        var center = [tf.pos[0] + dir[0] * STICKER_OUT, tf.pos[1] + dir[1] * STICKER_OUT,
          tf.pos[2] + dir[2] * STICKER_OUT];
        var col = hexToRgb(C.COLORS[st.color].hex);
        function mk(su, sv) {
          return [
            center[0] + b[0][0] * su + b[1][0] * sv,
            center[1] + b[0][1] * su + b[1][1] * sv,
            center[2] + b[0][2] * su + b[1][2] * sv,
          ];
        }
        var h = STICKER_HALF;
        pushQuad(sticker, mk(-h, -h), mk(h, -h), mk(h, h), mk(-h, h), dir, col);
      }

      if (isTarget) {
        // 目标块：画一圈发光边框
        var hl = BODY_HALF + 0.06;
        var glow = [1.0, 0.78, 0.25];
        var edges = [
          [[-hl, -hl, -hl], [hl, -hl, -hl]], [[hl, -hl, -hl], [hl, hl, -hl]],
          [[hl, hl, -hl], [-hl, hl, -hl]], [[-hl, hl, -hl], [-hl, -hl, -hl]],
          [[-hl, -hl, hl], [hl, -hl, hl]], [[hl, -hl, hl], [hl, hl, hl]],
          [[hl, hl, hl], [-hl, hl, hl]], [[-hl, hl, hl], [-hl, -hl, hl]],
          [[-hl, -hl, -hl], [-hl, -hl, hl]], [[hl, -hl, -hl], [hl, -hl, hl]],
          [[hl, hl, -hl], [hl, hl, hl]], [[-hl, hl, -hl], [-hl, hl, hl]],
        ];
        for (var e = 0; e < edges.length; e++) {
          var p0 = C.matApply(tf.rot, [edges[e][0][0] + tf.pos[0], edges[e][0][1] + tf.pos[1],
            edges[e][0][2] + tf.pos[2]]);
          var p1 = C.matApply(tf.rot, [edges[e][1][0] + tf.pos[0], edges[e][1][1] + tf.pos[1],
            edges[e][1][2] + tf.pos[2]]);
          pushLine3(mark, p0, p1, 0.035, glow);
        }
      }
    }
    body.upload();
    sticker.upload();
    mark.upload();
  };

  /** 坐标轴 gizmo：画在画面左下角（相机空间，尺寸恒定，像 HUD 一样不被遮挡） */
  Renderer.prototype.buildGizmo = function (camera, size) {
    var mesh = this.gizmoMesh;
    mesh.count = 0;
    var k = (size || 1);
    var len = 0.34 * k;
    var origin = [-0.78 * k, -0.56 * k, -2.6];
    var axes = [
      { dir: [1, 0, 0], color: AXIS_COLORS.x, label: 'X' },
      { dir: [0, 1, 0], color: AXIS_COLORS.y, label: 'Y' },
      { dir: [0, 0, 1], color: AXIS_COLORS.z, label: 'Z' },
    ];
    var viewMat = camera.viewMatrix ? camera.viewMatrix() : this.view;
    var tips = [];
    for (var i = 0; i < axes.length; i++) {
      var a = axes[i];
      var d = G.transformDir(viewMat, a.dir);
      var tip = [
        origin[0] + d[0] * len,
        origin[1] + d[1] * len,
        origin[2] + d[2] * len,
      ];
      tips.push(tip);
      pushLine3(mesh, origin, tip, 0.028 * k, a.color);
      // 轴端的小方块，便于辨认方向
      var perp = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
      var side = [
        d[1] * perp[2] - d[2] * perp[1],
        d[2] * perp[0] - d[0] * perp[2],
        d[0] * perp[1] - d[1] * perp[0],
      ];
      var l = Math.hypot(side[0], side[1], side[2]) || 1;
      side = [side[0] / l, side[1] / l, side[2] / l];
      var up = [
        d[1] * side[2] - d[2] * side[1],
        d[2] * side[0] - d[0] * side[2],
        d[0] * side[1] - d[1] * side[0],
      ];
      var t = 0.035 * k;
      pushQuad(mesh,
        [tip[0] - side[0] * t - up[0] * t, tip[1] - side[1] * t - up[1] * t, tip[2] - side[2] * t - up[2] * t],
        [tip[0] + side[0] * t - up[0] * t, tip[1] + side[1] * t - up[1] * t, tip[2] + side[2] * t - up[2] * t],
        [tip[0] + side[0] * t + up[0] * t, tip[1] + side[1] * t + up[1] * t, tip[2] + side[2] * t + up[2] * t],
        [tip[0] - side[0] * t + up[0] * t, tip[1] - side[1] * t + up[1] * t, tip[2] - side[2] * t + up[2] * t],
        d, a.color);
    }
    mesh.upload();
    return tips;
  };

  /* ------------------------------------------------------------------ *
   * 绘制
   * ------------------------------------------------------------------ */
  Renderer.prototype.render = function (camera, opts) {
    opts = opts || {};
    var gl = this.gl;
    var prog = this.prog;
    var w = this.canvas.clientWidth || this.canvas.width;
    var h = this.canvas.clientHeight || this.canvas.height;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(prog.program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    G.perspective(this.proj, (opts.fov || 42) * Math.PI / 180,
      this.canvas.width / Math.max(1, this.canvas.height), 0.1, 100);
    var vm = camera.viewMatrix ? camera.viewMatrix() : G.lookAt(G.mat4(), camera.eye, camera.target, [0, 1, 0]);
    this.view.set(vm);
    G.invert(this.projInv, this.proj);
    G.invert(this.viewInv, this.view);

    gl.uniformMatrix4fv(prog.uProj, false, this.proj);
    gl.uniformMatrix4fv(prog.uView, false, this.view);
    gl.uniformMatrix4fv(prog.uModel, false, this.model);
    gl.uniform3f(prog.uLightDir, 0.45, 0.82, 0.36);
    gl.uniform3f(prog.uEye, camera.eye[0], camera.eye[1], camera.eye[2]);
    gl.uniform1f(prog.uAlpha, 1);

    G.drawMesh(gl, prog, this.bodyMesh);
    G.drawMesh(gl, prog, this.stickerMesh);

    // 高亮边框（半透明叠加）
    if (this.markMesh.count) {
      gl.uniform1f(prog.uAlpha, 0.95);
      gl.depthMask(false);
      G.drawMesh(gl, prog, this.markMesh);
      gl.depthMask(true);
      gl.uniform1f(prog.uAlpha, 1);
    }

    // 坐标轴（画在相机空间，像 HUD：不受魔方遮挡）
    if (this.gizmoMesh.count) {
      gl.uniformMatrix4fv(prog.uView, false, G.identity(G.mat4()));
      gl.disable(gl.DEPTH_TEST);
      G.drawMesh(gl, prog, this.gizmoMesh);
      gl.enable(gl.DEPTH_TEST);
      gl.uniformMatrix4fv(prog.uView, false, this.view);
    }
  };

  /** 屏幕坐标 → 世界射线 */
  Renderer.prototype.ray = function (camera, ndcX, ndcY) {
    var q0 = G.transformPoint4(this.projInv, [ndcX, ndcY, -1]);
    var q1 = G.transformPoint4(this.projInv, [ndcX, ndcY, 1]);
    var p0 = [q0[0] / q0[3], q0[1] / q0[3], q0[2] / q0[3]];
    var p1 = [q1[0] / q1[3], q1[1] / q1[3], q1[2] / q1[3]];
    var a = G.transformPoint(this.viewInv, p0);
    var b = G.transformPoint(this.viewInv, p1);
    var dir = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    var len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    return { origin: a, dir: [dir[0] / len, dir[1] / len, dir[2] / len] };
  };

  Renderer.prototype.rotAxisAngle = rotAxisAngle;

  global.RubiksRenderer = {
    Renderer: Renderer,
    rotAxisAngle: rotAxisAngle,
    basisFor: basisFor,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
