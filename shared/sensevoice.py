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
"""
import os
import shutil
import subprocess
import sys
import time

ASR_MODEL_NAME = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09"
ASR_BASE_DIR = os.environ.get("ASR_BASE") or os.path.expanduser("~/models/sherpa-onnx")
# ASR_MODEL 可以直接指到含 model.int8.onnx 的那个目录
ASR_MODEL_DIR = os.environ.get("ASR_MODEL") or os.path.join(ASR_BASE_DIR, ASR_MODEL_NAME)
ASR_MODEL_URL = os.environ.get("ASR_MODEL_URL") or (
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/"
    "%s.tar.bz2" % ASR_MODEL_NAME)


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
    if os.environ.get("ASR_MODEL"):
        raise RuntimeError("ASR_MODEL=%s 指向的目录里没有模型" % ASR_MODEL_DIR)
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


def asr_transcribe(wav, chunk=60, threads=None, progress=True):
    """本地转写。返回 [(起始秒, 文本)]。

    chunk=0 表示整段一起送（长视频会慢）；默认按 60 秒切块，
    每块留 1 秒重叠（SenseVoice 官方按 ≤30 秒窗口训练，切块更稳）。
    """
    import wave
    import numpy as np

    with wave.open(wav, "rb") as wf:
        sr = wf.getframerate()
        n = wf.getnframes()
        raw = wf.readframes(n)
    pcm = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    rec = make_asr(threads)
    total = len(pcm) / float(sr)
    pieces = []

    if chunk and chunk > 0 and total > chunk * 1.5:
        step = chunk - 1.0
        starts = list(range(0, int(total), int(step)))
    else:
        starts = [0]

    for i, st in enumerate(starts, 1):
        a = int(st * sr)
        b = int((st + chunk) * sr) if chunk else len(pcm)
        seg = pcm[a:b]
        if len(seg) < sr // 2:
            break
        stream = rec.create_stream()
        stream.accept_waveform(sr, seg)
        rec.decode_stream(stream)
        txt = (stream.result.text or "").strip()
        if txt:
            pieces.append((round(st, 1), txt))
        if progress and len(starts) > 1:
            print("    asr %d/%d 块（%ds）" % (i, len(starts), round(st + chunk)), end="\r")
    if progress and len(starts) > 1:
        print(" " * 40, end="\r")
    return pieces


def asr_to_text(pieces):
    return "\n".join("[%s] %s" % (fmt_time(t), x) for t, x in pieces)


def fmt_time(sec):
    sec = int(sec)
    return "%02d:%02d" % (sec // 60, sec % 60)


def transcribe_media(media, dest_wav, chunk=60, progress=True):
    """一步到位：媒体 → (wav 路径, [(起始秒, 文本)])。"""
    wav = extract_audio(media, dest_wav)
    return wav, asr_transcribe(wav, chunk=chunk, progress=progress)
