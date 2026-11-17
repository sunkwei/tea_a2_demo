# -*- coding: utf-8 -*-
"""本地语音识别：SenseVoice Small（ONNX int8）+ sherpa-onnx。

**完全离线**，不联网、不调云端 API。 bilibili 和 video_analysis 共用这一份。

    模型：~/models/sherpa-onnx/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09
          （github.com/k2-fsa/sherpa-onnx releases/asr-models，158MB）
    运行时：pip install sherpa-onnx（cp314 有 wheel，纯 CPU，不依赖 torch）
    速度：实测 4 倍实时（4 线程，267 句干净语音用了 66 秒）

音频要转成 16k 单声道 wav（模型要这个格式）——用 ffmpeg 提。

常用 API：
    ok, why = asr_status(auto=True)          # 能不能用（缺就自动装/下载）
    wav = extract_audio(media, "out.wav")    # 任意媒体 → 16k 单声道 wav
    pieces = asr_transcribe(wav, chunk=60)   # [(起始秒, 文本), ...]
    text = asr_to_text(pieces)               # "[00:12] 你好" 那种逐字稿
    spans = asr_transcribe_spans(wav)        # [(起始秒, 结束秒, 文本), ...]

也能当独立命令行跑（不用 import）：

    python shared/sensevoice.py --download                      # 装运行时 + 下模型（158MB）
    python shared/sensevoice.py --status                        # 看状态
    python shared/sensevoice.py --wav a.wav                     # 逐字稿打到屏幕
    python shared/sensevoice.py --wav a.wav --output audacity   # Audacity 标签（导入音轨用）
    python shared/sensevoice.py --wav a.wav --output audacity --out a.txt
    python shared/sensevoice.py a.mp4 --output srt --out a.srt
"""
import argparse
import contextlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

ASR_MODEL_NAME = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09"
ASR_BASE_DIR = os.environ.get("ASR_BASE") or os.path.expanduser("~/models/sherpa-onnx")
# ASR_MODEL 可以直接指到含 model.int8.onnx 的那个目录
ASR_MODEL_DIR = os.environ.get("ASR_MODEL") or os.path.join(ASR_BASE_DIR, ASR_MODEL_NAME)
ASR_MODEL_URL = os.environ.get("ASR_MODEL_URL") or (
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/"
    "%s.tar.bz2" % ASR_MODEL_NAME)
# 手动指定了模型目录就只认那个目录：缺了也不往里下载（免得下到别处去）
ASR_MODEL_PINNED = bool(os.environ.get("ASR_MODEL"))


def ensure_asr_runtime(auto=True):
    """保证 sherpa-onnx 能 import。缺了就 pip 装（装到 user site，不动系统）。"""
    try:
        import sherpa_onnx  # noqa: F401
        return True, ""
    except ImportError:
        pass
    if not auto:
        return False, ("没装 sherpa-onnx（pip install --user --break-system-packages "
                       "sherpa-onnx，或跑 sh .tea_agent_run/scripts/setup-sensevoice.sh）")
    print("[asr] 没装 sherpa-onnx，正在装（--user，不动系统包）…")
    cmd = [sys.executable, "-m", "pip", "install", "--user",
           "--break-system-packages", "sherpa-onnx"]
    try:
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL,
                       stderr=subprocess.STDOUT)
    except Exception as exc:
        return False, "装 sherpa-onnx 失败：%s" % exc
    try:
        import sherpa_onnx  # noqa: F401
        return True, ""
    except ImportError:
        return False, "装完还是 import 不到 sherpa-onnx"


def _download(url, dest):
    """下载文件。优先 curl（能断点续传），没有就用 urllib。"""
    if shutil.which("curl"):
        cmd = ["curl", "-L", "--fail", "-C", "-", "--max-time", "1800",
               "--connect-timeout", "20", "--speed-limit", "10240",
               "--speed-time", "30", "--retry", "3", "--retry-delay", "3",
               "--retry-all-errors", "-o", dest, url]
        subprocess.run(cmd, check=True)
        return
    import urllib.request
    with urllib.request.urlopen(url, timeout=120) as r, open(dest, "wb") as fh:
        while True:
            buf = r.read(1 << 20)
            if not buf:
                break
            fh.write(buf)


def _extract_tar(tarball, dest_dir):
    """解 .tar.bz2：有 tar 就用 tar，否则退回 Python 的 tarfile。"""
    if shutil.which("tar"):
        subprocess.run(["tar", "xjf", tarball, "-C", dest_dir], check=True)
        return
    import tarfile
    with tarfile.open(tarball, "r:bz2") as tf:
        tf.extractall(dest_dir)


def _tar_ok(tarball):
    if shutil.which("tar"):
        return subprocess.run(["tar", "tjf", tarball], stdout=subprocess.DEVNULL,
                              stderr=subprocess.DEVNULL).returncode == 0
    import tarfile
    try:
        with tarfile.open(tarball, "r:bz2"):
            return True
    except Exception:
        return False


def ensure_asr_model(auto=True):
    """保证 SenseVoice 模型在本地。缺了就从 GitHub releases 下载（158MB）。"""
    if (os.path.exists(os.path.join(ASR_MODEL_DIR, "model.int8.onnx"))
            and os.path.exists(os.path.join(ASR_MODEL_DIR, "tokens.txt"))):
        return ASR_MODEL_DIR
    if not auto:
        raise RuntimeError("没有本地 ASR 模型：%s" % ASR_MODEL_DIR)
    if ASR_MODEL_PINNED:
        raise RuntimeError("指定的模型目录里没有模型（ASR_MODEL / --model）：%s"
                           % ASR_MODEL_DIR)
    os.makedirs(ASR_BASE_DIR, exist_ok=True)
    tarball = os.path.join(ASR_BASE_DIR, "%s.tar.bz2" % ASR_MODEL_NAME)
    print("[asr] 没有本地 SenseVoice 模型，正在下载（约 158MB）…")
    print("[asr] %s" % ASR_MODEL_URL)
    # GitHub 的 release 资源经常「连上却不出数据」，所以**断点续传 + 重试**
    last = None
    for attempt in range(1, 4):
        try:
            _download(ASR_MODEL_URL, tarball)
            last = None
            break
        except Exception as exc:
            last = exc
            size = (os.path.getsize(tarball) // 1048576) if os.path.exists(tarball) else 0
            print("[asr] 第 %d 次下载中断（%s，已下 %dMB），续传…" % (attempt, exc, size))
            time.sleep(2)
    if last is not None:
        raise RuntimeError("模型下载失败（%s）：%s" % (last, ASR_MODEL_URL))
    # 完整性校验：tar 都读不出来就说明下坏了
    if not _tar_ok(tarball):
        try:
            os.remove(tarball)
        except OSError:
            pass
        raise RuntimeError("模型下载坏了（解包校验失败）：%s" % ASR_MODEL_URL)
    print("[asr] 解压中…")
    try:
        _extract_tar(tarball, ASR_BASE_DIR)
    except Exception as exc:
        raise RuntimeError("模型解压失败（%s）：%s" % (exc, ASR_MODEL_URL))
    finally:
        try:
            os.remove(tarball)
        except OSError:
            pass
    if not os.path.exists(os.path.join(ASR_MODEL_DIR, "model.int8.onnx")):
        raise RuntimeError("解压后还是找不到 model.int8.onnx：%s" % ASR_MODEL_DIR)
    print("[asr] 模型就绪：%s" % ASR_MODEL_DIR)
    return ASR_MODEL_DIR


def asr_status(auto=True):
    """能不能用本地 ASR。返回 (ok, 说明)。

    auto=True 时缺运行时/缺模型会**自动装/自动下载**；
    ASR_NO_DOWNLOAD=1 可强制关闭（离线用）。
    """
    if os.environ.get("ASR_NO_DOWNLOAD") == "1":
        auto = False
    ok, why = ensure_asr_runtime(auto=auto)
    if not ok:
        return False, why
    try:
        ensure_asr_model(auto=auto)
    except Exception as exc:
        return False, str(exc)
    return True, ASR_MODEL_DIR


def make_asr(threads=None):
    import sherpa_onnx
    threads = threads or max(1, (os.cpu_count() or 4) // 2)
    return sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=os.path.join(ASR_MODEL_DIR, "model.int8.onnx"),
        tokens=os.path.join(ASR_MODEL_DIR, "tokens.txt"),
        num_threads=threads, use_itn=True, debug=False)


def extract_audio(media, dest_wav):
    """从媒体文件提取音频，转成 16k 单声道 wav（模型要这个格式）。"""
    if os.path.exists(dest_wav) and os.path.getsize(dest_wav) > 1024:
        return dest_wav
    if not shutil.which("ffmpeg"):
        raise RuntimeError("没装 ffmpeg，提不出音频")
    os.makedirs(os.path.dirname(os.path.abspath(dest_wav)) or ".", exist_ok=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", media,
                    "-vn", "-ar", "16000", "-ac", "1", dest_wav],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not os.path.exists(dest_wav):
        raise RuntimeError("提取 wav 失败")
    return dest_wav


# ---------------------------------------------------------------------------
# 解码内核：切块 → 逐块送模型
# ---------------------------------------------------------------------------

def _read_wav16k(wav):
    """读 16k 单声道 16bit wav。返回 (采样率, float32 波形)。"""
    import wave
    import numpy as np

    with wave.open(wav, "rb") as wf:
        sr = wf.getframerate()
        n = wf.getnframes()
        raw = wf.readframes(n)
    pcm = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    return sr, pcm


def _chunk_spans(total, chunk):
    """把音频切成 [(起, 止)]。

    chunk=0 表示整段一起送；否则按 chunk 秒切块，每块留 1 秒重叠
    （SenseVoice 官方按 ≤30 秒窗口训练，切块更稳）。
    """
    if chunk and chunk > 0 and total > chunk * 1.5:
        step = max(1, int(chunk - 1.0))
        starts = list(range(0, int(total), step))
    else:
        starts = [0]
    spans = []
    for st in starts:
        en = (st + chunk) if chunk else total
        spans.append((float(st), float(min(en, total))))
    return spans


def _decode_chunks(wav, chunk=60, threads=None, progress=True):
    """切块解码。返回 (结果列表, 音频总长秒)。

    每个结果：(块起始秒, 块结束秒, 文本, tokens, timestamps)。
    tokens/timestamps 是 token 级的（sherpa-onnx 的 result.tokens / result.timestamps），
    用来把「一句话」定位到具体的时间点上。
    """
    sr, pcm = _read_wav16k(wav)
    rec = make_asr(threads)
    total = len(pcm) / float(sr)
    spans = _chunk_spans(total, chunk)
    out = []
    for i, (st, en) in enumerate(spans, 1):
        a = int(st * sr)
        b = int(en * sr)
        seg = pcm[a:b]
        if len(seg) < sr // 2:
            break
        stream = rec.create_stream()
        stream.accept_waveform(sr, seg)
        rec.decode_stream(stream)
        res = stream.result
        txt = (res.text or "").strip()
        tokens = list(getattr(res, "tokens", None) or [])
        stamps = list(getattr(res, "timestamps", None) or [])
        out.append((st, en, txt, tokens, stamps))
        if progress and len(spans) > 1:
            print("    asr %d/%d 块（%ds）" % (i, len(spans), round(en)), end="\r")
    if progress and len(spans) > 1:
        print(" " * 40, end="\r")
    return out, total


def asr_transcribe(wav, chunk=60, threads=None, progress=True):
    """本地转写。返回 [(起始秒, 文本)]。

    chunk=0 表示整段一起送（长视频会慢）；默认按 60 秒切块，
    每块留 1 秒重叠（SenseVoice 官方按 ≤30 秒窗口训练，切块更稳）。
    """
    chunks, _total = _decode_chunks(wav, chunk=chunk, threads=threads,
                                     progress=progress)
    return [(round(st, 1), txt) for st, en, txt, _tk, _ts in chunks if txt]


# ---------------------------------------------------------------------------
# 分段（带起止时间）
# ---------------------------------------------------------------------------

# SenseVoice 的输出**不带标点**，所以「一句话」只能靠时间/字数切。
# （万一哪天模型开始输出标点了，这里也能顺手用上。）
PUNCT = "，。？！；：、,.!?;:…"


def _group_tokens(tokens, stamps, max_secs=12.0, max_chars=40, min_ts=0.0):
    """把 token 流切成一段段。返回 [(起, 止, 文本)]（相对块起点）。

    - 结束时间：下一个 token 的开始时间；最后一个按中位步长估
    - 切段条件：到标点 / 超过 max_secs / 超过 max_chars
    - min_ts：早于这个时刻的 token 直接丢掉（用来去掉块与块的重叠）
    """
    if not tokens or not stamps:
        return []
    n = min(len(tokens), len(stamps))
    toks, ts = [], []
    for i in range(n):
        t = tokens[i]
        if not t or t.startswith("<|") or t.startswith("<"):  # 特殊标记
            continue
        if float(stamps[i]) < min_ts:
            continue
        toks.append(t)
        ts.append(float(stamps[i]))
    if not toks:
        return []
    deltas = [ts[i + 1] - ts[i] for i in range(len(ts) - 1) if ts[i + 1] > ts[i]]
    step = sorted(deltas)[len(deltas) // 2] if deltas else 0.2
    ends = [ts[i + 1] if i + 1 < len(ts) else ts[i] + step for i in range(len(ts))]

    groups = []
    buf, gstart, gend = [], None, None
    for i, t in enumerate(toks):
        buf.append(t)
        if gstart is None:
            gstart = ts[i]
        gend = ends[i]
        text = "".join(buf).strip()
        closed = False
        if text and text[-1] in PUNCT:
            closed = True
        elif max_secs and (gend - gstart) >= max_secs:
            closed = True
        elif max_chars and len(text) >= max_chars:
            closed = True
        if closed:
            groups.append((gstart, gend, text))
            buf, gstart, gend = [], None, None
    if buf and "".join(buf).strip():
        groups.append((gstart, gend, "".join(buf).strip()))
    return groups


def _trim_overlap(spans):
    """保险丝：万一还有重叠，就把后一段的起点推到前一段的终点。

    （块重叠的**文本**重复在 asr_transcribe_spans 里按时间裁掉了。）
    """
    out = []
    for start, end, text in spans:
        text = (text or "").strip()
        if out and start < out[-1][1] - 0.01:
            start = out[-1][1]
        if text:
            out.append((start, max(start, end), text))
    return out


def asr_transcribe_spans(wav, chunk=60, threads=None, progress=True,
                          max_secs=12.0, max_chars=40):
    """本地转写（带起止时间）。返回 [(起始秒, 结束秒, 文本)]。

    跟 asr_transcribe 的区别：asr_transcribe 的时间是**块起点**（粗），
    这里用 token 级时间戳把每句话卡到具体区间（细），适合拿去做字幕/音轨标签。
    max_secs / max_chars 控制一句话最长多少秒 / 多少字（0 = 不限）。
    """
    chunks, _total = _decode_chunks(wav, chunk=chunk, threads=threads,
                                     progress=progress)
    spans = []
    prev_audio_end = 0.0
    for st, en, txt, tokens, stamps in chunks:
        if not txt:
            continue
        # 块与块之间有 1 秒重叠，那段音频会被转写两遍 → 按时间把重叠区丢掉
        cut = max(0.0, prev_audio_end - st)
        groups = _group_tokens(tokens, stamps, max_secs=max_secs,
                               max_chars=max_chars, min_ts=cut)
        prev_audio_end = en
        if not groups:
            # 没有 token 时间戳（老版本 sherpa-onnx）→ 整块当一句
            spans.append((round(st, 2), round(min(en, st + (max_secs or 5.0)), 2), txt))
            continue
        for gs, ge, gtext in groups:
            spans.append((round(st + gs, 2), round(min(st + ge, en), 2), gtext))
    return _trim_overlap(spans)


def asr_to_text(pieces):
    return "\n".join("[%s] %s" % (fmt_time(t), x) for t, x in pieces)


def fmt_time(sec):
    sec = int(sec)
    return "%02d:%02d" % (sec // 60, sec % 60)


def transcribe_media(media, dest_wav, chunk=60, progress=True):
    """一步到位：媒体 → (wav 路径, [(起始秒, 文本)])。"""
    wav = extract_audio(media, dest_wav)
    return wav, asr_transcribe(wav, chunk=chunk, progress=progress)


# ---------------------------------------------------------------------------
# 输出格式
# ---------------------------------------------------------------------------

FORMATS = ("text", "audacity", "srt", "vtt", "json")
# 顺手认几个别名
FORMAT_ALIAS = {
    "label": "audacity", "labels": "audacity", "audacity-label": "audacity",
    "subtitle": "srt", "webvtt": "vtt",
}
# --output 给文件名时，按扩展名猜格式（Audacity 的标签文件就是 .txt）
EXT_FORMAT = {
    ".srt": "srt", ".vtt": "vtt", ".json": "json",
    ".txt": "audacity", ".labels": "audacity", ".audacity": "audacity",
    ".tsv": "audacity", ".md": "text",
}


def _flat(text):
    """压成一行（标签/字幕里不能有换行和 tab）。"""
    return " ".join(str(text).split())


def spans_to_audacity(spans):
    """Audacity 标签文件：每行 `起始秒\\t结束秒\\t文本`（秒，tab 分隔）。

    Audacity 里 File → Import → Labels，选这个文件就能把标签贴到音轨上。
    """
    lines = []
    for start, end, text in spans:
        text = _flat(text)
        if not text:
            continue
        start = max(0.0, float(start))
        end = max(start, float(end))
        lines.append("%.3f\t%.3f\t%s" % (start, end, text))
    return "\n".join(lines) + ("\n" if lines else "")


def spans_to_text(spans):
    """逐字稿（终端友好）：[mm:ss] 文本"""
    return "\n".join("[%s] %s" % (fmt_time(s), _flat(t)) for s, e, t in spans)


def _srt_time(sec):
    ms = int(round(float(sec) * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return "%02d:%02d:%02d,%03d" % (h, m, s, ms)


def _vtt_time(sec):
    return _srt_time(sec).replace(",", ".")


def spans_to_srt(spans):
    """SRT 字幕。"""
    out = []
    for i, (start, end, text) in enumerate(spans, 1):
        out.append("%d\n%s --> %s\n%s\n" % (i, _srt_time(start), _srt_time(end),
                                           _flat(text)))
    return "\n".join(out)


def spans_to_vtt(spans):
    """WebVTT 字幕。"""
    out = ["WEBVTT", ""]
    for start, end, text in spans:
        out.append("%s --> %s\n%s\n" % (_vtt_time(start), _vtt_time(end),
                                       _flat(text)))
    return "\n".join(out)


def spans_to_json(spans, extra=None):
    """JSON（带 start/end/text）。"""
    obj = {"segments": [{"start": round(float(s), 3),
                         "end": round(float(e), 3),
                         "text": _flat(t)} for s, e, t in spans]}
    if extra:
        obj.update(extra)
    return json.dumps(obj, ensure_ascii=False, indent=2)


def spans_to_format(spans, fmt, extra=None):
    """按名字出内容。"""
    fmt = (fmt or "text").lower()
    if fmt == "audacity":
        return spans_to_audacity(spans)
    if fmt == "srt":
        return spans_to_srt(spans)
    if fmt == "vtt":
        return spans_to_vtt(spans)
    if fmt == "json":
        return spans_to_json(spans, extra)
    return spans_to_text(spans)


# ---------------------------------------------------------------------------
# 命令行
# ---------------------------------------------------------------------------

def _resolve_output(value):
    """--output 既能是格式名，也能是文件名。返回 (格式, 输出路径或 None)。"""
    if not value:
        return "text", None
    v = str(value).strip()
    if v.lower() in FORMATS:
        return v.lower(), None
    if v.lower() in FORMAT_ALIAS:
        return FORMAT_ALIAS[v.lower()], None
    ext = os.path.splitext(v)[1].lower()
    fmt = EXT_FORMAT.get(ext)
    if fmt:
        return fmt, v
    raise SystemExit("[asr] --output 看不懂：%s（格式：%s；也可以直接给文件名，"
                     "如 out.txt / out.srt / out.vtt / out.json）"
                     % (value, "/".join(FORMATS)))


def _is_16k_mono_wav(path):
    import wave
    try:
        with wave.open(path, "rb") as wf:
            return (wf.getframerate() == 16000 and wf.getnchannels() == 1
                    and wf.getsampwidth() == 2)
    except Exception:
        return False


def prepare_wav(src):
    """保证拿到 16k 单声道 16bit wav。返回 (wav 路径, 是不是临时文件)。"""
    if os.path.exists(src) and _is_16k_mono_wav(src):
        return src, False
    if not shutil.which("ffmpeg"):
        raise SystemExit("[asr] %s 不是 16k 单声道 wav，又没装 ffmpeg，转不了" % src)
    tmpdir = os.path.join(tempfile.gettempdir(), "sensevoice")
    os.makedirs(tmpdir, exist_ok=True)
    base = os.path.splitext(os.path.basename(src))[0] or "audio"
    dest = os.path.join(tmpdir, base + ".16k.wav")
    print("[asr] 转成 16k 单声道 wav：%s" % dest)
    try:
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-vn",
                        "-ar", "16000", "-ac", "1", "-sample_fmt", "s16", dest],
                       check=True, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL)
    except subprocess.CalledProcessError as exc:
        raise SystemExit("[asr] ffmpeg 转码失败（%s）：%s" % (src, exc))
    return dest, True


def _print_status():
    try:
        import sherpa_onnx
        rt = "sherpa-onnx %s（已装）" % (getattr(sherpa_onnx, "__version__", "?"))
    except ImportError:
        rt = "sherpa-onnx 没装"
    has = os.path.exists(os.path.join(ASR_MODEL_DIR, "model.int8.onnx"))
    print("[asr] 运行时：%s" % rt)
    print("[asr] 模型目录：%s（%s）" % (ASR_MODEL_DIR, "就绪" if has else "缺"))
    print("[asr] 模型根目录：%s" % ASR_BASE_DIR)
    print("[asr] 下载地址：%s" % ASR_MODEL_URL)
    if not has:
        print("[asr] 缺模型的话跑一句 `python shared/sensevoice.py --download`")
    return has


def _download_all(force=False):
    """装运行时 + 下模型。"""
    ok, why = ensure_asr_runtime(auto=True)
    if not ok:
        raise SystemExit("[asr] %s" % why)
    if force:
        if os.path.isdir(ASR_MODEL_DIR):
            print("[asr] --force：删掉旧模型 %s" % ASR_MODEL_DIR)
            shutil.rmtree(ASR_MODEL_DIR, ignore_errors=True)
        tarball = os.path.join(ASR_BASE_DIR, "%s.tar.bz2" % ASR_MODEL_NAME)
        if os.path.exists(tarball):
            os.remove(tarball)
    if ASR_MODEL_PINNED and not os.path.exists(
            os.path.join(ASR_MODEL_DIR, "model.int8.onnx")):
        raise SystemExit("[asr] --model 指定的目录里没有模型，自动下载只认 %s"
                         % ASR_MODEL_DIR)
    ensure_asr_model(auto=True)
    print("[asr] 都就绪了：%s" % ASR_MODEL_DIR)


def _build_parser():
    ap = argparse.ArgumentParser(
        prog="sensevoice.py",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        description="本地语音识别（SenseVoice Small / ONNX int8 / sherpa-onnx），"
                    "完全离线、不联网。",
        epilog="""示例：
  python shared/sensevoice.py --download                     # 只装运行时 + 下模型（158MB）
  python shared/sensevoice.py --status                       # 看状态
  python shared/sensevoice.py --wav a.wav                    # 逐字稿打到屏幕
  python shared/sensevoice.py --wav a.wav --output audacity  # Audacity 标签（导入音轨）
  python shared/sensevoice.py --wav a.wav --output audacity --out a.txt
  python shared/sensevoice.py a.mp4 --output srt --out a.srt # 别的媒体也能转
""")
    ap.add_argument("audio", nargs="?", default=None,
                    help="音频/媒体文件（等价于 --wav）")
    ap.add_argument("--wav", "--input", "--audio-file", dest="wav", default=None,
                    help="要转写的 wav（其它格式会自动转 16k 单声道）")
    ap.add_argument("--output", "-o", default="text",
                    help="输出格式：text|audacity|srt|vtt|json（也可以直接给文件名）")
    ap.add_argument("--format", default=None,
                    help="输出格式（覆盖 --output 的推断）")
    ap.add_argument("--out", default=None,
                    help="输出写到哪个文件（默认打印到屏幕）")
    ap.add_argument("--chunk", type=float, default=60,
                    help="切块秒数（0 = 整段一起送）")
    ap.add_argument("--threads", type=int, default=None,
                    help="解码线程数（默认 CPU 核数的一半）")
    ap.add_argument("--seg-max", type=float, default=12.0,
                    help="单条标签最长多少秒（0 = 不限）")
    ap.add_argument("--seg-chars", type=int, default=40,
                    help="单条标签最多多少字（0 = 不限）")
    ap.add_argument("--download", action="store_true",
                    help="装运行时 + 下模型（不指定音频时只干这个就退出）")
    ap.add_argument("--force", action="store_true",
                    help="配合 --download：删掉旧模型重新下")
    ap.add_argument("--status", action="store_true",
                    help="只打印状态（运行时/模型/路径）")
    ap.add_argument("--no-download", action="store_true",
                    help="缺运行时/模型也不自动装/下载（离线用）")
    ap.add_argument("--model", default=None,
                    help="模型目录（含 model.int8.onnx）")
    ap.add_argument("--base", default=None,
                    help="模型根目录（下载解压到这儿）")
    ap.add_argument("--url", default=None,
                    help="模型下载地址（换源用）")
    ap.add_argument("--keep-temp", action="store_true",
                    help="转码出来的临时 wav 不删")
    ap.add_argument("--quiet", "-q", action="store_true",
                    help="不要进度条")
    return ap


def main(argv=None):
    global ASR_BASE_DIR, ASR_MODEL_DIR, ASR_MODEL_URL, ASR_MODEL_PINNED

    args = _build_parser().parse_args(argv)

    # ---- 模型路径覆盖（命令行 > 环境变量 > 默认）----
    if args.base:
        ASR_BASE_DIR = os.path.abspath(os.path.expanduser(args.base))
        ASR_MODEL_DIR = os.path.join(ASR_BASE_DIR, ASR_MODEL_NAME)
        ASR_MODEL_PINNED = False
    if args.model:
        ASR_MODEL_DIR = os.path.abspath(os.path.expanduser(args.model))
        ASR_MODEL_PINNED = True
    if args.url:
        ASR_MODEL_URL = args.url

    # ---- 输出格式 / 输出路径 ----
    if args.format:
        fmt = args.format.strip().lower()
        fmt = FORMAT_ALIAS.get(fmt, fmt)
        if fmt not in FORMATS:
            raise SystemExit("[asr] --format 不认识：%s（可用：%s）"
                             % (args.format, "/".join(FORMATS)))
        out_path = args.out
    else:
        fmt, out_path = _resolve_output(args.output)
        if args.out:
            out_path = args.out

    audio = args.wav or args.audio

    # 状态/下载这类输出走 stderr，别把 stdout 弄脏（stdout 要留给结果）
    real_stdout = sys.stdout
    with contextlib.redirect_stdout(sys.stderr):
        if args.download:
            _download_all(force=args.force)
            if not audio:
                return 0
        if args.status:
            _print_status()
            if not audio:
                return 0
        if not audio:
            with contextlib.redirect_stdout(real_stdout):
                _build_parser().print_help()
            return 0
        if not os.path.exists(audio):
            raise SystemExit("[asr] 找不到文件：%s" % audio)

        ok, why = asr_status(auto=not args.no_download)
        if not ok:
            raise SystemExit("[asr] 用不了：%s" % why)

        wav, is_tmp = prepare_wav(audio)
        t0 = time.time()
        spans = asr_transcribe_spans(wav, chunk=args.chunk,
                                     threads=args.threads,
                                     progress=not args.quiet,
                                     max_secs=args.seg_max,
                                     max_chars=args.seg_chars)
        dt = time.time() - t0
        dur = 0.0
        try:
            import wave as _wave
            with _wave.open(wav, "rb") as wf:
                dur = wf.getnframes() / float(wf.getframerate())
        except Exception:
            pass
        rtf = (dur / dt) if dt > 0 else 0.0
        print("[asr] %d 段 / 音频 %.1f 秒 / 用时 %.1f 秒（%.1f 倍实时）"
              % (len(spans), dur, dt, rtf))

        content = spans_to_format(spans, fmt, {"audio": os.path.abspath(audio)})

        if out_path:
            parent = os.path.dirname(os.path.abspath(out_path))
            if parent:
                os.makedirs(parent, exist_ok=True)
            with open(out_path, "w", encoding="utf-8") as fh:
                fh.write(content)
            print("[asr] 写了 %d 条 → %s" % (len(spans), out_path))
        else:
            real_stdout.write(content)
            if content and not content.endswith("\n"):
                real_stdout.write("\n")
            real_stdout.flush()

        if is_tmp and not args.keep_temp:
            try:
                os.remove(wav)
            except OSError:
                pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
