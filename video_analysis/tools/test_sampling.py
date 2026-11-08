# -*- coding: utf-8 -*-
"""抽帧间隔规划的单元检查。"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from video_analysis import plan_sampling   # noqa: E402

cases = [(46, 8), (600, 15), (130, 10), (3600, 15), (20, 15), (9, 15),
         (95, 10), (600, 60)]
ok = True
for d, i in cases:
    step, sheets = plan_sampling(d, i, 9, 12, 24, True)
    per = 9
    cells = sheets * per
    # 帧落在 0, step, ...  最后要够铺满且不超过时长
    last = (cells - 1) * step
    good = last < d and cells >= 1
    ok = ok and good
    print("dur=%-6s interval=%-4s → step=%-4s sheets=%-3s cells=%-4s last_frame=%-6s %s"
          % (d, i, step, sheets, cells, last, "OK" if good else "BAD"))

for d, i in cases:
    step, n = plan_sampling(d, i, 9, 12, 24, False)
    last = (n - 1) * step
    good = last < d
    ok = ok and good
    print("[单帧] dur=%-6s interval=%-4s → step=%-4s frames=%-3s last=%-6s %s"
          % (d, i, step, n, last, "OK" if good else "BAD"))

print("ALL OK" if ok else "HAS BAD CASE")
sys.exit(0 if ok else 1)
