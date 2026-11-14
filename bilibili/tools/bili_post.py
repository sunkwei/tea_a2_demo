#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一条龙：B 站视频 → 语音转写(ASR) + 抽屏识图 + 弹幕 → 分析报告 → 观众视角评论 → 发布 + 回读。

**默认三路素材都上**：语音（本地 SenseVoice）+ 画面（抽帧拼图 → 视觉模型）+ 弹幕。
只想要最快的纯语音版时加 `--no_video`（跳过抽帧识图）。

弹幕用来做两件事：① 给报告补上"观众反应"；② 让评论站在观众视角、避开弹幕里已经刷屏的共识。

用法：
    python bilibili/tools/bili_post.py BV19uW76YE7B                    # 生成报告+3 个评论候选（不发布）
    python bilibili/tools/bili_post.py BV19uW76YE7B --yes              # 生成并发布（默认第 1 个候选）
    python bilibili/tools/bili_post.py BV19uW76YE7B --yes --pick 2     # 发布第 2 个候选
    python bilibili/tools/bili_post.py BV19uW76YE7B --yes --reply 323646262448   # 回复某条评论
    python bilibili/tools/bili_post.py BV19uW76YE7B --no_video          # 只要语音，不要抽屏
    python bilibili/tools/bili_post.py BV19uW76YE7B --facts notes.md    # 注入外部事实核查资料
    python bilibili/tools/bili_post.py BV19uW76YE7B --yes --comment-file my.md    # 用自己的正文

产物：
    ~/.tea_agent/bili/post/<bvid>/{audio.wav, asr.md, video.mp4, frames/, vision.md,
                                   danmaku.txt, report.md, candidates.json, blob.txt}
    bilibili/analysis/<bvid>_观点报告.md
    bilibili/analysis/<bvid>_评论候选.md
    bilibili/analysis/<bvid>_已发布评论.md      （发布后）
"""
import argparse
import hashlib
import io
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
for p in (os.path.join(ROOT, "bilibili"), os.path.join(ROOT, "shared"), HERE):
    if p not in sys.path:
        sys.path.insert(0, p)

import bili  # noqa: E402
import danmaku as dm  # noqa: E402
import frames  # noqa: E402
import llm  # noqa: E402
import sensevoice  # noqa: E402

STATE = os.path.join(os.path.expanduser("~"), ".tea_agent", "bili", "post")
ANALYSIS_DIR = os.path.join(ROOT, "bilibili", "analysis")

# 文本模型备胎（第一个是默认 provider）
LLM_FALLBACKS = [("minimax", "MiniMax-M3.1-Flash"), ("mimo", "mimo-v2.6-pro"),
                  ("deepseek", "deepseek-flash")]

REPORT_PROMPT = """你是资深中文时政/财经评论分析员。下面给你一个 B 站视频的素材：
视频元信息 + **本地语音转写逐字稿**（SenseVoice，可能有同音错字，按上下文理解）
+ **画面描述**（抽帧拼图交给视觉模型的结果，带时间点；如果这一节是空的，说明这次没做抽屏；
  画面里可能出现广告片段，报告里**如实标注**即可，但不要评价广告本身）
+ **弹幕**（观众实时反应）。

注意：转写可能有同音错字（比如"显理论"其实是"弦理论"），要按上下文理解；
**不要编造素材里没有的事实、数据或出处**，也不要假设看过没给的东西。
关键事实要区分来源：**画面上写着的**（有画面证据）＞ **口述的**（只有转写）＞ **查不到的**。

按下面的 markdown 结构输出（标题照抄，不要增删章节）：

## 一句话概括
## 核心论点
（3~6 条，每条一行，加粗关键词）
## 论证结构（按时间线）
（表格：时间 | 段落主旨 | 论据 | 论据来自口述还是画面）
## 关键事实与数据
（表格：视频的说法 | 来源（画面文字 / 只有口述 / 查不到） | 佐证程度与备注）
## 弹幕里的观众反应
（观众主要在说什么、情绪倾向、弹幕提出的哪些反驳值得注意）
## 值得注意的推理特点
## 可质疑之处
（具体，指出原话）
## 结论
（这份论证成立到什么程度，谁会认同谁会反对，真正分歧在哪）

评价要克制而具体：先说成立的部分，再说站不住的部分，最后讲清争议焦点。
"""

# 硬规则：广告是 UP 主的正当需求，评论里一律不提、不评、不调侃。
AD_RULE = ("【硬规则】视频中间可能插有广告/推广/恰饭内容，那是 UP 主的正常需求，"
           "**不要提及、不要评价、不要调侃、不要拿广告当段子**，"
           "整条评论里不要出现「广告」「推广」「恰饭」「软广」这些词。")

COMMENT_PROMPT = """你在给一个 B 站视频写一条**观众视角的评论**（会真的发出去）。

素材：视频元信息 + 逐字稿 + （可选）画面描述 + 弹幕画像（观众实时反应、刷屏句、观众自己提出的反驳）。

写作要求：
1. **观众口吻**，像看完视频的观众在跟别人聊天。不说教、不贴标签、不端着，不用"本题应当如何论证"这种口气。
2. **先认可**：从素材里挑出这期视频**具体**讲得好的地方（某个类比、某个结构、某个被承认的常识），点出它，别写成"整体不错"。
3. **再补 2~3 条实质性的不同意见或补充**：
   - 事实/口径问题要具体（"X 其实是 Y""这个数字是 Z 口径"），语气是商榷不是纠错；
   - 数字只能来自素材；有画面证据时可以顺手引用画面上的原文（更硬）；
   - **不要重复弹幕里已经刷屏的共识**（那些观众都说了），要补充弹幕里没人说清楚的；
   - 如果弹幕里提出了一个更好的角度，可以接过来，但要加自己的判断。
4. **照顾弹幕的情绪**：观众普遍在嘲讽/共鸣时，评论不要一副置身事外的腔调；
   弹幕里有明显的事实错误（人名、机构名、年代错了）可以顺手点一下（"其实叫谢太宝"），这很有价值。
5. **结尾**：留一个具体的期待或追问，不要空喊"期待更多讨论"。
6. 长度 **600~950 个字**（含标点）。纯文本，**不要用 markdown 标记、不要标题、不要列表符号**，段落之间用换行。
"""


try:  # 输出统一走 UTF-8，cmd 控制台是 GBK，长中文可能显示成乱码
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass


def log(msg):
    print("[%s] %s" % (time.strftime("%H:%M:%S"), msg), flush=True)


def write(path, text):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with io.open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
    return path


def llm_chat_resilient(messages, max_tokens=8000, label="llm", expect=None,
                         provider=None, model=None):
    """先试指定 provider；失败/被截断就加倍预算，再换备胎。"""
    tries = []
    if provider:
        tries.append((provider, model))
    for p, m in LLM_FALLBACKS:
        if (p, m) not in tries:
            tries.append((p, m))
    last = None
    for p, m in tries:
        for budget in (max_tokens, max_tokens * 2):
            try:
                _n, cfg, mname = llm.pick_provider(p, m)
                # MiniMax 是自适应思考模型，不给低推理档会把 max_tokens 全耗在思考上，
                # 正文就空了（finish_reason=length）。
                extra = ({"reasoning_effort": "low", "reasoning_split": True}
                         if "minimax" in (p or "").lower() else None)
                txt = llm.llm_chat(cfg, mname, messages, max_tokens=budget,
                                   extra=extra)
            except Exception as exc:  # noqa: BLE001
                last = exc
                log("[%s] %s/%s 失败：%s" % (label, p, m, str(exc)[:140]))
                break
            if not (txt or "").strip():
                last = RuntimeError("%s/%s 返回空" % (p, m))
                break
            if expect and expect not in txt:
                last = RuntimeError("输出被截断（缺「%s」）" % expect)
                log("[%s] %s/%s 被截断，加预算重试" % (label, p, m))
                continue
            return txt
    raise last or RuntimeError("所有 provider 都失败了")


def looks_complete(txt):
    """正文是否完整收尾（推理模型常把 max_tokens 耗在思考上，正文写到一半被砍）。"""
    t = (txt or "").strip()
    if not t:
        return False
    return t[-1] in "。！？…”』」）)】\n"


def trim_to_sentence(txt, limit=1000):
    """裁到最后一个完整句子，并保证不超过字数上限。"""
    t = (txt or "").strip()
    if len(t) <= limit:
        return t
    cut = t[:limit]
    for i in range(len(cut) - 1, max(0, len(cut) - 120) - 1, -1):
        if cut[i] in "。！？…”』」）":
            return cut[:i + 1]
    return cut


def make_comments(blob, n=3, style="structured"):
    """让模型出 n 个不同切入角度的评论候选。

    style=structured：原来的写法（先认可、再补 2~3 条意见、收尾留期待）。
    style=human：口语化、像真人随手敲的；提示词里带"AI 味句式"黑名单。
    """
    out = []
    for i in range(n):
        if style == "human":
            angle = ["顺着视频里最有感觉的那个点随口聊",
                     "挑一个具体的细节说说你的看法",
                     "接弹幕里那句话，但说点不一样的东西"][i % 3]
            # 注意：角度里绝不出现"广告"——广告是 UP 的正当需求，不评论
            sys_prompt = AD_RULE + "\n\n" + HUMAN_COMMENT_PROMPT + "\n\n【要避开的老套句式】" + \
                "、".join(AI_TELLS)
        else:
            angle = ["补充为主：把他没展开的地方补上",
                     "商榷为主：指出事实口径或论证上的具体问题",
                     "接观众的话：结合弹幕里没人说清楚的那一层来谈"][i % 3]
            sys_prompt = AD_RULE + "\n\n" + COMMENT_PROMPT
        msgs = [{"role": "system", "content": sys_prompt},
                {"role": "user", "content": "这一条请侧重：%s\n\n%s" % (angle, blob)}]
        txt = ""
        for budget in (6000, 12000):
            try:
                txt = llm_chat_resilient(msgs, max_tokens=budget,
                                         label="comment%d" % (i + 1))
            except Exception as exc:  # noqa: BLE001
                log("[comment%d] 生成失败：%s" % (i + 1, str(exc)[:150]))
                txt = ""
                break
            if looks_complete(txt):
                break
            log("[comment%d] 结尾被截断（%d 字），加倍预算重试" % (i + 1, len(txt)))
        if not txt:
            continue
        txt = txt.strip()
        if txt.startswith("```"):
            txt = txt.split("```")[-1]
        if not looks_complete(txt):
            log("[comment%d] 仍不完整，裁到最后一个完整句" % (i + 1))
            txt = trim_to_sentence(txt, 1000)
        min_len = 220 if style == "human" else 550
        if len(txt) < min_len:
            log("[comment%d] 只有 %d 字，重试一次要求写满" % (i + 1, len(txt)))
            retry = list(msgs) + [
                {"role": "assistant", "content": txt},
                {"role": "user", "content":
                 ("太短了，请重写一版：务必写满 250~600 字，多给具体的细节和"
                  "弹幕里的信息，不要空话套话。"
                  if style == "human" else
                  "太短了，请重写一版：务必写满 600~950 字，多给具体的细节、"
                  "原话和弹幕里的信息，不要空话套话。")}]
            try:
                txt2 = llm_chat_resilient(retry, max_tokens=4000,
                                          label="comment%d-retry" % (i + 1))
                if len(txt2.strip()) > len(txt):
                    txt = txt2.strip()
            except Exception as exc:  # noqa: BLE001
                log("[comment%d] 重试失败：%s" % (i + 1, str(exc)[:120]))
        out.append(txt)
        log("[comment%d] %d 字" % (i + 1, len(txt)))
    return out


def download_video(sess, bv, cid, dest, qn=64, tries=3):
    """下媒体流。CDN 偶尔第一次给空文件 → 重试；再不行用 requests 流式兜底。"""
    last = None
    for i in range(tries):
        try:
            pu = bili.fetch_playurl(sess, bv, cid, qn=qn)
            bili.download_media(sess, pu["url"], dest)
            if os.path.getsize(dest) > 1024:
                return dest
            last = RuntimeError("文件是空的")
        except Exception as exc:  # noqa: BLE001
            last = exc
        log("视频下载失败（第 %d 次）：%s" % (i + 1, str(last)[:120]))
        time.sleep(3)
    # 兜底：requests 流式
    import requests
    pu = bili.fetch_playurl(sess, bv, cid, qn=qn)
    with sess.get(pu["url"], headers={"Referer": "https://www.bilibili.com/"},
                  stream=True, timeout=120) as r:
        r.raise_for_status()
        with open(dest, "wb") as fh:
            for chunk in r.iter_content(1 << 20):
                fh.write(chunk)
    if not os.path.exists(dest) or os.path.getsize(dest) < 1024:
        raise RuntimeError("视频下载失败：%s" % last)
    log("已用 requests 流式兜底下载")
    return dest


HUMAN_COMMENT_PROMPT = """你在给一个 B 站视频写一条**评论**，要像真人看完随手敲的，
一眼看不出是机器写的（这很重要，UP 和别的观众最烦那种模板腔）。

【硬规则】视频中间可能插有广告/推广/恰饭内容，那是 UP 主的正常需求，
**不要提及、不要评价、不要调侃、不要拿广告当段子**，整条评论里不要出现
「广告」「推广」「恰饭」「软广」这些词。

素材：视频元信息 + 逐字稿 + （可选）画面描述 + 弹幕画像（观众在说什么、哪些话被刷屏了）。

写法要求：
1. **开口就说事**：直接从视频里某个具体的东西说起（一个画面、一句话、一个数据、一个吐槽点），
   不要"这期讲得不错"这种开场白。
2. **不要分点**：不要"一、二、三"，不要"首先/其次/最后"，不要小标题、不要 markdown 符号。
   就 1~3 段自然的话，长短不一，允许有短句和没说完的半句。
3. **只讲 1~2 个点**：真人评论通常不会面面俱到。挑你最想说的那一两个讲透，
   剩下的别提，也别把视频内容复述一遍。
4. **语气**：可以有"说实话""我一开始没反应过来""这就有点…""反正我是这么看"这类口语；
   允许用"其实""挺""就""吧"这类词；不要书面语（该视频/本片/UP主/综上所述/值得指出的是）。
5. **别吹捧**：不需要先夸一通。想夸就顺手带一句具体的（"那句比喻挺贴切"），不想夸就直接说事。
6. **别编造自己的经历**：不要写"我看了三遍""我朋友说""我是做这行的"这类没有依据的话。
   只表达你对内容本身的反应和判断。
7. **弹幕已经在刷的别跟着刷**（那些观众都说了）；弹幕里出现的口误或事实错误可以顺手点一句。
8. **结尾别升华**：不要"期待后续更……的讨论""总体来说……"，就用一句大白话收尾，
   可以是个疑问、一个自己的看法，或者干脆一句吐槽。
9. **别写成两段对称的总结**：不要"第一段复述现象 + 第二段给结论"的整齐结构，
   段落长短拉开，允许有一句只有几个字的短句。
10. 长度 **250~600 字**。纯文本，段落之间换行。
"""

AI_TELLS = [
    "这期信息密度很高", "补充几点", "总体挺喜欢", "期待后续", "值得指出的是",
    "首先", "其次", "综上", "本视频", "该视频", "UP主", "一方面", "另一方面",
    # 下面这些是"两段式总结"的典型口气，也很容易露馅
    "最讽刺的是", "更有意思的是", "比这更实在的是", "所以要真治", "整件事不是",
    "整件事就是", "归根结底", "反过来说", "问题不在于", "而在于",
]


def post_comment(sess, bvid, aid, msg, rpid=None):
    csrf = bili._cookie(sess, "bili_jct")
    if not csrf:
        raise RuntimeError("没有 bili_jct（登录态不对？）")
    sess.headers["Referer"] = "https://www.bilibili.com/video/%s" % bvid
    sess.headers["Origin"] = "https://www.bilibili.com"
    data = {"type": 1, "oid": aid, "pn": 1, "ps": 20, "message": msg, "csrf": csrf}
    if rpid:
        data["parent"] = rpid
        data["rpid"] = rpid
    r = sess.post("https://api.bilibili.com/x/v2/reply/add", data=data, timeout=30)
    j = r.json()
    if j.get("code") != 0:
        raise RuntimeError("发布失败 code=%s msg=%s" % (j.get("code"), j.get("message")))
    reply = (j.get("data") or {}).get("reply") or {}
    return reply.get("rpid"), reply


def verify(sess, aid, rpid, prefix):
    """回读：mode=2&next=0 才是按时间的最新一页（reply/detail 已废弃）。"""
    lst = bili.api(sess, "https://api.bilibili.com/x/v2/reply/main"
                   "?oid=%s&type=1&mode=2&next=0&ps=20" % aid)
    for x in ((lst or {}).get("replies") or []):
        if str(x.get("rpid")) == str(rpid):
            return True, x
    for x in ((lst or {}).get("replies") or []):
        if ((x.get("content") or {}).get("message") or "").strip().startswith(prefix[:20]):
            return True, x
    return False, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("bvid")
    ap.add_argument("--yes", action="store_true", help="真的发布（默认只生成草稿）")
    ap.add_argument("--pick", type=int, default=1, help="发布第几个候选（1 起）")
    ap.add_argument("--reply", default=None, help="作为某条评论的回复（rpid）")
    ap.add_argument("--facts", default=None, help="外部事实核查资料（文本文件）")
    ap.add_argument("--comment-file", default=None, help="用自己的正文发布（跳过生成）")
    ap.add_argument("--candidates", type=int, default=3, help="生成几个评论候选")
    ap.add_argument("--style", choices=("structured", "human"), default="structured",
                    help="评论风格：structured=先认可再补意见；human=口语化像真人写的")
    ap.add_argument("--no-report", action="store_true")
    ap.add_argument("--no_video", action="store_true",
                    help="不抽帧识图（默认是要的：ASR + 画面 + 弹幕 三路）")
    ap.add_argument("--qn", type=int, default=64, help="清晰度 64=720P")
    ap.add_argument("--interval", type=int, default=30, help="抽帧间隔（秒）")
    ap.add_argument("--max-sheets", type=int, default=8, help="最多几张拼图")
    ap.add_argument("--cols", type=int, default=3)
    ap.add_argument("--rows", type=int, default=3)
    ap.add_argument("--force", action="store_true", help="忽略缓存，重跑 ASR/弹幕/画面/报告")
    ap.add_argument("--out-dir", default=None, help="产物目录（默认 bilibili/analysis）")
    args = ap.parse_args()
    bv = args.bvid
    work = os.path.join(STATE, bv)
    os.makedirs(work, exist_ok=True)
    out_dir = args.out_dir or ANALYSIS_DIR

    sess = bili.make_session()
    view = bili.api(sess, "https://api.bilibili.com/x/web-interface/view?bvid=%s" % bv)
    aid, cid = view.get("aid"), view.get("cid")
    title = view.get("title")
    dur = view.get("duration") or 0
    stat = view.get("stat") or {}
    owner = (view.get("owner") or {}).get("name")
    log("《%s》 UP:%s ｜ %d:%02d ｜ 播放%s 点赞%s" %
        (title, owner, dur // 60, dur % 60, stat.get("view"), stat.get("like")))

    # 1) 语音（只下音频轨）
    asr_path = os.path.join(work, "asr.md")
    if os.path.exists(asr_path) and os.path.getsize(asr_path) > 200 and not args.force:
        asr_text = io.open(asr_path, encoding="utf-8").read()
        log("复用 ASR 转写（%d 字）" % len(asr_text))
    else:
        ok, why = sensevoice.asr_status(auto=True)
        if not ok:
            raise SystemExit("本地 ASR 用不了：%s\n"
                             "（Windows 上 ensure_asr_model 的 tar 校验会误报'模型包损坏'，"
                             "请用 .tea_agent_run/scripts/extract_model.py 手动解压）" % why)
        wav = os.path.join(work, "audio.wav")
        log("下载音频轨并转写…（%d 秒）" % dur)
        t0 = time.time()
        bili.fetch_audio(sess, bv, cid, wav)
        pieces = sensevoice.asr_transcribe(wav, chunk=60)
        asr_text = sensevoice.asr_to_text(pieces)
        write(asr_path, asr_text)
        log("ASR 完成 %d 段，耗时 %.1fs" % (len(pieces), time.time() - t0))

    # 2) 弹幕
    dm_path = os.path.join(work, "danmaku.txt")
    dm_raw = os.path.join(work, "danmaku.json")
    if os.path.exists(dm_path) and os.path.getsize(dm_path) > 50 and not args.force:
        dm_text = io.open(dm_path, encoding="utf-8").read()
        log("复用弹幕画像")
    else:
        log("抓弹幕…")
        items = dm.fetch_danmaku(sess, cid=cid)
        dm_text = dm.summarize(items, dur)
        write(dm_path, dm_text)
        write(dm_raw, json.dumps(items, ensure_ascii=False))
        log("弹幕 %d 条" % len(items))

    # 3) 画面（抽帧拼图 → 视觉模型）；--no_video 才跳过
    vision_text = ""
    if args.no_video:
        log("--no_video：跳过抽屏")
    else:
        vision_path = os.path.join(work, "vision.md")
        if os.path.exists(vision_path) and os.path.getsize(vision_path) > 200 \
                and not args.force:
            vision_text = io.open(vision_path, encoding="utf-8").read()
            log("复用画面描述")
        else:
            mp4 = os.path.join(work, "video.mp4")
            if not (os.path.exists(mp4) and os.path.getsize(mp4) > 1024 * 1024) \
                    or args.force:
                log("下载媒体流（qn=%s）…" % args.qn)
                download_video(sess, bv, cid, mp4, qn=args.qn)
            log("mp4 %.1f MB" % (os.path.getsize(mp4) / 1048576.0))
            per = args.cols * args.rows
            step, nsheets = frames.plan_sampling(dur, args.interval, per,
                                                 max_sheets=args.max_sheets)
            sheets, _per = frames.extract_sheets(
                mp4, os.path.join(work, "frames"), interval=step, cols=args.cols,
                rows=args.rows, max_sheets=nsheets, font=frames.find_font())
            log("抽帧 %d 张拼图（每 %ds 一帧，%dx%d）" % (len(sheets), step,
                                                       args.cols, args.rows))
            notes = frames.describe(sheets, step, per=per, cols=args.cols,
                                    rows=args.rows)
            vision_text = frames.format_notes(notes)
            write(vision_path, vision_text)

    facts = ""
    if args.facts and os.path.exists(args.facts):
        facts = "\n\n【外部事实核查资料（可信度高于转写，引用时以它为准）】\n" + \
            io.open(args.facts, encoding="utf-8").read()[:12000]
        log("注入外部资料 %s（%d 字）" % (args.facts, len(facts)))

    blob = ("# 视频元信息\n标题：%s\nUP主：%s\n时长：%d 分 %d 秒\n发布：%s\n"
            "数据：播放 %s ｜ 点赞 %s ｜ 收藏 %s ｜ 评论 %s\n简介：%s\n\n"
            % (title, owner, dur // 60, dur % 60,
               time.strftime("%Y-%m-%d %H:%M", time.localtime(view.get("pubdate") or 0)),
               stat.get("view"), stat.get("like"), stat.get("favorite"),
               stat.get("reply"), (view.get("desc") or "")[:500]))
    blob += "## 语音转写逐字稿（本地 SenseVoice，可能有同音错字）\n" + asr_text + "\n\n"
    if vision_text:
        blob += "## 画面描述（抽帧拼图 + 视觉模型，带时间点）\n" + vision_text + "\n\n"
    blob += "## 弹幕画像\n" + dm_text + "\n" + facts
    write(os.path.join(work, "blob.txt"), blob)
    blob_hash = hashlib.md5(blob.encode("utf-8")).hexdigest()

    # 4) 分析报告
    if not args.no_report:
        cached = os.path.join(work, "report.md")
        hfile = os.path.join(work, "report.hash")
        old_hash = io.open(hfile, encoding="utf-8").read().strip() \
            if os.path.exists(hfile) else ""
        if (os.path.exists(cached) and os.path.getsize(cached) > 500
                and old_hash == blob_hash and not args.force):
            report = io.open(cached, encoding="utf-8").read()
            log("复用分析报告（%d 字）" % len(report))
        else:
            log("生成分析报告…")
            report = llm_chat_resilient(
                [{"role": "system", "content": REPORT_PROMPT},
                 {"role": "user", "content": blob}],
                max_tokens=14000, label="report", expect="结论")
            write(cached, report)
            write(hfile, blob_hash)
        rep_path = write(os.path.join(out_dir, "%s_观点报告.md" % bv), report)
        log("报告 → %s" % rep_path)

    # 5) 评论候选
    if args.comment_file:
        cands = [io.open(args.comment_file, encoding="utf-8").read().strip()]
        log("用自带正文：%d 字" % len(cands[0]))
    else:
        cjson = os.path.join(work, "candidates.json")
        chash = os.path.join(work, "candidates.hash")
        cands = []
        old_hash = io.open(chash, encoding="utf-8").read().strip() \
            if os.path.exists(chash) else ""
        if os.path.exists(cjson) and old_hash == blob_hash and not args.force:
            try:
                cands = json.load(io.open(cjson, encoding="utf-8"))["candidates"]
                log("复用评论候选（%d 条）" % len(cands))
            except Exception:  # noqa: BLE001
                cands = []
        if not cands:
            log("生成 %d 个评论候选…" % args.candidates)
            cands = make_comments(blob, n=args.candidates, style=args.style)
            if not cands:
                raise SystemExit("评论候选生成失败")
            write(cjson, json.dumps({"candidates": cands}, ensure_ascii=False, indent=1))
            write(chash, blob_hash)
        write(os.path.join(out_dir, "%s_评论候选.md" % bv),
              "# %s —— 评论候选\n\n" % title +
              "\n\n".join("## 候选 %d（%d 字）\n\n%s" % (i, len(c), c)
                          for i, c in enumerate(cands)))
    cand_path = os.path.join(out_dir, "%s_评论候选.md" % bv)
    for i, c in enumerate(cands, 1):
        print("=" * 30, "候选 %d（%d 字）：%s" % (i, len(c),
                                                c[:40].replace("\n", " ")))
        print(c)
    print("（完整候选正文见 %s）" % cand_path)

    # 6) 发布
    idx = max(1, min(args.pick, len(cands))) - 1
    msg = cands[idx]
    if len(msg) > 1000:
        log("正文 %d 字超过 1000，先裁到最后一个完整句" % len(msg))
        msg = trim_to_sentence(msg, 1000)
    if not args.yes:
        log("dry-run：加 --yes 才真发（将发候选 %d）" % (idx + 1))
        return
    rpid, _ = post_comment(sess, bv, aid, msg, args.reply)
    log("已发布 rpid=%s（候选 %d）" % (rpid, idx + 1))
    ok, hit = False, None
    for i in range(4):  # 刚发完列表接口还没同步，要等一下再回读
        time.sleep(2 if i == 0 else 3)
        ok, hit = verify(sess, aid, rpid, msg)
        if ok:
            break
    log("回读：%s" % ("确认落地" if ok else "没在最新一页找到，可能还在审核"))
    arch = write(os.path.join(out_dir, "%s_已发布评论.md" % bv),
                  "# 《%s》—— 已发布的 B 站评论\n\n"
                  "> **视频**：%s ｜ UP主：%s ｜ aid=%s\n"
                  "> **评论 rpid**：%s ｜ 发布：%s ｜ 正文 %d 字\n"
                  "> **发布方式**：`bilibili/tools/bili_post.py`"
                  "（ASR+抽屏+弹幕 → 评论 → POST `x/v2/reply/add` → "
                  "`x/v2/reply/main?mode=2&next=0` 回读校验）\n\n---\n\n%s\n"
                  % (title, bv, owner, aid, rpid,
                     time.strftime("%Y-%m-%d %H:%M"), len(msg), msg))
    log("归档 → %s" % arch)


if __name__ == "__main__":
    main()
