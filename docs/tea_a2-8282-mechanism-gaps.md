# tea_a2（8282）作为 LLM agent「机制层」的接口评估

- **评估对象**：`http://localhost:8282`，`GET /api/health` → `version: 0.18.5`，provider `deepseek` / `deepseek-flash`，`exec_enabled: false`，8 个工作区。
- **文档来源**：`GET /api/doc?format=md`（69 KB / 1067 行，二进制内编译的那一份；HTML 111 KB）。
- **方法**：通读全部 1067 行 + 对 8282 做**只读探针**（26 个路由存在性、4 个方法级探测、3 个分页参数、4 个响应头、1 个 `/api/tools/call` 拒绝样例）。没有写任何文件、没有起新轮次、没有改代码。
- **标记**：✅ 本次实测 · 📖 文档声明（未实测，实测代价是起一轮 / 花钱）· ❌ 实测不存在。

---

## 0. 一句话结论

**执行生命周期这一层做得比大多数「agent 框架」都扎实（turn 级取消、断线接回、seq 回放、排队采纳、轨迹增量落盘），但"机制层"缺的不是生命周期，而是「外部编排者敢不敢用」的那一圈：工具原语、预算、审批、身份、幂等、机器可读的能力清单。**

现在的 8282 是一个**很好的 agent 宿主**（host），还不是一个**好的 agent 底座**（substrate）。差别在于：宿主假设"控制权在我"（模型决定调什么工具），底座要能回答"控制权在你"（脚本决定调什么工具，宿主只提供执行、沙箱、审计）。

---

## 1. 逐维度评分

| 维度 | 现状 | 评级 |
| --- | --- | --- |
| 执行生命周期（起 / 停 / 接回 / 排队） | `POST /api/chat` + `stop` + `turn` + `attach` + `queue` + `interrupt`，每帧递增 `seq`，8 MB 回放缓冲，断线不取消 | **A** |
| 状态与证据（什么被做了什么） | 轨迹 JSONL 一轮一行、原地刷新、断电留完整快照；`files_changed` 只记工具自报 | **A-** |
| 上下文治理 | 自动压缩 + `compaction` 事件（`covered_messages` / `dropped`）+ `summary_upto` | **B+** |
| 工具面（调 / 看 / 停） | 模型内 52 个工具；**外部只能调 2 个 web 工具 + MCP**（`/api/tools/call` 明确拒绝 `toolkit_exec`） | **D** |
| 预算与限流 | 只有全局上限（线程池 / `MAX_SUBSCRIBERS` / `MAX_ACTIVE_TURNS`），无请求级预算 | **D** |
| 授权与审批 | 单 token 布尔；无主体、无作用域、无策略、无审批闸门 | **F** |
| 幂等与重试语义 | 无 `Idempotency-Key`，无 `retryable`，无 `Retry-After` | **F** |
| 可发现性（机器契约） | `/api/doc` 人读 + `/api/tools` 带 schema；无 OpenAPI / capabilities / version 端点 | **C** |
| 可观测（审计 / 指标 / 关联 id） | 日志尾部 + 轨迹；无 `/api/audit`、无 `/api/metrics`、无 `X-Request-Id` | **D** |
| 确定性（重放 / 录制） | `fork` 有；`replay`、LLM 录制回放无 | **D** |
| 并发语义（文件层） | 会话写操作有 `409 turn_running`（严谨）；文件 `PUT` 无 ETag / 无前置条件 | **D** |

---

## 2. 已经做对、不要动的地方

这几条是"机制层"真正难的部分，文档里描述得很具体，说明是想过的，不是碰巧：

1. **轮次与连接解耦**。关页面不取消、`attach` 从 `since` 续播、`start.messages_before` 让客户端可以把已落盘的迭代截掉——这是"多客户端 / 换机器接着看"的前提。
2. **`seq` 单调 + `resync`**。回放缓冲溢出时明确告诉客户端"你落后了，重拉一次"，而不是假装连续。事件流就该这么设计。
3. **`interrupt` 等旧 worker 收尾落盘**。文档写了不加这一步会稳定复现数据覆盖——这类"慢一点但正确"的取舍是机制层该有的。
4. **三个时间数**（`started_at` / `elapsed_ms` / `timeout_ms`，且 `0 = 这个工具没有上限`）。长工具"活着还是死了"是个真问题，这是正解。
5. **轨迹增量落盘**（同偏移重写 + 截断，读入按 `turn_id` 取最后一条，坏尾行跳过，未完成标 `partial`）。审计链在断电后仍然成立，少见。
6. **原语层与产品层分开**（`/api/llm/chat` 一次调用 vs `/api/chat` 一轮 loop），并且**旋钮优先级 = 请求 > 机器 > 模型**、`null` 表示"清掉"、写错报 400 不静默。这几条是接口设计的常识，但多数实现做不到。
7. **`knobs.reasoning_effort_sent`**：承认"字段上线 ≠ 网关照做"，把不确定性放在响应里而不是文档里。
8. **不完整要自己说出来**（搜索的 `truncated` / `sessions_skipped`、工具输出的 `truncated`）。机制层最怕"看起来成功"。

---

## 3. 缺口：P0（外部编排者拿它当机制层，缺这些就做不成）

### P0-1 工具的通用调用入口：现在只有"模型能调"，"脚本不能调"

- **现状**：`/api/tools` 列出 52 个工具（含 MCP）。但 `POST /api/tools/call` 只认 `toolkit_search` / `toolkit_fetch`，✅ 实测：

  ```
  POST /api/tools/call {"tool":"toolkit_exec",...}
  400 {"error":{"code":"bad_request","message":"'toolkit_exec' is not a web tool - this endpoint calls toolkit_search and toolkit_fetch"}}
  ```

  MCP 工具另有 `/api/mcp/servers/{name}/call`。剩下的 `toolkit_exec` / `toolkit_file` / `toolkit_peer` / `toolkit_todo` / `toolkit_task` 只能由模型在 `/api/chat` 里调。
- **为什么是机制层的硬缺口**：外部编排者只有两条路，都不好：
  - 把控制权交给 `/api/chat`（模型决定调什么）→ 编排逻辑被埋进提示词，不可测、不可复现；
  - 自己用 `/api/exec` + 文件接口重写一遍工具语义 → 两套语义必然漂移（截断规则、沙箱、`files_changed`、轨迹记录全对不上），而且 `/api/exec` 默认根本不存在。
  文档自己把这条路写出来了（"脚本自己转（机制层的做法）"），但只对 web 工具成立——**恰好是最不需要沙箱的那两个**。
- **建议形状**：

  ```jsonc
  POST /api/tools/call
  {"tool":"toolkit_exec",
   "arguments":{"command":"npm test"},
   "workspace_id":"ws_x", "session_id":"s_x",   // 决定 cwd / 沙箱 / 落到哪条轨迹
   "timeout_ms":60000}
  → {"ok":true,"call_id":"tc_8f...","tool":"toolkit_exec",
     "output":"...","truncated":false,"exit_code":0,"elapsed_ms":4210,
     "files_changed":[{"path":"dist/a.js","bytes":1204}],
     "origin":"api"}
  ```
  - 与 loop 内执行**共用同一实现**（同一沙箱、同一截断、同一 `max_tool_output`）；
  - 把外部调用也写进轨迹（`kind:"tool", origin:"api"`）——否则外部编排干的事在审计里是隐形的；
  - 错误要能分开：`400 tool_unknown` / `403 tool_forbidden`（策略）/ `409 tool_busy`（同一 shell 会话被占）。
- **现在能怎么绕**：`/api/exec`（要 `--api-token`，全权）+ `/api/workspaces/{id}/file`。功能上够，语义上不是一套东西。

### P0-2 工具调用没有句柄：不能看进度、不能取消、拿不到完整输出

- **现状**：工具只在 SSE 里可见（`tool_start` / `tool_result`），没有可寻址的 `call_id`；`tool_result` 带 `truncated`，轨迹里单步默认再砍到 `trajectory_step_max_bytes: 8192`；文档明说"跑着的调用，服务端不会再说话"。
- **为什么是机制层必须有**：一个跑 3 分钟的构建，外部只能看到"有 `tool_start`、没有 `tool_result`"；不能只杀这一个调用（`/api/chat/stop` 杀整轮），也拿不到被截断的那 8 KB 之后的东西（比如最后 200 行报错）。这正是"机制层"和"聊天产品"的分水岭。
- **建议形状**：

  ```
  POST /api/tools/call            → call_id
  GET  /api/toolcalls/{id}        → {state, started_at, elapsed_ms, timeout_ms, tail_bytes, exit_code?}
  GET  /api/toolcalls/{id}/output?full=1
  POST /api/toolcalls/{id}/cancel
  SSE: {"type":"tool_progress","call_id":"tc_…","bytes":8123,"tail":"…"}
  ```
  完整输出落 `.tea_agent_run/toolcalls/<call_id>.out`（跟轨迹同源），`?full=1` 流式发。
- **现在能怎么绕**：让工具自己写文件（`toolkit_exec` 带重定向），再去读文件。可行但把机器细节漏给了调用方。

### P0-3 没有请求级预算：一轮可以无限跑、无限花

- **现状**：`/api/llm/chat` 有 `max_tokens`（单次输出）；`/api/chat` 有旋钮但没有 `max_iterations` / 墙钟 / 总 token / 总工具调用数（文档只提到"迭代上限"是终止原因之一，没给设置手段）。限额全是进程级（`MAX_ACTIVE_TURNS`、`MAX_SUBSCRIBERS`）。
- **为什么是机制层必须有**：调度方的第一句话永远是"这一轮最多花多少"。没有这个，只能靠外面掐表 + `/api/chat/stop`，而 stop 是"下一个模型/工具边界"才生效——正好卡在最贵的那种长工具里。
- **建议形状**：

  ```jsonc
  POST /api/chat {"message":"…",
    "limits":{"max_iterations":8,"max_wall_ms":300000,
              "max_tool_calls":40,"max_total_tokens":200000}}
  → done: {"stop_reason":"budget","budget_used":{...}}   // 不是 error
  ```
  超预算应做成**正常结束**（`stopped` + `reason`），而不是 `error`——机制层要能区分"失败了"和"到点了"。
- **现在能怎么绕**：外部计时 + stop；或者把预算写进 system prompt（不可靠，也不是机制）。

### P0-4 没有审批闸门 / 策略：现在只有"全权"和"没有"两档

- **现状**：`/api/exec` 没配 token 就 404，配了就是任意命令；`/api/shell` 文档自己写"接口本身不做鉴权，权限边界就是那个用户的权限"；`toolkit_exec` 在 loop 里无条件执行。**没有任何工具级 / 路径级 / 命令级策略，也没有"停下来问人"的事件。**
- **为什么是机制层必须有**：这条决定"能不能把 agent 交给一个不完全可信的调度方"。企业里第一个问题就是这个，现在只能答"别开 exec"。
- **建议形状**：

  ```jsonc
  GET/PUT /api/policy
  {"tools":{"toolkit_exec":"ask","toolkit_file":"allow","toolkit_peer":"deny"},
   "paths":{"read":["/srv/proj"],"write":["/srv/proj/.tmp"]},
   "exec":{"allow":["npm *","git *"],"deny":["rm -rf *","curl *"]}}

  // 命中 ask 时，轮次暂停，SSE 发：
  {"type":"approval_required","approval_id":"ap_…","tool":"toolkit_exec",
   "arguments":{"command":"rm -rf build"},"expires_at":"2026-…Z"}
  POST /api/turns/{turn_id}/approvals/{approval_id} {"decision":"allow_once|allow_always|deny"}
  ```
  默认保持现在的开放语义，只有 `policy` 存在时才收口（否则会打断现有用法）。
- **现在能怎么绕**：不给 agent 配 `toolkit_exec`；或者上层自己解析 `tool_call` 事件、抢先 stop。都不成立（工具已经执行了才发 `tool_start`… 实际上 `tool_start` 在 `tool_call` 之后、执行之前，能抢，但依赖时序，很脆）。

### P0-5 没有异步轮次句柄，也没有完成回调

- **现状**：`/api/chat` 是 SSE，想"发一条、走人、完成再通知"只能靠**断开连接**（文档保证断开不取消），但断开之后调用方没有任何 id；`turn_id` 只在 `done` 事件里出现，`GET /api/chat/turn` 只按 `session_id` 查。✅ 实测 `GET /api/chat/turn?turn_id=…` → `400 'session_id' is required`。
- **为什么是机制层必须有**：同步 SSE 是给 UI 的；后台任务需要"提交 → 句柄 → 回调/轮询"。现在的形态让"批量起 20 个 agent 任务"变成"开 20 条 SSE 挂在那儿"（每条约占一个线程，`MAX_SUBSCRIBERS` 8）。
- **建议形状**：

  ```
  POST /api/chat {"async":true}  → 202 {"turn_id":"t_…","session_id":"s_…","events_url":"…"}
  GET  /api/turns/{turn_id}      → {state, started_at, last_seq, usage, stop_reason}
  POST /api/webhooks {"url":"https://…","events":["turn_done","turn_stopped","tool_error"],
                      "secret":"…"}   → 带签名的重试投递
  ```
  只有 `async` 时才 202，默认仍是 SSE——不破坏现有客户端。
- **现在能怎么绕**：`curl -N … &` 然后丢弃输出；靠 session 的 `updated_at` 轮询。能跑，但拿不到"哪次失败了为什么"。

### P0-6 没有幂等键：重试 = 重复执行 + 重复计费

- **现状**：`POST /api/chat`、`/api/tools/call`、`/api/mcp/servers/{name}/call`、`/api/exec` 都不认 `Idempotency-Key`。✅ 实测带这个头发一个坏 body，返回的仍是普通 body 校验错误（说明这个头被无视）。
- **为什么是机制层必须有**：`POST /api/exec` 是"任意命令"——网络超时后重试一次，就是跑两遍 `apt-get upgrade`。聊天重复一轮会重复扣费，而且第二轮会看到第一轮的消息，语义直接错。
- **建议形状**：统一 `Idempotency-Key: <uuid>`，24 h 内同键返回**同一响应体**（含同一个 `turn_id` / `call_id` / `exit_code`）；键相同但 body 不同 → `409 idempotency_conflict`。缓存放 tea home（和 `workspaces.json` 同级），重启不丢。
- **现在能怎么绕**：调用方自己做去重表。但"命令已经发了、响应没回来"这类情况本地无法判定。

---

## 4. 缺口：P1（能用，但用起来要写一堆补丁）

### P1-1 没有主体身份：只有"有 token"和"没 token"

- **现状**：❌ `/api/whoami` 404。文档自述："项目钥匙守的是队列这一层，它背后的 agent 接口（`/api/workspaces`、`/api/chat`）还没有钥匙的概念——要真正做到「项目之间互相看不见」，agent 那一层也得按项目分。"
- **缺**：`GET /api/whoami → {principal, scopes:[read,chat,exec,admin], workspaces:[…], features:{exec,shell,fleet}}`；令牌带作用域而不是布尔；`/api/workspaces`、`/api/sessions`、`/api/chat` 按主体过滤。
- **为什么**：多项目托管时，"能看 A 项目的人不能读 B 项目的会话"现在做不到；`/api/destroy` 更是单 token 全权。

### P1-2 没有机器可读的能力清单

- **现状**：❌ `/api/openapi.json`、`/api/features`、`/api/capabilities`、`/api/version` 全 404。唯一"契约"是 `GET /api/doc` 的 Markdown（给人读的）和 `/api/tools` 的 schema。
- **缺**：

  ```jsonc
  GET /api/capabilities
  {"version":"0.18.5","git_hash":"…","built":"…",
   "features":{"exec":false,"shell":true,"mcp":true,"peer":true,"fleet":false,
               "asr":false,"trajectory":true},
   "limits":{"max_subscribers":8,"max_active_turns":24,"max_tool_output":32768,
             "max_raw_bytes":16777216},
   "routes":[{"method":"POST","path":"/api/chat","since":"0.18.0"}],
   "tools":[{"name":"toolkit_exec","schema":{…}}]}
  ```
- **为什么**：上层要判"这台支不支持 X"，现在只能 404 试探（`/api/exec` 不存在时说"this device has no fleet channel"，这条错误信息是好的，但**要先试才知道**）。版本协商也没有入口——`/api/health` 里有 version，但没说"哪些字段从哪个版本开始有"。

### P1-3 没有 agent 层的审计与指标

- **现状**：队列那套有 `/api/audit`（`sched/fleet_server.py` 侧），agent 这层 ❌ `/api/audit` 404、❌ `/api/metrics` 404。✅ 所有响应头**都没有** `X-Request-Id`，错误体里也没有 `request_id`。
- **缺**：`GET /api/audit?since=&principal=&route=&workspace=`（谁在什么时候调了 `/api/exec`、改了 `provider.yaml`、删了会话、跑了 `/api/destroy`）；`GET /api/metrics`（`turns_total`、`turn_duration_ms`、`tool_errors_total{tool}`、`tokens_total{model}`、`cost_estimate`，Prometheus 文本即可）；`X-Request-Id` 从 HTTP 贯到 SSE 每个帧。
- **为什么**：出事后现在只有 `/api/workspaces/{id}/logs?tail=300` 这一条线索，且是给人看的文本。跨进程（浏览器 → 8282 → provider → MCP）没有任何关联 id。

### P1-4 文件接口缺前置条件、缺删除、缺二进制写入

- **现状**（✅ 全部实测）：
  - `DELETE /api/workspaces/{id}/file` → **404 no such endpoint**（而模型有 `toolkit_file` 的 delete）——**外部编排者能读能写，不能删**；
  - `POST …/mkdir` → 404；`POST …/file/patch` → 404；
  - `GET …/file` **没有 ETag**，`PUT` 没有 `If-Match` / `If-None-Match` → 并发写直接互相覆盖；
  - `GET …/raw` 其实支持 `Range: bytes=0-10` → **206 + Content-Range**，但文档一个字没写（顺带说明其它路由可能也没写全）。
- **缺**：`ETag` + `If-Match`（不匹配 → `412`，缺头 → `428`）、`POST /file:patch`（按行/按段替换，避免整份读写）、`DELETE /file`、`POST /mkdir`、`PUT /file` 的二进制入口（现在只有 shell 会话的 `/upload` 能传原始字节）。
- **为什么**：两个 worker 同时改一个文件（一个在会话 A，一个是外部脚本）没有任何仲裁；"读 → 改一处 → 整份写回"这个模式在文件层没有护栏，而文档给会话层加了 `409 turn_running` —— 两层的严谨程度不一致。

### P1-5 没有工作区级并发租约

- **现状**：同一**会话**并发有排队/`interrupt`/`409`，但两个**会话**（在不同 workspace 或同 workspace 不同 session）可以同时跑，全局只受 `MAX_ACTIVE_TURNS=24` 限制。文件、`.tea_agent_run/memory.json`、`workspaces.json` 都可能被两个 worker 同时改。
- **缺**：`POST /api/workspaces/{id}/lease {ttl_s}` → `{lease_id, expires_at}`（advisory，不阻塞只提示）；或 `/api/chat` 加 `{"concurrency":"queue"|"fail"}`。
- **为什么**：机制层的调度方需要知道"这个工作区现在有没有人在动"，否则批量下发任务必然自相踩踏。

### P1-6 没有跨轮次的全局事件总线

- **现状**：SSE 只属于"一轮"，轮次结束缓冲就没了；❌ `/api/events` 404（那是队列服务 8283 的路由）。轮次开始/结束、会话被删、配置热加载、MCP 掉线，全都只能轮询。
- **缺**：`GET /api/events?types=turn_started,turn_done,tool_error,config_reloaded,mcp_disconnected&since=<seq>`，`seq` 用独立命名空间（`ev_`），与轮内 `seq` 分开。
- **为什么**：`GET /api/chat/turns` 能看"现在谁在跑"，但看不到"刚刚谁跑完了、结果如何"；轮次一结束，`attach` 就 404 `no_active_turn`，只剩会话终态。

### P1-7 会话读取不分页，且分页参数被**静默忽略**

- **现状**：✅ 实测 478 条消息的会话，`GET /api/sessions/{sid}` 一次返回 **1.22 MB**；带 `?limit=1`、`?after=0&limit=1`、`?since_message=1` 全部返回 478 条，**参数被无视**（`/api/workspaces/{id}/sessions` 的 `limit/after` 同理，只是恰好只有 1 个会话看不出来）。
- **为什么这件事比"没有分页"更严重**：文档自己立了规矩——"写错了会报错，不会被悄悄忽略"（旋钮那节）。**同样的原则在会话读取上没有执行**。调用方会以为拿到了被裁剪的结果，实际拿到了全量；而"全量"在大会话上是几 MB，轮询一次就把带宽吃满。
- **缺**：`?after_seq=&limit=`（真分页）+ `ETag` / `If-None-Match`（`304` 直接省掉重传）；或者明确拒绝不认识的参数。

---

## 5. 缺口：P2（等真有人要做才值得加）

| # | 缺什么 | 为什么 | 建议形状 |
| --- | --- | --- | --- |
| P2-1 | **重放 / 录制** | 轨迹是"审计"，不是"回放"：没有 `POST /api/turns/{id}/replay`，也没有 LLM 录制回放（VCR）。做回归、做影子运行、做"换个模型同一题对比"全靠它 | `POST /api/turns/{turn_id}/replay {"mode":"exact\|dry_tools\|new_model"}`；录制：`settings.replay_dir` 里存 provider 原始响应 |
| P2-2 | **上下文 / 压缩的显式控制** | 压缩是自动的，只有 `compaction` 事件；没有手动触发、没有"每条消息占多少 token / 会被谁挤掉"的视图、没有按请求覆盖 `max_context_tokens` | `POST /api/sessions/{sid}/compact {keep_last_n}`；`GET /api/sessions/{sid}/context`；`/api/chat` 加 `max_context_tokens` |
| P2-3 | **产物（artifacts）不是一等公民** | SSE 有 `artifacts` 事件，但没有 `GET /api/turns/{id}/artifacts` / `GET /api/workspaces/{id}/artifacts`；`files_changed` 只记工具自报，`toolkit_exec` 只留 `command`——**"这轮到底改了什么"没有 diff** | `GET /api/turns/{id}/diff`（对 `files_changed` 里每个 path 取前后快照，或直接用 git）；`GET …/artifacts?since=turn_id` |
| P2-4 | **记忆只能整块读写** | `GET/POST /api/workspaces/{id}/memory` 没有按 id 删/改/检索，`?limit=` 被忽略（实测 `notes: []`）；`toolkit_memory` 是工具层语义，外部编排拿不到同一套 | `GET /memory?q=&limit=&cursor=`、`DELETE /memory/{id}`；或直接把它做成普通文件 + 结构化 schema |
| P2-5 | **模型路由 / 降级 / 超时** | `/api/llm/chat` 只能指定单个 `provider` + `model`，没有请求级 `timeout_ms`、没有 fallback 链（"先 flash，失败换 minimax"），内部的重试是启发式（`stream_options` 那条） | `{"model":"deepseek-flash","fallbacks":[{"provider":"minimax","model":"…"}],"timeout_ms":20000,"retries":{"max":1,"on":[429,502]}}` |
| P2-6 | **只有"用 MCP"，没有"当 MCP / A2A"** | `/api/peer/chat` 是"把整轮交给对端模型"，没法"把对端的 `toolkit_exec` 当我的一个工具"；也没法把自己的工具暴露成 MCP server 给别人的 agent 用 | `--mcp-server` 模式（把自己 `/api/tools` 暴露成 MCP tools）+ `GET /.well-known/agent.json`（A2A agent card） |
| P2-7 | **没有调度** | 没有 `POST /api/schedules`（cron 触发一轮）；队列服务有任务队列，但那是 8283 另一个进程，"单机、每天 8 点跑一次"这种需求没有归属 | `POST /api/schedules {"cron":"0 8 * * *","workspace_id":"…","message":"…","session":"new\|same"}`，`GET /api/schedules` 带 `last_run` / `next_run` |
| P2-8 | **没有错误目录** | `{code,message}` 里的 code 没有集中清单、没有 `retryable`、没有 `Retry-After`（唯一带 429 的 `too_many_subscribers` 也没说等多久） | `GET /api/errors` 返回 `{code, http, retryable, meaning, hint}`；429 一律带 `Retry-After` |

---

## 6. 三条结构性问题（不是"缺一个接口"，是语义缺口）

**A. 控制权只有两个极端，缺中间那档。**
`/api/chat` = 模型控制 loop；`/api/llm/chat` + `/api/tools/call` = 脚本控制 loop，但工具只剩 web 两个。中间那档——**"我控制 loop，用你的工具、你的沙箱、你的轨迹"**——不存在。P0-1 + P0-2 合起来就是这一档。这是整份评估里唯一一条"补了之后用法会变"的缺口，其余都是"补了之后敢用"。

**B. 并发语义两层不一致。**
会话层很严谨（`409 turn_running`、`interrupt` 等 worker 收尾、排队只采纳一条）；文件层什么都没有（无 ETag、无租约、无锁），而且"整份读 → 改 → 整份写回"这个模式在文件层恰恰是最常见的。机制层的调用方会按会话层的严谨程度去推断文件层，然后踩坑。

**C. 错误不可判。**
code 是自由字符串，没有目录、没有 `retryable`、没有 `Retry-After`、没有 `request_id`。所以上层只能写 `if (message.includes('409'))` 这种代码，重试策略只能全凭猜。`too_many_subscribers` 这个设计很好（有上限、有明确拒绝），但它没告诉客户端"等 3 秒再试"。

---

## 7. 若只补 6 个（建议顺序）

| 顺序 | 补什么 | 性质 | 说明 |
| --- | --- | --- | --- |
| 1 | **P0-1 + P0-2 工具通用调用 + 调用句柄** | 能不能用 | 一起做才有意义：没有句柄的通用调用只是把"看不见的长任务"从模型搬到脚本里 |
| 2 | **P0-6 幂等键** | 敢不敢重试 | 改动最小、收益最直接（尤其是 `/api/exec`） |
| 3 | **P0-3 请求级预算** | 敢不敢撒手 | `limits` + `stop_reason: budget`，不做成 error |
| 4 | **P0-4 策略 + 审批闸门** | 敢不敢托管 | 默认关闭，`policy` 存在才收口 |
| 5 | **P0-5 async 句柄 + webhook** | 敢不敢批量 | 也可以先用 `GET /api/turns?since=` 代替 webhook |
| 6 | **P1-2 capabilities** | 少写胶水 | 一条端点顶过一百次 404 试探 |

P1-7（会话分页 / 静默忽略参数）不算"补接口"，是**修一个和本文档自己原则冲突的行为**，可以先做，成本很低。

---

## 8. 有三条我**不建议**加

- **通用 DAG / workflow 引擎**。文档开篇的立场是对的："策略应该写在脚本里，而不是长在服务端里"。加了编排 DSL 会把机制层变成产品层。
- **把 UI 状态塞进接口**（当前主题、滚动位置、气泡展开状态）。`?s=<session_id>` 已经够了。
- **默认强制审批**。默认保持现在的开放语义（本机、单用户、127.0.0.1），只有显式配了 `policy` 才收口——否则会把现在这套很顺手的用法全打断。

---

## 附录 A：本次探针结果（原始）

复跑：

```
node .tea_agent_run/scripts/probe_api.mjs     http://localhost:8282
node .tea_agent_run/scripts/probe_routes.mjs  http://localhost:8282
node .tea_agent_run/scripts/probe_paging.mjs
node .tea_agent_run/scripts/probe_file_api.mjs
```

**路由存在性**

| 结果 | 路由 |
| --- | --- |
| 200 | `/api/health`、`/api/status`、`/api/tools`（52 个工具）、`/api/providers`、`/api/chat/turns`、`/api/workspaces`、`/api/mcp/servers`、`/api/shell`（`conpty` / `pwsh.exe`）、`/api/destroy`、`/api/workspaces/{id}/sessions`、`/api/workspaces/{id}/memory`、`/api/sessions/{sid}` |
| 404 `no such endpoint` | `/api/metrics`、`/api/openapi.json`、`/api/whoami`、`/api/audit`、`/api/sessions`（列表只能按工作区取）、`/api/events`、`/api/tasks`、`/api/features`、`/api/capabilities`、`/api/version`、`/api/config`（`POST` 才有）、`/api/errors`、`/api/toolcalls/{id}`、`/api/webhooks`、`/api/policy`、`/api/schedules`、`/api/turns/{id}/replay`、`/api/turns/{id}/approvals/{aid}`、`/api/turns/{id}/artifacts`、`/api/workspaces/{id}/artifacts`、`/api/sessions/{sid}/compact`、`/api/sessions/{sid}/context`、`DELETE …/file`、`POST …/mkdir`、`POST …/file/patch` |
| 400（路由在，但缺参） | `GET /api/chat/turn?turn_id=…` → `'session_id' is required` |

**其它实测**

- `POST /api/tools/call {"tool":"toolkit_exec"}` → `400 'toolkit_exec' is not a web tool`。
- `POST /api/exec` → `404 this device has no fleet channel (start it with --api-token <token>)`（`exec_enabled:false`）。
- `GET /api/sessions/s_x?limit=1&after=0`（478 条消息）→ `200`，`messages: 478`，**参数未生效**，响应 1,220,642 字节。
- `GET …/raw` + `Range: bytes=0-10` → `206` + `Content-Range: bytes 0-10/814`（文档未记录）。
- `GET …/file` 响应头全量：`access-control-allow-origin` / `cache-control: no-store` / `content-length` / `content-type` —— **无 ETag、无 Last-Modified**（`mtime` 只在 JSON body 里），所以拿不到可用于 `If-Match` 的令牌。
- 所有探针响应：**无 `X-Request-Id`**；错误体只有 `{code,message}`。

## 附录 B：口径说明

- 标 📖 的判断来自 `/api/doc` 文本（字段语义、限制、失败模式），没有逐条实跑——凡实跑需要起一轮、调付费搜索或写文件的，都没有做。
- 文档与二进制是同一份（编译进二进制，`tests/smoke_api_docs.py` 校验路由覆盖），所以"文档没写"≈"这一版没有"的置信度较高；但文档没写 ≠ 一定不存在（`raw` 的 Range 支持就是反例），因此附录 A 里每条"不存在"都是实测 404，不是推断。
- 8282 上的版本是 **0.18.5**（此前记录里的 0.18.3 已过时）。
