"""可复现随机数。

引擎的所有随机（洗牌、判定、奸雄/反馈选牌）都走这里，
只要种子相同 + 动作序列相同，结果就完全一致，方便复盘和测试。
"""

from __future__ import annotations

import random
from typing import List, Sequence, TypeVar

T = TypeVar("T")


class Rng:
    def __init__(self, seed: int = 20261105) -> None:
        self.seed = seed
        self._r = random.Random(seed)

    def randint(self, a: int, b: int) -> int:
        return self._r.randint(a, b)

    def random(self) -> float:
        return self._r.random()

    def chance(self, p: float) -> bool:
        return self._r.random() < p

    def choice(self, seq: Sequence[T]) -> T:
        return self._r.choice(list(seq))

    def shuffle(self, seq: List[T]) -> None:
        self._r.shuffle(seq)

    def sample(self, seq: Sequence[T], k: int) -> List[T]:
        return self._r.sample(list(seq), k)
