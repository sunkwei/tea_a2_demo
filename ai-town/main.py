#!/usr/bin/env python
"""《AI 小镇：无限人生》启动入口。

用法：
    python main.py                 # 启动图形界面
    python main.py --offline       # 图形界面，但不用 LLM（纯程序化叙述）
    python main.py --sim --days 20 # 无头模拟，打印流水账
    python main.py --autoplay --days 30 # 全 NPC 自动玩（AI 当镇长）
    python main.py --selftest      # 跑单元测试
    python main.py --doctor        # 检查 LLM 连通性
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def main() -> int:
    ap = argparse.ArgumentParser(description="AI 小镇：无限人生")
    ap.add_argument("--seed", type=int, default=None, help="世界种子")
    ap.add_argument("--name", default="临溪镇", help="小镇名字")
    ap.add_argument("--offline", action="store_true", help="不调用 LLM，使用程序化叙述器")
    ap.add_argument("--sim", action="store_true", help="无头模拟")
    ap.add_argument("--autoplay", action="store_true", help="全 NPC 自动玩（AI 当镇长）")
    ap.add_argument("--policy", default="auto", choices=["auto", "llm", "rule"],
                    help="自动玩策略：auto=LLM 优先失败回落规则，rule=纯规则，llm=只用 LLM")
    ap.add_argument("--days", type=int, default=10, help="模拟天数")
    ap.add_argument("--selftest", action="store_true", help="运行单元测试")
    ap.add_argument("--doctor", action="store_true", help="检查 LLM 连通性")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    if args.selftest:
        import unittest

        loader = unittest.TestLoader()
        suite = loader.discover(os.path.join(os.path.dirname(os.path.abspath(__file__)), "tests"))
        runner = unittest.TextTestRunner(verbosity=2)
        return 0 if runner.run(suite).wasSuccessful() else 1

    if args.doctor:
        from ai_town.llm.client import LLMClient, load_config

        cfg = load_config()
        llm = LLMClient(cfg)
        print("配置：", {k: v for k, v in cfg.items() if k != "api_key"})
        print("密钥：", "有" if cfg.get("api_key") else "无")
        print("后端：", llm.describe(), "在线：", llm.online)
        if llm.online:
            data, raw, err = llm.complete_json(
                "只输出 JSON。", '输出 {"ok":true,"say":"连上了"}'
            )
            print("调用结果：", data if data is not None else f"失败 {err}")
        return 0

    if args.sim:
        from ai_town.sim import run

        run(days=args.days, seed=args.seed or 20241103, offline=args.offline, verbose=not args.quiet)
        return 0

    if args.autoplay:
        from ai_town.autoplay import run

        run(days=args.days, seed=args.seed or 20241103, offline=args.offline,
            policy=args.policy, verbose=not args.quiet)
        return 0

    from ai_town.ui.app import TownApp

    app = TownApp(seed=args.seed, name=args.name, offline=args.offline)
    app.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
