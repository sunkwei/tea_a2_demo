# 彩色标签 · Tab Colors（Firefox 扩展）

在 Firefox **原生标签分组**之上，给**每一个标签页**单独加颜色标记：彩色图标 + 强制标题前缀，
一眼就能看出「这个标签是干什么用的」。

---

## 为什么需要它

Firefox 137+ 支持标签分组（组本身有颜色），但**同一个组里的所有标签颜色都一样**，
想在组内再区分「工作 / 学习 / 购物」，就没有现成功能了。

本扩展补上这一层：

| 层级 | 能力 | 实现方式 |
| --- | --- | --- |
| 分组层 | 改 Firefox 原生标签组的颜色 | 直接调用原生 `browser.tabGroups.update()`，效果与 Firefox 自带的组颜色完全一致 |
| 标签层 | 给**单个**标签上色 | 内容脚本改写 `document.title`（强制标题前缀）+ 替换 `<link rel="icon">`（彩色图标） |

> **平台限制说明（重要）**
> Firefox 的 WebExtension API **没有**「单个标签颜色 / 标题」的能力：
> `tabs.update()` 不支持 `color` 也不支持 `title`（源码 `browser/components/extensions/schemas/tabs.json` 里根本没有这两个字段），
> 只有 `tabGroups.update({color})` 能改**整组**颜色。
> 所以标签层的颜色是通过内容脚本改页面实现的——效果就是标签栏里标题前面多了 `🔴 工作`、图标变成带色环的彩色图标。

---

## 功能

- **单标签上色**：9 种颜色 + 清除，作用于当前标签或整个站点
- **强制标题前缀**：`🔴 工作  原来的标题`，页面自己改标题也会被自动补回前缀
- **彩色图标**：把站点 favicon 套上同色圆环（也可切成纯色块），在标签栏一眼区分
- **原生组颜色**：在弹窗里直接改 Firefox 标签组本身的颜色
- **整组染色**：一键把某个组的颜色同时应用到组内每个标签（组内也能再区分）
- **右键菜单**：在标签上右键 → 「🎨 彩色标签」→ 颜色 / 整组染色 / 原生分组颜色
- **作用域**：颜色可以只作用于「此标签」，也可以作用于「整个站点」（关掉浏览器也不丢）
- **工具栏徽章**：当前标签的颜色会显示在扩展按钮上

---

## 安装

### 方式一：临时加载（开发/试用，Firefox 139+）

1. 打开 `about:debugging#/runtime/this-firefox`
2. 点「临时加载附加组件」→ 选择本目录下的 `manifest.json`
3. 顶部工具栏会出现「🎨 彩色标签」按钮

> 临时加载的扩展在**重启 Firefox 后会消失**，重新加载即可（日常使用建议用下面的 xpi / 商店版）。

### 方式二：安装打包好的 xpi

```bash
npx web-ext build --source-dir . --overwrite-dest
# 产物：web-ext-artifacts/tab_colors-1.0.0.zip（改名为 .xpi 即可）
```

安装：Firefox 打开 `about:addons` → 齿轮 → 「Install Add-on From File…」→ 选择该 `.xpi`。
（未签名的 xpi 在 release 版 Firefox 里会被拒绝，Nightly / Developer Edition / ESR 可以直接装；
正式分发建议传到 addons.mozilla.org 签名。）

### 方式三：上架 AMO

```bash
npx web-ext sign --api-key=... --api-secret=... --channel=listed
```

---

## 首次使用

第一次给标签上色时，Firefox 会弹出 **「访问所有网站」** 权限请求——必须允许，
扩展才能改写网页里的标题和图标（否则标签页里的内容脚本不会运行）。

- 弹窗顶部出现「启用」按钮 → 点它 → 在 Firefox 弹窗里选「允许」
- 如果误点了「不允许」：`about:addons` → 找到本扩展 → 「权限」→ 勾选「访问所有网站」

---

## 使用

### 弹窗（点工具栏图标）

- 顶部按 Firefox 原生分组分区，每个组可以改**组颜色**、点「套用到组内」把颜色给组内每个标签
- 每个标签一行：图标 + 标题（带颜色前缀）+ `单`/`站` 切换作用域 + 一排颜色块 + 清除
- 底部「设置」：标题前缀开关、彩色图标开关、图标样式（色环 / 纯色）、自定义标记文字、默认作用域
- 「还原当前窗口所有标签的标题 / 图标」可一键还原

### 右键菜单（在标签上点右键）

```
🎨 彩色标签
  ├ 此标签颜色 → 9 色 + 清除颜色
  ├ 整组染色（组内每个标签）→ 9 色
  ├ 分组颜色（Firefox 原生）→ 9 色
  └ 清除此标签颜色
```

### 作用域

- **单** = 只作用于当前这个标签（颜色记在 tabId 上；同一页面重开也会按 URL 恢复）
- **站** = 作用于整个域名（以后打开该站点的标签自动带这个颜色）

优先级：**标签级 > 站点级**。

---

## 已知限制

- **只对普通网页生效**：`about:` 页面、Firefox 内置 PDF 阅读器、`view-source:`、扩展页面等特权页面不允许注入内容脚本，标题和图标不会被改（但仍然可以被「记录颜色」，只是看不出效果）。
- **改标题会影响网页自身**：网页读到的 `document.title` 是带前缀的，个别依赖标题的站点可能受影响；可在设置里关掉「标题前缀标记」，只保留彩色图标。
- **图标合成**：Firefox 的 `tabs.Tab.favIconUrl` 是 data URI，可以直接用 canvas 合成色环；如果取不到就退化成纯色块。
- **隐私窗口**：需要在 `about:addons` → 本扩展 → 「权限」里允许「在隐私窗口中运行」。
- 颜色只保存在本地 `storage.local`，不上传任何数据。

---

## 目录结构

```
firefox-tab-colors/        扩展本体（可直接被 web-ext 打包）
  manifest.json
  common.js                颜色板等公共定义（IIFE + globalThis，避免重复注入报错）
  background.js            状态存储、标记解析、内容脚本注册、消息路由、右键菜单、徽章
  content.js               改标题前缀 + 换彩色图标（含单例保护，防重复注入叠加前缀）
  popup/                   工具栏弹窗（分组区 + 标签行 + 设置）
  icons/
tab-colors-dev/            开发/验证工具（不属于扩展，不会被打进 xpi）
  tools/rdp.mjs            极简 RDP 客户端（用 devtools 调试协议驱动真实 Firefox）
  tools/e2e.mjs            端到端验证：19 项断言覆盖上色/前缀/图标/作用域/分组/popup/撤销
  tools/serve.mjs          本地静态服务器（测试页）
  tools/shot.mjs           截图（devtools 截图通道）
  test/                    测试网页
```

### 本地跑起来验证

```bash
# 1. 起测试服务器
node tab-colors-dev/tools/serve.mjs 8787

# 2. 用 web-ext 起一个带插件的 Firefox（推荐 Firefox Nightly）
npx web-ext run --source-dir firefox-tab-colors \
  --firefox "C:\Program Files\Firefox Nightly\firefox.exe" \
  --start-url http://127.0.0.1:8787/ --no-input --verbose
# 日志里能看到 "Firefox args: -start-debugger-server <端口>"

# 3. 跑端到端验证（需要上面的端口号）
node tab-colors-dev/tools/e2e.mjs <端口>
```
