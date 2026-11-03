import json, sys, os, time, urllib.request
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.stdout.reconfigure(encoding="utf-8")
from ai_town.llm.client import load_config
from ai_town.llm import prompts
from ai_town.state import TownState

cfg = load_config()
key, base, model = cfg["api_key"], cfg["minimax_url"].rstrip("/"), cfg["minimax_model"]
st = TownState("临溪镇", 5)


def call(system, user, maxtok, extra=None):
    payload = {"model": model, "messages": [{"role": "system", "content": system},
                                             {"role": "user", "content": user}],
               "temperature": 0.9, "max_tokens": maxtok,
               "response_format": {"type": "json_object"}}
    if extra:
        payload.update(extra)
    req = urllib.request.Request(base + "/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + key}, method="POST")
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=240) as r:
        data = json.loads(r.read().decode("utf-8", "replace"))
    ch = data["choices"][0]
    msg = ch["message"]
    content = msg.get("content") or ""
    print(f"--- maxtok={maxtok} extra={extra} 用时{time.time()-t0:.1f}s finish={ch.get('finish_reason')} "
          f"usage={data.get('usage',{}).get('completion_tokens')} "
          f"content_len={len(content)} reasoning_len={len(msg.get('reasoning_content') or '')}")
    print("   content head:", content[:160].replace("\n", " "))
    return data


print("== A: 现状提示词, 2200 tokens")
call(prompts.NPC_SYSTEM, prompts.npc_prompt(st, 8), 2200)
print("== B: 现状提示词, 8000 tokens")
call(prompts.NPC_SYSTEM, prompts.npc_prompt(st, 8), 8000)
print("== C: 加中文思考约束, 4000 tokens")
call(prompts.NPC_SYSTEM + "\n请用中文思考，并直接给出 JSON 结果。", prompts.npc_prompt(st, 8), 4000)
