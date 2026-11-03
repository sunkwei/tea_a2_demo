# 《AI 小镇：无限人生》

> 一个由 LLM 实时生成一切的文字 + 轻可视化模拟经营游戏。
> 你是新上任的镇长；居民、事件、主线、危机全部由 LLM 现场生成，没有两次相同的存档。

![界面预览](docs/preview.png)

```
你输入「我想去井台看看那封没有署名的信」
        ↓
LLM 叙述结果 + 给出 3 个可选分支        ← 叙事素材（文本 + 语义标签）
        ↓
你选择其中一个分支
        ↓
确定性状态机结算资源 / 民心 / 信任     ← 数值由规则系统说了算
        ↓
写进记忆 → 下一次生成会「翻旧账」
```

---

## 一、快速开始

```bash
cd ai-town

python main.py                 # 启动图形界面（Tkinter）
python main.py --offline       # 图形界面但不联网：程序化叙述器照样能玩
python main.py --sim --days 20 # 无头模拟，打印 20 天的流水账
python main.py --selftest      # 跑单元测试（77 项）
python main.py --doctor        # 检查 LLM 连通性
```

> 需要 Python 3.10+（本机实测 3.14.10），Tkinter 随 Python 自带，无需 pip 安装。

## 二、LLM 配置（MiniMax 在线）

本机走 **MiniMax**（OpenAI 兼容端点），配置在 `config.json`：

```json
{
  "backend": "auto",
  "minimax_url": "https://api.minimax.cn/v1",
  "minimax_model": "MiniMax-M3.1-Flash",
  "api_key": "",
  "reasoning_effort": "low"
}
```

`api_key` 留空即可，程序会按这个顺序自动找：

1. 环境变量 `MINIMAX_API_KEY` / `AITOWN_MINIMAX_KEY` / `OPENAI_API_KEY`
2. 项目里的 `config.json`
3. `~/.tea_agent/provider.yaml` 的 `minimax:` 段（复用本机已配置好的账号）

其他后端也可以直接切：

```bash
set AITOWN_BACKEND=ollama        # 本地 Ollama
set AITOWN_BACKEND=openai        # 任意 OpenAI 兼容端点（LM Studio / vLLM）
set AITOWN_BACKEND=offline       # 完全离线
```

### 关于 MiniMax-M3.1-Flash 的三个坑（实测）

| 现象 | 原因 | 对策 |
|---|---|---|
| `thinking.type=disabled` 报 400 | 该模型是**自适应思考**，不允许关思考 | 改用 `reasoning_effort: "low"` |
| `content` 为空、`finish_reason=length` | 思考 token 把 `max_tokens` 吃光了 | `max_tokens` 给到 4000，且提示词要短 |
| 单次调用 100 秒 | 提示词越啰嗦，它想得越久 | 提示词写死字段长度上限后降到 6~10 秒 |

`reasoning_split: true` 会把思考过程单独放进 `reasoning_content`，解析器在 `content` 里找不到 JSON 时会再去那里捞一次。

## 三、玩法

| 系统 | 谁在负责 |
|---|---|
| NPC 生成（姓名 / 性格 / 背景 / 秘密 / 关系网） | LLM，关系网由状态机补全 |
| 每日 3~5 个事件（天灾 / 人情 / 商机 / 悬案 / 日常） | LLM 出题，状态机结算 |
| 主线剧情（3 阶段 + 线索 + 奖励） | LLM，阶段推进由状态机判定 |
| DM 模式：玩家随便输入 | LLM 裁决，输出叙事 + 3 个分支 |
| 经济（商品 / 价格波动 / 商队求购） | 纯确定性 |
| 17 种结局 | 纯确定性，按行为模式判定 |

**关键设计：LLM 不直接改数值。** 它只能从一张固定词表里挑「语义标签」：

```json
{"kind": 1, "coin": -8, "trust:n_3": 2, "build:market": 1, "risk": "high"}
```

由 `state.resolve_effects()` 查表换算成具体数值。这样既有生成式随机性，又不会数值崩盘。

## 四、目录结构

```
ai-town/
├── main.py                  # 入口（界面 / 模拟 / 自测 / 体检）
├── config.json              # LLM 配置
├── ai_town/
│   ├── models.py            # 数据模型：NPC / 事件 / 建筑 / 任务 / 记忆
│   ├── rng.py               # 确定性随机（带命名子流）
│   ├── state.py             # ★ 确定性状态机：资源、建筑、日循环、效果结算
│   ├── economy.py           # 商品、价格波动、商队
│   ├── endings.py           # 17 种结局判定
│   ├── game.py              # 编排层：把状态机 / Agent / LLM 串成闭环
│   ├── sim.py               # 无头模拟器
│   ├── save.py              # 存档读档（JSON，带版本号）
│   ├── llm/
│   │   ├── client.py        # 后端适配（minimax / openai / ollama / offline）
│   │   ├── prompts.py       # 提示词（给规则，不给剧本）
│   │   └── parsing.py       # 健壮 JSON 解析 + 结构校验
│   ├── agents/world.py      # Agent 层：NPC / 事件 / DM / 主线 / 对话
│   ├── fallback/narrator.py # ★ 程序化叙述器（离线可玩 + LLM 兜底）
│   └── ui/app.py            # Tkinter 前端
├── tests/                   # 77 项单元测试
└── tools/                   # 冒烟脚本与调试脚本
```

## 五、界面

```
┌──────────────┬────────────────────────┬──────────────┐
│ 镇长状态     │  叙事面板               │ 人物/档案    │
│ 资源面板     │  （LLM 写的故事）        │ 今日事件     │
│ 小镇地图     │                        │ 市场/建筑    │
│ （点居民）   │  ① ② ③ 分支按钮        │ 主线/镇志    │
├──────────────┴────────────────────────┴──────────────┤
│ [ 我想……                              ] [行动][结束这一天] │
└──────────────────────────────────────────────────────┘
```

地图上的圆点是居民（绿=信任高 / 黄=一般 / 红=不信你），方块是建筑。

## 六、测试与验证

```bash
python -m unittest discover -s tests -v   # 77 项单元测试
python tools/ui_smoke.py                   # UI 冒烟（建窗口→行动→推进一天→销毁）
python tools/llm_smoke.py                  # 在线 LLM 冒烟（居民/主线/事件/DM）
python tools/shot.py ui.png                # 界面截图
```

`tools/probe/` 是排查 MiniMax 输出格式与耗时问题时写的探针脚本（见该目录 README），留着有用。

## 七、扩展点

- **加新结局**：在 `endings.py` 的 `ENDINGS` 里加一条（`check` 是任意判定函数）。
- **加新建筑**：`state.py` 的 `BUILDING_DEFS` + `_building_flow`。
- **换提示词**：`llm/prompts.py`，注意保持短（见上文「三个坑」）。
- **加新后端**：继承 `llm/client.py` 的 `Backend` 基类，实现 `complete()` 即可。

## 八、已知限制

- MiniMax 单次调用 6~10 秒（思考型模型的固有成本），界面已用后台线程 + 状态提示处理，不卡 UI。
- LLM 偶尔输出坏 JSON，已用「修复 + 容错解析 + 最长片段扫描」三层兜底，仍失败则回退程序化叙述器。
- 地图是 6×6 网格的轻可视化，不是 3D。
