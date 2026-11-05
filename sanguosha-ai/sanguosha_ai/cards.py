"""牌堆定义。

牌分为：基本牌（杀/闪/桃/酒/无懈可击）、锦囊牌（南蛮/万箭/乐不思蜀/兵粮寸断/闪电）、
装备牌（武器/防具/坐骑）。颜色只有红/黑两色（仁王盾、藤甲、八卦阵的判定依赖颜色）。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .rng import Rng

SUITS = ["桃", "黑桃", "梅花", "方块"]
RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]


@dataclass
class Card:
    uid: str = ""
    name: str = ""
    kind: str = "basic"  # basic / trick / equip
    color: str = "black"  # red / black
    suit: str = "黑桃"
    rank: str = "A"
    extra: Dict[str, object] = field(default_factory=dict)

    @property
    def is_red(self) -> bool:
        return self.color == "red"

    def label(self) -> str:
        return f"{self.name}·{self.suit}{self.rank}"

    def to_dict(self) -> Dict[str, object]:
        return {
            "uid": self.uid,
            "name": self.name,
            "kind": self.kind,
            "color": self.color,
            "suit": self.suit,
            "rank": self.rank,
        }


# --------------------------------------------------------------------------
# 装备牌定义：extra 里的键决定引擎里的行为
#   weapon: extra_sha(每回合多一张杀) / damage_plus(杀伤害+1) / two_as_sha(两张当杀)
#            / range(攻击范围) / nolimit(无视距离) / guanshi(贯石斧) / vs_female(雌雄)
#   armor:  名字决定特殊效果（八卦阵 / 仁王盾 / 藤甲）
#   horse:  horse_att(攻击马) / horse_def(防御马)
# --------------------------------------------------------------------------
EQUIPS: Dict[str, Dict[str, object]] = {
    "诸葛连弩": {"slot": "weapon", "extra_sha": 1, "desc": "每回合可多使用一张【杀】"},
    "青釭剑": {"slot": "weapon", "damage_plus": 1, "desc": "使用【杀】造成的伤害 +1"},
    "丈八蛇矛": {"slot": "weapon", "two_as_sha": 1, "desc": "可将两张手牌当一张【杀】使用"},
    "青龙偃月刀": {"slot": "weapon", "range": 2, "desc": "攻击范围 2"},
    "雌雄双股剑": {"slot": "weapon", "vs_female": 1, "desc": "对女性角色使用【杀】伤害 +1"},
    "贯石斧": {"slot": "weapon", "guanshi": 1, "desc": "【杀】被闪时可弃一张牌强制命中"},
    "方天画戟": {"slot": "weapon", "range": 2, "desc": "攻击范围 2"},
    "麒麟弓": {"slot": "weapon", "range": 2, "desc": "攻击范围 2"},
    "烈弓": {"slot": "weapon", "nolimit": 1, "range": 2, "desc": "使用【杀】不受距离限制"},
    "寒冰剑": {"slot": "weapon", "range": 2, "desc": "攻击范围 2"},
    "八卦阵": {"slot": "armor", "desc": "受到【杀】时可判定，红色视为闪避"},
    "仁王盾": {"slot": "armor", "desc": "黑色的【杀】对你无效"},
    "藤甲": {"slot": "armor", "desc": "防止【杀】与【南蛮入侵】造成的伤害"},
    "赤兔": {"slot": "horse_att", "desc": "你的攻击范围 +1"},
    "大宛": {"slot": "horse_att", "desc": "你的攻击范围 +1"},
    "绝影": {"slot": "horse_def", "desc": "他人对你的距离 +1"},
    "爪黄飞电": {"slot": "horse_def", "desc": "他人对你的距离 +1"},
}

# 装备牌颜色（仁王盾必须是黑色牌才有意义，这里固定几个）
EQUIP_COLORS = {
    "仁王盾": "black",
    "藤甲": "black",
    "八卦阵": "black",
}


@dataclass
class DeckSpec:
    counts: Dict[str, int] = field(default_factory=dict)
    equips: Dict[str, int] = field(default_factory=dict)

    @classmethod
    def default(cls) -> "DeckSpec":
        return cls(
            counts={
                "杀": 30,
                "闪": 10,
                "桃": 6,
                "酒": 4,
                "无懈可击": 6,
                "南蛮入侵": 3,
                "万箭齐发": 3,
                "乐不思蜀": 2,
                "兵粮寸断": 2,
                "闪电": 1,
            },
            equips={
                "诸葛连弩": 2,
                "青釭剑": 2,
                "丈八蛇矛": 1,
                "青龙偃月刀": 2,
                "雌雄双股剑": 1,
                "贯石斧": 1,
                "方天画戟": 1,
                "麒麟弓": 1,
                "烈弓": 1,
                "寒冰剑": 1,
                "八卦阵": 2,
                "仁王盾": 2,
                "藤甲": 2,
                "赤兔": 2,
                "大宛": 1,
                "绝影": 1,
                "爪黄飞电": 1,
            },
        )


def build_deck(spec: Optional[DeckSpec] = None, rng: Optional[Rng] = None) -> List[Card]:
    """按规格生成牌堆（未洗牌）。"""
    spec = spec or DeckSpec.default()
    rng = rng or Rng()
    deck: List[Card] = []
    for name, count in spec.counts.items():
        kind = "basic" if name in ("杀", "闪", "桃", "酒", "无懈可击") else "trick"
        for i in range(count):
            suit = SUITS[i % len(SUITS)]
            rank = RANKS[(i * 3) % len(RANKS)]
            color = "red" if suit in ("桃", "方块") else "black"
            if name == "闪电":
                suit, rank, color = "黑桃", "A", "black"
            deck.append(Card(name=name, kind=kind, color=color, suit=suit, rank=rank))
    for name, count in spec.equips.items():
        info = EQUIPS[name]
        for i in range(count):
            suit = SUITS[i % len(SUITS)]
            rank = RANKS[(i * 5) % len(RANKS)]
            color = EQUIP_COLORS.get(name, "red" if suit in ("桃", "方块") else "black")
            deck.append(
                Card(
                    name=name,
                    kind="equip",
                    color=color,
                    suit=suit,
                    rank=rank,
                    extra=dict(info),
                )
            )
    return deck
