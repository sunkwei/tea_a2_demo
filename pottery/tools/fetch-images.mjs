/**
 * 中国陶器史 · 从 Wikimedia Commons 抓真实器物图
 *
 * 用法：
 *   node pottery/tools/fetch-images.mjs                  # 全部 20 件
 *   node pottery/tools/fetch-images.mjs --only ru,mise   # 只跑指定 id
 *   node pottery/tools/fetch-images.mjs --force          # 已有图片也重下
 *   node pottery/tools/fetch-images.mjs --list           # 只列候选标题，不下载（挑图用）
 *   node pottery/tools/fetch-images.mjs --pin "ru=File:xxx.jpg"   # 指定文件
 *
 * 规则：
 *   · 只收 CC0 / Public domain / CC BY / CC BY-SA；其余跳过
 *   · 下载 1200px 缩略图（够灯箱放大），命名 assets/ceramics/<id>.jpg
 *   · 写 assets/ceramics/sources.js：作者 / 许可 / 原链 / 检索词 / 采集日期
 *   · 网络：本机需要走 clash 的 HTTP 代理（Node 不读环境变量时要加 NODE_USE_ENV_PROXY=1）
 *       https_proxy=http://127.0.0.1:8118 NODE_USE_ENV_PROXY=1 node pottery/tools/fetch-images.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT_DIR = path.join(ROOT, 'assets', 'ceramics');
const CREDITS_FILE = path.join(OUT_DIR, 'sources.js');
const DATA_FILE = path.join(ROOT, 'src', 'data-ceramics.js');

const UA = 'ChinaPotteryHistoryDemo/1.0 (local educational use; https://github.com/sunkwei/tea_a2_demo)';
const API = 'https://commons.wikimedia.org/w/api.php';
const WIDTH = 1200;
const DELAY_MS = 700;

/* 原图里展柜反光/背景太杂的两张，下载后按这个几何裁切（会写进署名的 note） */
const CROP = {
  mise: '1150x520+65+180',
  'qing-fencai': '780x1500+250+180',
};

/* 每件器物的 Commons 检索词 + 期望/排除的标题特征 */
const SOURCE = {
  xianrendong: {
    q: 'Xianrendong pottery',
    prefer: /Xianrendong|Wannian|仙人洞|early pottery/i,
    reject: /pdf|book|catalogue|map|logo/i,
  },
  peiligang: {
    q: 'Peiligang Culture red pottery',
    prefer: /Peiligang|Cishan/i,
    reject: /pdf|book|catalogue/i,
  },
  yangshao: {
    q: 'Banpo painted pottery basin human face fish',
    prefer: /Banpo|human face|fish|Yangshao/i,
    reject: /pdf|book|catalogue|deer/i,
  },
  majiayao: {
    q: 'Majiayao dancing figures pottery basin',
    prefer: /dancing|Majiayao|舞蹈/i,
    reject: /pdf|book|catalogue|deer/i,
  },
  longshan: {
    q: 'Longshan eggshell black pottery cup',
    prefer: /Longshan|eggshell|black pottery/i,
    reject: /pdf|book|catalogue/i,
  },
  'shang-baitao': {
    q: 'Shang dynasty white pottery',
    prefer: /white pottery|Shang/i,
    reject: /pdf|book|catalogue|Liu Ding/i,
  },
  'proto-porcelain': {
    q: 'proto porcelain zun Shang Zhengzhou',
    prefer: /proto|porcelain|zun/i,
    reject: /pdf|book|catalogue/i,
  },
  'eastern-han': {
    q: 'Eastern Han celadon Yue kiln',
    prefer: /Eastern Han.*(celadon|Yue)|celadon.*Eastern Han/i,
    reject: /pdf|book|catalogue/i,
  },
  'yue-hunping': {
    q: 'Yue ware hunping Western Jin',
    prefer: /hunping|魂瓶|堆塑|Western Jin|Three Kingdoms/i,
    reject: /pdf|book|catalogue|Hangzhou 2009|Bowuguan/i,
  },
  'northern-qi': {
    q: 'Northern Qi white glazed porcelain',
    prefer: /Northern Qi.*white|white.*Northern Qi|范粹|Henan Museum/i,
    reject: /pdf|book|catalogue/i,
  },
  'tang-sancai': {
    q: 'Tang sancai camel musicians',
    prefer: /sancai.*camel|camel.*sancai/i,
    reject: /pdf|book|catalogue/i,
  },
  mise: {
    q: 'mise porcelain Famen Temple',
    prefer: /Mise|Famen|秘色/i,
    reject: /pdf|book|catalogue/i,
  },
  ru: {
    q: 'Ru ware brush washer Northern Song',
    prefer: /Ru ware|Ru kiln|汝窑|brush washer/i,
    reject: /pdf|book|catalogue|Scientific American|gazette/i,
  },
  jian: {
    q: 'Jian ware hare fur tea bowl Southern Song',
    prefer: /Jian|hare.?s.?fur/i,
    reject: /pdf|book|catalogue/i,
  },
  longquan: {
    q: 'Southern Song Longquan celadon vase',
    prefer: /Longquan.*(vase|celadon)|celadon.*Longquan/i,
    reject: /pdf|book|catalogue|censer|washer/i,
  },
  'yuan-qinghua': {
    q: 'Yuan underglaze blue Jingdezhen porcelain jar',
    prefer: /Yuan.*(blue|underglaze)|underglaze blue.*Yuan/i,
    reject: /pdf|book|catalogue|plate|stemmed/i,
  },
  doucai: {
    q: 'Chenghua chicken cup doucai',
    prefer: /chicken|doucai|雞缸|鬥彩/i,
    reject: /pdf|book|catalogue/i,
  },
  dehua: {
    q: 'Dehua blanc de chine Guanyin',
    prefer: /Guanyin|Dehua|blanc de chine/i,
    reject: /pdf|book|catalogue/i,
  },
  'qing-fencai': {
    q: 'Yongzheng famille rose porcelain vase',
    prefer: /famille rose|粉彩|Yongzheng/i,
    reject: /pdf|book|catalogue|dish|plate/i,
  },
  modern: {
    q: 'silicon nitride ceramic bearing ball',
    prefer: /bearing ball|Si3N4|silicon nitride/i,
    reject: /pdf|book|catalogue|diagram/i,
  },
};

/* 现代工业陶瓷的补充图（主图之外，灯箱里可以再看两张工艺细节） */
const EXTRA = [
  { id: 'modern-sic', q: 'silicon carbide fiber reinforced silicon carbide', prefer: /SiC.?SiC|silicon carbide fiber/i },
  { id: 'modern-mlcc', q: 'ceramic capacitors mounted on a PCB', prefer: /ceramic capacitor/i },
];

const LICENSE_OK = [/^cc0/i, /^public domain/i, /^pd\b/i, /^cc[- ]by(-sa)?\s*\d/i, /^cc[- ]by(-sa)?$/i];

function parseArgs(argv) {
  const out = { only: null, force: false, list: false, pin: {} };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') out.force = true;
    else if (a === '--list') out.list = true;
    else if (a === '--only') out.only = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--only=')) out.only = a.slice(7).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--pin') {
      String(argv[++i] || '').split(',').forEach((pair) => {
        const [id, title] = pair.split('=');
        if (id && title) out.pin[id.trim()] = title.trim();
      });
    } else if (a.startsWith('--pin=')) {
      a.slice(6).split(',').forEach((pair) => {
        const [id, title] = pair.split('=');
        if (id && title) out.pin[id.trim()] = title.trim();
      });
    }
  }
  return out;
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url, tries = 6) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Api-User-Agent': UA },
        signal: ctrl.signal,
      });
      if (res.status === 429 || res.status === 503) {
        const retryAfter = Number(res.headers.get('retry-after')) || 0;
        const wait = Math.max(retryAfter * 1000, 8000 * (i + 1));
        process.stdout.write('   ⏳ 限流，等待 ' + Math.round(wait / 1000) + 's 后重试\n');
        await sleep(wait);
        lastErr = new Error('HTTP ' + res.status);
        continue;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await sleep(1200 * (i + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

async function download(url, dest) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 3000) throw new Error('too small: ' + buf.length);
    fs.writeFileSync(dest, buf);
    return buf.length;
  } finally {
    clearTimeout(timer);
  }
}

function imageInfoOf(page) {
  const info = (page.imageinfo || [])[0];
  if (!info) return null;
  const mime = String(info.mime || '');
  if (!/^image\/(jpeg|png|webp)$/.test(mime)) return null;
  if ((info.width || 0) < 500 || (info.height || 0) < 400) return null;
  const em = info.extmetadata || {};
  const license = stripTags(em.LicenseShortName && em.LicenseShortName.value);
  if (!license || !LICENSE_OK.some((re) => re.test(license))) return null;
  return { info, em, license, mime };
}

function pickPage(pages, cfg) {
  const scored = [];
  for (const page of pages || []) {
    const got = imageInfoOf(page);
    if (!got) continue;
    const title = String(page.title || '').replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '');
    if (cfg.reject && cfg.reject.test(title)) continue;
    let score = 0;
    if (cfg.prefer && cfg.prefer.test(title)) score += 8;
    score += Math.min((got.info.width || 0) / 1000, 4);
    if (got.mime === 'image/jpeg') score += 1;
    if (got.info.width > got.info.height) score += 0.5; // 横幅更适合三栏版式
    scored.push({ page, title, score, ...got });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored[0] || null;
}

async function searchCandidates(cfg) {
  const url =
    API +
    '?action=query&format=json&formatversion=2&maxlag=5&generator=search' +
    '&gsrnamespace=6&gsrlimit=12&gsrsearch=' +
    encodeURIComponent(cfg.q) +
    '&prop=imageinfo&iiprop=url|extmetadata|size|mime&iiurlwidth=' +
    WIDTH;
  const json = await fetchJson(url);
  const pages = (json.query && json.query.pages) || [];
  const good = [];
  for (const page of pages) {
    const got = imageInfoOf(page);
    if (!got) continue;
    const title = String(page.title || '').replace(/^File:/, '');
    if (cfg.reject && cfg.reject.test(title)) continue;
    good.push({ page, title, ...got });
  }
  good.sort((a, b) => (b.info.width || 0) - (a.info.width || 0));
  return good;
}

async function fetchByTitle(title, cfg) {
  const t = /^File:/i.test(title) ? title : 'File:' + title;
  const url =
    API +
    '?action=query&format=json&formatversion=2&maxlag=5&titles=' +
    encodeURIComponent(t) +
    '&prop=imageinfo&iiprop=url|extmetadata|size|mime&iiurlwidth=' +
    WIDTH;
  const json = await fetchJson(url);
  return pickPage((json.query && json.query.pages) || [], cfg || {});
}

function creditFor(best, q) {
  const em = best.em;
  return {
    file: 'assets/ceramics/' + best.id + '.jpg',
    title: best.title,
    author: stripTags(em.Artist && em.Artist.value) || '未署名',
    license: best.license,
    licenseUrl: stripTags(em.LicenseUrl && em.LicenseUrl.value) || '',
    sourceUrl: best.info.descriptionurl || '',
    retrievedAt: new Date().toISOString().slice(0, 10),
    query: q,
    note: best.cropped ? '局部裁切' : '',
  };
}

async function handleOne(id, cfg, opts, credits) {
  const dest = path.join(OUT_DIR, id + '.jpg');
  if (fs.existsSync(dest) && !opts.force) return { id, status: 'skip' };
  if (fs.existsSync(dest)) fs.unlinkSync(dest);

  let best = null;
  if (opts.pin[id]) {
    best = await fetchByTitle(opts.pin[id], cfg);
    if (best) {
      best.id = id;
      best.query = 'pin:' + opts.pin[id];
    }
  }
  if (!best) {
    const cands = await searchCandidates(cfg);
    if (opts.list) {
      console.log('\n## ' + id + '  ← ' + cfg.q);
      cands.slice(0, 10).forEach((c, i) => {
        console.log('  ' + (i + 1) + '. ' + c.title + ' | ' + c.info.width + 'x' + c.info.height + ' | ' + c.license);
      });
      return { id, status: 'list' };
    }
    best = cands.find((c) => !cfg.prefer || cfg.prefer.test(c.title)) || cands[0] || null;
    if (best) {
      best.id = id;
      best.query = cfg.q;
    }
  }
  if (!best) return { id, status: 'missing' };

  const bytes = await download(best.info.thumburl || best.info.url, dest);
  if (CROP[id]) {
    try {
      execFileSync('convert', [dest, '-crop', CROP[id], '+repage', '-resize', '1280x1280>', dest]);
      best.cropped = true;
    } catch (e) {
      process.stdout.write('   ⚠ 裁切失败（没有 ImageMagick convert？）：' + e.message + '\n');
    }
  }
  const credit = creditFor(best, best.query);
  credits[id] = credit;
  return { id, status: 'ok', bytes, title: best.title };
}

function loadEntries() {
  const src = fs.readFileSync(DATA_FILE, 'utf8');
  const m = { exports: {} };
  new Function('module', 'exports', src)(m, m.exports);
  return m.exports.entries || [];
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const opts = parseArgs(process.argv);
  let entries = loadEntries();
  if (opts.only && opts.only.length) entries = entries.filter((e) => opts.only.includes(e.id));
  const jobs = entries.map((e) => ({ id: e.id, cfg: SOURCE[e.id] }));
  if (!opts.only || opts.only.includes('modern')) {
    EXTRA.forEach((x) => jobs.push({ id: x.id, cfg: { q: x.q, prefer: x.prefer, reject: /pdf|book|catalogue|diagram/i } }));
  }

  const credits = {};
  const results = [];
  for (const job of jobs) {
    if (!job.cfg) {
      results.push({ id: job.id, status: 'no-config' });
      continue;
    }
    try {
      const r = await handleOne(job.id, job.cfg, opts, credits);
      results.push(r);
      const tag = r.status === 'ok' ? '✓' : r.status === 'skip' ? '·' : r.status === 'list' ? '·' : '!';
      process.stdout.write(tag + ' ' + job.id + (r.title ? '  ' + r.title : '') + '\n');
    } catch (e) {
      results.push({ id: job.id, status: 'error', reason: e.message });
      process.stdout.write('! ' + job.id + '  ' + e.message + '\n');
    }
    await sleep(DELAY_MS);
  }

  if (opts.list) return;

  // 合并旧署名（增量更新时不要把没跑到的条目丢了）
  let prev = {};
  if (fs.existsSync(CREDITS_FILE)) {
    try {
      const fake = {};
      new Function('window', fs.readFileSync(CREDITS_FILE, 'utf8'))(fake);
      prev = fake.POTTERY_IMAGE_CREDITS || {};
    } catch (e) {
      prev = {};
    }
  }
  const merged = Object.assign({}, prev, credits);
  const header = '/* 由 tools/fetch-images.mjs 生成：图片来自 Wikimedia Commons，逐张标注作者与许可。 */\n';
  fs.writeFileSync(CREDITS_FILE, header + 'window.POTTERY_IMAGE_CREDITS = ' + JSON.stringify(merged, null, 2) + ';\n', 'utf8');

  const ok = results.filter((r) => r.status === 'ok').length;
  const skip = results.filter((r) => r.status === 'skip').length;
  const bad = results.filter((r) => r.status !== 'ok' && r.status !== 'skip');
  console.log('\n完成：下载 ' + ok + '，跳过 ' + skip + '，失败 ' + bad.length + '；署名写入 ' + path.relative(process.cwd(), CREDITS_FILE));
  bad.forEach((r) => console.log('  ' + r.id + ' — ' + (r.reason || r.status)));
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
