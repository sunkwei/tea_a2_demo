# 📺 IPTV 剧场 · 在线直播播放器

一个跑在本仓库里的 **网页版 IPTV 播放器**：聚合 GitHub 上的公开直播源（M3U 列表），
支持 **在线频道自动更新**、频道搜索 / 分类 / 收藏、批量体检、清晰度切换与可选 EPG 节目单。

```bash
npm install
npm run dev            # http://127.0.0.1:5173/iptv-player/index.html
npm run iptv:serve     # 或用独立服务器跑构建产物（自带流代理）：http://127.0.0.1:5180/iptv-player/index.html
```

### 📦 想直接双击打开？用单文件版

浏览器在 **`file://` 协议下禁止加载外部 ES 模块**（origin 为 null，CORS 拦截），
所以直接双击 `iptv-player/index.html` 只会看到「正在初始化…」——
页面里已经内置了提示，会告诉你该走哪条路。

要能双击即用，生成一份**把 JS/CSS 全部内联的单文件**：

```bash
npm run iptv:single   # → iptv-player/dist-single/iptv-player.html（617 KB）
```

然后双击 `iptv-player/dist-single/iptv-player.html` 即可：
频道列表、搜索、体检、播放全部照常（单文件版没有 `/api/proxy`，
所以只能播自带 CORS 头的源；需要代理时用 `npm run iptv:serve`）。

| 打开方式 | 频道列表 | 本地流代理 | 说明 |
| --- | --- | --- | --- |
| `npm run dev` | ✅ | ✅ | 开发用，Vite 插件提供 `/api/proxy` |
| `npm run iptv:serve` | ✅ | ✅ | 生产产物 + 独立流代理 |
| 双击 `dist-single/iptv-player.html` | ✅ | ❌ | 单文件，零依赖 |
| 双击 `iptv-player/index.html` | ❌ | ❌ | file:// 加载不了 ES 模块（页面内有提示） |

---

## ✨ 功能

| 能力 | 说明 |
| --- | --- |
| 多源聚合 | 内置 **87 个** GitHub 源（iptv-org 国家 / 分类 / 语言 / 大区 + Free-TV），可自由勾选，另支持自定义 M3U 地址 |
| **自动更新** | 定时（默认 30 分钟）+ 启动时 + 页面重新可见时；用 **ETag 条件请求 + 内容哈希** 判断变化，无变化时零流量；更新后提示「新增 / 移除」频道数 |
| GitHub 提交检测 | 源管理器里点 🐙 可查该源所在仓库的**最新提交**（时间 + 提交信息 + 链接） |
| 播放 | hls.js（MSE）优先，Safari 走原生 HLS，直链（mp4/ts）直接播；自动错误恢复、备用线路切换、清晰度选择 |
| 本地流代理 | 直播服务器大多**不带 CORS 头**，仓库内置 `/api/proxy` 同源转发（自动跟随 302、改写清单里的相对 URI、带 ETag 缓存），前端自动探测启用 |
| 频道体检 | 批量并发探测当前列表里的频道是否可用，绿=可播 / 黄=可达 / 红=失效，可一键「隐藏失效」 |
| 收藏 / 最近 | localStorage 持久化；收藏与最近观看都是独立视图 |
| EPG | 支持任意 XMLTV 地址（`.xml` / `.xml.gz`），显示「正在播出 / 稍后」 |
| 其它 | 深色主题、响应式布局、键盘快捷键、IndexedDB 缓存频道（秒开） |

### 快捷键

| 键 | 作用 | 键 | 作用 |
| --- | --- | --- | --- |
| `/` | 聚焦搜索框 | `空格` | 播放 / 暂停 |
| `←` `→` | 上一个 / 下一个频道 | `F` | 收藏当前频道 |
| `M` | 静音 | `Esc` | 关闭抽屉 |

---

## 📡 直播源来自哪些 GitHub 项目

调研（2026-10）后选用的公开项目，全部托管在 GitHub 且带 `Access-Control-Allow-Origin: *`：

| 项目 | Star | 用途 | 地址 |
| --- | --- | --- | --- |
| [iptv-org/iptv](https://github.com/iptv-org/iptv) | 142k | 官方频道索引，每日 PR 更新；按国家 / 分类 / 语言 / 大区出列表 | `https://iptv-org.github.io/iptv/{countries,categories,languages,regions}/<code>.m3u` |
| [iptv-org/epg](https://github.com/iptv-org/epg) | — | 节目单生成器（官方已不再统一发布 XMLTV，故 EPG 做成自填地址） | — |
| [Free-TV/IPTV](https://github.com/Free-TV/IPTV) | 21k | 社区维护的免费频道清单（含按国家拆分） | `https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8` |
| [Guovin/iptv-api](https://github.com/Guovin/iptv-api) | 25k | 自动采集 / 校验 / 测速工具，适合自建源 | — |
| [freearhey/iptv-checker](https://github.com/freearhey/iptv-checker) | 628 | 播放列表体检（Node CLI） | — |
| [Shra1V32/Playlist-AutoUpdater](https://github.com/Shra1V32/Playlist-AutoUpdater) | 716 | 每日自动更新播放列表 | — |

> ⚠️ 公开列表里混有大量失效 / 地域限制 / 需要 Referer 的源，这是公开列表的常态；
> 本项目用「体检 + 失效隐藏 + 备用线路」来兜住，而不是假装每个源都能播。

---

## 🔄 「在线频道自动更新」是怎么做的

1. **拉取**：每个启用的源发一次 `GET`。
   * 走同源代理时带 `If-None-Match` / `If-Modified-Since` —— 上游返回 **304** 就直接跳过解析；
   * 跨域直连**故意不发自定义头**（会触发 CORS 预检，GitHub Pages 不处理预检，会直接失败）；
   * 代理侧维护 ETag 缓存，上游说「没变」时直接回放内容，省一次往返。
2. **判重**：对拉到的文本算 **FNV-1a 哈希**，和上次一致就判定「无变化」，连解析都跳过。
3. **增量比对**：变了才解析，然后按 `tvg-id`（缺失时用 URL）对比 key 集合，得到「新增 / 移除」数量。
4. **落盘**：解析结果写入 **IndexedDB**（下次打开秒开），ETag / 哈希 / 时间戳写入 localStorage。
5. **调度**：默认 30 分钟一轮（可调 5~1440 分钟）；页面从后台切回来时若已过期会立刻补一次。
6. **兜底**：跨域被 CORS 拦下时，按设置里的代理模板（`https://…?url={url}`）重试。

---

## 🧱 目录结构

```
iptv-player/
├─ index.html            页面骨架
├─ styles.css            深色主题
├─ src/
│  ├─ main.js            装配：状态 / 渲染 / 调度 / 抽屉
│  ├─ m3u.js             M3U 解析、去重合并、排序（纯函数，可单测）
│  ├─ sources.js         内置源目录（国家 / 分类 / 语言 / 大区 / 其它项目）
│  ├─ playlist.js        拉取（条件请求 + 代理 + 哈希）+ 增量比对 + GitHub 提交查询
│  ├─ player.js          hls.js / 原生 HLS / 直链 封装，错误恢复与备用线路
│  ├─ health.js          频道可用性探测（并发受限）
│  ├─ epg.js             XMLTV 解析（含 gzip）
│  └─ store.js           设置 / 收藏 / 最近 / 源状态 / IndexedDB 缓存
└─ tools/
   ├─ selftest.mjs       无头自测（解析 / 合并 / 排序 / 源目录体检）
   ├─ check-single.mjs   单文件产物自检（无外链 + 内联脚本语法）
   ├─ shot.mjs           无头验证：加载 → 搜索 → 播放 → 源管理 → 体检，并截图
   ├─ proxy.mjs          本地流代理 + 静态服务器（dev 插件与 serve 共用）
   └─ serve.mjs          独立服务器：dist/ + 流代理
```

---

## 🧪 自测与验证

```bash
node iptv-player/tools/selftest.mjs            # 47 项离线断言
node iptv-player/tools/selftest.mjs --online   # 额外拉真实源验证 CORS / 解析
node iptv-player/tools/shot.mjs                # 无头浏览器跑完整流程 + 截图到 tools/shots/
npm run iptv:single                             # 生成单文件版（带产物自检）
```

最近一次无头验证结果（Edge headless，1600×1000）：

| 步骤 | 结果 |
| --- | --- |
| 频道加载 | 10 个源 → **5355** 个频道（cn 155 / hk 17 / tw 33 / jp 7 / kr 72 / us 299 / uk 1494 / news 1048 / sports 464 / freetv 2053） |
| 搜索 `CCTV` | 命中 53 个频道，列表同步过滤 |
| 播放测试流 | `readyState 4`、`currentTime 8.5s`、**1280×720**、自动画质 720p / 2149 kbps |
| 播放真实频道 | **CCTV-1 综合** 播放成功（1280 宽、缓冲 30s） |
| 二次更新 | 提示「所有源均无变化（已用 ETag 跳过下载）」——条件请求生效 |
| 本地流代理 | `GET /api/proxy?url=…` → 200 且内容为合法 M3U |
| 频道体检 | 40 个频道 → **15 可播 / 25 失效**，状态点正确渲染 |

---

## ⚠️ 已知限制

* **Referer 受限的源播不了**：浏览器不允许脚本设置 `Referer` 请求头，这类源需要服务端代理改写请求头。
* **地域限制**：部分频道仅在特定国家/运营商网络可用。
* **EPG 需自备**：公开 EPG 站点稳定性差，已做成「设置里填 XMLTV 地址」的形式（支持 `.gz`）。
* **静态托管无法用本地代理**：直接把 `dist/` 丢到静态托管时没有 `/api/proxy`，只能播放自带 CORS 头的源；用 `npm run dev` 或 `npm run iptv:serve` 才有完整能力。
* 频道数据来自第三方公开项目，仅用于技术演示，请遵守各源的许可与使用条款。

## License

MIT
