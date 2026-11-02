extends Node3D
class_name EnemyUnit
## 黄巾军敌兵：追击 / 攻击 / 受击 / 眩晕 / 魅惑 / 首领技能。

signal died(enemy: Node)

const SHEETS := {
	"Pawn": {
		"idle": ["res://assets/units/yellow/Pawn/Pawn_Idle.png", 8, 7.0],
		"run": ["res://assets/units/yellow/Pawn/Pawn_Run.png", 6, 12.0],
		"attack": ["res://assets/units/yellow/Pawn/Pawn_Interact Knife.png", 4, 10.0],
	},
	"Archer": {
		"idle": ["res://assets/units/yellow/Archer/Archer_Idle.png", 6, 7.0],
		"run": ["res://assets/units/yellow/Archer/Archer_Run.png", 4, 12.0],
		"attack": ["res://assets/units/yellow/Archer/Archer_Shoot.png", 8, 12.0],
	},
	"Lancer": {
		"idle": ["res://assets/units/yellow/Lancer/Lancer_Idle.png", 12, 7.0],
		"run": ["res://assets/units/yellow/Lancer/Lancer_Run.png", 6, 12.0],
		"attack": ["res://assets/units/yellow/Lancer/Lancer_Down_Attack.png", 3, 10.0],
	},
	"Warrior": {
		"idle": ["res://assets/units/yellow/Warrior/Warrior_Idle.png", 8, 7.0],
		"run": ["res://assets/units/yellow/Warrior/Warrior_Run.png", 6, 12.0],
		"attack": ["res://assets/units/yellow/Warrior/Warrior_Attack1.png", 4, 10.0],
	},
	"Monk": {
		"idle": ["res://assets/units/yellow/Monk/Idle.png", 6, 6.0],
		"run": ["res://assets/units/yellow/Monk/Run.png", 4, 12.0],
		"attack": ["res://assets/units/yellow/Monk/Heal.png", 11, 8.0],
	},
}
const PIXEL_SIZE := 0.034
const LANCER_PIXEL_SIZE := 0.021
const FOOT_OFFSET := -24.0
const LANCER_FOOT_OFFSET := -60.0

var type_id: String = "footman"
var data: Dictionary = {}
var arena: Node = null
var player: Node = null

var max_hp: float = 10.0
var hp: float = 10.0
var speed: float = 2.5
var dmg: float = 6.0
var attack_range: float = 1.6
var attack_cd_max: float = 1.2
var xp_value: float = 5.0
var armor: float = 0.0
var is_ranged: bool = false
var is_elite: bool = false
var is_boss: bool = false

var alive: bool = true
var attack_timer: float = 0.0
var stun: float = 0.0
var fear: float = 0.0
var charm: float = 0.0
var knockback: Vector3 = Vector3.ZERO
var armor_break: float = 0.0
var flash: float = 0.0
var attack_anim: float = 0.0
var facing: float = 1.0
var ability_timer: float = 0.0
var thunder_timer: float = 0.0
var elite_abilities: Array = []
var dmg_reduction: float = 0.0

var sprite: AnimSprite
var shadow: Sprite3D
var head_bar: HealthBar3D
var _tint: Color = Color(1, 1, 1)

func setup(id: String, arena_ref: Node, player_ref: Node) -> void:
	type_id = id
	arena = arena_ref
	player = player_ref
	data = Data.ENEMIES.get(id, Data.ENEMIES["footman"])
	max_hp = float(data.get("hp", 30.0))
	hp = max_hp
	speed = float(data.get("speed", 2.5))
	dmg = float(data.get("dmg", 6.0))
	attack_range = float(data.get("range", 1.6))
	attack_cd_max = float(data.get("cd", 1.2))
	xp_value = float(data.get("xp", 5.0))
	armor = float(data.get("armor", 0.0))
	is_ranged = bool(data.get("ranged", false))
	is_elite = bool(data.get("elite", false))
	is_boss = bool(data.get("boss", false))
	elite_abilities = data.get("abilities", [])

func _ready() -> void:
	add_to_group("enemies")
	var unit_key: String = data.get("unit", "Pawn")
	var sheet: Dictionary = SHEETS.get(unit_key, SHEETS["Pawn"])
	var is_lancer := unit_key == "Lancer"
	var px: float = LANCER_PIXEL_SIZE if is_lancer else PIXEL_SIZE

	shadow = Sprite3D.new()
	shadow.texture = preload("res://assets/terrain/shadow.png")
	shadow.pixel_size = px * 1.6
	shadow.alpha_cut = SpriteBase3D.ALPHA_CUT_DISCARD
	shadow.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
	shadow.rotation.x = -PI * 0.5
	shadow.position = Vector3(0, 0.01, 0)
	shadow.modulate = Color(0, 0, 0, 0.4)
	add_child(shadow)

	sprite = AnimSprite.new()
	add_child(sprite)
	var idle_tex: Texture2D = load(sheet["idle"][0])
	sprite.setup(idle_tex, int(sheet["idle"][1]), px)
	sprite.position = Vector3(0, TexGen.foot_offset_px(idle_tex, int(sheet["idle"][1])) * px, 0)

	var sc: float = float(data.get("scale", 1.0))
	sprite.scale = Vector3(sc, sc, sc)
	shadow.scale = Vector3(sc, sc, sc)

	if is_elite or is_boss:
		head_bar = HealthBar3D.new()
		add_child(head_bar)
		head_bar.setup(max_hp, 1.2 if is_elite else 2.0, 0.16)
		head_bar.position = Vector3(0, 2.0 * sc, 0)
		head_bar.set_color(Color(0.9, 0.35, 0.2) if is_elite else Color(0.75, 0.3, 0.85))

	var label := Label3D.new()
	label.text = str(data.get("name", "黄巾"))
	label.font = preload("res://assets/fonts/fusion-pixel-12px-zh_hans.ttf")
	label.font_size = 32
	label.pixel_size = 0.006
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.no_depth_test = true
	label.modulate = Color(1, 0.95, 0.8)
	label.outline_size = 12
	label.outline_modulate = Color(0, 0, 0, 0.8)
	label.position = Vector3(0, (2.4 if is_elite else 3.0) * sc, 0)
	label.visible = is_elite or is_boss
	add_child(label)

func _physics_process(delta: float) -> void:
	if not alive:
		return
	_tick(delta)
	if stun > 0.0:
		return
	var target: Node3D = _current_target()
	var to_target := Vector3.ZERO
	if target != null:
		to_target = target.global_position - global_position
		to_target.y = 0.0
	var dist := to_target.length()

	if fear > 0.0 and player != null:
		to_target = (global_position - player.global_position)
		to_target.y = 0.0
		dist = to_target.length()
		to_target = to_target.normalized()
		global_position += to_target * speed * 1.1 * delta
	elif target != null and dist > attack_range * 0.85:
		var dir := to_target.normalized()
		global_position += dir * speed * delta
		facing = -1.0 if dir.x < -0.05 else (1.0 if dir.x > 0.05 else facing)
		_animate("run")
	else:
		_animate("idle")

	_separate(delta)

	if knockback.length() > 0.001:
		global_position += knockback * delta * 6.0
		knockback = knockback.move_toward(Vector3.ZERO, delta * 22.0)

	if arena != null:
		global_position = arena.clamp_to_bounds(global_position)

	if target != null and dist <= attack_range and attack_timer <= 0.0 and stun <= 0.0:
		_do_attack(target)

func _tick(delta: float) -> void:
	attack_timer = maxf(attack_timer - delta, 0.0)
	stun = maxf(stun - delta, 0.0)
	fear = maxf(fear - delta, 0.0)
	charm = maxf(charm - delta, 0.0)
	armor_break = maxf(armor_break - delta, 0.0)
	attack_anim = maxf(attack_anim - delta, 0.0)
	flash = maxf(flash - delta, 0.0)
	if flash > 0.0:
		sprite.modulate = Color(1.6, 1.2, 1.2)
	else:
		sprite.modulate = _tint
	if is_boss:
		ability_timer -= delta
		thunder_timer -= delta
		if ability_timer <= 0.0:
			ability_timer = 7.0
			_cast_ability()
		if thunder_timer <= 0.0:
			thunder_timer = 5.5
			_thunder_strike()

func _current_target() -> Node3D:
	if charm > 0.0 and arena != null:
		var other: Node3D = arena.random_enemy_except(self)
		if other != null:
			return other
	if player != null and is_instance_valid(player) and player.alive:
		return player
	return null

func _separate(delta: float) -> void:
	if arena == null:
		return
	var push := Vector3.ZERO
	for e in arena.enemies:
		if e == self or not is_instance_valid(e) or not e.alive:
			continue
		var d: Vector3 = global_position - e.global_position
		d.y = 0.0
		var l: float = d.length()
		if l > 0.001 and l < 1.0:
			push += d / l * (1.0 - l) * 3.0
	if push.length() > 0.001:
		global_position += push * delta * 2.0

func _do_attack(target: Node3D) -> void:
	attack_timer = attack_cd_max
	attack_anim = 0.35
	var sheet: Dictionary = SHEETS.get(data.get("unit", "Pawn"), SHEETS["Pawn"])
	sprite.play(load(sheet["attack"][0]), int(sheet["attack"][1]), 12.0, false)
	if is_ranged:
		if arena != null:
			var dir: Vector3 = (target.global_position - global_position)
			dir.y = 0.0
			arena.spawn_projectile("arrow", global_position + Vector3(0, 1.0, 0), dir.normalized(), 11.0, dmg, 0)
	else:
		if player != null and is_instance_valid(player):
			player.take_damage(dmg, {})

func _cast_ability() -> void:
	if arena == null:
		return
	if elite_abilities.has("heal_allies"):
		arena.heal_allies(global_position, 6.0, max_hp * 0.12)
		var sheet: Dictionary = SHEETS.get(data.get("unit", "Monk"), SHEETS["Monk"])
		sprite.play(load(sheet["attack"][0]), int(sheet["attack"][1]), 8.0, false)
		attack_anim = 0.8

func _thunder_strike() -> void:
	if arena == null or player == null:
		return
	var target_pos: Vector3 = player.global_position
	arena.spawn_projectile("thunder", target_pos + Vector3(0, 8.0, 0), Vector3.DOWN, 9.0, dmg * 1.2, 0, {"aoe": 2.4})

func _animate(state: String) -> void:
	if attack_anim > 0.0:
		return
	var sheet: Dictionary = SHEETS.get(data.get("unit", "Pawn"), SHEETS["Pawn"])
	var entry: Array = sheet.get(state, sheet["idle"])
	sprite.play(load(entry[0]), int(entry[1]), float(entry[2]), true)
	sprite.face_camera(0.0, facing)

func take_damage(amount: float, flags: Dictionary = {}) -> void:
	if not alive:
		return
	var dmg: float = maxf(amount - armor, amount * 0.15)
	dmg *= (1.0 - clampf(dmg_reduction, 0.0, 0.9))
	if flags.has("armor_break"):
		armor_break = maxf(armor_break, float(flags["armor_break"]))
		dmg *= 1.25
	if flags.has("stun"):
		stun = maxf(stun, float(flags["stun"]))
	if flags.has("fear"):
		fear = maxf(fear, float(flags["fear"]))
	if flags.has("charm"):
		charm = maxf(charm, float(flags["charm"]))
	if flags.has("knockback"):
		var kb: Vector3 = flags["knockback"]
		if kb is Vector3:
			knockback = kb
	flash = 0.12
	hp -= dmg
	if head_bar != null:
		head_bar.set_hp(maxf(hp, 0.0))
	if hp <= 0.0:
		_die()

func _die() -> void:
	alive = false
	emit_signal("died", self)
	queue_free()
