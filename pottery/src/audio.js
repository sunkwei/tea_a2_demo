/**
 * 中国陶器史 · 背景音乐（Web Audio 实时合成，没有音频文件）
 *
 * 声音构成：
 *   · 低频「窑火」：两个略微失谐的正弦/三角振荡器 + 慢速振幅起伏
 *   · 风声：循环的褐噪声，低通 + 慢速扫频
 *   · 拨弦：D 五声音阶（D F G A C）随机落点，指数衰减，送混响
 *   · 混响：程序化生成的脉冲响应（衰减噪声），不需要外部 IR 文件
 *
 * 浏览器：<script> 引入后挂到 window.POTTERY_AUDIO
 * Node  ：没有 AudioContext 时 isSupported=false，createEngine() 返回 null（自检用）
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.POTTERY_AUDIO = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function (root) {
  'use strict';

  /* D 五声音阶（宫商角徵羽）：D F G A C，跨两个八度 */
  const SCALE = [
    { name: 'D3', freq: 146.83 },
    { name: 'F3', freq: 174.61 },
    { name: 'G3', freq: 196.00 },
    { name: 'A3', freq: 220.00 },
    { name: 'C4', freq: 261.63 },
    { name: 'D4', freq: 293.66 },
    { name: 'F4', freq: 349.23 },
    { name: 'G4', freq: 392.00 },
    { name: 'A4', freq: 440.00 },
    { name: 'C5', freq: 523.25 },
  ];

  const DEFAULT_VOLUME = 45;
  /* 整体混音增益：让默认 45% 落在 -34 dBFS 左右，仍然留足动态余量 */
  const MIX_GAIN = 3.2;

  function clamp01(v) {
    const n = Number(v);
    if (!isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
  }

  /** 音量 0–100 → 增益 0–1（近似人耳：平方曲线） */
  function volumeToGain(percent) {
    return Math.round(Math.pow(clamp01(Number(percent) / 100), 1.8) * 1000) / 1000;
  }

  /** 用给定随机源从音阶里挑一个音（便于测试） */
  function pickNote(rng) {
    const r = typeof rng === 'function' ? rng() : Math.random();
    const i = Math.min(SCALE.length - 1, Math.max(0, Math.floor(clamp01(r) * SCALE.length)));
    return SCALE[i];
  }

  function AudioCtor() {
    if (typeof root === 'undefined' || !root) return null;
    return root.AudioContext || root.webkitAudioContext || null;
  }

  let lastEngine = null;

  function getLastEngine() {
    return lastEngine;
  }

  /* ------------------------------------------------------------------ *
   * 实时合成
   * ------------------------------------------------------------------ */

  function createNoiseBuffer(ctx, seconds, brown) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.2;
      } else {
        data[i] = white * 0.5;
      }
    }
    return buf;
  }

  function createImpulse(ctx, seconds, decay) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  function createLimiter(ctx) {
    if (typeof ctx.createDynamicsCompressor !== 'function') return ctx.createGain();
    const c = ctx.createDynamicsCompressor();
    if (c.threshold) c.threshold.value = -18;
    if (c.knee) c.knee.value = 24;
    if (c.ratio) c.ratio.value = 3;
    if (c.attack) c.attack.value = 0.02;
    if (c.release) c.release.value = 0.3;
    return c;
  }

  /**
   * @param {{audioContext?: any}} [opts] 可注入 AudioContext 构造器（测试用）
   * @returns {null | {start:Function, stop:Function, setVolume:Function, isPlaying:Function,
   *                   getVolume:Function, contextState:Function, nodeCount:Function}}
   */
  function createEngine(opts) {
    const Ctx = (opts && opts.audioContext) || AudioCtor();
    if (!Ctx) return null;

    let ctx;
    try {
      ctx = new Ctx();
    } catch (e) {
      return null;
    }

    let playing = false;
    let volume = DEFAULT_VOLUME;
    let duck = 1;
    let timer = null;
    let gestureTimer = null;
    let nodes = 0;

    const now = function () { return ctx.currentTime; };

    const master = ctx.createGain();
    master.gain.value = 0.0001;
    const limiter = createLimiter(ctx);
    master.connect(limiter);
    limiter.connect(ctx.destination);

    /* 混响：程序化 IR + 干湿两路 */
    const bus = ctx.createGain();
    bus.gain.value = 0.9;
    bus.connect(master);
    let convolver = null;
    try {
      convolver = ctx.createConvolver();
      convolver.buffer = createImpulse(ctx, 3.4, 2.6);
      const wet = ctx.createGain();
      wet.gain.value = 0.34;
      bus.connect(convolver);
      convolver.connect(wet);
      wet.connect(master);
      nodes += 3;
    } catch (e) {
      convolver = null;
    }

    /* 风声 */
    let windGain = null;
    try {
      const wind = ctx.createBufferSource();
      wind.buffer = createNoiseBuffer(ctx, 2.5, true);
      wind.loop = true;
      const windLp = ctx.createBiquadFilter();
      windLp.type = 'lowpass';
      windLp.frequency.value = 360;
      windLp.Q.value = 0.6;
      windGain = ctx.createGain();
      windGain.gain.value = 0.055;
      wind.connect(windLp);
      windLp.connect(windGain);
      windGain.connect(bus);
      wind.start();
      /* 慢速扫频，让风声像窑口里的呼吸 */
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.045;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 130;
      lfo.connect(lfoGain);
      lfoGain.connect(windLp.frequency);
      lfo.start();
      nodes += 6;
    } catch (e) {
      windGain = null;
    }

    /* 低频窑火 */
    let droneGain = null;
    try {
      droneGain = ctx.createGain();
      droneGain.gain.value = 0.05;
      const droneLp = ctx.createBiquadFilter();
      droneLp.type = 'lowpass';
      droneLp.frequency.value = 520;
      droneGain.connect(droneLp);
      droneLp.connect(bus);
      [73.42, 110.0, 146.83].forEach(function (f, i) {
        const o = ctx.createOscillator();
        o.type = i === 1 ? 'triangle' : 'sine';
        o.frequency.value = f;
        o.detune.value = (i - 1) * 5;
        const g = ctx.createGain();
        g.gain.value = i === 0 ? 0.5 : 0.22;
        o.connect(g);
        g.connect(droneGain);
        o.start();
        nodes += 2;
      });
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.03;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.018;
      lfo.connect(lfoGain);
      lfoGain.connect(droneGain.gain);
      lfo.start();
      nodes += 2;
    } catch (e) {
      droneGain = null;
    }

    /* 拨弦：三角波 + 高八度正弦，指数衰减后停止并断开 */
    function pluck(freq, when, amount) {
      const t = Math.max(now(), when || now());
      const g = ctx.createGain();
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2400;
      lp.Q.value = 0.6;

      const o1 = ctx.createOscillator();
      o1.type = 'triangle';
      o1.frequency.value = freq;
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = freq * 2.004;
      const g2 = ctx.createGain();
      g2.gain.value = 0.22;

      o1.connect(g);
      o2.connect(g2);
      g2.connect(g);
      g.connect(lp);
      lp.connect(bus);

      const decay = 3.2 + Math.random() * 2.4;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(amount || 0.11, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);

      o1.start(t);
      o2.start(t);
      o1.stop(t + decay + 0.4);
      o2.stop(t + decay + 0.4);
      nodes += 5;
      setTimeout(function () {
        try { g.disconnect(); lp.disconnect(); } catch (e) {}
      }, Math.round((decay + 1) * 1000));
    }

    function playPhrase() {
      const n = pickNote();
      pluck(n.freq, now() + 0.05, 0.1 + Math.random() * 0.04);
      if (Math.random() < 0.42) {
        const n2 = pickNote();
        pluck(n2.freq, now() + 0.34 + Math.random() * 0.4, 0.07 + Math.random() * 0.03);
      }
    }

    function schedule(delay) {
      if (!playing) return;
      clearTimeout(timer);
      const wait = delay == null ? 1900 + Math.random() * 4300 : delay;
      timer = setTimeout(function () {
        if (!playing) return;
        playPhrase();
        schedule();
      }, wait);
    }

    function targetGain() {
      return Math.max(0.0001, volumeToGain(volume) * duck * MIX_GAIN);
    }

    function start() {
      if (playing) return true;
      playing = true;
      try {
        if (ctx.state === 'suspended' && ctx.resume) {
          const p = ctx.resume();
          if (p && p.catch) p.catch(function () {});
        }
      } catch (e) {}
      const t = now();
      try {
        master.gain.cancelScheduledValues(t);
        master.gain.setTargetAtTime(targetGain(), t, 0.35);
      } catch (e) {
        master.gain.value = targetGain();
      }
      schedule(700);
      return true;
    }

    function stop() {
      playing = false;
      clearTimeout(timer);
      timer = null;
      const t = now();
      try {
        master.gain.cancelScheduledValues(t);
        master.gain.setTargetAtTime(0.0001, t, 0.22);
      } catch (e) {
        master.gain.value = 0.0001;
      }
      clearTimeout(gestureTimer);
      gestureTimer = setTimeout(function () {
        if (!playing && ctx.suspend) {
          try {
            const p = ctx.suspend();
            if (p && p.catch) p.catch(function () {});
          } catch (e) {}
        }
      }, 900);
    }

    function setVolume(v) {
      volume = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
      if (playing) {
        try { master.gain.setTargetAtTime(targetGain(), now(), 0.08); } catch (e) { master.gain.value = targetGain(); }
      }
    }

    function setDuck(d) {
      duck = Math.max(0.08, Math.min(1, Number(d) || 1));
      if (playing) {
        try { master.gain.setTargetAtTime(targetGain(), now(), 0.4); } catch (e) {}
      }
    }

    /* 切到后台时自动压低，回来再抬起来 */
    if (root && root.document && root.document.addEventListener) {
      root.document.addEventListener('visibilitychange', function () {
        setDuck(root.document.hidden ? 0.25 : 1);
      });
    }

    const engine = {
      start: start,
      stop: stop,
      setVolume: setVolume,
      setDuck: setDuck,
      isPlaying: function () { return playing; },
      getVolume: function () { return volume; },
      getContext: function () { return ctx; },
      contextState: function () { return ctx.state; },
      nodeCount: function () { return nodes; },
      dispose: function () {
        stop();
        clearTimeout(gestureTimer);
        try { ctx.close(); } catch (e) {}
      },
    };
    lastEngine = engine;
    return engine;
  }

  return {
    SCALE: SCALE,
    DEFAULT_VOLUME: DEFAULT_VOLUME,
    volumeToGain: volumeToGain,
    pickNote: pickNote,
    isSupported: !!AudioCtor(),
    createEngine: createEngine,
    getLastEngine: getLastEngine,
  };
});
