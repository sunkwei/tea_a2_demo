#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一条龙：B 站视频 → 语音转写(ASR) + 弹幕 → 分析报告 → 观众视角评论 → 发布 + 回读。

**只用 ASR，不抓画面**：视频里的图表/画面文字会丢，所以报告里会标注"数字来自口述，可能有识别误差"。
弹幕用来做两件事：① 给报告补上"观众反应"；② 让评论站在观众视角、避开弹幕里已经刷屏的共识。

用法：
    python bilibili/tools/bili_post.py BV19uW76YE7B                    # 只生成报告+评论候选（不发布）
    python bilibili/tools/bili_post.py BV19uW76YE7B --yes              # 生成并发布（默认第 1 个候选）
    python bilibili/tools/bili_post.py BV19uW76YE7B --yes --pick 2     # 发布第 2 个候选
    python bilibili/tools/bili_post.py BV19uW76YE7B --yes --reply 323365380016   # 回复某条评论
    python bilibili/tools/bili_post.py BV19uW76YE7B --facts notes.md    # 注入外部事实核查资料
    python bilibili/tools/bili_post.py BV19uW76YE7B --yes --comment-file my.md    # 用自己的正文

产物：
    ~/.tea_agent/bili/post/<bvid>/{audio.wav, asr.md, danmaku.txt, report.md, candidates.md}
    bilibili/analysis/<bvid>_观点报告.md
    bilibili/analysis/<bvid>_评论候选.md
    bilibili/analysis/<bvid>_已发布评论.md      （发布后）
"""
import argparse
import io
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
for p in (os.path.join(ROOT, "bilibili"), os.path.join(ROOT, "shared"),
          os.path.join(ROOT, "bilibili", "tools")):
    if p not in sys.path:
        sys.path.insert(0, p)

import bili  # noqa: E402
import danmaku as dm  # noqa: E402
import llm  # noqa: E402
import sensevoice  # noqa: E402

STATE = os.path.join(os.path.expanduser("~"), ".tea_agent", "bili", "post")
ANALYSIS_DIR = os.path.join(ROOT, "bilibili", "analysis")

# 报告用文字模型备胎（第一个是默认 provider）
LLM_FALLBACKS = [("minimax", "MiniMax-M3.1-Flash"), ("mimo", "mimo-v2.6-pro"),
                  ("deepseek", "deepseek-flash")]

REPORT_PROMPT = """你是资深中文时政/财经评论分析员。下面给你一个 B 站视频的素材：
视频元信息 + **本地语音转写逐字稿**（SenseVoice，可能有同音错字，按上下文理解）+ **弹幕**（观众实时反应）。

注意：**这份素材里没有视频画面**，所以画面上才有的图表、字幕、数据一概没有；
所有事实与数字都来自口述，**不要编造素材里没有的事实、数据或出处**，也不要假设看过画面。
转写含混处写「（此处转写不清）」并说明推断依据。

按下面的 markdown 结构输出（标题照抄，不要增删章节）：

## 一句话概括
## 核心论点
（3~6 条，每条一行，加粗关键词）
## 论证结构（按时间线）
（表格：时间 | 段落主旨 | 论据）
## 关键事实与数据
（表格：视频的说法 | 素材里的佐证程度（转写明确 / 转写含混 / 素材里查不到）｜ 可能识别有误的数字要标出来）
## 弹幕里的观众反应
（观众主要在说什么、情绪倾向、弹幕提出的哪些反驳值得注意）
## 值得注意的推理特点
## 可质疑之处
（具体，指出原话）
## 结论
（这份论证成立到什么程度，谁会认同谁会反对，真正分歧在哪）

评价要克制而具体：先说成立的部分，再说站不住的部分，最后讲清争议焦点。
"""

COMMENT_PROMPT = """你在给一个 B 站视频写一条**观众视角的评论**（会真的发出去）。

素材：视频元信息 + 逐字稿 + 弹幕画像（观众实时反应、刷屏句、观众自己提出的反驳）。

写作要求：
1. **观众口吻**，像看完视频的观众在跟别人聊天。不说教、不贴标签、不端着、不用"我认为本题应当如何论证"这种口气。
2. **先认可**：从逐字稿里挑出这期视频**具体**讲得好的地方（某个类比、某个结构、某个被承认的常识），引用或点出它，别写成"整体不错"。
3. **再补 2~3 条实质性的不同意见或补充**：
   - 事实/口径问题要具体（"X 其实是 Y""这个数字是 Z 口径"），但语气是商榷不是纠错；
   - 数字只能来自逐字稿；如果你判断某个数字可能是转写误差，就写"这句我可能听错了，但我的理解是……"；
   - **不要重复弹幕里已经刷屏的共识**（那些观众都说了），要补充弹幕里没人说清楚的；
   - 如果弹幕里提出了一个更好的角度（例如用弹幕里的那条反驳），可以接过来，但要加自己的判断。
4. **照顾弹幕的情绪**：如果观众普遍在嘲讽/祛魅/共鸣，评论不要一副置身事外的腔调；如果弹幕里有明显的事实错误（例如人名、机构名错了），可以顺手点一下（"其实叫谢太宝"），这很有价值。
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


def make_comments(blob, n=3):
    """让模型出 n 个不同切入角度的评论候选。"""
    out = []
    for i in range(n):
        angle = ["补充为主：把他没展开的地方补上",
                 "商榷为主：指出事实口径或论证上的具体问题",
                 "接观众的话：结合弹幕里没人说清楚的那一层来谈"][i % 3]
        msgs = [{"role": "system", "content": COMMENT_PROMPT},
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
        txt = (txt or "").strip()
        if txt.startswith("```"):
            txt = txt.split("```")[-1]
        if not looks_complete(txt):
            log("[comment%d] 仍不完整，裁到最后一个完整句" % (i + 1))
            txt = trim_to_sentence(txt, 1000)
        if len(txt) < 550:
            log("[comment%d] 只有 %d 字，重试一次要求写满" % (i + 1, len(txt)))
            retry = list(msgs) + [
                {"role": "assistant", "content": txt},
                {"role": "user", "content":
                 "太短了，请重写一版：务必写满 600~950 字，多给具体的细节、"
                 "原话和弹幕里的信息，不要空话套话。"}]
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
    ap.add_argument("--facts", default=None, help="外部事实核查资料（文本文件），会喂给模型")
    ap.add_argument("--comment-file", default=None, help="用自己的正文发布（跳过生成）")
    ap.add_argument("--candidates", type=int, default=3, help="生成几个评论候选")
    ap.add_argument("--no-report", action="store_true")
    ap.add_argument("--force", action="store_true", help="忽略缓存，重跑 ASR/弹幕/报告")
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

    # 1) 音频 + ASR（不用视频、不抓画面）
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
    blob += "## 弹幕画像\n" + dm_text + "\n" + facts
    write(os.path.join(work, "blob.txt"), blob)

    # 3) 分析报告
    if not args.no_report:
        cached = os.path.join(work, "report.md")
        if os.path.exists(cached) and os.path.getsize(cached) > 500 and not args.force:
            report = io.open(cached, encoding="utf-8").read()
            log("复用分析报告（%d 字）" % len(report))
        else:
            log("生成分析报告…")
            report = llm_chat_resilient(
                [{"role": "system", "content": REPORT_PROMPT},
                 {"role": "user", "content": blob}],
                max_tokens=14000, label="report", expect="结论")
            write(cached, report)
        rep_path = write(os.path.join(out_dir, "%s_观点报告.md" % bv), report)
        log("报告 → %s" % rep_path)

    # 4) 评论候选
    if args.comment_file:
        cands = [io.open(args.comment_file, encoding="utf-8").read().strip()]
        log("用自带正文：%d 字" % len(cands[0]))
    else:
        cjson = os.path.join(work, "candidates.json")
        if os.path.exists(cjson) and not args.force:
            try:
                cands = json.load(io.open(cjson, encoding="utf-8"))["candidates"]
                log("复用评论候选（%d 条）" % len(cands))
            except Exception:  # noqa: BLE001
                cands = []
        else:
            cands = []
        if not cands:
            log("生成 %d 个评论候选…" % args.candidates)
            cands = make_comments(blob, n=args.candidates)
            if not cands:
                raise SystemExit("评论候选生成失败")
            write(cjson, json.dumps({"candidates": cands}, ensure_ascii=False, indent=1))
        write(os.path.join(out_dir, "%s_评论候选.md" % bv),
              "# %s —— 评论候选\n\n" % title +
              "\n\n".join("## 候选 %d（%d 字）\n\n%s" % (i + 1, len(c), c)
                          for i, c in enumerate(cands)))
        write(os.path.join(work, "candidates.md"), "\n\n".join(cands))
    cand_path = os.path.join(out_dir, "%s_评论候选.md" % bv)
    for i, c in enumerate(cands, 1):
        print("=" * 30, "候选 %d（%d 字）：%s" % (i, len(c),
                                                c[:40].replace("\n", " ")))
        print(c)
    print("（完整候选正文见 %s）" % cand_path)

    # 5) 发布
    idx = max(1, min(args.pick, len(cands))) - 1
    msg = cands[idx]
    if len(msg) > 1000:
        log("正文 %d 字超过 1000，先截断" % len(msg))
        msg = msg[:1000]
    if not args.yes:
        log("dry-run：加 --yes 才真发（将发候选 %d）" % (idx + 1))
        return
    rpid, _ = post_comment(sess, bv, aid, msg, args.reply)
    log("已发布 rpid=%s（候选 %d）" % (rpid, idx + 1))
    ok, hit = verify(sess, aid, rpid, msg)
    log("回读：%s" % ("确认落地" if ok else "没在最新一页找到，可能还在审核"))
    arch = write(os.path.join(out_dir, "%s_已发布评论.md" % bv),
                  "# 《%s》—— 已发布的 B 站评论\n\n"
                  "> **视频**：%s ｜ UP主：%s ｜ aid=%s\n"
                  "> **评论 rpid**：%s ｜ 发布：%s ｜ 正文 %d 字\n"
                  "> **发布方式**：`bilibili/tools/bili_post.py`（ASR+弹幕 → 评论 → "
                  "POST `x/v2/reply/add` → `x/v2/reply/main?mode=2&next=0` 回读校验）\n\n---\n\n%s\n"
                  % (title, bv, owner, aid, rpid,
                     time.strftime("%Y-%m-%d %H:%M"), len(msg), msg))
    log("归档 → %s" % arch)


if __name__ == "__main__":
    main()
