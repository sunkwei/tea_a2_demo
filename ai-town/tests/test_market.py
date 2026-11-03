"""行情风向：LLM 只说方向，数值由状态机定。"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ai_town.economy import Market, make_caravan
from ai_town.fallback.narrator import Narrator
from ai_town.llm.parsing import coerce_market
from ai_town.models import MarketBrief
from ai_town.rng import RNG
from ai_town.state import TownState

WHITELIST = ("food", "wood", "stone", "ore", "tools", "books", "liquor")


class TestCoerceMarket(unittest.TestCase):
    def test_whitelist_filters_unknown_goods(self):
        brief = coerce_market({"hot": ["food", "龙涎香"], "cold": ["ore"], "news": "粮价看涨"})
        self.assertIsNotNone(brief)
        self.assertEqual(brief.hot, ["food"])
        self.assertEqual(brief.cold, ["ore"])
        self.assertEqual(brief.news, "粮价看涨")

    def test_cold_excludes_hot(self):
        brief = coerce_market({"hot": ["food"], "cold": ["food", "ore"]})
        self.assertEqual(brief.cold, ["ore"])

    def test_empty_payload_rejected(self):
        self.assertIsNone(coerce_market({}))
        self.assertIsNone(coerce_market("不是对象"))

    def test_news_truncated(self):
        brief = coerce_market({"news": "长" * 500})
        self.assertLessEqual(len(brief.news), 120)

    def test_caravan_hint_capped(self):
        brief = coerce_market({"caravan_hint": ["food", "ore", "wood", "stone"]})
        self.assertLessEqual(len(brief.caravan_hint), 2)


class TestMarketBias(unittest.TestCase):
    def test_bias_pushes_price_up(self):
        m = Market(RNG(1))
        m.bias = {"food": 0.25}
        p0 = m.price_of("food")
        m.drift()
        self.assertGreater(m.price_of("food"), p0)

    def test_bias_pulls_price_down(self):
        m = Market(RNG(1))
        m.bias = {"food": -0.25}
        p0 = m.price_of("food")
        m.drift()
        self.assertLess(m.price_of("food"), p0)

    def test_bias_survives_save(self):
        m = Market(RNG(1))
        m.bias = {"ore": 0.05}
        m2 = Market.from_dict(m.to_dict(), RNG(1))
        self.assertAlmostEqual(m2.bias["ore"], 0.05)


class TestStateMarketBrief(unittest.TestCase):
    def setUp(self):
        self.st = TownState(name="行情镇", seed=42)

    def test_apply_sets_bias_and_notes(self):
        brief = MarketBrief(hot=["food"], cold=["ore"], news="粮价看涨")
        notes = self.st.apply_market_brief(brief)
        self.assertAlmostEqual(self.st.market.bias["food"], TownState.HOT_BIAS)
        self.assertAlmostEqual(self.st.market.bias["ore"], TownState.COLD_BIAS)
        self.assertTrue(any("粮价看涨" in n for n in notes))

    def test_caravan_hint_adds_demand(self):
        self.st.caravan = make_caravan(self.st.rng.spawn("c"), 1)
        before = len(self.st.caravan.demands)
        self.st.apply_market_brief(MarketBrief(hot=["food"], caravan_hint=["food"]))
        self.assertGreaterEqual(len(self.st.caravan.demands), before)
        self.assertIn("food", self.st.caravan.demands)

    def test_market_brief_survives_save(self):
        self.st.apply_market_brief(MarketBrief(hot=["food"], news="粮价看涨"))
        st2 = TownState.from_dict(self.st.to_dict())
        self.assertIsNotNone(st2.market_brief)
        self.assertEqual(st2.market_brief.hot, ["food"])
        self.assertIn("food", st2.market.bias)

    def test_offline_brief_is_whitelisted(self):
        brief = Narrator(RNG(7)).market_brief(self.st)
        self.assertTrue(brief.hot or brief.cold)
        for g in brief.hot + brief.cold + brief.caravan_hint:
            self.assertIn(g, WHITELIST)


class TestGameMarketFlow(unittest.TestCase):
    def test_advance_day_reports_market(self):
        from ai_town.game import Game

        g = Game(seed=1234, name="行情镇", offline=True)
        g.bootstrap()
        report = g.advance_day()
        self.assertIn("market", report)
        self.assertIn("market_notes", report)
        self.assertIsNotNone(g.state.market_brief)
        self.assertTrue(g.state.market_brief.news)

    def test_daily_event_count_in_range(self):
        from ai_town.game import Game

        g = Game(seed=99, name="行情镇", offline=True)
        g.bootstrap()
        for _ in range(12):
            n = g.daily_event_count()
            self.assertTrue(3 <= n <= 5, n)
            g.advance_day()


if __name__ == "__main__":
    unittest.main()
