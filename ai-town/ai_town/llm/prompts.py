"""提示词模板。

原则：给规则，不给剧本。
我们只规定"小镇允许发生哪几类事""每个字段必须怎么填""数值标签只能用哪些"，
具体内容交给模型自由发挥。

注意（MiniMax-M3.1-Flash 是重度推理模型）：
提示词越啰嗦，它想得越久。实测把字段长度上限写清楚、用词收紧，
单次调用能从 100s 压到 6~10s。所以这里的提示词都尽量短。
"""
from __future__ import annotations

from typing import Optional

from ..models import NPC
from ..state import SEMANTIC_EFFECTS, TownState

EFFECT_VOCAB = (
    "effects 只能用这些键："
    "coin/food/wood/stone/ore/renown(整数)、morale(整数)、population(整数)、"
    '"trust:<npc_id>"、"relation:<a>:<b>"、"flag:<词>"、"behavior:<标签>"、'
    '"build:<farm|lumber|quarry|mine|market|tavern|school|clinic|workshop>"、'
    '"risk:low|risk:high"、' +
    "、".join(sorted(SEMANTIC_EFFECTS.keys())) +
    "。数值幅度控制在 -20~20。"
)

JSON_ONLY = "只输出一个 JSON 对象，不要解释，不要 markdown 代码块，输出紧凑 JSON，直接给结果。"

DM_SYSTEM = (
    "你是中文文字经营游戏《AI 小镇：无限人生》的主持人（DM）。玩家是新镇长。\n"
    "要求：叙述 120~220 字，有画面感；不替玩家做决定；给出 3 个可选分支；"
    "呼应玩家做过的事；不写元叙述。\n"
    "每个分支必须带 effects 表示后果倾向（真实数值由规则系统计算）："
    "善待居民{\"kind\":1}、施恩{\"generous\":1}、赚钱{\"coin\":8}、花钱{\"costly\":1}、"
    "安抚民心{\"morale\":3}、冒险{\"risk\":\"high\"}、建集市{\"build:market\":1}、"
    "拉人入伙{\"all_trust\":1}。\n" + JSON_ONLY
)

NPC_SYSTEM = (
    "你是游戏《AI 小镇：无限人生》的角色设计师，为小镇生成居民。\n"
    "每人字段：name 姓名、role 职业、age 年龄、traits 两个性格词、"
    "background 不超过30字、secret 不超过25字、trust 50、skill 2。\n"
    "职业限定：农夫、铁匠、商人、学者、医匠、猎人、牧人、鞋匠、酒馆主、游吟诗人、老镇长、孤儿。\n"
    "秘密要能在后续剧情里引爆。\n" + JSON_ONLY
)

EVENT_SYSTEM = (
    "你是游戏《AI 小镇：无限人生》的事件导演，生成当天发生的 3~5 件事。\n"
    "类型只有五类：disaster 天灾、social 人情、opportunity 商机、mystery 悬案、routine 日常。\n"
    "每件事字段：title 标题、kind 类型、text 正文(60~120字)、"
    "choices 三个分支(每项 label 短句、hint 提示、effects)。\n"
    "事件要呼应小镇当前处境（缺粮别写丰收，缺钱别写大商队）。\n"
    "每个分支必须带 effects，例：{\"label\":\"开仓放粮\",\"hint\":\"安抚饥民\","
    "\"effects\":{\"food\":-8,\"morale\":6,\"kind\":1}}\n" + JSON_ONLY + "\n" + EFFECT_VOCAB
)

QUEST_SYSTEM = (
    "你是游戏《AI 小镇：无限人生》的剧情设计师，生成一条专属主线。\n"
    "字段：title、premise(80~150字)、goal、stages 三个阶段、target_npc(某个居民姓名)、"
    "clues 两个线索、reward。\n"
    "主线要有钩子、有可疑的人、有三个阶段。不要写结局。\n" + JSON_ONLY
)

TALK_SYSTEM = (
    "你扮演游戏《AI 小镇：无限人生》里的一个居民，与镇长对话。\n"
    "用第一人称，口语化，保留这个人的性格与秘密；被追问秘密会闪烁其词。\n"
    "最后给 3 个镇长可以继续的分支。\n" + JSON_ONLY
)


def _npc_lines(state: TownState) -> str:
    lines = []
    for n in state.npcs:
        if not n.alive:
            continue
        bits = [f"{n.id}={n.name}({n.role})"]
        if n.traits:
            bits.append("/".join(n.traits))
        if n.background:
            bits.append(n.background)
        if n.secret and n.trust >= 60:
            bits.append("秘密(愿意说):" + n.secret)
        bits.append(f"信任{n.trust}")
        lines.append("- " + "；".join(bits))
    return "\n".join(lines) if lines else "- 镇上还没有居民"


def _memory_lines(state: TownState, limit: int = 10) -> str:
    if not state.memory:
        return "- 还没有值得记住的事"
    return "\n".join(f"- 第{m.day}天：{m.text}" for m in state.memory[-limit:])


def npc_prompt(state: TownState, count: int = 8) -> str:
    return (
        f"小镇：{state.name}，第{state.year}年{state.season}季第{state.day}天。镇长刚上任。\n"
        f"请生成 {count} 位居民。"
        '输出：{"npcs":[{"name":"","role":"","age":30,"traits":["",""],'
        '"background":"","secret":"","trust":50,"skill":2}]}'
    )


def events_prompt(state: TownState, count: int = 4) -> str:
    return (
        f"{state.world_brief()}\n"
        f"居民：{_npc_lines(state)}\n"
        f"镇长做过的事：{_memory_lines(state)}\n"
        f"生成今天的 {count} 件事。"
        '输出：{"events":[{"title":"","kind":"social","text":"",'
        '"choices":[{"label":"","hint":"","effects":{}}]}]}'
    )


def dm_prompt(state: TownState, player_action: str, focus_npc: Optional[NPC] = None) -> str:
    focus = ""
    if focus_npc is not None:
        focus = (f"\n对话对象：{focus_npc.name}（{focus_npc.role}，性格 {'/'.join(focus_npc.traits)}，"
                 f"信任{focus_npc.trust}，秘密：{focus_npc.secret}）")
    return (
        f"{state.world_brief()}{focus}\n"
        f"镇长做过的事：{_memory_lines(state)}\n"
        f"镇长刚决定：「{player_action}」\n"
        "请叙述这件事的结果，并给出 3 个分支。"
        '输出：{"narrative":"","choices":[{"label":"","hint":"","effects":{}}]}'
    )


def quest_prompt(state: TownState) -> str:
    return (
        f"{state.world_brief()}\n"
        f"居民：{_npc_lines(state)}\n"
        f"镇长行为记录：{state.behavior}\n"
        f"做过的事：{_memory_lines(state, limit=15)}\n"
        "生成一条主线。"
        '输出：{"title":"","premise":"","goal":"","target_npc":"居民姓名",'
        '"stages":["","",""],"clues":["",""],"reward":{"renown":10,"coin":60}}'
    )


def talk_prompt(state: TownState, npc: NPC, player_text: str) -> str:
    return (
        f"{state.world_brief()}\n"
        f"你扮演：{npc.name}，{npc.role}，{npc.age}岁，性格 {'/'.join(npc.traits) or '普通'}。\n"
        f"背景：{npc.background}\n秘密：{npc.secret}\n"
        f"你对镇长的信任 {npc.trust}/100。\n"
        f"镇长说：「{player_text}」\n"
        "请以该角色口吻回应，并给 3 个分支。"
        '输出：{"narrative":"","choices":[{"label":"","hint":"","effects":{}}]}'
    )
