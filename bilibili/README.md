# 📺 B 站观看历史 → 字幕 → LLM 摘要 → markdown digest

一个自用的命令行工具：把 **B 站观看历史** 拉下来，抓每个视频的**字幕**，交给 LLM 出一份
结构化摘要，最后拼成一份「我最近在看什么」的 markdown 周报。

- 🧾 **字幕认准视频**：B 站的 `x/player/v2` 会**随机串台**（把别的视频的字幕轨一起返回）。
  这里用权威轨道列表 + 字幕 URL 里的 `aid/cid` 双重校验，**宁可没有字幕，也不要错的**。
- 🧠 **LLM 出结构化 JSON**：`summary` / `key_points` / `quotes` / `topics` / `category`，
  下游（推送、网页）可以直接消费；`digest --overview` 还会再问模型一次，做一份跨视频综述。
- 🔒 **不用浏览器抓数据**：B 站这些接口都是「纯 HTTP + cookie」，登录态从一个 Playwright
  `storageState` 文件里读（cookie 是明文，跨系统通用）。
- 🔍 **也能反过来用**：`discover` 主动去 bilibili.com 首页/热门/排行榜捞视频，
  用启发式分粗筛 + LLM 挑出「值得收藏」的若干条；`watchlater` 把选中的视频
  直接塞进「稍后再看」——**不用手点**。

> 它和 [`../zhihu`](../zhihu) 是同一套结构：抓内容 → 送 LLM → 出 digest。
> LLM 那一层在 [`../shared/llm.py`](../shared/llm.py)，登录入口在
> [`../shared/browser_login.py`](../shared/browser_login.py)。

---

## 快速开始

```bash
# 依赖：requests + pyyaml（只有摘要和抓取需要；--login 只要标准库）
pip install requests pyyaml

cd bilibili

python bili.py --login                          # 登录：开有头浏览器登录并存 storageState
python bili.py fetch      --pages 2 --limit 20   # 拉历史 + 字幕，存本地语料
python bili.py summarize  --limit 6              # 调 LLM 生成结构化摘要
python bili.py digest                           # 输出 markdown digest（打印）
python bili.py digest     --overview             # 额外做一次跨视频综述
python bili.py all                              # fetch + summarize + digest 一条龙
python bili.py show                             # 终端里快速看一眼最近几条

python bili.py discover --top 10                # 去 bilibili.com 找值得收藏的视频
python bili.py watch BV1Qkxc6XEwm               # 看一个视频（字幕 + 画面帧 → 总结）
python bili.py watchlater --list                # 看看「稍后再看」里有什么
python bili.py watchlater --add BV1xx BV2xx     # 手动塞几条进「稍后再看」
```

`digest --out digest.md` 可以把结果写到文件。

### 登录（`--login`）

`--login` 会开一个**有头浏览器**停在 B 站登录页，你登录完**把窗口关掉**就行，
storageState 会被写到工具读的那个文件（`SESSDATA` cookie 在不在 = 成功判据）。

- 没有图形界面时自动退回**无头 + 截二维码**（`--headless` 可强制，二维码也存本机）；
- **写一律写本机**：Linux/macOS 写 `~/.tea_agent/bili_state.json`，
  Windows 写 `~/Documents/pw_bilibili.json`；目录没有就现建（权限 700）。
  **不会**往 `/mnt/c/...` 那种「别系统挂载盘」里写——那是 Windows 侧的文件，
  在 Linux 上写它要过 9p/drvfs，又慢又容易失败。
- **读**按这个顺序找：`$BILI_STATE` → `--state` → `~/.tea_agent/bili_state.json` →
  `~/Documents/pw_bilibili.json` → `/mnt/c/Users/Hetin/Documents/pw_bilibili.json`
  （挂载盘那份只当**兜底读**：Windows 上登录过一次、文件放那儿的场景）；
- 想自己挑地方：`python bili.py --login --state /path/to/state.json`；
- 需要 Node.js 和 `playwright-core`（Windows 上第一次会自动装到 `%LOCALAPPDATA%\Temp\tea_playwright`；
  Linux 上 `npm i playwright-core`）。
- **浏览器不用自己指**：脚本会依次找 `CHROME_BIN` → playwright 自己下的 chromium →
  系统装的 google-chrome / chromium / edge（含 `/usr/bin/google-chrome` 这类常见路径和 PATH）。
  还是找不到就照提示二选一：`CHROME_BIN=/usr/bin/google-chrome` 或 `npx playwright install chromium`。

### 筛选：只看「看得认真」的

`fetch` 默认只收**看得过半**、或者**绝对时长 ≥ 120 秒**的视频：

```bash
python bili.py fetch --pages 3 --limit 30 --min-ratio 0.6 --min-seconds 180
python bili.py fetch --asr                          # 没字幕轨的用本地 ASR 顶上
```

**没字幕的视频也能进语料**：`--asr` 会用本地 SenseVoice 转写（标 `asr-sensevoice`），
语料里的行数/时间戳格式和真字幕一样，后面 summarize/digest 一视同仁。

已经抓过的视频不会重抓字幕（`--refresh` 强制重来）。

---

## 找值得收藏的视频（`discover`）

`fetch` 是**回顾**（你看过什么），`discover` 是**前瞻**（还有哪些值得看）：

```bash
python bili.py discover                       # 默认：捞候选 → 粗筛 → LLM 挑 8 条
python bili.py discover --candidates 80 --pool 32 --top 12
python bili.py discover --no-llm              # 不调 LLM，只按启发式分排
python bili.py discover --watch-later         # 挑完直接加进「稍后再看」（需登录）
```

**候选从哪来**（全是 B 站自己的接口，登录了就是你的个性化推荐，没登录就是游客推荐）：

| 来源 | 接口 | 说明 |
|---|---|---|
| 首页推荐 | `x/web-interface/index/top/feed/rcmd` | www.bilibili.com 首屏那条流 |
| 每周必看 | `x/web-interface/popular/series/one` | B 站自己的每周精选，编辑品味 |
| 综合热门 | `x/web-interface/popular` | 全站热榜 |
| 全站排行榜 | `x/web-interface/ranking/v2?rid=0` | 综合排序榜 |
| 知识科技排行 | `ranking/v2?rid=36/188/217` | 知识、科技数码、动物圈——收藏率高的重镇 |

**怎么筛**：每个候选补齐详情（简介、分区、标签、播放/点赞/投币/**收藏**数），
先按启发式分粗排——**收藏率**（收藏÷播放）是核心信号（收藏多 = 想留着以后回看），
再送 LLM 挑 6~10 条并写「为什么值得收藏」。报告写到 `~/.tea_agent/bili/discover.md`，
原始数据在 `discover.json`（含 LLM 原话）。

> 不登录也能跑：脚本会先访问一次首页拿 `buvid`，不然 B 站接口一律 `-352` 风控。

## 本地 ASR：SenseVoice Small

`watch` 有第三种素材来源：**本地语音转写**（不联网、不花钱、CPU 上跑）。

- 模型：**SenseVoice Small**（234M，ONNX int8，158MB 压缩 / 237MB 展开）
- 运行时：**sherpa-onnx**（自带 ONNX runtime，**不依赖 torch**；cp314 有现成 wheel）
- **缺了会自动补**：运行时没装 → 自动 `pip install --user --break-system-packages sherpa-onnx`；
  模型没下 → 自动从 [sherpa-onnx releases](https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models)
  下 `sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.bz2`（158MB）并解压。
  用 ASR 的命令第一次跑会自己把环境铺好，**不用手动装**。
- 想手动装也行：`sh ../.tea_agent_run/scripts/setup-sensevoice.sh`
- 下载带**断点续传 + 重试 + 速度下限**（GitHub release 资源经常「连着不发数据」或 SSL 断流）
  和 tar 完整性校验，坏了会重新下。
- 不想让它联网：`--no-download`（或 `ASR_NO_DOWNLOAD=1`），缺了就直接报错。
- 路径可改：`ASR_BASE=`（默认 `~/models/sherpa-onnx`）、`ASR_MODEL=`（直接指模型目录）、
  `ASR_MODEL_URL=`（换下载源）

```bash
python bili.py asr BV1Qkxc6XEwm            # 只要转写
python bili.py asr BV1Qkxc6XEwm --chunk 0  # 整段一起送（不切块）
python bili.py watch BV1Qkxc6XEwm --asr always   # 有字幕也跑一遍（互相印证）
```

**实测**：267 秒音频，切成 60 秒块识别耗时 **47~66 秒**（≈4 倍实时，4 线程 CPU）；
切块比整段送还快一点。多语言（zh/en/ja/ko/yue），还带情感/事件标签。

**为什么值得**：B 站很多视频**没有字幕轨**（你最近看的一半就有），
画面再准也只能猜个大概，语音是逐字稿。配合最后那步 LLM 合并，
ASR 的同音错字（偷啃→Token、鬼真草→鬼针草、香春→香椿）会被按上下文改正。

---

## 看一个视频（`watch`）

`fetch` 抓的是**看过的**视频的字幕；`watch` 是**当场看**一个视频，走两条通道：

```bash
python bili.py watch BV1Qkxc6XEwm                       # 字幕 + 画面 → 总结
python bili.py watch BV1Qkxc6XEwm --interval 10         # 抽帧密一点（每 10 秒一帧）
python bili.py watch BV1Qkxc6XEwm --no-frames           # 只看字幕，不下视频
python bili.py watch BV1Qkxc6XEwm --qn 80              # 要 1080P（默认 720P）
python bili.py watch BV1Qkxc6XEwm --no-llm             # 不合并总结，只给原始素材
```

| 通道 | 怎么来的 | 拿到什么 |
|---|---|---|
| **字幕** | `x/player/v2`（认准轨道，不串台） | 作者说的话（人写的 / AI 识别 / 翻译） |
| **语音** | 本地 SenseVoice Small（没字幕时顶上） | 逐字稿（带时间戳） |
| **画面** | `x/player/playurl` 下 MP4 → `ffmpeg` 抽帧拼图 → 视觉模型 | 人物、场景、**画面上的文字**、演示步骤 |

- 视觉模型走 **tea_a2 的 `POST /api/chat`**（`--tea-api` 默认 `http://127.0.0.1:8383`）——
  这是 tea_a2 里唯一吃图片的入口（`/api/llm/chat` 的 content 只收字符串）。
- **一条消息最多 4 张图**，所以帧先拼成 **3×3 大图**（每格烧了时间戳）：
  一张图管 9 帧，一条消息 4 张就是 36 帧；每批还会把上一批的描述带进提示词，叙事不断。
  想调：`--tile-cols/--tile-rows`（默认 3×3）、`--sheet-width`（默认 512）、
  `--interval`（默认 10 秒一帧）、`--vision-per-call`（默认 3 张）。
- B 站的 CDN 要带 `Referer: https://www.bilibili.com/`，否则 403。
- 报告写到 `~/.tea_agent/bili/watch_<bvid>.md`（总结 + 字幕全文 + 转写 + 画面描述）。
- 改提示词/换模型重跑总结，用 `--merge-only`：复用已下好的视频/识图/转写，
  不用再等一遍识别。

## 「稍后再看」（`watchlater`）

```bash
python bili.py watchlater --list                    # 列出现有的（最新在前）
python bili.py watchlater --add BV1REx46NEc4 BV...  # 加进去
python bili.py discover --watch-later               # 挑完顺手加进去
```

- 网页端点「添加至稍后再看」走的是 `POST /x/v2/history/toview/add`（`aid` + `csrf`），
  **不是**收藏夹那套 `x/v3/fav/...`——这是抓网页真实点击抓出来的。
- 读列表用 `GET /x/v2/history/toview?type=add`。
- 要登录态（`--login`），`bili_jct`（csrf）在 cookie 里。

---

## 数据落在哪

| 东西 | 位置 | 环境变量 |
|---|---|---|
| 语料（字幕 + 元信息） | `~/.tea_agent/bili/corpus.json` | `BILI_HOME` 改根目录 |
| 摘要 | `~/.tea_agent/bili/summaries.json` | 同上 |
| digest | `~/.tea_agent/bili/digest.md` | 同上 |
| discover 报告 | `~/.tea_agent/bili/discover.md` | 同上 |
| discover 原始数据 | `~/.tea_agent/bili/discover.json` | 同上 |
| watch 报告 | `~/.tea_agent/bili/watch_<bvid>.md` | 同上 |
| asr 转写 | `~/.tea_agent/bili/asr_<bvid>.md` | 同上 |
| watch 视频/帧/blob 缓存 | `~/.tea_agent/bili/watch/` | 同上 |
| 登录态 | `~/.tea_agent/bili_state.json`（本机写入）/ `~/Documents/pw_bilibili.json`（Windows） | `BILI_STATE` / `--state` |
| provider 配置 | `~/.tea_agent/provider.yaml`（**和 tea_a2 共用一份**） | — |

`provider.yaml` 里**第一个 provider 就是默认的**；`models` 是字典时取第一个键当默认模型。
也可以命令行指定：`--provider minimax --model MiniMax-M3.1-Flash`。

---

## 坑（都是实测踩出来的）

- **字幕会串台**：`x/player/v2` 有时返回别的视频的轨（同样 `lan='ai-zh'`，内容却是另一个视频）。
  校验办法有两个，两个都用：① `x/web-interface/view` 的 `subtitle.list` 是权威轨道列表；
  ② 正确的字幕 URL 形如 `/bfs/ai_subtitle/prod/{aid}{cid}{hash}`，里面连着 aid 和 cid。
  两条都不满足的轨一律丢掉。
- **view 的轨道 id 偶尔少最后一位**（`208297600337016268` 对上 `2082976003370162688`），
  所以比对时**前缀相同也算**。
- **`player/v2` 命中率只有一半左右**，所以要多次重试（默认最多 24 次）。
- **模型的思考 token 会把正文吃光**：有些模型（deepseek-flash 这种）把预算先花在思考上，
  正文就空了。**思考过程不是答案**——空回复会被当成失败重试，而不是直接返回给用户。
- **输出被截断时，严格 JSON 解析会「假成功」**：模型话说到一半被 `max_tokens` 砍掉，
  `json.loads` 会失败，而只找「第一个能解析的完整 JSON 对象」的解析器会返回
  **内层**那个对象（比如 picks 列表里的第一条），看着像成功，其实是错的。
  `shared/llm.py` 里的 `extract_json_loose()` 会把缺的引号/括号补回去再解析。
- **游客调接口会被风控**：没登录时先 `GET https://www.bilibili.com/` 拿 `buvid3`，
  否则 `x/web-interface/*` 一律返回 `-352`。
- **视频流要用渐进式 MP4，别用 DASH**：`x/player/playurl` 加 `fnval=1` 返回
  `durl`（一条流里画面+声音都有）；用 DASH（`fnval=16`）时 `dash.video` 里混着
  **纯音频流**，挑到就下到一个只有声音的文件，ffmpeg 抽帧直接报错。
- **别把 cookie 塞进 curl 的命令行**：`curl -H "Cookie: ..."` 一旦出错，
  `CalledProcessError` 会把整个 argv 打印出来——SESSDATA 直接进日志。
  代码里统一走 `curl_download()`：cookie 写临时文件（`curl -b`）+ 失败只报退出码。
- **音频轨的老 CDN 会连断**：`mcdn.bilivideo.cn:8082` 那个域名经常 recv 失败，
  挑音频轨时要优先 `upos-*.bilivideo.com`，而且**多个轨要逐个试**。
- **有些模型会把 token 预算全花在思考上**（`finish_reason=length`、正文为空）：
  deepseek-flash 最典型。合并总结这类长文本用 `mimo-v2.6-pro` 更稳；
  代码里 `llm_chat_resilient()` 会在主 provider 失败时自动换备胎。

---

## 一条龙：分析视频 → 写评论 → 发出去（`tools/bili_post.py`）

`bili.py` 是"抓内容做摘要"；`tools/bili_post.py` 是**另一条路**：把一个 B 站视频
**听完（ASR）+ 看画面（抽帧识图）+ 看弹幕** → 生成分析报告 → 生成**观众视角**的评论
→ 发布 → 回读校验。

```bash
# 生成报告 + 3 个评论候选（不发布，默认就是 dry-run）
python bilibili/tools/bili_post.py BV19uW76YE7B

# 生成并发布（默认发第 1 个候选）
python bilibili/tools/bili_post.py BV19uW76YE7B --yes

# 发第 2 个候选 / 作为某条评论的回复 / 用自己写的正文
python bilibili/tools/bili_post.py BV19uW76YE7B --yes --pick 2
python bilibili/tools/bili_post.py BV19uW76YE7B --yes --reply 323646262448
python bilibili/tools/bili_post.py BV19uW76YE7B --yes --comment-file my.md

# 注入外部事实核查资料（新闻/官方文件摘录），会喂给模型并被优先采信
python bilibili/tools/bili_post.py BV19uW76YE7B --facts notes.md

# 只要语音、不要抽屏（最快的一路）
python bilibili/tools/bili_post.py BV19uW76YE7B --no_video

# 忽略缓存重跑（ASR / 弹幕 / 抽屏 / 报告 / 候选）
python bilibili/tools/bili_post.py BV19uW76YE7B --force
```

### 流程

| 步骤 | 做法 | 产物 |
|---|---|---|
| 元信息 | `x/web-interface/view` | 标题 / UP / 时长 / 数据 / 简介 |
| **语音** | 只下**音频轨**（DASH audio）→ 本地 SenseVoice Small（60 秒切块） | `~/.tea_agent/bili/post/<bv>/asr.md` |
| **画面** | 下渐进式 MP4 → ffmpeg 抽帧拼 3×3 大图（每格烧时间戳）→ 视觉模型逐张描述 | `video.mp4`、`frames/`、`vision.md` |
| **弹幕** | `comment.bilibili.com/{cid}.xml`（一次拿全量）；坏了退回 `x/v2/dm/web/seg.so`（自带极简 protobuf 解码） | `danmaku.txt`（画像）+ `danmaku.json`（原始） |
| 报告 | 逐字稿 + 画面描述 + 弹幕 → LLM，章节固定（一句话概括/核心论点/论证结构/关键事实与数据/**弹幕里的观众反应**/推理特点/可质疑之处/结论） | `bilibili/analysis/<bv>_观点报告.md` |
| 评论 | 3 个不同切入角度的候选（补充型 / 商榷型 / 接弹幕的话），纯文本、600~950 字 | `bilibili/analysis/<bv>_评论候选.md` |
| 发布 | POST `x/v2/reply/add`（`type=1` + `oid=aid` + `csrf=bili_jct`） | — |
| 回读 | `x/v2/reply/main?mode=2&next=0`（**按时间的最新一页**） | `bilibili/analysis/<bv>_已发布评论.md` |

三路素材各有分工：**语音**给论证骨架（但同音错字多，人名几乎全错）；**画面**给硬证据
（图表上的数字、文件标题、地图标注）；**弹幕**给观众共识与纠错。
报告里每个数字都标了来源（"画面文字 / 只有口述 / 查不到"），评论里也会顺手点出
弹幕发现的错（"其实叫谢太宝"）。

### 弹幕能干什么

`tools/danmaku.py` 把弹幕压成一段给模型看的画像：

```bash
python bilibili/tools/danmaku.py BV19uW76YE7B            # 直接看画像
python bilibili/tools/danmaku.py BV19uW76YE7B --json     # 原始列表
```

- **热度分桶**：弹幕在视频哪几段最密（往往就是争议点）；
- **刷屏句**：同一句重复 ≥3 次的（"文明×82"、"懂你意思×53"）——评论别去重复它们；
- **长弹幕**：≥25 字的是观众自己的观点，信息量最大，优先参考；
- **关键词画像**："新加坡×85 离谱×13 空调×7 公务员×6 …"。

### 坑

- **发布回读只能用 `x/v2/reply/main?mode=2&next=0`**：`reply/detail` 已废弃（-400）、
  `reply/up/list` 返回非 JSON、mode=2 的 `next` 是**游标**不是页码（按页码翻会漏掉刚发的）。
- **正文上限 1000 字**（工具自动裁到最后一个完整句）。
- **推理模型会把 `max_tokens` 耗在思考上**，正文写一半被截断（结尾停在"AI怎样"这种半句）。
  工具因此做了：MiniMax 调用带 `reasoning_effort=low` + `reasoning_split=true`、
  评论生成后检查**结尾是否完整**、不完整就加倍预算重试、还不行就裁到最后一个句号。
- **CDN 偶尔第一次请求给空文件**（`bili.download_media` 报"文件是空的"）→ 工具会重试 3 次，
  再不行用 requests 流式下载兜底。
- **缓存按素材失效**：报告/候选缓存记的是 blob 的 md5；这次开抽屏、上次没开，
  blob 变了缓存自动作废（`--force` 可强制重算）。
- **cmd 控制台是 GBK**，工具输出已统一成 UTF-8；长中文正文看 `bilibili/analysis/*_评论候选.md` 最省事。
- 抽屏的两个前提：`tile` 拼图**帧数不够会补黑格**（间隔要按 `plan_sampling()` 算），
  Windows 上字体路径要写成 `C\:/Windows/Fonts/msyh.ttc`（否则**静默不烧时间戳**）。
