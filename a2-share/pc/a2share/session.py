"""会话凭据：secret / 短码 / token / 轮换 / 限流（PROTOCOL.md §3）。

要点：
- ``secret`` 永远是「当前可用、尚未被消费」的那一张；配对成功立即轮换。
- 短码由 secret 派生（同源、同寿命），PC 计算、手机只输入。
- token 常数时间比较，单设备。
- 配对抗爆破：每 IP 5 次 / 5 分钟；全局 20 次 / 10 分钟。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import threading
import time
from dataclasses import dataclass, field
from typing import Any

SECRET_BYTES = 10  # 80 bit
TOKEN_BYTES = 32  # 64 hex
B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
_HEX_RE = re.compile(r"^[0-9a-f]+$")

#: 配对限流参数（PROTOCOL.md §3.4）
IP_FAIL_LIMIT = 5
IP_FAIL_WINDOW = 300.0
GLOBAL_FAIL_LIMIT = 20
GLOBAL_FAIL_WINDOW = 600.0
LOCK_SECONDS = 60.0


def random_secret() -> str:
    """生成 16 字符 base32 secret（10 字节，无填充）。"""
    return base64.b32encode(secrets.token_bytes(SECRET_BYTES)).decode("ascii").rstrip("=")


def short_code_for(secret: str) -> str:
    """短码 = HMAC-SHA256(key=secret 字符串, msg="a2s-pair") 前 4 字节 BE % 1e6。

    与 PROTOCOL.md §2.4 一致：key 用 secret 的 **UTF-8 字节**，不是解码后的原始字节。
    """
    mac = hmac.new(secret.encode("utf-8"), b"a2s-pair", hashlib.sha256).digest()
    value = int.from_bytes(mac[:4], "big") % 1_000_000
    return f"{value:06d}"


def new_token() -> str:
    return secrets.token_bytes(TOKEN_BYTES).hex()


def constant_time_equals(left: str, right: str) -> bool:
    """常数时间比较（长度不等也走完整比较流程）。"""
    return hmac.compare_digest(left.encode("utf-8"), right.encode("utf-8"))


@dataclass
class Session:
    """PC 侧会话状态。"""

    sid: str = field(default_factory=lambda: secrets.token_bytes(4).hex())
    secret: str = field(default_factory=random_secret)
    generation: int = 1
    token: str | None = None
    device: dict[str, Any] | None = None
    paired_at: float = 0.0

    def __post_init__(self) -> None:
        self._lock = threading.RLock()
        self._ip_failures: dict[str, list[float]] = {}
        self._global_failures: list[float] = []
        self._ip_locked_until: dict[str, float] = {}
        self._locked_until: float = 0.0

    # ------------------------------------------------------------- 凭据
    @property
    def short_code(self) -> str:
        return short_code_for(self.secret)

    @property
    def paired(self) -> bool:
        return self.token is not None

    def rotate(self, revoke: bool = True) -> None:
        """轮换配对凭据。

        - ``revoke=False``：只换 secret 与 generation（配对成功后用，已发的 token 保留）；
        - ``revoke=True``：同时吊销 token 与设备（``--reset-identity`` 用）。
        """
        with self._lock:
            self.secret = random_secret()
            self.generation += 1
            if revoke:
                self.token = None
                self.device = None
                self.paired_at = 0.0

    def issue_token(self, device: dict[str, Any]) -> str:
        """吊销旧 token、发新 token，并记录设备。"""
        with self._lock:
            self.token = new_token()
            self.device = device
            self.paired_at = time.time()
            return self.token

    def check_token(self, token: str | None) -> str:
        """校验 token。

        返回 ``"ok"`` / ``"unauthorized"``（没有或格式不对）/ ``"session_expired"``
        （格式对但已不属于当前会话）。手机据此区分「请重新扫码」。
        """
        if not token:
            return "unauthorized"
        if len(token) != TOKEN_BYTES * 2 or not _HEX_RE.match(token):
            return "unauthorized"
        with self._lock:
            if self.token is None:
                # 会话已被轮换（PC 重启 / --reset-identity / 尚未配对）
                return "session_expired"
            if constant_time_equals(token, self.token):
                return "ok"
            return "session_expired"

    # ------------------------------------------------------------- 限流
    def _prune(self, now: float) -> None:
        cutoff_ip = now - IP_FAIL_WINDOW
        for ip, stamps in list(self._ip_failures.items()):
            kept = [t for t in stamps if t > cutoff_ip]
            if kept:
                self._ip_failures[ip] = kept
            else:
                self._ip_failures.pop(ip, None)
        cutoff_global = now - GLOBAL_FAIL_WINDOW
        self._global_failures = [t for t in self._global_failures if t > cutoff_global]

    def rate_limit_state(self, ip: str) -> tuple[bool, int]:
        """返回 ``(是否被限流, 剩余重试次数)``。"""
        now = time.monotonic()
        with self._lock:
            self._prune(now)
            if now < self._locked_until:
                return True, 0
            ip_count = len(self._ip_failures.get(ip, ()))
            global_count = len(self._global_failures)
            attempts_left = max(0, IP_FAIL_LIMIT - ip_count)
            if now < self._locked_until:
                return True, 0
            if now < self._ip_locked_until.get(ip, 0.0):
                return True, 0
            if ip_count >= IP_FAIL_LIMIT or global_count >= GLOBAL_FAIL_LIMIT:
                return True, attempts_left
            return False, attempts_left

    def record_failure(self, ip: str) -> None:
        now = time.monotonic()
        with self._lock:
            self._prune(now)
            self._ip_failures.setdefault(ip, []).append(now)
            self._global_failures.append(now)
            ip_count = len(self._ip_failures.get(ip, ()))
            global_count = len(self._global_failures)
            if ip_count >= IP_FAIL_LIMIT:
                self._ip_locked_until[ip] = now + LOCK_SECONDS
            if global_count >= GLOBAL_FAIL_LIMIT:
                self._locked_until = now + LOCK_SECONDS

    def clear_failures(self, ip: str) -> None:
        """配对成功后清空该 IP 的失败计数与锁定。"""
        with self._lock:
            self._ip_failures.pop(ip, None)
            self._ip_locked_until.pop(ip, None)

    def lock_remaining(self, ip: str = "") -> int:
        """剩余锁定秒数（给了 ip 就看该 IP，否则看全局）。"""
        with self._lock:
            now = time.monotonic()
            if ip:
                return max(0, int(self._ip_locked_until.get(ip, 0.0) - now))
            return max(0, int(self._locked_until - now))
