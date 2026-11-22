"""文件名清洗与同名占名测试（PROTOCOL.md §6）。"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from a2share import safe_name


class CleanTest(unittest.TestCase):
    def test_path_traversal(self) -> None:
        self.assertEqual(safe_name.clean("../../etc/passwd"), "passwd")
        self.assertEqual(safe_name.clean(r"..\..\windows\system32\a.dll"), "a.dll")

    def test_illegal_chars(self) -> None:
        self.assertEqual(safe_name.clean("a:b*c?d.txt"), "a_b_c_d.txt")
        self.assertEqual(safe_name.clean('a<b>c|d"e.txt'), "a_b_c_d_e.txt")

    def test_control_chars(self) -> None:
        self.assertEqual(safe_name.clean("nul\x07.txt"), "_nul.txt")
        self.assertEqual(safe_name.clean("a\x00b"), "ab")

    def test_reserved_names(self) -> None:
        self.assertEqual(safe_name.clean("CON"), "_CON")
        self.assertEqual(safe_name.clean("con.txt"), "_con.txt")
        self.assertEqual(safe_name.clean("COM1.log"), "_COM1.log")
        self.assertEqual(safe_name.clean("LPT9"), "_LPT9")

    def test_trailing_dot_and_space(self) -> None:
        self.assertEqual(safe_name.clean("a."), "a")
        self.assertEqual(safe_name.clean("  spaced  "), "spaced")
        self.assertEqual(safe_name.clean("name...  "), "name")

    def test_keep_unicode(self) -> None:
        self.assertEqual(safe_name.clean("报告 v2.pdf"), "报告 v2.pdf")
        self.assertEqual(safe_name.clean("emoji 🐱.png"), "emoji 🐱.png")

    def test_empty_fallback(self) -> None:
        self.assertTrue(safe_name.clean("").startswith("file-"))
        self.assertTrue(safe_name.clean("...").startswith("file-"))

    def test_truncate_keeps_extension(self) -> None:
        long_name = "x" * 400 + ".pdf"
        cleaned = safe_name.clean(long_name)
        self.assertLessEqual(len(cleaned.encode("utf-8")), 180)
        self.assertTrue(cleaned.endswith(".pdf"))

    def test_truncate_does_not_split_char(self) -> None:
        cleaned = safe_name.clean("中" * 200)
        self.assertLessEqual(len(cleaned.encode("utf-8")), 180)
        cleaned.encode("utf-8").decode("utf-8")  # 不抛异常即没切坏

    def test_nfc_normalisation(self) -> None:
        composed = "é.txt"  # e + 组合重音
        decomposed = "é.txt"
        self.assertEqual(safe_name.clean(composed), safe_name.clean(decomposed))


class ClaimTest(unittest.TestCase):
    def test_claim_and_no_overwrite(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            part = root / "a.part"
            part.write_bytes(b"hello")
            target = safe_name.claim(part, root, "报告.pdf")
            self.assertEqual(target.name, "报告.pdf")
            self.assertEqual(target.read_bytes(), b"hello")
            self.assertFalse(part.exists())

            part2 = root / "b.part"
            part2.write_bytes(b"world")
            target2 = safe_name.claim(part2, root, "报告.pdf")
            self.assertEqual(target2.name, "报告 (1).pdf")
            self.assertEqual(target.read_bytes(), b"hello")
            self.assertEqual(target2.read_bytes(), b"world")

    def test_claim_many(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            names = []
            for index in range(3):
                part = root / f"{index}.part"
                part.write_bytes(b"x")
                names.append(safe_name.claim(part, root, "a.pdf").name)
            self.assertEqual(names, ["a.pdf", "a (1).pdf", "a (2).pdf"])


if __name__ == "__main__":
    unittest.main()
