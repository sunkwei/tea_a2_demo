/*!
 * 三阶魔方 · 核心模型（零依赖）
 *   - 26 个块（8 角 / 12 棱 / 6 中心）的位置 + 朝向矩阵
 *   - 6 面转动（U D L R F B）+ 中层（M E S）+ 整体旋转（x y z）
 *   - 记号解析：'R' / "R'" / 'R2'，字符串序列解析与压缩
 *   - 面色提取：单面取色 / 六面展开 / 贴纸世界坐标
 *
 * 浏览器：<script src="src/core.js"></script>  →  globalThis.RubiksCore
 * Node  ：new Function(src)() 后取 globalThis.RubiksCore
 */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 颜色与面
   * 配色：上=黄 下=白 前=绿 后=蓝 右=红 左=橙（右手标准记号）
   * ------------------------------------------------------------------ */
  var COLORS = {
    W: { name: '白', hex: '#f2f3f5', dark: '#c9ccd1' },
    Y: { name: '黄', hex: '#ffd21e', dark: '#d0a400' },
    G: { name: '绿', hex: '#00a651', dark: '#00743a' },
    B: { name: '蓝', hex: '#0b6bcb', dark: '#084a8c' },
    R: { name: '红', hex: '#d81f26', dark: '#94141a' },
    O: { name: '橙', hex: '#ff7a1a', dark: '#c2560f' },
  };
  var FACE_CN = { U: '上', D: '下', F: '前', B: '后', R: '右', L: '左' };
  var COLOR_FACE = { Y: 'U', W: 'D', G: 'F', B: 'B', R: 'R', O: 'L' };

  /* ------------------------------------------------------------------ *
   * 转动定义
   * axis: 0=X 1=Y 2=Z ；layer: 该轴上的层（-1/0/1，null = 整体）
   * dir  : 绕「正轴」旋转的符号，+1 = 右手定则 +90°
   *        记号约定：顺时针（从该面外侧看）= 绕外法线 -90°
   *        因此 U/R/F(dir=-1)  L/D/B(dir=+1)
   * ------------------------------------------------------------------ */
  var MOVE_DEFS = {
    U: { axis: 1, layer: 1, dir: -1 },
    D: { axis: 1, layer: -1, dir: 1 },
    R: { axis: 0, layer: 1, dir: -1 },
    L: { axis: 0, layer: -1, dir: 1 },
    F: { axis: 2, layer: 1, dir: -1 },
    B: { axis: 2, layer: -1, dir: 1 },
    M: { axis: 0, layer: 0, dir: 1 },  // 中层，跟随 L
    E: { axis: 1, layer: 0, dir: 1 },  // 中层，跟随 D
    S: { axis: 2, layer: 0, dir: -1 }, // 中层，跟随 F
    X: { axis: 0, layer: null, dir: -1 }, // 整体旋转
    Y: { axis: 1, layer: null, dir: -1 },
    Z: { axis: 2, layer: null, dir: -1 },
  };

  /** 轴 + 层 → 面与该面「正向记号」对应的有符号步 */
  var FACE_BY_AXIS_LAYER = {
    '0_1': { face: 'R', dir: -1 },
    '0_-1': { face: 'L', dir: 1 },
    '1_1': { face: 'U', dir: -1 },
    '1_-1': { face: 'D', dir: 1 },
    '2_1': { face: 'F', dir: -1 },
    '2_-1': { face: 'B', dir: 1 },
  };

  /* ------------------------------------------------------------------ *
   * 26 个块：home = 归位坐标，stickers = [方向, 颜色]
   * ------------------------------------------------------------------ */
  var PIECES = [
    /* 中心 */
    { id: 'U', type: 'center', home: [0, 1, 0], stickers: [[[0, 1, 0], 'Y']] },
    { id: 'D', type: 'center', home: [0, -1, 0], stickers: [[[0, -1, 0], 'W']] },
    { id: 'F', type: 'center', home: [0, 0, 1], stickers: [[[0, 0, 1], 'G']] },
    { id: 'B', type: 'center', home: [0, 0, -1], stickers: [[[0, 0, -1], 'B']] },
    { id: 'R', type: 'center', home: [1, 0, 0], stickers: [[[1, 0, 0], 'R']] },
    { id: 'L', type: 'center', home: [-1, 0, 0], stickers: [[[-1, 0, 0], 'O']] },
    /* 棱块 */
    { id: 'UF', type: 'edge', home: [0, 1, 1], stickers: [[[0, 1, 0], 'Y'], [[0, 0, 1], 'G']] },
    { id: 'UR', type: 'edge', home: [1, 1, 0], stickers: [[[0, 1, 0], 'Y'], [[1, 0, 0], 'R']] },
    { id: 'UB', type: 'edge', home: [0, 1, -1], stickers: [[[0, 1, 0], 'Y'], [[0, 0, -1], 'B']] },
    { id: 'UL', type: 'edge', home: [-1, 1, 0], stickers: [[[0, 1, 0], 'Y'], [[-1, 0, 0], 'O']] },
    { id: 'FR', type: 'edge', home: [1, 0, 1], stickers: [[[0, 0, 1], 'G'], [[1, 0, 0], 'R']] },
    { id: 'BR', type: 'edge', home: [1, 0, -1], stickers: [[[0, 0, -1], 'B'], [[1, 0, 0], 'R']] },
    { id: 'BL', type: 'edge', home: [-1, 0, -1], stickers: [[[0, 0, -1], 'B'], [[-1, 0, 0], 'O']] },
    { id: 'FL', type: 'edge', home: [-1, 0, 1], stickers: [[[0, 0, 1], 'G'], [[-1, 0, 0], 'O']] },
    { id: 'DF', type: 'edge', home: [0, -1, 1], stickers: [[[0, -1, 0], 'W'], [[0, 0, 1], 'G']] },
    { id: 'DR', type: 'edge', home: [1, -1, 0], stickers: [[[0, -1, 0], 'W'], [[1, 0, 0], 'R']] },
    { id: 'DB', type: 'edge', home: [0, -1, -1], stickers: [[[0, -1, 0], 'W'], [[0, 0, -1], 'B']] },
    { id: 'DL', type: 'edge', home: [-1, -1, 0], stickers: [[[0, -1, 0], 'W'], [[-1, 0, 0], 'O']] },
    /* 角块 */
    { id: 'UFR', type: 'corner', home: [1, 1, 1], stickers: [[[0, 1, 0], 'Y'], [[0, 0, 1], 'G'], [[1, 0, 0], 'R']] },
    { id: 'URB', type: 'corner', home: [1, 1, -1], stickers: [[[0, 1, 0], 'Y'], [[1, 0, 0], 'R'], [[0, 0, -1], 'B']] },
    { id: 'UBL', type: 'corner', home: [-1, 1, -1], stickers: [[[0, 1, 0], 'Y'], [[0, 0, -1], 'B'], [[-1, 0, 0], 'O']] },
    { id: 'ULF', type: 'corner', home: [-1, 1, 1], stickers: [[[0, 1, 0], 'Y'], [[-1, 0, 0], 'O'], [[0, 0, 1], 'G']] },
    { id: 'DFR', type: 'corner', home: [1, -1, 1], stickers: [[[0, -1, 0], 'W'], [[0, 0, 1], 'G'], [[1, 0, 0], 'R']] },
    { id: 'DRB', type: 'corner', home: [1, -1, -1], stickers: [[[0, -1, 0], 'W'], [[1, 0, 0], 'R'], [[0, 0, -1], 'B']] },
    { id: 'DBL', type: 'corner', home: [-1, -1, -1], stickers: [[[0, -1, 0], 'W'], [[0, 0, -1], 'B'], [[-1, 0, 0], 'O']] },
    { id: 'DLF', type: 'corner', home: [-1, -1, 1], stickers: [[[0, -1, 0], 'W'], [[-1, 0, 0], 'O'], [[0, 0, 1], 'G']] },
  ];

  /* ------------------------------------------------------------------ *
   * 矩阵工具（行主序 3x3，向量按列）
   * ------------------------------------------------------------------ */
  function matMul(a, b) {
    var out = new Array(9);
    for (var i = 0; i < 3; i++) {
      for (var j = 0; j < 3; j++) {
        out[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
      }
    }
    return out;
  }
  function matApply(m, v) {
    return [
      m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
      m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
      m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
    ];
  }
  function rotMat(axis, dir) {
    if (axis === 0) return dir > 0 ? [1, 0, 0, 0, 0, -1, 0, 1, 0] : [1, 0, 0, 0, 0, 1, 0, -1, 0];
    if (axis === 1) return dir > 0 ? [0, 0, 1, 0, 1, 0, -1, 0, 0] : [0, 0, -1, 0, 1, 0, 1, 0, 0];
    return dir > 0 ? [0, -1, 0, 1, 0, 0, 0, 0, 1] : [0, 1, 0, -1, 0, 0, 0, 0, 1];
  }
  var IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  function isIdentity(m) {
    for (var i = 0; i < 9; i++) if (m[i] !== IDENTITY[i]) return false;
    return true;
  }
  function matEquals(a, b) {
    for (var i = 0; i < 9; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function vecEquals(a, b) {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  }
  function copyMat(m) { return [m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]]; }

  /**
   * 全部 24 个朝向矩阵（含 12 个绕「棱轴」的 180° 旋转）。
   * 注意：只取主轴旋转会漏掉棱块「翻面」的姿态，
   * 所以这里用 BFS 从单位矩阵出发枚举整个旋转群。
   */
  var ROTATIONS = (function () {
    var out = [IDENTITY.slice()];
    var seen = {};
    var queue = [IDENTITY.slice()];
    seen[IDENTITY.join(',')] = true;
    while (queue.length) {
      var m = queue.shift();
      for (var axis = 0; axis < 3; axis++) {
        for (var dir = -1; dir <= 1; dir += 2) {
          var nm = matMul(rotMat(axis, dir), m);
          var k = nm.join(',');
          if (seen[k]) continue;
          seen[k] = true;
          out.push(nm);
          queue.push(nm);
        }
      }
    }
    return out;
  })();

  /* ------------------------------------------------------------------ *
   * 状态
   * ------------------------------------------------------------------ */
  function createState() {
    var pieces = PIECES.map(function (def) {
      return {
        id: def.id,
        type: def.type,
        home: def.home.slice(),
        pos: def.home.slice(),
        rot: IDENTITY.slice(),
        stickers: def.stickers.map(function (s) {
          return { dir: s[0].slice(), color: s[1] };
        }),
      };
    });
    return { pieces: pieces };
  }

  function cloneState(state) {
    return {
      pieces: state.pieces.map(function (p) {
        return {
          id: p.id,
          type: p.type,
          home: p.home,
          pos: p.pos.slice(),
          rot: p.rot.slice(),
          stickers: p.stickers.map(function (s) { return { dir: s.dir, color: s.color }; }),
        };
      }),
    };
  }

  function pieceById(state, id) {
    for (var i = 0; i < state.pieces.length; i++) if (state.pieces[i].id === id) return state.pieces[i];
    return null;
  }

  /** 记号 → {face, axis, layer, dir, quarters} */
  function parseMove(name) {
    if (typeof name !== 'string') return null;
    var s = name.trim();
    if (!s) return null;
    var face = s[0].toUpperCase();
    var def = MOVE_DEFS[face];
    if (!def) return null;
    var raw = s.slice(1);
    var hasPrime = /[’']/.test(raw);
    var suffix = raw.replace(/[’']/g, '').trim();
    var quarters;
    if (suffix === '2') quarters = 2;
    else if (suffix === '') quarters = hasPrime ? 3 : 1;
    else if (suffix === '3') quarters = 3;
    else return null;
    return {
      face: face,
      axis: def.axis,
      layer: def.layer,
      dir: def.dir,
      quarters: quarters,
      whole: def.layer === null,
    };
  }

  /** 解析记号串： "R U R' F2" → ['R','U',"R'",'F2'] */
  function parseSequence(text) {
    if (Array.isArray(text)) return text.slice();
    var tokens = String(text || '').trim().split(/[\s,]+/).filter(Boolean);
    var out = [];
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      var m = /^([UDLRFBMESxyz])([2']|’)?$/i.exec(t);
      if (!m) return null;
      var face = m[1].toUpperCase();
      var mark = m[2] === '2' ? '2' : (m[2] ? "'" : '');
      out.push(face + mark);
    }
    return out;
  }

  /** 90° 步的有符号表示（绕正轴，+1 = +90°） */
  function signedStep(name) {
    var m = parseMove(name);
    if (!m) return null;
    var step = m.dir * m.quarters;
    step = ((step % 4) + 4) % 4;
    return { axis: m.axis, layer: m.layer, step: step, face: m.face, whole: m.whole };
  }

  /**
   * 把记号序列压成规范形式：同轴相邻的转动合并（RR→R2，RR'→去掉）
   * 只合并 6 面转动，中层/整体旋转原样保留。
   */
  function compressMoves(moves) {
    var out = [];
    var pending = null; // {axis, step}
    function flush() {
      if (!pending) return;
      var s = pending.step % 4;
      var info = FACE_BY_AXIS_LAYER[pending.axis + '_' + pending.layer];
      pending = null;
      if (!info || s === 0) return;
      var plain = ((info.dir % 4) + 4) % 4;
      if (s === 2) out.push(info.face + '2');
      else if (s === plain) out.push(info.face);
      else out.push(info.face + "'");
    }
    for (var i = 0; i < moves.length; i++) {
      var st = signedStep(moves[i]);
      if (!st) continue;
      if (st.whole || st.layer === 0) { flush(); out.push(moves[i]); continue; }
      if (pending && pending.axis === st.axis && pending.layer === st.layer) {
        pending.step = (pending.step + st.step) % 4;
      } else {
        flush();
        pending = { axis: st.axis, layer: st.layer, step: st.step };
      }
    }
    flush();
    return out;
  }

  /** 对状态施加一步（原地修改） */
  function applyMoveInPlace(state, name) {
    var m = parseMove(name);
    if (!m) return false;
    for (var q = 0; q < m.quarters; q++) {
      var mat = rotMat(m.axis, m.dir);
      for (var i = 0; i < state.pieces.length; i++) {
        var p = state.pieces[i];
        if (m.layer !== null && p.pos[m.axis] !== m.layer) continue;
        p.pos = matApply(mat, p.pos);
        p.rot = matMul(mat, p.rot);
      }
    }
    return true;
  }

  /** 返回新状态 */
  function applyMove(state, name) {
    var next = cloneState(state);
    applyMoveInPlace(next, name);
    return next;
  }

  /** 施加一串转动，返回新状态 */
  function applySequence(state, moves) {
    var next = cloneState(state);
    for (var i = 0; i < moves.length; i++) applyMoveInPlace(next, moves[i]);
    return next;
  }

  /** 逆转动记号 */
  function invertMove(name) {
    var m = parseMove(name);
    if (!m) return name;
    if (m.quarters === 2) return m.face + '2';
    var step = ((m.dir * m.quarters) % 4 + 4) % 4;
    if (step === 0) return m.face;
    var inv = (4 - step) % 4;
    if (inv === 2) return m.face + '2';
    var plainStep = ((m.dir % 4) + 4) % 4; // 该面「正向记号」对应的步
    return (inv === plainStep) ? m.face : m.face + "'";
  }

  /**
   * 绕「正轴」旋转某一层（右手定则），quarters 为 90° 的倍数。
   * 鼠标拧层用它，方向与动画方向保持一致。
   */
  function rotateLayer(state, axis, layer, quarters) {
    var q = ((quarters % 4) + 4) % 4;
    if (q === 0) return state;
    for (var s = 0; s < q; s++) {
      var mat = rotMat(axis, 1);
      for (var i = 0; i < state.pieces.length; i++) {
        var pc = state.pieces[i];
        if (pc.pos[axis] !== layer) continue;
        pc.pos = matApply(mat, pc.pos);
        pc.rot = matMul(mat, pc.rot);
      }
    }
    return state;
  }

  /* ------------------------------------------------------------------ *
   * 查询
   * ------------------------------------------------------------------ */
  function isSolved(state) {
    for (var i = 0; i < state.pieces.length; i++) {
      var p = state.pieces[i];
      if (!vecEquals(p.pos, p.home) || !isIdentity(p.rot)) return false;
    }
    return true;
  }

  /** 块是否归位（位置与朝向都正确） */
  function pieceSolved(state, id) {
    var p = pieceById(state, id);
    if (!p) return false;
    return vecEquals(p.pos, p.home) && isIdentity(p.rot);
  }

  /** 某位置上朝外的方向集合 */
  function outwardDirs(pos) {
    var out = [];
    if (pos[0] === 1) out.push([1, 0, 0]);
    if (pos[0] === -1) out.push([-1, 0, 0]);
    if (pos[1] === 1) out.push([0, 1, 0]);
    if (pos[1] === -1) out.push([0, -1, 0]);
    if (pos[2] === 1) out.push([0, 0, 1]);
    if (pos[2] === -1) out.push([0, 0, -1]);
    return out;
  }

  /** 贴纸世界坐标：{pieceId, color, dir, pos} */
  function facelets(state) {
    var out = [];
    for (var i = 0; i < state.pieces.length; i++) {
      var p = state.pieces[i];
      for (var j = 0; j < p.stickers.length; j++) {
        var st = p.stickers[j];
        var d = matApply(p.rot, st.dir);
        out.push({
          pieceId: p.id,
          color: st.color,
          dir: d,
          pos: [p.pos[0] + d[0], p.pos[1] + d[1], p.pos[2] + d[2]],
          cubePos: p.pos.slice(),
        });
      }
    }
    return out;
  }

  /* 六面展开时的面内基向量 */
  var FACE_BASIS = {
    U: { right: [1, 0, 0], down: [0, 0, 1] },
    D: { right: [1, 0, 0], down: [0, 0, -1] },
    F: { right: [1, 0, 0], down: [0, -1, 0] },
    B: { right: [-1, 0, 0], down: [0, -1, 0] },
    R: { right: [0, 0, -1], down: [0, -1, 0] },
    L: { right: [0, 0, 1], down: [0, -1, 0] },
  };
  var FACE_NORMAL = {
    U: [0, 1, 0], D: [0, -1, 0], F: [0, 0, 1], B: [0, 0, -1], R: [1, 0, 0], L: [-1, 0, 0],
  };

  /** 六面展开：{ U:[[9]], D:..., ... } 每面 3x3，索引 [row][col] */
  function faceGrid(state) {
    var grid = {};
    var faces = ['U', 'D', 'F', 'B', 'R', 'L'];
    for (var k = 0; k < faces.length; k++) {
      grid[faces[k]] = [[null, null, null], [null, null, null], [null, null, null]];
    }
    var list = facelets(state);
    for (var i = 0; i < list.length; i++) {
      var fl = list[i];
      for (var f = 0; f < faces.length; f++) {
        var face = faces[f];
        if (!vecEquals(fl.dir, FACE_NORMAL[face])) continue;
        var basis = FACE_BASIS[face];
        var rx = fl.pos[0] * basis.right[0] + fl.pos[1] * basis.right[1] + fl.pos[2] * basis.right[2];
        var ry = fl.pos[0] * basis.down[0] + fl.pos[1] * basis.down[1] + fl.pos[2] * basis.down[2];
        var col = rx + 1, row = ry + 1;
        if (row >= 0 && row < 3 && col >= 0 && col < 3) grid[face][row][col] = fl.color;
      }
    }
    return grid;
  }

  /** 单面中心色 */
  function faceCenter(state, face) {
    var grid = faceGrid(state);
    return grid[face][1][1];
  }

  /* ------------------------------------------------------------------ *
   * 打乱
   * ------------------------------------------------------------------ */
  function randomScramble(length, rng) {
    var rand = rng || Math.random;
    var faces = ['U', 'D', 'L', 'R', 'F', 'B'];
    var out = [];
    var lastFace = '';
    var lastAxis = -1;
    var guard = 0;
    while (out.length < length && guard++ < length * 50) {
      var f = faces[Math.floor(rand() * faces.length)];
      var axis = MOVE_DEFS[f].axis;
      if (f === lastFace) continue;
      if (axis === lastAxis && rand() < 0.8) continue;
      var suffix = rand() < 0.3 ? '2' : (rand() < 0.25 ? "'" : '');
      out.push(f + suffix);
      lastFace = f;
      lastAxis = axis;
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 导出
   * ------------------------------------------------------------------ */
  var Core = {
    COLORS: COLORS,
    FACE_CN: FACE_CN,
    COLOR_FACE: COLOR_FACE,
    FACE_NORMAL: FACE_NORMAL,
    FACE_BASIS: FACE_BASIS,
    MOVE_DEFS: MOVE_DEFS,
    PIECES: PIECES,
    IDENTITY: IDENTITY,
    ROTATIONS: ROTATIONS,
    matMul: matMul,
    matApply: matApply,
    rotMat: rotMat,
    isIdentity: isIdentity,
    matEquals: matEquals,
    vecEquals: vecEquals,
    copyMat: copyMat,
    createState: createState,
    cloneState: cloneState,
    pieceById: pieceById,
    parseMove: parseMove,
    parseSequence: parseSequence,
    compressMoves: compressMoves,
    applyMove: applyMove,
    applyMoveInPlace: applyMoveInPlace,
    rotateLayer: rotateLayer,
    applySequence: applySequence,
    invertMove: invertMove,
    isSolved: isSolved,
    pieceSolved: pieceSolved,
    outwardDirs: outwardDirs,
    facelets: facelets,
    faceGrid: faceGrid,
    faceCenter: faceCenter,
    randomScramble: randomScramble,
  };

  global.RubiksCore = Core;
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
})(typeof globalThis !== 'undefined' ? globalThis : this);
