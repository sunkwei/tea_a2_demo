"""NPC 自主行为：镇上的人不会等你点按钮。

每天早上，这一层会替居民做几件事：
  * 有些事**自己就发生了**（私下和解、结拜、说闲话、悄悄搬走）—— 直接结算并写进镇志；
  * 有些事**必须找镇长裁决**（断粮来求、吵起来、有人要走）—— 生成带分支的事件，
    和 LLM 生成的日常事件混在同一个列表里，等着镇长（真人或 AI）处理。

这样"全 NPC 自动玩"才成立：即使镇长今天什么都不干，镇子也在动。
"""
from __future__ import annotations

from typing import List, Optional, Tuple

from .models import Choice, EventCard, NPC
from .rng import RNG
from .state import TownState


def _alive(state: TownState) -> List[NPC]:
    return [n for n in state.npcs if n.alive]


def _pick(rng: RNG, items: List[NPC]) -> Optional[NPC]:
    return rng.choice(items) if items else None


def _ev(state: TownState, rng: RNG, title: str, text: str, kind: str,
        choices: List[Choice], tags: Optional[List[str]] = None) -> EventCard:
    return EventCard(
        id=f"npc_{state.day}_{rng.randint(100, 999)}",
        title=title,
        text=text,
        kind=kind,
        choices=choices,
        day=state.day,
        source="npc",
        tags=list(tags or []),
    )


# --------------------------------------------------------------------------
# 需要镇长裁决的事
# --------------------------------------------------------------------------
def _need_food(state: TownState, rng: RNG) -> Optional[EventCard]:
    pop = max(1, state.population)
    if state.resource("food") >= pop * 2:
        return None
    who = _pick(rng, _alive(state))
    if who is None:
        return None
    return _ev(
        state, rng, f"{who.name}家的粮缸见底了",
        f"{who.name}在镇公所门口站了好一会儿，才开口说家里只剩半缸米。"
        f"他没说是来求什么，但你听懂了。",
        "social",
        [
            Choice(id="c0", label="开仓放粮，先救急", hint="施恩",
                   effects={"food": -8, "morale": 4, "all_trust": 1, "mercy": 1}),
            Choice(id="c1", label="花钱从集市买一批", hint="稳妥",
                   effects={"coin": -12, "food": 6, "morale": 2}),
            Choice(id="c2", label="让他自己想办法", hint="冷处理",
                   effects={"morale": -4, "trust:" + who.id: -2, "harsh": 1}),
        ],
        tags=["npc", "求助"],
    )


def _need_work(state: TownState, rng: RNG) -> Optional[EventCard]:
    who = _pick(rng, _alive(state))
    if who is None or state.resource("coin") < 20:
        return None
    if state.population > 14:
        return None
    return _ev(
        state, rng, f"{who.name}来问有没有活干",
        f"{who.name}搓着手站在门口，说自己不挑活，只要有个奔头。"
        f"镇上的工位就那么多，多一个人就多一张要吃饭的嘴。",
        "opportunity",
        [
            Choice(id="c0", label="雇下他，管饭管工钱", hint="收人",
                   effects={"coin": -6, "morale": 3, "all_trust": 1}),
            Choice(id="c1", label="给他一件零工先顶着", hint="折中",
                   effects={"coin": -2, "morale": 1}),
            Choice(id="c2", label="眼下没有工，请他再等等", hint="拒",
                   effects={"morale": -3, "trust:" + who.id: -1}),
        ],
        tags=["npc", "求工"],
    )


def _quarrel(state: TownState, rng: RNG) -> Optional[EventCard]:
    alive = _alive(state)
    if len(alive) < 2:
        return None
    a = _pick(rng, alive)
    b = _pick(rng, alive)
    if a is None or b is None or a.id == b.id:
        return None
    rel = a.relations.get(b.id, 0)
    if rel > 20:
        return None  # 关系还行，今天不吵
    return _ev(
        state, rng, f"{a.name}和{b.name}在井台吵起来了",
        f"不知为一句话还是为半袋粮，{a.name}和{b.name}在井台前推搡起来。"
        f"围观的人越聚越多，{a.name}的嗓子已经哑了。",
        "social",
        [
            Choice(id="c0", label="各罚一天工，谁也别占便宜", hint="强硬",
                   effects={"harsh": 1, "coin": 6, "morale": -2}),
            Choice(id="c1", label="让他们把话说完，再各退一步", hint="调解",
                   effects={"kind": 1, "morale": 3, "relation:" + a.id + ":" + b.id: 1}),
            Choice(id="c2", label="分开带开，各打五十大板", hint="和稀泥",
                   effects={"morale": 1, "all_trust": 1, "renown": 1}),
        ],
        tags=["npc", "纠纷"],
    )


def _grudge(state: TownState, rng: RNG) -> Optional[EventCard]:
    alive = _alive(state)
    if state.morale > 45:
        return None
    who = _pick(rng, alive)
    if who is None:
        return None
    return _ev(
        state, rng, f"{who.name}在酒馆里说了你的不是",
        f"{who.name}在酒馆里跟人说，新镇长只会画饼。"
        f"他嗓门不大，但这话传得比什么都快。",
        "social",
        [
            Choice(id="c0", label="当众把话说清楚", hint="正面",
                   effects={"renown": 3, "morale": 2}),
            Choice(id="c1", label="私下找他谈", hint="私下",
                   effects={"trust:" + who.id: 2, "morale": 1}),
            Choice(id="c2", label="装作没听见", hint="冷处理",
                   effects={"morale": -3, "renown": -2}),
        ],
        tags=["npc", "不满"],
    )


def _leaving(state: TownState, rng: RNG) -> Optional[EventCard]:
    alive = [n for n in _alive(state) if n.trust < 40]
    if not alive or state.population <= 3:
        return None
    who = min(alive, key=lambda n: n.trust)
    return _ev(
        state, rng, f"{who.name}收拾行李要走了",
        f"{who.name}把行李捆好了，搁在门口。他说北边有活路，"
        f"这里的事不用他操心。",
        "social",
        [
            Choice(id="c0", label="放软话挽留，赔个不是", hint="挽留",
                   effects={"coin": -8, "trust:" + who.id: 3, "morale": 2}),
            Choice(id="c1", label="给他盘缠，让他走得体面", hint="成全",
                   effects={"coin": -4, "population": -1, "renown": 2}),
            Choice(id="c2", label="不加挽留", hint="冷",
                   effects={"population": -1, "morale": -3}),
        ],
        tags=["npc", "出走"],
    )


def _quest_push(state: TownState, rng: RNG) -> Optional[EventCard]:
    quest = state.active_quest()
    if quest is None:
        return None
    alive = _alive(state)
    who = _pick(rng, alive)
    if who is None:
        return None
    return _ev(
        state, rng, f"{who.name}说想起了「{quest.title}」的事",
        f"{who.name}忽然说起「{quest.title}」——他说他年轻时在旧镇长手下做过事，"
        f"记得那年冬天，镇公所的灯亮到很晚。",
        "mystery",
        [
            Choice(id="c0", label="追问下去", hint="推进主线",
                   effects={"quest:" + quest.id: 1, "coin": -3, "flag:追查": 1}),
            Choice(id="c1", label="记下来，改天再谈", hint="缓",
                   effects={"morale": 1, "discover:新线索": 1}),
            Choice(id="c2", label="不置可否", hint="冷处理",
                   effects={"morale": -1}),
        ],
        tags=["npc", "主线"],
    )


# --------------------------------------------------------------------------
# 不用镇长管，自己就发生的事
# --------------------------------------------------------------------------
def _self_happenings(state: TownState, rng: RNG) -> List[str]:
    out: List[str] = []
    alive = _alive(state)
    if len(alive) < 2:
        return out

    # 关系好的人私下走近一步
    pairs = []
    for a in alive:
        for b in alive:
            if a.id < b.id and a.relations.get(b.id, 0) > 25:
                pairs.append((a, b))
    if pairs and rng.chance(0.45):
        a, b = rng.choice(pairs)
        a.relations[b.id] = min(100, a.relations.get(b.id, 0) + rng.randint(1, 4))
        b.relations[a.id] = min(100, b.relations.get(a.id, 0) + rng.randint(1, 4))
        out.append(f"{a.name}和{b.name}的关系近了一些。")

    # 关系差的人结下新梁子
    bad = []
    for a in alive:
        for b in alive:
            if a.id < b.id and a.relations.get(b.id, 0) < -25:
                bad.append((a, b))
    if bad and rng.chance(0.35):
        a, b = rng.choice(bad)
        a.relations[b.id] = max(-100, a.relations.get(b.id, 0) - rng.randint(1, 4))
        b.relations[a.id] = max(-100, b.relations.get(a.id, 0) - rng.randint(1, 4))
        out.append(f"{a.name}和{b.name}又吵了一次，关系更僵了。")

    # 闲话传开了
    if rng.chance(0.2):
        out.append("镇上传开了一些关于镇长的闲话。")
        state.bump_behavior("rumor")

    # 私下的互赠
    if rng.chance(0.25):
        who = _pick(rng, alive)
        other = _pick(rng, alive)
        if who and other and who.id != other.id:
            who.mood = min(100, who.mood + 3)
            other.mood = min(100, other.mood + 3)
            out.append(f"{who.name}悄悄给{other.name}送了点东西，两人都没声张。")
    return out


# --------------------------------------------------------------------------
# 对外接口
# --------------------------------------------------------------------------
def daily_npc_events(state: TownState, rng: RNG, max_events: int = 2) -> Tuple[List[EventCard], List[str]]:
    """返回 (需要镇长裁决的事件, 居民自己发生的事)。"""
    makers = [_need_food, _need_work, _quarrel, _grudge, _leaving, _quest_push]
    events: List[EventCard] = []
    used: List[str] = []
    for maker in makers:
        if len(events) >= max_events:
            break
        try:
            ev = maker(state, rng)
        except Exception:  # noqa: BLE001 —— NPC 生活出问题也不能让游戏崩
            ev = None
        if ev is not None and ev.title not in used:
            events.append(ev)
            used.append(ev.title)
    happenings = _self_happenings(state, rng)
    return events, happenings
