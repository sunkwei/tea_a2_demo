"""UI 冒烟测试：建窗口 → 刷新 → 模拟一次行动与分支 → 推进一天 → 销毁。

不需要人工点击；用来抓 Tkinter 层面的异常（布局、回调、线程）。
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.stdout.reconfigure(encoding="utf-8")

from ai_town.ui.app import TownApp


def pump(app, timeout=60):
    """跑事件循环直到不忙或超时。"""
    t0 = time.time()
    while app.busy and time.time() - t0 < timeout:
        app.update()
        time.sleep(0.05)
    app.update()


def main():
    offline = "--online" not in sys.argv
    app = TownApp(seed=1234, name="测试镇", offline=offline, autostart=False)
    app.update()
    print("窗口建立 OK", app.winfo_width(), "x", app.winfo_height())

    app.game.bootstrap()
    app._on_booted(None)
    app.update()
    print("bootstrap 后刷新 OK，人口：", app.game.state.population)

    # 自由行动
    app.entry.insert(0, "我想去井台看看那封没有署名的信")
    app._on_action()
    pump(app)
    print("自由行动 OK，分支数：", len(app.current_choices))

    # 选一个分支
    if app.current_choices:
        app._on_choice(app.current_choices[0])
        pump(app)
        print("分支结算 OK")

    # 处理今日事件
    evs = app.game.state.events
    if evs:
        app.events_list.selection_set(0)
        app._on_event_select(None)
        app.update()
        print("事件选择 OK：", evs[0].title, "分支", len(evs[0].choices))
        if evs[0].choices:
            app.game.resolve_event(evs[0].id, evs[0].choices[0].id)
            app._refresh_all()
            print("事件结算 OK")

    # 推进一天
    app._on_next_day()
    pump(app)
    print("推进一天 OK，第", app.game.state.day, "天")

    # 交易 / 建造
    app._do_trade("sell", "food")
    app._do_build("lumber")
    app._refresh_all()
    print("交易建造 OK")

    # 地图点击 + 档案页雇工
    if app.game.state.npcs:
        npc = app.game.state.npcs[0]
        app._on_npc_click(npc.id)
        app.update()
        print("地图点击 OK")
        if app.game.state.buildings:
            app._do_hire(npc.id, app.game.state.buildings[0].id)
            app.update()
            print("雇工 OK")

    # 市场页签（行情新闻 / 走俏滞销）
    app._refresh_market()
    app.update()
    print("市场页签 OK")

    app.update()
    app.destroy()
    print("UI 冒烟测试全部通过")


if __name__ == "__main__":
    main()
