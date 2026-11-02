extends SceneTree
## GoDot 无头自测：数据表完整性 + 技能执行 + 战斗结算。
## 运行： godot --headless --path GoDot --script res://tools/selftest.gd

const DataRef = preload("res://scripts/data.gd")
const SkillSystemRef = preload("res://scripts/skill_system.gd")
const TexGenRef = preload("res://scripts/texgen.gd")

var checks := 0
var fails := 0

func _init() -> void:
	print("=== GoDot 自测开始 ===")
	_test_skill_table()
	_test_level_table()
	_test_enemy_table()
	_test_skill_kinds()
	_test_foot_offsets()
	_test_battle()
	print("=== 自测结束：%d 项检查，%d 项失败 ===" % [checks, fails])
	quit(0 if fails == 0 else 1)

func check(cond: bool, msg: String) -> void:
	checks += 1
	if cond:
		print("  [ok]   ", msg)
	else:
		fails += 1
		print("  [FAIL] ", msg)

# ------------------------------------------------------------------ 数据表
func _test_skill_table() -> void:
	print("-- 武技表 --")
	var skills: Array = DataRef.SKILLS
	check(skills.size() >= 16, "武技数量 >= 16（实际 %d）" % skills.size())
	var ids := {}
	var generals := {}
	var kinds := {}
	for s in skills:
		ids[s["id"]] = true
		generals[s["general"]] = true
		kinds[s["kind"]] = true
		var ok: bool = s.has("general") and s.has("name") and s.has("desc") and s.has("rarity")
		if not ok:
			check(false, "武技字段完整: %s" % s.get("id", "?"))
	check(ids.size() == skills.size(), "武技 id 无重复")
	check(generals.size() >= 10, "涉及武将 >= 10 位（实际 %d）" % generals.size())
	check(kinds.has("active") and kinds.has("passive"), "同时存在主动与被动武技")
	var rarities := {}
	for s in skills:
		rarities[s["rarity"]] = true
	check(rarities.size() == 4, "四种稀有度齐备")

func _test_level_table() -> void:
	print("-- 关卡表 --")
	var level: Dictionary = DataRef.LEVEL1
	var stages: Array = level["stages"]
	check(stages.size() == 3, "三个阶段（实际 %d）" % stages.size())
	var waves: Array = DataRef.flatten_waves(level)
	check(waves.size() == 15, "共 15 波（实际 %d）" % waves.size())
	var has_boss := false
	var has_elite := false
	for w in waves:
		if w.has("boss"):
			has_boss = true
		if w.has("elite"):
			has_elite = true
		check(w.has("stage_name"), "波次带阶段名")
	check(has_boss, "存在 Boss 波次")
	check(has_elite, "存在精英波次")
	var total_spawns := 0
	for w in waves:
		for g in w.get("spawns", []):
			total_spawns += int(g[1])
	check(total_spawns >= 100, "本关敌人总数 >= 100（实际 %d）" % total_spawns)

func _test_enemy_table() -> void:
	print("-- 敌兵表 --")
	var en: Dictionary = DataRef.ENEMIES
	check(en.size() >= 6, "敌兵种类 >= 6（实际 %d）" % en.size())
	for k in en.keys():
		var d: Dictionary = en[k]
		check(d.has("hp") and d.has("speed") and d.has("dmg") and d.has("xp"), "敌兵 %s 字段完整" % k)
	check(en.has("boss_zhangjiao"), "存在 Boss 张角")
	check(int(en["boss_zhangjiao"]["hp"]) > 500, "Boss 血量 > 500")

func _test_skill_kinds() -> void:
	print("-- 技能执行器 --")
	var handled := ["cone", "shockwave", "dash_strike", "array", "turrets", "fire", "charge", "heal_shield", "charm", "fear_strike"]
	for s in DataRef.SKILLS:
		if s["kind"] == "active":
			check(handled.has(s["id"]), "主动武技 %s 有对应实现" % s["id"])

func _test_foot_offsets() -> void:
	print("-- 精灵脚底对齐 --")
	var tex: Texture2D = load("res://assets/units/blue/Warrior/Warrior_Idle.png")
	var off: float = TexGenRef.foot_offset_px(tex, 8)
	print("    Warrior_Idle 脚底偏移 = %.1f px" % off)
	check(off > 5.0, "能从贴图算出脚底偏移（%.1f）" % off)

# ------------------------------------------------------------------ 战斗
func _test_battle() -> void:
	print("-- 战斗结算 --")
	var ArenaScript = load("res://scripts/arena.gd")
	var arena = ArenaScript.new()
	arena.build_world()
	root.add_child(arena)
	arena.player = arena.get_child(0)
	check(arena.player != null, "玩家已生成")
	var EnemyScript = load("res://scripts/enemy.gd")
	var e = EnemyScript.new()
	e.setup("footman", arena, arena.player)
	e.position = Vector3(2, 0, 0)
	arena.add_child(e)
	arena.enemies.append(e)
	var hp0: float = e.hp
	arena.damage_enemy(e, 1.0, {}, arena.player, true)
	check(e.hp < hp0, "伤害结算生效（%.0f → %.0f）" % [hp0, e.hp])
	var killed: bool = false
	e.hp = 1.0
	arena.damage_enemy(e, 10.0, {}, arena.player, true)
	check(not e.alive or e.hp <= 0.0, "敌人可被击杀")
	arena.player.hp = 10.0
	arena.player.take_damage(4.0, {})
	check(arena.player.hp < 10.0, "玩家可受伤")
	var hp_now: float = arena.player.hp
	arena.player.heal(5.0)
	check(arena.player.hp > hp_now, "玩家可回血")
	arena.queue_free()
