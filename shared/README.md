# 🧰 shared/ — 两个应用共用的那一半

[`../bilibili`](../bilibili) 和 [`../zhihu`](../zhihu) 是两个独立应用，但它们要干的事一样：
**抓内容 → 送 LLM → 出结构化摘要**。共用的那一部分放在这里，两个应用各 import 自己要的那一块。

| 文件 | 是什么 | 谁在用 |
|---|---|---|
| `llm.py` | LLM 那一层：挑 provider、发起 chat、把回复里的 JSON 抠出来 | bilibili、zhihu |
| `browser_login.py` | 登录入口的编排：找 node、装 playwright-core、开浏览器、验 cookie | bilibili、zhihu |
| `login_state.mjs` | 浏览器那一半（Node + playwright）：停在登录页，等你登录完关窗口，把 storageState 存下来 | `browser_login.py` |

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
- `llm_chat` **不把思考过程当答案**：有些模型把 token 先花在思考上，正文是空的。
  这种情况当成失败重试（最多 3 次），而不是把 `reasoning_content` 返回给调用方。
- 依赖：`requests` + `pyyaml`（没装时 import 不报错，用到才给一句清楚的提示）。

---

## browser_login.py + login_state.mjs

`--login` 的完整流程：

1. 找到 state 文件该写哪（环境变量 > 已存在的候选 > 默认路径）；
2. 调 `node login_state.mjs` 开浏览器（`headless=false`）；
3. 你在窗口里登录 → **把窗口关掉** → 它把 storageState 写下来；
4. 回读文件确认关键 cookie 在，并打印有效期。

- 浏览器必须是**干净的 context**：已登录的 context 打开登录页会直接跳走，根本没有二维码。
- playwright-core 不带浏览器，得自己指路：`CHROME_BIN`，或让它去找
  `%LOCALAPPDATA%\ms-playwright\chromium-*\chrome-win64\chrome.exe` 这类常见位置。
- Windows 上第一次运行会自动 `npm i --prefix %LOCALAPPDATA%\Temp\tea_playwright playwright-core`。
- Windows 上如果脚本在 WSL 的 UNC 路径里，node 处理 UNC 路径会出各种怪问题，
  所以先把助手脚本复制一份到 Windows 本地临时目录再跑。
