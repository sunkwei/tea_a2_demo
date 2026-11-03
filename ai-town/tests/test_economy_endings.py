"""经济、结局、程序化叙述器测试。"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ai_town.economy import GOODS, Market, make_caravan
from ai_town.endings import ENDINGS, evaluate
from ai_town.fallback.narrator import Narrator
from ai_town.models import NPC, Quest
from ai_town.rng import RNG
from ai_town.state import TownState


def make_town(seed=1, npcs=5):
    st = TownState("测试镇", seed)
    for i in range(npcs):
        st.npcs.append(NPC(id=f"n{i}", name=f"居民{i}", role="农夫", trust=50, mood=50))
    return st


class TestMarket(unittest.TestCase):
    def test_prices_bounded(self):
        m = Market(RNG(1))
        for _ in range(200):
            m.drift()
        for good, price in m.prices.items():
            base = GOODS[good]["base"]
            self.assertGreaterEqual(price, base * 0.4)
            self.assertLessEqual(price, base * 2.5)

    def test_spread(self):
        m = Market(RNG(1))
        self.assertGreater(m.sell_price("food"), m.buy_price("food"))

    def test_drift_reports(self):
        m = Market(RNG(2))
        notes = m.drift()
        self.assertIsInstance(notes, list)

    def test_caravan(self):
        c = make_caravan(RNG(3), day=5)
        self.assertTrue(c.demands)
        self.assertTrue(c.demand_text())


class TestEndings(unittest.TestCase):
    def test_default_is_ordinary(self):
        st = make_town()
        self.assertEqual(evaluate(st).key, "ordinary")

    def test_all_endings_have_text(self):
        for e in ENDINGS:
            self.assertTrue(e["title"])
            self.assertTrue(e["text"])
            self.assertIn(e["tone"], ("good", "bad", "neutral", "mixed"))

    def test_at_least_twelve_endings(self):
        self.assertGreaterEqual(len(ENDINGS), 12)

    def test_legend(self):
        st = make_town(npcs=14)
        st.morale = 90
        st.resources["renown"] = 80
        st.resources["coin"] = 900
        for n in st.npcs:
            n.trust = 80
        self.assertEqual(evaluate(st).key, "legend")

    def test_iron_hand(self):
        st = make_town()
        st.behavior["harsh"] = 9
        self.assertEqual(evaluate(st).key, "iron_hand")

    def test_quest_done(self):
        st = make_town()
        st.quests = [Quest(id="q1", title="t", premise="p", status="done")]
        self.assertEqual(evaluate(st).key, "mystery_solved")

    def test_granary_empty(self):
        st = make_town()
        st.resources["food"] = 0
        st.morale = 30
        self.assertEqual(evaluate(st).key, "granary_empty")


class TestNarrator(unittest.TestCase):
    def test_npcs(self):
        st = make_town()
        n = Narrator(RNG(5))
        npcs = n.npcs(st, 8)
        self.assertEqual(len(npcs), 8)
        for npc in npcs:
            self.assertTrue(npc.name)
            self.assertTrue(npc.role)
            self.assertTrue(npc.secret)

    def test_events(self):
        st = make_town()
        n = Narrator(RNG(5))
        events = n.events(st, 4)
        self.assertEqual(len(events), 4)
        for ev in events:
            self.assertTrue(ev.title)
            self.assertTrue(ev.text)
            self.assertGreaterEqual(len(ev.choices), 2)
            for c in ev.choices:
                self.assertTrue(c.label)

    def test_events_deterministic(self):
        st1, st2 = make_town(seed=11), make_town(seed=11)
        n1, n2 = Narrator(RNG(3)), Narrator(RNG(3))
        e1 = [e.title for e in n1.events(st1, 4)]
        e2 = [e.title for e in n2.events(st2, 4)]
        self.assertEqual(e1, e2)

    def test_narrate_action(self):
        st = make_town()
        n = Narrator(RNG(5))
        text, choices = n.narrate(st, "我想建一座农田")
        self.assertTrue(text)
        self.assertEqual(len(choices), 3)

    def test_quest(self):
        st = make_town()
        n = Narrator(RNG(5))
        q = n.quest(st)
        self.assertTrue(q.title)
        self.assertTrue(q.premise)
        self.assertEqual(len(q.stages), 3)

    def test_talk(self):
        st = make_town()
        n = Narrator(RNG(5))
        text, choices = n.talk(st, st.npcs[0], "你到底藏了什么秘密")
        self.assertTrue(text)
        self.assertEqual(len(choices), 3)


if __name__ == "__main__":
    unittest.main()
