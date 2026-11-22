"""桌面通知适配（失败静默，需求 FR-C12）。

Windows：PowerShell 跑 WinRT toast（失败退回 msg.exe）；
macOS：osascript display notification；Linux：notify-send。
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

from .log import Logger

_TOAST_SCRIPT = """param([string]$Title, [string]$Body)
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime] | Out-Null
$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$nodes = $xml.GetElementsByTagName('text')
$nodes.Item(0).AppendChild($xml.CreateTextNode($Title)) | Out-Null
$nodes.Item(1).AppendChild($xml.CreateTextNode($Body)) | Out-Null
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('a2_share').Show($toast)
"""


class Notifier:
    """桌面通知发送器。"""

    def __init__(self, logger: Logger, script_dir: Path | None = None) -> None:
        self.logger = logger
        self.script_dir = script_dir
        self.enabled = True

    def notify(self, title: str, body: str) -> bool:
        """发通知；任何失败都只记日志，不影响主流程。"""
        if not self.enabled:
            return False
        try:
            if sys.platform == "win32":
                return self._notify_windows(title, body)
            if sys.platform == "darwin":
                script = f'display notification "{_escape(body)}" with title "{_escape(title)}"'
                proc = subprocess.run(
                    ["osascript", "-e", script],
                    check=False,
                    capture_output=True,
                    timeout=10,
                )
                return proc.returncode == 0
            if shutil.which("notify-send"):
                proc = subprocess.run(
                    ["notify-send", title, body],
                    check=False,
                    capture_output=True,
                    timeout=10,
                )
                return proc.returncode == 0
            return False
        except (OSError, subprocess.SubprocessError) as exc:
            self.logger.debug("notify_failed", reason=str(exc))
            return False

    def _notify_windows(self, title: str, body: str) -> bool:
        script = self._write_script()
        if script is not None:
            try:
                proc = subprocess.run(
                    [
                        "powershell",
                        "-NoProfile",
                        "-ExecutionPolicy",
                        "Bypass",
                        "-File",
                        str(script),
                        "-Title",
                        title,
                        "-Body",
                        body,
                    ],
                    check=False,
                    capture_output=True,
                    timeout=20,
                )
                if proc.returncode == 0:
                    return True
            except (OSError, subprocess.SubprocessError):
                pass
        if shutil.which("msg"):
            try:
                proc = subprocess.run(
                    ["msg", "*", title, body],
                    check=False,
                    capture_output=True,
                    timeout=10,
                )
                return proc.returncode == 0
            except (OSError, subprocess.SubprocessError):
                return False
        return False

    def _write_script(self) -> Path | None:
        if self.script_dir is None:
            return None
        try:
            self.script_dir.mkdir(parents=True, exist_ok=True)
            path = self.script_dir / "notify.ps1"
            if not path.exists() or path.read_text(encoding="utf-8") != _TOAST_SCRIPT:
                path.write_text(_TOAST_SCRIPT, encoding="utf-8")
            return path
        except OSError:
            return None


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace('"', '\\"')
