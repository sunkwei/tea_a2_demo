"""PC 端 HTTP 集成测试（PROTOCOL.md §4）。"""

from __future__ import annotations

import http.client
import io
import json
import socket
import tempfile
import threading
import unittest
from pathlib import Path

from a2share.history import History
from a2share.log import Logger
from a2share.notify import Notifier
from a2share.server import App, create_server
from a2share.session import Session
from a2share.uploads import UploadStore


class FakeClipboard:
    """假剪贴板：按需成功或失败，不动用户剪贴板。"""

    def __init__(self, ok: bool = False) -> None:
        self.ok = ok
        self.written: list[str] = []

    def write_text(self, text: str) -> tuple[bool, str]:
        self.written.append(text)
        return (True, "") if self.ok else (False, "测试环境不写剪贴板")

    def write_image(self, path: Path) -> tuple[bool, str]:
        return (True, "") if self.ok else (False, "测试环境不写剪贴板")

    def probe(self) -> dict:
        return {"available": self.ok, "reason": ""}


class ServerTestCase(unittest.TestCase):
    clipboard_ok = False

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)
        self.recv = root / "recv"
        self.home = root / "home"
        self.recv.mkdir()
        self.home.mkdir()
        # 终端输出静音，文件日志照常写（单测跑起来要安静）
        self.logger = Logger(
            self.home / "a2_share.log", "debug", stream=io.StringIO()
        )
        self.session = Session()
        uploads = UploadStore(self.recv, self.home, self.logger)
        uploads.recover()
        self.app = App(
            session=self.session,
            uploads=uploads,
            clipboard=FakeClipboard(self.clipboard_ok),
            notifier=Notifier(self.logger, self.home / "scripts"),
            history=History(self.home / "history.jsonl"),
            logger=self.logger,
            pc_id="test-pc",
            pc_name="TEST-PC",
            recv_dir=self.recv,
            notify_enabled=False,
        )
        self.server = create_server(self.app, "127.0.0.1", 0)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(
            target=self.server.serve_forever, kwargs={"poll_interval": 0.05}
        )
        self.thread.daemon = True
        self.thread.start()

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self._tmp.cleanup()

    # ------------------------------------------------------------- 工具
    def request(self, method: str, path: str, body=None, token: str | None = None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        payload = None
        if body is not None:
            payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        conn.request(method, path, payload, headers)
        response = conn.getresponse()
        raw = response.read()
        conn.close()
        try:
            data = json.loads(raw.decode("utf-8"))
        except ValueError:
            data = {"raw": raw.decode("utf-8", "replace")}
        return response.status, data

    def pair(self) -> str:
        status, data = self.request(
            "POST",
            "/v1/pair",
            {
                "v": 1,
                "method": "qr",
                "secret": self.session.secret,
                "device": {"id": "phone-1", "name": "测试机", "android": 34, "app": "1.0.0"},
            },
        )
        self.assertEqual(status, 200, data)
        return data["token"]


class HelloTest(ServerTestCase):
    def test_hello_without_auth(self) -> None:
        status, data = self.request("GET", "/v1/hello")
        self.assertEqual(status, 200)
        self.assertEqual(data["v"], 1)
        self.assertEqual(data["name"], "TEST-PC")
        self.assertEqual(data["sid"], self.session.sid)
        self.assertFalse(data["paired"])

    def test_unknown_route(self) -> None:
        status, data = self.request("GET", "/v1/nope")
        self.assertEqual(status, 404)
        self.assertEqual(data["error"]["code"], "not_found")


class PairTest(ServerTestCase):
    def test_pair_with_wrong_secret(self) -> None:
        status, data = self.request(
            "POST", "/v1/pair", {"v": 1, "method": "qr", "secret": "AAAAAAAAAAAAAAAA"}
        )
        self.assertEqual(status, 401)
        self.assertEqual(data["error"]["code"], "bad_secret")
        self.assertIn("attempts_left", data["error"])

    def test_pair_with_short_code(self) -> None:
        status, data = self.request(
            "POST", "/v1/pair", {"v": 1, "method": "code", "code": self.session.short_code}
        )
        self.assertEqual(status, 200, data)
        self.assertEqual(len(data["token"]), 64)

    def test_pair_rotates_secret(self) -> None:
        old_secret = self.session.secret
        token = self.pair()
        self.assertNotEqual(old_secret, self.session.secret)
        # 旧 secret 再用就失败
        status, _ = self.request(
            "POST", "/v1/pair", {"v": 1, "method": "qr", "secret": old_secret}
        )
        self.assertEqual(status, 401)

    def test_pair_rejects_bad_protocol_version(self) -> None:
        status, data = self.request(
            "POST", "/v1/pair", {"v": 2, "method": "qr", "secret": self.session.secret}
        )
        self.assertEqual(status, 426)
        self.assertEqual(data["error"]["code"], "protocol_version")

    def test_status_requires_token(self) -> None:
        status, data = self.request("GET", "/v1/status")
        self.assertEqual(status, 401)
        self.assertEqual(data["error"]["code"], "unauthorized")

    def test_status_with_token(self) -> None:
        token = self.pair()
        status, data = self.request("GET", "/v1/status", token=token)
        self.assertEqual(status, 200)
        self.assertEqual(data["sid"], self.session.sid)
        self.assertTrue(data["paired"])

    def test_stale_token_is_session_expired(self) -> None:
        token = self.pair()
        self.session.rotate(revoke=True)
        status, data = self.request("GET", "/v1/status", token=token)
        self.assertEqual(status, 401)
        self.assertEqual(data["error"]["code"], "session_expired")


class UploadFlowTest(ServerTestCase):
    def test_upload_without_token_creates_nothing(self) -> None:
        status, data = self.request(
            "POST",
            "/v1/uploads",
            {"v": 1, "upload_id": "u1", "kind": "file", "name": "x.txt", "size": 3},
        )
        self.assertEqual(status, 401)
        self.assertEqual(data["error"]["code"], "unauthorized")
        self.assertEqual(list(self.recv.glob("*.txt")), [])

    def test_full_flow(self) -> None:
        token = self.pair()
        payload = "报告 v2 内容".encode("utf-8")
        status, data = self.request(
            "POST",
            "/v1/uploads",
            {
                "v": 1,
                "upload_id": "u1",
                "kind": "file",
                "name": "报告 v2.txt",
                "size": len(payload),
                "mime": "text/plain",
            },
            token=token,
        )
        self.assertEqual(status, 200, data)
        self.assertEqual(data["received"], 0)

        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        conn.request(
            "PUT",
            "/v1/uploads/u1?offset=0",
            payload,
            {"Authorization": f"Bearer {token}", "Content-Type": "application/octet-stream"},
        )
        response = conn.getresponse()
        body = json.loads(response.read().decode("utf-8"))
        conn.close()
        self.assertEqual(response.status, 200, body)
        self.assertEqual(body["received"], len(payload))

        status, data = self.request(
            "POST", "/v1/uploads/u1/finish", {"v": 1, "sha256": None}, token=token
        )
        self.assertEqual(status, 200, data)
        self.assertEqual(data["name"], "报告 v2.txt")
        target = self.recv / data["name"]
        self.assertTrue(target.exists())
        self.assertEqual(target.read_bytes(), payload)
        self.assertEqual(len(data["sha256"]), 64)
        self.assertEqual(len(data["md5"]), 32)

    def test_offset_conflict_returns_received(self) -> None:
        token = self.pair()
        self.request(
            "POST",
            "/v1/uploads",
            {"v": 1, "upload_id": "u1", "kind": "file", "name": "x.bin", "size": 10},
            token=token,
        )
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        conn.request(
            "PUT",
            "/v1/uploads/u1?offset=0",
            b"1234",
            {"Authorization": f"Bearer {token}", "Content-Type": "application/octet-stream"},
        )
        conn.getresponse().read()
        conn.close()
        # 再从 0 发 → 409
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        conn.request(
            "PUT",
            "/v1/uploads/u1?offset=0",
            b"1234",
            {"Authorization": f"Bearer {token}", "Content-Type": "application/octet-stream"},
        )
        response = conn.getresponse()
        body = json.loads(response.read().decode("utf-8"))
        conn.close()
        self.assertEqual(response.status, 409)
        self.assertEqual(body["error"]["code"], "offset_conflict")
        self.assertEqual(body["error"]["received"], 4)

    def test_upload_query(self) -> None:
        token = self.pair()
        self.request(
            "POST",
            "/v1/uploads",
            {"v": 1, "upload_id": "u1", "kind": "file", "name": "x.bin", "size": 10},
            token=token,
        )
        status, data = self.request("GET", "/v1/uploads/u1", token=token)
        self.assertEqual(status, 200)
        self.assertEqual(data["state"], "partial")

    def test_delete_upload(self) -> None:
        token = self.pair()
        self.request(
            "POST",
            "/v1/uploads",
            {"v": 1, "upload_id": "u1", "kind": "file", "name": "x.bin", "size": 10},
            token=token,
        )
        status, data = self.request("DELETE", "/v1/uploads/u1", token=token)
        self.assertEqual(status, 200)
        self.assertTrue(data["ok"])

    def test_chunk_beyond_declared_size(self) -> None:
        """块长度超过 init 声明的文件大小 → 400 bad_request。"""
        token = self.pair()
        self.request(
            "POST",
            "/v1/uploads",
            {"v": 1, "upload_id": "u1", "kind": "file", "name": "x.bin", "size": 10},
            token=token,
        )
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        conn.request(
            "PUT",
            "/v1/uploads/u1?offset=0",
            b"x" * 16,
            {"Authorization": f"Bearer {token}", "Content-Type": "application/octet-stream"},
        )
        response = conn.getresponse()
        body = json.loads(response.read().decode("utf-8"))
        conn.close()
        self.assertEqual(response.status, 400)
        self.assertEqual(body["error"]["code"], "bad_request")

    def test_chunk_over_8mib_rejected(self) -> None:
        """声明的单块超过 8 MiB 上限 → 413 too_large。

        用裸 socket 发请求头（不写 body）：服务端在读 body 之前就应答，
        这样客户端能完整读到 413（真机上超大的 body 会让连接提前关闭，
        手机端靠 init 返回的 max_chunk_bytes 提前规避）。
        """
        token = self.pair()
        self.request(
            "POST",
            "/v1/uploads",
            {
                "v": 1,
                "upload_id": "u1",
                "kind": "file",
                "name": "x.bin",
                "size": 16 * 1024 * 1024,
            },
            token=token,
        )
        raw = socket.create_connection(("127.0.0.1", self.port), timeout=10)
        try:
            head = (
                "PUT /v1/uploads/u1?offset=0 HTTP/1.1\r\n"
                f"Host: 127.0.0.1:{self.port}\r\n"
                f"Authorization: Bearer {token}\r\n"
                "Content-Type: application/octet-stream\r\n"
                f"Content-Length: {9 * 1024 * 1024}\r\n"
                "Connection: close\r\n\r\n"
            )
            raw.sendall(head.encode("ascii"))
            chunks = []
            while True:
                piece = raw.recv(4096)
                if not piece:
                    break
                chunks.append(piece)
            response_text = b"".join(chunks).decode("utf-8", "replace")
        finally:
            raw.close()
        self.assertIn("413", response_text.splitlines()[0])
        body = json.loads(response_text.split("\r\n\r\n", 1)[1])
        self.assertEqual(body["error"]["code"], "too_large")


class ClipboardTest(ServerTestCase):
    def test_clipboard_degrades_to_file(self) -> None:
        token = self.pair()
        secret_text = "剪贴板机密内容-不应出现在日志里"
        status, data = self.request(
            "POST", "/v1/clipboard/text", {"v": 1, "text": secret_text}, token=token
        )
        self.assertEqual(status, 200, data)
        self.assertEqual(data["clipboard"], "degraded")
        self.assertTrue(data["saved_as"].endswith(".txt"))
        saved = self.recv / data["saved_as"]
        self.assertTrue(saved.exists())
        self.assertEqual(saved.read_text(encoding="utf-8"), secret_text)
        # 日志里不能出现正文
        log_text = (self.home / "a2_share.log").read_text(encoding="utf-8")
        self.assertNotIn(secret_text, log_text)

    def test_clipboard_too_large(self) -> None:
        token = self.pair()
        status, data = self.request(
            "POST",
            "/v1/clipboard/text",
            {"v": 1, "text": "x" * (1024 * 1024 + 1)},
            token=token,
        )
        self.assertEqual(status, 413)
        self.assertEqual(data["error"]["code"], "too_large")


class HistoryTest(ServerTestCase):
    def test_history_lists_received_file(self) -> None:
        token = self.pair()
        payload = b"history"
        self.request(
            "POST",
            "/v1/uploads",
            {"v": 1, "upload_id": "u1", "kind": "file", "name": "h.bin", "size": len(payload)},
            token=token,
        )
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        conn.request(
            "PUT",
            "/v1/uploads/u1?offset=0",
            payload,
            {"Authorization": f"Bearer {token}", "Content-Type": "application/octet-stream"},
        )
        conn.getresponse().read()
        conn.close()
        self.request("POST", "/v1/uploads/u1/finish", {"v": 1, "sha256": None}, token=token)
        status, data = self.request("GET", "/v1/history", token=token)
        self.assertEqual(status, 200)
        self.assertEqual(len(data["items"]), 1)
        self.assertEqual(data["items"][0]["name"], "h.bin")
        self.assertEqual(data["items"][0]["device"], "测试机")


if __name__ == "__main__":
    unittest.main()
