"""决策层测试：模型选动作、解析失败时的规则兜底。"""

from __future__ import annotations

import unittest

from sanguosha_ai.engine import Engine, ResponseCtx
from sanguosha_ai.heroes import get_hero
from sanguosha_ai.llm.client import ChatResult, LlmClient
from sanguosha_ai.llm.policy import LlmPolicy, RulePolicy
from sanguosha_ai.rng import Rng


class FakeClient(LlmClient):
    """假客户端：按顺序返回预设文本。"""

    def __init__(self, responses):
        # 故意不调用父类构造：只需要 chat/available 两个接口
        self.responses = list(responses)
        self.calls = 0
        self.prompts = []

    @property
    def available(self):
        return True

    def chat(self, system, user, **kwargs):
        self.calls += 1
        self.prompts.append((system, user))
        text = self.responses.pop(0) if self.responses else '{"n": 1}'
        return ChatResult(ok=True, content=text, reasoning="想了一下", elapsed=0.01)


def build():
    heroes = [get_hero(k) for k in ("zhang_fei", "zhu_ge_liang", "cao_cao")]
    eng = Engine(heroes, Rng(7))
    eng.setup()
    return eng


class TestLlmPolicy(unittest.TestCase):
    def test_picks_action_by_index(self):
        eng = build()
        p = eng.players[0]
        actions = eng.legal_actions(p)
        client = FakeClient(['{"n": 2, "say": "接招"}'])
        pol = LlmPolicy(client, "fake")
        d = pol.decide(eng, p, actions, 1)
        self.assertEqual(d.source, "llm")
        self.assertEqual(d.action.id, actions[1].id)
        self.assertEqual(d.say, "接招")

    def test_json_in_prose_is_accepted(self):
        eng = build()
        p = eng.players[0]
        actions = eng.legal_actions(p)
        client = FakeClient(['我选第 3 个：{"n": 3}'])
        pol = LlmPolicy(client, "fake")
        d = pol.decide(eng, p, actions, 1)
        self.assertEqual(d.source, "llm")
        self.assertEqual(d.action.id, actions[2].id)

    def test_garbage_falls_back_to_rule(self):
        eng = build()
        p = eng.players[0]
        actions = eng.legal_actions(p)
        client = FakeClient(["完全看不懂的一团乱码"])
        pol = LlmPolicy(client, "fake")
        d = pol.decide(eng, p, actions, 1)
        self.assertEqual(d.source, "rule")
        self.assertIn(d.action.id, [a.id for a in actions])

    def test_out_of_range_index_falls_back(self):
        eng = build()
        p = eng.players[0]
        actions = eng.legal_actions(p)
        client = FakeClient(['{"n": 999}'])
        pol = LlmPolicy(client, "fake")
        d = pol.decide(eng, p, actions, 1)
        self.assertEqual(d.source, "rule")

    def test_prompt_contains_state_and_actions(self):
        eng = build()
        p = eng.players[0]
        actions = eng.legal_actions(p)
        client = FakeClient(['{"n": 1}'])
        pol = LlmPolicy(client, "fake")
        pol.decide(eng, p, actions, 3)
        system, user = client.prompts[0]
        self.assertIn("张飞", system)
        self.assertIn("【局面】", user)
        self.assertIn("第3回合", user)
        self.assertIn("1.", user)

    def test_response_pass(self):
        eng = build()
        p = eng.players[1]
        ctx = ResponseCtx(kind="dodge", defender=p.idx, card="杀")
        actions = eng.legal_responses(p, ctx)
        client = FakeClient(['{"n": %d}' % len(actions)])  # 最后一个是 pass
        pol = LlmPolicy(client, "fake")
        d = pol.respond(eng, p, ctx, actions)
        self.assertEqual(d.action.kind, "pass")


class TestRulePolicy(unittest.TestCase):
    def test_always_returns_legal_action(self):
        eng = build()
        p = eng.players[0]
        actions = eng.legal_actions(p)
        d = RulePolicy().decide(eng, p, actions)
        self.assertIn(d.action.id, [a.id for a in actions])

    def test_uses_tao_when_low(self):
        eng = build()
        p = eng.players[0]
        p.hp = 1
        from sanguosha_ai.cards import Card

        p.hand.append(Card(uid="t1", name="桃", kind="basic"))
        actions = eng.legal_actions(p)
        d = RulePolicy().decide(eng, p, actions)
        self.assertIn("桃", d.action.label)


if __name__ == "__main__":
    unittest.main()
