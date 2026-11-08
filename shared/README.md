# 🧰 shared/ — 两个应用共用的那一半

[`../bilibili`](../bilibili) 和 [`../zhihu`](../zhihu) 是两个独立应用，但它们要干的事一样：
**抓内容 → 送 LLM → 出结构化摘要**。共用的那一部分放在这里，两个应用各 import 自己要的那一块。

| 文件 | 是什么 | 谁在用 |
|---|---|---|
| `llm.py` | LLM 那一层：挑 provider、发起 chat、把回复里的 JSON 抠出来 | bilibili、zhihu |
| `browser_login.py` | 登录入口的编排：找 node、装 playwright-core、开浏览器、验 cookie | bilibili、zhihu |
| `login_state.mjs` | 浏览器那一半（Node + playwright）：停在登录页，等你登录完关窗口，把 storageState 存下来 | `browser_login.py` |
| `sensevoice.py` | 本地语音识别（SenseVoice Small / ONNX int8 / sherpa-onnx），**完全离线** | bilibili、video_analysis |

---

## llm.py

```python
from llm import pick_provider, llm_chat, extract_json

pname, prov, model = pick_provider()             # 第一个 provider 就是默认
raw = llm.llm_chat(prov, model, [{"role": "user", "content": text}])
obj = extract_json(raw)                           # 模型偶尔会包一层 ```，这里能抠出来
```

- provider 配置读 `~/.tea_agent/provider.yaml`（**和 tea_a2 共用一份**）：
  第一个 provider 是默认的；`models` 是字典时取第一个键当默认模型。
- `extract_json` 不只是 `json.loads`：模型爱在 JSON 外面包 ```json … ```，
  还有时前面带一句「好的，以下是 JSON：」——这些都能抠出来。
- `extract_json_loose` 是给**被截断**的回复用的：模型话说到一半被 `max_tokens` 砍掉时，
  严格的 `extract_json` 会退而返回一个**内层**对象（比如 picks 列表里的第一条）——
  看着像成功，其实是错的。`extract_json_loose` 会把缺的引号/括号补回去再解析。
  bili/zhihu 两条线现在都走它。
- `llm_chat` **不把思考过程当答案**：有些模型把 token 先花在思考上，正文是空的。
  这种情况当成失败重试（最多 3 次），而不是把 `reasoning_content` 返回给调用方。
- 依赖：`requests` + `pyyaml`（没装时 import 不报错，用到才给一句清楚的提示）。

---

## browser_login.py + login_state.mjs

`--login` 的完整流程：

1. 找到 state 文件该写哪（环境变量 > 已存在的**本机**候选 > 默认路径）；
2. 调 `node login_state.mjs` 开浏览器（`headless=false`）；
3. 你在窗口里登录 → **把窗口关掉** → 它把 storageState 写下来；
4. 回读文件确认关键 cookie 在，并打印有效期。

- 浏览器必须是**干净的 context**：已登录的 context 打开登录页会直接跳走，根本没有二维码。
- playwright-core 不带浏览器。`login_state.mjs` 会依次找：`CHROME_BIN` →
  playwright 自己下的（`%LOCALAPPDATA%\ms-playwright\chromium-*\…`）→
  系统装的 google-chrome / chromium / edge（`/usr/bin/google-chrome` 这类常见路径 + PATH）。
  都找不到会给两条提示，而不是甩一堆 playwright 堆栈。
- Windows 上第一次运行会自动 `npm i --prefix %LOCALAPPDATA%\Temp\tea_playwright playwright-core`。
- Windows 上如果脚本在 WSL 的 UNC 路径里，node 处理 UNC 路径会出各种怪问题，
  所以先把助手脚本复制一份到 Windows 本地临时目录再跑。
- **写只写本机**：`state_path()` 默认跳过「别系统的挂载盘」（`/mnt/c/…`、
  `/cygdrive/c/…`、`C:\…`，靠 `is_remote_path()` 判断），那些路径只作**读**的兜底——
  往挂载盘上写要过 9p/drvfs，又慢又容易失败。要往那儿写得显式指定：
  `BILI_STATE=…` / `ZHIHU_STATE=…` 或 `--state …`。
- 输出目录没有就现建，并 `chmod 700`（里面是明文 cookie）。

---

## sensevoice.py

本地 ASR：**SenseVoice Small（ONNX int8）+ sherpa-onnx**，纯 CPU、不联网、不依赖 torch。
模型约 158MB，放在 `~/models/sherpa-onnx/`（没有会自动下载）。

```python
from sensevoice import asr_status, extract_audio, asr_transcribe, asr_to_text

ok, why = asr_status(auto=True)                  # 缺运行时/模型会自动装/下载
wav  = extract_audio(media, "out.wav")           # 任意媒体 → 16k 单声道 wav
pieces = asr_transcribe(wav, chunk=60)           # [(起始秒, 文本), ...]
text = asr_to_text(pieces)                       # "[00:12] 你好" 那种逐字稿
```

- 速度约 **4 倍实时**（4 线程；57 分钟音频约 12 分钟跑完）。
- `chunk=60`（秒）按块切，每块留 1 秒重叠——SenseVoice 按 ≤30 秒窗口训练，切块更稳；
  `chunk=0` 表示整段一起送。
- 环境变量：`ASR_BASE`（模型根目录）、`ASR_MODEL`（直接指模型目录）、
  `ASR_MODEL_URL`（换下载源）、`ASR_NO_DOWNLOAD=1`（禁止自动下载，离线用）。
- **Windows 自带的 tar 没有 bzip2**：`tar xjf` 会失败，所以这里优先用 Python 的
  `tarfile`（`r:bz2`）解压/校验，不依赖系统 tar。
- 它的老毛病是**同音错字，专有名词错得最狠**（人名几乎全错）。所以给它的下游
  （做总结的 LLM）要明确要求「按上下文改正并用括号标出原词」。
