/* ==========================================================================
 * 琴房 · audio.js —— WebAudio 钢琴合成（无采样、无外部文件）
 *
 * 音色：加法合成。每个音 N 个正弦分音，带张力不谐和（inharmonicity）、
 *       分音各自衰减、琴槌噪声、双声道轻微展开；总线 压缩 + 程序化混响 + 限幅。
 * 延音踏板：踩下时离键不制音，抬起时统一制音。
 * 另带节拍器与 OfflineAudioContext 离线渲染（给自检用）。
 * ========================================================================== */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PianoAudio = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function freqOf(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

  /* ------------------------------------------------------------ 混响 IR */

  function makeImpulse(ctx, seconds) {
    var rate = ctx.sampleRate;
    var len = Math.max(1, Math.floor(rate * (seconds || 2.2)));
    var buf = ctx.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      var pre = Math.floor(rate * 0.012);
      for (var i = 0; i < len; i++) {
        var t = i / len;
        var env = Math.pow(1 - t, 2.4) * Math.exp(-t * 1.5);
        var s = (Math.random() * 2 - 1) * env;
        if (i < pre) s *= i / pre * 0.35;
        d[i] = s * 0.55;
      }
      /* 几次早期反射，声音更像房间而不是白噪尾 */
      var taps = [0.021, 0.037, 0.058, 0.081];
      for (var k = 0; k < taps.length; k++) {
        var idx = Math.floor(rate * taps[k] * (ch ? 1.07 : 1));
        if (idx < len) d[idx] += (ch ? -1 : 1) * 0.16 / (k + 1);
      }
    }
    return buf;
  }

  function makeNoise(ctx, seconds) {
    var rate = ctx.sampleRate;
    var len = Math.max(1, Math.floor(rate * (seconds || 0.25)));
    var buf = ctx.createBuffer(1, len, rate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    return buf;
  }

  /* ---------------------------------------------------------- 合成图 */

  function createGraph(ctx, destination, opts) {
    opts = opts || {};
    var graph = {
      ctx: ctx,
      voices: [],
      pedal: false,
      volume: opts.volume == null ? 0.8 : opts.volume,
      reverb: opts.reverb == null ? 0.3 : opts.reverb,
      noise: makeNoise(ctx, 0.25),
      closed: false
    };

    var master = ctx.createGain();
    master.gain.value = graph.volume;

    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -15;
    comp.knee.value = 16;
    comp.ratio.value = 3;
    comp.attack.value = 0.004;
    comp.release.value = 0.24;

    var dry = ctx.createGain();
    dry.gain.value = 1;
    var wet = ctx.createGain();
    wet.gain.value = graph.reverb;

    var conv = ctx.createConvolver();
    conv.buffer = makeImpulse(ctx, opts.reverbSeconds || 2.4);

    var limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.14;

    master.connect(comp);
    comp.connect(dry);
    comp.connect(conv);
    conv.connect(wet);
    dry.connect(limiter);
    wet.connect(limiter);
    limiter.connect(destination);

    /* 独立的总线：节拍器不进混响 */
    var metro = ctx.createGain();
    metro.gain.value = 0.5;
    metro.connect(destination);

    graph.nodes = { master: master, comp: comp, dry: dry, wet: wet, conv: conv, limiter: limiter, metro: metro };

    /* -------------------------------------------------------- 单音 */

    function buildVoice(midi, vel, t0) {
      var f0 = freqOf(midi);
      var out = ctx.createGain();
      out.gain.value = 1;
      var node = out;
      if (ctx.createStereoPanner) {
        var pan = ctx.createStereoPanner();
        pan.pan.value = clamp((midi - 64) / 110, -0.42, 0.42);
        out.connect(pan);
        node = pan;
      }
      node.connect(master);

      var register = 1 - 0.3 * Math.min(1, Math.abs(midi - 62) / 46);
      var peak = 0.15 * Math.pow(vel, 1.45) * register;
      var nPartial = midi < 36 ? 14 : midi < 52 ? 11 : midi < 72 ? 8 : midi < 90 ? 5 : 4;
      var B = 0.00026 * Math.pow(2, (midi - 60) / 22);
      var baseDecay = clamp(4.8 * Math.exp(-(midi - 21) / 34), 0.55, 6.5);
      var attack = midi < 40 ? 0.01 : 0.004;
      var nyq = ctx.sampleRate / 2;
      var voice = { midi: midi, vel: vel, t0: t0, out: out, oscs: [], released: false, sustained: false, dead: false, endAt: t0 };

      for (var n = 1; n <= nPartial; n++) {
        var fn = f0 * n * Math.sqrt(1 + B * n * n);
        if (fn > nyq * 0.82) break;
        var amp = peak * Math.pow(n, -1.32);
        if (n === 1) amp *= 1.15;
        var dec = Math.max(0.06, baseDecay / (1 + 0.55 * (n - 1)));
        var osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = fn * (1 + (Math.random() - 0.5) * 0.0006);
        var g = ctx.createGain();
        var atk = attack + n * 0.0008;
        g.gain.setValueAtTime(0.00001, t0);
        g.gain.linearRampToValueAtTime(amp, t0 + atk);
        g.gain.exponentialRampToValueAtTime(Math.max(1e-6, amp * 0.0016), t0 + atk + dec);
        osc.connect(g);
        g.connect(out);
        try { osc.start(t0); osc.stop(t0 + atk + dec + 0.06); } catch (e) { /* ignore */ }
        voice.oscs.push(osc);
        voice.endAt = Math.max(voice.endAt, t0 + atk + dec + 0.06);
      }

      /* 琴槌噪声：决定“击弦”的颗粒感 */
      if (graph.noise) {
        var src = ctx.createBufferSource();
        src.buffer = graph.noise;
        var bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = clamp(f0 * 3.4, 320, 9000);
        bp.Q.value = 1.05;
        var ng = ctx.createGain();
        ng.gain.setValueAtTime(0.00001, t0);
        ng.gain.linearRampToValueAtTime(0.085 * vel * register + 0.00001, t0 + 0.002);
        ng.gain.exponentialRampToValueAtTime(0.00001, t0 + 0.06);
        src.connect(bp);
        bp.connect(ng);
        ng.connect(out);
        try { src.start(t0); src.stop(t0 + 0.1); } catch (e) { /* ignore */ }
        voice.endAt = Math.max(voice.endAt, t0 + 0.1);
      }
      return voice;
    }

    /* ---------------------------------------------------- 制音 / 离键 */

    function damp(voice) {
      if (!voice || voice.dead) return;
      var now = ctx.currentTime;
      var current = voice.out.gain.value;
      var d = clamp(0.42 - (voice.midi - 21) / 87 * 0.3, 0.1, 0.45);
      try {
        voice.out.gain.cancelScheduledValues(now);
        voice.out.gain.setValueAtTime(Math.max(current, 0.0001), now);
        voice.out.gain.exponentialRampToValueAtTime(0.0001, now + d);
      } catch (e) {
        voice.out.gain.value = 0;
      }
      voice.dead = true;
      voice.endAt = now + d + 0.04;
      voice.oscs.forEach(function (o) {
        try { o.stop(now + d + 0.05); } catch (e) { /* 已经停了 */ }
      });
      setTimeout(function () {
        var i = graph.voices.indexOf(voice);
        if (i >= 0) graph.voices.splice(i, 1);
      }, (d + 0.2) * 1000);
    }

    function prune() {
      var now = ctx.currentTime;
      graph.voices = graph.voices.filter(function (v) { return v.dead || v.endAt > now; });
    }

    /* ------------------------------------------------------ 公开接口 */

    graph.noteOn = function (midi, vel, when) {
      if (graph.closed) return null;
      var t = (when == null ? ctx.currentTime : when) + 0.001;
      vel = clamp(vel == null ? 0.8 : vel, 0.05, 1);
      prune();

      /* 同键重击：旧音先制音（钢琴不会同时响两根同音弦） */
      for (var i = graph.voices.length - 1; i >= 0; i--) {
        var old = graph.voices[i];
        if (old.midi === midi && !old.dead) damp(old);
      }

      /* 复音上限：超过 48 个先掐最老的 */
      var live = graph.voices.filter(function (v) { return !v.dead; });
      if (live.length >= 48) {
        live.sort(function (a, b) { return a.t0 - b.t0; });
        damp(live[0]);
      }

      var voice = buildVoice(midi, vel, t);
      graph.voices.push(voice);
      return voice;
    };

    graph.noteOff = function (midi, force) {
      for (var i = graph.voices.length - 1; i >= 0; i--) {
        var v = graph.voices[i];
        if (v.midi !== midi || v.dead || v.released) continue;
        v.released = true;
        if (graph.pedal && !force) { v.sustained = true; continue; }
        damp(v);
        break;
      }
    };

    graph.setPedal = function (on) {
      on = !!on;
      if (graph.pedal === on) return;
      graph.pedal = on;
      if (!on) {
        graph.voices.forEach(function (v) {
          if (v.sustained && !v.dead) damp(v);
        });
      }
    };

    graph.allOff = function () {
      graph.voices.forEach(function (v) { if (!v.dead) damp(v); });
      graph.pedal = false;
    };

    graph.setVolume = function (v) {
      graph.volume = clamp(Number(v) || 0, 0, 1);
      master.gain.setTargetAtTime(graph.volume, ctx.currentTime, 0.03);
    };

    graph.setReverb = function (v) {
      graph.reverb = clamp(Number(v) || 0, 0, 1);
      wet.gain.setTargetAtTime(graph.reverb * 0.9, ctx.currentTime, 0.05);
    };

    graph.liveVoiceCount = function () {
      return graph.voices.filter(function (v) { return !v.dead; }).length;
    };

    graph.click = function (when, accent) {
      var t = when == null ? ctx.currentTime + 0.02 : when;
      var osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(accent ? 1760 : 1320, t);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.00001, t);
      g.gain.linearRampToValueAtTime(accent ? 0.5 : 0.3, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.00001, t + 0.06);
      osc.connect(g);
      g.connect(metro);
      try { osc.start(t); osc.stop(t + 0.08); } catch (e) { /* ignore */ }
    };

    graph.dispose = function () {
      graph.closed = true;
      graph.allOff();
      try { limiter.disconnect(); } catch (e) { /* ignore */ }
    };

    return graph;
  }

  /* ------------------------------------------------------------ 离线渲染 */

  function goertzel(data, sampleRate, freq) {
    var w = 2 * Math.PI * freq / sampleRate;
    var cw = Math.cos(w), coeff = 2 * cw, s0 = 0, s1 = 0, s2 = 0;
    for (var i = 0; i < data.length; i++) {
      s0 = data[i] + coeff * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    var real = s1 - s2 * cw, imag = s2 * Math.sin(w);
    return Math.sqrt(real * real + imag * imag) / data.length;
  }

  function renderOffline(opts) {
    opts = opts || {};
    var OC = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    if (!OC) return Promise.reject(new Error('当前浏览器不支持 OfflineAudioContext'));
    var sr = opts.sampleRate || 44100;
    var seconds = opts.seconds || 2;
    var octx = new OC(2, Math.round(sr * seconds), sr);
    var graph = createGraph(octx, octx.destination, {
      volume: opts.volume == null ? 0.9 : opts.volume,
      reverb: opts.reverb == null ? 0.24 : opts.reverb,
      reverbSeconds: opts.reverbSeconds || 1.8
    });
    var notes = opts.notes || [{ midi: opts.midi == null ? 60 : opts.midi, vel: opts.velocity == null ? 0.75 : opts.velocity, at: 0.02 }];
    notes.forEach(function (n) {
      graph.noteOn(n.midi, n.vel == null ? 0.75 : n.vel, n.at == null ? 0.02 : n.at);
    });
    if (opts.releaseAt != null) {
      notes.forEach(function (n) { graph.noteOff(n.midi); });
    }
    return octx.startRendering().then(function (buf) {
      var ch = buf.getChannelData(0);
      var peak = 0, sum = 0, i, a;
      for (i = 0; i < ch.length; i++) {
        a = Math.abs(ch[i]);
        if (a > peak) peak = a;
        sum += ch[i] * ch[i];
      }
      var win = ch.subarray(0, Math.min(ch.length, 4096));
      var out = {
        rms: Math.sqrt(sum / ch.length),
        peak: peak,
        seconds: seconds,
        sampleRate: sr,
        channels: buf.numberOfChannels,
        silent: peak < 1e-4
      };
      if (opts.probeHz) out.probe = goertzel(win, sr, opts.probeHz);
      if (opts.probeHzs) {
        out.probes = opts.probeHzs.map(function (f) { return { hz: f, mag: goertzel(win, sr, f) }; });
      }
      return out;
    });
  }

  /* ------------------------------------------------------------ 实时引擎 */

  var Engine = {
    ctx: null,
    graph: null,
    metroTimer: null,
    metroNext: 0,
    metroBeat: 0,
    metroBpm: 92,
    metroOn: false,
    onBeat: null,
    lastError: '',

    supported: function () {
      return !!(root.AudioContext || root.webkitAudioContext);
    },

    ensure: function () {
      if (this.graph && this.ctx) return this.graph;
      var AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) { this.lastError = '浏览器不支持 WebAudio'; return null; }
      try {
        this.ctx = new AC({ latencyHint: 'interactive' });
      } catch (e) {
        try { this.ctx = new AC(); } catch (e2) { this.lastError = '无法创建 AudioContext'; return null; }
      }
      this.graph = createGraph(this.ctx, this.ctx.destination, { volume: 0.8, reverb: 0.3 });
      this.graph.nodes.metro.gain.value = 0.45;
      this.resume();
      return this.graph;
    },

    resume: function () {
      if (!this.ctx) return Promise.resolve('none');
      var self = this;
      if (this.ctx.state === 'suspended' && this.ctx.resume) {
        return this.ctx.resume().then(function () { return self.ctx.state; }, function () { return self.ctx.state; });
      }
      return Promise.resolve(this.ctx.state);
    },

    state: function () { return this.ctx ? this.ctx.state : 'none'; },

    noteOn: function (midi, vel) {
      if (!this.ensure()) return null;
      this.resume();
      return this.graph.noteOn(midi, vel);
    },
    noteOff: function (midi) {
      if (!this.graph) return;
      this.graph.noteOff(midi);
    },
    pedal: function (on) { if (this.graph) this.graph.setPedal(on); },
    allOff: function () { if (this.graph) this.graph.allOff(); },
    setVolume: function (v) { if (this.graph) this.graph.setVolume(v); },
    setReverb: function (v) { if (this.graph) this.graph.setReverb(v); },
    voiceCount: function () { return this.graph ? this.graph.liveVoiceCount() : 0; },

    /* ------------------------------------------------------- 节拍器 */

    startMetronome: function (bpm, onBeat) {
      if (!this.ensure()) return;
      this.metroBpm = clamp(Number(bpm) || 92, 30, 240);
      this.onBeat = onBeat || null;
      this.metroOn = true;
      var self = this;
      var ctx = this.ctx;
      this.metroNext = ctx.currentTime + 0.08;
      this.metroBeat = 0;
      if (this.metroTimer) clearInterval(this.metroTimer);
      this.metroTimer = setInterval(function () { self._tickMetro(); }, 25);
      this._tickMetro();
    },

    setMetronomeBpm: function (bpm) {
      this.metroBpm = clamp(Number(bpm) || 92, 30, 240);
    },

    _tickMetro: function () {
      if (!this.metroOn || !this.ctx || !this.graph) return;
      var ctx = this.ctx;
      var lookahead = ctx.currentTime + 0.14;
      var guard = 0;
      while (this.metroNext < lookahead && guard++ < 16) {
        var accent = this.metroBeat % 4 === 0;
        this.graph.click(this.metroNext, accent);
        if (this.onBeat) {
          var self = this;
          var delay = Math.max(0, (this.metroNext - ctx.currentTime) * 1000);
          var beat = this.metroBeat;
          setTimeout(function () { if (self.onBeat) self.onBeat(beat, accent); }, delay);
        }
        this.metroNext += 60 / this.metroBpm;
        this.metroBeat++;
      }
    },

    stopMetronome: function () {
      this.metroOn = false;
      if (this.metroTimer) { clearInterval(this.metroTimer); this.metroTimer = null; }
    },

    renderOffline: renderOffline
  };

  return {
    Engine: Engine,
    createGraph: createGraph,
    renderOffline: renderOffline,
    freqOf: freqOf,
    goertzel: goertzel,
    supported: function () { return !!(root.AudioContext || root.webkitAudioContext); }
  };
});
