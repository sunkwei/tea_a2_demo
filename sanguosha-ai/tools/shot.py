"""给图形界面截图（无头验证用）。

用法： python tools/shot.py --wait 60 --out ui.png
注意：本机是 175% 缩放，Tk 报的是逻辑像素、PIL 抓的是物理像素，要按比例换算。
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from PIL import ImageGrab

from sanguosha_ai.config import load_game_config
from sanguosha_ai.ui.app import GameApp


def grab(win, path: str) -> None:
    win.attributes("-topmost", True)
    win.update_idletasks()
    win.update()
    time.sleep(0.4)
    win.update()
    img = ImageGrab.grab()
    sx = img.width / max(1, win.winfo_screenwidth())
    sy = img.height / max(1, win.winfo_screenheight())
    x = win.winfo_rootx()
    y = win.winfo_rooty()
    w = win.winfo_width()
    h = win.winfo_height()
    box = (int(x * sx), int(y * sy), int((x + w) * sx), int((y + h) * sy))
    img.crop(box).save(path)
    print(f"saved {path} {box}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--wait", type=int, default=60, help="等待多少秒后再截图")
    ap.add_argument("--out", default="sanguosha_ui.png")
    ap.add_argument("--max-turns", type=int, default=40)
    ap.add_argument("--seed", type=int, default=20261105)
    ap.add_argument("--speed", type=float, default=3.0)
    args = ap.parse_args()

    cfg = load_game_config()
    cfg.seed = args.seed
    cfg.max_turns = args.max_turns
    app = GameApp(cfg)
    app.speed.set(args.speed)
    app.auto_next.set(False)
    app.update()

    end = time.time() + args.wait
    while time.time() < end:
        app.update()
        time.sleep(0.05)
    grab(app, args.out)


if __name__ == "__main__":
    main()
