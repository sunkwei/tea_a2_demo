extends Node3D
class_name PlayerUnit
## 玩家（汉军校尉）：移动 / 普攻 / 闪避 / 武将武技 / 升级。

signal died
signal hp_changed(hp: float, max_hp: float)
signal xp_changed(xp: float, need: float, level: int)
signal stats_changed
signal skill_used(slot: int, skill_id: String)
signal level_gained(level: int)

const TEX_IDLE := preload("res://assets/units/blue/Warrior/Warrior_Idle.png")
const TEX_RUN := preload("res://assets/units/blue/Warrior/Warrior_Run.png")
const TEX_ATTACK := preload("res://assets/units/blue/Warrior/Warrior_Attack1.png")

const IDLE_FRAMES := 8
const RUN_FRAMES := 6
const ATTACK_FRAMES := 4
const PIXEL_SIZE := 0.036
const FOOT_OFFSET := -24.0

const BASE_HP := 120.0
const BASE_ATK := 12.0
const BASE_SPEED := 5.2
const ROLL_TIME := 0.28
const ROLL_CD := 1.6

var arena: Node = null
var camera: Camera3D = null

var max_hp: float = BASE_HP
var hp: float = BASE_HP
var atk: float = BASE_ATK
var speed: float = BASE_SPEED
var level: int = 1
var xp: float = 0.0
var xp_next: float = 18.0
var rage: float = 0.0
var rage_max: float = 100.0
var shield: float = 0.0
var crit_chance: float = 0.05
var crit_mult: float = 1.75
var range_mul: float = 1.0
var ranged: bool = false
var berserk: float = 0.0
var passives: Dictionary = {}

var skill_slots: Array = []          # [{id, cd, cd_max}]
var invuln: float = 0.0
var roll_cd: float = 0.0
var attack_cd: float = 0.0
var attack_anim: float = 0.0
var rolling: bool = false
var roll_time_left: float = 0.0
var roll_dir: Vector3 = Vector3.FORWARD
var dash_time: float = 0.0
var dash_dir: Vector3 = Vector3.ZERO
var dash_mult: float = 0.0
var dash_flags: Dictionary = {}
var dash_hit: Array = []
var aim_dir: Vector3 = Vector3.FORWARD
var facing: float = 1.0
var move_dir: Vector3 = Vector3.ZERO
var alive: bool = true
var kills: int = 0

var sprite: AnimSprite
var shadow: Sprite3D
var head_bar: HealthBar3D

func _ready() -> void:
	add_to_group("player")
	shadow = Sprite3D.new()
	shadow.texture = preload("res://assets/terrain/shadow.png")
	shadow.pixel_size = 0.022
	shadow.alpha_cut = SpriteBase3D.ALPHA_CUT_DISCARD
	shadow.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
	shadow.rotation.x = -PI * 0.5
	shadow.position = Vector3(0, 0.01, 0)
	shadow.modulate = Color(0, 0, 0, 0.45)
	add_child(shadow)

	sprite = AnimSprite.new()
	add_child(sprite)
	sprite.setup(TEX_IDLE, IDLE_FRAMES, PIXEL_SIZE)
	sprite.position = Vector3(0, TexGen.foot_offset_px(TEX_IDLE, IDLE_FRAMES) * PIXEL_SIZE, 0)

	head_bar = HealthBar3D.new()
	add_child(head_bar)
	head_bar.setup(max_hp, 1.0, 0.13)
	head_bar.position = Vector3(0, 2.55, 0)

	recalc_stats()
	hp = max_hp
	emit_signal("hp_changed", hp, max_hp)
	emit_signal("xp_changed", xp, xp_next, level)

# ---------------------------------------------------------------- 输入与更新
func _physics_process(delta: float) -> void:
	if not alive:
		return
	_tick_timers(delta)
	_tick_roll(delta)
	_read_input()
	_update_aim()
	_move(delta)
	_update_attack(delta)
	_update_skills(delta)
	_update_anim()

func _tick_timers(delta: float) -> void:
	invuln = maxf(invuln - delta, 0.0)
	roll_cd = maxf(roll_cd - delta, 0.0)
	attack_cd = maxf(attack_cd - delta, 0.0)
	attack_anim = maxf(attack_anim - delta, 0.0)
	berserk = maxf(berserk - delta, 0.0)
	for s in skill_slots:
		s["cd"] = maxf(float(s["cd"]) - delta, 0.0)

func _read_input() -> void:
	var iv := Vector2.ZERO
	if Input.is_physical_key_pressed(KEY_W) or Input.is_physical_key_pressed(KEY_UP):
		iv.y -= 1.0
	if Input.is_physical_key_pressed(KEY_S) or Input.is_physical_key_pressed(KEY_DOWN):
		iv.y += 1.0
	if Input.is_physical_key_pressed(KEY_A) or Input.is_physical_key_pressed(KEY_LEFT):
		iv.x -= 1.0
	if Input.is_physical_key_pressed(KEY_D) or Input.is_physical_key_pressed(KEY_RIGHT):
		iv.x += 1.0
	move_dir = Vector3(iv.x, 0, iv.y)
	if move_dir.length() > 1.0:
		move_dir = move_dir.normalized()

	if Input.is_physical_key_pressed(KEY_SPACE) and roll_cd <= 0.0 and not rolling:
		_start_roll()

func _update_aim() -> void:
	if camera != null:
		var vp := camera.get_viewport()
		if vp != null:
			var mouse := vp.get_mouse_position()
			var from := camera.project_ray_origin(mouse)
			var dir := camera.project_ray_normal(mouse)
			if absf(dir.y) > 0.0001:
				var t := -from.y / dir.y
				if t > 0.0:
					var hit := from + dir * t
					var d := hit - global_position
					d.y = 0.0
					if d.length() > 0.2:
						aim_dir = d.normalized()
						return
	if move_dir.length() > 0.05:
		aim_dir = move_dir.normalized()

func _move(delta: float) -> void:
	if dash_time > 0.0:
		dash_time -= delta
		var spd := 15.0
		global_position += dash_dir * spd * delta
		_strike_dash()
	elif rolling:
		global_position += roll_dir * 13.0 * delta
	else:
		var spd := speed * (1.25 if berserk > 0.0 else 1.0)
		if move_dir.length() > 0.05:
			global_position += move_dir * spd * delta
			facing = -1.0 if move_dir.x < -0.05 else (1.0 if move_dir.x > 0.05 else facing)
	if arena != null:
		global_position = arena.clamp_to_bounds(global_position)

func _update_attack(delta: float) -> void:
	var want := Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT) or Input.is_physical_key_pressed(KEY_J)
	if want and attack_cd <= 0.0:
		_do_attack()

func _do_attack() -> void:
	var rate := 0.42 * (0.72 if berserk > 0.0 else 1.0)
	attack_cd = rate
	attack_anim = 0.3
	sprite.play(TEX_ATTACK, ATTACK_FRAMES, 14.0, false)
	if ranged:
		if arena != null:
			arena.spawn_projectile("arrow", global_position + Vector3(0, 1.0, 0), aim_dir, 17.0, 0.95, 1, {"mult": true})
	else:
		if arena != null:
			arena.damage_cone(global_position, aim_dir, 100.0, 1.9 * range_mul, 1.0, {})

func _update_skills(_delta: float) -> void:
	for i in range(mini(3, skill_slots.size())):
		var key := KEY_1 + i
		if Input.is_physical_key_pressed(key):
			use_slot(i)

func use_slot(index: int) -> bool:
	if index < 0 or index >= skill_slots.size():
		return false
	var slot: Dictionary = skill_slots[index]
	if float(slot["cd"]) > 0.0:
		return false
	var skill: Dictionary = Data.skill_by_id(slot["id"])
	if skill.is_empty():
		return false
	SkillSystem.execute(arena, self, skill)
	slot["cd"] = float(skill.get("cd", 8.0))
	emit_signal("skill_used", index, slot["id"])
	emit_signal("stats_changed")
	return true

func _update_anim() -> void:
	if attack_anim > 0.0:
		return
	if rolling:
		sprite.play(TEX_RUN, RUN_FRAMES, 16.0, true)
	elif move_dir.length() > 0.05:
		sprite.play(TEX_RUN, RUN_FRAMES, 12.0, true)
	else:
		sprite.play(TEX_IDLE, IDLE_FRAMES, 7.0, true)

# ---------------------------------------------------------------- 动作
func _start_roll() -> void:
	rolling = true
	roll_cd = ROLL_CD
	invuln = maxf(invuln, ROLL_TIME + 0.08)
	roll_dir = aim_dir if move_dir.length() <= 0.05 else move_dir.normalized()
	roll_time_left = ROLL_TIME
	emit_signal("stats_changed")

func _tick_roll(delta: float) -> void:
	if not rolling:
		return
	roll_time_left -= delta
	if roll_time_left <= 0.0:
		rolling = false

## 突进技（赵云七进七出 / 马超西凉铁骑 / 张辽威震逍遥津）
func dash_strike(distance: float, mult: float, duration: float, flags: Dictionary) -> void:
	dash_time = duration
	dash_dir = aim_dir
	dash_mult = mult
	dash_flags = flags
	dash_hit.clear()
	invuln = maxf(invuln, duration + 0.1)
	sprite.play(TEX_ATTACK, ATTACK_FRAMES, 18.0, false)
	attack_anim = duration
	roll_dir = aim_dir

func _strike_dash() -> void:
	if arena == null:
		return
	for e in arena.enemies:
		if not is_instance_valid(e) or not e.alive:
			continue
		if dash_hit.has(e.get_instance_id()):
			continue
		if global_position.distance_to(e.global_position) < 1.5:
			dash_hit.append(e.get_instance_id())
			arena.damage_enemy(e, dash_mult, dash_flags, self)

func heal(amount: float) -> void:
	hp = minf(max_hp, hp + amount)
	emit_signal("hp_changed", hp, max_hp)

func add_shield(amount: float) -> void:
	shield += amount
	emit_signal("stats_changed")

func add_xp(amount: float) -> void:
	xp += amount
	while xp >= xp_next:
		xp -= xp_next
		level += 1
		xp_next = 18.0 + (level - 1) * 10.0
		emit_signal("level_gained", level)
	emit_signal("xp_changed", xp, xp_next, level)

func on_kill(enemy: Node) -> void:
	kills += 1
	rage = minf(rage_max, rage + 6.0)
	if rage >= rage_max:
		berserk = 5.0
		rage = 0.0
	if passives.has("caocao_cunning"):
		heal(4.0)
		atk = minf(atk + 2.0, BASE_ATK + (level - 1) * 2.0 + 15.0)
		emit_signal("stats_changed")

func take_damage(amount: float, _flags: Dictionary = {}) -> void:
	if not alive or invuln > 0.0:
		return
	var dmg := amount
	if passives.has("zhugeliang_empty") and hp / max_hp < 0.35:
		dmg *= 0.55
	if shield > 0.0:
		var absorbed: float = minf(shield, dmg)
		shield -= absorbed
		dmg -= absorbed
	hp -= dmg
	emit_signal("hp_changed", hp, max_hp)
	if hp <= 0.0:
		hp = 0.0
		alive = false
		emit_signal("died")

## 被动武技层数
func _stacks(id: String) -> int:
	return int(passives.get(id, 0))

## 重算属性（被动武技 / 升级都会调用）
func recalc_stats() -> void:
	var lv := float(level - 1)
	max_hp = BASE_HP + lv * 12.0
	atk = BASE_ATK + lv * 2.0
	speed = BASE_SPEED
	crit_chance = 0.05
	crit_mult = 1.75
	range_mul = 1.0
	ranged = false

	if _stacks("zhaoyun_stance") > 0:
		crit_chance += 0.12 * _stacks("zhaoyun_stance")
		crit_mult += 0.15 * _stacks("zhaoyun_stance")
	if _stacks("huangzhong_arrow") > 0:
		ranged = true
	if _stacks("taishici_godshot") > 0:
		range_mul += 0.4 * _stacks("taishici_godshot")
		atk *= 1.0 + 0.1 * _stacks("taishici_godshot")
	if _stacks("ganning_jinpan") > 0:
		speed += BASE_SPEED * 0.12 * _stacks("ganning_jinpan")
	if _stacks("sunshangxiang_fierce") > 0:
		crit_mult += 0.5 * _stacks("sunshangxiang_fierce")
	if _stacks("caocao_cunning") > 0:
		atk += 2.0 * mini(_stacks("caocao_cunning"), 7)
	if passives.has("zhugeliang_empty") and hp / max_hp < 0.35:
		speed *= 1.2

	hp = minf(hp, max_hp)
	head_bar.set_hp(hp)
	emit_signal("stats_changed")
	emit_signal("hp_changed", hp, max_hp)
