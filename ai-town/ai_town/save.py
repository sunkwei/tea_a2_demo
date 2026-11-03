"""存档 / 读档：纯 JSON，带版本号，兼容旧档。"""
from __future__ import annotations

import io
import json
import os
import time
from typing import Any, Dict, List, Optional

SAVE_VERSION = 1
DEFAULT_SAVE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "saves")


def ensure_dir(path: str) -> str:
    if not os.path.isdir(path):
        os.makedirs(path, exist_ok=True)
    return path


def save_path(name: str, directory: str = DEFAULT_SAVE_DIR) -> str:
    ensure_dir(directory)
    safe = "".join(ch for ch in name if ch not in '\\/:*?"<>|').strip() or "save"
    stamp = time.strftime("%Y%m%d-%H%M%S")
    return os.path.join(directory, f"{safe}-{stamp}.json")


def write_save(payload: Dict[str, Any], path: str) -> str:
    ensure_dir(os.path.dirname(os.path.abspath(path)))
    payload = dict(payload)
    payload["save_version"] = SAVE_VERSION
    payload["saved_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
    with io.open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    return path


def read_save(path: str) -> Optional[Dict[str, Any]]:
    if not os.path.exists(path):
        return None
    try:
        with io.open(path, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    return data


def list_saves(directory: str = DEFAULT_SAVE_DIR) -> List[Dict[str, Any]]:
    if not os.path.isdir(directory):
        return []
    out = []
    for fn in sorted(os.listdir(directory), reverse=True):
        if not fn.endswith(".json"):
            continue
        full = os.path.join(directory, fn)
        data = read_save(full) or {}
        st = data.get("state") or {}
        out.append(
            {
                "file": fn,
                "path": full,
                "town": st.get("name", "?"),
                "day": st.get("day", 1),
                "year": st.get("year", 1),
                "season": st.get("season", "春"),
                "saved_at": data.get("saved_at", ""),
            }
        )
    return out
