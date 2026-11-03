import json, sys, os, time, urllib.request
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.stdout.reconfigure(encoding="utf-8")
from ai_town.llm.client import load_config
from ai_town.llm import prompts
from ai_town.state import TownState

cfg = load_config()
key, base, model = cfg["api_key"], cfg["minimax_url"].rstrip("/"), cfg["minimax_model"]
st = TownState("临溪镇", 5)
SYS = prompts.NPC_SYSTEM


def call(tag, system, user, maxtok, extra=None):
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
    try:
        with urllib.request.urlopen(req, timeout=240) as r:
            data = json.loads(r.read().decode("utf-8", "replace"))
    except Exception as e:
        body = ""
        try:
            body = e.read().decode("utf-8", "replace")[:300]
        except Exception:
            pass
        print(f"--- {tag}: ERR {e} {body}")
        return None
    ch = data["choices"][0]
    msg = ch["message"]
    content = msg.get("content") or ""
    print(f"--- {tag}: 用时{time.time()-t0:.1f}s finish={ch.get('finish_reason')} "
          f"comp_tok={data.get('usage',{}).get('completion_tokens')} content_len={len(content)} "
          f"reasoning_len={len(msg.get('reasoning_content') or '')}")
    print("    head:", content[:120].replace("\n", " "))
    return data


call("a thinking.disabled", SYS, prompts.npc_prompt(st, 8), 4000, {"thinking": {"type": "disabled"}})
call("b enable_thinking=false", SYS, prompts.npc_prompt(st, 8), 4000, {"enable_thinking": False})
call("c reasoning_split", SYS, prompts.npc_prompt(st, 8), 4000, {"reasoning_split": True})
call("d 极简要求+少人数", "你是角色设计师。不要输出思考过程，直接输出 JSON。", prompts.npc_prompt(st, 4), 2000)
call("e 换消息顺序(无system)", "", prompts.npc_prompt(st, 6), 3000)
