"""PC 端命令行入口（需求 §8.4 / 设计 §5.2）。

    python a2-share/pc/a2_share.py            # 进入接收模式
    python a2-share/pc/a2_share.py --selftest # 自检
"""

from __future__ import annotations

import argparse
import json
import os
import secrets
import shutil
import signal
import socket
import sys
import threading
import time
from pathlib import Path

from . import APP_NAME, VERSION
from .clipboard import Clipboard
from .config import Config
from .history import History
from .log import Logger
from .net import local_ipv4, watch_ip
from .notify import Notifier
from .opener import open_file
from .paths import default_recv_dir, ensure_dir, state_dir, state_paths
from .qr import QrError, build_png, decode_payload, encode_payload
from .server import App, create_server
from .session import Session, short_code_for
from .uploads import UploadStore

VECTORS_PATH = Path(__file__).resolve().parents[2] / "tools" / "vectors" / "v1.json"


# --------------------------------------------------------------------- 参数
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="a2_share",
        description="a2_share · 手机 → PC 局域网直传（PC 端接收模式）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "示例：\n"
            "  a2_share                       进入接收模式，生成二维码 PNG\n"
            "  a2_share --dir D:\\inbox        指定接收目录\n"
            "  a2_share --selftest            自检（端口/凭据/二维码/落盘/剪贴板）\n"
            "  a2_share --history              查看接收历史（只记元数据）\n"
        ),
    )
    parser.add_argument("--dir", dest="recv_dir", default="", help="接收目录（默认 ~/Downloads/a2_share）")
    parser.add_argument("--port", type=int, default=0, help="监听端口（默认 8899）")
    parser.add_argument("--qr-out", dest="qr_out", default="", help="二维码 PNG 输出路径")
    parser.add_argument("--open", action="store_true", help="生成后自动打开二维码 PNG")
    parser.add_argument("--no-notify", action="store_true", help="关闭桌面通知")
    parser.add_argument("--history", action="store_true", help="查看接收历史后退出")
    parser.add_argument("--reset-identity", action="store_true", help="作废会话凭据并重新生成二维码")
    parser.add_argument("--selftest", action="store_true", help="自检")
    parser.add_argument("--bind", default="0.0.0.0", help="绑定地址（默认 0.0.0.0）")
    parser.add_argument("--ip", default="", help="二维码里写哪个 IP（默认自动挑私网 IPv4）")
    parser.add_argument("--clipboard-image", action="store_true", help="剪贴板图片同时写入系统剪贴板")
    parser.add_argument("--home", default="", help="状态目录（默认 ~/.tea_agent/a2_share）")
    parser.add_argument("--json", action="store_true", help="终端输出结构化 JSONL")
    parser.add_argument("--log-level", default="info", choices=["debug", "info", "warn", "error"])
    parser.add_argument("--version", action="version", version=f"{APP_NAME} {VERSION}")
    return parser


# ------------------------------------------------------------------- 工具
def load_vectors() -> dict:
    try:
        return json.loads(VECTORS_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def pick_ip(explicit: str = "") -> str:
    if explicit:
        return explicit
    return local_ipv4() or "127.0.0.1"


def make_payload(session: Session, ip: str, port: int, name: str) -> str:
    return encode_payload(
        secret=session.secret,
        ip=ip,
        port=port,
        issued=int(time.time()),
        name=name,
    )


def write_qr(path: Path, payload: str) -> bytes:
    data = build_png(payload)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)
    return data


def prepare(args: argparse.Namespace) -> dict:
    """加载配置、建目录，返回运行期上下文。"""
    home = state_dir(args.home or None)
    ensure_dir(home)
    paths = state_paths(home)
    config = Config.load(paths["config"])
    config.ensure_identity()
    if args.port:
        config.port = args.port
    if args.recv_dir:
        config.dir = str(Path(args.recv_dir).expanduser())
    if args.no_notify:
        config.notify = False
    if args.clipboard_image:
        config.clipboard_image = True
    config.save(paths["config"])

    recv_dir = Path(config.dir).expanduser() if config.dir else default_recv_dir()
    ensure_dir(recv_dir)
    ensure_dir(recv_dir / ".a2-incoming")
    ensure_dir(home / "scripts")
    return {
        "home": home,
        "paths": paths,
        "config": config,
        "recv_dir": recv_dir,
        "scripts": home / "scripts",
    }


# ----------------------------------------------------------------- 接收模式
def run_serve(args: argparse.Namespace) -> int:
    ctx = prepare(args)
    home: Path = ctx["home"]
    paths = ctx["paths"]
    config: Config = ctx["config"]
    recv_dir: Path = ctx["recv_dir"]

    logger = Logger(paths["log"], args.log_level, json_mode=args.json)
    logger.info("starting", version=VERSION, port=config.port)

    session = Session()
    uploads = UploadStore(recv_dir, home, logger)
    uploads.recover()
    clipboard = Clipboard(logger, ctx["scripts"])
    notifier = Notifier(logger, ctx["scripts"])
    notifier.enabled = config.notify
    history = History(paths["history"])

    qr_path = Path(args.qr_out).expanduser() if args.qr_out else paths["qr"]
    ip = pick_ip(args.ip)

    def current_payload() -> str:
        return make_payload(session, ip, config.port, config.name)

    def write_qr_now() -> None:
        try:
            write_qr(qr_path, current_payload())
        except (OSError, QrError) as exc:
            logger.error("qr_write_failed", reason=str(exc))

    try:
        app = App(
            session=session,
            uploads=uploads,
            clipboard=clipboard,
            notifier=notifier,
            history=history,
            logger=logger,
            pc_id=config.pc_id,
            pc_name=config.name,
            recv_dir=recv_dir,
            clipboard_image=config.clipboard_image,
            notify_enabled=config.notify,
        )
        app.on_paired = write_qr_now
        server = create_server(app, args.bind, config.port)
    except OSError as exc:
        logger.error("listen_failed", reason=str(exc), port=config.port)
        print(f"无法监听端口 {config.port}：{exc}", file=sys.stderr)
        print(f"提示：端口可能被占用，可以用 --port 换一个端口。", file=sys.stderr)
        return 2

    write_qr_now()
    print(f"二维码 PNG：{qr_path}")
    print(f"监听地址：{ip}:{config.port}")
    print(f"配对短码：{session.short_code}")
    print(f"状态目录：{home}")
    print(f"接收目录：{recv_dir}")
    print("按 Ctrl-C 退出。")
    if args.open:
        open_file(qr_path, logger)

    stop_event = threading.Event()
    watch_thread = watch_ip(ip, lambda new_ip: _on_ip_change(new_ip, qr_path, session, config, logger), logger, stop_event=stop_event)

    def shutdown(*_args) -> None:
        stop_event.set()
        threading.Thread(target=server.shutdown, daemon=True).start()

    try:
        signal.signal(signal.SIGINT, shutdown)
        signal.signal(signal.SIGTERM, shutdown)
    except (ValueError, OSError):  # pragma: no cover - 非主线程
        pass

    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:  # pragma: no cover
        pass
    finally:
        stop_event.set()
        server.server_close()
        logger.info("stopped")
    return 0


def _on_ip_change(new_ip: str, qr_path: Path, session: Session, config: Config, logger: Logger) -> None:
    """本机 IP 变了 → 重写二维码并提示重扫（FR-C14）。"""
    try:
        payload = make_payload(session, new_ip, config.port, config.name)
        write_qr(qr_path, payload)
        print(f"本机 IP 已变为 {new_ip}，二维码已更新，请重新扫码。")
        logger.warn("qr_refreshed", peer=new_ip)
    except (OSError, QrError) as exc:
        logger.error("qr_write_failed", reason=str(exc))


# ------------------------------------------------------------------- 历史
def run_history(args: argparse.Namespace) -> int:
    ctx = prepare(args)
    paths = ctx["paths"]
    history = History(paths["history"])
    items = history.items(100)
    if args.json:
        for item in items:
            print(json.dumps(item, ensure_ascii=False))
        return 0
    if not items:
        print("（还没有接收记录）")
        return 0
    print(f"{'时间':<20}{'来源':<16}{'类型':<10}{'名称':<28}{'大小':>10}")
    for item in items:
        stamp = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(item.get("ts", 0)))
        print(
            f"{stamp:<20}{str(item.get('device', ''))[:15]:<16}"
            f"{str(item.get('kind', ''))[:9]:<10}{str(item.get('name', ''))[:27]:<28}"
            f"{str(item.get('size', 0)):>10}"
        )
    return 0


# ---------------------------------------------------------- 重置身份
def run_reset_identity(args: argparse.Namespace) -> int:
    ctx = prepare(args)
    paths = ctx["paths"]
    config: Config = ctx["config"]
    logger = Logger(paths["log"], args.log_level, json_mode=args.json)
    session = Session()
    session.rotate(revoke=True)
    ip = pick_ip(args.ip)
    qr_path = Path(args.qr_out).expanduser() if args.qr_out else paths["qr"]
    write_qr(qr_path, make_payload(session, ip, config.port, config.name))
    print(f"已作废旧的会话凭据，并生成新的二维码：{qr_path}")
    print(f"配对短码：{session.short_code}")
    logger.info("identity_reset", generation=session.generation)
    return 0


# ------------------------------------------------------------------- 自检
def run_selftest(args: argparse.Namespace) -> int:
    """六项自检（DESIGN.md §10.4）。"""
    ctx = prepare(args)
    home: Path = ctx["home"]
    paths = ctx["paths"]
    config: Config = ctx["config"]
    recv_dir: Path = ctx["recv_dir"]
    logger = Logger(None, "error", json_mode=args.json)

    checks: list[tuple[str, bool, str]] = []

    def record(name: str, ok: bool, detail: str = "") -> None:
        checks.append((name, ok, detail))
        if args.json:
            print(json.dumps({"check": name, "ok": ok, "detail": detail}, ensure_ascii=False))
        else:
            print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" —— {detail}" if detail else ""))

    # 1) 目录可写 + 剩余空间
    try:
        probe = home / ".selftest.tmp"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        free = shutil.disk_usage(recv_dir).free
        ok = free >= 200 * 1024 * 1024
        record("目录可写且剩余空间 ≥ 200 MB", ok, f"{free // (1024 * 1024)} MB")
    except OSError as exc:
        record("目录可写且剩余空间 ≥ 200 MB", False, str(exc))

    # 2) 端口可监听
    probe_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    probe_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        probe_socket.bind((args.bind, config.port))
        record("端口可监听", True, f"{args.bind}:{config.port}")
    except OSError as exc:
        record("端口可监听", False, f"端口 {config.port} 被占用：{exc}")
    finally:
        probe_socket.close()

    # 3) 载荷编解码 + 短码与黄金样本一致
    vectors = load_vectors()
    ok = True
    detail = ""
    try:
        qr_vectors = vectors.get("qr", {})
        for case in qr_vectors.get("valid", []):
            info = decode_payload(case["payload"])
            expect = case["expect"]
            if info.secret != expect["secret"] or info.ip != expect["ip"]:
                raise ValueError(f"解析不一致: {case['payload']}")
            if info.port != expect["port"] or info.issued != expect["issued"]:
                raise ValueError(f"端口/时间戳不一致: {case['payload']}")
            if (info.name or None) != (expect.get("name") or None):
                raise ValueError(f"名字不一致: {case['payload']}")
            if len(case["payload"]) != expect["length"]:
                raise ValueError(
                    f"长度不一致: {len(case['payload'])} != {expect['length']}"
                )
        for case in qr_vectors.get("invalid", []):
            try:
                decode_payload(case["payload"])
            except QrError as exc:
                if exc.code != case["error"]:
                    raise ValueError(
                        f"错误码不一致: {case['payload']} → {exc.code} != {case['error']}"
                    )
            else:
                raise ValueError(f"应当拒绝: {case['payload']}")
        code_vector = vectors.get("short_code", {})
        if code_vector:
            computed = short_code_for(code_vector["secret"])
            if computed != code_vector["expect"]:
                raise ValueError(f"短码不一致: {computed} != {code_vector['expect']}")
        record("载荷编解码与短码符合黄金样本", True, "QR 向量 + 短码")
    except (KeyError, ValueError, QrError) as exc:
        ok = False
        detail = str(exc)
        record("载荷编解码与短码符合黄金样本", ok, detail)

    # 4) 二维码矩阵 + PNG 生成
    try:
        session = Session()
        payload = make_payload(session, "192.168.1.23", config.port, config.name)
        data = build_png(payload)
        header_ok = data[:8] == b"\x89PNG\r\n\x1a\n" and b"IHDR" in data[:32]
        record("二维码 PNG 生成", header_ok, f"{len(data)} 字节")
    except (OSError, QrError, ValueError) as exc:
        record("二维码 PNG 生成", False, str(exc))

    # 5) 回环起临时服务：配对 → 传 1 KB → 校验 sha256 → 定名
    try:
        ok, detail = _selftest_roundtrip(home, recv_dir, logger, config)
        record("配对 → 上传 1 KB → 校验 sha256 → 定名", ok, detail)
    except Exception as exc:  # noqa: BLE001
        record("配对 → 上传 1 KB → 校验 sha256 → 定名", False, str(exc))

    # 6) 剪贴板 / 通知适配器可用性（只探测）
    clipboard = Clipboard(logger, ctx["scripts"])
    probe = clipboard.probe()
    record("剪贴板适配器可用（只探测）", bool(probe.get("available")), probe.get("reason", ""))

    failed = [name for name, ok, _ in checks if not ok]
    if args.json:
        print(json.dumps({"summary": "ok" if not failed else "failed", "failed": failed}, ensure_ascii=False))
    else:
        print()
        print(f"自检结果：{len(checks) - len(failed)}/{len(checks)} 通过")
        for name in failed:
            print(f"  失败：{name}")
    return 0 if not failed else 1


def _selftest_roundtrip(
    home: Path, recv_dir: Path, logger: Logger, config: Config
) -> tuple[bool, str]:
    """在回环上跑一遍最小闭环。"""
    import hashlib
    import http.client

    from .server import App, create_server
    from .session import Session

    session = Session()
    uploads = UploadStore(recv_dir, home, logger)
    uploads.recover()
    clipboard = Clipboard(logger, home / "scripts")
    notifier = Notifier(logger, home / "scripts")
    notifier.enabled = False
    app = App(
        session=session,
        uploads=uploads,
        clipboard=clipboard,
        notifier=notifier,
        history=History(home / "history.jsonl"),
        logger=logger,
        pc_id="selftest",
        pc_name="selftest",
        recv_dir=recv_dir,
    )
    server = create_server(app, "127.0.0.1", 0)
    port = server.server_address[1]
    # 每次自检用独立的 upload_id：避免上次残留的 .part 让 init 走「续传」分支
    upload_id = "selftest-" + secrets.token_hex(6)
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.1})
    thread.daemon = True
    thread.start()
    try:
        payload = b"a2_share selftest payload\n" * 32
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        conn.request(
            "POST",
            "/v1/pair",
            json.dumps({"v": 1, "method": "qr", "secret": session.secret, "device": {"name": "selftest"}}),
            {"Content-Type": "application/json"},
        )
        response = conn.getresponse()
        body = json.loads(response.read().decode("utf-8"))
        token = body.get("token")
        if response.status != 200 or not token:
            return False, f"配对失败：{response.status}"
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        conn.request(
            "POST",
            "/v1/uploads",
            json.dumps(
                {
                    "v": 1,
                    "upload_id": upload_id,
                    "kind": "file",
                    "name": "selftest.txt",
                    "size": len(payload),
                    "mime": "text/plain",
                }
            ),
            headers,
        )
        response = conn.getresponse()
        json.loads(response.read().decode("utf-8"))
        if response.status != 200:
            return False, f"init 失败：{response.status}"
        conn.request(
            "PUT",
            f"/v1/uploads/{upload_id}?offset=0",
            payload,
            {**headers, "Content-Type": "application/octet-stream"},
        )
        response = conn.getresponse()
        json.loads(response.read().decode("utf-8"))
        if response.status != 200:
            return False, f"上传失败：{response.status}"
        conn.request(
            "POST",
            f"/v1/uploads/{upload_id}/finish",
            json.dumps({"v": 1, "sha256": hashlib.sha256(payload).hexdigest()}),
            headers,
        )
        response = conn.getresponse()
        result = json.loads(response.read().decode("utf-8"))
        conn.close()
        if response.status != 200:
            return False, f"finish 失败：{response.status} {result}"
        if result.get("sha256") != hashlib.sha256(payload).hexdigest():
            return False, "sha256 不一致"
        if result.get("md5") != hashlib.md5(payload).hexdigest():
            return False, "md5 不一致"
        # 自检产物不留在接收目录里
        try:
            (recv_dir / str(result.get("name"))).unlink(missing_ok=True)
        except OSError:
            pass
        return True, f"落盘为 {result.get('name')}（校验 sha256/md5 一致，已清理）"
    finally:
        server.shutdown()
        server.server_close()


# ------------------------------------------------------------------- 入口
def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.selftest:
            return run_selftest(args)
        if args.history:
            return run_history(args)
        if args.reset_identity:
            return run_reset_identity(args)
        return run_serve(args)
    except KeyboardInterrupt:  # pragma: no cover
        return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
