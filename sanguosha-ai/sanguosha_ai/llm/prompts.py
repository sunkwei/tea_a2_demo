"""提示词构造。

原则（踩坑经验）：
  * **短**。提示词越啰嗦，推理模型想得越久（MiniMax 从 100s → 6~10s）。
  * 字段写死上限，不让模型自由发挥长文本。
  * 让模型只输出一个「动作编号」，避免它写卡片名/目标名导致对不上。
  * 状态摘要用紧凑列表，不写长句。
"""

from __future__ import annotations

from typing import List, Optional, Sequence

from ..engine import Action, Engine, Player, ResponseCtx

MAX_ACTIONS = 24


def _hand_summary(p: Player) -> str:
    if not p.hand:
        return "无"
    names = [c.name for c in p.hand]
    return "、".join(names)


def _seat_summary(p: Player) -> str:
    eq = "、".join(c.name for c in p.equips.values())
    base = f"{p.name}({p.hero.name}) {p.hp}/{p.max_hp}血 手牌{len(p.hand)}张"
    if eq:
        base += f" 装备:{eq}"
    if not p.alive:
        base += " 已阵亡"
    return base


def build_play_prompt(
    engine: Engine,
    player: Player,
    actions: Sequence[Action],
    turn_no: int,
    phase: str = "出牌",
) -> str:
    lines: List[str] = []
    lines.append(f"【局面】第{turn_no}回合 · {player.name}({player.hero.name}) 的{phase}阶段")
    lines.append(f"你: {player.hero.faction} {player.hp}/{player.max_hp}血 手牌:{_hand_summary(player)}")
    others = [p for p in engine.players if p.idx != player.idx]
    lines.append("他人: " + " | ".join(_seat_summary(p) for p in others))
    lines.append("【可选动作】")
    shown = list(actions)[:MAX_ACTIONS]
    for i, a in enumerate(shown, 1):
        lines.append(f"{i}. {a.label}")
    if len(actions) > len(shown):
        lines.append(f"（其余 {len(actions) - len(shown)} 个动作已省略）")
    lines.append(
        '【输出】只输出 JSON：{"n": 动作编号, "say": "≤20字台词"}。n 必须是上面的编号；'
        "没有好招就选「结束出牌阶段」。"
    )
    return "\n".join(lines)


def build_respond_prompt(
    engine: Engine,
    player: Player,
    ctx: ResponseCtx,
    actions: Sequence[Action],
) -> str:
    others = [p for p in engine.players if p.idx != player.idx and p.alive]
    who = engine.player(ctx.source).name if ctx.source is not None else "对方"
    lines = [f"【情况】{who} 对你 使用【{ctx.card}】。{ctx.reason}"]
    lines.append(
        "你: "
        f"{player.name}({player.hero.name}) {player.hp}/{player.max_hp}血 手牌:{_hand_summary(player)}"
    )
    lines.append("他人: " + " | ".join(_seat_summary(p) for p in others))
    lines.append("【可选动作】")
    for i, a in enumerate(actions, 1):
        lines.append(f"{i}. {a.label}")
    lines.append('【输出】只输出 JSON：{"n": 动作编号, "say": "≤15字台词"}')
    return "\n".join(lines)


def build_system_prompt(player: Player, model_key: str, objective: str = "") -> str:
    hero = player.hero
    obj = objective or "想办法让其他角色阵亡，自己活到最后。"
    return (
        f"你是三国杀对局中的武将【{hero.name}】（{hero.faction}·{hero.title or hero.name}）。\n"
        f"人设：{hero.style}\n"
        f"技能：{hero.skill_desc()}\n"
        f"目标：{obj}\n"
        f"要求：只输出 JSON，不要解释，不要输出思考过程。"
    )


def build_respond_system_prompt(player: Player) -> str:
    hero = player.hero
    return (
        f"你是三国杀对局中的武将【{hero.name}】。人设：{hero.style}\n"
        "当前只需要你做一个快速反应（出闪/出杀/出桃/放弃）。"
        "只输出 JSON：{\"n\": 动作编号, \"say\": \"≤15字台词\"}"
    )
