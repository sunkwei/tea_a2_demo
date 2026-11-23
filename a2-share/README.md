# a2_share · 隔空投送

> 手机 → PC 的局域网直传：**PC 端出一条命令出二维码，手机扫一下就把文件、剪贴板送到电脑**。
> 同一个 Wi-Fi 内全程点对点，不经过任何第三方服务器；PC 不在线时内容进队列，PC 一上线自动补发。

| 组件 | 目录 | 技术栈 | 入口 |
|---|---|---|---|
| PC 端（接收） | [`pc/`](pc/) | Python 3.11+，零第三方依赖 | `python a2-share/pc/a2_share.py` |
| 手机端（分享目标） | [`phone/`](phone/) | Kotlin + 经典 View，无 GMS / 无 NDK | `gradlew assembleRelease` |
| 协议与验收 | [`PROTOCOL.md`](PROTOCOL.md) · [`tools/`](tools/) | 黄金样本 + 集成脚本 | `python a2-share/tools/e2e.py` |

需求见 [`REQUIREMENTS.md`](REQUIREMENTS.md)（v1.0 定稿），设计见 [`DESIGN.md`](DESIGN.md)（v1.1）。

**实现状态**：M0–M7 已全部落地并通过自动化验证 —— PC 单测 89 项 / 集成 21 项 / 自检 6 项 / 真服务冒烟通过；手机端 JVM 单测 51 项；release APK 4.29 MB；真机（小米 14 / Android 16）验收 6/6 通过。尚未验证的项见 §7。


---

## 1. 五分钟跑通

### PC 端

```bash
# Windows
a2-share\pc\a2_share.cmd
# macOS / Linux
a2-share/pc/a2_share
# 或者直接
python a2-share/pc/a2_share.py
```

终端会打印：

```
二维码 PNG：C:\Users\<你>\.tea_agent\a2_share\qr.png
监听地址：192.168.1.23:8899
配对短码：093511
状态目录：C:\Users\<你>\.tea_agent\a2_share
接收目录：C:\Users\<你>\Downloads\a2_share
按 Ctrl-C 退出。
```

用系统看图工具打开 `qr.png`（或加 `--open` 自动打开），手机对准它即可。

### 手机端

```bash
cd a2-share/phone
gradlew.bat assembleRelease        # Windows
# ./gradlew assembleRelease       # macOS / Linux
```

产物：`app/build/outputs/apk/release/app-release.apk`（约 4.3 MB，已用 debug key 签名，侧载即用）。
把 APK 装到手机（`adb install app-release.apk`，或用文件管理器安装），首次启动允许相机与通知权限。

### 用起来

1. 手机打开 a2_share → **扫码连接 PC** → 对准 PC 上的二维码。
2. 状态变成「已连接 PC-xxx」。
3. 在微信里收到文件 →「用其他应用打开」→ 选 **a2_share** → 确认条上点「发送」。
   文件落到 `~/Downloads/a2_share/`；同名自动变成 `名字 (1).pdf`。
4. 手机复制一段文字 → 打开 a2_share → **发送剪贴板** → PC 剪贴板里直接就有这段文字。

---

## 2. PC 端命令

| 命令 | 行为 |
|---|---|
| `a2_share` | 进入接收模式：监听端口 → 生成二维码 PNG → 打印地址与短码 |
| `--dir <path>` | 指定接收目录（默认 `~/Downloads/a2_share/`） |
| `--port <n>` | 指定端口（默认 **8899**，与 tea_a2 的 8383 不冲突） |
| `--qr-out <file.png>` | 指定二维码 PNG 输出路径 |
| `--open` | 生成后自动打开二维码 PNG |
| `--no-notify` | 关闭桌面通知 |
| `--history` | 查看接收历史（只记元数据，不记内容） |
| `--reset-identity` | 作废当前会话凭据并重新生成二维码 |
| `--selftest` | 自检（6 项），全部通过退出码 0 |
| `--bind <ip>` | 绑定地址（默认 `0.0.0.0`） |
| `--ip <ip>` | 二维码里写哪个 IP（默认自动挑私网 IPv4） |
| `--clipboard-image` | 剪贴板图片同时写入 PC 剪贴板（默认只存文件） |
| `--home <dir>` | 状态目录覆盖（默认 `~/.tea_agent/a2_share`，测试用） |
| `--json` | 终端输出结构化 JSONL |
| `--log-level <debug\|info\|warn>` | 日志级别 |
| `--version` | 打印版本 |

状态目录里有什么：

```
~/.tea_agent/a2_share/
├── config.json      # pc_id / 名称 / 端口 / 目录 / 开关
├── qr.png           # 当前二维码（原子写）
├── a2_share.log     # JSONL 日志（白名单字段，5 MB × 3 轮转）
├── completed.jsonl  # 已完成 upload 的台账（finish 幂等，滚动 500 条）
└── history.jsonl    # 接收历史（滚动 100 条，只记元数据）
```

接收目录里有什么：

```
~/Downloads/a2_share/
├── 报告 v2.pdf          # 最终文件（同名自动加 (1) / (2)）
├── clipboard-20261122-101530.txt   # 剪贴板写不进系统时降级存文件
└── .a2-incoming/        # 未完成的传输（<upload_id>.part / .json）
```

---

## 3. 手机端行为

| 场景 | 行为 |
|---|---|
| 分享文件 / 多文件 | 弹确认条（名称 / 大小 / 目标 PC），点「发送」才传；多文件逐个处理，单个失败不影响其它 |
| 分享纯文字 | 同样走确认条，落到 PC 剪贴板 |
| 发送剪贴板 | 文字直接发；图片先复制成 png 走同一条上传链路；取不到图片时明确提示「请先保存到相册再分享」 |
| PC 不在线 | 内容进队列（5 个文件 + 10 条剪贴板，两个独立额度，FIFO 淘汰并通知），PC 上线自动补发 |
| 不是 Wi-Fi | **不发起任何连接**，只缓存并提示「当前不是 Wi-Fi，已缓存」 |
| 离开原 Wi-Fi | 连接与凭据立即作废，状态变「已离开原 Wi-Fi，需要重新扫码」；队列内容保留 |
| PC 重启 | 凭据轮换，手机提示「请重新扫码」 |
| PC 掉线后恢复 | 同一会话内自动重连、自动补发，不用重扫 |
| 息屏传输 | 前台服务（`dataSync`）+ 传输期 wakelock |

> 缓存额度、单文件 100 MB、文件总量 500 MB、剪贴板 24 h、文件 7 天 TTL —— 都在 `core/QuotaPolicy.kt` 与 `core/Expiry.kt` 里，纯逻辑、有单测。

---

## 4. 协议摘要

PC 是 HTTP/1.1 服务端，手机是纯客户端（`PROTOCOL.md` 是线缆事实源）。

```
GET    /v1/hello                      探活（2 s 超时），返回 PC 名与 sid
POST   /v1/pair                       扫码 / 短码换 token（成功即轮换二维码）
GET    /v1/status                     心跳（20 s）
POST   /v1/uploads                    初始化上传，返回服务端已收字节数
PUT    /v1/uploads/{id}?offset=N      追加原始字节（1–8 MiB，默认 4 MiB）
POST   /v1/uploads/{id}/finish        定名落盘，返回 sha256 + md5
DELETE /v1/uploads/{id}               放弃
GET    /v1/uploads/{id}               查续传点
POST   /v1/clipboard/text             写 PC 剪贴板（失败降级存 .txt）
GET    /v1/history                    元数据历史
```

错误统一信封：`{"error":{"code","message","retryable","hint","request_id"}}`，
`hint` 是可直接展示给用户的中文；**客户端按 `code` 决策，不按 HTTP 状态猜**。

二维码载荷（alphanumeric，≤ 51 字节）：

```
A2S1-<SECRET:16>-<IP:8>-<PORT:4>-<ISSUED:7>[-<NAME:1..7>]
```

---

## 5. 测试与自检

```bash
# PC 端单元测试（89 项）
npm run test:a2share
#   等价：python -m unittest discover -s a2-share/pc/tests -t a2-share/pc

# PC 端自检（6 项：目录 / 端口 / 黄金样本 / 二维码 / 配对→上传闭环 / 剪贴板）
npm run a2share:selftest

# PC 端集成闭环（21 项：配对→上传→续传→冲突→未授权→超限→同名→剪贴板降级→幂等→重启续传→剪贴板 Unicode）
npm run a2share:e2e

# 真服务冒烟（起真进程 → 探活 → 二维码 PNG → 未授权被拒）
npm run a2share:smoke

# 手机端 JVM 单测（51 项：载荷 / 名称 / 配额 / 状态机 / TTL / 黄金样本）
npm run a2share:test

# 真机验收（需要连着手机：先 adb install 再跑）
npm run a2share:device -- --serial <设备号>

# 出 APK（debug key 签名）
npm run a2share:build
```

> `gradlew` 需要 **JDK 17**；本机 `JAVA_HOME` 若指向失效路径，构建前先 `set JAVA_HOME=<jdk17>`。
> APK 构建需要 Android SDK（platform 34 / build-tools 34.0.0），路径写在 `a2-share/phone/local.properties`（不入库）。

两端共用同一份黄金样本 [`tools/vectors/v1.json`](tools/vectors/v1.json)：
Python 单测与 Kotlin 单测读同一个文件，任何一端实现漂移都会立刻暴露。

---

## 6. 真机验收清单

### 已经在真机上跑过的（小米 14 / Android 16 / HyperOS，2026-11-23）

仓库里带了一个 **adb 驱动的真机验收脚本**，它自己起 PC 服务、配对、分享、比对：

```bash
python a2-share/tools/device_e2e.py --serial <设备号>
```

本轮实测结果（**6/6 通过**）：

| 用例 | 结果 | 证据 |
|---|---|---|
| 分享目标出现在系统分享面板 | 通过 | 系统面板里能选中 a2_share（FR-P01） |
| AC-01/AC-02 文件经分享面板落到 PC | 通过 | 277823 字节，**md5 与源一致** |
| AC-06 同名文件自动改名不覆盖 | 通过 | `x.jpg` / `x (1).jpg` / `x (2).jpg`，原文件不变 |
| AC-09 剪贴板文字发到 PC | 通过 | PC 日志 `clipboard_received` + Windows 剪贴板逐字一致 |
| AC-20/FR-L05 离线缓存 + 重扫后自动补发 | 通过 | PC 下线时入队，重扫后自动补发（md5 一致） |
| AC-27 非 Wi-Fi 时不发起任何连接 | 通过 | 关 Wi-Fi 后 **0 条** HTTP 请求，内容进队列 |
| AC-28 离开 Wi-Fi 后需重新扫码 | 通过 | 状态回到「未配对 / 请扫码连接 PC」 |

> 这轮真机测试**抓出并修掉了三个只跑单测发现不了的 bug**：
> 1. **主线程发网络请求**（`NetworkOnMainThreadException`）→ 配对在真机上必然失败；
> 2. **PC 写 Windows 剪贴板时非 ASCII 被截断**（ctypes 缓冲区按 `len(text)` 算，中文/emoji 丢失）；
> 3. **PowerShell 兜底路径**用 stdin 传文本，按控制台代码页解码 → 乱码（改成读 UTF-8 临时文件）。

`tools/device-checklist.md` 是逐条勾选表（AC-01 ~ AC-33）。最关键的几条：

| # | 场景 | 期望 |
|---|---|---|
| AC-01 | 系统文件 app 分享一个 5 MB PDF | 5 秒内落到 `~/Downloads/a2_share/`，md5 与源一致 |
| AC-03 | 微信里收到文件 →「用其他应用打开」 | 选到 a2_share 并落盘；**微信不列出第三方分享目标时**走「转发到文件助手 → 系统文件 app → 分享」 |
| AC-06 | PC 已有同名文件 | 自动改名 `x (1).pdf`，原文件不变 |
| AC-13/14 | PC 起二维码 → 手机扫码 | ≤ 5 秒显示「已连接」，PC 终端出现「设备已连接」 |
| AC-17 | PC 进程重启 | 二维码刷新，手机提示「请重新扫码」 |
| AC-18 | PC 掉线（非重启）后恢复 | 手机**自动重连**，不用重扫 |
| AC-20/21 | 断网连续分享 7 个文件 | 只缓存最新 5 个，最早 2 个被淘汰且**有通知** |
| AC-27 | 手机切到蜂窝 | 分享提示「当前非 Wi-Fi，已缓存」，**不发起任何连接** |
| AC-28/29 | 断开再连回同一个 AP / 换 AP | 凭据作废，必须重扫 |
| AC-31 | `a2_share --selftest` | 逐项打印通过/失败，全通过退出码 0 |
| AC-32 | tea_a2 在 8383 运行时启动 a2_share | 两者互不干扰 |
| AC-33 | 全新安装走完「扫码 → 分享 → PC 收到」 | 不依赖 tea_a2；APK ≤ 10 MB（实测 **4.3 MB**） |

---

## 7. 已知限制

1. **微信不保证列出第三方分享目标**（微信内部文件流常走自有页面）。替代路径：
   微信 → 转发到「文件助手 / 收藏」→ 系统文件 app → 分享 → a2_share。
2. **短码兜底需要知道 PC 地址**：6 位短码只编码凭据、不含 IP，所以「输入短码」界面里
   还有一个「PC 地址」输入框（PC 终端会打印 `监听地址：192.168.x.x:8899`）。
   这是协议设计留下的缺口，实现上补了一个输入框兜底。
3. **Windows 首次启动可能被防火墙拦**：放行 Python 的「专用网络」权限，或用 `--selftest` 先确认端口能监听。
4. **明文 HTTP**：同网段被动嗅探理论上能拿到 token（只能往 PC 投文件，读不到 PC 任何文件）。
   见 `DESIGN.md` §9.4 残余风险。
5. **只走 IPv4 私网**：IPv6-only 局域网不在 v1 范围。
6. **单设备**：第二台手机配对会顶掉第一台（一码一机）。
7. **PC 重启后必须重新扫码**：会话凭据随 PC 进程轮换（FR-L07 / AC-17），
   离线缓存的内容会在**重新扫码后**自动补发（FR-L05）。
   —— 这也是 AC-20 的真实语义：「PC 启动后自动收到」的前提是先完成一次重扫。
8. **仍未在真机上验证的用例**：相机扫码（AC-13/14，需人工对着屏幕扫）、
   1 GB 大文件与断点续传（AC-07/23）、息屏传输（AC-08）、
   缓存淘汰通知（AC-21）、微信内是否列出 a2_share（AC-03）。
   已验证的部分见 §6 的表格与 `tools/device-checklist.md`。

---

## 8. 目录

```
a2-share/
├── REQUIREMENTS.md      # 需求（唯一事实源）
├── DESIGN.md            # 技术设计
├── PROTOCOL.md          # 线缆协议
├── README.md            # 本文件
├── pc/                  # PC 端（Python）
│   ├── a2_share.py      # 入口
│   ├── a2share/         # config/session/qr/png/server/uploads/safe_name/clipboard/notify/net/history/opener/log
│   ├── vendor/          # Nayuki qrcodegen（MIT）
│   └── tests/           # unittest（89 项）
├── phone/               # Android 工程（Kotlin）
│   └── app/src/main/java/com/tea/a2share/
│       ├── core/        # 纯 Kotlin：QrPayload/QuotaPolicy/SafeName/PairPolicy/TransferMachine/Expiry/ApiDto
│       ├── data/        # SQLite 队列、配对凭据、内容文件
│       ├── net/         # HttpURLConnection、Wi-Fi 作用域监视、业务调用
│       ├── svc/         # 前台服务（队列泵 + 心跳）、通知
│       └── ui/          # 主界面 / 分享确认条 / 扫码 / 设置
└── tools/
    ├── vectors/v1.json  # 两端共用的黄金样本
    ├── e2e.py           # PC 端集成闭环（21 项）
    ├── smoke.py         # 真服务冒烟（起进程 → 探活 → 二维码 → 未授权被拒）
    ├── device_e2e.py    # 真机验收脚本（adb 驱动，6 项）
    └── device-checklist.md
```

---

## 9. 许可证与第三方代码

* 本项目代码：随仓库 MIT。
* `pc/vendor/qrcodegen.py`：[Nayuki QR-Code-generator](https://github.com/nayuki/QR-Code-generator)，
  MIT 许可，文件头保留原始版权声明。
* 手机端依赖：AndroidX / Material / CameraX / ZXing core / kotlinx-coroutines（均为 Apache-2.0 / Apache-2.0 同类许可）。
