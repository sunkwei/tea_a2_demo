# 📺 B 站观看历史 → 字幕 → LLM 摘要 → markdown digest

一个自用的命令行工具：把 **B 站观看历史** 拉下来，抓每个视频的**字幕**，交给 LLM 出一份
结构化摘要，最后拼成一份「我最近在看什么」的 markdown 周报。

- 🧾 **字幕认准视频**：B 站的 `x/player/v2` 会**随机串台**（把别的视频的字幕轨一起返回）。
  这里用权威轨道列表 + 字幕 URL 里的 `aid/cid` 双重校验，**宁可没有字幕，也不要错的**。
- 🧠 **LLM 出结构化 JSON**：`summary` / `key_points` / `quotes` / `topics` / `category`，
  下游（推送、网页）可以直接消费；`digest --overview` 还会再问模型一次，做一份跨视频综述。
- 🔒 **不用浏览器抓数据**：B 站这些接口都是「纯 HTTP + cookie」，登录态从一个 Playwright
  `storageState` 文件里读（cookie 是明文，跨系统通用）。

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
```

`digest --out digest.md` 可以把结果写到文件。

### 登录（`--login`）

`--login` 会开一个**有头浏览器**停在 B 站登录页，你登录完**把窗口关掉**就行，
storageState 会被写到工具读的那个文件（`SESSDATA` cookie 在不在 = 成功判据）。

- 没有图形界面时自动退回**无头 + 截二维码**（`--headless` 可强制）；
- 登录态文件按这个顺序找：`$BILI_STATE` → `~/.tea_agent/bili_state.json` →
  `~/Documents/pw_bilibili.json`（Windows 默认写这里）；
- 需要 Node.js 和 `playwright-core`（Windows 上第一次会自动装到 `%LOCALAPPDATA%\Temp\tea_playwright`）。

### 筛选：只看「看得认真」的

`fetch` 默认只收**看得过半**、或者**绝对时长 ≥ 120 秒**的视频：

```bash
python bili.py fetch --pages 3 --limit 30 --min-ratio 0.6 --min-seconds 180
```

已经抓过的视频不会重抓字幕（`--refresh` 强制重来）。

---

## 数据落在哪

| 东西 | 位置 | 环境变量 |
|---|---|---|
| 语料（字幕 + 元信息） | `~/.tea_agent/bili/corpus.json` | `BILI_HOME` 改根目录 |
| 摘要 | `~/.tea_agent/bili/summaries.json` | 同上 |
| digest | `~/.tea_agent/bili/digest.md` | 同上 |
| 登录态 | `~/.tea_agent/bili_state.json` / `~/Documents/pw_bilibili.json` | `BILI_STATE` |
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
