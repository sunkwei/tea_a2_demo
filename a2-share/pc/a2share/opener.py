"""用系统看图工具打开二维码 PNG（``--open``）。"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

from .log import Logger


def open_file(path: Path, logger: Logger) -> bool:
    """打开文件；失败只记日志。"""
    try:
        if sys.platform == "win32":
            os.startfile(str(path))  # type: ignore[attr-defined]
            return True
        if sys.platform == "darwin":
            return subprocess.run(
                ["open", str(path)], check=False, capture_output=True, timeout=10
            ).returncode == 0
        if shutil.which("xdg-open"):
            return subprocess.run(
                ["xdg-open", str(path)], check=False, capture_output=True, timeout=10
            ).returncode == 0
        logger.warn("opener_unavailable")
        return False
    except (OSError, subprocess.SubprocessError) as exc:
        logger.warn("open_failed", reason=str(exc))
        return False
