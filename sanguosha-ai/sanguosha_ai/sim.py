"""无模型快速模拟：用规则策略跑完整对局，用来验证引擎不会崩、能正常收敛。

用法： python -m sanguosha_ai.sim --games 50
"""

from __future__ import annotations

import argparse
import collections
from typing import List

from .config import GameConfig
from .engine import Engine
from .game import Seat, Session
from .heroes import HEROES
from .llm.policy import RulePolicy
from .rng import Rng


def run_sim(seed: int = 1, max_turns: int = 40, heroes: List[str] = None, quiet: bool = True) -> dict:
    heroes = heroes or ["zhang_fei", "zhu_ge_liang", "guan_yu"]
    from .heroes import get_hero

    cfg = GameConfig(seed=seed, max_turns=max_turns, llm_responses=False)
    seats = [
        Seat(model_key=f"rule-{i}", hero_key=h, policy=RulePolicy(), display="规则")
        for i, h in enumerate(heroes)
    ]
    events = []
    session = Session(cfg, seats, emit=events.append)
    result = session.run()
    if not quiet:
        for ev in events:
            print(f"[{ev.get('type')}] {ev.get('text')}")
    return {
        "winner": result.winner_name,
        "turns": result.turns,
        "events": len(events),
        "hp": [p.hp for p in session.engine.players],
        "alive": [p.alive for p in session.engine.players],
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--games", type=int, default=30)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--max-turns", type=int, default=40)
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()
    wins = collections.Counter()
    turns = []
    for i in range(args.games):
        r = run_sim(seed=args.seed + i, max_turns=args.max_turns, quiet=not args.verbose)
        wins[r["winner"] or "平局"] += 1
        turns.append(r["turns"])
    print(f"跑了 {args.games} 局，平均回合 {sum(turns)/max(1,len(turns)):.1f}")
    for k, v in wins.most_common():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
