import sys, os, time, json, io
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.stdout.reconfigure(encoding="utf-8")
from ai_town.game import Game
from ai_town.llm import prompts
from ai_town.llm.parsing import coerce_events, extract_json

g = Game(seed=5, name="临溪镇")
g.bootstrap()
st = g.state

system, prompt = prompts.EVENT_SYSTEM, prompts.events_prompt(st, 4)
print("prompt len:", len(prompt))
for i in range(2):
    t0 = time.time()
    data, raw, err = g.llm.complete_json(system, prompt, json_mode=True)
    print(f"--- 第{i+1}次: {time.time()-t0:.1f}s err={err!r} raw_len={len(raw or '')}")
    if data is None:
        print("   raw tail:", (raw or "")[-200:].replace("\n", " "))
        continue
    evs = coerce_events(data, st.day, "llm")
    print("   coerced:", len(evs))
    for e in evs:
        print("     -", e.kind, e.title, "| choices:", [(c.label, c.effects) for c in e.choices][:2])
    io.open(f"events_raw_{i}.txt", "w", encoding="utf-8").write(raw or "")
