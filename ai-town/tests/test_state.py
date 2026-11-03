"""状态机测试：资源结算、日循环、建筑、存档。"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ai_town.models import NPC
from ai_town.state import BUILDING_DEFS, TownState


def make_town(seed=42, npcs=4):
    st = TownState("测试镇", seed)
    for i in range(npcs):
        st.npcs.append(NPC(id=f"n{i}", name=f"居民{i}", role="农夫", trust=50))
    return st


class TestEffects(unittest.TestCase):
    def test_resource_effects(self):
        st = make_town()
        before = st.resource("coin")
        changes = st.resolve_effects({"coin": -30, "food": 10})
        self.assertEqual(st.resource("coin"), before - 30)
        self.assertEqual(st.resource("food"), 80 + 10)
        self.assertTrue(any("金币" in c for c in changes))

    def test_resources_never_negative(self):
        st = make_town()
        st.resolve_effects({"coin": -99999})
        self.assertEqual(st.resource("coin"), 0)

    def test_semantic_effects(self):
        st = make_town()
        morale = st.morale
        st.resolve_effects({"kind": 1})
        self.assertGreater(st.morale, morale)
        self.assertGreater(st.resource("renown"), 10)

    def test_trust_effect(self):
        st = make_town()
        st.resolve_effects({"trust:n0": 2})
        self.assertEqual(st.find_npc("n0").trust, 50 + 10)

    def test_morale_clamped(self):
        st = make_town()
        st.resolve_effects({"morale": 500})
        self.assertLessEqual(st.morale, 100)
        st.resolve_effects({"morale": -500})
        self.assertGreaterEqual(st.morale, 0)

    def test_flag_records_behavior(self):
        st = make_town()
        st.resolve_effects({"flag:追查旧账": 1})
        self.assertTrue(st.flags.get("追查旧账"))
        self.assertEqual(st.behavior.get("追查旧账"), 1)

    def test_population_growth(self):
        st = make_town(npcs=2)
        st.resolve_effects({"population": 1})
        self.assertEqual(st.population, 3)

    def test_build_effect_requires_resources(self):
        st = make_town()
        st.resources["coin"] = 0
        changes = st.resolve_effects({"build:market": 1})
        self.assertEqual(len(st.buildings), 0)
        self.assertTrue(any("不足" in c for c in changes))

    def test_build_effect_with_resources(self):
        st = make_town()
        st.resolve_effects({"build:market": 1})
        self.assertEqual(len(st.buildings), 1)
        self.assertEqual(st.buildings[0].kind, "market")


class TestDayCycle(unittest.TestCase):
    def test_tick_produces_and_consumes(self):
        st = make_town(npcs=2)
        ok, _ = st.build("farm")
        self.assertTrue(ok)
        st.buildings[0].staff = ["n0", "n1"]
        st.day = 1
        food_before = st.resource("food")
        report = st.tick_day()
        self.assertIn("produced", report)
        produced = report["produced"].get("food", 0)
        self.assertGreater(produced, 0)
        # 产出减去口粮（2 口人 = 2 份）
        self.assertEqual(st.resource("food"), food_before + produced - 2)
        self.assertTrue(any("吃掉" in n for n in report["notes"]))

    def test_famine_lowers_morale(self):
        st = make_town(npcs=6)
        st.resources["food"] = 0
        morale = st.morale
        st.tick_day()
        self.assertLess(st.morale, morale)
        self.assertGreater(st.behavior.get("hunger", 0), 0)

    def test_calendar_rolls_over(self):
        st = make_town()
        st.day = 30
        st.season = "秋"
        st.season_index = 2
        st.advance_calendar()
        self.assertEqual(st.day, 1)
        self.assertEqual(st.season, "冬")
        self.assertEqual(st.season_index, 3)

    def test_year_rolls_after_four_seasons(self):
        st = make_town()
        st.day = 30
        st.season_index = 3
        st.year = 1
        st.advance_calendar()
        self.assertEqual(st.season_index, 0)
        self.assertEqual(st.year, 2)

    def test_taxes_collected(self):
        st = make_town(npcs=5)
        coin = st.resource("coin")
        st.tick_day()
        self.assertGreater(st.resource("coin"), coin - 10)


class TestBuildings(unittest.TestCase):
    def test_cost_deducted(self):
        st = make_town()
        before = st.resource("coin")
        st.build("farm")
        self.assertEqual(st.resource("coin"), before - BUILDING_DEFS["farm"]["cost"]["coin"])

    def test_cannot_build_without_space_or_money(self):
        st = make_town()
        st.resources["coin"] = 1
        ok, msg = st.build("mine")
        self.assertFalse(ok)
        self.assertIn("不足", msg)

    def test_hire_assigns_staff(self):
        st = make_town()
        st.build("farm")
        b = st.buildings[0]
        ok, _ = st.hire("n0", b.id)
        self.assertTrue(ok)
        self.assertIn("n0", b.staff)
        self.assertEqual(st.find_npc("n0").job, b.id)


class TestSerialization(unittest.TestCase):
    def test_roundtrip(self):
        st = make_town(npcs=3)
        st.build("farm")
        st.add_memory("action", "干了一件事")
        st.behavior["kind"] = 2
        data = st.to_dict()
        st2 = TownState.from_dict(data)
        self.assertEqual(st2.name, st.name)
        self.assertEqual(st2.day, st.day)
        self.assertEqual(st2.population, st.population)
        self.assertEqual(len(st2.buildings), len(st.buildings))
        self.assertEqual(st2.behavior, st.behavior)
        self.assertEqual(len(st2.memory), len(st.memory))

    def test_missing_fields_tolerated(self):
        st2 = TownState.from_dict({"name": "残档"})
        self.assertEqual(st2.name, "残档")
        self.assertEqual(st2.population, 0)


if __name__ == "__main__":
    unittest.main()
