import json, sys, os, time, urllib.request
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.stdout.reconfigure(encoding="utf-8")
from ai_town.llm.client import load_config
from ai_town.llm import prompts
from ai_town.state import TownState

cfg = load_config()
key, base, model = cfg["api_key"], cfg["minimax_url"].rstrip("/"), cfg["minimax_model"]
st = TownState("临溪镇", 5)

TRIM_SYS = ("你是《AI 小镇：无限人生》的角色设计师。为小镇生成居民。"
            "只输出 JSON，不要思考过程，不要解释。"
            "每人字段：name 姓名、role 职业、age 年龄、traits 两个性格词、"
            "background 不超过30字的背景、secret 不超过25字的秘密、trust 50、skill 2。"
            "职业限定：农夫、铁匠、商人、学者、医匠、猎人、牧人、鞋匠、酒馆主、游吟诗人、老镇长、孤儿。"
            "只输出一个 JSON 对象，不要 markdown 代码块。")


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
            body = e.read().decode("utf-8", "replace")[:200]
        except Exception:
            pass
        print(f"--- {tag}: ERR {e} {body}")
        return None
    ch = data["choices"][0]
    content = ch["message"].get("content") or ""
    print(f"--- {tag}: 用时{time.time()-t0:.1f}s finish={ch.get('finish_reason')} "
          f"comp_tok={data.get('usage',{}).get('completion_tokens')} content_len={len(content)}")
    print("    head:", content[:120].replace("\n", " "))
    return data


call("1 effort=low + 原提示", prompts.NPC_SYSTEM, prompts.npc_prompt(st, 8), 4000, {"reasoning_effort": "low"})
call("2 effort=low + 精简提示", TRIM_SYS, prompts.npc_prompt(st, 8), 4000, {"reasoning_effort": "low"})
call("3 无effort + 精简提示", TRIM_SYS, prompts.npc_prompt(st, 8), 4000)
call("4 effort=low + 事件提示", prompts.EVENT_SYSTEM, prompts.events_prompt(st, 4), 4000, {"reasoning_effort": "low"})
call("5 effort=low + DM提示", prompts.DM_SYSTEM, prompts.dm_prompt(st, "我去井台看看那封没有署名的信"), 4000, {"reasoning_effort": "low"})
