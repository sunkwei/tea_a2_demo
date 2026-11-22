# 🧾 用户输入归档（PROMPT）

本仓库里**本机创建**的项目，都是 tea_a2 按用户一段段输入做出来的；
每个项目目录下的 **`PROMPT.md`** 存着它自己那份输入，不放在别处、也不靠回忆。

有几种情况要分清：

- **本机创建 + 有留档**：创建与后续改动的输入都在，`PROMPT.md` 是完整的；
- **本机创建 + 会话已清理**：项目确实是在这台机器上做的，但当时的会话记录被轮转掉了，只能补录；
- **外部引入**：项目不是在本机创建的（随某次提交搬进仓库），**本机根本没有「创建它的提示词」**；
  这类项目不承诺有 `PROMPT.md`，即便有，也只记搬进来之后在本机的改动。

> 生成方式：`npm run prompts:build`（[`tools/collect-prompts.mjs`](../tools/collect-prompts.mjs)），从 `.tea_agent_run/sessions/` 的会话记录里抽取、过滤、按项目归档。

## 收录情况

| 项目 | 目录 | 来源 | 输入归档 | 条数 | 会话 |
|------|------|------|---------|-----:|-----:|
| 📺 B 站 digest | `bilibili/` | 外部引入 | [`bilibili/PROMPT.md`](../bilibili/PROMPT.md) | 13 | 3 |
| 📚 知乎 digest | `zhihu/` | 外部引入 | — | 0 | 0 |
| 🦊 tea_a2 划词助手 | `tea-select/` | 本机创建 | [`tea-select/PROMPT.md`](../tea-select/PROMPT.md) | 2 | 1 |
| 🏺 中国陶器史 | `pottery/` | 本机创建 | [`pottery/PROMPT.md`](../pottery/PROMPT.md) | 4 | 1 |
| 🐱 喵屋便利店 | `meow-mart/` | 外部引入 | [`meow-mart/PROMPT.md`](../meow-mart/PROMPT.md) | 1 | 1 |
| 🌿 中药大全 | `tcm-herb/` | 本机创建 | — | 0 | 0 |
| 📌 便笺 | `sticky-notes/` | 本机创建 | — | 0 | 0 |
| 🐍 贪吃蛇竞赛 | `snake-race/` | 外部引入 | — | 0 | 0 |
| 🎬 Self-Attention 短片 | `attention-film/` | 外部引入 | — | 0 | 0 |
| 📺 IPTV 剧场 | `iptv-player/` | 外部引入 | — | 0 | 0 |
| 🧊 三阶魔方教程 | `rubiks-cube/` | 本机创建 | — | 0 | 0 |
| 🚀 终末地 · 舰桥观测舱 | `endfield-ship/` | 本机创建 | — | 0 | 0 |
| 🏘️ AI 小镇 | `ai-town/` | 本机创建 | — | 0 | 0 |
| ⚔️ AI 三国杀 | `sanguosha-ai/` | 本机创建 | — | 0 | 0 |
| 📼 本地视频分析 | `video_analysis/` | 本机创建 | — | 0 | 0 |
| 🎮 GoDot · 三国肉鸽 | `GoDot/` | 外部引入 | — | 0 | 0 |
| 🏗️ 青岛栈桥建模 | `zhanqiao/` | 本机创建 | — | 0 | 0 |

## 外部引入的项目（本机没有创建提示词）

这些项目随早期提交搬进仓库，创建过程不在这台机器上，下面标了它首次入库的提交：

- 📺 B 站 digest（`bilibili/`） —— 2026-11-04 `feat(bili/zhihu): …搬进这个仓库`
- 📚 知乎 digest（`zhihu/`） —— 2026-11-04 `feat(bili/zhihu): …搬进这个仓库`
- 🐱 喵屋便利店（`meow-mart/`） —— 2026-11-02 `feat: 提交 demo 全部代码`（随首批 `src/` 入库）
- 🐍 贪吃蛇竞赛（`snake-race/`） —— 2026-11-02 `feat: 提交 demo 全部代码`
- 🎬 Self-Attention 短片（`attention-film/`） —— 2026-11-02 `feat: 提交 demo 全部代码`
- 📺 IPTV 剧场（`iptv-player/`） —— 2026-11-02 `feat: 提交 demo 全部代码`
- 🎮 GoDot · 三国肉鸽（`GoDot/`） —— 2026-11-02 `feat: 提交 demo 全部代码`

其中 `bilibili/`、`meow-mart/` 在本机做过改动，所以有 `PROMPT.md`，但文件开头写明了「只含搬进来之后的改动」——别把它当成原始需求。

## 本机创建、但会话已清理的项目

这些项目确实是在这台机器上做出来的，但 `.tea_agent_run/sessions/` 只留了本工作区的一部分会话
（2026-11-08 起的几次；另有项目是在别的 workspace 里做的，记录不在这个目录），所以现在抽不到输入：

- 🌿 中药大全（`tcm-herb/`） —— 2026-11-21 `feat(tcm-herb): 新增「中药大全」`
- 📌 便笺（`sticky-notes/`） —— 2026-11-03 `feat(sticky-notes)`
- 🧊 三阶魔方教程（`rubiks-cube/`） —— 2026-11-06 `feat(rubiks-cube)`
- 🚀 终末地 · 舰桥观测舱（`endfield-ship/`） —— 2026-11-17 `feat(endfield-ship)`
- 🏘️ AI 小镇（`ai-town/`） —— 2026-11-03 `feat(ai-town)`
- ⚔️ AI 三国杀（`sanguosha-ai/`） —— 2026-11-05 `feat(sanguosha-ai)`
- 📼 本地视频分析（`video_analysis/`） —— 2026-11-08 `feat(video-analysis)`
- 🏗️ 青岛栈桥建模（`zhanqiao/`） —— 2026-11-04 `feat(zhanqiao)`

补录办法：把当时的输入原文写进 `<项目>/PROMPT.md`（格式照抄已有文件），或补进 `tools/collect-prompts.mjs` 的解析逻辑后重跑。

## 仓库级输入

讲整个 a2_demo（目录结构、README、索引页）而不是某个子项目的输入，记在这里：

1. 2026-11-22 — 对于 a2_demo,应该把每个子项目的"用户输入" 作为项目的一部分,去掉"继续" 等无效输入
2. 2026-11-22 — 注意,有些子项目不是本机创建的,所有有可能无法从历史提取"提示词",仅仅处理本机创建的项目

## 过滤规则（哪些输入不算数）

- **纯确认 / 纯提交指令**：`继续`、`嗯`、`好的`、`可以`、`提交,推送`、`提交 推送`、`合并` —— 对整个分句直接丢弃；
  一句话里混着有效内容时按分句剔除，例如 `不错, 提交, 推送` 整条丢掉，`将 xxx.zip 加入 git, 提交, 推送` 只留前半句。
- **纯夸奖**：`不错`、`很好`、`完美` 之类，没有可执行信息。
- **工具回填的系统消息**：`Images loaded by toolkit_load_image …`、`[shell: …]` 这类不是用户说的话。
- **无归属的闲聊 / 一次性问答**：例如「这张图里写的是什么？只回答图片里的文字」——既没提项目也没提仓库。
- **超长粘贴**：用户贴的日志只留前 8 行，其余标「后略」，避免把整段报错塞进项目文档。

一句话同时提到项目和仓库时，归到它**具体动到的项目**（例如「将 喵屋便利店 移到子目录，重排 README」落在 `meow-mart/PROMPT.md`）；
没提任何项目名、但接着同一会话往下说的（例如「图片点击放大有问题」），按上下文归到当前项目。

统计：扫描 8 个会话、54 条用户消息，收录 22 条，丢弃 32 条。
