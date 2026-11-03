"""游戏编排层：把状态机、Agent 层、LLM 串成一个可玩的循环。

MVP 闭环：
    玩家输入「我今天想做什么」
      → Agent 层产出叙事 + 3 个分支
      → 玩家选择
      → 确定性状态机结算资源 / 民心 / 信任
      → 记忆写回，下一次生成会翻旧账
"""
from __future__ import annotations

import os
import random
from typing import Any, Dict, List, Optional, Tuple

from .agents import AgentLayer
from .endings import evaluate
from .fallback.narrator import Narrator
from .llm.client import LLMClient
from .models import ActionOutcome, Choice, Ending, EventCard, NPC, Quest
from .rng import RNG
from .save import DEFAULT_SAVE_DIR, read_save, save_path, write_save
from .state import BUILDING_DEFS, TownState

#: effects -> 行为倾向标签（用于结局判定）
BEHAVIOR_TAGS: Dict[str, str] = {
    "kind": "mercy",
    "generous": "mercy",
    "popular": "mercy",
    "gift": "mercy",
    "patient": "mercy",
    "harsh": "harsh",
    "fear": "harsh",
    "greedy": "greed",
    "cheap": "greed",
    "trade": "trade",
    "work": "labor",
    "gather": "labor",
    "rest": "mercy",
    "festival": "mercy",
    "study": "curiosity",
    "scout": "curiosity",
    "bold": "bold",
    "law": "order",
    "cautious": "caution",
}


class Game:
    """一局游戏的全部运行时对象。"""

    def __init__(
        self,
        seed: Optional[int] = None,
        name: str = "临溪镇",
        llm: Optional[LLMClient] = None,
        offline: bool = False,
    ):
        self.seed = int(seed) if seed is not None else random.randrange(1, 10 ** 8)
        self.llm = llm if llm is not None else LLMClient()
        if offline:
            self.llm.backend = _offline_backend()
        self.narrator = Narrator(RNG(self.seed).spawn("narrator"))
        self.agents = AgentLayer(self.llm, self.narrator)
        self.state = TownState(name=name, seed=self.seed)
        self.pending: List[Choice] = []
        self.last_source = "template"
        self.today_report: Dict[str, Any] = {}
        self.finished = False

    # ------------------------------------------------------------------
    # 开局
    # ------------------------------------------------------------------
    def bootstrap(self) -> None:
        """生成居民、初始建筑、第一天的事件与主线。"""
        state = self.state
        npcs, source = self.agents.generate_npcs(state, count=8)
        state.npcs = npcs
        self.last_source = source

        # 初始家当：老镇长留下的一块农田和一间集市
        for kind, staff_n in (("farm", 2), ("market", 1)):
            ok, _ = state.build(kind)
            if ok and staff_n:
                b = state.buildings[-1]
                for npc in state.npcs[:staff_n]:
                    b.staff.append(npc.id)
                    npc.job = b.id
        state.add_log(f"你接任了{state.name}的镇长，前任只留下半本账和一间漏雨的屋。", "system")
        state.add_memory("quest", "你刚上任", ["start"])

        quest, qsrc = self.agents.generate_quest(state)
        state.quests = [quest]
        self.last_source = qsrc
        events, esrc = self.agents.generate_events(state, count=4)
        state.events = events
        self.last_source = esrc
        state.add_log(f"今天有 {len(events)} 件事等你拿主意。", "system")

    def new_game(self, name: str, seed: Optional[int] = None) -> None:
        self.seed = int(seed) if seed is not None else random.randrange(1, 10 ** 8)
        self.state = TownState(name=name, seed=self.seed)
        self.narrator = Narrator(RNG(self.seed).spawn("narrator"))
        self.agents.narrator = self.narrator
        self.pending = []
        self.finished = False
        self.bootstrap()

    # ------------------------------------------------------------------
    # 玩家行动
    # ------------------------------------------------------------------
    def detect_npc(self, text: str) -> Optional[NPC]:
        """从自由输入里认出要对话的人。"""
        if not text:
            return None
        for npc in self.state.npcs:
            if npc.alive and npc.name and npc.name in text:
                return npc
        for npc in self.state.npcs:
            if npc.alive and npc.role and npc.role in text:
                return npc
        return None

    def do_action(self, text: str) -> ActionOutcome:
        """MVP 核心循环第一拍：玩家说想做什么。"""
        state = self.state
        text = (text or "").strip()
        if not text:
            return ActionOutcome(narrative="（你什么也没说。）", source="system")

        focus = self.detect_npc(text)
        if focus is not None:
            outcome = self.talk_to(focus.id, text)
            return outcome

        narrative, choices, source = self.agents.narrate_action(state, text, None)
        self.pending = list(choices)
        self.last_source = source
        state.add_memory("action", f"镇长决定：{text}", ["action"])
        state.add_log(f"你决定：{text}", "action")
        return ActionOutcome(narrative=narrative, choices=choices, source=source)

    def choose(self, choice_id: str) -> ActionOutcome:
        """MVP 核心循环第二拍：玩家选分支 → 状态机结算。"""
        choice = None
        for c in self.pending:
            if c.id == choice_id:
                choice = c
                break
        if choice is None:
            for ev in self.state.events:
                for c in ev.choices:
                    if c.id == choice_id and not ev.resolved:
                        return self.resolve_event(ev.id, choice_id)
            return ActionOutcome(narrative="（这个选项已经不在了。）", source="system")
        return self.apply_choice(choice)

    def apply_choice(self, choice: Choice) -> ActionOutcome:
        state = self.state
        changes = state.resolve_effects(choice.effects)
        self._record_behavior(choice.effects)
        state.add_memory("event", f"你选择了「{choice.label}」", ["choice"] + list(choice.effects.keys())[:3])
        narrative = self._consequence(choice, changes)
        state.add_log(f"你选择了「{choice.label}」", "choice")
        self.pending = []
        return ActionOutcome(narrative=narrative, choices=[], changes=changes, source=self.last_source)

    def _record_behavior(self, effects: Dict[str, Any]) -> None:
        state = self.state
        for key in (effects or {}).keys():
            low = str(key).lower()
            tag = BEHAVIOR_TAGS.get(low)
            if tag:
                state.bump_behavior(tag)
                continue
            if low.startswith("build:"):
                state.bump_behavior("labor")
            elif low.startswith("relation:") or low == "all_trust":
                state.bump_behavior("social")
            elif low.startswith("flag:"):
                state.bump_behavior("curiosity")

    def _consequence(self, choice: Choice, changes: List[str]) -> str:
        """把结算结果写成一句话（不让 LLM 再跑一次，省时间也省额度）。"""
        if not changes:
            return f"你选择了「{choice.label}」。事情就这么定了，镇上暂时没有别的变化。"
        detail = "，".join(changes)
        if choice.hint:
            return f"你选择了「{choice.label}」（{choice.hint}）。{detail}。"
        return f"你选择了「{choice.label}」。{detail}。"

    # ------------------------------------------------------------------
    # 事件
    # ------------------------------------------------------------------
    def resolve_event(self, event_id: str, choice_id: str) -> ActionOutcome:
        state = self.state
        for ev in state.events:
            if ev.id != event_id:
                continue
            choice = None
            for c in ev.choices:
                if c.id == choice_id:
                    choice = c
                    break
            if choice is None:
                return ActionOutcome(narrative="（这个选项已经不在了。）", source="system")
            ev.resolved = True
            changes = state.resolve_effects(choice.effects)
            self._record_behavior(choice.effects)
            state.add_memory("event", f"「{ev.title}」——你选择了「{choice.label}」", ["event", ev.kind])
            narrative = f"{ev.title}\n\n{choice.label}。{('，'.join(changes) + '。') if changes else '镇上没有别的变化。'}"
            state.add_log(f"【{ev.title}】你选择了「{choice.label}」", "event")
            return ActionOutcome(narrative=narrative, choices=[], changes=changes, source=ev.source, event=ev)
        return ActionOutcome(narrative="（找不到这件事。）", source="system")

    def open_events(self) -> List[EventCard]:
        return [e for e in self.state.events if not e.resolved]

    # ------------------------------------------------------------------
    # 对话
    # ------------------------------------------------------------------
    def talk_to(self, npc_id: str, text: str) -> ActionOutcome:
        state = self.state
        npc = state.find_npc(npc_id)
        if npc is None:
            return ActionOutcome(narrative="（你找不到这个人。）", source="system")
        npc.met = True
        narrative, choices, source = self.agents.talk(state, npc, text)
        self.pending = list(choices)
        self.last_source = source
        state.add_memory("talk", f"你与{npc.name}谈：{text}", ["talk", npc.role])
        return ActionOutcome(narrative=f"{npc.name}（{npc.role}）\n\n{narrative}", choices=choices, source=source)

    # ------------------------------------------------------------------
    # 市场 / 建设
    # ------------------------------------------------------------------
    def buy(self, good: str, qty: int) -> Tuple[bool, str]:
        state = self.state
        if good in ("coin", "renown"):
            return False, "金币与声望不能买卖"
        price = state.market.sell_price(good)
        total = price * qty
        if state.resource("coin") < total:
            return False, f"金币不足，需要 {total}"
        state.resources["coin"] -= total
        if good in state.resources:
            state.resources[good] += qty
        else:
            state.stock[good] = state.stock_of(good) + qty
        state.add_memory("trade", f"买入 {qty} 份{good}，花费 {total} 金币", ["trade", "buy"])
        state.bump_behavior("trade")
        return True, f"买入 {qty} 份{good}，花费 {total} 金币"

    def sell(self, good: str, qty: int) -> Tuple[bool, str]:
        state = self.state
        if good in state.resources:
            if state.resource(good) < qty:
                return False, "库存不足"
            price = state.market.buy_price(good)
            gain = price * qty
            state.resources[good] -= qty
            state.resources["coin"] += gain
            state.add_memory("trade", f"卖出 {qty} 份{good}，收入 {gain} 金币", ["trade", "sell"])
            state.bump_behavior("trade")
            return True, f"卖出 {qty} 份{good}，收入 {gain} 金币"
        if state.stock_of(good) < qty:
            return False, "库存不足"
        price = state.market.buy_price(good)
        gain = price * qty
        state.stock[good] -= qty
        state.resources["coin"] += gain
        state.add_memory("trade", f"卖出 {qty} 份{good}，收入 {gain} 金币", ["trade", "sell"])
        state.bump_behavior("trade")
        return True, f"卖出 {qty} 份{good}，收入 {gain} 金币"

    def sell_to_caravan(self, good: str, qty: int) -> Tuple[bool, str]:
        state = self.state
        car = state.caravan
        if not car:
            return False, "现在没有商队在镇上"
        if good not in car.demands:
            return False, f"{car.name}不收{good}"
        if qty > car.demands[good]:
            return False, f"{car.name}最多收 {car.demands[good]} 份"
        if state.resource(good) < qty:
            return False, "库存不足"
        rate = state.market.price_of(good) * car.rate
        gain = int(round(rate * qty))
        state.resources[good] -= qty
        state.resources["coin"] += gain
        car.demands[good] -= qty
        state.add_memory("trade", f"把 {qty} 份{good}卖给{car.name}，收入 {gain} 金币", ["trade", "caravan"])
        state.bump_behavior("trade")
        if all(v <= 0 for v in car.demands.values()):
            state.add_log(f"{car.name}装满货物离开了。", "event")
            state.caravan = None
        return True, f"卖给{car.name} {qty} 份{good}，收入 {gain} 金币"

    def build(self, kind: str) -> Tuple[bool, str]:
        ok, msg = self.state.build(kind)
        if ok:
            self.state.bump_behavior("labor")
        return ok, msg

    def hire(self, npc_id: str, building_id: str) -> Tuple[bool, str]:
        return self.state.hire(npc_id, building_id)

    # ------------------------------------------------------------------
    # 推进一天
    # ------------------------------------------------------------------
    def advance_day(self) -> Dict[str, Any]:
        state = self.state
        report = state.tick_day()
        state.advance_calendar()
        events, source = self.agents.generate_events(state, count=4)
        state.events = events
        self.last_source = source
        report["new_events"] = events
        report["source"] = source
        state.add_log(
            f"第{state.day}天开始：{state.season}季，{state.weather}。人口 {state.population}，民心 {state.morale}。",
            "day",
        )
        return report

    # ------------------------------------------------------------------
    # 结局
    # ------------------------------------------------------------------
    def end_run(self) -> Ending:
        ending = evaluate(self.state)
        self.state.over = True
        self.state.ending = ending.to_dict()
        self.finished = True
        self.state.add_log(f"【结局】{ending.title}", "ending")
        return ending

    # ------------------------------------------------------------------
    # 存档
    # ------------------------------------------------------------------
    def to_payload(self) -> Dict[str, Any]:
        return {
            "state": self.state.to_dict(),
            "seed": self.seed,
            "pending": [c.to_dict() for c in self.pending],
            "last_source": self.last_source,
        }

    def save(self, path: Optional[str] = None) -> str:
        path = path or save_path(self.state.name, DEFAULT_SAVE_DIR)
        write_save(self.to_payload(), path)
        return path

    @classmethod
    def load(cls, path: str, llm: Optional[LLMClient] = None) -> "Game":
        data = read_save(path)
        if not data:
            raise ValueError("存档读取失败")
        st = data.get("state") or {}
        game = cls(seed=int(data.get("seed") or st.get("seed") or 0),
                   name=str(st.get("name", "临溪镇")), llm=llm)
        game.state = TownState.from_dict(st)
        game.pending = [Choice.from_dict(c) for c in (data.get("pending") or [])]
        game.last_source = str(data.get("last_source", "template"))
        game.finished = bool(game.state.over)
        return game

    # ------------------------------------------------------------------
    # 给 UI 用的摘要
    # ------------------------------------------------------------------
    def status_line(self) -> str:
        s = self.state
        return (
            f"第{s.year}年{s.season}季 第{s.day}天 · {s.weather} · "
            f"人口 {s.population} · 民心 {s.morale} · "
            f"金 {s.resource('coin')} 粮 {s.resource('food')} 木 {s.resource('wood')} "
            f"石 {s.resource('stone')} 矿 {s.resource('ore')} 望 {s.resource('renown')}"
        )

    def llm_label(self) -> str:
        if self.llm.online:
            return f"LLM：{self.llm.describe()}"
        return "LLM：离线（程序化叙述器）"


def _offline_backend():
    from .llm.client import OfflineBackend

    return OfflineBackend()
