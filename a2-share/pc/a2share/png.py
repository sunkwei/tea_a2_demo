"""最小 PNG 编码器（zlib + struct，无第三方依赖）。

只支持 8 位灰度、每行 filter type 0 —— 二维码黑白图够用。
"""

from __future__ import annotations

import struct
import zlib
from typing import Sequence


def _chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def encode_gray_png(width: int, height: int, pixels: Sequence[Sequence[int]]) -> bytes:
    """把二维灰度数组（0-255）编码成 PNG 字节串。"""
    if len(pixels) != height:
        raise ValueError("像素行数与高度不一致")
    raw = bytearray()
    for row in pixels:
        if len(row) != width:
            raise ValueError("像素列数与宽度不一致")
        raw.append(0)  # filter type 0 (None)
        raw.extend(bytes(bytearray(value & 0xFF for value in row)))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", ihdr)
        + _chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + _chunk(b"IEND", b"")
    )


def matrix_to_png(matrix: Sequence[Sequence[bool]], scale: int = 10) -> bytes:
    """把二维码矩阵渲染成 PNG 字节串（黑=0，白=255）。"""
    height = len(matrix)
    width = len(matrix[0]) if height else 0
    pixels = [
        [0 if cell else 255 for cell in row for _ in range(scale)]
        for row in matrix
        for _ in range(scale)
    ]
    return encode_gray_png(width * scale, height * scale, pixels)
