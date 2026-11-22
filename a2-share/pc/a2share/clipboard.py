"""系统剪贴板适配（Windows / macOS / Linux）。

要求（需求 FR-C09~C11）：
- 文字与图片都能写；
- 写不进去时**降级为只存文件**并给出人话原因，不抛异常终止流程。
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

from .log import Logger

_TEXT_FALLBACK_SCRIPT = """param([string]$Text)
[Console]::In.ReadToEnd() | Set-Clipboard
"""

_IMAGE_SCRIPT = """param([string]$Path)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bitmap = New-Object System.Drawing.Bitmap($Path)
[System.Windows.Forms.Clipboard]::SetImage($bitmap)
$bitmap.Dispose()
"""


def _run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    """跑一个子进程；不存在就抛 FileNotFoundError。"""
    return subprocess.run(
        cmd,
        check=False,
        capture_output=True,
        timeout=kwargs.pop("timeout", 10),
        **kwargs,
    )


class Clipboard:
    """平台剪贴板适配器。"""

    def __init__(self, logger: Logger, script_dir: Path | None = None) -> None:
        self.logger = logger
        self.script_dir = script_dir
        self.platform = sys.platform

    # ------------------------------------------------------------- 对外接口
    def write_text(self, text: str) -> tuple[bool, str]:
        """写文字。返回 ``(是否成功, 失败原因)``。"""
        try:
            if self.platform == "win32":
                if self._win_write_text(text):
                    return True, ""
                return self._win_write_text_powershell(text)
            if self.platform == "darwin":
                proc = _run(["pbcopy"], input=text.encode("utf-8"))
                if proc.returncode == 0:
                    return True, ""
                return False, "pbcopy 执行失败"
            for cmd in (["xclip", "-selection", "clipboard"], ["wl-copy"]):
                if shutil.which(cmd[0]):
                    proc = _run(cmd, input=text.encode("utf-8"))
                    if proc.returncode == 0:
                        return True, ""
                    return False, f"{cmd[0]} 执行失败"
            return False, "未找到 xclip/wl-copy"
        except (OSError, subprocess.SubprocessError) as exc:
            return False, str(exc)

    def write_image(self, path: Path) -> tuple[bool, str]:
        """写图片（文件路径）。返回 ``(是否成功, 失败原因)``。"""
        try:
            if self.platform == "win32":
                return self._win_write_image(path)
            if self.platform == "darwin":
                script = f'set the clipboard to (read POSIX file "{path}")'
                proc = _run(["osascript", "-e", script])
                if proc.returncode == 0:
                    return True, ""
                return False, "osascript 执行失败"
            for cmd in (
                ["xclip", "-selection", "clipboard", "-t", "image/png"],
                ["wl-copy", "-t", "image/png"],
            ):
                if shutil.which(cmd[0]):
                    with path.open("rb") as fh:
                        proc = _run(cmd, input=fh.read())
                    if proc.returncode == 0:
                        return True, ""
                    return False, f"{cmd[0]} 执行失败"
            return False, "未找到 xclip/wl-copy"
        except (OSError, subprocess.SubprocessError) as exc:
            return False, str(exc)

    def probe(self) -> dict:
        """只探测可用性，不改动用户剪贴板。"""
        if self.platform == "win32":
            return {"available": True, "reason": "Windows 剪贴板可用"}
        if self.platform == "darwin":
            ok = shutil.which("pbcopy") is not None
            return {"available": ok, "reason": "" if ok else "未找到 pbcopy"}
        ok = shutil.which("xclip") or shutil.which("wl-copy")
        return {"available": bool(ok), "reason": "" if ok else "未找到 xclip/wl-copy"}

    # --------------------------------------------------------- Windows 实现
    def _win_write_text(self, text: str) -> bool:
        """ctypes 快路径（无 PowerShell 开销）。"""
        if sys.platform != "win32":
            return False
        try:
            import ctypes

            CF_UNICODETEXT = 13
            GMEM_MOVEABLE = 0x0002
            user32 = ctypes.windll.user32
            kernel32 = ctypes.windll.kernel32
            if not user32.OpenClipboard(None):
                return False
            try:
                user32.EmptyClipboard()
                data = text + "\0"
                size = len(data) * ctypes.sizeof(ctypes.c_wchar)
                handle = kernel32.GlobalAlloc(GMEM_MOVEABLE, size)
                if not handle:
                    return False
                locked = kernel32.GlobalLock(handle)
                if not locked:
                    kernel32.GlobalFree(handle)
                    return False
                ctypes.memmove(locked, ctypes.create_unicode_buffer(data), size)
                kernel32.GlobalUnlock(handle)
                if not user32.SetClipboardData(CF_UNICODETEXT, handle):
                    kernel32.GlobalFree(handle)
                    return False
                return True
            finally:
                user32.CloseClipboard()
        except Exception:  # noqa: BLE001 - 任何异常都退回 PowerShell
            return False

    def _win_write_text_powershell(self, text: str) -> tuple[bool, str]:
        script = self._write_script("clip-text.ps1", _TEXT_FALLBACK_SCRIPT)
        if script is None:
            return False, "无法写入 PowerShell 脚本"
        try:
            proc = _run(
                ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script)],
                input=text.encode("utf-16-le"),
            )
        except (OSError, subprocess.SubprocessError) as exc:
            return False, str(exc)
        if proc.returncode == 0:
            return True, ""
        return False, "Set-Clipboard 执行失败"

    def _win_write_image(self, path: Path) -> tuple[bool, str]:
        script = self._write_script("clip-image.ps1", _IMAGE_SCRIPT)
        if script is None:
            return False, "无法写入 PowerShell 脚本"
        try:
            proc = _run(
                [
                    "powershell",
                    "-NoProfile",
                    "-STA",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-File",
                    str(script),
                    "-Path",
                    str(path),
                ]
            )
        except (OSError, subprocess.SubprocessError) as exc:
            return False, str(exc)
        if proc.returncode == 0:
            return True, ""
        return False, "PowerShell 写图片失败"

    def _write_script(self, name: str, body: str) -> Path | None:
        if self.script_dir is None:
            return None
        try:
            self.script_dir.mkdir(parents=True, exist_ok=True)
            path = self.script_dir / name
            if not path.exists() or path.read_text(encoding="utf-8") != body:
                path.write_text(body, encoding="utf-8")
            return path
        except OSError:
            return None
