/* ==========================================================================
 * 琴房 · songs.js —— 内置曲库与和弦进行
 *
 * 记谱：`音名:拍数`，`-` 是休止，`|` 分小节（小节长度可以不等，编译器按实际拍数走）。
 * left 是每小节一个和弦记号（和弦数不够时循环使用），pattern 决定左手伴奏型。
 * 全部为民谣 / 古典公版旋律，编配（左手伴奏）由 core.js 现场生成。
 * ========================================================================== */
(function (root) {
  'use strict';

  var SONGS = [
    {
      id: 'twinkle', title: '小星星', composer: '法国民谣', level: 1,
      bpm: 88, timeSig: [4, 4], key: 'C', pattern: 'alberti',
      intro: '最经典的入门曲，右手全在白键，左手阿尔贝蒂伴奏。',
      melody: [
        'C4:1 C4:1 G4:1 G4:1', 'A4:1 A4:1 G4:2', 'F4:1 F4:1 E4:1 E4:1', 'D4:1 D4:1 C4:2',
        'G4:1 G4:1 F4:1 F4:1', 'E4:1 E4:1 D4:2', 'G4:1 G4:1 F4:1 F4:1', 'E4:1 E4:1 D4:2',
        'C4:1 C4:1 G4:1 G4:1', 'A4:1 A4:1 G4:2', 'F4:1 F4:1 E4:1 E4:1', 'D4:1 D4:1 C4:2'
      ].join(' | '),
      left: 'C | C | F | C | C | C | G | G | C | C | F | C'
    },
    {
      id: 'two-tigers', title: '两只老虎', composer: '法国民谣', level: 1,
      bpm: 96, timeSig: [4, 4], key: 'C', pattern: 'alberti',
      intro: '轮唱小曲，节奏方整，适合练习四拍一组。',
      melody: [
        'C4:1 D4:1 E4:1 C4:1', 'C4:1 D4:1 E4:1 C4:1', 'E4:1 F4:1 G4:2', 'E4:1 F4:1 G4:2',
        'G4:0.5 A4:0.5 G4:0.5 F4:0.5 E4:1 C4:1', 'G4:0.5 A4:0.5 G4:0.5 F4:0.5 E4:1 C4:1',
        'C4:1 G3:1 C4:2', 'C4:1 G3:1 C4:2'
      ].join(' | '),
      left: 'C | C | C | C | C | C | C | C'
    },
    {
      id: 'mary', title: '玛丽有只小羊羔', composer: '美国童谣', level: 1,
      bpm: 100, timeSig: [4, 4], key: 'C', pattern: 'alberti',
      intro: '只需要五个音，用来熟悉 C–G 的位置。',
      melody: [
        'E4:1 D4:1 C4:1 D4:1', 'E4:1 E4:1 E4:2', 'D4:1 D4:1 D4:2', 'E4:1 G4:1 G4:2',
        'E4:1 D4:1 C4:1 D4:1', 'E4:1 E4:1 E4:1 E4:1', 'D4:1 D4:1 E4:1 D4:1', 'C4:4'
      ].join(' | '),
      left: 'C | C | G | C | C | C | G | C'
    },
    {
      id: 'row', title: '划船歌', composer: '美国民谣', level: 1,
      bpm: 94, timeSig: [3, 4], key: 'C', pattern: 'waltz',
      intro: '三拍子的摇橹节奏，左手低音＋两个和弦音。',
      melody: [
        'C4:1 C4:1 C4:1 D4:0.5 E4:0.5', 'E4:0.5 D4:0.5 E4:0.5 F4:0.5 G4:2',
        'C5:0.5 C5:0.5 C5:0.5 G4:0.5 G4:0.5 G4:0.5', 'E4:0.5 E4:0.5 E4:0.5 C4:0.5 C4:0.5 C4:0.5',
        'G4:0.5 F4:0.5 E4:0.5 D4:0.5 C4:2'
      ].join(' | '),
      left: 'C | C | C | C | G7'
    },
    {
      id: 'london', title: '伦敦桥', composer: '英国童谣', level: 2,
      bpm: 96, timeSig: [4, 4], key: 'C', pattern: 'alberti',
      intro: '四小节一句、重复两次，注意第二句结尾的 D G E C。',
      melody: [
        'G4:1 A4:1 G4:1 F4:1', 'E4:1 F4:1 G4:2', 'D4:1 E4:1 F4:2', 'E4:1 F4:1 G4:2',
        'G4:1 A4:1 G4:1 F4:1', 'E4:1 F4:1 G4:2', 'D4:2 G4:1 E4:1', 'C4:4'
      ].join(' | '),
      left: 'C | C | G | C | C | C | G | C'
    },
    {
      id: 'ode', title: '欢乐颂', composer: '贝多芬', level: 2,
      bpm: 100, timeSig: [4, 4], key: 'C', pattern: 'block',
      intro: '柱式和声，练和弦的整齐度比练速度更重要。',
      melody: [
        'E4:1 E4:1 F4:1 G4:1', 'G4:1 F4:1 E4:1 D4:1', 'C4:1 C4:1 D4:1 E4:1', 'E4:1.5 D4:0.5 D4:2',
        'E4:1 E4:1 F4:1 G4:1', 'G4:1 F4:1 E4:1 D4:1', 'C4:1 C4:1 D4:1 E4:1', 'D4:1.5 C4:0.5 C4:2',
        'D4:1 D4:1 E4:1 C4:1', 'D4:1 E4:0.5 F4:0.5 E4:1 C4:1', 'D4:1 E4:0.5 F4:0.5 E4:1 D4:1', 'C4:1 D4:1 G3:2',
        'E4:1 E4:1 F4:1 G4:1', 'G4:1 F4:1 E4:1 D4:1', 'C4:1 C4:1 D4:1 E4:1', 'D4:1.5 C4:0.5 C4:2'
      ].join(' | '),
      left: 'C | G7 | C | G7 | C | G7 | C | C | G7 | C | G7 | C | C | G7 | C | C'
    },
    {
      id: 'birthday', title: '生日快乐', composer: 'Hill 姐妹', level: 2,
      bpm: 96, timeSig: [4, 4], key: 'C', pattern: 'block',
      intro: '跨过一个八度（C5 / G5 / F5 / D5），适合练大跳。',
      melody: [
        'G4:0.5 G4:0.5 A4:1 G4:1 C5:1', 'B4:3 -:1',
        'G4:0.5 G4:0.5 A4:1 G4:1 D5:1', 'C5:3 -:1',
        'G4:0.5 G4:0.5 G5:1 E5:1 C5:1', 'B4:1 A4:1 -:2',
        'F5:0.5 F5:0.5 E5:1 C5:1 D5:1', 'C5:3 -:1'
      ].join(' | '),
      left: 'C | G7 | C | C | C | F | G7 | C'
    },
    {
      id: 'jingle', title: '铃儿响叮当', composer: 'James Pierpont', level: 3,
      bpm: 116, timeSig: [4, 4], key: 'C', pattern: 'alberti',
      intro: '副歌部分，附点节奏是重点。',
      melody: [
        'E4:1 E4:1 E4:2', 'E4:1 E4:1 E4:2', 'E4:1 G4:1 C4:1.5 D4:0.5', 'E4:3 -:1',
        'F4:1 F4:1 F4:1.5 F4:0.5', 'F4:1 E4:1 E4:1 E4:0.5 E4:0.5', 'E4:1 D4:1 D4:1 E4:1', 'D4:2 G4:2'
      ].join(' | '),
      left: 'C | C | C | C | F | C | G7 | C'
    },
    {
      id: 'lullaby', title: '摇篮曲', composer: '勃拉姆斯', level: 3,
      bpm: 72, timeSig: [3, 4], key: 'C', pattern: 'waltz',
      intro: '很慢的三拍子，练“低音—和弦—和弦”的圆舞曲手感。',
      melody: [
        'E4:1 E4:1 G4:1', 'E4:3', 'D4:1 D4:1 F4:1', 'D4:3',
        'C4:1 C4:1 E4:1', 'G4:1 F4:1 E4:1', 'D4:1 D4:1 C4:1', 'C4:3'
      ].join(' | '),
      left: 'C | C | G7 | G7 | C | C | G7 | C'
    },
    {
      id: 'elise', title: '致爱丽丝（片段）', composer: '贝多芬', level: 4,
      bpm: 84, timeSig: [3, 8], key: 'Am', pattern: 'arp',
      intro: 'A 段主题，半音倚音要用相邻的手指干净地换键。',
      melody: [
        'E5:0.5 D#5:0.5 E5:0.5', 'D#5:0.5 E5:0.5 B4:0.5', 'D5:0.5 C5:0.5 A4:1.5', '-:1.5',
        'B4:1.5', '-:1.5', 'C5:1.5', '-:1.5',
        'E5:0.5 D#5:0.5 E5:0.5', 'D#5:0.5 E5:0.5 B4:0.5', 'D5:0.5 C5:0.5 A4:1.5', '-:1.5',
        'B4:1.5', '-:1.5', 'C5:1.5', '-:1.5'
      ].join(' | '),
      left: 'Am | E7 | Am | Am | E7 | E7 | Am | Am | Am | E7 | Am | Am | E7 | E7 | Am | Am'
    }
  ];

  /* 和弦进行练习：每一步都是第 4 八度的原位三/七和弦，键位都在默认视窗里 */
  var PROGRESSIONS = [
    {
      id: 'canon-c', name: '卡农进行（C 调）', desc: 'C–G–Am–Em–F–C–F–G，八和弦万能伴奏',
      chords: ['C', 'G', 'Am', 'Em', 'F', 'C', 'F', 'G']
    },
    {
      id: 'pop', name: '流行 4536251', desc: 'F–G–Em–Am–Dm–G–C，华语流行最常用',
      chords: ['F', 'G', 'Em', 'Am', 'Dm', 'G', 'C', 'C']
    },
    {
      id: 'fifties', name: '50 年代进行', desc: 'C–Am–F–G，老歌标配',
      chords: ['C', 'Am', 'F', 'G']
    },
    {
      id: 'canon-d', name: '卡农进行（D 调）', desc: 'D–A–Bm–F#m–G–D–G–A，含两个黑键和弦',
      chords: ['D', 'A', 'Bm', 'F#m', 'G', 'D', 'G', 'A']
    },
    {
      id: 'minor', name: '小调循环', desc: 'Am–F–C–G，抒情小调',
      chords: ['Am', 'F', 'C', 'G']
    }
  ];

  var API = {
    SONGS: SONGS,
    PROGRESSIONS: PROGRESSIONS,
    byId: function (id) {
      for (var i = 0; i < SONGS.length; i++) if (SONGS[i].id === id) return SONGS[i];
      return null;
    },
    progressionById: function (id) {
      for (var i = 0; i < PROGRESSIONS.length; i++) if (PROGRESSIONS[i].id === id) return PROGRESSIONS[i];
      return null;
    }
  };

  if (typeof module === 'object' && module.exports) module.exports = API;
  else root.PianoSongs = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
