"""黄金样本一致性测试（PROTOCOL.md §11）。

样本文件 ``a2-share/tools/vectors/v1.json`` 由两端共用：Python 单测与
Android 单测读同一份，任何一端实现漂移都会在这里暴露。
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from a2share import qr, safe_name
from a2share.session import short_code_for

VECTORS = Path(__file__).resolve().parents[2] / "tools" / "vectors" / "v1.json"


def load() -> dict:
    return json.loads(VECTORS.read_text(encoding="utf-8"))


class VectorTest(unittest.TestCase):
    def setUp(self) -> None:
        self.vectors = load()

    def test_valid_payloads(self) -> None:
        for case in self.vectors["qr"]["valid"]:
            with self.subTest(payload=case["payload"]):
                info = qr.decode_payload(case["payload"])
                expect = case["expect"]
                self.assertEqual(info.secret, expect["secret"])
                self.assertEqual(info.ip, expect["ip"])
                self.assertEqual(info.port, expect["port"])
                self.assertEqual(info.issued, expect["issued"])
                self.assertEqual(info.name, expect.get("name"))
                self.assertEqual(len(case["payload"]), expect["length"])

    def test_invalid_payloads(self) -> None:
        for case in self.vectors["qr"]["invalid"]:
            with self.subTest(payload=case["payload"]):
                with self.assertRaises(qr.QrError) as ctx:
                    qr.decode_payload(case["payload"])
                self.assertEqual(ctx.exception.code, case["error"])

    def test_short_code(self) -> None:
        case = self.vectors["short_code"]
        self.assertEqual(short_code_for(case["secret"]), case["expect"])

    def test_safe_name(self) -> None:
        for case in self.vectors.get("safe_name", {}).get("cases", []):
            with self.subTest(raw=case["raw"]):
                self.assertEqual(safe_name.clean(case["raw"]), case["expect"])

    def test_pair_request_shape(self) -> None:
        request = self.vectors["pair_request"]
        self.assertEqual(request["v"], 1)
        self.assertIn(request["method"], ("qr", "code"))
        self.assertIn("device", request)

    def test_error_envelope_shape(self) -> None:
        error = self.vectors["error_envelope"]["error"]
        for field in ("code", "message", "retryable", "hint", "request_id"):
            self.assertIn(field, error)


if __name__ == "__main__":
    unittest.main()
