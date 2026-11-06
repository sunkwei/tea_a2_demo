/*!
 * 三阶魔方 · WebGL 小工具（着色器、缓冲、4x4 矩阵）
 * 零依赖，浏览器 <script> 直接引入 → globalThis.RubiksGL
 */
(function (global) {
  'use strict';

  /* ------------------------------ 矩阵 ------------------------------ */
  function mat4() {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }
  function identity(o) {
    o[0] = 1; o[1] = 0; o[2] = 0; o[3] = 0;
    o[4] = 0; o[5] = 1; o[6] = 0; o[7] = 0;
    o[8] = 0; o[9] = 0; o[10] = 1; o[11] = 0;
    o[12] = 0; o[13] = 0; o[14] = 0; o[15] = 1;
    return o;
  }
  function perspective(o, fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2);
    var nf = 1 / (near - far);
    o[0] = f / aspect; o[1] = 0; o[2] = 0; o[3] = 0;
    o[4] = 0; o[5] = f; o[6] = 0; o[7] = 0;
    o[8] = 0; o[9] = 0; o[10] = (far + near) * nf; o[11] = -1;
    o[12] = 0; o[13] = 0; o[14] = 2 * far * near * nf; o[15] = 0;
    return o;
  }
  function lookAt(o, eye, center, up) {
    var z0 = eye[0] - center[0], z1 = eye[1] - center[1], z2 = eye[2] - center[2];
    var len = Math.hypot(z0, z1, z2) || 1;
    z0 /= len; z1 /= len; z2 /= len;
    var x0 = up[1] * z2 - up[2] * z1;
    var x1 = up[2] * z0 - up[0] * z2;
    var x2 = up[0] * z1 - up[1] * z0;
    len = Math.hypot(x0, x1, x2);
    if (!len) { x0 = 1; x1 = 0; x2 = 0; } else { x0 /= len; x1 /= len; x2 /= len; }
    var y0 = z1 * x2 - z2 * x1;
    var y1 = z2 * x0 - z0 * x2;
    var y2 = z0 * x1 - z1 * x0;
    o[0] = x0; o[1] = y0; o[2] = z0; o[3] = 0;
    o[4] = x1; o[5] = y1; o[6] = z1; o[7] = 0;
    o[8] = x2; o[9] = y2; o[10] = z2; o[11] = 0;
    o[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
    o[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
    o[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
    o[15] = 1;
    return o;
  }
  /** o = a * b（列主序，与 WebGL uniformMatrix4fv 一致） */
  function multiply(o, a, b) {
    var r = new Float32Array(16);
    for (var c = 0; c < 4; c++) {
      for (var row = 0; row < 4; row++) {
        r[c * 4 + row] = a[row] * b[c * 4] + a[4 + row] * b[c * 4 + 1] +
          a[8 + row] * b[c * 4 + 2] + a[12 + row] * b[c * 4 + 3];
      }
    }
    o.set(r);
    return o;
  }
  function fromTranslation(o, v) {
    identity(o);
    o[12] = v[0]; o[13] = v[1]; o[14] = v[2];
    return o;
  }
  function fromScaling(o, v) {
    identity(o);
    o[0] = v[0]; o[5] = v[1]; o[10] = v[2];
    return o;
  }
  /** 由 3x3 旋转 + 平移构造 4x4 */
  function fromRotTrans(o, m3, t) {
    identity(o);
    o[0] = m3[0]; o[1] = m3[1]; o[2] = m3[2]; o[3] = 0;
    o[4] = m3[3]; o[5] = m3[4]; o[6] = m3[5]; o[7] = 0;
    o[8] = m3[6]; o[9] = m3[7]; o[10] = m3[8]; o[11] = 0;
    o[12] = t[0]; o[13] = t[1]; o[14] = t[2]; o[15] = 1;
    return o;
  }
  /** 列主序 4x4 变换点 / 方向 */
  function transformPoint(m, p) {
    var x = p[0], y = p[1], z = p[2];
    return [
      m[0] * x + m[4] * y + m[8] * z + m[12],
      m[1] * x + m[5] * y + m[9] * z + m[13],
      m[2] * x + m[6] * y + m[10] * z + m[14],
    ];
  }
  /** 列主序 4x4 齐次变换，返回 [x, y, z, w]（投影矩阵需要自己除 w） */
  function transformPoint4(m, p) {
    var x = p[0], y = p[1], z = p[2];
    return [
      m[0] * x + m[4] * y + m[8] * z + m[12],
      m[1] * x + m[5] * y + m[9] * z + m[13],
      m[2] * x + m[6] * y + m[10] * z + m[14],
      m[3] * x + m[7] * y + m[11] * z + m[15],
    ];
  }
  function transformDir(m, p) {
    var x = p[0], y = p[1], z = p[2];
    return [
      m[0] * x + m[4] * y + m[8] * z,
      m[1] * x + m[5] * y + m[9] * z,
      m[2] * x + m[6] * y + m[10] * z,
    ];
  }
  function invert(o, m) {
    // 一般 4x4 逆（用于射线拾取）
    var a = m;
    var b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4];
    var b02 = a[0] * a[7] - a[3] * a[4], b03 = a[1] * a[6] - a[2] * a[5];
    var b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6];
    var b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12];
    var b08 = a[8] * a[15] - a[11] * a[12], b09 = a[9] * a[14] - a[10] * a[13];
    var b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
    var det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return identity(o);
    det = 1 / det;
    var r = new Float32Array(16);
    r[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * det;
    r[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * det;
    r[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * det;
    r[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * det;
    r[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * det;
    r[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * det;
    r[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * det;
    r[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * det;
    r[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * det;
    r[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * det;
    r[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * det;
    r[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * det;
    r[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * det;
    r[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * det;
    r[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * det;
    r[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * det;
    o.set(r);
    return o;
  }

  /* ------------------------------ 着色器 ------------------------------ */
  var VERT_SRC = [
    'attribute vec3 aPos;',
    'attribute vec3 aNormal;',
    'attribute vec3 aColor;',
    'uniform mat4 uProj;',
    'uniform mat4 uView;',
    'uniform mat4 uModel;',
    'varying vec3 vNormal;',
    'varying vec3 vColor;',
    'varying vec3 vWorld;',
    'void main() {',
    '  vec4 wp = uModel * vec4(aPos, 1.0);',
    '  vWorld = wp.xyz;',
    '  vNormal = mat3(uModel) * aNormal;',
    '  vColor = aColor;',
    '  gl_Position = uProj * uView * wp;',
    '}',
  ].join('\n');

  var FRAG_SRC = [
    'precision mediump float;',
    'uniform vec3 uLightDir;',
    'uniform vec3 uEye;',
    'uniform float uAlpha;',
    'varying vec3 vNormal;',
    'varying vec3 vColor;',
    'varying vec3 vWorld;',
    'void main() {',
    '  vec3 N = normalize(vNormal);',
    '  vec3 L = normalize(uLightDir);',
    '  float d = max(dot(N, L), 0.0);',
    '  vec3 V = normalize(uEye - vWorld);',
    '  vec3 H = normalize(L + V);',
    '  float spec = pow(max(dot(N, H), 0.0), 28.0) * 0.30;',
    '  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.10;',
    '  vec3 col = vColor * (0.34 + 0.80 * d) + spec + rim;',
    '  gl_FragColor = vec4(col, uAlpha);',
    '}',
  ].join('\n');

  function compile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('着色器编译失败: ' + log);
    }
    return sh;
  }

  function createProgram(gl) {
    var vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
    var fs = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    var p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.bindAttribLocation(p, 1, 'aNormal');
    gl.bindAttribLocation(p, 2, 'aColor');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('着色器链接失败: ' + gl.getProgramInfoLog(p));
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return {
      program: p,
      uProj: gl.getUniformLocation(p, 'uProj'),
      uView: gl.getUniformLocation(p, 'uView'),
      uModel: gl.getUniformLocation(p, 'uModel'),
      uLightDir: gl.getUniformLocation(p, 'uLightDir'),
      uEye: gl.getUniformLocation(p, 'uEye'),
      uAlpha: gl.getUniformLocation(p, 'uAlpha'),
    };
  }

  /** 创建一个可动态更新的网格 */
  function createMesh(gl, maxVerts) {
    var buffer = gl.createBuffer();
    return {
      buffer: buffer,
      maxVerts: maxVerts,
      count: 0,
      data: new Float32Array(maxVerts * 9),
      upload: function () {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.data.subarray(0, this.count * 9), gl.DYNAMIC_DRAW);
      },
    };
  }

  function drawMesh(gl, prog, mesh) {
    if (!mesh.count) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 36, 12);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 36, 24);
    gl.enableVertexAttribArray(0);
    gl.enableVertexAttribArray(1);
    gl.enableVertexAttribArray(2);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  }

  global.RubiksGL = {
    mat4: mat4,
    identity: identity,
    perspective: perspective,
    lookAt: lookAt,
    multiply: multiply,
    fromTranslation: fromTranslation,
    fromScaling: fromScaling,
    fromRotTrans: fromRotTrans,
    transformPoint: transformPoint,
    transformPoint4: transformPoint4,
    transformDir: transformDir,
    invert: invert,
    createProgram: createProgram,
    createMesh: createMesh,
    drawMesh: drawMesh,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
