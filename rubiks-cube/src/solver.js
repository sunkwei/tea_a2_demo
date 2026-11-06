/*!
 * 三阶魔方 · 还原教程求解器（零依赖，纯前端）
 *
 * 两种求解方式：
 *  A. 单块求解（第 1、2 步）：把某个块放到某个位置。
 *     · 准备一批「核心公式」（如 R U R' U'、F U F …）；
 *     · 用单块状态空间（棱块/角块各 24 态）反解出每个公式要求的「就位姿态」；
 *     · 在单块状态图上 BFS 找「找位路径」，把块摆成就位姿态；
 *     · 拼成完整序列，套到整颗魔方上模拟验证：目标达成 + 已完成部分没被破坏。
 *  B. 贪心迭代（第 3~7 步）：从「标准公式库 + 顶层转向」的候选里，
 *     每次挑一个能让当前阶段进度最大的公式，重复直到阶段目标达成。
 *
 * 无论哪种方式，输出的每一步都会用整颗魔方模拟校验，所以提示一定是「对的」。
 */
(function (global) {
  'use strict';

  var C = global.RubiksCore;

  /* ------------------------------------------------------------------ *
   * 基础数据
   * ------------------------------------------------------------------ */
  var QUARTER = ['U', "U'", 'D', "D'", 'L', "L'", 'R', "R'", 'F', "F'", 'B', "B'"];

  var WHITE_EDGES = ['DF', 'DR', 'DB', 'DL'];
  var WHITE_CORNERS = ['DFR', 'DRB', 'DBL', 'DLF'];
  var MID_EDGES = ['FR', 'BR', 'BL', 'FL'];
  var YELLOW_EDGES = ['UF', 'UR', 'UB', 'UL'];
  var YELLOW_CORNERS = ['UFR', 'URB', 'UBL', 'ULF'];

  var COLOR_CN = { W: '白', Y: '黄', G: '绿', B: '蓝', R: '红', O: '橙' };

  /* 标准公式库（每个阶段从中挑） */
  var ALGOS = {
    /* 中层插入：这些公式只动「要插入的那条棱 + 顶层」，不会破坏底层 */
    mid: ["U F' U F U R U' R'", "U F' U' F U R U R'", "U B' U B U L U' L'", "U B' U' B U L U L'",
      "U R' U R U B U' B'", "U R' U' R U B U B'", "U L' U L U F U' F'", "U L' U' L U F U F'",
      "U R U' R'", "U' L' U L", "U F U' F'", "U' B U B'"],
    /* 顶面棱块翻正（黄色朝上） */
    edgeUp: ["F U F'", "F' U' F", "B U B'", "B' U' B", "R' D R", "L D' L'",
      "F R U R' U' F'", "F' U' F U", "R U R' U' F' U F", "U F U' F' U' R' U R"],
    /* 顶面角块翻正 */
    cornerUp: ["R U R' U R U2 R'", "F R U R' U' F'", "F' U' F U", "R' D' R D",
      "F' U F U R U' R'", "L' U' L U' R U R'", "R U R' U' F' U F"],
    /* 顶棱三循环（会打乱顶角，但顶角是下一步的事） */
    edgePerm: ["F R U R' U' F'", "U R U' L' U R' U' L", "R U R' U' F' U F"],
    /* 顶角三循环（顶棱保持不动） */
    cornerPerm: ["U R U' L' U R' U' L", "R U R' U'", "L' U' L U", "R' D' R D"],
    /* 下层槽位插入 / 找位用 */
    edgeHome: ['F U F', 'R U R', 'B U B', 'L U L'],
    cornerHome: ["R U R' U'", "R' U R U'", "L U L' U'", "L' U' L U",
      "F U F' U'", "F' U' F U", "B' U' B U", "B U B' U'",
      "R U' R' U", "L' U L U'", "U R U' R'", "U' L' U L"],
  };

  var U_SETUPS = ['', 'U', "U'", 'U2'];

  /* ------------------------------------------------------------------ *
   * 判定辅助
   * ------------------------------------------------------------------ */
  function homeAll(state, ids) {
    for (var i = 0; i < ids.length; i++) if (!C.pieceSolved(state, ids[i])) return false;
    return true;
  }
  function pieceStateOf(state, id) {
    var p = C.pieceById(state, id);
    if (!p) return null;
    return { pos: p.pos.slice(), rot: p.rot.slice() };
  }
  /** 某块是否在顶面且黄色朝上（位置不限） */
  function pieceYellowUp(ps) {
    if (ps.pos[1] !== 1) return false;
    var d = C.matApply(ps.rot, [0, 1, 0]); // 黄色贴纸的 home 方向是 +Y
    return d[0] === 0 && d[1] === 1 && d[2] === 0;
  }
  function everyPiece(state, ids, fn) {
    for (var i = 0; i < ids.length; i++) {
      var ps = pieceStateOf(state, ids[i]);
      if (!ps || !fn(ps)) return false;
    }
    return true;
  }

  /* ------------------------------------------------------------------ *
   * 单块状态空间
   * ------------------------------------------------------------------ */
  function edgePositions() {
    var out = [];
    for (var x = -1; x <= 1; x++) {
      for (var y = -1; y <= 1; y++) {
        for (var z = -1; z <= 1; z++) {
          var n = (x ? 1 : 0) + (y ? 1 : 0) + (z ? 1 : 0);
          if (n === 2) out.push([x, y, z]);
        }
      }
    }
    return out;
  }
  function cornerPositions() {
    var out = [];
    for (var x = -1; x <= 1; x += 2) {
      for (var y = -1; y <= 1; y += 2) {
        for (var z = -1; z <= 1; z += 2) out.push([x, y, z]);
      }
    }
    return out;
  }
  var EDGE_POS = edgePositions();
  var CORNER_POS = cornerPositions();

  function sameDirSet(a, b) {
    if (a.length !== b.length) return false;
    var used = new Array(b.length).fill(false);
    for (var i = 0; i < a.length; i++) {
      var found = false;
      for (var j = 0; j < b.length; j++) {
        if (used[j]) continue;
        if (a[i][0] === b[j][0] && a[i][1] === b[j][1] && a[i][2] === b[j][2]) {
          used[j] = true; found = true; break;
        }
      }
      if (!found) return false;
    }
    return true;
  }

  /** 某块所有合法的（位置, 朝向）组合 */
  function enumeratePieceStates(piece) {
    var positions = piece.type === 'edge' ? EDGE_POS : CORNER_POS;
    var homeDirs = piece.stickers.map(function (s) { return s.dir; });
    var out = [];
    for (var i = 0; i < positions.length; i++) {
      var outs = C.outwardDirs(positions[i]);
      for (var r = 0; r < C.ROTATIONS.length; r++) {
        var rot = C.ROTATIONS[r];
        var mapped = homeDirs.map(function (d) { return C.matApply(rot, d); });
        if (sameDirSet(mapped, outs)) {
          out.push({ pos: positions[i].slice(), rot: rot.slice() });
        }
      }
    }
    return out;
  }

  function pieceKey(ps) {
    return ps.pos.join(',') + '|' + ps.rot.join(',');
  }

  /** 单块在一步转动后的状态（支持 90/180） */
  function movePiece(ps, moveName) {
    var m = C.parseMove(moveName);
    if (!m) return ps;
    var pos = ps.pos.slice();
    var rot = ps.rot.slice();
    if (m.layer === null || pos[m.axis] === m.layer) {
      for (var q = 0; q < m.quarters; q++) {
        var mat = C.rotMat(m.axis, m.dir);
        pos = C.matApply(mat, pos);
        rot = C.matMul(mat, rot);
      }
    }
    return { pos: pos, rot: rot };
  }

  /** 核心公式反解：算出「块必须先摆成什么样」 */
  function invertPiece(core, goal) {
    var st = { pos: goal.pos.slice(), rot: goal.rot.slice() };
    for (var i = core.length - 1; i >= 0; i--) {
      st = movePiece(st, C.invertMove(core[i]));
    }
    return st;
  }

  function samePath(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /** 单块状态图 BFS，记录到每个状态的若干候选路径 */
  function piecePaths(piece, start, maxLen, keep) {
    var valid = new Set();
    var all = enumeratePieceStates(piece);
    for (var i = 0; i < all.length; i++) valid.add(pieceKey(all[i]));

    var map = new Map();
    var states = new Map();
    var k0 = pieceKey(start);
    map.set(k0, { dist: 0, paths: [[]] });
    states.set(k0, start);
    var frontier = [k0];
    var ORDER = ['U', "U'", 'L', "L'", 'R', "R'", 'F', "F'", 'B', "B'", 'D', "D'"];
    for (var d = 0; d < maxLen && frontier.length; d++) {
      var nextKeys = [];
      for (var f = 0; f < frontier.length; f++) {
        var k = frontier[f];
        var cur = states.get(k);
        var e = map.get(k);
        for (var m = 0; m < ORDER.length; m++) {
          var nst = movePiece(cur, ORDER[m]);
          var nk = pieceKey(nst);
          if (!valid.has(nk)) continue;
          var ne = map.get(nk);
          if (!ne) {
            ne = { dist: d + 1, paths: [] };
            map.set(nk, ne);
            states.set(nk, nst);
            nextKeys.push(nk);
          }
          if (ne.paths.length >= keep) continue;
          for (var p = 0; p < e.paths.length && ne.paths.length < keep; p++) {
            var np = e.paths[p].concat(ORDER[m]);
            var dup = false;
            for (var q = 0; q < ne.paths.length; q++) if (samePath(ne.paths[q], np)) { dup = true; break; }
            if (!dup) ne.paths.push(np);
          }
        }
      }
      frontier = nextKeys;
    }
    return map;
  }

  /* ------------------------------------------------------------------ *
   * 阶段定义（教程 7 步）
   * ------------------------------------------------------------------ */
  var STAGES = [
    {
      id: 'cross',
      title: '第 1 步 · 白色十字',
      brief: '4 个白色棱块归位，白色朝下',
      detail: '棱块是只有两个颜色的小块。目标是让「白-绿 / 白-红 / 白-蓝 / 白-橙」' +
        '四个棱块回到下层，白色面朝下，四个方向各一个，中间连成一个十字。',
      mode: 'piece',
      goal: function (s) { return homeAll(s, WHITE_EDGES); },
      tasks: WHITE_EDGES.slice(),
      pieceGoal: function (ps, id, home) {
        return C.vecEquals(ps.pos, home) && C.isIdentity(ps.rot);
      },
      preserve: function (s, done) { return homeAll(s, done); },
      core: 'edgeHome',
    },
    {
      id: 'corners1',
      title: '第 2 步 · 白色角块',
      brief: '4 个白色角块插进下层，白色朝下',
      detail: '角块是三个颜色的小块。把带白色的四个角块放回下层四个角上，白色面朝下、' +
        '另外两个颜色和中心对得上，同时别破坏已经做好的十字。',
      mode: 'greedy',
      goal: function (s) { return homeAll(s, WHITE_EDGES) && homeAll(s, WHITE_CORNERS); },
      preserve: function (s) { return homeAll(s, WHITE_EDGES); },
      progress: function (s) {
        var n = 0;
        for (var i = 0; i < WHITE_CORNERS.length; i++) if (C.pieceSolved(s, WHITE_CORNERS[i])) n++;
        return n;
      },
      candidates: function () {
        // 「把角块从下层捞到顶层」的手法（只影响该角块所在的槽位）
        var lifts = ["F R' F' R", "R' F R F'", "L' B L B'", "B R' B' R",
          "R' B R B'", "B' R B R'", "L' F L F'", "F' L' F L"];
        // 「把角块插进下层角位」的公式
        var inserts = ["R U R' U'", "R' U R U'", "L U L' U'", "L' U' L U",
          "F U F' U'", "F' U' F U", "B U B' U'", "B' U' B U"];
        var out = [];
        for (var i = 0; i < lifts.length; i++) {
          var lift = C.parseSequence(lifts[i]);
          if (!lift) continue;
          for (var j = 0; j < inserts.length; j++) {
            var ins = C.parseSequence(inserts[j]);
            if (!ins) continue;
            for (var u = 0; u < U_SETUPS.length; u++) {
              var setup = U_SETUPS[u] ? C.parseSequence(U_SETUPS[u]) : [];
              out.push(setup.concat(lift).concat(ins));
            }
          }
        }
        return out;
      },
      maxIter: 6,
    },
    {
      id: 'middle',
      title: '第 3 步 · 中层棱块',
      brief: '4 个中层棱块插进中间层',
      detail: '中层四个棱块（绿-红 / 蓝-红 / 蓝-橙 / 绿-橙）依次插进中层对应位置。' +
        '常用手法是「上-转-插-转回」，插入时不要把下层弄乱。',
      mode: 'piece',
      goal: function (s) {
        return homeAll(s, WHITE_EDGES) && homeAll(s, WHITE_CORNERS) && homeAll(s, MID_EDGES);
      },
      tasks: MID_EDGES.slice(),
      pieceGoal: function (ps, id, home) {
        return C.vecEquals(ps.pos, home) && C.isIdentity(ps.rot);
      },
      preserve: function (s, done) {
        return homeAll(s, done.concat(WHITE_EDGES));
      },
      core: 'mid',
      repair: [{ ids: WHITE_CORNERS, core: 'cornerHome' }],
      repairPreserve: function (s, done) {
        return homeAll(s, done.concat(WHITE_EDGES).concat(MID_EDGES));
      },
      candidates: function () {
        var lifts = ["F R' F' R", "R' F R F'", "L' B L B'", "B R' B' R",
          "R' B R B'", "B' R B R'", "L' F L F'", "F' L' F L",
          "U F' U F", "U' F U' F'", "U R U' R'", "U' R' U R"];
        var inserts = ["U R U' R'", "U' L' U L", "U F U' F'", "U' B U B'",
          "R U R' U'", "L' U' L U", "U R U' R' U' F' U F", "U' L' U L U F U' F'"];
        var out = [];
        for (var i = 0; i < lifts.length; i++) {
          var lift = C.parseSequence(lifts[i]);
          if (!lift) continue;
          for (var j = 0; j < inserts.length; j++) {
            var ins = C.parseSequence(inserts[j]);
            if (!ins) continue;
            for (var u = 0; u < U_SETUPS.length; u++) {
              var setup = U_SETUPS[u] ? C.parseSequence(U_SETUPS[u]) : [];
              out.push(setup.concat(lift).concat(ins));
            }
          }
        }
        return out;
      },
      maxIter: 6,
    },
    {
      id: 'yellowCross',
      title: '第 4 步 · 黄色十字',
      brief: '顶面 4 个黄色棱块黄色朝上，连成十字',
      detail: '把顶面四个棱块的黄色都翻到朝上，连成一个十字。' +
        '此时十字的朝向可能和你手里的魔方不一致，先做出十字就行。',
      mode: 'greedy',
      goal: function (s) {
        return homeAll(s, WHITE_EDGES) && homeAll(s, WHITE_CORNERS) && homeAll(s, MID_EDGES) &&
          everyPiece(s, YELLOW_EDGES, pieceYellowUp);
      },
      preserve: function (s) {
        return homeAll(s, WHITE_EDGES) && homeAll(s, WHITE_CORNERS) && homeAll(s, MID_EDGES);
      },
      progress: function (s) {
        var n = 0;
        for (var i = 0; i < YELLOW_EDGES.length; i++) if (pieceYellowUp(pieceStateOf(s, YELLOW_EDGES[i]))) n++;
        return n;
      },
      algos: 'edgeUp',
      maxIter: 10,
    },
    {
      id: 'yellowFace',
      title: '第 5 步 · 黄色面',
      brief: '顶面 4 个角块黄色朝上，顶面全黄',
      detail: '顶面还差四个角块。逐个把角块的黄色翻到朝上，四个角都翻好后顶面就是全黄了。',
      mode: 'greedy',
      goal: function (s) {
        return homeAll(s, WHITE_EDGES) && homeAll(s, WHITE_CORNERS) && homeAll(s, MID_EDGES) &&
          everyPiece(s, YELLOW_EDGES, pieceYellowUp) && everyPiece(s, YELLOW_CORNERS, pieceYellowUp);
      },
      preserve: function (s) {
        return homeAll(s, WHITE_EDGES) && homeAll(s, WHITE_CORNERS) && homeAll(s, MID_EDGES) &&
          everyPiece(s, YELLOW_EDGES, pieceYellowUp);
      },
      progress: function (s) {
        var n = 0;
        for (var i = 0; i < YELLOW_CORNERS.length; i++) if (pieceYellowUp(pieceStateOf(s, YELLOW_CORNERS[i]))) n++;
        return n;
      },
      algos: 'cornerUp',
      maxIter: 10,
    },
    {
      id: 'topEdges',
      title: '第 6 步 · 顶棱归位',
      brief: '4 个黄色棱块换到正确的棱位',
      detail: '顶面已经全黄，棱块的位置可能不对。用公式把棱块换到正确的棱位，' +
        '这一动的公式会顺带打乱顶角，别担心，下一步再换回来。',
      mode: 'greedy',
      goal: function (s) {
        return homeAll(s, WHITE_EDGES) && homeAll(s, WHITE_CORNERS) && homeAll(s, MID_EDGES) &&
          everyPiece(s, YELLOW_EDGES, pieceYellowUp) && homeAll(s, YELLOW_EDGES);
      },
      preserve: function (s) {
        return homeAll(s, WHITE_EDGES) && homeAll(s, WHITE_CORNERS) && homeAll(s, MID_EDGES) &&
          everyPiece(s, YELLOW_EDGES, pieceYellowUp) &&
          everyPiece(s, YELLOW_CORNERS, pieceYellowUp);
      },
      progress: function (s) {
        var n = 0;
        for (var i = 0; i < YELLOW_EDGES.length; i++) if (C.pieceSolved(s, YELLOW_EDGES[i])) n++;
        return n;
      },
      algos: 'edgePerm',
      maxIter: 10,
    },
    {
      id: 'topCorners',
      title: '第 7 步 · 顶角归位',
      brief: '4 个黄色角块换到正确的角位，大功告成',
      detail: '最后一步：把顶面四个角块换到正确的角上，换完整个魔方就还原了。',
      mode: 'greedy',
      goal: function (s) { return C.isSolved(s); },
      preserve: function (s) {
        return homeAll(s, WHITE_EDGES) && homeAll(s, WHITE_CORNERS) && homeAll(s, MID_EDGES) &&
          everyPiece(s, YELLOW_EDGES, pieceYellowUp) && homeAll(s, YELLOW_EDGES);
      },
      progress: function (s) {
        var n = 0;
        for (var i = 0; i < YELLOW_CORNERS.length; i++) if (C.pieceSolved(s, YELLOW_CORNERS[i])) n++;
        return n;
      },
      algos: 'cornerPerm',
      maxIter: 10,
    },
  ];

  /**
   * 生成「找位候选」：用交换子 [A,B] = A B A' B' 结构。
   * 交换子只影响 A 层与 B 层的交集，天然不会把底层的其它棱块弄乱，
   * 很适合「把块从底层捞到顶层 / 摆正」这类准备动作。
   */
  function buildSetupCandidates() {
    var MOVES = ['U', "U'", 'D', "D'", 'L', "L'", 'R', "R'", 'F', "F'", 'B', "B'"];
    var seen = new Set();
    var out = [];
    function push(seq) {
      var k = seq.join(' ');
      if (seen.has(k)) return;
      seen.add(k);
      out.push(seq);
    }
    for (var a = 0; a < MOVES.length; a++) {
      for (var b = 0; b < MOVES.length; b++) {
        var A = MOVES[a], B = MOVES[b];
        var Ai = C.invertMove(A), Bi = C.invertMove(B);
        push([A, B]);
        push([A, B, Ai]);
        push([A, B, Ai, Bi]);
        for (var u = 0; u < 3; u++) {
          var U = ['U', "U'", 'U2'][u];
          push([U, A, B, Ai, Bi]);
          push([A, B, Ai, Bi, U]);
          push([U, A, B, Ai]);
          push([A, B, Ai, U]);
          push([U, A, B]);
          push([A, U, B]);
          push([A, B, U]);
          push([U, A, B, Bi]);
          push([A, B, Bi, U]);
          push([A, B, Ai, Bi, U, A]);
        }
      }
    }
    out.sort(function (x, y) { return x.length - y.length; });
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 单块求解
   * ------------------------------------------------------------------ */
  function solvePieceTask(state, pieceId, pieceGoal, preserveTest, coreKey, opts) {
    opts = opts || {};
    var piece = C.pieceById(state, pieceId);
    if (!piece) return null;
    var start = { pos: piece.pos.slice(), rot: piece.rot.slice() };
    if (pieceGoal(start)) return { moves: [], pieceId: pieceId };

    var all = enumeratePieceStates(piece);
    var goals = all.filter(pieceGoal);
    if (!goals.length) return null;

    var cores = (ALGOS[coreKey] || []).slice();
    var paths = piecePaths(piece, start, opts.maxSetup || 8, opts.keep || 120);
    var pool = buildSetupCandidates();
    var poolStates = pool.map(function (seq) {
      var st = start;
      for (var si = 0; si < seq.length; si++) st = movePiece(st, seq[si]);
      return st;
    });
    var best = null;

    function damage(after) {
      var n = 0;
      for (var i = 0; i < state.pieces.length; i++) {
        if (state.pieces[i].id === pieceId) continue;
        if (!C.pieceSolved(after, state.pieces[i].id)) n++;
      }
      return n;
    }
    function consider(seq) {
      var after = C.applySequence(state, seq);
      var ps = pieceStateOf(after, pieceId);
      if (!ps || !pieceGoal(ps)) return;
      var score;
      if (opts.loose) {
        score = damage(after) * 100 + seq.length;
      } else {
        if (preserveTest && !preserveTest(after)) return;
        score = seq.length;
      }
      if (!best || score < best.score) best = { score: score, seq: seq };
    }

    for (var ci = 0; ci < cores.length; ci++) {
      var core = C.parseSequence(cores[ci]);
      if (!core) continue;
      for (var gi = 0; gi < goals.length; gi++) {
        var ready = invertPiece(core, goals[gi]);
        // (1) 交换子找位
        for (var pi = 0; pi < pool.length; pi++) {
          var pst = poolStates[pi];
          if (!C.vecEquals(pst.pos, ready.pos) || !C.matEquals(pst.rot, ready.rot)) continue;
          consider(pool[pi].concat(core));
        }
        // (2) 单块 BFS 找位
        var entry = paths.get(pieceKey(ready));
        if (!entry) continue;
        for (var pi2 = 0; pi2 < entry.paths.length; pi2++) {
          consider(entry.paths[pi2].concat(core));
        }
      }
    }
    if (best) return { moves: C.compressMoves(best.seq), pieceId: pieceId, source: 'core' };
    return null;
  }

  /* ------------------------------------------------------------------ *
   * 贪心迭代（标准公式库）
   * ------------------------------------------------------------------ */
  function solveGreedy(state, stage) {
    var cands = [];
    if (stage.candidates) {
      cands = stage.candidates();
    } else {
      var algos = (ALGOS[stage.algos] || []).slice();
      for (var i = 0; i < algos.length; i++) {
        var base = C.parseSequence(algos[i]);
        if (!base) continue;
        for (var u = 0; u < U_SETUPS.length; u++) {
          var setup = U_SETUPS[u] ? C.parseSequence(U_SETUPS[u]) : [];
          cands.push(setup.concat(base));
        }
      }
    }
    var cur = C.cloneState(state);
    var moves = [];
    for (var it = 0; it < (stage.maxIter || 8); it++) {
      if (stage.goal(cur)) break;
      var baseScore = stage.progress(cur);
      var best = null;
      for (var c = 0; c < cands.length; c++) {
        var after = C.applySequence(cur, cands[c]);
        if (stage.preserve && !stage.preserve(after)) continue;
        var sc = stage.progress(after);
        if (sc > baseScore && (!best || sc > best.score || (sc === best.score && cands[c].length < best.seq.length))) {
          best = { score: sc, seq: cands[c] };
        }
      }
      if (!best) break;
      cur = C.applySequence(cur, best.seq);
      moves = moves.concat(best.seq);
    }
    if (!stage.goal(cur)) return null;
    return { moves: C.compressMoves(moves) };
  }

  /* ------------------------------------------------------------------ *
   * 阶段计划
   * ------------------------------------------------------------------ */
  function detectStage(state) {
    for (var i = 0; i < STAGES.length; i++) {
      if (!STAGES[i].goal(state)) return i;
    }
    return STAGES.length - 1;
  }

  function stageStatus(state) {
    return STAGES.map(function (st) { return !!st.goal(state); });
  }

  /** 把一个阶段拆成「小任务」列表：每项 {pieceId, moves, text} */
  function planStage(state, stageIndex, opts) {
    opts = opts || {};
    var stage = STAGES[stageIndex];
    if (!stage) return [];

    if (stage.mode === 'greedy') {
      var res = solveGreedy(state, stage);
      if (!res) {
        return [{
          pieceId: null, moves: null, failed: true, complete: false,
          text: '这一步暂时算不出公式，请按上面的说明手动完成',
        }];
      }
      var after = C.applySequence(state, res.moves);
      return [{
        pieceId: null,
        moves: res.moves,
        text: stage.brief,
        source: 'greedy',
        complete: stage.goal(after),
      }];
    }

    var work = C.cloneState(state);
    var done = [];
    var tasks = [];
    for (var i = 0; i < stage.tasks.length; i++) {
      var id = stage.tasks[i];
      var ps = pieceStateOf(work, id);
      if (!ps) continue;
      var home = C.pieceById(work, id).home.slice();
      if (stage.pieceGoal(ps, id, home)) { done.push(id); continue; }

      var goalFn = (function (h) {
        return function (s) { return stage.pieceGoal(s, id, h); };
      })(home);

      var res2 = solvePieceTask(work, id, goalFn,
        function (s) { return stage.preserve(s, done); },
        stage.core, opts);
      var loose = false;
      if (!res2) {
        // 退一步：允许打乱已完成的部分，挑一个扰动最小的解（最后统一校验阶段目标）
        res2 = solvePieceTask(work, id, goalFn, null, stage.core,
          Object.assign({}, opts, { loose: true }));
        loose = !!res2;
      }

      var text = describeTask(work, stage, id);
      if (!res2) {
        tasks.push({ pieceId: id, moves: null, text: text, failed: true });
        break;
      }
      work = C.applySequence(work, res2.moves);
      done.push(id);
      tasks.push({ pieceId: id, moves: res2.moves, text: text, source: loose ? 'loose' : res2.source });
    }

    // 汇总：这一组公式是否真的把阶段目标做出来了
    var complete = stage.goal(work);

    // 补救：若阶段目标还没达成，把被带偏的块修回去
    if (!stage.goal(work) && stage.repair) {
      for (var ri = 0; ri < stage.repair.length; ri++) {
        var rp = stage.repair[ri];
        var rdone = [];
        for (var rj = 0; rj < rp.ids.length; rj++) {
          var rid = rp.ids[rj];
          var rps = pieceStateOf(work, rid);
          if (!rps) continue;
          var rhome = C.pieceById(work, rid).home.slice();
          if (stage.pieceGoal(rps, rid, rhome)) { rdone.push(rid); continue; }
          var rgoal = (function (h) {
            return function (s) { return stage.pieceGoal(s, rid, h); };
          })(rhome);
          var rres = solvePieceTask(work, rid, rgoal,
            function (s) {
              return stage.repairPreserve ? stage.repairPreserve(s, rdone) : stage.preserve(s, rdone);
            },
            rp.core, opts);
          if (!rres) {
            rres = solvePieceTask(work, rid, rgoal, null, rp.core, opts);
          }
          if (!rres) { rdone = null; break; }
          work = C.applySequence(work, rres.moves);
          rdone.push(rid);
          tasks.push({ pieceId: rid, moves: rres.moves, text: describeTask(work, stage, rid), source: 'repair' });
        }
        if (rdone && stage.goal(work)) break;
      }
      complete = stage.goal(work);
    }
    for (var ti = 0; ti < tasks.length; ti++) tasks[ti].complete = complete;
    return tasks;
  }

  /* ------------------------------------------------------------------ *
   * 文案
   * ------------------------------------------------------------------ */
  function pieceLabel(state, id) {
    var p = C.pieceById(state, id);
    if (!p) return id;
    var colors = p.stickers.map(function (s) { return COLOR_CN[s.color]; });
    var type = p.type === 'corner' ? '角块' : (p.type === 'edge' ? '棱块' : '中心');
    return colors.join('-') + type;
  }

  function posLabel(pos) {
    var parts = [];
    if (pos[1] === 1) parts.push('上');
    if (pos[1] === -1) parts.push('下');
    if (pos[2] === 1) parts.push('前');
    if (pos[2] === -1) parts.push('后');
    if (pos[0] === 1) parts.push('右');
    if (pos[0] === -1) parts.push('左');
    return parts.join('·');
  }

  function describeTask(state, stage, id) {
    var label = pieceLabel(state, id);
    var p = C.pieceById(state, id);
    return '把「' + label + '」放到 ' + posLabel(p.home) + ' 的位置';
  }

  function moveLabel(move) {
    var m = C.parseMove(move);
    if (!m) return move;
    var faceName = {
      U: '上面', D: '下面', F: '前面', B: '后面', R: '右面', L: '左面',
      M: '中间竖层', E: '中间横层', S: '中间纵层',
    }[m.face] || m.face;
    if (m.face === 'M' || m.face === 'E' || m.face === 'S') {
      return faceName + '转 ' + (m.quarters === 2 ? '180°' : '90°');
    }
    if (m.quarters === 3) return faceName + '逆时针转 90°';
    if (m.quarters === 2) return faceName + '转 180°';
    return faceName + '顺时针转 90°';
  }

  /* ------------------------------------------------------------------ *
   * 导出
   * ------------------------------------------------------------------ */
  var Solver = {
    STAGES: STAGES,
    ALGOS: ALGOS,
    WHITE_EDGES: WHITE_EDGES,
    WHITE_CORNERS: WHITE_CORNERS,
    MID_EDGES: MID_EDGES,
    YELLOW_EDGES: YELLOW_EDGES,
    YELLOW_CORNERS: YELLOW_CORNERS,
    detectStage: detectStage,
    stageStatus: stageStatus,
    planStage: planStage,
    solveGreedy: solveGreedy,
    pieceLabel: pieceLabel,
    posLabel: posLabel,
    moveLabel: moveLabel,
    enumeratePieceStates: enumeratePieceStates,
  };

  global.RubiksSolver = Solver;
  if (typeof module !== 'undefined' && module.exports) module.exports = Solver;
})(typeof globalThis !== 'undefined' ? globalThis : this);
