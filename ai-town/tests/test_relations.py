"""NPC 关系网每日演化：同工相熟、久不往来会淡、流言会伤信任。"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ai_town.fallback.narrator import Narrator
from ai_town.rng import RNG
from ai_town.state import TownState


def make_town(seed: int = 4, npcs: int = 6) -> TownState:
    st = TownState(name="关系镇", seed=seed)
    st.npcs = Narrator(RNG(seed)).npcs(st, npcs)
    return st


class TestRelationEvolution(unittest.TestCase):
    def test_co_workers_get_closer(self):
        st = make_town()
        farm = None
        for kind in ("farm", "market", "lumber"):
            ok, _ = st.build(kind)
            if ok:
                farm = st.buildings[-1]
                break
        a, b = st.npcs[0], st.npcs[1]
        for n in (a, b):
            farm.staff.append(n.id)
            n.job = farm.id
        before = a.relations.get(b.id, 0)
        for _ in range(6):
            st.evolve_relations(st.rng.spawn(f"rel-{st.day}-{_}"))
        self.assertGreater(a.relations.get(b.id, 0), before)

    def test_relation_values_stay_in_range(self):
        st = make_town()
        for _ in range(30):
            st.evolve_relations(st.rng.spawn(f"rel-{st.day}-{_}"))
            for n in st.npcs:
                for v in n.relations.values():
                    self.assertTrue(-100 <= v <= 100)
                self.assertTrue(0 <= n.trust <= 100)

    def test_rumor_eventually_bumps_behavior(self):
        st = make_town()
        for n in st.npcs:
            n.trust = 20  # 全镇都不满，才容易起流言
        for i in range(40):
            st.evolve_relations(st.rng.spawn(f"rel-{i}"))
        self.assertGreaterEqual(st.behavior.get("rumor", 0), 1)

    def test_trust_moves_with_relations(self):
        st = make_town()
        a, b = st.npcs[0], st.npcs[1]
        a.relations[b.id] = 90
        b.relations[a.id] = 90
        before = b.trust
        for i in range(30):
            st.evolve_relations(st.rng.spawn(f"rel-{i}"))
        self.assertGreaterEqual(b.trust, before)

    def test_no_npcs_is_safe(self):
        st = TownState(name="空镇", seed=1)
        self.assertEqual(st.evolve_relations(RNG(1)), [])


class TestRelationPersistence(unittest.TestCase):
    def test_relations_survive_save_load(self):
        st = make_town()
        st.evolve_relations(st.rng.spawn("rel-1"))
        st2 = TownState.from_dict(st.to_dict())
        self.assertEqual(len(st2.npcs), len(st.npcs))
        self.assertEqual(st2.npcs[0].relations, st.npcs[0].relations)


if __name__ == "__main__":
    unittest.main()
