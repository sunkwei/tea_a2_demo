"""记忆驱动「翻旧账」：旧事变成今天找上门的事件。"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ai_town import callbacks
from ai_town.fallback.narrator import Narrator
from ai_town.models import EventCard
from ai_town.rng import RNG
from ai_town.state import TownState


def make_town(seed: int = 5, npcs: int = 6) -> TownState:
    st = TownState(name="旧账镇", seed=seed)
    st.npcs = Narrator(RNG(seed)).npcs(st, npcs)
    return st


class TestRecall(unittest.TestCase):
    def test_no_memory_no_recall(self):
        st = make_town()
        self.assertEqual(callbacks.recall(st), [])

    def test_recall_picks_relevant_memory(self):
        st = make_town()
        st.add_memory("event", "你选择了「开仓放粮」", ["choice", "kind", "food"])
        st.add_memory("action", "镇长决定：去北坡挖矿", ["action"])
        picked = callbacks.recall(st)
        self.assertTrue(picked)
        self.assertIn("开仓放粮", picked[0].text)

    def test_recall_lines_mentions_day(self):
        st = make_town()
        st.add_memory("event", "你选择了「加税三成」", ["choice", "harsh"])
        lines = callbacks.recall_lines(st)
        self.assertIn("加税三成", lines)
        self.assertIn("天", lines)


class TestCallbackEvent(unittest.TestCase):
    def test_event_has_three_choices_and_cites_deed(self):
        st = make_town()
        st.add_memory("event", "你选择了「加税三成」", ["choice", "harsh"])
        ev = callbacks.callback_event(st, RNG(11))
        self.assertIsNotNone(ev)
        self.assertEqual(len(ev.choices), 3)
        self.assertIn("callback", ev.tags)
        self.assertIn("加税三成", ev.text)

    def test_event_mentions_npc(self):
        st = make_town()
        st.add_memory("event", "你选择了「开仓放粮」", ["choice", "kind"])
        ev = callbacks.callback_event(st, RNG(3))
        self.assertTrue(any(n.name in ev.text for n in st.npcs if n.alive))

    def test_inject_respects_daily_cap(self):
        st = make_town()
        st.add_memory("event", "你选择了「加税三成」", ["choice", "harsh"])
        events = [EventCard(id=f"e{i}", title=f"普通事{i}", text="无关紧要", kind="routine")
                  for i in range(5)]
        ev = callbacks.maybe_inject(st, events, RNG(2), chance=1.0)
        self.assertIsNotNone(ev)
        self.assertLessEqual(len(events), 5)
        self.assertIn("callback", events[0].tags)

    def test_inject_skips_when_no_memory(self):
        st = make_town()
        events = [EventCard(id="e0", title="普通事", text="无关紧要", kind="routine")]
        self.assertIsNone(callbacks.maybe_inject(st, events, RNG(2), chance=1.0))

    def test_deterministic_same_seed(self):
        st1 = make_town(seed=8)
        st1.add_memory("event", "你选择了「烧掉账本」", ["choice", "harsh"])
        st2 = make_town(seed=8)
        st2.add_memory("event", "你选择了「烧掉账本」", ["choice", "harsh"])
        a = callbacks.callback_event(st1, RNG(77))
        b = callbacks.callback_event(st2, RNG(77))
        self.assertEqual(a.title, b.title)
        self.assertEqual(a.text, b.text)
        self.assertEqual([c.label for c in a.choices], [c.label for c in b.choices])


class TestCallbackInGameLoop(unittest.TestCase):
    def test_callback_appears_over_many_days(self):
        from ai_town.game import Game

        g = Game(seed=2024, name="旧账镇", offline=True)
        g.bootstrap()
        seen = 0
        for _ in range(25):
            out = g.do_action("我打算去集市走一趟")
            if out.choices:
                g.apply_choice(out.choices[0])
            report = g.advance_day()
            if report.get("callback"):
                seen += 1
        self.assertGreater(seen, 0, "25 天里应该至少出现一次翻旧账")


if __name__ == "__main__":
    unittest.main()
