# a2_share · 传输协议 v1

> **状态** 定稿（实现以此为准） ｜ **版本** `v1` ｜ **日期** 2026-11-22
> **上游** [`REQUIREMENTS.md`](REQUIREMENTS.md) · [`DESIGN.md`](DESIGN.md)
> **读者** PC 端与 Android 端实现者。两端对同一份黄金样本（§11）必须给出同一结果。

---

## 0. 一句话

PC 是 HTTP/1.1 服务端；手机用 `GET /v1/hello` 探活、`POST /v1/pair` 换 token、`POST /v1/uploads` + `PUT chunk(offset)` + `finish` 传文件；断线后凭 `offset` 续传；离开 Wi-Fi 或 PC 重启都会让 token 失效，必须重扫。

---

## 1. 通用约定

### 1.1 地址与编码

| 项 | 约定 |
|---|---|
| Base URL | `http://<ipv4>:<port>/v1`（默认端口 8899，仅 IPv4） |
| 请求/响应体 | JSON（UTF-8，`Content-Type: application/json`），上传块例外（原始字节） |
| 字段命名 | 小写下划线：`upload_id`、`session_expired` |
| 时间 | epoch 秒（`t`、`server_time`）或 epoch 毫秒（`created_at`、队列字段），字段名带 `_at` 的用毫秒 |
| 大整数 | 一律 JSON number（≤ 4 GiB，安全） |

### 1.2 请求头

| 头 | 谁发 | 说明 |
|---|---|---|
| `Authorization: Bearer <token>` | 手机（除 hello/pair） | 32 字节 token 的 64 位小写 hex |
| `X-A2-Device: <device_id>` | 手机 | 便于 PC 日志关联；不参与鉴权 |
| `X-A2-Request: <8 hex>` | 手机 | 每个请求随机，用于两端日志对齐 |
| `X-Request-Id` | PC 响应回显 | 同 `X-A2-Request`（缺失则 PC 自生成） |
| `User-Agent: a2share-android/<version>` | 手机 | 排障用 |

### 1.3 统一响应信封

成功：`2xx`，JSON 直接是业务字段（见各端点）。

失败：

```json
{"error":{"code":"offset_conflict","message":"offset 1200 != received 4096","retryable":true,"hint":"从 received 继续","request_id":"a1b2c3d4","received":4096}}
```

- `code`：机器可读，见 §9；`message`：英文短句（日志用）；`hint`：**中文**，可直接展示给用户（对应需求 §7 的文案要求）。
- `retryable`：调用方是否值得自动重试。**以它为准，不要按 HTTP 状态猜**。
- 额外字段按端点定义（如 `received`、`attempts_left`）。

### 1.4 认证与拒绝

- 除 `GET /v1/hello`、`POST /v1/pair` 外，全部要求 `Authorization`。
- 校验失败：**没有 token / 格式错** → `401 unauthorized`；**token 格式对但已不属于当前会话**（PC 重启、被顶替、`--reset-identity`）→ `401 session_expired`（手机据此给出「请重新扫码」）。
- 响应带 `Connection: close`，随后**立即销毁连接、不读取请求体、不创建任何文件**（FR-S01）。
- token 比较使用常数时间比较（长度不等也走完整比较）。

### 1.5 幂等与并发

| 接口 | 幂等键 | 语义 |
|---|---|---|
| `POST /v1/uploads` | `upload_id` | 重复调用返回当前 `received`；元数据不一致 → `409 upload_conflict` |
| `PUT chunk` | `(upload_id, offset)` | 重复发送同一 offset：若服务端已收则 409 回 `received`；由客户端对齐 |
| `finish` | `upload_id` | 已完成再次调用 → 返回同一结果（`200`，不再改文件） |
| `DELETE` | `upload_id` | 不存在也返回 200 |
| `POST /v1/pair` | **不幂等** | 成功即轮换 secret；重放会失败（预期） |

- 同一 `upload_id` 的写操作在服务端**串行**（内存锁）；并发 PUT 第二者得 `409 offset_conflict`。
- 同一设备同时只允许 1 个未完成上传（P1 放宽）；违反 → `429 busy`。

### 1.6 超时

| 侧 | 项 | 值 |
|---|---|---|
| PC | 请求头读取 | 15 s（`self.connection.settimeout`；读完头后切到 body 超时） |
| PC | 请求体读取 | 60 s 无字节即断开（4 MiB 块在 0.1 MB/s 下也只需 40 s） |
| PC | keep-alive 空闲 | 65 s（`protocol_version = "HTTP/1.1"`；超时关闭） |
| PC | 半包/短读 | 断开连接并保留 `.part`（客户端用 offset 续） |
| 手机 | 探活 `hello` 连接+读 | 2 s（FR-L03） |
| 手机 | `pair` | 5 s |
| 手机 | `PUT` 连接 / 读 | 5 s / 60 s |
| 手机 | `finish` | 30 s（PC 要算哈希） |

---

## 2. 二维码载荷 v1

### 2.1 格式（alphanumeric，定宽，**≤ 51 字节**）

```
A2S1-<SECRET:16>-<IP:8>-<PORT:4>-<ISSUED:7>[-<NAME:1..7>]
```

| 字段 | 长度 | 字符集 | 含义 |
|---|---|---|---|
| `A2S1` | 4 | 固定 | magic + 载荷版本（`A2S` + `1`） |
| `SECRET` | 16 | `A-Z2-7`（RFC4648 base32） | 10 字节（80 bit）会话凭据，base32 无填充 |
| `IP` | 8 | `0-9A-F` | IPv4 四段，每段 2 位大写 hex |
| `PORT` | 4 | `0-9A-F` | 端口，大写 hex，左补 0 |
| `ISSUED` | 7 | `A-Z2-7` | 32 位 unix 秒，按 5 bit/字符编码（高位补零，共 35 bit） |
| `NAME` | 0–7 | `A-Z0-9-` | PC 名提示：取清洗后的 ASCII 名字前 7 位；**可为空（连 `-` 一起省略）** |

- **总长**：不带名 **43**，带名 ≤ 51（需求上限 60 字节）。
  （`A2S1-` 5 + secret 16 + `-` 1 + ip 8 + `-` 1 + port 4 + `-` 1 + issued 7 = 43）
- **完整 PC 名不靠二维码**：手机在 `hello`/`pair` 响应里取（名称可能是中文/长名，塞不进载荷）。二维码里的 `NAME` 只用于扫码后、连接前的一行提示。
- **不允许小写、空格、中文**：保证 QR 走 alphanumeric 模式，版本小、图案大（预期 v3，29×29；module 10 px + 静区 4 module → PNG ≈ 370×370）。

### 2.2 编码规则

1. `SECRET`：`crypto.randomBytes(10)` → base32（无 `=`）。
2. `IP`：`a.b.c.d` → 每段 `toString(16).toUpperCase().padStart(2,'0')`。
3. `PORT`：`toString(16).toUpperCase().padStart(4,'0')`；范围 1–65535。
4. `ISSUED`：`Math.floor(Date.now()/1000) >>> 0`，把 32 bit 当 35 bit（左边补 3 个 0），每 5 bit 一个 base32 字符，共 7 个。
5. `NAME`：`name.toUpperCase()` → 只保留 `A-Z0-9-` → 取前 7；为空则整段省略（含分隔符）。

### 2.3 解析规则（手机端，按顺序）

1. 去掉首尾空白与不可见字符；长度 **43–51**；必须以 `A2S1-` 开头，否则 `bad_payload`。
2. **按固定宽度切片**（不要用 `-` 分割，`NAME` 里可能含 `-`）：
   `off=5`：secret[5,21)、ip[22,30)、port[31,35)、issued[36,43)、name[44..]。
3. 校验字符集合（大写 base32 / hex）；`SECRET` 必须正好 16 字符。
4. 解码 `IP`：拒绝 `0.0.0.0`、`127.0.0.0/8`、`169.254.0.0/16`、组播/广播地址 → `bad_address`。
5. 解码 `PORT`：0 → `bad_port`。
6. 解码 `ISSUED`：仅记录与展示；**不参与鉴权**（A6，避免时钟偏差卡死）。偏差 > 24 h 时日志 warn，不拒绝。
7. 校验 `NAME` 字符集；非法则忽略该字段（不影响连接）。

### 2.4 短码（兜底，与二维码同源）

```
code = (uint32_be( HMAC-SHA256(key = UTF8(SECRET字符串), msg = "a2s-pair")[0..4] ) % 1_000_000)
       格式化为 6 位十进制（左补 0）
```

- 与二维码**同寿命**：配对成功或 `--reset-identity` 后随 `SECRET` 一起轮换。
- 仅 PC 计算并展示；手机只负责输入，不校验（校验在 PC）。
- **短码里没有地址**：6 位码只编码凭据，不含 IP/端口。手机走短码兜底时还需要 PC 的「监听地址」（PC 终端会打印），所以手机端「输入短码」界面额外提供一个地址输入框。
- 限流见 §3.4。

### 2.5 示例（黄金样本）

```
A2S1-K5Q2M7Z3XJ4W6NRA-C0A80117-22C3-BVQFQF3-SUNKW-X
        secret=K5Q2M7Z3XJ4W6NRA  ip=192.168.1.23  port=8899
        issued=1795342523（2026-11-22T10:15:23Z）  name=SUNKW-X
短码 = 093511
```

不带的写法：`A2S1-K5Q2M7Z3XJ4W6NRA-C0A80117-22C3-BVQFQF3`（43 字符）。

---

## 3. 配对与会话

### 3.1 状态（PC 侧）

```
session = {
  sid: 8 hex,            // 每次进程启动随机；用来让手机发现「PC 重启了」
  secret: 16 chars,      // 当前且「未被用过」的配对凭据
  short_code: "123456",  // 由 secret 派生
  generation: int,       // 每次轮换 +1（日志/排障）
  token: 64 hex|null,    // 已配对设备的 token（单设备）
  device: {id,name,model,android,app}|null,
  paired: bool
}
```

**不变式**：`secret` 永远是「当前可用的、尚未被消费的」那一张。配对成功 → 立即生成新 `secret`/`short_code`、写 `qr.png`、`generation++`。

### 3.2 手机侧状态机

```
UNPAIRED ──扫码/短码──► PAIRING ──200──► CONNECTED ──离开Wi-Fi──► LEFT_WIFI/NO_WIFI
   ▲                        │失败                │  ▲                    │
   │                        ▼                    │  └──重新扫码──────────┘
   └── SESSION_EXPIRED ◄── 401/ sid 变化 ◄───────┘
```

| 状态 | 允许自动连接 | 允许自动补发 | 文案（需求 §7） |
|---|---|---|---|
| `UNPAIRED` | 否 | 否 | 「未配对，请扫码连接 PC」 |
| `PAIRING` | 是（正在） | 否 | 「正在连接…」 |
| `CONNECTED` | 是 | 是 | 「已连接 PC-xxx」 |
| `OFFLINE_SAME_WIFI` | 是（退避重试） | 排队等待 | 「PC 未连接，内容已缓存，PC 上线后会自动发送」 |
| `LEFT_WIFI` | 否 | 否 | 「已离开原 Wi-Fi，需要重新扫码连接 PC」 |
| `NO_WIFI` | 否 | 否 | 「当前不是 Wi-Fi，已缓存。等回到 Wi-Fi 再发」 |
| `SESSION_EXPIRED` | 否 | 否 | 「PC 已重启或配对已失效，请重新扫码」 |

**关键规则**：从 `LEFT_WIFI` 回到 Wi-Fi 后**仍然停在 `UNPAIRED`**，必须扫码（D7 / AC-28）。

### 3.3 `POST /v1/pair`

请求：

```json
{
  "v": 1,
  "method": "qr",
  "secret": "K5Q2M7Z3XJ4W6NRA",
  "device": {"id":"6f0c…","name":"Xiaomi 14","model":"2311DRK48C","android":34,"app":"1.0.0"}
}
```

短码方式：`{"v":1,"method":"code","code":"093511","device":{…}}`。

成功 `200`：

```json
{
  "v": 1,
  "token": "9f2c…（64 hex）",
  "session": {"sid": "a1b2c3d4", "generation": 4},
  "pc": {"id": "8c1d…", "name": "SUNKW-X1", "platform": "win32"},
  "limits": {"max_upload_bytes": 4294967296, "max_chunk_bytes": 8388608, "clipboard_text_bytes": 1048576},
  "server_time": 1795342523
}
```

服务端动作（按顺序）：校验 `v` → 校验 secret/code → 吊销旧 token → 发新 token → 记录 device → **轮换 secret + short_code** → 原子重写 `qr.png` → 终端打印「已配对 <name>；已生成新二维码」。

错误：`bad_secret`（附 `attempts_left`）、`rate_limited`（附 `retry_after`）、`protocol_version`、`bad_request`。

### 3.4 配对抗爆破

| 维度 | 规则 |
|---|---|
| 每 IP | 5 次失败 / 5 分钟；超限 `429 rate_limited`（`retry_after` 60–300 s） |
| 全局 | 20 次失败 / 10 分钟；超限锁定 60 s |
| 成功配对 | 清空该 IP 的失败计数 |
| 短码空间 | 10^6，配合上表在局域网内不可行暴力 |

---

## 4. 端点

### 4.1 `GET /v1/hello`（无需认证）

用途：探活（FR-L03）、取 PC 名、发现 PC 重启、配对前确认版本。

响应 `200`：

```json
{"v":1,"name":"SUNKW-X1","pc_id":"8c1d…","sid":"a1b2c3d4","paired":true,"t":1795342523}
```

- 必须 **< 20 ms** 返回，不做磁盘 IO、不加锁。
- `paired=true` 只表示「当前有 token」，不代表本次请求方有权限。
- 不返回 IP/端口/secret 等任何可用于连接的额外信息（二维码里已有）。

### 4.2 `GET /v1/status`（认证）

心跳与权威会话状态。

```json
{"v":1,"sid":"a1b2c3d4","paired":true,"device":{"id":"6f0c…","name":"Xiaomi 14"},"last_activity":1795342523,"server_time":1795342523}
```

- 手机每 20 s 调一次；连续 3 次失败 → `OFFLINE_SAME_WIFI`，进入退避。
- `401 session_expired` → `SESSION_EXPIRED`，停止重试并提示重扫（FR-L07 / AC-17）。
- `sid` 与手机保存的不一致时，即使 `200` 也按「PC 已重启」处理（防御：token 可能尚未失效的极端情况）。

### 4.3 `POST /v1/uploads`（认证）

初始化（或恢复）一次上传。

```json
{"v":1,"upload_id":"0b9e…（UUID v4）","kind":"file","name":"报告 v2.pdf","size":123456789,"mime":"application/pdf","created_at":1795342523000,"sha256":null}
```

`kind`：`file` | `clipboard_image`。

响应 `200`：

```json
{"v":1,"upload_id":"0b9e…","received":0,"name":"报告 v2.pdf","resume":false,"max_chunk_bytes":8388608}
```

- `received`：服务端 `.part` 当前字节数（**以文件实际大小为准**，见 §5.3）。
- `resume=true` 表示此前已有进度。
- `name` 是清洗后的名字；最终名字（可能带 ` (1)`）在 `finish` 返回。
- 已存在同 `upload_id` 但 `name/size/kind` 不一致 → `409 upload_conflict`（附 `received`）。客户端应换新 `upload_id`。
- 预检磁盘：`size - received + 64 MiB` 余量不足 → `507 insufficient_storage`。
- `size > 4294967296` → `413 too_large`。
- `size == 0`：允许，直接 `finish`。

### 4.4 `PUT /v1/uploads/{upload_id}?offset={n}`（认证）

追加原始字节。

| 项 | 约定 |
|---|---|
| `Content-Type` | `application/octet-stream` |
| `Content-Length` | **必须**；不支持 `Transfer-Encoding: chunked` |
| 块大小 | 1–8 MiB；默认 4 MiB（客户端可自适应，但不得越界） |
| `offset` | 十进制非负整数，必须等于服务端当前 `received` |
| 校验顺序 | 认证 → upload 存在 → offset 合法 → 长度合法 → 才开始落盘 |

响应 `200`：`{"v":1,"received":4194304}`。

错误：

| 情况 | 响应 |
|---|---|
| `offset != received` | `409 offset_conflict` + `received`（**立即对齐重发，不计失败次数**） |
| `offset + length > size` | `400 bad_request` |
| 同一 `upload_id` 另一个 PUT 正在写 | `409 offset_conflict`（附带当前 `received`） |
| 认证失败 | `401`，不读 body、销毁连接 |
| 磁盘满 / 写失败 | `507 insufficient_storage` / `500 internal`，保留已收字节 |

- 服务端流式落盘（64 KiB buffer 循环写），**不把块读进内存再写**，也不整文件进内存。
- 每块结束即 `200`；不要求 fsync（`finish` 统一 fsync）。
- 在读完当前请求体之前返回的错误（401 / 409 / 413 / 507）必须带 `Connection: close`；客户端按新连接重试。

### 4.5 `GET /v1/uploads/{upload_id}`（认证）

```json
{"v":1,"upload_id":"0b9e…","received":4194304,"size":123456789,"name":"报告 v2.pdf","kind":"file","state":"partial"}
```

`state`：`partial` | `complete`（`.part` 已满但尚未 finish）。不存在 → `404 not_found`（客户端重新 `init`）。

### 4.6 `POST /v1/uploads/{upload_id}/finish`（认证）

```json
{"v":1,"sha256":"<hex 或 null>"}
```

服务端：

1. `received == size`（否则 `409 incomplete` + `received`）。
2. **重放检查**：`upload_id` 已在 `completed.jsonl` → 直接返回同一结果（200，不再动文件、不再算哈希）。
3. 读一遍 `.part`，**同一遍**算 SHA-256 与 MD5。
4. 客户端给了 `sha256` 且不一致 → `422 hash_mismatch`（保留 `.part`，允许客户端换 `upload_id` 重来）。
5. **占名与台账**（顺序不能换）：
   a. 探测候选名（不创建文件；本 app 是接收目录的唯一写入者，探测窗口足够小）；
   b. 追加 completed `intent`：`{upload_id, final_name, size, sha256}`；
   c. 原子占名（§6.2）；撞名 → 取下一个候选，**追加一条新 intent** 后再试；
   d. 追加 `done` 记录 → 删除 `.part` 与 meta → 写历史 → 通知。
6. 返回结果。

> 意图与 done 之间崩溃：启动时扫 `completed.jsonl`，对每个 `upload_id` 取**最后一条 intent**，检查 `final_name` 存在且大小一致 → 补写 done；否则丢弃意图（`.part` 仍在，可续传）。这条保证「PC 在 finish 里崩溃后手机重试不会产生第二份文件」（AC-25）。若外部程序恰好在这几毫秒里创建了同名文件，intent 会记录实际占到的名字，不会误判。

响应 `200`：

```json
{"v":1,"name":"报告 v2 (1).pdf","path":"报告 v2 (1).pdf","size":123456789,
 "sha256":"…","md5":"…","dedup":true,"ms":2345}
```

- `md5` 是为了让 AC-01/AC-02 能直接对照源文件，不额外读盘（与 sha256 同一遍算）。
- 对 `kind=clipboard_image`：落盘后按 `--clipboard-image` 决定是否写系统剪贴板；写失败不影响 200（结果里 `clipboard:"degraded"`）。

### 4.7 `DELETE /v1/uploads/{upload_id}`（认证）

删除 `.part` 与 meta。幂等：不存在也 `200 {"ok":true}`。用于用户「取消」或 `hash_mismatch` 后重来。

### 4.8 `POST /v1/clipboard/text`（认证）

```json
{"v":1,"text":"500 字文字…","client_id":"0b9e…"}
```

- `text` 为 UTF-8，≤ 1 MiB（`413 too_large`）。
- 成功：`{"ok":true,"clipboard":"ok","chars":500,"saved_as":null}`
- 降级：`{"ok":true,"clipboard":"degraded","chars":500,"saved_as":"clipboard-20261122-101530.txt"}`（FR-C11）
- **正文永不写日志**（FR-S07 / AC-12）。

### 4.9 `GET /v1/history?limit=100`（P1，认证）

```json
{"v":1,"items":[{"ts":1795342523,"device":"Xiaomi 14","kind":"file","name":"a.pdf","size":123,"result":"ok","sha256":"…"}],"total":1}
```

只回元数据；`limit` 上限 100。

---

## 5. 分块、续传与两端崩溃恢复

### 5.1 客户端循环（伪代码）

```
offset = 0
r = POST /uploads {upload_id, name, size, ...}
offset = r.received
while offset < size:
    n = min(4 MiB, size - offset)
    try:
        r = PUT /uploads/{id}?offset=offset  body=file[offset, offset+n)
        offset = r.received                  // 以服务端为准
        persist(sent_offset = offset)        // 4 MiB 粒度
    catch 409 offset_conflict as e:
        offset = e.received                  // 立即对齐，不计失败次数
    catch network/timeout:
        retry(backoff 2s,4s,8s ×3) → 仍失败则保存 offset、回队列
finish(sha256)
```

### 5.2 块大小

| 值 | 原因 |
|---|---|
| 默认 4 MiB | 进度每 4 MiB 一次、断点最多丢 4 MiB、HTTP 开销可忽略 |
| 上限 8 MiB | 服务端单请求内存上界（流式，实际只占约一个块的 buffer） |
| 1 GB = 256 块 | 每块一次往返，局域网 RTT < 5 ms，开销 < 2 s |

### 5.3 服务端权威 offset

- `received` **等于 `.part` 的实际文件大小**（`stat`），不信任客户端或内存计数。
- 好处：任何时刻断线（包括块传到一半）留下的都是合法前缀，**无需截断**，也无需每块写 meta。
- meta（`<id>.json`）只在 `init` 写一次：`{name,size,mime,kind,device_id,created_at}`。
- 有 `.part` 无 meta（异常残留）→ 视为孤儿，`init` 时删除重建（日志 warn）。

### 5.4 崩溃矩阵

| 崩在哪 | 恢复 |
|---|---|
| 手机在 PUT 中崩溃 | 重启后 `SENDING→PENDING`，`init` 拿 `received` 续（可能少最后一块） |
| PC 在 PUT 中崩溃 | `.part` 大小即 offset；重启后 token 失效 → 手机重扫 → `init` 续 |
| PC 在 finish 中崩溃（未 rename） | `.part` 满；`init` 返回 `received=size`，客户端直接 `finish` |
| PC 在 rename 后崩溃（未响应） | 重启后从 `completed.jsonl` 的「意图」恢复出 done；客户端重放 `finish` 得 200 + 同一结果（不再写第二份）。仅当天台账被清（500 条滚动）才可能得 404 |
| 残留 `.part` 超 7 天 | PC 启动时清理 |

### 5.5 内存与流量上界

- PC：单块 ≤ 8 MiB；任一时刻最多 1 个写流 + 1 个 `finish` 哈希流。
- 手机：读文件用 64 KiB buffer 写 socket；上传期间内存增量目标 < 16 MiB（远低于 NFR-03 的 150 MB）。
- 全程不 base64、不整文件读入内存。

---

## 6. 落盘与命名

### 6.1 清洗算法（两端同一套，PC 是权威）

输入 `raw`（UTF-8）：

1. 非法 UTF-8 字节 → U+FFFD；统一 **NFC**。
2. 取 basename：按最后一个 `/` 或 `\` 切，只留最后一段。
3. 删除控制字符 `U+0000–U+001F`、`U+007F`。
4. 替换 `/ \ : * ? " < > |` → `_`。
5. 去掉**首尾**空格与结尾的点（Windows 规则）。
6. 保留名（大小写不敏感，含带扩展名形式）：`CON PRN AUX NUL COM1–COM9 LPT1–LPT9` → 前缀 `_`。
7. 截断到 **180 UTF-8 字节**（保留扩展名 ≤ 20 字节）；截断不切坏多字节字符。
8. 空结果 → `file-<epochms>`。
9. 保留中文 / emoji / 空格（需求 FR-P17）。

> 手机端用同名规则只是为了「队列里显示的名字」与最终一致；PC 端在 `init` 时再清洗一次，**以 PC 返回的 `name` 为准**。

### 6.2 同名不覆盖（PC）

```
candidate = name
for n in 0..999:
   target = n == 0 ? candidate : "<base> (n)<ext>"
   try 原子占名:
       POSIX:   fs.link(part, target)   // 已存在 → EEXIST
       Windows: fs.rename(part, target) // 已存在 → EEXIST/EPERM
   on success: POSIX 再 unlink(part); return target
   on EEXIST: continue
最后：<base>-<6 hex><ext>
```

- **禁止**「先 `exists` 再 rename」：POSIX 的 `rename` 会静默覆盖。
- 大小写不敏感文件系统（Windows/macOS 默认）上 `A.pdf` 与 `a.pdf` 视为同名 → 自动 ` (1)`。
- 最终文件名可能比 `init` 返回的更长（带后缀），手机以 `finish` 返回的 `name` 更新 UI。

### 6.3 目录

| 路径 | 用途 |
|---|---|
| `<recv>/.a2-incoming/<upload_id>.part` | 未完成内容（与最终文件同卷，保证原子 rename） |
| `<recv>/.a2-incoming/<upload_id>.json` | 初始化元数据 |
| `<recv>/<name>` | 最终文件 |
| `~/.tea_agent/a2_share/qr.png` | 当前二维码（原子写） |

---

## 7. 剪贴板

### 7.1 文字

- 手机：前台 Activity 读 `ClipboardManager`，≤ 1 MiB。
- 在线：`POST /v1/clipboard/text`。
- 离线：入队 `kind=clipboard_text`，内容写 `files/queue/<id>.txt`，补发时走同一接口。
- PC：写系统剪贴板；失败 → 存 `clipboard-<YYYYMMDD-HHMMSS>.txt` 到接收目录，返回 `degraded`，终端/通知给出原因（如「未找到 xclip/wl-copy」）。

### 7.2 图片

- 手机：`ClipData.Item.getUri()` → 复制到 `files/queue/<id>/clipboard.png` → `kind=clipboard_image` 走**文件上传链路**（同一套分块/续传/幂等）。
- 失败（无 URI / 不可读 / 只有路径字符串）→ 不入队，提示「取不到剪贴板里的图片，请先保存到相册再分享」。
- PC：落盘为 `.png`；`--clipboard-image` 时写系统剪贴板（失败只提示）。

### 7.3 隐私

- 日志字段白名单：`event, peer, device_id, upload_id, name, size, ms, code`。
- 文本正文、图片内容、文件内容**永不进日志**；历史只存元数据。

---

## 8. 心跳、会话与「能连上吗」

| 场景 | 手机动作 |
|---|---|
| 分享时判定（FR-L03） | `GET /v1/hello`，2 s；成功 → 直接传；失败 → 入队 + `OFFLINE_SAME_WIFI` |
| 已连接 | `GET /v1/status` 每 20 s；3 次连续失败 → 退避（2/5/10/30/60/300 s） |
| 收到 401 `session_expired` | 清 token，`SESSION_EXPIRED`，通知重扫；**不再自动重试** |
| 收到 401 `unauthorized` | 同 `session_expired`（无法区分时按需重扫处理） |
| `sid` 与本地不同 | 按「PC 重启」处理（即使请求成功） |
| 连接超时 ×3 | 提示「PC 地址可能已变，请重新扫码」（AC-19） |
| 回到 Wi-Fi（从 `LEFT_WIFI`） | 状态回 `UNPAIRED`；**不探测、不补发**，等扫码 |

---

## 9. 错误目录

| code | HTTP | retryable | 含义 | 手机动作 / 文案 |
|---|---|---|---|---|
| `bad_request` | 400 | 否 | 字段缺失/格式错 | 记日志，标记该条 FAILED |
| `protocol_version` | 426 | 否 | `v` 不支持 | 「PC 版本不兼容，请更新 a2_share」 |
| `unauthorized` | 401 | 否 | token 缺失/错误 | 「配对已失效，请重新扫码」 |
| `session_expired` | 401 | 否 | token 随进程轮换失效 | 同上（FR-L07 / AC-17） |
| `bad_secret` | 401 | 否 | secret/短码错或已用 | 「配对码不对，请重试（还可试 N 次）」 |
| `rate_limited` | 429 | 是（按 `retry_after`） | 配对/请求过频 | 静默等待后重试 |
| `busy` | 429 | 是 | 已有未完成上传 | 等当前完成再发 |
| `not_found` | 404 | 否 | upload 不存在 | 重新 `init`（新 `upload_id`） |
| `upload_conflict` | 409 | 否 | `upload_id` 元数据不一致 | 换新 `upload_id` 重传 |
| `offset_conflict` | 409 | **是（立即）** | offset 与服务端不一致 | 用 `received` 重发；不计失败次数 |
| `incomplete` | 409 | 是 | 未收满就 finish | 继续传剩余字节 |
| `hash_mismatch` | 422 | 否 | 客户端 sha256 与内容不符 | 换新 `upload_id` 重传，提示「文件校验失败」 |
| `too_large` | 413 | 否 | 超过单文件/文本上限 | 「文件过大，未发送」 |
| `insufficient_storage` | 507 | 否 | PC 磁盘不足 | 「PC 存储空间不足，已保存进度」 |
| `internal` | 500 | 是（有限次） | 服务端异常 | 退避重试；连续失败提示看 PC 日志 |

> 客户端实现要求：按 `code` 决策，不按 HTTP 状态猜；未知 `code` 按 `retryable=false` + 通用文案处理。

---

## 10. 版本演进

- 路径 `/v1`；每个 JSON 都必须带 `"v":1`；缺失 → `400 bad_request`；更大 → `426 protocol_version`。
- **只增不改**：加字段可选、可忽略；语义变化或删字段 → `/v2`，并在 PC 端同时挂 `/v1` 至少一个版本。
- 二维码 magic `A2S1` 的最后一位是载荷版本；改布局 → `A2S2`（手机识别到更高版本 → 「请更新 app」）。
- 黄金样本（§11）随版本新增，不删除旧样本。

---

## 11. 黄金样本（`tools/vectors/v1.json` 的内容）

> 两端单测都读这份；下面数值已用 Python 实算校验（base32 / HMAC / 载荷长度）。

```json
{
  "qr": {
    "valid": [
      {
        "payload": "A2S1-K5Q2M7Z3XJ4W6NRA-C0A80117-22C3-BVQFQF3-SUNKW-X",
        "expect": {
          "secret": "K5Q2M7Z3XJ4W6NRA",
          "ip": "192.168.1.23",
          "port": 8899,
          "issued": 1795342523,
          "name": "SUNKW-X",
          "length": 51
        }
      },
      {
        "payload": "A2S1-K5Q2M7Z3XJ4W6NRA-C0A80117-22C3-BVQFQF3",
        "expect": {
          "secret": "K5Q2M7Z3XJ4W6NRA",
          "ip": "192.168.1.23",
          "port": 8899,
          "issued": 1795342523,
          "name": null,
          "length": 43
        }
      }
    ],
    "invalid": [
      {"payload": "A2S2-K5Q2M7Z3XJ4W6NRA-C0A80117-22C3-BVQFQF3", "error": "protocol_version"},
      {"payload": "A2S1-K5Q2M7Z3XJ4W6NR-C0A80117-22C3-BVQFQF3", "error": "bad_payload"},
      {"payload": "A2S1-K5Q2M7Z3XJ4W6NRA-7F000001-22C3-BVQFQF3", "error": "bad_address"},
      {"payload": "A2S1-K5Q2M7Z3XJ4W6NRA-C0A80117-0000-BVQFQF3", "error": "bad_port"},
      {"payload": "a2s1-k5q2m7z3xj4w6nra-c0a80117-22c3-bvqfqf3", "error": "bad_payload"}
    ]
  },
  "short_code": {
    "secret": "K5Q2M7Z3XJ4W6NRA",
    "expect": "093511",
    "rule": "HMAC-SHA256(key=UTF8(secret), msg=\"a2s-pair\") 前 4 字节 BE % 1000000，6 位补零"
  },
  "pair_request": {
    "v": 1, "method": "qr", "secret": "K5Q2M7Z3XJ4W6NRA",
    "device": {"id": "6f0c2a1e-3b4d-4c5e-8f90-123456789abc", "name": "Xiaomi 14", "model": "2311DRK48C", "android": 34, "app": "1.0.0"}
  },
  "pair_response": {
    "v": 1,
    "token": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "session": {"sid": "a1b2c3d4", "generation": 4},
    "pc": {"id": "8c1d2e3f-4a5b-4c6d-8e9f-abcdefabcdef", "name": "SUNKW-X1", "platform": "win32"},
    "limits": {"max_upload_bytes": 4294967296, "max_chunk_bytes": 8388608, "clipboard_text_bytes": 1048576},
    "server_time": 1795342523
  },
  "init_request": {
    "v": 1, "upload_id": "0b9e7c1a-2d3e-4f50-9a1b-2c3d4e5f6071",
    "kind": "file", "name": "报告 v2.pdf", "size": 5242880,
    "mime": "application/pdf", "created_at": 1795342523000, "sha256": null
  },
  "error_envelope": {
    "error": {
      "code": "offset_conflict", "message": "offset 1200 != received 4096",
      "retryable": true, "hint": "从 received 继续", "request_id": "a1b2c3d4", "received": 4096
    }
  }
}
```

---

## 12. 两端一致性检查清单

实现完成后逐项打勾（任何一项不一致都会在真机上以「偶发」形式爆炸）：

- [ ] base32 字母表是 `ABCDEFGHIJKLMNOPQRSTUVWXYZ234567`，**大写**、无填充。
- [ ] 二维码按**固定偏移**解析（`5/22/31/36/44`），不按 `-` split。
- [ ] IP/端口 hex 大写且左补 0；端口拒绝 0；IP 拒绝回环/链路本地/组播。
- [ ] 时间戳 7 个字符、5 bit/字符、值当 32 bit；解析后仅展示。
- [ ] 短码用 `secret` **字符串的 UTF-8 字节**做 HMAC key，msg 固定 `a2s-pair`，取前 4 字节 BE。
- [ ] 配对成功立即轮换；旧 token 失效；`qr.png` 原子重写。
- [ ] 认证失败时**不读 body**、销毁连接、不落盘、不进历史。
- [ ] `offset != received` 返回 409 + `received`；客户端切换后**不增加失败次数**。
- [ ] 服务端 `received = .part 实际大小`；不依赖内存计数或每块 meta。
- [ ] `finish` 同遍读盘算 sha256 + md5；`size` 不符返回 409 `incomplete`。
- [ ] 同名占名用 `link`（POSIX）/失败重试（Windows），**绝不覆盖**。
- [ ] 剪贴板正文与文件内容不进日志；日志只有白名单字段。
- [ ] 心跳 20 s；401 → `SESSION_EXPIRED` → 不再自动重试；`sid` 变化按重启处理。
- [ ] 离开 Wi-Fi → 清 token/地址、取消在传、保留续传点；回来必须重扫。
- [ ] 所有错误响应都有 `{code,message,retryable,hint,request_id}`。
- [ ] PC：`protocol_version = "HTTP/1.1"`、每个响应有 `Content-Length`、401 不读 body、`handle_expect_100` 已覆盖。
- [ ] PC：`rfile.read()` 循环读满 `Content-Length`，socket 超时 15 s/60 s 生效；Ctrl-C 走 `shutdown()`。
