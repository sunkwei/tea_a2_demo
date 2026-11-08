#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""video_analysis —— 分析**本地**视频：抽帧拼图 + 本地 ASR → LLM 理解 → 输出总结。

和 bilibili/bili.py 的 `watch` 是同一条链路（画面 + 语音 → LLM 总结），
区别是输入不是 B 站 bv 号，而是**本地视频文件**。

    python3 video_analysis/video_analysis.py ~/Videos/讲个视频.mp4
    python3 video_analysis/video_analysis.py "讲个视频"            # 只给文件名：在常见目录里找
    python3 video_analysis/video_analysis.py out.mp4 --list         # 看看能搜到哪些视频
    python3 video_analysis/video_analysis.py out.mp4 --merge-only   # 只重跑分析（复用中间产物）

流程：
    1. 定位文件（路径 / 文件名；默认在 cwd、~/Videos、~/Downloads、~/Desktop… 里找）
    2. ffprobe 读元信息（时长、分辨率、帧率、有没有音轨）
    3. ffmpeg 抽帧并**拼成大图**（每格烧了时间戳），交给视觉模型理解
    4. ffmpeg 提 16k 单声道 wav → 本地 SenseVoice 语音转写（离线）
    5. 三份材料（转写 + 画面描述 + 元信息）一起喂给文本 LLM → 分析总结
    6. 输出 markdown 报告（默认 ~/.tea_agent/video_analysis/<名字>.md）

依赖：
    ffmpeg / ffprobe（必需）、sherpa-onnx + SenseVoice 模型（ASR，可选自动装）
    LLM 走 ~/.tea_agent/provider.yaml 里的 provider（和 tea_a2 共用一份）

只依赖标准库 + requests + pyyaml + numpy（Pillow 不需要）。
"""
import argparse
import base64
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
SHARED = os.path.join(os.path.dirname(HERE), "shared")
if SHARED not in sys.path:
    sys.path.insert(0, SHARED)

import llm  # noqa: E402  （shared/llm.py：provider 选择 / chat）
import sensevoice  # noqa: E402  （shared/sensevoice.py：本地 ASR）

try:
    import requests
except ImportError:
    requests = None

HOME = os.path.expanduser("~")
STATE_DIR = os.environ.get("VA_HOME") or os.path.join(HOME, ".tea_agent", "video_analysis")
WORK_ROOT = os.path.join(STATE_DIR, "work")

VIDEO_EXTS = {".mp4", ".mkv", ".mov", ".avi", ".flv", ".webm", ".m4v", ".ts",
              ".wmv", ".mpg", ".mpeg", ".rmvb", ".rm", ".3gp", ".ogv", ".vob"}

# 抽帧烧时间戳要一个字体。Windows 用雅黑/黑体，Linux 用 DejaVu，macOS 用系统字体。
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simhei.ttf",
    r"C:\Windows\Fonts\consola.ttf", r"C:\Windows\Fonts\arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
    "/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/Helvetica.ttc",
]

# 视觉模型备胎（provider.yaml 里标了 supports_vision 的才敢用）
VISION_FALLBACKS = [("minimax", "MiniMax-M3.1-Flash"),
                    ("qwen", "qwen3.8-flash"),
                    ("opencode", "mimo-v2.6-flash")]
# 文本模型备胎（做长文本总结更稳的那几个）
LLM_FALLBACKS = [("mimo", "mimo-v2.6-pro"), ("minimax", "MiniMax-M3.1-Flash")]

TEA_API_DEFAULT = "http://127.0.0.1:8383"


# --------------------------------------------------------------------------
# 小工具
# --------------------------------------------------------------------------
def log(msg):
    print(msg, flush=True)


def run(cmd, timeout=None):
    """跑一个命令；失败就把 stderr 尾巴带出来。"""
    p = subprocess.run(cmd, capture_output=True, text=True, errors="replace",
                       timeout=timeout)
    if p.returncode != 0:
        raise RuntimeError("命令失败（rc=%s）：%s\n%s"
                           % (p.returncode, " ".join(cmd[:3]),
                              (p.stderr or p.stdout or "")[-400:]))
    return p


def which_or_die(name):
    path = shutil.which(name)
    if not path:
        raise SystemExit("没装 %s（Windows: https://ffmpeg.org/download.html）" % name)
    return path


def find_font():
    for f in FONT_CANDIDATES:
        if os.path.exists(f):
            return f
    return None


def fmt_dur(sec):
    sec = int(sec or 0)
    h, m, s = sec // 3600, (sec % 3600) // 60, sec % 60
    return ("%d:%02d:%02d" % (h, m, s)) if h else ("%d:%02d" % (m, s))


def load_json(path, default=None):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return default


def save_json(path, obj):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=1)


def slugify(name):
    s = re.sub(r"[^\w一-鿿.-]+", "_", name).strip("._")
    return (s or "video")[:60]


# --------------------------------------------------------------------------
# 1) 定位文件
# --------------------------------------------------------------------------
def default_search_dirs():
    dirs = [os.getcwd()]
    for sub in ("Videos", "Downloads", "Desktop", "Documents", "视频", "下载"):
        p = os.path.join(HOME, sub)
        if os.path.isdir(p):
            dirs.append(p)
    for sub in ("video_analysis", "videos"):
        p = os.path.join(STATE_DIR, sub)
        if os.path.isdir(p):
            dirs.append(p)
    # 一层子目录也扫一下（很多人在 ~/Videos/xxx/ 里放）
    return dirs


# 扫目录时跳过的：代码依赖、构建产物、版本库（里面全是 .ts/.d.ts 之类的假视频）
SKIP_DIRS = {"node_modules", ".git", ".svn", ".hg", "dist", "build", "__pycache__",
             ".idea", ".vscode", ".venv", "venv", ".tea_agent_run"}


def walk_videos(dirs, depth=2):
    out = []
    seen = set()
    for d in dirs:
        if not d or not os.path.isdir(d):
            continue
        base_depth = d.rstrip(os.sep).count(os.sep)
        for root, subdirs, files in os.walk(d):
            subdirs[:] = [s for s in subdirs
                          if s not in SKIP_DIRS and not s.startswith(".")]
            if root.count(os.sep) - base_depth >= depth:
                subdirs[:] = []
            for f in files:
                ext = os.path.splitext(f)[1].lower()
                if ext not in VIDEO_EXTS:
                    continue
                if f.lower().endswith(".d.ts"):
                    continue          # TypeScript 声明文件，不是视频
                p = os.path.abspath(os.path.join(root, f))
                if p in seen:
                    continue
                seen.add(p)
                out.append(p)
    return out


def resolve_video(name, extra_dirs=None, quiet=False):
    """按路径或文件名找到视频文件。

    顺序：直接当路径 → 精确文件名 → 去掉扩展名的名字 → 包含匹配。
    """
    name = (name or "").strip().strip('"')
    if not name:
        raise SystemExit("要给一个视频文件名（或路径）")
    if os.path.isfile(name):
        return os.path.abspath(name)

    dirs = list(extra_dirs or []) + default_search_dirs()
    cands = walk_videos(dirs)
    if not cands:
        raise SystemExit("在 %s 里没找到任何视频文件" % ", ".join(dirs[:6]))

    want = os.path.basename(name)
    want_stem = os.path.splitext(want)[0]
    base = {os.path.basename(p).lower(): p for p in cands}
    if want.lower() in base:
        return base[want.lower()]
    stem = {os.path.splitext(os.path.basename(p))[0].lower(): p for p in cands}
    if want_stem.lower() in stem:
        return stem[want_stem.lower()]
    # 包含匹配（文件名写了一半）
    hits = [p for p in cands if want_stem.lower() in os.path.basename(p).lower()]
    if len(hits) == 1:
        return hits[0]
    if len(hits) > 1:
        if not quiet:
            log("[find] 「%s」匹配到多个，取第一个：" % name)
            for h in hits[:8]:
                log("        %s" % h)
        return hits[0]
    raise SystemExit(
        "找不到「%s」。已扫过的目录：%s\n现有视频（挑一个用完整文件名）：\n  %s"
        % (name, ", ".join(dirs[:6]), "\n  ".join(cands[:20])))


# --------------------------------------------------------------------------
# 2) ffprobe：元信息
# --------------------------------------------------------------------------
def probe(path):
    which_or_die("ffprobe")
    p = subprocess.run(["ffprobe", "-v", "quiet", "-print_format", "json",
                        "-show_format", "-show_streams", path],
                       capture_output=True, text=True, errors="replace")
    if p.returncode != 0:
        raise RuntimeError("ffprobe 读不了这个文件：%s" % (p.stderr or "")[:200])
    data = json.loads(p.stdout or "{}")
    fmt = data.get("format") or {}
    streams = data.get("streams") or []
    v = next((s for s in streams if s.get("codec_type") == "video"), None)
    a = next((s for s in streams if s.get("codec_type") == "audio"), None)

    def _num(x, d=0.0):
        try:
            return float(x)
        except (TypeError, ValueError):
            return d

    fps = 0.0
    if v and v.get("avg_frame_rate") and "/" in v["avg_frame_rate"]:
        try:
            n, d = v["avg_frame_rate"].split("/")
            fps = float(n) / float(d) if float(d) else 0.0
        except (TypeError, ValueError, ZeroDivisionError):
            fps = 0.0
    return {
        "path": path,
        "name": os.path.basename(path),
        "size": int(_num(fmt.get("size"))),
        "duration": _num(fmt.get("duration")),
        "bitrate": int(_num(fmt.get("bit_rate"))),
        "format": fmt.get("format_name", ""),
        "width": int(v.get("width") or 0) if v else 0,
        "height": int(v.get("height") or 0) if v else 0,
        "vcodec": (v or {}).get("codec_name", ""),
        "fps": round(fps, 3),
        "has_audio": a is not None,
        "acodec": (a or {}).get("codec_name", ""),
        "asample_rate": int(_num((a or {}).get("sample_rate"))),
        "achannels": int(_num((a or {}).get("channels"))),
    }


# --------------------------------------------------------------------------
# 3) 抽帧 → 拼图（每格烧时间戳）
# --------------------------------------------------------------------------
def extract_sheets(video, outdir, interval=15, cols=3, rows=3, cell_width=480,
                   font=None, max_sheets=12, n_sheets=0):
    """抽帧并**拼成大图**：一张图 = cols×rows 帧（每格烧了时间戳）。

    一条消息放多张图比一张一张发划算——拼图之后一张图管 9 帧。
    返回 [(图片路径, 该图覆盖的帧数), ...]。
    """
    which_or_die("ffmpeg")
    os.makedirs(outdir, exist_ok=True)
    for f in os.listdir(outdir):
        if f.endswith(".jpg"):
            os.remove(os.path.join(outdir, f))

    per = max(1, cols * rows)
    vf = "fps=1/%d,scale=%d:-1" % (max(1, interval), cell_width)
    if font:
        # 冒号要转义，不然 filtergraph 会把 C:/ 当成选项分隔
        fp = font.replace("\\", "/").replace(":", "\\:")
        vf += (",drawtext=fontfile='%s':text='%%{pts\\:hms}':x=8:y=8:fontsize=24"
               ":fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=4" % fp)
    vf += ",tile=%dx%d" % (cols, rows)
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", video, "-vf", vf,
           "-q:v", "3", os.path.join(outdir, "sheet%02d.jpg")]
    if n_sheets:
        # -frames:v 是**输出**选项，必须放在输入之后、输出文件之前
        cmd.insert(len(cmd) - 1, "-frames:v")
        cmd.insert(len(cmd) - 1, str(int(n_sheets)))
    run(cmd)
    sheets = sorted(os.path.join(outdir, f) for f in os.listdir(outdir)
                    if f.endswith(".jpg"))
    if max_sheets and len(sheets) > max_sheets:
        for extra in sheets[max_sheets:]:
            os.remove(extra)
        sheets = sheets[:max_sheets]
    return [(p, per) for p in sheets]


def extract_frames(video, outdir, interval=15, cell_width=480, max_frames=24,
                   font=None):
    """不拼图模式：一张一张抽（画面里有细节、需要看原图时用）。"""
    which_or_die("ffmpeg")
    os.makedirs(outdir, exist_ok=True)
    for f in os.listdir(outdir):
        if f.endswith(".jpg"):
            os.remove(os.path.join(outdir, f))
    vf = "fps=1/%d,scale=%d:-1" % (max(1, interval), cell_width)
    if font:
        fp = font.replace("\\", "/").replace(":", "\\:")
        vf += (",drawtext=fontfile='%s':text='%%{pts\\:hms}':x=8:y=8:fontsize=24"
               ":fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=4" % fp)
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", video, "-vf", vf,
         "-q:v", "3", os.path.join(outdir, "f%03d.jpg")])
    frames = sorted(os.path.join(outdir, f) for f in os.listdir(outdir)
                    if f.endswith(".jpg"))
    if max_frames:
        frames = frames[:max_frames]
    return [(p, 1) for p in frames]


def plan_sampling(duration, interval, per, max_sheets=12, max_frames=24,
                  tile=True):
    """算抽帧间隔和拼图张数。

    要点是**别让拼图出现黑格**：tile 滤镜总是输出满格，帧不够时用黑色补上，
    视觉模型会把黑格当成"画面内容"瞎猜。所以间隔要重新算，让帧数正好铺满
    所有拼图（最后一帧落在视频结束前）。
    """
    interval = max(1, int(interval or 1))
    duration = float(duration or 0)
    if duration <= 0:
        return interval, (max_sheets if tile else max_frames)
    if not tile:
        want = max(1, min(max_frames, int(round(duration / interval)) or 1))
        return max(1, int(duration // want)), want
    per = max(1, per)
    # 先按用户给的间隔估帧数，再受 max_sheets 限制
    want = max(1, int(round(duration / interval)) or 1)
    want = min(want, per * max_sheets)
    sheets = max(1, (want + per - 1) // per)
    # 间隔取整到秒，并保证 (总格数-1)*间隔 < 时长 → 不会多出半张
    step = max(1, int(duration // (sheets * per)))
    return step, sheets


# --------------------------------------------------------------------------
# 4) 本地 ASR
# --------------------------------------------------------------------------
def run_asr(video, workdir, chunk=60, auto_download=True, progress=True):
    """本地语音转写。返回 (逐字稿文本, [(起始秒, 文本)])。失败返回 ("", [])。"""
    ok, why = sensevoice.asr_status(auto=auto_download)
    if not ok:
        log("[asr] 用不了：%s" % why)
        return "", []
    wav = os.path.join(workdir, "audio.wav")
    t0 = time.time()
    log("[asr] 提取音频 → 16k 单声道 wav…")
    sensevoice.extract_audio(video, wav)
    log("[asr] SenseVoice 转写中（本地 CPU，约 4 倍实时，慢是正常的）…")
    pieces = sensevoice.asr_transcribe(wav, chunk=chunk, progress=progress)
    dur = 0
    try:
        import wave
        with wave.open(wav, "rb") as wf:
            dur = wf.getnframes() / float(wf.getframerate())
    except Exception:
        pass
    log("[asr] %d 段 / %s 音频，耗时 %.1fs" % (len(pieces), fmt_dur(dur),
                                             time.time() - t0))
    return sensevoice.asr_to_text(pieces), pieces


# --------------------------------------------------------------------------
# 5) 视觉模型：看拼图
# --------------------------------------------------------------------------
def pick_vision_provider(name=None, model=None):
    """挑一个支持图片的 provider。provider.yaml 里 models[x].supports_vision。"""
    try:
        import yaml
    except ImportError:
        yaml = None
    if name:
        return llm.pick_provider(name, model)
    if yaml is None:
        return llm.pick_provider(None, model)
    path = os.path.join(HOME, ".tea_agent", "provider.yaml")
    with open(path, "r", encoding="utf-8") as fh:
        cfg = yaml.safe_load(fh) or {}
    providers = cfg.get("providers") or {}
    for pname, p in providers.items():
        models = p.get("models") or {}
        if isinstance(models, dict):
            for mname, minfo in models.items():
                if (minfo or {}).get("supports_vision"):
                    return llm.pick_provider(pname, mname)
        elif models:
            return llm.pick_provider(pname, None)
    return llm.pick_provider(None, model)


def vision_chat(prov_cfg, model, prompt, images, max_tokens=6000, timeout=240,
                tries=2):
    """直接调 provider（OpenAI 兼容）发图：image_url 用 base64 data URI。"""
    if requests is None:
        raise SystemExit("需要 requests：pip3 install requests")
    url = llm.chat_completions_url(prov_cfg.get("api_url"))
    headers = {"Content-Type": "application/json"}
    headers["Authorization"] = "Bearer " + (prov_cfg.get("api_key") or "")
    for k, v in (prov_cfg.get("headers") or {}).items():
        headers[k] = v
    content = [{"type": "text", "text": prompt}]
    for p in images:
        with open(p, "rb") as fh:
            b64 = base64.b64encode(fh.read()).decode("ascii")
        content.append({"type": "image_url",
                        "image_url": {"url": "data:image/jpeg;base64,%s" % b64}})
    body = {"model": model,
            "messages": [{"role": "user", "content": content}],
            "max_tokens": max_tokens}
    last = None
    for i in range(tries):
        try:
            r = requests.post(url, headers=headers, json=body, timeout=timeout)
            if r.status_code != 200:
                last = "http %s: %s" % (r.status_code, (r.text or "")[:200])
                time.sleep(2 + i * 2)
                continue
            j = r.json()
            msg = ((j.get("choices") or [{}])[0].get("message") or {})
            text = (msg.get("content") or "").strip()
            if not text:
                usage = j.get("usage") or {}
                last = ("空回复（finish_reason=%s，用掉 %s token，其中思考 %s）"
                        % ((j.get("choices") or [{}])[0].get("finish_reason"),
                           usage.get("completion_tokens"),
                           (usage.get("completion_tokens_details") or {})
                           .get("reasoning_tokens")))
                time.sleep(2)
                continue
            return text
        except Exception as exc:
            last = repr(exc)
            time.sleep(2 + i * 2)
    raise RuntimeError("视觉模型调用失败: %s" % last)


def tea_workspaces(tea_api):
    r = requests.get(tea_api + "/api/workspaces", timeout=20)
    data = r.json()
    wlist = data.get("workspaces") if isinstance(data, dict) else data
    if isinstance(wlist, dict):
        wlist = wlist.get("workspaces")
    for w in (wlist or []):
        if w.get("id") and w.get("exists") is not False:
            return w["id"]
    return (wlist or [{}])[0].get("id", "")


def tea_vision(tea_api, workspace_id, images, prompt, provider, model, timeout=300):
    """走 tea_a2 自己的 API 识图（一条消息最多 4 张图）。"""
    body = {
        "workspace_id": workspace_id,
        "message": prompt,
        "images": [{"data": base64.b64encode(open(p, "rb").read()).decode()}
                   for p in images],
        "provider": provider,
        "model": model,
        "tools": ["__tea_select_no_tools__"],
        "async": True,
    }
    r = requests.post(tea_api + "/api/chat", json=body, timeout=180)
    if r.status_code not in (200, 202):
        raise RuntimeError("tea_a2 拒了：%s %s" % (r.status_code, (r.text or "")[:200]))
    turn_id = (r.json() or {}).get("turn_id")
    if not turn_id:
        raise RuntimeError("tea_a2 没给 turn_id：%s" % (r.text or "")[:200])
    deadline = time.time() + timeout
    while time.time() < deadline:
        d = requests.get(tea_api + "/api/turns/" + turn_id, timeout=30).json()
        state = d.get("state")
        if state and state != "running":
            if d.get("error"):
                raise RuntimeError("tea_a2 跑出错了：%s" % d.get("error"))
            return d.get("result") or ""
        time.sleep(1.5)
    raise RuntimeError("视觉识别超时")


def vision_candidates(args):
    """识图要试的 (provider, model) 列表：用户指定的优先，然后才是备胎。"""
    cands = []
    if args.vision_provider:
        cands.append((args.vision_provider, args.vision_model))
    else:
        pname, _prov, model = pick_vision_provider(None, args.vision_model)
        cands.append((pname, model))
    for p, m in VISION_FALLBACKS:
        if (p, m) not in cands:
            cands.append((p, m))
    return cands


def describe_frames(items, args):
    """把（图片, 帧数）列表丢给视觉模型，返回每张图的描述。

    items: [(图片路径, 该图覆盖的帧数), ...]
    """
    if not items:
        return []
    cols, rows = args.cols, args.rows
    per = max(1, cols * rows)
    base_prompt = (
        "这是一个本地视频的**连续画面截图拼图**（%dx%d 一张图，每格左上角的时间戳"
        "就是它在视频里的位置，相邻格间隔约 %d 秒，共 %d 格）。\n"
        "请按时间顺序描述：画面里出现了什么（人物、场景、**画面上的文字/字幕/图表**），"
        "这一段在讲什么；最后用一句话概括这一段。"
        % (cols, rows, max(1, args.interval), per))

    notes = []
    prev = ""
    backend = args.vision_backend
    # provider 直连时一次只送 1 张：多图会让推理模型的思考变长，更容易把
    # token 预算吃光（正文就空了）。tea_a2 那边最多 4 张。
    per_call = max(1, min(4 if backend == "tea" else 1, args.vision_per_call))
    wid = None
    cands = []
    if backend == "tea":
        wid = tea_workspaces(args.tea_api)
        log("[vision] tea_a2 @ %s（%s/%s）" % (args.tea_api, args.vision_provider,
                                              args.vision_model))
    else:
        cands = vision_candidates(args)
        pname, prov, model = llm.pick_provider(cands[0][0], cands[0][1])
        log("[vision] %s/%s（%s）｜ 备胎：%s"
            % (pname, model, prov.get("api_url"),
               ", ".join("%s/%s" % c for c in cands[1:])))

    for i in range(0, len(items), per_call):
        batch = items[i:i + per_call]
        prompt = base_prompt
        if prev:
            prompt += ("\n\n【上一批（第 %d-%d 格）的描述】\n%s\n"
                       "请接着上一批继续说，不要重复已经说过的内容。"
                       % (max(1, i - per + 1), i, prev[:1500]))
        txt = ""
        if backend == "tea":
            try:
                txt = tea_vision(args.tea_api, wid, [b[0] for b in batch], prompt,
                                 args.vision_provider, args.vision_model)
            except Exception as exc:
                log("[vision] tea_a2 失败：%s" % str(exc)[:160])
        else:
            for pname, model in cands:
                try:
                    _n, prov, mname = llm.pick_provider(pname, model)
                    txt = vision_chat(prov, mname, prompt, [b[0] for b in batch],
                                      max_tokens=args.vision_max_tokens)
                    if txt.strip():
                        break
                except Exception as exc:
                    log("[vision] %s/%s 失败：%s" % (pname, model, str(exc)[:180]))
                    txt = ""
        prev = txt
        lo = i + 1
        hi = min((i + len(batch)) * per, len(items) * per)
        notes.append("【第 %d-%d 格】\n%s" % (lo, hi, txt))
        log("[vision] 识图 %d/%d（覆盖到第 %d 格）%s"
            % (min(i + per_call, len(items)), len(items), hi,
               "" if txt.strip() else "  ← 这张没识别出来"))
    return notes


# --------------------------------------------------------------------------
# 6) 合并 → LLM 分析
# --------------------------------------------------------------------------
ANALYSIS_PROMPT = """你在帮用户「看懂」一个本地视频。素材有三部分：

- **语音转写**：视频里说的话（本地 ASR 自动识别的，可能有同音错字）
- **画面描述**：按时间顺序抽帧拼成的截图，由视觉模型描述（人物、场景、画面上的文字）
- **视频元信息**：时长、分辨率、帧率

请综合三者，写一份**这个视频到底在讲什么**的分析报告，用中文 Markdown，包含：

1. **一句话概括**：这个视频在讲什么（一句话说清）
2. **内容主线**：按时间顺序列出关键节点（带时间点），讲清楚它的论点/流程/情节，
   **不要照抄字幕**；如果这是教程类视频，就写清楚步骤和做法
3. **关键概念与关键信息**：术语、概念、画面上出现的文字、演示的步骤、数据
4. **值得注意的点**：结论、金句、反直觉的地方、容易被忽略的细节
5. **评价**：
   - 站得住的地方（它讲对了什么、价值在哪）
   - 需要打补丁或存疑的地方（哪里讲得糙、哪里可能有偏差、有没有漏掉的重要视角）
6. **结论**：一段话说清这个视频的价值和它的局限，以及适合谁看

注意：
- **语音转写里有同音错字**（ASR 的老毛病，专有名词错得最狠），看到明显的要按上下文改正，
  并用括号标出原词，例如「熊士利」→ 熊十力（原文「熊士利」）；不确定的保留原样。
- 画面描述和转写矛盾时，**以转写为准**（作者自己的话），并注明哪里对不上。
- 只依据给出的素材，**不要编造**视频里没有的内容；素材没覆盖到的就写「素材未覆盖」。
- 直接给 Markdown 正文，不要写「好的，我来分析」这类前言。"""


def llm_chat_resilient(prov, model, messages, max_tokens=8000, label="llm",
                       expect=None):
    """先试指定的 provider；失败就自动换备胎。

    expect：正文里**必须出现**的字符串（比如最后一节的小标题"结论"）。
    推理模型（MiniMax-M3.1-Flash 这类）会把思考 token 也算进 max_tokens，
    正文常在写一半时被截断——用 expect 检出截断，然后**加倍预算重试**，
    还不行再换 provider。
    """
    tries = [(prov, model)]
    for p, m in LLM_FALLBACKS:
        if (p, m) != (prov, model):
            tries.append((p, m))
    last = None
    for p, m in tries:
        for budget in (max_tokens, max_tokens * 2):
            try:
                _name, cfg, mname = llm.pick_provider(p, m)
                txt = llm.llm_chat(cfg, mname, messages, max_tokens=budget)
            except Exception as exc:
                last = exc
                log("[%s] %s/%s 失败：%s" % (label, p, m, str(exc)[:140]))
                break
            if not (txt or "").strip():
                last = RuntimeError("%s/%s 返回空" % (p, m))
                break
            if expect and expect not in txt:
                last = RuntimeError("输出不完整（缺「%s」，多半被 max_tokens 截断）"
                                    % expect)
                log("[%s] %s/%s 输出被截断（预算 %s），加预算重试"
                    % (label, p, m, budget))
                continue
            if (p, m) != (prov, model):
                log("[%s] 主 provider 不行，换 %s/%s 成功" % (label, p, m))
            return txt
    raise last or RuntimeError("所有 provider 都失败了")


def build_blob(meta, transcript, frame_notes, max_chars=24000):
    """把三份材料拼成送给文本模型的输入。"""
    blob = "# 视频\n"
    blob += "文件：%s\n" % meta.get("name", "")
    blob += "时长：%s（%d 秒）\n" % (fmt_dur(meta.get("duration")), meta.get("duration") or 0)
    blob += "画面：%sx%s @ %s fps，编码 %s\n" % (meta.get("width"), meta.get("height"),
                                                 meta.get("fps"), meta.get("vcodec"))
    blob += "音频：%s\n\n" % (meta.get("acodec") or "无")
    if transcript:
        blob += "## 语音转写（本地 SenseVoice 跑的，逐字）\n"
        blob += transcript[:max_chars] + "\n\n"
    if frame_notes:
        blob += "## 画面描述（抽帧拼图，视觉模型看的）\n"
        blob += "\n\n".join(n[:1500] for n in frame_notes) + "\n\n"
    return blob


def render_report(meta, analysis, transcript, frame_notes, workdir):
    out = []
    out.append("# %s —— 本地视频分析\n" % meta.get("name", ""))
    out.append("> 文件：`%s` ｜ 时长 %s ｜ %sx%s @ %sfps ｜ 编码 %s/%s ｜ 大小 %.1f MB\n"
               % (meta.get("path"), fmt_dur(meta.get("duration")), meta.get("width"),
                  meta.get("height"), meta.get("fps"), meta.get("vcodec"),
                  meta.get("acodec") or "-", (meta.get("size") or 0) / 1048576.0))
    out.append("> 分析时间：%s ｜ 素材：%s ｜ 中间产物：%s\n"
               % (time.strftime("%Y-%m-%d %H:%M"),
                  "语音转写 + 画面截图拼图",
                  workdir))
    if analysis:
        out.append("## 分析\n")
        out.append(analysis.strip() + "\n")
    if transcript:
        out.append("## 语音转写全文\n")
        out.append("```\n" + transcript + "\n```\n")
    if frame_notes:
        out.append("## 画面描述\n")
        out.append("\n\n".join(frame_notes) + "\n")
    return "\n".join(out)


# --------------------------------------------------------------------------
# 主流程
# --------------------------------------------------------------------------
def analyze_video(path, args):
    meta = probe(path)
    log("[probe] %s ｜ %s ｜ %sx%s @ %sfps ｜ %s"
        % (meta["name"], fmt_dur(meta["duration"]), meta["width"], meta["height"],
           meta["fps"], "有音轨" if meta["has_audio"] else "无音轨"))

    stem = os.path.splitext(os.path.basename(path))[0]
    slug = "%s_%s" % (slugify(stem),
                      hashlib.sha1(os.path.abspath(path).encode("utf-8")).hexdigest()[:8])
    workdir = os.path.join(args.work_dir or WORK_ROOT, slug)
    os.makedirs(workdir, exist_ok=True)

    cache_t = os.path.join(workdir, "transcript.json")
    cache_f = os.path.join(workdir, "frames.json")
    mtime = os.path.getmtime(path)

    # ---- 抽帧拼图 ----
    sheets = []
    if args.merge_only:
        cache = load_json(cache_f) or {}
        frame_notes = cache.get("notes") or []
        sheets = [(p, 1) for p in (cache.get("sheets") or [])]
        log("[frames] --merge-only：复用 %d 张图 / %d 段画面描述"
            % (len(sheets), len(frame_notes)))
    elif not args.no_frames:
        font = find_font()
        if not font:
            log("[frames] 没找到字体，时间戳不烧了")
        per = max(1, args.cols * args.rows)
        interval, n_sheets = plan_sampling(
            meta["duration"], args.interval, per,
            max_sheets=args.max_sheets, max_frames=args.max_frames,
            tile=not args.no_tile)
        if interval != args.interval:
            log("[frames] 抽帧间隔 %ds → %ds（凑满整张拼图，避免黑格）"
                % (args.interval, interval))
        args.interval = interval
        t0 = time.time()
        if args.no_tile:
            sheets = extract_frames(path, os.path.join(workdir, "frames"), interval,
                                    args.cell_width, args.max_frames, font)
        else:
            sheets = extract_sheets(path, os.path.join(workdir, "frames"), interval,
                                    args.cols, args.rows, args.cell_width, font,
                                    args.max_sheets, n_sheets)
        log("[frames] %d 张图（%s），耗时 %.1fs"
            % (len(sheets), "单帧" if args.no_tile else "%dx%d 拼图" % (args.cols, args.rows),
               time.time() - t0))
        if not sheets:
            log("[frames] 一张都没抽到")

    # ---- ASR ----
    transcript, pieces = "", []
    if args.merge_only:
        cache = load_json(cache_t) or {}
        pieces = cache.get("pieces") or []
        transcript = cache.get("text") or ""
        log("[asr] --merge-only：复用转写 %d 段" % len(pieces))
    elif not args.no_asr and meta["has_audio"]:
        cache = load_json(cache_t)
        if (cache and not args.no_reuse
                and abs((cache.get("mtime") or 0) - mtime) < 1):
            pieces = cache.get("pieces") or []
            transcript = cache.get("text") or ""
            log("[asr] 复用已有转写（%d 段）" % len(pieces))
        else:
            transcript, pieces = run_asr(path, workdir, chunk=args.asr_chunk,
                                         auto_download=not args.no_download)
            save_json(cache_t, {"mtime": mtime, "pieces": pieces, "text": transcript})
    elif not meta["has_audio"]:
        log("[asr] 这个文件没有音轨，跳过")

    # ---- 视觉理解 ----
    if not args.merge_only:
        frame_notes = []
        if sheets:
            try:
                frame_notes = describe_frames(sheets, args)
            except Exception as exc:
                log("[vision] 没走通：%s" % exc)
                if not args.keep_going and not transcript:
                    raise
        save_json(cache_f, {"notes": frame_notes,
                            "sheets": [s[0] for s in sheets]})

    # ---- 合并 + 分析 ----
    blob = build_blob(meta, transcript, frame_notes, args.max_chars)
    blob_path = os.path.join(workdir, "blob.txt")
    with open(blob_path, "w", encoding="utf-8") as fh:
        fh.write(blob)
    log("[blob] 素材 %d 字 → %s" % (len(blob), blob_path))

    analysis = ""
    if not args.no_llm:
        pname, prov, model = llm.pick_provider(args.provider, args.model)
        log("[llm] 分析总结（%s/%s）…" % (pname, model))
        try:
            analysis = llm_chat_resilient(
                pname, model,
                [{"role": "system", "content": ANALYSIS_PROMPT},
                 {"role": "user", "content": blob}],
                max_tokens=args.max_tokens, label="llm", expect="结论")
        except Exception as exc:
            log("[llm] 总结失败：%s" % exc)

    report = render_report(meta, analysis, transcript, frame_notes, workdir)
    out_path = args.out or os.path.join(STATE_DIR, "%s.md" % slug)
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write(report)
    log("[out] 报告 → %s" % out_path)

    if args.json:
        payload = {
            "file": meta,
            "workdir": workdir,
            "sheets": [s[0] for s in sheets],
            "frames_described": len(frame_notes),
            "asr_segments": len(pieces),
            "asr_chars": len(transcript),
            "transcript": transcript,
            "frame_notes": frame_notes,
            "analysis": analysis,
            "report": report,
        }
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=1)
        log("[out] JSON → %s" % args.json)

    if args.print_report:
        log("")
        log(report)
    else:
        log("")
        log(analysis[:3000] if analysis else "（没有生成分析正文）")
    return out_path


def cmd_list(args):
    dirs = list(args.dir or []) + default_search_dirs()
    cands = walk_videos(dirs)
    log("扫描目录：%s" % ", ".join(dirs))
    log("找到 %d 个视频：" % len(cands))
    for p in cands:
        try:
            size = os.path.getsize(p) / 1048576.0
        except OSError:
            size = 0
        log("  %-60s %8.1f MB" % (p, size))
    return 0


def main():
    ap = argparse.ArgumentParser(
        description="本地视频分析：抽帧拼图 + 本地 ASR → LLM 理解 → 总结",
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video", nargs="?", help="本地视频文件名或路径")
    ap.add_argument("--dir", action="append", help="额外搜索目录（可多次）")
    ap.add_argument("--list", action="store_true", help="只列出能搜到的视频文件")
    # 抽帧
    ap.add_argument("--interval", type=int, default=15, help="每多少秒抽一帧")
    ap.add_argument("--cols", type=int, default=3, help="拼图列数")
    ap.add_argument("--rows", type=int, default=3, help="拼图行数")
    ap.add_argument("--cell-width", type=int, default=480, help="拼图里每格多宽（像素）")
    ap.add_argument("--max-sheets", type=int, default=12, help="最多几张拼图")
    ap.add_argument("--no-tile", action="store_true", help="不拼图，一张一张抽")
    ap.add_argument("--max-frames", type=int, default=24, help="不拼图时最多抽几张")
    ap.add_argument("--no-frames", action="store_true", help="不看画面，只用语音")
    # ASR
    ap.add_argument("--no-asr", action="store_true", help="不做语音转写")
    ap.add_argument("--asr-chunk", type=int, default=60, help="ASR 切块秒数（0=整段）")
    ap.add_argument("--no-download", action="store_true", help="缺 ASR 模型/运行时也不自动下载")
    # 模型
    ap.add_argument("--vision-backend", choices=["provider", "tea"], default="provider",
                    help="识图走 provider 直连（默认）还是 tea_a2 API")
    ap.add_argument("--vision-provider", default=None)
    ap.add_argument("--vision-model", default=None)
    ap.add_argument("--vision-per-call", type=int, default=1,
                    help="一次送几张图给视觉模型（provider 直连建议 1，多图容易把 token 吃光）")
    ap.add_argument("--vision-max-tokens", type=int, default=6000,
                    help="视觉模型输出的 token 上限（推理模型要留够思考空间）")
    ap.add_argument("--provider", default=None, help="文本模型 provider")
    ap.add_argument("--model", default=None, help="文本模型")
    ap.add_argument("--tea-api", default=TEA_API_DEFAULT)
    ap.add_argument("--max-chars", type=int, default=24000, help="送进模型的转写字数上限")
    ap.add_argument("--max-tokens", type=int, default=32000,
                    help="文本模型输出预算（推理模型的思考 token 也算在里面）")
    ap.add_argument("--no-llm", action="store_true", help="不调 LLM，只出素材")
    # 输出
    ap.add_argument("--out", default=None, help="报告写到哪（默认 ~/.tea_agent/video_analysis/）")
    ap.add_argument("--json", default=None, help="额外写一份 JSON（素材 + 分析）")
    ap.add_argument("--work-dir", default=None, help="中间产物放哪")
    ap.add_argument("--print-report", action="store_true", help="把完整报告打到终端")
    ap.add_argument("--keep-going", action="store_true", help="识图失败也继续")
    ap.add_argument("--merge-only", action="store_true",
                    help="只重跑 LLM 分析（复用已抽帧/识图/转写的结果）")
    ap.add_argument("--no-reuse", action="store_true", help="不复用已有的转写缓存")
    args = ap.parse_args()

    if args.list:
        return cmd_list(args)
    if not args.video:
        ap.print_help()
        return 1
    path = resolve_video(args.video, args.dir)
    log("[find] %s" % path)
    analyze_video(path, args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
