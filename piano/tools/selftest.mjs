/**
 * 琴房 · 离线断言（Node 直跑，不需要浏览器）
 *
 * 覆盖：音名/频率换算、键盘布局与命中、曲谱 DSL 与伴奏生成、
 *       评分与准确率、四套练习状态机、曲库体检、设置规范化。
 *
 * 用法：node piano/tools/selftest.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/* 所有脚本共用一个沙箱：practice.js 依赖 core.js 挂在全局的 PianoCore */
const sandbox = {};
function loadScript(rel, globalName) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const fn = new Function('globalThis', `${src}\nreturn globalThis.${globalName};`);
  return fn(sandbox);
}

const Core = loadScript('src/core.js', 'PianoCore');
const Songs = loadScript('src/songs.js', 'PianoSongs');
const Practice = loadScript('src/practice.js', 'PianoPractice');

let pass = 0;
const fails = [];

function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fails.push(name + (extra ? ' → ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); }
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  ok(name, a === e, `期望 ${e}，实际 ${a}`);
}

/* ================================================================ 音高 */

console.log('\n【音名与频率】');

eq('C4 → 60', Core.nameToMidi('C4'), 60);
eq('A0 → 21', Core.nameToMidi('A0'), 21);
eq('C8 → 108', Core.nameToMidi('C8'), 108);
eq('C#4 → 61', Core.nameToMidi('C#4'), 61);
eq('Db4 → 61', Core.nameToMidi('Db4'), 61);
eq('B3 → 59', Core.nameToMidi('B3'), 59);
eq('非法音名返回 null', Core.nameToMidi('H4'), null);

eq('60 → C4', Core.midiToName(60), 'C4');
eq('61 → C#4', Core.midiToName(61), 'C#4');
eq('70 → A#4', Core.midiToName(70), 'A#4');
eq('flat 模式 61 → Db4', Core.midiToName(61, true), 'Db4');

ok('A4 = 440Hz', Math.abs(Core.midiToFreq(69) - 440) < 1e-9);
ok('C4 ≈ 261.63Hz', Math.abs(Core.midiToFreq(60) - 261.6256) < 1e-3);
ok('八度差 = 2 倍频率', Math.abs(Core.midiToFreq(72) / Core.midiToFreq(60) - 2) < 1e-9);

ok('黑键判定 C#', Core.isBlackKey(61));
ok('白键判定 C', !Core.isBlackKey(60));
eq('88 键白键数 = 52', Core.allWhiteKeys().length, 52);
eq('白键列表首尾', [Core.allWhiteKeys()[0], Core.allWhiteKeys()[51]], [21, 108]);

eq('唱名标签', Core.noteLabel(60, 'solfege'), 'do');
eq('唱名标签（升号）', Core.noteLabel(61, 'solfege'), 'di');
eq('简谱标签', Core.noteLabel(60, 'jianpu'), '1');
eq('简谱高八度带点', Core.noteLabel(72, 'jianpu'), "1'");
eq('音名标签', Core.noteLabel(60, 'name'), 'C4');
eq('不显示标签', Core.noteLabel(60, 'none'), '');

/* ============================================================ 键盘几何 */

console.log('\n【键盘布局与命中】');

/* 24 个白键从 A0 起：白键 A0…C4，黑键 A#0…A#3（共 16 个） */
const layout = Core.layoutKeyboard({ width: 1000, height: 200, whiteCount: 24, startWhite: 0 });
eq('布局白键数', layout.whites.length, 24);
eq('布局黑键数（末白键右侧的黑键不出屏）', layout.blacks.length, 16);
ok('白键宽度 = 总宽/白键数', Math.abs(layout.whiteW - 1000 / 24) < 1e-9);
eq('第一个白键', layout.whites[0].midi, 21);
eq('最后一个白键', layout.whites[23].midi, 60);
ok('黑键不会超出右边界', layout.blacks.every(b => b.x + b.w <= layout.width + 0.001));
ok('黑键不会超出左边界', layout.blacks.every(b => b.x >= -0.001));

ok('A#3 命中黑键', Core.hitTestKey(layout, Core.keyCenter(layout, 58).x, 40) === 58);
ok('视窗最右白键右侧的黑键不在布局内（不会画到屏外）', layout.map[61] === undefined);
ok('C4 命中白键', Core.hitTestKey(layout, Core.keyCenter(layout, 60).x, 150) === 60);
ok('白键下半部即使有黑键重叠也是白键',
  Core.hitTestKey(layout, Core.keyCenter(layout, 60).x, 190) === 60);
eq('超出右边界无命中', Core.hitTestKey(layout, 1200, 50), null);
eq('上方空白无命中', Core.hitTestKey(layout, 100, -5), null);

const layout2 = Core.layoutKeyboard({ width: 800, height: 200, whiteCount: 52, startWhite: 0 });
eq('全键盘 52 白键', layout2.whites.length, 52);
eq('全键盘 36 黑键', layout2.blacks.length, 36);
ok('全键盘首键 A0', layout2.whites[0].midi === 21);
ok('全键盘末键 C8', layout2.whites[51].midi === 108);

/* 每个黑键都应该能被命中，且不与白键混淆 */
const blackHitOk = layout.blacks.every(b => Core.hitTestKey(layout, b.x + b.w / 2, 30) === b.midi);
ok('所有黑键都能命中', blackHitOk);
const whiteHitOk = layout.whites.every(w =>
  Core.hitTestKey(layout, w.x + w.w / 2, layout.height - 5) === w.midi);
ok('所有白键下半部都命中白键', whiteHitOk);

const fit = Core.fitRange(60, 72, 52);
ok('fitRange 覆盖目标音域', Core.allWhiteKeys()[fit.startWhite] <= 60 &&
  Core.allWhiteKeys()[fit.startWhite + fit.whiteCount - 1] >= 72, JSON.stringify(fit));
ok('fitRange 不越界', fit.startWhite >= 0 && fit.startWhite + fit.whiteCount <= 52);

/* ============================================================ 曲谱 DSL */

console.log('\n【曲谱 DSL 与伴奏】');

const meas = Core.parseMelody('C4:1 D4:1 E4:2 | -:1 G3:1');
eq('小节数', meas.length, 2);
eq('第一小节拍数', meas[0].beats, 4);
eq('第一小节音符数', meas[0].notes.length, 3);
eq('第二小节拍数', meas[1].beats, 2);
eq('第二小节实际音数（休止不计）', meas[1].notes.length, 1);
eq('音符起始拍', meas[0].notes[1].start, 1);
ok('坏记谱抛错', (() => { try { Core.parseMelody('X9:1'); return false; } catch (e) { return true; } })());
ok('越界音高抛错', (() => { try { Core.parseMelody('C9:1'); return false; } catch (e) { return true; } })());
ok('零时值抛错', (() => { try { Core.parseMelody('C4:0'); return false; } catch (e) { return true; } })());

eq('和弦 C → [0,4,7]', Core.parseChord('C').intervals, [0, 4, 7]);
eq('和弦 Cm → [0,3,7]', Core.parseChord('Cm').intervals, [0, 3, 7]);
eq('和弦 C7 → [0,4,7,10]', Core.parseChord('C7').intervals, [0, 4, 7, 10]);
eq('和弦 F#m 根音', Core.parseChord('F#m').rootPc, 6);
eq('和弦 Bb 根音', Core.parseChord('Bb').rootPc, 10);
eq('未知和弦返回 null', Core.parseChord('Cz'), null);

/* 和弦放在第 4 八度：根音是该八度的根（如 A → A4 = 69） */
eq('C4 和弦音', Core.chordVoicing('C', 4).midis, [60, 64, 67]);
eq('Am4 和弦音', Core.chordVoicing('Am', 4).midis, [69, 72, 76]);
eq('G4 和弦音', Core.chordVoicing('G', 4).midis, [67, 71, 74]);

const alb = Core.accompaniment(Core.parseChord('C'), 0, 4, 'alberti');
eq('阿尔贝蒂 4 拍出 8 个八分音', alb.length, 8);
eq('阿尔贝蒂首个音是根音', alb[0].midi, 36);
ok('阿尔贝蒂全在左手区', alb.every(n => n.midi >= 36 && n.midi <= 60));
const block = Core.accompaniment(Core.parseChord('C'), 0, 4, 'block');
eq('柱式 3 个音', block.length, 3);
eq('柱式时长为整小节', block[0].dur, 3.8);
const waltz = Core.accompaniment(Core.parseChord('G'), 0, 3, 'waltz');
ok('圆舞曲型为 1 低音 + 2 和弦音 × 2', waltz.length === 5, String(waltz.length));

const compiled = Core.compileSong(Songs.byId('twinkle'));
ok('编译后有音符', compiled.notes.length > 0);
eq('小星星第一音是 C4', compiled.notes.find(n => n.hand === 'R').midi, 60);
eq('小星星有左手', compiled.hasLeft, true);
ok('总时长为正', compiled.duration > 0);
ok('音域在 88 键内', compiled.notes.every(n => n.midi >= 21 && n.midi <= 108));
ok('音符按时间排序', compiled.notes.every((n, i) => i === 0 || compiled.notes[i - 1].start <= n.start));
ok('左手音高低于右手', (() => {
  const lh = compiled.notes.filter(n => n.hand === 'L');
  const rh = compiled.notes.filter(n => n.hand === 'R');
  return Math.max(...lh.map(n => n.midi)) < Math.min(...rh.map(n => n.midi));
})());

/* ============================================================ 评分 */

console.log('\n【评分与准确率】');

eq('偏差 0 → perfect', Core.judgeTiming(0).grade, 'perfect');
eq('偏差 0.05 → perfect', Core.judgeTiming(0.05).grade, 'perfect');
eq('偏差 0.08 → great', Core.judgeTiming(0.08).grade, 'great');
eq('偏差 0.15 → good', Core.judgeTiming(0.15).grade, 'good');
eq('偏差 0.5 → miss', Core.judgeTiming(0.5).grade, 'miss');
eq('负偏差同样判定', Core.judgeTiming(-0.03).grade, 'perfect');
eq('perfect 得 100 分', Core.judgeTiming(0).points, 100);

eq('全 perfect 准确率 100', Core.accuracy({ perfect: 10, great: 0, good: 0, miss: 0 }), 100);
eq('全 miss 准确率 0', Core.accuracy({ perfect: 0, great: 0, good: 0, miss: 10 }), 0);
ok('混合准确率介于 0-100', (() => {
  const a = Core.accuracy({ perfect: 5, great: 3, good: 1, miss: 1 });
  return a > 50 && a < 100;
})());
eq('S 级门槛', Core.gradeOf(97), 'S');
eq('A 级门槛', Core.gradeOf(92), 'A');
eq('B 级门槛', Core.gradeOf(82), 'B');
eq('C 级门槛', Core.gradeOf(70), 'C');
eq('D 级门槛', Core.gradeOf(50), 'D');

/* ======================================================== 音阶与和弦 */

console.log('\n【音阶与和弦】');

/* octave=4 表示“第 4 个八度”，根音落在该八度内（C4=60, A4=69 …） */
const cMaj = Core.buildScale(0, 'major', 4);
eq('C 大调上行', cMaj.up, [60, 62, 64, 65, 67, 69, 71, 72]);
eq('C 大调下行（回到 C4）', cMaj.down, [71, 69, 67, 65, 64, 62, 60]);
eq('上下行总数', cMaj.seq.length, 15);
ok('上下行首尾相接', cMaj.seq[0] === 60 && cMaj.seq[cMaj.seq.length - 1] === 60);
ok('上行到顶后原路返回', cMaj.seq[7] === 72 && cMaj.seq[8] === 71);

const aMin = Core.buildScale(9, 'minor', 4);
eq('A 自然小调上行', aMin.up, [69, 71, 72, 74, 76, 77, 79, 81]);
eq('五声音阶 6 个音', Core.buildScale(0, 'penta', 4).up.length, 6);

eq('大三和弦', Core.buildChord(0, 'maj', 4).midis, [60, 64, 67]);
eq('小三和弦', Core.buildChord(9, 'min', 4).midis, [69, 72, 76]);
eq('属七和弦', Core.buildChord(7, 'dom7', 4).midis, [67, 71, 74, 77]);
eq('减三和弦', Core.buildChord(2, 'dim', 4).midis, [62, 65, 68]);

const prog = Core.buildProgression(['C', 'G', 'Am'], 4);
eq('和弦进行步数', prog.length, 3);
eq('进行首和弦', prog[0].midis, [60, 64, 67]);
eq('进行第三和弦', prog[2].midis, [69, 72, 76]);

/* ====================================================== 跟弹状态机 */

console.log('\n【跟弹状态机】');

const song = Core.compileSong(Songs.byId('twinkle'));
const sess = new Practice.SongPractice(song, { hands: 'right', tempo: 100, lead: 1.0 });
sess.start();
eq('初始状态', sess.state, 'playing');
ok('判定音数 = 右手音符数', sess.total === song.notes.filter(n => n.hand === 'R').length);
ok('自动伴奏音 = 左手音符数', sess.autoNotes.length === song.notes.filter(n => n.hand === 'L').length);

// 走到第一个音并命中
sess.t = sess.notes[0].start;
const r1 = sess.press(sess.notes[0].midi);
eq('命中判定为 hit', r1.type, 'hit');
ok('得分为正', r1.points > 0);
eq('连击为 1', sess.combo, 1);
eq('命中后音符状态', sess.notes[0].state, 'hit');

// 提前太多按下 → 错音
sess.t = sess.notes[1].start - 0.4;
const r2 = sess.press(sess.notes[1].midi);
eq('过早按下判为 wrong', r2.type, 'wrong');
eq('错音计数 +1', sess.counts.wrong, 1);
eq('错音清空连击', sess.combo, 0);

// 曲外音符不罚
sess.t = sess.notes[1].start;
const r3 = sess.press(21);
eq('曲外音不罚分', r3.type, 'neutral');
eq('曲外音不计入错音', sess.counts.wrong, 1);

// 漏音判定
const beforeMiss = sess.counts.miss;
sess.t = sess.notes[1].start + 0.5;
sess.update(0.01);
ok('超时未按记为漏音', sess.counts.miss > beforeMiss);

sess.finish();
eq('结束后状态', sess.state, 'done');
ok('总结含等级', ['S', 'A', 'B', 'C', 'D'].includes(sess.summary().grade));

/* 单手 + 自动伴奏：另一手应自动发声 */
const sess2 = new Practice.SongPractice(song, { hands: 'right', autoOther: true, tempo: 100, lead: 0.5 });
let autoFired = 0;
sess2.onAutoNote = () => { autoFired++; };
sess2.start();
sess2.update(2.5);
ok('自动伴奏手会自己发声', autoFired > 0, 'fired=' + autoFired);
ok('自动音不计入待弹总数', sess2.total === song.notes.filter(n => n.hand === 'R').length);

/* ====================================================== 认键状态机 */

console.log('\n【认键状态机】');

const seq = [0.1, 0.7, 0.3, 0.9];
let idx = 0;
const finder = new Practice.NoteFinder({
  pool: [60, 62, 64, 65],
  rounds: 4,
  timeLimit: 3,
  rng: () => seq[idx++ % seq.length]
});
ok('认键可以开始', finder.start());
eq('认键初始状态', finder.state, 'playing');
ok('有目标音', finder.target != null);

const target = finder.target;
const wrongRes = finder.press(target === 60 ? 62 : 60);
eq('答错判为 not ok', wrongRes.ok, false);
eq('答错计数 +1', finder.wrong, 1);
ok('答错扣时间', finder.timeLeft < 3);

const t2 = finder.target;
finder.press(t2);
eq('答对计数 +1', finder.correct, 1);
eq('答对后进入下一题', finder.index, 1);

// 超时
finder.timeLeft = 0.01;
finder.update(0.02);
eq('超时计数 +1', finder.timeouts, 1);

finder.index = finder.rounds;
finder._next();
eq('答满题数后结束', finder.state, 'done');
ok('认键总结含准确率', typeof finder.summary().accuracy === 'number');

/* ====================================================== 音阶状态机 */

console.log('\n【音阶状态机】');

const drill = new Practice.ScaleDrill([60, 62, 64, 65], { name: '测试' });
eq('音阶初始状态', drill.state, 'playing');
eq('音阶第一个待弹', drill.next(), 60);
eq('按错音记错', drill.press(61).ok, false);
eq('错音计数', drill.errors, 1);
eq('按对音前进', drill.press(60).index, 1);
drill.press(62); drill.press(64); drill.press(65);
eq('弹完即完成', drill.state, 'done');
ok('有错音时等级降到 A', drill.summary().grade === 'A', drill.summary().grade);

const clean = new Practice.ScaleDrill([60, 62, 64], { name: '干净' });
clean.press(60); clean.press(62); clean.press(64);
eq('全对等级 S', clean.summary().grade, 'S');
eq('全对标记', clean.summary().clean, true);

/* ====================================================== 和弦状态机 */

console.log('\n【和弦状态机】');

const chord = new Practice.ChordDrill(
  [{ name: 'C', midis: [60, 64, 67] }, { name: 'G', midis: [59, 62, 67] }],
  { bpm: 120, beatsPerChord: 4, loops: 1 }
);
chord.start();
eq('和弦初始状态', chord.state, 'playing');
eq('当前和弦', chord.current().name, 'C');
eq('按错音判错', chord.press(61).wrong, true);
chord.press(60); chord.press(64);
eq('还差一个音不算完成', chord.state, 'playing');
const done = chord.press(67);
eq('按齐和弦算完成', done.complete, true);
eq('完成后进入下一个和弦', chord.current().name, 'G');
ok('和弦统计已清 1', chord.cleared === 1);

chord.timeLeft = 0.01;
chord.update(0.02);
ok('和弦超时记漏', chord.missed === 1);

/* ========================================================== 曲库体检 */

console.log('\n【曲库体检】');

ok('曲库非空', Songs.SONGS.length >= 10, String(Songs.SONGS.length));
ok('和弦进行非空', Songs.PROGRESSIONS.length >= 5, String(Songs.PROGRESSIONS.length));

Songs.SONGS.forEach(s => {
  const issues = Core.lintSong(s);
  ok('《' + s.title + '》曲谱无问题', issues.length === 0, issues.join('；'));
});

Songs.PROGRESSIONS.forEach(p => {
  const bad = p.chords.filter(c => !Core.parseChord(c));
  ok('和弦进行《' + p.name + '》记号合法', bad.length === 0, bad.join(','));
  const steps = Core.buildProgression(p.chords, 4);
  ok('和弦进行《' + p.name + '》可生成', steps.length === p.chords.length);
});

/* ------------------------------------------------------------ 细节 */

console.log('\n【曲库细节】');

const twinkle = Core.compileSong(Songs.byId('twinkle'));
const twRH = twinkle.notes.filter(n => n.hand === 'R');
eq('小星星右手 42 个音', twRH.length, 42);
eq('小星星 12 小节', twinkle.measures.length, 12);
eq('小星星第一小节 C4 C4 G4 G4',
  twRH.filter(n => n.measure === 0).map(n => n.midi), [60, 60, 67, 67]);
eq('小星星第二小节 A4 A4 G4(两拍)',
  twRH.filter(n => n.measure === 1).map(n => n.midi), [69, 69, 67]);
eq('小星星第三小节 F4 F4 E4 E4',
  twRH.filter(n => n.measure === 2).map(n => n.midi), [65, 65, 64, 64]);

const ode = Core.compileSong(Songs.byId('ode'));
eq('欢乐颂第一音 E4', ode.notes.filter(n => n.hand === 'R')[0].midi, 64);
eq('欢乐颂 16 小节', ode.measures.length, 16);

const birthday = Core.compileSong(Songs.byId('birthday'));
ok('生日快乐含 G5', birthday.notes.some(n => n.midi === 79));
ok('生日快乐含 F5', birthday.notes.some(n => n.midi === 77));

const elise = Core.compileSong(Songs.byId('elise'));
ok('致爱丽丝含 D#5', elise.notes.some(n => n.midi === 75));
ok('致爱丽丝有左手琶音', elise.notes.filter(n => n.hand === 'L').length > 0);

const row = Core.compileSong(Songs.byId('row'));
ok('划船歌是 3/4 拍', row.timeSig[0] === 3);
ok('划船歌含 C5', row.notes.some(n => n.midi === 72));

const jingle = Core.compileSong(Songs.byId('jingle'));
ok('铃儿响叮当含 G4', jingle.notes.some(n => n.midi === 67));

const lullaby = Core.compileSong(Songs.byId('lullaby'));
ok('摇篮曲是 3/4 拍', lullaby.timeSig[0] === 3);

const tigers = Core.compileSong(Songs.byId('two-tigers'));
ok('两只老虎含 G3', tigers.notes.some(n => n.midi === 55));

/* ========================================================== 设置 */

console.log('\n【设置规范化】');

const s1 = Core.normalizeSettings({ volume: 5, reverb: -1, whiteCount: 999, label: 'x', tempo: 999 });
eq('音量截断到 1', s1.volume, 1);
eq('混响截断到 0', s1.reverb, 0);
eq('白键数上限 52', s1.whiteCount, 52);
eq('非法标签回落 name', s1.label, 'name');
eq('速度截断 140', s1.tempo, 140);
eq('默认曲目', s1.songId, 'twinkle');

const s2 = Core.normalizeSettings(null);
eq('空设置用默认值', s2.volume, Core.DEFAULT_SETTINGS.volume);
ok('startWhite 不越界', s2.startWhite >= 0 && s2.startWhite + s2.whiteCount <= 52);

/* ========================================================== 汇总 */

console.log('\n' + pass + ' 项通过' + (fails.length ? '，' + fails.length + ' 项失败' : ''));
if (fails.length) {
  fails.forEach(f => console.log('  ✗ ' + f));
  process.exit(1);
}
