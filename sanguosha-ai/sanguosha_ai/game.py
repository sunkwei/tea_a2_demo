"""对局编排：把引擎、模型策略、界面事件串起来。

一个 Session = 一局游戏：
  * 引擎只管规则；
  * 每个座位有一个策略对象（LLM 策略或人类策略）；
  * 引擎请求响应（出闪/桃）时，Session 转给对应座位的策略。
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Sequence

from .config import GameConfig, ModelSpec, MODEL_SPECS
from .engine import Action, Engine, Player, ResponseCtx
from .heroes import Hero, get_hero
from .llm.client import LlmClient
from .llm.policy import LlmPolicy, RulePolicy
from .rng import Rng

Emit = Callable[[Dict[str, object]], None]


@dataclass
class Seat:
    model_key: str
    hero_key: str
    policy: object  # 需要有 decide(engine, player, actions, turn_no) 与 respond(engine, player, ctx, actions)
    display: str = ""
    is_human: bool = False


@dataclass
class GameResult:
    winner: Optional[int] = None
    winner_name: str = ""
    turns: int = 0
    elapsed: float = 0.0
    stats: Dict[str, dict] = field(default_factory=dict)
    log: List[Dict[str, object]] = field(default_factory=list)


class Session:
    def __init__(
        self,
        cfg: GameConfig,
        seats: Sequence[Seat],
        emit: Optional[Emit] = None,
        engine: Optional[Engine] = None,
    ) -> None:
        self.cfg = cfg
        self.seats = list(seats)
        self.emit: Emit = emit or (lambda ev: None)
        heroes = [get_hero(s.hero_key) for s in self.seats]
        self.engine = engine or Engine(heroes, Rng(cfg.seed), emit=self.emit)
        self.engine.emit = self.emit
        self.human_queue = None  # 人类座位用（由 UI 注入）
        # 把策略的思考回调接到事件流上（界面显示「思考中」与推理摘要）
        for seat in self.seats:
            pol = getattr(seat, "policy", None)
            if pol is None or not hasattr(pol, "on_think"):
                continue
            key = seat.model_key
            emit = self.emit

            def _on_think(mk, reasoning, elapsed, ok, phase="done", _key=key, _emit=emit):
                _emit(
                    {
                        "type": "think",
                        "model": _key,
                        "reasoning": (reasoning or "")[:400],
                        "elapsed": elapsed,
                        "ok": ok,
                        "phase": phase,
                    }
                )

            pol.on_think = _on_think

    # ------------------------------------------------------------------
    def seat_of(self, idx: int) -> Seat:
        return self.seats[idx]

    def _emit(self, ev: Dict[str, object]) -> None:
        self.emit(ev)

    # ------------------------------------------------------------------
    def responder(self, ctx: ResponseCtx):
        """引擎请求响应 → 交给对应座位的策略。返回 (是否响应, 使用的牌 uid)。"""
        defender_idx = ctx.defender
        if defender_idx is None:
            return False, None
        seat = self.seat_of(defender_idx)
        player = self.engine.player(defender_idx)
        if not player.alive:
            return False, None
        actions = self.engine.legal_responses(player, ctx)
        if not actions:
            return False, None
        use_llm = self.cfg.llm_responses and not seat.is_human
        if use_llm:
            try:
                decision = seat.policy.respond(self.engine, player, ctx, actions)
            except Exception as e:  # noqa: BLE001
                self._emit({"type": "error", "text": f"{seat.model_key} 响应出错：{e}"})
                decision = RulePolicy().respond(self.engine, player, ctx, actions)
        else:
            decision = RulePolicy().respond(self.engine, player, ctx, actions)
        if decision.say:
            self._emit(
                {
                    "type": "say",
                    "text": decision.say,
                    "player": defender_idx,
                    "model": seat.model_key,
                }
            )
        act = decision.action
        if act.kind == "pass" or not act.card:
            return False, None
        return True, act.card

    # ------------------------------------------------------------------
    def play_phase(self, player: Player) -> None:
        seat = self.seat_of(player.idx)
        guard = 0
        while not self.engine.finished:
            guard += 1
            if guard > 40:
                self._emit({"type": "error", "text": "出牌阶段动作过多，强制结束。"})
                break
            if "skip_play" in player.skills_used:
                break
            actions = self.engine.legal_actions(player)
            if len(actions) <= 1:  # 只剩「结束出牌阶段」
                break
            try:
                decision = seat.policy.decide(self.engine, player, actions, self.engine.turn_no)
            except Exception as e:  # noqa: BLE001
                self._emit({"type": "error", "text": f"{seat.model_key} 决策出错：{e}"})
                decision = RulePolicy().decide(self.engine, player, actions)
            if decision.say:
                self._emit(
                    {
                        "type": "say",
                        "text": decision.say,
                        "player": player.idx,
                        "model": seat.model_key,
                    }
                )
            act = decision.action
            if act.kind == "end_phase":
                break
            self._emit(
                {
                    "type": "action",
                    "text": f"{player.name} 选择了：{act.label}",
                    "player": player.idx,
                    "model": seat.model_key,
                    "source": decision.source,
                }
            )
            try:
                ok = self.engine.apply_play(player, act, responder=self.responder)
            except Exception as e:  # noqa: BLE001
                self._emit({"type": "error", "text": f"执行动作出错：{e}"})
                ok = False
            if not ok:
                break

    # ------------------------------------------------------------------
    def run(self) -> GameResult:
        started = time.time()
        self.engine.setup()
        for p in self.engine.players:
            seat = self.seat_of(p.idx)
            p.model = seat.model_key
            p.seat_label = f"{p.idx + 1}号位 · {seat.display or seat.model_key}"
            self._emit(
                {
                    "type": "seat",
                    "text": f"{p.idx + 1}号位 {p.name}（{p.hero.name}）由 {seat.display or seat.model_key} 操控",
                    "player": p.idx,
                    "model": seat.model_key,
                }
            )
        turns = 0
        while not self.engine.finished and turns < self.cfg.max_turns:
            turns += 1
            idx = self.engine.current
            player = self.engine.player(idx)
            if player.alive:
                self.engine.start_turn(idx)
                if not self.engine.finished:
                    self.play_phase(player)
                if not self.engine.finished:
                    self.engine.phase_discard(player)
                self.engine.phase = "end"
            # 下一个存活角色
            nxt = (idx + 1) % len(self.engine.players)
            guard = 0
            while not self.engine.players[nxt].alive and guard < len(self.engine.players):
                nxt = (nxt + 1) % len(self.engine.players)
                guard += 1
            self.engine.current = nxt
        if not self.engine.finished:
            self._emit({"type": "info", "text": f"达到回合上限 {self.cfg.max_turns}，对局结束。"})
        result = GameResult(
            winner=self.engine.winner,
            winner_name=self.engine.players[self.engine.winner].name if self.engine.winner is not None else "",
            turns=self.engine.turn_no,
            elapsed=time.time() - started,
            log=list(self.engine.log),
        )
        for idx, seat in enumerate(self.seats):
            stats = getattr(seat.policy, "stats", None)
            if stats:
                result.stats[seat.model_key] = dict(stats)
        return result


# ----------------------------------------------------------------------
def build_default_session(
    cfg: GameConfig,
    seats: Optional[List[Seat]] = None,
    emit: Optional[Emit] = None,
    human_models: Optional[set] = None,
) -> Session:
    """按配置生成一局的座位（默认三个模型各带一名武将）。"""
    from .heroes import DEFAULT_LINEUP

    human_models = human_models or set()
    if seats is None:
        seats = []
        for key in cfg.seats:
            hero_key = cfg.hero_for(key) or DEFAULT_LINEUP.get(key, "zhang_fei")
            spec = MODEL_SPECS.get(key)
            if spec is None:
                raise KeyError(f"未知模型：{key}")
            client = LlmClient(spec, timeout=cfg.llm_timeout)
            policy = LlmPolicy(client, key)
            seats.append(
                Seat(
                    model_key=key,
                    hero_key=hero_key,
                    policy=policy,
                    display=spec.display,
                )
            )
    return Session(cfg, seats, emit=emit)
