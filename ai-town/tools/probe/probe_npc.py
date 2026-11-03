import sys, os, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.stdout.reconfigure(encoding="utf-8")
from ai_town.game import Game
from ai_town.state import TownState
from ai_town.llm import prompts

g = Game(seed=5, name="临溪镇")
print("backend:", g.llm.describe(), "online:", g.llm.online)

st = TownState("临溪镇", 5)
t0 = time.time()
data, raw, err = g.llm.complete_json(prompts.NPC_SYSTEM, prompts.npc_prompt(st, 8), json_mode=True)
print(f"用时 {time.time()-t0:.1f}s err={err!r}")
print("raw head:", (raw or "")[:300])
print("data type:", type(data).__name__)
if data:
    from ai_town.llm.parsing import coerce_npcs
    npcs = coerce_npcs(data, 1)
    print("coerced:", len(npcs), [n.name for n in npcs])
print("last_error:", g.llm.last_error)
