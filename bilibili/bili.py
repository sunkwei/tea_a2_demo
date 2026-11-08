# -*- coding: utf-8 -*-
"""bilibili 观看历史 → 字幕 → LLM 摘要 → markdown digest。

独立工具：不依赖 tea_agent 二进制，只共用 ~/.tea_agent/provider.yaml
里的 provider 配置（LLM 那一层在 shared/llm.py）。

    python3 bilibili/bili.py --login                           # 登录：开有头浏览器登录并存 storageState
    python3 bilibili/bili.py fetch      --pages 2 --limit 20     # 拉历史+字幕，存语料
    python3 bilibili/bili.py summarize  --limit 6                # 调 LLM 生成结构化摘要
    python3 bilibili/bili.py digest                              # 输出 markdown digest
    python3 bilibili/bili.py digest     --overview               # 额外做一次跨视频综述
    python3 bilibili/bili.py all                                 # fetch+summarize+digest 一条龙

设计要点：
  * 不用浏览器：B 站这些接口都是「纯 HTTP + cookie」。登录态从一个
    Playwright storageState 文件里读（cookie 是明文，跨 OS 通用）。
  * 字幕要**认准视频**：B 站的 player/v2 会随机串台，把别的视频的字幕轨
    一起返回（同样 lan='ai-zh'，id 和内容却是另一个视频的）。实测命中率
    只有一半，所以要多试。认准的办法有两个，两个都用上：
      1) x/web-interface/view 的 subtitle.list 是稳定的权威轨道列表，
         用轨道 id 跟它比对（view 的 id 偶尔会少最后一位，所以还加前缀匹配）；
      2) 正确的字幕 URL 形如 /bfs/ai_subtitle/prod/{aid}{cid}{hash}，
         里面连着 aid 和 cid。
    两条都不满足的轨道一律丢掉，宁可没有字幕也不要串台的。
  * 字幕不重抓：corpus 里已有的 bvid 直接复用（--refresh 强制重抓）。
  * 摘要用结构化 JSON 输出，方便下游（微信推送、Web UI）消费。
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
SHARED = os.path.join(os.path.dirname(HERE), "shared")
if SHARED not in sys.path:
    sys.path.insert(0, SHARED)

import llm  # noqa: E402  （shared/llm.py：provider 选择 / chat / JSON 抽取）
from sensevoice import (asr_status, asr_transcribe, asr_to_text,  # noqa: E402
                       extract_audio, fmt_time as fmt_time_asr)

# 延迟依赖：--login 只要标准库，裸 Python 也能跑
try:
    import requests
except ImportError:
    requests = None

HOME = os.path.expanduser("~")
STATE_DIR = os.environ.get("BILI_HOME") or os.path.join(HOME, ".tea_agent", "bili")
CORPUS = os.path.join(STATE_DIR, "corpus.json")
SUMMARIES = os.path.join(STATE_DIR, "summaries.json")
DIGEST = os.path.join(STATE_DIR, "digest.md")

# 登录态：**写**永远写本机，**读**可以顺带认一下别系统挂载盘上导出的那份。
#
#   写：--login 在本机建目录、写文件（Linux/macOS: ~/.tea_agent/bili_state.json，
#       Windows: ~/Documents/pw_bilibili.json）。
#   读：按下面顺序找，找到第一个就用；/mnt/c 那种挂载盘排在最后，只当兜底
#       （比如 Windows 上登录过一次、把文件放那儿，这边拿来用）。
WIN_DOCS = os.path.join(HOME, "Documents")
LOCAL_STATE = os.path.join(HOME, ".tea_agent", "bili_state.json")
STATE_CANDIDATES = [
    os.environ.get("BILI_STATE", ""),
    LOCAL_STATE,
    os.path.join(WIN_DOCS, "pw_bilibili.json"),
    "/mnt/c/Users/Hetin/Documents/pw_bilibili.json",
]
if os.name == "nt":
    STATE_DEFAULT = os.path.join(WIN_DOCS, "pw_bilibili.json")
else:
    STATE_DEFAULT = LOCAL_STATE

# 命令行 --state 指定的登录态文件（有它就优先用它）
STATE_OVERRIDE = ""

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")

# 字幕语言优先级：人写的 > AI 中文 > 其它（英文/日文翻译稿也能用）
LAN_PRIORITY = {"zh-CN": 0, "zh-Hans": 0, "zh-Hant": 1, "ai-zh": 2, "zh": 3,
                "ai-en": 5, "ai-ja": 6}


# --------------------------------------------------------------------------
# 登录态
# --------------------------------------------------------------------------
def load_cookies(allow_anon=False):
    """读登录态。allow_anon=True 时没有登录态也能跑（游客视角）。"""
    candidates = ([STATE_OVERRIDE] if STATE_OVERRIDE else []) + STATE_CANDIDATES
    for path in candidates:
        if path and os.path.exists(path):
            with open(path, "r", encoding="utf-8") as fh:
                st = json.load(fh)
            jar = [(c["name"], c["value"], c["domain"]) for c in st.get("cookies", [])
                   if c["domain"].endswith(("bilibili.com", "bilibili.cn",
                                            "biligame.com", "huasheng.cn"))]
            print("[bili] 登录态: %s (%d 个 cookie)" % (path, len(jar)))
            return jar
    if allow_anon:
        return []
    raise SystemExit("找不到登录态文件。先跑 `python bili.py --login` 登录一次"
                     "（登录态会写到本机 %s），"
                     "或用 --state /path/to/state.json（或 BILI_STATE=…）指定。"
                     % STATE_DEFAULT)


def make_session(allow_anon=False):
    if requests is None:
        raise SystemExit("需要 requests：pip3 install requests")
    s = requests.Session()
    s.headers.update({
        "User-Agent": UA,
        "Referer": "https://www.bilibili.com/",
        "Origin": "https://www.bilibili.com",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9",
    })
    for name, value, domain in load_cookies(allow_anon=allow_anon):
        s.cookies.set(name, value, domain=domain, path="/")
    if allow_anon:
        # 匿名也先拿个 buvid，不然 B 站接口一律 -352（风控）
        bootstrap_anon(s)
    return s


def api(sess, url, tries=3):
    """调 B 站 API，返回 data；失败重试。"""
    last = None
    for i in range(tries):
        try:
            r = sess.get(url, timeout=20)
            j = r.json()
            if j.get("code") == 0:
                return j.get("data")
            last = "code=%s msg=%s" % (j.get("code"), j.get("message"))
        except Exception as exc:                      # 网络抖动 / 返回不是 json
            last = repr(exc)
        time.sleep(1.0 + i)
    raise RuntimeError("接口失败 %s: %s" % (url, last))


# --------------------------------------------------------------------------
# 抓取
# --------------------------------------------------------------------------
def fetch_history(sess, pages=2, ps=30):
    """观看历史（按时间倒序），带翻页。"""
    items, cursor = [], None
    for _ in range(pages):
        url = ("https://api.bilibili.com/x/web-interface/history/cursor"
               "?ps=%d&type=archive" % ps)
        if cursor:
            url += "&max=%s" % cursor
        data = api(sess, url)
        lst = data.get("list") or []
        if not lst:
            break
        for v in lst:
            items.append({
                "bvid": (v.get("history") or {}).get("bvid"),
                "cid": (v.get("history") or {}).get("cid"),
                "aid": (v.get("history") or {}).get("oid"),
                "title": v.get("title"),
                "author": v.get("author_name"),
                "tag": v.get("tag_name"),
                "view_at": v.get("view_at"),
                "progress": v.get("progress"),
                "duration": v.get("duration"),
                "url": v.get("uri"),
            })
        cursor = (data.get("cursor") or {}).get("max")
        if not cursor:
            break
    return items


def auth_track_ids(sess, bvid):
    """这个视频**真正的**字幕轨道 id 集合。来源：view 的 subtitle.list（稳定）。"""
    view = api(sess, "https://api.bilibili.com/x/web-interface/view?bvid=%s" % bvid)
    lst = (view.get("subtitle") or {}).get("list") or []
    return [str(t.get("id")) for t in lst if t.get("id")]


def id_matches(tid, auth_ids):
    """轨道 id 和权威 id 比对。

    view 的 list 里的 id 偶尔会少最后一位（208297600337016268 对上
    2082976003370162688），所以不能只比相等，前缀相同也算。
    """
    tid = str(tid or "")
    if not tid:
        return False
    for a in auth_ids:
        a = str(a)
        if tid == a or tid.startswith(a) or a.startswith(tid):
            return True
    return False


def pick_track(tracks, auth_ids, aid, cid):
    """从 player/v2 的返回里挑属于本视频的轨道。

    先用权威 id 匹配，再用「URL 里含 {aid}{cid}」匹配；都挑不到就返回 None
    （宁可没有字幕，也不要串台的）。
    """
    by_id = [t for t in tracks if id_matches(t.get("id"), auth_ids)]
    if by_id:
        by_id.sort(key=lambda t: LAN_PRIORITY.get(t.get("lan"), 9))
        return by_id[0]
    if aid and cid:
        exact = "%s%s" % (aid, cid)
        by_url = [t for t in tracks if exact in (t.get("subtitle_url") or "")]
        if by_url:
            by_url.sort(key=lambda t: LAN_PRIORITY.get(t.get("lan"), 9))
            return by_url[0]
    return None


def fetch_subtitle(sess, bvid, cid, aid=None, tries=24):
    """字幕正文。返回 (lines, lan)。拿不到就抛异常。

    player/v2 每次返回的轨道集合是随机的（会串台），实测 bvid&cid 这一路的
    命中率约一半，所以要多试几次。
    """
    auth_ids = auth_track_ids(sess, bvid)
    if not auth_ids:
        raise RuntimeError("这个视频没有字幕")
    reason = "player/v2 返回的轨道都不是本视频的（串台）"
    for attempt in range(tries):
        try:
            pv = api(sess, "https://api.bilibili.com/x/player/v2?bvid=%s&cid=%s" % (bvid, cid))
        except Exception as exc:
            reason = str(exc)
            time.sleep(0.4)
            continue
        tracks = ((pv.get("subtitle") or {}).get("subtitles")) or []
        track = pick_track(tracks, auth_ids, aid, cid)
        if not track:
            time.sleep(0.3)
            continue
        url = track.get("subtitle_url") or ""
        if not url:
            reason = "权威轨道没有 url"
            time.sleep(0.3)
            continue
        if url.startswith("//"):
            url = "https:" + url
        try:
            body = sess.get(url, timeout=30).json()
        except Exception as exc:
            reason = "字幕正文下载失败 %r" % (exc,)
            time.sleep(0.3)
            continue
        lines = body.get("body") or []
        if not lines:
            reason = "字幕正文为空"
            time.sleep(0.3)
            continue
        return lines, track.get("lan")
    raise RuntimeError("取不到字幕: %s" % reason)


def ratio(item):
    dur = item.get("duration") or 0
    pos = item.get("progress") or 0
    if pos < 0 or dur <= 0:
        return 0.0
    return min(1.0, pos / dur)


def cmd_fetch(args):
    sess = make_session()
    items = fetch_history(sess, pages=args.pages)
    print("[bili] 历史 %d 条" % len(items))

    # 只留「看得比较认真」的：看得过半，或者绝对时长够长
    picked, seen = [], set()
    for it in items:
        if not it["bvid"] or it["bvid"] in seen:
            continue
        r = ratio(it)
        if r < args.min_ratio and (it.get("progress") or 0) < args.min_seconds:
            continue
        seen.add(it["bvid"])
        picked.append(it)
        if len(picked) >= args.limit:
            break
    print("[bili] 入选 %d 条（观看比例 ≥ %.0f%% 或 ≥ %ds）" %
          (len(picked), args.min_ratio * 100, args.min_seconds))

    corpus = {}
    if os.path.exists(CORPUS):
        with open(CORPUS, "r", encoding="utf-8") as fh:
            corpus = json.load(fh)

    got, miss, dropped = 0, [], []
    for n, it in enumerate(picked, 1):
        bvid = it["bvid"]
        old = corpus.get(bvid)
        if old and not args.refresh and old.get("lines"):
            print("  [%2d/%d] %s  (已有字幕，跳过)" % (n, len(picked), it["title"][:28]))
            continue
        try:
            lines, lan = fetch_subtitle(sess, bvid, it["cid"], it.get("aid"))
        except Exception as exc:
            print("  [%2d/%d] %s  字幕失败: %s" % (n, len(picked), it["title"][:28], exc))
            if args.asr:
                ok, why = asr_status(auto=not args.no_download)
                if not ok:
                    print("        ASR 也用不了: %s" % why)
                else:
                    try:
                        wav = fetch_audio(sess, bvid, it["cid"],
                                          os.path.join(STATE_DIR, "%s.wav" % bvid))
                        pieces = asr_transcribe(wav, chunk=args.asr_chunk, progress=False)
                        lines = asr_to_lines(pieces, chunk=args.asr_chunk)
                        if lines:
                            it["sub_lines"] = len(lines)
                            it["sub_chars"] = sum(len(x["content"]) for x in lines)
                            it["sub_lan"] = "asr-sensevoice"
                            it["sub_head"] = " / ".join(x["content"] for x in lines[:3])[:80]
                            corpus[bvid] = {"meta": it, "lines": lines}
                            got += 1
                            print("        ASR 顶上：%d 句（%s）" % (len(lines), it["sub_lan"]))
                            time.sleep(0.4)
                            continue
                    except Exception as exc2:
                        print("        ASR 失败: %s" % exc2)
            miss.append(it["title"])
            # 旧数据可能是串台留下的，丢掉，宁可没有也不要错的
            if old and args.refresh and corpus.pop(bvid, None):
                dropped.append(it["title"])
            continue
        it["sub_lines"] = len(lines)
        it["sub_chars"] = sum(len(x.get("content", "")) for x in lines)
        it["sub_lan"] = lan
        it["sub_head"] = " / ".join(x.get("content", "") for x in lines[:3])[:80]
        corpus[bvid] = {"meta": it, "lines": lines}
        got += 1
        print("  [%2d/%d] %s  字幕 %d 行 (%s)" % (n, len(picked), it["title"][:28], len(lines), lan))
        time.sleep(0.4)                       # 别把人家接口打爆

    os.makedirs(STATE_DIR, exist_ok=True)
    os.chmod(STATE_DIR, 0o700)
    with open(CORPUS, "w", encoding="utf-8") as fh:
        json.dump(corpus, fh, ensure_ascii=False, indent=1)
    print("[bili] 语料: %d 个视频 → %s（新抓 %d，无字幕 %d，丢弃旧数据 %d）" %
          (len(corpus), CORPUS, got, len(miss), len(dropped)))


# --------------------------------------------------------------------------
# discover：去 bilibili.com 找「值得收藏」的视频
#
#   候选来源（都是 B 站自己的接口）：
#     * 首页推荐   x/web-interface/index/top/feed/rcmd   ← www.bilibili.com 首屏
#     * 综合热门   x/web-interface/popular
#     * 全站排行榜 x/web-interface/ranking/v2
#   游客也能跑：先访问一次首页拿 buvid（不然接口一律 -352 风控）。
#   拿到候选后逐条补详情（简介/分区/标签/收藏数…），用启发式分粗筛，
#   再交给 LLM 挑出「值得收藏」的若干条并给理由。
# --------------------------------------------------------------------------
import base64
import math
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor

DISCOVER_MD = os.path.join(STATE_DIR, "discover.md")
DISCOVER_JSON = os.path.join(STATE_DIR, "discover.json")


def bootstrap_anon(sess):
    """匿名也要先弄个 buvid，否则 B 站接口直接 -352（风控）。"""
    try:
        sess.get("https://www.bilibili.com/", timeout=20)
    except Exception:
        pass
    try:
        j = sess.get("https://api.bilibili.com/x/frontend/finger/spi", timeout=20).json()
        data = j.get("data") or {}
        for key, ck in (("b_3", "buvid3"), ("b_4", "buvid4")):
            if data.get(key):
                sess.cookies.set(ck, data[key], domain=".bilibili.com", path="/")
    except Exception:
        pass


def fetch_rcmd(sess, ps=30, fresh_idx=1):
    """首页推荐流（登录了就是个性化，没登录就是通用推荐）。"""
    url = ("https://api.bilibili.com/x/web-interface/index/top/feed/rcmd"
           "?ps=%d&fresh_type=3&feed_version=V8&fresh_idx=%d&fresh_idx_1h=%d"
           "&brush=0&homepage_ver=1&y_num=3" % (ps, fresh_idx, fresh_idx))
    data = api(sess, url)
    return data.get("item") or []


def fetch_popular(sess, ps=20, pages=1):
    """综合热门。"""
    out = []
    for pn in range(1, pages + 1):
        data = api(sess, "https://api.bilibili.com/x/web-interface/popular?ps=%d&pn=%d"
                   % (ps, pn))
        out.extend(data.get("list") or [])
    return out


def fetch_ranking(sess):
    """全站排行榜（含收藏/投币/播放综合分）。"""
    data = api(sess, "https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all")
    return data.get("list") or []


def fetch_weekly(sess, issues=2):
    """每周必看（B 站自己做的每周精选，编辑品味，质量最高的一批）。"""
    data = api(sess, "https://api.bilibili.com/x/web-interface/popular/series/list")
    nums = [it.get("number") for it in (data.get("list") or [])
            if it.get("number") and it.get("status") == 2]
    out = []
    for num in nums[:issues]:
        try:
            one = api(sess, "https://api.bilibili.com/x/web-interface/popular/series/one"
                      "?number=%s" % num)
        except Exception:
            continue
        out.extend(one.get("list") or [])
    return out


# 值得收藏的分区：知识、科技数码、动物圈（收藏率普遍比热门娱乐高）
WORTH_RIDS = [(36, "知识"), (188, "科技数码"), (217, "动物圈")]


def fetch_region_ranking(sess, rids=None):
    """分区排行榜：热门榜被娱乐内容占满，知识/科技区才是「值得收藏」的重镇。"""
    out = []
    for rid, name in (rids or WORTH_RIDS):
        try:
            data = api(sess, "https://api.bilibili.com/x/web-interface/ranking/v2"
                       "?rid=%d&type=all" % rid)
        except Exception:
            continue
        for v in (data.get("list") or []):
            v["_rid"] = name
            out.append(v)
    return out


def enrich(sess, bv):
    """补齐一个视频的详情：简介、分区、标签、完整数据。"""
    try:
        v = api(sess, "https://api.bilibili.com/x/web-interface/view?bvid=%s" % bv)
    except Exception:
        return None
    tags = []
    try:
        tl = api(sess, "https://api.bilibili.com/x/tag/archive/tags?bvid=%s" % bv)
        tags = [t.get("tag_name") for t in (tl or []) if t.get("tag_name")]
    except Exception:
        pass
    stat = v.get("stat") or {}
    owner = v.get("owner") or {}
    return {
        "bvid": bv,
        "aid": v.get("aid"),
        "title": v.get("title"),
        "author": owner.get("name"),
        "mid": owner.get("mid"),
        "duration": v.get("duration") or 0,
        "tname": v.get("tname") or "",
        "desc": (v.get("desc") or "").strip(),
        "pubdate": v.get("pubdate") or 0,
        "tags": tags[:8],
        "view": stat.get("view") or 0,
        "like": stat.get("like") or 0,
        "coin": stat.get("coin") or 0,
        "favorite": stat.get("favorite") or 0,
        "share": stat.get("share") or 0,
        "danmaku": stat.get("danmaku") or 0,
        "reply": stat.get("reply") or 0,
        "url": "https://www.bilibili.com/video/%s" % bv,
    }


def value_score(v):
    """启发式「值得收藏」分：收藏量级 + 收藏率 + 点赞率 + 投币率 + 时长偏好。

    收藏率（收藏÷播放）是核心信号——收藏多说明「想留着以后回看」，
    而不是「看一眼热闹」。
    """
    view = max(int(v.get("view") or 0), 1)
    fav = int(v.get("favorite") or 0)
    like = int(v.get("like") or 0)
    coin = int(v.get("coin") or 0)
    dur = int(v.get("duration") or 0)
    pts = 0.0
    pts += min(3.0, 3.0 * (math.log10(1 + fav) / 5.0))   # 收藏量级
    pts += min(2.0, (fav / view) * 20)                    # 收藏率（5% → 1 分）
    pts += min(1.0, (like / view) * 10)                   # 点赞率
    pts += min(1.0, (coin / view) * 100)                  # 投币率（知识向）
    if 180 <= dur <= 7200:
        pts += 1.0                                        # 3 分钟 ~ 2 小时：能装下完整内容
    elif dur >= 60:
        pts += 0.5
    return round(pts, 2)


WATCH_PROMPT = """你在帮用户「看」一个 B 站视频。素材有两部分：
- 字幕：视频里说的话（自动识别的，可能有错字）
- 画面描述：按时间顺序抽出的画面帧，由视觉模型描述（人物、场景、画面上的文字）

请综合两者，写一份**这个视频到底在讲什么**的说明，包含：
- 一句话概括
- 主要内容（分点讲清楚它的论点/流程/情节，不要照抄字幕）
- 画面里出现的关键信息（画面上的文字、演示的步骤等）
- 值得注意的点（结论、数据、金句）

如果两部分有矛盾，以字幕（作者自己的话）为准，并注明。

**语音转写里有同音错字**（ASR 的老毛病），看到明显的要按上下文改正并在括号里标出原词，
例如「偷啃」→ Token、「鬼真草」→ 鬼针草、「香春/春树」→ 香椿、「撒波/撒尿」等；
不确定的保留原样。用中文 Markdown 输出。"""

DISCOVER_PROMPT = """你在帮一个 B 站用户挑「值得收藏」的视频。
「收藏」的意思是：以后还会回来看——知识、教程、工具、测评、攻略、值得反复看的作品；
而不是看完就忘的热闹、切片、纯情绪视频。

下面是刚从 B 站首页推荐 / 综合热门 / 全站排行榜抓来的候选，每条带：
- 标题、UP 主、分区、时长、标签、简介
- 播放 / 点赞 / 投币 / **收藏** 数量，以及收藏率（收藏 ÷ 播放）
- 一个启发式分数（收藏量级 + 收藏率 + 点赞率 + 投币率 + 时长偏好）

请**只依据上面的信息**判断，不要编造视频里没有的内容。挑出 **6 到 10 条**最值得收藏的
（候选不够就少给，别硬凑），理由要说清楚「为什么值得收藏 / 以后回来看能得到什么」，
一句话、不超过 40 字。教程、工具、测评、攻略、系统讲解这类「回看价值高」的优先；
纯热闹的娱乐内容除非它本身是值得反复看的好作品，否则不要选。

用 JSON 回答，不要加任何解释文字：

{
  "picks": [
    {"bvid": "...", "title": "...", "why": "一句话理由",
     "category": "知识科普|科技数码|AI|游戏|娱乐|生活|音乐|运动|其他",
     "worth": 9}
  ],
  "themes": ["这批视频整体偏好的方向，2-4 条"],
  "skip_notes": ["看着热闹但不太值得收藏的典型，1-2 条"]
}"""


def _fmt_dur(sec):
    sec = int(sec or 0)
    h, m, s = sec // 3600, (sec % 3600) // 60, sec % 60
    return ("%d:%02d:%02d" % (h, m, s)) if h else ("%d:%02d" % (m, s))


def _fmt_num(n):
    n = int(n or 0)
    if n >= 10000:
        return "%.1f万" % (n / 10000.0)
    return str(n)


def cmd_discover(args):
    sess = make_session(allow_anon=True)
    logged = any(c.name == "SESSDATA" for c in sess.cookies)
    print("[bili] %s" % ("已登录：按你的口味推荐" if logged else "未登录：游客视角推荐"))

    cands, buckets = {}, {}

    def take(source, items):
        """items 是接口原样返回的列表；rcmd 里混着直播/广告，只留视频。"""
        got = 0
        for it in items:
            if it.get("goto") not in (None, "", "av"):
                continue
            bv = it.get("bvid")
            if not bv or bv in cands:
                continue
            cands[bv] = {"bvid": bv, "source": source}
            buckets.setdefault(source, []).append(bv)
            got += 1
        print("  %s：%d 条（可用 %d）" % (source, len(items), got))

    sources = [
        ("首页推荐", lambda: fetch_rcmd(sess, ps=30, fresh_idx=1)),
        ("首页推荐(刷新)", lambda: fetch_rcmd(sess, ps=30, fresh_idx=2)),
        ("每周必看", lambda: fetch_weekly(sess, issues=args.weekly_issues)),
        ("综合热门", lambda: fetch_popular(sess, ps=20, pages=args.popular_pages)),
        ("全站排行榜", lambda: fetch_ranking(sess)),
        ("知识科技排行", lambda: fetch_region_ranking(sess)),
    ]
    for name, fn in sources:
        if args.sources and name.split("(")[0] not in args.sources:
            continue
        try:
            take(name, fn())
        except Exception as exc:
            print("  %s 取不到：%s" % (name, exc))

    if not cands:
        raise SystemExit("一个候选都没拿到（B 站接口可能在风控）")

    # 各来源**轮流**取候选，免得某一个来源把名额占满
    order = []
    src_names = list(buckets)
    while len(order) < args.candidates:
        added = False
        for name in src_names:
            if not buckets[name]:
                continue
            bv = buckets[name].pop(0)
            if bv not in order:
                order.append(bv)
                added = True
            if len(order) >= args.candidates:
                break
        if not added:
            break

    # 补详情
    target = order[:args.candidates]
    details = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        for v in pool.map(lambda bv: enrich(sess, bv), target):
            if v:
                v["source"] = cands[v["bvid"]]["source"]
                v["score"] = value_score(v)
                details.append(v)
    details.sort(key=lambda v: v["score"], reverse=True)
    print("[bili] 候选 %d 条 → 补齐详情 %d 条" % (len(cands), len(details)))

    pool_list = details[:args.pool]
    blob = []
    for v in pool_list:
        view = max(int(v.get("view") or 0), 1)
        blob.append(
            "#%d %s\n- bvid: %s | UP: %s | 分区: %s | 时长: %s\n"
            "- 播放 %s | 点赞 %s | 投币 %s | 收藏 %s | 收藏率 %.1f%% | 启发式分 %.2f\n"
            "- 标签: %s\n- 简介: %s" % (
                pool_list.index(v) + 1, v.get("title"), v.get("bvid"), v.get("author"),
                v.get("tname"), _fmt_dur(v.get("duration")),
                _fmt_num(v.get("view")), _fmt_num(v.get("like")), _fmt_num(v.get("coin")),
                _fmt_num(v.get("favorite")), 100.0 * v.get("favorite", 0) / view,
                v.get("score"), "、".join(v.get("tags") or []) or "无",
                (v.get("desc") or "")[:120]))
    print("[llm] 送评 %d 条候选" % len(pool_list))

    picks, themes, skip, raw = [], [], [], ""
    if not args.no_llm:
        pname, prov, model = llm.pick_provider(args.provider, args.model)
        print("[llm] provider=%s model=%s" % (pname, model))
        try:
            raw = llm_chat_resilient(
                pname, model,
                [{"role": "system", "content": DISCOVER_PROMPT},
                 {"role": "user", "content": "\n\n".join(blob)}], max_tokens=6000,
                label="llm")
            obj = llm.extract_json_loose(raw)
            # 模型有时不叫 picks（推荐/推荐列表/shortlist…），都认一下
            for key in ("picks", "推荐", "pick", "shortlist", "videos", "items"):
                val = obj.get(key)
                if isinstance(val, list) and val:
                    picks = val
                    break
            if not picks:
                print("[llm] 回复里没有可用的精选列表，退回启发式排序"
                      "（原话已存 %s）" % DISCOVER_JSON)
            for key in ("themes", "口味", "整体口味"):
                if isinstance(obj.get(key), list) and obj.get(key):
                    themes = obj[key]
                    break
            for key in ("skip_notes", "不推荐", "skip"):
                if isinstance(obj.get(key), list) and obj.get(key):
                    skip = obj[key]
                    break
        except Exception as exc:
            print("[llm] 失败，退回启发式排序：%s" % exc)

    by_bv = {v["bvid"]: v for v in details}
    if not picks:
        picks = [{"bvid": v["bvid"], "title": v["title"],
                  "why": "收藏 %s（收藏率 %.1f%%），时长 %s" % (
                      _fmt_num(v["favorite"]),
                      100.0 * v["favorite"] / max(v["view"], 1), _fmt_dur(v["duration"])),
                  "category": v.get("tname") or "其他", "worth": None}
                 for v in pool_list[:args.top]]

    out = []
    out.append("# B 站值得收藏的视频\n")
    out.append("> 生成于 %s ｜ 来源：首页推荐 + 每周必看 + 综合热门 + 全站排行榜 + 知识科技分区榜%s\n"
               % (time.strftime("%Y-%m-%d %H:%M"), "" if logged else "（游客视角）"))
    out.append("> 候选 %d 条 → 启发式粗筛 %d 条 → 精选 %d 条\n"
               % (len(cands), len(pool_list), len(picks)))
    out.append("## 精选清单\n")
    picked_bv = []
    for i, p in enumerate(picks, 1):
        v = by_bv.get(p.get("bvid")) or {}
        picked_bv.append(p.get("bvid"))
        out.append("### %d. %s\n" % (i, p.get("title") or v.get("title")))
        out.append("- **UP主**：%s ｜ **分区**：%s ｜ **时长**：%s\n"
                   % (v.get("author"), p.get("category") or v.get("tname") or "未知",
                      _fmt_dur(v.get("duration"))))
        if v:
            view = max(int(v.get("view") or 0), 1)
            out.append("- **数据**：播放 %s ｜ 点赞 %s ｜ 投币 %s ｜ **收藏 %s**（收藏率 %.1f%%）\n"
                       % (_fmt_num(v.get("view")), _fmt_num(v.get("like")),
                          _fmt_num(v.get("coin")), _fmt_num(v.get("favorite")),
                          100.0 * v.get("favorite", 0) / view))
        if p.get("why"):
            out.append("- **为什么值得收藏**：%s\n" % p["why"])
        if v.get("tags"):
            out.append("- **标签**：%s\n" % "、".join(v["tags"][:6]))
        if v.get("desc"):
            out.append("- **简介**：%s\n" % v["desc"][:160])
        out.append("- **链接**：%s\n" % (v.get("url") or
                                        "https://www.bilibili.com/video/%s" % p.get("bvid")))

    if themes:
        out.append("\n## 这批视频的整体口味\n")
        for t in themes:
            out.append("- %s" % t)
    if skip:
        out.append("\n## 热闹但不必收藏\n")
        for t in skip:
            out.append("- %s" % t)

    rest = [v for v in details if v["bvid"] not in picked_bv][:args.rest]
    if rest:
        out.append("\n## 其它候选（没进精选，但收藏率不错）\n")
        out.append("| 标题 | UP主 | 时长 | 收藏 | 收藏率 | 链接 |")
        out.append("|---|---|---|---|---|---|")
        for v in rest:
            view = max(int(v.get("view") or 0), 1)
            out.append("| %s | %s | %s | %s | %.1f%% | [看](%s) |" % (
                (v.get("title") or "")[:40], v.get("author"), _fmt_dur(v.get("duration")),
                _fmt_num(v.get("favorite")), 100.0 * v.get("favorite", 0) / view, v.get("url")))

    text = "\n".join(out)
    os.makedirs(STATE_DIR, exist_ok=True)
    os.chmod(STATE_DIR, 0o700)
    with open(DISCOVER_MD, "w", encoding="utf-8") as fh:
        fh.write(text)
    with open(DISCOVER_JSON, "w", encoding="utf-8") as fh:
        json.dump({"at": int(time.time()), "logged_in": logged,
                   "candidates": details, "picks": picks, "themes": themes,
                   "llm_raw": raw[:8000]},
                  fh, ensure_ascii=False, indent=1)
    print("[discover] 精选 %d 条 → %s" % (len(picks), DISCOVER_MD))
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(text)
        print("[discover] → %s" % args.out)
    else:
        print(text)

    if args.fav:
        add_favorites(sess, [b for b in picked_bv if b], args)
    if args.watch_later:
        add_watch_later(sess, [b for b in picked_bv if b])


def _cookie(sess, name):
    for c in sess.cookies:
        if c.name == name:
            return c.value
    return None


# --------------------------------------------------------------------------
# watch：真的「看」一个视频
#
#   两条通道：
#     1) 字幕（x/player/v2）→ 文本，B 站自己给的（人写的 / AI 识别 / 翻译）
#     2) 画面（playurl 下视频流 → ffmpeg 抽帧 → 视觉模型）→ 图像
#   两条都拿到后合并成一个总结。
#
#   视觉模型走 tea_a2 的 POST /api/chat（**只有它吃图片**，
#   /api/llm/chat 的 content 只收字符串）。tea_a2 一条消息最多 4 张图，
#   所以帧要分批送。
# --------------------------------------------------------------------------
TEA_API_DEFAULT = "http://127.0.0.1:8383"
WATCH_DIR = os.path.join(STATE_DIR, "watch")


def fetch_playurl(sess, bvid, cid, qn=64):
    """拿播放地址。

    优先用**渐进式 MP4**（fnval=1）：画面和声音在同一条流里，一次下载
    既能抽帧又能提音频。DASH 的 `video` 数组里混着纯音频流（挑到就白下了），
    所以只有拿不到 durl 时才退回 DASH。
    """
    data = api(sess, "https://api.bilibili.com/x/player/playurl?bvid=%s&cid=%s"
               "&qn=%d&fnval=1&fourk=1&platform=html5" % (bvid, cid, qn))
    durl = data.get("durl") or []
    if durl:
        return {"url": durl[0].get("url"), "size": durl[0].get("size"),
                "kind": "mp4", "width": None, "height": None, "qn": qn,
                "audio": None}
    # 回退：DASH
    data = api(sess, "https://api.bilibili.com/x/player/playurl?bvid=%s&cid=%s"
               "&qn=%d&fnval=16&fourk=1" % (bvid, cid, qn))
    dash = data.get("dash") or {}
    vids = dash.get("video") or []
    if not vids:
        raise RuntimeError("拿不到播放地址（这个视频可能需要大会员/付费）")
    ok = [v for v in vids if (v.get("id") or 0) <= qn] or vids
    track = sorted(ok, key=lambda v: v.get("bandwidth") or 0)[0]
    return {
        "url": track.get("baseUrl") or track.get("base_url"),
        "width": track.get("width"), "height": track.get("height"),
        "qn": track.get("id"), "kind": "dash", "size": None,
        "audio": (dash.get("audio") or [{}])[0].get("baseUrl")
                 or (dash.get("audio") or [{}])[0].get("base_url"),
    }


def has_video_stream(path):
    """这个文件里到底有没有视频流（DASH 里混着纯音频流，会坑死抽帧）。"""
    if not shutil.which("ffprobe"):
        return True
    try:
        out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v",
                              "-show_entries", "stream=codec_type", "-of", "csv=p=0", path],
                             stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                             timeout=60).stdout.decode()
        return "video" in out
    except Exception:
        return True


def curl_download(url, dest, timeout=300, need_cookies=True):
    """下载一个 URL。

    **cookie 写临时文件**（curl -b），**不**塞进命令行——不然 curl 报错时
    argv 会被整个打印出来，SESSDATA 就进日志了。
    """
    args = ["curl", "-sSL", "--max-time", str(timeout), "-o", dest, url,
            "-H", "Referer: https://www.bilibili.com/",
            "-H", "User-Agent: " + UA]
    cfile = None
    if need_cookies:
        jar = load_cookies(allow_anon=True)
        if jar:
            cfile = dest + ".cookies.txt"
            with open(cfile, "w", encoding="utf-8") as fh:
                fh.write("# Netscape HTTP Cookie File\n")
                for name, value, domain in jar:
                    fh.write("%s\tTRUE\t/\tFALSE\t0\t%s\t%s\n"
                             % (domain if domain.startswith(".") else "." + domain,
                                name, value))
            args += ["-b", cfile]
    try:
        subprocess.run(args, check=True, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL)
    except subprocess.CalledProcessError as exc:
        raise RuntimeError("下载失败（curl 退出码 %s）" % exc.returncode)
    finally:
        if cfile and os.path.exists(cfile):
            try:
                os.remove(cfile)
            except OSError:
                pass
    if not os.path.exists(dest) or os.path.getsize(dest) < 1024:
        raise RuntimeError("下载失败（文件是空的）")
    return dest


def download_media(sess, url, dest):
    """下载媒体流。B 站的 CDN 要 Referer，缺了会 403。"""
    if os.path.exists(dest) and os.path.getsize(dest) > 1024:
        return dest
    curl_download(url, dest)
    return dest


def extract_frames(video, outdir, interval=20, width=512):
    """按固定间隔抽帧，缩到 width 宽（省 token）。"""
    if not shutil.which("ffmpeg"):
        raise RuntimeError("没装 ffmpeg，抽不了帧（apt install ffmpeg）")
    os.makedirs(outdir, exist_ok=True)
    for f in os.listdir(outdir):
        if f.endswith(".jpg"):
            os.remove(os.path.join(outdir, f))
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", video,
                    "-vf", "fps=1/%d,scale=%d:-1" % (max(1, interval), width),
                    "-q:v", "4", os.path.join(outdir, "f%03d.jpg")],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return sorted(os.path.join(outdir, f) for f in os.listdir(outdir)
                  if f.endswith(".jpg"))


def fetch_audio(sess, bvid, cid, dest_wav, media=None):
    """拿 16k 单声道 wav。

    有 media（已经下好的 MP4）就直接从里面提；没有就单独下音频轨
    （只有音轨时体积小得多）。
    """
    if os.path.exists(dest_wav) and os.path.getsize(dest_wav) > 1024:
        return dest_wav
    if media and os.path.exists(media):
        return extract_audio(media, dest_wav)
    data = api(sess, "https://api.bilibili.com/x/player/playurl?bvid=%s&cid=%s"
               "&qn=64&fnval=16&fourk=1" % (bvid, cid))
    dash = data.get("dash") or {}
    auds = dash.get("audio") or []
    if not auds:
        raise RuntimeError("拿不到音频轨")
    raw = os.path.splitext(dest_wav)[0] + ".m4s"
    # 老域名 mcdn.bilivideo.cn:8082 经常连断，优先用正常的 upos-* CDN，
    # 而且多个轨要逐个试（第一个挂了还有备胎）
    urls = [a.get("baseUrl") or a.get("base_url") for a in auds]
    urls = sorted(urls, key=lambda u: (0 if u and "mcdn.bilivideo.cn" not in u else 1))
    last = None
    for url in urls:
        if not url:
            continue
        try:
            curl_download(url, raw)
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", raw,
                            "-ar", "16000", "-ac", "1", dest_wav],
                           check=True, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL)
            if os.path.exists(dest_wav) and os.path.getsize(dest_wav) > 1024:
                return dest_wav
            last = RuntimeError("转 wav 失败")
        except Exception as exc:
            last = exc
            continue
    raise RuntimeError("音频下载/转换都失败了：%s" % last)


def extract_sheets(video, outdir, interval=10, width=640, cols=3, rows=3):
    """抽帧并**拼成大图**：一张图 = cols×rows 帧（每格烧了时间戳）。

    tea_a2 一条消息最多 4 张图，直接一张一张发等于一次只看 4 帧；
    拼图之后一张图管 9 帧，一条消息能看 36 帧。
    """
    if not shutil.which("ffmpeg"):
        raise RuntimeError("没装 ffmpeg，抽不了帧（apt install ffmpeg）")
    os.makedirs(outdir, exist_ok=True)
    for f in os.listdir(outdir):
        if f.endswith(".jpg"):
            os.remove(os.path.join(outdir, f))
    font = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    vf = "fps=1/%d,scale=%d:-1" % (max(1, interval), width)
    if os.path.exists(font):
        # 每格左上角写上时间戳，模型才能说「第 1 分 20 秒那格」
        vf += (",drawtext=fontfile=%s:text='%%{pts\\:hms}':x=8:y=8:fontsize=26"
               ":fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=4" % font)
    vf += ",tile=%dx%d" % (cols, rows)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", video, "-vf", vf,
                    "-q:v", "3", os.path.join(outdir, "sheet%02d.jpg")],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return sorted(os.path.join(outdir, f) for f in os.listdir(outdir)
                  if f.endswith(".jpg"))


def tea_workspaces(tea_api):
    r = requests.get(tea_api + "/api/workspaces", timeout=20)
    data = r.json()
    wlist = data.get("workspaces") if isinstance(data, dict) else data
    if isinstance(wlist, dict):
        wlist = wlist.get("workspaces")
    for w in (wlist or []):
        if w.get("id") and w.get("exists") is not False and w.get("writable") is not False:
            return w["id"]
    return (wlist or [{}])[0].get("id", "")


def tea_vision(tea_api, workspace_id, images, prompt, provider, model, timeout=300):
    """送一批图给 tea_a2 的视觉模型，返回文字。

    注意：tea_a2 一条消息**最多 4 张图**（超了报 too_many_images）。
    """
    body = {
        "workspace_id": workspace_id,
        "message": prompt,
        "images": [{"data": base64.b64encode(open(p, "rb").read()).decode()}
                   for p in images],
        "provider": provider,
        "model": model,
        "tools": ["__tea_select_no_tools__"],   # 一个工具都不给它
        "async": True,
    }
    r = requests.post(tea_api + "/api/chat", json=body, timeout=180)
    if r.status_code not in (200, 202):
        raise RuntimeError("tea_a2 拒了：%s %s" % (r.status_code, r.text[:200]))
    turn_id = (r.json() or {}).get("turn_id")
    if not turn_id:
        raise RuntimeError("tea_a2 没给 turn_id：%s" % r.text[:200])
    deadline = time.time() + timeout
    while time.time() < deadline:
        d = requests.get(tea_api + "/api/turns/" + turn_id, timeout=30).json()
        state = d.get("state")
        if state and state != "running":
            if d.get("error"):
                raise RuntimeError("tea_a2 回合出错：%s" % d.get("error"))
            return d.get("result") or ""
        time.sleep(1.5)
    raise RuntimeError("视觉识别超时")


def _watch_merge(args, bv, title, dur, v, transcript, asr_text):
    """只跑「合并总结」这一步（--merge-only）。"""
    blob_path = os.path.join(WATCH_DIR, bv, "blob.txt")
    if not os.path.exists(blob_path):
        raise SystemExit("[watch] 没有 %s，先跑一次完整 watch" % blob_path)
    with open(blob_path, "r", encoding="utf-8") as fh:
        blob = fh.read()
    pname, prov, model = llm.pick_provider(args.provider, args.model)
    print("[llm] 合并总结（%s/%s）…" % (pname, model))
    summary = ""
    try:
        summary = llm_chat_resilient(pname, model,
                                     [{"role": "system", "content": WATCH_PROMPT},
                                      {"role": "user", "content": blob}],
                                     max_tokens=16000, label="llm")
    except Exception as exc:
        print("[llm] 总结失败：%s" % exc)
    path = os.path.join(STATE_DIR, "watch_%s.md" % bv)
    old_text = ""
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as fh:
            old_text = fh.read()
    tail = old_text.split("## 语音转写")[1] if "## 语音转写" in old_text else ""
    text = ("# %s\n\n> %s ｜ UP：%s ｜ 时长 %s ｜ https://www.bilibili.com/video/%s\n\n"
            "## 总结\n\n%s\n\n## 语音转写%s" % (
                title, bv, (v.get("owner") or {}).get("name"),
                "%d:%02d" % (dur // 60, dur % 60), bv, summary or "（没跑出来）", tail))
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
    print("[watch] → %s" % path)
    print(summary)


def asr_to_lines(pieces, chunk=60):
    """把 ASR 的分段转成字幕那种逐句格式：[{from, content}, ...]。

    粗粒度的时间戳按句子在块内均分——够用（能定位到大概哪一分钟）。
    """
    import re
    lines = []
    for start, text in pieces:
        parts = [p for p in re.split(r"(?<=[。！？!?；;\n])", text) if p.strip()]
        if not parts:
            parts = [text]
        step = (chunk / float(len(parts))) if parts else chunk
        t = float(start)
        for p in parts:
            lines.append({"from": round(t, 2), "content": p.strip()})
            t += step
    return lines


def cmd_watch(args):
    """看一个视频：字幕 + 画面帧 → 总结。"""
    bv = args.bvid
    sess = make_session(allow_anon=True)
    v = api(sess, "https://api.bilibili.com/x/web-interface/view?bvid=%s" % bv)
    cid = v.get("cid")
    title = v.get("title")
    dur = v.get("duration") or 0
    print("[watch] %s ｜ %s ｜ %ss" % (bv, title, dur))

    # 1) 字幕
    transcript = ""
    if args.merge_only:
        print("[watch] --merge-only：跳过下载/识图/转写，只重跑合并总结")
        return _watch_merge(args, bv, title, dur, v, "", "")
    try:
        lines, lan = fetch_subtitle(sess, bv, cid, v.get("aid"))
        transcript = "\n".join("[%s] %s" % (round(x.get("from", 0)), x.get("content"))
                                for x in lines)
        print("[watch] 字幕 %d 行（%s）" % (len(lines), lan))
    except Exception as exc:
        print("[watch] 没字幕：%s" % exc)

    # 1.5) 本地 ASR（SenseVoice）：没字幕时顶上，或者跟字幕互相印证
    asr_text = ""
    mode = args.asr
    if mode == "auto":
        mode = "never" if transcript else "always"
    if mode == "always":
        ok, why = asr_status(auto=not args.no_download)
        if not ok:
            print("[watch] 本地 ASR 用不了：%s" % why)
        else:
            try:
                os.makedirs(WATCH_DIR, exist_ok=True)
                wav = fetch_audio(sess, bv, cid, os.path.join(WATCH_DIR, "%s.wav" % bv),
                                  media=os.path.join(WATCH_DIR, "%s.mp4" % bv))
                print("[watch] 本地 ASR（SenseVoice）转写中…")
                t0 = time.time()
                pieces = asr_transcribe(wav, chunk=args.asr_chunk)
                asr_text = asr_to_text(pieces)
                print("[watch] ASR 完成 %d 段，耗时 %.1fs" % (len(pieces), time.time() - t0))
            except Exception as exc:
                print("[watch] ASR 失败：%s" % exc)

    # 2) 画面
    frame_notes = []
    frames = []
    if not args.no_frames:
        try:
            os.makedirs(WATCH_DIR, exist_ok=True)
            os.chmod(WATCH_DIR, 0o700)
            pu = fetch_playurl(sess, bv, cid, qn=args.qn)
            vpath = os.path.join(WATCH_DIR, "%s.mp4" % bv)
            print("[watch] 下载媒体流（%s）…" % ("MP4" if pu.get("kind") == "mp4"
                                             else "%sx%s" % (pu["width"], pu["height"])))
            download_media(sess, pu["url"], vpath)
            if not has_video_stream(vpath):
                raise RuntimeError("下到的文件里没有视频流（DASH 挑到纯音频轨了）")
            per = args.tile_cols * args.tile_rows
            print("[watch] 抽帧（每 %ss 一帧，%dx%d 拼成一张图）…" % (args.interval, args.tile_cols, args.tile_rows))
            if per <= 1:
                frames = extract_frames(vpath, os.path.join(WATCH_DIR, bv),
                                        args.interval, args.width)
            else:
                frames = extract_sheets(vpath, os.path.join(WATCH_DIR, bv),
                                        args.interval, args.sheet_width,
                                        args.tile_cols, args.tile_rows)
            nframes = len(frames) * per
            print("[watch] %d 张图（每张最多 %d 帧，合计约 %d 帧）"
                  % (len(frames), per, nframes))

            tea_api = args.tea_api
            wid = tea_workspaces(tea_api)
            print("[watch] 视觉模型：tea_a2 @ %s（%s/%s）" % (tea_api, args.vision_provider, args.vision_model))
            base_prompt = ("这是一个 B 站视频的**连续画面**（按时间先后排好，"
                           "%dx%d 一张图，每格左上角的时间戳就是它在视频里的位置，"
                           "相邻格间隔约 %d 秒）。\n"
                           "请按时间顺序描述：画面里出现了什么（人物、场景、"
                           "**画面上的文字**），这一段在讲什么；最后用一句话概括这一段。"
                           % (args.tile_cols, args.tile_rows, max(1, args.interval)))
            prev = ""
            per_call = max(1, min(4, args.vision_per_call))
            for i in range(0, len(frames), per_call):
                batch = frames[i:i + per_call]
                prompt = base_prompt
                if prev:
                    # 把上一批的描述带上去，叙事才接得上（不然每批都从零开始）
                    prompt += ("\n\n【上一批（第 %d-%d 格）的描述】\n%s\n"
                               "请接着上一批继续说，不要重复已经说过的内容。"
                               % (max(1, i - per + 1), i, prev[:1500]))
                txt = tea_vision(tea_api, wid, batch, prompt,
                                 args.vision_provider, args.vision_model)
                prev = txt
                lo = i + 1
                hi = min((i + len(batch)) * per, nframes)
                frame_notes.append("【第 %d-%d 格】\n%s" % (lo, hi, txt))
                print("[watch] 识图 %d/%d 张（覆盖到第 %d 格）"
                      % (min(i + 4, len(frames)), len(frames), hi))
        except Exception as exc:
            print("[watch] 画面这条路没走通：%s" % exc)
            if not args.keep_going:
                if not transcript:
                    raise
                frame_notes = []

    # 3) 合并总结
    blob = "# 视频\n标题：%s\nUP主：%s\n时长：%s 秒\n简介：%s\n\n" % (
        title, (v.get("owner") or {}).get("name"), dur, (v.get("desc") or "")[:300])
    if transcript:
        blob += "## 字幕（逐句，B 站给的）\n" + transcript[:args.max_chars] + "\n\n"
    if asr_text:
        blob += ("## 语音转写（本地 SenseVoice 跑的，逐字）\n"
                 + asr_text[:args.max_chars] + "\n\n")
    if frame_notes:
        blob += "## 画面描述\n" + "\n\n".join(n[:1200] for n in frame_notes) + "\n\n"

    # blob 存下来：改提示词/换模型时可以只重跑合并，不用再下视频重识图
    blob_dir = os.path.join(WATCH_DIR, bv)
    os.makedirs(blob_dir, exist_ok=True)
    blob_path = os.path.join(blob_dir, "blob.txt")
    if args.merge_only and os.path.exists(blob_path):
        with open(blob_path, "r", encoding="utf-8") as fh:
            blob = fh.read()
        print("[watch] 复用 %s" % blob_path)
    else:
        with open(blob_path, "w", encoding="utf-8") as fh:
            fh.write(blob)

    summary = ""
    if not args.no_llm:
        pname, prov, model = llm.pick_provider(args.provider, args.model)
        print("[llm] 合并总结（%s/%s）…" % (pname, model))
        try:
            summary = llm_chat_resilient(
                pname, model,
                [{"role": "system", "content": WATCH_PROMPT},
                 {"role": "user", "content": blob}], max_tokens=16000, label="llm")
        except Exception as exc:
            print("[llm] 总结失败：%s" % exc)

    out = []
    out.append("# %s\n" % title)
    out.append("> %s ｜ UP：%s ｜ 时长 %s ｜ %s\n" % (
        bv, (v.get("owner") or {}).get("name"),
        "%d:%02d" % (dur // 60, dur % 60), "https://www.bilibili.com/video/%s" % bv))
    if summary:
        out.append("## 总结\n")
        out.append(summary + "\n")
    if transcript:
        out.append("## 字幕全文\n")
        out.append(transcript + "\n")
    if asr_text:
        out.append("## 语音转写（本地 SenseVoice）\n")
        out.append(asr_text + "\n")
    if frame_notes:
        out.append("## 画面描述\n")
        out.append("\n\n".join(frame_notes) + "\n")
    text = "\n".join(out)

    os.makedirs(STATE_DIR, exist_ok=True)
    path = os.path.join(STATE_DIR, "watch_%s.md" % bv)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
    print("[watch] → %s" % path)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(text)
        print("[watch] → %s" % args.out)
    else:
        print(text[:4000])


def add_watch_later(sess, bvids):
    """把视频加进「稍后再看」。

    接口是 POST https://api.bilibili.com/x/v2/history/toview/add
    （form: aid=<aid> & csrf=<bili_jct>），网页端点「添加至稍后再看」也是这个。
    （接口是抓网页真实点击抓出来的：.tea_agent_run/scripts/bili-probe-watchlater-api.mjs）
    """
    csrf = _cookie(sess, "bili_jct")
    if not (csrf and _cookie(sess, "SESSDATA")):
        raise SystemExit("[bili] 加「稍后再看」要登录态：先跑 `python bili.py --login`")
    ok, fail = 0, []
    for bv in bvids:
        try:
            v = api(sess, "https://api.bilibili.com/x/web-interface/view?bvid=%s" % bv)
            aid = v.get("aid")
            r = sess.post("https://api.bilibili.com/x/v2/history/toview/add",
                          data={"aid": aid, "csrf": csrf},
                          headers={"Referer": "https://www.bilibili.com/video/%s" % bv,
                                   "Origin": "https://www.bilibili.com"},
                          timeout=20).json()
            if r.get("code") == 0:
                ok += 1
                print("  ✓ %s" % (v.get("title") or bv)[:60])
            else:
                fail.append((bv, r.get("message")))
                print("  ✗ %s：%s" % ((v.get("title") or bv)[:60], r.get("message")))
        except Exception as exc:
            fail.append((bv, repr(exc)))
            print("  ✗ %s：%r" % (bv, exc))
        time.sleep(0.4)
    print("[bili] 稍后再看：成功 %d，失败 %d" % (ok, len(fail)))
    return ok, fail


def fetch_watch_later(sess, ps=100):
    """读回「稍后再看」列表（最新在前）。"""
    data = api(sess, "https://api.bilibili.com/x/v2/history/toview?type=add")
    lst = data.get("list") or []
    out = []
    for it in lst[:ps]:
        out.append({
            "bvid": it.get("bvid"),
            "aid": it.get("aid"),
            "title": it.get("title"),
            "author": it.get("author_name") or (it.get("owner") or {}).get("name"),
            "duration": it.get("duration"),
            "add_at": it.get("add_at"),
        })
    return out


def add_favorites(sess, bvids, args):
    """把选中的视频加进收藏夹（需要登录态）。"""
    csrf = _cookie(sess, "bili_jct")
    sessdata = _cookie(sess, "SESSDATA")
    if not (csrf and sessdata):
        raise SystemExit("[bili] 加收藏要登录态：先跑 `python bili.py --login`")
    nav = api(sess, "https://api.bilibili.com/x/web-interface/nav")
    mid = (nav.get("data") or {}).get("mid")
    folders = (api(sess, "https://api.bilibili.com/x/v3/fav/folder/created/list-all"
                    "?up_mid=%s" % mid) or {}).get("list") or []
    fid = args.fav_fid
    if not fid:
        if folders:
            fid = folders[0]["id"]
            print("[bili] 收藏夹：%s（%s）" % (folders[0]["title"], fid))
        else:
            r = sess.post("https://api.bilibili.com/x/v3/fav/folder/create",
                          data={"title": "值得收藏", "intro": "tea_a2 帮你挑的",
                                "privacy": "0", "csrf": csrf, "cross_domain": "true"},
                          headers={"Referer": "https://www.bilibili.com/", "Origin": "https://www.bilibili.com"},
                          timeout=20).json()
            if r.get("code") != 0:
                raise SystemExit("[bili] 建收藏夹失败：%s" % r.get("message"))
            fid = (r.get("data") or {}).get("id")
            print("[bili] 新建收藏夹：值得收藏（%s）" % fid)
    ok, fail = 0, []
    for bv in bvids:
        try:
            v = api(sess, "https://api.bilibili.com/x/web-interface/view?bvid=%s" % bv)
            aid = v.get("aid")
            r = sess.post("https://api.bilibili.com/x/v3/fav/resource/add",
                          data={"fid": fid, "aid": aid, "type": 2, "csrf": csrf,
                                "cross_domain": "true"},
                          headers={"Referer": "https://www.bilibili.com/",
                                   "Origin": "https://www.bilibili.com"},
                          timeout=20).json()
            if r.get("code") == 0:
                ok += 1
                print("  ✓ %s" % (v.get("title") or bv)[:50])
            else:
                fail.append((bv, r.get("message")))
                print("  ✗ %s：%s" % ((v.get("title") or bv)[:50], r.get("message")))
        except Exception as exc:
            fail.append((bv, repr(exc)))
            print("  ✗ %s：%r" % (bv, exc))
    print("[bili] 加收藏完成：成功 %d，失败 %d" % (ok, len(fail)))


# --------------------------------------------------------------------------
# LLM
#
# provider 选择 / chat / JSON 抽取都在 shared/llm.py 里（知乎那边也用同一份）
# --------------------------------------------------------------------------
SUMMARY_PROMPT = """你是一个观看记录整理助手。下面给你一个 B 站视频的标题、UP 主和字幕（可能是自动识别/翻译的，会有错字）。

请只依据字幕内容总结，不要编造字幕里没有的信息。用 JSON 回答，不要加任何解释文字：

{
  "summary": "一到两句话概括这个视频讲了什么（中文）",
  "key_points": ["要点1", "要点2", "要点3"],
  "quotes": ["字幕里最有信息量的一句原话（可以少于3条，没有就留空数组）"],
  "topics": ["主题标签1", "主题标签2"],
  "category": "AI评测|科技数码|知识科普|游戏|娱乐|生活|体育|其他"
}"""

OVERVIEW_PROMPT = """下面是你最近观看的若干 B 站视频的摘要。请写一份「我最近在看什么」的综述。

用 JSON 回答，不要加解释文字：

{
  "headline": "一句话概括这段时间你的关注点",
  "themes": [{"theme": "主题", "detail": "这个主题下你看了什么、有什么共同点"}],
  "notable": ["值得注意的具体内容（模型对比结论、新技术、值得记住的事实等）"],
  "suggestions": ["基于这些内容，你可能还想看/该关注的方向"]
}"""


def cmd_summarize(args):
    if not os.path.exists(CORPUS):
        raise SystemExit("没有语料，先跑 fetch")
    with open(CORPUS, "r", encoding="utf-8") as fh:
        corpus = json.load(fh)
    summaries = {}
    if os.path.exists(SUMMARIES):
        with open(SUMMARIES, "r", encoding="utf-8") as fh:
            summaries = json.load(fh)

    pname, prov, model = llm.pick_provider(args.provider, args.model)
    print("[llm] provider=%s model=%s" % (pname, model))

    todo = [b for b in corpus if args.refresh or not summaries.get(b, {}).get("summary")]
    todo = todo[:args.limit]
    print("[llm] 待处理 %d 个（已有 %d 个摘要）" % (len(todo), len(summaries)))
    if not todo:
        return

    for n, bvid in enumerate(todo, 1):
        entry = corpus[bvid]
        meta = entry["meta"]
        lines = entry["lines"]
        text = "\n".join("[%s] %s" % (round(x.get("from", 0)), x.get("content", ""))
                         for x in lines)
        if len(text) > args.max_chars:
            text = text[:args.max_chars] + "\n…（字幕过长已截断）"
        head = "标题：%s\nUP主：%s\n分区：%s\n时长：%s 秒\n字幕语言：%s\n\n字幕：\n" % (
            meta.get("title"), meta.get("author"), meta.get("tag"),
            meta.get("duration"), meta.get("sub_lan"))
        print("  [%d/%d] %s" % (n, len(todo), (meta.get("title") or "")[:30]))
        try:
            raw = llm.llm_chat(prov, model,
                               [{"role": "system", "content": SUMMARY_PROMPT},
                                {"role": "user", "content": head + text}])
            obj = llm.extract_json_loose(raw)
        except Exception as exc:
            print("      失败: %s" % exc)
            continue
        obj["bvid"] = bvid
        obj["title"] = meta.get("title")
        obj["author"] = meta.get("author")
        obj["tag"] = meta.get("tag")
        obj["url"] = meta.get("url")
        obj["view_at"] = meta.get("view_at")
        obj["watch_ratio"] = round(ratio(meta), 3)
        obj["sub_lan"] = meta.get("sub_lan")
        obj["model"] = model
        obj["at"] = int(time.time())
        summaries[bvid] = obj
        print("      %s" % (obj.get("summary") or "")[:70])

    os.makedirs(STATE_DIR, exist_ok=True)
    with open(SUMMARIES, "w", encoding="utf-8") as fh:
        json.dump(summaries, fh, ensure_ascii=False, indent=1)
    print("[llm] 摘要 → %s（%d 个）" % (SUMMARIES, len(summaries)))


# --------------------------------------------------------------------------
# digest
# --------------------------------------------------------------------------
CAT_ORDER = ["AI评测", "科技数码", "知识科普", "游戏", "娱乐", "生活", "体育", "其他"]


def load_summaries():
    if not os.path.exists(SUMMARIES):
        raise SystemExit("没有摘要，先跑 summarize")
    with open(SUMMARIES, "r", encoding="utf-8") as fh:
        return json.load(fh)


def fmt_time(ts):
    if not ts:
        return ""
    return time.strftime("%m-%d %H:%M", time.localtime(ts))


def cmd_digest(args):
    summaries = load_summaries()
    items = [s for s in summaries.values() if s.get("summary")]
    items.sort(key=lambda s: s.get("view_at") or 0, reverse=True)
    if args.limit:
        items = items[:args.limit]

    groups = {}
    for s in items:
        groups.setdefault(s.get("category") or "其他", []).append(s)

    out = []
    out.append("# 我最近在看什么\n")
    out.append("> 生成于 %s ｜ 共 %d 个视频\n" %
               (time.strftime("%Y-%m-%d %H:%M"), len(items)))

    overview = None
    if args.overview and items:
        pname, prov, model = llm.pick_provider(args.provider, args.model)
        print("[llm] 生成跨视频综述 (%s/%s) …" % (pname, model))
        blob = "\n\n".join(
            "#%d %s（UP：%s）\n%s\n要点：%s" %
            (i + 1, s.get("title"), s.get("author"), s.get("summary"),
             "；".join(s.get("key_points") or []))
            for i, s in enumerate(items))
        try:
            overview = llm.extract_json_loose(llm.llm_chat(
                prov, model,
                [{"role": "system", "content": OVERVIEW_PROMPT},
                 {"role": "user", "content": blob}], max_tokens=2000))
        except Exception as exc:
            print("[llm] 综述失败: %s" % exc)

    if overview:
        out.append("## 一句话\n")
        out.append("%s\n" % overview.get("headline", ""))
        for th in overview.get("themes") or []:
            out.append("- **%s**：%s" % (th.get("theme"), th.get("detail")))
        if overview.get("notable"):
            out.append("\n### 值得记住的点\n")
            for n in overview["notable"]:
                out.append("- %s" % n)
        if overview.get("suggestions"):
            out.append("\n### 可能还想看\n")
            for n in overview["suggestions"]:
                out.append("- %s" % n)
        out.append("\n---\n")

    out.append("## 分组浏览\n")
    for cat in CAT_ORDER + [c for c in groups if c not in CAT_ORDER]:
        if cat not in groups:
            continue
        out.append("### %s（%d）\n" % (cat, len(groups[cat])))
        for s in groups[cat]:
            out.append("**%s**  \n%s ｜ UP：%s ｜ %s ｜ 看到 %.0f%%\n" % (
                s.get("title"), fmt_time(s.get("view_at")), s.get("author"),
                "、".join(s.get("topics") or []), (s.get("watch_ratio") or 0) * 100))
            out.append("%s\n" % s.get("summary"))
            for kp in s.get("key_points") or []:
                out.append("- %s" % kp)
            for q in s.get("quotes") or []:
                out.append("  > %s" % q)
            out.append("- 链接：%s\n" % (s.get("url") or
                                         "https://www.bilibili.com/video/%s" % s.get("bvid")))

    text = "\n".join(out)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(text)
        print("[digest] → %s" % args.out)
    else:
        print(text)


def cmd_show(args):
    """终端里快速看一眼：最近 n 条。"""
    summaries = load_summaries()
    items = sorted(summaries.values(), key=lambda s: s.get("view_at") or 0, reverse=True)
    for s in items[:args.limit]:
        print("%s  %s" % (fmt_time(s.get("view_at")), (s.get("title") or "")[:44]))
        print("    %s" % (s.get("summary") or "")[:100])


def cmd_all(args):
    """一条龙：抓 → 摘要 → digest。"""
    cmd_fetch(args)
    cmd_summarize(args)
    args.out = args.out or DIGEST
    args.overview = True
    cmd_digest(args)
    print("\n[digest] %s" % args.out)


def cmd_watchlater(args):
    """看 / 改「稍后再看」列表。"""
    sess = make_session()
    if args.add:
        add_watch_later(sess, args.add)
    if args.list or not args.add:
        items = fetch_watch_later(sess, ps=args.limit)
        print("[bili] 稍后再看 %d 条：" % len(items))
        for i, it in enumerate(items, 1):
            print("  %2d. %s  %s  (%s)" % (
                i, it.get("bvid"), (it.get("title") or "")[:40], it.get("author")))


def cmd_asr(args):
    """只要语音转写（本地 SenseVoice，不联网）。"""
    ok, why = asr_status(auto=not args.no_download)
    if not ok:
        raise SystemExit("[asr] %s" % why)
    bv = args.bvid
    sess = make_session()
    v = api(sess, "https://api.bilibili.com/x/web-interface/view?bvid=%s" % bv)
    cid = v.get("cid")
    print("[asr] %s ｜ %s" % (bv, v.get("title")))
    os.makedirs(STATE_DIR, exist_ok=True)
    wav = fetch_audio(sess, bv, cid, os.path.join(STATE_DIR, "%s.wav" % bv))
    t0 = time.time()
    pieces = asr_transcribe(wav, chunk=args.chunk)
    text = asr_to_text(pieces)
    print("[asr] %d 段，耗时 %.1fs" % (len(pieces), time.time() - t0))
    out = ["# %s\n" % v.get("title"),
           "> %s ｜ UP：%s ｜ 本地 SenseVoice Small (int8) 转写\n" % (
               bv, (v.get("owner") or {}).get("name")),
           text, ""]
    path = os.path.join(STATE_DIR, "asr_%s.md" % bv)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(out))
    print("[asr] → %s" % path)
    print(text[:args.limit])


# 备胎顺序：deepseek-flash 这类会把预算全花在思考上（正文为空），
# mimo-v2.6-pro / MiniMax 做长文本总结更稳。
LLM_FALLBACKS = [("mimo", "mimo-v2.6-pro"), ("minimax", "MiniMax-M3.1-Flash")]


def llm_chat_resilient(prov, model, messages, max_tokens=8000, label="llm"):
    """先试指定的 provider；失败就自动换备胎。返回文本。"""
    tries = [(prov, model)]
    for p, m in LLM_FALLBACKS:
        if (p, m) != (prov, model):
            tries.append((p, m))
    last = None
    for p, m in tries:
        try:
            _name, cfg, mname = llm.pick_provider(p, m)
            txt = llm.llm_chat(cfg, mname, messages, max_tokens=max_tokens)
            if txt and txt.strip():
                if (p, m) != (prov, model):
                    print("[%s] 主 provider 不行，换 %s/%s 成功" % (label, p, m))
                return txt
            last = RuntimeError("%s/%s 返回空" % (p, m))
        except Exception as exc:
            last = exc
            print("[%s] %s/%s 失败：%s" % (label, p, m, str(exc)[:140]))
    raise last or RuntimeError("所有 provider 都失败了")


def cmd_login(args):
    """登录入口：开有头浏览器登录 B 站，把 storageState 存下来。"""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import browser_login

    out = args.state or browser_login.state_path("BILI_STATE", STATE_CANDIDATES,
                                                 STATE_DEFAULT)
    if browser_login.is_remote_path(out):
        print("[bili] 提示：目标是挂载盘上的路径（%s），写入慢且容易失败；"
              "要写本机就加 --state %s" % (out, LOCAL_STATE))
    ok, msg = browser_login.login(
        url="https://passport.bilibili.com/login",
        out=out, cookie="SESSDATA", label="bili",
        headless=args.headless, timeout=args.timeout)
    if not ok:
        raise SystemExit("[bili] 登录没成功：%s" % msg)
    good, detail = browser_login.check_state(out, "SESSDATA")
    print("[bili] %s → %s" % (out, detail))
    if not good:
        raise SystemExit("[bili] 登录态不对：" + detail)
    # 顺手验一下：导航接口认不认我们
    try:
        sess = make_session()
        nav = api(sess, "https://api.bilibili.com/x/web-interface/nav")
        print("[bili] isLogin=%s mid=%s uname=%s" % (
            (nav.get("data") or {}).get("isLogin"),
            (nav.get("data") or {}).get("mid"),
            (nav.get("data") or {}).get("uname")))
    except Exception as exc:
        print("[bili] 校验跳过：%s" % exc)


def main():
    global STATE_OVERRIDE
    ap = argparse.ArgumentParser(description="bilibili 观看历史知识提炼")
    ap.add_argument("--login", action="store_true",
                    help="登录入口：开有头浏览器登录，把 storageState 存下来")
    ap.add_argument("--headless", action="store_true",
                    help="配合 --login：不开窗口，改成扫码")
    ap.add_argument("--timeout", type=int, default=600, help="--login 最多等多久（秒）")
    ap.add_argument("--state", default=None,
                    help="登录态文件放哪（--login 写这儿，抓取时也从这儿读）")
    sub = ap.add_subparsers(dest="cmd")

    def common(p):
        p.add_argument("--pages", type=int, default=2, help="历史翻页数（每页 30 条）")
        p.add_argument("--asr", action="store_true", help="没有字幕时用本地 ASR 顶上")
        p.add_argument("--asr-chunk", type=int, default=60, help="ASR 切块秒数")
        p.add_argument("--no-download", action="store_true",
                       help="缺 ASR 模型/运行时也不自动下载（离线用）")
        p.add_argument("--limit", type=int, default=20, help="最多处理多少个视频")
        p.add_argument("--min-ratio", type=float, default=0.4, help="最少看过的比例")
        p.add_argument("--min-seconds", type=int, default=120, help="或者至少看这么多秒")
        p.add_argument("--refresh", action="store_true", help="重新抓/重算")
        p.add_argument("--provider", default=None)
        p.add_argument("--model", default=None)
        p.add_argument("--max-chars", type=int, default=24000, help="送进模型的字幕字符上限")
        p.add_argument("--out", default=None, help="digest 写到哪（默认打印）")
        p.add_argument("--overview", action="store_true", help="额外生成跨视频综述")
        return p

    common(sub.add_parser("fetch", help="拉历史 + 字幕，存本地语料")).set_defaults(func=cmd_fetch)
    common(sub.add_parser("summarize", help="调 LLM 生成结构化摘要")).set_defaults(func=cmd_summarize)
    common(sub.add_parser("digest", help="输出 markdown digest")).set_defaults(func=cmd_digest)
    common(sub.add_parser("all", help="fetch + summarize + digest")).set_defaults(func=cmd_all)

    p = sub.add_parser("discover", help="去 bilibili.com 找值得收藏的视频")
    p.add_argument("--candidates", type=int, default=45, help="最多补详情多少个候选")
    p.add_argument("--pool", type=int, default=24, help="送进 LLM 的候选条数")
    p.add_argument("--top", type=int, default=8, help="精选几条")
    p.add_argument("--rest", type=int, default=10, help="附表里再列多少条其它候选")
    p.add_argument("--popular-pages", type=int, default=1, help="综合热门翻几页")
    p.add_argument("--weekly-issues", type=int, default=2, help="每周必看取几期")
    p.add_argument("--sources", default=None,
                   help="只用某些来源，逗号分隔：首页推荐,每周必看,综合热门,全站排行榜,知识科技排行")
    p.add_argument("--no-llm", action="store_true", help="不调 LLM，只按启发式分排")
    p.add_argument("--fav", action="store_true", help="把精选的加进收藏夹（需登录）")
    p.add_argument("--watch-later", action="store_true", help="把精选的加进「稍后再看」（需登录）")
    p.add_argument("--fav-fid", type=int, default=None, help="加到哪个收藏夹 id")
    p.add_argument("--provider", default=None)
    p.add_argument("--model", default=None)
    p.add_argument("--out", default=None, help="报告写到哪（默认打印）")
    p.set_defaults(func=cmd_discover)

    p = sub.add_parser("watch", help="看一个视频：字幕 + 画面帧 → 总结")
    p.add_argument("bvid", help="要看的视频 bvid")
    p.add_argument("--frames", dest="noop", action="store_true", help=argparse.SUPPRESS)
    p.add_argument("--interval", type=int, default=10, help="每多少秒抽一帧")
    p.add_argument("--width", type=int, default=512, help="单帧模式：缩到多宽（像素）")
    p.add_argument("--tile-cols", type=int, default=3, help="拼图列数（0/1 = 不拼）")
    p.add_argument("--tile-rows", type=int, default=3, help="拼图行数")
    p.add_argument("--sheet-width", type=int, default=512, help="拼图里每格多宽（像素）")
    p.add_argument("--vision-per-call", type=int, default=3,
                   help="一次送几张拼图给视觉模型（tea_a2 最多 4 张）")
    p.add_argument("--merge-only", action="store_true",
                   help="只重跑合并总结（复用已下载/识图/转写的结果）")
    p.add_argument("--qn", type=int, default=64, help="要清晰度（64=720P，80=1080P）")
    p.add_argument("--no-frames", action="store_true", help="不看画面，只用字幕")
    p.add_argument("--asr", choices=["auto", "always", "never"], default="auto",
                   help="本地 ASR：auto=没字幕时才跑（默认），always=都跑，never=不跑")
    p.add_argument("--asr-chunk", type=int, default=60, help="ASR 切块秒数（0=整段一起送）")
    p.add_argument("--no-download", action="store_true",
                   help="缺 ASR 模型/运行时也不自动下载（离线用）")
    p.add_argument("--no-llm", action="store_true", help="不调 LLM 合并总结")
    p.add_argument("--keep-going", action="store_true", help="画面失败也继续")
    p.add_argument("--tea-api", default=TEA_API_DEFAULT, help="tea_a2 地址")
    p.add_argument("--vision-provider", default="deepseek")
    p.add_argument("--vision-model", default="deepseek-flash")
    p.add_argument("--provider", default=None)
    p.add_argument("--model", default=None)
    p.add_argument("--max-chars", type=int, default=24000, help="送进模型的字幕字符上限")
    p.add_argument("--out", default=None, help="写到哪（默认打印）")
    p.set_defaults(func=cmd_watch)

    p = sub.add_parser("asr", help="本地语音转写（SenseVoice，不联网）")
    p.add_argument("bvid", help="要转写的 bvid")
    p.add_argument("--chunk", type=int, default=60, help="切块秒数（0=整段）")
    p.add_argument("--limit", type=int, default=2000, help="终端最多打印多少字")
    p.add_argument("--no-download", action="store_true",
                   help="缺 ASR 模型/运行时也不自动下载（离线用）")
    p.set_defaults(func=cmd_asr)

    p = sub.add_parser("watchlater", help="看 / 改「稍后再看」列表")
    p.add_argument("--add", nargs="+", default=None, help="加这些 bvid 进去")
    p.add_argument("--list", action="store_true", help="列出现有的（默认就列）")
    p.add_argument("--limit", type=int, default=50, help="最多列多少条")
    p.set_defaults(func=cmd_watchlater)

    p = sub.add_parser("show", help="终端快速看一眼")
    p.add_argument("--limit", type=int, default=10)
    p.set_defaults(func=cmd_show)

    args = ap.parse_args()
    STATE_OVERRIDE = args.state or ""
    if args.login:
        cmd_login(args)
        return
    if not args.cmd:
        ap.print_help()
        return
    args.func(args)


if __name__ == "__main__":
    main()
