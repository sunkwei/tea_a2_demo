"""确定性随机数。

所有随机都必须可复现：同一个 seed + 同一串操作序列 => 完全相同的世界。
子流用 key 派生，避免"多抽一次随机数就全盘错位"。
"""
from __future__ import annotations

import hashlib
import random
from typing import Optional


def _hash_seed(seed: int, key: str) -> int:
    h = hashlib.blake2b(f"{int(seed)}::{key}".encode("utf-8"), digest_size=8).digest()
    return int.from_bytes(h, "big")


class RNG:
    """带命名子流的确定性随机源。"""

    __slots__ = ("seed", "_r")

    def __init__(self, seed: int = 0):
        self.seed = int(seed)
        self._r = random.Random(self.seed)

    # -- 基本接口 -------------------------------------------------------
    def random(self) -> float:
        return self._r.random()

    def randint(self, a: int, b: int) -> int:
        return self._r.randint(a, b)

    def randrange(self, start: int, stop: Optional[int] = None) -> int:
        if stop is None:
            return self._r.randrange(start)
        return self._r.randrange(start, stop)

    def uniform(self, a: float, b: float) -> float:
        return self._r.uniform(a, b)

    def choice(self, seq):
        seq = list(seq)
        if not seq:
            raise IndexError("choice on empty sequence")
        return self._r.choice(seq)

    def shuffle(self, seq) -> None:
        self._r.shuffle(seq)

    def sample(self, seq, k: int):
        pool = list(seq)
        k = max(0, min(k, len(pool)))
        return self._r.sample(pool, k)

    def chance(self, p: float) -> bool:
        return self._r.random() < p

    def gauss(self, mu: float = 0.0, sigma: float = 1.0) -> float:
        return self._r.gauss(mu, sigma)

    # -- 子流 -----------------------------------------------------------
    def spawn(self, key: str) -> "RNG":
        """派生一条互相独立但可复现的子流。"""
        return RNG(_hash_seed(self.seed, key))

    def fork(self, key: str) -> "RNG":
        """派生并推进自身状态（用于"这一次行动"）。"""
        self._r.random()
        return self.spawn(key)

    def clone(self) -> "RNG":
        r = RNG(self.seed)
        r._r = random.Random()
        r._r.setstate(self._r.getstate())
        return r
