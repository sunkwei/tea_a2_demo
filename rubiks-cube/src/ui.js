/*!
 * 三阶魔方 · 界面（教程步骤卡、六面展开图、状态栏、坐标轴标签）
 */
(function (global) {
  'use strict';

  var C = global.RubiksCore;
  var S = global.RubiksSolver;

  var FACE_ORDER = [
    { face: 'U', cap: '上', row: 1, col: 2 },
    { face: 'L', cap: '左', row: 2, col: 1 },
    { face: 'F', cap: '前', row: 2, col: 2 },
    { face: 'R', cap: '右', row: 2, col: 3 },
    { face: 'B', cap: '后', row: 2, col: 4 },
    { face: 'D', cap: '下', row: 3, col: 2 },
  ];

  function fmtTime(ms) {
    var s = Math.floor(ms / 1000);
    var m = Math.floor(s / 60);
    return m + ':' + String(s % 60).padStart(2, '0');
  }

  function UI(app) {
    this.app = app;
    this.el = {
      steps: document.getElementById('steps'),
      net: document.getElementById('net'),
      time: document.getElementById('stat-time'),
      moves: document.getElementById('stat-moves'),
      stage: document.getElementById('stat-stage'),
      state: document.getElementById('stat-state'),
      stageWrap: document.getElementById('stage'),
      canvas: document.getElementById('gl'),
    };
    this.labels = [];
    this.buildNet();
    this.buildSteps();
    this.bind();
    var self = this;
    app.onChange(function () { self.render(); });
    setInterval(function () { self.renderTime(); }, 250);
    this.render();
  }

  /* --------------------- 六面展开图 --------------------- */
  UI.prototype.buildNet = function () {
    var html = '';
    var cells = '';
    for (var i = 0; i < 9; i++) cells += '<div class="cell" data-i="' + i + '"></div>';
    for (var f = 0; f < FACE_ORDER.length; f++) {
      var o = FACE_ORDER[f];
      html += '<div style="grid-row:' + o.row + ';grid-column:' + o.col + '">';
      html += '<div class="face-cap">' + o.cap + '</div>';
      html += '<div class="face" data-face="' + o.face + '">' + cells + '</div>';
      html += '</div>';
    }
    this.el.net.innerHTML = html;
    this.netCells = {};
    var faces = this.el.net.querySelectorAll('.face');
    for (var k = 0; k < faces.length; k++) {
      var name = faces[k].getAttribute('data-face');
      var cells = faces[k].querySelectorAll('.cell');
      var arr = [];
      for (var c = 0; c < cells.length; c++) arr.push(cells[c]);
      this.netCells[name] = arr;
    }
  };

  UI.prototype.renderNet = function () {
    var grid = C.faceGrid(this.app.state);
    for (var f = 0; f < FACE_ORDER.length; f++) {
      var name = FACE_ORDER[f].face;
      var cells = this.netCells[name];
      if (!cells) continue;
      for (var i = 0; i < 9; i++) {
        var color = grid[name][Math.floor(i / 3)][i % 3];
        cells[i].style.background = color ? C.COLORS[color].hex : '#222';
      }
    }
  };

  /* --------------------- 步骤卡片 --------------------- */
  UI.prototype.buildSteps = function () {
    var html = '';
    for (var i = 0; i < S.STAGES.length; i++) {
      var st = S.STAGES[i];
      html += '<div class="step" data-step="' + i + '">' +
        '<div class="head">' +
        '<span class="num">' + (i + 1) + '</span>' +
        '<span class="title">' + st.title.replace(/^第 \d+ 步 · /, '') + '</span>' +
        '<span class="brief">' + st.brief + '</span>' +
        '</div><div class="body"></div></div>';
    }
    this.el.steps.innerHTML = html;
    this.stepEls = this.el.steps.querySelectorAll('.step');
    var self = this;
    this.el.steps.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      if (act === 'demo') {
        self.app.demo();
      } else if (act === 'hint') {
        self.app.hint();
        self.render();
      }
    });
  };

  UI.prototype.renderSteps = function () {
    var app = this.app;
    var tasks = app.hintPlan || [];
    for (var i = 0; i < S.STAGES.length; i++) {
      var st = S.STAGES[i];
      var el = this.stepEls[i];
      var active = i === app.stageIndex;
      var done = st.goal(app.state);
      el.className = 'step' + (active ? ' active' : '') + (done && !active ? ' done' : '');
      var body = el.querySelector('.body');
      var html = '<p>' + st.detail + '</p>';
      if (active) {
        if (tasks.length) {
          html += '<div style="margin-top:6px;color:var(--muted);font-size:12px">当前要做：</div>';
          if (tasks[0] && tasks[0].complete === false) {
            html += '<div style="margin-top:4px;font-size:11.5px;color:#ffb9a0">' +
              '提示：下面这组公式只保证把目标块放到位，可能仍需手动收尾。</div>';
          }
          for (var t = 0; t < tasks.length; t++) {
            var task = tasks[t];
            if (!task.text) continue;
            var seq = task.moves && task.moves.length
              ? '<code>' + task.moves.join(' ') + '</code>' : '<span style="color:#ff9a9a">（暂未算出公式）</span>';
            html += '<div class="task"><span class="dot">▸</span><div>' + task.text + ' ' + seq + '</div></div>';
          }
        } else {
          html += '<div class="task"><span class="dot">▸</span><div>这一步已经完成 ✓</div></div>';
        }
        html += '<div class="actions">' +
          '<button class="primary" data-act="demo">演示这一步</button>' +
          '<button data-act="hint">重新算提示</button>' +
          '</div>';
      }
      body.innerHTML = html;
    }
  };

  /* --------------------- 状态栏 --------------------- */
  UI.prototype.renderTime = function () {
    this.el.time.textContent = fmtTime(this.app.elapsed());
  };

  UI.prototype.render = function () {
    var app = this.app;
    this.renderSteps();
    this.renderNet();
    this.renderTime();
    this.el.moves.textContent = app.moveCount;
    this.el.stage.textContent = (app.stageIndex + 1) + ' / ' + S.STAGES.length;
    var solved = C.isSolved(app.state);
    this.el.state.textContent = solved ? '已还原' : '进行中';
    this.el.state.className = 'badge ' + (solved ? 'ok' : 'run');
  };

  /* --------------------- 坐标轴标签 --------------------- */
  UI.prototype.updateAxisLabels = function (tips, camera) {
    if (!this.labels.length) {
      for (var i = 0; i < 3; i++) {
        var el = document.createElement('div');
        el.className = 'axis-label';
        this.el.stage.appendChild(el);
        this.labels.push(el);
      }
      this.labels[0].textContent = 'X';
      this.labels[1].textContent = 'Y';
      this.labels[2].textContent = 'Z';
      this.labels[0].style.color = '#f24a55';
      this.labels[1].style.color = '#5cd470';
      this.labels[2].style.color = '#5999f2';
    }
    if (!tips) return;
    var rect = this.el.canvas.getBoundingClientRect();
    for (var k = 0; k < 3; k++) {
      var p = tips[k];
      // 相机空间 → NDC（与渲染器同一套透视参数）
      var x = p[0], y = p[1], z = p[2];
      var f = 1 / Math.tan(42 * Math.PI / 180 / 2);
      var aspect = rect.width / Math.max(1, rect.height);
      var ndcX = (f / aspect) * x / -z;
      var ndcY = f * y / -z;
      var left = (ndcX * 0.5 + 0.5) * rect.width;
      var top = (-ndcY * 0.5 + 0.5) * rect.height;
      this.labels[k].style.left = left + 'px';
      this.labels[k].style.top = top + 'px';
    }
  };

  /* --------------------- 事件 --------------------- */
  UI.prototype.bind = function () {
    var app = this.app;
    document.getElementById('btn-scramble').addEventListener('click', function () { app.scramble(25); });
    document.getElementById('btn-reset').addEventListener('click', function () { app.reset(); });
    document.getElementById('btn-undo').addEventListener('click', function () { app.undo(); });
    document.getElementById('btn-hint').addEventListener('click', function () { app.hint(); app.emit(); });
    document.getElementById('btn-demo').addEventListener('click', function () { app.demo(); });
    var views = document.querySelectorAll('[data-view]');
    for (var i = 0; i < views.length; i++) {
      views[i].addEventListener('click', function (e) {
        app.camera.preset(e.currentTarget.getAttribute('data-view'));
      });
    }
    document.getElementById('zoom').addEventListener('input', function (e) {
      app.camera.dist = 7.4 / Math.pow(1.12, Number(e.target.value) / 20);
      app.camera.update();
    });
    app.onGizmo = function (tips, camera) { self.updateAxisLabels(tips, camera); };
    var self = this;
  };

  global.addEventListener('DOMContentLoaded', function () {
    var app = global.RubiksApp.init(document.getElementById('gl'));
    global.__rubik = app;
    global.__rubikUI = new UI(app);
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
