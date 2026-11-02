# 🎬 60 秒看懂 Self-Attention → Transformer

一支 **60 秒的图解短片**：用 Canvas 2D 把「Self-Attention 是什么、Transformer 怎么把它组装起来」讲清楚。
纯前端渲染，无任何动画库、无外部图片/模型资源；再由无头浏览器逐帧渲染 + ffmpeg 合成 MP4。

🎥 成片：[`release/attention-film.mp4`](./release/attention-film.mp4)（1920×1080 / 30fps / 60.0s / H.264+AAC / 6.2MB）
🖼️ 封面：[`release/poster.jpg`](./release/poster.jpg)　🧩 [每 5 秒一帧的联系表](./release/contact-sheet.png)

在浏览器里看（可播放 / 拖进度 / 空格暂停）：

```bash
npm run dev      # 然后打开 http://127.0.0.1:5173/attention-film/
```

---

## 片子讲了什么

用一句中文短句 **「小猫 追着 蝴蝶 飞过 草地」** 做例子，8 个章节、60 秒：

| # | 时间 | 章节 | 画面 |
| --- | --- | --- | --- |
| 01 | 0–5s | 开场 | 标题 + 「词 → Transformer → 新词」的预告 |
| 02 | 5–12s | 角色 | 每个词都长出 **Query / Key / Value** 三个向量 |
| 03 | 12–21s | 计算 | q·k 打分 → softmax 权重 → 加权 Value → 新表示 |
| 04 | 21–28s | 矩阵 | 5×5 注意力矩阵热力图，逐格点亮 |
| 05 | 28–36s | 多头 | 4 个头各看各的（语法/指代/语义/邻接）→ Concat → W_O |
| 06 | 36–46s | 模块 | 一个 Transformer Block：注意力 + 残差 + LayerNorm + FFN，再堆 6 层 |
| 07 | 46–54s | 架构 | Encoder / Decoder 全景、交叉注意力、掩码自注意力 |
| 08 | 54–60s | 收尾 | 一行公式 + 三句话总结 |

每章底部都有同步字幕，鼠标悬停进度条可随时回看。

---

## 代码结构

```
attention-film/
├── index.html          播放器页面（canvas + 控制条）
├── styles.css
├── src/
│   ├── main.js         播放循环 / 进度条 / 快捷键 / 无头渲染 API(window.__film)
│   ├── film.js         时间轴调度：把 t 映射到 8 个场景 + HUD + 字幕
│   ├── draw.js         Canvas 原语（圆角矩形/箭头/热力色/向量条/文字/背景）
│   ├── ease.js         缓动函数（easeOut / easeOutBack / seq …）
│   ├── data.js         固定数据：词表、分数、softmax 权重、4 个头的矩阵
│   ├── music.js        程序化生成的环境音乐（OfflineAudioContext → WAV）
│   └── scenes/         8 个场景，一场景一文件
│       ├── intro.js  qkv.js  attention.js  matrix.js
│       └── heads.js  block.js  arch.js    outro.js
├── tools/              无头渲染与质检工具（见下）
└── release/            产物：mp4 / poster / music.wav / frames(中间帧)
```

### 关键设计：确定性时间轴

**每一帧都是时间 `t` 的纯函数**——`renderFrame(ctx, t)` 不依赖上一帧、不依赖挂钟。

```js
renderFrame(ctx, t);        // 同一个 t 永远得到同一张画面
```

带来的好处：
- 拖进度条 = 直接跳到某个 `t`，不需要重放
- 无头渲染可以逐帧精确复现（`t = i / fps`）
- 改代码后只要重渲受影响的帧，不用重录

所有动画元素都用 `seq(t, start, dur)` 表达"从第几秒开始、用什么缓动走完"。

---

## 工具（tools/）

| 命令 | 作用 |
| --- | --- |
| `npm run film:shot -- 1.5,12,30` | 无头截图若干时间点 → `tools/shots/` |
| `npm run film:layout -- 1.5,12,30` | **排版体检**：抓所有文字/图形包围盒，报重叠 / 出界 / 遮挡 |
| `npm run film:music` | 在页面里离线渲染背景音乐 → `release/music.wav` |
| `npm run film:capture` | 逐帧渲染 1800 帧 → `release/frames/`（约 5 分钟） |
| `npm run film:encode` | ffmpeg：帧序列 → MP4 → 叠加音乐 → `release/attention-film.mp4` |
| `npm run film:build` | 一条龙：build → 音乐 → 逐帧 → 合成 |

其它小工具：
- `tools/ascii.mjs` —— 把某一帧转成字符画，不看图也能核对构图
- `tools/sheet.mjs` —— 把多张截图拼成一张联系表
- `tools/smoke.mjs` —— 播放器冒烟测试（播放/暂停/拖进度/画面变化/音乐按钮/零报错）
- `tools/probe.mjs` —— 像素探针：采样某帧指定坐标的颜色，客观确认元素画出来了
- `tools/colorascii.mjs` —— 彩色字符画：按色相把画面映射成字符，不看图也能核对构图

> 排版体检是这台机器上唯一能"不开眼"检查排版的手段：画面绘制时会顺手把每个矩形/文字的包围盒记进 `window.__trace`，
> 工具再在无头浏览器里逐帧回放、比对相交面积。

---

## 重新生成成片

```bash
npm run film:build
```

依赖：Node ≥ 18、已装 `puppeteer-core`、本机有 **Edge**（`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`）和 **ffmpeg**。

---

## 音乐

`src/music.js` 用 WebAudio 离线渲染一段 60 秒的环境垫乐：Am–F–Dm–G 四个和弦缓慢交替，
每个章节切换点落一枚钟声，底下铺一层极轻的滤波噪声。纯正弦/三角波，没有采样素材，体积 10MB（44.1kHz 立体声 WAV）。

播放器里点 `♪` 或按 `M` 开关；成片里已经混好。
