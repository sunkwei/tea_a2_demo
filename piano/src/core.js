/* ==========================================================================
 * 琴房 · core.js
 * 纯逻辑：音名 / 键盘几何与命中 / 曲谱 DSL / 伴奏生成 / 评分 / 音阶和弦 / 设置
 * 不碰 DOM、不碰 WebAudio，浏览器与 Node（tools/selftest.mjs）共用。
 * ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PianoCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ 音高 */

  var LOW_MIDI = 21;          // A0
  var HIGH_MIDI = 108;        // C8
  var SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  var SOLFEGE = ['do', 'di', 're', 'ri', 'mi', 'fa', 'fi', 'sol', 'si', 'la', 'li', 'ti'];
  var JIANPU = ['1', '#1', '2', '#2', '3', '4', '#4', '5', '#5', '6', '#6', '7'];
  var BLACK_PC = { 1: 1, 3: 1, 6: 1, 8: 1, 10: 1 };
  var BASE_SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function num(v, dflt) { var n = Number(v); return isFinite(n) ? n : dflt; }
  function pc(midi) { return ((midi % 12) + 12) % 12; }
  function octaveOf(midi) { return Math.floor(midi / 12) - 1; }
  function isBlackKey(midi) { return BLACK_PC[pc(midi)] === 1; }
  function midiToName(midi, flat) { return (flat ? FLAT : SHARP)[pc(midi)] + octaveOf(midi); }
  function midiToFreq(midi, a4) { return (a4 || 440) * Math.pow(2, (midi - 69) / 12); }

  function nameToMidi(name) {
    var m = /^([A-Ga-g])([#b♯♭]?)(-?\d+)$/.exec(String(name == null ? '' : name).trim());
    if (!m) return null;
    var semis = BASE_SEMI[m[1].toUpperCase()];
    if (m[2] === '#' || m[2] === '♯') semis += 1;
    else if (m[2] === 'b' || m[2] === '♭') semis -= 1;
    var oct = parseInt(m[3], 10);
    return semis + (oct + 1) * 12;
  }

  /** 键帽上的标签：name=音名 solfege=唱名 jianpu=简谱 none=不显示 */
  function noteLabel(midi, style) {
    if (!style || style === 'none') return '';
    if (style === 'solfege') return SOLFEGE[pc(midi)];
    if (style === 'jianpu') {
      var j = JIANPU[pc(midi)], o = octaveOf(midi), mark = '';
      if (o > 4) mark = new Array(o - 3).join("'");
      else if (o < 4) mark = new Array(5 - o).join(',');
      return j + mark;
    }
    return midiToName(midi);
  }

  function whiteKeys(low, high) {
    var out = [];
    low = low == null ? LOW_MIDI : low;
    high = high == null ? HIGH_MIDI : high;
    for (var m = low; m <= high; m++) if (!isBlackKey(m)) out.push(m);
    return out;
  }
  var ALL_WHITE = whiteKeys(LOW_MIDI, HIGH_MIDI);   // 52 个白键
  function allWhiteKeys() { return ALL_WHITE.slice(); }

  /* ------------------------------------------------------------ 键盘几何 */

  /* 黑键相对白键边界的水平偏移（单位：白键宽）——模仿真钢琴的分组 */
  var BLACK_OFFSET = { 0: -0.105, 2: 0.105, 5: -0.125, 7: 0, 9: 0.125 };

  /**
   * 计算一屏键盘的几何。坐标系：左上角为 (0,0)，单位 CSS px。
   * opts: { width, height, whiteCount, startWhite, blackRatio }
   */
  function layoutKeyboard(opts) {
    var width = Math.max(1, num(opts.width, 800));
    var height = Math.max(1, num(opts.height, 180));
    var whiteCount = clamp(Math.round(num(opts.whiteCount, 24)), 5, ALL_WHITE.length);
    var startWhite = clamp(Math.round(num(opts.startWhite, 0)), 0, ALL_WHITE.length - whiteCount);
    var whiteW = width / whiteCount;
    var blackW = whiteW * 0.62;
    var blackH = height * clamp(num(opts.blackRatio, 0.63), 0.4, 0.8);
    var whites = [], blacks = [], i, midi, p;
    for (i = 0; i < whiteCount; i++) {
      midi = ALL_WHITE[startWhite + i];
      whites.push({ midi: midi, x: i * whiteW, y: 0, w: whiteW, h: height, index: i });
      p = pc(midi);
      /* 只有当右侧那个白键也在视窗里，黑键才画得出来（否则会半截出屏） */
      if (i + 1 < whiteCount && BLACK_OFFSET[p] !== undefined && ALL_WHITE[startWhite + i + 1] === midi + 2) {
        blacks.push({
          midi: midi + 1,
          x: (i + 1) * whiteW + BLACK_OFFSET[p] * whiteW - blackW / 2,
          y: 0, w: blackW, h: blackH
        });
      }
    }
    var map = {};
    whites.forEach(function (k) { map[k.midi] = k; });
    blacks.forEach(function (k) { map[k.midi] = k; });
    return {
      width: width, height: height, whiteW: whiteW, blackW: blackW, blackH: blackH,
      whites: whites, blacks: blacks, map: map,
      startWhite: startWhite, whiteCount: whiteCount,
      lowMidi: whites[0].midi,
      highMidi: whites[whites.length - 1].midi,
      endWhite: startWhite + whiteCount - 1
    };
  }

  /** 命中测试：黑键优先（它在白键之上），返回 midi 或 null */
  function hitTestKey(layout, x, y) {
    if (!layout || !(x >= 0) || x > layout.width || y < 0 || y > layout.height) return null;
    var i, k;
    if (y <= layout.blackH) {
      for (i = 0; i < layout.blacks.length; i++) {
        k = layout.blacks[i];
        if (x >= k.x && x < k.x + k.w) return k.midi;
      }
    }
    var idx = Math.floor(x / layout.whiteW);
    if (idx < 0 || idx >= layout.whites.length) return null;
    return layout.whites[idx].midi;
  }

  /** 键的中心点（调试 / 自动化测试 / 指法提示用） */
  function keyCenter(layout, midi) {
    var k = layout.map[midi];
    if (!k) return null;
    return { x: k.x + k.w / 2, y: k.y + k.h * 0.78 };
  }

  function rangeLabel(layout) {
    if (!layout) return '';
    var hi = layout.highMidi;
    if (layout.blacks.length) hi = Math.max(hi, layout.blacks[layout.blacks.length - 1].midi);
    return midiToName(layout.lowMidi) + '–' + midiToName(hi);
  }

  /**
   * 按可用宽度算出「显示多少个白键」，保证每个白键不窄于 minKeyWidth。
   * 触摸屏上键太窄很难按，这是默认视窗的依据。
   */
  function fitWhiteCount(availableWidth, minKeyWidth) {
    var min = Math.max(1, num(minKeyWidth, 100));
    return clamp(Math.floor(num(availableWidth, 800) / min), 7, ALL_WHITE.length);
  }

  /** 把一段 midi 区间套进视窗（返回 {startWhite, whiteCount}） */
  function fitRange(lowMidi, highMidi, maxWhite) {
    var wiLow = 0, i;
    for (i = 0; i < ALL_WHITE.length; i++) { if (ALL_WHITE[i] >= lowMidi) { wiLow = i; break; } }
    if (wiLow > 0 && ALL_WHITE[wiLow - 1] >= lowMidi) wiLow -= 1;
    var wiHigh = wiLow;
    while (wiHigh + 1 < ALL_WHITE.length && ALL_WHITE[wiHigh] < highMidi) wiHigh++;
    var need = wiHigh - wiLow + 1;
    /* 左边多留一个白键做余量，宽度也要跟着加 1，否则最高音会掉出视窗 */
    var count = clamp(Math.max(need + 1, 14), 7, Math.min(ALL_WHITE.length, maxWhite || ALL_WHITE.length));
    var start = clamp(wiLow - 1, 0, ALL_WHITE.length - count);
    return { startWhite: start, whiteCount: count };
  }

  /* --------------------------------------------------------------- 曲谱 DSL */

  /* 记谱：C4:1  D#5:0.5  -:2  （音名:拍数，- 表示休止），用 | 分隔小节 */
  var TOKEN = /^(-|[A-Ga-g][#b]?-?\d+)(?::([0-9.]+))?$/;

  function parseMelody(text) {
    var measures = [];
    String(text || '').split('|').forEach(function (chunk) {
      var raw = chunk.trim();
      if (!raw) return;
      var notes = [], at = 0;
      raw.split(/\s+/).forEach(function (tok) {
        if (!tok) return;
        var m = TOKEN.exec(tok);
        if (!m) throw new Error('无法解析的音符：' + tok);
        var dur = m[2] ? parseFloat(m[2]) : 1;
        if (!(dur > 0)) throw new Error('时值必须大于 0：' + tok);
        if (m[1] !== '-') {
          var midi = nameToMidi(m[1]);
          if (midi == null) throw new Error('无法解析的音名：' + tok);
          if (midi < LOW_MIDI || midi > HIGH_MIDI) throw new Error('超出钢琴音域：' + tok);
          notes.push({ midi: midi, name: m[1], start: at, beats: dur });
        }
        at += dur;
      });
      measures.push({ notes: notes, beats: at });
    });
    return measures;
  }

  /* 和弦记号：C / Cm / C7 / Cmaj7 / Cm7 / Cdim / Caug / Csus4 / C6 / Cm6 / C9 / Cm7b5 */
  var CHORD_QUALITY = {
    '': [0, 4, 7], 'maj': [0, 4, 7], 'M': [0, 4, 7],
    'm': [0, 3, 7], 'min': [0, 3, 7],
    'dim': [0, 3, 6], 'o': [0, 3, 6],
    'aug': [0, 4, 8], '+': [0, 4, 8],
    'sus4': [0, 5, 7], 'sus2': [0, 2, 7],
    '6': [0, 4, 7, 9], 'm6': [0, 3, 7, 9],
    '7': [0, 4, 7, 10], 'dom7': [0, 4, 7, 10],
    'maj7': [0, 4, 7, 11], 'M7': [0, 4, 7, 11],
    'm7': [0, 3, 7, 10], 'min7': [0, 3, 7, 10],
    'm7b5': [0, 3, 6, 10], 'dim7': [0, 3, 6, 9],
    'add9': [0, 4, 7, 14], '9': [0, 4, 7, 10, 14]
  };

  function parseChord(sym) {
    var m = /^([A-G])([#b]?)([A-Za-z0-9+\-]*)$/.exec(String(sym == null ? '' : sym).trim());
    if (!m) return null;
    var root = BASE_SEMI[m[1]];
    if (m[2] === '#') root += 1; else if (m[2] === 'b') root -= 1;
    var iv = CHORD_QUALITY[m[3]];
    if (!iv) return null;
    return {
      name: m[1] + m[2] + m[3],
      rootPc: pc(root),
      intervals: iv.slice()
    };
  }

  /** 把和弦放在指定八度（默认 4），返回 midi 列表 */
  function chordVoicing(sym, octave) {
    var c = parseChord(sym);
    if (!c) return null;
    var root = ((octave == null ? 4 : octave) + 1) * 12 + c.rootPc;
    return {
      name: c.name, rootPc: c.rootPc, root: root,
      midis: c.intervals.map(function (iv) { return root + iv; })
    };
  }

  /* 左手伴奏型：alberti 阿尔贝蒂 / block 柱式 / arp 琶音 / waltz 圆舞曲 */
  function accompaniment(chord, startBeat, beats, pattern) {
    var out = [];
    if (!chord || !(beats > 0) || !pattern || pattern === 'none') return out;
    var root = 36 + chord.rootPc;              // C2..B2，左手低音区
    var tones = chord.intervals.map(function (iv) { return root + iv; });
    var s, k, seq;

    if (pattern === 'block') {
      tones.forEach(function (midi) {
        out.push({ midi: midi, start: startBeat, dur: beats * 0.95, hand: 'L', vel: 0.6 });
      });
      return out;
    }
    if (pattern === 'waltz') {
      out.push({ midi: tones[0], start: startBeat, dur: Math.min(1, beats) * 0.9, hand: 'L', vel: 0.62 });
      for (var b = 1; b < beats - 1e-6 && b <= 2; b++) {
        [tones[1], tones[2]].forEach(function (midi) {
          if (midi != null) out.push({ midi: midi, start: startBeat + b, dur: 0.82, hand: 'L', vel: 0.48 });
        });
      }
      return out;
    }
    if (pattern === 'arp') {
      seq = [tones[0], tones[1] != null ? tones[1] : tones[0], tones.length > 3 ? tones[3] : tones[2], tones[0] + 12];
      k = 0;
      for (s = 0; s < beats - 1e-6; s += 0.5) {
        out.push({ midi: seq[k % seq.length], start: startBeat + s, dur: 0.46, hand: 'L', vel: k === 0 ? 0.58 : 0.48 });
        k++;
      }
      return out;
    }
    /* alberti：根-五-三-五 */
    seq = [tones[0], tones[2] != null ? tones[2] : tones[0], tones[1], tones[2] != null ? tones[2] : tones[0]];
    k = 0;
    for (s = 0; s < beats - 1e-6; s += 0.5) {
      out.push({ midi: seq[k % seq.length], start: startBeat + s, dur: 0.46, hand: 'L', vel: 0.5 });
      k++;
    }
    return out;
  }

  /**
   * 编译一首曲子：右手旋律 + 左手伴奏，返回拍/秒两套时间。
   * song: { id,title,composer,level,bpm,timeSig,key,melody,left,pattern }
   */
  function compileSong(song) {
    if (!song || typeof song.melody !== 'string') throw new Error('曲子缺少 melody');
    var measures = parseMelody(song.melody);
    if (!measures.length) throw new Error('曲子没有小节');
    var chords = String(song.left || '').split('|').map(function (s) { return s.trim(); }).filter(Boolean);
    var pattern = song.pattern || 'alberti';
    var bpm = num(song.bpm, 96);
    var notes = [], span = [], t = 0;

    measures.forEach(function (meas, i) {
      var sym = chords.length ? chords[i % chords.length] : null;
      var chord = sym ? parseChord(sym) : null;
      span.push({ index: i, start: t, beats: meas.beats, chord: chord ? chord.name : (sym || '') });
      meas.notes.forEach(function (n) {
        notes.push({ midi: n.midi, start: t + n.start, dur: n.beats, hand: 'R', vel: 0.8, measure: i });
      });
      accompaniment(chord, t, meas.beats, pattern).forEach(function (n) {
        n.measure = i;
        notes.push(n);
      });
      t += meas.beats;
    });

    notes.sort(function (a, b) { return a.start - b.start || a.midi - b.midi; });
    var lo = 127, hi = 0;
    notes.forEach(function (n) { if (n.midi < lo) lo = n.midi; if (n.midi > hi) hi = n.midi; });
    var hasLeft = notes.some(function (n) { return n.hand === 'L'; });

    return {
      id: song.id, title: song.title || song.id, composer: song.composer || '',
      level: num(song.level, 1), bpm: bpm, timeSig: song.timeSig || [4, 4], key: song.key || 'C',
      pattern: pattern, notes: notes, measures: span,
      beats: t, duration: t * 60 / bpm, noteRange: [lo, hi], hasLeft: hasLeft,
      chordLine: chords.slice(), source: song
    };
  }

  /** 曲谱体检：给 selftest / 启动自检用 */
  function lintSong(song) {
    var issues = [];
    try {
      var c = compileSong(song);
      if (!c.notes.length) issues.push('没有音符');
      if (c.chordLine.length && (song.pattern || 'alberti') !== 'none' && !c.hasLeft) issues.push('左手没有生成音符');
      var bad = c.notes.filter(function (n) { return n.midi < LOW_MIDI || n.midi > HIGH_MIDI; });
      if (bad.length) issues.push('越界音符 ' + bad.length + ' 个');
      c.measures.forEach(function (m) {
        if (!(m.beats > 0)) issues.push('第 ' + (m.index + 1) + ' 小节为空');
      });
      c.chordLine.forEach(function (sym) {
        if (!parseChord(sym)) issues.push('和弦记号无法解析：' + sym);
      });
      if (!(c.duration > 0)) issues.push('时长必须大于 0');
    } catch (e) {
      issues.push(e && e.message ? e.message : String(e));
    }
    return issues;
  }

  /* ---------------------------------------------------------------- 评分 */

  var JUDGE_WINDOWS = [
    { grade: 'perfect', window: 0.055, points: 100, label: '完美' },
    { grade: 'great', window: 0.11, points: 80, label: '很好' },
    { grade: 'good', window: 0.19, points: 55, label: '不错' }
  ];
  var MISS_WINDOW = 0.19;

  /** 输入：与目标音的秒差（可为负，表示抢拍） */
  function judgeTiming(deltaSec) {
    var abs = Math.abs(deltaSec);
    for (var i = 0; i < JUDGE_WINDOWS.length; i++) {
      if (abs <= JUDGE_WINDOWS[i].window) {
        return { grade: JUDGE_WINDOWS[i].grade, label: JUDGE_WINDOWS[i].label, points: JUDGE_WINDOWS[i].points, abs: abs };
      }
    }
    return { grade: 'miss', label: '漏掉', points: 0, abs: abs };
  }

  /** 由 perfect/great/good/miss 计数算准确率（0-100） */
  function accuracy(counts) {
    var judged = (counts.perfect || 0) + (counts.great || 0) + (counts.good || 0) + (counts.miss || 0);
    if (!judged) return 100;
    var weighted = (counts.perfect || 0) * 1 + (counts.great || 0) * 0.85 + (counts.good || 0) * 0.6;
    return Math.round((weighted / judged) * 1000) / 10;
  }

  function gradeOf(acc) {
    return acc >= 96 ? 'S' : acc >= 90 ? 'A' : acc >= 80 ? 'B' : acc >= 68 ? 'C' : 'D';
  }

  function fmtTime(sec) {
    sec = Math.max(0, Number(sec) || 0);
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ------------------------------------------------------------ 音阶和弦 */

  var SCALES = {
    major: { name: '大调', intervals: [0, 2, 4, 5, 7, 9, 11] },
    minor: { name: '自然小调', intervals: [0, 2, 3, 5, 7, 8, 10] },
    harmonic: { name: '和声小调', intervals: [0, 2, 3, 5, 7, 8, 11] },
    penta: { name: '五声音阶', intervals: [0, 2, 4, 7, 9] },
    blues: { name: '布鲁斯', intervals: [0, 3, 5, 6, 7, 10] }
  };

  var CHORD_TEMPLATES = {
    maj: { name: '大三和弦', intervals: [0, 4, 7] },
    min: { name: '小三和弦', intervals: [0, 3, 7] },
    dim: { name: '减三和弦', intervals: [0, 3, 6] },
    aug: { name: '增三和弦', intervals: [0, 4, 8] },
    sus4: { name: '挂四和弦', intervals: [0, 5, 7] },
    dom7: { name: '属七和弦', intervals: [0, 4, 7, 10] },
    maj7: { name: '大七和弦', intervals: [0, 4, 7, 11] },
    min7: { name: '小七和弦', intervals: [0, 3, 7, 10] }
  };

  /** 音阶：上行（含高八度主音）→ 下行 */
  function buildScale(rootPc, type, octave) {
    var sc = SCALES[type] || SCALES.major;
    var oct = octave == null ? 4 : octave;
    var base = (oct + 1) * 12 + pc(rootPc);
    var up = sc.intervals.map(function (iv) { return base + iv; });
    up.push(base + 12);
    var down = up.slice(0, up.length - 1).reverse();
    return {
      name: midiToName(base, true) + ' ' + sc.name,
      up: up, down: down, seq: up.concat(down)
    };
  }

  function buildChord(rootPc, type, octave) {
    var tpl = CHORD_TEMPLATES[type] || CHORD_TEMPLATES.maj;
    var oct = octave == null ? 4 : octave;
    var base = (oct + 1) * 12 + pc(rootPc);
    return {
      name: midiToName(base, true) + (type === 'maj' ? '' : ' ' + tpl.name),
      midis: tpl.intervals.map(function (iv) { return base + iv; }),
      root: base, type: type
    };
  }

  /** 和弦进行的每一步：{ name, midis }，默认第 4 八度（都在可见范围内） */
  function buildProgression(symbols, octave) {
    return (symbols || []).map(function (sym) {
      var v = chordVoicing(sym, octave == null ? 4 : octave);
      if (!v) return null;
      return { name: sym, midis: v.midis };
    }).filter(Boolean);
  }

  /* -------------------------------------------------------------- 设置 */

  var SETTINGS_KEY = 'piano-studio/settings/v1';
  var BEST_KEY = 'piano-studio/best/v1';

  var DEFAULT_SETTINGS = {
    volume: 0.78,
    reverb: 0.3,
    label: 'name',
    velocity: 'touch',      // touch=按触点位置 touch 力度 / fixed=固定力度
    whiteCount: 0,          // 0 = 自动（按屏幕宽度算，键更宽）
    startWhite: -1,         // -1 = 以中央 C 为中心
    pedal: false,
    metro: false,
    bpm: 92,
    tempo: 100,             // 跟弹速度百分比
    hands: 'both',
    otherHand: true,
    lead: 2.4,              // 瀑布流可视提前量（秒）
    theme: 'auto',
    midiOut: false,
    /* 各模式的具体选项 */
    songId: 'twinkle',
    noteScope: 'visible',
    noteRounds: '20',
    noteTime: '6',
    scaleRoot: 0,
    scaleType: 'major',
    scaleDir: 'both',
    progId: 'canon-c',
    progBeats: '4',
    progLoops: '2'
  };

  function normalizeSettings(raw) {
    var s = {};
    Object.keys(DEFAULT_SETTINGS).forEach(function (k) {
      s[k] = raw && raw[k] !== undefined ? raw[k] : DEFAULT_SETTINGS[k];
    });
    s.volume = clamp(num(s.volume, 0.78), 0, 1);
    s.reverb = clamp(num(s.reverb, 0.3), 0, 1);
    s.label = ['name', 'solfege', 'jianpu', 'none'].indexOf(s.label) >= 0 ? s.label : 'name';
    s.velocity = s.velocity === 'fixed' ? 'fixed' : 'touch';
    /* whiteCount = 0 表示「自动」：按屏幕宽度自适应，保证键够宽 */
    s.whiteCount = clamp(Math.round(num(s.whiteCount, 0)), 0, ALL_WHITE.length);
    if (s.whiteCount > 0) s.whiteCount = clamp(s.whiteCount, 7, ALL_WHITE.length);
    /* startWhite = -1 表示「以中央 C 为中心」（默认，视窗随键宽自适应） */
    s.startWhite = Math.round(num(s.startWhite, -1));
    if (s.startWhite >= 0) s.startWhite = clamp(s.startWhite, 0, ALL_WHITE.length - s.whiteCount);
    s.pedal = !!s.pedal;
    s.metro = !!s.metro;
    s.bpm = clamp(Math.round(num(s.bpm, 92)), 30, 240);
    s.tempo = clamp(Math.round(num(s.tempo, 100)), 40, 140);
    s.hands = ['both', 'right', 'left'].indexOf(s.hands) >= 0 ? s.hands : 'both';
    s.otherHand = !!s.otherHand;
    s.lead = clamp(num(s.lead, 2.4), 1.2, 4.5);
    s.theme = ['auto', 'dark', 'light'].indexOf(s.theme) >= 0 ? s.theme : 'auto';
    s.midiOut = !!s.midiOut;
    s.songId = String(s.songId || 'twinkle');
    s.noteScope = ['visible', 'all', 'white'].indexOf(s.noteScope) >= 0 ? s.noteScope : 'visible';
    s.noteRounds = ['10', '20', '30'].indexOf(String(s.noteRounds)) >= 0 ? String(s.noteRounds) : '20';
    s.noteTime = ['4', '6', '9'].indexOf(String(s.noteTime)) >= 0 ? String(s.noteTime) : '6';
    s.scaleRoot = clamp(Math.round(num(s.scaleRoot, 0)), 0, 11);
    s.scaleType = SCALES[s.scaleType] ? s.scaleType : 'major';
    s.scaleDir = ['up', 'both'].indexOf(s.scaleDir) >= 0 ? s.scaleDir : 'both';
    s.progId = String(s.progId || 'canon-c');
    s.progBeats = ['2', '4', '8'].indexOf(String(s.progBeats)) >= 0 ? String(s.progBeats) : '4';
    s.progLoops = ['1', '2', '4'].indexOf(String(s.progLoops)) >= 0 ? String(s.progLoops) : '2';
    return s;
  }

  /* ------------------------------------------------------------- 导出 */

  return {
    LOW_MIDI: LOW_MIDI, HIGH_MIDI: HIGH_MIDI,
    ALL_WHITE: ALL_WHITE,
    JUDGE_WINDOWS: JUDGE_WINDOWS, MISS_WINDOW: MISS_WINDOW,
    SCALES: SCALES, CHORD_TEMPLATES: CHORD_TEMPLATES,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS, SETTINGS_KEY: SETTINGS_KEY, BEST_KEY: BEST_KEY,
    clamp: clamp, num: num, pc: pc, octaveOf: octaveOf,
    isBlackKey: isBlackKey, midiToName: midiToName, midiToFreq: midiToFreq,
    nameToMidi: nameToMidi, noteLabel: noteLabel,
    whiteKeys: whiteKeys, allWhiteKeys: allWhiteKeys,
    layoutKeyboard: layoutKeyboard, hitTestKey: hitTestKey, keyCenter: keyCenter,
    fitWhiteCount: fitWhiteCount,
    whiteIndexOf: function (midi) {
      for (var i = 0; i < ALL_WHITE.length; i++) if (ALL_WHITE[i] >= midi) return i;
      return ALL_WHITE.length - 1;
    },
    rangeLabel: rangeLabel, fitRange: fitRange,
    parseMelody: parseMelody, parseChord: parseChord, chordVoicing: chordVoicing,
    accompaniment: accompaniment, compileSong: compileSong, lintSong: lintSong,
    judgeTiming: judgeTiming, accuracy: accuracy, gradeOf: gradeOf, fmtTime: fmtTime,
    buildScale: buildScale, buildChord: buildChord, buildProgression: buildProgression,
    normalizeSettings: normalizeSettings
  };
});
