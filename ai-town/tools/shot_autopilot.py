"""给「AI 托管」模式拍一张截图。"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.stdout.reconfigure(encoding="utf-8")

from PIL import ImageGrab

from ai_town.ui.app import TownApp


def pump(app, timeout=1.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        app.update()
        time.sleep(0.03)
    app.update()


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "ai_host.png"
    app = TownApp(seed=8888, name="临溪镇", offline=True, autostart=False)
    app.deiconify()
    app.lift()
    app.attributes("-topmost", True)
    app.geometry("1320x760+20+20")
    app.update()
    time.sleep(0.4)

    app.game.bootstrap()
    app._on_booted(None)
    app.update()

    app._toggle_autopilot()
    for _ in range(8):
        pump(app, timeout=0.8)
    app.update()
    time.sleep(0.3)
    app.update()

    x, y = app.winfo_rootx(), app.winfo_rooty()
    w, h = app.winfo_width(), app.winfo_height()
    img = ImageGrab.grab(bbox=(x, y, x + w, y + h))
    img.save(out)
    print("saved", out, img.size, "| 托管中：", app.autopilot_mode, "| 第", app.game.state.day, "天", flush=True)
    app.destroy()


if __name__ == "__main__":
    main()
