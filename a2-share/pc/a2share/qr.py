"""二维码载荷编解码 + 矩阵渲染（PROTOCOL.md §2）。

载荷格式（alphanumeric，定宽，≤ 51 字节）::

    A2S1-<SECRET:16>-<IP:8>-<PORT:4>-<ISSUED:7>[-<NAME:1..7>]

按 **固定偏移** 解析（不按 ``-`` 分割，因为 NAME 里可能含 ``-``）::

    secret[5:21]  ip[22:30]  port[31:35]  issued[36:43]  name[44:]

基础长度 43 字符，带名字最长 51 字符。
"""

from __future__ import annotations

import importlib.util
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
MAGIC = "A2S1"
BASE_LEN = 43
MAX_LEN = 51

_HEX_RE = re.compile(r"^[0-9A-F]+$")
_B32_RE = re.compile(r"^[A-Z2-7]+$")
_NAME_RE = re.compile(r"^[A-Z0-9-]+$")


class QrError(ValueError):
    """载荷非法。``code`` 取值：bad_payload / bad_address / bad_port / protocol_version。"""

    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(message or code)
        self.code = code
        self.message = message or code


@dataclass
class QrInfo:
    """解析结果。"""

    secret: str
    ip: str
    port: int
    issued: int
    name: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "secret": self.secret,
            "ip": self.ip,
            "port": self.port,
            "issued": self.issued,
            "name": self.name,
        }


# --------------------------------------------------------------------- 工具
def b32_encode_bits(value: int, bits: int) -> str:
    """把 ``value`` 按 5 bit 一组编码成 base32（**高位在前**，高位补零）。

    例：32 位时间戳当 35 bit（左边补 3 个 0）编码 → 7 个字符，
    解码回来正好是原值（PROTOCOL.md §2.2 第 4 条）。
    """
    groups = bits // 5
    out = []
    for index in range(groups):
        shift = 5 * (groups - 1 - index)
        out.append(B32_ALPHABET[(value >> shift) & 0x1F])
    return "".join(out)


def b32_decode_bits(text: str) -> int:
    value = 0
    for char in text:
        index = B32_ALPHABET.find(char)
        if index < 0:
            raise QrError("bad_payload", f"非法 base32 字符: {char!r}")
        value = (value << 5) | index
    return value


def encode_ip(ip: str) -> str:
    parts = ip.split(".")
    if len(parts) != 4:
        raise QrError("bad_address", f"非法 IPv4: {ip}")
    out = []
    for part in parts:
        try:
            number = int(part)
        except ValueError as exc:  # pragma: no cover - 由调用方保证
            raise QrError("bad_address", f"非法 IPv4: {ip}") from exc
        if not 0 <= number <= 255:
            raise QrError("bad_address", f"非法 IPv4: {ip}")
        out.append(f"{number:02X}")
    return "".join(out)


def decode_ip(hex_text: str) -> str:
    if len(hex_text) != 8 or not _HEX_RE.match(hex_text):
        raise QrError("bad_address", f"非法 IP 字段: {hex_text}")
    octets = [int(hex_text[i : i + 2], 16) for i in range(0, 8, 2)]
    first, second = octets[0], octets[1]
    if octets == [0, 0, 0, 0]:
        raise QrError("bad_address", "不接受 0.0.0.0")
    if first == 127:
        raise QrError("bad_address", "不接受回环地址")
    if first == 169 and second == 254:
        raise QrError("bad_address", "不接受链路本地地址")
    if 224 <= first <= 239:
        raise QrError("bad_address", "不接受组播地址")
    if octets == [255, 255, 255, 255]:
        raise QrError("bad_address", "不接受广播地址")
    return ".".join(str(o) for o in octets)


def encode_port(port: int) -> str:
    if not 1 <= port <= 65535:
        raise QrError("bad_port", f"非法端口: {port}")
    return f"{port:04X}"


def decode_port(hex_text: str) -> int:
    if len(hex_text) != 4 or not _HEX_RE.match(hex_text):
        raise QrError("bad_port", f"非法端口字段: {hex_text}")
    port = int(hex_text, 16)
    if port == 0:
        raise QrError("bad_port", "不接受端口 0")
    return port


def encode_issued(issued: int) -> str:
    """32 位秒级时间戳 → 7 个 base32 字符（当 35 bit，左边补 3 个 0）。"""
    value = int(issued) & 0xFFFFFFFF
    return b32_encode_bits(value, 35)


def decode_issued(text: str) -> int:
    if len(text) != 7 or not _B32_RE.match(text):
        raise QrError("bad_payload", f"非法时间戳字段: {text}")
    return b32_decode_bits(text) & 0xFFFFFFFF


def sanitize_name(name: str | None) -> str | None:
    """PC 名提示：只保留 ``A-Z0-9-``，取前 7 位；空则整体省略。"""
    if not name:
        return None
    cleaned = re.sub(r"[^A-Z0-9-]", "", name.upper())[:7]
    return cleaned or None


# ------------------------------------------------------------------ 编解码
def encode_payload(
    secret: str,
    ip: str,
    port: int,
    issued: int | None = None,
    name: str | None = None,
) -> str:
    """生成载荷字符串。"""
    secret = secret.upper()
    if len(secret) != 16 or not _B32_RE.match(secret):
        raise QrError("bad_payload", "secret 必须是 16 位 base32")
    if issued is None:
        issued = int(time.time())
    clean_name = sanitize_name(name)
    payload = (
        f"{MAGIC}-{secret}-{encode_ip(ip)}-{encode_port(port)}-{encode_issued(issued)}"
    )
    if clean_name:
        payload += f"-{clean_name}"
    if len(payload) > MAX_LEN:  # pragma: no cover - 结构上不可能超过
        raise QrError("bad_payload", "载荷过长")
    return payload


def decode_payload(raw: str) -> QrInfo:
    """解析载荷。非法时抛 :class:`QrError`（带 ``code``）。"""
    text = "".join(ch for ch in (raw or "") if ch.isprintable()).strip()
    if not text.startswith(MAGIC + "-"):
        if re.match(r"^A2S[0-9]-", text):
            raise QrError("protocol_version", "载荷版本不支持")
        raise QrError("bad_payload", "缺少 A2S1 前缀")
    if not (BASE_LEN <= len(text) <= MAX_LEN):
        raise QrError("bad_payload", f"长度非法: {len(text)}")
    if not _B32_RE.match(text[5:21]):
        raise QrError("bad_payload", "secret 字符集非法")
    secret = text[5:21]
    ip = decode_ip(text[22:30])
    port = decode_port(text[31:35])
    issued = decode_issued(text[36:43])
    name: str | None = None
    if len(text) > BASE_LEN:
        if text[43] != "-":
            raise QrError("bad_payload", "缺少名字分隔符")
        candidate = text[44:]
        if candidate and _NAME_RE.match(candidate):
            name = candidate
    return QrInfo(secret=secret, ip=ip, port=port, issued=issued, name=name)


# ------------------------------------------------------------------ 矩阵渲染
def _load_vendor():
    """加载 vendored 的 Nayuki QR 编码器（MIT，见 vendor/README.md）。"""
    path = Path(__file__).resolve().parent.parent / "vendor" / "qrcodegen.py"
    spec = importlib.util.spec_from_file_location("a2share_vendor_qrcodegen", path)
    if spec is None or spec.loader is None:  # pragma: no cover
        raise RuntimeError(f"无法加载 QR 编码器: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def render_matrix(payload: str, border: int = 4) -> list[list[bool]]:
    """渲染二维码为 0/1 矩阵（含静区）。True = 黑点。"""
    vendor = _load_vendor()
    segment = vendor.QrSegment.make_alphanumeric(payload)
    code = vendor.QrCode.encode_segments([segment], vendor.QrCode.Ecc.MEDIUM)
    raw_size = getattr(code, "size", None) or code.get_size()
    size = raw_size + border * 2
    matrix = [[False] * size for _ in range(size)]
    for y in range(raw_size):
        for x in range(raw_size):
            if code.get_module(x, y):
                matrix[y + border][x + border] = True
    return matrix


def build_png(payload: str, scale: int = 10, border: int = 4) -> bytes:
    """把载荷渲染成 PNG 字节串（黑点 + 4 module 静区）。"""
    from . import png as png_mod

    matrix = render_matrix(payload, border)
    return png_mod.matrix_to_png(matrix, scale)


def write_qr_png(path, payload: str, scale: int = 10, border: int = 4) -> bytes:
    """原子地把二维码 PNG 写到 ``path``。"""
    import os
    from pathlib import Path

    data = build_png(payload, scale, border)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)
    return data
