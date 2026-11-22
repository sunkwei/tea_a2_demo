# 🪷 李清照 · 漱玉词

一个**长幅滚动**的 H5 单页：从 1084 年章丘明水的一间书房，到 1155 年临安的晚岁，
把李清照的生平拆成 16 个节点，用 **14 篇作品**（11 首词、2 首诗、1 篇文）按年代串起来。

- **左栏**：时期 / 地点 / 年份 / 年龄 / 第几篇
- **中栏**：配图（可点击放大）、题眼、图注、作者与许可
- **右栏**：词牌与标题、一句点评、**词笺**、词语注释、生平与赏析、三条看点、出处
- **背景音乐**：真实古琴录音《阳关三叠》（Charlie Huang 演奏，CC BY-SA 3.0），可调音量、后台自动压低
- **AI**：每篇都有「问 AI」，调用本机 **tea_a2（localhost:8383）** 联网补充；连不上时页面完全可用

没有框架、没有构建步骤：`index.html` + 6 个经典 `<script>`，双击就能看。

---

## 打开

| 方式 | 命令 | 说明 |
| --- | --- | --- |
| 直接打开 | 双击 `li-qingzhao/index.html` | 图片、音频都是本地文件，`file://` 下可用；AI 也可用（a2 的 CORS 是 `*`） |
| 本地服务器 | `node li-qingzhao/tools/serve.mjs`（或 `npm run lqz:serve`） | http://127.0.0.1:5179 ；支持 Range 请求，音频的时长/拖动更稳 |
| 单文件版 | `node li-qingzhao/tools/build-single.mjs`（或 `npm run lqz:build`） | 生成 `li-qingzhao/li-qingzhao.html`（约 14.4 MB，图片与音频全部内联），拷走一个文件即可 |

---

## 页面结构

```
hero          标题 / 导语 / 统计（14 篇 · 5 段 · 71 年 · 10 座城）+ 竖排《声声慢》词笺
stages        五段人生：章丘·汴京 → 青州归来堂 → 莱州·建康 → 江南漂泊 → 临安晚岁
journey       行迹条：章丘 1084 → 汴京 1101 → 青州 1107 → … → 临安 1150
rail          吸顶的作品导航（16 个入口；桌面 8×2 网格，移动端横向滚动）
timeline      三栏长列表：年代 | 配图 + 题眼 | 词与文
footer        内容 / 图片 / 音乐 / AI 四段免责声明 + 署名汇总
lightbox      图片放大：滚轮/双击缩放、放大后拖动平移、← → 换图、Esc 关闭
ai drawer     右侧抽屉：连接设置 / 示例问题 / 检索来源 / 离线启动指引
audio dock    右下角「古琴」：播放 / 暂停、音量、曲目与许可
```

### 三栏与响应式

- 桌面：`196px | 370px | 1fr`，左栏与中栏 `position: sticky`，读长文时年代和配图一直在视野里；
  中间有一条时间轴竖线与节点圆点。
- ≤1120px：年代列收窄到 170px。
- ≤900px：两栏（左栏变成横排标签），中栏不再吸顶。
- ≤720px：单列堆叠，顺序为「年代 → 图 → 文」；隐藏首屏竖排词笺与浮动 AI 按钮（每条仍有「问 AI」）。
- 深色模式跟随系统（`prefers-color-scheme`），打印时自动隐藏灯箱/导航/按钮。

### 词笺与注释

- 词按原句断行，上下阕之间留一行空白；标点单独弱化成灰色，不抢字。
- 长调（如《声声慢》《永遇乐》）自动收紧字号与行距。
- 散文（《金石录后序》）用独立样式：连续段落、首行缩进 2em，和诗词区分开。
- 「词语注释」默认折叠，展开后是 `词语 → 解释` 的两列小注。
- 每条配图下有一句「题眼」、图注、作者/许可/Commons 链接。

### 灯箱

- 点图打开，标题、地点与年代、作者与许可一起显示；左上角 `n / 21` 计数。
- 点图 = 以点击处为原点放大 2.2 倍；滚轮连续缩放（1–4 倍）；放大后拖动平移；双击复位。
- `←/→` 在全部 21 张图（16 主图 + 5 附图）之间切换。

---

## 词与年

| # | 年份 | 地点 | 作品 |
| --- | --- | --- | --- |
| 1 | 1084—1099 | 章丘 · 汴京 | 生平：章丘明水，书香门第 |
| 2 | 约 1099 | 汴京 · 济南 | 《如梦令 · 常记溪亭日暮》 |
| 3 | 约 1099—1100 | 汴京 | 《点绛唇 · 蹴罢秋千》（作者存疑） |
| 4 | 1101 | 汴京 | 《减字木兰花 · 卖花担上》 |
| 5 | 约 1103 | 汴京 | 《一剪梅 · 红藕香残玉簟秋》 |
| 6 | 约 1104 重阳 | 汴京（一说青州） | 《醉花阴 · 薄雾浓云愁永昼》 |
| 7 | 1107—1121 | 青州 · 归来堂 | 《凤凰台上忆吹箫 · 香冷金猊》 |
| 8 | 1127—1128 | 淄州 → 建康 | 《渔家傲 · 天接云涛连晓雾》 |
| 9 | 1129 春 | 和州乌江 | 《夏日绝句》 |
| 10 | 1129 八月 | 建康 | 《孤雁儿 · 藤床纸帐朝眠起》 |
| 11 | 1132 | 会稽 | 《金石录后序》（节选） |
| 12 | 1134 | 金华 | 《题八咏楼》（附《打马图经》） |
| 13 | 1135 | 金华 | 《武陵春 · 风住尘香花已尽》 |
| 14 | 约 1135—1145 | 临安 | 《声声慢 · 寻寻觅觅》 |
| 15 | 约 1150 | 临安 | 《永遇乐 · 落日熔金》 |
| 16 | 1155（一说 1151 / 1156） | 临安 | 余响：漱玉词与易安体 |

系年说明：除《金石录后序》《题八咏楼》等有明确自署或同时代记载外，词的写作年代多为推定；
页面对容易混淆的地方写「约」并注明异说，不把《琅嬛记》之类的笔记传闻当史实。

---

## 背景音乐（真实古琴录音）

| 项 | 内容 |
| --- | --- |
| 曲目 | 《阳关三叠》（打谱自《琴学入门》1867） |
| 演奏 | Charlie Huang（Charles R Tsua），2013-10-06 于英国伯明翰 |
| 乐器 | 古琴（丝弦/尼龙弦） |
| 来源 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Guqin-Yangguan_Sandie.ogg) |
| 许可 | CC BY-SA 3.0 |

- 页面内做了**响度归一（-20 LUFS）与 44.1kHz / 128kbps MP3 转码**，属改编版本，同样以 CC BY-SA 3.0 提供。
- 首次播放必须点一下「古琴」（浏览器自动播放策略）；上次开着的话，刷新后第一次点页面会自动续播。
- 音量与开关存在 `localStorage`（`lq.audio.v1`）；音量 0–100 走平方曲线，默认 45%。
- 切到后台时自动压到 32%，回来再抬起来；暂停会淡出并真正 `pause()`，不占资源。
- 单文件版把 MP3 以 data URI 内联，仍然离线可播。

想换曲子：把 `assets/audio/yangguan-sandie.mp3` 换掉，并更新 `assets/images/sources.js` 里的 `LI_QINGZHAO_AUDIO`；
`tools/fetch-images.mjs --audio` 会重新下载并做响度归一。

---

## 接入 tea_a2 做 AI 问答

页面不依赖后端：直接在浏览器里 `fetch` 本机 a2。

```js
POST http://localhost:8383/api/llm/chat
{
  "prompt": "……你是宋代文学与历史普及作者……用户问题：……",
  "provider": "deepseek",          // 只有这个 provider 开了 supports_search
  "model": "deepseek-flash",
  "web_tools": true,               // 服务端代模型调搜索端点
  "reasoning_effort": "none",
  "max_tokens": 1600
}
```

- **探测**：启动时静默 `GET /api/health`，状态显示在抽屉顶部（`在线 1.8.0` / `离线` / `超时`）。
- **来源**：优先解析 `web_tool_calls[].output` 里的 `[n] 标题 / url / score / summary`，
  再补上模型正文里写的链接，按 URL 去重。
- **降级**：连不上时给出可复制的启动命令（`tea_agent --port 8383 --workspace …`），不影响本地时间线；
  可以「重试」或改连接设置。
- **设置**：服务地址 / provider / model 存在 `localStorage`（`lq.a2.config.v1`），可一键恢复默认。
- 每篇作品带一个预设问题，点「问 AI」会把作品、作年、地点、原文、已注词语一起送进 prompt。

> 回答默认标注「AI 生成 · 未经审核」。文学史与系年问题请以正式出版物为准。

---

## 图片与许可

- 全部图片来自 **Wikimedia Commons**，由 `tools/fetch-images.mjs` 按确切文件名下载并压到 1400×1600 以内的 JPEG。
- 只接受 **CC0 / Public domain / CC BY / CC BY-SA**。
- 逐张署名写在 `assets/images/sources.js`（作者、许可、原链、采集日期、检索词）；页面图注、灯箱、页脚都会显示。
- 图片是**古画 + 今景混用**：宋徽宗《梅花与鸟》、马远《寒江独钓图》、仇英/吕纪/边寿民等后人作品，
  以及今天的百脉泉、青州范公亭、金华八咏楼、西湖夜景。照片不是宋代原貌，图注里已说明。
- 换图 / 补图：

```bash
# 需要走本机 clash 的 HTTP 代理（Node 不读环境变量时要显式打开）
https_proxy=http://127.0.0.1:8118 NODE_USE_ENV_PROXY=1 node li-qingzhao/tools/fetch-images.mjs --list
https_proxy=http://127.0.0.1:8118 NODE_USE_ENV_PROXY=1 node li-qingzhao/tools/fetch-images.mjs --only shaonv
https_proxy=http://127.0.0.1:8118 NODE_USE_ENV_PROXY=1 node li-qingzhao/tools/fetch-images.mjs --meta   # 只刷新署名
```

改完图片记得 `node li-qingzhao/tools/selftest.mjs`：它会检查每个引用的图片存在、>8KB、有许可与来源。

---

## 数据

`src/data-life.js` 只有事实、引文与点评，不碰 DOM：

```js
{
  id: 'shaonv', order: 2, stage: 1,
  era: '北宋 · 元符', years: '约 1099', age: '约 16 岁',
  place: '汴京 · 济南', kind: '词',
  written: '约 1099 年', source: '《漱玉词》',
  title: '如梦令 · 常记溪亭日暮',
  subtitle: '一次晚了归舟的游湖，被她记了一辈子',
  lead: '整首词没有一个“愁”字……',
  keyLine: '误入藕花深处',
  poem: ['常记溪亭日暮，沉醉不知归路。', '……'],
  notes: [{ term: '溪亭', text: '……' }],
  body: ['第一段', '第二段'],
  points: ['看点 1', '看点 2', '看点 3'],
  tags: ['少女', '游湖', '济南'],
  question: '给 AI 的预设问题'
}
```

图片路径不用写：`core.withImages()` 按 `assets/images/<id>.jpg` 约定补全；
需要换图的条目（如《如梦令》用荷花特写）显式写 `image`；附图用 `extra: [{ id, label }]`。

---

## 目录

```
li-qingzhao/
├─ index.html             页面骨架（经典 <script>，file:// 可用）
├─ src/
│  ├─ styles.css          全部样式（三栏 / 词笺 / 灯箱 / 抽屉 / 深色 / 响应式 / 打印）
│  ├─ data-life.js        16 条生平与作品 + 五段 + 行迹
│  ├─ core.js             纯逻辑：排序 / 校验 / 导航 / 统计 / 文本 / 提问 / 检索解析
│  ├─ audio.js            古琴播放器（懒加载 / 淡入淡出 / 音量 / 后台压低 / 记忆）
│  ├─ online.js           tea_a2 探测与提问（不碰 DOM）
│  └─ app.js              渲染 / 滚动进度 / 导航高亮 / 灯箱 / 音乐 / AI 抽屉
├─ assets/
│  ├─ images/             21 张图片 + sources.js（署名）
│  └─ audio/              yangguan-sandie.mp3（5.4 MB，响度归一）
└─ tools/
   ├─ fetch-images.mjs    Wikimedia 抓图 + 古琴曲 + 生成署名
   ├─ serve.mjs           本地静态服务器（5179，支持 Range）
   ├─ build-single.mjs    单文件构建（图片 + 音频内联）
   ├─ selftest.mjs       92 项离线断言
   └─ verify.mjs         58 项无头浏览器端到端（--online 再加 2 项）
```

## 自检

```bash
node li-qingzhao/tools/selftest.mjs        # 数据 / 图片 / 署名 / 音频 / 纯逻辑 / 提问词 / 检索解析 / 播放器
node li-qingzhao/tools/verify.mjs          # 无头 Chrome：三栏、图片、词笺、灯箱、音乐、AI 降级、移动端、深色
node li-qingzhao/tools/verify.mjs --online # 再跑一次真实 tea_a2（需 8383 在跑）
```

`verify.mjs` 自己起一个临时静态服务器，不依赖 `serve.mjs`；浏览器路径可用 `CHROME_PATH` 指定。
截图写到 `li-qingzhao/tools/shots/`（不入库）。

---

## 已知取舍

- **系年**：除少数作品外，李清照词的写作年代只能推定；页面一律写「约」，并在有异说的地方注明。
- **作者归属**：《点绛唇·蹴罢秋千》明清人选本多题李清照，宋人词选未收，页面标了「作者存疑」。
- **再嫁张汝舟**：宋人《建炎以来系年要录》等有记载，清代俞正燮等力辩其诬，学界至今有争议；页面并存两说。
- **图片**：不同时代、不同博物馆的古画与今景混用，风格不统一；这是「让词里的物象有个着落」的取舍，图注已说明。
- **音乐**：是真实古琴录音，不是实时合成；页面只做了响度归一与转码，改动了音频本体，署名里已注明。
- **AI**：回答可能过时或出错，页面只负责把问题、原文与来源摊开给你看。

---

## 许可

- 代码：MIT（与本仓库一致）。
- 页面文字：可自由引用，但请保留出处。
- 图片与古琴录音：各依 Wikimedia Commons 上标注的许可（CC0 / Public Domain / CC BY / CC BY-SA），逐张/逐曲署名见 `assets/images/sources.js`。
