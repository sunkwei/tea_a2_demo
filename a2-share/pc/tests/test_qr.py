"""二维码载荷编解码测试（PROTOCOL.md §2）。"""

from __future__ import annotations

import unittest

from a2share import qr
from a2share.session import short_code_for

VALID_PAYLOAD = "A2S1-K5Q2M7Z3XJ4W6NRA-C0A80117-22C3-BVQFQF3-SUNKW-X"
BARE_PAYLOAD = "A2S1-K5Q2M7Z3XJ4W6NRA-C0A80117-22C3-BVQFQF3"


class PayloadTest(unittest.TestCase):
    def test_decode_valid(self) -> None:
        info = qr.decode_payload(VALID_PAYLOAD)
        self.assertEqual(info.secret, "K5Q2M7Z3XJ4W6NRA")
        self.assertEqual(info.ip, "192.168.1.23")
        self.assertEqual(info.port, 8899)
        self.assertEqual(info.issued, 1795342523)
        self.assertEqual(info.name, "SUNKW-X")

    def test_decode_without_name(self) -> None:
        info = qr.decode_payload(BARE_PAYLOAD)
        self.assertIsNone(info.name)
        self.assertEqual(len(BARE_PAYLOAD), 43)
        self.assertEqual(len(VALID_PAYLOAD), 51)

    def test_round_trip(self) -> None:
        payload = qr.encode_payload(
            secret="K5Q2M7Z3XJ4W6NRA",
            ip="192.168.1.23",
            port=8899,
            issued=1795342523,
            name="SUNKW-X",
        )
        self.assertEqual(payload, VALID_PAYLOAD)
        info = qr.decode_payload(payload)
        self.assertEqual(info.to_dict()["secret"], "K5Q2M7Z3XJ4W6NRA")

    def test_issued_field_is_35bit(self) -> None:
        self.assertEqual(qr.encode_issued(1795342523), "BVQFQF3")
        self.assertEqual(qr.decode_issued("BVQFQF3"), 1795342523)

    def test_name_sanitised(self) -> None:
        self.assertEqual(qr.sanitize_name("我的电脑-01"), "-01")
        self.assertEqual(qr.sanitize_name("sunkw-x1"), "SUNKW-X")
        self.assertIsNone(qr.sanitize_name("我的电脑"))
        self.assertIsNone(qr.sanitize_name(""))

    def test_payload_never_exceeds_51(self) -> None:
        payload = qr.encode_payload(
            secret="K5Q2M7Z3XJ4W6NRA", ip="10.0.0.1", port=65535, name="A" * 40
        )
        self.assertLessEqual(len(payload), 51)


class InvalidPayloadTest(unittest.TestCase):
    def _expect(self, payload: str, code: str) -> None:
        with self.assertRaises(qr.QrError) as ctx:
            qr.decode_payload(payload)
        self.assertEqual(ctx.exception.code, code, payload)

    def test_protocol_version(self) -> None:
        self._expect("A2S2-K5Q2M7Z3XJ4W6NRA-C0A80117-22C3-BVQFQF3", "protocol_version")

    def test_short_secret(self) -> None:
        self._expect("A2S1-K5Q2M7Z3XJ4W6NR-C0A80117-22C3-BVQFQF3", "bad_payload")

    def test_loopback_address(self) -> None:
        self._expect("A2S1-K5Q2M7Z3XJ4W6NRA-7F000001-22C3-BVQFQF3", "bad_address")

    def test_zero_port(self) -> None:
        self._expect("A2S1-K5Q2M7Z3XJ4W6NRA-C0A80117-0000-BVQFQF3", "bad_port")

    def test_lowercase_rejected(self) -> None:
        self._expect("a2s1-k5q2m7z3xj4w6nra-c0a80117-22c3-bvqfqf3", "bad_payload")

    def test_too_long(self) -> None:
        self._expect(VALID_PAYLOAD + "-EXTRA", "bad_payload")

    def test_missing_prefix(self) -> None:
        self._expect("HELLO-WORLD", "bad_payload")


class ShortCodeTest(unittest.TestCase):
    def test_golden_value(self) -> None:
        self.assertEqual(short_code_for("K5Q2M7Z3XJ4W6NRA"), "093511")

    def test_six_digits(self) -> None:
        from a2share.session import random_secret

        code = short_code_for(random_secret())
        self.assertEqual(len(code), 6)
        self.assertTrue(code.isdigit())

    def test_stable(self) -> None:
        self.assertEqual(
            short_code_for("K5Q2M7Z3XJ4W6NRA"), short_code_for("K5Q2M7Z3XJ4W6NRA")
        )


class RenderTest(unittest.TestCase):
    def test_matrix_and_png(self) -> None:
        matrix = qr.render_matrix(BARE_PAYLOAD)
        self.assertGreater(len(matrix), 20)
        self.assertEqual(len(matrix), len(matrix[0]))
        # 静区：四周必须全白
        self.assertFalse(any(matrix[0]))
        self.assertFalse(any(matrix[-1]))
        data = qr.build_png(BARE_PAYLOAD)
        self.assertTrue(data.startswith(b"\x89PNG\r\n\x1a\n"))
        self.assertIn(b"IHDR", data[:32])


if __name__ == "__main__":
    unittest.main()
