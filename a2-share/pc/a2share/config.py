"""config.json 的读写（DESIGN.md §6.1）。

写文件必须原子（临时文件 + replace），避免半截 JSON 让下次启动读不出来。
"""

from __future__ import annotations

import json
import os
import re
import socket
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path

from .paths import DEFAULT_PORT


@dataclass
class Config:
    """PC 端持久配置。"""

    version: int = 1
    pc_id: str = ""
    name: str = ""
    port: int = DEFAULT_PORT
    dir: str = ""
    notify: bool = True
    clipboard_image: bool = False
    extra: dict = field(default_factory=dict)

    # --------------------------------------------------------------- 读写
    @classmethod
    def load(cls, path: Path) -> "Config":
        data: dict = {}
        if path.exists():
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(raw, dict):
                    data = raw
            except (OSError, ValueError):
                data = {}
        known = {f for f in cls.__dataclass_fields__ if f != "extra"}
        extra = {k: v for k, v in data.items() if k not in known}
        cfg = cls(
            version=int(data.get("version", 1) or 1),
            pc_id=str(data.get("pc_id", "") or ""),
            name=str(data.get("name", "") or ""),
            port=int(data.get("port", DEFAULT_PORT) or DEFAULT_PORT),
            dir=str(data.get("dir", "") or ""),
            notify=bool(data.get("notify", True)),
            clipboard_image=bool(data.get("clipboard_image", False)),
            extra=extra,
        )
        return cfg

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        data = asdict(self)
        extra = data.pop("extra", {}) or {}
        data.update(extra)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(
            json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        os.replace(tmp, path)

    # --------------------------------------------------------------- 便捷
    def ensure_identity(self) -> None:
        """补齐 pc_id 与显示名（首次启动）。"""
        if not self.pc_id:
            self.pc_id = uuid.uuid4().hex
        if not self.name:
            self.name = default_pc_name()


def default_pc_name() -> str:
    """PC 显示名：主机名清洗成 ASCII，最多 24 字符。"""
    host = socket.gethostname() or "PC"
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", host).strip("-._")
    return (cleaned or "PC")[:24]
