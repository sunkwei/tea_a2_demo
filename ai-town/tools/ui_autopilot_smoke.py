"""UI 冒烟测试：AI 托管 / 玩家接管的切换。

不需要人工点击；验证托管循环、模式切换、玩家中途接管。
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.stdout.reconfigure(encoding="utf-8")

from ai_town.ui.app import TownApp


def pump(app, timeout=3.0, until_idle=True):
    """跑事件循环；until_idle=True 时等后台任务结束，否则只跑一小会儿。"""
    t0 = time.time()
    while time.time() - t0 < timeout:
        app.update()
        if until_idle and not app.busy:
            break
        time.sleep(0.03)
    app.update()


def main():
    app = TownApp(seed=4321, name="托管镇", offline=True, autostart=False)
    app.update()
    app.game.bootstrap()
    app._on_booted(None)
    app.update()
    day0 = app.game.state.day
    print("起点：第", day0, "天", flush=True)

    # 1) 开启托管
    app._toggle_autopilot()
    assert app.autopilot_mode, "托管没开起来"
    print("托管已开启，按钮文案：", app.btn_auto.cget("text"), flush=True)
    for _ in range(6):
        pump(app, timeout=1.0, until_idle=False)
    print("托管跑了几步，天数：", app.game.state.day, "（起点", day0, "）", flush=True)
    assert app.game.state.day > day0, "托管没有推进日子"
    assert "AI 托管" in app.text.get("1.0", "end"), "叙事面板里没有托管日志"
    print("托管日志已写入叙事面板 OK", flush=True)

    # 2) 玩家接管：输入一句行动
    app.entry.insert(0, "我要亲自去井台看看")
    app._on_action()
    pump(app, timeout=10, until_idle=True)
    assert not app.autopilot_mode, "接管后托管没有停"
    print("玩家接管 OK，按钮文案：", app.btn_auto.cget("text"), flush=True)
    assert "你决定" in app.text.get("1.0", "end")

    # 3) 再开托管 → 手动停掉
    app._toggle_autopilot()
    assert app.autopilot_mode
    pump(app, timeout=1.0, until_idle=False)
    app._toggle_autopilot()
    assert not app.autopilot_mode, "手动停止托管失败"
    print("再次托管 / 手动停止 OK", flush=True)

    # 4) 托管时点「结束这一天」不应崩
    app._toggle_autopilot()
    app._on_next_day()
    pump(app, timeout=1.0, until_idle=False)
    app._toggle_autopilot()

    app.destroy()
    print("托管切换冒烟测试全部通过", flush=True)


if __name__ == "__main__":
    main()
