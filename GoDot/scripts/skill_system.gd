class_name SkillSystem
extends RefCounted
## 武将武技执行器：把数据表里的「武技」翻译成战场上的实际效果。
## 纯静态函数 + 鸭子类型，方便无头自测。

## 执行一次主动武技。arena / player 由调用方传入。
static func execute(arena: Node, player: Node, skill: Dictionary) -> void:
	var kind: String = skill.get("kind", "")
	var mult: float = skill.get("mult", 1.0)
	var pos: Vector3 = player.global_position
	match kind:
		"cone":
			arena.damage_cone(pos, player.aim_direction(), 120.0, 3.4, mult, {"armor_break": 3.0})
		"shockwave":
			arena.damage_radius(pos, 4.5, mult, {"knockback": 7.0, "stun": 1.5})
		"dash_strike":
			player.dash_strike(5.0, mult, 0.45, {})
		"array":
			arena.spawn_area("array", pos, 3.6, 6.0, mult)
		"turrets":
			arena.spawn_turrets(pos, 2, 12.0)
		"fire":
			arena.spawn_area("fire", pos, 3.2, 8.0, mult)
		"charge":
			player.dash_strike(6.0, mult, 0.6, {"stun": 1.0})
		"heal_shield":
			player.heal(player.max_hp * 0.3)
			player.add_shield(40.0)
		"charm":
			arena.charm_enemies(pos, 5.0, 3.0)
		"fear_strike":
			player.dash_strike(5.0, mult, 0.4, {"fear": 2.0})
		_:
			pass

## 叠加被动武技。玩家身上的被动以 id -> 层数 记录。
static func apply_passive(player: Node, skill: Dictionary) -> void:
	var id: String = skill.get("id", "")
	player.passives[id] = int(player.passives.get(id, 0)) + 1
	player.recalc_stats()

static func describe(skill: Dictionary) -> String:
	return "%s · %s" % [skill.get("general", ""), skill.get("name", "")]

static func rarity_name(rarity: int) -> String:
	return Data.RARITY_NAMES.get(rarity, "普通")

static func rarity_color(rarity: int) -> Color:
	return Data.RARITY_COLORS.get(rarity, Color.WHITE)
