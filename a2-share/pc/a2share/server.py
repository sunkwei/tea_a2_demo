"""PC 端 HTTP 服务（PROTOCOL.md §4）。

Python ``http.server`` 的坑（DESIGN.md D-R3）在这里统一处理：
- ``protocol_version = "HTTP/1.1"``，否则 keep-alive 失效，1 GB 上传每块都要重连；
- 每个响应都显式写 ``Content-Length``，否则客户端会挂到超时；
- 401 时不读请求体、``Connection: close``、并覆盖 ``handle_expect_100``；
- 请求头 15 s / 请求体 60 s 的 socket 超时；
- 连接数上限，防慢客户端堆积线程；
- ``version_string()`` 不暴露 Python 版本。
"""

from __future__ import annotations

import json
import secrets
import socket
import threading
import time
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from . import safe_name
from .clipboard import Clipboard
from .history import History
from .log import Logger
from .notify import Notifier
from .session import Session, constant_time_equals
from .uploads import UploadError, UploadMeta, UploadStore

HEADER_TIMEOUT = 15.0
BODY_TIMEOUT = 60.0
KEEPALIVE_TIMEOUT = 65.0
MAX_CONNECTIONS = 16
MAX_CLIPBOARD_TEXT = 1024 * 1024
MAX_BODY = 8 * 1024 * 1024
COPY_BUFFER = 64 * 1024

#: 错误目录（PROTOCOL.md §9）：code → (HTTP 状态, retryable, 中文提示)
ERRORS: dict[str, tuple[int, bool, str]] = {
    "bad_request": (400, False, "请求格式不对"),
    "protocol_version": (426, False, "PC 版本不兼容，请更新 a2_share"),
    "unauthorized": (401, False, "配对已失效，请重新扫码"),
    "session_expired": (401, False, "PC 已重启或配对已失效，请重新扫码"),
    "bad_secret": (401, False, "配对码不对，请重试"),
    "rate_limited": (429, True, "请求过于频繁，请稍后再试"),
    "busy": (429, True, "上一个文件还没传完，请稍候"),
    "not_found": (404, False, "上传不存在，请重新开始"),
    "upload_conflict": (409, False, "上传信息冲突，请重新开始"),
    "offset_conflict": (409, True, "断点位置不一致，已对齐，请继续"),
    "incomplete": (409, True, "文件还没传完，请继续发送剩余部分"),
    "hash_mismatch": (422, False, "文件校验失败，请重新发送"),
    "too_large": (413, False, "文件过大，未发送"),
    "insufficient_storage": (507, False, "PC 存储空间不足，已保存进度"),
    "internal": (500, True, "PC 内部错误，请查看 PC 日志"),
}


@dataclass
class App:
    """服务端依赖容器（显式注入，便于测试）。"""

    session: Session
    uploads: UploadStore
    clipboard: Clipboard
    notifier: Notifier
    history: History
    logger: Logger
    pc_id: str = ""
    pc_name: str = ""
    recv_dir: Path = Path(".")
    clipboard_image: bool = False
    notify_enabled: bool = True
    on_paired: Any = None  # 可选回调：配对成功后重写二维码
    last_activity: float = field(default_factory=time.time)


class A2Handler(BaseHTTPRequestHandler):
    """路由与协议实现。"""

    protocol_version = "HTTP/1.1"
    server_version = "a2_share/1.0"
    sys_version = ""

    # ------------------------------------------------------------ 基础工具
    @property
    def app(self) -> App:
        return self.server.app  # type: ignore[attr-defined]

    def version_string(self) -> str:
        return self.server_version

    def log_message(self, fmt: str, *args: Any) -> None:  # noqa: A003
        # 不写 stderr，交给自己的日志模块
        self.app.logger.debug("http_access", reason=fmt % args)

    def setup(self) -> None:
        super().setup()
        try:
            self.connection.settimeout(HEADER_TIMEOUT)
        except OSError:
            pass

    def handle_one_request(self) -> None:
        try:
            self.connection.settimeout(KEEPALIVE_TIMEOUT)
            super().handle_one_request()
        except (socket.timeout, TimeoutError):
            self.close_connection = True

    # ---------------------------------------------------------- 响应封装
    def _send_bytes(
        self,
        status: int,
        body: bytes,
        content_type: str = "application/json",
        close: bool = False,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        request_id = self.headers.get("X-A2-Request") or self._request_id()
        self.send_header("X-Request-Id", request_id)
        if close:
            self.close_connection = True
            self.send_header("Connection", "close")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError, OSError):
                self.close_connection = True

    def _send_json(self, status: int, payload: dict[str, Any], close: bool = False) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._send_bytes(status, body, close=close)

    def _send_error(
        self,
        code: str,
        message: str = "",
        *,
        status: int | None = None,
        retryable: bool | None = None,
        hint: str | None = None,
        extra: dict[str, Any] | None = None,
        close: bool = False,
    ) -> None:
        http_status, default_retryable, default_hint = ERRORS.get(
            code, ERRORS["internal"]
        )
        payload: dict[str, Any] = {
            "code": code,
            "message": message or code,
            "retryable": default_retryable if retryable is None else retryable,
            "hint": default_hint if hint is None else hint,
            "request_id": self.headers.get("X-A2-Request") or self._request_id(),
        }
        if extra:
            payload.update(extra)
        self._send_json(status or http_status, {"error": payload}, close=close)

    def _request_id(self) -> str:
        return secrets.token_hex(4)

    # ---------------------------------------------------------- 请求体读取
    def _content_length(self) -> int | None:
        raw = self.headers.get("Content-Length")
        if raw is None:
            return None
        try:
            return int(raw)
        except ValueError:
            return -1

    def _read_json_body(self) -> dict[str, Any]:
        length = self._content_length()
        if length is None or length < 0:
            raise UploadError("bad_request", "缺少或非法的 Content-Length")
        if length > MAX_BODY:
            raise UploadError("too_large", "请求体过大")
        raw = self.rfile.read(length) if length else b""
        if len(raw) != length:
            raise UploadError("bad_request", "请求体不完整")
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError) as exc:
            raise UploadError("bad_request", f"JSON 解析失败: {exc}") from exc
        if not isinstance(data, dict):
            raise UploadError("bad_request", "请求体必须是 JSON 对象")
        return data

    # ------------------------------------------------------------ 认证
    def _bearer(self) -> str | None:
        raw = self.headers.get("Authorization") or ""
        if not raw.lower().startswith("bearer "):
            return None
        return raw[7:].strip()

    def _require_auth(self) -> bool:
        """认证通过返回 True；否则已写回 401。"""
        token = self._bearer()
        state = self.app.session.check_token(token)
        if state == "ok":
            return True
        code = "unauthorized" if state == "unauthorized" else "session_expired"
        # 不读请求体、不落盘：直接关连接
        self._send_error(
            code,
            "token 缺失或已失效",
            close=True,
            extra={"session_expired": code == "session_expired"},
        )
        return False

    def handle_expect_100(self) -> bool:
        """未授权时先回 401，绝不进入读 body 的流程。"""
        if not self._require_auth():
            return False
        return super().handle_expect_100()

    # ---------------------------------------------------------- 路由分发
    def do_GET(self) -> None:  # noqa: N802
        path = self._route()
        try:
            if path == "/v1/hello":
                self._handle_hello()
            elif path == "/v1/status":
                if self._require_auth():
                    self._handle_status()
            elif path.startswith("/v1/uploads/"):
                if self._require_auth():
                    self._handle_upload_get(path)
            elif path == "/v1/history":
                if self._require_auth():
                    self._handle_history()
            else:
                self._send_error("not_found", "未知接口", close=True)
        except UploadError as exc:
            self._upload_error(exc)
        except Exception as exc:  # noqa: BLE001
            self.app.logger.error("internal_error", reason=str(exc))
            self._send_error("internal", str(exc))

    def do_POST(self) -> None:  # noqa: N802
        path = self._route()
        try:
            if path == "/v1/pair":
                self._handle_pair()
            elif path == "/v1/uploads":
                if self._require_auth():
                    self._handle_upload_init()
            elif path.endswith("/finish") and path.startswith("/v1/uploads/"):
                if self._require_auth():
                    self._handle_upload_finish(path)
            elif path == "/v1/clipboard/text":
                if self._require_auth():
                    self._handle_clipboard_text()
            else:
                self._send_error("not_found", "未知接口", close=True)
        except UploadError as exc:
            self._upload_error(exc)
        except Exception as exc:  # noqa: BLE001
            self.app.logger.error("internal_error", reason=str(exc))
            self._send_error("internal", str(exc))

    def do_PUT(self) -> None:  # noqa: N802
        path = self._route()
        try:
            if path.startswith("/v1/uploads/"):
                if self._require_auth():
                    self._handle_upload_put(path)
            else:
                self._send_error("not_found", "未知接口", close=True)
        except UploadError as exc:
            self._upload_error(exc)
        except Exception as exc:  # noqa: BLE001
            self.app.logger.error("internal_error", reason=str(exc))
            self._send_error("internal", str(exc))

    def do_DELETE(self) -> None:  # noqa: N802
        path = self._route()
        try:
            if path.startswith("/v1/uploads/"):
                if self._require_auth():
                    upload_id = path.rsplit("/", 1)[-1]
                    self.app.uploads.abort(upload_id)
                    self._send_json(200, {"ok": True})
            else:
                self._send_error("not_found", "未知接口", close=True)
        except UploadError as exc:
            self._upload_error(exc)
        except Exception as exc:  # noqa: BLE001
            self.app.logger.error("internal_error", reason=str(exc))
            self._send_error("internal", str(exc))

    # ------------------------------------------------------------ 各端点
    def _route(self) -> str:
        return urlparse(self.path).path.rstrip("/") or "/"

    def _query(self) -> dict[str, list[str]]:
        return parse_qs(urlparse(self.path).query)

    def _handle_hello(self) -> None:
        session = self.app.session
        self._send_json(
            200,
            {
                "v": 1,
                "name": self.app.pc_name,
                "pc_id": self.app.pc_id,
                "sid": session.sid,
                "paired": session.paired,
                "t": int(time.time()),
            },
        )

    def _handle_status(self) -> None:
        session = self.app.session
        self._send_json(
            200,
            {
                "v": 1,
                "sid": session.sid,
                "paired": session.paired,
                "device": session.device,
                "last_activity": int(self.app.last_activity),
                "server_time": int(time.time()),
            },
        )

    def _handle_pair(self) -> None:
        data = self._read_json_body()
        version = data.get("v")
        if version != 1:
            self._send_error(
                "protocol_version" if isinstance(version, int) and version > 1 else "bad_request",
                f"不支持的协议版本: {version!r}",
            )
            return
        peer = self.client_address[0] if self.client_address else ""
        session = self.app.session
        limited, attempts_left = session.rate_limit_state(peer)
        if limited:
            self._send_error(
                "rate_limited",
                "配对尝试过于频繁",
                extra={"retry_after": max(60, session.lock_remaining()), "attempts_left": 0},
            )
            return
        method = str(data.get("method", "qr"))
        if method == "qr":
            secret = str(data.get("secret", "")).upper()
            ok = bool(secret) and constant_time_equals(secret, session.secret)
        elif method == "code":
            code = str(data.get("code", "")).strip()
            ok = bool(code) and constant_time_equals(code, session.short_code)
        else:
            self._send_error("bad_request", "method 只支持 qr / code")
            return
        if not ok:
            session.record_failure(peer)
            _, attempts_left = session.rate_limit_state(peer)
            self._send_error(
                "bad_secret",
                "配对凭据错误或已被使用",
                extra={"attempts_left": attempts_left},
            )
            return
        session.clear_failures(peer)
        device = data.get("device") if isinstance(data.get("device"), dict) else {}
        token = session.issue_token(device)
        session.rotate(revoke=False)
        self.app.logger.info(
            "device_paired",
            peer=peer,
            device=str(device.get("name", "")),
            generation=session.generation,
        )
        if self.app.on_paired:
            try:
                self.app.on_paired()
            except Exception:  # noqa: BLE001
                self.app.logger.warn("qr_rewrite_failed")
        self._send_json(
            200,
            {
                "v": 1,
                "token": token,
                "session": {"sid": session.sid, "generation": session.generation},
                "pc": {
                    "id": self.app.pc_id,
                    "name": self.app.pc_name,
                    "platform": _platform(),
                },
                "limits": {
                    "max_upload_bytes": self.app.uploads.max_upload_bytes,
                    "max_chunk_bytes": self.app.uploads.max_chunk_bytes,
                    "clipboard_text_bytes": MAX_CLIPBOARD_TEXT,
                },
                "server_time": int(time.time()),
            },
        )

    def _handle_upload_init(self) -> None:
        data = self._read_json_body()
        version = data.get("v")
        if version != 1:
            self._send_error(
                "protocol_version" if isinstance(version, int) and version > 1 else "bad_request",
                f"不支持的协议版本: {version!r}",
            )
            return
        upload_id = str(data.get("upload_id", "")).strip()
        if not upload_id:
            self._send_error("bad_request", "缺少 upload_id")
            return
        try:
            size = int(data.get("size", 0))
        except (TypeError, ValueError):
            self._send_error("bad_request", "size 非法")
            return
        meta = UploadMeta(
            name=safe_name.clean(str(data.get("name", ""))),
            size=size,
            mime=str(data.get("mime", "") or ""),
            kind=str(data.get("kind", "file") or "file"),
            device_id=self.headers.get("X-A2-Device", ""),
            created_at=int(data.get("created_at", 0) or 0),
        )
        result = self.app.uploads.init(upload_id, meta)
        self._send_json(200, {"v": 1, **result})

    def _handle_upload_get(self, path: str) -> None:
        upload_id = path.rsplit("/", 1)[-1]
        result = self.app.uploads.query(upload_id)
        self._send_json(200, {"v": 1, **result})

    def _handle_upload_put(self, path: str) -> None:
        upload_id = path.rsplit("/", 1)[-1]
        params = self._query()
        raw_offset = (params.get("offset") or [""])[0]
        try:
            offset = int(raw_offset)
        except ValueError:
            self._send_error("bad_request", "offset 非法", close=True)
            return
        if offset < 0:
            self._send_error("bad_request", "offset 非法", close=True)
            return
        length = self._content_length()
        if length is None or length <= 0:
            self._send_error("bad_request", "缺少 Content-Length", close=True)
            return
        if length > MAX_BODY:
            self._send_error("too_large", "块过大", close=True)
            return
        try:
            self.connection.settimeout(BODY_TIMEOUT)
        except OSError:
            pass

        def reader(size: int) -> bytes:
            return self.rfile.read(size)

        try:
            received = self.app.uploads.append(upload_id, offset, length, reader)
        except UploadError as exc:
            # 错误在读完 body 之前返回：先把剩余请求体丢掉，
            # 再带 Connection: close 应答，避免残留字节被当成下一个请求
            self._drain_body(length)
            self._upload_error(exc, close=True)
            return
        self._send_json(200, {"v": 1, "received": received})

    def _handle_upload_finish(self, path: str) -> None:
        upload_id = path[len("/v1/uploads/") : -len("/finish")]
        try:
            self.connection.settimeout(BODY_TIMEOUT)
        except OSError:
            pass
        data = self._read_json_body()
        version = data.get("v", 1)
        if version != 1:
            self._send_error("bad_request", f"不支持的协议版本: {version!r}")
            return
        sha256 = data.get("sha256")
        result = self.app.uploads.finish(upload_id, str(sha256) if sha256 else None)
        device_name = ""
        if self.app.session.device:
            device_name = str(self.app.session.device.get("name", ""))
        self.app.history.add(
            device=device_name,
            kind=str(result.get("kind", "file")),
            name=result.get("name", ""),
            size=result.get("size", 0),
            result="ok",
            sha256=result.get("sha256", ""),
        )
        if self.app.notify_enabled:
            self.app.notifier.notify(
                "收到文件", f"{result.get('name')}（{result.get('size', 0)} 字节）"
            )
        self._send_json(200, {"v": 1, **result})

    def _handle_clipboard_text(self) -> None:
        data = self._read_json_body()
        text = data.get("text")
        if not isinstance(text, str):
            self._send_error("bad_request", "缺少 text")
            return
        encoded = text.encode("utf-8")
        if len(encoded) > MAX_CLIPBOARD_TEXT:
            self._send_error("too_large", "剪贴板文本超过 1 MiB")
            return
        ok, reason = self.app.clipboard.write_text(text)
        saved_as = None
        if not ok:
            stamp = time.strftime("%Y%m%d-%H%M%S")
            saved_as = f"clipboard-{stamp}.txt"
            try:
                self.app.recv_dir.mkdir(parents=True, exist_ok=True)
                (self.app.recv_dir / saved_as).write_text(text, encoding="utf-8")
            except OSError as exc:
                self.app.logger.warn("clipboard_save_failed", reason=str(exc))
                saved_as = None
        self.app.logger.info(
            "clipboard_received",
            chars=len(text),
            result="ok" if ok else "degraded",
            saved_as=saved_as,
        )
        if self.app.notify_enabled:
            self.app.notifier.notify("收到剪贴板", f"{len(text)} 个字符")
        self._send_json(
            200,
            {
                "ok": True,
                "clipboard": "ok" if ok else "degraded",
                "chars": len(text),
                "saved_as": saved_as,
                "reason": "" if ok else reason,
            },
        )

    def _handle_history(self) -> None:
        params = self._query()
        try:
            limit = int((params.get("limit") or ["100"])[0])
        except ValueError:
            limit = 100
        limit = max(1, min(limit, 100))
        items = self.app.history.items(limit)
        self._send_json(200, {"v": 1, "items": items, "total": len(items)})

    # ------------------------------------------------------------ 错误映射
    def _upload_error(self, exc: UploadError, close: bool | None = None) -> None:
        if close is None:
            close = exc.code in {"bad_request", "too_large", "insufficient_storage"}
        self._send_error(exc.code, exc.message, extra=exc.extra, close=close)

    def _drain_body(self, length: int) -> None:
        """丢弃还没读完的请求体（仅限已认证的失败路径）。"""
        remaining = max(0, min(length, MAX_BODY))
        try:
            while remaining > 0:
                chunk = self.rfile.read(min(COPY_BUFFER, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
        except (OSError, socket.timeout):
            pass


def _platform() -> str:
    import sys

    return sys.platform


class A2ShareServer(ThreadingHTTPServer):
    """线程化 HTTP 服务（带连接数上限）。"""

    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address: tuple[str, int], app: App) -> None:
        self.app = app
        self._active = 0
        self._counter_lock = threading.Lock()
        super().__init__(address, A2Handler)

    def process_request(self, request, client_address) -> None:  # type: ignore[override]
        with self._counter_lock:
            if self._active >= MAX_CONNECTIONS:
                self.app.logger.warn("too_many_connections", peer=str(client_address))
                try:
                    request.close()
                except OSError:
                    pass
                return
            self._active += 1
        super().process_request(request, client_address)

    def shutdown_request(self, request) -> None:  # type: ignore[override]
        super().shutdown_request(request)
        with self._counter_lock:
            self._active = max(0, self._active - 1)


def create_server(app: App, host: str, port: int) -> A2ShareServer:
    """创建（但不启动）服务实例。"""
    return A2ShareServer((host, port), app)
