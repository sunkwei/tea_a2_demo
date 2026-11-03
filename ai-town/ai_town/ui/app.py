"""Tkinter 前端：小镇地图 + 叙事面板 + 交互。

界面分区：
    左：状态条 + 小镇地图（Canvas）
    中：叙事日志（可滚动）+ 输入行 + 分支按钮
    右：人物 / 事件 / 市场 / 建筑 / 主线 / 镇志 六个页签

LLM 调用全部丢到后台线程，主线程只负责画界面。
"""
from __future__ import annotations

import os
import queue
import sys
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, simpledialog, ttk
from tkinter.scrolledtext import ScrolledText
from typing import Any, Callable, Dict, List, Optional

from ..endings import ENDINGS
from ..game import Game
from ..models import Choice, EventCard, NPC
from ..save import DEFAULT_SAVE_DIR, list_saves
from ..state import BUILDING_DEFS
from ..models import GOODS_LABELS
from . import theme as T

TILE = 54
MAP_PAD = 8


class TownApp(tk.Tk):
    def __init__(
        self,
        seed: Optional[int] = None,
        name: str = "临溪镇",
        offline: bool = False,
        autostart: bool = True,
    ):
        super().__init__()
        self.title("AI 小镇：无限人生")
        sw, sh = self.winfo_screenwidth(), self.winfo_screenheight()
        self.geometry(f"{min(1320, sw - 60)}x{min(840, sh - 90)}+20+20")
        self.minsize(1040, 640)
        self.configure(bg=T.BG)

        self.game = Game(seed=seed, name=name, offline=offline)
        self.queue: "queue.Queue" = queue.Queue()
        self.busy = False
        self.current_event: Optional[EventCard] = None
        self.current_choices: List[Choice] = []
        self._map_items: Dict[str, str] = {}

        self._build_menu()
        self._build_layout()
        self._build_statusbar()
        self.after(120, self._poll)
        if autostart:
            self.after(150, self._start)

    # ------------------------------------------------------------------
    # 界面搭建
    # ------------------------------------------------------------------
    def _build_menu(self) -> None:
        menubar = tk.Menu(self, bg=T.BG_PANEL, fg=T.FG, activebackground=T.ACCENT_SOFT,
                          activeforeground=T.FG, tearoff=0)
        m_game = tk.Menu(menubar, bg=T.BG_PANEL, fg=T.FG, tearoff=0)
        m_game.add_command(label="新游戏…", command=self._menu_new_game)
        m_game.add_command(label="保存进度", command=self._menu_save)
        m_game.add_command(label="读取进度…", command=self._menu_load)
        m_game.add_separator()
        m_game.add_command(label="结束本局（看结局）", command=self._menu_finish)
        m_game.add_separator()
        m_game.add_command(label="退出", command=self.destroy)
        m_view = tk.Menu(menubar, bg=T.BG_PANEL, fg=T.FG, tearoff=0)
        m_view.add_command(label="结束这一天", command=self._on_next_day)
        m_view.add_command(label="刷新界面", command=self._refresh_all)
        m_help = tk.Menu(menubar, bg=T.BG_PANEL, fg=T.FG, tearoff=0)
        m_help.add_command(label="玩法说明", command=self._show_help)
        m_help.add_command(label="结局列表", command=self._show_endings)
        menubar.add_cascade(label="游戏", menu=m_game)
        menubar.add_cascade(label="操作", menu=m_view)
        menubar.add_cascade(label="帮助", menu=m_help)
        self.configure(menu=menubar)

    def _build_layout(self) -> None:
        self.columnconfigure(1, weight=1)
        self.rowconfigure(0, weight=1)

        # ---- 左栏 ----
        left = tk.Frame(self, bg=T.BG, width=380)
        left.grid(row=0, column=0, sticky="nsw")
        left.grid_propagate(False)
        self.left = left

        head = tk.Frame(left, bg=T.BG_PANEL, bd=0)
        head.pack(fill="x")
        self.lbl_town = tk.Label(head, text="……", bg=T.BG_PANEL, fg=T.ACCENT, font=T.FONT_TITLE)
        self.lbl_town.pack(anchor="w", padx=10, pady=(8, 2))
        self.lbl_day = tk.Label(head, text="", bg=T.BG_PANEL, fg=T.FG_DIM, font=T.FONT)
        self.lbl_day.pack(anchor="w", padx=10, pady=(0, 8))

        self.res_frame = tk.Frame(left, bg=T.BG_PANEL)
        self.res_frame.pack(fill="x")
        self.res_labels: Dict[str, tk.Label] = {}

        map_wrap = tk.Frame(left, bg=T.BG_PANEL)
        map_wrap.pack(fill="x", pady=(6, 0))
        tk.Label(map_wrap, text="小镇地图（点居民看档案）", bg=T.BG_PANEL, fg=T.FG_DIM,
                 font=T.FONT_SMALL).pack(anchor="w", padx=10, pady=(6, 2))
        size = self.game.state.map_size * TILE + MAP_PAD * 2
        self.map_canvas = tk.Canvas(map_wrap, width=size, height=size, bg=T.BG_PANEL,
                                   highlightthickness=0)
        self.map_canvas.pack(padx=10, pady=(0, 10))
        self.map_canvas.bind("<Button-1>", self._on_map_click)

        tk.Label(left, text="提示：直接在中间输入「我想……」即可行动。",
                 bg=T.BG, fg=T.FG_DIM, font=T.FONT_SMALL, wraplength=350,
                 justify="left").pack(anchor="w", padx=12, pady=(4, 12))

        # ---- 中栏 ----
        mid = tk.Frame(self, bg=T.BG)
        mid.grid(row=0, column=1, sticky="nsew", padx=6)
        mid.rowconfigure(0, weight=1)
        mid.columnconfigure(0, weight=1)

        self.text = ScrolledText(mid, bg=T.BG_CARD, fg=T.FG, font=T.FONT_STORY,
                                 relief="flat", bd=0, padx=14, pady=10,
                                 wrap="word", insertbackground=T.FG, spacing1=4, spacing3=6)
        self.text.grid(row=0, column=0, sticky="nsew")
        self._init_tags()

        self.choice_frame = tk.Frame(mid, bg=T.BG)
        self.choice_frame.grid(row=1, column=0, sticky="ew", pady=(6, 0))

        input_row = tk.Frame(mid, bg=T.BG)
        input_row.grid(row=2, column=0, sticky="ew", pady=(8, 0))
        input_row.columnconfigure(0, weight=1)
        self.entry = tk.Entry(input_row, bg=T.BG_CARD, fg=T.FG, insertbackground=T.FG,
                              font=T.FONT_STORY, relief="flat", bd=0)
        self.entry.grid(row=0, column=0, sticky="ew", padx=(0, 8), ipady=6)
        self.entry.bind("<Return>", lambda e: self._on_action())
        self.btn_action = tk.Button(input_row, text="行动", command=self._on_action,
                                    bg=T.ACCENT, fg="#1d1a17", font=T.FONT_BOLD,
                                    relief="flat", bd=0, padx=16, pady=6,
                                    activebackground="#e0a850", activeforeground="#1d1a17")
        self.btn_action.grid(row=0, column=1)
        self.btn_next = tk.Button(input_row, text="结束这一天", command=self._on_next_day,
                                  bg=T.BG_CARD, fg=T.FG, font=T.FONT,
                                  relief="flat", bd=0, padx=12, pady=6,
                                  activebackground=T.ACCENT_SOFT)
        self.btn_next.grid(row=0, column=2, padx=(8, 0))

        # ---- 右栏 ----
        right = tk.Frame(self, bg=T.BG, width=330)
        right.grid(row=0, column=2, sticky="nse")
        right.grid_propagate(False)
        self.right = right
        self.nb = ttk.Notebook(right)
        self.nb.pack(fill="both", expand=True, padx=6, pady=8)

        self.people_list = tk.Listbox(self.nb, bg=T.BG_CARD, fg=T.FG, font=T.FONT,
                                      relief="flat", bd=0, highlightthickness=0,
                                      selectbackground=T.ACCENT_SOFT)
        self.people_list.bind("<<ListboxSelect>>", self._on_people_select)
        self.nb.add(self.people_list, text="人物")

        self.people_detail = tk.Text(self.nb, bg=T.BG_CARD, fg=T.FG, font=T.FONT,
                                      relief="flat", bd=0, padx=10, pady=8,
                                      wrap="word", height=12, state="disabled")
        self.nb.add(self.people_detail, text="档案")

        self.events_list = tk.Listbox(self.nb, bg=T.BG_CARD, fg=T.FG, font=T.FONT,
                                      relief="flat", bd=0, highlightthickness=0,
                                      selectbackground=T.ACCENT_SOFT)
        self.events_list.bind("<<ListboxSelect>>", self._on_event_select)
        self.nb.add(self.events_list, text="今日事件")

        self.market_frame = tk.Frame(self.nb, bg=T.BG_CARD)
        self.nb.add(self.market_frame, text="市场")

        self.build_frame = tk.Frame(self.nb, bg=T.BG_CARD)
        self.nb.add(self.build_frame, text="建筑")

        self.quest_frame = tk.Frame(self.nb, bg=T.BG_CARD)
        self.nb.add(self.quest_frame, text="主线")

        self.log_frame = tk.Frame(self.nb, bg=T.BG_CARD)
        self.nb.add(self.log_frame, text="镇志")

        self._build_market_tab()
        self._build_build_tab()

    def _init_tags(self) -> None:
        self.text.tag_configure("story", foreground=T.FG, font=T.FONT_STORY,
                                spacing3=8, lmargin1=4, lmargin2=4)
        self.text.tag_configure("title", foreground=T.ACCENT, font=T.FONT_TITLE,
                                spacing1=10, spacing3=6)
        self.text.tag_configure("day", foreground=T.INFO, font=T.FONT_BOLD,
                                spacing1=12, spacing3=6)
        self.text.tag_configure("system", foreground=T.FG_DIM, font=T.FONT)
        self.text.tag_configure("change", foreground=T.GOOD, font=T.FONT)
        self.text.tag_configure("error", foreground=T.BAD, font=T.FONT)
        self.text.tag_configure("speaker", foreground=T.ACCENT_SOFT, font=T.FONT_BOLD)

    def _build_statusbar(self) -> None:
        bar = tk.Frame(self, bg=T.BG_PANEL)
        bar.grid(row=1, column=0, columnspan=3, sticky="ew")
        self.lbl_status = tk.Label(bar, text="", bg=T.BG_PANEL, fg=T.FG_DIM, font=T.FONT_SMALL)
        self.lbl_status.pack(side="left", padx=10, pady=4)
        self.lbl_busy = tk.Label(bar, text="", bg=T.BG_PANEL, fg=T.ACCENT, font=T.FONT_SMALL)
        self.lbl_busy.pack(side="right", padx=10, pady=4)

    # ------------------------------------------------------------------
    # 启动
    # ------------------------------------------------------------------
    def _start(self) -> None:
        self._append("正在唤醒小镇……居民、事件与主线都在路上。", "system")
        self._run_bg(
            self.game.bootstrap,
            self._on_booted,
            busy_text="正在生成小镇（首次约 30 秒）…",
        )

    def _on_booted(self, _res: Any) -> None:
        st = self.game.state
        self._append(f"你成为了{st.name}的镇长。", "title")
        self._append(st.world_brief(), "system")
        q = st.quests[0] if st.quests else None
        if q:
            self._append(f"【主线】{q.title}\n{q.premise}", "day")
        self._append(f"今天有 {len(st.events)} 件事等你拿主意（右侧「今日事件」页签）。", "system")
        self._refresh_all()

    # ------------------------------------------------------------------
    # 文本输出
    # ------------------------------------------------------------------
    def _append(self, text: str, tag: str = "story") -> None:
        self.text.configure(state="normal")
        self.text.insert("end", text + "\n", tag)
        self.text.see("end")
        self.text.configure(state="disabled")

    def _set_choices(self, choices: List[Choice]) -> None:
        for w in self.choice_frame.winfo_children():
            w.destroy()
        self.current_choices = list(choices)
        if not choices:
            return
        for i, ch in enumerate(choices):
            label = f"{i + 1}. {ch.label}" + (f"（{ch.hint}）" if ch.hint else "")
            btn = tk.Button(self.choice_frame, text=label, command=lambda c=ch: self._on_choice(c),
                            bg=T.BG_CARD, fg=T.FG, font=T.FONT, relief="flat", bd=0,
                            anchor="w", padx=10, pady=6, activebackground=T.ACCENT_SOFT,
                            activeforeground=T.FG)
            btn.pack(fill="x", pady=2)

    # ------------------------------------------------------------------
    # 后台线程
    # ------------------------------------------------------------------
    def _run_bg(self, fn: Callable[[], Any], on_done: Callable[[Any], None],
                busy_text: str = "处理中…") -> None:
        if self.busy:
            self._append("（镇长正忙着，稍等一下。）", "system")
            return
        self.busy = True
        self.lbl_busy.configure(text=busy_text)
        self.entry.configure(state="disabled")
        self.btn_action.configure(state="disabled")
        self.btn_next.configure(state="disabled")

        def worker() -> None:
            try:
                res = fn()
                self.queue.put(("ok", on_done, res, None))
            except Exception as e:  # noqa: BLE001
                self.queue.put(("ok", on_done, None, e))

        threading.Thread(target=worker, daemon=True).start()

    def _poll(self) -> None:
        try:
            while True:
                _kind, cb, res, err = self.queue.get_nowait()
                self.busy = False
                self.lbl_busy.configure(text="")
                self.entry.configure(state="normal")
                self.btn_action.configure(state="normal")
                self.btn_next.configure(state="normal")
                if err is not None:
                    self._append(f"（出了点岔子：{err}）", "error")
                else:
                    try:
                        cb(res)
                    except Exception as e:  # noqa: BLE001
                        self._append(f"（界面刷新失败：{e}）", "error")
        except queue.Empty:
            pass
        self.after(120, self._poll)

    # ------------------------------------------------------------------
    # 玩家动作
    # ------------------------------------------------------------------
    def _on_action(self) -> None:
        text = self.entry.get().strip()
        if not text:
            return
        self.entry.delete(0, "end")
        self._append(f"▸ 你决定：{text}", "speaker")
        self._set_choices([])
        self._run_bg(lambda: self.game.do_action(text), self._on_action_done, "世界正在回应…")

    def _on_action_done(self, outcome: Any) -> None:
        self._append(outcome.narrative, "story")
        if outcome.changes:
            self._append("结算：" + "，".join(outcome.changes), "change")
        self._set_choices(outcome.choices)
        self._refresh_all()

    def _on_choice(self, choice: Choice) -> None:
        self._set_choices([])
        self._append(f"▸ {choice.label}", "speaker")
        self._run_bg(lambda: self.game.apply_choice(choice), self._on_choice_done)

    def _on_choice_done(self, outcome: Any) -> None:
        self._append(outcome.narrative, "story")
        if outcome.changes:
            self._append("结算：" + "，".join(outcome.changes), "change")
        self._refresh_all()

    def _on_next_day(self) -> None:
        self._set_choices([])
        self._run_bg(self.game.advance_day, self._on_next_day_done, "新的一天…")

    def _on_next_day_done(self, report: Any) -> None:
        st = self.game.state
        self._append(f"—— 第{st.day}天 · {st.season}季 · {st.weather} ——", "day")
        notes = report.get("notes") or []
        if notes:
            self._append("结算：" + "；".join(notes), "system")
        for e in report.get("events") or []:
            self._append("· " + e, "system")
        self._append(f"今天有 {len(st.events)} 件事等你拿主意。", "system")
        self._refresh_all()

    def _on_event_select(self, _evt: Any) -> None:
        sel = self.events_list.curselection()
        if not sel:
            return
        idx = sel[0]
        evs = [e for e in self.game.state.events]
        if idx >= len(evs):
            return
        ev = evs[idx]
        self.current_event = ev
        self._append(f"【{ev.title}】", "title")
        self._append(ev.text, "story")
        self._set_choices(ev.choices)

    # ------------------------------------------------------------------
    # 地图
    # ------------------------------------------------------------------
    def _draw_map(self) -> None:
        c = self.map_canvas
        c.delete("all")
        self._map_items.clear()
        st = self.game.state
        n = st.map_size
        for r in range(n):
            for col in range(n):
                x0 = col * TILE + MAP_PAD
                y0 = r * TILE + MAP_PAD
                color = T.TILE_A if (r + col) % 2 == 0 else T.TILE_B
                c.create_rectangle(x0, y0, x0 + TILE, y0 + TILE, fill=color, outline=T.BG_PANEL)
        for b in st.buildings:
            r, col = divmod(b.tile, n)
            x0 = col * TILE + MAP_PAD + 7
            y0 = r * TILE + MAP_PAD + 7
            x1 = x0 + TILE - 14
            y1 = y0 + TILE - 14
            color = T.BUILDING_COLORS.get(b.kind, "#777777")
            rect = c.create_rectangle(x0, y0, x1, y1, fill=color, outline="#d8c8a8", width=1)
            icon = BUILDING_DEFS.get(b.kind, {}).get("icon", "?")
            c.create_text((x0 + x1) / 2, (y0 + y1) / 2, text=icon, fill="#f3ead8", font=T.FONT_BOLD)
            c.tag_bind(rect, "<Button-1>", lambda e, bid=b.id: self._on_building_click(bid))
            self._map_items[b.id] = rect
        for i, npc in enumerate(st.npcs):
            if not npc.alive:
                continue
            r, col = divmod(npc.home_tile, n)
            cx = col * TILE + MAP_PAD + 14 + (i % 3) * 9
            cy = r * TILE + MAP_PAD + 14 + (i // 3) * 9
            if npc.trust >= 70:
                color = T.GOOD
            elif npc.trust >= 40:
                color = T.ACCENT
            else:
                color = T.BAD
            dot = c.create_oval(cx, cy, cx + 9, cy + 9, fill=color, outline="#1d1a17")
            c.tag_bind(dot, "<Button-1>", lambda e, nid=npc.id: self._on_npc_click(nid))
            self._map_items[npc.id] = dot

    def _on_map_click(self, _evt: Any) -> None:
        pass

    def _on_npc_click(self, npc_id: str) -> None:
        npc = self.game.state.find_npc(npc_id)
        if not npc:
            return
        self._show_npc_detail(npc)
        # 在人物页签里选中
        for i, n in enumerate(self.game.state.npcs):
            if n.id == npc_id:
                self.people_list.selection_clear(0, tk.END)
                self.people_list.selection_set(i)
                self.people_list.see(i)
                break
        self.nb.select(1)  # 档案页签

    def _on_building_click(self, bid: str) -> None:
        b = self.game.state.building(bid)
        if not b:
            return
        d = BUILDING_DEFS.get(b.kind, {})
        staff = "、".join(
            (self.game.state.find_npc(s).name if self.game.state.find_npc(s) else s)
            for s in b.staff
        )
        self._append(f"【{b.name}】{d.get('desc', '')}", "title")
        self._append(f"等级 Lv{b.level}｜状态 {int(b.condition * 100)}%｜人手：{staff or '无'}", "system")

    # ------------------------------------------------------------------
    # 右栏刷新
    # ------------------------------------------------------------------
    def _refresh_all(self) -> None:
        st = self.game.state
        self.lbl_town.configure(text=st.name)
        self.lbl_day.configure(
            text=f"第{st.year}年{st.season}季 · 第{st.day}天 · {st.weather} · 人口 {st.population}"
        )
        self._refresh_resources()
        self._draw_map()
        self._refresh_people()
        self._refresh_events()
        self._refresh_market()
        self._refresh_buildings()
        self._refresh_quest()
        self._refresh_log()
        self.lbl_status.configure(text=self.game.status_line() + "   |   " + self.game.llm_label())

    def _refresh_resources(self) -> None:
        for w in self.res_frame.winfo_children():
            w.destroy()
        st = self.game.state
        rows = [
            ("民心", f"{st.morale}", T.GOOD if st.morale >= 60 else (T.BAD if st.morale < 35 else T.ACCENT)),
            ("金币", f"{st.resource('coin')}", T.FG),
            ("粮食", f"{st.resource('food')}", T.FG),
            ("木材", f"{st.resource('wood')}", T.FG),
            ("石料", f"{st.resource('stone')}", T.FG),
            ("矿石", f"{st.resource('ore')}", T.FG),
            ("声望", f"{st.resource('renown')}", T.FG),
        ]
        grid = tk.Frame(self.res_frame, bg=T.BG_PANEL)
        grid.pack(fill="x", padx=10, pady=(4, 8))
        for i, (name, val, color) in enumerate(rows):
            cell = tk.Frame(grid, bg=T.BG_PANEL)
            cell.grid(row=i // 2, column=i % 2, sticky="ew", pady=1)
            tk.Label(cell, text=name, bg=T.BG_PANEL, fg=T.FG_DIM, font=T.FONT_SMALL,
                     width=4, anchor="w").pack(side="left")
            tk.Label(cell, text=val, bg=T.BG_PANEL, fg=color, font=T.FONT_BOLD,
                     anchor="e").pack(side="right")
        grid.columnconfigure(0, weight=1)
        grid.columnconfigure(1, weight=1)

    def _refresh_people(self) -> None:
        self.people_list.delete(0, tk.END)
        for npc in self.game.state.npcs:
            mark = "◆" if npc.alive else "◇"
            self.people_list.insert(tk.END, f"{mark} {npc.name}（{npc.role}）")

    def _show_npc_detail(self, npc: NPC) -> None:
        st = self.game.state
        self.people_detail.configure(state="normal")
        self.people_detail.delete("1.0", "end")
        lines = [
            f"{npc.name}　{npc.role}　{npc.age}岁",
            f"性格：{'、'.join(npc.traits) or '普通'}",
            f"背景：{npc.background}",
            f"信任 {npc.trust}/100　心情 {npc.mood}/100　技能 {npc.skill}",
        ]
        if npc.trust >= 60:
            lines.append(f"秘密：{npc.secret}")
        else:
            lines.append("秘密：他还不敢说。")
        rel = []
        for rid, val in npc.relations.items():
            other = st.find_npc(rid)
            if other:
                rel.append(f"{other.name}({val:+d})")
        if rel:
            lines.append("关系：" + "、".join(rel))
        job = st.building(npc.job) if npc.job else None
        if job:
            lines.append(f"工作：{job.name}")
        self.people_detail.insert("end", "\n".join(lines))
        self.people_detail.configure(state="disabled")

    def _on_people_select(self, _evt: Any) -> None:
        sel = self.people_list.curselection()
        if not sel:
            return
        npcs = self.game.state.npcs
        if sel[0] < len(npcs):
            self._show_npc_detail(npcs[sel[0]])

    def _refresh_events(self) -> None:
        self.events_list.delete(0, tk.END)
        for ev in self.game.state.events:
            mark = "✓" if ev.resolved else "●"
            self.events_list.insert(tk.END, f"{mark} {ev.title}")

    def _build_market_tab(self) -> None:
        for w in self.market_frame.winfo_children():
            w.destroy()
        st = self.game.state
        tk.Label(self.market_frame, text="价格随供需浮动", bg=T.BG_CARD, fg=T.FG_DIM,
                 font=T.FONT_SMALL).pack(anchor="w", padx=8, pady=(8, 4))
        for good in ("food", "wood", "stone", "ore", "tools", "books"):
            row = tk.Frame(self.market_frame, bg=T.BG_CARD)
            row.pack(fill="x", padx=8, pady=2)
            own = st.resource(good) if good in st.resources else st.stock_of(good)
            tk.Label(row, text=f"{GOODS_LABELS.get(good, good)}", bg=T.BG_CARD, fg=T.FG,
                     font=T.FONT, width=6, anchor="w").pack(side="left")
            tk.Label(row, text=f"市价{st.market.price_of(good):.1f}　存{own}",
                     bg=T.BG_CARD, fg=T.FG_DIM, font=T.FONT_SMALL).pack(side="left", padx=4)
            tk.Button(row, text="卖5", command=lambda g=good: self._do_trade("sell", g),
                      bg=T.BG_PANEL, fg=T.FG, relief="flat", bd=0, padx=6,
                      font=T.FONT_SMALL, activebackground=T.ACCENT_SOFT).pack(side="right")
            tk.Button(row, text="买5", command=lambda g=good: self._do_trade("buy", g),
                      bg=T.BG_PANEL, fg=T.FG, relief="flat", bd=0, padx=6,
                      font=T.FONT_SMALL, activebackground=T.ACCENT_SOFT).pack(side="right", padx=4)
        car = st.caravan
        if car:
            tk.Label(self.market_frame, text=f"商队：{car.name}", bg=T.BG_CARD, fg=T.ACCENT,
                     font=T.FONT_BOLD).pack(anchor="w", padx=8, pady=(10, 2))
            tk.Label(self.market_frame, text=f"求购 {car.demand_text()}（价优 {car.rate}倍）",
                     bg=T.BG_CARD, fg=T.FG_DIM, font=T.FONT_SMALL).pack(anchor="w", padx=8)
            for good, qty in car.demands.items():
                if qty <= 0:
                    continue
                tk.Button(self.market_frame, text=f"卖 {qty} 份{GOODS_LABELS.get(good, good)} 给商队",
                          command=lambda g=good, q=qty: self._do_caravan(g, q),
                          bg=T.BG_PANEL, fg=T.FG, relief="flat", bd=0, padx=6, pady=2,
                          font=T.FONT_SMALL, anchor="w", activebackground=T.ACCENT_SOFT
                          ).pack(fill="x", padx=8, pady=1)

    def _build_build_tab(self) -> None:
        for w in self.build_frame.winfo_children():
            w.destroy()
        st = self.game.state
        tk.Label(self.build_frame, text="现有建筑", bg=T.BG_CARD, fg=T.FG_DIM,
                 font=T.FONT_SMALL).pack(anchor="w", padx=8, pady=(8, 2))
        for b in st.buildings:
            staff = "、".join(
                (st.find_npc(s).name if st.find_npc(s) else s) for s in b.staff
            )
            tk.Label(self.build_frame, text=f"{b.name} Lv{b.level}　{staff or '无人'}",
                     bg=T.BG_CARD, fg=T.FG, font=T.FONT, anchor="w").pack(fill="x", padx=8)
        tk.Label(self.build_frame, text="开建（点一下）", bg=T.BG_CARD, fg=T.FG_DIM,
                 font=T.FONT_SMALL).pack(anchor="w", padx=8, pady=(10, 2))
        for kind, d in BUILDING_DEFS.items():
            cost = " ".join(
                f"{('金币' if k == 'coin' else '粮' if k == 'food' else '木' if k == 'wood' else '石' if k == 'stone' else '矿')}{v}"
                for k, v in d["cost"].items()
            )
            tk.Button(self.build_frame, text=f"{d['name']}（{cost}）",
                      command=lambda k=kind: self._do_build(k),
                      bg=T.BG_PANEL, fg=T.FG, relief="flat", bd=0, padx=6, pady=2,
                      font=T.FONT_SMALL, anchor="w", activebackground=T.ACCENT_SOFT
                      ).pack(fill="x", padx=8, pady=1)

    def _refresh_market(self) -> None:
        self._build_market_tab()

    def _refresh_buildings(self) -> None:
        self._build_build_tab()

    def _refresh_quest(self) -> None:
        for w in self.quest_frame.winfo_children():
            w.destroy()
        st = self.game.state
        for q in st.quests:
            tk.Label(self.quest_frame, text=f"【{q.title}】", bg=T.BG_CARD, fg=T.ACCENT,
                     font=T.FONT_BOLD, wraplength=300, justify="left").pack(anchor="w", padx=8, pady=(8, 2))
            tk.Label(self.quest_frame, text=q.premise, bg=T.BG_CARD, fg=T.FG,
                     font=T.FONT_SMALL, wraplength=300, justify="left").pack(anchor="w", padx=8)
            for i, stage in enumerate(q.stages):
                mark = "▶" if i == q.stage else ("✓" if i < q.stage else "·")
                color = T.ACCENT if i == q.stage else T.FG_DIM
                tk.Label(self.quest_frame, text=f"{mark} {stage}", bg=T.BG_CARD, fg=color,
                         font=T.FONT_SMALL, wraplength=300, justify="left").pack(anchor="w", padx=14)
            if q.clues:
                tk.Label(self.quest_frame, text="线索：" + "、".join(q.clues), bg=T.BG_CARD,
                         fg=T.INFO, font=T.FONT_SMALL, wraplength=300, justify="left").pack(anchor="w", padx=8, pady=(4, 0))
            if q.status != "active":
                tk.Label(self.quest_frame, text=f"状态：{q.status}", bg=T.BG_CARD, fg=T.FG_DIM,
                         font=T.FONT_SMALL).pack(anchor="w", padx=8)
        if not st.quests:
            tk.Label(self.quest_frame, text="还没有主线", bg=T.BG_CARD, fg=T.FG_DIM,
                     font=T.FONT_SMALL).pack(anchor="w", padx=8, pady=8)

    def _refresh_log(self) -> None:
        for w in self.log_frame.winfo_children():
            w.destroy()
        st = self.game.state
        tk.Label(self.log_frame, text="镇志", bg=T.BG_CARD, fg=T.FG_DIM,
                 font=T.FONT_SMALL).pack(anchor="w", padx=8, pady=(8, 2))
        for entry in st.log[-60:][::-1]:
            tk.Label(self.log_frame, text=f"第{entry.get('day', '?')}天 · {entry.get('text', '')}",
                     bg=T.BG_CARD, fg=T.FG, font=T.FONT_SMALL, wraplength=300,
                     justify="left", anchor="w").pack(fill="x", padx=8)

    # ------------------------------------------------------------------
    # 交易 / 建造
    # ------------------------------------------------------------------
    def _do_trade(self, kind: str, good: str) -> None:
        fn = self.game.sell if kind == "sell" else self.game.buy
        ok, msg = fn(good, 5)
        self._append(("卖出：" if kind == "sell" else "买入：") + msg if ok else f"（{msg}）",
                     "change" if ok else "error")
        self._refresh_all()

    def _do_caravan(self, good: str, qty: int) -> None:
        ok, msg = self.game.sell_to_caravan(good, qty)
        self._append(msg if ok else f"（{msg}）", "change" if ok else "error")
        self._refresh_all()

    def _do_build(self, kind: str) -> None:
        ok, msg = self.game.build(kind)
        self._append(msg if ok else f"（{msg}）", "change" if ok else "error")
        self._refresh_all()

    # ------------------------------------------------------------------
    # 菜单
    # ------------------------------------------------------------------
    def _menu_new_game(self) -> None:
        name = simpledialog.askstring("新游戏", "小镇叫什么名字？", initialvalue="临溪镇")
        if not name:
            return
        seed_s = simpledialog.askstring("新游戏", "种子（留空随机）：", initialvalue="")
        try:
            seed = int(seed_s) if seed_s and seed_s.strip() else None
        except ValueError:
            seed = None
        self.game.new_game(name, seed)
        self.text.configure(state="normal")
        self.text.delete("1.0", "end")
        self.text.configure(state="disabled")
        self._set_choices([])
        self._start()

    def _menu_save(self) -> None:
        path = filedialog.asksaveasfilename(
            title="保存进度", defaultextension=".json",
            initialdir=DEFAULT_SAVE_DIR, filetypes=[("JSON", "*.json")]
        )
        if not path:
            return
        try:
            self.game.save(path)
            self._append(f"已保存到 {path}", "system")
        except Exception as e:  # noqa: BLE001
            self._append(f"（保存失败：{e}）", "error")

    def _menu_load(self) -> None:
        path = filedialog.askopenfilename(
            title="读取进度", initialdir=DEFAULT_SAVE_DIR, filetypes=[("JSON", "*.json")]
        )
        if not path:
            return
        try:
            self.game = Game.load(path)
            self._append(f"已读取 {path}", "system")
            self._refresh_all()
        except Exception as e:  # noqa: BLE001
            self._append(f"（读取失败：{e}）", "error")

    def _menu_finish(self) -> None:
        ending = self.game.end_run()
        self._append(f"【结局】{ending.title}", "title")
        self._append(ending.text, "story")
        messagebox.showinfo("结局", f"{ending.title}\n\n{ending.text}")

    def _show_help(self) -> None:
        messagebox.showinfo(
            "玩法说明",
            "《AI 小镇：无限人生》\n\n"
            "· 你是新上任的镇长，NPC、事件、剧情全部由 LLM 现场生成。\n"
            "· 在中间输入「我想去井台看看」这类自由描述 → LLM 叙述结果并给 3 个分支。\n"
            "· 点分支或事件页签里的事件 → 确定性状态机结算资源 / 民心 / 信任。\n"
            "· 「结束这一天」推进一天：产出、口粮、税收、行情、商队都会结算。\n"
            "· 你的每个选择都会被记住，LLM 之后会拿旧事来翻旧账。\n"
            "· 民心、信任、财富与行为倾向共同决定 17 种结局之一。",
        )

    def _show_endings(self) -> None:
        text = "\n".join(f"· {e['title']}" for e in ENDINGS)
        messagebox.showinfo("结局列表", f"共 {len(ENDINGS)} 种：\n\n{text}")


def main(argv: Optional[List[str]] = None) -> int:
    import argparse

    ap = argparse.ArgumentParser(description="AI 小镇：无限人生（Tkinter 前端）")
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--name", default="临溪镇")
    ap.add_argument("--offline", action="store_true", help="不使用 LLM，纯程序化叙述")
    args = ap.parse_args(argv)
    app = TownApp(seed=args.seed, name=args.name, offline=args.offline)
    app.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
