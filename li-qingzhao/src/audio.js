/**
 * 李清照 · 漱玉词 —— 古琴背景音乐播放器
 *
 * 曲子是真实录音：Charlie Huang 演奏《阳关三叠》（CC BY-SA 3.0，Wikimedia Commons）。
 * 本文件不碰 DOM，只包一个 <audio> 元素：懒加载、淡入淡出、音量、后台压低、记忆开关。
 *
 * 浏览器：<script> 引入后挂到 window.LI_QINGZHAO_AUDIO_PLAYER
 * Node  ：selftest 用假的 audio 元素 + 假 storage 测纯逻辑
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LI_QINGZHAO_AUDIO_PLAYER = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function (root) {
  'use strict';

  const KEY = 'lq.audio.v1';
  const DEFAULT_VOLUME = 45;
  const DUCKED = 0.32;

  function clamp01(v) {
    const n = Number(v);
    if (!isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
  }

  function normalizeVolume(v) {
    const n = Number(v);
    if (!isFinite(n)) return DEFAULT_VOLUME;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  /** 音量 0–100 → 0–1：平方曲线，接近人耳 */
  function volumeToGain(percent) {
    return Math.round(Math.pow(clamp01(normalizeVolume(percent) / 100), 1.8) * 1000) / 1000;
  }

  function readSettings(storage) {
    const out = { volume: DEFAULT_VOLUME, enabled: false, src: '' };
    try {
      if (!storage) return out;
      const raw = storage.getItem(KEY);
      if (!raw) return out;
      const j = JSON.parse(raw);
      if (j && typeof j.volume === 'number') out.volume = normalizeVolume(j.volume);
      if (j && j.enabled === true) out.enabled = true;
      if (j && typeof j.src === 'string') out.src = j.src;
    } catch (e) { /* 无痕模式 / file:// 下可能不可用 */ }
    return out;
  }

  function writeSettings(storage, patch) {
    const next = Object.assign({}, readSettings(storage), patch);
    try {
      if (storage) storage.setItem(KEY, JSON.stringify(next));
    } catch (e) { /* 忽略 */ }
    return next;
  }

  /**
   * @param {{audio:any, src:string, storage?:any, fadeMs?:number, onState?:Function}} opts
   */
  function createPlayer(opts) {
    const audio = opts && opts.audio;
    const storage = opts && opts.storage;
    const fadeMs = opts && opts.fadeMs != null ? Number(opts.fadeMs) : 1800;
    const onState = opts && typeof opts.onState === 'function' ? opts.onState : function () {};

    if (!audio) return null;

    const saved = readSettings(storage);
    const state = {
      ready: false,
      loaded: false,
      playing: false,
      loading: false,
      error: '',
      volume: saved.volume,
      ducked: false,
      src: opts.src || saved.src || '',
      currentTime: 0,
      duration: 0,
    };

    let fadeTimer = null;
    let pauseToken = 0;
    let wantPlay = saved.enabled;

    function emit() {
      try { onState(getState()); } catch (e) { /* 回调里出错不影响播放 */ }
    }

    function gainNow() {
      return volumeToGain(state.volume) * (state.ducked ? DUCKED : 1);
    }

    function setAudioVolume(v) {
      try { audio.volume = clamp01(v); } catch (e) { /* 某些环境只读 */ }
    }

    function clearFade() {
      if (fadeTimer) {
        clearInterval(fadeTimer);
        fadeTimer = null;
      }
    }

    function fadeTo(target, ms) {
      clearFade();
      const from = Number(audio.volume);
      if (!fadeMs || !ms || !isFinite(from)) {
        setAudioVolume(target);
        return;
      }
      const t0 = Date.now();
      fadeTimer = setInterval(function () {
        const p = Math.min(1, (Date.now() - t0) / ms);
        setAudioVolume(from + (target - from) * p);
        if (p >= 1) clearFade();
      }, 40);
    }

    function ensureSrc() {
      if (!state.src) return false;
      if (!state.loaded) {
        try {
          audio.src = state.src;
          audio.loop = true;
          audio.preload = 'auto';
          if (typeof audio.load === 'function') audio.load();
        } catch (e) {
          state.error = '音频加载失败';
          emit();
          return false;
        }
        state.loaded = true;
        state.loading = true;
        emit();
      }
      return true;
    }

    function getState() {
      return {
        ready: state.ready,
        playing: state.playing,
        loading: state.loading,
        error: state.error,
        volume: state.volume,
        ducked: state.ducked,
        currentTime: Number(audio.currentTime) || 0,
        duration: Number(audio.duration) || 0,
        wantPlay: wantPlay,
        src: state.src,
      };
    }

    function play() {
      if (!ensureSrc()) return Promise.reject(new Error('no audio source'));
      pauseToken += 1;
      setAudioVolume(0);
      let p;
      try {
        p = audio.play();
      } catch (e) {
        state.error = '浏览器拦截了自动播放';
        emit();
        return Promise.reject(e);
      }
      const promise = p && typeof p.then === 'function' ? p : Promise.resolve();
      return promise.then(function () {
        state.ready = true;
        state.playing = true;
        state.loading = false;
        state.error = '';
        wantPlay = true;
        writeSettings(storage, { enabled: true, volume: state.volume, src: state.src });
        fadeTo(gainNow(), fadeMs);
        emit();
        return getState();
      }).catch(function (err) {
        state.playing = false;
        state.loading = false;
        state.error = '浏览器要求先点一下页面才能出声';
        wantPlay = false;
        emit();
        throw err;
      });
    }

    function pause(silent) {
      if (!state.playing && !state.loading) {
        if (!silent) writeSettings(storage, { enabled: false, volume: state.volume, src: state.src });
        return getState();
      }
      fadeTo(0, Math.min(fadeMs, 700));
      state.playing = false;
      if (!silent) writeSettings(storage, { enabled: false, volume: state.volume, src: state.src });
      wantPlay = false;
      const token = ++pauseToken;
      const done = function () {
        if (token !== pauseToken) return;
        try { audio.pause(); } catch (e) { /* ignore */ }
        state.loading = false;
        emit();
      };
      if (fadeMs) setTimeout(done, Math.min(fadeMs, 700) + 40);
      else done();
      emit();
      return getState();
    }

    function toggle() {
      return state.playing ? Promise.resolve(pause()) : play();
    }

    function setVolume(v) {
      state.volume = normalizeVolume(v);
      if (!state.playing) setAudioVolume(0);
      else fadeTo(gainNow(), 160);
      writeSettings(storage, { volume: state.volume, src: state.src });
      emit();
      return state.volume;
    }

    function setDucked(on) {
      const next = !!on;
      if (state.ducked === next) return getState();
      state.ducked = next;
      if (state.playing) fadeTo(gainNow(), 420);
      emit();
      return getState();
    }

    /* 事件：加载完成 / 出错 / 播放位置 */
    if (typeof audio.addEventListener === 'function') {
      audio.addEventListener('loadedmetadata', function () {
        state.loading = false;
        state.duration = Number(audio.duration) || 0;
        emit();
      });
      audio.addEventListener('canplay', function () {
        state.loading = false;
        emit();
      });
      audio.addEventListener('error', function () {
        state.loading = false;
        state.playing = false;
        state.error = '音频文件没找到（请确认 assets/audio/yangguan-sandie.mp3）';
        wantPlay = false;
        emit();
      });
      audio.addEventListener('timeupdate', function () {
        state.currentTime = Number(audio.currentTime) || 0;
        emit();
      });
    }

    ensureSrc();
    setAudioVolume(0);

    return {
      play: play,
      pause: pause,
      toggle: toggle,
      setVolume: setVolume,
      setDucked: setDucked,
      getState: getState,
      shouldResume: function () { return wantPlay; },
      src: state.src,
      KEY: KEY,
    };
  }

  return {
    KEY: KEY,
    DEFAULT_VOLUME: DEFAULT_VOLUME,
    DUCKED: DUCKED,
    normalizeVolume: normalizeVolume,
    volumeToGain: volumeToGain,
    readSettings: readSettings,
    writeSettings: writeSettings,
    createPlayer: createPlayer,
  };
});
