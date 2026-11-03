import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.stdout.reconfigure(encoding="utf-8")
from ai_town.state import TownState

# risk 的三种写法都要按"值"判级，而不是一律当高风险
low = TownState("t", 7)
high = TownState("t", 7)
pref = TownState("t", 7)
outs_low = [low.resolve_effects({"risk": "low"}) for _ in range(8)]
outs_high = [high.resolve_effects({"risk": "high"}) for _ in range(8)]
outs_pref = [pref.resolve_effects({"risk:low": 1}) for _ in range(8)]
print("risk=low  :", outs_low)
print("risk=high :", outs_high)
print("risk:low  :", outs_pref)
bad_low = [o for o in outs_low if any("代价不小" in c for c in o)]
bad_pref = [o for o in outs_pref if any("代价不小" in c for c in o)]
assert not bad_low, f"risk=low 不该出大代价：{bad_low}"
assert not bad_pref, f"risk:low 不该出大代价：{bad_pref}"
assert any(any("代价不小" in c for c in o) for o in outs_high), "risk=high 该有机会出大代价"
print("risk 判定 OK")
