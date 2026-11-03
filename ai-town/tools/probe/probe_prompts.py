import sys, os, time, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.stdout.reconfigure(encoding="utf-8")
from ai_town.game import Game
from ai_town.llm import prompts
from ai_town.llm.parsing import coerce_action, coerce_events

g = Game(seed=5, name="临溪镇")
g.bootstrap()
st = g.state

for tag, system, prompt, coercer in (
    ("events", prompts.EVENT_SYSTEM, prompts.events_prompt(st, 4), coerce_events),
    ("dm", prompts.DM_SYSTEM, prompts.dm_prompt(st, "我去井台看看那封没有署名的信"), coerce_action),
):
    t0 = time.time()
    data, raw, err = g.llm.complete_json(system, prompt, json_mode=True)
    print(f"=== {tag}: {time.time()-t0:.1f}s err={err!r}")
    print("raw head:", (raw or "")[:200].replace("\n", " "))
    if data is not None:
        print("data keys:", list(data.keys()) if isinstance(data, dict) else type(data))
        out = coercer(data)
        if tag == "events":
            print("coerced events:", len(out))
            for e in out:
                print("   ", e.title, "| choices:", len(e.choices), [c.label for c in e.choices][:3])
        else:
            print("narrative:", (out[0] or "")[:120])
            print("choices:", [(c.label, c.effects) for c in out[1]])
    print()
