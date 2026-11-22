"""a2_share · PC 端（接收端）实现。

分层（见 DESIGN.md §4.1）：
    cli → server → {session, uploads, history, log}
    uploads → {safe_name, paths, log}
    qr → {vendor/qrcodegen, png}

所有模块都不读全局状态（config 显式传入），便于测试注入。
"""

__all__ = ["APP_NAME", "VERSION", "PROTOCOL_VERSION"]

APP_NAME = "a2_share"
VERSION = "1.0.0"
#: 线缆协议版本（PROTOCOL.md §10）
PROTOCOL_VERSION = 1
