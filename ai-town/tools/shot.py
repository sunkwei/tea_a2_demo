"""给 UI 拍一张截图（需要 Pillow）。

走的是真实路径：bootstrap 与 LLM 行动都在后台线程里跑，主线程持续泵事件，
这样窗口保持响应，截图才是活的。
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.stdout.reconfigure(encoding="utf-8")

from PIL import ImageGrab

from ai_town.ui.app import TownApp


def pump(app, timeout=180):
    t0 = time.time()
    while app.busy and time.time() - t0 < timeout:
        app.update()
        time.sleep(0.05)
    for _ in range(10):
        app.update()
        time.sleep(0.02)
    return time.time() - t0


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "ui_shot.png"
    offline = "--online" not in sys.argv
    app = TownApp(seed=20241103, name="临溪镇", offline=offline, autostart=False)
    app.deiconify()
    app.lift()
    app.attributes("-topmost", True)
    app.update()
    time.sleep(0.6)

    app._start()
    print("bootstrap 用时 %.1fs" % pump(app), flush=True)

    app.entry.insert(0, "我想去井台看看那封没有署名的信")
    app._on_action()
    print("行动用时 %.1fs" % pump(app), flush=True)

    app.update_idletasks()
    app.update()
    time.sleep(0.4)
    app.update()

    x, y = app.winfo_rootx(), app.winfo_rooty()
    w, h = app.winfo_width(), app.winfo_height()
    img = ImageGrab.grab(bbox=(x, y, x + w, y + h))
    img.save(out)
    print("saved", out, img.size, "| 标题：", app.lbl_town.cget("text"))
    app.destroy()


if __name__ == "__main__":
    main()
