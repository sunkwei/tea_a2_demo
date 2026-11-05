"""JSON 容错解析测试（小模型经常吐坏 JSON）。"""

from __future__ import annotations

import unittest

from sanguosha_ai.llm.parsing import extract_int, extract_json, extract_str


class TestExtractJson(unittest.TestCase):
    def test_plain_json(self):
        self.assertEqual(extract_json('{"n": 3, "say": "好"}'), {"n": 3, "say": "好"})

    def test_code_fence(self):
        text = '```json\n{"n": 2}\n```'
        self.assertEqual(extract_json(text), {"n": 2})

    def test_json_with_prose(self):
        text = '好的，我的选择是：{"n": 5, "say": "冲！"} 请多关照。'
        data = extract_json(text)
        self.assertEqual(data["n"], 5)

    def test_missing_colon(self):
        data = extract_json('{"n" 4, "say" "哈"}')
        self.assertIsInstance(data, dict)
        self.assertEqual(data.get("n"), 4)

    def test_trailing_comma(self):
        data = extract_json('{"n": 7, "say": "呵",}')
        self.assertEqual(data["n"], 7)

    def test_unclosed_string(self):
        data = extract_json('{"n": 1, "say": "没说完')
        self.assertIsInstance(data, dict)
        self.assertEqual(data.get("n"), 1)

    def test_single_quotes(self):
        data = extract_json("{'n': 2, 'say': '行'}")
        self.assertEqual(data.get("n"), 2)

    def test_broken_json_returns_none(self):
        self.assertIsNone(extract_json("完全不是 JSON，只是一段话"))

    def test_empty(self):
        self.assertIsNone(extract_json(""))


class TestExtractInt(unittest.TestCase):
    def test_from_json_text(self):
        self.assertEqual(extract_int('{"n": 4}'), 4)

    def test_from_prose(self):
        self.assertEqual(extract_int("我选择第 3 个动作"), 3)

    def test_none(self):
        self.assertIsNone(extract_int("没有数字"))


class TestExtractStr(unittest.TestCase):
    def test_say(self):
        self.assertEqual(extract_str('{"say": "燕人先去也"}'), "燕人先去也")

    def test_prose_fallback(self):
        self.assertEqual(extract_str("say: 冲啊"), "冲啊")


if __name__ == "__main__":
    unittest.main()
