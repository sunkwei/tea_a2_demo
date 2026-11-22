# a2_share · 技术设计

> **版本** v1.0 ｜ **状态** 设计定稿，待开发（开发在另一台机器） ｜ **日期** 2026-11-22
> **上游** [`REQUIREMENTS.md`](REQUIREMENTS.md)（唯一需求事实源，v1.0 定稿）
> **配套** [`PROTOCOL.md`](PROTOCOL.md)（线缆协议 v1，两端照着实现）
> **本文回答** 附录 C 留给实现阶段的四件事：协议形态、模块拆分、技术选型、落地顺序。

---

## 0. 一页结论

| 维度 | 定稿 |
|---|---|
| 拓扑 | **PC 监听、手机主动连**：PC 跑 HTTP/1.1 服务（默认 `0.0.0.0:8899`），手机是纯客户端 |
| PC 端 | **Python 3.11+（本机 3.14.10 已验证），零第三方运行时依赖**：`http.server` + 自写最小 PNG 编码 + vendored 单文件 QR 编码器 |
| Android 端 | **Kotlin + 经典 View（不用 Compose）+ 框架 SQLite（不用 Room）**，`minSdk 29 / targetSdk 34`，无 GMS、无 NDK |
| 扫码 | **CameraX + ZXing core（纯 Java）**；相册选图识别 + 6 位短码兜底 |
| 传输 | **自定义 HTTP 分块上传**：`init → PUT chunk(offset) → finish`，服务端 `.part` 落盘、按 offset 续传、幂等 |
| 配对 | 二维码载荷 **≤51 字节**（alphanumeric），**每配对一次就轮换**；短码与二维码同源、一次性；单设备 token |
| 连接生命周期 | 手机侧 `ConnectivityManager` 网络句柄判定 Wi-Fi 作用域；离开即清 token；PC 重启 = `sid` 变化 → 必须重扫 |
| 队列 | 框架 SQLite 单表 + 文件目录；5 文件 / 10 剪贴板双额度、FIFO、TTL、字节护栏、跨进程可恢复 |
| 保活 | 有队列/传输时前台服务（`dataSync`）+ 心跳退避（20s→5min）；空闲且无队列则停服务（省电） |
| 验收 | 分层：纯逻辑单测 → 协议黄金样本（两端共用）→ PC 端 Python 集成闭环 → 真机 AC 清单 |
| 工作量 | 约 **12–16 人日**（单人，含真机调试），分 M0–M7 七个里程碑 |

**一句话路线**：先把「PC 能被 curl 喂文件」和「短码配对」跑通（M1–M2），再上分享目标（M3）——相机扫码是最容易拖时间的部分，不放在主链路上。

---

## 1. 设计假设、边界与不做

### 1.1 假设（不成立时的影响写在各条后面）

| ID | 假设 | 不成立时 |
|---|---|---|
| A1 | PC 与手机在同一 L2 局域网，**AP 未开客户端隔离**（访客 Wi-Fi 常隔离） | 表现为 `hello` 超时 → 手机提示「连不上 PC，请检查是否同一 Wi-Fi / 访客网络隔离」，不做补救 |
| A2 | PC 至少有一个私网 IPv4（`10/8`、`172.16/12`、`192.168/16`） | IPv6-only 环境不在 v1 范围；`--ip` 可手工指定 |
| A3 | 手机可以侧载 APK（无 Play 商店依赖） | 开发机需 `adb install` 或文件管理器安装 |
| A4 | PC 用户能运行 PowerShell（Windows 剪贴板/通知走它） | 降级为「只存文件」并提示（FR-C11） |
| A5 | 文件大小可由 `ContentResolver` 或复制后 `stat` 得到 | 取不到时先复制再 stat；复制失败则明确报错，不入队 |
| A6 | PC 时钟大致正确（QR 时间戳仅作展示/排障，不参与鉴权） | 无影响（避免时钟偏差把配对卡死） |
| A7 | 同一时刻只服务**一台**手机（Q-07 默认） | 第二台配对会顶掉第一台；P1 再做多设备 |
| A8 | 传输期间手机存储 ≥ 2×文件大小 + 200 MB（先复制再上传） | 预检失败 → 明确提示剩余空间，不入队 |

### 1.2 边界条件（实现必须显式处理）

- **0 字节文件**、1 字节文件、正好 100 MB、超过 100 MB、1 GB、4 GiB 上限。
- 文件名：中文 / emoji / 空格 / 前后空格 / 结尾点号 / Windows 保留名（`CON`、`PRN`、`NUL`、`AUX`、`COM1`…）/ 超长（>255 UTF-8 字节）/ 控制字符 / RTL。
- 同名（含大小写不敏感文件系统上的 `A.pdf` 与 `a.pdf`）、多文件同一次分享、同一次分享里文本与图片并存。
- 剪贴板：只有 HTML、只有路径字符串、URI 不可读、图片超 10 MB、文本 5 MB。
- 网络：切换 AP 但同 SSID、同 AP 漫游、短暂掉线 1 秒、开 VPN、开热点、飞行模式、Doze/厂商冻结。
- 进程：手机 App 被杀（队列不丢、`.part` 可续）、PC 进程被杀（重启后手机必须重扫，但服务端 `.part` 仍可续）、PC 磁盘满、PC 端口被占。
- 时间：剪贴板 24h / 文件 7 天过期边界；用户手动改系统时间（TTL 以墙上时间为准，检测到回拨 > 1h 只告警、不清数据，见 §6.2）。

### 1.3 明确不做（与需求 §2.2 一致，另加设计层判断）

- 不做 TLS（见 §9.4 的权衡）、不做 mDNS 自动发现（与「离开 Wi-Fi 必须重扫」冲突）、不做 WebSocket/SSE（轮询足够，见 §3）。
- 不做 PC 端 Web UI、不做手机端多目标并发传输、不做文件夹同步。
- 不做 IPv6、不做 iOS。

---

## 2. 总体架构

### 2.1 部署形态

```
┌──────────────────────────── 手机（Android 10–16，无 GMS） ────────────────────────────┐
│  a2_share APK (com.tea.a2share)                                                       │
│  ┌──────────────┐  ┌────────────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ ShareActivity│  │  MainActivity      │  │ ScanActivity │  │ TransferService   │  │
│  │ (透明确认条) │  │  状态/队列/设置    │  │ 相机+短码    │  │ 前台服务 + 心跳   │  │
│  └──────┬───────┘  └─────────┬──────────┘  └──────┬───────┘  └─────────┬─────────┘  │
│         └──────────────┬─────┴────────────────────┴────────────────────┘            │
│                 ┌──────▼───────────────────────────────────────────────┐              │
│                 │ core（纯 Kotlin，无 Android 依赖，可 JVM 单测）       │              │
│                 │  QrPayload · QuotaPolicy · SafeName · PairPolicy     │              │
│                 │  TransferStateMachine · Backoff · ApiDto            │              │
│                 └──────┬───────────────────────────┬───────────────────┘              │
│          ┌─────────────▼──────────┐     ┌──────────▼──────────────┐                  │
│          │ data: SQLite 队列/凭据 │     │ net: HttpURLConnection  │                  │
│          │ files/queue, files/inbox│    │ + ConnectivityMonitor   │                  │
│          └────────────────────────┘     └──────────┬──────────────┘                  │
└─────────────────────────────────────────────────────┼────────────────────────────────┘
                                                      │ Wi-Fi（同一 L2）
                                                      │ HTTP/1.1 + Bearer token
┌─────────────────────────────────────────────────────▼────────────────────────────────┐
│  PC：a2_share CLI（Python 3.11+，独立进程，与 tea_a2:8383 互不相干）                   │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌───────────┐ ┌────────────┐  │
│  │  session │ │   qr     │ │  http     │ │ uploads  │ │ clipboard │ │  notify    │  │
│  │ 凭据/短码│ │ 载荷+PNG │ │ 路由/认证 │ │ 续传/落盘│ │ 平台适配  │ │ 平台适配   │  │
│  └──────────┘ └──────────┘ └─────┬─────┘ └────┬─────┘ └───────────┘ └────────────┘  │
│         ┌──────────────────────────▼────────────▼──────────────────────────┐          │
│         │ 磁盘：~/.tea_agent/a2_share/{config.json,qr.png,log}              │          │
│         │       ~/Downloads/a2_share/{文件…, .a2-incoming/<id>.part}         │          │
│         └───────────────────────────────────────────────────────────────────┘          │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 职责边界

| 关注点 | 归谁 | 说明 |
|---|---|---|
| 会话凭据的有效期 | **两端共同**：PC 进程重启即换凭据；手机在离开 Wi-Fi 时主动丢弃 | PC 无法感知手机换网，所以「Wi-Fi 会话」这条约束由手机侧执行；PC 侧靠「配对后轮换 + 单设备 + `--reset-identity`」收口 |
| 「能连上 PC 吗」 | 手机 | `GET /v1/hello`，2 秒超时；失败就进队列，不当错误（R-17） |
| 「PC 重启了吗」 | 手机 | 比对 `hello.sid` 与本地保存的 `sid`；不同 → 提示重扫 |
| 「文件完整性」 | PC | `finish` 时校验字节数并计算 SHA-256，写进日志与响应 |
| 「配额/淘汰/TTL」 | 手机 | PC 不关心队列；PC 只做单文件 4 GiB 的硬护栏 |
| 「同名不覆盖」 | PC | 落盘时用 link/rename 原子占名，冲突加 ` (n)` |

### 2.3 为什么不是这些方案

| 备选 | 否决理由 |
|---|---|
| 手机当服务端、PC 主动拉 | 手机 IP 每换网就变，PC 无从发现；且要求 PC 常驻轮询 |
| WebSocket / SSE 双向通道 | 只有「上传 + 心跳 + 配对」三件事，HTTP 请求/响应足够；少一套帧协议与重连语义 |
| mDNS/Bonjour 发现 PC | 与 D7（离开 Wi-Fi 必须重扫）直接冲突，且给同网段陌生设备更多可乘之机 |
| 云端中转 | 违反需求 §2.2（范围）与需求 §1.3.5（隐私克制） |
| 复用 tea_a2 的隧道/peer 通道 | PC 端要求独立进程、独立端口，不依赖 tea_a2（D8/FR-C15） |

---

## 3. 技术选型

### 3.1 PC 端：Python 3.11+，零第三方运行时依赖

| 决策 | 选择 | 备选 | 理由 |
|---|---|---|---|
| 语言/运行时 | **Python 3.11+**（本机 3.14.10 实测） | Node 20+ | 用户指定优先 Python；stdlib 足够；开发机自带 Python，不需要 Node/npm |
| HTTP | `http.server.ThreadingHTTPServer` + `BaseHTTPRequestHandler`（自写路由、流式落盘） | FastAPI+uvicorn / Flask | 只有 ~10 个路由；框架要 pip 依赖与 ASGI/WSGI 栈。线程模型对「单手机串行上传」足够，`rfile/wfile` 可直接流式 |
| 并发 | 线程 + 每 `upload_id` 一把 `threading.Lock` | asyncio | 逻辑简单可读；`hashlib`/文件写期间释放 GIL；不自己写异步 HTTP |
| 二维码 PNG | vendored `qrcodegen.py`（Nayuki，MIT）+ `zlib/struct` 手写 ~40 行 PNG | `segno`/`qrcode`（pip） | 单文件纯 Python、支持 alphanumeric + 纠错等级；离线可构建 |
| CLI | `argparse` | click/typer | stdlib |
| 剪贴板/通知 | 平台适配：Windows 文本走 `ctypes` 快路径，失败回退 PowerShell；图片 PowerShell `-Sta` | 原生扩展 | 无编译；失败可降级（FR-C11） |
| 测试 | `unittest` + `http.client` | pytest | 零依赖，`python -m unittest` 直接跑 |
| 分发 | `python pc/a2_share.py`（附 `a2_share.cmd` / `a2_share` 包装）；可选 `pyproject.toml` 供 pipx | PyInstaller | 源码 <300 KB、零依赖；NFR-04 的 20 MB 按「程序 + 依赖」计，Python 运行时由系统提供 |

> 依赖政策：`pc/pyproject.toml` 的 `dependencies = []`（构建后端仅在 `pipx install` 时需要，可选）；vendored 代码必须带 LICENSE 头与来源注释。主路径 `python pc/a2_share.py` 不读 `pyproject.toml`。
> **NFR-04 口径**：不打包 Python 运行时（与 Node 方案同理，运行时由系统提供）；若要单文件 exe，PyInstaller 产物约 10–15 MB，列 P2。

**Python 特有的实现约束**（对应 §12 D-R3，必须写进代码）：

- `BaseHTTPRequestHandler.protocol_version = "HTTP/1.1"`；否则 keep-alive 失效，1 GB 上传每块重建连接。
- 每个响应（含错误信封）必须显式 `Content-Length`，否则客户端挂到超时。
- 401 时 `close_connection = True` 且**不读 body**；同时覆盖 `handle_expect_100()`，未授权先回 401（Java/Android 客户端可能带 `Expect: 100-continue`）。
- 任何在读完 body 之前返回的错误（401 / 409 / 413 / 507）都必须 `Connection: close`；keep-alive 下残留字节会被当成下一个请求行。
- `ThreadingHTTPServer.daemon_threads = True`、`allow_reuse_address = True`；Ctrl-C 用 `server.shutdown()` + `server_close()`，不靠 `sys.exit`。
- 连接超时：读完请求头 15 s、读 body 60 s（`self.connection.settimeout`）；`rfile.read()` 循环读满 `Content-Length`，短读即断开并保留 `.part`。
- 落盘 64 KiB buffer 循环写；`hashlib.sha256/md5` 在同一遍 `update`；不要 `read()` 整块再写。
- 连接数设上限（建议信号量 16），防慢客户端堆积线程。
- 覆盖 `version_string()`（只报 `a2_share/1.0`），不暴露 Python 版本；`log_message()` 交给自己的日志模块，不写 stderr。
- `ThreadingHTTPServer` 只是局域网工具，不面向公网；不要开目录列表、不要复用 `SimpleHTTPRequestHandler` 的静态文件逻辑。

### 3.2 Android 端：Kotlin + 框架能力，最小依赖

| 决策 | 选择 | 备选 | 理由 |
|---|---|---|---|
| UI | 经典 View + ViewBinding | Jetpack Compose | Compose 拉入 runtime/compiler，构建慢、APK 大；本 app 只有 4 个界面 |
| 存储 | `android.database.sqlite.SQLiteOpenHelper` + 薄 DAO | Room | 只有一张队列表；Room 要 KSP 与版本对齐（R-18），收益不足以抵消构建风险。表结构膨胀时再迁 Room（预留 `version` 迁移位） |
| 网络 | `HttpURLConnection` 封装（固定长度流式 PUT） | OkHttp | 无需连接池/拦截器；明文 HTTP，无 TLS；封装层隔离，日后可换 |
| 并发 | Kotlin 协程（`kotlinx-coroutines-android`）+ `StateFlow` | Executor + Handler | 状态机/竞态可读性好；依赖小且稳定 |
| 扫码 | CameraX（camera2/lifecycle/view）+ ZXing `core`（纯 Java） | ML Kit（GMS，违反 NFR-12）、`zxing-android-embedded`（拉 appcompat） | 无 GMS、体积可控、CameraX 生命周期简单 |
| 图片/JSON | `org.json`（框架）+ `BitmapFactory` | Gson/Moshi/kotlinx-serialization | 报文小；少一个依赖。DTO 手写 `toJson/fromJson` 并单测 |
| 后台 | 前台服务 `dataSync` + `START_STICKY` + partial wakelock（仅传输时） | WorkManager | 避免 Android 12+ 后台启动 FGS 限制；保证息屏传输（AC-08）。WorkManager 作为 P1 兜底再评估 |
| 下载/构建 | Gradle wrapper 8.6、AGP 8.2.2、Kotlin 1.9.22、JDK 17、compileSdk 34 | 更新版本 | 与 tea_a2 `android/` 验证过的组合一致，直接复用其踩坑经验（`docs/android.md`） |

**预估 APK 体积**：Kotlin stdlib ≈1.7 MB + CameraX ≈2.5 MB + ZXing core ≈0.5 MB + 协程 ≈0.2 MB + 自身资源 ≈0.5 MB ≈ **5.5–6 MB**（< 10 MB，NFR-04）。构建后以 `assembleRelease` + `apkanalyzer` 复核。

### 3.3 版本矩阵（另一台机器照此准备）

| 组件 | 版本 | 备注 |
|---|---|---|
| JDK | 17 | AGP 8.2 硬性要求；显式 `JAVA_HOME`（本机默认 java 是 25，会报错） |
| Android SDK | platform 34 / build-tools 34.0.0 | 不需要 NDK |
| Gradle | 8.6（wrapper） | 不依赖系统 Gradle |
| AGP / Kotlin | 8.2.2 / 1.9.22 | 与 tea_a2 相同；`buildFeatures.viewBinding true` |
| CameraX | 1.3.4（`camera-core`/`camera-camera2`/`camera-lifecycle`/`camera-view`） | 扫码预览与帧分析 |
| ZXing core | 3.5.3 | 纯 Java，无 appcompat / 无 GMS |
| Kotlin 协程 | 1.7.3（`kotlinx-coroutines-android`） | 队列泵/状态机 |
| minSdk / targetSdk | 29 / 34 | 覆盖 Android 10–16；避开 26–28 的分区存储差异 |
| Python | ≥ 3.11（本机 **3.14.10** 实测；不装第三方包） | PC 端与 e2e/自检脚本 |
| 真机 | Android 10–16 各一台（至少一台 HyperOS/ColorOS） | 验收 NFR-05 |

> Windows 上 `python` 可能是 Microsoft Store 的别名（会弹商店）：包装脚本按 `py -3` → `python3` → `python` 的顺序探测；三者都没有时打印安装指引并退出 2。

---

## 4. 模块划分

### 4.1 PC 端（`a2-share/pc/`）

```
pc/
├── a2_share.py            # 入口：参数、启动、信号处理、Ctrl-C
├── a2share/
│   ├── __init__.py
│   ├── cli.py             # argparse / --help / 默认值
│   ├── paths.py           # 状态目录、接收目录、跨平台路径（A2_SHARE_HOME 供测试）
│   ├── config.py          # config.json 读写（原子写）
│   ├── session.py         # sid / secret / 短码 / token / 轮换 / 常数时间比对 / 限流
│   ├── qr.py              # 载荷编解码（A2S1）+ 矩阵生成（调 vendor）
│   ├── png.py             # 最小 PNG 编码（zlib + struct）
│   ├── server.py          # ThreadingHTTPServer、路由、认证、错误信封、请求日志
│   ├── uploads.py         # init / append / finish / abort / recover / 每 id 锁
│   ├── safe_name.py       # 文件名清洗、保留名、长度、碰撞占名（link/rename）
│   ├── clipboard.py       # write_text / write_image / probe（平台分支）
│   ├── notify.py          # 桌面通知（平台分支，失败静默）
│   ├── opener.py          # --open：用系统看图工具打开 PNG（平台分支）
│   ├── net.py             # 本机 IPv4 挑选、IP 变化监视、网段判断
│   ├── history.py         # 元数据历史（P1；JSONL，滚动 100 条）
│   └── log.py             # JSONL 日志 + 人类可读终端输出 + 轮转
├── vendor/qrcodegen.py    # Nayuki QR 编码（MIT，附来源与 LICENSE）
├── tests/                 # unittest：codec / name / uploads / server 集成
├── pyproject.toml         # 可选 pipx 安装；dependencies = []
├── a2_share.cmd           # Windows 包装：python "%~dp0a2_share.py" %*
└── a2_share               # POSIX 包装：exec python3 .../a2_share.py "$@"
```

**模块依赖方向**（无环）：`cli → server → {session, uploads, history, log}`；`uploads → {safe_name, paths, log}`；`qr → {vendor, png}`；平台适配（clipboard/notify/net/opener）只被 server/入口调用。所有模块不读全局状态（config 显式传入），便于测试注入。

### 4.2 Android 端（`a2-share/phone/app/src/main/java/com/tea/a2share/`）

```
com.tea.a2share
├── App.kt                     # 进程级容器（手写单例，无 DI 框架）
├── core/                      # ← 纯 Kotlin，无 android.* 引用，JVM 单测
│   ├── QrPayload.kt           # 载荷解码 + 校验（与 pc/a2share/qr.py 同一套规则）
│   ├── ApiDto.kt              # 请求/响应 DTO 与手写 JSON 编解码
│   ├── QuotaPolicy.kt         # 额度/淘汰/字节护栏/单文件上限的纯决策
│   ├── SafeName.kt            # 手机端名称清洗（与 PC 端规则对齐）
│   ├── PairPolicy.kt          # 会话状态机（UNPAIRED/CONNECTED/…）
│   ├── TransferMachine.kt     # 单条传输状态机 + 退避
│   └── Expiry.kt              # TTL 判定（墙上时间；回拨只告警）
├── data/
│   ├── DbHelper.kt            # SQLiteOpenHelper（version=1，预留迁移）
│   ├── QueueDao.kt            # 事务性增删改查、按状态/时间取
│   ├── QueueRepository.kt     # 入队（含配额决策）、状态迁移、清空、剪枝
│   ├── Prefs.kt               # 配对凭据、设置（allowBackup=false）
│   └── Files.kt               # files/queue、files/inbox 的落盘与清理
├── net/
│   ├── HttpTransport.kt       # 接口（便于单测替身）
│   ├── HttpUrlTransport.kt    # HttpURLConnection：hello/pair/status/init/put/finish/clipboard
│   ├── ConnectivityMonitor.kt # NetworkCallback：Wi-Fi 作用域、句柄、前后台事件
│   └── PcClient.kt            # 业务级调用：探测、配对、上传、心跳
├── svc/
│   ├── TransferService.kt     # 前台服务：队列泵、心跳、退避、通知、START_STICKY
│   └── Notifications.kt       # 渠道：传输/连接/告警
├── ui/
│   ├── MainActivity.kt        # 连接状态卡、扫码入口、发送剪贴板、队列、设置
│   ├── ShareActivity.kt       # 透明主题：确认条、复制到 inbox、入队
│   ├── ScanActivity.kt        # CameraX + ZXing + 短码输入 + 相册识别
│   ├── QueueFragment.kt       # 列表、重发/删除/清空、进度
│   └── SettingsActivity.kt    # 确认开关、后台引导（FR-P13）、隐私、清空
└── res/values/strings.xml     # 全部文案走资源（NFR-10），中文为默认
```

**关键约束**：`core/` 里不允许出现 `android.*`（用单测守住，`test` 里直接跑 JVM）；`core/` 的输入输出都是数据类，Android 适配层只做「读系统 → 调 core → 写系统」。

**Manifest 要点**（M2/M3 开工前先落）：

- `ShareActivity`：`exported=true`、`launchMode=singleTop`、透明主题；`<intent-filter>` 覆盖 `ACTION_SEND`（`*/*` 与 `text/plain`）与 `ACTION_SEND_MULTIPLE`（`*/*`）。
- 权限：`INTERNET`、`ACCESS_NETWORK_STATE`、`CAMERA`、`POST_NOTIFICATIONS`(33+)、`FOREGROUND_SERVICE`、`FOREGROUND_SERVICE_DATA_SYNC`、`WAKE_LOCK`；**不申请**存储/位置权限（分享 URI 自带授权，相册选图走系统 picker）。
- **明文 HTTP 必须显式放行**：`<application android:usesCleartextTraffic="true">`（或 network-security-config 只放行私网 IP），否则 Android 9+ 直接拒绝连接。
- 服务：`TransferService` 声明 `android:foregroundServiceType="dataSync"`；`allowBackup=false`。
- 一条命令出 APK：`npm run a2share:build` → 显式 `JAVA_HOME=<jdk17>` + `./gradlew assembleRelease`（debug key 签名，侧载即用）。该脚本是 APK 构建，和 PC 端的 Python 运行时无关。

### 4.3 两端共享的契约

- **协议**：`PROTOCOL.md`（唯一线缆事实源）。
- **黄金样本**：`tools/vectors/v1.json`（QR 载荷、配对/上传请求响应样例、错误码），Python 单测与 Android 单测都读它（Gradle `sourceSets.test.resources.srcDir("../../tools/vectors")`）。
- **名称清洗规则**：同一张表（`PROTOCOL.md` §6），两端各自实现、同一组测试向量验证。

---

## 5. 接口定义（摘要）

### 5.1 PC HTTP API（详见 `PROTOCOL.md` §4）

| 方法 | 路径 | 认证 | 作用 |
|---|---|---|---|
| GET | `/v1/hello` | 否 | 探活/取 PC 名与 `sid`（心跳、配对前探测） |
| POST | `/v1/pair` | 否（凭 secret/短码） | 配对换 token；成功即轮换二维码 |
| GET | `/v1/status` | 是 | 心跳、会话状态 |
| POST | `/v1/uploads` | 是 | 初始化上传，返回服务端已收字节数 |
| PUT | `/v1/uploads/{upload_id}?offset=N` | 是 | 追加原始字节（请求体即文件片段） |
| POST | `/v1/uploads/{upload_id}/finish` | 是 | 落盘定名、校验、返回 SHA-256 + MD5 |
| DELETE | `/v1/uploads/{upload_id}` | 是 | 放弃并清理 `.part` |
| GET | `/v1/uploads/{upload_id}` | 是 | 查询续传点（App/PC 重启后） |
| POST | `/v1/clipboard/text` | 是 | 写 PC 剪贴板（失败降级存 .txt） |
| GET | `/v1/history` | 是 | 元数据历史（P1） |

统一错误信封沿用 tea_a2 约定：`{"error":{"code","message","retryable","hint","request_id"}}`；错误目录见 `PROTOCOL.md` §9（P1 再做 `GET /v1/errors` 接口）。

### 5.2 PC CLI（需求 §8.4 + 设计新增项）

| 命令 | 行为 |
|---|---|
| `a2_share` | 接收模式（默认） |
| `--dir <path>` `--port <n>` `--qr-out <png>` | 同需求 |
| `--open` `--no-notify` `--history` `--reset-identity` `--selftest` | 同需求 |
| `--bind <ip>` | 绑定地址（默认 `0.0.0.0`；多网卡排障用） |
| `--ip <ip>` | **二维码里写哪个 IP**（默认自动挑私网 IPv4） |
| `--clipboard-image` | 剪贴板图片同时写入系统剪贴板（默认只存文件，见 §13-Q3） |
| `--home <dir>` | 状态目录覆盖（默认 `~/.tea_agent/a2_share`；测试用） |
| `--json` | 终端输出结构化 JSONL（供 e2e 脚本解析） |
| `--log-level <debug|info|warn>` | 日志级别 |
| `--version` | 打印版本（`a2_share 1.0.0`），装错解释器时用于排障 |

> `a2_share` 是 `pc/a2_share.cmd`（Windows）/ `pc/a2_share`（POSIX）包装，等价于 `python pc/a2_share.py`；`A2_SHARE_HOME` 环境变量与 `--home` 等效（e2e 用）。

### 5.3 Android 内部关键纯函数（签名即契约）

```kotlin
object QrPayload { fun decode(raw: String): Result<Hint, QrError> }        // Hint(secret, ip, port, issued, shortName)

sealed interface QuotaDecision {
  data class Accept(val evict: List<QueueItem>) : QuotaDecision
  data class Reject(val reason: RejectReason) : QuotaDecision               // TooLarge / NotEnoughBytes / NoSpace
}
object QuotaPolicy {
  fun onEnqueue(item: NewItem, snapshot: QueueSnapshot, diskFreeBytes: Long): QuotaDecision
}

sealed interface TransferStep {
  data object Probe : TransferStep
  data class Init(val uploadId: String) : TransferStep
  data class Send(val offset: Long, val length: Int) : TransferStep
  data class Finish(val sha256: String) : TransferStep
  data class Done(val serverName: String) : TransferStep
  data class Wait(val ms: Long, val reason: WaitReason) : TransferStep      // 退避/等网络/等配对
}
object TransferMachine { fun next(state: TransferSnapshot, event: TransferEvent): TransferStep }
```

这些函数是「队列正确性」的核心，全部用 JVM 单测覆盖（§10.1）。

---

## 6. 数据模型

### 6.1 PC 磁盘布局

```
~/.tea_agent/a2_share/
├── config.json        # {version:1, pc_id, name, port, dir, notify, clipboard_image}
├── qr.png             # 当前二维码（原子写：qr.png.tmp → rename）
├── a2_share.log       # JSONL，按大小轮转（5 MB × 3）
├── completed.jsonl    # 已完成的 upload_id 台账（finish 幂等/防重传，滚动 500 条）
└── history.jsonl      # P1：仅元数据，滚动 100 条

<接收目录>/                      # 默认 ~/Downloads/a2_share
├── 报告 v2.pdf                 # 最终文件（UTF-8 原名）
├── .a2-incoming/               # 未完成传输（与最终文件同卷，保证 rename 原子）
│   ├── <upload_id>.part
│   └── <upload_id>.json        # {name,size,mime,kind,device_id,created_at}（不存 received）
└── clipboard-20261122-101530.txt  # 剪贴板降落时的降级产物
```

- **配置原子写**：写临时文件 + `fs.rename`，避免半截 JSON。
- **`.part` 恢复**：`received` 一律取 `stat(part).size`；大于 `meta.size` 时 `truncate` 到 `size`（防异常写入）；meta 里不存 `received`，避免两处真值。
- **`.part` 清理**：启动时删除 7 天未动的残留。
- **权限**：状态目录 0700、文件 0600（Windows 不看 POSIX 位，逻辑仍保留）。

### 6.2 Android SQLite（version = 1）

```sql
CREATE TABLE queue (
  id           TEXT PRIMARY KEY,          -- UUID v4，客户端生成，幂等键
  kind         TEXT NOT NULL,             -- file | clipboard_text | clipboard_image
  display_name TEXT NOT NULL,             -- 原名（UTF-8）
  mime         TEXT,
  size         INTEGER NOT NULL,
  local_path   TEXT,                      -- files/queue/<id>/<name>；clipboard_text 为 .txt；SENT/CANCELED 时置 NULL 并删文件
  sha256       TEXT,                      -- 可选（上传前不算，服务端回填）
  created_at   INTEGER NOT NULL,          -- epoch ms
  updated_at   INTEGER NOT NULL,
  status       TEXT NOT NULL,             -- PENDING|SENDING|SENT|FAILED|EXPIRED|MISSING|CANCELED
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  expires_at   INTEGER,                   -- epoch ms；NULL = 不过期
  upload_id    TEXT,                      -- 续传 id（= id，可不同）
  sent_offset  INTEGER NOT NULL DEFAULT 0,-- 已确认字节（每 4 MiB 块确认后持久化）
  target_pc_id TEXT,
  sent_at      INTEGER
);
CREATE INDEX idx_queue_status_created ON queue(status, created_at);
CREATE INDEX idx_queue_kind_status     ON queue(kind, status);

CREATE TABLE pc (                          -- v1 只允许 1 行；P1 多 PC
  id TEXT PRIMARY KEY, name TEXT, base_url TEXT, token TEXT,
  session TEXT, paired_at INTEGER, last_ok_at INTEGER, wifi_handle TEXT
);
```

**状态语义与额度口径**（落实 FR-Q10）：

| 状态 | 占条数额度 | 占字节额度 | 会自动补发 | 备注 |
|---|---|---|---|---|
| `PENDING` | 是 | 是 | 是 | 待发/待重试 |
| `SENDING` | 是 | 是 | — | 传输中（杀进程后回 `PENDING`） |
| `FAILED` | 是 | 是 | 下次触发时重试 | 3 次失败后停留，等用户/新会话 |
| `SENT` | 否 | 否 | 否 | 内容文件立即删，行保留 24h 供「已发」显示 |
| `EXPIRED` | 否 | **是** | 否 | 标灰；文件仍在磁盘，占字节额度直到清空/淘汰 |
| `MISSING` | 否 | 否 | 否 | 启动自检发现文件被系统清理 |
| `CANCELED` | 否 | 否 | 否 | 用户删除，文件立即删 |

**TTL 实现**：只用 `expires_at` + `created_at`（墙上时间）。启动时若发现当前时间比 `updated_at` 早 1 小时以上（用户回拨），只写日志告警、不批量判过期——TTL 是省存储的策略，不是安全边界。

### 6.3 内存状态（Android，单例）

```
PairState = UNPAIRED | PAIRING | CONNECTED | OFFLINE_SAME_WIFI | LEFT_WIFI | NO_WIFI | SESSION_EXPIRED
QueuePump = IDLE | PROBING | UPLOADING | BACKOFF(until)
Session   = { pcId, name, baseUrl, token, sid, wifiHandle, pairedAt, lastOkAt }
```

- 所有状态变更都过 `QueueRepository` 的事务 + `StateFlow` 广播；UI 只读。
- `SENDING` 的条目在 App 启动时一律回 `PENDING`（先查服务端已收字节再续），避免「假发送中」。

---

## 7. 关键流程

### 7.1 PC 启动

```
加载 config → 确保目录可写 → 恢复 .a2-incoming（截断半块）→
生成 session {sid, secret(80bit), shortCode(6位), generation} →
挑广告 IP（--ip > 私网 IPv4 启发式）→ 渲染 QR → 原子写 qr.png →
打印：PNG 路径 / IP:port / 6 位短码 / 状态目录 →
listen 8899 → 每 3s 检查 IP 变化（变了：重写 QR + 终端提示 FR-C14）
Ctrl-C：关闭监听、清理（保留 .part 与队列外的状态）
```

**启动预算**（NFR-02）：从执行命令到端口可接单 ≤ 1 s（二维码渲染与打印并行/之后完成也不影响接单）；扫码/短码到 `CONNECTED` ≤ 5 s；分享确认到首字节 ≤ 2 s（探测预算 2 s，成功则直接开始 `init`）。

### 7.2 配对（扫码 / 短码同一条路径）

```
手机                           PC
 │  扫 A2S1 载荷                  │
 │  GET /v1/hello (2s)            │ → {v, name, sid, paired, t}
 │  POST /v1/pair {secret,device} │ → 校验 secret 是「当前且未用」
 │                                │   发 token（32B）→ 轮换 secret+短码 → 重写 qr.png
 │ ← {token, sid, pc}             │
 │ 存 Session，状态 CONNECTED      │
 │ 触发队列补发（FIFO）            │
```

- **短码**：`code = f(secret)` 的 6 位数字（同一 `secret` 下稳定），与二维码**同源**；用过即随 secret 轮换失效。
- **限流**：每 IP 5 次/5 分钟；全局 20 次/10 分钟；超限 429 + 锁定 60s（6 位码不可暴力）。
- **失败语义**：只有 `bad_secret`（错码/已用）与 `rate_limited`；第二台手机配对成功会顶掉第一台（§9.3），不设 `already_paired`。

### 7.3 分享文件 → PC

```
ACTION_SEND/SEND_MULTIPLE
 → ShareActivity（透明）：读 ClipData（stream URI 必须当场复制，授权是一次性的）
 → 复制到 files/inbox/<id>/（协程/前台服务里做，带进度；失败则报错不入队）
 → 解析 name/size（OpenableColumns → 兜底 ContentResolver/stat）
 → 确认条（开启时）：显示「名称/大小/目标 PC」→「发送」才继续（FR-P03）
 → 配额决策：超 100MB / 500MB / 空间不足 → 拒绝 + 明确文案
 → 插入 queue(PENDING) → 启前台服务 → 显示通知
 → 队列泵：Wi-Fi? → hello(2s) → init → PUT 4MiB 块（每块持久化 sent_offset）
 → finish → SENT（删内容文件，留行 24h）→ 通知
（多文件：逐个复制、逐个入队；单个失败不影响其它，结束后汇总提示，AC-04）
```

**纯文字分享**（`ACTION_SEND` + `EXTRA_TEXT`、无 stream）：不落成文件，直接入队 `kind=clipboard_text`（PC 写剪贴板）；确认条显示「文字 · N 字」+ 前 60 字预览。带 stream 的分享里附带的 `EXTRA_TEXT`（常见于图片配文）忽略，只发文件——不擅自把配文当剪贴板内容。`ACTION_SEND` 也可能带多条 `ClipData`，统一按 URI 列表处理。

**队列泵串行**：同一时刻只有一条在传（带宽、进度、失败语义都简单）。PC 端协议支持并发，为 P1 留门。

**吞吐预算**（NFR-01）：单流 4 MiB 块 + 两端直写 FD，目标 ≥ 5 MB/s（1 GB ≈ 3.5 分钟）；`finish` 的 sha256+md5 一遍读盘约 2–5 s/GB（`hashlib` 是 C 实现），手机侧 `finish` 超时给 30 s。实测值记进 README 的验收表。

### 7.4 离线缓存与自动补发

```
触发点：入队 / 配对成功 / 网络恢复为 Wi-Fi / 服务心跳 tick / 用户点重发
 → 取 PENDING|FAILED 的最旧一条（FIFO）
 → 依次尝试；失败按 2s/4s/8s 退避，3 次后置 FAILED 并提示
 → 全部完成 → 通知汇总
```

- 额度与淘汰在**入队瞬间**完成（同步、事务），不在补发时做——这样「挤掉谁」对用户可解释。
- 淘汰/过期/失效各自通知，不静默（FR-Q03）。

### 7.5 断点续传（两端崩溃都要能续）

```
手机 init(upload_id, name, size) → PC 若已有 .part：{received, name}
  received < size → 从 received 开始 PUT
  PUT offset != received → 409 {received}（手机立即对齐，不计失败次数）
  每次 200 后：手机持久化 sent_offset（每块一次，4 MiB 粒度）
finish → PC 校验 size，算 SHA-256 → 探测候选名并写 completed 意图 → 原子占名（撞名追加意图重试）→ 标记 done → {name, size, sha256}
（重启后按意图核对文件，保证重放 finish 幂等，防 AC-25 重复）
```

- PC 崩溃：重启后 `init` 读 `.part` + meta，`received` = `.part` 实际大小（大于 `size` 时截断）。
- 手机崩溃：`SENDING` 回 `PENDING`，`sent_offset` 直接复用。
- 传输中手机离开 Wi-Fi：取消请求、保留 `upload_id` 与 `sent_offset`，回队列。

### 7.6 剪贴板

```
文字：Activity 前台读 ClipboardManager → ≤1MiB → POST /v1/clipboard/text
      PC 写系统剪贴板；失败 → 存 clipboard-<时间>.txt 并回 {clipboard:"degraded"}
      离线：kind=clipboard_text 入队（内容落 .txt，不进日志）
图片：读 item.uri → 复制成 .png → 与文件同一条上传链路（kind=clipboard_image）
      PC 落盘；--clipboard-image 时再写系统剪贴板（失败只提示，不影响落盘）
取不到：明确提示「取不到剪贴板里的图片，请先保存到相册再分享」（FR-P05）
```

### 7.7 离开 Wi-Fi 作用域（FR-L04 / FR-P16）

```
ConnectivityMonitor（NetworkCallback，WIFI transport）
  onLost(当前网络) 或 onCapabilitiesChanged(非 WIFI 活动网络) 或 networkHandle 变化
   → 状态 LEFT_WIFI / NO_WIFI
   → 立即：取消在传请求（保留续传点）→ 清 token/baseUrl/sid → 停心跳
   → 通知「已离开原 Wi-Fi，需要重新扫码连接 PC」；队列原样保留
   → 回到 Wi-Fi：状态仍为 UNPAIRED（不自动连、不自动补发），必须扫码/短码
判定依据只取「Wi-Fi 传输类型 + Network 句柄」，不读 SSID/BSSID（避免申请定位权限）。
同 AP 重连也会换 Network 对象 → 触发作废，符合 AC-28/29。
漫游误判用「UI 800ms 防抖 + 日志」处理（R-08），不改变作废策略。
```

### 7.8 PC 重启 / 换 IP

| 事件 | 手机如何知道 | 行为 |
|---|---|---|
| PC 进程重启 | `hello.sid` 变化，或任意接口 401 `session_expired` | 停重试，状态 `SESSION_EXPIRED`，通知「请重新扫码」（AC-17） |
| PC 掉线后恢复（未重启） | 心跳/探测失败后重试成功，`sid` 不变 | 自动重连、自动补发（AC-18） |
| PC 换 IP | 旧 `base_url` 连不上（超时/拒绝） | 连续 3 次失败 → 提示「PC 地址可能已变，请重新扫码」（AC-19）；PC 侧已重写 `qr.png` |
| 用户 `--reset-identity` | 401（token 失效） | 同「重启」，提示重扫 |

心跳节奏：CONNECTED 时 20s；失败后 2s/5s/10s/30s/1min/5min 退避；有队列时服务常驻，队列空且 30 分钟无活动 → 停前台服务（通知消失），App 打开时再启。

---

## 8. 失败场景与恢复矩阵

| # | 失败 | 检测 | 用户看到 | 系统行为 |
|---|---|---|---|---|
| 1 | PC 没启动 | `hello` 超时/拒绝（2s） | 「PC 未连接，内容已缓存，PC 上线后会自动发送」 | 入队 PENDING；心跳退避；不报错 |
| 2 | 当前不是 Wi-Fi | Connectivity 判定 | 「当前不是 Wi-Fi，已缓存。等回到 Wi-Fi 再发」 | **不发任何连接**（AC-27） |
| 3 | 同一 Wi-Fi 但 PC 换 IP | 连接失败 ×3 | 「PC 地址可能已变，请重新扫码」 | 保留队列，停自动重试（等扫码） |
| 4 | PC 进程被杀（传输中） | 连接断开 | 「PC 断开了，已保存进度」 | 保留 `.part` + `sent_offset`；重扫后从 offset 续 |
| 5 | 手机被杀（传输中） | 重启后启动自检 | 无感 | `SENDING→PENDING`，`init` 取服务端 offset 续 |
| 6 | 服务端 409 offset 冲突 | 响应码 | 无感 | 用服务端 `received` 重发当前块；不计失败次数 |
| 7 | 磁盘满 | `ENOSPC` | 「PC 存储空间不足，已保存进度」 | 507；保留 `.part`；手机退避重试 |
| 8 | 同名文件 | 落盘时 | PC 通知「已保存为 x (1).pdf」 | 原子占名循环，不覆盖（AC-06） |
| 9 | 文件 >100 MB | 入队前 | 「文件 320 MB 超过 100 MB 上限，未缓存」 | 拒绝入队，源 URI 已复制的内容删除 |
| 10 | 队列满 | 入队前 | 「缓存已满（5 个文件），最早的一项『x.pdf』已被移除」 | 事务内淘汰最旧 + 删文件 + 通知（AC-21） |
| 11 | 条目 TTL 过期 | 定时/启动 | 列表标灰「已过期」 | 不补发；字节仍占用直到清空（AC-24） |
| 12 | 队列文件被系统清理 | 启动自检 | 「某项已失效（文件不在了）」 | `MISSING`，不占条数 |
| 13 | 剪贴板图片拿不到 | 读取异常/无 URI | 「取不到剪贴板里的图片，请先保存到相册再分享」 | 不建队列条目（AC-11） |
| 14 | PC 剪贴板写不进 | 适配器返回失败 | 手机无感；PC 终端/通知提示 | 降级存 `.txt`，返回 `degraded`（FR-C11） |
| 15 | 未配对设备请求 | 认证失败 | （攻击者） | 401，**不读请求体**、不落盘、不进历史；限流（FR-S01） |
| 16 | 二维码截图被外传 | — | — | 配对即轮换；`--reset-identity` 一键作废；单设备 token（残余风险见 §9.4） |
| 17 | 手机离开 Wi-Fi | NetworkCallback | 「已离开原 Wi-Fi，需要重新扫码」 | 清凭据、停心跳、取消在传、队列保留（AC-28/29） |
| 18 | 短码输错 | 配对响应 `bad_secret` | 「配对码不对，请重试（还可试 4 次）」 | 记失败次数；超过 5 次/5min → 429 + 锁定 60s |
| 19 | 相机权限被拒 | 权限回调 | 「没有相机权限，可以输入短码，或从相册选二维码」 | 相册识别 + 短码兜底（AC-15） |
| 20 | Windows 防火墙拦截 | 连接超时（PC 日志无请求） | 「连不上 PC，可能被防火墙拦了」 | README 给放行步骤；`--selftest` 提示（R-13） |

---

## 9. 安全设计

### 9.1 威胁模型

| 威胁 | 面 | 影响 |
|---|---|---|
| 同 Wi-Fi 陌生设备投递恶意文件 | 监听端口 | 高 |
| 二维码被截图/拍照外传 | 配对凭据 | 高 |
| 局域网被动嗅探 token | 明文 HTTP | 中 |
| 路径穿越 / 保留名 / 覆盖已有文件 | 落盘 | 高 |
| 通过超大/超多请求耗尽磁盘 | 上传接口 | 中 |
| 剪贴板/文件名进日志 | 日志与历史 | 中 |
| 收到文件被自动执行/解压 | 落盘目录 | 高 |

### 9.2 措施

1. **认证先于读体**：除 `hello`/`pair` 外全部要求 `Bearer`；未通过时立即 `401` + `Connection: close` 并 `destroy()`，不读取请求体，不创建文件。
2. **token**：32 字节随机，常数时间比较；单设备；进程退出即失效；`--reset-identity` 手工吊销。
3. **配对凭据**：80 bit 随机，80 位空间 + 限流；**一次一用**，配对成功即轮换并重写 PNG；短码由 secret 派生、同寿命。
4. **限流**：配对 5/5min/IP + 全局 20/10min；上传每设备最多 1 个并发 `upload_id`；单请求体 ≤8 MiB；单文件 ≤4 GiB。
5. **落盘**：仅取最后一段文件名、清洗非法字符、去保留名、限长；目标目录固定；`link/rename` 原子占名不覆盖；不执行、不解压、不解析内容。
6. **网络面**：只监听局域网；不提供任何读取已落盘文件的接口；`history` 只回元数据。
7. **隐私**：日志白名单字段（`event, peer, device, upload_id, name, size, ms, code`）；剪贴板正文与文件内容永不入日志；队列可一键清空；`allowBackup=false`。

### 9.3 设计取舍

- **「一码一机」优先于「一码多机」**（Q-07）：配对成功即轮换，截图在配对后失效。同网段的第二台手机拿到屏幕上的新码仍可配对（物理可见性=授权），这是可接受的信任模型。
- **PC 无法感知手机离开 Wi-Fi**：安全边界由手机执行（明确的产品决策，R-09）。PC 侧用「轮换 + 单设备 + 重置」把暴露窗口压到「配对前的那张码」。
- **配对成功是否顶替旧设备**：默认**允许顶替**（family 场景更顺），旧设备下次心跳得 401 → 提示重扫。若要求「必须先在旧设备断开」，改动只在 `session.py` 的一处判断。

### 9.4 残余风险（接受并写入 README）

| 风险 | 说明 | 后续可选 |
|---|---|---|
| 明文 HTTP | 同网段被动嗅探可拿 token，进而上传文件（不能读 PC 任何文件） | P2：自签 TLS + 指纹固定（二维码带证书指纹） |
| 二维码当前那张仍可被拍照 | 物理接触屏幕即视为授权 | 配对 TTL（默认不启用，避免打断「随时扫码」） |
| 单设备被顶替 | 有屏幕访问权的人可抢会话 | P1：多设备白名单 + 撤销界面 |
| 无完整性签名 | token 只证明「有权限发」，不证明「内容未被篡改」 | LAN 场景不必要；P2 可加每文件 HMAC |

---

## 10. 测试与验收策略

### 10.1 分层

| 层 | 工具 | 覆盖 | 命令（实现后） |
|---|---|---|---|
| L1 纯逻辑 | `unittest` / JUnit | 载荷编解码、名称清洗、配额决策、状态机、退避、TTL、DTO | `python -m unittest discover -s a2-share/pc/tests -t a2-share/pc`、`./gradlew testDebugUnitTest` |
| L2 协议一致性 | 共享 `tools/vectors/v1.json` | 两端对同一批样本给出同一结果（QR/JSON/错误码） | 随 L1 跑 |
| L3 PC 集成 | Python 起真服务（临时目录/端口） | 配对→上传→续传→冲突→未授权→超限→同名→剪贴板降级 | `python a2-share/tools/e2e.py` |
| L4 真机 | `tools/device-checklist.md` + `adb` | AC-01~33 逐条留证 | 手工（每条记截图/日志） |
| L5 压测 | 脚本 + 真机 | 1 GB 续传、20 文件连传、息屏 30 分钟 | 手工/半自动 |

### 10.2 必须写进 L1 的「容易错」用例

- QR 载荷：缺字段/多字段/大小写/端口 0/回环地址/时间戳未来值/超长名称 → 各自错误码。
- 名称：`../../etc/passwd`、`CON`、`a.`、`a `、255 字节中文、emoji、大小写同名。
- 配额：第 6 个文件挤掉第 1 个；剪贴板不占文件额度；发送中不淘汰；500 MB 边界；单文件 100 MB 边界；过期条目不计条数但仍计字节。
- 状态机：409 不算失败次数；401 不重试；断网 3 次后 FAILED；重新配对后 attempts 归零。
- 续传：`.part` 大于 `size` 时截断、小于则从实际大小续；`offset + length > size` 拒绝；重复 init 幂等。

### 10.3 AC 覆盖映射（设计 → 验收）

| AC | 主要落点 | 验证层 |
|---|---|---|
| AC-01~06 | ShareActivity + uploads + safe-name | L3 + L4 |
| AC-07 | 分块/续传/流式 | L3（模拟断点）+ L4（真 1 GB） |
| AC-08 | TransferService + wakelock | L4 |
| AC-09~12 | clipboard + `/v1/clipboard/text` | L3 + L4 |
| AC-13~16 | QR/短码/pair/session | L1 + L3 + L4 |
| AC-17~19 | `sid`/心跳/连接失败文案 | L3（模拟重启）+ L4 |
| AC-20~26 | QueueRepository + QuotaPolicy + Expiry | L1 + L4 |
| AC-27~30 | ConnectivityMonitor + PairPolicy | L1 + L4 |
| AC-31~33 | `--selftest` / 端口共存 / APK 体积 | L3 + 构建检查 |

### 10.4 `--selftest` 的检查项（AC-31）

| # | 检查 | 失败时提示 |
|---|---|---|
| 1 | 状态目录/接收目录可写、剩余空间 ≥ 200 MB | 路径 + 系统错误原因 |
| 2 | 端口可监听（默认 8899；被占时报告占用者） | 「端口被占，用 --port 换一个」 |
| 3 | 载荷编解码 + 短码与黄金样本一致 | 指出不一致字段 |
| 4 | QR 矩阵 + PNG 生成（结构、尺寸、静区） | 「二维码生成失败」 |
| 5 | 回环起临时服务：配对 → 传 1 KB → 校验 sha256 → 定名 | 停在失败步骤 |
| 6 | 剪贴板/通知适配器可用性（只探测，不改用户剪贴板） | 「已降级：只存文件」 |

退出码：全通过 0，任一失败 1；`--json` 时每项输出一行 JSONL（供 e2e 断言）。

### 10.5 验收证据规范

- 每条 AC 在 `tools/device-checklist.md` 里留：时间、机型/ROM、PC 系统、命令、截图名、日志片段（不含内容）。
- 1 GB 用例额外记：耗时、平均速率、续传起点、两端 hash。

---

## 11. 交付路线

> 原则：**先用短码打通，再补相机扫码**；PC 端永远可以被 curl 驱动，前端问题不阻塞后端。

| 里程碑 | 内容 | 依赖 | 退出条件 | 估时 |
|---|---|---|---|---|
| **M0 骨架** | 目录、PC 入口/`--help`/日志、`--selftest` 空壳、Android 空壳可装、共享向量文件 | — | `python a2-share/pc/a2_share.py --selftest` 有输出；`adb install` 成功 | 0.5–1d |
| **M1 PC 最小闭环** | config/session/QR/PNG/http/hello/uploads/finish/同名/续传；L3 集成测试 | M0 | curl 完成「配对→传 5 MB→md5 一致」；409/401/超限有测试 | 2d |
| **M2 配对（短码优先）** | 手机端配对页（手输短码）+ Session 存储 + 状态卡；QR 解码模块（先单测，不接相机） | M1 | AC-15；手机能配对并保持 `sid` | 1.5d |
| **M3 分享目标** | Manifest 分享入口、透明确认条、复制到 inbox、队列泵、前台服务、进度 | M2 | AC-01~06、AC-08（先不要求离线缓存） | 2–3d |
| **M4 剪贴板** | 文字/图片读取、PC 剪贴板适配与降级、通知 | M3 | AC-09~12 | 1d |
| **M5 队列与离线** | SQLite 队列、配额/淘汰/TTL/自检、补发、续传落盘 | M3 | AC-20~26 | 2–3d |
| **M6 Wi-Fi 会话与重连** | ConnectivityMonitor、离开作废、心跳/退避、`sid`/401 处理、PC IP 变化 | M2+M5 | AC-17~19、27~30 | 2d |
| **M7 扫码相机与加固** | CameraX+ZXing、相册识别、限流、安全复核、README、仓库集成 | M2、M6 | AC-13、14、31~33；全量回归 | 2d |

**并行建议**：M4 与 M5 可由两人并行（都只改自己的模块，接口在 `core/`）；M7 的相机部分可由不熟悉 Android 的人先做 spike（1 天，验证 ZXing 在小屏/低对比度下的识别率）。

**仓库集成（M7 收尾，需求 §8.5）**：`tools/gen-project-index.mjs` 加项目条目 → `npm run index:build`；`docs/INDEX.md` 加行；根 `README.md` 横幅；根 `package.json` 加 `test:a2share` / `a2share:e2e` / `a2share:build`（前两者转调 `python`，最后一个转调 Gradle）。注意 agent.md 里的坑：`prompts:build` 会重写所有项目，只保留本项目的改动。

---

## 12. 设计风险与需求风险的对应

| 需求风险 | 设计上的处理 | 残余 |
|---|---|---|
| R-01 微信不列出第三方分享目标 | 不靠代码解决：M3 第一件事就是真机验证；README 写替代路径（文件助手 → 系统文件 app） | 高（产品限制） |
| R-02 后台读剪贴板受限 | 只在前台 Activity 读；自动推送列 P1 | 无 |
| R-03 剪贴板图片 URI 不可读 | 明确失败文案 + 相册兜底；不重试 | 中 |
| R-04 ROM 冻结 | FGS(`dataSync`) + 传输期 wakelock + 引导页（复用 tea_a2 `MainActivity` 的厂商 Intent） | 中 |
| R-05 陌生设备投文件 | §9.2 全部措施 | 低 |
| R-06 二维码外传 | 一次一用 + 单设备 + 重置 | 中 |
| R-07 二维码扫不出 | 载荷 ≤51 字符、module 10px、静区 4、纯黑白；`--open` 全屏；短码兜底 | 低 |
| R-08 离开 Wi-Fi 误判 | 只认 Network 句柄/传输类型；UI 防抖；调试日志 | 中（漫游会多扫一次，符合产品决策） |
| R-10/R-11 缓存占满/敏感残留 | 双额度 + 字节护栏 + TTL + 一键清空 + 只记元数据 | 低 |
| R-12 大文件 OOM | 全链路流式：ContentResolver → 文件；文件 → 4 MiB 块；PC 直接写 FD | 无 |
| R-13 防火墙 | 启动打印放行提示 + README；`--selftest` 区分「能监听」与「外部能连」 | 中 |
| R-14 扫码库体积/GMS | ZXing core（纯 Java）+ CameraX；APK 预算 6 MB | 低 |
| R-16 端口冲突 | 8899 + 启动检测 + 友好报错 + `--port` | 低 |
| R-17 弱网误判 | 超时 2s；探测失败一律进队列；不把「慢」当「错」 | 低 |
| R-18 开发机环境 | §3.3 版本矩阵 + 构建脚本显式 `JAVA_HOME` | 中 |

**新增的设计风险**：

| ID | 风险 | 影响 | 处理 |
|---|---|---|---|
| D-R1 | 自定义分块协议两端实现不一致 | 高 | 共享黄金样本 + L3 集成测试 + 错误码目录 |
| D-R2 | Android 15 起 `dataSync` 前台服务 6 小时上限（target 35+ 才强制） | 中 | v1 保持 target 34；README 记录；升 target 时把长队列改 `specialUse` 或 WorkManager |
| D-R3 | Python `http.server` 的默认行为会坑：HTTP/1.0 无 keep-alive、漏 `Content-Length` 客户端挂死、`Expect: 100-continue`、慢客户端堆线程 | 高 | 显式 `protocol_version`/`Content-Length`/`handle_expect_100`；daemon threads + 每连接 socket 超时 + 连接数上限；集成测试含半包/慢读 |
| D-R4 | Windows/POSIX 的重命名语义不同（`os.replace` 会覆盖）/ `CON` 等保留名 | 高 | 统一走 `safe_name.claim()`：POSIX `os.link`+`os.unlink`，Windows `os.rename`（目标存在即失败）重试；保留名表 + 单测 |
| D-R5 | PowerShell 每次 300–700 ms 延迟，剪贴板图片写失败 | 中 | 文字可用 `Set-Clipboard`；图片默认只存文件；失败降级 |
| D-R6 | `HttpURLConnection` 在弱网下的超时/取消行为 | 中 | 每块独立请求 + `setConnectTimeout/ReadTimeout` + 显式 `disconnect()`；`HttpTransport` 可替换 |
| D-R7 | 二维码轮换与「一码一机」让用户困惑（配对后屏幕上的码变了） | 低 | 终端明确提示「已配对，已生成新的二维码（换手机/重连用）」；README 说明 |

---

## 13. 待确认项（默认值已定，不阻塞开发）

| ID | 问题 | 当前默认 | 影响面 |
|---|---|---|---|
| Q1 | 空闲时是否常驻前台服务（PC 掉线后秒级重连）？ | **否**：有队列/传输才常驻；队列空 30 分钟停服务 | 只影响「PC 恢复后多久自动连」；不改协议 |
| Q2 | 配对成功是否立即轮换二维码？ | **是**（一码一机，Q-07） | 屏幕上二维码配对后会变；要改成「不变」只需去掉 `session.rotate()` |
| Q3 | 剪贴板图片默认写 PC 剪贴板？ | **否**，`--clipboard-image` 开启 | AC-10 用开启状态验收 |
| Q4 | 允许多台手机吗？ | **否**（后配对的顶掉先配对的） | P1 再做多设备表 |
| Q5 | PC 端允许 vendored 第三方 QR 单文件（Nayuki `qrcodegen.py`，MIT）？ | **是**，附 LICENSE 与来源 | 若不允许，改为自写 QR 编码（+2–3 人日） |
| Q6 | IPv6 支持？ | **v1 不做** | 只有 IPv6-only 局域网才受影响 |

---

## 14. 变更影响与回滚

- **本文档是设计层事实源**；线缆细节以 `PROTOCOL.md` 为准；需求以 `REQUIREMENTS.md` 为准。三者冲突时：需求 > 协议 > 设计。
- **设计变更流程**：改文档 → 在 §14 记一行（版本/日期/影响模块/是否动协议）→ 再改代码。
- **回滚粒度**（无代码阶段）：文档回滚只需 `git revert` 对应提交；协议字段一旦实现，删除字段要走「先停用、后删除」两个版本（`PROTOCOL.md` §10）。

- **改动影响面速查**：

| 改动 | 影响 |
|---|---|
| 二维码载荷字段 | 两端 codec + 黄金样本 + 已打印的 QR 全部失效 |
| 认证/会话语义 | 手机配对状态机、AC-13~19 |
| 分块大小/offset 语义 | 两端续传、L3 集成测试 |
| 队列状态/额度口径 | UI、通知、AC-20~26 |
| 接收目录/命名规则 | PC 落盘、AC-06、README |

**变更记录**：

| 版本 | 日期 | 变更 | 影响 | 动协议？ |
|---|---|---|---|---|
| v1.0 | 2026-11-22 | 设计定稿 | — | — |
| v1.1 | 2026-11-22 | 按用户要求，PC 端运行时 **Node 20+ → Python 3.11+**（stdlib + vendored QR） | §0/§2.1/§3.1/§4.1/§10/§11/§12/§13 | 否 |

---

## 附：设计文档的阅读顺序

1. 先看 §0 与 §2，明白「谁在连谁、谁负责什么」。
2. 实现 PC 端：§3.1 + §4.1 + §6.1 + `PROTOCOL.md` §4–§6。
3. 实现 Android：§3.2 + §4.2 + §6.2 + §7 + `PROTOCOL.md` §2–§5。
4. 验收：§10 + `REQUIREMENTS.md` §5。

---

## 附录 A：需求 → 设计追溯

> 逐条列出，便于开发机上「照着需求找设计」。分组内共用一个机制时合并成一行。

| 需求 | 设计落点 |
|---|---|
| G1 G2 G3 G4 G5 | §0（目标映射）、§7.3、§7.4、§7.6、§11 |
| FR-P01 FR-P02 FR-P03 FR-P17 | §4.2（Manifest 要点 / ShareActivity）、§7.3、`PROTOCOL.md` §6.1 |
| FR-P04 FR-P05 | §7.6、`PROTOCOL.md` §7 |
| FR-P06 FR-P07 | §4.2（QueueFragment）、§6.2（状态与额度）、§7.4 |
| FR-P08 | §5.3（TransferMachine）、`PROTOCOL.md` §5.2 |
| FR-P09 FR-P10 | §3.2（ZXing/CameraX）、§4.2（ScanActivity）、`PROTOCOL.md` §2.4 / §3.3 |
| FR-P11 | §6.2（`pc` 表，P1）、§4.2 |
| FR-P12 FR-P13 | §3.2（前台服务/wakelock）、§4.2（TransferService）、§12 R-04 |
| FR-P14 FR-P15 FR-P16 | §6.3（PairState）、§7.7、`PROTOCOL.md` §3.2 / §8 |
| FR-P18 | §4.2（Notifications 三渠道）、§8 |
| FR-P19 | §9.2 第 7 条、`PROTOCOL.md` §7.3 |
| FR-P20 | §4.2（SettingsActivity）、§3.2 |
| FR-P21 | 架构图（`com.tea.a2share`）、§4.2 |
| FR-P22 FR-P23 | §7.4（重试）、§7.5（续传）、`PROTOCOL.md` §5.4 |
| FR-C01 FR-C02 FR-C03 | §5.2（CLI 表）、§7.1 |
| FR-C04 FR-C05 FR-C06 FR-C07 | §7.1、§7.2、`PROTOCOL.md` §2 / §3.3 / §3.4 |
| FR-C08 FR-C09 FR-C10 FR-C11 | §6.1、§7.6、`PROTOCOL.md` §6 / §7 |
| FR-C12 | §4.1（log/notify）、§9.2 第 7 条 |
| FR-C13 | §4.1（history.py）、`PROTOCOL.md` §4.9（P1） |
| FR-C14 | §7.1、§7.8 |
| FR-C15 | §0、§2.1、§3.1（独立进程/端口） |
| FR-C16 | §10.4（`--selftest` 6 项） |
| FR-C17 | `PROTOCOL.md` §3.1、§7.8 |
| FR-S01 FR-S02 FR-S03 FR-S04 | §9.2、§9.3、`PROTOCOL.md` §1.4 / §3.4 |
| FR-S05 FR-S06 FR-S07 | §9.2 第 5–7 条、§8 第 15 行 |
| FR-Q01 FR-Q02 FR-Q03 | §6.2（额度/状态语义）、§7.3、§7.4 |
| FR-Q04 FR-Q05 | §6.2（100 MB / 500 MB / 10 MB 护栏） |
| FR-Q06 FR-Q07 | §6.2（启动自检、TTL） |
| FR-Q08 | §7.4（FIFO 补发、3 次退避） |
| FR-Q09 | §7.7（离开 Wi-Fi 不清队列） |
| FR-Q10 | §6.2（状态表：谁占额度） |
| FR-Q11 | §4.2（QueueFragment 暂停/跳过）、§7.4（触发点可停） |
| FR-Q12 | §6.2（SQLite + 内容文件）、§6.3、`PROTOCOL.md` §5.4 |
| FR-L01 FR-L02 | §2.2、§7.8、`PROTOCOL.md` §8 |
| FR-L03 | `PROTOCOL.md` §8 第 1 行（2s 探测） |
| FR-L04 FR-L05 | §7.7、§7.8 |
| FR-L06 | §7.8（心跳/退避，无需重扫） |
| FR-L07 | §7.8（`sid` 变化 / 401） |
| FR-L08 | §7.4、§8 第 1 行 |
| NFR-01 NFR-02 NFR-03 | §3（选型）、§7.1（启动/扫码预算）、§7.3（吞吐预算）、`PROTOCOL.md` §5.2 / §5.5（4 MiB 块、流式） |
| NFR-04 | §3.2（APK 预算 5.5–6 MB）、§10.4 |
| NFR-05 | §3.3（版本矩阵 / 真机） |
| NFR-06 | §3.2（FGS + wakelock）、§10.1（L5 压测） |
| NFR-07 NFR-08 | §9（威胁模型/措施/残余）、§10.2（AC-12） |
| NFR-09 | §10.4（一条命令自检）、§11（构建脚本） |
| NFR-10 | §4.2（strings.xml） |
| NFR-11 | §4.1（JSONL 日志）、§6.3（状态可见） |
| NFR-12 | §3.2（无 GMS，ZXing 本地解码） |
| AC-01 AC-02 AC-03 AC-04 AC-05 AC-06 | §10.3；§7.3（多文件/同名/编码） |
| AC-07 AC-08 | §10.3；§7.5、§3.2 |
| AC-09 AC-10 AC-11 AC-12 | §10.3；§7.6、§9.2 |
| AC-13 AC-14 AC-15 AC-16 | §10.3；§7.2、§10.4 |
| AC-17 AC-18 AC-19 | §10.3；§7.8 |
| AC-20 AC-21 AC-22 AC-23 AC-24 AC-25 AC-26 | §10.3；§6.2、§7.4、§7.5 |
| AC-27 AC-28 AC-29 AC-30 | §10.3；§7.7 |
| AC-31 AC-32 AC-33 | §10.3；§10.4、§0（端口分离）、§3.2（体积） |
| R-01 R-02 R-03 R-04 R-05 R-06 R-07 R-08 R-09 R-10 R-11 R-12 R-13 R-14 R-15 R-16 R-17 R-18 R-19 R-20 | §12 |

---

## 附录 B：与需求的**有意偏差**（不是漏项）

| # | 需求原文 | 设计做法 | 原因 |
|---|---|---|---|
| B1 | FR-C04 二维码包含「主机名 + IP + PC 名 + 时间戳」且 ≤60 字节 | IP/端口/时间戳/名字提示都进；**主机名与完整 PC 名不进**，由 `hello`/`pair` 返回 | 主机名无法解析（不做 mDNS），完整名可能中文/超长；51 字节的上限优先保证扫得中 |
| B2 | FR-C04 二维码含时间戳 | 含，但**只展示/排障，不参与鉴权** | 避免 PC/手机时钟偏差把配对卡死（A6） |
| B3 | AC-01 要求 md5 一致 | `finish` **同一遍**算 SHA-256 **和** MD5，两者都返回/记日志 | 不额外读盘，验收可直接对照 |
| B4 | Q-07 一码一机 | 配对成功**立即轮换**二维码与短码 | 把「截图外传」的窗口压到配对前；见 §9.3 |
| B5 | FR-C10 剪贴板图片「可选」进 PC 剪贴板 | 默认**只存文件**，`--clipboard-image` 开启 | Windows 依赖 PowerShell STA，慢且易失败（D-R5） |
| B6 | FR-Q08/AC-20「PC 上线自动补发」 | 有队列时前台服务保活 + 心跳退避（20s→5min）；队列空 30 分钟停服务 | 平衡电量；不改「无需重扫」的语义 |
| B7 | 需求未限定 IP 版本 | v1 **仅 IPv4** | 二维码 8 字符编码 IPv4；IPv6 会让载荷翻倍 |
| B8 | Q-01 单文件 100 MB / 总量 500 MB | 手机端执行；PC 端只做 **4 GiB** 硬护栏 | PC 不知道队列策略，也不该替用户做产品决策 |

> 需要用户拍板的默认值集中在 §13；B1–B4 属协议取舍（改动走 `PROTOCOL.md` §10 的版本演进），B5–B8 属实现默认值（改一个常量或开关）。
