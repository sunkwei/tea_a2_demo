# 🧾 用户输入（原始需求）

> 本项目是**这台机器上用 [tea_a2](https://github.com/sunkwei/tea_a2) 从头做出来的**。
> 下面是把它做出来、以及后来改动它的**用户输入原文**，按时间顺序摘自本工作区的会话记录（`.tea_agent_run/sessions/`）。
> 已剔除「继续」「嗯」「提交,推送」这类没有信息量的指令、纯夸奖和工具回填的系统消息，
> 保留的句子未改动措辞。全仓库的收录情况见 [`docs/PROMPTS.md`](../docs/PROMPTS.md)。

项目目录：`video_analysis/` · 来源：本机创建 · 收录 **2** 条输入 · 来自 **1** 个会话

---

## 2026-11-08 · 基于 bilibili 分析视频的功能，做一个分

<sub>会话 `s_b147e34440d9`</sub>

1. **10:28** 视频分析中，调用 llm 时，是通过 tea_a2 的 http 接口访问么？还是 a2_task server ?
2. **10:30** 先这样，我用用看，感觉将来还是改为走 tea_task server 比较合理，但今天不修改了

---

<sub>想补充更早的输入？把原文追加到本文件，或改 `tools/collect-prompts.mjs` 后重跑 `npm run prompts:build`。</sub>
