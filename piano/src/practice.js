/* ==========================================================================
 * 琴房 · practice.js —— 四套练习的状态机（纯逻辑，无 DOM / 无音频）
 *
 *   SongPractice  曲谱跟弹（瀑布流判分、单手 + 另一手自动伴奏）
 *   NoteFinder    认键速记（看音名找琴键）
 *   ScaleDrill    音阶练习（上行 + 下行，顺序校验）
 *   ChordDrill    和弦进行（按齐构成音，超时算漏）
 * ========================================================================== */
(function (root, factory) {
  var api = factory(root && root.PianoCore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PianoPractice = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';
  if (!Core) throw new Error('PianoPractice 依赖 PianoCore（core.js 需先加载）');

  /* -------------------------------------------------------- 曲谱跟弹 */

  function SongPractice(compiled, opts) {
    opts = opts || {};
    this.song = compiled;
    this.hands = opts.hands || 'both';
    this.autoOther = opts.autoOther !== false;
    this.tempo = Core.clamp(opts.tempo || 100, 40, 140) / 100;
    this.bpm = compiled.bpm * this.tempo;
    this.beatSec = 60 / this.bpm;
    this.lead = opts.lead == null ? 2.2 : opts.lead;

    this.state = 'idle';
    this.t = 0;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.counts = { perfect: 0, great: 0, good: 0, miss: 0, wrong: 0 };
    this.events = [];
    this.last = null;

    this.notes = [];
    this.autoNotes = [];
    var self = this;
    compiled.notes.forEach(function (n) {
      var judged = self.hands === 'both' ||
        (self.hands === 'right' ? n.hand === 'R' : n.hand === 'L');
      var item = {
        midi: n.midi, hand: n.hand, measure: n.measure,
        beat: n.start, beats: n.dur,
        start: n.start * self.beatSec,
        dur: n.dur * self.beatSec,
        state: 'pending', grade: null, delta: 0
      };
      if (judged) self.notes.push(item);
      else self.autoNotes.push(item);
    });
    this.total = this.notes.length;
    this.duration = compiled.duration / this.tempo;
    this.autoIndex = 0;
    this.onAutoNote = opts.onAutoNote || null;
    this.onNoteResult = opts.onNoteResult || null;
  }

  SongPractice.prototype.start = function () {
    this.state = 'playing';
    this.t = -this.lead;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.counts = { perfect: 0, great: 0, good: 0, miss: 0, wrong: 0 };
    this.events = [];
    this.last = null;
    this.autoIndex = 0;
    this.notes.forEach(function (n) { n.state = 'pending'; n.grade = null; n.delta = 0; });
    this.autoNotes.forEach(function (n) { n.state = 'pending'; });
    return this;
  };

  SongPractice.prototype.pause = function () {
    if (this.state === 'playing') this.state = 'paused';
  };
  SongPractice.prototype.resume = function () {
    if (this.state === 'paused') this.state = 'playing';
  };
  SongPractice.prototype.stop = function () {
    this.state = 'stopped';
  };

  /** 推进时间：dt 秒。返回本次新产生的漏音数量 */
  SongPractice.prototype.update = function (dt) {
    if (this.state !== 'playing') return 0;
    var prev = this.t;
    this.t += dt;
    var missed = 0, i;

    /* 另一手自动伴奏 */
    if (this.autoOther) {
      while (this.autoIndex < this.autoNotes.length && this.autoNotes[this.autoIndex].start <= this.t) {
        var auto = this.autoNotes[this.autoIndex++];
        if (auto.start > prev - 0.001) {          // 只播新跨过去的音
          auto.state = 'auto';
          if (this.onAutoNote) this.onAutoNote(auto);
        }
      }
    }

    /* 过了判定窗还没按 → 漏音 */
    for (i = 0; i < this.notes.length; i++) {
      var n = this.notes[i];
      if (n.state === 'pending' && this.t - n.start > Core.MISS_WINDOW) {
        n.state = 'miss';
        n.grade = 'miss';
        this.counts.miss++;
        this.combo = 0;
        missed++;
        this.last = { type: 'miss', note: n };
        if (this.onNoteResult) this.onNoteResult(this.last);
      }
    }
    if (this.t > this.duration + 1.1) this.finish();
    return missed;
  };

  /** 按键：返回 {type:'hit'...} / {wrong:true} / {ignored:true} / null */
  SongPractice.prototype.press = function (midi) {
    if (this.state !== 'playing' || this.t < -0.06) return null;
    var i, n, d, a;
    var best = null, bestAbs = Infinity, near = null, nearAbs = Infinity;

    for (i = 0; i < this.notes.length; i++) {
      n = this.notes[i];
      if (n.midi !== midi) continue;
      d = this.t - n.start;
      a = Math.abs(d);
      if (a < nearAbs) { near = n; nearAbs = a; }
      if (n.state === 'pending' && a <= Core.MISS_WINDOW && a < bestAbs) { best = n; bestAbs = a; }
    }

    if (!best) {
      if (near && nearAbs <= 0.45) {          // 是这首歌的音，但差得太远
        this.counts.wrong++;
        this.combo = 0;
        this.last = { type: 'wrong', midi: midi, note: near, delta: this.t - near.start };
        if (this.onNoteResult) this.onNoteResult(this.last);
        return this.last;
      }
      return { type: 'neutral', midi: midi };  // 曲外自由按键，不罚
    }

    var j = Core.judgeTiming(this.t - best.start);
    best.state = 'hit';
    best.grade = j.grade;
    best.delta = this.t - best.start;
    this.combo++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    var mult = 1 + Math.min(this.combo, 40) / 40 * 0.5;
    var points = Math.round(j.points * mult);
    this.score += points;
    this.counts[j.grade]++;
    this.last = { type: 'hit', grade: j.grade, label: j.label, points: points, note: best, delta: best.delta, combo: this.combo };
    if (this.onNoteResult) this.onNoteResult(this.last);
    return this.last;
  };

  SongPractice.prototype.finish = function () {
    if (this.state === 'done') return;
    this.state = 'done';
    this.t = this.duration;
    /* 还没按的一律算漏 */
    for (var i = 0; i < this.notes.length; i++) {
      var n = this.notes[i];
      if (n.state === 'pending') {
        n.state = 'miss';
        n.grade = 'miss';
        this.counts.miss++;
      }
    }
  };

  SongPractice.prototype.accuracy = function () { return Core.accuracy(this.counts); };
  SongPractice.prototype.grade = function () { return Core.gradeOf(this.accuracy()); };
  SongPractice.prototype.progress = function () {
    if (this.duration <= 0) return 0;
    return Core.clamp(this.t / this.duration, 0, 1);
  };
  SongPractice.prototype.summary = function () {
    var acc = this.accuracy();
    return {
      songId: this.song.id, title: this.song.title, accuracy: acc, grade: Core.gradeOf(acc),
      score: this.score, maxCombo: this.maxCombo, counts: this.counts,
      total: this.total, duration: this.duration, tempo: this.tempo, hands: this.hands
    };
  };
  SongPractice.prototype.pendingNotesIn = function (from, to) {
    return this.notes.filter(function (n) {
      return n.state === 'pending' && n.start >= from && n.start <= to;
    });
  };

  /* -------------------------------------------------------- 认键速记 */

  function NoteFinder(opts) {
    opts = opts || {};
    this.pool = (opts.pool || []).slice();
    this.rounds = Math.max(1, opts.rounds || 20);
    this.timeLimit = opts.timeLimit || 6;
    this.rng = opts.rng || Math.random;
    this.state = 'idle';
    this.index = 0;
    this.correct = 0;
    this.wrong = 0;
    this.timeouts = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.timeLeft = this.timeLimit;
    this.target = null;
    this.last = null;
    this.log = [];
    this.elapsed = 0;
  }

  NoteFinder.prototype.start = function () {
    if (!this.pool.length) return false;
    this.state = 'playing';
    this.index = 0;
    this.correct = 0;
    this.wrong = 0;
    this.timeouts = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.elapsed = 0;
    this.last = null;
    this.log = [];
    this.target = null;
    this._next();
    return true;
  };

  NoteFinder.prototype._pick = function () {
    if (this.pool.length === 1) return this.pool[0];
    for (var k = 0; k < 10; k++) {
      var i = Math.floor(this.rng() * this.pool.length);
      var m = this.pool[Core.clamp(i, 0, this.pool.length - 1)];
      if (m !== this.target) return m;
    }
    return this.pool[0];
  };

  NoteFinder.prototype._next = function () {
    if (this.index >= this.rounds) {
      this.state = 'done';
      this.target = null;
      return;
    }
    this.target = this._pick();
    this.timeLeft = this.timeLimit;
  };

  NoteFinder.prototype.press = function (midi) {
    if (this.state !== 'playing') return null;
    if (midi === this.target) {
      this.correct++;
      this.index++;
      this.streak++;
      if (this.streak > this.bestStreak) this.bestStreak = this.streak;
      this.last = { type: 'correct', midi: midi, index: this.index };
      this._next();
      return { ok: true, target: this.target, done: this.state === 'done' };
    }
    this.wrong++;
    this.streak = 0;
    this.timeLeft = Math.max(0.7, this.timeLeft - 1.2);
    this.last = { type: 'wrong', midi: midi, expected: this.target };
    return { ok: false, expected: this.target };
  };

  NoteFinder.prototype.update = function (dt) {
    if (this.state !== 'playing') return;
    this.elapsed += dt;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeouts++;
      this.index++;
      this.streak = 0;
      this.last = { type: 'timeout' };
      this._next();
    }
  };

  NoteFinder.prototype.accuracy = function () {
    var total = this.index || 1;
    return Math.round(Core.clamp((this.correct - this.wrong * 0.5) / total, 0, 1) * 1000) / 10;
  };
  NoteFinder.prototype.grade = function () { return Core.gradeOf(this.accuracy()); };
  NoteFinder.prototype.progress = function () {
    return Core.clamp(this.index / this.rounds, 0, 1);
  };
  NoteFinder.prototype.summary = function () {
    return {
      accuracy: this.accuracy(), grade: this.grade(), correct: this.correct, wrong: this.wrong,
      timeouts: this.timeouts, rounds: this.rounds, bestStreak: this.bestStreak, elapsed: this.elapsed
    };
  };

  /* -------------------------------------------------------- 音阶练习 */

  function ScaleDrill(seq, opts) {
    opts = opts || {};
    this.seq = (seq || []).slice();
    this.name = opts.name || '';
    this.index = 0;
    this.errors = 0;
    this.state = this.seq.length ? 'playing' : 'done';
    this.last = null;
    this.elapsed = 0;
    this.lastErrorAt = -1;
  }

  ScaleDrill.prototype.press = function (midi) {
    if (this.state !== 'playing') return null;
    if (midi === this.seq[this.index]) {
      this.index++;
      if (this.index >= this.seq.length) this.state = 'done';
      this.last = { ok: true, index: this.index, done: this.state === 'done' };
      return this.last;
    }
    this.errors++;
    this.lastErrorAt = this.index;
    this.last = { ok: false, expected: this.seq[this.index], midi: midi };
    return this.last;
  };

  ScaleDrill.prototype.next = function () {
    return this.state === 'playing' ? this.seq[this.index] : null;
  };
  ScaleDrill.prototype.update = function (dt) {
    if (this.state === 'playing') this.elapsed += dt;
  };
  ScaleDrill.prototype.progress = function () {
    return this.seq.length ? Core.clamp(this.index / this.seq.length, 0, 1) : 0;
  };
  ScaleDrill.prototype.summary = function () {
    return {
      name: this.name, notes: this.seq.length, errors: this.errors,
      elapsed: this.elapsed, clean: this.errors === 0,
      grade: this.errors === 0 ? 'S' : this.errors <= 2 ? 'A' : this.errors <= 5 ? 'B' : 'C'
    };
  };

  /* ------------------------------------------------------ 和弦进行 */

  function ChordDrill(steps, opts) {
    opts = opts || {};
    this.steps = (steps || []).slice();
    this.bpm = opts.bpm || 80;
    this.beatsPerChord = opts.beatsPerChord || 4;
    this.loops = Math.max(1, opts.loops || 2);
    this.beatSec = 60 / this.bpm;
    this.limit = this.beatsPerChord * this.beatSec;
    this.state = this.steps.length ? 'idle' : 'done';
    this.index = 0;
    this.loop = 0;
    this.held = {};
    this.errors = 0;
    this.cleared = 0;
    this.missed = 0;
    this.timeLeft = this.limit;
    this.last = null;
    this.elapsed = 0;
  }

  ChordDrill.prototype.start = function () {
    if (!this.steps.length) return false;
    this.state = 'playing';
    this.index = 0;
    this.loop = 0;
    this.held = {};
    this.errors = 0;
    this.cleared = 0;
    this.missed = 0;
    this.elapsed = 0;
    this.timeLeft = this.limit;
    this.last = null;
    return true;
  };

  ChordDrill.prototype.current = function () {
    return this.state === 'done' ? null : this.steps[this.index] || null;
  };

  ChordDrill.prototype.advance = function (result) {
    this.held = {};
    this.index++;
    if (this.index >= this.steps.length) {
      this.index = 0;
      this.loop++;
      if (this.loop >= this.loops) {
        this.state = 'done';
        return;
      }
    }
    this.timeLeft = this.limit;
    this.last = result || null;
  };

  ChordDrill.prototype.press = function (midi) {
    if (this.state !== 'playing') return null;
    var step = this.steps[this.index];
    if (!step) return null;
    if (step.midis.indexOf(midi) >= 0) {
      this.held[midi] = true;
      var held = this.held;
      var complete = step.midis.every(function (m) { return held[m]; });
      if (complete) {
        this.cleared++;
        this.last = { ok: true, complete: true, chord: step.name };
        this.advance({ ok: true, complete: true, chord: step.name });
        return { ok: true, complete: true, chord: step.name };
      }
      this.last = { ok: true, complete: false, chord: step.name };
      return this.last;
    }
    this.errors++;
    this.last = { ok: false, wrong: true, midi: midi, chord: step.name };
    return this.last;
  };

  ChordDrill.prototype.release = function (midi) {
    if (this.held[midi]) delete this.held[midi];
  };

  ChordDrill.prototype.update = function (dt) {
    if (this.state !== 'playing') return;
    this.elapsed += dt;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.missed++;
      this.last = { ok: false, timeout: true, chord: (this.steps[this.index] || {}).name };
      this.advance(null);
    }
  };

  ChordDrill.prototype.progress = function () {
    var done = this.loop * this.steps.length + this.index;
    var total = this.loops * this.steps.length;
    return total ? Core.clamp(done / total, 0, 1) : 0;
  };
  ChordDrill.prototype.accuracy = function () {
    var total = this.cleared + this.missed + this.errors * 0.5;
    if (!total) return 100;
    return Math.round(Core.clamp(this.cleared / total, 0, 1) * 1000) / 10;
  };
  ChordDrill.prototype.summary = function () {
    return {
      cleared: this.cleared, missed: this.missed, errors: this.errors,
      loops: this.loops, accuracy: this.accuracy(),
      grade: Core.gradeOf(this.accuracy()), elapsed: this.elapsed
    };
  };

  return {
    SongPractice: SongPractice,
    NoteFinder: NoteFinder,
    ScaleDrill: ScaleDrill,
    ChordDrill: ChordDrill
  };
});
