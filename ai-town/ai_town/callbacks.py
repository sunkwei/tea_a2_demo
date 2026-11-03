"""记忆驱动「翻旧账」：把玩家过去做过的事，变成今天找上门的事件。

设计要点：
  * 检索用确定性规则（当前处境 + 行为倾向 + 新近度），不烧 LLM 额度；
  * 事件文本必须点名"第几天你做了什么"，玩家一眼能认出这是自己干的；
  * 后果仍然走语义标签 -> 状态机结算，LLM 不直接改数值。

这一层是规格里"记忆驱动：LLM 记得玩家做过的每件事，用来生成翻旧账式事件"的落地实现。
"""
from __future__ import annotations

from typing import Dict, List, Optional, Tuple

from .models import Choice, EventCard, MemoryEntry, NPC
from .rng import RNG
from .state import TownState

#: 处境 -> 相关记忆的关键词（标签或文本里出现即加分）
NEED_KEYWORDS: Dict[str, Tuple[str, ...]] = {
    "food": ("food", "hunger", "gather", "gift", "generous", "开仓", "粮"),
    "coin": ("trade", "coin", "greedy", "caravan", "买卖", "商队"),
    "morale": ("morale", "kind", "festival", "trust", "民心", "安抚"),
    "trust": ("trust", "talk", "all_trust", "关系", "谈"),
    "build": ("build", "hire", "建", "雇"),
    "quest": ("quest", "flag", "clue", "线索", "追查"),
}

#: 行为倾向 -> 相关记忆关键词
BEHAVIOR_KEYWORDS: Dict[str, Tuple[str, ...]] = {
    "mercy": ("kind", "generous", "gift", "popular"),
    "harsh": ("harsh", "fear", "cheap"),
    "greed": ("greedy", "trade", "coin"),
    "labor": ("build", "work", "gather", "hire"),
    "order": ("law", "flag"),
    "curiosity": ("scout", "study", "flag", "调查"),
    "bold": ("bold", "risk"),
    "social": ("talk", "relation"),
}

PLACES = ["井台", "石桥", "老磨坊", "祠堂前的空地", "南坡的篱笆", "码头",
          "旧兵营", "河湾的芦苇荡", "集市尽头", "学堂后院", "镇外的碑林"]

GRUDGE_TAGS = {"harsh", "fear", "cheap", "greed"}
FAVOR_TAGS = {"kind", "generous", "gift", "popular", "patient"}

#: 泛泛的记忆（只有"做过某事"，没有具体后果），翻旧账价值低
GENERIC_TAGS = {"action", "choice", "event", "talk", "start", "market", "build", "trade", "quest"}


# --------------------------------------------------------------------------
# 检索
# --------------------------------------------------------------------------
def _need_context(state: TownState) -> List[str]:
    """当前最紧要的几个问题，决定"翻哪一笔旧账"更有戏剧性。"""
    out: List[str] = []
    pop = max(1, state.population)
    if state.resource("food") < pop * 2:
        out.append("food")
    if state.resource("coin") < 80:
        out.append("coin")
    if state.morale < 50:
        out.append("morale")
    if state.avg_trust < 45:
        out.append("trust")
    if state.active_quest():
        out.append("quest")
    if not out:
        out.append("trust")
    return out


def score_memory(state: TownState, m: MemoryEntry) -> int:
    """给一条记忆打分：越相关、越贴近当前处境、越具体、越新，分数越高。"""
    score = 0
    blob = f"{m.text} {' '.join(m.tags or [])}"
    for need in _need_context(state):
        if any(k in blob for k in NEED_KEYWORDS.get(need, ())):
            score += 3
    for tag, count in (state.behavior or {}).items():
        if count <= 0:
            continue
        if any(k in blob for k in BEHAVIOR_KEYWORDS.get(tag, ())):
            score += 2
    # 越具体的记忆越适合拿来翻旧账（带具体效果标签的 > 只有"做过某事"的）
    specific = [t for t in (m.tags or []) if t not in GENERIC_TAGS]
    score += min(3, len(specific))
    # 新近度
    age = max(0, state.day - m.day)
    score += max(0, 4 - age // 3)
    return score


def recall(state: TownState, limit: int = 3) -> List[MemoryEntry]:
    """取回最值得"翻"的旧事（确定性，不需要 LLM）。"""
    if not state.memory:
        return []
    scored = [(score_memory(state, m), i, m) for i, m in enumerate(state.memory)]
    scored.sort(key=lambda t: (-t[0], -t[2].day, -t[1]))
    picked = [m for s, _i, m in scored[:limit] if s > 0]
    return picked


def recall_lines(state: TownState, limit: int = 3) -> str:
    """给提示词用的"最相关的旧事"清单。"""
    picked = recall(state, limit=limit)
    if not picked:
        return ""
    return "\n".join(f"- 第{m.day}天：{m.text}" for m in picked)


# --------------------------------------------------------------------------
# 旧事分类
# --------------------------------------------------------------------------
def _classify(state: TownState, m: MemoryEntry) -> str:
    tags = set(m.tags or [])
    flags = [t.split(":", 1)[1] for t in tags if str(t).startswith("flag:")]
    if any(f in ("旧账", "调查线索", "追查", "追查旧账") for f in flags):
        return "old_debt"
    if any(f in ("碑林", "夜访者", "空白信") for f in flags):
        return "mystery_echo"
    if m.kind == "build":
        return "old_works"
    if m.kind == "trade":
        return "old_trade"
    if m.kind == "talk":
        return "old_promise"
    if m.kind == "action":
        return "old_deed"
    if m.kind == "event":
        if tags & GRUDGE_TAGS:
            return "old_grudge"
        if tags & FAVOR_TAGS:
            return "old_favor"
        return "old_deed"
    return "old_deed"


def _short(text: str, limit: int = 34) -> str:
    text = (text or "").strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _pick_npc(state: TownState, rng: RNG, prefer_low_trust: bool = False) -> Optional[NPC]:
    alive = [n for n in state.npcs if n.alive]
    if not alive:
        return None
    if prefer_low_trust:
        grumpy = [n for n in alive if n.trust < 55]
        if grumpy and rng.chance(0.7):
            return rng.choice(grumpy)
    return rng.choice(alive)


# --------------------------------------------------------------------------
# 事件模板
# --------------------------------------------------------------------------
def _build_event(
    state: TownState,
    rng: RNG,
    title: str,
    text: str,
    choices: List[Choice],
    kind: str = "social",
) -> EventCard:
    return EventCard(
        id=f"cb_{state.day}_{rng.randint(100, 999)}",
        title=title,
        text=text,
        kind=kind,
        choices=choices,
        day=state.day,
        source="template",
        tags=["callback"],
    )


def _make(state: TownState, rng: RNG, m: MemoryEntry) -> Optional[EventCard]:
    """根据旧事类型，造一件今天找上门的事。"""
    deed = _short(m.text)
    kind = _classify(state, m)
    place = rng.choice(PLACES)
    npc = _pick_npc(state, rng, prefer_low_trust=(kind == "old_grudge"))
    if npc is None:
        return None
    nid = npc.id
    name = npc.name

    if kind == "old_favor":
        return _build_event(
            state, rng, "旧恩上门",
            f"{name}提着一篮子东西站在镇公所门口，说没什么事，只是路过。"
            f"你认得那样东西——第{m.day}天，{deed}。你大概早忘了，{name}没忘。",
            [
                Choice(id="c0", label="收下，把当年的事说开", hint="认下这份情",
                       effects={"trust:" + nid: 2, "morale": 3, "renown": 2}),
                Choice(id="c1", label="收下，并让全镇都知道", hint="扬名",
                       effects={"renown": 6, "morale": 3, "coin": -4}),
                Choice(id="c2", label="婉拒，请他留下喝口水", hint="不欠人情",
                       effects={"trust:" + nid: 1, "morale": 2}),
            ],
        )

    if kind == "old_grudge":
        return _build_event(
            state, rng, "旧账被翻出来",
            f"祠堂的门上贴着一张纸，写着：{deed}。没有落款，可镇上每个人都认得那是谁干的。"
            f"{name}站在人群里，看你的眼神跟往常不一样了。",
            [
                Choice(id="c0", label="当众认下，赔个不是", hint="低头",
                       effects={"morale": 5, "renown": -2, "coin": -6}),
                Choice(id="c1", label="把纸揭了，不予理会", hint="强硬",
                       effects={"morale": -3, "coin": 3, "harsh": 1}),
                Choice(id="c2", label="暗地里追查是谁贴的", hint="查",
                       effects={"coin": -5, "renown": 2, "flag:追查旧账": 1}),
            ],
        )

    if kind == "old_debt":
        quest = state.active_quest()
        effects_q = {"quest:" + quest.id: 1} if quest else {"flag:旧账": 1}
        return _build_event(
            state, rng, "旧线索的回响",
            f"{name}带来一件东西，放在桌上就不肯说话——{place}底下挖出来的。"
            f"它和第{m.day}天那件事有关：{deed}。",
            [
                Choice(id="c0", label="收下，接着往下查", hint="追",
                       effects=dict(effects_q, **{"discover:旧线索": 1})),
                Choice(id="c1", label="先按住这件事，安抚人心", hint="稳",
                       effects={"morale": 3, "all_trust": 1}),
                Choice(id="c2", label="让他先别对外说", hint="压",
                       effects={"renown": -2, "trust:" + nid: 1}),
            ],
            kind="mystery",
        )

    if kind == "mystery_echo":
        return _build_event(
            state, rng, "旧案又有人提起",
            f"酒馆里不知谁提起了{deed}，当年在场的人这回也在。"
            f"{name}把杯子推远了一点，看了你一眼。",
            [
                Choice(id="c0", label="主动把话挑明", hint="摊牌",
                       effects={"renown": 3, "morale": 3, "trust:" + nid: 1}),
                Choice(id="c1", label="让酒馆散了，各回各家", hint="压",
                       effects={"harsh": 1, "coin": 4, "morale": -1}),
                Choice(id="c2", label=f"私下找{name}问清楚", hint="问",
                       effects={"coin": -3, "discover:新线索": 1, "trust:" + nid: 1}),
            ],
            kind="mystery",
        )

    if kind == "old_works":
        works = [b.name for b in state.buildings]
        work = rng.choice(works) if works else "你修的那处地方"
        return _build_event(
            state, rng, "旧工程出事了",
            f"{place}那边出了事：{work}的顶梁裂了，{name}是第一个跑来告诉你的。"
            f"那是第{m.day}天{deed}之后的事。",
            [
                Choice(id="c0", label="立刻停工修缮", hint="稳妥",
                       effects={"coin": -12, "morale": 5, "renown": 2}),
                Choice(id="c1", label="先加固再继续用", hint="省钱",
                       effects={"coin": -6, "morale": 1}),
                Choice(id="c2", label="先查是谁偷的工", hint="追责",
                       effects={"coin": -4, "renown": 1, "flag:追查旧账": 1, "harsh": 1}),
            ],
            kind="opportunity",
        )

    if kind == "old_trade":
        return _build_event(
            state, rng, "老买卖找上门",
            f"{name}带着当年那张契子来敲门：{deed}。他想续上这笔交情，"
            f"也想看看你还认不认从前的价。",
            [
                Choice(id="c0", label="续约，给个公道价", hint="守信",
                       effects={"coin": -8, "trade": 1, "trust:" + nid: 1}),
                Choice(id="c1", label="婉拒，另找别家", hint="逐利",
                       effects={"coin": 7, "greedy": 1}),
                Choice(id="c2", label="让他替你去跟行商谈", hint="借力",
                       effects={"renown": 3, "trade": 1, "coin": 2}),
            ],
            kind="opportunity",
        )

    if kind == "old_promise":
        return _build_event(
            state, rng, "有人来讨一句承诺",
            f"{name}在门口站了很久才敲门。他说起第{m.day}天的事：{deed}。"
            f"你当时说过一句话，他记到现在。",
            [
                Choice(id="c0", label="兑现当初的承诺", hint="认账",
                       effects={"coin": -10, "renown": 4, "trust:" + nid: 2}),
                Choice(id="c1", label="解释当初的难处", hint="推",
                       effects={"morale": -2, "trust:" + nid: 1}),
                Choice(id="c2", label="反过来要他先出把力", hint="强",
                       effects={"coin": 8, "morale": -4, "harsh": 1}),
            ],
        )

    return _build_event(
        state, rng, "旧事找上门",
        f"{name}在{place}拦住你，说起第{m.day}天的事：{deed}。"
        f"那之后，镇上有些事悄悄变了，今天轮到他来问个明白。",
        [
            Choice(id="c0", label="认真听完", hint="听",
                   effects={"trust:" + nid: 2, "morale": 2}),
            Choice(id="c1", label="先处理手头别的事", hint="拖",
                   effects={"morale": -2, "coin": 3}),
            Choice(id="c2", label="反问他凭什么这么问", hint="硬",
                   effects={"harsh": 1, "coin": 4, "trust:" + nid: -1}),
        ],
    )


def callback_event(state: TownState, rng: RNG) -> Optional[EventCard]:
    """造一件"翻旧账"事件；没有可用记忆时返回 None。"""
    picked = recall(state, limit=3)
    if not picked:
        return None
    m = picked[0]
    try:
        ev = _make(state, rng, m)
    except Exception:  # noqa: BLE001 —— 叙事失败绝不能把游戏卡死
        return None
    if ev is None:
        return None
    state.add_memory("event", f"旧事重现：{ev.title}", ["callback", ev.kind])
    return ev


def maybe_inject(
    state: TownState,
    events: List[EventCard],
    rng: RNG,
    chance: float = 0.55,
) -> Optional[EventCard]:
    """把翻旧账事件插进今天的事件列表（保持每天 3~5 件）。"""
    if any("callback" in (e.tags or []) for e in events):
        return None
    if not state.memory or not rng.chance(chance):
        return None
    ev = callback_event(state, rng)
    if ev is None:
        return None
    events.insert(0, ev)
    while len(events) > 5:
        events.pop()
    return ev
