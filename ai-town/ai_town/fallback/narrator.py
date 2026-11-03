"""离线兜底：程序化叙述器。

没有本地模型（或模型返回垃圾）时，游戏照样能玩：
所有叙事由模板 + 词库 + 确定性随机拼装，并且会**读小镇当前状态**，
所以"缺粮时不会给你丰收事件""镇长欠钱时不会有大商队"。
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from ..models import Choice, EventCard, MarketBrief, NPC, Quest
from ..rng import RNG
from ..state import BUILDING_DEFS, TownState

SURNAMES = ["赵", "钱", "孙", "李", "周", "吴", "郑", "王", "冯", "陈", "褚", "卫",
            "蒋", "沈", "韩", "杨", "朱", "秦", "尤", "许", "何", "吕", "施", "张"]
GIVEN = ["阿禾", "三娘", "石头", "老栓", "小满", "青禾", "半夏", "望山", "拾一", "照月",
         "铁生", "云开", "如晦", "有田", "归舟", "不辞", "知白", "听雨", "守拙", "长庚",
         "溪奴", "春生", "定国", "素心", "沉舟", "子期", "南山", "寄北"]

ROLES = ["农夫", "铁匠", "商人", "学者", "医匠", "猎人", "牧人", "鞋匠", "酒馆主",
         "游吟诗人", "退休的老镇长", "孤儿"]

TRAITS = ["沉默寡言", "热心肠", "固执", "精明", "爱笑", "多疑", "倔强", "温和",
          "刻薄", "仗义", "懒散", "严谨", "好奇", "胆怯", "慷慨", "记仇"]

SECRET_TEMPLATES = [
    "他其实不是本地人，二十年前从北边逃来。",
    "他藏着一笔当年做军需时昧下的钱。",
    "他偷偷在夜里去镇外的老坟地，不知道在看什么。",
    "他认得那个每月初来赶集的外乡人，却从不说起。",
    "他有一封信，至今没敢拆开。",
    "他知道旧井塌方那晚是谁动的手，但不敢说。",
    "他年轻时也想过离开小镇，是某个人把他劝回来的。",
    "他欠着镇上某个人一笔还不清的人情。",
    "他其实不会打铁，手艺是跟死去的师父学的最后一样东西。",
    "他替人保管着一个不能说的名字。",
]

BACKGROUNDS = [
    "在山里长大，靠一把柴刀活到成年。",
    "早年在邻镇做过账房，精于算术。",
    "战乱里丢了家，带着母亲走到这里就没再走。",
    "三代都在这里种同一块地。",
    "被城里学堂逐出来，理由没人愿意提。",
    "跑过几年船，见识过比镇子大得多的地方。",
    "为还债卖掉了自己的工具，却还留着学徒时打的第一把刀。",
    "在别的镇子开过医馆，因为一场失误关了门。",
    "每天最早醒来，却从不参加镇上的议事。",
    "喜欢在夜里写字，写的东西没人看过。",
]

RELATION_KINDS = ["亲族", "师徒", "旧怨", "债务", "旧友", "暗恋", "同乡"]

PLACES = ["井台", "石桥", "老磨坊", "祠堂前的空地", "南坡的篱笆", "码头",
          "旧兵营", "河湾的芦苇荡", "集市尽头", "学堂后院", "镇外的碑林"]

MARKET_NEWS = [
    "山口那边传来消息，{hot}的行情看涨。",
    "有行商在酒馆里说，{hot}最近走得慢，{cold}倒是抢手。",
    "昨夜的雨把官道泡软了，{hot}的货堆在了渡口。",
    "邻镇的告示贴在集市门口：{hot}要价，{cold}照旧。",
    "北岭的驮队换了货单，{hot}这阵子最被人念叨。",
]

HOT_WORDS = {
    "food": "粮食", "wood": "木材", "stone": "石料", "ore": "矿石",
    "tools": "工具", "books": "书籍", "liquor": "烈酒",
}

COLD_WORDS = {
    "food": "粮食", "wood": "木材", "stone": "石料", "ore": "矿石",
    "tools": "工具", "books": "书籍", "liquor": "烈酒",
}


class Narrator:
    """程序化叙述器（离线模式）。"""

    def __init__(self, rng: Optional[RNG] = None):
        self.rng = rng or RNG(0)
        self._counter = 0

    def _next_rng(self, state: TownState, tag: str) -> RNG:
        self._counter += 1
        return self.rng.spawn(f"{tag}-{state.day}-{self._counter}")

    # ------------------------------------------------------------------
    # NPC
    # ------------------------------------------------------------------
    def npcs(self, state: TownState, count: int = 8) -> List[NPC]:
        rng = self._next_rng(state, "npc")
        names: List[str] = []
        while len(names) < count:
            n = rng.choice(SURNAMES) + rng.choice(GIVEN)
            if n not in names:
                names.append(n)
        out: List[NPC] = []
        for i, name in enumerate(names):
            role = ROLES[i % len(ROLES)]
            out.append(
                NPC(
                    id=f"n_{i + 1}",
                    name=name,
                    role=role,
                    age=rng.randint(19, 64),
                    traits=rng.sample(TRAITS, 2),
                    background=rng.choice(BACKGROUNDS),
                    secret=rng.choice(SECRET_TEMPLATES),
                    trust=rng.randint(38, 62),
                    mood=rng.randint(45, 68),
                    skill=rng.randint(1, 4),
                    home_tile=rng.randrange(state.map_size * state.map_size),
                )
            )
        # 关系网
        for i in range(len(out)):
            for _ in range(rng.randint(0, 2)):
                j = rng.randrange(len(out))
                if j == i:
                    continue
                a, b = out[i], out[j]
                kind = rng.choice(RELATION_KINDS)
                delta = {"旧怨": -rng.randint(10, 40), "债务": -rng.randint(5, 25),
                         "暗恋": rng.randint(20, 50), "旧友": rng.randint(20, 45),
                         "亲族": rng.randint(40, 70), "师徒": rng.randint(25, 55),
                         "同乡": rng.randint(10, 35)}[kind]
                a.relations[b.id] = a.relations.get(b.id, 0) + delta
                b.relations[a.id] = b.relations.get(a.id, 0) + delta
                a.tags.append(f"relation:{kind}")
        return out

    # ------------------------------------------------------------------
    # 每日事件
    # ------------------------------------------------------------------
    def events(self, state: TownState, count: int = 4) -> List[EventCard]:
        rng = self._next_rng(state, "events")
        weights = self._event_weights(state)
        pool: List[Tuple[str, str, str, List[Dict[str, Any]]]] = []
        pool += self._disaster_templates(state)
        pool += self._social_templates(state)
        pool += self._opportunity_templates(state)
        pool += self._mystery_templates(state)
        pool += self._routine_templates(state)

        picked: List[EventCard] = []
        used_titles = set()
        for _ in range(count):
            candidates = [p for p in pool if p[1] not in used_titles]
            if not candidates:
                break
            weights2 = []
            for c in candidates:
                w = weights.get(c[0], 1.0)
                if c[0] == "disaster" and state.season != "冬":
                    w *= 0.6
                weights2.append(max(0.05, w))
            total = sum(weights2)
            pick = rng.random() * total
            acc = 0.0
            chosen = candidates[-1]
            for c, w in zip(candidates, weights2):
                acc += w
                if pick <= acc:
                    chosen = c
                    break
            kind, title, text_tpl, choices = chosen
            used_titles.add(title)
            text = self._fill(text_tpl, state, rng)
            made_choices = []
            for i, ch in enumerate(choices):
                made_choices.append(
                    Choice(
                        id=f"c{i}",
                        label=self._fill(ch["label"], state, rng),
                        hint=ch.get("hint", ""),
                        effects=dict(ch.get("effects") or {}),
                    )
                )
            picked.append(
                EventCard(
                    id=f"e{state.day}_{len(picked)}",
                    title=self._fill(title, state, rng),
                    text=text,
                    kind=kind,
                    choices=made_choices,
                    day=state.day,
                    source="template",
                )
            )
        return picked

    def _event_weights(self, state: TownState) -> Dict[str, float]:
        w = {"disaster": 1.0, "social": 1.4, "opportunity": 1.3, "mystery": 1.1, "routine": 0.8}
        pop = max(1, state.population)
        if state.resource("food") < pop * 2:
            w["disaster"] += 1.2
            w["routine"] -= 0.3
        if state.resource("coin") < 60:
            w["opportunity"] += 0.9
        if state.season == "冬":
            w["disaster"] += 0.8
            w["opportunity"] -= 0.3
        if state.active_quest():
            w["mystery"] += 0.9
        if state.morale < 40:
            w["social"] += 0.8
        return w

    # -- 各类型模板 ---------------------------------------------------
    def _disaster_templates(self, state: TownState) -> List[Tuple[str, str, str, List[Dict[str, Any]]]]:
        return [
            ("disaster", "井水变苦了", "井台上打上来的水泛着铁腥味。{npc}第一个发现，"
             "他尝了一口就吐在墙根。镇民们围着井口，谁也不肯先回家。",
             [{"label": "封井，另找水源", "effects": {"coin": -15, "morale": -3}},
              {"label": "花钱请人清理井底", "effects": {"coin": -25, "food": 4}},
              {"label": "让大家先喝井边的雨水", "effects": {"morale": -6, "food": -2}}]),
            ("disaster", "仓库失窃", "夜里有人撬开了粮仓的锁。清点之后，"
             "少了近三成的存粮，地上却留着一串陌生的脚印。",
             [{"label": "派人彻查脚印", "effects": {"coin": -5, "morale": 2}},
              {"label": "只字不提，抓紧补货", "effects": {"coin": -18, "morale": -2}},
              {"label": "召集全镇会议追责", "effects": {"morale": -4, "renown": 3}}]),
            ("disaster", "西坡塌了一角", "西坡的土在夜里松了半边，差点压到下面的菜地。"
             "{npc}说这不是第一次了，他记得上一任镇长也这么说过。",
             [{"label": "组织人手加固山坡", "effects": {"wood": -6, "food": 4, "morale": 3}},
              {"label": "把西坡划成禁地", "effects": {"food": -5, "morale": -2}},
              {"label": "先迁走受影响的农户", "effects": {"coin": -12, "morale": 5}}]),
            ("disaster", "寒潮提前来了", "风比往年早半个月转向北方。地里还没熟的麦子"
             "在夜里冻成了灰绿色，{npc}蹲在田边一言不发。",
             [{"label": "组织抢收能抢的", "effects": {"food": 10, "wood": -4}},
              {"label": "烧掉所有木料取暖", "effects": {"wood": -14, "morale": -4}},
              {"label": "向邻镇借粮", "effects": {"coin": -20, "food": 14}}]),
        ]

    def _social_templates(self, state: TownState) -> List[Tuple[str, str, str, List[Dict[str, Any]]]]:
        return [
            ("social", "酒馆里的争执", "两个男人在{place}吵了起来，谁也不肯让。"
             "{npc}站在中间劝架，却劝得脸红脖子粗。",
             [{"label": "分开二人，各罚一天工", "effects": {"harsh": 1, "coin": 4}},
              {"label": "让他们把话说完", "effects": {"kind": 1, "morale": 3}},
              {"label": "出面替其中一方赔礼", "effects": {"coin": -8, "renown": 2}}]),
            ("social", "一封没有署名的信", "有人把一封没有署名的信塞进了镇长的门缝。"
             "信里只有一句话：“你前任不干净。”",
             [{"label": "追查写信人", "effects": {"coin": -6, "renown": 2, "flag": "追查旧账"}},
              {"label": "烧掉，不予理会", "effects": {"morale": -2, "coin": 2}},
              {"label": "把信拿到议事会上公开", "effects": {"morale": -5, "renown": 4}}]),
            ("social", "孤儿要读书", "{npc}领着一个孩子来敲你的门。孩子想上学，"
             "但镇上的学堂刚开张，谁也不知道该不该收。",
             [{"label": "免学费，收下他", "effects": {"coin": -8, "renown": 4}},
              {"label": "让镇民轮流教他识字", "effects": {"morale": 4, "renown": 2}},
              {"label": "建议他先去干活挣钱", "effects": {"coin": 6, "morale": -3}}]),
            ("social", "婚事与聘礼", "两家要结亲，聘礼数目在{place}吵成了僵局，"
             "两家都看着你，等一个说法。",
             [{"label": "按老规矩裁断", "effects": {"renown": 2, "morale": 1}},
              {"label": "让两家自己谈", "effects": {"morale": -3, "coin": 3}},
              {"label": "镇里出一半聘礼", "effects": {"coin": -14, "morale": 6}}]),
        ]

    def _opportunity_templates(self, state: TownState) -> List[Tuple[str, str, str, List[Dict[str, Any]]]]:
        return [
            ("opportunity", "行商路过", "一支商队停在{place}外，领头人说他们愿意出好价钱"
             "收矿石和粮食，还带了一批镇上没有的干货。",
             [{"label": "卖出一批存货", "effects": {"coin": 22, "ore": -6}},
              {"label": "只卖多余的粮食", "effects": {"coin": 12, "food": -8}},
              {"label": "留着货，等更好的价钱", "effects": {"patient": 1, "coin": -2}}]),
            ("opportunity", "矿脉露头", "有人在{place}的岩壁上看见一丝亮色，"
             "也许是矿，也许只是石英。{npc}赌上了自己的工钱要试试。",
             [{"label": "拨钱给他试采", "effects": {"coin": -12, "ore": 8}},
              {"label": "按旧规矩抽成", "effects": {"coin": 6, "ore": 4, "renown": -2}},
              {"label": "叫停，别拿镇上的命赌", "effects": {"safe": 1, "coin": -2}}]),
            ("opportunity", "邻镇来借人", "邻镇的石匠忙不过来，愿出双倍的工钱借我们的人"
             "去帮一个月。{npc}第一个来问你的意见。",
             [{"label": "借人过去，赚一笔", "effects": {"coin": 30, "food": -6, "morale": -3}},
              {"label": "婉拒，把人留在镇上", "effects": {"morale": 4, "coin": -2}},
              {"label": "借人，但要求对方供粮", "effects": {"coin": 18, "food": 6}}]),
            ("opportunity", "学徒上门", "一个少年带着一把卷刃的旧刀站在门口，"
             "说想拜镇上的老师傅为师。",
             [{"label": "破格收下他", "effects": {"coin": -6, "renown": 3}},
              {"label": "按规矩先做三年学徒", "effects": {"coin": 4, "morale": 1}},
              {"label": "劝他另谋出路", "effects": {"coin": 2, "renown": -2}}]),
        ]

    def _mystery_templates(self, state: TownState) -> List[Tuple[str, str, str, List[Dict[str, Any]]]]:
        return [
            ("mystery", "旧镇长的账本", "有人在{place}找到一本发霉的账本，"
             "上面记着上任镇长时期的每一笔进出。最后几页被撕掉了。",
             [{"label": "彻查账目", "effects": {"coin": -8, "flag": "旧账"}},
              {"label": "把账本烧掉", "effects": {"coin": 3, "morale": -3}},
              {"label": "私下问{ npc }", "effects": {"flag": "旧账", "renown": 2}}]),
            ("mystery", "夜里的脚步声", "连着三晚，有人听见{place}有脚步声。"
             "{npc}说他不敢去看，但也不敢再睡。",
             [{"label": "带人夜巡", "effects": {"coin": -5, "morale": 4, "flag": "夜访者"}},
              {"label": "加派人手守夜", "effects": {"coin": -10, "morale": 2}},
              {"label": "装作不知道", "effects": {"morale": -4}}]),
            ("mystery", "碑林里的新土", "镇外碑林有一块碑下的土是新的，"
             "像是刚被人翻动过。{npc}说那下面埋的不是本镇人。",
             [{"label": "亲自去挖开看看", "effects": {"risk": "high", "flag": "碑林"}},
              {"label": "派可信的人去查", "effects": {"coin": -6, "flag": "碑林"}},
              {"label": "那是别人的事", "effects": {"morale": -2}}]),
            ("mystery", "一封寄给死人的信", "邮差送来一封贴着旧邮票的信，"
             "收信人是十年前就搬走的{ npc }。信封里只有一张空白纸。",
             [{"label": "追查寄信人", "effects": {"coin": -4, "flag": "空白信"}},
              {"label": "烧掉，别让镇上乱传", "effects": {"coin": 2, "morale": -2}},
              {"label": "把信交给{ npc }看", "effects": {"renown": 3, "flag": "空白信"}}]),
        ]

    def _routine_templates(self, state: TownState) -> List[Tuple[str, str, str, List[Dict[str, Any]]]]:
        return [
            ("routine", "集市日", "今天逢集。{place}挤满了人，"
             "吵吵嚷嚷，也热热闹闹。",
             [{"label": "去逛逛，顺手看看行情", "effects": {"coin": -4, "food": 2}},
              {"label": "在集市上招募人手", "effects": {"coin": -2, "morale": 2}},
              {"label": "留在镇公所处理公务", "effects": {"coin": 6, "morale": -2}}]),
            ("routine", "秋收之后", "{npc}把最后一车粮堆进了仓，回头问镇长："
             "“今年这粮，够不够撑到开春？”",
             [{"label": "开仓平价卖粮", "effects": {"coin": 16, "food": -12, "morale": 5}},
              {"label": "全部囤起来等灾年", "effects": {"food": 4, "morale": -3}},
              {"label": "提高税粮，改收现钱", "effects": {"coin": 22, "morale": -6}}]),
            ("routine", "有人来求个差事", "{npc}在门口等着，想讨一份活干。"
             "镇上的活计不算多，但也不能让人白等。",
             [{"label": "给他一份工", "effects": {"coin": -5, "morale": 3}},
              {"label": "让他去学堂帮忙", "effects": {"food": -3, "renown": 2}},
              {"label": "眼下没有活，请他再等等", "effects": {"morale": -3, "coin": 2}}]),
        ]

    def _fill(self, text: str, state: TownState, rng: RNG) -> str:
        alive = [n for n in state.npcs if n.alive]
        npc = rng.choice(alive).name if alive else "老周"
        place = rng.choice(PLACES)
        out = (text.replace("{ npc }", npc).replace("{npc}", npc)
               .replace("{place}", place).replace("{player}", "镇长"))
        return out

    # ------------------------------------------------------------------
    # 行情风向（离线兜底）
    # ------------------------------------------------------------------
    def market_brief(self, state: TownState) -> MarketBrief:
        rng = self._next_rng(state, "market")
        hot: List[str] = []
        cold: List[str] = []
        if state.season == "冬":
            hot = ["food", "wood"]
            cold = ["tools", "books"]
        elif state.season == "秋":
            hot = ["food"]
            cold = ["ore", "tools"]
        elif state.season == "夏":
            hot = ["ore"]
            cold = ["food"]
        else:
            hot = [rng.choice(["wood", "stone", "food"])]
        if state.resource("food") < state.population * 2 and "food" not in hot:
            hot.append("food")
        if state.resource("ore") < 4 and "ore" not in hot:
            hot.append("ore")
        hot = hot[:3]
        cold = [g for g in cold if g not in hot][:3]
        caravan_hint = [rng.choice([g for g in ("food", "wood", "ore", "tools") if g not in cold] or ["ore"])]
        news = rng.choice(MARKET_NEWS).format(
            hot="、".join(HOT_WORDS.get(g, g) for g in hot) or "货",
            cold="、".join(COLD_WORDS.get(g, g) for g in cold) or "别的货",
        )
        return MarketBrief(hot=hot, cold=cold, caravan_hint=caravan_hint[:2], news=news, source="template")

    # ------------------------------------------------------------------
    # DM 叙事
    # ------------------------------------------------------------------
    def narrate(self, state: TownState, action: str, npc: Optional[NPC] = None) -> Tuple[str, List[Choice]]:
        rng = self._next_rng(state, "dm")
        action = (action or "").strip()
        intent = self._classify(state, action)
        text, effects = self._resolve_intent(state, intent, action, rng)
        choices = self._followup_choices(state, intent, rng)
        if effects and choices:
            merged = dict(effects)
            merged.update(choices[0].effects)
            choices[0].effects = merged
        return text, choices

    def _classify(self, state: TownState, action: str) -> str:
        a = action
        for kind in BUILDING_DEFS:
            if kind in a or BUILDING_DEFS[kind]["name"] in a:
                if any(k in a for k in ("建", "盖", "开", "修", "扩")):
                    return f"build:{kind}"
        if any(k in a for k in ("招募", "雇", "聘", "招工", "收留")):
            return "hire"
        if any(k in a for k in ("问", "拜访", "找", "谈谈", "聊", "说服")):
            return "talk"
        if any(k in a for k in ("卖", "买", "交易", "商队", "议价")):
            return "trade"
        if any(k in a for k in ("调查", "查", "搜查", "搜寻", "探索", "追踪")):
            return "investigate"
        if any(k in a for k in ("种", "耕", "开荒", "农")):
            return "farm"
        if any(k in a for k in ("修", "补", "加固")):
            return "repair"
        if any(k in a for k in ("休", "睡", "歇")):
            return "rest"
        if any(k in a for k in ("吃", "宴", "酒", "庆")):
            return "celebrate"
        return "generic"

    def _resolve_intent(self, state: TownState, intent: str, action: str, rng: RNG) -> Tuple[str, Dict[str, Any]]:
        npc = rng.choice([n for n in state.npcs if n.alive]) if state.npcs else None
        who = npc.name if npc else "老周"
        if intent.startswith("build:"):
            kind = intent.split(":", 1)[1]
            d = BUILDING_DEFS[kind]
            cost = d["cost"]
            lacking = [k for k, v in cost.items() if state.resource(k) < v]
            if lacking:
                from ..models import RESOURCE_LABELS
                names = "、".join(RESOURCE_LABELS.get(k, k) for k in lacking)
                return (f"你叫来了匠人，图纸摊在{PLACES[0 % len(PLACES)]}的石桌上。"
                        f"可一算料钱，{names}就卡住了——匠人们卷起图纸走了。"
                        f"「镇长，{d['name']}不是嘴上说说的事。」", {"coin": -2})
            return (f"你在{PLACES[rng.randrange(len(PLACES))]}旁边划出一块地，"
                    f"锤子声从早响到晚。{d['name']}立起来了，村里人围着看稀奇，"
                    f"说新镇长还真有两下子。", {"build:" + kind: 1})
        if intent == "hire":
            return (f"你在{PLACES[rng.randrange(len(PLACES))]}支起了招人的桌子。"
                    f"{who}最先过来，问的却不是工钱，而是「镇上到底还缺不缺人」。"
                    f"你把话说清楚了，队伍才慢慢排起来。", {"population": 1, "coin": -6})
        if intent == "talk":
            return (f"你在{PLACES[rng.randrange(len(PLACES))]}找到了{who}。"
                    f"起初对方只是敷衍，直到你问到某件具体的小事，"
                    f"他才抬起头认真看了你一眼。", {"all_trust": 1, "renown": 2})
        if intent == "trade":
            return (f"你把仓库的账翻了三遍，才敢去和商队的人开口。"
                    f"对方压价压得狠，你咬着牙没有让步——至少这一次没有。",
                    {"trade": 1, "coin": 8})
        if intent == "investigate":
            return (f"你带着人把{PLACES[rng.randrange(len(PLACES))]}翻了个遍。"
                    f"没找到想要的东西，倒找到几样不该在那儿的东西。"
                    f"你把它们收好，谁也没说。", {"flag": "调查线索", "coin": -3, "risk": "low"})
        if intent == "farm":
            return (f"天刚亮你就下了地。{who}说今年雨水不错，"
                    f"「要是再不补种，今年的粮就悬了。」你挽起袖子，一起下了地。",
                    {"food": 8, "morale": 3})
        if intent == "repair":
            return (f"你带着人把破掉的地方一段段补好。木料用了不少，"
                    f"但看着它重新立起来，谁都觉得这钱花得值。", {"wood": -5, "morale": 5})
        if intent == "rest":
            return (f"你在镇公所的椅子上睡了一个下午。醒来时天已经黑了，"
                    f"桌上不知谁放了一碗还温着的粥。", {"morale": 4})
        if intent == "celebrate":
            return (f"{PLACES[rng.randrange(len(PLACES))]}热闹了一整晚。"
                    f"酒喝光了两坛，故事讲了十三个，有三个没人信。", {"coin": -8, "morale": 8, "renown": 2})
        return (f"你把要做的事在脑子里过了一遍，然后照着做了。"
                f"{who}在一边看着，没说好，也没说不好。"
                f"镇子还是那个镇子，只是有些东西悄悄挪动了一点。", {"coin": -2})

    def _followup_choices(self, state: TownState, intent: str, rng: RNG) -> List[Choice]:
        alive = [n for n in state.npcs if n.alive]
        who = rng.choice(alive).name if alive else "他"
        return [
            Choice(id="c0", label="继续追查这件事", hint="深入", effects={"flag": "追查", "coin": -4}),
            Choice(id="c1", label=f"先安抚民心，让大家安心", hint="稳", effects={"kind": 1, "morale": 4}),
            Choice(id="c2", label=f"找{who}单独谈谈", hint="人心", effects={"all_trust": 1, "renown": 1}),
        ]

    # ------------------------------------------------------------------
    # 主线
    # ------------------------------------------------------------------
    def quest(self, state: TownState) -> Quest:
        rng = self._next_rng(state, "quest")
        alive = [n for n in state.npcs if n.alive]
        target = rng.choice(alive) if alive else None
        titles = ["失踪的老镇长", "井里的第二把钥匙", "不该存在的账目",
                  "碑林里的第八块碑", "写在墙上的名字", "换季之夜的口供"]
        title = rng.choice(titles)
        premise = (
            f"上任镇长离任那天没带走任何东西，却带走了一个名字。"
            f"三个月后，{target.name if target else '镇上的老仆'}在{PLACES[rng.randrange(len(PLACES))]}"
            f"认出了那个名字——它就写在镇公所的旧告示上，被人用刀刮过。"
        )
        stages = [
            f"弄清是谁刮掉了告示",
            f"找到与「{target.name if target else '那个人'}」有关的证人",
            "在旧镇长留下的东西里找到真相",
        ]
        return Quest(
            id=f"q_{state.day}",
            title=title,
            premise=premise,
            goal="查清前任镇长留下的谜团",
            stages=stages,
            stage=0,
            status="active",
            reward={"renown": 12, "coin": 80},
            target_npc=target.id if target else "",
            clues=[],
            source="template",
        )

    # ------------------------------------------------------------------
    # 对话
    # ------------------------------------------------------------------
    def talk(self, state: TownState, npc: NPC, player_text: str) -> Tuple[str, List[Choice]]:
        rng = self._next_rng(state, "talk")
        secretish = any(k in (player_text or "") for k in ("秘密", "真相", "当年", "为什么", "对不起", "帮我"))
        if npc.trust >= 65 and secretish:
            body = (f"{npc.name}沉默了很久，然后压低声音说："
                    f"「{npc.secret}」说完他又改了口，「这事你别到处说。」")
        elif npc.trust >= 65:
            body = (f"{npc.name}和你聊了很久，说起小时候的事。"
                    f"他讲到一半忽然停住，像是想起什么不太愿意提的旧事。")
        else:
            body = (f"{npc.name}敷衍地应了两句，眼睛一直往别处看。"
                    f"他还不信任你——或者说，还不想被信任。")
        choices = [
            Choice(id="c0", label="继续追问那件旧事", hint="冒险", effects={"trust:" + npc.id: 1, "risk": "low"}),
            Choice(id="c1", label="换个话题，聊点轻松的", hint="缓和", effects={"trust:" + npc.id: 1, "morale": 2}),
            Choice(id="c2", label="给他一点时间", hint="退一步", effects={"trust:" + npc.id: 1, "patient": 1}),
        ]
        return body, choices
