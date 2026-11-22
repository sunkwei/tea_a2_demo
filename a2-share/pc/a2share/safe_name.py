"""文件名清洗与「同名不覆盖」的原子占名（PROTOCOL.md §6）。

PC 端是权威实现；手机端同名规则只用于让队列显示名与最终一致。
"""

from __future__ import annotations

import errno
import os
import re
import time
import unicodedata
from pathlib import Path

#: Windows 保留名（大小写不敏感，含带扩展名的形式）
RESERVED = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}

ILLEGAL_CHARS = '/\\:*?"<>|'
CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")
MAX_NAME_BYTES = 180
MAX_EXT_BYTES = 20


def clean(raw: str) -> str:
    """把任意来源的文件名清洗成安全的落盘名。

    保留中文 / emoji / 空格（需求 FR-P17），只处理非法字符、保留名与超长。
    """
    if raw is None:
        raw = ""
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", "replace")
    # 1) 统一 NFC
    text = unicodedata.normalize("NFC", raw)
    # 2) 只取最后一段（按 / 与 \ 切）
    text = re.split(r"[/\\]", text)[-1]
    # 3) 去控制字符
    text = CONTROL_CHARS.sub("", text)
    # 4) 非法字符换 _
    text = "".join("_" if ch in ILLEGAL_CHARS else ch for ch in text)
    # 5) 去首尾空格、去结尾的点
    text = text.strip(" ")
    text = text.rstrip(".")
    # 6) 保留名
    stem, ext = _split_ext(text)
    if stem.upper() in RESERVED:
        stem = "_" + stem
    text = stem + ext
    # 7) 限长（不切坏多字节字符）
    text = _truncate(text, MAX_NAME_BYTES)
    # 8) 空结果兜底
    if not text:
        text = f"file-{int(time.time() * 1000)}"
    return text


def _split_ext(name: str) -> tuple[str, str]:
    index = name.rfind(".")
    if index <= 0:  # 没有扩展名，或以点开头（隐藏文件）
        return name, ""
    return name[:index], name[index:]


def _truncate(name: str, limit: int) -> str:
    """按 UTF-8 字节截断，尽量保留扩展名，且不切坏多字节字符。"""
    if len(name.encode("utf-8")) <= limit:
        return name
    stem, ext = _split_ext(name)
    ext_bytes = ext.encode("utf-8")
    if len(ext_bytes) > MAX_EXT_BYTES:
        stem, ext = name, ""  # 扩展名过长就整个不要
        ext_bytes = b""
    keep = max(1, limit - len(ext_bytes))
    encoded = stem.encode("utf-8")
    if len(encoded) <= keep:
        return stem + ext
    cut = encoded[:keep]
    while cut and (cut[-1] & 0xC0) == 0x80:  # 回退到字符边界
        cut = cut[:-1]
    try:
        stem = cut.decode("utf-8")
    except UnicodeDecodeError:  # pragma: no cover - 理论上不会发生
        stem = ""
    return (stem or "file") + ext


def _candidates(name: str) -> list[str]:
    """同名时的候选名列表：``x.pdf`` → ``x (1).pdf`` → ``x (2).pdf`` ..."""
    stem, ext = _split_ext(name)
    yield name
    for index in range(1, 1000):
        yield f"{stem} ({index}){ext}"


def claim(part_path: Path, target_dir: Path, name: str) -> Path:
    """把 ``.part`` 原子占名为最终文件名，**绝不覆盖**已有文件。

    POSIX 用 ``link``（已存在则 EEXIST），Windows 用 ``rename``（已存在则失败）。
    候选名全部占用时退回 ``<base>-<6 hex><ext>``。
    """
    target_dir.mkdir(parents=True, exist_ok=True)
    for candidate in _candidates(name):
        target = target_dir / candidate
        try:
            if os.name == "nt":
                os.rename(part_path, target)
            else:
                os.link(part_path, target)
                os.unlink(part_path)
        except OSError as exc:
            if exc.errno in (errno.EEXIST, errno.EPERM, errno.EACCES):
                continue
            raise
        return target
    stem, ext = _split_ext(name)
    fallback = target_dir / f"{stem}-{os.urandom(3).hex()}{ext}"
    if os.name == "nt":
        os.rename(part_path, fallback)
    else:
        os.link(part_path, fallback)
        os.unlink(part_path)
    return fallback
