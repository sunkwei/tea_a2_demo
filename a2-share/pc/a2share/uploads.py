"""分块上传的落盘、续传与定名（PROTOCOL.md §4.3–§4.7、§5）。

要点：
- ``received`` 一律以 ``.part`` 的**实际文件大小**为准（不信任内存计数）。
- 同一 ``upload_id`` 的写操作串行（每 id 一把锁）。
- 定名走 ``safe_name.claim``，绝不覆盖同名文件。
- ``finish`` 幂等：已完成的上传再次 finish 返回同一结果。
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable

from . import safe_name
from .log import Logger
from .paths import incoming_dir

MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024  # 4 GiB 硬护栏
MAX_CHUNK_BYTES = 8 * 1024 * 1024  # 8 MiB 单块上限
DISK_MARGIN_BYTES = 64 * 1024 * 1024  # 落盘余量
COPY_BUFFER = 64 * 1024
LEDGER_LIMIT = 500  # completed.jsonl 滚动条数


class UploadError(Exception):
    """上传相关错误，``code`` 对应 PROTOCOL.md §9 的错误目录。"""

    def __init__(self, code: str, message: str, extra: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.extra = extra or {}


@dataclass
class UploadMeta:
    """``init`` 时写一次的元数据（``received`` 不在这里，避免两处真值）。"""

    name: str
    size: int
    mime: str = ""
    kind: str = "file"
    device_id: str = ""
    created_at: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "size": self.size,
            "mime": self.mime,
            "kind": self.kind,
            "device_id": self.device_id,
            "created_at": self.created_at,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "UploadMeta":
        return cls(
            name=str(data.get("name", "")),
            size=int(data.get("size", 0)),
            mime=str(data.get("mime", "")),
            kind=str(data.get("kind", "file")),
            device_id=str(data.get("device_id", "")),
            created_at=int(data.get("created_at", 0)),
        )


class UploadStore:
    """管理 ``<recv>/.a2-incoming/`` 下的未完成传输。"""

    def __init__(
        self,
        recv_dir: Path,
        home: Path,
        logger: Logger,
        *,
        max_upload_bytes: int = MAX_UPLOAD_BYTES,
        max_chunk_bytes: int = MAX_CHUNK_BYTES,
    ) -> None:
        self.recv_dir = recv_dir
        self.home = home
        self.logger = logger
        self.max_upload_bytes = max_upload_bytes
        self.max_chunk_bytes = max_chunk_bytes
        self.incoming = incoming_dir(recv_dir)
        self.ledger_path = home / "completed.jsonl"
        self._locks: dict[str, threading.Lock] = {}
        self._guard = threading.Lock()
        self._meta_cache: dict[str, UploadMeta] = {}

    # ------------------------------------------------------------- 内部工具
    def _lock_for(self, upload_id: str) -> threading.Lock:
        with self._guard:
            lock = self._locks.get(upload_id)
            if lock is None:
                lock = threading.Lock()
                self._locks[upload_id] = lock
            return lock

    def _part_path(self, upload_id: str) -> Path:
        return self.incoming / f"{upload_id}.part"

    def _meta_path(self, upload_id: str) -> Path:
        return self.incoming / f"{upload_id}.json"

    def _read_meta(self, upload_id: str) -> UploadMeta | None:
        path = self._meta_path(upload_id)
        if not path.exists():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        if not isinstance(data, dict):
            return None
        return UploadMeta.from_dict(data)

    def _write_meta(self, upload_id: str, meta: UploadMeta) -> None:
        self.incoming.mkdir(parents=True, exist_ok=True)
        path = self._meta_path(upload_id)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(meta.to_dict(), ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, path)

    def _received(self, upload_id: str) -> int:
        path = self._part_path(upload_id)
        try:
            return path.stat().st_size
        except OSError:
            return 0

    def _free_space(self) -> int:
        try:
            return shutil.disk_usage(self.recv_dir).free
        except OSError:
            return 1 << 62

    # --------------------------------------------------------------- 台账
    def _read_ledger(self) -> list[dict[str, Any]]:
        if not self.ledger_path.exists():
            return []
        records: list[dict[str, Any]] = []
        try:
            with self.ledger_path.open("r", encoding="utf-8") as fh:
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
        return records

    def _append_ledger(self, record: dict[str, Any]) -> None:
        self.home.mkdir(parents=True, exist_ok=True)
        try:
            with self.ledger_path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(record, ensure_ascii=False) + "\n")
        except OSError:
            self.logger.warn("ledger_write_failed")

    def _trim_ledger(self) -> None:
        records = self._read_ledger()
        if len(records) <= LEDGER_LIMIT:
            return
        keep = records[-LEDGER_LIMIT:]
        tmp = self.ledger_path.with_suffix(".jsonl.tmp")
        try:
            tmp.write_text(
                "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in keep),
                encoding="utf-8",
            )
            os.replace(tmp, self.ledger_path)
        except OSError:
            pass

    def completed_result(self, upload_id: str) -> dict[str, Any] | None:
        """已完成的 upload 返回台账里的结果（finish 幂等）。"""
        for record in reversed(self._read_ledger()):
            if record.get("phase") == "done" and record.get("upload_id") == upload_id:
                return record.get("result")
        return None

    # --------------------------------------------------------------- 启动恢复
    def recover(self) -> None:
        """清理残留、修正超长 ``.part``、补齐崩溃留下的 intent。"""
        self.incoming.mkdir(parents=True, exist_ok=True)
        cutoff = time.time() - 7 * 24 * 3600
        for part in self.incoming.glob("*.part"):
            upload_id = part.stem
            meta = self._read_meta(upload_id)
            if meta is None:
                # 有 .part 没 meta：孤儿残留，删掉重来
                try:
                    part.unlink()
                    self.logger.warn("orphan_part_removed", upload_id=upload_id)
                except OSError:
                    pass
                continue
            try:
                stat = part.stat()
            except OSError:
                continue
            if stat.st_mtime < cutoff:
                try:
                    part.unlink()
                    self._meta_path(upload_id).unlink(missing_ok=True)
                    self.logger.warn("stale_part_removed", upload_id=upload_id)
                except OSError:
                    pass
                continue
            if stat.st_size > meta.size:
                # 异常写入（meta.size 更小）：截断到声明大小
                with part.open("r+b") as fh:
                    fh.truncate(meta.size)
                self.logger.warn("part_truncated", upload_id=upload_id, size=meta.size)
        self._reconcile_ledger()

    def _reconcile_ledger(self) -> None:
        """intent → done 的崩溃恢复（PROTOCOL.md §5.4）。"""
        records = self._read_ledger()
        intents: dict[str, dict[str, Any]] = {}
        done_ids: set[str] = set()
        for record in records:
            upload_id = str(record.get("upload_id", ""))
            phase = record.get("phase")
            if phase == "intent":
                intents[upload_id] = record
            elif phase == "done":
                done_ids.add(upload_id)
        for upload_id, intent in intents.items():
            if upload_id in done_ids:
                continue
            final_name = str(intent.get("final_name", ""))
            size = int(intent.get("size", 0))
            target = self.recv_dir / final_name
            try:
                exists = target.exists() and target.stat().st_size == size
            except OSError:
                exists = False
            if exists:
                self._append_ledger(
                    {
                        "ts": int(time.time()),
                        "phase": "done",
                        "upload_id": upload_id,
                        "result": intent.get("result"),
                    }
                )
                self.logger.info("ledger_reconciled", upload_id=upload_id, name=final_name)

    # ------------------------------------------------------------------ API
    def init(self, upload_id: str, meta: UploadMeta) -> dict[str, Any]:
        """初始化（或恢复）一次上传。"""
        if not upload_id or "/" in upload_id or "\\" in upload_id or ".." in upload_id:
            raise UploadError("bad_request", "upload_id 非法")
        if meta.size < 0:
            raise UploadError("bad_request", "size 非法")
        if meta.size > self.max_upload_bytes:
            raise UploadError("too_large", f"文件超过 {self.max_upload_bytes} 字节上限")
        lock = self._lock_for(upload_id)
        with lock:
            existing = self._read_meta(upload_id)
            if existing is not None:
                if (
                    existing.size != meta.size
                    or existing.kind != meta.kind
                    or existing.name != meta.name
                ):
                    raise UploadError(
                        "upload_conflict",
                        "upload_id 元数据不一致",
                        {"received": self._received(upload_id)},
                    )
                received = self._received(upload_id)
                if received > meta.size:
                    with self._part_path(upload_id).open("r+b") as fh:
                        fh.truncate(meta.size)
                    received = meta.size
                return {
                    "upload_id": upload_id,
                    "received": received,
                    "name": existing.name,
                    "resume": received > 0,
                    "max_chunk_bytes": self.max_chunk_bytes,
                }
            # 没有 meta 但有 .part：孤儿，删掉重来
            part = self._part_path(upload_id)
            if part.exists():
                try:
                    part.unlink()
                    self.logger.warn("orphan_part_removed", upload_id=upload_id)
                except OSError:
                    pass
            need = meta.size + DISK_MARGIN_BYTES
            if self._free_space() < need:
                raise UploadError("insufficient_storage", "接收目录剩余空间不足")
            self.incoming.mkdir(parents=True, exist_ok=True)
            with self._part_path(upload_id).open("wb"):
                pass
            self._write_meta(upload_id, meta)
            return {
                "upload_id": upload_id,
                "received": 0,
                "name": meta.name,
                "resume": False,
                "max_chunk_bytes": self.max_chunk_bytes,
            }

    def append(
        self,
        upload_id: str,
        offset: int,
        length: int,
        reader: Callable[[int], bytes],
    ) -> int:
        """追加一段原始字节；``reader(n)`` 返回至多 n 字节。"""
        meta = self._read_meta(upload_id)
        if meta is None:
            raise UploadError("not_found", "上传不存在")
        if length <= 0 or length > self.max_chunk_bytes:
            raise UploadError("bad_request", "块长度非法")
        lock = self._lock_for(upload_id)
        with lock:
            received = self._received(upload_id)
            if offset != received:
                raise UploadError(
                    "offset_conflict",
                    f"offset {offset} != received {received}",
                    {"received": received},
                )
            if offset + length > meta.size:
                raise UploadError("bad_request", "块超出声明的文件大小")
            path = self._part_path(upload_id)
            written = 0
            try:
                with path.open("r+b") as fh:
                    fh.seek(offset)
                    while written < length:
                        chunk = reader(min(COPY_BUFFER, length - written))
                        if not chunk:
                            break
                        fh.write(chunk)
                        written += len(chunk)
                    fh.flush()
            except OSError as exc:
                raise UploadError("insufficient_storage", f"写盘失败: {exc}") from exc
            if written < length:
                # 短读：保留已写字节，客户端按 409 对齐后续传
                raise UploadError(
                    "internal",
                    "读取请求体不完整",
                    {"received": offset + written},
                )
            return offset + written

    def query(self, upload_id: str) -> dict[str, Any]:
        meta = self._read_meta(upload_id)
        if meta is None:
            raise UploadError("not_found", "上传不存在")
        received = self._received(upload_id)
        return {
            "upload_id": upload_id,
            "received": received,
            "size": meta.size,
            "name": meta.name,
            "kind": meta.kind,
            "state": "complete" if received >= meta.size else "partial",
        }

    def finish(self, upload_id: str, client_sha256: str | None = None) -> dict[str, Any]:
        """定名落盘并返回结果（幂等）。"""
        done = self.completed_result(upload_id)
        if done is not None:
            result = dict(done)
            result["dedup"] = True
            return result
        meta = self._read_meta(upload_id)
        if meta is None:
            raise UploadError("not_found", "上传不存在")
        lock = self._lock_for(upload_id)
        started = time.monotonic()
        with lock:
            received = self._received(upload_id)
            if received != meta.size:
                raise UploadError(
                    "incomplete",
                    f"只收到 {received}/{meta.size} 字节",
                    {"received": received},
                )
            part = self._part_path(upload_id)
            sha256, md5 = self._hash_file(part)
            if client_sha256 and client_sha256.lower() != sha256:
                raise UploadError("hash_mismatch", "客户端上报的 sha256 与内容不一致")
            final_name = safe_name.clean(meta.name)
            target = safe_name.claim(part, self.recv_dir, final_name)
            final_name = target.name
            result = {
                "name": final_name,
                "path": final_name,
                "size": meta.size,
                "sha256": sha256,
                "md5": md5,
                "kind": meta.kind,
                "ms": int((time.monotonic() - started) * 1000),
            }
            self._append_ledger(
                {
                    "ts": int(time.time()),
                    "phase": "intent",
                    "upload_id": upload_id,
                    "final_name": final_name,
                    "size": meta.size,
                    "result": result,
                }
            )
            self._append_ledger(
                {
                    "ts": int(time.time()),
                    "phase": "done",
                    "upload_id": upload_id,
                    "result": result,
                }
            )
            self._trim_ledger()
            try:
                self._meta_path(upload_id).unlink(missing_ok=True)
            except OSError:
                pass
            self.logger.info(
                "upload_finished",
                upload_id=upload_id,
                name=final_name,
                size=meta.size,
                ms=result["ms"],
            )
            out = dict(result)
            out["dedup"] = False
            return out

    def abort(self, upload_id: str) -> None:
        """放弃上传并清理 ``.part``（幂等）。"""
        with self._lock_for(upload_id):
            for path in (self._part_path(upload_id), self._meta_path(upload_id)):
                try:
                    path.unlink(missing_ok=True)
                except OSError:
                    pass
            self.logger.info("upload_aborted", upload_id=upload_id)

    @staticmethod
    def _hash_file(path: Path) -> tuple[str, str]:
        """同一遍读盘算出 sha256 与 md5。"""
        sha = hashlib.sha256()
        md5 = hashlib.md5()
        with path.open("rb") as fh:
            while True:
                chunk = fh.read(COPY_BUFFER)
                if not chunk:
                    break
                sha.update(chunk)
                md5.update(chunk)
        return sha.hexdigest(), md5.hexdigest()
