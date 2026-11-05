"""Tkinter 图形界面：牌桌 + 手牌 + 事件日志 + 模型思考面板。

线程模型：
  * 对局跑在后台线程（Session.run），把事件塞进 queue；
  * Tk 主线程每 80ms 轮询队列并刷新界面；
  * 「思考中」的状态由模型调用前后的 on_think 回调驱动。
"""

from __future__ import annotations

import queue
import threading
import time
import tkinter as tk
from collections import deque
from tkinter import ttk
from typing import Dict, List, Optional

from ..config import GameConfig, MODEL_SPECS
from ..engine import Player
from ..game import Seat, Session
from ..heroes import DEFAULT_LINEUP, get_hero
from ..llm.client import LlmClient
from ..llm.policy import LlmPolicy

# ---------------------------------------------------------------- 配色
BG = "#14161b"
PANEL = "#1e2129"
PANEL2 = "#272b35"
FG = "#e9e6e1"
MUTED = "#9aa0ac"
GOLD = "#d8a24a"
RED = "#c0392b"
GREEN = "#27ae60"
BLUE = "#2e86c1"

CARD_BG = {
    "杀": "#8e2f2f",
    "闪": "#245b8f",
    "桃": "#a8542a",
    "酒": "#6b3fa0",
    "无懈可击": "#4a4f5c",
    "装备": "#4e6b45",
    "锦囊": "#5c4a7d",
}
SEAT_MODEL_COLOR = {
    "minimax-m3.1-flash": "#e0703a",
    "deepseek-flash": "#4b8bf5",
    "mimo-v2.6-flash": "#38b48b",
}


def card_color(name: str) -> str:
    if name in CARD_BG:
        return CARD_BG[name]
    if name in ("南蛮入侵", "万箭齐发", "乐不思蜀", "兵粮寸断", "闪电"):
        return CARD_BG["锦囊"]
    return CARD_BG["装备"]


# ---------------------------------------------------------------- 组件
class SeatPanel(tk.Frame):
    """一个座位的展示面板。"""

    def __init__(self, master, idx: int, on_click=None):
        super().__init__(master, bg=PANEL, highlightthickness=2, highlightbackground="#333846")
        self.idx = idx
        self.on_click = on_click
        self.bind("<Button-1>", lambda _e: self.on_click and self.on_click(self.idx))

        self.title = tk.Label(self, text="", bg=PANEL, fg=FG, font=("Microsoft YaHei UI", 12, "bold"))
        self.title.pack(pady=(6, 0))
        self.sub = tk.Label(self, text="", bg=PANEL, fg=MUTED, font=("Microsoft YaHei UI", 9))
        self.sub.pack()
        self.hp = tk.Label(self, text="", bg=PANEL, fg=RED, font=("Microsoft YaHei UI", 11, "bold"))
        self.hp.pack(pady=(3, 0))
        self.equip = tk.Label(self, text="", bg=PANEL, fg="#b9c2d0", font=("Microsoft YaHei UI", 9))
        self.equip.pack()
        self.state = tk.Label(self, text="", bg=PANEL, fg=MUTED, font=("Microsoft YaHei UI", 9))
        self.state.pack(pady=(2, 6))

    def update(self, p: Player, model_key: str, active: bool, phase_text: str = "") -> None:
        self.title.config(
            text=f"{p.idx + 1}号位 · {p.name}",
            fg=GOLD if active else (FG if p.alive else "#666c78"),
        )
        self.sub.config(text=f"{p.hero.faction}·{p.hero.title or p.hero.name} · {model_key}")
        hearts = "♥" * max(0, p.hp) + "♡" * max(0, p.max_hp - p.hp)
        self.hp.config(text=hearts, fg=RED if p.alive else "#666c78")
        eq = "、".join(c.name for c in p.equips.values())
        self.equip.config(text=f"装备：{eq}" if eq else "装备：无")
        self.state.config(text=phase_text or (f"手牌 {len(p.hand)} 张" if p.alive else "已阵亡"))
        self.configure(highlightbackground=GOLD if active else "#333846")


class CardBtn(tk.Button):
    def __init__(self, master, card, command=None):
        super().__init__(
            master,
            text=f"{card.name}\n{card.suit}{card.rank}",
            width=7,
            height=2,
            font=("Microsoft YaHei UI", 10, "bold"),
            bg=card_color(card.name),
            fg="#fbf7f0",
            activebackground=card_color(card.name),
            activeforeground="#ffffff",
            relief="raised",
            borderwidth=1,
            highlightthickness=2,
            highlightbackground="#f0d9a8",
            command=command,
            cursor="hand2",
        )


class LogView(tk.Frame):
    def __init__(self, master):
        super().__init__(master, bg=PANEL)
        self.text = tk.Text(
            self,
            bg="#101216",
            fg="#cfd3da",
            font=("Consolas", 9),
            height=10,
            wrap="word",
            state="disabled",
            highlightthickness=0,
        )
        scroll = tk.Scrollbar(self, command=self.text.yview)
        self.text.configure(yscrollcommand=scroll.set)
        self.text.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")
        self.text.tag_configure("say", foreground="#ffd479")
        self.text.tag_configure("damage", foreground="#ff7b6b")
        self.text.tag_configure("heal", foreground="#7ee2a8")
        self.text.tag_configure("death", foreground="#ff5252")
        self.text.tag_configure("win", foreground=GOLD, font=("Consolas", 10, "bold"))
        self.text.tag_configure("think", foreground="#7f8896")
        self.text.tag_configure("error", foreground="#ff9f43")
        self.text.tag_configure("phase", foreground="#9ecbff")
        self.text.tag_configure("action", foreground="#d5d9e0")

    def write(self, text: str, tag: str = "") -> None:
        self.text.configure(state="normal")
        self.text.insert("end", text + "\n", tag)
        self.text.see("end")
        self.text.configure(state="disabled")


# ---------------------------------------------------------------- 主窗口
class GameApp(tk.Tk):
    def __init__(self, cfg: GameConfig):
        super().__init__()
        self.cfg = cfg
        self.title("AI 三国杀 · minimax-m3.1-flash / deepseek-flash / mimo-v2.6-flash")
        self.geometry("1320x860")
        self.minsize(1100, 720)
        self.configure(bg=BG)
        style = ttk.Style(self)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure("TButton", background="#39404e", foreground=FG, borderwidth=0, focusthickness=0)
        style.map("TButton", background=[("active", "#4a5364")])
        style.configure("TCheckbutton", background=PANEL2, foreground=FG)
        style.map("TCheckbutton", background=[("active", PANEL2)], foreground=[("active", FG)])
        style.configure("Horizontal.TScale", background=PANEL2, troughcolor="#39404e")

        self.events: "queue.Queue[Dict]" = queue.Queue()
        self.pending: deque = deque()
        self.speed = tk.DoubleVar(value=1.0)  # 1.0 = 正常
        self.auto_next = tk.BooleanVar(value=True)
        self.running = False
        self.session: Optional[Session] = None
        self.model_status: Dict[str, Dict[str, str]] = {}
        self.last_error: Optional[tk.StringVar] = None

        self._build_ui()
        self.after(80, self._poll)
        self.after(300, self._start_game)

    # ------------------------------------------------------------ UI
    def _build_ui(self) -> None:
        # 顶部工具条
        bar = tk.Frame(self, bg=PANEL2, height=46)
        bar.pack(fill="x")
        tk.Label(
            bar,
            text="⚔ AI 三国杀",
            bg=PANEL2,
            fg=GOLD,
            font=("Microsoft YaHei UI", 14, "bold"),
        ).pack(side="left", padx=14)
        self.status_var = tk.StringVar(value="准备开始…")
        tk.Label(bar, textvariable=self.status_var, bg=PANEL2, fg=FG, font=("Microsoft YaHei UI", 10)).pack(
            side="left", padx=10
        )
        ttk.Scale(bar, from_=0.0, to=3.0, variable=self.speed, orient="horizontal", length=140).pack(
            side="left", padx=(18, 4)
        )
        tk.Label(bar, text="速度", bg=PANEL2, fg=MUTED, font=("Microsoft YaHei UI", 9)).pack(side="left")
        ttk.Button(bar, text="开新局", command=self._start_game).pack(side="right", padx=6)
        ttk.Button(bar, text="导出战报", command=self._export).pack(side="right", padx=6)
        ttk.Checkbutton(bar, text="结束后自动开下一局", variable=self.auto_next).pack(side="right", padx=10)

        body = tk.Frame(self, bg=BG)
        body.pack(fill="both", expand=True)

        # 左侧牌桌
        table = tk.Frame(body, bg=BG)
        table.pack(side="left", fill="both", expand=True)
        self.canvas = tk.Canvas(table, bg="#171a20", highlightthickness=0, height=520)
        self.canvas.pack(fill="both", expand=True)
        self.canvas.bind("<Configure>", self._on_canvas_resize)

        self.seat_panels: List[SeatPanel] = []
        self.seat_pos = [(0.5, 0.02), (0.10, 0.38), (0.90, 0.38)]
        for i in range(3):
            panel = SeatPanel(self.canvas, i, on_click=self._focus_seat)
            self.seat_panels.append(panel)
        self._layout_seats()

        self.deck_label = tk.Label(self.canvas, text="", bg="#171a20", fg=MUTED, font=("Microsoft YaHei UI", 10))
        self.deck_label.place(relx=0.5, rely=0.82, anchor="center")

        # 右侧：模型面板 + 日志
        side = tk.Frame(body, bg=BG, width=400)
        side.pack(side="right", fill="y")
        side.pack_propagate(False)
        tk.Label(
            side, text="参战模型", bg=BG, fg=GOLD, font=("Microsoft YaHei UI", 11, "bold")
        ).pack(anchor="w", padx=12, pady=(10, 4))
        self.model_frame = tk.Frame(side, bg=PANEL)
        self.model_frame.pack(fill="x", padx=10)
        self.model_rows: Dict[str, Dict[str, tk.Label]] = {}

        tk.Label(side, text="对局日志", bg=BG, fg=GOLD, font=("Microsoft YaHei UI", 11, "bold")).pack(
            anchor="w", padx=12, pady=(12, 4)
        )
        self.log = LogView(side)
        self.log.pack(fill="both", expand=True, padx=10, pady=(0, 10))

        # 底部：手牌区
        self.hand_frame = tk.Frame(self, bg=PANEL, height=130)
        self.hand_frame.pack(fill="x", side="bottom")
        self.hand_title = tk.Label(
            self.hand_frame, text="手牌", bg=PANEL, fg=GOLD, font=("Microsoft YaHei UI", 10, "bold")
        )
        self.hand_title.pack(anchor="w", padx=12, pady=(6, 2))
        self.hand_row = tk.Frame(self.hand_frame, bg=PANEL)
        self.hand_row.pack(fill="x", padx=12, pady=(0, 10))

    def _on_canvas_resize(self, _event=None) -> None:
        w = max(1, self.canvas.winfo_width())
        h = max(1, self.canvas.winfo_height())
        self.canvas.delete("table")
        self.canvas.create_oval(
            w * 0.08, h * 0.08, w * 0.92, h * 0.70,
            outline="#2b303b", width=2, tags="table",
        )
        self._layout_seats()

    def _layout_seats(self) -> None:
        for i, panel in enumerate(self.seat_panels):
            px, py = self.seat_pos[i]
            panel.place(relx=px, rely=py, anchor="n", width=215)

    # ------------------------------------------------------------ 开局
    def _start_game(self) -> None:
        if self.running:
            return
        self.running = True
        self.model_status = {}
        for row in self.model_rows.values():
            row["state"].config(text="等待中", fg=MUTED)
        self.log.write("—— 新的一局 ——", "phase")

        cfg = self.cfg
        seats: List[Seat] = []
        for key in cfg.seats:
            spec = MODEL_SPECS[key]
            client = LlmClient(spec, timeout=cfg.llm_timeout)
            policy = LlmPolicy(client, key)
            hero_key = cfg.hero_for(key) or DEFAULT_LINEUP.get(key, "zhang_fei")
            seats.append(
                Seat(model_key=key, hero_key=hero_key, policy=policy, display=spec.display)
            )
            self.model_rows.setdefault(key, {})
            self.model_rows[key].update(
                {
                    "name": tk.Label(
                        self.model_frame,
                        text=f"● {spec.display}",
                        bg=PANEL,
                        fg=SEAT_MODEL_COLOR.get(key, FG),
                        font=("Microsoft YaHei UI", 9, "bold"),
                        anchor="w",
                    ),
                    "hero": tk.Label(self.model_frame, text="", bg=PANEL, fg=MUTED, anchor="w",
                                     font=("Microsoft YaHei UI", 9)),
                    "state": tk.Label(self.model_frame, text="等待中", bg=PANEL, fg=MUTED, anchor="w",
                                      font=("Microsoft YaHei UI", 9)),
                    "say": tk.Label(self.model_frame, text="", bg=PANEL, fg="#ffd479", anchor="w",
                                    font=("Microsoft YaHei UI", 9, "italic")),
                }
            )
            self.model_rows[key]["name"].pack(fill="x")
            self.model_rows[key]["hero"].pack(fill="x")
            self.model_rows[key]["state"].pack(fill="x")
            self.model_rows[key]["say"].pack(fill="x")

        self.session = Session(cfg, seats, emit=self.events.put)
        self.thread = threading.Thread(target=self._run_game, daemon=True)
        self.thread.start()

    def _run_game(self) -> None:
        try:
            result = self.session.run()
            self.events.put({"type": "result", "result": result})
        except Exception as e:  # noqa: BLE001
            self.events.put({"type": "error", "text": f"对局异常：{e}"})

    # ------------------------------------------------------------ 事件
    def _poll(self) -> None:
        while True:
            try:
                ev = self.events.get_nowait()
            except queue.Empty:
                break
            self.pending.append(ev)
        # 按速度逐条刷新
        delay = max(0.0, 0.35 / max(0.2, self.speed.get()))
        if self.pending and time.time() >= getattr(self, "_next_emit", 0):
            ev = self.pending.popleft()
            self._next_emit = time.time() + delay
            self._handle_event(ev)
        self.after(80, self._poll)

    def _handle_event(self, ev: Dict) -> None:
        etype = str(ev.get("type", "info"))
        text = str(ev.get("text", ""))
        player = ev.get("player")
        model_key = str(ev.get("model", ""))
        if etype == "phase":
            self.log.write(text, "phase")
            self.status_var.set(text)
        elif etype == "seat":
            self.log.write(text, "action")
            row = self.model_rows.get(model_key)
            if row:
                row["hero"].config(text=text.split("由")[-1].strip())
        elif etype == "say":
            self.log.write(f"    「{text}」", "say")
            row = self.model_rows.get(model_key)
            if row:
                row["say"].config(text=f"「{text}」")
        elif etype == "action":
            self.log.write(f"    → {text}", "action")
        elif etype == "damage":
            self.log.write(f"  * {text}", "damage")
        elif etype == "heal":
            self.log.write(f"  * {text}", "heal")
        elif etype == "death":
            self.log.write(f"  * {text}", "death")
        elif etype == "win":
            self.log.write(f"  ★ {text}", "win")
            self.status_var.set(text)
        elif etype == "error":
            self.log.write(f"  !! {text}", "error")
        elif etype == "think":
            self._handle_think(ev)
        elif etype == "info":
            self.log.write(f"    {text}")
        elif etype == "result":
            self._handle_result(ev)
        self._refresh_table()

    def _handle_think(self, ev: Dict) -> None:
        model_key = str(ev.get("model", ""))
        phase = str(ev.get("phase", "done"))
        row = self.model_rows.get(model_key)
        if phase == "start":
            if row:
                row["state"].config(text="思考中…", fg=GOLD)
            self.status_var.set(f"{model_key} 正在思考…")
        else:
            reason = str(ev.get("reasoning", ""))
            elapsed = float(ev.get("elapsed", 0) or 0)
            if row:
                row["state"].config(text=f"完成 · {elapsed:.1f}s", fg=MUTED)
            if reason:
                self.log.write(f"    （{model_key} 思考 {elapsed:.1f}s）{reason[:180]}", "think")

    def _handle_result(self, ev: Dict) -> None:
        result = ev.get("result")
        self.running = False
        try:
            name = result.winner_name or "无人获胜"
            turns = result.turns
            self.log.write(f"★ 本局结束：{name} 获胜（共 {turns} 回合，{result.elapsed:.0f}s）", "win")
            self.status_var.set(f"本局结束：{name} 获胜")
        except Exception:  # noqa: BLE001
            pass
        if self.auto_next.get():
            self.after(4000, self._start_game)
        else:
            self.status_var.set("本局结束（可点「开新局」）")

    # ------------------------------------------------------------ 刷新
    def _refresh_table(self) -> None:
        if not self.session:
            return
        engine = self.session.engine
        for idx, panel in enumerate(self.seat_panels):
            p = engine.player(idx)
            seat = self.session.seat_of(idx)
            active = engine.current == idx and engine.phase in ("play", "draw", "judge")
            text = ""
            row = self.model_rows.get(seat.model_key)
            if row and row["state"].cget("text") == "思考中…" and active:
                text = "思考中…"
            panel.update(p, seat.model_key, active, text)
        self.deck_label.config(
            text=f"牌堆 {len(engine.draw_pile)} 张   ·   弃牌堆 {len(engine.discard_pile)} 张   ·   第 {engine.turn_no} 回合"
        )
        self._refresh_hand(engine)

    def _refresh_hand(self, engine) -> None:
        for w in self.hand_row.winfo_children():
            w.destroy()
        if not engine.players:
            return
        idx = engine.current
        p = engine.player(idx)
        seat = self.session.seat_of(idx)
        self.hand_title.config(
            text=f"手牌 · {p.name}（{p.hero.name}） · 由 {seat.display or seat.model_key} 操控"
        )
        for card in p.hand:
            CardBtn(self.hand_row, card).pack(side="left", padx=4, pady=2)

    # ------------------------------------------------------------ 其他
    def _focus_seat(self, idx: int) -> None:
        if not self.session:
            return
        p = self.session.engine.player(idx)
        names = "、".join(f"{c.name}({c.suit}{c.rank})" for c in p.hand)
        self.log.write(f"    [查看] {p.name} 手牌：{names or '无'}", "action")

    def _export(self) -> None:
        if not self.session:
            return
        path = f"sanguosha_replay_{int(time.time())}.txt"
        try:
            with open(path, "w", encoding="utf-8") as f:
                for ev in self.session.engine.log:
                    f.write(f"[{ev.get('type')}] {ev.get('text')}\n")
            self.log.write(f"  战报已导出：{path}", "action")
        except Exception as e:  # noqa: BLE001
            self.log.write(f"  导出失败：{e}", "error")


def launch(cfg: GameConfig) -> None:
    app = GameApp(cfg)
    app.mainloop()
