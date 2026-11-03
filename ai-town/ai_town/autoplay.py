"""全 NPC 自动玩：世界自己跑起来。

    python main.py --autoplay --days 30            # LLM 当镇长（在线）
    python main.py --autoplay --days 30 --policy rule   # 纯规则镇长（离线、秒级）

每一轮：
    1. NPC 自主行动（求助/争吵/出走/私事）→ 有的自动发生，有的变成要镇长裁决的事件
    2. AI 镇长决策：处理今天的事件 + 决定今天做什么
    3. 镇长行动（走 DM 叙事）+ 选一个分支
    4. 推进一天（产出/口粮/税收/行情/商队/翻旧账…）
"""
from __future__ import annotations

import sys
from typing import Any, Dict, List, Optional, Tuple

from . import npc_life
from .agents.autopilot import Autopilot
from .game import Game
from .state import TownState


def _out(text: str) -> None:
    try:
        sys.stdout.write(text + "\n")
        sys.stdout.flush()
    except Exception:
        pass


def inject_npc_events(
    game: Game, rng, max_total: int = 5
) -> Tuple[List[Any], List[str]]:
    """把 NPC 自主行为混进今天的事件列表（总量封顶 5 件）。"""
    state = game.state
    events, happenings = npc_life.daily_npc_events(state, rng, max_events=2)
    for h in happenings:
        state.add_log(h, "npc")
    if events:
        room = max(0, max_total - len(events))
        state.events = list(state.events)[:room] + events
    return events, happenings


def run(
    days: int = 20,
    seed: int = 20241103,
    offline: bool = False,
    policy: str = "auto",
    verbose: bool = True,
    name: str = "临溪镇",
) -> Game:
    game = Game(seed=seed, name=name, offline=offline)
    game.bootstrap()
    state = game.state
    pilot = Autopilot(game, policy=policy)
    rng = state.rng.spawn("autoplay")

    if verbose:
        _out(f"=== 全 NPC 自动玩 · {state.name} · 种子 {seed} · {game.llm_label()} ===")
        _out(f"策略：{policy}｜人口 {state.population}｜主线：{state.quests[0].title if state.quests else '—'}")
        _out("")

    for _ in range(max(1, days)):
        _events, happenings = inject_npc_events(game, rng)
        if verbose and happenings:
            for h in happenings:
                _out(f"  ·（居民自己）{h}")
        entry = pilot.step()
        if not verbose:
            continue
        _out(f"—— 第{entry['day']}天 · {entry['season']}季 · {entry['weather']} ——")
        for ev in entry["events"]:
            ch = "，".join(ev["changes"]) if ev["changes"] else "无变化"
            _out(f"【{ev['title']}】▸ {ev['choice']} → {ch}")
        _out(f"镇长（{entry['source']}）：{entry['decision']}")
        if entry.get("why"):
            _out(f"　理由：{entry['why']}")
        if entry.get("narrative"):
            _out(f"　{entry['narrative'][:220]}")
        if entry.get("choice"):
            ch = "，".join(entry.get("changes") or []) or "无变化"
            _out(f"　▸ {entry['choice']} → {ch}")
        notes = entry.get("notes") or []
        if notes:
            _out(f"　结算：{'；'.join(notes)}")
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

    ap = argparse.ArgumentParser(description="AI 小镇 · 全 NPC 自动玩")
    ap.add_argument("--days", type=int, default=20)
    ap.add_argument("--seed", type=int, default=20241103)
    ap.add_argument("--policy", default="auto", choices=["auto", "llm", "rule"])
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    run(days=args.days, seed=args.seed, offline=args.offline, policy=args.policy,
        verbose=not args.quiet)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
