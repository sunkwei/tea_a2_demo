# 🧾 用户输入归档（PROMPT）

本仓库的每个项目都是 tea_a2 按用户一段段输入长出来的。这一页是「原始输入」的总索引：
每个项目目录下的 **`PROMPT.md`** 存着它自己那份输入，不放在别处、也不靠回忆。

> 生成方式：`npm run prompts:build`（[`tools/collect-prompts.mjs`](../tools/collect-prompts.mjs)），从 `.tea_agent_run/sessions/` 的会话记录里抽取、过滤、按项目归档。

## 收录情况

| 项目 | 目录 | 输入归档 | 条数 | 会话 |
|------|------|---------|-----:|-----:|
| 📺 B 站 digest | `bilibili/` | [`bilibili/PROMPT.md`](../bilibili/PROMPT.md) | 13 | 3 |
| 📚 知乎 digest | `zhihu/` | — | 0 | 0 |
| 🦊 tea_a2 划词助手 | `tea-select/` | [`tea-select/PROMPT.md`](../tea-select/PROMPT.md) | 2 | 1 |
| 🏺 中国陶器史 | `pottery/` | [`pottery/PROMPT.md`](../pottery/PROMPT.md) | 4 | 1 |
| 🐱 喵屋便利店 | `meow-mart/` | [`meow-mart/PROMPT.md`](../meow-mart/PROMPT.md) | 1 | 1 |
| 🌿 中药大全 | `tcm-herb/` | — | 0 | 0 |
| 📌 便笺 | `sticky-notes/` | — | 0 | 0 |
| 🐍 贪吃蛇竞赛 | `snake-race/` | — | 0 | 0 |
| 🎬 Self-Attention 短片 | `attention-film/` | — | 0 | 0 |
| 📺 IPTV 剧场 | `iptv-player/` | — | 0 | 0 |
| 🧊 三阶魔方教程 | `rubiks-cube/` | — | 0 | 0 |
| 🚀 终末地 · 舰桥观测舱 | `endfield-ship/` | — | 0 | 0 |
| 🏘️ AI 小镇 | `ai-town/` | — | 0 | 0 |
| ⚔️ AI 三国杀 | `sanguosha-ai/` | — | 0 | 0 |
| 📼 本地视频分析 | `video_analysis/` | — | 0 | 0 |
| 🎮 GoDot · 三国肉鸽 | `GoDot/` | — | 0 | 0 |
| 🏗️ 青岛栈桥建模 | `zhanqiao/` | — | 0 | 0 |

## 为什么有些项目没有 PROMPT.md

本工作区的会话记录（`.tea_agent_run/sessions/`）从 **2026-11-08** 才开始留存，更早的会话已随工作区轮转清理。
因此 2026-11-02 / 11-03 建的那批项目（贪吃蛇、便笺、魔方、IPTV、终末地舰桥、AI 小镇、三国杀、中药大全、栈桥、Godot…）
**原始输入没有本地留档**，现在只能从 git 提交信息里看出做了什么，看不出当时是怎么说的。

补录办法：把当时的输入原文写进 `<项目>/PROMPT.md`（格式照抄已有文件），或补进 `tools/collect-prompts.mjs` 的解析逻辑后重跑。
没留档的项目清单：`zhihu/`、`tcm-herb/`、`sticky-notes/`、`snake-race/`、`attention-film/`、`iptv-player/`、`rubiks-cube/`、`endfield-ship/`、`ai-town/`、`sanguosha-ai/`、`video_analysis/`、`GoDot/`、`zhanqiao/`

## 仓库级输入

讲整个 a2_demo（目录结构、README、索引页）而不是某个子项目的输入，记在这里：

1. 2026-11-22 — 对于 a2_demo,应该把每个子项目的"用户输入" 作为项目的一部分,去掉"继续" 等无效输入

## 过滤规则（哪些输入不算数）

- **纯确认 / 纯提交指令**：`继续`、`嗯`、`好的`、`可以`、`提交,推送`、`提交 推送`、`合并` —— 对整个分句直接丢弃；
  一句话里混着有效内容时按分句剔除，例如 `不错, 提交, 推送` 整条丢掉，`将 xxx.zip 加入 git, 提交, 推送` 只留前半句。
- **纯夸奖**：`不错`、`很好`、`完美` 之类，没有可执行信息。
- **工具回填的系统消息**：`Images loaded by toolkit_load_image …`、`[shell: …]` 这类不是用户说的话。
- **无归属的闲聊 / 一次性问答**：例如「这张图里写的是什么？只回答图片里的文字」——既没提项目也没提仓库。
- **超长粘贴**：用户贴的日志只留前 8 行，其余标「后略」，避免把整段报错塞进项目文档。

一句话同时提到项目和仓库时，归到它**具体动到的项目**（例如「将 喵屋便利店 移到子目录，重排 README」落在 `meow-mart/PROMPT.md`）；
没提任何项目名、但接着同一会话往下说的（例如「图片点击放大有问题」），按上下文归到当前项目。

统计：扫描 8 个会话、53 条用户消息，收录 21 条，丢弃 32 条。
