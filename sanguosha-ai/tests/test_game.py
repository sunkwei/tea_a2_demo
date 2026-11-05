"""整局对局测试：规则策略跑完整局，必须能收敛、不许崩。"""

from __future__ import annotations

import unittest

from sanguosha_ai.config import GameConfig
from sanguosha_ai.game import Seat, Session
from sanguosha_ai.llm.policy import RulePolicy


def run_game(seed: int, heroes, max_turns: int = 40):
    cfg = GameConfig(seed=seed, max_turns=max_turns, llm_responses=False)
    seats = [
        Seat(model_key=f"rule-{i}", hero_key=h, policy=RulePolicy(), display="规则")
        for i, h in enumerate(heroes)
    ]
    events = []
    session = Session(cfg, seats, emit=events.append)
    result = session.run()
    return result, events, session


class TestFullGame(unittest.TestCase):
    def test_game_terminates_and_has_winner(self):
        result, events, session = run_game(11, ["zhang_fei", "zhu_ge_liang", "guan_yu"])
        self.assertTrue(result.turns <= 40)
        # 要么有人赢，要么到达回合上限（不能中途崩）
        win_events = [e for e in events if e.get("type") == "win"]
        if not win_events:
            self.assertTrue(any("回合上限" in str(e.get("text", "")) for e in events))
        for p in session.engine.players:
            self.assertGreaterEqual(p.hp, 0)

    def test_many_games_are_stable(self):
        wins = 0
        for seed in range(20, 30):
            result, events, _ = run_game(seed, ["zhang_fei", "zhu_ge_liang", "guan_yu"])
            self.assertGreater(result.turns, 0)
            if result.winner is not None:
                wins += 1
        self.assertGreater(wins, 0, "10 局里至少应该有一局分出胜负")

    def test_events_are_json_friendly(self):
        result, events, _ = run_game(31, ["zhang_fei", "cao_cao", "sun_quan"])
        for ev in events:
            self.assertIsInstance(ev, dict)
            self.assertIn("type", ev)
            self.assertIsInstance(ev.get("text", ""), str)


if __name__ == "__main__":
    unittest.main()
