# tea_a2 划词助手

Firefox 扩展：**划词之后在鼠标位置弹出一条横幅**，横幅上有「翻译 / 搜索 / 总结」三个按钮，
点一下就调用 tea_a2 的 `POST http://localhost:8383/api/llm/chat` 把结果直接显示在横幅下面。

另外还有一个**划图识图**：按 `Alt+Shift+A`（或在设置页点「划图识图」）进入选区模式，
在页面上拖出一个矩形 → 抓图 → 交给 tea_a2 的**视觉模型**识别，结果显示在选区旁边。

- 翻译：选中的内容是中文 → 译成英文；不是中文 → 译成中文。系统提示词固定是
  `将下面内容翻译为英文/中文，不思考`（同时把 `reasoning_effort` 设成 `none`，模型不思考）。
- 总结：用思考（`reasoning_effort` 默认 `medium`），先一句话总览再分条列要点。
- 搜索：默认交给 tea_a2 自己联网（请求里带 `search: true`）；接口搜索不稳定时可以切成
  「扩展自己抓搜索结果」。

## 安装

```bash
node tea-select/tools/build.mjs        # 产出 tea-select/dist/tea-select-0.1.0.zip
```

Firefox 里：`about:debugging#/runtime/this-firefox` → **临时载入附加组件** → 选这个 zip。
（正式上架需要 Mozilla 签名，签名后把 zip 改名为 `.xpi` 即可。）

需要 Firefox 115+；本仓库的实测用的是 `Firefox Developer Edition`。

## 用法

1. 在任意网页里用鼠标划一段字（或者 Shift+方向键选字）。
2. 鼠标位置立刻出现一条小横幅：**翻译 · 搜索 · 总结 · ×**。
3. 点某个按钮，横幅下方展开结果面板：标题写着「任务 · provider/model · 耗时」，
   面板里有「复制」「在浏览器打开」（搜索任务才有）「关闭」。
4. **结果面板是常驻的**：滚动页面、点页面别处都不会把它收走（避免读到一半就没了），
   只有点面板上的「关闭」（或按 Esc、横幅上的 ×）才收起。

快捷键：`Alt+Shift+T` 打开设置页（页面上也能用）。

## 识图（划图）

「划图」= 在页面上拖出一个矩形，把这块画面交给模型看。

**怎么触发**

- 页面里按 `Alt+Shift+A`（浏览器级快捷键和页面级快捷键都监听，随手按哪个都管用；
  快捷键可以在设置页改）；
- 设置页点「划图识图」——它会在**最近一个网页标签页**里启动选区模式。

**怎么工作**

1. 内容脚本盖一层全屏的半透明覆盖层（shadow DOM，页面样式管不到它），拖动时用
   `box-shadow` 挖出一个洞，就是选区；
2. 松手后**先把覆盖层藏掉、等两帧**——不然扩展自己的界面会被截进图里；
3. 选区正好盖住一张 `<img>` 的话，**直接用那张原图**（清楚、不受缩放换算影响）；
   否则用 `browser.tabs.captureVisibleTab()` 抓当前可视区域，按
   `缩放 = 抓到的图宽 ÷ 视口宽` 裁出选区（Firefox 的截图含不含滚动条两种情况都算得出来，
   见 `core.js` 的 `computeCaptureScale`）；
4. 抓好的图（PNG，默认最长边缩到 1600）送去 tea_a2。

**tea_a2 那边**

识图走的是 `POST /api/chat`，不是 `/api/llm/chat`——**`/api/llm/chat` 的
`messages[].content` 只收字符串，收不了图片**（content 传数组会被当成空字符串丢掉）。
`/api/chat` 收 `images: [{"data": "<base64>"}]`（不带 `data:` 前缀）：

```jsonc
{
  "workspace_id": "ws_xxx",          // 留空的话扩展自动去 /api/workspaces 挑一个
  "message": "描述这张图片的内容……",   // 设置页里改
  "images": [{ "data": "<base64>" }],
  "provider": "deepseek",
  "model": "deepseek-flash",
  "system_prompt": "你是一个严谨的图片识别助手……",
  "tools": ["__tea_select_no_tools__"], // 一个工具都不给（空数组会被当成「全部工具」）
  "async": true                        // 拿到 turn_id，再轮询 /api/turns/{id}
}
```

- 模型必须在 `provider.yaml` 里声明 `supports_vision: true`，否则服务端直接回
  `vision_unsupported`（本机 8383 上的 `deepseek/deepseek-flash`、
  `minimax/MiniMax-M3` 都是支持的）；
- 单次最多 4 张图、单张 8 MB；一次识图 = 一个新会话（不传 `session_id`）。

## 设置页

点工具栏图标，或 `about:addons` → 齿轮 → 选项。

| 位置 | 字段 | 说明 |
| --- | --- | --- |
| 接口与模型 | 接口地址 | tea_a2 的地址，默认 `http://localhost:8383`（0.18.4，认 `search`）；本机那台是 `http://localhost:8282` |
| | 默认提供商 / 默认模型 | 手填，或点「读取 tea_a2 的提供商」从 `/api/providers` 拉列表 |
| 分任务模型 | 翻译/搜索/总结 的提供商 + 模型 + 思考强度 | 留空 = 用默认；翻译默认 `none`（不思考），总结默认 `medium`（使用思考） |
| 搜索 | 搜索引擎 | Bing（默认）/ DuckDuckGo / Google / 自定义模板 |
| | 搜索方式 | `auto`（默认，接口 + 扩展兜底）/ `api`（只用接口联网）/ `extension`（只用扩展抓的结果） |
| | 抓到的结果交给 tea_a2 归纳 | 关掉就只给你打开搜索页 |
| 识图 | 识图用的提供商 / 模型 / 思考强度 | 留空 = 用默认；**要选支持视觉的模型** |
| | 工作区 | tea_a2 的 workspace id，留空 = 自动挑一个能写的 |
| | 提示词 / 最长边 | 送给模型的话；抓到的图最长边（像素），超了等比缩小 |
| | 快捷键 | 页面里按哪个键进划图模式，默认 `Alt+Shift+A` |
| 交互 | 最少划选字数 / 送模型的最大字符 / 显示思考过程 | |

设置改完自动保存到 `browser.storage.local`。

## 它怎么调 tea_a2

所有请求都走后台脚本（内容脚本不直接联网），请求体是 `/api/llm/chat` 的原生格式：

```jsonc
{
  "provider": "deepseek",
  "model": "deepseek-flash",
  "system": "将下面内容翻译为英文，不思考",
  "messages": [{ "role": "user", "content": "选中的原文" }],
  "reasoning_effort": "none",   // none=不思考；low/medium/high=思考
  "stream": false,
  "search": true                // 只有「搜索」任务带
}
```

`/api/llm/chat` 是**一次模型调用**，没有 agent loop。实测结论（对着本机 tea_a2 0.18.3 打的）：

- `prompt` 或 `messages` 至少给一个；`system`、`provider`、`model`、`temperature`、
  `max_tokens`、`stream`、`reasoning_effort` 都能传。
- 未知字段会被**静默忽略**，不会报错；`search: true` 在 0.18.4 上已经生效（8383 这台），
  8282 那台 0.18.3 也支持但更不稳。
- `reasoning_effort` 支持 `none / minimal / low / medium / high / xhigh / max`；
  `off` 是非法值（会 502）。`none` 时返回的 `reasoning` 是空的；`auto` = 不往上游发这个参数。
- **不是所有模型都收同一个档位**（在 8383 上实测的矩阵）：

  | 模型 | 不传 | none | minimal | low | medium | high |
  | --- | --- | --- | --- | --- | --- | --- |
  | deepseek/deepseek-flash | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
  | minimax/MiniMax-M3.1-Flash | ✅ | ❌ 强制自适应思考 | ✅ | ✅ | ✅ | ✅ |
  | mimo/mimo-v2.6-flash·pro | ✅ | ✅ | ❌ 只认 none/low/medium/high | ✅ | ✅ | ✅ |

  扩展的做法：遇到「这个模型不认这个档位」的报错就沿阶梯降级重试
  （`none → minimal → low → 不指定`，`minimal → low → 不指定`，`high → medium → low → 不指定`…），
  并把这个 provider/model 能用的档位记下来（存 `storage.local`），以后直接用那一档。
  降级发生时，结果面板里会写明「已自动降到 minimal」这样的提示。
  也可以在设置页把思考强度手动设成 `auto`（= 不发这个参数），效果一样。
- 服务端联网搜索**时灵时不灵**：有时会带回带 `[1][2]` 标注和真实链接的答案，有时模型会说
  「当前环境无法访问网络」，偶尔还会把内部工具调用/搜索计划当正文吐出来。
  扩展里做了兜底：识别到 `tool_call` / `ds_safety` / `search_query` 这类杂质时，会换两种问法重试，
  并把杂质从结果里清掉。

## 目录

```
tea-select/
  manifest.json          MV3，Firefox（gecko id: tea-select@tea-a2.local）
  src/core.js            纯逻辑：语言判断、提示词、请求体、搜索结果解析（不碰 DOM）
  src/background.js      后台：设置存取、调用 tea_a2、搜索
  src/content.js         内容脚本：监听划词 → shadow DOM 横幅 → 结果面板；划图选区覆盖层
  src/banner.css.js      横幅样式（注入 shadow root）
  src/options.html/js/css 设置页
  tools/selftest.mjs     核心逻辑单测（node）
  tools/build.mjs        打包 zip
  tools/test-page.html   e2e 用的测试页
  tools/options-harness.html  设置页离线测试台（用假 browser API 跑设置页）
```

## 自测

```bash
node tea-select/tools/selftest.mjs      # 离线断言：语言判断 / 提示词 / 请求体 / 搜索解析 / 设置归一化
node tea-select/tools/selftest-live.mjs  # 联调断言：真打 tea_a2（含模型拒收思考强度的降级重试）
```

划图的端到端（Firefox + WebDriver BiDi，装扩展 → 按快捷键 → 拖选区 → 校验模型读出来的东西）：

```bash
/tmp/bidivenv/bin/python .tea_agent_run/scripts/firefox-vision-e2e.py
```

旧版端到端（会用临时 profile 装进 Firefox Developer Edition，划词 → 点按钮 → 校验结果 → 截图）：

```bash
node .tea_agent_run/scripts/firefox-e2e.mjs
```

## 已知限制

### 识图

- `captureVisibleTab` 抓的是**当前活动标签页**：划图时如果中途切走了标签页，
  扩展会先把标签页切回来再截（可能抢一下焦点）。
- 抓图需要 `<all_urls>` 的 host 权限（`manifest.json` 里已经加了）：
  没有它 Firefox 不让截图，也没法跨域取图片原图。
- 走 `/api/chat` 是因为它是 tea_a2 里唯一收图片的接口——代价是走 agent loop
  （比一次模型调用重），每次识图还会在工作区里落一个新会话。
  想更轻的话，可以在 tea_a2 侧给 `/api/llm/chat` 加一个 `images` 支持，
  扩展只要把 `buildVisionBody` 换成 `/api/llm/chat` 的请求体即可。
- 覆盖层是 `position: fixed` 的：如果页面给 `<body>` 加了 `transform`，
  覆盖层会跟着那个祖先定位，坐标可能偏（很少见）。

- 需要「读取和更改你在所有网站上的数据」的权限：划词横幅要在每个页面里画，这是浏览器的要求。
- 扩展只在顶层页面注入（`all_frames: false`），iframe 里划词不会有横幅。
- 搜索的联网能力取决于 tea_a2 服务端与它背后的 provider（当前是 DeepSeek 的
  `/v1/tools/search`），服务端不稳时建议在设置里把「搜索方式」切成 `extension`。
