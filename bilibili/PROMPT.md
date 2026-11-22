# 🧾 用户输入（原始需求）

> 本项目由 [tea_a2](https://github.com/sunkwei/tea_a2) 生成。下面是把它做出来、以及后来改动它的**用户输入原文**，
> 按时间顺序摘自本工作区的会话记录（`.tea_agent_run/sessions/`）。
> 已剔除「继续」「嗯」「提交,推送」这类没有信息量的指令、纯夸奖和工具回填的系统消息，
> 保留的句子未改动措辞。全仓库的收录情况见 [`docs/PROMPTS.md`](../docs/PROMPTS.md)。

项目目录：`bilibili/` · 收录 **13** 条输入 · 来自 **3** 个会话

---

## 2026-11-08 · bilibili 应用, --login 时应该

<sub>会话 `s_4be2e2dc8392`</sub>

1. **02:04** bilibili 应用,--login 时应该在本地创建目录,而不是 /mnt/c ...
2. **02:11** $ python bilibili/bili.py --login
   [login] node: /usr/bin/node
   [login] 目标: /home/sunkw/.tea_agent/bili_state.json
   [login] 在弹出的浏览器里登录，登录完把窗口关掉就行。
   [login:bili] 浏览器: (让 playwright 自己找)
   [login:bili] 登录页: https://passport.bilibili.com/login
   [login] 有头模式起不来（多半是没有图形界面 / DISPLAY 没设），退回无头 + 扫码。
   [login] browserType.launch: Executable doesn't exist at /home/sunkw/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome ╔════════════════════════════════════════════════════════════╗ ║ Looks like …
   …（粘贴内容后略，原 28 行）


---

## 2026-11-08 · 使用 bilibili 去 https://ww

<sub>会话 `s_12c90b9dcdbd`</sub>

1. **02:14** 使用 bilibili 去 https://www.bilibili.com 看看有哪些值得收藏的视频
2. **02:28** 挑出10条值得观看的视频加入"稍后观看"列表
3. **02:44** 以后每次跑,都需要 --login 么?
4. **02:53** 看看 BV1Qkxc6XEwm 视频,支持观看视频内容么?
5. **03:06** 最多只能4张图,是不是容易丢弃太多内容了?
6. **03:07** 是不是应该本地部署一个图像理解模型才行?
7. **03:11** 这台老机器跑不了本地识图模型;asr 模型可以,考虑使用 sensevoice small 模型实现
8. **04:00** 使用 asr 功能时,如果没有模型(sensevoice small),就去下载

---

## 2026-11-22 · 使用bilibili 工具分析视频 https:

<sub>会话 `s_47518565dac6`</sub>

1. **02:14** 使用bilibili 工具分析视频 https://www.bilibili.com/video/BV17C4P6CE5f
2. **02:37** 总结一份评价,感谢 up 指出更深刻的思考结论
3. **02:39** 发表短篇

---

<sub>想补充更早的输入？把原文追加到本文件，或改 `tools/collect-prompts.mjs` 后重跑 `npm run prompts:build`。</sub>
