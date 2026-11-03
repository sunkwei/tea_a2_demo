"""结局系统：17 种结局，全部由可观测的行为模式决定。

判定顺序即"稀有度"：越特殊的结局越先判定，最后兜底到"寻常镇生"。
"""
from __future__ import annotations

from typing import Callable, Dict, List, Optional

from .models import Ending
from .state import TownState

Checker = Callable[[TownState], bool]


def _b(state: TownState, tag: str) -> int:
    return int(state.behavior.get(tag, 0))


def _has_building(state: TownState, kind: str, level: int = 1) -> bool:
    return any(b.kind == kind and b.level >= level for b in state.buildings)


def _quest_done(state: TownState) -> bool:
    return any(q.status == "done" for q in state.quests)


def _quest_failed(state: TownState) -> bool:
    return any(q.status == "failed" for q in state.quests)


def _all_met(state: TownState) -> bool:
    alive = [n for n in state.npcs if n.alive]
    return bool(alive) and all(n.met for n in alive)


def _neg_relations(state: TownState) -> int:
    neg = 0
    for n in state.npcs:
        for v in n.relations.values():
            if v < -20:
                neg += 1
    return neg


def _interactions(state: TownState) -> int:
    return len(state.memory)


# --------------------------------------------------------------------------
# 结局表
# --------------------------------------------------------------------------
ENDINGS: List[Dict[str, object]] = [
    {
        "key": "legend",
        "title": "传奇镇长",
        "tone": "good",
        "check": lambda s: (
            s.morale >= 85 and s.resource("renown") >= 70 and s.resource("coin") >= 700
            and s.population >= 14 and s.avg_trust >= 72
        ),
        "text": "多年以后，人们讲起你的名字，不再加「镇长」两个字。"
                "粮仓满着，路上有商队，学堂里有孩子朗朗读书。"
                "他们说那几年，小镇像是被谁重新写了一遍。",
    },
    {
        "key": "golden_age",
        "title": "黄金时代",
        "tone": "good",
        "check": lambda s: s.resource("coin") >= 850 and s.morale >= 80 and s.population >= 12,
        "text": "账房先生把这一年的数目念了三遍，越念越高兴。"
                "仓廪里有的是粮，柜里有的是钱，人人有活干。"
                "这是小镇几十年来最像样的一个年景。",
    },
    {
        "key": "academy",
        "title": "学院之城",
        "tone": "good",
        "check": lambda s: _has_building(s, "school", 2) and s.stock_of("books") >= 8,
        "text": "学堂的孩子已经能自己抄书了。有人说这里将来会出个大学，"
                "会有人从很远的地方来求学。你听了，只是笑了笑——"
                "当初你只是想让一个孤儿认得几个字。",
    },
    {
        "key": "trade_empire",
        "title": "商路繁荣",
        "tone": "good",
        "check": lambda s: _b(s, "trade") >= 8 and s.resource("coin") >= 550,
        "text": "商队开始把这里当中转站。夜里集市的灯一直亮到三更，"
                "驮马的铃铛声从山口一直排到镇门。",
    },
    {
        "key": "magnate",
        "title": "巨贾之镇",
        "tone": "mixed",
        "check": lambda s: s.resource("coin") >= 1400,
        "text": "你的钱多得数不过来。可镇民们看你的眼神，和看钱庄掌柜的一模一样。"
                "他们恭恭敬敬地叫你大人，却不再跟你说心里话。",
    },
    {
        "key": "fellowship",
        "title": "群贤毕至",
        "tone": "good",
        "check": lambda s: s.avg_trust >= 78 and _all_met(s) and s.population >= 8,
        "text": "每个人你都叫得出名字，也知道他们家里的难处。"
                "议事那天，所有人都在，你一句，他们一句，"
                "最后竟没有一个人反对你。",
    },
    {
        "key": "benevolent",
        "title": "仁爱之镇",
        "tone": "good",
        "check": lambda s: _b(s, "mercy") >= 9 and s.morale >= 70,
        "text": "你掏空了自己的钱袋，填满了别人的肚子。"
                "有人在你家门口放了鸡蛋，有人往你窗台上塞了一束野花。"
                "这座小镇记得。",
    },
    {
        "key": "mystery_solved",
        "title": "悬案终章",
        "tone": "good",
        "check": lambda s: _quest_done(s),
        "text": "旧镇长留下的那件事终于有了答案。"
                "你在祠堂前把真相念了出来，风把纸吹得哗哗响。"
                "从此以后，小镇的孩子们都记得这个故事——"
                "一个镇长，怎样用一年的时间，把所有人的谎话拆干净。",
    },
    {
        "key": "mystery_failed",
        "title": "悬案未解",
        "tone": "bad",
        "check": lambda s: _quest_failed(s),
        "text": "那件事终究没有查清。有人在夜里烧掉了最后一页账簿，"
                "从此再没有人提起那个名字。你在任期的最后一天，"
                "把那本笔记锁进了柜子最底下。",
    },
    {
        "key": "iron_hand",
        "title": "铁腕镇长",
        "tone": "bad",
        "check": lambda s: _b(s, "harsh") >= 8,
        "text": "你的命令被执行得很快，没有人问为什么。"
                "镇子确实整齐了：粮仓的锁是新的，酒馆的灯是灭的，"
                "议事厅的椅子空了一半。",
    },
    {
        "key": "corrupt",
        "title": "贪墨者",
        "tone": "bad",
        "check": lambda s: _b(s, "greed") >= 10 and s.resource("renown") < 32,
        "text": "镇公所的账越做越厚，你越看越满意。"
                "只是夜里翻来覆去睡不着时，你会想起第一天到任，"
                "那个把全部家当放在桌上的老农。",
    },
    {
        "key": "rumors",
        "title": "流言蜚语",
        "tone": "bad",
        "check": lambda s: _neg_relations(s) >= 3 or _b(s, "rumor") >= 5,
        "text": "镇上有太多关于你的说法。"
                "有人说你在南坡埋了东西，有人说你和某某有一笔说不清的钱。"
                "你走过的路上，背后总有声音低下去。",
    },
    {
        "key": "exodus",
        "title": "人心离散",
        "tone": "bad",
        "check": lambda s: s.population <= 4 and s.morale <= 45,
        "text": "走的人比来的多。他们不打招呼，只把门带上。"
                "最后一天你在镇口站了很久，风很大，"
                "只有旧招牌还在响。",
    },
    {
        "key": "granary_empty",
        "title": "粮仓见底",
        "tone": "bad",
        "check": lambda s: s.resource("food") <= 0 and s.morale < 55,
        "text": "仓门推开时，里面回声很大。"
                "有人开始挖冬眠的草根，有人把种子袋里的谷子倒出来数了三遍。"
                "你终于明白，冬天不是一句话，是一把秤。",
    },
    {
        "key": "ruin",
        "title": "断壁残垣",
        "tone": "bad",
        "check": lambda s: len(s.buildings) <= 1 and s.population <= 4,
        "text": "你上任时是什么样，现在还是什么样——甚至更差。"
                "只有一座半塌的屋子和一个还在扫地的老人认得你。",
    },
    {
        "key": "hard_winter",
        "title": "苦冬",
        "tone": "mixed",
        "check": lambda s: s.season == "冬" and s.resource("food") < max(4, s.population * 2),
        "text": "雪下了四十天。柴不够，粮不够，笑话也不够。"
                "你熬过了一个冬天，但小镇瘦了一大圈。",
    },
    {
        "key": "hermit",
        "title": "隐世之镇",
        "tone": "neutral",
        "check": lambda s: s.day >= 10 and _interactions(s) <= 3,
        "text": "你几乎什么都没做。镇子照旧日出日落，照旧有人吵架有人和好。"
                "多年以后人们谈起你，只说："
                "「哦，那个镇长，挺好的人，就是没什么存在感。」",
    },
    {
        "key": "ordinary",
        "title": "寻常镇生",
        "tone": "neutral",
        "check": lambda s: True,
        "text": "没有奇迹，也没有崩塌。粮食勉强够吃，税收勉强够用，"
                "冬天来了又走了。镇上的人说："
                "「新镇长？还行吧，跟前任差不多。」",
    },
]

ENDING_INDEX: Dict[str, Dict[str, object]] = {e["key"]: e for e in ENDINGS}


def evaluate(state: TownState) -> Ending:
    """按稀有度判定结局。"""
    for entry in ENDINGS:
        checker: Checker = entry["check"]  # type: ignore[assignment]
        try:
            hit = checker(state)
        except Exception:
            hit = False
        if hit:
            return Ending(
                key=str(entry["key"]),
                title=str(entry["title"]),
                text=str(entry["text"]),
                tone=str(entry["tone"]),
            )
    return Ending(key="ordinary", title="寻常镇生", text="一切如常。", tone="neutral")


def ending_summary(state: TownState) -> List[Dict[str, object]]:
    """给玩家看的"可能达成"提示（只暴露标题，不剧透）。"""
    out = []
    for entry in ENDINGS:
        if entry["key"] == "ordinary":
            continue
        out.append({"key": entry["key"], "title": entry["title"], "tone": entry["tone"]})
    return out


def progress_hints(state: TownState) -> List[str]:
    """当前状态距离哪些结局最近（提示用）。"""
    hints: List[str] = []
    if state.morale >= 70:
        hints.append("民心高涨——某些结局正在靠近")
    if state.avg_trust >= 70:
        hints.append("居民信任你——某些结局正在靠近")
    if state.resource("coin") >= 700:
        hints.append("金库充盈——某些结局正在靠近")
    if state.resource("food") <= 0:
        hints.append("粮仓已空——危险")
    if state.population <= 4:
        hints.append("人口稀少——危险")
    if _quest_failed(state):
        hints.append("主线已失败")
    return hints
