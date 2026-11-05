"""三国杀 · AI 对局 —— 规则引擎（纯逻辑，不含任何 LLM 依赖）。

设计目标：
  * 引擎完全确定：同样的种子 + 同样的动作序列 → 同样的结果，便于测试与复盘。
  * 引擎不直接调用模型。引擎只负责「给出合法动作列表」和「执行动作」，
    由上层 Session 把合法动作翻译成提示词给模型，再把模型的选择翻译回动作。

座位采用**环形排布**（与真实三国杀一致）：两名角色之间的座位距离 =
min(|i-j|, 人数-|i-j|)。所以 3 人局里彼此都是邻座，攻击范围 1 就能互相攻击；
4 人及以上时「赤兔」「烈弓」「绝影」这类加距离的装备才有实际意义。
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Sequence, Tuple

from .cards import Card, DeckSpec, build_deck
from .heroes import HEROES, Hero
from .rng import Rng

# --------------------------------------------------------------------------
# 基础数据结构
# --------------------------------------------------------------------------


@dataclass
class Player:
    idx: int
    name: str
    hero: Hero
    hp: int
    max_hp: int
    hand: List[Card] = field(default_factory=list)
    equips: Dict[str, Card] = field(default_factory=dict)  # weapon/armor/horse_att/horse_def
    alive: bool = True
    model: str = ""  # 控制该角色的模型名（人类则为空）
    seat_label: str = ""

    # --- 回合内的临时状态 ---
    sha_used: int = 0
    jiu_ready: bool = False
    skills_used: List[str] = field(default_factory=list)

    @property
    def skills(self) -> List[str]:
        return [s.key for s in self.hero.skills]

    def has_skill(self, key: str) -> bool:
        return any(s.key == key for s in self.hero.skills)

    def skill_desc(self, key: str) -> str:
        for s in self.hero.skills:
            if s.key == key:
                return s.desc
        return ""

    def reset_turn_state(self) -> None:
        self.sha_used = 0
        self.jiu_ready = False
        self.skills_used = []

    @property
    def hand_size(self) -> int:
        return len(self.hand)

    @property
    def alive_players(self) -> int:
        return 0  # 由 Engine 统计，这里不用

    def find_card(self, uid: str) -> Optional[Card]:
        for c in self.hand:
            if c.uid == uid:
                return c
        return None

    def remove_card(self, uid: str) -> Optional[Card]:
        for i, c in enumerate(self.hand):
            if c.uid == uid:
                return self.hand.pop(i)
        return None

    def equip_of(self, slot: str) -> Optional[Card]:
        return self.equips.get(slot)

    def public_state(self) -> Dict[str, object]:
        return {
            "idx": self.idx,
            "name": self.name,
            "hero": self.hero.name,
            "faction": self.hero.faction,
            "hp": self.hp,
            "max_hp": self.max_hp,
            "hand_count": len(self.hand),
            "alive": self.alive,
            "equips": [c.name for c in self.equips.values()],
        }


@dataclass
class Action:
    """一个合法动作。模型只需要在动作列表里挑一个下标。"""

    id: str
    kind: str  # play / respond / skill / end_phase / pass
    label: str
    card: Optional[str] = None  # Card.uid
    target: Optional[int] = None  # 目标座位
    as_card: Optional[str] = None  # 转换后的牌名（杀/闪）
    count: int = 0  # 技能参数（如制衡弃几张）
    extra: Dict[str, object] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, object]:
        return {
            "id": self.id,
            "kind": self.kind,
            "label": self.label,
            "card": self.card,
            "target": self.target,
            "as_card": self.as_card,
            "count": self.count,
        }


@dataclass
class ResponseCtx:
    """需要玩家（通常是防守方）响应的事件。"""

    kind: str  # dodge / kill / rescue / nullify
    need: int = 1
    source: Optional[int] = None
    defender: Optional[int] = None  # 需要做出响应的角色
    card: str = ""
    reason: str = ""


# 事件类型：info / say / think / damage / heal / death / phase / error / win
Emit = Callable[[Dict[str, object]], None]


class Engine:
    """三国杀规则引擎（简化但自洽的规则子集）。"""

    MAX_SHA_PER_TURN = 1

    def __init__(
        self,
        heroes: Sequence[Hero],
        rng: Optional[Rng] = None,
        emit: Optional[Emit] = None,
        deck_spec: Optional[DeckSpec] = None,
    ) -> None:
        self.rng = rng or Rng()
        self.emit: Emit = emit or (lambda ev: None)
        self.players: List[Player] = []
        for i, hero in enumerate(heroes):
            p = Player(
                idx=i,
                name=hero.name,
                hero=hero,
                hp=hero.max_hp,
                max_hp=hero.max_hp,
                seat_label=f"{i + 1}号位",
            )
            self.players.append(p)
        self.draw_pile: List[Card] = []
        self.discard_pile: List[Card] = []
        self.turn_no = 0
        self.current = 0
        self.phase = "init"
        self.finished = False
        self.winner: Optional[int] = None
        self.delayed: Dict[int, List[Card]] = {p.idx: [] for p in self.players}
        self._uid = itertools.count(1)
        self.deck_spec = deck_spec or DeckSpec.default()
        self.log: List[Dict[str, object]] = []

    # ------------------------------------------------------------------
    # 基础工具
    # ------------------------------------------------------------------

    def next_uid(self) -> str:
        return f"c{next(self._uid)}"

    def new_card(self, name: str, color: str = "black") -> Card:
        """生成一张指定名字的牌（技能转换用）。"""
        return Card(uid=self.next_uid(), name=name, color=color, kind="basic")

    def log_event(self, text: str, kind: str = "info", **extra: object) -> None:
        ev = {"type": kind, "text": text, "turn": self.turn_no, "player": self.current}
        ev.update(extra)
        self.log.append(ev)
        self.emit(ev)

    def alive_players(self) -> List[Player]:
        return [p for p in self.players if p.alive]

    def player(self, idx: int) -> Player:
        return self.players[idx]

    def opponents_of(self, idx: int) -> List[Player]:
        return [p for p in self.players if p.alive and p.idx != idx]

    def seat_distance(self, a: int, b: int) -> int:
        n = max(1, len(self.players))
        d = abs(a - b)
        return min(d, n - d)

    def attack_range(self, p: Player) -> int:
        r = 1
        weapon = p.equip_of("weapon")
        if weapon:
            if weapon.extra.get("range"):
                r = max(r, int(weapon.extra["range"]))
        if p.equip_of("horse_att"):
            r += 1
        return r

    def effective_distance(self, attacker: int, target: int) -> int:
        d = self.seat_distance(attacker, target)
        if self.player(target).equip_of("horse_def"):
            d += 1
        if self.player(attacker).equip_of("horse_att"):
            d -= 1
        return d

    def can_reach(self, attacker: int, target: int) -> bool:
        weapon = self.player(attacker).equip_of("weapon")
        if weapon and weapon.extra.get("nolimit"):
            return True
        return self.effective_distance(attacker, target) <= self.attack_range(self.player(attacker))

    def sha_limit(self, p: Player) -> int:
        if p.has_skill("paoxiao"):
            return 99
        limit = self.MAX_SHA_PER_TURN
        weapon = p.equip_of("weapon")
        if weapon and weapon.extra.get("extra_sha"):
            limit += 1
        return limit

    # ------------------------------------------------------------------
    # 牌堆
    # ------------------------------------------------------------------

    def setup(self) -> None:
        self.draw_pile = build_deck(self.deck_spec, self.rng)
        self.rng.shuffle(self.draw_pile)
        for p in self.players:
            for _ in range(4):
                self.draw_card(p, quiet=True)
        self.turn_no = 0
        self.current = int(self.rng.choice(list(range(len(self.players)))))
        self.log_event(f"发牌完毕，{self.player(self.current).name} 先手。", kind="phase")
        self.phase = "ready"

    def draw_card(self, p: Player, quiet: bool = False) -> Optional[Card]:
        if not self.draw_pile:
            self.draw_pile = self.discard_pile[:]
            self.discard_pile = []
            self.rng.shuffle(self.draw_pile)
            if not self.draw_pile:
                return None
        card = self.draw_pile.pop()
        card.uid = self.next_uid()
        p.hand.append(card)
        if not quiet:
            self.log_event(f"{p.name} 摸了一张【{card.name}】。")
        return card

    def draw_cards(self, p: Player, n: int) -> None:
        got = []
        for _ in range(n):
            c = self.draw_card(p, quiet=True)
            if c is None:
                break
            got.append(c)
        if got:
            names = "、".join(f"【{c.name}】" for c in got)
            self.log_event(f"{p.name} 摸了 {len(got)} 张牌：{names}。")

    def discard(self, p: Player, card: Card, reason: str = "") -> None:
        p.remove_card(card.uid)
        self.discard_pile.append(card)
        tail = f"（{reason}）" if reason else ""
        self.log_event(f"{p.name} 弃置了【{card.name}】{tail}。")

    def discard_card_by_uid(self, p: Player, uid: str, reason: str = "") -> Optional[Card]:
        card = p.find_card(uid)
        if card is None:
            return None
        self.discard(p, card, reason)
        return card

    # ------------------------------------------------------------------
    # 合法动作枚举
    # ------------------------------------------------------------------

    def legal_actions(self, p: Player) -> List[Action]:
        """出牌阶段的所有合法动作（永远包含「结束出牌阶段」）。"""
        acts: List[Action] = []
        if not p.alive:
            return acts
        for card in list(p.hand):
            acts.extend(self._card_actions(p, card))
        acts.extend(self._skill_actions(p))
        acts.append(
            Action(
                id="end_phase",
                kind="end_phase",
                label="结束出牌阶段",
            )
        )
        return acts

    def _card_actions(self, p: Player, card: Card) -> List[Action]:
        out: List[Action] = []
        if card.kind == "equip":
            slot = card.extra.get("slot", "weapon")
            if slot not in p.equips:
                out.append(
                    Action(
                        id=f"equip:{card.uid}",
                        kind="play",
                        label=f"装备【{card.name}】",
                        card=card.uid,
                    )
                )
            return out

        if card.name == "杀":
            out.extend(self._sha_actions(p, card, as_card=None))
            if p.has_skill("longdan"):
                # 龙胆：闪当杀（本卡就是杀，这里不适用）
                pass
            return out

        if card.name == "闪":
            out.append(
                Action(id=f"play:{card.uid}", kind="play", label="使用【闪】", card=card.uid)
            )
            if p.has_skill("longdan") and self._can_sha_now(p):
                out.extend(self._sha_actions(p, card, as_card="杀"))
            return out

        if card.name in ("桃", "酒"):
            out.append(
                Action(id=f"play:{card.uid}", kind="play", label=f"使用【{card.name}】", card=card.uid)
            )
            return out

        if card.name == "无懈可击":
            out.append(
                Action(id=f"play:{card.uid}", kind="play", label="使用【无懈可击】", card=card.uid)
            )
            return out

        if card.kind == "trick":
            if card.name in ("南蛮入侵", "万箭齐发"):
                out.append(
                    Action(id=f"play:{card.uid}", kind="play", label=f"使用【{card.name}】", card=card.uid)
                )
            elif card.name in ("乐不思蜀", "兵粮寸断"):
                for t in self.opponents_of(p.idx):
                    out.append(
                        Action(
                            id=f"play:{card.uid}->{t.idx}",
                            kind="play",
                            label=f"对 {t.name} 使用【{card.name}】",
                            card=card.uid,
                            target=t.idx,
                        )
                    )
            elif card.name == "闪电":
                for t in self.opponents_of(p.idx):
                    out.append(
                        Action(
                            id=f"play:{card.uid}->{t.idx}",
                            kind="play",
                            label=f"对 {t.name} 使用【闪电】",
                            card=card.uid,
                            target=t.idx,
                        )
                    )
            return out
        return out

    def _can_sha_now(self, p: Player) -> bool:
        return p.sha_used < self.sha_limit(p)

    def _sha_actions(self, p: Player, card: Card, as_card: Optional[str]) -> List[Action]:
        """为一手牌生成所有「杀」的合法目标。"""
        out: List[Action] = []
        if not self._can_sha_now(p):
            return out
        name = as_card or "杀"
        color = card.color if as_card is None else ("red" if card.color == "red" else "black")
        for t in self.opponents_of(p.idx):
            if t.has_skill("kongcheng") and len(t.hand) == 0:
                continue  # 空城：不能成为【杀】目标
            if not self.can_reach(p.idx, t.idx):
                continue
            out.append(
                Action(
                    id=f"play:{card.uid}->{t.idx}",
                    kind="play",
                    label=f"对 {t.name} 使用【{name}】",
                    card=card.uid,
                    target=t.idx,
                    as_card=name,
                    extra={"color": color},
                )
            )
        return out

    def _skill_actions(self, p: Player) -> List[Action]:
        out: List[Action] = []
        # 武圣：红色手牌可当【杀】
        if p.has_skill("wusheng") and self._can_sha_now(p):
            for card in p.hand:
                if card.kind == "equip" or card.color != "red":
                    continue
                if card.name == "杀":
                    continue
                for t in self.opponents_of(p.idx):
                    if t.has_skill("kongcheng") and len(t.hand) == 0:
                        continue
                    if not self.can_reach(p.idx, t.idx):
                        continue
                    out.append(
                        Action(
                            id=f"skill:wusheng:{card.uid}->{t.idx}",
                            kind="skill",
                            label=f"发动【武圣】：将【{card.name}】当【杀】对 {t.name}",
                            card=card.uid,
                            target=t.idx,
                            as_card="杀",
                            extra={"color": "red", "skill": "wusheng"},
                        )
                    )
        # 丈八蛇矛：两张手牌当一张【杀】
        weapon = p.equip_of("weapon")
        if weapon and weapon.extra.get("two_as_sha") and self._can_sha_now(p) and len(p.hand) >= 2:
            for t in self.opponents_of(p.idx):
                if t.has_skill("kongcheng") and len(t.hand) == 0:
                    continue
                if not self.can_reach(p.idx, t.idx):
                    continue
                out.append(
                    Action(
                        id=f"skill:zhangba:{t.idx}",
                        kind="skill",
                        label=f"发动【丈八蛇矛】：两张手牌当【杀】对 {t.name}",
                        target=t.idx,
                        as_card="杀",
                        count=2,
                        extra={"skill": "zhangba", "color": "black"},
                    )
                )
        # 仁德：把一张手牌交给别人
        if p.has_skill("rende") and p.hand:
            for card in p.hand:
                for t in self.opponents_of(p.idx):
                    out.append(
                        Action(
                            id=f"skill:rende:{card.uid}->{t.idx}",
                            kind="skill",
                            label=f"发动【仁德】：把【{card.name}】交给 {t.name}",
                            card=card.uid,
                            target=t.idx,
                            extra={"skill": "rende"},
                        )
                    )
        # 制衡：弃置全部手牌再摸等量
        if p.has_skill("zhiheng") and p.hand and "zhiheng" not in p.skills_used:
            out.append(
                Action(
                    id="skill:zhiheng",
                    kind="skill",
                    label=f"发动【制衡】：弃置全部 {len(p.hand)} 张手牌并摸等量的牌",
                    count=len(p.hand),
                    extra={"skill": "zhiheng"},
                )
            )
        return out

    # ------------------------------------------------------------------
    # 响应（闪 / 杀 / 桃 / 无懈）
    # ------------------------------------------------------------------

    def legal_responses(self, p: Player, ctx: ResponseCtx) -> List[Action]:
        out: List[Action] = []
        if not p.alive:
            return out
        if ctx.kind == "dodge":
            for card in p.hand:
                if card.name == "闪":
                    out.append(
                        Action(
                            id=f"resp:shan:{card.uid}",
                            kind="respond",
                            label=f"出【闪】抵挡【{ctx.card}】",
                            card=card.uid,
                            extra={"resp": "shan"},
                        )
                    )
                elif card.name == "杀" and p.has_skill("longdan"):
                    out.append(
                        Action(
                            id=f"resp:shan:{card.uid}",
                            kind="respond",
                            label=f"发动【龙胆】：以【杀】当【闪】抵挡【{ctx.card}】",
                            card=card.uid,
                            extra={"resp": "shan"},
                        )
                    )
        elif ctx.kind == "kill":
            for card in p.hand:
                if card.name == "杀":
                    out.append(
                        Action(
                            id=f"resp:sha:{card.uid}",
                            kind="respond",
                            label=f"出【杀】应对【{ctx.card}】",
                            card=card.uid,
                            extra={"resp": "sha"},
                        )
                    )
                elif card.name == "闪" and p.has_skill("longdan"):
                    out.append(
                        Action(
                            id=f"resp:sha:{card.uid}",
                            kind="respond",
                            label=f"发动【龙胆】：以【闪】当【杀】应对【{ctx.card}】",
                            card=card.uid,
                            extra={"resp": "sha"},
                        )
                    )
        elif ctx.kind == "rescue":
            for card in p.hand:
                if card.name == "桃":
                    out.append(
                        Action(
                            id=f"resp:tao:{card.uid}",
                            kind="respond",
                            label="出【桃】自救",
                            card=card.uid,
                            extra={"resp": "tao"},
                        )
                    )
                elif card.name == "酒":
                    out.append(
                        Action(
                            id=f"resp:tao:{card.uid}",
                            kind="respond",
                            label="出【酒】自救（视为桃）",
                            card=card.uid,
                            extra={"resp": "tao"},
                        )
                    )
        elif ctx.kind == "nullify":
            for card in p.hand:
                if card.name == "无懈可击":
                    out.append(
                        Action(
                            id=f"resp:nullify:{card.uid}",
                            kind="respond",
                            label=f"出【无懈可击】抵消【{ctx.card}】",
                            card=card.uid,
                            extra={"resp": "nullify"},
                        )
                    )
        out.append(Action(id="pass", kind="pass", label="不响应"))
        return out

    # ------------------------------------------------------------------
    # 回合流程
    # ------------------------------------------------------------------

    def start_turn(self, idx: int) -> None:
        self.current = idx
        self.turn_no += 1
        p = self.player(idx)
        p.reset_turn_state()
        self.phase = "judge"
        self.log_event(f"—— 第 {self.turn_no} 回合 · {p.name}（{p.hero.name}） ——", kind="phase")
        self.phase_judge(p)
        if not self.finished:
            self.phase_draw(p)
        if not self.finished:
            self.phase = "play"

    # -- 判定阶段 --
    def phase_judge(self, p: Player) -> None:
        cards = self.delayed.get(p.idx, [])
        while cards:
            card = cards.pop(0)
            if card.name == "乐不思蜀":
                ok = self.judge_red(p, card)
                if ok:
                    self.log_event(f"{p.name} 的【乐不思蜀】判定为红，跳过出牌阶段！", kind="phase")
                    p.skills_used.append("skip_play")
                else:
                    self.log_event(f"{p.name} 的【乐不思蜀】判定为黑，无事发生。")
                    self.discard_pile.append(card)
            elif card.name == "兵粮寸断":
                ok = self.judge_red(p, card)
                if ok:
                    self.log_event(f"{p.name} 的【兵粮寸断】判定为红，跳过摸牌阶段！", kind="phase")
                    p.skills_used.append("skip_draw")
                else:
                    self.log_event(f"{p.name} 的【兵粮寸断】判定为黑，无事发生。")
                    self.discard_pile.append(card)
            elif card.name == "闪电":
                res = self.judge_card(p, card)
                self.log_event(f"{p.name} 的【闪电】判定：{res.name}。")
                if res.color == "black" and res.rank in ("2", "3", "4", "5", "6", "7", "8", "9"):
                    self.log_event(f"【闪电】命中！{p.name} 受到 3 点伤害！", kind="damage")
                    self.deal_damage(p, 3, None, "闪电")
                    self.discard_pile.append(card)
                else:
                    self.log_event("【闪电】未命中，置入判定区。")
                    cards.append(card)
                    self.delayed[p.idx] = cards
                    return
        self.delayed[p.idx] = cards

    def judge_card(self, p: Player, card: Card) -> Card:
        if self.draw_pile:
            jc = self.draw_pile.pop()
            jc.uid = self.next_uid()
        else:  # 牌堆空了，用弃牌堆凑
            jc = Card(uid=self.next_uid(), name="判定牌", color="black", kind="basic")
        return jc

    def judge_red(self, p: Player, card: Card) -> bool:
        jc = self.judge_card(p, card)
        self.log_event(f"{p.name} 判定：{jc.name}（{'红' if jc.color == 'red' else '黑'}）。")
        self.discard_pile.append(jc)
        return jc.color == "red"

    # -- 摸牌阶段 --
    def phase_draw(self, p: Player) -> None:
        self.phase = "draw"
        if "skip_draw" in p.skills_used:
            self.log_event(f"{p.name} 被【兵粮寸断】影响，跳过摸牌阶段。")
            return
        n = 2
        if p.has_skill("yingzi"):
            n += 1
        self.draw_cards(p, n)

    # -- 弃牌阶段 --
    def phase_discard(self, p: Player) -> None:
        self.phase = "discard"
        limit = max(0, p.hp)
        while len(p.hand) > limit:
            card = p.hand[-1]
            self.discard(p, card, "弃牌阶段")

    # ------------------------------------------------------------------
    # 动作执行
    # ------------------------------------------------------------------

    def apply_play(self, p: Player, act: Action, responder) -> bool:
        """执行一个出牌动作。responder(ctx) -> (是否响应, 使用的手牌 uid 或 None)。"""
        if act.kind == "skill":
            return self._apply_skill(p, act, responder)
        card = p.find_card(act.card or "")
        if card is None:
            return False
        if act.as_card and act.as_card != card.name:
            # 技能转换：原牌打出，视为另一种牌
            p.remove_card(card.uid)
            self.discard_pile.append(card)
            if act.as_card == "杀":
                self._use_sha(p, card, act.target, color=str(act.extra.get("color", card.color)), responder=responder)
            return True
        p.remove_card(card.uid)
        if card.kind == "equip":
            slot = str(card.extra.get("slot", "weapon"))
            old = p.equips.pop(slot, None)
            if old:
                self.discard_pile.append(old)
                self.log_event(f"{p.name} 弃置了装备【{old.name}】。")
            p.equips[slot] = card
            self.log_event(f"{p.name} 装备了【{card.name}】。")
            return True
        if card.name == "杀":
            self._use_sha(p, card, act.target, color=card.color, responder=responder)
            return True
        if card.name == "闪":
            self.discard(p, card, "无效使用")
            return True
        if card.name == "桃":
            if p.hp < p.max_hp:
                p.hp += 1
                self.log_event(f"{p.name} 使用【桃】，回复 1 点体力（{p.hp}/{p.max_hp}）。", kind="heal")
            else:
                self.log_event(f"{p.name} 体力已满，【桃】被弃置。")
            self.discard_pile.append(card)
            return True
        if card.name == "酒":
            p.jiu_ready = True
            self.log_event(f"{p.name} 喝下一张【酒】，下一张【杀】伤害 +1。")
            self.discard_pile.append(card)
            return True
        if card.name == "无懈可击":
            self.discard(p, card, "直接打出")
            return True
        if card.name in ("南蛮入侵", "万箭齐发"):
            self._use_aoe(p, card, responder)
            return True
        if card.name in ("乐不思蜀", "兵粮寸断"):
            self._use_delayed(p, card, act.target, responder)
            return True
        if card.name == "闪电":
            self._use_delayed(p, card, act.target, responder)
            return True
        self.discard_pile.append(card)
        return True

    def _apply_skill(self, p: Player, act: Action, responder) -> bool:
        skill = str(act.extra.get("skill", ""))
        if skill == "rende":
            card = p.find_card(act.card or "")
            t = self.player(act.target) if act.target is not None else None
            if card is None or t is None or not t.alive:
                return False
            p.remove_card(card.uid)
            t.hand.append(card)
            self.log_event(f"{p.name} 发动【仁德】，将【{card.name}】交给 {t.name}。")
            return True
        if skill == "zhiheng":
            n = act.count or len(p.hand)
            discarded = []
            for _ in range(n):
                if not p.hand:
                    break
                discarded.append(p.hand.pop())
            for c in discarded:
                self.discard_pile.append(c)
            self.log_event(f"{p.name} 发动【制衡】，弃置 {len(discarded)} 张手牌并摸等量的牌。")
            self.draw_cards(p, len(discarded))
            p.skills_used.append("zhiheng")
            return True
        if skill == "wusheng":
            card = p.find_card(act.card or "")
            t = self.player(act.target) if act.target is not None else None
            if card is None or t is None:
                return False
            p.remove_card(card.uid)
            self.discard_pile.append(card)
            self.log_event(f"{p.name} 发动【武圣】，将【{card.name}】当【杀】使用！")
            self._use_sha(p, card, t.idx, color="red", responder=responder, virtual=True)
            return True
        if skill == "zhangba":
            t = self.player(act.target) if act.target is not None else None
            if t is None or len(p.hand) < 2:
                return False
            c1 = p.hand.pop()
            c2 = p.hand.pop()
            self.discard_pile.extend([c1, c2])
            self.log_event(f"{p.name} 发动【丈八蛇矛】，将两张手牌当【杀】使用！")
            virt = Card(uid=self.next_uid(), name="杀", color="black", kind="basic")
            self._use_sha(p, virt, t.idx, color="black", responder=responder, virtual=True, attacker=p.idx)
            return True
        return False

    # -- 【杀】 --
    def _use_sha(self, p: Player, card: Card, target_idx: Optional[int], color: str, responder, virtual: bool = False, attacker: Optional[int] = None) -> None:
        src = attacker if attacker is not None else p.idx
        p.sha_used += 1
        if not virtual:
            p.remove_card(card.uid)
            self.discard_pile.append(card)
        if target_idx is None or not self.player(target_idx).alive:
            self.log_event(f"{p.name} 的【杀】没有合法目标。")
            return
        t = self.player(target_idx)
        self.log_event(f"{p.name} 对 {t.name} 使用【杀】！")

        # 仁王盾：黑色的【杀】无效
        armor = t.equip_of("armor")
        if armor and armor.name == "仁王盾" and color == "black":
            self.log_event(f"{t.name} 的【仁王盾】令黑色的【杀】无效。")
            return
        # 八卦阵
        if armor and armor.name == "八卦阵":
            jc = self.judge_card(t, Card(uid=self.next_uid(), name="八卦阵", color="black", kind="armor"))
            self.log_event(f"{t.name} 发动【八卦阵】，判定：{jc.name}。")
            self.discard_pile.append(jc)
            if jc.color == "red":
                self.log_event("判定为红，【杀】被闪避。")
                return
        # 无双：需要两张闪
        need = 1
        if self.player(src).has_skill("wushuang") or t.has_skill("wushuang"):
            need = 2
            self.log_event("【无双】发动，需要两张【闪】才能抵消！")
        shans = 0
        for _ in range(need):
            ok, uid = responder(
                ResponseCtx(
                    kind="dodge",
                    need=need - shans,
                    source=src,
                    defender=t.idx,
                    card="杀",
                    reason=f"{t.name} 需要响应【杀】",
                )
            )
            if not ok or uid is None:
                break
            card_shan = t.find_card(uid)
            if card_shan is None:
                break
            t.remove_card(uid)
            self.discard_pile.append(card_shan)
            shans += 1
            self.log_event(f"{t.name} 打出一张【闪】。")
        if shans >= need:
            self.log_event(f"{t.name} 成功闪避了【杀】。")
            return
        # 贯石斧：被闪时可弃一张牌强制命中
        weapon = self.player(src).equip_of("weapon")
        if weapon and weapon.extra.get("guanshi") and shans > 0 and len(self.player(src).hand) > 0:
            spent = self.player(src).hand[-1]
            self.discard(self.player(src), spent, "发动【贯石斧】")
            self.log_event(f"{self.player(src).name} 发动【贯石斧】，强行命中！")
            shans = 0
        if shans > 0:
            self.log_event(f"{t.name} 闪避了【杀】。")
            return
        # 伤害计算
        dmg = 1
        w = self.player(src).equip_of("weapon")
        if w and w.extra.get("damage_plus"):
            dmg += int(w.extra["damage_plus"])
        if self.player(src).jiu_ready:
            dmg += 1
            self.player(src).jiu_ready = False
        if w and w.extra.get("vs_female") and t.hero.gender == "女":
            dmg += 1
            self.log_event(f"【雌雄双股剑】对女性角色伤害 +1！")
        if self.player(src).has_skill("wushuang") and len(t.hand) == 0:
            dmg += 1
            self.log_event("【无双】对无手牌角色伤害 +1！")
        self.log_event(f"{t.name} 受到 {dmg} 点伤害！", kind="damage")
        self.deal_damage(t, dmg, src, "杀")

    # -- AOE --
    def _use_aoe(self, p: Player, card: Card, responder) -> None:
        self.discard_pile.append(card)
        self.log_event(f"{p.name} 打出【{card.name}】！")
        need_card = "杀" if card.name == "南蛮入侵" else "闪"
        for t in self.opponents_of(p.idx):
            ok, uid = responder(
                ResponseCtx(
                    kind="kill" if need_card == "杀" else "dodge",
                    source=p.idx,
                    defender=t.idx,
                    card=card.name,
                    reason="AOE",
                )
            )
            if ok and uid:
                c = t.find_card(uid)
                if c:
                    t.remove_card(uid)
                    self.discard_pile.append(c)
                    self.log_event(f"{t.name} 打出【{c.name}】抵消了【{card.name}】。")
                    continue
            armor = t.equip_of("armor")
            if armor and armor.name == "藤甲":
                self.log_event(f"{t.name} 的【藤甲】防止了【{card.name}】的伤害。")
                continue
            self.log_event(f"{t.name} 受到 1 点伤害！", kind="damage")
            self.deal_damage(t, 1, p.idx, card.name)

    # -- 延时锦囊 --
    def _use_delayed(self, p: Player, card: Card, target_idx: Optional[int], responder) -> None:
        if target_idx is None:
            return
        t = self.player(target_idx)
        p.remove_card(card.uid)
        self.log_event(f"{p.name} 对 {t.name} 使用【{card.name}】。")
        # 无懈可击链
        cancelled = self._nullify_chain(p, t, card, responder)
        if cancelled:
            self.log_event(f"【{card.name}】被【无懈可击】抵消。")
            self.discard_pile.append(card)
            return
        self.delayed[t.idx].append(card)
        self.log_event(f"【{card.name}】置于 {t.name} 的判定区。")

    def _nullify_chain(self, p: Player, t: Player, card: Card, responder) -> bool:
        """返回 True 表示延时锦囊被抵消。"""
        cancelled = False
        depth = 0
        while depth < 2:
            depth += 1
            used = None
            for other in self.players:
                if not other.alive or other.idx in (p.idx, t.idx):
                    continue
                if not any(c.name == "无懈可击" for c in other.hand):
                    continue
                ok, uid = responder(
                    ResponseCtx(
                        kind="nullify",
                        source=p.idx,
                        defender=other.idx,
                        card=card.name,
                        reason="无懈可击",
                    )
                )
                if ok and uid:
                    c = other.find_card(uid)
                    if c:
                        other.remove_card(uid)
                        self.discard_pile.append(c)
                        self.log_event(f"{other.name} 打出【无懈可击】！")
                        used = other
                        break
            if used is None:
                break
            cancelled = not cancelled
        return cancelled

    # -- 伤害与濒死 --
    def deal_damage(self, target: Player, amount: int, source: Optional[int], reason: str) -> None:
        # 天香：致命伤害可用红牌防止
        if target.has_skill("tiansiang") and target.hp - amount <= 0:
            red = next((c for c in target.hand if c.color == "red" and c.kind != "equip"), None)
            if red is not None:
                target.remove_card(red.uid)
                self.discard_pile.append(red)
                self.log_event(f"{target.name} 发动【天香】，弃置【{red.name}】防止了伤害！")
                return
        target.hp -= amount
        if target.hp < 0:
            target.hp = 0
        self.log_event(f"{target.name} 体力 {target.hp}/{target.max_hp}。")
        if source is not None:
            self._damage_hooks(target, self.player(source), amount)
        if target.hp <= 0:
            self._dying(target, source)

    def _damage_hooks(self, target: Player, source: Player, amount: int) -> None:
        # 奸雄：获得伤害来源的一张牌
        if target.has_skill("jianxiong") and source.alive:
            pool = list(source.hand) + list(source.equips.values())
            if pool:
                card = self.rng.choice(pool)
                if card in source.hand:
                    source.remove_card(card.uid)
                else:
                    for slot, eq in list(source.equips.items()):
                        if eq.uid == card.uid:
                            source.equips.pop(slot, None)
                            break
                target.hand.append(card)
                self.log_event(f"{target.name} 发动【奸雄】，获得了【{card.name}】。")
        # 反馈：弃置伤害来源的一张牌
        if target.has_skill("fankui") and source.alive:
            pool = list(source.hand) + list(source.equips.values())
            if pool:
                card = self.rng.choice(pool)
                if card in source.hand:
                    source.remove_card(card.uid)
                else:
                    for slot, eq in list(source.equips.items()):
                        if eq.uid == card.uid:
                            source.equips.pop(slot, None)
                            break
                self.discard_pile.append(card)
                self.log_event(f"{target.name} 发动【反馈】，弃置了 {source.name} 的【{card.name}】。")

    def _dying(self, target: Player, source: Optional[int]) -> None:
        self.log_event(f"{target.name} 濒死！", kind="phase")
        rescued = False
        # 自己救
        tao = next((c for c in target.hand if c.name in ("桃", "酒")), None)
        if tao is not None:
            target.remove_card(tao.uid)
            self.discard_pile.append(tao)
            target.hp = 1
            self.log_event(f"{target.name} 使用【{tao.name}】自救成功，体力回复至 1。", kind="heal")
            rescued = True
        # 其他人救
        if not rescued:
            for other in self.players:
                if not other.alive or other.idx == target.idx:
                    continue
                if not any(c.name in ("桃", "酒") for c in other.hand):
                    continue
                ok, uid = responder(
                    ResponseCtx(
                        kind="rescue",
                        source=target.idx,
                        defender=other.idx,
                        card="桃",
                        reason=f"救 {target.name}",
                    )
                )
                if ok and uid:
                    c = other.find_card(uid)
                    if c:
                        other.remove_card(uid)
                        self.discard_pile.append(c)
                        target.hp = 1
                        self.log_event(f"{other.name} 对 {target.name} 使用【{c.name}】救活！", kind="heal")
                        rescued = True
                        break
        if rescued:
            return
        target.alive = False
        target.hp = 0
        self.log_event(f"{target.name} 阵亡！", kind="death")
        self._check_end()

    def _check_end(self) -> None:
        alive = self.alive_players()
        if len(alive) <= 1:
            self.finished = True
            if alive:
                self.winner = alive[0].idx
                self.log_event(f"🏆 {alive[0].name}（{alive[0].hero.name}）获胜！", kind="win")
            else:
                self.winner = None
                self.log_event("同归于尽，无人获胜。", kind="win")
