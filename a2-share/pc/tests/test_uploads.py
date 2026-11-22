"""上传落盘 / 续传 / 定名测试（PROTOCOL.md §4.3–§4.7、§5）。"""

from __future__ import annotations

import hashlib
import tempfile
import unittest
from pathlib import Path

from a2share.log import NullLogger
from a2share.uploads import UploadError, UploadMeta, UploadStore


class UploadStoreTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)
        self.recv = root / "recv"
        self.home = root / "home"
        self.recv.mkdir()
        self.home.mkdir()
        self.store = UploadStore(self.recv, self.home, NullLogger())
        self.store.recover()

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _meta(self, size: int, name: str = "a.bin", kind: str = "file") -> UploadMeta:
        return UploadMeta(name=name, size=size, mime="application/octet-stream", kind=kind)

    def _put(self, upload_id: str, offset: int, payload: bytes) -> int:
        position = 0

        def reader(size: int) -> bytes:
            nonlocal position
            chunk = payload[position : position + size]
            position += len(chunk)
            return chunk

        return self.store.append(upload_id, offset, len(payload), reader)

    # ---------------------------------------------------------------- 基本
    def test_init_creates_part(self) -> None:
        result = self.store.init("u1", self._meta(10))
        self.assertEqual(result["received"], 0)
        self.assertFalse(result["resume"])
        self.assertTrue((self.recv / ".a2-incoming" / "u1.part").exists())

    def test_append_and_finish(self) -> None:
        payload = b"hello a2_share"
        self.store.init("u1", self._meta(len(payload)))
        received = self._put("u1", 0, payload)
        self.assertEqual(received, len(payload))
        result = self.store.finish("u1")
        self.assertEqual(result["sha256"], hashlib.sha256(payload).hexdigest())
        self.assertEqual(result["md5"], hashlib.md5(payload).hexdigest())
        target = self.recv / result["name"]
        self.assertTrue(target.exists())
        self.assertEqual(target.read_bytes(), payload)

    def test_zero_byte_file(self) -> None:
        self.store.init("u0", self._meta(0))
        result = self.store.finish("u0")
        self.assertEqual(result["size"], 0)
        self.assertEqual(result["name"], "a.bin")

    def test_finish_is_idempotent(self) -> None:
        payload = b"abc"
        self.store.init("u1", self._meta(len(payload)))
        self._put("u1", 0, payload)
        first = self.store.finish("u1")
        second = self.store.finish("u1")
        self.assertEqual(first["name"], second["name"])
        self.assertTrue(second.get("dedup"))

    def test_same_name_gets_suffix(self) -> None:
        for index in range(2):
            upload_id = f"u{index}"
            payload = f"payload-{index}".encode()
            self.store.init(upload_id, self._meta(len(payload)))
            self._put(upload_id, 0, payload)
            self.store.finish(upload_id)
        names = sorted(p.name for p in self.recv.glob("*.bin"))
        self.assertEqual(names, ["a (1).bin", "a.bin"])

    # ---------------------------------------------------------------- 续传
    def test_resume_reports_received(self) -> None:
        payload = b"0123456789"
        self.store.init("u1", self._meta(len(payload)))
        self._put("u1", 0, payload[:4])
        result = self.store.init("u1", self._meta(len(payload)))
        self.assertEqual(result["received"], 4)
        self.assertTrue(result["resume"])

    def test_offset_conflict(self) -> None:
        payload = b"0123456789"
        self.store.init("u1", self._meta(len(payload)))
        self._put("u1", 0, payload[:4])
        with self.assertRaises(UploadError) as ctx:
            self._put("u1", 0, payload[:4])
        self.assertEqual(ctx.exception.code, "offset_conflict")
        self.assertEqual(ctx.exception.extra["received"], 4)

    def test_chunk_beyond_size_rejected(self) -> None:
        self.store.init("u1", self._meta(4))
        with self.assertRaises(UploadError) as ctx:
            self._put("u1", 0, b"12345678")
        self.assertEqual(ctx.exception.code, "bad_request")

    def test_incomplete_finish(self) -> None:
        self.store.init("u1", self._meta(10))
        self._put("u1", 0, b"1234")
        with self.assertRaises(UploadError) as ctx:
            self.store.finish("u1")
        self.assertEqual(ctx.exception.code, "incomplete")
        self.assertEqual(ctx.exception.extra["received"], 4)

    def test_hash_mismatch_keeps_part(self) -> None:
        payload = b"abcdef"
        self.store.init("u1", self._meta(len(payload)))
        self._put("u1", 0, payload)
        with self.assertRaises(UploadError) as ctx:
            self.store.finish("u1", "0" * 64)
        self.assertEqual(ctx.exception.code, "hash_mismatch")
        self.assertTrue((self.recv / ".a2-incoming" / "u1.part").exists())

    def test_init_conflict_on_metadata_change(self) -> None:
        self.store.init("u1", self._meta(10))
        with self.assertRaises(UploadError) as ctx:
            self.store.init("u1", self._meta(11))
        self.assertEqual(ctx.exception.code, "upload_conflict")

    def test_too_large(self) -> None:
        store = UploadStore(self.recv, self.home, NullLogger(), max_upload_bytes=1024)
        with self.assertRaises(UploadError) as ctx:
            store.init("u1", self._meta(2048))
        self.assertEqual(ctx.exception.code, "too_large")

    def test_abort(self) -> None:
        self.store.init("u1", self._meta(10))
        self.store.abort("u1")
        self.assertFalse((self.recv / ".a2-incoming" / "u1.part").exists())
        self.store.abort("u1")  # 幂等

    def test_query(self) -> None:
        self.store.init("u1", self._meta(10))
        self._put("u1", 0, b"1234")
        info = self.store.query("u1")
        self.assertEqual(info["received"], 4)
        self.assertEqual(info["state"], "partial")

    # ---------------------------------------------------------------- 恢复
    def test_recover_removes_orphan_part(self) -> None:
        incoming = self.recv / ".a2-incoming"
        incoming.mkdir(parents=True, exist_ok=True)
        (incoming / "ghost.part").write_bytes(b"xxx")
        self.store.recover()
        self.assertFalse((incoming / "ghost.part").exists())

    def test_recover_truncates_oversized_part(self) -> None:
        self.store.init("u1", self._meta(4))
        with (self.recv / ".a2-incoming" / "u1.part").open("ab") as fh:
            fh.write(b"extra")
        self.store.recover()
        self.assertEqual((self.recv / ".a2-incoming" / "u1.part").stat().st_size, 4)

    def test_recover_keeps_valid_part(self) -> None:
        self.store.init("u1", self._meta(10))
        self._put("u1", 0, b"1234")
        self.store.recover()
        self.assertEqual(self.store.query("u1")["received"], 4)

    def test_completed_ledger_survives_restart(self) -> None:
        payload = b"ledger"
        self.store.init("u1", self._meta(len(payload)))
        self._put("u1", 0, payload)
        result = self.store.finish("u1")
        fresh = UploadStore(self.recv, self.home, NullLogger())
        fresh.recover()
        again = fresh.finish("u1")
        self.assertEqual(again["name"], result["name"])
        self.assertTrue(again["dedup"])


if __name__ == "__main__":
    unittest.main()
