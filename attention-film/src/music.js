// music.js — 程序化生成的环境音乐（OfflineAudioContext 离线渲染 → WAV）
// 风格：缓慢的 Am–F–Dm–G 铺底 pad + 每个章节切换时的钟声 + 极轻的空气感噪声
const SR = 44100;

const CHORDS = [
  { root: 110.0, notes: [220.0, 261.63, 329.63, 493.88] }, // Am
  { root: 87.31, notes: [174.61, 220.0, 261.63, 329.63] }, // F
  { root: 146.83, notes: [220.0, 261.63, 293.66, 349.23] }, // Dm
  { root: 123.47, notes: [196.0, 246.94, 293.66, 349.23] }, // G
];
const BAR = 8; // 每段和弦 8 秒

function env(ctx, node, t0, dur, peak, attack, release) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + attack);
  g.gain.setValueAtTime(Math.max(peak, 0.0002), t0 + dur - release);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  node.connect(g);
  return g;
}

export async function renderMusic(duration = 60) {
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * duration), SR);
  const master = ctx.createGain();
  master.gain.value = 0.85;
  master.connect(ctx.destination);

  /* --- 低音 --- */
  const bass = ctx.createGain();
  bass.gain.value = 0.5;
  bass.connect(master);

  /* --- 铺底 pad --- */
  const padBus = ctx.createGain();
  padBus.gain.value = 0.5;
  const padFilter = ctx.createBiquadFilter();
  padFilter.type = 'lowpass';
  padFilter.frequency.value = 1100;
  padFilter.Q.value = 0.6;
  padBus.connect(padFilter);
  padFilter.connect(master);

  const bars = Math.ceil(duration / BAR);
  for (let b = 0; b < bars; b++) {
    const chord = CHORDS[b % CHORDS.length];
    const t0 = b * BAR;
    const dur = Math.min(BAR + 3, duration - t0);
    if (dur <= 0) break;

    // 低音
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = chord.root;
    const og = env(ctx, o, t0, dur, 0.16, 1.6, 2.2);
    og.connect(bass);
    o.start(t0);
    o.stop(t0 + dur);

    // pad 声部
    chord.notes.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = i % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.value = f;
      osc.detune.value = (i - 1.5) * 5;
      const g = env(ctx, osc, t0, dur, 0.075, 2.4, 2.6);
      g.connect(padBus);
      osc.start(t0);
      osc.stop(t0 + dur);
    });
  }

  /* --- 章节钟声 --- */
  const CUES = [0, 5, 12, 21, 28, 36, 46, 54];
  CUES.forEach((t, i) => {
    if (t >= duration) return;
    const chord = CHORDS[Math.floor(t / BAR) % CHORDS.length];
    const f = chord.notes[i % chord.notes.length] * 2;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.11, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + 2.8);
  });

  /* --- 空气感噪声 --- */
  const len = Math.ceil(SR * duration);
  const noise = ctx.createBuffer(1, len, SR);
  const nd = noise.getChannelData(0);
  let s = 12345;
  for (let i = 0; i < len; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    nd[i] = (s / 0x3fffffff - 1) * 0.5;
  }
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 620;
  const ng = ctx.createGain();
  ng.gain.value = 0.035;
  src.connect(lp);
  lp.connect(ng);
  ng.connect(master);
  src.start(0);

  const buf = await ctx.startRendering();
  return encodeWav(buf);
}

function encodeWav(buf) {
  const ch = buf.numberOfChannels;
  const len = buf.length;
  const bytes = 44 + len * ch * 2;
  const ab = new ArrayBuffer(bytes);
  const view = new DataView(ab);
  const str = (off, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  view.setUint32(4, bytes - 8, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, ch, true);
  view.setUint32(24, buf.sampleRate, true);
  view.setUint32(28, buf.sampleRate * ch * 2, true);
  view.setUint16(32, ch * 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, len * ch * 2, true);
  const data = [];
  for (let c = 0; c < ch; c++) data.push(buf.getChannelData(c));
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      off += 2;
    }
  }
  return ab;
}
