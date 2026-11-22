// tools/gen-project-index.mjs —— 一站式重生成「项目横幅」与根目录落地索引页
//
//   node tools/gen-project-index.mjs   （或 npm run index:build）
//
// 产出：
//   docs/banners/<slug>.svg   每个项目一张 640×168 的渐变横幅（图标 + 中英文名 + 一句话）
//   index.html                根目录落地索引页（同样是这些横幅 + 分类筛选 / 搜索）
//
// README.md 里引用的也是 docs/banners/*.svg，所以改文案只改这里一处即可。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT_BANNERS = path.join(ROOT, 'docs/banners');

const CATS = {
  viz: '3D & 可视化',
  web: '纯前端小应用',
  llm: 'LLM 应用',
  data: '抓取与摘要',
  asset: '素材 · 扩展 · 建模',
  tool: '工具 · 手机与桌面',
};

const FONT_CN = "'Noto Sans CJK SC','Source Han Sans SC','PingFang SC','Microsoft YaHei',sans-serif";
const FONT_EMOJI = "'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif";

/** web: 有网页入口的相对链接；null 表示只有命令行 / 编辑器项目 */
const projects = [
  {
    slug: 'meow-mart', emoji: '🐱', cat: 'viz',
    cn: '喵屋便利店', en: 'MIDNIGHT MEOW MART',
    tagline: '雨夜霓虹小镇：会走路的橘猫与积水倒影',
    tags: ['Three.js', 'Bloom', '程序化'],
    dir: 'meow-mart/', web: 'meow-mart/index.html', run: 'npm run dev',
    note: '全部几何体与贴图运行时生成，仓库里没有一个模型文件',
  },
  {
    slug: 'endfield-ship', emoji: '🚀', cat: 'viz',
    cn: '终末地 · 舰桥观测舱', en: 'ENDFIELD · BRIDGE DECK',
    tagline: '明日方舟风格飞船内舱 + ARK 风格 HUD',
    tags: ['Three.js', 'PBR', '体积光'],
    dir: 'endfield-ship/', web: 'endfield-ship/index.html', run: 'npm run dev',
    note: '舷窗外有泰拉II、天梯缆索；PRTS 终端可以真的敲指令',
  },
  {
    slug: 'snake-race', emoji: '🐍', cat: 'viz',
    cn: '贪吃蛇竞赛', en: 'SNAKE ARENA',
    tagline: '2–4 条 AI 蛇同场围杀，生存到最后者胜',
    tags: ['原生 JS', 'Canvas', 'AI 算法'],
    dir: 'snake-race/', web: 'snake-race/index.html', run: 'npm run dev',
    note: '每轮计算硬性 ≤ 50ms，含无头自测与胜率基准',
  },
  {
    slug: 'attention-film', emoji: '🎬', cat: 'viz',
    cn: '60 秒看懂 Self-Attention', en: 'ATTENTION FILM',
    tagline: '图解短片：从 Q/K/V 一路讲到 Transformer',
    tags: ['Canvas 2D', 'ffmpeg', '逐帧渲染'],
    dir: 'attention-film/', web: 'attention-film/index.html', run: 'npm run dev',
    note: '每一帧都是时间 t 的纯函数，进度条可以任意拖',
  },
  {
    slug: 'iptv-player', emoji: '📺', cat: 'web',
    cn: 'IPTV 剧场', en: 'IPTV THEATER',
    tagline: '网页版直播播放器：87 个源，在线自动更新',
    tags: ['hls.js', '流代理', '频道体检'],
    dir: 'iptv-player/', web: 'iptv-player/index.html', run: 'npm run dev',
    note: 'ETag 条件请求判重，失效频道一键隐藏',
  },
  {
    slug: 'sticky-notes', emoji: '📌', cat: 'web',
    cn: '便笺', en: 'STICKY NOTES',
    tagline: '纯本地便笺：提醒、回收站、正则分类',
    tags: ['localStorage', 'file://', 'AI 可选'],
    dir: 'sticky-notes/', web: 'sticky-notes/index.html', run: '双击 index.html',
    note: '文字色按 WCAG 对比度自动挑选，全部 ≥ 4.5:1',
  },
  {
    slug: 'rubiks-cube', emoji: '🧊', cat: 'web',
    cn: '三阶魔方还原教程', en: 'RUBIK’S CUBE',
    tagline: '手写 WebGL 魔方 + 7 步还原教程',
    tags: ['WebGL', '零依赖', 'file://'],
    dir: 'rubiks-cube/', web: 'rubiks-cube/index.html', run: '双击 index.html',
    note: '按住任意贴纸拖动即拧层，教程公式经整盘模拟校验',
  },
  {
    slug: 'tcm-herb', emoji: '🌿', cat: 'web',
    cn: '中药大全', en: 'TCM HERB ATLAS',
    tagline: '86 味药材图鉴 + 39 个病症 + 22 首验方',
    tags: ['原生 JS', '离线可用', '拼音检索'],
    dir: 'tcm-herb/', web: 'tcm-herb/index.html', run: '双击 index.html',
    note: '按病症查药与配伍，错别字也能搜到',
  },
  {
    slug: 'pottery', emoji: '🏺', cat: 'web',
    cn: '中国陶器史', en: 'CHINESE CERAMICS',
    tagline: '两万年窑火：20 件器物的长幅时间线',
    tags: ['原生 JS', 'Web Audio', 'AI 问答'],
    dir: 'pottery/', web: 'pottery/index.html', run: '双击 index.html',
    note: '背景音乐用 Web Audio 实时合成，没有音频文件',
  },
  {
    slug: 'li-qingzhao', emoji: '🪷', cat: 'web',
    cn: '李清照 · 漱玉词', en: 'LI QINGZHAO',
    tagline: '一生与词：16 个节点串起生平与 14 篇作品',
    tags: ['原生 JS', '长幅时间线', '古琴音乐', 'AI 问答'],
    dir: 'li-qingzhao/', web: 'li-qingzhao/index.html', run: '双击 index.html',
    note: '真实古琴录音《阳关三叠》+ Wikimedia 配图逐张署名',
  },
  {
    slug: 'piano', emoji: '🎹', cat: 'web',
    cn: '琴房 · 钢琴练习', en: 'PIANO STUDIO',
    tagline: '多点触摸复音：瀑布流跟弹、认键、音阶和弦',
    tags: ['WebAudio', 'Canvas', '多点触摸'],
    dir: 'piano/', web: 'piano/index.html', run: '双击 piano/index.html',
    note: '音色全部靠加法合成现场算出来，仓库里没有一个音频文件',
  },
  {
    slug: 'tab-colors', emoji: '🎨', cat: 'asset',
    cn: '彩色标签', en: 'TAB COLORS',
    tagline: 'Firefox 扩展：在分组之上给单个标签上色',
    tags: ['WebExtension', 'MV3', 'Firefox'],
    dir: 'firefox-tab-colors/', web: null, run: 'about:debugging 临时加载 manifest.json',
    note: 'WebExtension 没有 per-tab 颜色，只能内容脚本改标题前缀 + 换彩色图标',
  },
  {
    slug: 'ai-town', emoji: '🏘️', cat: 'llm',
    cn: 'AI 小镇：无限人生', en: 'AI TOWN',
    tagline: 'LLM 现场生成居民、事件与主线的模拟经营',
    tags: ['Python', 'Tkinter', 'LLM'],
    dir: 'ai-town/', web: null, run: 'python ai-town/main.py',
    note: '17 种结局，全 NPC 可自动玩，离线也能跑',
  },
  {
    slug: 'sanguosha-ai', emoji: '⚔️', cat: 'llm',
    cn: 'AI 三国杀', en: 'SANGUOSHA AI',
    tagline: '三个大模型同台打三国杀，自己出牌自己喊话',
    tags: ['Python', 'HTML5', '多模型'],
    dir: 'sanguosha-ai/', web: 'sanguosha-ai/web/index.html', run: 'npm run sgss:web',
    note: '命令行与网页版共用一套对局内核',
  },
  {
    slug: 'tea-select', emoji: '🦊', cat: 'llm',
    cn: 'tea_a2 划词助手', en: 'TEA-SELECT EXTENSION',
    tagline: 'Firefox 扩展：划词即译 / 搜 / 总结，还能划图识图',
    tags: ['MV3', 'Firefox', 'Vision'],
    dir: 'tea-select/', web: null, run: 'web-ext run',
    note: '结果直接显示在横幅里，不用切标签页',
  },
  {
    slug: 'bilibili', emoji: '📺', cat: 'data',
    cn: 'B 站 digest', en: 'BILIBILI DIGEST',
    tagline: '观看历史 → 字幕 → LLM 摘要 → 周报',
    tags: ['Python', '字幕校验', 'LLM'],
    dir: 'bilibili/', web: null, run: 'python bilibili/bili.py all',
    note: '还有 discover：主动去找值得收藏的视频并加稍后再看',
  },
  {
    slug: 'zhihu', emoji: '📚', cat: 'data',
    cn: '知乎 digest', en: 'ZHIHU DIGEST',
    tagline: '收藏夹 / 回答正文 → 结构化摘要',
    tags: ['Python', '抓取', 'LLM'],
    dir: 'zhihu/', web: null, run: 'python zhihu/zhihu.py digest',
    note: '写操作默认 dry-run，加 --yes 才真投递',
  },
  {
    slug: 'video-analysis', emoji: '📼', cat: 'data',
    cn: '本地视频分析', en: 'VIDEO ANALYSIS',
    tagline: '抽帧拼图 + 本地 ASR → LLM 写分析报告',
    tags: ['SenseVoice', 'ONNX', 'LLM'],
    dir: 'video_analysis/', web: null, run: 'python video_analysis/video_analysis.py',
    note: '3×3 拼图每格烧了时间戳，ASR 全离线跑在 CPU 上',
  },
  {
    slug: 'godot', emoji: '🎮', cat: 'asset',
    cn: 'GoDot · 三国肉鸽', en: 'GODOT ROGUELIKE',
    tagline: 'Godot 4 项目：三国题材肉鸽',
    tags: ['Godot 4', 'GDScript'],
    dir: 'GoDot/', web: null, run: 'Godot 打开',
    note: '场景、脚本与像素素材都在仓库里',
  },
  {
    slug: 'zhanqiao', emoji: '🏗️', cat: 'asset',
    cn: '青岛栈桥 & 回澜阁', en: 'ZHANQIAO MODEL',
    tagline: '按真实物理尺寸的 Blender 建模',
    tags: ['Blender', 'Python', '尺寸校验'],
    dir: 'zhanqiao/', web: null, run: '打开 .blend',
    note: 'build_zhanqiao.py 生成模型，verify.py 复核尺寸',
  },
  {
    slug: 'a2-share', emoji: '📲', cat: 'tool',
    cn: 'a2_share · 隔空投送', en: 'A2 SHARE',
    tagline: '手机扫码 → PC 直接收文件与剪贴板',
    tags: ['Python 3.11', 'Android/Kotlin', '局域网直传'],
    dir: 'a2-share/', web: null, run: 'python a2-share/pc/a2_share.py',
    note: 'PC 起二维码，手机扫码即连；断网缓存、回来自动补发',
  },
];

// ───────────────────────────── 横幅 SVG ─────────────────────────────

const PALETTE = {
  'meow-mart': ['#2a1040', '#ff4fa3'],
  'endfield-ship': ['#1a1a12', '#ffd23f'],
  'snake-race': ['#06281f', '#2ee6a8'],
  'attention-film': ['#1b1030', '#7c5cff'],
  'iptv-player': ['#2a0d12', '#ff5d5d'],
  'sticky-notes': ['#2b2306', '#ffc94d'],
  'rubiks-cube': ['#0b1a2a', '#35b8ff'],
  'tcm-herb': ['#0d2213', '#63d471'],
  'pottery': ['#2b160c', '#d9822b'],
  'li-qingzhao': ['#1b1310', '#c9563f'],
  'ai-town': ['#2a1508', '#ff9d4d'],
  'sanguosha-ai': ['#2b0b0b', '#e0483c'],
  'tea-select': ['#241306', '#ff8a3d'],
  'bilibili': ['#0f1c2e', '#00a1d6'],
  'zhihu': ['#0c1633', '#3d7bff'],
  'video-analysis': ['#1b0f26', '#c66bff'],
  godot: ['#0e1c24', '#4fd6e0'],
  zhanqiao: ['#101a2c', '#6aa9ff'],
  'a2-share': ['#0d1f16', '#4ad991'],
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function bannerSvg(p) {
  const [from, to] = PALETTE[p.slug] || ['#151a24', '#5b7cff'];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="168" viewBox="0 0 640 168" role="img" aria-label="${esc(p.cn)} ${esc(p.en)}">
  <title>${esc(p.cn)} · ${esc(p.en)}</title>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${from}"/>
      <stop offset="1" stop-color="${to}" stop-opacity="0.55"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.85" cy="0.1" r="0.8">
      <stop offset="0" stop-color="${to}" stop-opacity="0.75"/>
      <stop offset="1" stop-color="${to}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="chip" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.18"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0.06"/>
    </linearGradient>
  </defs>

  <rect width="640" height="168" rx="18" fill="#080b12"/>
  <rect width="640" height="168" rx="18" fill="url(#bg)"/>
  <rect width="640" height="168" rx="18" fill="url(#glow)"/>

  <g stroke="#ffffff" stroke-opacity="0.05">
    <path d="M0 56h640M0 112h640"/>
    <path d="M132 0v168M452 0v168"/>
  </g>

  <rect x="24" y="40" width="88" height="88" rx="22" fill="url(#chip)" stroke="#ffffff" stroke-opacity="0.22"/>
  <text x="68" y="99" text-anchor="middle" font-size="46" font-family="${FONT_EMOJI}">${p.emoji}</text>

  <text x="132" y="60" font-size="27" font-weight="700" fill="#ffffff" font-family="${FONT_CN}">${esc(p.cn)}</text>
  <text x="133" y="84" font-size="12.5" fill="#ffffff" fill-opacity="0.62" letter-spacing="1.6" font-family="${FONT_CN}">${esc(p.en)}</text>
  <text x="133" y="116" font-size="14" fill="#ffffff" fill-opacity="0.85" font-family="${FONT_CN}">${esc(p.tagline)}</text>

  <text x="616" y="150" text-anchor="end" font-size="11.5" fill="#ffffff" fill-opacity="0.5" letter-spacing="0.6" font-family="${FONT_CN}">${esc(p.dir)}</text>
  <circle cx="612" cy="26" r="4" fill="${to}" fill-opacity="0.9"/>
  <circle cx="598" cy="26" r="2" fill="#ffffff" fill-opacity="0.35"/>
</svg>
`;
}

// ───────────────────────────── 落地页 ─────────────────────────────

const hasPrompt = (p) => fs.existsSync(path.join(ROOT, p.dir, 'PROMPT.md'));

const cardHtml = (p) => {
  const primary = p.web
    ? `<a class="go" href="${p.web}">打开 →</a>`
    : `<a class="go" href="${p.dir}README.md">看用法 →</a>`;
  const secondary = p.web ? `<a class="doc" href="${p.dir}README.md">说明</a>` : '';
  const prompt = hasPrompt(p) ? `<a class="doc" href="${p.dir}PROMPT.md">输入</a>` : '';
  const tags = p.tags.map((t) => `<span>${esc(t)}</span>`).join('');
  const search = (p.cn + ' ' + p.en + ' ' + p.tagline + ' ' + p.dir + ' ' + p.tags.join(' ')).toLowerCase();
  return `      <article class="card" data-cat="${p.cat}" data-search="${esc(search)}">
        <a class="shot" href="${p.web || p.dir + 'README.md'}"><img src="docs/banners/${p.slug}.svg" alt="${esc(p.cn)}" loading="lazy"></a>
        <div class="body">
          <p>${esc(p.note)}</p>
          <div class="tags">${tags}</div>
          <div class="foot">
            <code>${esc(p.dir)}</code>
            <span class="run">${esc(p.run)}</span>
            ${primary}${secondary}${prompt}
          </div>
        </div>
      </article>`;
};

const filterChips = Object.entries(CATS)
  .map(([k, label]) => {
    const n = projects.filter((p) => p.cat === k).length;
    return `        <button class="chip" data-cat="${k}">${label} ${n}</button>`;
  })
  .join('\n');

const indexHtml = `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>a2_demo · 项目索引</title>
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎪</text></svg>" />
    <style>
      :root {
        color-scheme: dark;
        --bg: #07090f;
        --line: #1e2635;
        --text: #e8eef8;
        --dim: #8b9bb4;
        --accent: #6ea8ff;
      }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      body {
        background:
          radial-gradient(1200px 600px at 15% -10%, #16203a 0%, transparent 60%),
          radial-gradient(900px 500px at 90% 0%, #2a1038 0%, transparent 55%),
          var(--bg);
        color: var(--text);
        font: 15px/1.6 "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
        min-height: 100vh;
      }
      a { color: inherit; text-decoration: none; }
      .wrap { max-width: 1180px; margin: 0 auto; padding: 56px 24px 72px; }
      header h1 { font-size: clamp(26px, 4vw, 40px); margin: 0 0 12px; letter-spacing: 0.5px; }
      header .lead { color: var(--dim); margin: 0 0 6px; font-size: 16px; }
      header .sub { color: #5f7392; margin: 0; font-size: 13px; }
      header .sub a { color: #7f9cc4; }
      .bar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 28px 0 22px; }
      .chip {
        border: 1px solid var(--line); background: #0c1119; color: var(--dim);
        padding: 7px 14px; border-radius: 999px; cursor: pointer; font: inherit; font-size: 13px;
        transition: 0.15s;
      }
      .chip:hover { color: var(--text); border-color: #2c3a52; }
      .chip.on { color: #0a0f18; background: var(--accent); border-color: var(--accent); font-weight: 700; }
      .search {
        margin-left: auto; min-width: 200px; flex: 0 1 260px;
        background: #0c1119; border: 1px solid var(--line); border-radius: 999px;
        padding: 8px 16px; color: var(--text); font: inherit; font-size: 13px; outline: none;
      }
      .search:focus { border-color: #35507a; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 20px; }
      .card {
        background: linear-gradient(180deg, #0f1522, #0a0e16);
        border: 1px solid var(--line); border-radius: 18px; overflow: hidden;
        display: flex; flex-direction: column; transition: 0.18s;
      }
      .card:hover { border-color: #35507a; transform: translateY(-2px); }
      .card.hide { display: none; }
      .shot { display: block; line-height: 0; background: #080b12; }
      .shot img { width: 100%; height: auto; display: block; }
      .body { padding: 14px 18px 16px; display: flex; flex-direction: column; gap: 8px; flex: 1; }
      .body p { margin: 0; color: var(--dim); font-size: 13px; }
      .tags { display: flex; flex-wrap: wrap; gap: 6px; }
      .tags span {
        font-size: 11px; color: #9fb6d8; border: 1px solid #223049;
        background: #0d1626; border-radius: 999px; padding: 2px 9px;
      }
      .foot { margin-top: auto; padding-top: 10px; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; border-top: 1px dashed #1a2334; }
      .foot code { font-size: 12px; color: #8ea6c8; background: #0b1019; border: 1px solid #1a2334; border-radius: 6px; padding: 2px 7px; }
      .foot .run { font-size: 12px; color: #64768f; }
      .foot .go { margin-left: auto; font-size: 13px; font-weight: 700; color: var(--accent); }
      .foot .go:hover { text-decoration: underline; }
      .foot .doc { font-size: 12px; color: var(--dim); }
      .foot .doc:hover { color: var(--text); }
      .empty { color: var(--dim); padding: 24px 0; display: none; }
      footer { margin-top: 44px; color: #55677f; font-size: 12.5px; border-top: 1px solid #141b27; padding-top: 18px; }
      footer a { color: #7f9cc4; }
      footer code { color: #8ea6c8; }
      @media (max-width: 560px) {
        .wrap { padding: 32px 16px 48px; }
        .search { margin-left: 0; flex-basis: 100%; }
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <header>
        <h1>🎪 a2_demo · 多项目实验场</h1>
        <p class="lead">${projects.length} 个各自独立、打开就能跑的小项目：3D 场景、纯前端应用、LLM 玩法、内容抓取与素材工程。</p>
        <p class="sub">全部由 <a href="https://github.com/sunkwei/tea_a2">tea_a2</a> 创建 · 详细索引见 <a href="README.md">README.md</a> / <a href="docs/INDEX.md">docs/INDEX.md</a></p>
      </header>

      <div class="bar">
        <button class="chip on" data-cat="all">全部 ${projects.length}</button>
${filterChips}
        <input class="search" id="q" type="search" placeholder="搜索项目 / 技术栈…" />
      </div>

      <main class="grid" id="grid">
${projects.map(cardHtml).join('\n')}
      </main>
      <p class="empty" id="empty">没有匹配的项目 —— 换个关键词试试。</p>

      <footer>
        前端项目统一由根目录的 Vite 工程托管（<code>npm run dev</code> → <code>http://127.0.0.1:5173/</code>）；
        便笺 / 魔方 / 中药大全 / 陶器史 / 李清照是纯 <code>file://</code> 应用，双击各自目录下的 <code>index.html</code> 即可。
      </footer>
    </div>

    <script>
      const chips = [...document.querySelectorAll('.chip')];
      const cards = [...document.querySelectorAll('.card')];
      const empty = document.getElementById('empty');
      const q = document.getElementById('q');
      let cat = 'all';

      function apply() {
        const kw = q.value.trim().toLowerCase();
        let shown = 0;
        for (const card of cards) {
          const okCat = cat === 'all' || card.dataset.cat === cat;
          const okKw = !kw || card.dataset.search.includes(kw);
          const ok = okCat && okKw;
          card.classList.toggle('hide', !ok);
          if (ok) shown++;
        }
        empty.style.display = shown ? 'none' : 'block';
      }

      for (const chip of chips) {
        chip.addEventListener('click', () => {
          cat = chip.dataset.cat;
          chips.forEach((c) => c.classList.toggle('on', c === chip));
          apply();
        });
      }
      q.addEventListener('input', apply);
    </script>
  </body>
</html>
`;

// ───────────────────────────── 写文件 ─────────────────────────────

fs.mkdirSync(OUT_BANNERS, { recursive: true });
for (const p of projects) {
  fs.writeFileSync(path.join(OUT_BANNERS, `${p.slug}.svg`), bannerSvg(p), 'utf8');
}
fs.writeFileSync(path.join(ROOT, 'index.html'), indexHtml, 'utf8');

console.log(`✅ ${projects.length} 张横幅 → docs/banners/`);
console.log('✅ 落地索引页 → index.html');
