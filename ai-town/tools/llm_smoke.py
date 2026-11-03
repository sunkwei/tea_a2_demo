"""LLM 链路冒烟测试：走一遍真实在线模型（NPC / 事件 / 主线 / DM 叙事）。"""
import sys, time, io, os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.stdout.reconfigure(encoding="utf-8")

from ai_town.game import Game
from ai_town.llm.client import LLMClient, load_config


def main():
    cfg = load_config()
    print("backend config:", cfg.get("backend"), cfg.get("minimax_url"), cfg.get("minimax_model"),
          "key?", bool(cfg.get("api_key")))
    llm = LLMClient(cfg)
    print("picked backend:", llm.describe(), "online:", llm.online)

    t0 = time.time()
    g = Game(seed=int(sys.argv[1]) if len(sys.argv) > 1 else 42, name="临溪镇", llm=llm)
    g.bootstrap()
    print(f"bootstrap 用时 {time.time() - t0:.1f}s  source={g.last_source}")
    print("--- 居民 ---")
    for n in g.state.npcs[:4]:
        print(f"  {n.name}（{n.role}，{n.age}岁）{'、'.join(n.traits)} | {n.background} | 秘密：{n.secret}")
    print("--- 主线 ---")
    q = g.state.quests[0]
    print(f"  {q.title} source={q.source}\n  {q.premise}\n  阶段：{q.stages}\n  目标NPC：{q.target_npc}")
    print("--- 今日事件 ---")
    for e in g.state.events:
        print(f"  [{e.kind}] {e.title}  ({e.source})")
        print(f"     {e.text[:110]}…")
        for c in e.choices[:3]:
            print(f"      - {c.label}  {c.effects}")
    t1 = time.time()
    out = g.do_action("我想去井台看看那封没有署名的信")
    print(f"\nDM 行动用时 {time.time() - t1:.1f}s source={out.source}")
    print("  ", out.narrative[:400])
    for c in out.choices:
        print(f"   - {c.label} | {c.hint} | {c.effects}")
    if out.choices:
        res = g.apply_choice(out.choices[0])
        print("  结算：", res.changes, "->", res.narrative[:120])


if __name__ == "__main__":
    main()
