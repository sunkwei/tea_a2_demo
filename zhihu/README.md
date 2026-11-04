# 📚 知乎抓取 / 阅读 / 发回答 / 让 LLM 写一篇

一个自用的命令行工具：知乎登录态 → 内容抓取 → LLM 摘要 → markdown digest，
外加一条「读最近看过的 → 让模型写一篇新的」的路子。

- 🧾 **抓的是正文，不是标题**：回答/文章正文会转成纯文本再进模型（收藏夹里只有摘要，
  会另外去取全文）。
- 🧠 **LLM 出结构化 JSON**：`summary` / `key_points` / `quotes` / `topics` / `category`；
  `digest --overview` 还会再问一次，做一份跨内容综述。
- ✍️ **写操作默认是 dry-run**：`post` 只打印要发的东西，`--yes` 才真投递。

> 它和 [`../bilibili`](../bilibili) 是同一套结构。LLM 那一层在
> [`../shared/llm.py`](../shared/llm.py)，登录入口在
> [`../shared/browser_login.py`](../shared/browser_login.py)。

---

## 快速开始

```bash
# 依赖：requests（只有抓取和发版需要；--login 只要标准库）
pip install requests

cd zhihu

python zhihu.py --login                       # 登录：开有头浏览器登录并存 storageState
python zhihu.py whoami                        # 账号信息 + 登录态有效期
python zhihu.py hot --limit 20                # 热榜
python zhihu.py search "大模型" --limit 10    # 搜索（综合/内容/用户）
python zhihu.py collections                   # 我的收藏夹
python zhihu.py collection 737068447          # 某个收藏夹里的东西
python zhihu.py moments                       # 自己的动态
python zhihu.py invited                       # 等你来答
```

抓取 → 摘要 → digest：

```bash
python zhihu.py fetch --collection 737068447  # 抓语料（可重复 --query / --question / --answer / --article / --collection）
python zhihu.py summarize                     # LLM 结构化摘要
python zhihu.py digest --overview             # markdown digest（--out 写文件）
python zhihu.py all --collection 737068447    # 一条龙
```

发东西（**默认只打印，不真发**）：

```bash
python zhihu.py post answer --file body.md --question <问题 id>   # 发回答
python zhihu.py post article --file body.md --title "标题"        # 发专栏文章
python zhihu.py post llm --count 10                              # 读最近看过的 10 篇 → 让 LLM 写一篇新的
python zhihu.py rm --answer <id>                                 # 删掉自己发的
```

### post llm：让模型写一篇新的

知乎**没有浏览历史接口了**（`/api/v4/history` 404，网页 `/history` 也是 404 页面），
所以「最近读过的」从**收藏夹**（按收藏时间）和**本地语料**（`fetch` 抓过的）两处凑，
去重后按时间倒序取前 N 篇。

```bash
python zhihu.py post llm                    # 读 10 篇 → 分析 → 写一篇 → 只显示
python zhihu.py post llm --count 6 --out /tmp/a.md
python zhihu.py post llm --yes              # 真投递到知乎专栏
```

- 模型被问两次：一次**分析**这些文章（母题 / 角度 / 可用素材 / 语气），一次**创作**（标题 + 正文）。
- 正文是 markdown 纯文本（空行分段），转成知乎编辑器要的 HTML 后发出去；
  文稿也会写到 `~/.tea_agent/zhihu/draft.md`。
- 风格是**中文硬科幻的通用手法**（宏大尺度 + 危机 + 硬核细节 + 冷峻抒情），
  prompt 里**不冒充任何具体作家的身份**。

---

## 数据落在哪

| 东西 | 位置 | 环境变量 |
|---|---|---|
| 语料 | `~/.tea_agent/zhihu/corpus.json` | `ZHIHU_HOME` 改根目录 |
| 摘要 | `~/.tea_agent/zhihu/summaries.json` | 同上 |
| digest / 文稿 | `~/.tea_agent/zhihu/digest.md`、`draft.md` | 同上 |
| 登录态 | `~/.tea_agent/zhihu_state.json` / `~/Documents/pw_zhihu.json` | `ZHIHU_STATE` |
| provider 配置 | `~/.tea_agent/provider.yaml`（**和 tea_a2 共用一份**） | — |

---

## 登录（`--login`）

开一个**有头浏览器**停在知乎登录页，你登录完**把窗口关掉**就行，storageState 会被写下来
（`z_c0` cookie 在不在 = 成功判据）。没有图形界面时自动退回无头 + 截二维码（`--headless` 强制）。

需要 Node.js 和 `playwright-core`（Windows 上第一次会自动装到 `%LOCALAPPDATA%\Temp\tea_playwright`）。

---

## 接口现状（2026-10 实测，别照着老博客改）

**能用**（带 cookie 就行，不需要签名）：

| 接口 | 干什么 |
|---|---|
| `GET /api/v4/me` | 账号信息 |
| `GET /api/v4/search_v3` | 搜索（general / content / people） |
| `GET /api/v4/answers/{id}` | 回答正文 |
| `GET /api/v4/questions/{id}/answers` | 某问题下的回答列表 |
| `GET /api/v4/people/{token}/collections` | 收藏夹列表 |
| `GET /api/v4/collections/{id}/items` | 收藏夹内容 |
| `GET /api/v3/moments/{token}/activities` | 自己的动态 |
| `GET api.zhihu.com/topstory/hot-lists/total` | 热榜 |
| `GET zhuanlan.zhihu.com/api/articles/{id}` | 专栏文章正文（老接口，还在） |

**不能用**（知乎上了 zse-ck 签名 / 风控）：`GET /api/v4/questions/{id}`（403 请求参数异常）、
`GET www.zhihu.com/question/{id}`（403 风控页，连浏览器都拦）。

**写操作**（抓包确认的流程）：

- 发回答：`POST /api/v4/read_history/add` → `POST /api/v4/questions/{qid}/draft`
  → `POST /api/v4/content/publish`（`action=answer`）。
  直接 `POST /api/v4/questions/{qid}/answers` 已经废了（422）。
- 发专栏文章：`POST zhuanlan.zhihu.com/api/articles/drafts` 建草稿（**草稿在 zhuanlan 域**）
  → `POST www.zhihu.com/api/v4/content/publish`（`action=article`，正文在 `data.hybrid.html`，
  标题在 `data.title.title`，草稿 id 在 `data.draft.id`）。

**时间戳有两种**：有时是 epoch（`1790003655`），有时是 ISO 字符串
（`2026-09-21T23:14:15+08:00`）——两种都得认，不然一条坏时间戳就能把整个来源炸掉。

---

## 测试

```bash
python zhihu/tests/test_zhihu_llm_post.py     # 22 项离线断言
```

覆盖的是「post llm」这条最长的链路：收藏夹 + 语料凑出「最近读过的」（去重、按时间倒序、
取全文）、模型被问两次、发布 payload 的每个字段，以及**不加 `--yes` 绝不发布**。
网络和模型都是假的，跑起来不碰外网。
