"""日志：结构化 JSONL 落盘 + 人类可读终端输出（需求 FR-C12 / NFR-11）。

约定（PROTOCOL.md §7.3）：只允许白名单字段进日志，剪贴板正文与文件内容
永远不写。级别：debug / info / warn / error。
"""

from __future__ import annotations

import json
import sys
import threading
import time
from pathlib import Path
from typing import Any, TextIO

LEVELS = {"debug": 10, "info": 20, "warn": 30, "error": 40}

#: 允许写进日志的字段（其余一律丢弃，防止把内容泄进日志）
WHITELIST = {
    "event",
    "peer",
    "device_id",
    "upload_id",
    "name",
    "size",
    "ms",
    "code",
    "path",
    "port",
    "sid",
    "generation",
    "kind",
    "result",
    "chars",
    "saved_as",
    "reason",
    "level",
    "ts",
    "msg",
}


class Logger:
    """线程安全的行日志器。"""

    def __init__(
        self,
        path: Path | None = None,
        level: str = "info",
        *,
        json_mode: bool = False,
        stream: TextIO | None = None,
        max_bytes: int = 5 * 1024 * 1024,
        backups: int = 3,
    ) -> None:
        self.path = path
        self.level = LEVELS.get(level, 20)
        self.json_mode = json_mode
        self.stream = stream if stream is not None else sys.stdout
        self.max_bytes = max_bytes
        self.backups = backups
        self._lock = threading.Lock()

    # ------------------------------------------------------------------ 写入
    def log(self, level: str, event: str, **fields: Any) -> None:
        if LEVELS.get(level, 20) < self.level:
            return
        record: dict[str, Any] = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime()),
            "level": level,
            "event": event,
        }
        for key, value in fields.items():
            if key in WHITELIST:
                record[key] = value
        line = json.dumps(record, ensure_ascii=False, sort_keys=True)
        with self._lock:
            self._write_file(line)
            self._write_terminal(record, line)

    def debug(self, event: str, **fields: Any) -> None:
        self.log("debug", event, **fields)

    def info(self, event: str, **fields: Any) -> None:
        self.log("info", event, **fields)

    def warn(self, event: str, **fields: Any) -> None:
        self.log("warn", event, **fields)

    def error(self, event: str, **fields: Any) -> None:
        self.log("error", event, **fields)

    # ------------------------------------------------------------- 内部实现
    def _write_file(self, line: str) -> None:
        if self.path is None:
            return
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            if self.path.exists() and self.path.stat().st_size > self.max_bytes:
                self._rotate()
            with self.path.open("a", encoding="utf-8") as fh:
                fh.write(line + "\n")
        except OSError:
            # 日志写不进去不能影响主流程
            pass

    def _rotate(self) -> None:
        for index in range(self.backups, 0, -1):
            src = self.path.with_suffix(self.path.suffix + f".{index}")
            dst = self.path.with_suffix(self.path.suffix + f".{index + 1}")
            if src.exists():
                try:
                    if index == self.backups:
                        src.unlink()
                    else:
                        dst.replace(src)
                except OSError:
                    pass
        first = self.path.with_suffix(self.path.suffix + ".1")
        try:
            self.path.replace(first)
        except OSError:
            pass

    def _write_terminal(self, record: dict[str, Any], line: str) -> None:
        if self.json_mode:
            self.stream.write(line + "\n")
        else:
            extra = {
                k: v
                for k, v in record.items()
                if k not in ("ts", "level", "event")
            }
            tail = " ".join(f"{k}={v}" for k, v in extra.items())
            self.stream.write(
                f"[{record['ts']}] {record['level'].upper():5s} {record['event']}"
                + (f"  {tail}" if tail else "")
                + "\n")
        try:
            self.stream.flush()
        except (OSError, ValueError):
            pass


class NullLogger(Logger):
    """测试用：什么都不写。"""

    def __init__(self) -> None:
        super().__init__(path=None, level="error", stream=sys.stdout)

    def log(self, level: str, event: str, **fields: Any) -> None:  # noqa: D102
        return
