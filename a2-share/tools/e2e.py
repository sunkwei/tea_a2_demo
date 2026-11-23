#!/usr/bin/env python3
"""a2_share · PC 端集成闭环（DESIGN.md §10.1 的 L3 层）。

    python a2-share/tools/e2e.py

在临时目录里起一个真服务，按顺序跑完这些场景：
配对 → 上传 → 续传 → 冲突 → 未授权 → 超限 → 同名 → 剪贴板降级 → 幂等 → PC 重启续传。

退出码 0 = 全通过，1 = 有失败。
"""

from __future__ import annotations

import hashlib
import http.client
import json
import shutil
import sys
import tempfile
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pc"))

from a2share.clipboard import Clipboard  # noqa: E402
from a2share.history import History  # noqa: E402
from a2share.log import Logger  # noqa: E402
from a2share.notify import Notifier  # noqa: E402
from a2share.server import App, create_server  # noqa: E402
from a2share.session import Session  # noqa: E402
from a2share.uploads import UploadStore  # noqa: E402

RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    RESULTS.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" —— {detail}" if detail else ""))


class FailingClipboard:
    """模拟「系统剪贴板不可用」→ 触发降级存文件。"""

    def write_text(self, text: str) -> tuple[bool, str]:
        return False, "未找到 xclip/wl-copy"

    def write_image(self, path: Path) -> tuple[bool, str]:
        return False, "未找到 xclip/wl-copy"

    def probe(self) -> dict:
        return {"available": False, "reason": "未找到 xclip/wl-copy"}


class Client:
    """极简 HTTP 客户端（只依赖标准库）。"""

    def __init__(self, port: int) -> None:
        self.port = port
        self.token: str | None = None

    def raw(
        self,
        method: str,
        path: str,
        body: bytes | None = None,
        headers: dict[str, str] | None = None,
        auth: bool = True,
    ) -> tuple[int, dict]:
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=20)
        head = {"Content-Type": "application/json"}
        if auth and self.token:
            head["Authorization"] = f"Bearer {self.token}"
        head.update(headers or {})
        conn.request(method, path, body, head)
        response = conn.getresponse()
        raw = response.read()
        conn.close()
        try:
            return response.status, json.loads(raw.decode("utf-8"))
        except ValueError:
            return response.status, {"raw": raw.decode("utf-8", "replace")}

    def json(self, method: str, path: str, payload: dict | None = None, **kwargs):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
        return self.raw(method, path, body, **kwargs)


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="a2share-e2e-"))
    home = tmp / "home"
    recv = tmp / "recv"
    home.mkdir()
    recv.mkdir()
    logger = Logger(home / "a2_share.log", "info")
    session = Session()
    uploads = UploadStore(recv, home, logger)
    uploads.recover()
    app = App(
        session=session,
        uploads=uploads,
        clipboard=FailingClipboard(),
        notifier=Notifier(logger, home / "scripts"),
        history=History(home / "history.jsonl"),
        logger=logger,
        pc_id="e2e-pc",
        pc_name="E2E-PC",
        recv_dir=recv,
        notify_enabled=False,
    )
    server = create_server(app, "127.0.0.1", 0)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.05})
    thread.daemon = True
    thread.start()
    client = Client(port)
    try:
        run_scenarios(client, session, recv, home, logger, uploads)
    finally:
        server.shutdown()
        server.server_close()
        shutil.rmtree(tmp, ignore_errors=True)

    failed = [name for name, ok, _ in RESULTS if not ok]
    print()
    print(f"集成闭环：{len(RESULTS) - len(failed)}/{len(RESULTS)} 通过")
    for name in failed:
        print(f"  失败：{name}")
    return 0 if not failed else 1


def run_scenarios(
    client: Client,
    session: Session,
    recv: Path,
    home: Path,
    logger: Logger,
    uploads: UploadStore,
) -> None:
    # ---------------------------------------------------------------- 探活
    status, data = client.json("GET", "/v1/hello", auth=False)
    check("hello 无需认证可访问", status == 200 and data.get("sid") == session.sid, f"status={status}")

    # ---------------------------------------------------------------- 配对
    status, data = client.json(
        "POST", "/v1/pair", {"v": 1, "method": "qr", "secret": "A" * 16}, auth=False
    )
    check(
        "错误 secret 被拒绝",
        status == 401 and data.get("error", {}).get("code") == "bad_secret",
        f"status={status}",
    )
    old_secret = session.secret
    status, data = client.json(
        "POST",
        "/v1/pair",
        {"v": 1, "method": "qr", "secret": old_secret, "device": {"name": "e2e-phone"}},
        auth=False,
    )
    check(
        "正确 secret 配对成功并拿到 token",
        status == 200 and len(data.get("token", "")) == 64,
        f"status={status}",
    )
    client.token = data.get("token")
    check("配对后二维码凭据已轮换", session.secret != old_secret)

    status, data = client.json(
        "POST", "/v1/pair", {"v": 1, "method": "qr", "secret": old_secret}, auth=False
    )
    check("旧 secret 不能再配对", status == 401)

    # ------------------------------------------------------------ 未授权
    status, data = client.raw("GET", "/v1/status", auth=False)
    check("未授权访问 status 被拒", status == 401, f"status={status}")
    status, data = client.json(
        "POST",
        "/v1/uploads",
        {"v": 1, "upload_id": "u-unauth", "kind": "file", "name": "x.bin", "size": 4},
        auth=False,
    )
    check(
        "未授权上传被拒且不落盘",
        status == 401 and not list(recv.glob("*.bin")),
        f"status={status}",
    )

    # -------------------------------------------------------------- 上传
    payload = ("a2_share 集成测试内容 " * 100).encode("utf-8")
    client.json(
        "POST",
        "/v1/uploads",
        {
            "v": 1,
            "upload_id": "u1",
            "kind": "file",
            "name": "报告 v2.txt",
            "size": len(payload),
            "mime": "text/plain",
        },
    )
    status, data = client.raw(
        "PUT",
        "/v1/uploads/u1?offset=0",
        payload,
        {"Content-Type": "application/octet-stream"},
    )
    check("分块上传成功", status == 200 and data.get("received") == len(payload), f"status={status}")
    status, data = client.json(
        "POST", "/v1/uploads/u1/finish", {"v": 1, "sha256": hashlib.sha256(payload).hexdigest()}
    )
    landed = recv / data.get("name", "")
    check(
        "finish 落盘且 sha256/md5 一致",
        status == 200
        and landed.exists()
        and landed.read_bytes() == payload
        and data.get("sha256") == hashlib.sha256(payload).hexdigest()
        and data.get("md5") == hashlib.md5(payload).hexdigest(),
        f"status={status} name={data.get('name')}",
    )

    # -------------------------------------------------------------- 同名
    client.json(
        "POST",
        "/v1/uploads",
        {"v": 1, "upload_id": "u2", "kind": "file", "name": "报告 v2.txt", "size": len(payload)},
    )
    client.raw(
        "PUT",
        "/v1/uploads/u2?offset=0",
        payload,
        {"Content-Type": "application/octet-stream"},
    )
    status, data = client.json("POST", "/v1/uploads/u2/finish", {"v": 1, "sha256": None})
    check(
        "同名文件自动改名不覆盖",
        status == 200 and data.get("name") == "报告 v2 (1).txt" and (recv / "报告 v2.txt").exists(),
        f"name={data.get('name')}",
    )

    # -------------------------------------------------------------- 续传
    half = len(payload) // 2
    client.json(
        "POST",
        "/v1/uploads",
        {"v": 1, "upload_id": "u3", "kind": "file", "name": "resume.bin", "size": len(payload)},
    )
    client.raw(
        "PUT",
        "/v1/uploads/u3?offset=0",
        payload[:half],
        {"Content-Type": "application/octet-stream"},
    )
    status, data = client.json(
        "POST",
        "/v1/uploads",
        {"v": 1, "upload_id": "u3", "kind": "file", "name": "resume.bin", "size": len(payload)},
    )
    check(
        "重新 init 能拿到续传点",
        status == 200 and data.get("received") == half and data.get("resume") is True,
        f"received={data.get('received')}",
    )
    client.raw(
        "PUT",
        f"/v1/uploads/u3?offset={half}",
        payload[half:],
        {"Content-Type": "application/octet-stream"},
    )
    status, data = client.json("POST", "/v1/uploads/u3/finish", {"v": 1, "sha256": None})
    check(
        "续传完成后内容一致",
        status == 200 and (recv / data.get("name", "")).read_bytes() == payload,
        f"status={status}",
    )

    # -------------------------------------------------------------- 冲突
    client.json(
        "POST",
        "/v1/uploads",
        {"v": 1, "upload_id": "u4", "kind": "file", "name": "conflict.bin", "size": 64},
    )
    client.raw(
        "PUT",
        "/v1/uploads/u4?offset=0",
        b"x" * 16,
        {"Content-Type": "application/octet-stream"},
    )
    status, data = client.raw(
        "PUT",
        "/v1/uploads/u4?offset=0",
        b"x" * 16,
        {"Content-Type": "application/octet-stream"},
    )
    check(
        "offset 冲突返回 409 与服务端 received",
        status == 409
        and data.get("error", {}).get("code") == "offset_conflict"
        and data.get("error", {}).get("received") == 16,
        f"status={status}",
    )

    # -------------------------------------------------------------- 超限
    status, data = client.json(
        "POST",
        "/v1/uploads",
        {
            "v": 1,
            "upload_id": "u5",
            "kind": "file",
            "name": "huge.bin",
            "size": 5 * 1024 * 1024 * 1024,
        },
    )
    check(
        "超过 4 GiB 上限被拒",
        status == 413 and data.get("error", {}).get("code") == "too_large",
        f"status={status}",
    )

    # ------------------------------------------------------- 剪贴板降级
    secret_text = "机密剪贴板内容-e2e"
    status, data = client.json(
        "POST", "/v1/clipboard/text", {"v": 1, "text": secret_text}
    )
    saved = data.get("saved_as") or ""
    log_path = home / "a2_share.log"
    log_text = log_path.read_text(encoding="utf-8") if log_path.exists() else ""
    check(
        "剪贴板写失败时降级存文件且不写日志正文",
        status == 200
        and data.get("clipboard") == "degraded"
        and saved.endswith(".txt")
        and (recv / saved).read_text(encoding="utf-8") == secret_text
        and secret_text not in log_text,
        f"saved_as={saved}",
    )

    # ------------------------------------------------ 剪贴板 Unicode 逐字
    unicode_text = "a2_share 剪贴板测试 🐱 emoji"
    status, data = client.json(
        "POST", "/v1/clipboard/text", {"v": 1, "text": unicode_text}
    )
    ok = status == 200 and data.get("chars") == len(unicode_text)
    detail = f"chars={data.get('chars')}（期望 {len(unicode_text)}）"
    check("剪贴板接口收到的 Unicode 文本字符数正确", ok, detail)

    # 平台适配器直测：e2e 里的 clipboard 是假的（会走降级），这里测真的那条路
    from a2share.clipboard import Clipboard
    from a2share.log import NullLogger

    real = Clipboard(NullLogger(), recv / "scripts")
    wrote, reason = real.write_text(unicode_text)
    detail2 = "写入=" + str(wrote)
    if wrote and sys.platform == "win32":
        import subprocess
        out = subprocess.run(
            ["powershell", "-NoProfile", "-Command", "Get-Clipboard"],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30,
        )
        got = out.stdout.strip()
        detail2 += "；系统剪贴板=" + repr(got) + "；一致=" + str(got == unicode_text)
        wrote = wrote and got == unicode_text
    elif wrote:
        detail2 += "（非 Windows，跳过读回比对）"
    check("剪贴板 Unicode 文本逐字一致（中文 + emoji）", wrote, detail2)

    # -------------------------------------------------------------- 幂等
    status, again = client.json("POST", "/v1/uploads/u1/finish", {"v": 1, "sha256": None})
    check(
        "重复 finish 返回同一结果且不产生第二份文件",
        status == 200 and again.get("name") == "报告 v2.txt" and again.get("dedup") is True,
        f"status={status}",
    )
    check(
        "接收目录里没有重复文件",
        len(list(recv.glob("报告 v2*.txt"))) == 2,
        str(sorted(p.name for p in recv.glob("报告 v2*.txt"))),
    )

    # ------------------------------------------------- PC 重启后续传
    fresh = UploadStore(recv, home, logger)
    fresh.recover()
    status, data = client.json(
        "POST",
        "/v1/uploads",
        {"v": 1, "upload_id": "u6", "kind": "file", "name": "restart.bin", "size": 32},
    )
    client.raw(
        "PUT",
        "/v1/uploads/u6?offset=0",
        b"y" * 10,
        {"Content-Type": "application/octet-stream"},
    )
    restarted = UploadStore(recv, home, logger)
    restarted.recover()
    info = restarted.query("u6")
    check(
        "PC 重启后 .part 续传点仍在",
        info["received"] == 10,
        f"received={info['received']}",
    )

    # -------------------------------------------------------------- 历史
    status, data = client.json("GET", "/v1/history?limit=10")
    check(
        "历史只记元数据",
        status == 200 and len(data.get("items", [])) >= 2 and "text" not in data["items"][0],
        f"items={len(data.get('items', []))}",
    )


if __name__ == "__main__":
    sys.exit(main())
