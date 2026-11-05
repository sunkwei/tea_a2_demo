"""AI 三国杀 · 命令行入口。

  python main.py                 打开网页版（HTML5 前端 + 实时事件流）
  python main.py --gui            打开 Tkinter 桌面版
  python main.py --cli           命令行跑一局（真实模型）
  python main.py --cli --games 3 连跑三局
  python main.py --doctor        检查三个模型的连通性
  python main.py --selftest      跑单元测试
  python main.py --sim 30        用规则策略快速模拟 30 局（不联网）
"""

from __future__ import annotations

import argparse
import sys
import time
from typing import Dict, List, Optional

from sanguosha_ai.config import MODEL_ORDER, MODEL_SPECS, GameConfig, load_game_config
from sanguosha_ai.game import Seat, Session, build_default_session
from sanguosha_ai.heroes import DEFAULT_LINEUP, get_hero
from sanguosha_ai.llm.client import LlmClient

BANNER = r"""
   ___  ___  _   _   ___  __  __
  / __|/ _ \| \ | | / _ \|  \/  |   AI 三国杀
 | (__| (_) |  \| || (_) | |\/| |   minimax-m3.1-flash / deepseek-flash / mimo-v2.6-flash
  \___|\___/| |\  | \___/| |  | |
"""


# ----------------------------------------------------------------------
def build_seats(args, cfg: GameConfig) -> List[Seat]:
    seats: List[Seat] = []
    for key in cfg.seats:
        spec = MODEL_SPECS.get(key)
        if spec is None:
            raise SystemExit(f"未知模型：{key}（可选：{', '.join(MODEL_SPECS)}）")
        hero_key = cfg.hero_for(key) or DEFAULT_LINEUP.get(key, "zhang_fei")
        client = LlmClient(spec, timeout=cfg.llm_timeout)
        policy = _make_policy(client, key)
        seats.append(
            Seat(model_key=key, hero_key=hero_key, policy=policy, display=spec.display)
        )
    return seats


def _make_policy(client, key):
    from sanguosha_ai.llm.policy import LlmPolicy

    return LlmPolicy(client, key)


# ----------------------------------------------------------------------
def cmd_doctor(args) -> int:
    print(BANNER)
    ok = True
    for key in MODEL_ORDER:
        spec = MODEL_SPECS[key]
        client = LlmClient(spec, timeout=45)
        if not client.available:
            print(f"✗ {key:22s} 未配置（api_url/api_key 缺失）")
            ok = False
            continue
        started = time.time()
        res = client.chat("你是测试助手。", "只回答两个字：就绪")
        dt = time.time() - started
        if res.ok:
            print(f"✓ {key:22s} {dt:5.1f}s  回复：{res.content[:30]!r}")
        else:
            print(f"✗ {key:22s} {dt:5.1f}s  失败：{res.error[:120]}")
            ok = False
    print("\n全部模型可用。" if ok else "\n部分模型不可用（对局会自动回落到规则策略）。")
    return 0 if ok else 1


# ----------------------------------------------------------------------
def cmd_cli(args) -> int:
    cfg = load_game_config()
    cfg.seed = args.seed if args.seed is not None else cfg.seed
    cfg.max_turns = args.max_turns
    cfg.llm_timeout = args.timeout
    if args.no_responses:
        cfg.llm_responses = False
    if args.models:
        cfg.seats = list(args.models)
    if args.heroes:
        cfg.heroes.update(args.heroes)

    print(BANNER)
    for key in cfg.seats:
        hero = get_hero(cfg.hero_for(key) or DEFAULT_LINEUP.get(key, "zhang_fei"))
        print(f"  {key:22s} → {hero.name}（{hero.faction}·{hero.skill_desc()}）")
    print()

    last_result = None
    for g in range(args.games):
        cfg.seed = (args.seed or 20261105) + g * 977
        seats = build_seats(args, cfg)
        printer = CliPrinter(verbose=args.verbose)
        session = Session(cfg, seats, emit=printer.on_event)
        print(f"===== 第 {g + 1}/{args.games} 局（seed={cfg.seed}） =====")
        result = session.run()
        last_result = result
        print(f"\n结果：{result.winner_name or '无人获胜'} 获胜，用时 {result.elapsed:.0f}s，共 {result.turns} 回合")
        for key, st in result.stats.items():
            print(f"  {key:22s} 模型决策 {st.get('llm', 0)} 次 / 规则兜底 {st.get('rule', 0)} 次 / 出错 {st.get('error', 0)} 次")
        print()
    return 0


class CliPrinter:
    """把事件流打印成可读的对局记录。"""

    def __init__(self, verbose: bool = False) -> None:
        self.verbose = verbose

    def on_event(self, ev: Dict[str, object]) -> None:
        etype = str(ev.get("type", "info"))
        text = str(ev.get("text", ""))
        if etype == "phase":
            print(f"\n{text}")
        elif etype == "say":
            who = ev.get("player")
            print(f"    「{text}」")
        elif etype == "action":
            print(f"    → {text}")
        elif etype == "error":
            print(f"    !! {text}")
        elif etype in ("damage", "death", "heal", "win"):
            print(f"  * {text}")
        elif etype == "info":
            if self.verbose:
                print(f"    {text}")
        else:
            print(f"  {text}")


# ----------------------------------------------------------------------
def cmd_sim(args) -> int:
    from sanguosha_ai.sim import main as sim_main

    sys.argv = ["sim", "--games", str(args.sim), "--seed", str(args.seed or 1)]
    sim_main()
    return 0


def cmd_selftest(args) -> int:
    import unittest

    loader = unittest.TestLoader()
    suite = loader.discover("tests")
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    return 0 if result.wasSuccessful() else 1


# ----------------------------------------------------------------------
def cmd_web(args) -> int:
    from sanguosha_ai.server import serve

    cfg = load_game_config()
    cfg.seed = args.seed if args.seed is not None else cfg.seed
    cfg.max_turns = args.max_turns
    cfg.llm_timeout = args.timeout
    if args.no_responses:
        cfg.llm_responses = False
    if args.models:
        cfg.seats = list(args.models)
    if args.heroes:
        cfg.heroes.update(args.heroes)
    serve(cfg, host=args.host, port=args.port, open_browser=not args.no_browser)
    return 0


def cmd_gui(args) -> int:
    from sanguosha_ai.ui.app import launch

    cfg = load_game_config()
    cfg.seed = args.seed if args.seed is not None else cfg.seed
    cfg.max_turns = args.max_turns
    cfg.llm_timeout = args.timeout
    if args.no_responses:
        cfg.llm_responses = False
    if args.models:
        cfg.seats = list(args.models)
    if args.heroes:
        cfg.heroes.update(args.heroes)
    launch(cfg)
    return 0


# ----------------------------------------------------------------------
def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="AI 三国杀：三个大模型同台对局")
    ap.add_argument("--seed", type=int, default=None, help="随机种子")
    ap.add_argument("--max-turns", type=int, default=60, help="单局最大回合数")
    ap.add_argument("--timeout", type=int, default=90, help="模型调用超时（秒）")
    ap.add_argument("--models", nargs="*", default=None, help="参与对局的模型 key")
    ap.add_argument("--heroes", nargs="*", default=None, help="模型=武将key 的配对")
    ap.add_argument("--no-responses", action="store_true", help="出闪/桃交给规则，不问模型")
    ap.add_argument("--verbose", action="store_true", help="打印更多过程")
    ap.add_argument("--cli", action="store_true", help="命令行模式")
    ap.add_argument("--web", action="store_true", help="网页版（HTML5 + SSE，默认）")
    ap.add_argument("--gui", action="store_true", help="Tkinter 桌面版")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")
    ap.add_argument("--doctor", action="store_true", help="检查模型连通性")
    ap.add_argument("--selftest", action="store_true", help="跑单元测试")
    ap.add_argument("--sim", type=int, default=0, help="规则策略模拟 N 局")
    ap.add_argument("--games", type=int, default=1, help="CLI 模式连跑几局")
    args = ap.parse_args(argv)

    if args.heroes:
        pairs = {}
        for item in args.heroes:
            if "=" in item:
                k, v = item.split("=", 1)
                pairs[k] = v
        args.heroes = pairs

    if args.doctor:
        return cmd_doctor(args)
    if args.selftest:
        return cmd_selftest(args)
    if args.sim:
        return cmd_sim(args)
    if args.cli:
        return cmd_cli(args)
    if args.gui:
        return cmd_gui(args)
    return cmd_web(args)


if __name__ == "__main__":
    raise SystemExit(main())
