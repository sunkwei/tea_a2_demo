extends Node3D
class_name Projectile
## 箭矢 / 雷击：自管理飞行与命中判定。

var arena: Node = null
var kind: String = "arrow"
var dir: Vector3 = Vector3.FORWARD
var speed: float = 12.0
var damage: float = 5.0
var use_mult: bool = false
var pierce: int = 0
var life: float = 4.0
var flags: Dictionary = {}
var hit_ids: Array = []
var sprite: Sprite3D
var _t: float = 0.0

func setup(p_arena: Node, p_kind: String, pos: Vector3, p_dir: Vector3, p_speed: float, p_damage: float, p_pierce: int, p_flags: Dictionary, is_mult: bool) -> void:
	arena = p_arena
	kind = p_kind
	global_position = pos
	dir = p_dir.normalized()
	speed = p_speed
	damage = p_damage
	pierce = p_pierce
	flags = p_flags
	use_mult = is_mult

	sprite = Sprite3D.new()
	sprite.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	sprite.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
	sprite.alpha_cut = SpriteBase3D.ALPHA_CUT_DISCARD
	sprite.pixel_size = 0.02
	match kind:
		"arrow":
			sprite.texture = preload("res://assets/units/yellow/Archer/Arrow.png")
			sprite.pixel_size = 0.02
		"thunder":
			sprite.texture = TexGen.disc_texture(Color(0.75, 0.9, 1.0, 0.95), 64, 0.5)
			sprite.pixel_size = 0.06
			sprite.billboard = BaseMaterial3D.BILLBOARD_DISABLED
		"fire":
			sprite.texture = preload("res://assets/effects/fire2.png")
			sprite.pixel_size = 0.05
		_:
			sprite.texture = TexGen.orb_texture(Color(1, 1, 1), 32)
			sprite.pixel_size = 0.05
	add_child(sprite)

func _physics_process(delta: float) -> void:
	_t += delta
	life -= delta
	if life <= 0.0:
		queue_free()
		return
	if kind == "thunder":
		global_position += dir * speed * delta
		if global_position.y <= 0.2:
			_impact(global_position)
			return
		return

	global_position += dir * speed * delta
	if arena == null:
		return
	# 与敌兵碰撞
	for e in arena.enemies:
		if not is_instance_valid(e) or not e.alive:
			continue
		if hit_ids.has(e.get_instance_id()):
			continue
		var to: Vector3 = e.global_position + Vector3(0, 0.9, 0) - global_position
		to.y = 0.0
		if to.length() < 0.75:
			hit_ids.append(e.get_instance_id())
			arena.damage_enemy(e, damage if not use_mult else damage, flags, arena.player, use_mult)
			if pierce <= 0:
				queue_free()
				return
			pierce -= 1

func _impact(pos: Vector3) -> void:
	if arena != null:
		arena.area_blast(pos, float(flags.get("aoe", 2.0)), damage, flags, use_mult)
	queue_free()
