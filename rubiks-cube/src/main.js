/*!
 * 三阶魔方 · 主程序（状态、动画、教程联动）
 * 浏览器：<script src="src/core.js"></script> ... <script src="src/main.js"></script>
 */
(function (global) {
  'use strict';

  var C = global.RubiksCore;
  var S = global.RubiksSolver;
  var G = global.RubiksGL;

  var App = {
    state: null,
    camera: null,
    renderer: null,
    controls: null,
    history: [],
    moveCount: 0,
    queue: [],
    anim: null,
    tween: null,
    highlight: null,
    stageIndex: 0,
    timer: { running: false, start: 0, elapsed: 0 },
    solved: true,
    listeners: [],
    hintPlan: null,

    init: function (canvas) {
      this.state = C.createState();
      this.camera = new global.RubiksCamera.Camera();
      this.renderer = new global.RubiksRenderer.Renderer(canvas);
      this.controls = new global.RubiksControls.Controls(canvas, this.camera, this);
      this.solved = true;
      this.bindKeys();
      var self = this;
      function loop(t) {
        self.frame(t);
        global.requestAnimationFrame(loop);
      }
      global.requestAnimationFrame(loop);
      this.emit();
      return this;
    },

    onChange: function (fn) { this.listeners.push(fn); },
    emit: function () {
      for (var i = 0; i < this.listeners.length; i++) this.listeners[i](this);
    },

    /* --------------------- 动画 --------------------- */
    isAnimating: function () {
      return !!this.tween || this.queue.length > 0;
    },

    setAnim: function (a) {
      this.tween = null;
      this.anim = a;
    },

    animateBack: function (a) {
      this.tween = { from: a.angle, to: 0, t0: performance.now(), dur: 160, axis: a.axis, layer: a.layer };
      this.anim = { axis: a.axis, layer: a.layer, angle: a.angle };
    },

    /** 鼠标拧层：k 为绕「正轴」的 90° 步数，residual 为动画残差 */
    commitTwist: function (axis, layer, k, residual) {
      if (k !== 0) {
        C.rotateLayer(this.state, axis, layer, k);
        this.history.push({ type: 'twist', axis: axis, layer: layer, quarters: k });
        this.moveCount++;
        this.startTimer();
      }
      this.tween = {
        from: residual, to: 0, t0: performance.now(), dur: 170,
        axis: axis, layer: layer,
      };
      this.anim = { axis: axis, layer: layer, angle: residual };
      this.afterChange();
    },

    /** 记号转动（如 "R" / "U'" / "F2"），进入动画队列 */
    applyMove: function (name, silent) {
      var m = C.parseMove(name);
      if (!m) return false;
      this.queue.push(name);
      if (!silent) this.startTimer();
      return true;
    },

    applyMoveNow: function (name) {
      var m = C.parseMove(name);
      if (!m) return;
      C.applyMoveInPlace(this.state, name);
      this.history.push({ type: 'notation', name: name });
      this.moveCount++;
      this.startTimer();
      this.afterChange();
    },

    undo: function () {
      if (this.isAnimating() || !this.history.length) return;
      var last = this.history.pop();
      if (last.type === 'twist') {
        C.rotateLayer(this.state, last.axis, last.layer, -last.quarters);
      } else {
        C.applyMoveInPlace(this.state, C.invertMove(last.name));
      }
      this.moveCount = Math.max(0, this.moveCount - 1);
      this.afterChange();
    },

    scramble: function (count) {
      var seq = C.randomScramble(count || 25);
      this.reset(false);
      for (var i = 0; i < seq.length; i++) this.queue.push(seq[i]);
      this.startTimer();
      this.afterChange();
    },

    reset: function (notify) {
      this.state = C.createState();
      this.history = [];
      this.moveCount = 0;
      this.queue = [];
      this.anim = null;
      this.tween = null;
      this.timer = { running: false, start: 0, elapsed: 0 };
      this.solved = true;
      this.highlight = null;
      this.hintPlan = null;
      if (notify !== false) this.afterChange();
    },

    /* --------------------- 计时 --------------------- */
    startTimer: function () {
      if (this.solved) {
        this.timer = { running: true, start: performance.now(), elapsed: 0 };
      }
    },
    stopTimer: function () {
      if (this.timer.running) {
        this.timer.elapsed = performance.now() - this.timer.start;
        this.timer.running = false;
      }
    },
    elapsed: function () {
      if (this.timer.running) return performance.now() - this.timer.start;
      return this.timer.elapsed;
    },

    /* --------------------- 教程 --------------------- */
    refreshStage: function () {
      this.stageIndex = S.detectStage(this.state);
      var tasks = S.planStage(this.state, this.stageIndex, {});
      this.hintPlan = tasks;
      // 高亮当前目标块
      var hl = null;
      for (var i = 0; i < tasks.length; i++) {
        if (tasks[i].pieceId) { hl = tasks[i].pieceId; break; }
      }
      this.highlight = hl;
      return tasks;
    },

    hint: function () {
      this.refreshStage();
      return this.hintPlan;
    },

    demo: function () {
      var tasks = this.hintPlan || this.refreshStage();
      var moves = [];
      for (var i = 0; i < tasks.length; i++) {
        if (tasks[i].moves) moves = moves.concat(tasks[i].moves);
      }
      if (!moves.length) return false;
      this.startTimer();
      for (var j = 0; j < moves.length; j++) this.queue.push(moves[j]);
      this.afterChange();
      return true;
    },

    /* --------------------- 键盘 --------------------- */
    bindKeys: function () {
      var self = this;
      var map = { u: 'U', d: 'D', l: 'L', r: 'R', f: 'F', b: 'B' };
      global.document.addEventListener('keydown', function (e) {
        if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
        var k = e.key.toLowerCase();
        if (map[k]) {
          var name = map[k];
          if (e.shiftKey) name += "'";
          self.applyMove(name);
          e.preventDefault();
          return;
        }
        if (k === 'z') { self.undo(); e.preventDefault(); }
        else if (k === ' ') { self.scramble(25); e.preventDefault(); }
        else if (k === 'h') { self.hint(); self.emit(); e.preventDefault(); }
        else if (k === 'p') { self.demo(); e.preventDefault(); }
        else if (k >= '1' && k <= '6') {
          var names = ['front', 'back', 'left', 'right', 'top', 'bottom'];
          self.camera.preset(names[Number(k) - 1]);
        }
      });
    },

    /* --------------------- 帧循环 --------------------- */
    afterChange: function () {
      var wasSolved = this.solved;
      this.solved = C.isSolved(this.state);
      if (this.solved && !wasSolved) this.stopTimer();
      this.refreshStage();
      this.emit();
    },

    frame: function (t) {
      // 推进队列
      if (!this.tween && this.queue.length) {
        var name = this.queue.shift();
        var m = C.parseMove(name);
        if (m) {
          C.applyMoveInPlace(this.state, name);
          this.history.push({ type: 'notation', name: name });
          this.moveCount++;
          var angle = m.dir * m.quarters * Math.PI / 2;
          this.tween = {
            from: -angle, to: 0, t0: performance.now(), dur: 150,
            axis: m.axis, layer: m.layer,
          };
          this.anim = { axis: m.axis, layer: m.layer, angle: -angle };
          this.afterChange();
        }
      }
      // 推进补间
      if (this.tween) {
        var p = Math.min(1, (performance.now() - this.tween.t0) / this.tween.dur);
        var e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        var ang = this.tween.from + (this.tween.to - this.tween.from) * e;
        this.anim = { axis: this.tween.axis, layer: this.tween.layer, angle: ang };
        if (p >= 1) { this.tween = null; this.anim = null; this.afterChange(); }
      }

      this.renderer.buildScene(this.state, { anim: this.anim, highlight: this.highlight });
      var tips = this.renderer.buildGizmo(this.camera, 1);
      this.renderer.render(this.camera, {});
      if (this.onGizmo) this.onGizmo(tips, this.camera);
    },
  };

  global.RubiksApp = App;
})(typeof globalThis !== 'undefined' ? globalThis : this);
