/* ==========================================================================
 * 琴房 · piano-view.js —— Canvas 视图层
 *
 *  · 键盘：88 键横向视窗（可滚动 / 缩放），白键黑键、标签、提示高亮、按下态
 *  · 瀑布流：跟弹模式下音符从上方落下，横向与琴键严格对齐
 *  · 小地图：整副 88 键缩略图 + 当前视窗 + 曲目音域，可点可拖
 *  · 多点触摸：Pointer Events，每个 pointerId 独立跟踪，滑键（glissando）自动换音
 * ========================================================================== */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PianoView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var Core = root.PianoCore;

  var PALETTE = {
    felt: '#2a1f24',
    feltEdge: '#4a3a40',
    whiteTop: '#fbfaf7',
    whiteBottom: '#dedad0',
    whiteEdge: '#9a948a',
    blackTop: '#33343c',
    blackBottom: '#121216',
    blackEdge: '#050508',
    label: '#6d6a63',
    labelC: '#3f3d38',
    press: '#ffcf6b',
    pressEdge: '#d99a2b',
    hintTarget: '#7ee0c8',
    hintChord: '#9ec1ff',
    hintScale: '#ffd479',
    hintError: '#ff7a7a',
    stageBg: '#12131a',
    grid: 'rgba(255,255,255,.05)',
    gridBar: 'rgba(255,255,255,.13)',
    hitLine: 'rgba(255,255,255,.28)',
    rightHand: '#ffc247',
    leftHand: '#5ec8f0',
    hitFlash: '#8affc1',
    miss: '#ff6b6b'
  };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* ------------------------------------------------------------- 模块 */

  var View = {
    keys: null, stage: null, mini: null,
    kctx: null, sctx: null, mctx: null,
    layout: null,
    width: 0, height: 0, dpr: 1,
    stageOffsetX: 0,          // 舞台画布相对琴键画布的横向偏移（像素）
    startWhite: 0, whiteCount: 24,
    labelStyle: 'name',
    pressed: {},          // midi -> true
    hints: {},           // midi -> kind
    pointers: {},        // pointerId -> midi
    keyOwners: {},       // midi -> [pointerId]
    onNoteOn: null, onNoteOff: null, onViewport: null,
    songRange: null,
    mode: 'free',
    keysDirty: true,
    stageDirty: true,
    miniDirty: true
  };

  /* --------------------------------------------------------- 尺寸管理 */

  function fitCanvas(canvas, ctx) {
    var rect = canvas.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    var w = Math.max(1, Math.round(rect.width));
    var h = Math.max(1, Math.round(rect.height));
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w: w, h: h };
  }

  View.init = function (opts) {
    View.keys = opts.keys;
    View.stage = opts.stage;
    View.mini = opts.mini;
    View.kctx = View.keys.getContext('2d');
    View.sctx = View.stage.getContext('2d');
    View.mctx = View.mini.getContext('2d');
    View.onNoteOn = opts.onNoteOn || null;
    View.onNoteOff = opts.onNoteOff || null;
    View.onViewport = opts.onViewport || null;

    bindPointer(View.keys, 'keys');
    bindPointer(View.mini, 'mini');

    var ro = window.ResizeObserver ? new ResizeObserver(function () {
      View.resize();
    }) : null;
    if (ro) {
      ro.observe(View.keys);
      ro.observe(View.stage);
      ro.observe(View.mini);
    } else {
      window.addEventListener('resize', View.resize);
    }
    View.resize();
    return View;
  };

  View.resize = function () {
    var k = fitCanvas(View.keys, View.kctx);
    View.width = k.w;
    View.height = k.h;
    var s = fitCanvas(View.stage, View.sctx);
    View.stageW = s.w;
    View.stageH = s.h;
    var m = fitCanvas(View.mini, View.mctx);
    View.miniW = m.w;
    View.miniH = m.h;

    /* 瀑布流的音符必须和琴键逐像素对齐。
       .stage 与 .keys 使用同样的左右内边距，两块画布等宽同起点，
       这里再兜一层位移修正，防止以后改样式时错位。 */
    var kr = View.keys.getBoundingClientRect();
    var sr = View.stage.getBoundingClientRect();
    View.stageOffsetX = kr.left - sr.left;

    View.recompute();
    View.keysDirty = View.stageDirty = View.miniDirty = true;
  };

  View.recompute = function () {
    View.layout = Core.layoutKeyboard({
      width: View.width,
      height: View.height,
      whiteCount: View.whiteCount,
      startWhite: View.startWhite
    });
  };

  /* --------------------------------------------------------- 视窗控制 */

  View.setViewport = function (startWhite, whiteCount) {
    var all = Core.allWhiteKeys();
    if (whiteCount != null) {
      View.whiteCount = clamp(Math.round(whiteCount), 7, all.length);
    }
    View.startWhite = clamp(Math.round(startWhite), 0, all.length - View.whiteCount);
    View.recompute();
    View.keysDirty = View.miniDirty = View.stageDirty = true;
    if (View.onViewport) {
      View.onViewport({
        startWhite: View.startWhite,
        whiteCount: View.whiteCount,
        lowMidi: View.layout.lowMidi,
        highMidi: View.layout.highMidi,
        label: Core.rangeLabel(View.layout)
      });
    }
  };

  View.scrollBy = function (deltaWhite) {
    View.setViewport(View.startWhite + deltaWhite, View.whiteCount);
  };

  View.zoom = function (delta) {
    var target = clamp(View.whiteCount + delta, 7, Core.allWhiteKeys().length);
    var center = View.startWhite + View.whiteCount / 2;
    var start = clamp(Math.round(center - target / 2), 0, Core.allWhiteKeys().length - target);
    View.setViewport(start, target);
  };

  View.fitRange = function (lowMidi, highMidi) {
    var f = Core.fitRange(lowMidi, highMidi, Core.allWhiteKeys().length);
    View.setViewport(f.startWhite, f.whiteCount);
  };

  /** 把某个 midi 滚进当前视窗（已在视窗内则不动） */
  View.revealMidi = function (midi) {
    var all = Core.allWhiteKeys();
    var wi = -1, i;
    for (i = 0; i < all.length; i++) { if (all[i] >= midi) { wi = i; break; } }
    if (wi < 0) wi = all.length - 1;
    if (wi >= View.startWhite && wi < View.startWhite + View.whiteCount) return false;
    View.setViewport(wi - Math.floor(View.whiteCount / 2), View.whiteCount);
    return true;
  };

  View.setSongRange = function (lowMidi, highMidi) {
    View.songRange = (lowMidi == null) ? null : { low: lowMidi, high: highMidi };
    View.miniDirty = true;
  };

  View.setLabelStyle = function (style) {
    View.labelStyle = style || 'name';
    View.keysDirty = true;
  };

  View.setMode = function (mode) {
    View.mode = mode;
    View.stageDirty = true;
  };

  View.setPressed = function (midi, on) {
    if (on) {
      if (View.pressed[midi]) return;
      View.pressed[midi] = true;
    } else {
      if (!View.pressed[midi]) return;
      delete View.pressed[midi];
    }
    View.keysDirty = true;
  };

  View.clearPressed = function () {
    View.pressed = {};
    View.keysDirty = true;
  };

  View.setHints = function (map) {
    View.hints = map || {};
    View.keysDirty = true;
  };

  View.clearHints = function () {
    View.hints = {};
    View.keysDirty = true;
  };

  /* ------------------------------------------------------- 命中与指针 */

  View.hitTest = function (x, y) {
    return Core.hitTestKey(View.layout, x, y);
  };

  function localPos(canvas, e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function bindPointer(canvas, which) {
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
      var p = localPos(canvas, e);
      if (which === 'keys') {
        var midi = View.hitTest(p.x, p.y);
        if (midi == null) return;
        e.preventDefault();
        View.pointers[e.pointerId] = midi;
        (View.keyOwners[midi] = View.keyOwners[midi] || []).push(e.pointerId);
        View.setPressed(midi, true);
        if (View.onNoteOn) View.onNoteOn(midi, velocityFrom(e, p), 'pointer');
      } else {
        View.miniDrag = { x: p.x, start: View.startWhite };
        e.preventDefault();
        jumpMini(p.x);
      }
    });

    canvas.addEventListener('pointermove', function (e) {
      var p = localPos(canvas, e);
      if (which === 'keys') {
        var cur = View.pointers[e.pointerId];
        if (cur == null) return;
        e.preventDefault();
        var midi = View.hitTest(p.x, p.y);
        if (midi !== cur) {
          /* 滑键：抬起旧键、按下新键 */
          releasePointer(e.pointerId, cur);
          if (midi != null) {
            View.pointers[e.pointerId] = midi;
            (View.keyOwners[midi] = View.keyOwners[midi] || []).push(e.pointerId);
            View.setPressed(midi, true);
            if (View.onNoteOn) View.onNoteOn(midi, velocityFrom(e, p), 'pointer');
          }
        }
      } else if (View.miniDrag) {
        e.preventDefault();
        var per = View.miniW / Core.allWhiteKeys().length;
        var delta = Math.round((p.x - View.miniDrag.x) / per);
        View.setViewport(View.miniDrag.start + delta, View.whiteCount);
      }
    });

    function up(e) {
      if (which === 'keys') {
        var cur = View.pointers[e.pointerId];
        if (cur == null) return;
        releasePointer(e.pointerId, cur);
      } else {
        View.miniDrag = null;
      }
    }
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('lostpointercapture', up);
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  function releasePointer(pointerId, midi) {
    delete View.pointers[pointerId];
    var owners = View.keyOwners[midi];
    if (owners) {
      var i = owners.indexOf(pointerId);
      if (i >= 0) owners.splice(i, 1);
      if (!owners.length) {
        delete View.keyOwners[midi];
        View.setPressed(midi, false);
        if (View.onNoteOff) View.onNoteOff(midi, 'pointer');
      }
    }
  }

  function velocityFrom(e, p) {
    if (e.pointerType === 'pen' && e.pressure > 0) {
      return clamp(0.35 + e.pressure * 0.65, 0.1, 1);
    }
    if (e.pointerType === 'touch' && e.pressure > 0 && Math.abs(e.pressure - 0.5) > 0.01) {
      return clamp(0.35 + e.pressure * 0.65, 0.1, 1);
    }
    /* 触屏没有压力：越靠近琴键前端（下方）越响，模拟杠杆 */
    if (View.layout && View.height > 0) {
      var depth = clamp(p.y / View.height, 0, 1);
      return clamp(0.62 + depth * 0.3, 0.2, 1);
    }
    return 0.8;
  }

  function jumpMini(x) {
    var per = View.miniW / Core.allWhiteKeys().length;
    var idx = clamp(Math.floor(x / per), 0, Core.allWhiteKeys().length - 1);
    View.setViewport(idx - Math.floor(View.whiteCount / 2), View.whiteCount);
  }

  /* --------------------------------------------------------- 键盘绘制 */

  function roundRect(ctx, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.closePath();
  }

  View.drawKeys = function () {
    var ctx = View.kctx;
    var L = View.layout;
    if (!ctx || !L) return;
    var w = View.width, h = View.height;

    ctx.clearRect(0, 0, w, h);

    /* 琴床上方的毛毡 */
    var felt = ctx.createLinearGradient(0, 0, 0, 14);
    felt.addColorStop(0, PALETTE.feltEdge);
    felt.addColorStop(1, PALETTE.felt);
    ctx.fillStyle = felt;
    ctx.fillRect(0, 0, w, 14);
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.fillRect(0, 13, w, 1);

    var pressedSet = View.pressed;
    var hints = View.hints;

    /* 白键 */
    L.whites.forEach(function (k) {
      var isC = Core.pc(k.midi) === 0;
      var g = ctx.createLinearGradient(0, 0, 0, h);
      if (pressedSet[k.midi]) {
        g.addColorStop(0, '#ffe9b0');
        g.addColorStop(1, PALETTE.press);
      } else {
        g.addColorStop(0, PALETTE.whiteTop);
        g.addColorStop(1, PALETTE.whiteBottom);
      }
      roundRect(ctx, k.x + 0.5, 14, k.w - 1, h - 14, 5);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = pressedSet[k.midi] ? PALETTE.pressEdge : PALETTE.whiteEdge;
      ctx.lineWidth = 1;
      ctx.stroke();

      /* 底部阴影，做出立体感 */
      var sh = ctx.createLinearGradient(0, h - 12, 0, h);
      sh.addColorStop(0, 'rgba(0,0,0,0)');
      sh.addColorStop(1, 'rgba(0,0,0,.16)');
      ctx.fillStyle = sh;
      ctx.fillRect(k.x + 1, h - 12, k.w - 2, 11);

      var hint = hints[k.midi];
      if (hint) {
        ctx.save();
        roundRect(ctx, k.x + 0.5, 14, k.w - 1, h - 14, 5);
        ctx.clip();
        ctx.fillStyle = hintColor(hint, 0.28);
        ctx.fillRect(k.x, 14, k.w, h - 14);
        ctx.restore();
      }
    });

    /* 黑键 */
    L.blacks.forEach(function (k) {
      var g = ctx.createLinearGradient(0, 0, 0, L.blackH);
      if (pressedSet[k.midi]) {
        g.addColorStop(0, '#8a7a55');
        g.addColorStop(1, PALETTE.press);
      } else {
        g.addColorStop(0, PALETTE.blackTop);
        g.addColorStop(1, PALETTE.blackBottom);
      }
      roundRect(ctx, k.x, 14, k.w, L.blackH - 12, 4);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = pressedSet[k.midi] ? PALETTE.pressEdge : PALETTE.blackEdge;
      ctx.stroke();

      var hint = hints[k.midi];
      if (hint) {
        ctx.save();
        roundRect(ctx, k.x, 14, k.w, L.blackH - 12, 4);
        ctx.clip();
        ctx.fillStyle = hintColor(hint, 0.42);
        ctx.fillRect(k.x, 14, k.w, L.blackH);
        ctx.restore();
      }
    });

    /* 标签 */
    if (View.labelStyle !== 'none') {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      L.whites.forEach(function (k) {
        var isC = Core.pc(k.midi) === 0;
        var txt = Core.noteLabel(k.midi, View.labelStyle);
        if (!txt) return;
        ctx.font = (isC ? '600 12px ui-sans-serif,system-ui,"Segoe UI",sans-serif'
                        : '400 11px ui-sans-serif,system-ui,"Segoe UI",sans-serif');
        ctx.fillStyle = pressedSet[k.midi] ? '#6a4a12' : (isC ? PALETTE.labelC : PALETTE.label);
        ctx.fillText(txt, k.x + k.w / 2, h - 10);
      });
      L.blacks.forEach(function (k) {
        var txt = Core.noteLabel(k.midi, View.labelStyle);
        if (!txt) return;
        ctx.font = '400 10px ui-sans-serif,system-ui,"Segoe UI",sans-serif';
        ctx.fillStyle = pressedSet[k.midi] ? '#4a3608' : 'rgba(255,255,255,.55)';
        ctx.fillText(txt, k.x + k.w / 2, L.blackH - 18);
      });
    }

    View.keysDirty = false;
  };

  function hintColor(kind, alpha) {
    var c = PALETTE[kind] || PALETTE.hintTarget;
    if (c[0] === '#') {
      var r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
      return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
    }
    return c;
  }

  /* --------------------------------------------------------- 小地图 */

  View.drawMini = function () {
    var ctx = View.mctx;
    if (!ctx) return;
    var w = View.miniW, h = View.miniH;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.fillRect(0, 0, w, h);

    var all = Core.allWhiteKeys();
    var per = w / all.length;
    var whiteIndex = {};
    all.forEach(function (m, i) { whiteIndex[m] = i; });

    /* 曲目音域 */
    if (View.songRange) {
      var lo = whiteIndex[firstWhiteAtOrAbove(View.songRange.low)];
      var hi = whiteIndex[firstWhiteAtOrAbove(View.songRange.high)];
      if (lo != null && hi != null) {
        ctx.fillStyle = 'rgba(255,194,71,.22)';
        ctx.fillRect(lo * per, 0, (hi - lo + 1) * per, h);
      }
    }

    all.forEach(function (m, i) {
      ctx.fillStyle = '#d8d4c8';
      ctx.fillRect(i * per, h * 0.28, Math.max(1, per - 0.6), h * 0.72);
    });
    for (var midi = Core.LOW_MIDI; midi <= Core.HIGH_MIDI; midi++) {
      if (!Core.isBlackKey(midi)) continue;
      var wi = whiteIndex[firstWhiteAtOrAbove(midi)] - 1;
      if (wi < 0) continue;
      ctx.fillStyle = '#1a1a20';
      ctx.fillRect((wi + 1) * per - per * 0.32, h * 0.05, Math.max(1, per * 0.62), h * 0.62);
    }

    /* 当前视窗 */
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(View.startWhite * per + 0.75, 0.75, View.whiteCount * per - 1.5, h - 1.5);
    ctx.fillStyle = 'rgba(255,255,255,.1)';
    ctx.fillRect(View.startWhite * per, 0, View.whiteCount * per, h);

    View.miniDirty = false;
  };

  function firstWhiteAtOrAbove(midi) {
    var all = Core.allWhiteKeys();
    for (var i = 0; i < all.length; i++) if (all[i] >= midi) return all[i];
    return all[all.length - 1];
  }

  /* --------------------------------------------------------- 舞台绘制 */

  /**
   * state = {
   *   mode, songName, notes: [{midi,start,dur,hand,state,hitTime}], time, lead,
   *   beatsPerBar, beatSec, prompt: {text, sub}, countdown, combo, score
   * }
   */
  View.drawStage = function (state) {
    var ctx = View.sctx;
    if (!ctx) return;
    var w = View.stageW, h = View.stageH;
    ctx.clearRect(0, 0, w, h);

    var bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#0d0e14');
    bg.addColorStop(1, PALETTE.stageBg);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    var hitY = h - 2;
    ctx.fillStyle = 'rgba(255,255,255,.05)';
    ctx.fillRect(0, hitY - 26, w, 26);

    if (state && state.mode === 'song' && state.notes && state.notes.length) {
      drawFalling(ctx, state, w, h, hitY);
    } else if (state && state.mode === 'note') {
      drawNoteTarget(ctx, state, w, h);
    } else if (state && state.mode === 'harmony') {
      drawHarmony(ctx, state, w, h);
    } else {
      drawIdleStage(ctx, state, w, h);
    }
    View.stageDirty = false;
  };

  function drawFalling(ctx, state, w, h, hitY) {
    var lead = Math.max(0.6, state.lead || 2.4);
    var pps = (h - 6) / lead;          // 每秒下落的像素
    var now = state.time;
    var L = View.layout;
    var offsetX = View.stageOffsetX;
    var beatSec = state.beatSec || 0.6;
    var barSec = beatSec * (state.beatsPerBar || 4);

    /* 拍格 */
    if (state.totalSec) {
      var firstBeat = Math.floor(now / beatSec) - 1;
      var lastBeat = Math.ceil((now + lead) / beatSec) + 1;
      for (var b = firstBeat; b <= lastBeat; b++) {
        var y = hitY - (b * beatSec - now) * pps;
        if (y < 0 || y > h) continue;
        var isBar = ((b % (state.beatsPerBar || 4)) + (state.beatsPerBar || 4)) % (state.beatsPerBar || 4) === 0;
        ctx.fillStyle = isBar ? PALETTE.gridBar : PALETTE.grid;
        ctx.fillRect(0, y, w, isBar ? 1.5 : 1);
      }
    }

    /* 音符 */
    state.notes.forEach(function (n) {
      var dt = n.start - now;
      if (dt > lead + 0.4 || dt < -0.9) return;
      var key = L.map[n.midi];
      if (!key) return;
      var yBottom = hitY - dt * pps;
      var yTop = yBottom - Math.max(3, n.dur * pps);
      if (yBottom < -20 || yTop > h + 20) return;
      var x = key.x + key.w / 2 + offsetX;
      var wRect = Math.max(4, Math.min(key.w - 2, 26));
      var alpha = 1;
      if (n.state === 'hit') alpha = Math.max(0, 1 - (now - (n.hitTime == null ? now : n.hitTime)) * 3);
      else if (n.state === 'miss') alpha = 0.35;
      else if (n.state === 'auto') alpha = 0.75;
      if (alpha <= 0.02) return;

      ctx.save();
      ctx.globalAlpha = alpha;
      var color = n.state === 'miss' ? PALETTE.miss
        : n.state === 'hit' ? PALETTE.hitFlash
        : (n.hand === 'L' ? PALETTE.leftHand : PALETTE.rightHand);
      var g = ctx.createLinearGradient(0, yTop, 0, yBottom);
      g.addColorStop(0, color);
      g.addColorStop(1, shade(color, -0.35));
      ctx.fillStyle = g;
      roundRect(ctx, x - wRect / 2, yTop, wRect, yBottom - yTop, 3);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    });

    /* 判定线 */
    ctx.fillStyle = PALETTE.hitLine;
    ctx.fillRect(0, hitY - 1, w, 2);
  }

  function drawNoteTarget(ctx, state, w, h) {
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.font = '500 13px ui-sans-serif,system-ui,"Segoe UI",sans-serif';
    ctx.fillText(state.promptTop || '在键盘上找到这个音', w / 2, 30);
    ctx.fillStyle = '#7ee0c8';
    ctx.font = '700 56px ui-sans-serif,system-ui,"Segoe UI",sans-serif';
    ctx.fillText(state.promptText || '—', w / 2, h / 2 + 8);
    if (state.promptSub) {
      ctx.fillStyle = 'rgba(255,255,255,.42)';
      ctx.font = '400 15px ui-sans-serif,system-ui,"Segoe UI",sans-serif';
      ctx.fillText(state.promptSub, w / 2, h / 2 + 38);
    }
  }

  function drawHarmony(ctx, state, w, h) {
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.font = '500 13px ui-sans-serif,system-ui,"Segoe UI",sans-serif';
    ctx.fillText(state.promptTop || '', w / 2, 28);
    ctx.fillStyle = '#ffd479';
    ctx.font = '700 44px ui-sans-serif,system-ui,"Segoe UI",sans-serif';
    ctx.fillText(state.promptText || '', w / 2, h / 2 + 6);
    if (state.promptSub) {
      ctx.fillStyle = 'rgba(255,255,255,.45)';
      ctx.font = '400 14px ui-sans-serif,system-ui,"Segoe UI",sans-serif';
      ctx.fillText(state.promptSub, w / 2, h / 2 + 34);
    }
  }

  function drawIdleStage(ctx, state, w, h) {
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,.24)';
    ctx.font = '400 14px ui-sans-serif,system-ui,"Segoe UI",sans-serif';
    var lines = (state && state.hintLines) || ['用手指直接按琴键，或用电脑键盘 Z / Q 两排演奏', '多点触摸：多指同时按下即可叠出和弦'];
    lines.forEach(function (t, i) {
      ctx.fillText(t, w / 2, h / 2 - 10 + i * 22);
    });
  }

  function shade(hex, amt) {
    if (hex[0] !== '#') return hex;
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    var f = function (v) { return clamp(Math.round(v + 255 * amt), 0, 255); };
    return 'rgb(' + f(r) + ',' + f(g) + ',' + f(b) + ')';
  }

  /* ----------------------------------------------------------- 总绘制 */

  View.draw = function (state) {
    if (View.keysDirty) View.drawKeys();
    if (View.miniDirty) View.drawMini();
    if (View.stageDirty || (state && state.mode === 'song')) View.drawStage(state);
  };

  View.PALETTE = PALETTE;
  return View;
});
