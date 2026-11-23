"""剪贴板适配测试（真机验收 AC-09/AC-10 抓到的 UTF-16 截断 bug）。"""

from __future__ import annotations

import unittest

from a2share.clipboard import utf16_bytes


class Utf16Test(unittest.TestCase):
    def test_ascii(self) -> None:
        text = "hello-from-real-device"
        raw = utf16_bytes(text)
        self.assertEqual(len(raw), (len(text) + 1) * 2)
        self.assertEqual(raw.decode("utf-16-le").rstrip("\x00"), text)

    def test_chinese_and_emoji(self) -> None:
        text = "a2_share 真机剪贴板测试 🐱 with emoji"
        raw = utf16_bytes(text)
        # 🐱 是非 BMP 字符（U+1F431），占 2 个 UTF-16 码元：
        # 字节数必须大于 (len(text)+1)*2，按 len(text) 算会截断
        self.assertGreater(len(raw), (len(text) + 1) * 2)
        self.assertEqual(raw.decode("utf-16-le").rstrip("\x00"), text)

    def test_bmp_emoji(self) -> None:
        # ✅（U+2705）在 BMP 内，只占 1 个码元
        text = "✅ ok"
        raw = utf16_bytes(text)
        self.assertEqual(len(raw), (len(text) + 1) * 2)
        self.assertEqual(raw.decode("utf-16-le").rstrip("\x00"), text)

    def test_ends_with_nul(self) -> None:
        raw = utf16_bytes("x")
        self.assertTrue(raw.endswith(b"\x00\x00"))

    def test_newline_and_tab(self) -> None:
        text = "换行\n第二行\t制表符"
        self.assertEqual(utf16_bytes(text).decode("utf-16-le").rstrip("\x00"), text)


if __name__ == "__main__":
    unittest.main()
