# 🏺 中国陶器史 · 两万年窑火

一个**长幅滚动**的 H5 单页：从江西仙人洞、湖南玉蟾岩两万年前的陶片，到仰韶彩陶、龙山蛋壳黑陶、
原始瓷、东汉青瓷、唐三彩、宋五大名窑、元青花、明清彩瓷，最后落到今天的氧化铝基片、氮化硅轴承球
与陶瓷基复合材料。

- **左栏**：年代 / 文化（窑口）/ 第几件
- **中栏**：真实器物照片，**点击放大**（灯箱支持缩放、拖动、← → 切换）
- **右栏**：一句点评 + 两段介绍 + 3 条看点 + 关键词 + 出土/收藏信息
- **AI**：点右下角「AI 问陶」或每行的「问 AI」，调用本机 **tea_a2（localhost:8383）** 联网检索并回答

没有框架、没有构建步骤：`index.html` + 5 个经典 `<script>`，双击就能看。

---

## 打开

| 方式 | 命令 | 说明 |
| --- | --- | --- |
| 直接打开 | 双击 `pottery/index.html` | 图片是本地文件，`file://` 下可用；AI 也可用（a2 的 CORS 是 `*`） |
| 本地服务器 | `node pottery/tools/serve.mjs` | http://127.0.0.1:5178 ；某些浏览器对 `file://` 的跨域请求更严格，用这个更稳 |
| 单文件版 | `node pottery/tools/build-single.mjs` | 生成 `pottery/pottery.html`（约 9 MB，图片全部内联），拷走一个文件即可 |

---

## 页面结构

```
hero          标题 / 导语 / 统计（20 件器物 · 约 2 万年 · 20 个文化或窑口）
compare       先分清「陶」与「瓷」：胎料 / 烧成温度 / 吸水率 / 釉 / 透光
rail          吸顶的时代导航（20 个入口，滚动时自动高亮）
timeline      三栏长列表：年代 | 实物图 | 点评
footer        内容与 AI 的两段免责声明 + 图片许可汇总提示
lightbox      图片放大：滚轮/双击缩放、放大后拖动平移、← → 换图、Esc 关闭
ai drawer     右侧抽屉：探测 / 提问 / 来源列表 / 离线启动指引 / 连接设置
```

### 三栏与响应式

- 桌面：`190px | 360px | 1fr`，左栏 `position: sticky`，读长文时年代一直在视野里；
  中间有一条时间轴竖线与节点圆点。
- ≤1040px：年代列收窄到 `160px`。
- ≤860px：单列堆叠，顺序改为「年代 → 图 → 文」，图片改 `16/10`；AI 抽屉变成底部弹层。
- 深色模式跟随系统（`prefers-color-scheme`），打印时自动隐藏灯箱/导航/按钮。

### 灯箱

- 点图打开，标题、年代、作者与许可一起显示，底部 `n / 22` 计数。
- 点图 = 以点击处为原点放大 2.2 倍；滚轮连续缩放（1–4 倍）；放大后拖动平移；双击复位。
- `←/→` 在全部 22 张图（20 件器物 + 现代工业陶瓷的 2 张工艺补充图）之间切换。

---

## 背景音乐（实时合成，没有音频文件）

右下角「♪ 窑火」是开关，旁边的 `⋯` 打开音量面板。声音全部由 **Web Audio** 在浏览器里算出来：

| 层 | 做法 | 听感 |
| --- | --- | --- |
| 窑火 | 73 / 110 / 146 Hz 三个略微失谐的振荡器 + 0.03 Hz 振幅起伏 | 低沉的窑腔嗡鸣 |
| 风 | 循环褐噪声 → 360 Hz 低通，LFO 慢扫 | 窑口的风 |
| 拨弦 | D 五声音阶（D F G A C）随机落点，三角波 + 高八度正弦，指数衰减 | 若隐若现的拨弦 |
| 混响 | 程序化生成的 3.4 秒衰减噪声当 IR，干湿两路 | 空间感 |

- 没有 mp3 / ogg：单文件版也不额外增大，离线、断网都能响。
- 首次播放必须点一下按钮（浏览器自动播放策略）；上次开着的话，刷新后第一次点页面会自动续播。
- 音量与开关存在 `localStorage`（`pottery.audio.v1`）；音量 0–100 走平方曲线，默认 45%。
- 切到后台时自动压到 25%，回来再抬起来；暂停会淡出并挂起 AudioContext，不占 CPU。
- 混音整体留了约 20 dB 余量（默认 45% 约 -33 dBFS），不会盖过你正在听的播客。

想改音阶或节奏：`src/audio.js` 顶部的 `SCALE`、`MIX_GAIN`，以及 `schedule()` 里的 1900–6200 ms 间隔。

---

## 接入 tea_a2 做 AI 搜索

页面不依赖后端：直接在浏览器里 `fetch` 本机 a2。

```js
POST http://localhost:8383/api/llm/chat
{
  "prompt": "……你是中国陶瓷史科普助手……用户问题：汝窑天青釉为什么难烧？",
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
- **降级**：连不上时给出可复制的启动命令（`tea_agent --port 8383 --workspace …`），
  不影响本地时间线；可以「重试」或「重新检测」。
- **设置**：服务地址 / provider / model 存在 `localStorage`（`pottery.a2.config.v1`），可一键恢复默认。
- 每个条目带一个预设问题，点「问 AI」会把条目上下文（器物、年代、窑口、出土/收藏）一起送进 prompt。

> 回答默认标注「AI 生成 · 未经审核」。文博类信息（尤其定年、真伪、价格）请以博物馆与正式出版物为准。

---

## 图片与许可

- 全部实物图来自 **Wikimedia Commons**，由 `tools/fetch-images.mjs` 按检索词下载 1200px 缩略图，
  只接受 **CC0 / Public domain / CC BY / CC BY-SA**。
- 逐张署名写在 `assets/ceramics/sources.js`（作者、许可、原链、采集日期、检索词）；
  页面图注、灯箱、页脚都会显示。
- `mise.jpg` / `qing-fencai.jpg` 因为展柜反光做了**局部裁切**，署名里标了「局部裁切」。
- 换图 / 补图：

```bash
# 需要走本机 clash 的 HTTP 代理（Node 不读环境变量时要显式打开）
https_proxy=http://127.0.0.1:8118 NODE_USE_ENV_PROXY=1 node pottery/tools/fetch-images.mjs --list
https_proxy=http://127.0.0.1:8118 NODE_USE_ENV_PROXY=1 node pottery/tools/fetch-images.mjs --only ru
https_proxy=http://127.0.0.1:8118 NODE_USE_ENV_PROXY=1 \
  node pottery/tools/fetch-images.mjs --force --pin "ru=File:Some better photo.jpg"
```

改完图片记得 `node pottery/tools/selftest.mjs`：它会检查每件器物的图片文件存在、>20KB、有许可与来源。

---

## 数据

`src/data-ceramics.js` 只有事实与点评，不碰 DOM：

```js
{
  id: 'ru', order: 13,
  era: '北宋', years: '约 1086—1106 年', culture: '汝窑',
  title: '天青釉洗', subtitle: '二十年窑火，烧出最安静的颜色',
  site: '河南宝丰清凉寺窑址', museum: '故宫博物院 / 克利夫兰艺术博物馆等',
  lead: '一句点评',
  body: ['第一段', '第二段'],
  points: ['看点 1', '看点 2', '看点 3'],
  tags: ['汝窑', '天青', '宋代'],
  question: '给 AI 的预设问题'
}
```

图片路径不用写：`core.withImages()` 按 `assets/ceramics/<id>.jpg` 约定补全；
`modern` 条目额外带 `extra: [{ src, label, creditId }]` 两张工艺补充图。

年代尽量写区间；不同学者的断代有出入的地方，正文里写「学界尚有不同说法」。

---

## 目录

```
pottery/
├─ index.html            页面骨架（经典 <script>，file:// 可用）
├─ src/
│  ├─ styles.css         全部样式（三栏 / 灯箱 / 抽屉 / 深色 / 响应式 / 打印）
│  ├─ data-ceramics.js   20 条时间线 + 陶瓷对照表
│  ├─ audio.js           Web Audio 实时合成背景音乐（不碰 DOM）
│  ├─ core.js            纯逻辑：排序 / 校验 / 邻居 / prompt / 检索结果解析
│  ├─ online.js          tea_a2 探测与提问（不碰 DOM）
│  └─ app.js             渲染 / 滚动进度 / 时代导航 / 灯箱 / AI 抽屉
├─ assets/ceramics/      22 张 jpg + sources.js（署名）
└─ tools/
   ├─ fetch-images.mjs   Wikimedia Commons 抓图 + 生成署名
   ├─ serve.mjs          本地静态服务器（5178）
   ├─ build-single.mjs   单文件构建
   ├─ selftest.mjs       75 项离线断言
   └─ verify.mjs         49 项无头浏览器端到端（--online 再加 4 项）
```

## 自检

```bash
node pottery/tools/selftest.mjs        # 数据 / 图片 / 署名 / 纯逻辑 / 提问词 / 检索解析 / 音频引擎
node pottery/tools/verify.mjs          # 无头 Chrome：三栏、图片、灯箱、移动端、背景音乐、AI 降级
node pottery/tools/verify.mjs --online # 再跑一次真实 tea_a2（需 8383 在跑）
```

`verify.mjs` 自己起一个临时静态服务器，不依赖 `serve.mjs`；浏览器路径可用 `CHROME_PATH` 指定。
截图写到 `pottery/tools/shots/`（不入库）。

---

## 已知取舍

- 器物图片是**不同博物馆、不同光线**下拍的，风格不统一；这是「真实器物」优先于「好看」的结果。
- 汝窑、秘色瓷等条目给的是**通行的区间与主流解释**，不是某一篇论文的结论。
- AI 回答里的具体年份、拍卖价、馆藏数量可能过时或出错，页面只负责把来源摊开给你看。
