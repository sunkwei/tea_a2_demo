"""数据模型：镇子状态、NPC、事件、建筑、任务、记忆。

所有 dataclass 都带 to_dict/from_dict，方便存档（JSON）与跨进程传递。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

# --------------------------------------------------------------------------
# 资源
# --------------------------------------------------------------------------
RESOURCE_LABELS: Dict[str, str] = {
    "coin": "金币",
    "food": "粮食",
    "wood": "木材",
    "stone": "石料",
    "ore": "矿石",
    "renown": "声望",
}
RESOURCE_KEYS: List[str] = list(RESOURCE_LABELS)

#: 可在市场上买卖的货物
TRADE_GOODS: List[str] = ["food", "wood", "stone", "ore", "tools", "books"]

GOODS_LABELS: Dict[str, str] = {
    **RESOURCE_LABELS,
    "tools": "工具",
    "books": "书籍",
    "liquor": "烈酒",
}

SEASONS = ["春", "夏", "秋", "冬"]
PHASES = ["清晨", "午后", "黄昏", "深夜"]
WEATHERS = ["晴", "阴", "小雨", "大雾", "雷雨", "霜降"]


# --------------------------------------------------------------------------
# 选项 / 事件
# --------------------------------------------------------------------------
@dataclass
class Choice:
    """一个玩家可选分支。

    effects 支持两类：
      1. 显式数值：{"coin": -10, "food": 5, "morale": 3, "trust:npc_3": 8}
      2. 语义标签：{"costly": 1, "kind": 1, "build:market": 1}
         语义由 state.resolve_effects 查表换算成数值 —— LLM 不直接改数值。
    """

    id: str
    label: str
    hint: str = ""
    effects: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {"id": self.id, "label": self.label, "hint": self.hint, "effects": dict(self.effects)}

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Choice":
        return cls(
            id=str(d.get("id", "")),
            label=str(d.get("label", "")),
            hint=str(d.get("hint", "")),
            effects=dict(d.get("effects") or {}),
        )


@dataclass
class EventCard:
    """当天发生的一个事件（天灾 / 人情 / 商机 / 悬案）。"""

    id: str
    title: str
    text: str
    kind: str = "social"          # disaster | social | opportunity | mystery | routine
    choices: List[Choice] = field(default_factory=list)
    day: int = 0
    resolved: bool = False
    source: str = "template"      # llm | template
    tags: List[str] = field(default_factory=list)
    urgency: int = 0              # 0=不急 1=今天 2=限期

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "text": self.text,
            "kind": self.kind,
            "choices": [c.to_dict() for c in self.choices],
            "day": self.day,
            "resolved": self.resolved,
            "source": self.source,
            "tags": list(self.tags),
            "urgency": self.urgency,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "EventCard":
        return cls(
            id=str(d.get("id", "")),
            title=str(d.get("title", "")),
            text=str(d.get("text", "")),
            kind=str(d.get("kind", "social")),
            choices=[Choice.from_dict(c) for c in (d.get("choices") or [])],
            day=int(d.get("day", 0)),
            resolved=bool(d.get("resolved", False)),
            source=str(d.get("source", "template")),
            tags=list(d.get("tags") or []),
            urgency=int(d.get("urgency", 0)),
        )


# --------------------------------------------------------------------------
# NPC / 建筑
# --------------------------------------------------------------------------
@dataclass
class NPC:
    id: str
    name: str
    role: str = "镇民"
    age: int = 30
    traits: List[str] = field(default_factory=list)
    background: str = ""
    secret: str = ""
    trust: int = 50               # 对镇长的信任 0..100
    mood: int = 50                # 心情 0..100
    skill: int = 1                # 劳动技能 1..5
    home_tile: int = 0
    job: str = ""                 # 所属建筑 id
    alive: bool = True
    met: bool = False
    relations: Dict[str, int] = field(default_factory=dict)   # npc_id -> 好感 -100..100
    tags: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "role": self.role,
            "age": self.age,
            "traits": list(self.traits),
            "background": self.background,
            "secret": self.secret,
            "trust": self.trust,
            "mood": self.mood,
            "skill": self.skill,
            "home_tile": self.home_tile,
            "job": self.job,
            "alive": self.alive,
            "met": self.met,
            "relations": dict(self.relations),
            "tags": list(self.tags),
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "NPC":
        return cls(
            id=str(d.get("id", "")),
            name=str(d.get("name", "")),
            role=str(d.get("role", "镇民")),
            age=int(d.get("age", 30)),
            traits=list(d.get("traits") or []),
            background=str(d.get("background", "")),
            secret=str(d.get("secret", "")),
            trust=int(d.get("trust", 50)),
            mood=int(d.get("mood", 50)),
            skill=int(d.get("skill", 1)),
            home_tile=int(d.get("home_tile", 0)),
            job=str(d.get("job", "")),
            alive=bool(d.get("alive", True)),
            met=bool(d.get("met", False)),
            relations={str(k): int(v) for k, v in (d.get("relations") or {}).items()},
            tags=list(d.get("tags") or []),
        )


@dataclass
class Building:
    id: str
    name: str
    kind: str
    level: int = 1
    tile: int = 0
    staff: List[str] = field(default_factory=list)
    built_day: int = 1
    condition: float = 1.0        # 0..1，破损需要修缮

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "kind": self.kind,
            "level": self.level,
            "tile": self.tile,
            "staff": list(self.staff),
            "built_day": self.built_day,
            "condition": float(self.condition),
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Building":
        return cls(
            id=str(d.get("id", "")),
            name=str(d.get("name", "")),
            kind=str(d.get("kind", "")),
            level=int(d.get("level", 1)),
            tile=int(d.get("tile", 0)),
            staff=list(d.get("staff") or []),
            built_day=int(d.get("built_day", 1)),
            condition=float(d.get("condition", 1.0)),
        )


# --------------------------------------------------------------------------
# 任务 / 记忆
# --------------------------------------------------------------------------
@dataclass
class Quest:
    id: str
    title: str
    premise: str
    goal: str = ""
    stages: List[str] = field(default_factory=list)
    stage: int = 0
    status: str = "active"        # active | done | failed
    reward: Dict[str, Any] = field(default_factory=dict)
    target_npc: str = ""
    clues: List[str] = field(default_factory=list)
    source: str = "template"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "premise": self.premise,
            "goal": self.goal,
            "stages": list(self.stages),
            "stage": self.stage,
            "status": self.status,
            "reward": dict(self.reward),
            "target_npc": self.target_npc,
            "clues": list(self.clues),
            "source": self.source,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Quest":
        return cls(
            id=str(d.get("id", "")),
            title=str(d.get("title", "")),
            premise=str(d.get("premise", "")),
            goal=str(d.get("goal", "")),
            stages=list(d.get("stages") or []),
            stage=int(d.get("stage", 0)),
            status=str(d.get("status", "active")),
            reward=dict(d.get("reward") or {}),
            target_npc=str(d.get("target_npc", "")),
            clues=list(d.get("clues") or []),
            source=str(d.get("source", "template")),
        )


@dataclass
class MemoryEntry:
    """LLM 的记忆单元：镇长做过的每一件事。"""

    day: int
    kind: str                    # action | event | talk | build | trade | quest
    text: str
    tags: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {"day": self.day, "kind": self.kind, "text": self.text, "tags": list(self.tags)}

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "MemoryEntry":
        return cls(
            day=int(d.get("day", 0)),
            kind=str(d.get("kind", "action")),
            text=str(d.get("text", "")),
            tags=list(d.get("tags") or []),
        )


# --------------------------------------------------------------------------
# 结局
# --------------------------------------------------------------------------
@dataclass
class Ending:
    key: str
    title: str
    text: str
    tone: str = "neutral"         # good | bad | neutral | mixed

    def to_dict(self) -> Dict[str, Any]:
        return {"key": self.key, "title": self.title, "text": self.text, "tone": self.tone}

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Ending":
        return cls(
            key=str(d.get("key", "")),
            title=str(d.get("title", "")),
            text=str(d.get("text", "")),
            tone=str(d.get("tone", "neutral")),
        )


@dataclass
class ActionOutcome:
    """一次玩家行动 / 选择的结算结果。"""

    narrative: str = ""
    choices: List[Choice] = field(default_factory=list)
    changes: List[str] = field(default_factory=list)
    source: str = "template"
    event: Optional[EventCard] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "narrative": self.narrative,
            "choices": [c.to_dict() for c in self.choices],
            "changes": list(self.changes),
            "source": self.source,
            "event": self.event.to_dict() if self.event else None,
        }
