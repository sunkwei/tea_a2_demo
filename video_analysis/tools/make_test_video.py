#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""造一个带中文语音的测试视频（用来验证 video_analysis 的全链路）。

    python3 video_analysis/tools/make_test_video.py [输出路径]

做法：
  1. 用 Windows SAPI（Microsoft Huihui Desktop）把一段中文说明合成 wav
  2. ffmpeg 做三张「幻灯片」当画面（drawtext + enable 分段显示）
  3. 合成 mp4：画面 + 中文语音
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = r"C:\Windows\Fonts\msyh.ttc"

SPEECH = ("大家好，今天我们演示一个本地视频分析工具。它会做三件事。"
          "第一步，把视频按固定间隔抽帧，拼成带时间戳的大图，交给视觉模型理解画面。"
          "第二步，用本地部署的语音识别模型，把视频里说的话转成文字。"
          "第三步，把语音转写和画面描述一起交给大模型，生成一份完整的分析报告。"
          "这样整个过程既不需要上传视频，也不需要联网，隐私和安全都更有保障。")

SLIDES = [
    ("第一步", "抽帧拼图 交给视觉模型"),
    ("第二步", "本地语音识别 转成文字"),
    ("第三步", "交给大模型 生成分析报告"),
]


def synth_speech(wav, text=SPEECH):
    """Windows SAPI 合成中文语音。"""
    ps = os.path.join(os.path.dirname(wav), "_tts.ps1")
    with open(ps, "w", encoding="utf-8-sig") as fh:      # BOM：PS 5.1 才认 UTF-8
        fh.write(
            "$ErrorActionPreference='Stop'\n"
            "Add-Type -AssemblyName System.Speech\n"
            "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer\n"
            "$s.SelectVoice('Microsoft Huihui Desktop')\n"
            "$s.Rate = -1\n"
            "$s.SetOutputToWaveFile('%s')\n"
            "$t = [System.IO.File]::ReadAllText('%s', [System.Text.Encoding]::UTF8)\n"
            "$s.Speak($t)\n"
            "$s.Dispose()\n" % (wav.replace("\\", "\\\\"),
                                os.path.join(os.path.dirname(wav), "_speech.txt")
                                .replace("\\", "\\\\")))
    with open(os.path.join(os.path.dirname(wav), "_speech.txt"), "w",
              encoding="utf-8") as fh:
        fh.write(text)
    r = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
                        "-File", ps], capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(wav):
        raise SystemExit("TTS 失败：%s%s" % (r.stdout[-300:], r.stderr[-500:]))
    return wav


def audio_duration(path):
    r = subprocess.run(["ffprobe", "-v", "quiet", "-print_format", "json",
                        "-show_format", path], capture_output=True, text=True)
    import json
    return float(json.loads(r.stdout)["format"]["duration"])


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "test_video.mp4")
    out = os.path.abspath(out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    wav = os.path.splitext(out)[0] + "_speech.wav"
    print("[tts] 合成中文语音…")
    synth_speech(wav)
    dur = audio_duration(wav)
    print("[tts] 语音 %0.1fs" % dur)

    # 三张幻灯片，按时间平分
    step = dur / len(SLIDES)
    fonts = []
    for i, (head, body) in enumerate(SLIDES):
        t0, t1 = i * step, (i + 1) * step
        fp = FONT.replace("\\", "/").replace(":", "\\:")
        fonts.append(
            "drawtext=fontfile='%s':text='%s':fontcolor=white:fontsize=64"
            ":x=(w-text_w)/2:y=(h/2-120):enable='between(t\\,%s\\,%s)'" %
            (fp, head, t0, t1))
        fonts.append(
            "drawtext=fontfile='%s':text='%s':fontcolor=0xffe0a0:fontsize=44"
            ":x=(w-text_w)/2:y=(h/2+20):enable='between(t\\,%s\\,%s)'" %
            (fp, body, t0, t1))
    bg = ["0x1f4e79", "0x7d3c0d", "0x145a32"]
    vf = ",".join(fonts)
    # 背景色随时间换：分段 color 源 + concat 太麻烦，这里用一条渐变式背景 + 色块
    vf = ("drawtext=fontfile='%s':text='':fontcolor=white:fontsize=1"
          ":x=0:y=0:enable='gte(t\\,0)'," % FONT.replace("\\", "/").replace(":", "\\:")) + vf

    cmd = ["ffmpeg", "-y", "-loglevel", "error",
           "-f", "lavfi", "-i", "color=c=%s:s=1280x720:r=25:d=%0.2f" % (bg[0], dur),
           "-i", wav,
           "-vf", vf,
           "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "25",
           "-c:a", "aac", "-b:a", "128k", "-shortest", out]
    print("[ffmpeg] 合成画面 + 语音…")
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit("ffmpeg 失败：%s" % (r.stderr or "")[-600:])
    print("[ok] %s（%0.1fs）" % (out, dur))
    for f in ("_tts.ps1", "_speech.txt"):
        p = os.path.join(os.path.dirname(wav), f)
        if os.path.exists(p):
            os.remove(p)


if __name__ == "__main__":
    main()
