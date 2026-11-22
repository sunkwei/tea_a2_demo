/**
 * 中国陶器史 · 离线自检（不启动浏览器、不联网）
 *
 *   node pottery/tools/selftest.mjs
 *
 * 覆盖：数据完整性 / 图片与署名文件 / 纯逻辑（排序、邻居、检索解析）
 *      / 提问词构造 / HTML 转义。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

let pass = 0;
const fails = [];
function check(name, ok, extra) {
  if (ok) {
    pass++;
    console.log('  ✓ ' + name);
  } else {
    fails.push(name);
    console.log('  ✗ ' + name + (extra ? '  → ' + extra : ''));
  }
}
function eq(name, actual, expect) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expect);
  check(name, a === e, '得到 ' + a + '，期望 ' + e);
}

/* 以“浏览器脚本”的方式加载，顺带验证 UMD 包装本身可用 */
function loadScript(rel) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const m = { exports: {} };
  new Function('module', 'exports', src)(m, m.exports);
  return m.exports;
}

const data = loadScript('src/data-ceramics.js');
const core = loadScript('src/core.js');
globalThis.POTTERY_CORE = core;
const online = loadScript('src/online.js');
const audio = loadScript('src/audio.js');
const credits = (() => {
  const fake = {};
  new Function('window', fs.readFileSync(path.join(ROOT, 'assets/ceramics/sources.js'), 'utf8'))(fake);
  return fake.POTTERY_IMAGE_CREDITS || {};
})();

console.log('\n[1] 数据');
const entries = core.sortByOrder(core.withImages(data.entries));
eq('条目数量为 20', entries.length, 20);
eq('数据体检无问题', core.validate(entries), []);
check('order 从 1 连续递增', entries.every((e, i) => e.order === i + 1), entries.map((e) => e.order).join(','));
check('meta 有标题与导语', !!(data.meta && data.meta.title && data.meta.intro));
check('陶/瓷对照表 5 行', Array.isArray(data.compare) && data.compare.length === 5);
check(
  '时间线覆盖现代工业陶瓷',
  entries[entries.length - 1].id === 'modern' && /陶瓷基复合材料|MLCC/.test(entries[entries.length - 1].body.join(''))
);
check('最早一条提到两万年区间', /20000/.test(entries[0].years) && /陶/.test(entries[0].title));

console.log('\n[2] 图片与署名');
const missing = [];
const tiny = [];
entries.forEach((e) => {
  const p = path.join(ROOT, e.image);
  if (!fs.existsSync(p)) { missing.push(e.id); return; }
  if (fs.statSync(p).size < 20000) tiny.push(e.id + '(' + fs.statSync(p).size + ')');
});
check('每件器物都有图片文件', missing.length === 0, missing.join(','));
check('图片体积都 > 20KB（不是占位图）', tiny.length === 0, tiny.join(','));
const badCredit = entries.filter((e) => !credits[e.id] || !credits[e.id].license || !credits[e.id].sourceUrl);
check('每件器物都有许可与来源链接', badCredit.length === 0, badCredit.map((e) => e.id).join(','));
const licenseOk = /^(CC0|CC BY|CC BY-SA|Public domain)/i;
const badLicense = entries.filter((e) => !licenseOk.test(credits[e.id].license));
check('许可都在 CC0 / CC BY / CC BY-SA / PD 范围', badLicense.length === 0, badLicense.map((e) => e.id + ':' + credits[e.id].license).join(','));
const extraCredits = Object.keys(credits).filter((k) => !entries.some((e) => e.id === k));
check('没有孤立的署名条目（modern-sic/mlcc 允许）', extraCredits.every((k) => k.startsWith('modern-')), extraCredits.join(','));

console.log('\n[3] 纯逻辑');
eq('withImages 会补路径且不改原对象', [entries[0].image, data.entries[0].image], ['assets/ceramics/xianrendong.jpg', undefined]);
eq('byId 命中', core.byId(entries, 'ru').title, '天青釉洗');
eq('byId 未命中返回 null', core.byId(entries, 'nope'), null);
eq('indexOfId', core.indexOfId(entries, 'doucai'), 16);
eq('neighbor +1', core.neighbor(entries, 'xianrendong', 1).id, 'peiligang');
eq('neighbor -1 循环到最后', core.neighbor(entries, 'xianrendong', -1).id, 'modern');
eq('neighbor 从末尾 +1 回到开头', core.neighbor(entries, 'modern', 1).id, 'xianrendong');
eq('shortYears 去掉括号', core.shortYears('723 年（开元十一年）'), '723 年');
eq('shortYears 空值', core.shortYears(null), '');
const nav = core.eraNav(entries);
eq('eraNav 与条目同长', nav.length, entries.length);
check('eraNav 带 id/era/years', nav.every((n) => n.id && n.era && n.years));
const st = core.stats(entries);
eq('stats.count', st.count, 20);
check('stats.cultures 去重', st.cultures >= 15 && st.cultures <= 20, String(st.cultures));
eq('creditText 组合作者与许可', core.creditText({ author: 'A', license: 'CC0', note: '' }), '图片：A · CC0');
check('creditText 空署名有兜底', core.creditText(null).includes('Wikimedia'));

console.log('\n[4] 提问词');
eq('normalizeQuery 折叠空白', core.normalizeQuery('  汝窑   天青\n釉 '), '汝窑 天青 釉');
check('normalizeQuery 截断到 300', core.normalizeQuery('x'.repeat(500)).length === 300);
const prompt = core.buildPrompt('汝窑为什么难烧？', core.byId(entries, 'ru'));
check('prompt 含用户问题', prompt.includes('汝窑为什么难烧？'));
check('prompt 含条目上下文', prompt.includes('汝窑') && prompt.includes('1086'));
check('prompt 要求标注不确定', prompt.includes('不同说法'));
check('prompt 要求列来源', prompt.includes('来源：'));
check('prompt 不带 markdown 表格', prompt.includes('不要用 markdown 表格'));

console.log('\n[5] 检索结果解析');
const sample = [
  '2 result(s) for: 汝窑',
  '',
  '[1] 汝窑 - 故宫博物院',
  '    url: https://www.dpm.org.cn/ru.html',
  '    score: 3.21',
  '    authority: 5',
  '    summary: 汝窑为北宋晚期宫廷烧造。',
  '',
  '[2] Ru ware - Wikipedia',
  '    url: https://en.wikipedia.org/wiki/Ru_ware',
  '    score: 1.02',
  '    authority: 2',
  '    summary: Ru ware is a type of Chinese celadon.',
].join('\n');
const parsed = core.parseSearchOutput(sample);
eq('parseSearchOutput 解析两条', parsed.length, 2);
eq('标题/链接/评分/权威', [parsed[0].title, parsed[0].url, parsed[0].score, parsed[0].authority], ['汝窑 - 故宫博物院', 'https://www.dpm.org.cn/ru.html', 3.21, 5]);
check('summary 被保留', parsed[1].summary.includes('celadon'));
const sources = core.parseSources([
  { ok: true, output: sample },
  { ok: true, output: sample },
  { ok: false, output: sample },
]);
eq('parseSources 按 URL 去重', sources.length, 2);
const urls = core.extractUrls('正文见 https://a.example/x，另有 https://b.example/y。');
eq('extractUrls 去掉中文标点', urls.map((u) => u.url), ['https://a.example/x', 'https://b.example/y']);
const merged = core.mergeSources(sources, urls);
eq('mergeSources 合并去重', merged.length, 4);
eq('mergeSources 保序', merged[0].url, 'https://www.dpm.org.cn/ru.html');

console.log('\n[6] 联网层（不发请求）');
eq('normalizeBase 补协议', online.normalizeBase('localhost:8383/'), 'http://localhost:8383');
eq('normalizeBase 默认值', online.normalizeBase(''), 'http://localhost:8383');
eq('healthUrl', online.healthUrl('http://127.0.0.1:8383/'), 'http://127.0.0.1:8383/api/health');
eq('chatUrl', online.chatUrl(''), 'http://localhost:8383/api/llm/chat');
check('默认 provider 支持检索', online.PROVIDER === 'deepseek' && online.MODEL === 'deepseek-flash');
check('启动指引可复制', online.startHint('').includes('tea_agent --port 8383'));
check('错误文案覆盖离线/超时/502', ['offline', 'timeout', 'upstream', 'empty'].every((k) => online.errorText(k).length > 4));

console.log('\n[7] 背景音乐（纯逻辑 + 引擎状态机）');
eq('五声音阶 10 个音', audio.SCALE.length, 10);
eq('A4 = 440Hz', audio.SCALE.find((n) => n.name === 'A4').freq, 440);
eq('D3 = 146.83Hz', audio.SCALE.find((n) => n.name === 'D3').freq, 146.83);
eq('默认音量 45', audio.DEFAULT_VOLUME, 45);
eq('音量 0 → 增益 0', audio.volumeToGain(0), 0);
eq('音量 100 → 增益 1', audio.volumeToGain(100), 1);
eq('音量 50 → 0.287（平方曲线）', audio.volumeToGain(50), 0.287);
eq('音量越界钳制（-10）', audio.volumeToGain(-10), 0);
eq('音量越界钳制（200）', audio.volumeToGain(200), 1);
eq('pickNote(0) = 最低音', audio.pickNote(() => 0).name, 'D3');
eq('pickNote(0.999) = 最高音', audio.pickNote(() => 0.999).name, 'C5');
eq('pickNote(1) 不越界', audio.pickNote(() => 1).name, 'C5');
check('Node 里没有 AudioContext → isSupported=false', audio.isSupported === false);
check('没有 AudioContext 时 createEngine() 返回 null', audio.createEngine() === null);
check('getLastEngine 初始为 null', audio.getLastEngine() === null);

/* 用最小假 AudioContext 跑一遍建图 / start / volume / stop，确认不抛异常且状态正确 */
function fakeParam(v) {
  return {
    value: v,
    setValueAtTime() {},
    setTargetAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
    cancelScheduledValues() {},
  };
}
function fakeNode(extra) {
  return Object.assign({ connect() {}, disconnect() {} }, extra || {});
}
function FakeCtx() {
  this.sampleRate = 44100;
  this.currentTime = 0;
  this.state = 'suspended';
  this.destination = fakeNode();
  this.createGain = () => fakeNode({ gain: fakeParam(0) });
  this.createBiquadFilter = () => fakeNode({ type: '', frequency: fakeParam(0), Q: fakeParam(0) });
  this.createConvolver = () => fakeNode({ buffer: null });
  this.createBuffer = (ch, len) => ({ getChannelData: () => new Float32Array(len) });
  this.createBufferSource = () => fakeNode({ buffer: null, loop: false, start() {}, stop() {} });
  this.createOscillator = () => fakeNode({ type: '', frequency: fakeParam(0), detune: fakeParam(0), start() {}, stop() {} });
  this.createDynamicsCompressor = () =>
    fakeNode({ threshold: fakeParam(0), knee: fakeParam(0), ratio: fakeParam(0), attack: fakeParam(0), release: fakeParam(0) });
  this.resume = () => { this.state = 'running'; return Promise.resolve(); };
  this.suspend = () => { this.state = 'suspended'; return Promise.resolve(); };
  this.close = () => {};
}
const engine = audio.createEngine({ audioContext: FakeCtx });
check('假 AudioContext 下能建出引擎', !!engine);
check('建图产生了节点', engine && engine.nodeCount() >= 10, engine ? String(engine.nodeCount()) : 'null');
eq('初始音量 45', engine.getVolume(), 45);
check('初始未播放', engine.isPlaying() === false);
engine.start();
check('start() 后 isPlaying=true', engine.isPlaying() === true);
eq('start() 会 resume AudioContext', engine.contextState(), 'running');
engine.setVolume(30);
eq('setVolume(30)', engine.getVolume(), 30);
engine.setVolume(999);
eq('setVolume 上界 100', engine.getVolume(), 100);
engine.stop();
check('stop() 后 isPlaying=false', engine.isPlaying() === false);
check('getLastEngine 指向最近引擎', audio.getLastEngine() === engine);
engine.dispose();

console.log('\n[8] HTML 转义');
eq('escapeHtml 处理尖括号与引号', core.escapeHtml('<b class="x">&\'</b>'), '&lt;b class=&quot;x&quot;&gt;&amp;&#39;&lt;/b&gt;');
check('escapeHtml 空值安全', core.escapeHtml(null) === '');

console.log('\n' + pass + ' 项通过，' + fails.length + ' 项失败');
if (fails.length) {
  console.log('失败：');
  fails.forEach((f) => console.log('  · ' + f));
  process.exit(1);
}
