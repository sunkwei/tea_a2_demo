import sys, os, time, json, io
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.stdout.reconfigure(encoding="utf-8")
from ai_town.game import Game
from ai_town.llm import prompts
from ai_town.llm.parsing import extract_json, _repair, _scan_balanced

g = Game(seed=5, name="临溪镇")
g.bootstrap()
st = g.state

system, prompt = prompts.EVENT_SYSTEM, prompts.events_prompt(st, 4)
raw = g.llm.complete(system, prompt, json_mode=True)
io.open("events_raw.txt", "w", encoding="utf-8").write(raw)
print("len:", len(raw))
print("head:", raw[:120])
print("tail:", raw[-300:])
print("--- json.loads:", end=" ")
try:
    json.loads(raw)
    print("OK")
except Exception as e:
    print("FAIL", e)
print("--- extract_json:", type(extract_json(raw)).__name__)
print("--- repair+loads:", end=" ")
try:
    json.loads(_repair(raw))
    print("OK")
except Exception as e:
    print("FAIL", e)
