"""游戏内「操作指南」窗口。

直接读取 `ai_town/GUIDE.md` 并按 `## ` 标题切成多页，
保证**游戏里的手册和仓库里的手册永远是同一份**。
"""
from __future__ import annotations

import os
import re
import tkinter as tk
from tkinter import ttk
from tkinter.scrolledtext import ScrolledText
from typing import List, Optional, Tuple

from . import theme as T

GUIDE_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "GUIDE.md")


def _plain(md: str) -> str:
    """把 Markdown 粗略地转成适合 Text 控件显示的纯文本。"""
    out: List[str] = []
    for raw in md.split("\n"):
        line = raw.rstrip()
        if line.strip() in ("---", "***", "___"):
            continue
        if line.lstrip().startswith("> "):
            line = "· " + line.lstrip()[2:].strip()
        if line.startswith("|"):  # 表格行 -> 用 ｜ 分隔的可读文本
            cells = [c.strip() for c in line.strip("|").split("|")]
            if all(set(c) <= set("-: ") for c in cells if c):
                continue
            cells = [c for c in cells if c]
            if cells:
                out.append("　" + "　｜　".join(cells))
                continue
        line = re.sub(r"^#{1,6}\s*", "", line)
        line = line.replace("**", "").replace("`", "")
        out.append(line)
    text = "\n".join(out)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def load_pages(path: Optional[str] = None) -> List[Tuple[str, str]]:
    """读指南文件，切成 [(页标题, 页正文)]。"""
    p = path or GUIDE_PATH
    if not os.path.exists(p):
        return [("操作指南", f"找不到指南文件：\n{p}")]
    with open(p, encoding="utf-8") as fh:
        text = fh.read()
    pages: List[Tuple[str, str]] = []
    intro: List[str] = []
    title: Optional[str] = None
    body: List[str] = []
    for line in text.split("\n"):
        if line.startswith("## "):
            if title is None:
                title = line[3:].strip()
                body = []
            else:
                pages.append((title, "\n".join(body).strip()))
                title = line[3:].strip()
                body = []
            continue
        if line.startswith("# "):
            continue
        if title is None:
            intro.append(line)
        else:
            body.append(line)
    if title is not None:
        pages.append((title, "\n".join(body).strip()))
    if "".join(intro).strip():
        pages.insert(0, ("开始之前", "\n".join(intro).strip()))
    return pages


def show_guide(parent: tk.Misc) -> tk.Toplevel:
    """弹出操作指南窗口。"""
    win = tk.Toplevel(parent)
    win.title("操作指南")
    win.geometry("900x640")
    win.configure(bg=T.BG)
    win.transient(parent)

    top = tk.Frame(win, bg=T.BG_PANEL)
    top.pack(fill="x")
    tk.Label(top, text="《AI 小镇：无限人生》操作指南", bg=T.BG_PANEL, fg=T.ACCENT,
             font=T.FONT_TITLE).pack(side="left", padx=12, pady=8)
    tk.Label(top, text=GUIDE_PATH, bg=T.BG_PANEL, fg=T.FG_DIM, font=T.FONT_SMALL
             ).pack(side="right", padx=12)

    nb = ttk.Notebook(win)
    nb.pack(fill="both", expand=True, padx=8, pady=8)

    for title, body in load_pages():
        frame = tk.Frame(nb, bg=T.BG_CARD)
        txt = ScrolledText(frame, bg=T.BG_CARD, fg=T.FG, font=T.FONT, relief="flat",
                           bd=0, padx=14, pady=10, wrap="word", spacing1=2, spacing3=4)
        txt.pack(fill="both", expand=True)
        txt.insert("1.0", _plain(body))
        txt.configure(state="disabled")
        nb.add(frame, text=title)

    bottom = tk.Frame(win, bg=T.BG_PANEL)
    bottom.pack(fill="x")
    tk.Label(bottom, text="改这份手册：编辑上面那个路径的 GUIDE.md，重启游戏即可生效。",
             bg=T.BG_PANEL, fg=T.FG_DIM, font=T.FONT_SMALL).pack(side="left", padx=12, pady=6)
    tk.Button(bottom, text="关闭", command=win.destroy, bg=T.ACCENT, fg="#1d1a17",
              font=T.FONT_BOLD, relief="flat", bd=0, padx=14, pady=4,
              activebackground="#e0a850").pack(side="right", padx=12, pady=4)
    return win


if __name__ == "__main__":
    for t, b in load_pages():
        print("=" * 20, t)
        print(_plain(b)[:200])
