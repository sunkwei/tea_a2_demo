"""接收历史：只记元数据，滚动保留最近 100 条（需求 FR-C13）。

绝不记录剪贴板正文或文件内容（FR-S07）。
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

DEFAULT_LIMIT = 100


class History:
    """JSONL 历史台账。"""

    def __init__(self, path: Path, limit: int = DEFAULT_LIMIT) -> None:
        self.path = path
        self.limit = limit

    def add(self, **fields: Any) -> None:
        """追加一条（时间戳自动补上）。"""
        record = {"ts": int(time.time())}
        record.update(fields)
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(record, ensure_ascii=False) + "\n")
        except OSError:
            return
        self._trim()

    def items(self, limit: int | None = None) -> list[dict[str, Any]]:
        """读取最近若干条（最新的在前）。"""
        if not self.path.exists():
            return []
        records: list[dict[str, Any]] = []
        try:
            with self.path.open("r", encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        record = json.loads(line)
                    except ValueError:
                        continue
                    if isinstance(record, dict):
                        records.append(record)
        except OSError:
            return []
        records.reverse()
        return records[: (limit or self.limit)]

    def _trim(self) -> None:
        try:
            with self.path.open("r", encoding="utf-8") as fh:
                lines = [line for line in fh if line.strip()]
        except OSError:
            return
        if len(lines) <= self.limit:
            return
        keep = lines[-self.limit :]
        try:
            tmp = self.path.with_suffix(".jsonl.tmp")
            tmp.write_text("".join(keep), encoding="utf-8")
            tmp.replace(self.path)
        except OSError:
            pass
