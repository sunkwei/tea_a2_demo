"""Agent 层：把 LLM 与程序化叙述器包装成游戏玩法。

每一层都遵循同一个契约：
    返回 (内容, 来源标记)
LLM 失败 / 输出不可用时，自动退回程序化叙述器，游戏永远能往下走。
"""
from __future__ import annotations

from typing import List, Optional, Tuple

from ..fallback.narrator import Narrator
from ..llm import client as llm_client
from ..llm import prompts
from ..llm.parsing import coerce_action, coerce_events, coerce_npcs, sanitize_effects
from ..models import Choice, EventCard, NPC, Quest
from ..state import TownState


class AgentLayer:
    def __init__(self, llm: Optional[llm_client.LLMClient] = None, narrator: Optional[Narrator] = None):
        self.llm = llm or llm_client.LLMClient()
        self.narrator = narrator or Narrator()
        self.last_source = "template"
        self.last_error = ""

    # -- 工具 -----------------------------------------------------------
    def _online(self) -> bool:
        return bool(self.llm and self.llm.online)

    def _json(self, system: str, prompt: str) -> Optional[object]:
        data, raw, err = self.llm.complete_json(system, prompt, json_mode=True)
        if data is None:
            self.last_error = err or "JSON 解析失败"
            return None
        return data

    # ------------------------------------------------------------------
    # NPC 生成
    # ------------------------------------------------------------------
    def generate_npcs(self, state: TownState, count: int = 8) -> Tuple[List[NPC], str]:
        if self._online():
            data = self._json(prompts.NPC_SYSTEM, prompts.npc_prompt(state, count))
            npcs = coerce_npcs(data, state.day) if data is not None else []
            npcs = [n for n in npcs if n.name and n.role]
            if len(npcs) >= 3:
                self._decorate(state, npcs)
                self.last_source = "llm"
                return npcs, "llm"
            self.last_error = "LLM 返回的居民太少"
        npcs = self.narrator.npcs(state, count)
        self.last_source = "template"
        return npcs, "template"

    def _decorate(self, state: TownState, npcs: List[NPC]) -> None:
        """补齐 LLM 没给的东西：位置、技能、关系网。"""
        rng = state.rng.spawn("decorate")
        for i, n in enumerate(npcs):
            n.id = n.id or f"n_{i + 1}"
            n.home_tile = i % (state.map_size * state.map_size)
            n.skill = max(1, min(5, n.skill))
            n.trust = max(0, min(100, n.trust))
            n.mood = max(0, min(100, n.mood))
        for i in range(len(npcs)):
            for _ in range(rng.randint(0, 2)):
                j = rng.randrange(len(npcs))
                if i == j:
                    continue
                a, b = npcs[i], npcs[j]
                delta = rng.randint(-35, 45)
                a.relations[b.id] = max(-100, min(100, a.relations.get(b.id, 0) + delta))
                b.relations[a.id] = max(-100, min(100, b.relations.get(a.id, 0) + delta))

    # ------------------------------------------------------------------
    # 每日事件
    # ------------------------------------------------------------------
    def generate_events(self, state: TownState, count: int = 4) -> Tuple[List[EventCard], str]:
        if self._online():
            data = self._json(prompts.EVENT_SYSTEM, prompts.events_prompt(state, count))
            events = coerce_events(data, state.day, source="llm") if data is not None else []
            events = [e for e in events if e.title and e.text]
            if events:
                for e in events:
                    if not e.choices:
                        e.choices = self._default_choices()
                self.last_source = "llm"
                return events[:count], "llm"
        events = self.narrator.events(state, count)
        self.last_source = "template"
        return events, "template"

    def _default_choices(self) -> List[Choice]:
        return [
            Choice(id="c0", label="亲自过问", effects={"all_trust": 1, "coin": -3}),
            Choice(id="c1", label="出钱摆平", effects={"coin": -10, "morale": 3}),
            Choice(id="c2", label="暂且搁置", effects={"coin": 2, "morale": -2}),
        ]

    # ------------------------------------------------------------------
    # DM 叙事
    # ------------------------------------------------------------------
    def narrate_action(
        self, state: TownState, action: str, focus: Optional[NPC] = None
    ) -> Tuple[str, List[Choice], str]:
        if self._online():
            data = self._json(prompts.DM_SYSTEM, prompts.dm_prompt(state, action, focus))
            if data is not None:
                narrative, choices = coerce_action(data)
                choices = [c for c in choices if c.label]
                if narrative:
                    if len(choices) < 2:
                        choices = (choices + self._default_choices())[:3]
                    self.last_source = "llm"
                    return narrative, choices[:3], "llm"
            self.last_error = self.last_error or "DM 输出不可用"
        narrative, choices = self.narrator.narrate(state, action, focus)
        self.last_source = "template"
        return narrative, choices, "template"

    # ------------------------------------------------------------------
    # 主线
    # ------------------------------------------------------------------
    def generate_quest(self, state: TownState) -> Tuple[Quest, str]:
        if self._online():
            data = self._json(prompts.QUEST_SYSTEM, prompts.quest_prompt(state))
            if isinstance(data, dict):
                title = str(data.get("title") or "").strip()
                premise = str(data.get("premise") or "").strip()
                stages = data.get("stages")
                if not isinstance(stages, list):
                    stages = []
                stages = [str(s) for s in stages if str(s).strip()][:4]
                if title and premise and stages:
                    target = str(data.get("target_npc") or "")
                    if target and not state.find_npc(target):
                        target = ""
                    quest = Quest(
                        id=f"q_{state.day}",
                        title=title[:40],
                        premise=premise[:600],
                        goal=str(data.get("goal") or "")[:120],
                        stages=stages,
                        stage=0,
                        status="active",
                        reward=sanitize_effects(data.get("reward")),
                        target_npc=target,
                        clues=[str(c) for c in (data.get("clues") or [])][:5],
                        source="llm",
                    )
                    self.last_source = "llm"
                    return quest, "llm"
        quest = self.narrator.quest(state)
        self.last_source = "template"
        return quest, "template"

    # ------------------------------------------------------------------
    # 对话
    # ------------------------------------------------------------------
    def talk(
        self, state: TownState, npc: NPC, player_text: str
    ) -> Tuple[str, List[Choice], str]:
        if self._online():
            data = self._json(prompts.TALK_SYSTEM, prompts.talk_prompt(state, npc, player_text))
            if data is not None:
                narrative, choices = coerce_action(data)
                choices = [c for c in choices if c.label]
                if narrative:
                    if len(choices) < 2:
                        choices = (choices + self._default_choices())[:3]
                    self.last_source = "llm"
                    return narrative, choices[:3], "llm"
        narrative, choices = self.narrator.talk(state, npc, player_text)
        self.last_source = "template"
        return narrative, choices, "template"
