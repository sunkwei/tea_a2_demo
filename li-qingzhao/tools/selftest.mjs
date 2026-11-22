/**
 * 李清照 · 漱玉词 —— 离线自检
 *
 *   node li-qingzhao/tools/selftest.mjs
 *
 * 覆盖：数据完整性 / 图片与署名 / 音频文件 / 纯逻辑 / 提问与检索解析 / 音频播放器
 * 不启动浏览器；端到端请跑 tools/verify.mjs。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

let pass = 0;
let fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra != null ? '  → ' + extra : '')); }
}
globalThis.window = globalThis;
function load(rel) {
  const file = path.join(ROOT, rel);
  vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: rel });
}
function text(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }

console.log('李清照 · 漱玉词 —— 离线自检\n');

/* ------------------------------------------------------------------ *
 * 1. 加载
 * ------------------------------------------------------------------ */
load('src/data-life.js');
load('src/core.js');
load('src/audio.js');
load('src/online.js');

const D = globalThis.LI_QINGZHAO_DATA;
const C = globalThis.LI_QINGZHAO_CORE;
const A = globalThis.LI_QINGZHAO_AUDIO_PLAYER;
const O = globalThis.LI_QINGZHAO_ONLINE;
check('data-life.js 加载', !!D && Array.isArray(D.entries));
check('core.js 加载', !!C && typeof C.validate === 'function');
check('audio.js 加载', !!A && typeof A.createPlayer === 'function');
check('online.js 加载', !!O && typeof O.search === 'function');

/* ------------------------------------------------------------------ *
 * 2. 数据完整性
 * ------------------------------------------------------------------ */
const problems = C.validate(D.entries);
check('数据体检无问题', problems.length === 0, problems.join(' / '));
check('条目数 = 16（14 篇作品 + 生平 + 余响）', D.entries.length === 16, D.entries.length);
check('meta.works = 14', D.meta.works === 14, D.meta.works);
check('五个 stage 都有条目', C.stagesOf(D.entries, D.stages).every((s) => s.count > 0));
const stageCounts = C.stagesOf(D.entries, D.stages).map((s) => s.count);
check('各段篇数合计 = 16', stageCounts.reduce((a, b) => a + b, 0) === 16, stageCounts.join(','));
check('order 连续 1..16', C.sortByOrder(D.entries).every((e, i) => e.order === i + 1));
check('id 唯一', new Set(D.entries.map((e) => e.id)).size === D.entries.length);
check('所有条目有 keyLine', D.entries.every((e) => typeof e.keyLine === 'string' && e.keyLine.trim()));
check('所有条目有 question', D.entries.every((e) => e.question && e.question.length > 6));
check('所有条目 stage 在 1..5', D.entries.every((e) => e.stage >= 1 && e.stage <= 5));
check('所有条目 body 至少两段', D.entries.every((e) => e.body.length >= 2));
check('所有条目 notes 至少两条', D.entries.every((e) => e.notes.length >= 2));
check('所有条目 points 三条', D.entries.every((e) => e.points.length === 3));
check('词/诗条目有 poem 文本', D.entries.filter((e) => e.kind === '词' || e.kind === '诗').every((e) => e.poem.length >= 2));
check('散文条目 poem 至少 3 段', D.entries.filter((e) => e.prose).every((e) => e.poem.length >= 3));
check('余响条目有 quote 与出处', D.entries.filter((e) => e.kind === '余响').every((e) => e.quote && e.quoteFrom));
check('年代都落在 1080—1160', D.entries.every((e) => {
  const nums = (e.years.match(/\d{4}/g) || []).map(Number);
  return nums.length && nums.every((n) => n >= 1080 && n <= 1160);
}));
check('行迹 11 个地点', D.journey.length === 11, D.journey.length);
check('meta.span = 1084—1155', D.meta.span === '1084—1155', D.meta.span);

/* ------------------------------------------------------------------ *
 * 3. 图片与署名
 * ------------------------------------------------------------------ */
load('assets/images/sources.js');
const CREDITS = globalThis.LI_QINGZHAO_CREDITS;
const AUDIO = globalThis.LI_QINGZHAO_AUDIO;
check('sources.js 有署名对象', !!CREDITS && Object.keys(CREDITS).length >= 18, Object.keys(CREDITS || {}).length);
check('音频有署名对象', !!AUDIO && !!AUDIO.license && !!AUDIO.sourceUrl);

const imageRefs = [];
D.entries.forEach((e) => {
  const img = e.image || 'assets/images/' + e.id + '.jpg';
  imageRefs.push([e.creditId || String(img).split('/').pop().replace(/\.[a-z0-9]+$/i, ''), img]);
  (e.extra || []).forEach((x) => imageRefs.push([x.id, 'assets/images/' + x.id + '.jpg']));
});
imageRefs.push(['hero-lotus', 'assets/images/hero-lotus.jpg']);
const missing = imageRefs.filter(([, src]) => !exists(src));
check('所有引用的图片都存在', missing.length === 0, missing.map((x) => x[0]).join(','));
const tiny = imageRefs.filter(([, src]) => exists(src) && fs.statSync(path.join(ROOT, src)).size < 8000);
check('图片都大于 8KB', tiny.length === 0, tiny.map((x) => x[0]).join(','));
const noCredit = imageRefs.filter(([id]) => !CREDITS[id]);
check('所有图片都有署名', noCredit.length === 0, noCredit.map((x) => x[0]).join(','));
const badLicense = Object.entries(CREDITS).filter(([, c]) => !/^(cc0|public domain|pd\b|cc[- ]by)/i.test(c.license || ''));
check('图片许可都在白名单内', badLicense.length === 0, badLicense.map((x) => x[0]).join(','));
check('署名都有 Commons 原链', Object.values(CREDITS).every((c) => /^https:\/\/commons\.wikimedia\.org\//.test(c.sourceUrl || '')));
check('署名作者都不为空', Object.values(CREDITS).every((c) => (c.author || '').trim().length > 0));

try {
  const out = execFileSync('identify', ['-format', '%m %w %h\n', path.join(ROOT, 'assets/images/hero-lotus.jpg')], { encoding: 'utf8' });
  check('ImageMagick 能读图片尺寸', /JPEG \d+ \d+/.test(out), out.trim());
} catch (e) {
  check('ImageMagick 能读图片尺寸', false, e.message);
}

const audioFile = path.join(ROOT, 'assets/audio/yangguan-sandie.mp3');
check('古琴音频存在且 > 1MB', fs.existsSync(audioFile) && fs.statSync(audioFile).size > 1048576, fs.existsSync(audioFile) ? fs.statSync(audioFile).size : 'missing');
check('音频文件头是 MP3', fs.existsSync(audioFile) && ['ID3', '\u00ff\u00fb'].indexOf(fs.readFileSync(audioFile).slice(0, 3).toString('latin1')) >= 0);
check('音频许可 CC BY-SA 3.0', /CC BY-SA 3.0/.test(AUDIO.license || ''), AUDIO.license);

/* ------------------------------------------------------------------ *
 * 4. 纯逻辑
 * ------------------------------------------------------------------ */
check('sortByOrder 不改原数组', D.entries[0].order === 1 && C.sortByOrder(D.entries) !== D.entries);
check('byId 能取到 shaonv', C.byId(D.entries, 'shaonv').id === 'shaonv');
check('indexOfId 返回 0..n', C.indexOfId(D.entries, 'yuxiang') === 15, C.indexOfId(D.entries, 'yuxiang'));
check('neighbor 末条 +1 回到第一条', C.neighbor(D.entries, 'yuxiang', 1).id === 'zhangqiu');
check('neighbor 首条 -1 到末条', C.neighbor(D.entries, 'zhangqiu', -1).id === 'yuxiang');
check('shortYears 去掉括号', C.shortYears('约 1104 年（一说青州）') === '约 1104 年');
check('railYear 取起始年', C.railYear('1127—1128') === '1127', C.railYear('1127—1128'));
check('railYear 处理单年', C.railYear('1101') === '1101');
check('eraNav 16 项且标签短', C.eraNav(D.entries).length === 16 && C.eraNav(D.entries).every((x) => x.label.length < 20));
check('stagesOf 重新统计篇数', stageCounts.join(',') === '4,3,3,3,3', stageCounts.join(','));
const stats = C.stats(D.entries, D.meta);
check('stats.works = 14', stats.works === 14, stats.works);
check('stats.places = 10', stats.places === 10, stats.places);
check('kindsText 含 11 首词', /11 首词/.test(C.kindsText(D.entries)), C.kindsText(D.entries));
check('escapeHtml 转义脚本', C.escapeHtml('<script>') === '&lt;script&gt;');
check('poemLineHtml 弱化标点', /<i class="punct">，<\/i>/.test(C.poemLineHtml('寻寻觅觅，')));
check('splitTitle 拆词牌', C.splitTitle('如梦令 · 常记溪亭日暮').tune === '如梦令');
check('splitTitle 保留无词牌标题', C.splitTitle('夏日绝句').tune === '');
check('tuneOf 返回词牌', C.tuneOf(D.entries.find((e) => e.id === 'shaonv')) === '如梦令');
check('creditText 带许可', /CC|Public domain/.test(C.creditText(CREDITS.xinhu)), C.creditText(CREDITS.xinhu));

/* 提问 */
const prompt = C.buildAskPrompt(D.entries.find((e) => e.id === 'shengshengman'), '开头的叠字为什么好？', D.meta);
check('提问 prompt 含作品名', prompt.includes('声声慢'));
check('提问 prompt 含原文', prompt.includes('寻寻觅觅'));
check('提问 prompt 含用户问题', prompt.includes('开头的叠字为什么好？'));
check('提问 prompt 要求注明异说', prompt.includes('存疑'));
check('空问题被拒', C.validateQuestion('  ') !== '');
check('长问题被拒', C.validateQuestion('问'.repeat(C.MAX_QUERY + 1)) !== '');
check('正常问题通过', C.validateQuestion('这首词好在哪里？') === '');

/* 检索解析 */
const sample = '3 result(s) for: 李清照 声声慢\n\n[1] 声声慢 - 百度百科\n    url: https://baike.baidu.com/item/声声慢\n    score: 0.92\n    summary: 李清照词作。\n\n[2] 李清照 - 维基百科\n    url: https://zh.wikipedia.org/wiki/李清照\n    score: 0.88\n    summary: 宋代词人。';
const parsed = C.parseSearchOutput(sample);
check('parseSearchOutput 解析 2 条', parsed.length === 2, parsed.length);
check('parseSearchOutput 取 url/标题', parsed[0].url.includes('baike') && parsed[0].title.includes('声声慢'));
const calls = [{ ok: true, output: sample }, { ok: false, output: sample }];
const sources = C.parseSources(calls);
check('parseSources 跳过失败调用并去重', sources.length === 2, sources.length);
check('mergeSources 去重合并', C.mergeSources(sources, C.extractUrls('见 https://zh.wikipedia.org/wiki/李清照 和 https://example.com/a')).length === 3);
check('extractUrls 去掉句末标点', C.extractUrls('见 https://example.com/a。')[0].url === 'https://example.com/a');

/* 回答渲染（先转义，再做有限 Markdown 处理） */
const md = C.renderAnswer('**结论先说：** 家世影响大。\n\n1. **家世**，主要是"文化课本"\n2. 第二条\n\n- 要点 A\n\n结尾');
check('renderAnswer 渲染粗体', /<strong>结论先说：<\/strong>/.test(md), md.slice(0, 80));
check('renderAnswer 渲染有序列表', /<ol><li><strong>家世<\/strong>/.test(md));
check('renderAnswer 渲染无序列表', /<ul><li>要点 A<\/li><\/ul>/.test(md));
check('renderAnswer 保留段落', /<p>结尾<\/p>/.test(md));
check('renderAnswer 转义 HTML', !/<script>/.test(C.renderAnswer('<script>alert(1)</script>')));
check('renderAnswer 只放行 http(s) 链接', /<a href="https:\/\/a\.b"/.test(C.renderAnswer('[x](https://a.b)')) && !/<a href="javascript:/.test(C.renderAnswer('[x](javascript:alert(1))')));

/* ------------------------------------------------------------------ *
 * 5. 音频播放器
 * ------------------------------------------------------------------ */
check('normalizeVolume 夹取范围', A.normalizeVolume(120) === 100 && A.normalizeVolume(-5) === 0);
check('normalizeVolume 非法值回默认', A.normalizeVolume('x') === 45);
check('volumeToGain(0)=0', A.volumeToGain(0) === 0);
check('volumeToGain(100)=1', A.volumeToGain(100) === 1);
check('volumeToGain 单调', A.volumeToGain(20) < A.volumeToGain(50) && A.volumeToGain(50) < A.volumeToGain(80));
check('readSettings 默认值', A.readSettings(null).volume === 45 && A.readSettings(null).enabled === false);

function fakeStorage(initial) {
  const map = Object.assign({}, initial || {});
  return {
    getItem: (k) => (k in map ? map[k] : null),
    setItem: (k, v) => { map[k] = String(v); },
    removeItem: (k) => { delete map[k]; },
    dump: () => map,
  };
}

function fakeAudio() {
  const listeners = {};
  return {
    volume: 0, currentTime: 0, duration: 350, loop: false, preload: '', src: '', paused: true,
    played: 0,
    play() { this.played++; this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; },
    load() {},
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    fire(type) { (listeners[type] || []).forEach((fn) => fn()); },
  };
}

const store = fakeStorage();
const audioEl = fakeAudio();
const player = A.createPlayer({ audio: audioEl, src: 'assets/audio/yangguan-sandie.mp3', storage: store, fadeMs: 0 });
check('createPlayer 设置 src 与 loop', audioEl.src === 'assets/audio/yangguan-sandie.mp3' && audioEl.loop === true);
check('初始未播放、音量为 0', player.getState().playing === false && audioEl.volume === 0);

const played = await player.play();
check('play() 后进入播放状态', played.playing === true && audioEl.played === 1);
check('play() 后音量按 45% 曲线设置', Math.abs(audioEl.volume - A.volumeToGain(45)) < 0.001, audioEl.volume);
check('play() 写入 localStorage enabled', JSON.parse(store.dump()[A.KEY]).enabled === true);
check('setVolume(80) 生效', player.setVolume(80) === 80 && Math.abs(audioEl.volume - A.volumeToGain(80)) < 0.001);
check('后台压低 0.32×', player.setDucked(true) && Math.abs(audioEl.volume - A.volumeToGain(80) * A.DUCKED) < 0.001);
player.setDucked(false);
player.pause();
check('pause() 后状态与音量', player.getState().playing === false && audioEl.volume === 0);
check('pause() 写入 enabled=false', JSON.parse(store.dump()[A.KEY]).enabled === false);

const store2 = fakeStorage({ [A.KEY]: JSON.stringify({ enabled: true, volume: 66 }) });
const p2 = A.createPlayer({ audio: fakeAudio(), src: 'x.ogg', storage: store2, fadeMs: 0 });
check('记住上次音量', p2.getState().volume === 66);
check('记住上次开启状态', p2.shouldResume() === true);

/* ------------------------------------------------------------------ *
 * 6. 页面骨架
 * ------------------------------------------------------------------ */
const html = text('index.html');
check('index.html 引用 6 个脚本', ['assets/images/sources.js', 'src/data-life.js', 'src/core.js', 'src/audio.js', 'src/online.js', 'src/app.js'].every((s) => html.includes('src="' + s + '"')));
check('index.html 有 audio 元素', /<audio id="bgm"[^>]*loop/.test(html));
check('index.html 有关键容器', ['heroIntro', 'stageGrid', 'journeyTrack', 'railList', 'timelineList', 'lightbox', 'ai', 'musicBtn'].every((id) => html.includes('id="' + id + '"')));
check('CSS 有深色模式', /prefers-color-scheme:\s*dark/.test(text('src/styles.css')));
check('CSS 有响应式断点', /@media \(max-width: 720px\)/.test(text('src/styles.css')));
check('CSS 有打印样式', /@media print/.test(text('src/styles.css')));
check('build-single.mjs 存在', exists('tools/build-single.mjs'));
check('serve.mjs 存在', exists('tools/serve.mjs'));
check('verify.mjs 存在', exists('tools/verify.mjs'));

/* ------------------------------------------------------------------ */
console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (fail) process.exit(1);
