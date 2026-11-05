"""武将与技能定义。

技能用 key 标识，引擎里直接按 key 判断行为（简单可靠，便于测试）。
每个武将还有一段「人设」文本，会拼进模型提示词，让模型按角色性格说话和决策。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List


@dataclass
class Skill:
    key: str
    name: str
    desc: str


@dataclass
class Hero:
    key: str
    name: str
    faction: str
    gender: str
    max_hp: int
    skills: List[Skill] = field(default_factory=list)
    style: str = ""
    title: str = ""

    def skill_desc(self) -> str:
        return "；".join(f"【{s.name}】{s.desc}" for s in self.skills)


def _h(*a, **kw) -> Hero:
    return Hero(*a, **kw)


HEROES: List[Hero] = [
    _h(
        key="guan_yu",
        name="关羽",
        faction="蜀",
        gender="男",
        max_hp=4,
        title="美髯公",
        skills=[Skill("wusheng", "武圣", "你可以将一张红色手牌当【杀】使用")],
        style="义薄云天，傲气自负，说话斩钉截截。喜欢正面强攻，一旦锁定目标绝不手软。",
    ),
    _h(
        key="zhang_fei",
        name="张飞",
        faction="蜀",
        gender="男",
        max_hp=4,
        title="万人敌",
        skills=[Skill("paoxiao", "咆哮", "你可以无次数限制地使用【杀】")],
        style="暴躁冲动，嗓门大，讨厌犹豫。喜欢连续猛攻，嘲讽对手。",
    ),
    _h(
        key="zhao_yun",
        name="赵云",
        faction="蜀",
        gender="男",
        max_hp=4,
        title="常胜将军",
        skills=[Skill("longdan", "龙胆", "你可以将【杀】当【闪】、【闪】当【杀】使用")],
        style="冷静果断，身手矫健。攻守平衡，讲究一击必中且留有后手。",
    ),
    _h(
        key="cao_cao",
        name="曹操",
        faction="魏",
        gender="男",
        max_hp=4,
        title="魏武帝",
        skills=[Skill("jianxiong", "奸雄", "当你受到伤害后，你可以获得伤害来源的一张牌")],
        style="多疑善谋，善于算计。优先抢资源、囤牌，最后收网，绝不轻易出手。",
    ),
    _h(
        key="zhu_ge_liang",
        name="诸葛亮",
        faction="蜀",
        gender="男",
        max_hp=3,
        title="卧龙",
        skills=[Skill("kongcheng", "空城", "当你没有手牌时，你不能成为【杀】或【决斗】的目标")],
        style="神机妙算，惜字如金。喜欢用计策与牌堆周旋，体力不多时更要惜身。",
    ),
    _h(
        key="liu_bei",
        name="刘备",
        faction="蜀",
        gender="男",
        max_hp=4,
        title="汉昭烈帝",
        skills=[Skill("rende", "仁德", "出牌阶段，你可以将一张手牌交给其他角色")],
        style="仁厚仗义，愿意把牌让给别人，也懂得借刀杀人。说话恳切，讲义气。",
    ),
    _h(
        key="si_ma_yi",
        name="司马懿",
        faction="魏",
        gender="男",
        max_hp=3,
        title="冢虎",
        skills=[Skill("fankui", "反馈", "当你受到伤害后，你可以弃置伤害来源的一张牌")],
        style="隐忍阴狠，滴水不漏。挨打也要咬回一口，偏好在低谷时翻盘。",
    ),
    _h(
        key="lv_bu",
        name="吕布",
        faction="群",
        gender="男",
        max_hp=4,
        title="飞将",
        skills=[Skill("wushuang", "无双", "你使用【杀】指定目标后，目标需要连续打出两张【闪】才能抵消；你对没有手牌的角色造成伤害 +1")],
        style="天下第一猛将，嗜血好战。只认拳头，不服就干，狂妄自负。",
    ),
    _h(
        key="sun_quan",
        name="孙权",
        faction="吴",
        gender="男",
        max_hp=4,
        title="孙仲谋",
        skills=[Skill("zhiheng", "制衡", "出牌阶段，你可以弃置任意张手牌并摸取等量的牌")],
        style="年轻有为，敢打敢拼。喜欢重新整理手牌，把牌换成更想要的组合。",
    ),
    _h(
        key="da_qiao",
        name="大乔",
        faction="吴",
        gender="女",
        max_hp=3,
        title="江东二乔",
        skills=[Skill("tiansiang", "天香", "当你受到伤害时，你可以弃置一张红色手牌防止此伤害")],
        style="温婉灵巧，善用红牌化解危机。优先自保，其次支援同伴。",
    ),
    _h(
        key="huang_zhong",
        name="黄忠",
        faction="蜀",
        gender="男",
        max_hp=4,
        title="老当益壮",
        skills=[Skill("liegong", "烈弓", "你使用【杀】无距离限制")],
        style="老而弥坚，百步穿杨。偏爱远程狙击远处残血目标。",
    ),
    _h(
        key="zhou_yu",
        name="周瑜",
        faction="吴",
        gender="男",
        max_hp=4,
        title="美周郎",
        skills=[Skill("yingzi", "英姿", "摸牌阶段，你可以多摸一张牌")],
        style="年少气盛，风度翩翩。手牌越多越敢打，善用范围攻击清场。",
    ),
]

HERO_BY_KEY: Dict[str, Hero] = {h.key: h for h in HEROES}


def get_hero(key: str) -> Hero:
    if key in HERO_BY_KEY:
        return HERO_BY_KEY[key]
    raise KeyError(f"未知武将：{key}")


# 默认阵容：三个模型各带一名武将
DEFAULT_LINEUP: Dict[str, str] = {
    "minimax-m3.1-flash": "zhang_fei",
    "deepseek-flash": "zhu_ge_liang",
    "mimo-v2.6-flash": "guan_yu",
}
