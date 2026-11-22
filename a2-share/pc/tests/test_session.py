"""会话凭据测试（PROTOCOL.md §3）。"""

from __future__ import annotations

import unittest

from a2share.session import (
    B32_ALPHABET,
    IP_FAIL_LIMIT,
    Session,
    random_secret,
    short_code_for,
)


class SecretTest(unittest.TestCase):
    def test_secret_shape(self) -> None:
        secret = random_secret()
        self.assertEqual(len(secret), 16)
        self.assertTrue(all(ch in B32_ALPHABET for ch in secret))

    def test_short_code_is_six_digits(self) -> None:
        code = short_code_for(random_secret())
        self.assertEqual(len(code), 6)
        self.assertTrue(code.isdigit())

    def test_short_code_uses_utf8_of_secret_string(self) -> None:
        # 黄金样本：key 用 secret 的 UTF-8 字节，而不是解码后的原始字节
        self.assertEqual(short_code_for("K5Q2M7Z3XJ4W6NRA"), "093511")


class TokenTest(unittest.TestCase):
    def setUp(self) -> None:
        self.session = Session()

    def test_no_token(self) -> None:
        self.assertEqual(self.session.check_token(None), "unauthorized")
        self.assertEqual(self.session.check_token(""), "unauthorized")

    def test_wrong_length_token(self) -> None:
        self.assertEqual(self.session.check_token("abcd"), "unauthorized")

    def test_paired_token_ok(self) -> None:
        token = self.session.issue_token({"name": "测试机"})
        self.assertEqual(self.session.check_token(token), "ok")
        self.assertTrue(self.session.paired)

    def test_stale_token_is_session_expired(self) -> None:
        token = self.session.issue_token({"name": "测试机"})
        self.session.rotate(revoke=True)
        self.assertEqual(self.session.check_token(token), "session_expired")

    def test_rotate_keeps_token_when_not_revoking(self) -> None:
        token = self.session.issue_token({"name": "测试机"})
        generation = self.session.generation
        self.session.rotate(revoke=False)
        self.assertEqual(self.session.check_token(token), "ok")
        self.assertGreater(self.session.generation, generation)
        self.assertNotEqual(self.session.secret, "")

    def test_secret_changes_on_rotate(self) -> None:
        before = self.session.secret
        self.session.rotate(revoke=False)
        self.assertNotEqual(before, self.session.secret)


class RateLimitTest(unittest.TestCase):
    def setUp(self) -> None:
        self.session = Session()

    def test_lock_after_failures(self) -> None:
        for _ in range(IP_FAIL_LIMIT):
            self.session.record_failure("10.0.0.2")
        limited, attempts_left = self.session.rate_limit_state("10.0.0.2")
        self.assertTrue(limited)
        self.assertEqual(attempts_left, 0)

    def test_other_ip_unaffected(self) -> None:
        for _ in range(IP_FAIL_LIMIT):
            self.session.record_failure("10.0.0.2")
        limited, attempts_left = self.session.rate_limit_state("10.0.0.3")
        self.assertFalse(limited)
        self.assertEqual(attempts_left, IP_FAIL_LIMIT)

    def test_clear_failures(self) -> None:
        for _ in range(3):
            self.session.record_failure("10.0.0.2")
        self.session.clear_failures("10.0.0.2")
        limited, attempts_left = self.session.rate_limit_state("10.0.0.2")
        self.assertFalse(limited)
        self.assertEqual(attempts_left, IP_FAIL_LIMIT)


if __name__ == "__main__":
    unittest.main()
