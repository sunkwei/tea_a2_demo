"""全 NPC 自动玩测试。"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ai_town import npc_life
from ai_town.agents.autopilot import Autopilot, LLMPolicy, RulePolicy
from ai_town.autoplay import inject_npc_events, run
from ai_town.game import Game


def offline_game(seed=1234, name="自动镇"):
    g = Game(seed=seed, name=name, offline=True)
    g.bootstrap()
    return g


class TestNpcLife(unittest.TestCase):
    def test_daily_events_shape(self):
        g = offline_game()
        st = g.state
        events, happenings = npc_life.daily_npc_events(st, st.rng.spawn("npclife"), max_events=2)
        self.assertLessEqual(len(events), 2)
        for ev in events:
            self.assertTrue(ev.title)
            self.assertTrue(ev.text)
            self.assertTrue(ev.choices)
            self.assertEqual(ev.source, "npc")
        self.assertIsInstance(happenings, list)

    def test_events_are_asking_mayor(self):
        g = offline_game()
        st = g.state
        events, _ = npc_life.daily_npc_events(st, st.rng.spawn("npclife2"), max_events=2)
        for ev in events:
            for ch in ev.choices:
                self.assertTrue(ch.label)
                self.assertIsInstance(ch.effects, dict)

    def test_inject_keeps_total_bounded(self):
        g = offline_game()
        st = g.state
        inject_npc_events(g, st.rng.spawn("inj"))
        self.assertLessEqual(len(st.events), 5)


class TestRulePolicy(unittest.TestCase):
    def test_action_depends_on_state(self):
        g = offline_game()
        rule = RulePolicy()
        st = g.state
        # 缺粮 → 优先搞粮
        st.resources["food"] = 0
        action = rule.choose_action(g, [])
        self.assertTrue(action)
        self.assertIn("粮", action)

    def test_branch_index_valid(self):
        g = offline_game()
        rule = RulePolicy()
        for ev in g.state.events:
            for pref in ("省钱", "施恩", "冒险", "求稳", "追查"):
                idx = rule.choose_branch(ev, 0, pref)
                self.assertTrue(0 <= idx < len(ev.choices))

    def test_decide_returns_valid_picks(self):
        g = offline_game()
        rule = RulePolicy()
        events = g.open_events()
        d = rule.decide(g, events)
        self.assertTrue(d.action)
        self.assertEqual(len(d.event_picks), len(events))
        for i, ev in enumerate(events):
            self.assertTrue(0 <= d.event_picks[i] < len(ev.choices))


class TestAutopilot(unittest.TestCase):
    def test_llm_policy_offline_returns_none(self):
        g = offline_game()
        self.assertIsNone(LLMPolicy(g.llm).decide(g, []))

    def test_step_resolves_events(self):
        g = offline_game()
        pilot = Autopilot(g, policy="rule")
        today = list(g.state.events)
        entry = pilot.step()
        self.assertTrue(entry["decision"])
        self.assertGreaterEqual(len(entry["events"]), 0)
        # 当天的事件都被裁完了（advance_day 之后 events 已经换成下一天的）
        for ev in today:
            self.assertTrue(ev.resolved, f"事件没被处理：{ev.title}")
        self.assertEqual(len(entry["events"]), len([e for e in today if e.choices]))
        self.assertGreater(g.state.day, 1)

    def test_ten_days_stay_sane(self):
        g = offline_game(seed=99)
        pilot = Autopilot(g, policy="rule")
        for _ in range(10):
            pilot.step()
            st = g.state
            for v in st.resources.values():
                self.assertGreaterEqual(v, 0)
            self.assertGreaterEqual(st.morale, 0)
            self.assertLessEqual(st.morale, 100)
            self.assertGreaterEqual(st.population, 0)

    def test_run_wrapper(self):
        g = run(days=3, seed=11, offline=True, policy="rule", verbose=False)
        self.assertTrue(g.state.over)
        self.assertTrue(g.state.ending)


if __name__ == "__main__":
    unittest.main()
