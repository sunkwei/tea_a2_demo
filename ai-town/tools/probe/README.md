# 探针脚本

排查 MiniMax 输出格式 / 延迟问题时用的临时脚本，留着以后还能复用。

| 脚本 | 用途 |
|---|---|
| `probe_endpoint.py` | 直接打 MiniMax `/chat/completions`，看原始响应与 usage |
| `probe_npc.py` | 用游戏里的真实提示词调 `complete_json`，打印解析结果与错误 |
| `probe_tokens.py` | 对比不同 `max_tokens` 下的截断表现 |
| `probe_thinking.py` | 试各种"关思考"参数（`thinking.type` / `enable_thinking` / `reasoning_split`） |
| `probe_effort.py` | 对比 `reasoning_effort=low` 对耗时的影响（结论：100s → 6~10s） |
| `probe_prompts.py` | 跑事件 / DM 提示词，单独看解析与 coerce 结果 |
| `probe_raw.py` | 把模型原始输出存成 txt，方便离线看坏 JSON 长什么样 |
| `probe_coerce.py` | 连续两次生成事件，检查 `coerce_events` 抽取是否稳定 |

跑法（在 `ai-town/` 目录下）：

```bash
python tools\probe\probe_effort.py
```
