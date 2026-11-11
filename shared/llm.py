# -*- coding: utf-8 -*-
"""LLM 那一层：挑 provider、发起 chat、把回复里的 JSON 抠出来。

bilibili 和 zhihu 两个应用共用这一份——它们要干的事一样：把抓来的正文
送给模型，拿回一份**结构化**的 JSON 摘要。

    from llm import pick_provider, llm_chat, extract_json

    pname, prov, model = pick_provider()          # 第一个 provider 就是默认
    raw = llm_chat(prov, model, [{"role": "user", "content": text}])
    obj = extract_json(raw)                        # 模型偶尔会包一层 ```，这里能抠出来

provider 配置读的是 ~/.tea_agent/provider.yaml（和 tea_a2 共用一份）：
第一个 provider 是默认的；`models` 是字典时取第一个键当默认模型。

只依赖标准库 + requests + pyyaml（后两个没装时，import 这模块不报错，
用到的时候才给一句清楚的提示）。
"""
import json
import os
import re
import time

# 依赖懒加载：抓取那一侧不碰 LLM 的时候，这个模块照样能 import
try:
    import requests
except ImportError:
    requests = None
try:
    import yaml
except ImportError:
    yaml = None

HOME = os.path.expanduser("~")
PROVIDER_YAML = os.path.join(HOME, ".tea_agent", "provider.yaml")


# --------------------------------------------------------------------------
# provider / chat / JSON
# --------------------------------------------------------------------------
def chat_completions_url(api_url):
    """和 tea_a2 的 llm.cpp::endpoint() 保持一致。"""
    base = (api_url or "").strip().rstrip("/")
    suffix = "/chat/completions"
    if base.endswith(suffix):
        return base
    if base.endswith("/v1"):
        return base + suffix
    if "/" not in base.split("://", 1)[-1]:
        return base + "/v1" + suffix
    return base + suffix


def pick_provider(name=None, model=None):
    if yaml is None:
        raise SystemExit("需要 pyyaml：pip3 install pyyaml")
    with open(PROVIDER_YAML, "r", encoding="utf-8") as fh:
        cfg = yaml.safe_load(fh)
    providers = cfg.get("providers") or {}
    if not providers:
        raise SystemExit("provider.yaml 里没有 providers")
    # 顺序就是开关：第一个是默认（和 tea_a2 一致）
    pname = name or next(iter(providers))
    p = providers[pname]
    models = p.get("models") or {}
    if isinstance(models, dict):
        mnames = list(models.keys())
    else:
        mnames = list(models)
    mname = model or (mnames[0] if mnames else p.get("default_model"))
    if not mname:
        raise SystemExit("provider %s 没有可用模型" % pname)
    return pname, p, mname


def llm_chat(p, model, messages, max_tokens=2000, temperature=0.2, tries=3,
             extra=None):
    """extra：额外塞进请求 body 的字段（dict）。

    有些推理模型需要额外开关，例如 MiniMax 要
    ``{"reasoning_effort": "low", "reasoning_split": True}``，
    否则思考 token 会把 max_tokens 吃光、正文为空（finish_reason=length）。
    """
    if requests is None:
        raise SystemExit("需要 requests：pip3 install requests")
    url = chat_completions_url(p.get("api_url"))
    headers = {"Content-Type": "application/json"}
    headers["Authorization"] = "Bearer " + (p.get("api_key") or "")
    for k, v in (p.get("headers") or {}).items():
        headers[k] = v
    body = {"model": model, "messages": messages, "max_tokens": max_tokens}
    if temperature is not None:
        body["temperature"] = temperature
    if extra:
        body.update(extra)
    last = None
    for i in range(tries):
        try:
            r = requests.post(url, headers=headers, json=body, timeout=180)
            if r.status_code != 200:
                last = "http %s: %s" % (r.status_code, r.text[:200])
                time.sleep(2 + i * 2)
                continue
            j = r.json()
            choice = (j.get("choices") or [{}])[0]
            msg = choice.get("message") or {}
            text = msg.get("content") or ""
            if not text.strip():
                # 有些模型（deepseek-flash 这种）把 token 先花在思考上，正文
                # 就空了。**别把思考过程当答案返回**——那是模型的内心戏，
                # 不是结果；调用方要的是正文。
                usage = j.get("usage") or {}
                last = ("空回复（finish_reason=%s，用掉 %s token，其中思考 %s）：%s"
                        % (choice.get("finish_reason"),
                           usage.get("completion_tokens"),
                           (usage.get("completion_tokens_details") or {}).get("reasoning_tokens"),
                           (msg.get("reasoning_content") or r.text)[:200]))
                time.sleep(2)
                continue
            return text
        except Exception as exc:
            last = repr(exc)
            time.sleep(2 + i * 2)
    raise RuntimeError("LLM 调用失败: %s" % last)


def _strip_fence(text):
    text = (text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text.strip())
    return text


def extract_json_loose(text):
    """宽松版 JSON 抽取：输出被截断时也能救回能救的部分。

    模型常常在半路被 max_tokens 截断（末尾少几个 ] } 或字符串没闭合）。
    严格解析会失败；而 extract_json 会退而返回一个**内层**对象
    （比如 picks 列表里的第一个条目），看起来像成功，其实是错的。
    这里按顺序试：
      1. 完整 JSON；
      2. 从第一个 { 开始，把没闭合的引号/括号补回去再解析；
      3. 都失败才退回严格的 extract_json。
    """
    text = _strip_fence(text)
    try:
        return json.loads(text)
    except Exception:
        pass

    start = text.find("{")
    if start >= 0:
        body = text[start:]
        stack, in_str, esc = [], False, False
        for ch in body:
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
                continue
            if ch == '"':
                in_str = True
            elif ch in "{[":
                stack.append(ch)
            elif ch in "}]":
                if stack:
                    stack.pop()
        repaired = body
        if esc:                       # 截断在转义符后面
            repaired = repaired[:-1]
        if in_str:                    # 字符串没闭合
            repaired += '"'
        repaired = re.sub(r",\s*$", "", repaired)   # 截断处常留个尾逗号
        for opener in reversed(stack):
            repaired += "}" if opener == "{" else "]"
        try:
            return json.loads(repaired)
        except Exception:
            pass
    return extract_json(text)


def extract_json(text):
    """从模型回复里抠出第一个完整的 JSON 对象。"""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text.strip())
    try:
        return json.loads(text)
    except Exception:
        pass
    start = text.find("{")
    while start >= 0:
        depth, in_str, esc = 0, False, False
        for i in range(start, len(text)):
            c = text[i]
            if in_str:
                if esc:
                    esc = False
                elif c == "\\":
                    esc = True
                elif c == '"':
                    in_str = False
                continue
            if c == '"':
                in_str = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start:i + 1])
                    except Exception:
                        break
        start = text.find("{", start + 1)
    raise ValueError("回复里没有可解析的 JSON: %s" % text[:200])
