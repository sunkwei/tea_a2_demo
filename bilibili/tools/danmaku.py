# -*- coding: utf-8 -*-
"""B 站弹幕抓取与统计（不依赖抓图，只用 HTTP 接口）。

两个来源：
  * XML 老接口  https://comment.bilibili.com/{cid}.xml      —— 一次拿全量，好解析（首选）
  * protobuf 新接口 https://api.bilibili.com/x/v2/dm/web/seg.so?type=1&oid={cid}&segment_index=N
    —— 按 6 分钟分段，自带极简 protobuf 解码器（DanmakuElem：field2=毫秒, field7=文本）

提供：
    fetch_danmaku(sess, bvid=None, cid=None)   -> [{"time": 秒, "text": str, "uid": str}, ...]
    summarize(danmaku, duration)               -> 给 LLM 用的弹幕画像（热度分桶/刷屏句/长弹幕/关键词）
"""
import re
import sys
import xml.etree.ElementTree as ET
from collections import Counter

# 弹幕里常见的"情绪/立场"关键词，用于给 LLM 一张观众情绪的粗略画像
KEYWORDS = [
    "新加坡", "李家", "李光耀", "黄循财", "工人党", "行动党", "民主", "自由", "威权",
    "马督工", "督工", "笑哭", "doge", "滑稽", "前排", "打卡", "爷青回", "有一说一",
    "认真", "同意", "不同意", "离谱", "恐怖", "细思极恐", "资本", "工人", "外劳",
    "空调", "公务员", "涨薪", "选票", "马来", "印度", "上海", "香港", "中国",
]


def _read_varint(buf, i):
    result = 0
    shift = 0
    while i < len(buf):
        b = buf[i]
        i += 1
        result |= (b & 0x7F) << shift
        if not b & 0x80:
            break
        shift += 7
    return result, i


def _parse_fields(buf):
    """极简 protobuf 解析：只认 varint(0) / length-delimited(2) / fixed(1,5)。"""
    i = 0
    out = []
    while i < len(buf):
        try:
            key, i = _read_varint(buf, i)
        except IndexError:
            break
        field, wt = key >> 3, key & 7
        if wt == 0:
            val, i = _read_varint(buf, i)
        elif wt == 2:
            ln, i = _read_varint(buf, i)
            val = buf[i:i + ln]
            i += ln
        elif wt == 5:
            val = buf[i:i + 4]
            i += 4
        elif wt == 1:
            val = buf[i:i + 8]
            i += 8
        else:
            break
        out.append((field, wt, val))
    return out


def _elem_from_bytes(payload):
    """从一段 protobuf 字节里认 DanmakuElem：field7=文本, field2=毫秒, field6=uidHash。"""
    text = None
    progress = None
    uid = None
    for field, wt, val in _parse_fields(payload):
        if field == 7 and wt == 2:
            text = val.decode("utf-8", "replace")
        elif field == 2 and wt == 0:
            progress = val
        elif field == 6 and wt == 2:
            uid = val.decode("utf-8", "replace")
    if not text:
        return None
    return {"time": (progress or 0) / 1000.0, "text": text, "uid": uid or ""}


def fetch_danmaku(sess, bvid=None, cid=None, prefer="xml"):
    """抓弹幕。bvid 或 cid 给一个即可。返回 [{time, text, uid}]。"""
    if cid is None:
        view = sess.get("https://api.bilibili.com/x/web-interface/view?bvid=%s" % bvid,
                        timeout=20).json()
        cid = view["data"]["cid"]
    items = []
    if prefer in ("xml", "auto"):
        try:
            r = sess.get("https://comment.bilibili.com/%d.xml" % cid, timeout=30)
            if r.status_code == 200 and b"<i>" in r.content[:200]:
                root = ET.fromstring(r.content.decode("utf-8", "replace"))
                for d in root.findall("d"):
                    p = (d.get("p") or "").split(",")
                    try:
                        t = float(p[0])
                    except (IndexError, ValueError):
                        t = 0.0
                    uid = p[6] if len(p) > 6 else ""
                    items.append({"time": t, "text": (d.text or "").strip(), "uid": uid})
                if items:
                    return items
        except Exception:  # noqa: BLE001
            pass
    # 回退：protobuf 分段接口
    seg = 1
    while True:
        url = ("https://api.bilibili.com/x/v2/dm/web/seg.so?type=1&oid=%d"
               "&segment_index=%d" % (cid, seg))
        try:
            r = sess.get(url, timeout=30)
            if r.status_code != 200 or not r.content:
                break
        except Exception:  # noqa: BLE001
            break
        got = []
        for field, wt, val in _parse_fields(r.content):
            if wt != 2:
                continue
            elem = _elem_from_bytes(val)
            if elem is None:
                # 可能是嵌套一层（field1 = elems）
                for f2, w2, v2 in _parse_fields(val):
                    if w2 == 2:
                        e2 = _elem_from_bytes(v2)
                        if e2:
                            got.append(e2)
            else:
                got.append(elem)
        if not got:
            break
        items.extend(got)
        seg += 1
        if seg > 40:
            break
    return items


def summarize(items, duration=None, long_limit=30, bucket_samples=4):
    """把弹幕压成一段给 LLM 看的画像：热度分桶 + 刷屏句 + 长弹幕 + 关键词。"""
    if not items:
        return "（没有抓到弹幕）"
    items = sorted(items, key=lambda x: x.get("time") or 0)
    total = len(items)
    dur = duration or (items[-1]["time"] + 1)
    parts = ["共 %d 条弹幕，视频时长 %.0f 秒。" % (total, dur)]

    # 热度分桶
    quarters = 4
    buckets = [[] for _ in range(quarters)]
    for it in items:
        idx = min(quarters - 1, int((it["time"] / dur) * quarters))
        buckets[idx].append(it)
    names = ["前 1/4", "第 2/4", "第 3/4", "后 1/4"]
    parts.append("热度分布（条数）：" + "，".join(
        "%s %d" % (names[i], len(b)) for i, b in enumerate(buckets)))
    for i, b in enumerate(buckets):
        if not b:
            continue
        samples = []
        step = max(1, len(b) // bucket_samples)
        for j in range(0, len(b), step):
            samples.append(b[j]["text"][:40])
            if len(samples) >= bucket_samples:
                break
        if samples:
            parts.append("  - %s（%d 条）代表：%s" % (names[i], len(b), " / ".join(samples)))

    # 刷屏句（完全重复）
    cnt = Counter(it["text"] for it in items)
    spam = [(t, c) for t, c in cnt.most_common(60) if c >= 3 and len(t) <= 30]
    if spam:
        parts.append("被反复刷屏的弹幕（同一句出现次数）：" + "；".join(
            "%s×%d" % (t, c) for t, c in spam[:12]))

    # 长弹幕（信息量大的）
    longs = [it for it in items if len(it["text"]) >= 25]
    longs.sort(key=lambda x: -len(x["text"]))
    if longs:
        parts.append("较长的弹幕（观众自己的观点，优先参考）：")
        for it in longs[:long_limit]:
            parts.append("  [%d秒] %s" % (int(it["time"]), it["text"][:160]))

    # 关键词画像
    kw = []
    for k in KEYWORDS:
        c = sum(1 for it in items if k in it["text"])
        if c:
            kw.append("%s×%d" % (k, c))
    if kw:
        parts.append("关键词出现次数：" + " ".join(kw))
    return "\n".join(parts)


def strip_markup(text):
    """去掉弹幕里的表情占位符（[doge] 之类），保留可读文本。"""
    return re.sub(r"\[[^\[\]]{1,12}\]", "", text or "").strip()


if __name__ == "__main__":
    import argparse
    import json
    import os

    ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    sys.path.insert(0, os.path.join(ROOT, "bilibili"))
    import bili  # noqa: E402

    ap = argparse.ArgumentParser()
    ap.add_argument("bvid")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    sess = bili.make_session()
    view = bili.api(sess, "https://api.bilibili.com/x/web-interface/view?bvid=%s" % args.bvid)
    items = fetch_danmaku(sess, cid=view.get("cid"))
    if args.json:
        print(json.dumps(items, ensure_ascii=False, indent=1)[:4000])
    else:
        print(summarize(items, view.get("duration")))
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(summarize(items, view.get("duration")))
        print("→ %s" % args.out)
