"""JSON 解析与结构校验测试（针对小模型常见的坏输出）。"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ai_town.llm.parsing import (
    coerce_action,
    coerce_events,
    coerce_npcs,
    extract_json,
    sanitize_effects,
)


class TestExtractJSON(unittest.TestCase):
    def test_plain(self):
        self.assertEqual(extract_json('{"a":1}'), {"a": 1})

    def test_markdown_fence(self):
        text = "好的，这是结果：\n```json\n{\"a\": 2}\n```\n希望有用"
        self.assertEqual(extract_json(text), {"a": 2})

    def test_fence_without_language(self):
        self.assertEqual(extract_json("```\n{\"a\": 3}\n```"), {"a": 3})

    def test_trailing_text(self):
        self.assertEqual(extract_json('{"a": 4}  以上就是全部'), {"a": 4})

    def test_chinese_quotes(self):
        self.assertEqual(extract_json('{“a”: 5}'), {"a": 5})

    def test_trailing_comma(self):
        self.assertEqual(extract_json('{"a": 6,}'), {"a": 6})

    def test_missing_colon(self):
        self.assertEqual(extract_json('{"title" "薄田里的官印"}'), {"title": "薄田里的官印"})

    def test_unterminated_string_value(self):
        raw = '{"events":[{"effects":{"flag:x":"}}]}'
        data = extract_json(raw)
        self.assertIsInstance(data, dict)
        self.assertIn("events", data)

    def test_array_root(self):
        self.assertEqual(extract_json('[{"a":1}]'), [{"a": 1}])

    def test_garbage_returns_none(self):
        self.assertIsNone(extract_json("完全没有 JSON 的一段话"))
        self.assertIsNone(extract_json(""))


class TestSanitizeEffects(unittest.TestCase):
    def test_keeps_allowed_numeric(self):
        out = sanitize_effects({"coin": -10, "food": 5, "morale": 3})
        self.assertEqual(out["coin"], -10)
        self.assertEqual(out["food"], 5)
        self.assertEqual(out["morale"], 3)

    def test_drops_unknown_keys(self):
        out = sanitize_effects({"hack_the_world": 100, "coin": 1})
        self.assertNotIn("hack_the_world", out)

    def test_semantic_tags_kept(self):
        out = sanitize_effects({"kind": 1, "costly": True})
        self.assertEqual(out.get("kind"), 1)
        self.assertEqual(out.get("costly"), 1)

    def test_prefixed_keys_kept(self):
        out = sanitize_effects({"trust:n_1": 2, "build:market": 1, "flag:线索": 1})
        self.assertEqual(out["trust:n_1"], 2)
        self.assertEqual(out["build:market"], 1)
        self.assertEqual(out["flag:线索"], 1)

    def test_clamps_big_numbers(self):
        out = sanitize_effects({"coin": 99999})
        self.assertLessEqual(abs(out["coin"]), 100)

    def test_non_dict_input(self):
        self.assertEqual(sanitize_effects("nope"), {})
        self.assertEqual(sanitize_effects(None), {})


class TestCoerce(unittest.TestCase):
    def test_coerce_events(self):
        data = {
            "events": [
                {
                    "title": "井水变苦",
                    "kind": "天灾",
                    "text": "井水泛着铁腥味。",
                    "choices": [
                        {"label": "封井", "effects": {"coin": -10}},
                        {"label": "清理", "effects": {"coin": -20}},
                    ],
                }
            ]
        }
        evs = coerce_events(data, day=3, source="llm")
        self.assertEqual(len(evs), 1)
        self.assertEqual(evs[0].kind, "disaster")
        self.assertEqual(evs[0].day, 3)
        self.assertEqual(len(evs[0].choices), 2)

    def test_coerce_events_accepts_list_root(self):
        evs = coerce_events([{"title": "t", "text": "x"}], day=1)
        self.assertEqual(len(evs), 1)

    def test_coerce_events_skips_broken(self):
        evs = coerce_events([{"title": "", "text": "x"}, {"text": "no title"}], day=1)
        self.assertEqual(len(evs), 0)

    def test_coerce_npcs(self):
        data = {"npcs": [{"name": "阿禾", "role": "农夫", "age": 30, "traits": ["安静"],
                           "background": "种了一辈子地", "secret": "藏着一封信"}]}
        npcs = coerce_npcs(data, day=1)
        self.assertEqual(len(npcs), 1)
        self.assertEqual(npcs[0].name, "阿禾")
        self.assertEqual(npcs[0].traits, ["安静"])
        self.assertTrue(0 <= npcs[0].trust <= 100)

    def test_coerce_npcs_skips_nameless(self):
        npcs = coerce_npcs({"npcs": [{"role": "农夫"}, {"name": "有名字"}]}, day=1)
        self.assertEqual(len(npcs), 1)

    def test_coerce_action(self):
        narrative, choices = coerce_action(
            {"narrative": "你走到井台。", "choices": [{"label": "继续", "effects": {"kind": 1}}]}
        )
        self.assertIn("井台", narrative)
        self.assertEqual(len(choices), 1)

    def test_coerce_action_from_string(self):
        narrative, choices = coerce_action("只有一段话")
        self.assertEqual(narrative, "只有一段话")
        self.assertEqual(choices, [])


if __name__ == "__main__":
    unittest.main()
