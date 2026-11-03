"""游戏闭环测试（离线模式，不调用网络）。"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ai_town.game import Game


class TestGameLoop(unittest.TestCase):
    def setUp(self):
        self.game = Game(seed=20241103, name="环测镇", offline=True)
        self.game.bootstrap()

    def test_bootstrap(self):
        st = self.game.state
        self.assertEqual(len(st.npcs), 8)
        self.assertGreaterEqual(len(st.buildings), 1)
        self.assertEqual(len(st.events), 4)
        self.assertEqual(len(st.quests), 1)
        for ev in st.events:
            self.assertTrue(ev.text)
            self.assertTrue(ev.choices)

    def test_action_returns_choices(self):
        out = self.game.do_action("我去集市看看行情")
        self.assertTrue(out.narrative)
        self.assertEqual(len(out.choices), 3)

    def test_choice_updates_resources(self):
        out = self.game.do_action("我把粮食分给缺粮的人家")
        self.assertTrue(out.choices)
        ch = out.choices[0]
        before = dict(self.game.state.resources)
        res = self.game.apply_choice(ch)
        self.assertTrue(res.changes)
        self.assertNotEqual(before, dict(self.game.state.resources))

    def test_talk_to_npc(self):
        npc = self.game.state.npcs[0]
        out = self.game.do_action(f"我去找{npc.name}聊聊")
        self.assertTrue(out.narrative)
        self.assertTrue(npc.met)
        self.assertTrue(out.choices)

    def test_resolve_event(self):
        ev = self.game.state.events[0]
        out = self.game.resolve_event(ev.id, ev.choices[0].id)
        self.assertTrue(out.changes or out.narrative)
        self.assertTrue(ev.resolved)

    def test_next_day_advances(self):
        day = self.game.state.day
        report = self.game.advance_day()
        self.assertIn("notes", report)
        self.assertNotEqual(self.game.state.day, day)
        self.assertEqual(len(self.game.state.events), 4)

    def test_memory_grows(self):
        before = len(self.game.state.memory)
        self.game.do_action("我去北坡看看")
        self.assertGreater(len(self.game.state.memory), before)

    def test_trade(self):
        ok, msg = self.game.sell("ore", 1)
        self.assertTrue(ok, msg)
        ok, msg = self.game.buy("ore", 1)
        self.assertTrue(ok, msg)

    def test_trade_rejects_overspend(self):
        self.game.state.resources["coin"] = 0
        ok, _ = self.game.buy("ore", 100)
        self.assertFalse(ok)

    def test_save_and_load(self):
        self.game.do_action("我去井台看看")
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "s.json")
            self.game.save(path)
            g2 = Game.load(path, llm=self.game.llm)
            self.assertEqual(g2.state.name, self.game.state.name)
            self.assertEqual(g2.state.day, self.game.state.day)
            self.assertEqual(len(g2.state.npcs), len(self.game.state.npcs))
            self.assertEqual(len(g2.state.memory), len(self.game.state.memory))

    def test_ending(self):
        ending = self.game.end_run()
        self.assertTrue(ending.title)
        self.assertTrue(self.game.state.over)

    def test_twenty_days_stable(self):
        """连跑 20 天，数值不能崩（不能出现负数/None）。"""
        for _ in range(20):
            for ev in self.game.open_events():
                self.game.resolve_event(ev.id, ev.choices[0].id)
            out = self.game.do_action("我在镇上转一圈，看看大家怎么样")
            if out.choices:
                self.game.apply_choice(out.choices[0])
            self.game.advance_day()
            st = self.game.state
            for key, val in st.resources.items():
                self.assertIsInstance(val, int)
                self.assertGreaterEqual(val, 0)
            self.assertGreaterEqual(st.morale, 0)
            self.assertLessEqual(st.morale, 100)
            self.assertGreaterEqual(st.population, 0)


if __name__ == "__main__":
    unittest.main()
