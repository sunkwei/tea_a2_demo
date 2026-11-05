"""HTTP + SSE 后端：驱动对局，把事件和状态快照实时推给浏览器。

零第三方依赖（只用标准库），所以 `python main.py --web` 就能跑。

接口：
  GET  /api/state    → 当前对局状态快照（JSON）
  GET  /api/events   → SSE 事件流（每条都是 {ev, state}）
  POST /api/start    → 开新局（可选 body: {"seed": 20261105, "max_turns": 60}）
  POST /api/stop     → 停掉当前对局
  GET  /             → 静态页面（web/ 目录）
"""

from __future__ import annotations

import json
import queue
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Dict, List, Optional
from urllib.parse import urlparse

from .config import GameConfig, MODEL_SPECS
from .game import Seat, Session
from .heroes import DEFAULT_LINEUP
from .llm.client import LlmClient
from .llm.policy import LlmPolicy

WEB_DIR = Path(__file__).resolve().parent.parent / "web"


class Hub:
    """SSE 广播中心。"""

    def __init__(self) -> None:
        self._clients: List["queue.Queue[Dict]"] = []
        self._lock = threading.Lock()

    def subscribe(self) -> "queue.Queue[Dict]":
        q: "queue.Queue[Dict]" = queue.Queue(maxsize=500)
        with self._lock:
            self._clients.append(q)
        return q

    def unsubscribe(self, q: "queue.Queue[Dict]") -> None:
        with self._lock:
            if q in self._clients:
                self._clients.remove(q)

    def publish(self, payload: Dict) -> None:
        with self._lock:
            clients = list(self._clients)
        for q in clients:
            try:
                q.put_nowait(payload)
            except queue.Full:
                pass


class GameRunner:
    """管理一局（或多局连续）对局。"""

    def __init__(self, cfg: GameConfig) -> None:
        self.cfg = cfg
        self.hub = Hub()
        self.session: Optional[Session] = None
        self.thread: Optional[threading.Thread] = None
        self.lock = threading.Lock()
        self.model_state: Dict[str, Dict[str, object]] = {}
        self.running = False
        self.games_played = 0
        self.auto_next = True

    # ------------------------------------------------------------------
    def _emit(self, ev: Dict) -> None:
        etype = str(ev.get("type", "info"))
        mk = str(ev.get("model", "") or "")
        if mk:
            st = self.model_state.setdefault(mk, {"state": "等待中", "elapsed": 0.0, "say": ""})
            if etype == "think":
                if ev.get("phase") == "start":
                    st["state"] = "思考中…"
                else:
                    st["state"] = "待命"
                    st["elapsed"] = float(ev.get("elapsed", 0) or 0)
            elif etype == "say":
                st["say"] = str(ev.get("text", ""))
        self.hub.publish({"ev": ev, "state": self.snapshot()})

    # ------------------------------------------------------------------
    def snapshot(self) -> Dict:
        with self.lock:
            session = self.session
        players: List[Dict] = []
        current = 0
        phase = ""
        turn = 0
        deck = 0
        discard = 0
        finished = False
        winner = None
        if session is not None:
            engine = session.engine
            current = engine.current
            phase = engine.phase
            turn = engine.turn_no
            deck = len(engine.draw_pile)
            discard = len(engine.discard_pile)
            finished = engine.finished
            winner = engine.winner
            for p in engine.players:
                seat = session.seat_of(p.idx)
                players.append(
                    {
                        "idx": p.idx,
                        "name": p.name,
                        "hero": p.hero.name,
                        "faction": p.hero.faction,
                        "title": p.hero.title,
                        "gender": p.hero.gender,
                        "hp": p.hp,
                        "max_hp": p.max_hp,
                        "alive": p.alive,
                        "model": seat.model_key,
                        "model_label": seat.display or seat.model_key,
                        "skills": [{"name": s.name, "desc": s.desc} for s in p.hero.skills],
                        "hand": [c.to_dict() for c in p.hand],
                        "equips": [c.to_dict() for c in p.equips.values()],
                        "delayed": [c.name for c in engine.delayed.get(p.idx, [])],
                    }
                )
        return {
            "players": players,
            "current": current,
            "phase": phase,
            "turn": turn,
            "deck": deck,
            "discard": discard,
            "finished": finished,
            "winner": winner,
            "running": self.running,
            "games": self.games_played,
            "models": self.model_state,
        }

    # ------------------------------------------------------------------
    def start(self, seed: Optional[int] = None, max_turns: Optional[int] = None) -> Dict:
        if self.running:
            return {"ok": False, "error": "已有对局在进行中"}
        cfg = self.cfg
        if seed is not None:
            cfg.seed = int(seed)
        if max_turns is not None:
            cfg.max_turns = int(max_turns)
        seats: List[Seat] = []
        for key in cfg.seats:
            spec = MODEL_SPECS[key]
            client = LlmClient(spec, timeout=cfg.llm_timeout)
            policy = LlmPolicy(client, key)
            hero_key = cfg.hero_for(key) or DEFAULT_LINEUP.get(key, "zhang_fei")
            seats.append(Seat(model_key=key, hero_key=hero_key, policy=policy, display=spec.display))
        session = Session(cfg, seats, emit=self._emit)
        with self.lock:
            self.session = session
        self.running = True
        self.model_state = {
            s.model_key: {"state": "等待中", "elapsed": 0.0, "say": ""} for s in seats
        }

        def _run() -> None:
            try:
                result = session.run()
                self.games_played += 1
                self._emit(
                    {
                        "type": "result",
                        "text": f"本局结束：{result.winner_name or '无人获胜'}（{result.turns} 回合，{result.elapsed:.0f}s）",
                        "winner": result.winner_name,
                    }
                )
            except Exception as e:  # noqa: BLE001
                self._emit({"type": "error", "text": f"对局异常：{e}"})
            finally:
                self.running = False
                self._emit({"type": "state", "text": ""})
                if self.auto_next:
                    threading.Timer(6.0, self._auto_start).start()

        self.thread = threading.Thread(target=_run, daemon=True)
        self.thread.start()
        return {"ok": True, "seed": cfg.seed}

    def _auto_start(self) -> None:
        """一局结束后自动开下一局（网页端可以一直看着打）。"""
        if not self.auto_next or self.running:
            return
        self._emit({"type": "phase", "text": f"—— 第 {self.games_played + 1} 局 ——"})
        self.start()


class Handler(SimpleHTTPRequestHandler):
    runner: GameRunner = None  # 由 create_server 注入

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    # ---------------- 工具 ----------------
    def _json(self, obj: Dict, code: int = 200) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args) -> None:  # 静音访问日志
        pass

    # ---------------- 路由 ----------------
    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/api/state":
            self._json(self.runner.snapshot())
            return
        if path == "/api/events":
            self._sse()
            return
        if path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return
        if path == "/" or path == "/index.html":
            self.path = "/index.html"
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw.decode("utf-8") or "{}")
        except Exception:  # noqa: BLE001
            data = {}
        if path == "/api/start":
            self._json(self.runner.start(data.get("seed"), data.get("max_turns")))
            return
        if path == "/api/stop":
            self.runner.running = False
            self._json({"ok": True})
            return
        self._json({"ok": False, "error": "unknown endpoint"}, 404)

    # ---------------- SSE ----------------
    def _sse(self) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        q = self.runner.hub.subscribe()
        try:
            self._write({"ev": {"type": "hello", "text": "connected"}, "state": self.runner.snapshot()})
            last_beat = time.time()
            while True:
                try:
                    payload = q.get(timeout=1.0)
                    self._write(payload)
                except queue.Empty:
                    if time.time() - last_beat > 15:
                        last_beat = time.time()
                        self.wfile.write(b": ping\n\n")
                        self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            self.runner.hub.unsubscribe(q)

    def _write(self, payload: Dict) -> None:
        data = json.dumps(payload, ensure_ascii=False)
        self.wfile.write(f"data: {data}\n\n".encode("utf-8"))
        self.wfile.flush()


def create_server(cfg: GameConfig, host: str = "127.0.0.1", port: int = 8765) -> ThreadingHTTPServer:
    runner = GameRunner(cfg)
    handler = type("BoundHandler", (Handler,), {"runner": runner})
    httpd = ThreadingHTTPServer((host, port), handler)
    httpd.runner = runner  # type: ignore[attr-defined]
    return httpd


def serve(cfg: GameConfig, host: str = "127.0.0.1", port: int = 8765, open_browser: bool = False) -> None:
    httpd = create_server(cfg, host, port)
    # 启动后自动开一局，网页连上就有东西看
    threading.Thread(target=lambda: (time.sleep(0.6), httpd.runner.start()), daemon=True).start()
    url = f"http://{host}:{port}/"
    print(f"AI 三国杀 服务已启动：{url}")
    print("（前端页面在 web/ 目录，开发时用 vite：npm run dev -- --open /sanguosha/ ）")
    if open_browser:
        try:
            import webbrowser

            webbrowser.open(url)
        except Exception:  # noqa: BLE001
            pass
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
    finally:
        httpd.server_close()
