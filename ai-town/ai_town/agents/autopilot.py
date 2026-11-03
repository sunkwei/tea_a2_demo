"""自动游玩：让 AI 代替玩家当镇长。

两种策略：
  * RulePolicy —— 纯规则（读世界状态挑行动、挑分支），离线可用、零延迟、可复现；
  * LLMPolicy  —— 让 LLM 当镇长的大脑（一次调用给出「今天做什么 + 每件事怎么裁 + 倾向」），
                  解析失败自动退回 RulePolicy。

两种策略都通过 `Game` 的公开接口操作世界（do_action / resolve_event / advance_day），
所以自动玩和真人玩是同一条代码路径，规则完全一致。
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from ..game import Game
from ..llm import prompts
from ..models import Choice, EventCard
from ..state import BUILDING_DEFS, TownState

PREFERENCES = ("省钱", "求稳", "施恩", "冒险", "追查")

AUTOPILOT_SYSTEM = (
    "你是中文模拟经营游戏《AI 小镇：无限人生》的镇长 AI，代替玩家做决定。只输出 JSON。"
)


@dataclass
class Decision:
    """镇长（或 AI）的一天决策。"""

    action: str = "在镇上转一圈，看看大家怎么样"
    event_picks: List[int] = field(default_factory=list)   # 与事件序号一一对应
    preference: str = "求稳"
    why: str = ""
    source: str = "rule"

    def pick_for(self, index: int, default: int = 0) -> int:
        if 0 <= index < len(self.event_picks):
            return int(self.event_picks[index])
        return default


# --------------------------------------------------------------------------
# 规则策略
# --------------------------------------------------------------------------
class RulePolicy:
    """读世界状态挑行动、挑分支。完全确定性。"""

    name = "rule"

    # -- 行动 -----------------------------------------------------------
    def choose_action(self, game: Game, events: List[EventCard]) -> str:
        st = game.state
        pop = max(1, st.population)
        if st.resource("food") < pop * 2:
            return "开仓放粮，先把饥民安抚住"
        if st.morale < 45:
            return "挨家挨户安抚镇民，听听他们到底要什么"
        if st.caravan is not None and st.resource("coin") < 120:
            want = list(st.caravan.demands.keys())
            if want:
                return f"把{stock_label(want[0])}卖给{st.caravan.name}"
        # 缺什么建什么
        need = _needed_building(st)
        if need:
            d = BUILDING_DEFS[need]
            if st.resource("coin") >= d["cost"]["coin"]:
                return f"在镇外空地上开建一座{d['name']}"
        # 还没打过招呼的人
        strangers = [n for n in st.npcs if n.alive and not n.met]
        if strangers:
            return f"去找{strangers[0].name}单独聊聊"
        quest = st.active_quest()
        if quest is not None:
            return f"追查「{quest.title}」里那件还没弄清的事"
        if st.resource("coin") > 220 and st.free_tiles():
            return "把剩下的钱投到镇子的长远建设上"
        return "在镇上转一圈，看看大家怎么样"

    # -- 分支 -----------------------------------------------------------
    def choose_branch(self, event: EventCard, index: int, preference: str) -> int:
        n = len(event.choices)
        if n == 0:
            return 0
        if preference == "省钱":
            # 挑最省钱的一支
            best, best_cost = 0, None
            for i, c in enumerate(event.choices):
                cost = 0
                for k, v in (c.effects or {}).items():
                    if k == "coin" and isinstance(v, (int, float)):
                        cost += int(v)
                if best_cost is None or cost < best_cost:
                    best, best_cost = i, cost
            return best
        if preference == "施恩":
            for i, c in enumerate(event.choices):
                if any(k in (c.effects or {}) for k in ("kind", "mercy", "all_trust", "morale")):
                    if "coin" not in (c.effects or {}):
                        return i
            return 0
        if preference == "冒险":
            for i, c in enumerate(event.choices):
                if "risk" in (c.effects or {}):
                    return i
        # 求稳 / 追查：按事件类型挑
        kind = event.kind
        if kind == "disaster":
            return min(1, n - 1)
        if kind == "social":
            return min(1, n - 1)
        if kind == "opportunity":
            return 0
        if kind == "mystery":
            return 0
        return 0

    # -- 对外 -----------------------------------------------------------
    def decide(self, game: Game, events: List[EventCard]) -> Decision:
        action = self.choose_action(game, events)
        pref = "求稳"
        st = game.state
        pop = max(1, st.population)
        if st.resource("food") < pop * 2:
            pref = "施恩"
        elif st.morale < 45:
            pref = "施恩"
        elif st.resource("coin") < 80:
            pref = "省钱"
        elif st.active_quest() is not None:
            pref = "追查"
        picks = [self.choose_branch(ev, i, pref) for i, ev in enumerate(events)]
        return Decision(action=action, event_picks=picks, preference=pref,
                        why="规则策略", source="rule")


def stock_label(key: str) -> str:
    return {"food": "粮食", "wood": "木材", "stone": "石料", "ore": "矿石",
            "tools": "工具", "books": "书籍", "liquor": "烈酒"}.get(key, key)


def _needed_building(st: TownState) -> Optional[str]:
    """按缺口挑最该建的建筑。"""
    pop = max(1, st.population)
    kinds = {b.kind for b in st.buildings}
    if st.resource("food") < pop * 3 and "farm" not in kinds:
        return "farm"
    if st.resource("wood") < 20 and "lumber" not in kinds:
        return "lumber"
    if st.resource("stone") < 15 and "quarry" not in kinds:
        return "quarry"
    if st.resource("coin") < 120 and "market" not in kinds:
        return "market"
    if "tavern" not in kinds and st.morale < 70:
        return "tavern"
    if "clinic" not in kinds and st.morale < 80:
        return "clinic"
    return None


# --------------------------------------------------------------------------
# LLM 策略
# --------------------------------------------------------------------------
class LLMPolicy:
    """让 LLM 当镇长的大脑。一次调用给出：今天做什么 + 每件事怎么裁 + 倾向。"""

    name = "llm"

    def __init__(self, llm: Any):
        self.llm = llm

    def _prompt(self, game: Game, events: List[EventCard]) -> str:
        st = game.state
        lines = [st.world_brief()]
        if events:
            lines.append("今天要处理的事：")
            for i, ev in enumerate(events):
                opts = " / ".join(c.label for c in ev.choices) or "（无）"
                lines.append(f"{i}. {ev.title} —— {ev.text[:60]}… 可选：{opts}")
        recent = [f"- 第{m.day}天：{m.text}" for m in st.memory[-6:]]
        if recent:
            lines.append("最近：\n" + "\n".join(recent))
        lines.append(
            "输出格式：{\"action\":\"镇长今天要做的一件具体的事\",\"preference\":\""
            + "|".join(PREFERENCES) + "\",\"why\":\"一句理由\",\"picks\":[分支序号…]}"
        )
        lines.append(f"picks 与事件序号一一对应，0/1/2 表示选该事件的第几个分支；没有事件就给空数组。")
        return "\n".join(lines)

    def decide(self, game: Game, events: List[EventCard]) -> Optional[Decision]:
        if not self.llm or not getattr(self.llm, "online", False):
            return None
        data, _raw, err = self.llm.complete_json(AUTOPILOT_SYSTEM, self._prompt(game, events), json_mode=True)
        if data is None or not isinstance(data, dict):
            return None
        action = str(data.get("action") or "").strip()[:80]
        if not action:
            return None
        pref = str(data.get("preference") or "求稳").strip()
        if pref not in PREFERENCES:
            pref = "求稳"
        picks_raw = data.get("picks")
        picks: List[int] = []
        if isinstance(picks_raw, list):
            for v in picks_raw:
                try:
                    picks.append(int(v))
                except Exception:
                    picks.append(0)
        while len(picks) < len(events):
            picks.append(0)
        return Decision(action=action, event_picks=picks[: len(events)], preference=pref,
                        why=str(data.get("why") or "")[:120], source="llm")


# --------------------------------------------------------------------------
# 自动游玩
# --------------------------------------------------------------------------
class Autopilot:
    """自动镇长：处理事件 → 采取行动 → 推进一天。"""

    def __init__(self, game: Game, policy: str = "auto"):
        self.game = game
        self.rule = RulePolicy()
        self.llm_policy = LLMPolicy(game.llm)
        self.policy = policy
        self.log: List[Dict[str, Any]] = []

    # -- 决策 -----------------------------------------------------------
    def decide(self, events: List[EventCard]) -> Decision:
        mode = self.policy
        if mode == "rule":
            return self.rule.decide(self.game, events)
        decision = None
        if mode in ("auto", "llm"):
            decision = self.llm_policy.decide(self.game, events)
        if decision is None:
            decision = self.rule.decide(self.game, events)
        # LLM 给了行动，但分支没覆盖时用规则补
        picks = []
        for i, ev in enumerate(events):
            if i < len(decision.event_picks):
                idx = int(decision.event_picks[i])
                if 0 <= idx < len(ev.choices):
                    picks.append(idx)
                    continue
            picks.append(self.rule.choose_branch(ev, i, decision.preference))
        decision.event_picks = picks
        return decision

    def pick_branch(self, choices: List[Choice], preference: str, event: Optional[EventCard] = None) -> int:
        """挑一个真的会改变世界的分支：优先选有 effects 的，再按偏好微调。"""
        if not choices:
            return 0
        effective = [i for i, c in enumerate(choices) if c.effects]
        if not effective:
            return 0
        idx = self.rule.choose_branch(event, 0, preference) if event is not None else 0
        if idx not in effective:
            idx = effective[0]
            if preference == "省钱":
                def cost(i: int) -> int:
                    return sum(int(v) for k, v in (choices[i].effects or {}).items()
                               if k == "coin" and isinstance(v, (int, float)))
                idx = min(effective, key=cost)
            elif preference == "施恩":
                for i in effective:
                    if any(k in (choices[i].effects or {}) for k in ("kind", "mercy", "all_trust", "morale")):
                        idx = i
                        break
        return idx

    # -- 一天 -----------------------------------------------------------
    def step(self) -> Dict[str, Any]:
        game = self.game
        state = game.state
        events = game.open_events()
        decision = self.decide(events)
        entry: Dict[str, Any] = {
            "day": state.day,
            "season": state.season,
            "weather": state.weather,
            "decision": decision.action,
            "why": decision.why,
            "preference": decision.preference,
            "source": decision.source,
            "events": [],
            "narrative": "",
            "changes": [],
        }

        # 1) 裁事件
        for i, ev in enumerate(events):
            if not ev.choices:
                continue
            idx = decision.pick_for(i, 0)
            if not (0 <= idx < len(ev.choices)):
                idx = 0
            ch = ev.choices[idx]
            out = game.resolve_event(ev.id, ch.id)
            entry["events"].append({
                "title": ev.title, "choice": ch.label,
                "changes": out.changes, "kind": ev.kind,
            })

        # 2) 镇长行动
        outcome = game.do_action(decision.action)
        entry["narrative"] = outcome.narrative
        if outcome.choices:
            idx = self.pick_branch(outcome.choices, decision.preference)
            res = game.apply_choice(outcome.choices[idx])
            entry["changes"] = res.changes
            entry["choice"] = outcome.choices[idx].label

        # 3) 推进一天
        report = game.advance_day()
        entry["notes"] = report.get("notes", [])
        entry["world"] = {
            "pop": state.population,
            "morale": state.morale,
            "coin": state.resource("coin"),
            "food": state.resource("food"),
        }
        self.log.append(entry)
        return entry
