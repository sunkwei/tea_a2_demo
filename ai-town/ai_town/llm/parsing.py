"""健壮 JSON 解析 + 结构校验。

本地小模型经常不吐纯 JSON：会带 markdown 围栏、会前后加解说、会用中文引号、
会写单引号、会多逗号。这里统统兜住，失败就返回 None，让上层回退到模板。
"""
from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional, Tuple

from ..models import Choice, EventCard, MarketBrief, NPC
from ..state import SEMANTIC_EFFECTS

FENCE_RE = re.compile(r"```(?:json|JSON)?\s*(.*?)```", re.S)

#: 允许出现在 effects 里的"裸"键
BARE_EFFECT_KEYS = {
    "coin", "food", "wood", "stone", "ore", "renown",
    "morale", "population", "all_trust",
}
#: 允许的前缀键
PREFIX_EFFECT_KEYS = (
    "trust:", "relation:", "flag:", "behavior:", "build:", "quest:", "discover:", "risk:",
)

EVENT_KINDS = {"disaster", "social", "opportunity", "mystery", "routine"}

#: 行情风向允许出现的商品白名单（LLM 不能编造不存在的商品）
MARKET_GOODS = ("food", "wood", "stone", "ore", "tools", "books", "liquor")

#: 中文名 -> 商品代号（小模型很爱写中文，认不出来就等于没给）
MARKET_ALIASES: Dict[str, Tuple[str, ...]] = {
    "food": ("粮食", "新粮", "口粮", "谷物", "米", "粮"),
    "wood": ("木材", "木料", "木头", "木"),
    "stone": ("石料", "石材", "石头", "石"),
    "ore": ("矿石", "铁矿", "铜矿", "矿"),
    "tools": ("工具", "铁器", "农具", "器具"),
    "books": ("书籍", "书"),
    "liquor": ("烈酒", "酒"),
}

#: 行情消息里暗示"走俏"的词
HOT_WORDS = ("走俏", "看涨", "涨价", "抢手", "紧缺", "紧张", "需求旺", "缺货", "看紧")
#: 行情消息里暗示"滞销"的词
COLD_WORDS = ("滞销", "跌价", "偏弱", "走低", "便宜", "无人问津", "积压", "看跌")

KIND_ALIASES = {
    "天灾": "disaster", "灾害": "disaster", "灾难": "disaster", "disaster": "disaster",
    "人情": "social", "社交": "social", "社会": "social", "social": "social",
    "商机": "opportunity", "机遇": "opportunity", "贸易": "opportunity",
    "opportunity": "opportunity", "economy": "opportunity",
    "悬案": "mystery", "谜案": "mystery", "剧情": "mystery", "mystery": "mystery",
    "日常": "routine", "routine": "routine",
}


# --------------------------------------------------------------------------
# JSON 抽取
# --------------------------------------------------------------------------
def _strip_fences(text: str) -> str:
    m = FENCE_RE.search(text)
    if m:
        return m.group(1).strip()
    return text.strip()


KNOWN_KEYS = (
    "title|kind|text|choices|options|branches|label|hint|effects|name|role|age|traits|"
    "background|secret|trust|skill|narrative|premise|goal|stages|clues|reward|target_npc|"
    "mood|population|description|body|next|actions|replies"
)


def _repair(text: str) -> str:
    """修一些常见的"非标准 JSON"问题（只在直接解析失败时才用）。"""
    t = text
    # 中文引号 -> 直引号
    t = t.replace("“", '"').replace("”", '"').replace("‘", "'").replace("’", "'")
    # 字符串里的裸控制字符（含换行）会让 json 解析失败
    t = re.sub(r"[\x00-\x1f]", " ", t)
    # 去掉对象/数组里的尾逗号
    t = re.sub(r",\s*([}\]])", r"\1", t)
    # 去掉行内注释
    t = re.sub(r"//[^\n\"]*", "", t)
    # 模型偶尔漏掉冒号："choices" "xxx"  ->  "choices": "xxx"
    t = re.sub(r'("(?:%s)"\s*)(?=["\d\[{])' % KNOWN_KEYS, r'\1: ', t)
    return t


def _balanced_fragments(text: str):
    """产出所有配平的 JSON 片段（按长度从大到小）。"""
    frags = []
    for opener, closer in (("{", "}"), ("[", "]")):
        idx = text.find(opener)
        while idx != -1:
            depth = 0
            in_str = False
            esc = False
            end = -1
            for i in range(idx, len(text)):
                ch = text[i]
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
                    continue
                if ch == opener:
                    depth += 1
                elif ch == closer:
                    depth -= 1
                    if depth == 0:
                        end = i + 1
                        break
            if end > 0:
                frags.append(text[idx:end])
            idx = text.find(opener, idx + 1)
    frags.sort(key=len, reverse=True)
    return frags


def _scan_balanced(text: str) -> Optional[Any]:
    """扫描配平片段，取能解析出的最长的那个。"""
    for frag in _balanced_fragments(text):
        for candidate in (frag, _repair(frag)):
            try:
                return json.loads(candidate)
            except Exception:
                continue
    return None


def extract_json(text: str) -> Optional[Any]:
    """从任意文本里抠出 JSON；抠不出来返回 None。

    依次尝试：直接解析 -> 修复后解析 -> 容错解析 -> 扫描最长配平片段。
    """
    if not text:
        return None
    stripped = _strip_fences(text)
    for candidate in (stripped, _repair(stripped)):
        try:
            return json.loads(candidate)
        except Exception:
            pass
    try:
        return _tolerant_loads(stripped)
    except Exception:
        pass
    return _scan_balanced(stripped)


def _tolerant_loads(text: str) -> Any:
    """容错 JSON 解析。

    能容忍小模型常见的毛病：
      * 键后面漏冒号（"choices" "xxx"）
      * 字符串没有闭合（"flag:x":" 后直接跟 }）
      * 结尾少一个括号
    """
    state = {"pos": 0}
    n = len(text)

    def skip_ws() -> None:
        while state["pos"] < n and text[state["pos"]] in " \t\r\n":
            state["pos"] += 1

    def parse_str() -> str:
        pos = state["pos"]
        assert text[pos] == '"'
        pos += 1
        buf: List[str] = []
        while pos < n:
            ch = text[pos]
            if ch == "\\":
                pos += 1
                if pos < n:
                    buf.append(text[pos])
                    pos += 1
                continue
            if ch == '"':
                state["pos"] = pos + 1
                return "".join(buf)
            if ch in "},]" and not buf:
                # 未闭合的字符串：就地结束，当作空串
                state["pos"] = pos
                return ""
            buf.append(ch)
            pos += 1
        state["pos"] = pos
        return "".join(buf)

    def parse_value() -> Any:
        skip_ws()
        pos = state["pos"]
        if pos >= n:
            raise ValueError("unexpected end")
        ch = text[pos]
        if ch == "{":
            return parse_obj()
        if ch == "[":
            return parse_arr()
        if ch == '"':
            return parse_str()
        m = re.match(r"(true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)", text[pos:])
        if not m:
            raise ValueError("bad value")
        tok = m.group(1)
        state["pos"] = pos + len(tok)
        if tok == "true":
            return True
        if tok == "false":
            return False
        if tok == "null":
            return None
        try:
            return int(tok)
        except ValueError:
            return float(tok)

    def skip_value() -> None:
        depth = 0
        pos = state["pos"]
        while pos < n:
            ch = text[pos]
            if ch in "{[":
                depth += 1
            elif ch in "}]":
                if depth == 0:
                    return
                depth -= 1
            elif ch == "," and depth == 0:
                return
            pos += 1
        state["pos"] = pos

    def parse_obj() -> Dict[str, Any]:
        obj: Dict[str, Any] = {}
        state["pos"] += 1  # {
        while True:
            skip_ws()
            pos = state["pos"]
            if pos >= n:
                break
            ch = text[pos]
            if ch == "}":
                state["pos"] = pos + 1
                break
            if ch == ",":
                state["pos"] = pos + 1
                continue
            if ch == '"':
                key = parse_str()
            else:
                m = re.match(r"[^,:{}\[\]]+", text[pos:])
                if not m:
                    state["pos"] = pos + 1
                    continue
                key = m.group(0).strip()
                state["pos"] = pos + len(m.group(0))
            skip_ws()
            pos = state["pos"]
            if pos < n and text[pos] == ":":
                state["pos"] = pos + 1
            try:
                obj[key] = parse_value()
            except Exception:
                skip_value()
        return obj

    def parse_arr() -> List[Any]:
        arr: List[Any] = []
        state["pos"] += 1  # [
        while True:
            skip_ws()
            pos = state["pos"]
            if pos >= n:
                break
            ch = text[pos]
            if ch == "]":
                state["pos"] = pos + 1
                break
            if ch == ",":
                state["pos"] = pos + 1
                continue
            try:
                arr.append(parse_value())
            except Exception:
                skip_value()
        return arr

    starts = [i for i in (text.find("{"), text.find("[")) if i >= 0]
    if not starts:
        raise ValueError("no json found")
    state["pos"] = min(starts)
    return parse_value()


# --------------------------------------------------------------------------
# effects 清洗
# --------------------------------------------------------------------------
def sanitize_effects(raw: Any) -> Dict[str, Any]:
    """只保留状态机能理解的键；LLM 不能凭空造数值语义。"""
    out: Dict[str, Any] = {}
    if not isinstance(raw, dict):
        return out
    for key, val in raw.items():
        if not isinstance(key, str):
            continue
        k = key.strip()
        low = k.lower()
        if low in SEMANTIC_EFFECTS:
            out[low] = 1
            continue
        if low in BARE_EFFECT_KEYS:
            num = val if isinstance(val, (int, float)) and not isinstance(val, bool) else 0
            num = max(-100, min(100, int(num)))
            if num:
                out[low] = num
            continue
        if any(low.startswith(p) for p in PREFIX_EFFECT_KEYS):
            num = val if isinstance(val, (int, float)) and not isinstance(val, bool) else 1
            num = max(-10, min(10, int(num)))
            out[k] = num
            continue
    return out


def _as_text(val: Any, default: str = "") -> str:
    if isinstance(val, str):
        return val.strip()
    if val is None:
        return default
    return str(val).strip()


# --------------------------------------------------------------------------
# 结构化转换
# --------------------------------------------------------------------------
def coerce_npcs(data: Any, day: int = 1) -> List[NPC]:
    raw_list: List[Any] = []
    if isinstance(data, dict):
        for key in ("npcs", "people", "characters", "residents", "居民", "人物"):
            if isinstance(data.get(key), list):
                raw_list = data[key]
                break
        if not raw_list and isinstance(data.get("npc"), dict):
            raw_list = [data["npc"]]
    elif isinstance(data, list):
        raw_list = data

    out: List[NPC] = []
    for i, raw in enumerate(raw_list):
        if not isinstance(raw, dict):
            continue
        name = _as_text(raw.get("name") or raw.get("姓名"))
        if not name:
            continue
        role = _as_text(raw.get("role") or raw.get("job") or raw.get("职业"), "镇民")
        traits = raw.get("traits") or raw.get("性格") or []
        if isinstance(traits, str):
            traits = [traits]
        traits = [t for t in (str(x).strip() for x in traits) if t][:5]
        try:
            age = int(raw.get("age") or raw.get("年龄") or 30)
        except Exception:
            age = 30
        trust = 50
        try:
            trust = max(0, min(100, int(raw.get("trust") or 50)))
        except Exception:
            trust = 50
        out.append(
            NPC(
                id=str(raw.get("id") or f"n_{day}_{i}"),
                name=name[:12],
                role=role[:12],
                age=max(14, min(90, age)),
                traits=traits,
                background=_as_text(raw.get("background") or raw.get("背景") or raw.get("past")),
                secret=_as_text(raw.get("secret") or raw.get("秘密")),
                trust=trust,
                mood=max(0, min(100, int(raw.get("mood") or 55))),
                skill=max(1, min(5, int(raw.get("skill") or 2))),
                home_tile=i,
            )
        )
    return out


def normalize_kind(raw: Any) -> str:
    key = _as_text(raw).lower()
    if key in EVENT_KINDS:
        return key
    return KIND_ALIASES.get(key, "social")


def coerce_choices(raw: Any, prefix: str = "c") -> List[Choice]:
    out: List[Choice] = []
    if not isinstance(raw, list):
        return out
    for i, item in enumerate(raw):
        if isinstance(item, str):
            item = {"label": item}
        if not isinstance(item, dict):
            continue
        label = _as_text(item.get("label") or item.get("text") or item.get("选项") or item.get("choice"))
        if not label:
            continue
        effects = sanitize_effects(
            item.get("effects") or item.get("outcome") or item.get("result") or item.get("影响")
        )
        out.append(
            Choice(
                id=str(item.get("id") or f"{prefix}{i}"),
                label=label[:60],
                hint=_as_text(item.get("hint") or item.get("detail") or item.get("说明"))[:80],
                effects=effects,
            )
        )
    return out


def coerce_events(data: Any, day: int = 1, source: str = "llm") -> List[EventCard]:
    raw_list: List[Any] = []
    if isinstance(data, dict):
        for key in ("events", "事件", "cards", "list"):
            if isinstance(data.get(key), list):
                raw_list = data[key]
                break
    elif isinstance(data, list):
        raw_list = data

    out: List[EventCard] = []
    for i, raw in enumerate(raw_list):
        if not isinstance(raw, dict):
            continue
        title = _as_text(raw.get("title") or raw.get("name") or raw.get("标题"))
        text = _as_text(raw.get("text") or raw.get("description") or raw.get("body") or raw.get("正文"))
        if not title or not text:
            continue
        choices = coerce_choices(raw.get("choices") or raw.get("options") or raw.get("branches") or raw.get("选项"))
        try:
            urgency = int(raw.get("urgency") or 0)
        except Exception:
            urgency = 0
        out.append(
            EventCard(
                id=str(raw.get("id") or f"e{day}_{i}"),
                title=title[:40],
                text=text[:600],
                kind=normalize_kind(raw.get("kind") or raw.get("type") or raw.get("类型")),
                choices=choices,
                day=day,
                source=source,
                tags=[str(t).strip() for t in (raw.get("tags") or []) if str(t).strip()][:6],
                urgency=max(0, min(2, urgency)),
            )
        )
    return out


def _match_good(text: Any) -> str:
    """把"粮食""石料""这种写法认成商品代号；认不出返回空串。"""
    t = _as_text(text).lower()
    if not t:
        return ""
    if t in MARKET_GOODS:
        return t
    for key, names in MARKET_ALIASES.items():
        for n in names:
            if n in t:
                return key
    return ""


def _infer_from_news(news: str) -> Tuple[List[str], List[str]]:
    """模型只给了行情消息时，从消息里反推走俏/滞销。"""
    hot: List[str] = []
    cold: List[str] = []
    if not news:
        return hot, cold
    for clause in re.split(r"[，。；、,.!?！？]", news):
        if not clause:
            continue
        goods = []
        for key, names in MARKET_ALIASES.items():
            if any(n in clause for n in names):
                goods.append(key)
        if not goods:
            continue
        if any(w in clause for w in HOT_WORDS):
            for g in goods:
                if g not in hot:
                    hot.append(g)
        elif any(w in clause for w in COLD_WORDS):
            for g in goods:
                if g not in cold:
                    cold.append(g)
    return hot[:3], cold[:3]


def coerce_market(data: Any) -> Optional[MarketBrief]:
    """把 LLM 的行情输出收敛成白名单内的 MarketBrief。

    LLM 只能决定"什么货走俏、什么货滞销、商队可能收什么"，
    具体价格与数量由状态机算。
    """
    if not isinstance(data, dict):
        return None

    def pick(raw: Any, limit: int) -> List[str]:
        if isinstance(raw, str):
            raw = [raw]
        out: List[str] = []
        if not isinstance(raw, list):
            return out
        for item in raw:
            if isinstance(item, dict):
                item = item.get("good") or item.get("name") or item.get("商品") or ""
            key = _match_good(item)
            if key and key not in out:
                out.append(key)
            if len(out) >= limit:
                break
        return out

    hot = pick(data.get("hot") or data.get("hot_goods") or data.get("走俏")
                or data.get("涨价") or data.get("热门"), 3)
    cold = pick(data.get("cold") or data.get("cold_goods") or data.get("滞销")
                or data.get("跌价") or data.get("冷门"), 3)
    caravan = pick(data.get("caravan_hint") or data.get("caravan") or data.get("求购")
                   or data.get("商队"), 2)
    news = _as_text(data.get("news") or data.get("headline") or data.get("消息")
                    or data.get("行情"))[:120]
    if not hot and not cold:
        ihot, icold = _infer_from_news(news)
        hot, cold = ihot, icold
    cold = [g for g in cold if g not in hot]
    if not hot and not cold and not caravan and not news:
        return None
    return MarketBrief(hot=hot, cold=cold, caravan_hint=caravan, news=news, source="llm")


def coerce_action(data: Any) -> Tuple[str, List[Choice]]:
    """DM 模式返回值：(叙事文本, 三个分支)。"""
    narrative = ""
    choices: List[Choice] = []
    if isinstance(data, str):
        return data.strip(), []
    if isinstance(data, list):
        # 直接给了一个列表：当作分支
        choices = coerce_choices(data)
        return "", choices
    if isinstance(data, dict):
        narrative = _as_text(
            data.get("narrative") or data.get("text") or data.get("story") or data.get("描述") or data.get("叙事")
        )
        choices = coerce_choices(
            data.get("choices") or data.get("options") or data.get("branches") or data.get("选项")
        )
        # 兼容 {"narrative": ..., "next": [...]} 之类
        if not choices:
            for key in ("next", "actions", "replies"):
                if isinstance(data.get(key), list):
                    choices = coerce_choices(data[key])
                    break
    return narrative, choices
