import json, sys, os, time, urllib.request
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.stdout.reconfigure(encoding="utf-8")
from ai_town.llm.client import load_config

cfg = load_config()
key = cfg["api_key"]
base = cfg["minimax_url"].rstrip("/")
model = cfg["minimax_model"]

prompt = """小镇：临溪镇，第1年春季第1天。
镇长刚上任，急需认识这里的居民。请生成 5 位居民。
输出格式：{"npcs":[{"name":"","role":"","age":30,"traits":[""],"background":"","secret":"","trust":50,"skill":2}]}"""

for maxtok in (2200, 8000):
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": "你是角色设计师。只输出一个 JSON 对象，不要解释，不要 markdown 代码块。"},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.9,
        "max_tokens": maxtok,
        "response_format": {"type": "json_object"},
    }
    req = urllib.request.Request(base + "/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + key}, method="POST")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            raw = r.read().decode("utf-8", "replace")
        data = json.loads(raw)
        ch = data["choices"][0]["message"]
        print(f"=== max_tokens={maxtok} 用时{time.time()-t0:.1f}s usage={data.get('usage')}")
        print("finish_reason:", data["choices"][0].get("finish_reason"))
        print("content len:", len(ch.get("content") or ""))
        print("content head:", (ch.get("content") or "")[:300])
        print("reasoning len:", len(ch.get("reasoning_content") or ""))
    except Exception as e:
        print("ERR", type(e).__name__, e)
