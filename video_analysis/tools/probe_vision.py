# -*- coding: utf-8 -*-
"""单独验证识图：拿一张拼图，分别试各个 vision provider。"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "video_analysis"))

import video_analysis as va   # noqa: E402

img = sys.argv[1] if len(sys.argv) > 1 else None
if not img:
    print("用法: probe_vision.py <拼图.jpg>")
    sys.exit(1)

prompt = ("这是一个本地视频的连续画面截图拼图（3x3 一张图，每格左上角的时间戳"
          "就是它在视频里的位置）。请按时间顺序描述画面里出现了什么"
          "（人物、场景、画面上的文字），最后用一句话概括这一段。")

for pname, model in va.vision_candidates(type("A", (), {
    "vision_provider": None, "vision_model": None})()):
    try:
        _n, prov, mname = va.llm.pick_provider(pname, model)
        txt = va.vision_chat(prov, mname, prompt, [img], max_tokens=6000)
        print("== %s/%s → %d 字" % (pname, mname, len(txt)))
        print(txt[:400].replace("\n", " "))
        print()
    except Exception as exc:
        print("== %s/%s 失败: %s" % (pname, model, str(exc)[:200]))
