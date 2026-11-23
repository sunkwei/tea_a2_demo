#!/usr/bin/env python3
"""a2_share · 真机端到端验收（adb 驱动，Android 10~16 通用）。

    python a2-share/tools/device_e2e.py [--serial <设备号>]

脚本会：
  1. 在本机起一个 PC 端服务（临时目录、端口 8899）；
  2. 用 adb 把手机唤醒、点亮屏幕（息屏时 uiautomator dump 会是空的）；
  3. 用**短码**配对（不依赖相机扫码），地址从命令行给或自动取本机私网 IP；
  4. 走**系统分享面板**分享一个文件 → 确认条 → PC 落盘，md5 比对；
  5. 分享一段文字 → PC 剪贴板内容逐字比对；
  6. 顺带验证：同名不覆盖、离线缓存后重扫自动补发、切蜂窝不外发、离开 Wi-Fi 需重扫。

依赖：adb（在 PATH 或 ANDROID_HOME/platform-tools 里）、一个已安装 a2_share 的真机。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENTRY = ROOT / "pc" / "a2_share.py"
PKG = "com.tea.a2share"
DEFAULT_PORT = 8899
RESULTS: list[tuple[str, bool, str]] = []


# --------------------------------------------------------------------- 工具
def find_adb() -> str:
    found = shutil.which("adb")
    if found:
        return found
    sdk = Path.home() / "AppData/Local/Android/Sdk/platform-tools/adb.exe"
    if sdk.exists():
        return str(sdk)
    raise SystemExit("找不到 adb：把它加进 PATH，或设置 ANDROID_HOME")


def adb_path() -> str:
    global ADB
    try:
        return ADB
    except NameError:
        ADB = find_adb()
        return ADB


SERIAL = ""


def adb(*args: str, timeout: int = 120) -> str:
    prefix = ["-s", SERIAL] if SERIAL else []
    proc = subprocess.run(
        [adb_path(), *prefix, *args], capture_output=True, text=True, encoding="utf-8",
        errors="replace", timeout=timeout,
    )
    return proc.stdout + proc.stderr


def dump() -> ET.Element:
    adb("shell", "uiautomator", "dump", "/sdcard/ui.xml")
    raw = adb("shell", "cat", "/sdcard/ui.xml")
    raw = raw[raw.find("<?xml"):] if "<?xml" in raw else raw
    try:
        return ET.fromstring(raw)
    except ET.ParseError:
        return ET.Element("empty")


def center(node: ET.Element) -> tuple[int, int]:
    match = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.get("bounds", ""))
    x1, y1, x2, y2 = (int(value) for value in match.groups())
    return (x1 + x2) // 2, (y1 + y2) // 2


def wait_for(text: str, timeout: float = 12.0) -> list[ET.Element]:
    deadline = time.time() + timeout
    while time.time() < deadline:
        nodes = [
            node for node in dump().iter("node")
            if text in ((node.get("text") or "") + (node.get("content-desc") or ""))
        ]
        exact = [node for node in nodes if (node.get("text") or "") == text]
        if exact:
            return exact
        time.sleep(1.0)
    return []


def tap_node(node: ET.Element, label: str = "") -> None:
    x, y = center(node)
    print(f"   tap {label!r} @ ({x},{y})")
    adb("shell", "input", "tap", str(x), str(y))
    time.sleep(2.0)


def tap_text(text: str, timeout: float = 12.0) -> bool:
    nodes = wait_for(text, timeout=timeout)
    if not nodes:
        print(f"   !! 找不到「{text}」")
        return False
    tap_node(nodes[0], text)
    return True


def wake() -> None:
    """唤醒 + 解锁 + 常亮：息屏时 uiautomator dump 是空的，脚本会找不到控件。"""
    adb("shell", "svc", "power", "stayon", "true")
    adb("shell", "input", "keyevent", "KEYCODE_WAKEUP")
    adb("shell", "wm", "dismiss-keyguard")
    time.sleep(1.0)


def field_values() -> list[str]:
    return [
        node.get("text", "")
        for node in dump().iter("node")
        if node.get("class") == "android.widget.EditText"
    ]


def fill_field(index: int, value: str, label: str) -> bool:
    """填输入框并**回读校验**。

    实测：adb 的 input text 会被输入法自动纠错打乱（`172.16.1.219` → `1.7216.1.219`），
    所以必须打完回读，不对就清空重输。
    """
    for _ in range(3):
        nodes = [n for n in dump().iter("node") if n.get("class") == "android.widget.EditText"]
        if len(nodes) <= index:
            print(f"   !! 没有第 {index} 个输入框")
            return False
        x, y = center(nodes[index])
        adb("shell", "input", "tap", str(x), str(y))
        time.sleep(1.4)
        adb("shell", "input", "keyevent", "KEYCODE_MOVE_END")
        for _ in range(40):
            adb("shell", "input", "keyevent", "KEYCODE_DEL")
        time.sleep(0.4)
        for start in range(0, len(value), 4):
            adb("shell", "input", "text", value[start : start + 4])
            time.sleep(0.9)
        time.sleep(1.4)
        values = field_values()
        if len(values) > index and values[index] == value:
            print(f"   {label} 输入正确：{value}")
            return True
        print(f"   {label} 被输入法打乱（{values[index] if len(values) > index else ''}），清空重试")
        time.sleep(1.2)
    return False


def check(name: str, ok: bool, detail: str = "") -> None:
    RESULTS.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" —— {detail}" if detail else ""))


def local_ip() -> str:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("192.0.2.1", 9))  # 只查路由，不发包
        return sock.getsockname()[0]
    finally:
        sock.close()


def pick_media_image() -> tuple[str, str, str] | None:
    """从 MediaStore 挑一张图片（真实分享流程用得到）。"""
    out = adb(
        "shell", "content", "query", "--uri", "content://media/external/images/media",
        "--projection", "_id:_display_name:_data",
    )
    for line in out.splitlines():
        if "Row:" not in line:
            continue
        match = re.search(r"_id=(\d+).*?_display_name=(.*?), _data=(.*)$", line)
        if not match:
            continue
        media_id, name, data = match.group(1), match.group(2), match.group(3)
        if name.lower().endswith((".jpg", ".jpeg", ".png")) and " " not in name:
            return media_id, name, data
    return None


class PcServer:
    """PC 端服务（可重启，用于离线缓存场景）。"""

    def __init__(self, home: Path, recv: Path, port: int) -> None:
        self.home = home
        self.recv = recv
        self.port = port
        self.proc: subprocess.Popen | None = None
        self.short_code = ""

    def start(self) -> str:
        self.proc = subprocess.Popen(
            [sys.executable, "-u", str(ENTRY), "--home", str(self.home),
             "--dir", str(self.recv), "--port", str(self.port), "--no-notify"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            encoding="utf-8", errors="replace",
        )
        deadline = time.time() + 20
        while time.time() < deadline:
            line = self.proc.stdout.readline()
            if not line:
                break
            match = re.search(r"配对短码：(\d{6})", line)
            if match:
                self.short_code = match.group(1)
                break
        return self.short_code

    def stop(self) -> None:
        if self.proc:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.proc.kill()
            self.proc = None

    def files(self) -> list[Path]:
        return [p for p in sorted(self.recv.rglob("*")) if p.is_file()]


def share_via_system_sheet(media_id: str) -> bool:
    """系统分享面板 → 选 a2_share → 确认条「发送」。"""
    uri = f"content://media/external/images/media/{media_id}"
    adb(
        "shell", "am", "start", "-a", "android.intent.action.SEND",
        "-t", "image/jpeg", "--eu", "android.intent.extra.STREAM", uri,
    )
    time.sleep(4)
    for _ in range(5):
        hits = [
            node for node in dump().iter("node")
            if "a2" in ((node.get("text") or "") + (node.get("content-desc") or "")).lower()
        ]
        if hits:
            tap_node(hits[0], "a2_share")
            time.sleep(3)
            break
        adb("shell", "input", "swipe", "1000", "1600", "200", "1600", "300")
        time.sleep(1.5)
    else:
        print("   !! 分享面板里没找到 a2_share")
        return False
    return tap_text("发送")


def pair(short_code: str, address: str) -> bool:
    """短码配对（AC-15 的兜底路径，也是自动化里唯一好驱动的路径）。"""
    wake()
    adb("shell", "am", "force-stop", PKG)
    time.sleep(1)
    adb("shell", "am", "start", "-n", f"{PKG}/.ui.MainActivity")
    time.sleep(3)
    tap_text("扫码连接 PC")
    tap_text("输入短码")
    if not fill_field(0, short_code, "短码"):
        return False
    if not fill_field(1, address, "PC 地址"):
        return False
    adb("shell", "input", "keyevent", "KEYCODE_BACK")
    time.sleep(1)
    tap_text("发送")
    time.sleep(4)
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="a2_share 真机端到端验收")
    parser.add_argument("--serial", default="", help="设备号（多设备时指定）")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--ip", default="", help="PC 地址（默认自动取本机私网 IP）")
    parser.add_argument("--skip-file", action="store_true", help="跳过文件分享（只测剪贴板）")
    args = parser.parse_args()

    global ADB, SERIAL
    ADB = find_adb()
    SERIAL = args.serial
    if SERIAL:
        print(f"  设备：{SERIAL}")

    address = args.ip or local_ip()
    print(f"  PC 地址：{address}:{args.port}")

    picked = None if args.skip_file else pick_media_image()
    digest = ""
    if picked:
        media_id, display_name, data_path = picked
        local = Path(tempfile.gettempdir()) / "a2-share-src"
        subprocess.run(
            [adb_path(), *(["-s", SERIAL] if SERIAL else []), "pull", data_path, str(local)],
            capture_output=True, timeout=180,
        )
        if local.exists():
            digest = hashlib.md5(local.read_bytes()).hexdigest()
            print(f"  测试图片：{display_name}（{local.stat().st_size} 字节，md5={digest}）")
        else:
            picked = None

    tmp = Path(tempfile.mkdtemp(prefix="a2share-device-"))
    home = tmp / "home"
    recv = tmp / "recv"
    home.mkdir()
    recv.mkdir()
    pc = PcServer(home, recv, args.port)
    logcat_path = tmp / "device_logcat.txt"
    logcat = subprocess.Popen(
        [adb_path(), *(["-s", SERIAL] if SERIAL else []),
         "logcat", "-s", "a2share:V"],
        stdout=logcat_path.open("w", encoding="utf-8", errors="replace"),
        stderr=subprocess.STDOUT,
    )
    try:
        short_code = pc.start()
        print(f"  [PC] 短码 = {short_code}")
        if not pair(short_code, address):
            print("!! 配对失败")
            return 1

        # ── 文件分享（系统分享面板 → a2_share）
        if picked:
            media_id = picked[0]
            share_via_system_sheet(media_id)
            time.sleep(8)
            landed = [p for p in pc.files() if digest and hashlib.md5(p.read_bytes()).hexdigest() == digest]
            check("AC-01/AC-02 文件经分享面板落到 PC 且 md5 一致", bool(landed),
                  f"收到：{[p.name for p in pc.files()]}")

            # 同名不覆盖
            share_via_system_sheet(media_id)
            time.sleep(8)
            names = [p.name for p in pc.files()]
            check("AC-06 同名文件自动改名不覆盖",
                  any(" (1)" in name for name in names), f"收到：{names}")

        # ── 剪贴板
        # 注意：adb 把非 ASCII 文本传给手机 shell 时会在第一个非 ASCII 字符处截断，
        # 所以真机链路用 ASCII 文本；中文/emoji 的逐字一致由 PC 侧 e2e.py 覆盖。
        text = "a2_share-clipboard-test-20261123"
        adb(
            "shell", "am", "start", "-n", f"{PKG}/.ui.ShareActivity",
            "-a", "android.intent.action.SEND", "-t", "text/plain",
            "--es", "android.intent.extra.TEXT", text,
        )
        time.sleep(3)
        tap_text("发送")
        time.sleep(6)
        # 剪贴板走 /v1/clipboard/text，不进 history.jsonl；看 PC 日志 + 读回系统剪贴板
        pc_log = home / "a2_share.log"
        logged = pc_log.exists() and "clipboard_received" in pc_log.read_text(encoding="utf-8")
        clip = ""
        if sys.platform == "win32":
            proc = subprocess.run(
                ["powershell", "-NoProfile", "-Command", "Get-Clipboard"],
                capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30,
            )
            clip = proc.stdout.strip()
        check("AC-09 剪贴板文字发到 PC（PC 日志 + 系统剪贴板）",
              logged and (not clip or clip == text),
              f"PC 日志有 clipboard_received={logged}；系统剪贴板={clip[:40]!r}")
        if pc_log.exists():
            print("  [PC] 日志尾部：")
            for line in pc_log.read_text(encoding="utf-8").splitlines()[-5:]:
                print("      " + line)
            # 离线缓存 → 重扫后自动补发
            pc.stop()
            time.sleep(2)
            before = len(pc.files())
            share_via_system_sheet(media_id)
            time.sleep(6)
            new_code = pc.start()
            print(f"  [PC] 已重启（新短码 {new_code}），按 FR-L07 需重扫")
            time.sleep(2)
            pair(new_code, address)
            deadline = time.time() + 90
            grew = False
            while time.time() < deadline:
                time.sleep(3)
                if len(pc.files()) > before:
                    grew = True
                    break
            check("AC-20/FR-L05 离线缓存 + 重扫后自动补发", grew,
                  f"{before} 个 → {len(pc.files())} 个")

            # 非 Wi-Fi 不外发
            adb("shell", "svc", "wifi", "disable")
            time.sleep(8)
            marker = time.strftime("%m-%d %H:%M:%S")
            share_via_system_sheet(media_id)
            time.sleep(8)
            recent = [
                line for line in logcat_path.read_text(encoding="utf-8", errors="replace").splitlines()
                if line[:19] > marker
            ]
            outbound = [line for line in recent if "/v1/" in line and "->" in line]
            check("AC-27 非 Wi-Fi 时不发起任何连接", not outbound,
                  f"关闭 Wi-Fi 后的 HTTP 请求：{len(outbound)} 条")
            adb("shell", "svc", "wifi", "enable")
            time.sleep(8)
            adb("shell", "am", "start", "-n", f"{PKG}/.ui.MainActivity")
            time.sleep(3)
            status = " ".join(n.get("text") or "" for n in dump().iter("node"))
            check("AC-28 离开 Wi-Fi 后需重新扫码", "已连接" not in status)

    finally:
        pc.stop()
        time.sleep(1)
        logcat.terminate()

    failed = [name for name, ok, _ in RESULTS if not ok]
    print(f"\n真机验收：{len(RESULTS) - len(failed)}/{len(RESULTS)} 通过")
    for name in failed:
        print(f"  失败：{name}")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
