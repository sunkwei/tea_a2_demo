"""经济系统：商品、价格波动、商队需求。

价格是随机游走 + 季节/事件修正，全部由确定性 RNG 驱动。
LLM 可以"提议"一次商机，但价格数字由这里说了算。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .rng import RNG

#: 商品定义：基础价 / 分类
GOODS: Dict[str, Dict[str, Any]] = {
    "food": {"name": "粮食", "base": 4, "cat": "raw"},
    "wood": {"name": "木材", "base": 6, "cat": "raw"},
    "stone": {"name": "石料", "base": 8, "cat": "raw"},
    "ore": {"name": "矿石", "base": 12, "cat": "raw"},
    "tools": {"name": "工具", "base": 20, "cat": "craft"},
    "books": {"name": "书籍", "base": 30, "cat": "lux"},
    "liquor": {"name": "烈酒", "base": 18, "cat": "lux"},
}

RAW_GOODS: List[str] = ["food", "wood", "stone", "ore"]

CARAVAN_NAMES = [
    "北岭商队", "盐湖车队", "青石驼队", "长风马帮", "白鹭商旅",
    "落雁行商", "铜锣商队", "双桥货郎", "雪岭驮队", "赤水粮行",
]

CARAVAN_CARGO = ["food", "wood", "ore", "liquor", "tools", "salt", "spice", "cloth"]

CARAVAN_GOODS: Dict[str, str] = {
    "salt": "盐",
    "spice": "香料",
    "cloth": "布匹",
}


def good_name(key: str) -> str:
    if key in GOODS:
        return GOODS[key]["name"]
    return CARAVAN_GOODS.get(key, key)


@dataclass
class Caravan:
    """一支到镇上的商队：求购某些货物，顺便贩卖稀有货。"""

    id: str
    name: str
    day: int
    demands: Dict[str, int] = field(default_factory=dict)     # 货物 -> 数量
    offers: Dict[str, int] = field(default_factory=dict)       # 货物 -> 数量
    rate: float = 1.35                                        # 求购价倍率
    goodwill: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "day": self.day,
            "demands": dict(self.demands),
            "offers": dict(self.offers),
            "rate": self.rate,
            "goodwill": self.goodwill,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Caravan":
        return cls(
            id=str(d.get("id", "")),
            name=str(d.get("name", "")),
            day=int(d.get("day", 0)),
            demands={str(k): int(v) for k, v in (d.get("demands") or {}).items()},
            offers={str(k): int(v) for k, v in (d.get("offers") or {}).items()},
            rate=float(d.get("rate", 1.35)),
            goodwill=int(d.get("goodgoodwill", d.get("goodwill", 0))),
        )

    def add_demand(self, good: str, qty: int) -> None:
        """行情风向追加求购（数量由状态机说了算）。"""
        self.demands[good] = max(0, self.demands.get(good, 0) + int(qty))

    def demand_text(self) -> str:
        parts = [f"{good_name(g)}×{q}" for g, q in self.demands.items()]
        return "、".join(parts)


class Market:
    """市场价格。ref_price 是行情价，实际买卖有买卖差价。"""

    SPREAD = 0.18

    def __init__(self, rng: Optional[RNG] = None, prices: Optional[Dict[str, float]] = None):
        self.rng = rng or RNG(0)
        #: 每日价格偏置（来自 LLM 行情风向），单位是每天的涨跌比例
        self.bias: Dict[str, float] = {}
        if prices:
            self.prices = {k: float(v) for k, v in prices.items()}
        else:
            self.prices = {
                k: float(v["base"]) * self.rng.uniform(0.92, 1.08) for k, v in GOODS.items()
            }

    # -- 价格 -----------------------------------------------------------
    def price_of(self, good: str) -> float:
        return float(self.prices.get(good, GOODS.get(good, {"base": 5})["base"]))

    def buy_price(self, good: str) -> int:
        """镇民买入价（玩家卖货拿到的钱）。"""
        return max(1, int(round(self.price_of(good) * (1 - self.SPREAD))))

    def sell_price(self, good: str) -> int:
        """玩家买入价（玩家买货花的钱）。"""
        return max(1, int(round(self.price_of(good) * (1 + self.SPREAD))))

    def trend(self, good: str) -> int:
        base = float(GOODS.get(good, {"base": 5})["base"])
        p = self.price_of(good)
        if p > base * 1.15:
            return 1
        if p < base * 0.85:
            return -1
        return 0

    def drift(self, modifiers: Optional[Dict[str, float]] = None) -> List[str]:
        """每日行情波动，返回给玩家看的行情摘要。"""
        notes: List[str] = []
        for good in list(self.prices.keys()):
            base = float(GOODS.get(good, {"base": 5})["base"])
            step = self.rng.uniform(-0.12, 0.12)
            mod = float((modifiers or {}).get(good, 0.0))
            bias = float(self.bias.get(good, 0.0))
            newp = self.prices[good] * (1 + step + bias) + mod
            self.prices[good] = max(base * 0.5, min(base * 2.4, newp))
        for good in RAW_GOODS:
            t = self.trend(good)
            if t > 0:
                notes.append(f"{good_name(good)}涨价")
            elif t < 0:
                notes.append(f"{good_name(good)}跌价")
        return notes

    def to_dict(self) -> Dict[str, Any]:
        return {"prices": dict(self.prices), "bias": dict(self.bias)}

    @classmethod
    def from_dict(cls, d: Dict[str, Any], rng: Optional[RNG] = None) -> "Market":
        m = cls(rng=rng, prices=(d or {}).get("prices"))
        raw = (d or {}).get("bias") or {}
        if isinstance(raw, dict):
            m.bias = {str(k): float(v) for k, v in raw.items() if isinstance(v, (int, float))}
        return m


def make_caravan(
    rng: RNG,
    day: int,
    price_hint: Optional[Dict[str, float]] = None,
    demand_hint: Optional[List[str]] = None,
) -> Caravan:
    """生成一支商队。

    demand_hint：LLM 行情风向点名的货物会被优先写进求购清单，
    但具体数量仍然由这里的确定性随机决定。
    """
    name = rng.choice(CARAVAN_NAMES)
    n_demand = 1 if rng.chance(0.65) else 2
    wants = rng.sample(RAW_GOODS, n_demand)
    demands: Dict[str, int] = {}
    for g in wants:
        demands[g] = rng.randint(8, 24)
    for hint in list(demand_hint or [])[:2]:
        if hint in demands:
            demands[hint] = max(demands[hint], rng.randint(14, 28))
        elif hint in RAW_GOODS and len(demands) < 3:
            demands[hint] = rng.randint(10, 24)
    offers: Dict[str, int] = {}
    n_offer = 1 if rng.chance(0.7) else 2
    for g in rng.sample(CARAVAN_CARGO, n_offer):
        offers[g] = rng.randint(2, 8)
    rate = round(rng.uniform(1.25, 1.55), 2)
    return Caravan(
        id=f"car_{day}_{rng.randint(1000, 9999)}",
        name=name,
        day=day,
        demands=demands,
        offers=offers,
        rate=rate,
    )
