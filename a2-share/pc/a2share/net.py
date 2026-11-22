"""本机 IPv4 挑选与地址变化监视（需求 FR-C02 / FR-C14）。"""

from __future__ import annotations

import socket
import threading
import time
from typing import Callable

from .log import Logger


def is_private_ipv4(ip: str) -> bool:
    """是否是 RFC1918 私网地址（设计假设 A2）。"""
    try:
        parts = [int(p) for p in ip.split(".")]
    except ValueError:
        return False
    if len(parts) != 4 or any(not 0 <= p <= 255 for p in parts):
        return False
    first, second = parts[0], parts[1]
    if first == 10:
        return True
    if first == 172 and 16 <= second <= 31:
        return True
    if first == 192 and second == 168:
        return True
    return False


def local_ipv4() -> str | None:
    """挑一个本机私网 IPv4。

    先用 UDP connect 拿默认路由的源地址（不真的发包），再退回
    ``getaddrinfo``；最后过滤出私网地址。
    """
    candidates: list[str] = []
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.settimeout(0.3)
            sock.connect(("192.0.2.1", 9))  # TEST-NET-1，只查路由不发包
            candidates.append(sock.getsockname()[0])
        finally:
            sock.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            candidates.append(info[4][0])
    except OSError:
        pass
    for candidate in candidates:
        if is_private_ipv4(candidate):
            return candidate
    for candidate in candidates:
        if candidate and not candidate.startswith("127."):
            return candidate
    return None


def watch_ip(
    current: str,
    on_change: Callable[[str], None],
    logger: Logger,
    interval: float = 3.0,
    stop_event: threading.Event | None = None,
) -> threading.Thread:
    """后台监视本机 IP 变化；变了就回调（重写二维码 + 提示重扫）。"""

    def loop() -> None:
        event = stop_event or threading.Event()
        while not event.wait(interval):
            try:
                latest = local_ipv4()
            except OSError:
                continue
            if latest and latest != current:
                logger.warn("ip_changed", peer=latest)
                on_change(latest)

    thread = threading.Thread(target=loop, name="a2-ip-watch", daemon=True)
    thread.start()
    return thread
