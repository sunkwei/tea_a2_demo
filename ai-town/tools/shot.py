"""给 UI 拍一张截图（需要 Pillow）。

走的是真实路径：bootstrap 与 LLM 行动都在后台线程里跑，主线程持续泵事件，
这样窗口保持响应，截图才是活的。

注意 DPI：Windows 开了缩放（本机 175%）时，Tk 报的是逻辑像素，
而 PIL.ImageGrab 抓的是物理像素，直接按 Tk 坐标抓会只截到窗口左边 57%。
这里自动算缩放比再抓。
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.stdout.reconfigure(encoding="utf-8")

from PIL import ImageGrab

from ai_town.ui.app import TownApp

#: 右栏页签序号：0 人物 / 1 档案 / 2 今日事件 / 3 市场 / 4 建筑 / 5 主线 / 6 镇志
TAB_INDEX = {"people": 0, "profile": 1, "events": 2, "market": 3,
             "build": 4, "quest": 5, "log": 6}


def screen_scale(app):
    """物理像素 / 逻辑像素 的比例（DPI 缩放）。"""
    try:
        full = ImageGrab.grab()
        sx = full.size[0] / float(max(1, app.winfo_screenwidth()))
        sy = full.size[1] / float(max(1, app.winfo_screenheight()))
        if 0.5 <= sx <= 4 and 0.5 <= sy <= 4:
            return sx, sy
    except Exception:
        pass
    return 1.0, 1.0


def pump(app, timeout=180):
    t0 = time.time()
    while app.busy and time.time() - t0 < timeout:
        app.update()
        time.sleep(0.05)
    for _ in range(10):
        app.update()
        time.sleep(0.02)
    return time.time() - t0


def grab(app, out):
    app.update_idletasks()
    app.update()
    time.sleep(0.4)
    app.update()
    sx, sy = screen_scale(app)
    x, y = app.winfo_rootx(), app.winfo_rooty()
    w, h = app.winfo_width(), app.winfo_height()
    bbox = (int(x * sx), int(y * sy), int((x + w) * sx), int((y + h) * sy))
    img = ImageGrab.grab(bbox=bbox)
    img.save(out)
    print("saved", out, img.size, "| 缩放", round(sx, 2), "| 标题：", app.lbl_town.cget("text"))
    return img


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "ui_shot.png"
    tab = None
    for arg in sys.argv[2:]:
        if arg.startswith("--tab="):
            tab = arg.split("=", 1)[1]
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

    if tab and tab in TAB_INDEX:
        app.nb.select(TAB_INDEX[tab])
        pump(app)

    grab(app, out)
    app.destroy()


if __name__ == "__main__":
    main()
