"""路径与目录约定（DESIGN.md §6.1）。

状态目录默认 ``~/.tea_agent/a2_share``，可用 ``--home`` 或环境变量
``A2_SHARE_HOME`` 覆盖（e2e / 单测用临时目录）。
"""

from __future__ import annotations

import os
from pathlib import Path

APP_NAME = "a2_share"
DEFAULT_PORT = 8899
INCOMING_DIRNAME = ".a2-incoming"


def state_dir(explicit: str | os.PathLike[str] | None = None) -> Path:
    """返回状态目录（配置、二维码、日志、台账）。"""
    if explicit:
        return Path(explicit).expanduser()
    env = os.environ.get("A2_SHARE_HOME")
    if env:
        return Path(env).expanduser()
    return Path.home() / ".tea_agent" / APP_NAME


def default_recv_dir() -> Path:
    """默认接收目录：``~/Downloads/a2_share``（需求 §8.4 / Q-10）。"""
    return Path.home() / "Downloads" / APP_NAME


def ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def incoming_dir(recv_dir: Path) -> Path:
    """未完成传输的落脚点（与最终文件同卷，保证 rename 原子）。"""
    return recv_dir / INCOMING_DIRNAME


def state_paths(home: Path) -> dict[str, Path]:
    """状态目录下的固定文件位置。"""
    return {
        "config": home / "config.json",
        "qr": home / "qr.png",
        "log": home / "a2_share.log",
        "completed": home / "completed.jsonl",
        "history": home / "history.jsonl",
    }
