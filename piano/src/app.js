/* ==========================================================================
 * 琴房 · app.js —— 主控制器
 *
 *  模式：自由弹奏 / 跟弹练习 / 认键练习 / 音阶和弦
 *  输入：多点触摸（Pointer Events）、电脑键盘、MIDI 输出、录音回放
 *  状态：localStorage 持久化设置与最佳成绩
 * ========================================================================== */
(function () {
  'use strict';

  var Core = window.PianoCore;
  var Songs = window.PianoSongs;
  var Practice = window.PianoPractice;
  var Audio = window.PianoAudio;
  var View = window.PianoView;

  /* ------------------------------------------------------------ DOM */

  var $ = function (id) { return document.getElementById(id); };
  var elStage = $('stage');
  var elStageCanvas = $('stageCanvas');
  var elKeysCanvas = $('keysCanvas');
  var elMiniCanvas = $('miniCanvas');
  var elTabs = $('tabs');
  var elPanel = $('panel');
  var elHud = $('hud');
  var elJudge = $('judge');
  var elOverlay = $('overlay');
  var elCountdown = $('countdown');
  var elProgress = $('progress');
  var elProgressBar = elProgress.querySelector('i');
  var elToast = $('toast');
  var elStatus = $('statusbar');
  var elStAudio = $('stAudio');
  var elStVoice = $('stVoice');
  var elStMidi = $('stMidi');

  /* ---------------------------------------------------------- 状态 */

  var settings = loadSettings();
  var mode = 'free';
  var songCache = {};
  var session = null;        // 当前练习会话
  var sessionKind = null;    // 'song' | 'note' | 'scale' | 'chord'
  var running = false;
  var autoNotes = [];        // 自动伴奏手的发声音符
  var midiOut = null;
  var harmonyTab = 'scale';
  var lastStageSig = '';

  var record = {
    active: false,
    clip: [],                // {midi, vel, on, off}
    startedAt: 0,
    playing: false,
    playTimers: []
  };

  var KEY_MAP = buildKeyMap();

  /* ------------------------------------------------------ 设置存取 */

  function loadSettings() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(Core.SETTINGS_KEY) || 'null'); } catch (e) { raw = null; }
    var s = Core.normalizeSettings(raw);
    applyTheme(s.theme);
    return s;
  }

  function saveSettings() {
    try { localStorage.setItem(Core.SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* 无痕模式忽略 */ }
  }

  function loadBest() {
    try { return JSON.parse(localStorage.getItem(Core.BEST_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveBest(b) {
    try { localStorage.setItem(Core.BEST_KEY, JSON.stringify(b)); } catch (e) { /* ignore */ }
  }
  var best = loadBest();

  function applyTheme(theme) {
    var t = theme;
    if (t === 'auto') {
      t = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    document.documentElement.setAttribute('data-theme', t);
  }

  /* --------------------------------------------------------- 提示条 */

  var toastTimer = 0;
  function toast(msg, ms) {
    elToast.textContent = msg;
    elToast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { elToast.classList.remove('show'); }, ms || 2200);
  }

  /* ------------------------------------------------------ 音符入口 */

  /** 所有发声都走这里：UI、录音、MIDI、判定共用 */
  function noteOn(midi, velocity, source) {
    if (midi == null) return;
    velocity = velocity == null ? 0.8 : velocity;
    ensureAudio();
    Audio.Engine.noteOn(midi, velocity);
    sendMidi(midi, velocity, 0x90);
    if (record.active) record.clip.push({ midi: midi, vel: velocity, on: performance.now(), off: null });

    if (sessionKind === 'song' && session) {
      var res = session.press(midi);
      if (res) handleJudge(res);
    } else if (sessionKind === 'note' && session) {
      var r2 = session.press(midi);
      if (r2) {
        if (r2.ok) {
          flashJudge('perfect', '答对');
          updateNoteHud();
        } else {
          flashJudge('wrong', '不是这个音');
        }
      }
    } else if (sessionKind === 'scale' && session) {
      var r3 = session.press(midi);
      if (r3) {
        if (r3.ok) {
          flashJudge('perfect', '');
          updateScaleHint();
          if (r3.done) finishScale();
        } else {
          flashJudge('wrong', '应按 ' + Core.midiToName(r3.expected));
        }
      }
    } else if (sessionKind === 'chord' && session) {
      var r4 = session.press(midi);
      if (r4) {
        if (r4.complete) {
          flashJudge('perfect', r4.chord + ' ✓');
          updateChordHint();
        } else if (r4.wrong) {
          flashJudge('wrong', '不是 ' + r4.chord + ' 的音');
        }
      }
    }
  }

  function noteOff(midi, source) {
    if (midi == null) return;
    Audio.Engine.noteOff(midi);
    sendMidi(midi, 0, 0x80);
    if (record.active) {
      for (var i = record.clip.length - 1; i >= 0; i--) {
        if (record.clip[i].midi === midi && record.clip[i].off == null) {
          record.clip[i].off = performance.now();
          break;
        }
      }
    }
    if (sessionKind === 'chord' && session) session.release(midi);
  }

  /* ------------------------------------------------------- 判定反馈 */

  function handleJudge(res) {
    if (res.type === 'hit') {
      if (res.note) res.note.hitTime = session ? session.t : 0;
      flashJudge(res.grade, res.label);
    } else if (res.type === 'miss') {
      flashJudge('miss', '漏掉了');
    } else if (res.type === 'wrong') {
      flashJudge('wrong', '太早了');
    }
  }

  var judgeTimer = 0;
  function flashJudge(kind, text) {
    if (!elJudge) return;
    elJudge.className = 'judge ' + kind;
    elJudge.textContent = text || '';
    void elJudge.offsetWidth;                 // 重启动画
    elJudge.classList.add('show');
    clearTimeout(judgeTimer);
    judgeTimer = setTimeout(function () { elJudge.classList.remove('show'); }, 560);
  }

  /* --------------------------------------------------------- 音频 */

  var audioReady = false;
  function ensureAudio() {
    if (audioReady) return;
    if (!Audio.supported()) {
      elStAudio.innerHTML = '<span class="dot off"></span>浏览器不支持 WebAudio';
      return;
    }
    Audio.Engine.ensure();
    Audio.Engine.setVolume(settings.volume);
    Audio.Engine.setReverb(settings.reverb);
    audioReady = true;
    refreshAudioStatus();
  }

  function refreshAudioStatus() {
    var st = Audio.Engine.state();
    var ok = st === 'running';
    elStAudio.innerHTML = '<span class="dot ' + (ok ? 'on' : 'off') + '"></span>音频 ' +
      (st === 'none' ? '未启动' : st === 'suspended' ? '已暂停（点一下键盘）' : '运行中');
    elStVoice.innerHTML = '复音 <b>' + Audio.Engine.voiceCount() + '</b>';
  }

  /* --------------------------------------------------------- MIDI */

  /* 不在启动时调用 requestMIDIAccess —— 浏览器会弹权限框挡住界面。
     改成用户点状态栏的 MIDI 文字才申请。 */
  function initMidi() {
    if (!navigator.requestMIDIAccess) {
      elStMidi.textContent = 'MIDI 不支持';
      elStMidi.disabled = true;
      return;
    }
    elStMidi.textContent = 'MIDI 未连接（点击连接）';
  }

  function connectMidi() {
    if (!navigator.requestMIDIAccess) { toast('此浏览器不支持 MIDI 输出'); return; }
    elStMidi.textContent = 'MIDI 连接中…';
    navigator.requestMIDIAccess().then(function (access) {
      function pick() {
        var outs = [];
        access.outputs.forEach(function (o) { outs.push(o); });
        if (!outs.length) {
          elStMidi.textContent = 'MIDI 无输出设备';
          midiOut = null;
          return;
        }
        midiOut = outs[0];
        outs.forEach(function (o) { o.onstatechange = pick; });
        elStMidi.textContent = 'MIDI ' + (midiOut.name || '已连接');
      }
      access.onstatechange = pick;
      pick();
    }).catch(function () {
      elStMidi.textContent = 'MIDI 未授权';
    });
  }

  function sendMidi(midi, vel, status) {
    if (!midiOut) return;
    try {
      midiOut.send([status, midi, Math.max(0, Math.min(127, Math.round(vel * 127)))]);
    } catch (e) { /* 设备断开忽略 */ }
  }

  /* --------------------------------------------------- 电脑键盘映射 */

  function buildKeyMap() {
    /* 下排白键 z x c v b n m，下排黑键 s d g h j；上排白键 q w e r t y u，上排黑键 2 3 5 6 7 */
    var lower = { z: 0, x: 2, c: 4, v: 5, b: 7, n: 9, m: 11, s: 1, d: 3, g: 6, h: 8, j: 10 };
    var upper = { q: 12, w: 14, e: 16, r: 17, t: 19, y: 21, u: 23, 2: 13, 3: 15, 5: 18, 6: 20, 7: 22 };
    var map = {};
    Object.keys(lower).forEach(function (k) { map[k] = lower[k]; });
    Object.keys(upper).forEach(function (k) { map[k] = upper[k]; });
    return map;
  }

  var kbBase = 48;              // C3
  var kbDown = {};

  window.addEventListener('keydown', function (e) {
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key.toLowerCase();
    if (k === ' ' || e.code === 'Space') {
      e.preventDefault();
      if (!kbDown.__pedal) {
        kbDown.__pedal = true;
        ensureAudio();
        Audio.Engine.pedal(true);
      }
      return;
    }
    if (k === 'escape') { stopSession(); return; }
    if (k === '[') { shiftOctave(-1); return; }
    if (k === ']') { shiftOctave(1); return; }
    if (k === 'r') { toggleRecord(); return; }
    if (!(k in KEY_MAP)) return;
    e.preventDefault();
    if (kbDown[k]) return;
    kbDown[k] = true;
    var midi = clampMidi(kbBase + KEY_MAP[k]);
    View.setPressed(midi, true);
    noteOn(midi, 0.78, 'keyboard');
  });

  window.addEventListener('keyup', function (e) {
    var k = e.key.toLowerCase();
    if (k === ' ' || e.code === 'Space') {
      kbDown.__pedal = false;
      Audio.Engine.pedal(false);
      return;
    }
    if (!(k in KEY_MAP)) return;
    if (!kbDown[k]) return;
    delete kbDown[k];
    var midi = clampMidi(kbBase + KEY_MAP[k]);
    View.setPressed(midi, false);
    noteOff(midi, 'keyboard');
  });

  function clampMidi(m) { return Math.max(Core.LOW_MIDI, Math.min(Core.HIGH_MIDI, m)); }
  function shiftOctave(d) {
    kbBase = clampMidi(kbBase + d * 12);
    toast('电脑键盘八度：' + Core.midiToName(kbBase));
  }

  /* ------------------------------------------------------- 模式切换 */

  function setMode(next) {
    if (mode === next) return;
    stopSession();
    mode = next;
    Array.prototype.forEach.call(elTabs.querySelectorAll('.tab'), function (t) {
      t.setAttribute('aria-selected', String(t.dataset.mode === next));
    });
    View.setMode(next);
    elHud.innerHTML = '';
    elJudge.className = 'judge';
    elOverlay.hidden = true;
    elProgress.hidden = true;
    elCountdown.hidden = true;
    buildPanel();
    updateStageState();
  }

  elTabs.addEventListener('click', function (e) {
    var t = e.target.closest('.tab');
    if (t) setMode(t.dataset.mode);
  });

  /* --------------------------------------------------------- 面板 */

  function buildPanel() {
    elPanel.innerHTML = '';
    if (mode === 'free') buildFreePanel();
    else if (mode === 'song') buildSongPanel();
    else if (mode === 'note') buildNotePanel();
    else if (mode === 'harmony') buildHarmonyPanel();
  }

  function field(labelText, control) {
    var f = document.createElement('div');
    f.className = 'field';
    var l = document.createElement('label');
    l.textContent = labelText;
    f.appendChild(l);
    f.appendChild(control);
    return f;
  }

  function select(options, value, onChange) {
    var s = document.createElement('select');
    options.forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = String(o.value);
      opt.textContent = o.label;
      if (String(o.value) === String(value)) opt.selected = true;
      s.appendChild(opt);
    });
    s.addEventListener('change', function () { onChange(s.value); });
    return s;
  }

  function button(label, cls, onClick) {
    var b = document.createElement('button');
    b.className = 'btn ' + (cls || '');
    b.textContent = label;
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  function range(min, max, step, value, onInput) {
    var r = document.createElement('input');
    r.type = 'range';
    r.min = min; r.max = max; r.step = step; r.value = value;
    r.addEventListener('input', function () { onInput(Number(r.value)); });
    return r;
  }

  function hintSpan(text) {
    var s = document.createElement('span');
    s.className = 'hintline';
    s.textContent = text;
    return s;
  }

  /* ---- 自由弹奏 ---- */

  function buildFreePanel() {
    var vol = range(0, 100, 1, Math.round(settings.volume * 100), function (v) {
      settings.volume = v / 100;
      Audio.Engine.setVolume(settings.volume);
      saveSettings();
    });
    var rev = range(0, 100, 1, Math.round(settings.reverb * 100), function (v) {
      settings.reverb = v / 100;
      Audio.Engine.setReverb(settings.reverb);
      saveSettings();
    });
    var labelSel = select([
      { value: 'name', label: '音名 C4' },
      { value: 'solfege', label: '唱名 do' },
      { value: 'jianpu', label: '简谱 1' },
      { value: 'none', label: '不显示' }
    ], settings.label, function (v) {
      settings.label = v;
      View.setLabelStyle(v);
      saveSettings();
    });
    var metro = document.createElement('input');
    metro.type = 'checkbox';
    metro.checked = settings.metro;
    metro.addEventListener('change', function () {
      settings.metro = metro.checked;
      toggleMetronome();
      saveSettings();
    });

    elPanel.appendChild(field('音量', vol));
    elPanel.appendChild(field('混响', rev));
    elPanel.appendChild(field('键名', labelSel));
    elPanel.appendChild(field('节拍器', metro));
    elPanel.appendChild(button('录制', '', function () { toggleRecord(); }));
    elPanel.appendChild(button('回放', '', function () { playRecording(); }));
    elPanel.appendChild(button('清除录音', 'danger', function () {
      record.clip = [];
      toast('已清除录音');
    }));
    elPanel.appendChild(hintSpan('多点触摸可直接叠出和弦；按住不放左右拖是滑键。'));
  }

  /* ---- 跟弹练习 ---- */

  function buildSongPanel() {
    var songOpts = Songs.SONGS.map(function (s) {
      return { value: s.id, label: s.title + '（' + s.composer + '·Lv' + s.level + '）' };
    });
    var songSel = select(songOpts, settings.songId, function (v) {
      settings.songId = v;
      saveSettings();
      if (sessionKind === 'song') startSong();
      else updateBestBox();
    });
    var tempo = range(40, 140, 5, settings.tempo, function (v) {
      settings.tempo = v;
      saveSettings();
      if (sessionKind === 'song') startSong();
      updateTempoLabel();
    });
    var tempoTxt = document.createElement('b');
    tempoTxt.id = 'tempoTxt';
    tempoTxt.textContent = settings.tempo + '%';

    var handsSel = select([
      { value: 'both', label: '双手' },
      { value: 'right', label: '只练右手' },
      { value: 'left', label: '只练左手' }
    ], settings.hands, function (v) {
      settings.hands = v;
      saveSettings();
      if (sessionKind === 'song') startSong();
    });

    var autoBox = document.createElement('input');
    autoBox.type = 'checkbox';
    autoBox.checked = settings.otherHand;
    autoBox.addEventListener('change', function () {
      settings.otherHand = autoBox.checked;
      saveSettings();
      if (sessionKind === 'song') startSong();
    });

    var startBtn = button(sessionKind === 'song' ? '停止' : '开始跟弹',
      sessionKind === 'song' ? 'danger' : 'primary', function () {
        if (sessionKind === 'song') stopSession(); else startSong();
      });
    startBtn.id = 'songStart';

    var bestBox = document.createElement('span');
    bestBox.className = 'best';
    bestBox.id = 'songBest';

    elPanel.appendChild(field('曲目', songSel));
    elPanel.appendChild(field('速度', tempo));
    elPanel.appendChild(tempoTxt);
    elPanel.appendChild(field('练习手', handsSel));
    elPanel.appendChild(field('另一手自动伴奏', autoBox));
    elPanel.appendChild(startBtn);
    elPanel.appendChild(bestBox);
    updateBestBox();
  }

  function updateTempoLabel() {
    var b = $('tempoTxt');
    if (b) b.textContent = settings.tempo + '%';
  }

  function updateBestBox() {
    var box = $('songBest');
    if (!box) return;
    var rec = best[settings.songId];
    box.innerHTML = rec ? ('最佳 <b>' + rec.grade + '</b> ' + rec.accuracy + '%') : '暂无记录';
  }

  function compiledSong(id) {
    if (songCache[id]) return songCache[id];
    var src = Songs.byId(id) || Songs.SONGS[0];
    var c = Core.compileSong(src);
    songCache[id] = c;
    return c;
  }

  function startSong() {
    stopSession();
    var c = compiledSong(settings.songId);
    session = new Practice.SongPractice(c, {
      hands: settings.hands,
      autoOther: settings.otherHand,
      tempo: settings.tempo,
      lead: settings.lead,
      onAutoNote: function (note) { playAutoNote(note); }
    });
    sessionKind = 'song';
    session.start();
    View.setSongRange(c.noteRange[0], c.noteRange[1]);
    View.fitRange(c.noteRange[0], c.noteRange[1]);
    View.setMode('song');
    buildPanel();
    elProgress.hidden = false;
    toast('开始跟弹：' + c.title + '（' + settings.tempo + '% 速度）');
  }

  function playAutoNote(note) {
    ensureAudio();
    Audio.Engine.noteOn(note.midi, (note.vel || 0.6) * 0.9);
    autoNotes.push(note);
    var dur = Math.max(0.12, note.dur);
    setTimeout(function () {
      Audio.Engine.noteOff(note.midi);
      var i = autoNotes.indexOf(note);
      if (i >= 0) autoNotes.splice(i, 1);
    }, dur * 1000);
  }

  /* ---- 认键练习 ---- */

  function buildNotePanel() {
    var scopeSel = select([
      { value: 'visible', label: '当前视窗' },
      { value: 'all', label: '全部 88 键' },
      { value: 'white', label: '只有白键' }
    ], settings.noteScope, function (v) {
      settings.noteScope = v;
      saveSettings();
      if (sessionKind === 'note') startNote();
    });
    var roundsSel = select([
      { value: '10', label: '10 题' },
      { value: '20', label: '20 题' },
      { value: '30', label: '30 题' }
    ], settings.noteRounds, function (v) {
      settings.noteRounds = v;
      saveSettings();
      if (sessionKind === 'note') startNote();
    });
    var timeSel = select([
      { value: '4', label: '4 秒/题' },
      { value: '6', label: '6 秒/题' },
      { value: '9', label: '9 秒/题' }
    ], settings.noteTime, function (v) {
      settings.noteTime = v;
      saveSettings();
      if (sessionKind === 'note') startNote();
    });
    var startBtn = button(sessionKind === 'note' ? '停止' : '开始认键',
      sessionKind === 'note' ? 'danger' : 'primary', function () {
        if (sessionKind === 'note') stopSession(); else startNote();
      });
    startBtn.id = 'noteStart';

    elPanel.appendChild(field('范围', scopeSel));
    elPanel.appendChild(field('题量', roundsSel));
    elPanel.appendChild(field('限时', timeSel));
    elPanel.appendChild(startBtn);
    elPanel.appendChild(hintSpan('屏幕显示音名，在键盘上按下对应的键。'));
  }

  function notePool() {
    var scope = settings.noteScope;
    var pool = [];
    var lo = Core.LOW_MIDI, hi = Core.HIGH_MIDI;
    if (scope === 'visible' && View.layout) {
      lo = View.layout.lowMidi;
      hi = View.layout.highMidi;
      if (View.layout.blacks.length) hi = Math.max(hi, View.layout.blacks[View.layout.blacks.length - 1].midi);
    }
    for (var m = lo; m <= hi; m++) {
      if (scope === 'white' && Core.isBlackKey(m)) continue;
      pool.push(m);
    }
    return pool;
  }

  function startNote() {
    stopSession();
    var pool = notePool();
    if (!pool.length) { toast('当前范围没有可用音'); return; }
    session = new Practice.NoteFinder({
      pool: pool,
      rounds: Number(settings.noteRounds),
      timeLimit: Number(settings.noteTime)
    });
    session.start();
    sessionKind = 'note';
    lastNoteTarget = null;
    View.setMode('note');
    View.clearHints();
    buildPanel();
    elProgress.hidden = false;
    updateNoteHud();
  }

  var lastNoteTarget = null;
  function updateNoteHud() {
    if (!session || sessionKind !== 'note') return;
    /* 目标音可能在视窗外（题目范围是全部 88 键），滚进来 */
    if (session.target != null && session.target !== lastNoteTarget) {
      lastNoteTarget = session.target;
      View.revealMidi(session.target);
    }
    elHud.innerHTML = '<span class="chip">第 <b>' + (session.index + 1) + '</b> / ' + session.rounds +
      '</span><span class="chip">正确 <b>' + session.correct + '</b></span>' +
      '<span class="chip">连击 <b>' + session.streak + '</b></span>';
  }

  /* ---- 音阶 / 和弦 ---- */

  function buildHarmonyPanel() {
    var seg = document.createElement('div');
    seg.className = 'seg';
    [['scale', '音阶'], ['chord', '和弦进行']].forEach(function (pair) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = pair[1];
      b.setAttribute('aria-pressed', String(harmonyTab === pair[0]));
      b.addEventListener('click', function () {
        harmonyTab = pair[0];
        stopSession();
        buildPanel();
      });
      seg.appendChild(b);
    });
    elPanel.appendChild(seg);

    if (harmonyTab === 'scale') {
      var roots = [];
      ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].forEach(function (r, i) {
        roots.push({ value: String(i), label: r });
      });
      var rootSel = select(roots, String(settings.scaleRoot), function (v) {
        settings.scaleRoot = Number(v);
        saveSettings();
        if (sessionKind === 'scale') startScale();
      });
      var typeSel = select(Object.keys(Core.SCALES).map(function (k) {
        return { value: k, label: Core.SCALES[k].name };
      }), settings.scaleType, function (v) {
        settings.scaleType = v;
        saveSettings();
        if (sessionKind === 'scale') startScale();
      });
      var dirSel = select([
        { value: 'up', label: '只上行' },
        { value: 'both', label: '上下行' }
      ], settings.scaleDir, function (v) {
        settings.scaleDir = v;
        saveSettings();
        if (sessionKind === 'scale') startScale();
      });
      var startBtn = button(sessionKind === 'scale' ? '停止' : '开始音阶',
        sessionKind === 'scale' ? 'danger' : 'primary', function () {
          if (sessionKind === 'scale') stopSession(); else startScale();
        });
      startBtn.id = 'scaleStart';
      elPanel.appendChild(field('主音', rootSel));
      elPanel.appendChild(field('音阶', typeSel));
      elPanel.appendChild(field('方向', dirSel));
      elPanel.appendChild(startBtn);
    } else {
      var progOpts = Songs.PROGRESSIONS.map(function (p) {
        return { value: p.id, label: p.name };
      });
      var progSel = select(progOpts, settings.progId, function (v) {
        settings.progId = v;
        saveSettings();
        if (sessionKind === 'chord') startChord();
        else buildPanel();
      });
      var beatsSel = select([
        { value: '2', label: '每和弦 2 拍' },
        { value: '4', label: '每和弦 4 拍' },
        { value: '8', label: '每和弦 8 拍' }
      ], settings.progBeats, function (v) {
        settings.progBeats = v;
        saveSettings();
        if (sessionKind === 'chord') startChord();
      });
      var loopsSel = select([
        { value: '1', label: '1 轮' },
        { value: '2', label: '2 轮' },
        { value: '4', label: '4 轮' }
      ], settings.progLoops, function (v) {
        settings.progLoops = v;
        saveSettings();
        if (sessionKind === 'chord') startChord();
      });
      var cStart = button(sessionKind === 'chord' ? '停止' : '开始和弦',
        sessionKind === 'chord' ? 'danger' : 'primary', function () {
          if (sessionKind === 'chord') stopSession(); else startChord();
        });
      cStart.id = 'chordStart';
      elPanel.appendChild(field('进行', progSel));
      elPanel.appendChild(field('节奏', beatsSel));
      elPanel.appendChild(field('轮数', loopsSel));
      elPanel.appendChild(cStart);
      var p = Songs.progressionById(settings.progId);
      if (p) elPanel.appendChild(hintSpan(p.desc));
    }
  }

  function startScale() {
    stopSession();
    var sc = Core.buildScale(settings.scaleRoot, settings.scaleType, 4);
    var seq = settings.scaleDir === 'up' ? sc.up : sc.seq;
    session = new Practice.ScaleDrill(seq, { name: sc.name });
    sessionKind = 'scale';
    lastScaleNext = null;
    View.setMode('harmony');
    View.clearHints();
    buildPanel();
    elProgress.hidden = false;
    updateScaleHint();
    toast('音阶：' + sc.name);
  }

  var lastScaleNext = null;
  function updateScaleHint() {
    if (!session || sessionKind !== 'scale') return;
    var next = session.next();
    /* 目标音可能在视窗外，滚进来 */
    if (next != null && next !== lastScaleNext) {
      lastScaleNext = next;
      View.revealMidi(next);
    }
    var hints = {};
    if (next != null) hints[next] = 'hintScale';
    View.setHints(hints);
  }

  function startChord() {
    stopSession();
    var prog = Songs.progressionById(settings.progId);
    if (!prog) return;
    var steps = Core.buildProgression(prog.chords, 4);
    session = new Practice.ChordDrill(steps, {
      bpm: 80,
      beatsPerChord: Number(settings.progBeats),
      loops: Number(settings.progLoops)
    });
    session.start();
    sessionKind = 'chord';
    lastChordKey = null;
    View.setMode('harmony');
    View.clearHints();
    buildPanel();
    elProgress.hidden = false;
    updateChordHint();
  }

  var lastChordKey = null;
  function updateChordHint() {
    if (!session || sessionKind !== 'chord') return;
    var cur = session.current();
    /* 整块和弦都要在视窗里，用最低音定位 */
    if (cur && cur.midis.length) {
      var lo = Math.min.apply(null, cur.midis);
      var hi = Math.max.apply(null, cur.midis);
      var sig = lo + '-' + hi;
      if (sig !== lastChordKey) {
        lastChordKey = sig;
        View.revealRange(lo, hi);
      }
    }
    var hints = {};
    if (cur) cur.midis.forEach(function (m) { hints[m] = 'hintChord'; });
    View.setHints(hints);
  }

  /* ------------------------------------------------------ 会话控制 */

  function stopSession() {
    if (!session) return;
    if (sessionKind === 'song') {
      session.stop();
      autoNotes.forEach(function (n) { Audio.Engine.noteOff(n.midi); });
      autoNotes = [];
    }
    session = null;
    sessionKind = null;
    lastNoteTarget = null;
    lastScaleNext = null;
    lastChordKey = null;
    View.clearHints();
    elProgress.hidden = true;
    elCountdown.hidden = true;
    elHud.innerHTML = '';
    buildPanel();
    updateStageState();
  }

  function finishSession(kind, summary, title) {
    sessionKind = null;
    elProgress.hidden = true;
    View.clearHints();
    showResult(title, summary);
    if (kind === 'song' && summary.songId) {
      var cur = best[summary.songId];
      if (!cur || summary.accuracy > cur.accuracy) {
        best[summary.songId] = { accuracy: summary.accuracy, grade: summary.grade, score: summary.score };
        saveBest(best);
      }
      updateBestBox();
    }
  }

  var RESULT_LABELS = {
    accuracy: '准确率', score: '得分', maxCombo: '最高连击', counts: '判定明细',
    title: '曲目', total: '音符总数', duration: '用时(秒)', correct: '答对', wrong: '答错',
    timeouts: '超时', rounds: '题量', bestStreak: '最高连击', name: '名称', notes: '音数',
    errors: '错音', elapsed: '用时(秒)', clean: '全对', cleared: '完成', missed: '漏掉',
    loops: '轮数', tempo: '速度', hands: '练习手', songId: '曲目 ID'
  };

  function showResult(title, s) {
    var rows = '';
    Object.keys(s).forEach(function (k) {
      if (k === 'grade') return;
      var v = s[k];
      if (typeof v === 'object') v = JSON.stringify(v);
      var label = RESULT_LABELS[k] || k;
      rows += '<div class="row"><span>' + label + '</span><b>' + v + '</b></div>';
    });
    elOverlay.hidden = false;
    elOverlay.innerHTML = '<div class="card">' +
      '<h2>' + title + '</h2>' +
      '<div class="grade ' + (s.grade || '') + '">' + (s.grade || '') + '</div>' +
      rows +
      '<div class="actions"><button class="btn primary" id="againBtn" type="button">再来一次</button>' +
      '<button class="btn" id="closeBtn" type="button">关闭</button></div></div>';
    $('closeBtn').addEventListener('click', function () { elOverlay.hidden = true; });
    $('againBtn').addEventListener('click', function () {
      elOverlay.hidden = true;
      if (sessionKind === 'song') startSong();
      else if (sessionKind === 'note') startNote();
      else if (sessionKind === 'scale') startScale();
      else if (sessionKind === 'chord') startChord();
    });
  }

  function finishScale() {
    finishSession('scale', session.summary(), '音阶完成');
  }

  /* ---------------------------------------------------------- 主循环 */

  var lastFrame = 0;
  function frame(now) {
    var dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;

    if (session) {
      if (sessionKind === 'song') {
        session.update(dt);
        if (session.state === 'done') finishSession('song', session.summary(), '跟弹结束');
        else updateSongHud(session);
      } else if (sessionKind === 'note') {
        session.update(dt);
        if (session.state === 'done') finishSession('note', session.summary(), '认键结束');
        else updateNoteHud();
      } else if (sessionKind === 'scale') {
        session.update(dt);
      } else if (sessionKind === 'chord') {
        session.update(dt);
        if (session.state === 'done') finishSession('chord', session.summary(), '和弦完成');
      }
    }

    updateStageState();
    View.draw(viewState());
    refreshAudioStatus();
    requestAnimationFrame(frame);
  }

  function startLoop() {
    if (running) return;
    running = true;
    lastFrame = performance.now();
    requestAnimationFrame(frame);
  }

  function updateSongHud(s) {
    elHud.innerHTML = '<span class="chip">' + s.song.title + '</span>' +
      '<span class="chip">得分 <b>' + s.score + '</b></span>' +
      '<span class="chip combo">连击 <b>' + s.combo + '</b></span>' +
      '<span class="chip">准确率 <b>' + s.accuracy() + '%</b></span>';
    /* 只在开始前的最后一小段显示倒计时，免得和判定文字打架 */
    if (s.t < -0.2) {
      elCountdown.hidden = false;
      elCountdown.textContent = String(Math.max(1, Math.min(3, Math.ceil(-s.t))));
    } else {
      elCountdown.hidden = true;
    }
  }

  /* --------------------------------------------------------- 舞台态 */

  function viewState() {
    var st = { mode: mode };
    if (sessionKind === 'song' && session) {
      var s = session;
      st.mode = 'song';
      st.lead = settings.lead;
      st.time = s.t;
      st.beatSec = s.beatSec;
      st.beatsPerBar = s.song.timeSig[0];
      st.totalSec = s.duration;
      st.notes = [];
      s.notes.forEach(function (n) {
        st.notes.push({ midi: n.midi, start: n.start, dur: n.dur, hand: n.hand, state: n.state, hitTime: n.hitTime });
      });
      s.autoNotes.forEach(function (n) {
        st.notes.push({ midi: n.midi, start: n.start, dur: n.dur, hand: n.hand, state: n.state, hitTime: n.hitTime });
      });
    } else if (sessionKind === 'note' && session) {
      st.mode = 'note';
      st.promptText = session.target == null ? '—' : Core.midiToName(session.target);
      st.promptSub = session.target == null ? '' :
        Core.noteLabel(session.target, 'solfege') + ' · ' + Core.noteLabel(session.target, 'jianpu');
      st.promptTop = '按下这个音（' + Math.max(0, Math.ceil(session.timeLeft)) + 's）';
    } else if (sessionKind === 'scale' && session) {
      st.mode = 'harmony';
      var nx = session.next();
      st.promptText = nx == null ? '完成' : Core.midiToName(nx);
      st.promptTop = session.name + ' · 第 ' + (session.index + 1) + '/' + session.seq.length + ' 个音';
      st.promptSub = '错误 ' + session.errors + ' 次';
    } else if (sessionKind === 'chord' && session) {
      st.mode = 'harmony';
      var cur = session.current();
      st.promptText = cur ? cur.name : '完成';
      st.promptTop = '按住这个和弦的所有音';
      st.promptSub = cur ? cur.midis.map(function (m) { return Core.midiToName(m); }).join(' + ') : '';
    } else {
      st.hintLines = mode === 'free'
        ? ['用手指直接按琴键，或用电脑键盘 Z / Q 两排演奏', '多点触摸：多指同时按下即可叠出和弦']
        : ['选择上方曲目后点“开始跟弹”', '音符落到判定线时按下对应琴键'];
    }
    return st;
  }

  function updateStageState() {
    var st = viewState();
    var sig = st.mode + '|' + (st.promptText || '') + '|' + (st.promptTop || '') + '|' + (st.promptSub || '');
    if (sig !== lastStageSig) {
      lastStageSig = sig;
      View.stageDirty = true;
    }
    if (session && typeof session.progress === 'function') {
      elProgressBar.style.width = (session.progress() * 100).toFixed(1) + '%';
    }
  }

  /* ------------------------------------------------------- 录音回放 */

  function toggleRecord() {
    ensureAudio();
    if (record.active) {
      record.active = false;
      record.clip.forEach(function (n) { if (n.off == null) n.off = performance.now(); });
      var btn = $('recordBtn');
      btn.textContent = '●';
      btn.style.color = '';
      toast('已录制 ' + record.clip.length + ' 个音');
    } else {
      if (record.playing) { stopPlayback(); return; }
      record.active = true;
      record.clip = [];
      record.startedAt = performance.now();
      var b = $('recordBtn');
      b.textContent = '■';
      b.style.color = '#e05a52';
      toast('开始录制，再点一次结束');
    }
  }

  function playRecording() {
    if (!record.clip.length) { toast('还没有录音'); return; }
    if (record.playing) { stopPlayback(); return; }
    ensureAudio();
    record.playing = true;
    var base = record.startedAt;
    record.clip.forEach(function (n) {
      var on = n.on - base;
      var off = (n.off == null ? n.on + 400 : n.off) - base;
      var t1 = setTimeout(function () {
        Audio.Engine.noteOn(n.midi, n.vel);
        View.setPressed(n.midi, true);
      }, Math.max(0, on));
      var t2 = setTimeout(function () {
        Audio.Engine.noteOff(n.midi);
        View.setPressed(n.midi, false);
      }, Math.max(0, off));
      record.playTimers.push(t1, t2);
    });
    var end = record.clip.reduce(function (m, n) {
      return Math.max(m, (n.off == null ? n.on : n.off) - base);
    }, 0);
    record.playTimers.push(setTimeout(function () {
      record.playing = false;
      record.playTimers = [];
      toast('回放结束');
    }, end + 200));
  }

  function stopPlayback() {
    record.playTimers.forEach(clearTimeout);
    record.playTimers = [];
    record.playing = false;
  }

  /* --------------------------------------------------------- 节拍器 */

  function toggleMetronome() {
    ensureAudio();
    if (settings.metro) {
      Audio.Engine.startMetronome(settings.bpm, function () {
        elStatus.classList.add('beat');
        setTimeout(function () { elStatus.classList.remove('beat'); }, 90);
      });
    } else {
      Audio.Engine.stopMetronome();
    }
  }

  /* ------------------------------------------------- 键盘音域控件 */

  function updateKbRange() {
    var box = $('kbRange');
    if (!box || !View.layout) return;
    box.textContent = Core.rangeLabel(View.layout) + '（' + View.whiteCount + ' 个白键）';
    var auto = $('kbAuto');
    if (auto) auto.setAttribute('aria-pressed', String(View.autoWidth));
  }

  function bindKeyboardControls() {
    $('kbLeft').addEventListener('click', function () { View.scrollOctave(-1); updateKbRange(); });
    $('kbRight').addEventListener('click', function () { View.scrollOctave(1); updateKbRange(); });
    /* ＋= 键变宽（显示更少白键），−= 键变窄（显示更多白键） */
    $('kbZoomIn').addEventListener('click', function () {
      View.zoomBy(-3); settings.whiteCount = View.whiteCount; saveSettings(); updateKbRange();
    });
    $('kbZoomOut').addEventListener('click', function () {
      View.zoomBy(3); settings.whiteCount = View.whiteCount; saveSettings(); updateKbRange();
    });
    $('kbAuto').addEventListener('click', function () {
      var on = View.setAutoWidth(!View.autoWidth);
      settings.whiteCount = on ? 0 : View.whiteCount;
      saveSettings();
      updateKbRange();
      toast(on ? '键宽：按屏幕自适应' : '键宽：固定 ' + View.whiteCount + ' 个白键');
    });
    $('stMidi').addEventListener('click', function () {
      if (midiOut) { toast('MIDI 已连接：' + (midiOut.name || '')); return; }
      connectMidi();
    });
  }

  /* --------------------------------------------------------- 顶栏 */

  $('recordBtn').addEventListener('click', toggleRecord);

  $('themeBtn').addEventListener('click', function () {
    var cur = document.documentElement.getAttribute('data-theme');
    var next = cur === 'dark' ? 'light' : 'dark';
    settings.theme = next;
    applyTheme(next);
    saveSettings();
  });

  $('helpBtn').addEventListener('click', function () {
    elOverlay.hidden = false;
    elOverlay.innerHTML = '<div class="card"><h2>怎么玩</h2>' +
      '<div class="hint-box">' +
      '<p><b>1. 弹</b>：手指直接按琴键；多点触摸可以同时按住多个键弹和弦；按住不放左右拖动是滑键。</p>' +
      '<p><b>2. 电脑键盘</b>：下排 <span class="kbd">Z</span><span class="kbd">X</span><span class="kbd">C</span><span class="kbd">V</span>… 是低音，' +
      '上排 <span class="kbd">Q</span><span class="kbd">W</span><span class="kbd">E</span>… 是高音，黑键在 <span class="kbd">S</span><span class="kbd">D</span><span class="kbd">G</span> 与 <span class="kbd">2</span><span class="kbd">3</span><span class="kbd">5</span>。' +
      '<span class="kbd">[</span> <span class="kbd">]</span> 换八度，空格是延音踏板，<span class="kbd">Esc</span> 停止练习。</p>' +
      '<p><b>3. 跟弹</b>：选曲子 → 点“开始跟弹”，音符落到判定线时按下对应键。只练一只手时，另一手可自动伴奏。</p>' +
      '<p><b>4. 认键</b>：屏幕给音名，你在键盘上找出来。</p>' +
      '<p><b>5. 音阶 / 和弦</b>：按提示依次弹音阶，或按住和弦进行里的每个和弦。</p>' +
      '<p><b>6. 录制</b>：点左上角红点开始录，再点一次停止，然后回放自己的演奏。</p>' +
      '</div><div class="actions"><button class="btn primary" id="closeHelp" type="button">知道了</button></div></div>';
    $('closeHelp').addEventListener('click', function () { elOverlay.hidden = true; });
  });

  /* ------------------------------------------------------ 首次交互 */

  window.addEventListener('pointerdown', function once() {
    ensureAudio();
    if (settings.metro) toggleMetronome();
    window.removeEventListener('pointerdown', once);
  }, { passive: true });

  window.addEventListener('resize', function () {
    if (View.autoWidth) View.applyAutoWidth();
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && sessionKind === 'song' && session && session.state === 'playing') {
      session.pause();
      toast('已暂停');
    }
  });

  /* ---------------------------------------------------------- 启动 */

  View.init({
    keys: elKeysCanvas,
    stage: elStageCanvas,
    mini: elMiniCanvas,
    onNoteOn: function (midi, vel, source) {
      ensureAudio();
      View.setPressed(midi, true);
      noteOn(midi, vel, source);
    },
    onNoteOff: function (midi, source) {
      noteOff(midi, source);
      View.setPressed(midi, false);
    },
    onViewport: function (vp) {
      $('stHint').textContent = '可视音域 ' + vp.label + '（' + vp.whiteCount + ' 个白键）';
      updateKbRange();
    }
  });

  /* whiteCount = 0 → 自适应：按屏幕宽度算，保证每个白键够宽好按 */
  if (settings.whiteCount > 0) {
    View.setAutoWidth(false);
    View.setViewport(settings.startWhite, settings.whiteCount);
  } else {
    View.setAutoWidth(true);
    View.setViewport(settings.startWhite, null);
    View.applyAutoWidth();
  }
  /* startWhite = -1 → 视窗以中央 C 为中心 */
  if (settings.startWhite < 0) {
    View.setViewport(Core.whiteIndexOf(60) - Math.floor(View.whiteCount / 2), null);
  }
  View.setLabelStyle(settings.label);
  bindKeyboardControls();
  updateKbRange();
  buildPanel();
  updateStageState();
  initMidi();
  refreshAudioStatus();
  startLoop();

  /* 暴露给自动化测试 */
  window.__piano = {
    Core: Core, Songs: Songs, Practice: Practice, Audio: Audio, View: View,
    state: function () {
      return {
        mode: mode, sessionKind: sessionKind,
        session: session ? {
          state: session.state, t: session.t, score: session.score, combo: session.combo,
          counts: session.counts, total: session.total,
          accuracy: typeof session.accuracy === 'function' ? session.accuracy() : null,
          index: session.index, errors: session.errors
        } : null,
        view: {
          startWhite: View.startWhite, whiteCount: View.whiteCount,
          lowMidi: View.layout.lowMidi, highMidi: View.layout.highMidi
        },
        audio: Audio.Engine.state(),
        voices: Audio.Engine.voiceCount(),
        record: { active: record.active, clip: record.clip.length }
      };
    },
    /** 当前练习会话（自动化测试用） */
    currentSession: function () { return session; },
    noteOn: noteOn,
    noteOff: noteOff,
    setMode: setMode,
    startSong: startSong,
    startNote: startNote,
    startScale: startScale,
    startChord: startChord,
    stop: stopSession,
    setSettings: function (patch) {
      Object.assign(settings, patch);
      saveSettings();
      if (settings.whiteCount > 0) {
        View.setAutoWidth(false);
        View.setViewport(settings.startWhite, settings.whiteCount);
      } else {
        View.setAutoWidth(true);
        View.setViewport(settings.startWhite, null);
        View.applyAutoWidth();
      }
      if (settings.startWhite < 0) {
        View.setViewport(Core.whiteIndexOf(60) - Math.floor(View.whiteCount / 2), null);
      }
      View.setLabelStyle(settings.label);
      buildPanel();
      updateKbRange();
    },
    settings: function () { return settings; },
    keyCenter: function (midi) { return Core.keyCenter(View.layout, midi); },
    hitTest: function (x, y) { return View.hitTest(x, y); },
    viewport: function () {
      return {
        startWhite: View.startWhite, whiteCount: View.whiteCount,
        whiteKeyWidth: View.whiteKeyWidth(), autoWidth: View.autoWidth
      };
    },
    zoomBy: function (d) { var n = View.zoomBy(d); settings.whiteCount = n; saveSettings(); updateKbRange(); return n; },
    setAutoWidth: function (on) { var r = View.setAutoWidth(on); settings.whiteCount = on ? 0 : View.whiteCount; saveSettings(); updateKbRange(); return r; },
    scrollOctave: function (d) { View.scrollOctave(d); updateKbRange(); }
  };
})();
