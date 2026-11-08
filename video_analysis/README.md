# video_analysis —— 本地视频分析工具

输入一个**本地视频文件**，自动完成：**抽帧拼图 → 视觉模型理解画面** ＋ **本地 ASR 转写语音** → 一起喂给 LLM → 输出一份完整的分析报告。

和 `bilibili/bili.py watch` 是同一条链路（画面 + 语音 → LLM 总结），区别是输入不是 B 站 bv 号，而是本地文件。

```
                  ┌─ ffmpeg 抽帧 ─ 3×3 拼图（每格烧时间戳）─┐
本地视频 ─────────┤                                        ├─→ 视觉模型 → 画面描述 ─┐
                  └─ ffmpeg 提音轨 ─ 16k 单声道 wav ──────┴─→ SenseVoice(本地) → 逐字稿 ─┴─→ 文本 LLM → 分析报告
```

## 快速开始

```bash
# 给个文件名就行（在 cwd、~/Videos、~/Downloads、~/Desktop… 里找）
python3 video_analysis/video_analysis.py "一次讲清楚中国10种茶叶.mp4"

# 也可以给完整路径
python3 video_analysis/video_analysis.py ~/Videos/xxx.mp4 --out ~/Desktop/xxx分析.md

# 看看能搜到哪些视频
python3 video_analysis/video_analysis.py --list
```

跑完会在终端打印分析正文，同时把报告写到
`~/.tea_agent/video_analysis/<视频名>_<路径哈希>.md`。

## 常用参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `--interval N` | 15 | 每多少秒抽一帧（会自动凑满整张拼图，见下） |
| `--cols/--rows` | 3/3 | 拼图布局，一格 3×3 = 9 帧/图 |
| `--cell-width N` | 480 | 拼图里每格多宽（像素） |
| `--max-sheets N` | 12 | 最多几张拼图；视频长时抽帧间隔会自动放大 |
| `--no-tile` | — | 不拼图，一张一张抽（看细节用） |
| `--no-frames` / `--no-asr` | — | 只用语音 / 只用画面 |
| `--vision-provider/--vision-model` | 自动 | 识图用哪个模型（默认挑 `provider.yaml` 里第一个 `supports_vision: true` 的） |
| `--vision-backend tea` | — | 识图改走 tea_a2 自己的 API（一条消息最多 4 张图） |
| `--provider/--model` | 默认 | 做分析��文本模型 |
| `--merge-only` | — | **只重跑 LLM 分析**，复用已抽帧/识图/转写的结果（改提示词时用） |
| `--out / --json` | — | 报告写哪 / 额外导出 JSON（素材 + 分析） |
| `--print-report` | — | 把完整报告打到终端 |

## 输出长什么样

一份 markdown，结构固定：

```
# <视频名> —— 本地视频分析
> 文件 / 时长 / 分辨率 / 编码 / 大小

## 分析            ← LLM 写的正文
   1. 一句话概括
   2. 内容主线（带时间点的表格）
   3. 关键概念与关键信息
   4. 值得注意的点
   5. 评价（站得住的地方 / 需要打补丁或存疑的地方）
   6. 结论
## 语音转写全文     ← 本地 ASR 的逐字稿
## 画面描述         ← 视觉模型逐张拼图的描述
```

## 依赖

| 东西 | 干什么 | 没有会怎样 |
|---|---|---|
| `ffmpeg` / `ffprobe` | 抽帧、拼图、提音轨、读元信息 | **必需**，没有直接报错 |
| `sherpa-onnx` + SenseVoice 模型 | 本地 ASR（离线） | 自动安装/下载；也可以 `--no-asr` 跳过 |
| `~/.tea_agent/provider.yaml` 里的 provider | 识图 + 分析 | 必需（和 tea_a2 共用一份） |

```bash
pip3 install requests pyyaml numpy
pip3 install --user --break-system-packages sherpa-onnx   # ASR 运行时
```

SenseVoice 模型（约 158MB）会自动下到 `~/models/sherpa-onnx/`；
离线环境设 `ASR_NO_DOWNLOAD=1` 可以禁止自动下载。

## 几个实现上的坑（改代码前先看）

1. **拼图不许出现黑格**。`tile` 滤镜永远输出满格，帧不够就用黑色补，
   视觉模型会把黑格当画面内容瞎猜。所以抽帧间隔是算出来的（`plan_sampling()`），
   保证帧数正好铺满所有拼图。要改抽帧逻辑先跑 `tools/test_sampling.py`。
2. **`fps=1/N` 会保留原始 PTS**，所以 `drawtext=text='%{pts\:hms}'` 烧出来的是
   原视频时间（不是抽帧后的序号）。但这条在 **cmd 里传会被 `%` 吃掉**——
   必须用 `subprocess` 传 argv（代码里已经这么做了），别在 cmd 里手拼。
3. **Windows 字体路径里的冒号要转义**：`C\:/Windows/Fonts/msyh.ttc`。
   字体候选见 `FONT_CANDIDATES`（雅黑/黑体/DejaVu/苹方）。
4. **推理模型（MiniMax-M3.1-Flash 这类）会把思考 token 也算进 `max_tokens`**：
   - 识图：不给够预算会返回**空正文**（`finish_reason=length`），画面描述整段丢失。
     默认 `--vision-max-tokens 6000`，且一次只送 1 张图。
   - 分析：正文写到一半被截断。`llm_chat_resilient(..., expect="结论")` 会检出截断，
     自动加倍预算重试，还不行才换 provider。
5. **ASR 有同音错字**（专有名词错得最狠，"抽帧"→"抽针"）。
   分析提示词里已经要求模型按上下文改正并用括号标出原词。
6. **转写缓存**：同一视频再跑会复用 `work/<slug>/transcript.json`
   （靠文件 mtime 判断视频有没有变），改提示词时用 `--merge-only` 最省时间。

## 目录

```
video_analysis/
├── video_analysis.py        # 主程序（单文件，只依赖标准库+requests+pyyaml+numpy）
├── README.md
├── requirements.txt
└── tools/
    ├── make_test_video.py   # 造一个带中文语音的测试视频（Windows SAPI + ffmpeg）
    ├── test_sampling.py     # 抽帧间隔规划的单元检查
    └── probe_vision.py      # 单独试各个 provider 的识图能力
```

ASR 的公共实现放在 `shared/sensevoice.py`（`bilibili/bili.py` 也在用）。

## 中间产物

都在 `~/.tea_agent/video_analysis/work/<视频名>_<哈希>/`：

```
frames/sheet01.jpg   拼图原图（带时间戳）
audio.wav            16k 单声道音频
transcript.json      ASR 结果（可复用）
frames.json          画面描述（可复用）
blob.txt             送进 LLM 的全部素材
```
