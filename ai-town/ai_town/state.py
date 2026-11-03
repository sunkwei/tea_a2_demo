"""确定性状态机：资源、建筑、日循环、效果结算。

规则：
  * LLM 只能"提议"（语义标签），数值变化全部在这里查表落地。
  * 所有随机都来自 self.rng / 派生子流，同 seed 同操作序列 => 同结果。
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from .economy import GOODS, RAW_GOODS, Caravan, Market, good_name, make_caravan
from .models import (
    RESOURCE_LABELS,
    SEASONS,
    WEATHERS,
    Building,
    EventCard,
    MarketBrief,
    MemoryEntry,
    NPC,
    Quest,
)
from .rng import RNG

# --------------------------------------------------------------------------
# 建筑定义
# --------------------------------------------------------------------------
BUILDING_DEFS: Dict[str, Dict[str, Any]] = {
    "farm": {
        "name": "农田",
        "icon": "田",
        "desc": "小镇的粮袋子。种得越多，冬天越安稳。",
        "cost": {"coin": 40, "wood": 12},
        "upkeep": 2,
        "cap": 4,
    },
    "lumber": {
        "name": "伐木场",
        "icon": "木",
        "desc": "伐木人把山坡剃成平地，木材是盖房与烧火的根本。",
        "cost": {"coin": 50, "wood": 10},
        "upkeep": 3,
        "cap": 4,
    },
    "quarry": {
        "name": "采石场",
        "icon": "石",
        "desc": "石头笨重，但城墙、井与学堂都少不了它。",
        "cost": {"coin": 60, "wood": 16},
        "upkeep": 3,
        "cap": 4,
    },
    "mine": {
        "name": "矿井",
        "icon": "矿",
        "desc": "矿道又深又黑。挖出矿石，也挖出事故。",
        "cost": {"coin": 90, "wood": 20, "stone": 10},
        "upkeep": 4,
        "cap": 4,
    },
    "market": {
        "name": "集市",
        "icon": "市",
        "desc": "有集市才有买卖，价格由供需说话。",
        "cost": {"coin": 80, "wood": 20, "stone": 12},
        "upkeep": 3,
        "cap": 4,
    },
    "tavern": {
        "name": "酒馆",
        "icon": "酒",
        "desc": "人们把不满和传闻都带进酒馆，也把笑声带出去。",
        "cost": {"coin": 70, "wood": 25},
        "upkeep": 4,
        "cap": 4,
    },
    "school": {
        "name": "学堂",
        "icon": "学",
        "desc": "孩子在这里识字，村民在这里长见识。",
        "cost": {"coin": 120, "wood": 30, "stone": 20},
        "upkeep": 5,
        "cap": 3,
    },
    "clinic": {
        "name": "医馆",
        "icon": "医",
        "desc": "会止血、会熬药，也让人敢把烦心事说出来。",
        "cost": {"coin": 100, "wood": 20, "stone": 20},
        "upkeep": 4,
        "cap": 3,
    },
    "workshop": {
        "name": "工坊",
        "icon": "工",
        "desc": "把矿石打成工具，工具再变成别的生意。",
        "cost": {"coin": 110, "wood": 25, "stone": 25},
        "upkeep": 5,
        "cap": 3,
    },
}

SEASON_FACTOR: Dict[str, Dict[str, float]] = {
    "春": {"food": 1.2, "wood": 1.0, "ore": 0.9},
    "夏": {"food": 1.4, "wood": 1.1, "ore": 1.0},
    "秋": {"food": 1.6, "wood": 1.2, "ore": 1.05},
    "冬": {"food": 0.4, "wood": 0.7, "ore": 0.8},
}

#: 语义效果表 —— LLM 只能从这张表里挑，状态机负责换算成具体数值
SEMANTIC_EFFECTS: Dict[str, Dict[str, Any]] = {
    "costly": {"coin": -14, "morale": -1},
    "expensive": {"coin": -30},
    "cheap": {"coin": 6},
    "generous": {"coin": -12, "renown": 4, "morale": 4},
    "kind": {"renown": 3, "morale": 4},
    "harsh": {"renown": -3, "morale": -6},
    "greedy": {"coin": 18, "renown": -4},
    "bold": {"coin": -8, "renown": 5, "morale": 2},
    "cautious": {"coin": -4, "morale": 1},
    "popular": {"renown": 4, "morale": 5},
    "patient": {"morale": 3},
    "work": {"food": 8, "wood": 5},
    "rest": {"morale": 4, "food": -3},
    "trade": {"coin": 14},
    "scout": {"food": 4, "ore": 3},
    "study": {"renown": 3},
    "gather": {"food": 6, "wood": 4},
    "fear": {"renown": -6, "morale": -6},
    "gift": {"coin": -6, "renown": 3},
    "law": {"renown": 2, "morale": 2},
    "festival": {"coin": -10, "morale": 8, "renown": 3},
    "hunger": {"food": -8, "morale": -4},
}

WANDERER_NAMES = [
    "阿豆", "石头", "小满", "阿唐", "柳七", "陈谷", "阿雾", "白芨",
    "老渡", "青禾", "阿砚", "半夏", "老槐", "小舟", "阿箬", "云娘",
]

WANDERER_ROLES = ["流民", "猎户", "商贩", "教书的", "手艺人", "老兵"]


def clamp(v: float, lo: int, hi: int) -> int:
    return max(lo, min(hi, int(round(v))))


class TownState:
    """小镇的全部确定性状态。"""

    def __init__(self, name: str = "临溪镇", seed: int = 0):
        self.name = name
        self.seed = int(seed)
        self.rng = RNG(self.seed)
        self.market = Market(self.rng.spawn("market"))
        self.day = 1
        self.year = 1
        self.season = SEASONS[0]
        self.season_index = 0
        self.phase = "清晨"
        self.weather = "晴"
        self.morale = 60
        self.resources: Dict[str, int] = {
            "coin": 160,
            "food": 80,
            "wood": 40,
            "stone": 30,
            "ore": 6,
            "renown": 10,
        }
        self.stock: Dict[str, int] = {"tools": 0, "books": 0, "liquor": 0}
        self.npcs: List[NPC] = []
        self.buildings: List[Building] = []
        self.events: List[EventCard] = []
        self.quests: List[Quest] = []
        self.memory: List[MemoryEntry] = []
        self.behavior: Dict[str, int] = {}
        self.flags: Dict[str, Any] = {}
        self.log: List[Dict[str, Any]] = []
        self.caravan: Optional[Caravan] = None
        self.caravan_timer = 3
        #: 今日行情风向（LLM 提方向，状态机定数字）
        self.market_brief: Optional[MarketBrief] = None
        self.over = False
        self.ending: Optional[Dict[str, Any]] = None
        self.map_size = 6

    # ------------------------------------------------------------------
    # 基础查询
    # ------------------------------------------------------------------
    @property
    def population(self) -> int:
        return sum(1 for n in self.npcs if n.alive)

    @property
    def avg_trust(self) -> float:
        alive = [n for n in self.npcs if n.alive]
        if not alive:
            return 0.0
        return sum(n.trust for n in alive) / len(alive)

    def find_npc(self, npc_id: str) -> Optional[NPC]:
        for n in self.npcs:
            if n.id == npc_id:
                return n
        return None

    def find_npc_by_name(self, name: str) -> Optional[NPC]:
        for n in self.npcs:
            if n.name == name:
                return n
        return None

    def building(self, bid: str) -> Optional[Building]:
        for b in self.buildings:
            if b.id == bid:
                return b
        return None

    def resource(self, key: str) -> int:
        return int(self.resources.get(key, 0))

    def stock_of(self, key: str) -> int:
        return int(self.stock.get(key, 0))

    # ------------------------------------------------------------------
    # 日志与记忆
    # ------------------------------------------------------------------
    def add_log(self, text: str, kind: str = "system") -> None:
        self.log.append({"day": self.day, "season": self.season, "kind": kind, "text": text})

    def add_memory(self, kind: str, text: str, tags: Optional[List[str]] = None) -> None:
        self.memory.append(MemoryEntry(day=self.day, kind=kind, text=text, tags=list(tags or [])))

    def bump_behavior(self, tag: str, n: int = 1) -> None:
        if not tag:
            return
        self.behavior[tag] = self.behavior.get(tag, 0) + n

    # ------------------------------------------------------------------
    # 效果结算：LLM 语义 -> 具体数值
    # ------------------------------------------------------------------
    def resolve_effects(self, effects: Optional[Dict[str, Any]]) -> List[str]:
        changes: List[str] = []
        for raw_key, raw_val in (effects or {}).items():
            key = str(raw_key).strip()
            low = key.lower()
            amount = raw_val if isinstance(raw_val, (int, float)) else 1
            if isinstance(amount, bool):
                amount = 1
            amount = int(amount)

            if low in SEMANTIC_EFFECTS:
                for sub, val in SEMANTIC_EFFECTS[low].items():
                    self._apply_scalar(sub, val, changes)
                continue
            if low == "risk":
                # 写法一：{"risk": "low"} —— 值就是风险等级
                level = str(raw_val).lower() if isinstance(raw_val, str) else "high"
                if level not in ("low", "high", "none"):
                    level = "high"
                self._apply_risk(level, changes)
                continue
            if low.startswith("risk:"):
                self._apply_risk(low.split(":", 1)[1].lower(), changes)
                continue
            if low.startswith("trust:"):
                npc = self.find_npc(key.split(":", 1)[1])
                if npc:
                    d = amount * 5
                    npc.trust = clamp(npc.trust + d, 0, 100)
                    npc.mood = clamp(npc.mood + d // 2, 0, 100)
                    changes.append(f"{npc.name} 信任 {d:+d}")
                continue
            if low.startswith("relation:"):
                parts = key.split(":")
                if len(parts) == 3:
                    a, b = self.find_npc(parts[1]), self.find_npc(parts[2])
                    if a and b:
                        d = amount * 10
                        a.relations[b.id] = clamp(a.relations.get(b.id, 0) + d, -100, 100)
                        b.relations[a.id] = clamp(b.relations.get(a.id, 0) + d, -100, 100)
                        changes.append(f"{a.name}与{b.name}的关系 {d:+d}")
                continue
            if low.startswith("flag:"):
                flag = key.split(":", 1)[1]
                self.flags[flag] = True
                self.bump_behavior(flag)
                changes.append(f"记下「{flag}」")
                continue
            if low.startswith("behavior:"):
                self.bump_behavior(key.split(":", 1)[1], amount)
                continue
            if low.startswith("build:"):
                ok, msg = self.build(key.split(":", 1)[1])
                changes.append(msg)
                continue
            if low.startswith("quest:"):
                self.advance_quest(key.split(":", 1)[1], changes)
                continue
            if low.startswith("discover:"):
                clue = key.split(":", 1)[1]
                q = self.active_quest()
                if q and clue not in q.clues:
                    q.clues.append(clue)
                    changes.append(f"获得线索：{clue}")
                continue
            if low.startswith("all_trust"):
                for npc in self.npcs:
                    if npc.alive:
                        npc.trust = clamp(npc.trust + amount * 4, 0, 100)
                changes.append("全镇对你的信任上升")
                continue
            if low == "morale":
                self.morale = clamp(self.morale + amount, 0, 100)
                changes.append(f"民心 {amount:+d}")
                continue
            if low == "population":
                self._change_population(amount, changes)
                continue
            if low in self.resources:
                self._apply_scalar(low, amount, changes)
                continue
            if low in GOODS:
                self.stock[low] = max(0, self.stock.get(low, 0) + amount)
                changes.append(f"{good_name(low)} {amount:+d}")
                continue
        return self._merge_changes(changes)

    @staticmethod
    def _merge_changes(changes: List[str]) -> List[str]:
        """把同类变化合并成一条（例如 民心 +4 与 民心 +3 -> 民心 +7）。"""
        import re

        totals: Dict[str, int] = {}
        order: List[str] = []
        plain: List[str] = []
        for ch in changes:
            m = re.match(r"^(.*?)\s+([+-]\d+)$", ch)
            if m:
                label, num = m.group(1), int(m.group(2))
                if label not in totals:
                    totals[label] = 0
                    order.append(label)
                totals[label] += num
            else:
                plain.append(ch)
        merged = [f"{label} {totals[label]:+d}" for label in order]
        return merged + plain

    def _apply_scalar(self, key: str, value: Any, changes: List[str]) -> None:
        amount = int(value)
        if key == "morale":
            self.morale = clamp(self.morale + amount, 0, 100)
            changes.append(f"民心 {amount:+d}")
            return
        if key in self.resources:
            self.resources[key] = max(0, self.resources.get(key, 0) + amount)
            changes.append(f"{RESOURCE_LABELS.get(key, key)} {amount:+d}")
            return
        if key in GOODS:
            self.stock[key] = max(0, self.stock.get(key, 0) + amount)
            changes.append(f"{good_name(key)} {amount:+d}")

    def _apply_risk(self, level: str, changes: List[str]) -> None:
        # 每次风险判定都要用不同的子流，否则同一天所有风险会掷出同一个结果
        seq = getattr(self, "_risk_seq", 0)
        self._risk_seq = seq + 1
        rng = self.rng.spawn(f"risk-{self.day}-{seq}")
        if level == "none":
            return
        if level == "low":
            if rng.chance(0.12):
                self._apply_scalar("coin", -6, changes)
                changes.append("小插曲：出了点岔子")
            return
        if rng.chance(0.34):
            self._apply_scalar("coin", -15, changes)
            self._apply_scalar("morale", -4, changes)
            changes.append("意外发生了，代价不小")
        elif rng.chance(0.12):
            self._apply_scalar("coin", 25, changes)
            changes.append("意外之喜")

    def _change_population(self, amount: int, changes: List[str]) -> None:
        if amount > 0:
            for _ in range(amount):
                npc = self.make_wanderer()
                self.npcs.append(npc)
                changes.append(f"{npc.name}（{npc.role}）搬来了小镇")
        elif amount < 0:
            alive = [n for n in self.npcs if n.alive]
            alive.sort(key=lambda n: (n.trust, n.mood))
            for _ in range(min(-amount, len(alive))):
                npc = alive.pop(0)
                npc.alive = False
                changes.append(f"{npc.name}收拾行李离开了")

    def make_wanderer(self) -> NPC:
        rng = self.rng.spawn(f"wander-{self.day}-{len(self.npcs)}")
        name = rng.choice(WANDERER_NAMES)
        while self.find_npc_by_name(name):
            name = rng.choice(WANDERER_NAMES)
        return NPC(
            id=f"n_{self.day}_{len(self.npcs)}",
            name=name,
            role=rng.choice(WANDERER_ROLES),
            age=rng.randint(17, 62),
            traits=[rng.choice(["安静", "热心", "固执", "精明", "乐观", "多疑"])],
            background="路过此地，听闻小镇换了新镇长。",
            trust=45,
            mood=55,
            skill=rng.randint(1, 3),
            home_tile=rng.randrange(self.map_size * self.map_size),
        )

    # ------------------------------------------------------------------
    # 行情风向落地
    # ------------------------------------------------------------------
    #: 走俏商品每天涨的比例
    HOT_BIAS = 0.07
    #: 滞销商品每天跌的比例
    COLD_BIAS = -0.06

    def apply_market_brief(self, brief: Optional[MarketBrief]) -> List[str]:
        """把 LLM 的行情风向落地成价格偏置与商队需求。

        LLM 只能决定"什么货走俏"；偏置幅度、求购数量都是这里说了算。
        """
        notes: List[str] = []
        self.market_brief = brief
        if brief is None:
            return notes
        bias: Dict[str, float] = {}
        for good in brief.hot:
            bias[good] = self.HOT_BIAS
        for good in brief.cold:
            if good not in bias:
                bias[good] = self.COLD_BIAS
        self.market.bias = bias
        if brief.hot:
            notes.append("走俏：" + "、".join(good_name(g) for g in brief.hot))
        if brief.cold:
            notes.append("滞销：" + "、".join(good_name(g) for g in brief.cold))
        if brief.caravan_hint and self.caravan is not None:
            for good in brief.caravan_hint:
                if good in RAW_GOODS and good not in self.caravan.demands:
                    self.caravan.add_demand(good, 10)
                    notes.append(f"{self.caravan.name}开始求购{good_name(good)}")
        if brief.news:
            notes.append(brief.news)
            self.add_log(brief.news, "market")
        self.add_memory("market", "行情：" + "，".join(notes[:2]) if notes else "行情无异", ["market"])
        return notes

    # ------------------------------------------------------------------
    # 关系网演化
    # ------------------------------------------------------------------
    def _bump_relation(self, a: NPC, b: NPC, delta: int) -> None:
        a.relations[b.id] = max(-100, min(100, a.relations.get(b.id, 0) + delta))
        b.relations[a.id] = max(-100, min(100, b.relations.get(a.id, 0) + delta))

    def evolve_relations(self, rng: RNG) -> List[str]:
        """关系网每日演化：同工相熟、久不往来会淡、流言会伤信任。"""
        notes: List[str] = []
        alive = [n for n in self.npcs if n.alive]
        if len(alive) < 2:
            return notes

        # 1) 同在一处做工 -> 相熟
        for b in self.buildings:
            staff = [self.find_npc(s) for s in b.staff]
            staff = [n for n in staff if n and n.alive]
            for i in range(len(staff)):
                for j in range(i + 1, len(staff)):
                    if rng.chance(0.55):
                        self._bump_relation(staff[i], staff[j], rng.randint(1, 2))

        # 2) 交好的替你说话，结怨的拆台，久不来往的自然变淡
        for a in alive:
            for rid, val in list(a.relations.items()):
                other = self.find_npc(rid)
                if other is None or not other.alive:
                    continue
                if val >= 55 and rng.chance(0.25):
                    a.trust = clamp(a.trust + 1, 0, 100)
                    other.trust = clamp(other.trust + 1, 0, 100)
                elif val <= -35 and rng.chance(0.25):
                    a.trust = clamp(a.trust - 1, 0, 100)
                    other.trust = clamp(other.trust - 1, 0, 100)
                elif rng.chance(0.06):
                    self._bump_relation(a, other, -1)

        # 3) 流言：不满的人到处说镇长的坏话
        unhappy = [n for n in alive if n.trust < 50]
        if unhappy and rng.chance(0.35):
            teller = rng.choice(unhappy)
            others = [n for n in alive if n.id != teller.id]
            if others:
                listener = rng.choice(others)
                self._bump_relation(teller, listener, rng.randint(2, 6))
                listener.trust = clamp(listener.trust - rng.randint(1, 3), 0, 100)
                teller.mood = clamp(teller.mood - 1, 0, 100)
                self.bump_behavior("rumor")
                notes.append(f"镇上传开了关于镇长的闲话（{listener.name}听说了）")
        return notes

    # ------------------------------------------------------------------
    # 建筑
    # ------------------------------------------------------------------
    def free_tiles(self) -> List[int]:
        used = {b.tile for b in self.buildings}
        return [i for i in range(self.map_size * self.map_size) if i not in used]

    def build(self, kind: str, tile: Optional[int] = None) -> Tuple[bool, str]:
        d = BUILDING_DEFS.get(kind)
        if not d:
            return False, "没有这种建筑"
        for res, amt in d["cost"].items():
            if self.resources.get(res, 0) < amt:
                return False, f"{RESOURCE_LABELS.get(res, res)}不足，无法开建{d['name']}"
        if tile is None:
            free = self.free_tiles()
            if not free:
                return False, "镇上已经没有空地了"
            tile = free[0]
        elif tile in {b.tile for b in self.buildings}:
            return False, "那块地已经被占了"
        for res, amt in d["cost"].items():
            self.resources[res] = self.resources.get(res, 0) - amt
        b = Building(
            id=f"b_{kind}_{len(self.buildings) + 1}",
            name=d["name"],
            kind=kind,
            tile=tile,
            built_day=self.day,
        )
        self.buildings.append(b)
        self.add_log(f"你主持建起了{d['name']}。", "build")
        self.add_memory("build", f"建造了{d['name']}", ["build", kind])
        self.bump_behavior("build")
        return True, f"建成{d['name']}"

    def hire(self, npc_id: str, building_id: str) -> Tuple[bool, str]:
        npc = self.find_npc(npc_id)
        b = self.building(building_id)
        if not npc or not b:
            return False, "找不到人或建筑"
        if not npc.alive:
            return False, f"{npc.name}已经不在镇上了"
        cap = int(BUILDING_DEFS.get(b.kind, {}).get("cap", 3))
        if len(b.staff) >= cap:
            return False, f"{b.name}人手已满"
        if npc.job:
            old = self.building(npc.job)
            if old:
                old.staff = [s for s in old.staff if s != npc.id]
        b.staff.append(npc.id)
        npc.job = b.id
        npc.trust = clamp(npc.trust + 4, 0, 100)
        self.add_log(f"{npc.name}答应去{b.name}干活。", "build")
        self.add_memory("build", f"{npc.name}入职{b.name}", ["hire"])
        return True, f"{npc.name}加入了{b.name}"

    def _building_flow(self, b: Building, rng: RNG) -> Tuple[Dict[str, int], Dict[str, int]]:
        """返回 (产出, 消耗)。"""
        out: Dict[str, int] = {}
        cost: Dict[str, int] = {}
        lvl = b.level
        staff = len([s for s in b.staff if self.find_npc(s) and self.find_npc(s).alive])
        factor = SEASON_FACTOR.get(self.season, SEASON_FACTOR["春"])
        cond = max(0.3, b.condition)

        def add(d: Dict[str, int], k: str, v: int) -> None:
            if v:
                d[k] = d.get(k, 0) + v

        if b.kind == "farm":
            add(out, "food", int((6 + 3 * staff) * lvl * factor.get("food", 1.0) * cond))
        elif b.kind == "lumber":
            add(out, "wood", int((6 + 3 * staff) * lvl * factor.get("wood", 1.0) * cond))
        elif b.kind == "quarry":
            add(out, "stone", int((5 + 2 * staff) * lvl * cond))
        elif b.kind == "mine":
            add(out, "ore", int((4 + 2 * staff) * lvl * factor.get("ore", 1.0) * cond))
            if rng.chance(0.10):
                b.condition = max(0.3, b.condition - 0.15)
                out["ore"] = int(out.get("ore", 0) * 0.5)
                self.add_log(f"{b.name}发生塌方，产量减半。", "event")
        elif b.kind == "market":
            add(out, "coin", int((5 + 3 * staff) * lvl * cond))
            add(cost, "wood", 1 * lvl)
        elif b.kind == "tavern":
            add(out, "coin", int((4 + 4 * staff) * lvl * cond))
            add(cost, "food", 2 * lvl + staff)
            self.morale = clamp(self.morale + 1 * lvl, 0, 100)
        elif b.kind == "school":
            add(out, "renown", 2 * lvl)
            add(cost, "food", staff)
            for sid in b.staff:
                npc = self.find_npc(sid)
                if npc:
                    npc.skill = min(5, npc.skill + 1)
                    npc.mood = clamp(npc.mood + 1, 0, 100)
        elif b.kind == "clinic":
            add(out, "renown", 1 * lvl)
            add(cost, "food", staff)
            self.morale = clamp(self.morale + 1 * lvl, 0, 100)
        elif b.kind == "workshop":
            add(cost, "ore", 3 * lvl + staff)
            add(out, "tools", 2 * lvl + staff)
        return out, cost

    # ------------------------------------------------------------------
    # 日循环
    # ------------------------------------------------------------------
    def tick_day(self) -> Dict[str, Any]:
        """推进一天，结算生产 / 消耗 / 民心 / 行情 / 商队。"""
        rng = self.rng.spawn(f"day-{self.day}")
        report: Dict[str, Any] = {
            "day": self.day,
            "produced": {},
            "consumed": {},
            "notes": [],
            "events": [],
        }
        self.weather = rng.choice(WEATHERS)

        produced: Dict[str, int] = {}
        consumed: Dict[str, int] = {}
        for b in list(self.buildings):
            out, cost = self._building_flow(b, rng)
            for k, v in out.items():
                produced[k] = produced.get(k, 0) + v
            for k, v in cost.items():
                consumed[k] = consumed.get(k, 0) + v
        for k, v in produced.items():
            if k in self.resources:
                self.resources[k] += v
            elif k in self.stock:
                self.stock[k] = self.stock.get(k, 0) + v
        for k, v in consumed.items():
            self.resources[k] = max(0, self.resources.get(k, 0) - v)
        report["produced"] = produced
        report["consumed"] = consumed

        # 维护费
        upkeep = sum(int(BUILDING_DEFS.get(b.kind, {}).get("upkeep", 0)) for b in self.buildings)
        if upkeep:
            self.resources["coin"] = max(0, self.resources["coin"] - upkeep)
            report["notes"].append(f"建筑维护花费 {upkeep} 金币")

        # 口粮
        pop = self.population
        need = int(pop * (1.5 if self.season == "冬" else 1.0))
        if self.resources["food"] >= need:
            self.resources["food"] -= need
            report["notes"].append(f"{pop} 口人吃掉 {need} 份粮食")
        else:
            deficit = need - self.resources["food"]
            self.resources["food"] = 0
            self.morale = clamp(self.morale - 9, 0, 100)
            self.bump_behavior("hunger")
            report["notes"].append(f"缺粮 {deficit} 份，民心动摇")
            alive = [n for n in self.npcs if n.alive]
            if alive and rng.chance(0.35):
                victim = rng.choice(alive)
                victim.alive = False
                victim.mood = 0
                self.add_log(f"{victim.name}在饥荒中离开了小镇。", "event")
                report["events"].append(f"{victim.name}离开了")

        # 税收
        tax = int(round(pop * 1.6 * max(0.3, self.morale / 70.0)))
        if tax:
            self.resources["coin"] += tax
            report["notes"].append(f"税收入库 {tax} 金币")

        # 民心自然回升
        if self.resources["food"] > pop * 2:
            self.morale = clamp(self.morale + 2, 0, 100)

        # 建筑损耗
        for b in self.buildings:
            if rng.chance(0.06):
                b.condition = max(0.3, b.condition - 0.1)
                report["notes"].append(f"{b.name}需要修缮")

        # 行情
        notes = self.market.drift()
        report["notes"].extend(notes)

        # 商队
        self.caravan_timer -= 1
        if self.caravan is None and self.caravan_timer <= 0:
            hint = list(self.market_brief.caravan_hint) if self.market_brief else []
            self.caravan = make_caravan(self.rng.spawn(f"caravan-{self.day}"), self.day, demand_hint=hint)
            self.caravan_timer = self.rng.randint(3, 6)
            report["events"].append(f"{self.caravan.name}抵达：求购 {self.caravan.demand_text()}")
        elif self.caravan is not None:
            report["events"].append(f"{self.caravan.name}还在镇上")

        # 随机小事
        self._random_events(rng, report)

        # 关系网演化
        rel_notes = self.evolve_relations(rng)
        if rel_notes:
            report["notes"].extend(rel_notes)
            report["events"].extend(rel_notes)

        report["notes"].append(f"民心 {self.morale}，人口 {self.population}")
        return report

    def _random_events(self, rng: RNG, report: Dict[str, Any]) -> None:
        roll = rng.random()
        has_clinic = any(b.kind == "clinic" for b in self.buildings)
        if roll < 0.04 and not has_clinic:
            sick = [n for n in self.npcs if n.alive]
            if sick:
                who = rng.choice(sick)
                who.mood = clamp(who.mood - 12, 0, 100)
                self.morale = clamp(self.morale - 3, 0, 100)
                report["events"].append(f"{who.name}病了")
        elif roll < 0.12:
            self._change_population(1, report["events"])
        elif roll < 0.17:
            loss = rng.randint(4, 12)
            self.resources["coin"] = max(0, self.resources["coin"] - loss)
            report["events"].append(f"库房失窃，损失 {loss} 金币")
        elif roll < 0.27:
            gain = rng.randint(4, 14)
            self.resources["food"] += gain
            report["events"].append(f"猎人送来 {gain} 份野味")
        elif roll < 0.33:
            for npc in self.npcs:
                if npc.alive:
                    npc.trust = clamp(npc.trust + 2, 0, 100)
            report["events"].append("镇民们自发地帮村里修了几段路")

    # ------------------------------------------------------------------
    # 任务
    # ------------------------------------------------------------------
    def active_quest(self) -> Optional[Quest]:
        for q in self.quests:
            if q.status == "active":
                return q
        return None

    def advance_quest(self, quest_id: str, changes: List[str]) -> None:
        for q in self.quests:
            if q.id != quest_id:
                continue
            if q.status != "active":
                return
            q.stage = min(len(q.stages), q.stage + 1)
            if q.stage >= len(q.stages):
                q.status = "done"
                self.apply_reward(q.reward, changes)
                self.add_log(f"主线「{q.title}」完成。", "quest")
                self.bump_behavior("quest_done")
            else:
                changes.append(f"主线推进：{q.stages[q.stage - 1]}")
            return

    def apply_reward(self, reward: Optional[Dict[str, Any]], changes: Optional[List[str]] = None) -> None:
        if not reward:
            return
        for key, val in reward.items():
            if key in self.resources:
                self.resources[key] = max(0, self.resources[key] + int(val))
                if changes is not None:
                    changes.append(f"{RESOURCE_LABELS.get(key, key)} {int(val):+d}")
            elif key == "morale":
                self.morale = clamp(self.morale + int(val), 0, 100)

    # ------------------------------------------------------------------
    # 时间推进
    # ------------------------------------------------------------------
    def advance_calendar(self) -> None:
        self.day += 1
        if self.day > 30:
            self.day = 1
            self.season_index = (self.season_index + 1) % 4
            self.season = SEASONS[self.season_index]
            if self.season_index == 0:
                self.year += 1

    # ------------------------------------------------------------------
    # 序列化
    # ------------------------------------------------------------------
    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "seed": self.seed,
            "day": self.day,
            "year": self.year,
            "season": self.season,
            "season_index": self.season_index,
            "phase": self.phase,
            "weather": self.weather,
            "morale": self.morale,
            "resources": dict(self.resources),
            "stock": dict(self.stock),
            "npcs": [n.to_dict() for n in self.npcs],
            "buildings": [b.to_dict() for b in self.buildings],
            "events": [e.to_dict() for e in self.events],
            "quests": [q.to_dict() for q in self.quests],
            "memory": [m.to_dict() for m in self.memory],
            "behavior": dict(self.behavior),
            "flags": dict(self.flags),
            "log": list(self.log),
            "market": self.market.to_dict(),
            "market_brief": self.market_brief.to_dict() if self.market_brief else None,
            "caravan": self.caravan.to_dict() if self.caravan else None,
            "caravan_timer": self.caravan_timer,
            "over": self.over,
            "ending": dict(self.ending) if self.ending else None,
            "map_size": self.map_size,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "TownState":
        s = cls(name=str(d.get("name", "临溪镇")), seed=int(d.get("seed", 0)))
        s.day = int(d.get("day", 1))
        s.year = int(d.get("year", 1))
        s.season_index = int(d.get("season_index", 0))
        s.season = str(d.get("season", SEASONS[s.season_index % 4]))
        s.phase = str(d.get("phase", "清晨"))
        s.weather = str(d.get("weather", "晴"))
        s.morale = int(d.get("morale", 60))
        s.resources = {**s.resources, **(d.get("resources") or {})}
        s.stock = {**s.stock, **(d.get("stock") or {})}
        s.npcs = [NPC.from_dict(x) for x in (d.get("npcs") or [])]
        s.buildings = [Building.from_dict(x) for x in (d.get("buildings") or [])]
        s.events = [EventCard.from_dict(x) for x in (d.get("events") or [])]
        s.quests = [Quest.from_dict(x) for x in (d.get("quests") or [])]
        s.memory = [MemoryEntry.from_dict(x) for x in (d.get("memory") or [])]
        s.behavior = {str(k): int(v) for k, v in (d.get("behavior") or {}).items()}
        s.flags = dict(d.get("flags") or {})
        s.log = list(d.get("log") or [])
        s.market = Market.from_dict(d.get("market") or {}, s.rng.spawn("market"))
        if d.get("market_brief"):
            s.market_brief = MarketBrief.from_dict(d["market_brief"])
        s.caravan = Caravan.from_dict(d["caravan"]) if d.get("caravan") else None
        s.caravan_timer = int(d.get("caravan_timer", 3))
        s.over = bool(d.get("over", False))
        s.ending = d.get("ending")
        s.map_size = int(d.get("map_size", 6))
        return s

    # ------------------------------------------------------------------
    # 给 LLM 用的世界摘要
    # ------------------------------------------------------------------
    def world_brief(self) -> str:
        blds = "、".join(f"{b.name}(Lv{b.level},{len(b.staff)}人)" for b in self.buildings) or "尚无建筑"
        people = "、".join(f"{n.name}({n.role},信任{n.trust})" for n in self.npcs if n.alive) or "尚无居民"
        return (
            f"【小镇】{self.name}｜第{self.year}年{self.season}季 第{self.day}天｜{self.weather}\n"
            f"【人口】{self.population} 人｜民心 {self.morale}｜声望 {self.resource('renown')}\n"
            f"【资源】金币{self.resource('coin')} 粮{self.resource('food')} 木{self.resource('wood')} "
            f"石{self.resource('stone')} 矿{self.resource('ore')}\n"
            f"【建筑】{blds}\n"
            f"【居民】{people}"
        )
