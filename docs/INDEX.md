# 🗂️ a2_demo 全局目录

> 这是一个**多项目实验场**：每个子项目都能独立跑起来、互不依赖，按需取用。
> 本页是全仓库的索引——想知道「有什么、怎么跑、怎么测」，看这一页就够。

---

## 📇 一览表

| # | 项目 | 目录 | 一句话定位 | 技术栈 | 启动 | 自测 |
|---|------|------|-----------|--------|------|------|
| 1 | 🐱 喵屋便利店 | `meow-mart/` | 雨夜 3D 小镇：霓虹便利店、会走路的橘猫、积水倒影、斜飞雨丝 | Three.js + Vite | `npm run dev` → `/meow-mart/` | — |
| 2 | 🐍 贪吃蛇竞赛 | `snake-race/` | 2–4 条 AI 蛇同场围杀，5 种自研避让算法竞技 | 原生 JS + Canvas | `npm run dev` | `npm run test:snake` |
| 3 | 🎬 60 秒看懂 Self-Attention | `attention-film/` | 图解短片：Canvas 2D 讲清 Self-Attention → Transformer | Canvas 2D + ffmpeg | `npm run dev` | `npm run film:shot` |
| 4 | 📺 IPTV 剧场 | `iptv-player/` | 网页版直播播放器：87 个内置源、在线更新、频道体检 | 原生 JS + hls.js | `npm run dev` | `npm run test:iptv` |
| 5 | 📌 便笺 | `sticky-notes/` | 纯本地便笺：WCAG 对比度、提醒、回收站、正则查询 | 原生 JS | 双击 `index.html` | `npm run test:sticky` |
| 6 | 🧊 三阶魔方还原教程 | `rubiks-cube/` | 手写 WebGL 3D 魔方 + 鼠标拧层 + 7 步还原教程 | WebGL（零依赖） | 双击 `index.html` | `npm run test:rubik` |
| 7 | 🏘️ AI 小镇：无限人生 | `ai-town/` | LLM 实时生成一切文字的模拟经营游戏，17 种结局 | Python + Tkinter | `cd ai-town && python main.py` | `cd ai-town && python -m pytest tests -q` |
| 8 | ⚔️ AI 三国杀 | `sanguosha-ai/` | 三个大模型同台打三国杀，自己出牌自己喊话 | Python + HTML5 | `cd sanguosha-ai && python main.py --web` | `npm run test:sgss` |
| 9 | 📺📚 看过的内容交给 LLM | `bilibili/` + `zhihu/` + `shared/` | B 站/知乎观看历史 → 字幕/正文 → LLM 结构化摘要 | Python（requests） | `cd bilibili && python bili.py fetch` | `python -m pytest` |
| 10 | 🦊 tea_a2 划词助手 | `tea-select/` | Firefox 扩展：划词后弹横幅，一键翻译/搜索/总结 | JS (MV3) | `web-ext run` | `node tea-select/tools/selftest.mjs` |
| 11 | 🎮 GoDot · 三国肉鸽 | `GoDot/` | Godot 4 项目：三国题材肉鸽 | Godot 4 | Godot 打开 `project.godot` | — |
| 12 | 🏗️ 青岛栈桥 & 回澜阁 | `zhanqiao/` | 按真实物理尺寸的 Blender 建模（含 `.blend`） | Blender | 打开 `zhanqiao.blend` | `python zhanqiao/verify.py` |
| 13 | 🚀 终末地 · 舰桥观测舱 | `endfield-ship/` | 明日方舟风格飞船内舱：泰拉II 行星 + 天梯缆索 + ARK 风格 HUD | Three.js + 原生 ESM | `npm run dev` | `npm run test:endfield` |
| 14 | 🌿 中药大全 | `tcm-herb/` | 药材图鉴 + 按病症查药/配伍/验方、拼音与错别字检索、查询历史、可选联网 | 原生 JS（file://） | 双击 `index.html` | `npm run test:tcm` |
| 15 | 🏺 中国陶器史 | `pottery/` | 两万年长幅时间线：20 件真实器物，左年代 / 中实物图 / 右点评，点图放大，Web Audio 实时合成背景音乐，可选 tea_a2 联网问答 | 原生 JS（file://） | 双击 `index.html` | `npm run test:pottery` |
| 16 | 🪷 李清照 · 漱玉词 | `li-qingzhao/` | 一生与词：16 个节点 / 14 篇作品，左年代 / 中配图 + 题眼 / 右词笺与注释，真实古琴《阳关三叠》，可选 tea_a2 问答 | 原生 JS（file://） | 双击 `index.html` | `npm run test:lqz` |
| 17 | 🎹 琴房 | `piano/` | 多点触摸钢琴练习：多指复音 / 瀑布流跟弹判分 / 认键 / 音阶和弦，WebAudio 加法合成音色 | 原生 JS（无构建） | 双击 `index.html` | `npm run test:piano` |

> 每个项目都有自己的 `README.md`，细节看那一份；本页只做索引与横向对比。

---

## 🗂️ 按主题分组

### A. 纯前端可视化（打开就能玩，零后端）

| 项目 | 看点 |
|------|------|
| 🐱 喵屋便利店（`meow-mart/`） | 全部几何体与贴图**运行时程序化生成**，仓库里没有一个模型/贴图文件；后处理含 Bloom |
| 🐍 贪吃蛇竞赛 | 5 种 AI 避让算法同场竞技，含基准组与 head-to-head 压测脚本 |
| 🎬 Self-Attention 短片 | 无动画库、无外部素材，逐帧渲染后用 ffmpeg 合成 |
| 🧊 三阶魔方 | 贴纸/块体/光照全是手写 WebGL，鼠标拖拽即拧层，教程公式经整盘模拟校验 |

前三个与 IPTV 共用根目录的 Vite 工程（`vite.config.js`），`npm run dev` 后按路径访问：
`/`（项目索引页）、`/meow-mart/`、`/snake-race/`、`/attention-film/`、`/iptv-player/`。

> **🧊 三阶魔方与 📌 便笺是独立的 `file://` 应用**，用经典 `<script>` 引入（ES module 在
> `file://` 下会被 CORS 拦掉），因此**不进入 Vite 构建**、也不需要打包；双击 `index.html` 即用。
> 开发时也能用 `npm run dev` 访问 `/rubiks-cube/`、`/sticky-notes/`。
> 🌿 **中药大全** 同样是独立的 `file://` 应用（86 味药 / 39 病症 / 22 首验方），可选接本机 tea_a2 联网补充；
> 单文件版用 `npm run tcm:build` 生成。
> 🏺 **中国陶器史** 也是独立的 `file://` 应用：20 件器物、22 张 Wikimedia Commons 实物图（逐张署名）、
> 点击放大灯箱；右下角「♪ 窑火」用 Web Audio 实时合成背景音乐（没有音频文件），「AI 问陶」调本机 tea_a2 联网检索。
> 单文件版用 `npm run pottery:build` 生成。
> 🪷 **李清照 · 漱玉词** 也是独立的 `file://` 应用：16 个生平节点 + 14 篇作品，21 张 Wikimedia Commons 配图（逐张署名）、
> 点击放大灯箱、词语注释；背景音乐是真实古琴录音《阳关三叠》（CC BY-SA 3.0，页面内做响度归一），
> 右下角「古琴」可播放/调音量，「问 AI」调本机 tea_a2。单文件版用 `npm run lqz:build` 生成。

### A2. 3D 场景（Three.js）

- 🐱 `meow-mart/`：喵屋便利店 —— 雨夜霓虹小镇（程序化贴图 + Bloom + 积水反射）
- 🚀 `endfield-ship/`：终末地 · 舰桥观测舱 —— 泰拉II 行星 / 天梯缆索 / 明日方舟风格 HUD
  （PBR + 程序化 Canvas 贴图 + 体积光 + Bloom 调色 + PRTS 终端）
  自测：`npm run test:endfield`（70 项离线断言）、`npm run endfield:verify`（46 项无头浏览器）

### B. LLM 应用（会调模型的那些）

- **本机 tea_a2**（`http://localhost:8383`）是这仓库的「模型中台」：
  `POST /api/llm/chat` 支持 `prompt|messages`、`system`、`provider`、`model`、
  `reasoning_effort`（none/minimal/low/medium/high/xhigh/max，按模型支持度降级）、
  `search`（联网搜索）、`tools`（函数调用）。`GET /api/providers` 可查可用模型。
- 🦊 **tea-select**（Firefox 扩展）：划词 → 调 tea_a2 → 横幅直接显示结果。
- 📌 **便笺**：可选接 tea_a2 做 AI 归类 / 抽时间 / 问答 / 长文拆条（默认关闭）。
- 🪷 **李清照 · 漱玉词**：每篇作品都有「问 AI」，把原文、作年、地点与已注词语一起送进 prompt；连不上时页面完全可用。

### C. 内容抓取与摘要

`shared/` 放的是 `bilibili/` 与 `zhihu/` **共用的一半**：登录态（Playwright storageState）、
LLM 调用封装、正文清洗、摘要提示词与解析。两者各自只 import 自己要的那一块。

- 📺 `bilibili/bili.py`：拉观看历史 → 抓字幕 → 结构化摘要 → markdown 周报
- 📚 `zhihu/zhihu.py`：收藏夹/回答正文 → 摘要；还能「读最近看过的 → 让模型写一篇新的」

### D. 素材、工具与扩展

- 🎮 `GoDot/`：Godot 4 项目（三国肉鸽）
- 🏗️ `zhanqiao/`：Blender 建模 + `verify.py` 尺寸校验
- 🦊 `tea-select/`：Firefox MV3 扩展，`tools/build.mjs` 可打包 zip

---

## 🔗 依赖关系

```
                       ┌──────────────────────────────┐
   root Vite 工程 ────▶│ 前端四件套                    │
   (vite.config.js)    │ /  /snake-race/  /rubiks-cube/ │
                       │ /attention-film/  /iptv-player/│
                       └──────────────────────────────┘

   shared/  ◀── import ── bilibili/   zhihu/
      │
      └── LLM 调用封装 ──▶ 本机 tea_a2 (localhost:8383)

   sticky-notes/  tea-select/  ── HTTP ──▶ 本机 tea_a2 (localhost:8383)

   ai-town/  sanguosha-ai/  ── 直连模型 provider（本地 Ollama / OpenAI 兼容端点 / 云端模型）
```

**一句话**：前端四件套只依赖浏览器；两个 LLM 应用依赖本机 tea_a2 或任意 OpenAI 兼容端点；
抓取类应用依赖 `shared/` 与 Python 生态。

---

## 🧰 常用脚本速查（根 `package.json`）

| 命令 | 作用 |
|------|------|
| `npm run dev` | Vite 开发服务器（:5173），根路径是项目索引页，喵屋在 `/meow-mart/` |
| `npm run build` / `npm run preview` | 构建 / 预览产物 |
| `npm run test:snake` | 贪吃蛇规则断言 + 性能压测 |
| `npm run bench:snake:head` | 贪吃蛇算法 head-to-head（200 局） |
| `npm run film:build` | 短片一站式：构建 → 配乐 → 逐帧抓取 → ffmpeg 合成 |
| `npm run test:iptv` / `npm run iptv:single` | IPTV 离线断言 / 打包单文件版 |
| `npm run test:sticky` / `npm run sticky:verify` | 便笺离线断言 / 无头 Edge 端到端验证 |
| `npm run test:tcm` / `npm run tcm:verify` | 中药大全离线断言（57 项）/ 无头 Edge 端到端（24 项） |
| `npm run tcm:build` / `npm run tcm:images` | 生成单文件版 / 重新抓取药材图片 |
| `npm run test:rubik` / `npm run rubik:verify` | 魔方离线断言 / 无头 Edge 端到端验证 |
| `npm run test:endfield` | 终末地舰桥观测舱离线断言（纯 Node，70 项） |
| `npm run endfield:verify` | 终末地舰桥观测舱无头 Edge 端到端验证 + 截图（46 项） |
| `npm run sgss:web` / `npm run test:sgss` | AI 三国杀网页版 / pytest |
| `npm run sgss:doctor` | 三国杀环境自检（模型、端口、依赖） |

---

## 🧪 每个项目都怎么自测

仓库里形成了一套统一约定，新项目照抄即可：

1. **`tools/selftest.mjs`** —— 纯 Node 离线断言，不开浏览器（核心逻辑、解析、规则）。
2. **`tools/verify.mjs`** —— 用 CDP 驱动真实 Edge 打开 `file://` 页面，
   做真实交互（点击、拖拽、打字）并截图到 `tools/shots/`。
   关键点：脚本一律用经典 `<script>` 引入（ES module 在 `file://` 下会被 CORS 拦），
   截图目录默认进 `.gitignore`，需要入仓库的预览图另存 `docs/preview.png`。
3. **无头浏览器**统一用 Edge，必要时加
   `--enable-unsafe-swiftshader --use-gl=angle --use-angle=swiftshader` 跑 WebGL。

---

## 🗃️ 仓库结构

```
tea_a2_demo/
├── index.html                # 🎪 项目索引落地页（横幅 + 筛选 + 搜索）
├── vite.config.js  package.json
├── docs/banners/             # 18 张项目横幅 SVG（npm run index:build 生成）
├── docs/PROMPTS.md           # 用户输入归档总表（npm run prompts:build 生成）
├── tools/gen-project-index.mjs  # 横幅 + 索引页生成器
├── meow-mart/                # ① 喵屋便利店（Three.js）
├── snake-race/               # ② 贪吃蛇竞赛
├── attention-film/           # ③ Self-Attention 短片
├── iptv-player/              # ④ IPTV 剧场
├── sticky-notes/             # ⑤ 便笺（独立 file:// 应用）
├── tcm-herb/                 # ⑯ 中药大全（独立 file:// 应用）
├── pottery/                  # 🏺 中国陶器史（独立 file:// 应用 + 可选 AI）
├── li-qingzhao/              # 🪷 李清照 · 漱玉词（独立 file:// 应用 + 古琴音乐 + 可选 AI）
├── rubiks-cube/              # ⑥ 三阶魔方还原教程（独立 file:// 应用）
├── ai-town/                  # ⑦ AI 小镇
├── sanguosha-ai/             # ⑧ AI 三国杀
├── bilibili/  zhihu/  shared/   # ⑨⑩⑪ 抓取 + 摘要（shared 为共用层）
├── tea-select/               # ⑫ Firefox 划词扩展
├── GoDot/                    # ⑬ Godot 项目
├── zhanqiao/                 # ⑭ Blender 建模
├── endfield-ship/             # ⑮ 终末地 · 舰桥观测舱（Three.js + 原生 ESM）
├── docs/                     # 全局索引、预览图、机制分析
└── .tea_agent_run/           # 会话工作区（不入库）
```

---

## 🧾 每个项目的用户输入

**本机创建**的项目，目录下的 **`PROMPT.md`** 记着它当初是怎么被要求做出来的（用户输入原文，已剔除「继续」「提交,推送」这类无效指令）。
- 本机创建 + 留档：`tea-select/`、`pottery/`、`li-qingzhao/`
- 本机创建但会话没留下：中药大全、便笺、魔方、终末地、AI 小镇、三国杀、视频分析、栈桥（无 `PROMPT.md`，可补录）
- 外部引入（不是本机创建的）：`bilibili/`、`zhihu/`、`meow-mart/`、贪吃蛇、短片、IPTV、GoDot —— 本机没有创建提示词；
  `bilibili/`、`meow-mart/` 的 `PROMPT.md` 只记搬进来之后的改动

总表与过滤规则见 [`PROMPTS.md`](PROMPTS.md)，重新生成用 `npm run prompts:build`。

---

## 📌 相关文档

- [`docs/PROMPTS.md`](PROMPTS.md) —— 用户输入归档总表（各项目 `PROMPT.md` 的索引）
- [`docs/tea_a2-8282-mechanism-gaps.md`](tea_a2-8282-mechanism-gaps.md) —— tea_a2 机制缺口分析
- [`docs/starship-deck-comparison.md`](starship-deck-comparison.md) —— 与 starship-deck（fable 5.2）的逐维度对比报告：视觉/渲染/光照/性能/交互/🔊声音/工程验证
- 各子项目的 `README.md` —— 各自的完整说明与踩坑记录
