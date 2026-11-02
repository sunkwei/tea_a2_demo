extends Node
## GoDot 数据表：武将武技 / 敌兵 / 关卡配置。
## 纯数据 + 查询函数，方便无头自测（见 tools/selftest.gd）。

const RARITY_NAMES := {1: "普通", 2: "精良", 3: "史诗", 4: "传说"}
const RARITY_COLORS := {
	1: Color(0.72, 0.72, 0.78),
	2: Color(0.38, 0.82, 0.46),
	3: Color(0.38, 0.66, 0.98),
	4: Color(0.98, 0.68, 0.26),
}

## 武技池：玩家的「三选一」卡牌来源。
## kind 决定主动技效果（见 scripts/skill_system.gd）；passive 由 player.apply_passive 处理。
const SKILLS: Array = [
	{
		"id": "guanyu_crescent", "general": "关羽", "name": "青龙偃月斩",
		"rarity": 4, "kind": "active", "cd": 7.0, "mult": 2.6,
		"icon": "res://assets/ui/icon_01.png", "tint": Color(0.42, 0.86, 0.48),
		"desc": "青锋八尺，偃月一斩：对前方 120° 扇形造成 260% 伤害，并令目标破防 3 秒（受伤 +25%）。",
	},
	{
		"id": "lvbu_fangtian", "general": "吕布", "name": "方天画戟",
		"rarity": 4, "kind": "active", "cd": 9.0, "mult": 2.2,
		"icon": "res://assets/ui/icon_02.png", "tint": Color(0.92, 0.36, 0.34),
		"desc": "戟出如山：横扫周身 4.2 米范围，造成 220% 伤害并把敌人击飞。",
	},
	{
		"id": "zhangfei_roar", "general": "张飞", "name": "当阳桥吼",
		"rarity": 3, "kind": "active", "cd": 11.0, "mult": 1.2,
		"icon": "res://assets/ui/icon_03.png", "tint": Color(0.55, 0.45, 0.38),
		"desc": "一声断喝：半径 4.5 米内敌人受 120% 伤害，被击退并眩晕 1.5 秒。",
	},
	{
		"id": "zhaoyun_charge", "general": "赵云", "name": "七进七出",
		"rarity": 3, "kind": "active", "cd": 6.0, "mult": 1.8,
		"icon": "res://assets/ui/icon_04.png", "tint": Color(0.92, 0.94, 0.98),
		"desc": "长坂坡七进七出：向前突进 5 米，途中无敌并造成 180% 伤害。",
	},
	{
		"id": "zhaoyun_stance", "general": "赵云", "name": "龙胆",
		"rarity": 2, "kind": "passive", "cd": 0.0, "mult": 0.0,
		"icon": "res://assets/ui/icon_05.png", "tint": Color(0.86, 0.9, 0.96),
		"desc": "银枪龙胆：暴击率 +12%，暴击伤害 +15%。",
	},
	{
		"id": "zhugeliang_array", "general": "诸葛亮", "name": "八阵图",
		"rarity": 3, "kind": "active", "cd": 14.0, "mult": 0.6,
		"icon": "res://assets/ui/icon_06.png", "tint": Color(0.55, 0.78, 0.95),
		"desc": "石兵布阵：召出半径 3.6 米的八阵图，6 秒内每秒造成 60% 伤害，阵中敌人受伤 -25%。",
	},
	{
		"id": "zhugeliang_woodox", "general": "诸葛亮", "name": "木牛流马",
		"rarity": 3, "kind": "active", "cd": 16.0, "mult": 0.55,
		"icon": "res://assets/ui/icon_07.png", "tint": Color(0.72, 0.58, 0.35),
		"desc": "木牛流马：召出两台辎重，12 秒内自动向敌人连发弩矢。",
	},
	{
		"id": "zhugeliang_empty", "general": "诸葛亮", "name": "空城计",
		"rarity": 3, "kind": "passive", "cd": 0.0, "mult": 0.0,
		"icon": "res://assets/ui/icon_08.png", "tint": Color(0.62, 0.8, 0.98),
		"desc": "虚张声势：生命低于 35% 时减伤 45%，且移动速度 +20%。",
	},
	{
		"id": "huangzhong_arrow", "general": "黄忠", "name": "百步穿杨",
		"rarity": 2, "kind": "passive", "cd": 0.0, "mult": 0.0,
		"icon": "res://assets/ui/icon_09.png", "tint": Color(0.85, 0.72, 0.4),
		"desc": "老当益壮：普攻化作远程箭矢，射程大增并可穿透一名敌人。",
	},
	{
		"id": "machao_cavalry", "general": "马超", "name": "西凉铁骑",
		"rarity": 3, "kind": "active", "cd": 10.0, "mult": 2.2,
		"icon": "res://assets/ui/icon_10.png", "tint": Color(0.78, 0.8, 0.86),
		"desc": "西凉铁骑：策马冲锋 6 米，沿途撞击造成 220% 伤害并眩晕 1 秒。",
	},
	{
		"id": "zhouyu_fire", "general": "周瑜", "name": "赤壁火计",
		"rarity": 3, "kind": "active", "cd": 12.0, "mult": 0.55,
		"icon": "res://assets/ui/icon_01.png", "tint": Color(0.95, 0.5, 0.2),
		"desc": "火攻赤壁：召出半径 3.2 米的火海，8 秒内每秒灼烧 55% 伤害。",
	},
	{
		"id": "caocao_cunning", "general": "曹操", "name": "奸雄",
		"rarity": 3, "kind": "passive", "cd": 0.0, "mult": 0.0,
		"icon": "res://assets/ui/icon_02.png", "tint": Color(0.55, 0.5, 0.62),
		"desc": "唯才是举：每次击杀回复 4 点生命，并永久 +2 攻击（上限 +15）。",
	},
	{
		"id": "caocao_benevolence", "general": "曹操", "name": "仁德",
		"rarity": 2, "kind": "active", "cd": 14.0, "mult": 0.0,
		"icon": "res://assets/ui/icon_03.png", "tint": Color(0.75, 0.8, 0.9),
		"desc": "推心置腹：恢复 30% 生命，并获得可吸收 40 点伤害的护盾。",
	},
	{
		"id": "diaochan_beauty", "general": "貂蝉", "name": "闭月羞花",
		"rarity": 3, "kind": "active", "cd": 12.0, "mult": 0.0,
		"icon": "res://assets/ui/icon_04.png", "tint": Color(0.96, 0.66, 0.78),
		"desc": "闭月羞花：半径 5 米内的敌人 3 秒内改为攻击你的同伴。",
	},
	{
		"id": "sunshangxiang_fierce", "general": "孙尚香", "name": "枭姬",
		"rarity": 2, "kind": "passive", "cd": 0.0, "mult": 0.0,
		"icon": "res://assets/ui/icon_05.png", "tint": Color(0.9, 0.6, 0.45),
		"desc": "弓腰美人：暴击伤害 +50%。",
	},
	{
		"id": "zhangliao_raid", "general": "张辽", "name": "威震逍遥津",
		"rarity": 3, "kind": "active", "cd": 10.0, "mult": 1.7,
		"icon": "res://assets/ui/icon_06.png", "tint": Color(0.5, 0.72, 0.85),
		"desc": "八百破阵：突进斩击，路径上造成 170% 伤害并令敌人恐惧 2 秒。",
	},
	{
		"id": "taishici_godshot", "general": "太史慈", "name": "神射",
		"rarity": 2, "kind": "passive", "cd": 0.0, "mult": 0.0,
		"icon": "res://assets/ui/icon_07.png", "tint": Color(0.7, 0.85, 0.6),
		"desc": "信义笃烈：攻击范围 +40%，攻击力 +10%。",
	},
	{
		"id": "ganning_jinpan", "general": "甘宁", "name": "锦帆",
		"rarity": 1, "kind": "passive", "cd": 0.0, "mult": 0.0,
		"icon": "res://assets/ui/icon_08.png", "tint": Color(0.45, 0.78, 0.85),
		"desc": "兴霸鞭：移动速度 +12%。",
	},
]

## 敌兵图鉴。
const ENEMIES: Dictionary = {
	"footman": {
		"name": "黄巾卒", "faction": "yellow", "unit": "Pawn",
		"hp": 36.0, "speed": 2.6, "dmg": 8.0, "range": 1.7, "cd": 1.2, "xp": 5,
		"scale": 1.0, "ranged": false,
	},
	"archer": {
		"name": "黄巾弓手", "faction": "yellow", "unit": "Archer",
		"hp": 28.0, "speed": 2.2, "dmg": 9.0, "range": 9.0, "cd": 1.7, "xp": 7,
		"scale": 1.0, "ranged": true, "proj": "arrow",
	},
	"lancer": {
		"name": "黄巾枪兵", "faction": "yellow", "unit": "Lancer",
		"hp": 62.0, "speed": 3.0, "dmg": 12.0, "range": 2.1, "cd": 1.3, "xp": 9,
		"scale": 1.0, "ranged": false,
	},
	"zealot": {
		"name": "黄巾力士", "faction": "yellow", "unit": "Pawn",
		"hp": 115.0, "speed": 2.2, "dmg": 15.0, "range": 1.9, "cd": 1.5, "xp": 15,
		"scale": 1.3, "ranged": false, "armor": 2.0,
	},
	"elite_zhangbao": {
		"name": "渠帅·张宝", "faction": "yellow", "unit": "Warrior",
		"hp": 340.0, "speed": 3.2, "dmg": 18.0, "range": 2.3, "cd": 1.2, "xp": 60,
		"scale": 1.35, "ranged": false, "elite": true,
	},
	"elite_bocai": {
		"name": "渠帅·波才", "faction": "yellow", "unit": "Warrior",
		"hp": 300.0, "speed": 2.9, "dmg": 16.0, "range": 2.3, "cd": 1.3, "xp": 55,
		"scale": 1.3, "ranged": false, "elite": true,
	},
	"boss_zhangjiao": {
		"name": "大贤良师·张角", "faction": "yellow", "unit": "Monk",
		"hp": 1600.0, "speed": 2.0, "dmg": 24.0, "range": 3.0, "cd": 1.6, "xp": 300,
		"scale": 1.9, "ranged": false, "boss": true, "armor": 4.0,
		"abilities": ["heal_allies", "thunder_strike"],
	},
}

## 第一关：黄巾之乱 · 广宗道（三个阶段，共 15 波）
const LEVEL1: Dictionary = {
	"id": "level1",
	"name": "第一关 · 黄巾之乱",
	"subtitle": "广宗道",
	"intro": "建安元年，黄巾举旗。义军自广宗道起，转战三处，渠帅张角坐镇大贤良师府。",
	"stages": [
		{
			"name": "阶段一 · 村口哨所",
			"waves": [
				{"spawns": [["footman", 3]], "note": "村口哨所遇黄巾哨兵！"},
				{"spawns": [["footman", 4], ["archer", 1]], "note": "贼众渐多，小心弓箭。"},
				{"spawns": [["footman", 4], ["archer", 2]], "note": "黄巾列阵于田埂之上。"},
				{"spawns": [["footman", 5], ["lancer", 2]], "note": "长枪手压阵，速战速决。"},
				{"spawns": [["footman", 4], ["archer", 2]], "elite": "elite_zhangbao", "elite_count": 1,
					"note": "渠帅张宝亲至！"},
			],
		},
		{
			"name": "阶段二 · 破庙道场",
			"waves": [
				{"spawns": [["footman", 5], ["archer", 2]], "note": "破庙前，黄巾设伏。"},
				{"spawns": [["footman", 4], ["lancer", 3]], "note": "枪兵列阵，步步为营。"},
				{"spawns": [["footman", 6], ["archer", 3]], "elite": "elite_bocai", "elite_count": 1,
					"note": "波才引兵自庙后杀出！"},
				{"spawns": [["zealot", 2], ["footman", 4]], "note": "黄巾力士力大难挡。"},
				{"spawns": [["footman", 6], ["lancer", 3], ["archer", 2]],
					"elite": "elite_zhangbao", "elite_count": 1, "elite2": "elite_bocai",
					"note": "两渠帅并至，围困道场！"},
			],
		},
		{
			"name": "阶段三 · 广宗城门",
			"waves": [
				{"spawns": [["footman", 6], ["lancer", 3]], "note": "兵临广宗城门。"},
				{"spawns": [["zealot", 3], ["archer", 3]], "note": "城头乱箭如雨。"},
				{"spawns": [["footman", 8], ["archer", 3], ["lancer", 2]], "note": "贼众倾巢而出！"},
				{"spawns": [["zealot", 2], ["lancer", 4]], "elite": "elite_zhangbao", "elite_count": 1,
					"note": "张宝死守城门！"},
				{"spawns": [["footman", 6], ["archer", 2]], "boss": "boss_zhangjiao",
					"note": "大贤良师张角现身，太平道起！"},
			],
		},
	],
}

## 把关卡配置拍平成「波列表」，并记录每波所属阶段。
static func flatten_waves(level: Dictionary) -> Array:
	var out: Array = []
	var stages: Array = level.get("stages", [])
	for s in stages:
		for w in s.get("waves", []):
			var entry: Dictionary = (w as Dictionary).duplicate(true)
			entry["stage_name"] = s.get("name", "")
			out.append(entry)
	return out

static func skill_by_id(id: String) -> Dictionary:
	for s in SKILLS:
		if s["id"] == id:
			return s
	return {}

static func skills_of_kind(kind: String) -> Array:
	var out: Array = []
	for s in SKILLS:
		if s["kind"] == kind:
			out.append(s)
	return out
