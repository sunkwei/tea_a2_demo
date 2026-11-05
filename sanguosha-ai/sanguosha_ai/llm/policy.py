"""决策层：让模型选动作，以及模型失败时的规则兜底。

模型只需要在「合法动作列表」里挑一个编号（1..N），
这样即使模型胡说八道，我们也能保证执行的动作一定是合法的（不会把游戏玩崩）。
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import List, Optional, Sequence, Tuple

from ..engine import Action, Engine, Player, ResponseCtx
from .client import ChatResult, LlmClient
from .parsing import extract_int, extract_json, extract_str
from .prompts import build_play_prompt, build_respond_prompt, build_respond_system_prompt, build_system_prompt


@dataclass
class Decision:
    action: Action
    say: str = ""
    reason: str = ""
    source: str = "llm"  # llm / rule
    elapsed: float = 0.0
    error: str = ""
    raw: str = ""
    extra: dict = field(default_factory=dict)


def _match_by_text(actions: Sequence[Action], text: str) -> Optional[Action]:
    """模型没给编号时，尝试按「牌名 + 目标名」在合法动作里找一条。"""
    if not text:
        return None
    best = None
    best_score = 0
    for a in actions:
        score = 0
        for kw in ("杀", "闪", "桃", "酒", "无懈可击", "装备", "结束出牌"):
            if kw in text and kw in a.label:
                score += 1
        for other in actions:
            pass
        if score > best_score:
            best, best_score = a, score
    return best if best_score > 0 else None


class RulePolicy:
    """规则兜底：模型不可用 / 解析失败时使用，保证对局能继续。"""

    name = "规则策略"

    def decide(
        self,
        engine: Engine,
        player: Player,
        actions: Sequence[Action],
        turn_no: int = 0,
    ) -> Decision:
        by_id = {a.id: a for a in actions}
        # 1) 救命优先
        if player.hp <= 2 and player.hp < player.max_hp:
            for a in actions:
                if a.kind == "play" and a.label.startswith("使用【桃】"):
                    return Decision(action=a, say="稳住！", source="rule", reason="低血量先回血")
        # 2) 装备
        for a in actions:
            if a.kind == "play" and a.label.startswith("装备"):
                return Decision(action=a, say="披挂上阵！", source="rule", reason="先上装备")
        # 3) 杀：优先打残血目标
        shas = [a for a in actions if a.kind in ("play", "skill") and a.as_card == "杀"]
        if shas:
            def hp_of(a: Action) -> int:
                return engine.player(a.target).hp if a.target is not None else 99

            target = sorted(shas, key=hp_of)[0]
            return Decision(action=target, say="受死吧！", source="rule", reason="攻击残血目标")
        # 群体锦囊：能打一片就打一片
        aoe = [
            a
            for a in actions
            if a.kind == "play" and (a.label.startswith("使用【南蛮入侵】") or a.label.startswith("使用【万箭齐发】"))
        ]
        if aoe and len(engine.opponents_of(player.idx)) >= 2:
            return Decision(action=aoe[0], say="统统受死！", source="rule", reason="群体锦囊")
        # 有酒先喝（准备打致命一击）
        jiu = [a for a in actions if a.kind == "play" and a.label == "使用【酒】"]
        if jiu and any(
            engine.player(a.target).hp <= 1 for a in shas if a.target is not None
        ):
            return Decision(action=jiu[0], say="干了这杯！", source="rule", reason="酒 + 杀")
        # 4) 仁德：牌多时把牌分出去
        rende = [a for a in actions if a.extra.get("skill") == "rende"]
        if rende and len(player.hand) >= 5:
            low = min(
                (p for p in engine.opponents_of(player.idx)),
                key=lambda p: p.hp,
                default=None,
            )
            for a in rende:
                if low is not None and a.target == low.idx:
                    return Decision(action=a, say="接着！", source="rule", reason="仁德支援")
        end = by_id.get("end_phase")
        if end:
            return Decision(action=end, say="暂且收手。", source="rule", reason="无可行动作")
        if actions:
            return Decision(action=actions[0], source="rule")
        raise RuntimeError("没有合法动作")

    def respond(self, engine: Engine, player: Player, ctx: ResponseCtx, actions: Sequence[Action]) -> Decision:
        prefer = {"dodge": "resp:shan", "kill": "resp:sha", "rescue": "resp:tao"}
        want = prefer.get(ctx.kind, "")
        if want:
            for a in actions:
                if a.id.startswith(want):
                    return Decision(action=a, say="接着！", source="rule", reason="规则响应")
        return Decision(action=actions[-1], source="rule")


class LlmPolicy:
    """模型决策：提示词 → JSON → 合法动作；失败则回落到规则策略。"""

    def __init__(
        self,
        client: LlmClient,
        model_key: str,
        rule_policy: Optional[RulePolicy] = None,
        on_think=None,
        on_error=None,
    ) -> None:
        self.client = client
        self.model_key = model_key
        self.rule = rule_policy or RulePolicy()
        self.on_think = on_think
        self.on_error = on_error
        self.stats = {"llm": 0, "rule": 0, "error": 0}

    # ------------------------------------------------------------------
    def _handle_error(self, msg: str) -> None:
        self.stats["error"] += 1
        if self.on_error:
            try:
                self.on_error(msg)
            except Exception:  # noqa: BLE001
                pass

    def _pick_index(self, raw: str, actions: Sequence[Action]) -> Optional[int]:
        data = extract_json(raw)
        idx = None
        if isinstance(data, dict):
            for k in ("n", "action", "index", "i", "choice", "动作", "编号"):
                if k in data:
                    v = data[k]
                    if isinstance(v, bool):
                        continue
                    if isinstance(v, (int, float)):
                        idx = int(v)
                        break
                    if isinstance(v, str) and v.strip().isdigit():
                        idx = int(v.strip())
                        break
        if idx is None:
            idx = extract_int(raw)
        if idx is None and isinstance(data, str):
            idx = extract_int(data)
        if idx is None and isinstance(data, list) and data:
            first = data[0]
            if isinstance(first, dict):
                for k in ("n", "action", "index"):
                    if isinstance(first.get(k), (int, float)):
                        idx = int(first[k])
                        break
        if idx is not None and 1 <= idx <= len(actions):
            return idx
        return None

    def _say_of(self, raw: str, data) -> str:
        say = ""
        if isinstance(data, dict):
            for k in ("say", "taunt", "line", "台词", "说"):
                v = data.get(k)
                if isinstance(v, str) and v.strip():
                    say = v.strip()
                    break
        if not say:
            say = extract_str(raw)
        return say[:40]

    # ------------------------------------------------------------------
    def decide(
        self,
        engine: Engine,
        player: Player,
        actions: Sequence[Action],
        turn_no: int,
    ) -> Decision:
        if not actions:
            raise RuntimeError("没有合法动作")
        if not self.client.available:
            self._handle_error("模型未配置")
            d = self.rule.decide(engine, player, actions)
            d.source = "rule"
            self.stats["rule"] += 1
            return d
        system = build_system_prompt(player, self.model_key)
        user = build_play_prompt(engine, player, actions, turn_no)
        if self.on_think:
            try:
                self.on_think(self.model_key, "", 0.0, True, "start")
            except Exception:  # noqa: BLE001
                pass
        res: ChatResult = self.client.chat(system, user)
        raw = res.raw or res.content or res.reasoning or ""
        if self.on_think:
            try:
                self.on_think(self.model_key, res.reasoning, res.elapsed, res.ok, "done")
            except Exception:  # noqa: BLE001
                pass
        data = extract_json(raw)
        idx = self._pick_index(raw, actions)
        if idx is None:
            alt = _match_by_text(actions, raw)
            if alt is not None:
                self.stats["llm"] += 1
                return Decision(
                    action=alt,
                    say=self._say_of(raw, data),
                    reason="按文本匹配",
                    source="llm",
                    elapsed=res.elapsed,
                    error=res.error,
                    raw=raw,
                )
            self._handle_error(res.error or f"无法解析模型输出：{raw[:120]}")
            d = self.rule.decide(engine, player, actions)
            d.source = "rule"
            d.error = res.error
            self.stats["rule"] += 1
            return d
        self.stats["llm"] += 1
        return Decision(
            action=actions[idx - 1],
            say=self._say_of(raw, data),
            reason="模型选择",
            source="llm",
            elapsed=res.elapsed,
            error=res.error,
            raw=raw,
        )

    def respond(
        self,
        engine: Engine,
        player: Player,
        ctx: ResponseCtx,
        actions: Sequence[Action],
    ) -> Decision:
        if not actions:
            raise RuntimeError("没有合法响应")
        if not self.client.available:
            d = self.rule.respond(engine, player, ctx, actions)
            self.stats["rule"] += 1
            return d
        system = build_respond_system_prompt(player)
        user = build_respond_prompt(engine, player, ctx, actions)
        if self.on_think:
            try:
                self.on_think(self.model_key, "", 0.0, True, "start")
            except Exception:  # noqa: BLE001
                pass
        res = self.client.chat(system, user)
        raw = res.raw or res.content or res.reasoning or ""
        if self.on_think:
            try:
                self.on_think(self.model_key, res.reasoning, res.elapsed, res.ok, "done")
            except Exception:  # noqa: BLE001
                pass
        data = extract_json(raw)
        idx = self._pick_index(raw, actions)
        if idx is None:
            alt = _match_by_text(actions, raw)
            if alt is not None:
                self.stats["llm"] += 1
                return Decision(action=alt, say=self._say_of(raw, data), source="llm", elapsed=res.elapsed)
            self._handle_error(res.error or f"无法解析模型输出：{raw[:120]}")
            d = self.rule.respond(engine, player, ctx, actions)
            d.source = "rule"
            self.stats["rule"] += 1
            return d
        self.stats["llm"] += 1
        return Decision(
            action=actions[idx - 1],
            say=self._say_of(raw, data),
            source="llm",
            elapsed=res.elapsed,
            error=res.error,
            raw=raw,
        )
