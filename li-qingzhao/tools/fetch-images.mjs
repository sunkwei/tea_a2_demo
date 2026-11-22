/**
 * 李清照 · 漱玉词 —— 从 Wikimedia Commons 抓配图与古琴曲
 *
 * 用法：
 *   node li-qingzhao/tools/fetch-images.mjs            # 全部
 *   node li-qingzhao/tools/fetch-images.mjs --only qingzhou,yijianmei
 *   node li-qingzhao/tools/fetch-images.mjs --force    # 已有文件也重下
 *   node li-qingzhao/tools/fetch-images.mjs --list     # 只列候选，不下载
 *   node li-qingzhao/tools/fetch-images.mjs --audio    # 只重下背景音乐
 *   node li-qingzhao/tools/fetch-images.mjs --meta     # 只刷新署名（不重下图）
 *
 * 规则：
 *   · 只收 CC0 / Public domain / CC BY / CC BY-SA 的图片与音频
 *   · 图片下载 1400px 缩略图，再压到 1400×1600 以内的 JPEG（quality 84）
 *   · 写 assets/images/sources.js：作者 / 许可 / 原链 / 检索词 / 采集日期
 *   · 背景音乐《阳关三叠》来自 Commons（Charlie Huang 演奏，CC BY-SA 3.0），
 *     下载后做响度归一（-20 LUFS）并转码为 44.1kHz / 128kbps MP3
 *   · Node 需要走本机 clash 的 HTTP 代理：
 *       https_proxy=http://127.0.0.1:8118 NODE_USE_ENV_PROXY=1 \
 *         node li-qingzhao/tools/fetch-images.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const IMG_DIR = path.join(ROOT, 'assets', 'images');
const AUDIO_DIR = path.join(ROOT, 'assets', 'audio');
const CREDITS_FILE = path.join(IMG_DIR, 'sources.js');

const UA = 'LiQingzhaoHistoryDemo/1.0 (local educational use; https://github.com/sunkwei/tea_a2_demo)';
const API = 'https://commons.wikimedia.org/w/api.php';
const WIDTH = 1400;
const DELAY_MS = 2600;

/* 每张图都用 Commons 上的确切文件名（pin），保证选图稳定；
   q 只用来记录检索词，便于日后换图。 */
const SOURCE = {
  'hero-lotus': { q: '荷花芦雁图', pin: 'File:明人荷花芦雁图轴.png' },
  zhangqiu: { q: '百脉泉 章丘', pin: 'File:Baimai spring park 2008 05 30.jpg' },
  dianjiangchun: { q: '画丽珠萃秀 秦弄玉 仕女', pin: 'File:畫麗珠萃秀 Gathering Gems of Beauty (秦弄玉).jpg', crop: 'right', author: 'He Dazi（赫达资）' },
  'dianjiangchun-full': { q: '画丽珠萃秀 秦弄玉 全图', pin: 'File:畫麗珠萃秀 Gathering Gems of Beauty (秦弄玉).jpg', author: 'He Dazi（赫达资）' },
  lotusflower: { q: '荷花 特写', pin: 'File:Lotus flower (978659).jpg' },
  xinhu: { q: '清明上河图 汴京', pin: 'File:Along the River During the Qingming Festival (detail of original).jpg' },
  yijianmei: { q: '残荷 吕纪', pin: 'File:吕纪残荷鹰鹭图轴.png' },
  zuihuayin: { q: '菊花 陶镕', pin: "File:Chrysanthemums from 'Album of Flower Paintings' by Tao Rong, Honolulu Museum of Art.JPG" },
  qingzhou: { q: '青州 范公亭', pin: 'File:Gate of the Fangongting Park.jpg' },
  'qingzhou-book': { q: '宋版书 庄子', pin: 'File:Zhuangzi Song Edition.jpg' },
  nandu: { q: '马远 寒江独钓', pin: 'File:Angler on a Wintry Lake, by Ma Yuan, 1195.jpg' },
  wujiang: { q: '项王故里 英风阁', pin: 'File:宿迁项王故里英风阁(1) - panoramio.jpg' },
  guyan: { q: '宋徽宗 梅花', pin: 'File:Songhuizong3.jpg' },
  jinshilu: { q: '宋版书 易经', pin: 'File:I Ching Song Dynasty print.jpg' },
  bayonglou: { q: '金华 八咏楼', pin: 'File:Bayonglou 7732.jpg' },
  'bayonglou-dama': { q: '李清照 打马图', pin: 'File:李清照打馬圖.png' },
  wulingchun: { q: '周茂叔爱莲图 舟', pin: 'File:周茂叔愛蓮図-Zhou Maoshu Admiring Lotuses MET DP-12232-283.jpg' },
  shengshengman: { q: '芦雁图 边寿民', pin: 'File:边寿民芦雁图轴.jpg' },
  yongyule: { q: '西湖 夜景 临安', pin: 'File:2014.11.21.193919 Bridge causeway night Xihu Hangzhou.jpg' },
  yuxiang: { q: '李清照纪念堂 济南', pin: 'File:Li Qingzhao Memorial.JPG' },
  'yuxiang-statue': { q: '李清照塑像', pin: 'File:李清照塑像.jpg' },
};

const AUDIO = {
  src: 'assets/audio/yangguan-sandie.mp3',
  title: '阳关三叠',
  titleEn: 'Yangguan Sandie · Three Refrains on the Yang Pass Theme',
  performer: 'Charlie Huang（Charles R Tsua）',
  instrument: '古琴（丝弦/尼龙弦）',
  score: '《琴学入门》（1867）',
  recorded: '2013-10-06 · 英国伯明翰',
  license: 'CC BY-SA 3.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
  sourceUrl: 'https://commons.wikimedia.org/wiki/File:Guqin-Yangguan_Sandie.ogg',
  note: '响度归一 + 44.1kHz / 128kbps MP3 转码；改编版同许可。',
};

const MIME_OK = /^image\/(jpeg|png|webp)$/;
const LICENSE_OK = [/^cc0/i, /^public domain/i, /^pd\b/i, /^cc[- ]by(-sa)?\s*\d/i, /^cc[- ]by(-sa)?$/i];

function parseArgs(argv) {
  const out = { only: null, force: false, list: false, audio: false, meta: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') out.force = true;
    else if (a === '--list') out.list = true;
    else if (a === '--audio') out.audio = true;
    else if (a === '--meta') out.meta = true;
    else if (a === '--only') out.only = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--only=')) out.only = a.slice(7).split(',').map((s) => s.trim()).filter(Boolean);
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stripTags = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

async function fetchJson(url, tries = 6) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA }, signal: ctrl.signal });
      if (res.status === 429 || res.status === 503) {
        const retryAfter = Number(res.headers.get('retry-after')) || 0;
        const wait = Math.max(retryAfter * 1000, 9000 * (i + 1));
        process.stdout.write('   ⏳ 限流，等待 ' + Math.round(wait / 1000) + 's 后重试\n');
        await sleep(wait);
        lastErr = new Error('HTTP ' + res.status);
        continue;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      if (!text.trim().startsWith('{')) throw new Error('non-json response');
      return JSON.parse(text);
    } catch (e) {
      lastErr = e;
      await sleep(1500 * (i + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

async function fetchBinary(url, tries = 6) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90000);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 3000) throw new Error('too small: ' + buf.length);
      return buf;
    } catch (e) {
      lastErr = e;
      await sleep(2500 * (i + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

function infoOf(page) {
  const info = (page.imageinfo || [])[0];
  if (!info) return null;
  if (!MIME_OK.test(String(info.mime || ''))) return null;
  const em = info.extmetadata || {};
  const license = stripTags(em.LicenseShortName && em.LicenseShortName.value);
  if (!license || !LICENSE_OK.some((re) => re.test(license))) return null;
  if ((info.width || 0) < 500 || (info.height || 0) < 300) return null;
  return { info, em, license, title: String(page.title || '').replace(/^File:/, '') };
}

async function fetchByTitle(title) {
  const t = /^File:/i.test(title) ? title : 'File:' + title;
  const url = API + '?action=query&format=json&formatversion=2&maxlag=5&titles=' +
    encodeURIComponent(t) + '&prop=imageinfo&iiprop=url|extmetadata|size|mime&iiurlwidth=' + WIDTH;
  const json = await fetchJson(url);
  const page = (json.query && json.query.pages && json.query.pages[0]) || null;
  return page ? infoOf(page) : null;
}

async function searchCandidates(q) {
  const url = API + '?action=query&format=json&formatversion=2&maxlag=5&generator=search' +
    '&gsrnamespace=6&gsrlimit=12&gsrsearch=' + encodeURIComponent(q) +
    '&prop=imageinfo&iiprop=url|extmetadata|size|mime&iiurlwidth=' + WIDTH;
  const json = await fetchJson(url);
  const pages = (json.query && json.query.pages) || [];
  return pages.map((p) => {
    const got = infoOf(p);
    return got ? Object.assign({ page: p, title: String(p.title || '').replace(/^File:/, '') }, got) : null;
  }).filter(Boolean).sort((a, b) => (b.info.width || 0) - (a.info.width || 0));
}

function cleanAuthor(s) {
  let t = stripTags(s);
  if (!t || /unknown/i.test(t)) return '佚名';
  t = t.replace(/^Creator:\s*/i, '').replace(/\s+was identified[\s\S]*$/i, '').trim();
  if (t.length > 60) t = t.slice(0, 60).replace(/[\s,;:，。]+$/, '') + '…';
  return t.replace(/\s+/g, ' ');
}

function creditFor(id, cfg, got) {
  const em = got.em;
  return {
    file: 'assets/images/' + id + '.jpg',
    title: got.title || id,
    author: (cfg && cfg.author) || cleanAuthor(em.Artist && em.Artist.value),
    license: got.license,
    licenseUrl: stripTags(em.LicenseUrl && em.LicenseUrl.value) || '',
    sourceUrl: got.info.descriptionurl || '',
    retrievedAt: new Date().toISOString().slice(0, 10),
    query: cfg.q || '',
    note: '',
  };
}

function loadExistingCredits() {
  if (!fs.existsSync(CREDITS_FILE)) return {};
  try {
    const text = fs.readFileSync(CREDITS_FILE, 'utf8');
    const m = text.match(/window\.LI_QINGZHAO_CREDITS\s*=\s*(\{[\s\S]*?\});\s*\nwindow\.LI_QINGZHAO_AUDIO/);
    return m ? JSON.parse(m[1]) : {};
  } catch (e) {
    return {};
  }
}

function writeCredits(credits) {
  const banner = '/* 由 tools/fetch-images.mjs 生成：图片与音频的作者 / 许可 / 原链 */\n' +
    '/* 图片均来自 Wikimedia Commons；逐张署名，改图请重跑脚本。 */\n';
  const body = 'window.LI_QINGZHAO_CREDITS = ' + JSON.stringify(credits, null, 2) + ';\n' +
    'window.LI_QINGZHAO_AUDIO = ' + JSON.stringify(AUDIO, null, 2) + ';\n';
  fs.writeFileSync(CREDITS_FILE, banner + body);
}

/** 有些册页是左右双开，只取右半幅 */
function cropRightHalf(dest) {
  const tmp = dest + '.crop.jpg';
  try {
    execFileSync('convert', [dest, '-gravity', 'East', '-crop', '50%x100%+0+0', '+repage', '-strip', '-quality', '88', tmp], { stdio: 'ignore' });
    fs.renameSync(tmp, dest);
  } catch (e) {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    console.log('   ! 裁切失败：' + e.message);
  }
}

/** 统一压成 1400×1600 以内的 JPEG，避免 PNG 缩略图过大 */
function postProcess(dest) {
  const tmp = dest + '.tmp.jpg';
  try {
    execFileSync('convert', [dest, '-resize', '1400x1600>', '-strip', '-interlace', 'Plane', '-quality', '84', tmp], { stdio: 'ignore' });
    fs.renameSync(tmp, dest);
  } catch (e) {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    console.log('   ! 压缩失败，保留原文件：' + e.message);
  }
}

async function handleImage(id, cfg, opts, credits) {
  const dest = path.join(IMG_DIR, id + '.jpg');
  if (fs.existsSync(dest) && !opts.force && !opts.meta) return { id, status: 'skip' };

  let got = null;
  if (cfg.pin) {
    got = await fetchByTitle(cfg.pin);
    if (got) got.query = cfg.q || '';
  }
  if (!got && opts.list) {
    const cands = await searchCandidates(cfg.q);
    console.log('\n## ' + id + '  ← ' + cfg.q);
    cands.slice(0, 10).forEach((c, i) => console.log('  ' + (i + 1) + '. ' + c.title + ' | ' + c.info.width + 'x' + c.info.height + ' | ' + c.license));
    return { id, status: 'list' };
  }
  if (!got) {
    const cands = await searchCandidates(cfg.q);
    got = cands[0] || null;
  }
  if (!got) return { id, status: 'miss' };
  credits[id] = creditFor(id, cfg, got);
  if (opts.meta && fs.existsSync(dest)) {
    console.log('  ✓ ' + id + '  元数据已更新  ' + got.license);
    return { id, status: 'meta' };
  }
  const url = got.info.thumburl || got.info.url;
  const buf = await fetchBinary(url);
  fs.writeFileSync(dest, buf);
  if (cfg.crop === 'right') cropRightHalf(dest);
  postProcess(dest);
  const size = fs.statSync(dest).size;
  console.log('  ✓ ' + id + '  ' + Math.round(size / 1024) + 'KB  ' + got.license + '  ' + credits[id].author.slice(0, 40));
  return { id, status: 'ok' };
}

async function handleAudio(opts) {
  const dest = path.join(ROOT, AUDIO.src);
  if (fs.existsSync(dest) && !opts.force) {
    console.log('  · 音频已存在：' + AUDIO.src);
    return;
  }
  const page = await fetchJson(API + '?action=query&format=json&formatversion=2&maxlag=5&titles=' +
    encodeURIComponent('File:Guqin-Yangguan Sandie.ogg') + '&prop=imageinfo&iiprop=url|extmetadata|size|mime');
  const info = (page.query && page.query.pages && page.query.pages[0] && page.query.pages[0].imageinfo && page.query.pages[0].imageinfo[0]) || null;
  if (!info) throw new Error('音频信息获取失败');
  const raw = await fetchBinary(info.url);
  const tmp = path.join(AUDIO_DIR, '.source.ogg');
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  fs.writeFileSync(tmp, raw);
  console.log('  ↓ 原始音频 ' + (raw.length / 1048576).toFixed(1) + 'MB，开始响度归一…');
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-y', '-i', tmp, '-af',
      'loudnorm=I=-20:TP=-4:LRA=11,aresample=44100', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '128k', dest],
      { stdio: ['ignore', 'ignore', 'pipe'] });
  } finally {
    fs.unlinkSync(tmp);
  }
  console.log('  ✓ ' + AUDIO.src + '  ' + (fs.statSync(dest).size / 1048576).toFixed(1) + 'MB');
}

async function main() {
  const opts = parseArgs(process.argv);
  fs.mkdirSync(IMG_DIR, { recursive: true });
  fs.mkdirSync(AUDIO_DIR, { recursive: true });

  if (!opts.audio) {
    const credits = loadExistingCredits();
    const ids = Object.keys(SOURCE).filter((id) => !opts.only || opts.only.includes(id));
    for (const id of ids) {
      try {
        await handleImage(id, SOURCE[id], opts, credits);
      } catch (e) {
        console.log('  ✗ ' + id + '：' + e.message);
      }
      writeCredits(credits);
      await sleep(DELAY_MS);
    }
    writeCredits(credits);
    console.log('\n署名写入 ' + path.relative(ROOT, CREDITS_FILE));
  }

  if (!opts.only || opts.audio) {
    try {
      await handleAudio(opts);
    } catch (e) {
      console.log('  ✗ 音频：' + e.message);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
