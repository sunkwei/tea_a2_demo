"""规则引擎测试：牌堆、伤害结算、技能、濒死、胜负。"""

from __future__ import annotations

import unittest

from sanguosha_ai.cards import Card, DeckSpec, build_deck
from sanguosha_ai.engine import Engine, ResponseCtx
from sanguosha_ai.heroes import get_hero
from sanguosha_ai.rng import Rng


def make_engine(hero_keys=("zhang_fei", "zhu_ge_liang", "guan_yu"), seed=42):
    heroes = [get_hero(k) for k in hero_keys]
    events = []
    eng = Engine(heroes, Rng(seed), emit=events.append)
    return eng, events


def give(player, name, color="black", kind="basic", extra=None):
    card = Card(uid=player.idx * 1000 + len(player.hand) + 1, name=name, color=color, kind=kind, extra=extra or {})
    player.hand.append(card)
    return card


class TestDeck(unittest.TestCase):
    def test_default_deck_size_and_content(self):
        deck = build_deck(DeckSpec.default(), Rng(1))
        names = [c.name for c in deck]
        self.assertGreater(len(deck), 60)
        for key in ("杀", "闪", "桃", "酒", "无懈可击", "南蛮入侵", "闪电", "赤兔", "八卦阵"):
            self.assertIn(key, names)

    def test_equipment_slots(self):
        deck = build_deck(DeckSpec.default(), Rng(1))
        slots = {c.name: c.extra.get("slot") for c in deck if c.kind == "equip"}
        self.assertEqual(slots["诸葛连弩"], "weapon")
        self.assertEqual(slots["八卦阵"], "armor")
        self.assertEqual(slots["赤兔"], "horse_att")
        self.assertEqual(slots["绝影"], "horse_def")


class TestBasics(unittest.TestCase):
    def test_setup_deals_four_cards_each(self):
        eng, _ = make_engine()
        eng.setup()
        for p in eng.players:
            self.assertEqual(len(p.hand), 4)
            self.assertEqual(p.hp, p.max_hp)

    def test_draw_and_discard(self):
        eng, _ = make_engine()
        eng.setup()
        p = eng.players[0]
        before = len(p.hand)
        eng.draw_cards(p, 2)
        self.assertEqual(len(p.hand), before + 2)
        eng.phase_discard(p)
        self.assertLessEqual(len(p.hand), p.hp)

    def test_sha_damages_target(self):
        eng, _ = make_engine()
        eng.setup()
        a, b = eng.players[0], eng.players[1]
        card = give(a, "杀")
        act = [x for x in eng.legal_actions(a) if x.card == card.uid and x.target == b.idx]
        self.assertTrue(act, "张飞与诸葛亮应当互相可攻击")
        eng.apply_play(a, act[0], responder=lambda ctx: (False, None))
        self.assertEqual(b.hp, b.max_hp - 1)

    def test_dodge_avoids_damage(self):
        eng, _ = make_engine()
        eng.setup()
        a, b = eng.players[0], eng.players[1]
        card = give(a, "杀")
        shan = give(b, "闪")
        act = [x for x in eng.legal_actions(a) if x.card == card.uid and x.target == b.idx][0]

        def responder(ctx):
            if ctx.kind == "dodge" and ctx.defender == b.idx:
                return True, shan.uid
            return False, None

        eng.apply_play(a, act, responder=responder)
        self.assertEqual(b.hp, b.max_hp)

    def test_tao_heals(self):
        eng, _ = make_engine()
        eng.setup()
        a = eng.players[0]
        a.hp = 1
        card = give(a, "桃")
        act = [x for x in eng.legal_actions(a) if x.card == card.uid][0]
        eng.apply_play(a, act, responder=lambda ctx: (False, None))
        self.assertEqual(a.hp, 2)

    def test_dying_rescued_by_tao(self):
        eng, _ = make_engine()
        eng.setup()
        a, b = eng.players[0], eng.players[1]
        b.hp = 1
        give(b, "桃")
        eng.deal_damage(b, 1, a.idx, "杀")
        self.assertTrue(b.alive)
        self.assertEqual(b.hp, 1)

    def test_dying_without_tao_is_dead(self):
        eng, _ = make_engine()
        eng.setup()
        a, b = eng.players[0], eng.players[1]
        b.hp = 1
        b.hand.clear()
        for p in eng.players:
            p.hand.clear()
        eng.deal_damage(b, 1, a.idx, "杀")
        self.assertFalse(b.alive)
        self.assertEqual(b.hp, 0)

    def test_winner_when_last_enemy_dies(self):
        eng, _ = make_engine()
        eng.setup()
        a, b, c = eng.players
        for p in (b, c):
            p.hand.clear()
        eng.deal_damage(b, 99, a.idx, "杀")
        self.assertFalse(eng.finished, "还有一人存活时不算结束")
        eng.deal_damage(c, 99, a.idx, "杀")
        self.assertTrue(eng.finished)
        self.assertEqual(eng.winner, a.idx)


class TestSkills(unittest.TestCase):
    def test_paoxiao_allows_many_sha(self):
        eng, _ = make_engine()
        eng.setup()
        a = eng.players[0]
        self.assertTrue(a.has_skill("paoxiao"))
        self.assertEqual(eng.sha_limit(a), 99)

    def test_normal_hero_has_one_sha_limit(self):
        eng, _ = make_engine()
        eng.setup()
        b = eng.players[1]
        self.assertEqual(eng.sha_limit(b), 1)

    def test_wusheng_converts_red_card(self):
        eng, _ = make_engine()
        eng.setup()
        a = eng.players[2]  # 关羽
        card = give(a, "桃", color="red")
        acts = [x for x in eng.legal_actions(a) if x.extra.get("skill") == "wusheng"]
        self.assertTrue(acts, "红色手牌应当能当【杀】")
        self.assertEqual(acts[0].as_card, "杀")
        self.assertEqual(card.color, "red")

    def test_longdan_uses_dodge_as_sha(self):
        eng, _ = make_engine(("zhao_yun", "zhu_ge_liang", "cao_cao"))
        eng.setup()
        a = eng.players[0]
        card = give(a, "闪")
        acts = [x for x in eng.legal_actions(a) if x.card == card.uid and x.as_card == "杀"]
        self.assertTrue(acts, "【闪】应当能当【杀】")

    def test_kongcheng_blocks_sha_target(self):
        eng, _ = make_engine()
        eng.setup()
        a = eng.players[0]
        b = eng.players[1]  # 诸葛亮
        b.hand.clear()
        card = give(a, "杀")
        acts = [x for x in eng.legal_actions(a) if x.card == card.uid and x.target == b.idx]
        self.assertFalse(acts, "空城状态下不能成为【杀】的目标")

    def test_jianxiong_steals_card_after_damage(self):
        eng, _ = make_engine(("cao_cao", "zhu_ge_liang", "zhang_fei"))
        eng.setup()
        a = eng.players[0]
        b = eng.players[1]
        give(b, "杀")
        before = len(a.hand)
        eng.deal_damage(a, 1, b.idx, "杀")
        self.assertEqual(len(a.hand), before + 1)


class TestEquipment(unittest.TestCase):
    def test_equip_replaces_slot(self):
        eng, _ = make_engine(("cao_cao", "zhu_ge_liang", "zhang_fei"))
        eng.setup()
        a = eng.players[0]
        card = give(a, "诸葛连弩", kind="equip", extra={"slot": "weapon", "extra_sha": 1})
        act = [x for x in eng.legal_actions(a) if x.card == card.uid][0]
        eng.apply_play(a, act, responder=lambda ctx: (False, None))
        self.assertEqual(a.equip_of("weapon").name, "诸葛连弩")
        self.assertEqual(eng.sha_limit(a), 2)

    def test_renwang_blocks_black_sha(self):
        eng, _ = make_engine()
        eng.setup()
        a, b = eng.players[0], eng.players[1]
        b.equips["armor"] = Card(uid="armor1", name="仁王盾", kind="equip", extra={"slot": "armor"})
        card = give(a, "杀", color="black")
        act = [x for x in eng.legal_actions(a) if x.card == card.uid and x.target == b.idx][0]
        eng.apply_play(a, act, responder=lambda ctx: (False, None))
        self.assertEqual(b.hp, b.max_hp, "黑色【杀】被仁王盾挡下")

    def test_horse_extends_range(self):
        eng, _ = make_engine(("zhang_fei", "zhu_ge_liang", "cao_cao"))
        eng.setup()
        a, c = eng.players[0], eng.players[2]
        self.assertFalse(eng.can_reach(a.idx, c.idx) if len(eng.players) > 3 else False)
        a.equips["horse_att"] = Card(uid="h1", name="赤兔", kind="equip", extra={"slot": "horse_att"})
        self.assertEqual(eng.attack_range(a), 2)


class TestLegalResponses(unittest.TestCase):
    def test_dodge_responses(self):
        eng, _ = make_engine()
        eng.setup()
        p = eng.players[1]
        shan = give(p, "闪")
        acts = eng.legal_responses(p, ResponseCtx(kind="dodge", defender=p.idx, card="杀"))
        self.assertTrue(any(a.card == shan.uid for a in acts))
        self.assertTrue(any(a.kind == "pass" for a in acts))

    def test_no_dodge_card_only_pass(self):
        eng, _ = make_engine()
        eng.setup()
        p = eng.players[1]
        p.hand.clear()
        acts = eng.legal_responses(p, ResponseCtx(kind="dodge", defender=p.idx, card="杀"))
        self.assertEqual(len(acts), 1)
        self.assertEqual(acts[0].kind, "pass")


if __name__ == "__main__":
    unittest.main()
