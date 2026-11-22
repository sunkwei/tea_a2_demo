"""PC 端真服务冒烟：起进程 → 探活 → 看二维码 PNG → 收尾。"""

import http.client
import json
import struct
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENTRY = ROOT / "pc" / "a2_share.py"


def png_size(path: Path):
    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "不是 PNG"
    width, height = struct.unpack(">II", data[16:24])
    return width, height


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="a2share-smoke-"))
    home = tmp / "home"
    recv = tmp / "recv"
    home.mkdir()
    recv.mkdir()
    port = 18899
    process = subprocess.Popen(
        [sys.executable, "-u", str(ENTRY), "--home", str(home), "--dir", str(recv),
         "--port", str(port), "--no-notify"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    try:
        deadline = time.time() + 15
        payload = None
        while time.time() < deadline:
            line = process.stdout.readline()
            if not line:
                break
            print("  服务输出：", line.rstrip())
            if "监听地址" in line:
                payload = line.strip()
                break
        assert payload, "服务没有打印监听地址"

        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        conn.request("GET", "/v1/hello")
        response = conn.getresponse()
        body = json.loads(response.read().decode("utf-8"))
        conn.close()
        assert response.status == 200, body
        print("  /v1/hello →", body)

        qr = home / "qr.png"
        assert qr.exists(), "二维码 PNG 没生成"
        width, height = png_size(qr)
        print(f"  二维码 PNG：{qr}（{width}x{height} px，{qr.stat().st_size} 字节）")
        assert width == height and width >= 200, "二维码尺寸异常"

        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        conn.request("GET", "/v1/status")
        response = conn.getresponse()
        body = json.loads(response.read().decode("utf-8"))
        conn.close()
        assert response.status == 401, body
        print("  未授权 /v1/status →", body["error"]["code"])

        print("\n冒烟通过：服务可启动、可探活、二维码已生成、未授权被拒。")
        return 0
    finally:
        # Windows 的 subprocess 不支持 SIGINT，直接 terminate
        if sys.platform == "win32":
            process.terminate()
        else:
            process.send_signal(signal.SIGINT)
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()


if __name__ == "__main__":
    sys.exit(main())
