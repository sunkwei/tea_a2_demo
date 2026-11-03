"""无头模拟器：不打开界面，把一局游戏跑完并打印流水账。

用途：
  * 回归测试（数值系统会不会崩）
  * 演示与调试（看看 LLM 生成的叙事长什么样）
"""
from __future__ import annotations

import sys
from typing import List, Optional

from .game import Game

PLAYER_ACTIONS = [
    "去集市看看行情",
    "找镇民聊聊天",
    "去南坡看看情况",
    "组织人手修缮旧屋",
    "把粮食分给缺粮的人家",
    "去北边打听商队的消息",
    "在镇公所处理积压的公务",
    "亲自下田干活",
    "调查井台边的脚印",
    "请人写一份告示",
]


def _out(text: str) -> None:
    try:
        sys.stdout.write(text + "\n")
        sys.stdout.flush()
    except Exception:
        pass


def run(
    days: int = 10,
    seed: int = 20241103,
    offline: bool = False,
    verbose: bool = True,
    name: str = "临溪镇",
) -> Game:
    game = Game(seed=seed, name=name, offline=offline)
    game.bootstrap()
    state = game.state

    if verbose:
        _out(f"=== {state.name} · 种子 {seed} · {game.llm_label()} ===")
        _out(state.world_brief())
        _out(f"主线：{state.quests[0].title} —— {state.quests[0].premise}")
        _out("")

    rng = state.rng.spawn("sim")
    for d in range(days):
        if verbose:
            _out(f"—— 第{state.day}天 · {state.season}季 · {state.weather} ——")
        for ev in game.open_events():
            _out(f"【{ev.title}】{ev.text}")
            if ev.choices:
                pick = rng.choice(ev.choices)
                out = game.resolve_event(ev.id, pick.id)
                if verbose:
                    _out(f"  ▸ {pick.label} → {'，'.join(out.changes) if out.changes else '无变化'}")
        action = PLAYER_ACTIONS[rng.randrange(len(PLAYER_ACTIONS))]
        out = game.do_action(action)
        if verbose:
            _out(f"行动：{action}")
            _out(f"  {out.narrative}")
        if out.choices:
            pick = rng.choice(out.choices)
            res = game.apply_choice(pick)
            if verbose:
                _out(f"  ▸ {pick.label} → {'，'.join(res.changes) if res.changes else '无变化'}")
        report = game.advance_day()
        if verbose:
            notes = "；".join(report.get("notes", []))
            _out(f"  结算：{notes}")
            for e in report.get("events", []):
                _out(f"  · {e}")
            _out("")

    ending = game.end_run()
    if verbose:
        _out("=" * 56)
        _out(f"结局：{ending.title}")
        _out(ending.text)
        _out("=" * 56)
        _out(f"第{state.day}天 {state.season}季｜人口 {state.population}｜民心 {state.morale}"
             f"｜金 {state.resource('coin')}｜粮 {state.resource('food')}"
             f"｜建筑 {len(state.buildings)}｜记忆 {len(state.memory)} 条")
        _out(f"行为倾向：{state.behavior}")
    return game


def main(argv: Optional[List[str]] = None) -> int:
    import argparse

    argv = list(sys.argv[1:] if argv is None else argv)
    ap = argparse.ArgumentParser(description="AI 小镇 无头模拟")
    ap.add_argument("--days", type=int, default=10)
    ap.add_argument("--seed", type=int, default=20241103)
    ap.add_argument("--offline", action="store_true", help="强制离线（不用 LLM）")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    run(days=args.days, seed=args.seed, offline=args.offline, verbose=not args.quiet)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
