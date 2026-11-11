# -*- coding: utf-8 -*-
"""抽帧拼图 + 视觉模型描述（B 站视频分析用）。

给 `bilibili/tools/bili_post.py` 调用，也可以单独跑：

    python bilibili/tools/frames.py <本地视频> --interval 30 --outdir 目录

要点（都是踩出来的）：
  * 拼图必须**先算好间隔**再抽帧：`tile` 滤镜帧数不够会**补黑格**，视觉模型会把黑格
    当成画面内容瞎猜 → 用 plan_sampling() 让帧数正好铺满所有拼图。
  * Windows 上 ffmpeg 的 drawtext 字体路径要写成 `C\\:/Windows/Fonts/msyh.ttc`（冒号要转义），
    否则**静默不画时间戳**，视觉模型就不知道哪一格是第几秒。
  * MiniMax 直连识图必须带 `reasoning_effort=low` + `reasoning_split=true` 且
    max_tokens≥12000，否则思考 token 吃光预算、正文为空（finish_reason=length）。
  * 一次只送 1 张图：多图会让推理模型的思考变长，更容易把预算吃光。
"""
import base64
import os
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
for _p in (os.path.join(ROOT, "shared"),):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import llm  # noqa: E402

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
    r"C:\Windows\Fonts\msyh.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]

# 识图备胎：minimax 快且稳；qwen 本机 403 未购；opencode 要 session id
VISION_CANDIDATES = [("minimax", "MiniMax-M3.1-Flash"),
                     ("deepseek", "deepseek-flash"),
                     ("mimo", "mimo-v2.6-flash")]


def log(msg):
    print("[%s] %s" % (time.strftime("%H:%M:%S"), msg), flush=True)


def find_font():
    for f in FONT_CANDIDATES:
        if os.path.exists(f):
            return f
    return None


def plan_sampling(duration, interval, per, max_sheets=8):
    """算抽帧间隔与拼图张数：让帧数正好铺满所有拼图，最后一帧落在视频结束前。"""
    interval = max(1, int(interval or 1))
    duration = float(duration or 0)
    per = max(1, per)
    if duration <= 0:
        return interval, max(1, max_sheets)
    want = max(1, int(round(duration / interval)) or 1)
    want = min(want, per * max_sheets)
    sheets = max(1, (want + per - 1) // per)
    step = max(1, int(duration // (sheets * per)))
    return step, sheets


def extract_sheets(video, outdir, interval=30, cols=3, rows=3, cell_width=480,
                   max_sheets=8, font=None):
    """抽帧并拼成大图：一张图 = cols×rows 帧，每格烧了时间戳。返回图片路径列表。"""
    if not shutil.which("ffmpeg"):
        raise RuntimeError("没装 ffmpeg，抽不了帧")
    os.makedirs(outdir, exist_ok=True)
    for f in os.listdir(outdir):
        if f.endswith(".jpg"):
            os.remove(os.path.join(outdir, f))
    per = max(1, cols * rows)
    vf = "fps=1/%d,scale=%d:-1" % (max(1, interval), cell_width)
    if font:
        fp = font.replace("\\", "/").replace(":", "\\:")
        vf += (",drawtext=fontfile='%s':text='%%{pts\\:hms}':x=8:y=8:fontsize=24"
               ":fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=4" % fp)
    vf += ",tile=%dx%d" % (cols, rows)
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", video, "-vf", vf,
           "-q:v", "3", os.path.join(outdir, "sheet%02d.jpg")]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL,
                   stderr=subprocess.DEVNULL)
    sheets = sorted(os.path.join(outdir, f) for f in os.listdir(outdir)
                    if f.endswith(".jpg"))
    if max_sheets and len(sheets) > max_sheets:
        for extra in sheets[max_sheets:]:
            os.remove(extra)
        sheets = sheets[:max_sheets]
    return sheets, per


def call_vision(prov_cfg, model, prompt, image, max_tokens=12000):
    """直连 provider（OpenAI 兼容）发图：image_url 用 base64 data URI。"""
    import requests
    url = llm.chat_completions_url(prov_cfg.get("api_url"))
    headers = {"Content-Type": "application/json",
               "Authorization": "Bearer " + (prov_cfg.get("api_key") or "")}
    for k, v in (prov_cfg.get("headers") or {}).items():
        headers[k] = v
    with open(image, "rb") as fh:
        b64 = base64.b64encode(fh.read()).decode("ascii")
    body = {
        "model": model,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url",
             "image_url": {"url": "data:image/jpeg;base64,%s" % b64}},
        ]}],
        "max_tokens": max_tokens,
    }
    if "minimax" in (prov_cfg.get("api_url") or "").lower() or \
            model.lower().startswith("minimax"):
        body["reasoning_effort"] = "low"
        body["reasoning_split"] = True
    r = requests.post(url, headers=headers, json=body, timeout=300)
    if r.status_code != 200:
        raise RuntimeError("http %s: %s" % (r.status_code, (r.text or "")[:180]))
    j = r.json()
    choice = (j.get("choices") or [{}])[0]
    msg = choice.get("message") or {}
    text = (msg.get("content") or "").strip()
    if not text:
        usage = j.get("usage") or {}
        raise RuntimeError("空回复（finish_reason=%s, tokens=%s, 思考=%s）"
                           % (choice.get("finish_reason"),
                              usage.get("completion_tokens"),
                              (usage.get("completion_tokens_details") or {})
                              .get("reasoning_tokens")))
    return text


BASE_PROMPT = """这是一个 B 站视频的**连续画面拼图**（{cols}×{rows} 一张图，每格左上角的时间戳
就是它在视频里的位置，相邻格间隔约 {step} 秒）。
请按时间顺序描述：画面里有什么（人物、场景、**画面上的文字**），这一段在讲什么。
**重点**：把画面上出现的**具体数字、百分比、图表标题、机构/文件名称、年份、地图/图表上的标注**
如实抄出来（看不清就写"看不清"，别猜）；画面上出现的**弹幕文字**也可以顺带提一句它在配合什么。
最后用一句话概括这一段。**总长度控制在 350 字以内**，不要展开分析。"""


def describe(sheets, step, per=9, cols=3, rows=3, candidates=None):
    """逐张拼图做视觉描述，返回 [文本, ...]。一次送 1 张图。"""
    cands = list(candidates or VISION_CANDIDATES)
    notes = []
    prev = ""
    for i, path in enumerate(sheets):
        prompt = BASE_PROMPT.format(cols=cols, rows=rows, step=max(1, step))
        if prev:
            prompt += ("\n\n【上一批的描述】\n%s\n请接着往下说，不要重复。" % prev[:1200])
        txt = ""
        for pname, model in cands:
            try:
                _n, cfg, mname = llm.pick_provider(pname, model)
                txt = call_vision(cfg, mname, prompt, path)
                if txt.strip():
                    break
            except Exception as exc:  # noqa: BLE001
                log("  %s/%s 失败：%s" % (pname, model, str(exc)[:140]))
                txt = ""
        if not txt:
            txt = "（这一段识图失败）"
        lo = i * per + 1
        hi = min((i + 1) * per, len(sheets) * per)
        notes.append("【第 %d-%d 格（约 %ds~%ds）】\n%s"
                     % (lo, hi, (lo - 1) * step, (hi - 1) * step, txt))
        prev = txt
        log("识图 %d/%d" % (i + 1, len(sheets)))
    return notes


def format_notes(notes):
    return "\n\n".join(notes)


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--interval", type=int, default=30)
    ap.add_argument("--cols", type=int, default=3)
    ap.add_argument("--rows", type=int, default=3)
    ap.add_argument("--outdir", default="frames_out")
    args = ap.parse_args()
    sheets, per = extract_sheets(args.video, args.outdir, interval=args.interval,
                                 cols=args.cols, rows=args.rows)
    log("拼图 %d 张（每 %d 格）" % (len(sheets), per))
    notes = describe(sheets, args.interval, per=per, cols=args.cols, rows=args.rows)
    print(format_notes(notes))
