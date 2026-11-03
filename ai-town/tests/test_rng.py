"""确定性随机数测试。"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ai_town.rng import RNG


class TestRNG(unittest.TestCase):
    def test_same_seed_same_sequence(self):
        a, b = RNG(123), RNG(123)
        seq_a = [a.random() for _ in range(20)]
        seq_b = [b.random() for _ in range(20)]
        self.assertEqual(seq_a, seq_b)

    def test_different_seed_differs(self):
        a, b = RNG(1), RNG(2)
        self.assertNotEqual([a.random() for _ in range(10)], [b.random() for _ in range(10)])

    def test_spawn_is_independent_but_reproducible(self):
        a, b = RNG(7), RNG(7)
        x = a.spawn("day-1").random()
        y = b.spawn("day-1").random()
        self.assertEqual(x, y)
        # 不同 key 不同流
        self.assertNotEqual(RNG(7).spawn("a").random(), RNG(7).spawn("b").random())

    def test_spawn_does_not_disturb_parent(self):
        a = RNG(9)
        before = a.random()
        b = RNG(9)
        b.spawn("x").random()
        b.spawn("y").random()
        self.assertEqual(before, b.random())

    def test_range_helpers(self):
        r = RNG(3)
        for _ in range(50):
            self.assertTrue(0 <= r.randint(1, 6) <= 6)
            self.assertTrue(0 <= r.randrange(10) < 10)
            self.assertTrue(0.0 <= r.random() < 1.0)

    def test_clone_copies_state(self):
        a = RNG(5)
        a.random()
        b = a.clone()
        self.assertEqual(a.random(), b.random())


if __name__ == "__main__":
    unittest.main()
