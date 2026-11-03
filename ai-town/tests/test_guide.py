"""操作指南测试：手册要能渲染、内容要和代码对得上。"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ai_town.endings import ENDINGS
from ai_town.models import RESOURCE_LABELS
from ai_town.state import BUILDING_DEFS
from ai_town.ui.guide import GUIDE_PATH, _plain, load_pages


def guide_text() -> str:
    with open(GUIDE_PATH, encoding="utf-8") as fh:
        return fh.read()


class TestGuide(unittest.TestCase):
    def test_guide_file_lives_inside_package(self):
        self.assertTrue(os.path.exists(GUIDE_PATH))
        self.assertTrue(GUIDE_PATH.replace("\\", "/").endswith("ai_town/GUIDE.md"))

    def test_pages_parse(self):
        pages = load_pages()
        self.assertGreaterEqual(len(pages), 5)
        for title, body in pages:
            self.assertTrue(title.strip())
            self.assertTrue(body.strip())

    def test_sections_present(self):
        titles = [t for t, _ in load_pages()]
        for key in ("上手", "界面", "操作", "数值", "建筑", "结局", "常见问题"):
            self.assertTrue(any(key in t for t in titles), f"缺少章节：{key}")

    def test_plain_strips_markdown(self):
        out = _plain("## 标题\n\n- **粗体** 与 `代码`\n\n---\n\n> 引用\n")
        self.assertNotIn("##", out)
        self.assertNotIn("**", out)
        self.assertNotIn("`", out)
        self.assertNotIn("\n---", out)

    def test_guide_covers_all_buildings(self):
        text = guide_text()
        for kind, d in BUILDING_DEFS.items():
            self.assertIn(d["name"], text, f"指南里没写建筑：{d['name']}")

    def test_guide_covers_all_endings(self):
        text = guide_text()
        for e in ENDINGS:
            self.assertIn(e["title"], text, f"指南里没写结局：{e['title']}")

    def test_guide_covers_resources(self):
        text = guide_text()
        for label in RESOURCE_LABELS.values():
            self.assertIn(label, text, f"指南里没写资源：{label}")


if __name__ == "__main__":
    unittest.main()
