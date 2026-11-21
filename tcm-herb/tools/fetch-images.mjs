/**
 * 从 Wikimedia Commons 抓取药材图片，落盘到 assets/herbs/，并生成 sources.js（作者/许可/原链）。
 *
 * 用法：
 *   node tcm-herb/tools/fetch-images.mjs                 # 全部 86 味
 *   node tcm-herb/tools/fetch-images.mjs --only gan-cao  # 只跑指定 id（逗号分隔）
 *   node tcm-herb/tools/fetch-images.mjs --force         # 已有图片也重下
 *   node tcm-herb/tools/fetch-images.mjs --limit 5       # 只跑前 5 味（调试）
 *
 * 规则（需求 Q3）：
 *   · 只收 CC0 / Public domain / CC BY / CC BY-SA 的图片；其余一律跳过
 *   · 下载 720px 缩略图，控制体积；文件命名 assets/herbs/<id>.jpg
 *   · 取不到合适图片 → 生成同名的程序化 SVG 占位图，并在署名里标明「示意图」
 *   · 生成 sources.js：window.TCM_IMAGE_CREDITS = { <id>: {file,title,author,license,licenseUrl,sourceUrl,retrievedAt} }
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT_DIR = path.join(ROOT, 'assets', 'herbs');
const CREDITS_FILE = path.join(OUT_DIR, 'sources.js');
const DATA_FILE = path.join(ROOT, 'src', 'data-herbs.js');

const UA = 'TCMHerbDemo/1.0 (local educational use; https://github.com/sunkwei/tea_a2_demo)';
const API = 'https://commons.wikimedia.org/w/api.php';
const WIDTH = 640;
const CONCURRENCY = 1;
const DELAY_MS = 900;

/* 每味药的 Commons 检索词：优先拉丁学名/属名，矿物与药材用通用词 */
const QUERY = {
  'ma-huang': 'Ephedra sinica',
  'gui-zhi': 'Cinnamomum cassia',
  'zi-su-ye': 'Perilla frutescens',
  'jing-jie': 'Schizonepeta tenuifolia',
  'fang-feng': 'Saposhnikovia divaricata',
  'bo-he': 'Mentha haplocalyx',
  'chai-hu': 'Bupleurum chinense',
  'shi-gao': 'Gypsum mineral',
  'zhi-mu': 'Anemarrhena asphodeloides',
  'huang-qin': 'Scutellaria baicalensis',
  'huang-lian': 'Coptis chinensis',
  'zhi-zi': 'Gardenia jasminoides',
  'lian-qiao': 'Forsythia suspensa',
  'jin-yin-hua': 'Lonicera japonica',
  'pu-gong-ying': 'Taraxacum mongolicum',
  'da-huang': 'Rheum palmatum',
  'fan-xie-ye': 'Senna alexandrina',
  'huo-ma-ren': 'Cannabis sativa',
  'du-huo': 'Angelica pubescens',
  'wei-ling-xian': 'Clematis chinensis',
  'qin-jiao': 'Gentiana macrophylla',
  'sang-ji-sheng': 'Taxillus chinensis',
  'huo-xiang': 'Pogostemon cablin',
  'cang-zhu': 'Atractylodes lancea',
  'hou-po': 'Magnolia officinalis',
  'sha-ren': 'Amomum villosum',
  'fu-ling': 'Wolfiporia extensa',
  'yi-yi-ren': 'Coix lacryma-jobi',
  'ze-xie': 'Alisma plantago-aquatica',
  'zhu-ling': 'Polyporus umbellatus',
  'jin-qian-cao': 'Lysimachia christinae',
  'fu-zi': 'Aconitum carmichaelii',
  'gan-jiang': 'Zingiber officinale',
  'rou-gui': 'Cinnamomum cassia bark',
  'wu-zhu-yu': 'Evodia rutaecarpa',
  'chen-pi': 'Citrus reticulata',
  'zhi-shi': 'Citrus aurantium',
  'mu-xiang': 'Aucklandia lappa',
  'xiang-fu': 'Cyperus rotundus',
  'wu-yao': 'Lindera aggregata',
  'shan-zha': 'Crataegus pinnatifida',
  'shen-qu': 'Massa medicata fermentata',
  'mai-ya': 'Hordeum vulgare',
  'san-qi': 'Panax notoginseng',
  'bai-ji': 'Bletilla striata',
  'di-yu': 'Sanguisorba officinalis',
  'chuan-xiong': 'Ligusticum chuanxiong',
  'hong-hua': 'Carthamus tinctorius',
  'dan-shen': 'Salvia miltiorrhiza',
  'tao-ren': 'Prunus persica',
  'yi-mu-cao': 'Leonurus japonicus',
  'ban-xia': 'Pinellia ternata',
  'chuan-bei-mu': 'Fritillaria cirrhosa',
  'jie-geng': 'Platycodon grandiflorus',
  'ku-xing-ren': 'Prunus armeniaca',
  'pi-pa-ye': 'Eriobotrya japonica',
  'suan-zao-ren': 'Ziziphus jujuba spinosa',
  'bai-zi-ren': 'Platycladus orientalis',
  'shou-wu-teng': 'Fallopia multiflora',
  'tian-ma': 'Gastrodia elata',
  'gou-teng': 'Uncaria rhynchophylla',
  'shi-jue-ming': 'Haliotis shell',
  'di-long': 'Eisenia fetida',
  'shi-chang-pu': 'Acorus gramineus',
  'ren-shen': 'Panax ginseng',
  'dang-shen': 'Codonopsis pilosula',
  'huang-qi': 'Astragalus membranaceus',
  'bai-zhu': 'Atractylodes macrocephala',
  'dang-gui': 'Angelica sinensis',
  'shu-di-huang': 'Rehmannia glutinosa',
  'gou-qi-zi': 'Lycium barbarum',
  'nv-zhen-zi': 'Ligustrum lucidum',
  'du-zhong': 'Eucommia ulmoides',
  'wu-wei-zi': 'Schisandra chinensis',
  'wu-mei': 'Prunus mume',
  'shan-zhu-yu': 'Cornus officinalis',
  'pang-da-hai': 'Sterculia lychnophora',
  'yin-yang-huo': 'Epimedium',
  'xu-duan': 'Dipsacus asper',
  'yuan-zhi': 'Polygala tenuifolia',
  'ju-hua': 'Chrysanthemum morifolium',
  'hai-piao-xiao': 'Sepia officinalis cuttlebone',
  'che-qian-zi': 'Plantago asiatica',
  'gan-cao': 'Glycyrrhiza uralensis',
  'bai-shao': 'Paeonia lactiflora',
  'sheng-jiang': 'Zingiber officinale rhizome',
};

const LICENSE_OK = [
  /^cc0/i,
  /^public domain/i,
  /^pd\b/i,
  /^cc[- ]by(-sa)?\s*\d/i,
];

function parseArgs(argv) {
  const out = { only: null, force: false, limit: 0 };
  argv.slice(2).forEach((arg, i) => {
    if (arg === '--force') out.force = true;
    else if (arg === '--only') out.only = (argv[i + 3] || '').split(',').map(s => s.trim()).filter(Boolean);
    else if (arg.startsWith('--only=')) out.only = arg.slice(7).split(',').map(s => s.trim()).filter(Boolean);
    else if (arg === '--limit') out.limit = Number(argv[i + 3]) || 0;
    else if (arg.startsWith('--limit=')) out.limit = Number(arg.slice(8)) || 0;
  });
  return out;
}

function loadHerbs() {
  const src = fs.readFileSync(DATA_FILE, 'utf8');
  const m = { exports: {} };
  new Function('module', 'exports', src)(m, m.exports);
  return m.exports;
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchJson(url, tries = 6) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA }, signal: ctrl.signal });
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
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 2000) throw new Error('too small: ' + buf.length);
    fs.writeFileSync(dest, buf);
    return buf.length;
  } finally {
    clearTimeout(timer);
  }
}

function pickPage(pages) {
  const scored = [];
  for (const page of pages || []) {
    const info = (page.imageinfo || [])[0];
    if (!info) continue;
    const mime = String(info.mime || '');
    if (!/^image\/(jpeg|png|webp)$/.test(mime)) continue;
    if ((info.width || 0) < 420 || (info.height || 0) < 300) continue;
    const em = info.extmetadata || {};
    const license = stripTags(em.LicenseShortName && em.LicenseShortName.value);
    if (!license || !LICENSE_OK.some(re => re.test(license))) continue;

    const title = String(page.title || '').replace(/^File:/, '').replace(/\.[a-z]+$/i, '');
    let score = 0;
    if (/illustration|köhler|flora|botanical|drawing/i.test(title)) score -= 6; // 线描图不如图片直观
    if (/herb|root|leaf|flower|plant|dried|sliced|powder|medicinal/i.test(title)) score += 4;
    score += Math.min((info.width || 0) / 800, 4);
    if (mime === 'image/jpeg') score += 1;

    scored.push({ page, info, em, license, title, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored[0] || null;
}

function svgPlaceholder(name) {
  const ch = String(name || '药').slice(0, 1);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 90" role="img" aria-label="${name}示意图">
  <rect width="120" height="90" fill="#e8e0cd"/>
  <circle cx="60" cy="40" r="20" fill="none" stroke="#2f6b57" stroke-width="2"/>
  <path d="M60 24v32M44 40h32" stroke="#2f6b57" stroke-width="2"/>
  <text x="60" y="80" font-size="13" text-anchor="middle" fill="#2f6b57" font-family="serif">${ch} · 示意图</text>
</svg>`;
}

async function handleHerb(herb, opts) {
  const id = herb.id;
  const jpg = path.join(OUT_DIR, id + '.jpg');
  const svg = path.join(OUT_DIR, id + '.svg');
  const existed = fs.existsSync(jpg) || fs.existsSync(svg);

  if (existed && !opts.force) {
    return { id, name: herb.name, status: 'skip' };
  }
  if (fs.existsSync(jpg)) fs.unlinkSync(jpg);
  if (fs.existsSync(svg)) fs.unlinkSync(svg);

  const q = QUERY[id] || herb.name;
  const url = API + '?action=query&format=json&formatversion=2&maxlag=5&generator=search' +
    '&gsrnamespace=6&gsrlimit=10&gsrsearch=' + encodeURIComponent(q) +
    '&prop=imageinfo&iiprop=url|extmetadata|size|mime&iiurlwidth=' + WIDTH;

  try {
    const json = await fetchJson(url);
    const best = pickPage(json.query && json.query.pages);
    if (!best) throw new Error('no suitable image');

    const thumb = best.info.thumburl || best.info.url;
    const bytes = await download(thumb, jpg);
    const em = best.em;
    return {
      id, name: herb.name, status: 'ok', bytes,
      credit: {
        file: 'assets/herbs/' + id + '.jpg',
        title: best.title,
        author: stripTags(em.Artist && em.Artist.value) || '未署名',
        license: best.license,
        licenseUrl: stripTags(em.LicenseUrl && em.LicenseUrl.value) || '',
        sourceUrl: best.info.descriptionurl || '',
        retrievedAt: new Date().toISOString().slice(0, 10),
        query: q,
      },
    };
  } catch (e) {
    fs.writeFileSync(svg, svgPlaceholder(herb.name), 'utf8');
    return {
      id, name: herb.name, status: 'placeholder', reason: e.message,
      credit: {
        file: 'assets/herbs/' + id + '.svg',
        title: herb.name + '（程序化示意图）',
        author: '本站生成',
        license: 'CC0',
        licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
        sourceUrl: '',
        retrievedAt: new Date().toISOString().slice(0, 10),
        query: q,
      },
    };
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const opts = parseArgs(process.argv);
  let herbs = loadHerbs();
  if (opts.only && opts.only.length) herbs = herbs.filter(h => opts.only.includes(h.id));
  if (opts.limit) herbs = herbs.slice(0, opts.limit);

  // 旧署名先读出来，便于增量更新
  let credits = {};
  if (fs.existsSync(CREDITS_FILE)) {
    try {
      const src = fs.readFileSync(CREDITS_FILE, 'utf8');
      const fake = {};
      new Function('window', src)(fake);
      credits = fake.TCM_IMAGE_CREDITS || {};
    } catch (e) { credits = {}; }
  }

  const results = [];
  let cursor = 0;

  async function worker(w) {
    while (cursor < herbs.length) {
      const idx = cursor++;
      const herb = herbs[idx];
      const r = await handleHerb(herb, opts);
      results.push(r);
      if (r.credit) credits[r.id] = r.credit;
      const tag = r.status === 'ok' ? '✓' : r.status === 'skip' ? '·' : '!';
      process.stdout.write(tag + ' ' + herb.name + (r.status === 'placeholder' ? '（占位）' : '') + '\n');
      await sleep(DELAY_MS);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));

  const header = '/* 由 tools/fetch-images.mjs 生成：图片来自 Wikimedia Commons，逐张标注作者与许可。 */\n';
  fs.writeFileSync(
    CREDITS_FILE,
    header + 'window.TCM_IMAGE_CREDITS = ' + JSON.stringify(credits, null, 2) + ';\n',
    'utf8'
  );

  const ok = results.filter(r => r.status === 'ok').length;
  const ph = results.filter(r => r.status === 'placeholder').length;
  const skip = results.filter(r => r.status === 'skip').length;
  console.log('\n完成：成功 ' + ok + '，占位 ' + ph + '，跳过 ' + skip + '；署名写入 ' + path.relative(process.cwd(), CREDITS_FILE));
  results.filter(r => r.status === 'placeholder').forEach(r => console.log('  占位：' + r.name + ' — ' + r.reason));
}

main().catch(e => {
  console.error('FATAL', e);
  process.exit(1);
});
