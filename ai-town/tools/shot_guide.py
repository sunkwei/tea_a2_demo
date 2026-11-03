"""给「操作指南」窗口拍一张截图。"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.stdout.reconfigure(encoding="utf-8")

from PIL import ImageGrab

from ai_town.ui.app import TownApp
from ai_town.ui.guide import load_pages, show_guide


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "guide_shot.png"
    pages = load_pages()
    print("页数：", len(pages), "｜标题：", " / ".join(t for t, _ in pages))

    app = TownApp(seed=7, name="临溪镇", offline=True, autostart=False)
    app.deiconify()
    app.lift()
    app.attributes("-topmost", True)
    app.geometry("1000x700+20+20")
    app.update()
    time.sleep(0.5)

    win = show_guide(app)
    win.attributes("-topmost", True)
    win.lift()
    app.update()
    time.sleep(0.8)
    win.update()

    x, y = win.winfo_rootx(), win.winfo_rooty()
    w, h = win.winfo_width(), win.winfo_height()
    img = ImageGrab.grab(bbox=(x, y, x + w, y + h))
    img.save(out)
    print("saved", out, img.size)
    win.destroy()
    app.destroy()


if __name__ == "__main__":
    main()
