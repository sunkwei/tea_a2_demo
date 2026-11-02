extends Node3D
class_name Arena
## 战场：地形搭建、刷怪波次、伤害结算、技能效果、镜头。

signal wave_started(index: int, total: int, note: String)
signal wave_cleared(index: int)
signal stage_changed(stage_name: String)
signal boss_spawned(enemy: Node)
signal boss_hp_changed(hp: float, max_hp: float)
signal boss_defeated()
signal player_died()
signal level_up_ready()
signal notice(text: String)
signal enemy_killed(enemy_name: String)
signal player_hp_changed(hp: float, max_hp: float)
signal xp_changed(xp: float, need: float, level: int)
signal skill_ready(slot: int, skill_id: String, cd_max: float)

const GROUND_TEX := preload("res://assets/terrain/ground_grass.png")
const STONE_TEX := preload("res://assets/terrain/ground_stone.png")
const FONT := preload("res://assets/fonts/fusion-pixel-12px-zh_hans.ttf")

const TREE := preload("res://assets/terrain/tree1.png")
const TREE2 := preload("res://assets/terrain/tree2.png")
const ROCK := preload("res://assets/terrain/rock1.png")
const ROCK2 := preload("res://assets/terrain/rock2.png")
const BUSH := preload("res://assets/terrain/bush1.png")
const CASTLE := preload("res://assets/buildings/Red Buildings/Castle.png")
const HOUSE1 := preload("res://assets/buildings/Red Buildings/House1.png")
const HOUSE2 := preload("res://assets/buildings/Red Buildings/House2.png")
const TOWER := preload("res://assets/buildings/Red Buildings/Tower.png")
const BARRACKS := preload("res://assets/buildings/Red Buildings/Barracks.png")

var player: PlayerUnit = null
var camera: Camera3D = null
var enemies: Array = []
var projectiles: Array = []
var pickups: Array = []
var areas: Array = []
var turrets: Array = []

var level: Dictionary = {}
var waves: Array = []
var wave_index: int = -1
var wave_timer: float = 0.0
var spawn_queue: Array = []
var wave_elapsed: float = 0.0
var running: bool = false
var finished: bool = false
var kills: int = 0
var elapsed: float = 0.0
var boss: Node = null
var boss_stage_done: bool = false

var bounds_size: Vector2 = Vector2(32.0, 28.0)
var cam_offset: Vector3 = Vector3(0.0, 14.0, 10.4)
var _rng := RandomNumberGenerator.new()

# ------------------------------------------------------------------ 初始化
func _ready() -> void:
	_rng.randomize()
	level = Data.LEVEL1
	waves = Data.flatten_waves(level)

func build_world() -> void:
	_build_ground()
	_build_scenery()
	_build_camera()
	spawn_player()

func _build_ground() -> void:
	var ground := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(bounds_size.x * 2.0, bounds_size.y * 2.0)
	ground.mesh = pm
	var mat := StandardMaterial3D.new()
	mat.albedo_texture = GROUND_TEX
	mat.uv1_scale = Vector3(bounds_size.x, bounds_size.y, 1.0)
	mat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
	mat.texture_repeat = true
	mat.albedo_color = Color(0.78, 0.86, 0.72)
	ground.material_override = mat
	ground.position = Vector3.ZERO
	add_child(ground)

	# 官道：一条从南面通向城门的土路
	var road := MeshInstance3D.new()
	var rmesh := PlaneMesh.new()
	rmesh.size = Vector2(5.0, bounds_size.y * 2.0)
	road.mesh = rmesh
	var rmat := StandardMaterial3D.new()
	rmat.albedo_texture = GROUND_TEX
	rmat.uv1_scale = Vector3(2.5, bounds_size.y, 1.0)
	rmat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
	rmat.texture_repeat = true
	rmat.albedo_color = Color(0.62, 0.55, 0.42)
	road.material_override = rmat
	road.position = Vector3(0, 0.01, 0)
	add_child(road)

	# 城门前石板广场
	var plaza := MeshInstance3D.new()
	var pmesh := PlaneMesh.new()
	pmesh.size = Vector2(18.0, 10.0)
	plaza.mesh = pmesh
	var pmat := StandardMaterial3D.new()
	pmat.albedo_texture = STONE_TEX
	pmat.uv1_scale = Vector3(4.5, 2.5, 1.0)
	pmat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
	pmat.texture_repeat = true
	pmat.albedo_color = Color(0.72, 0.76, 0.82)
	plaza.material_override = pmat
	plaza.position = Vector3(0, 0.02, -bounds_size.y + 6.0)
	add_child(plaza)

func _build_scenery() -> void:
	# 广宗城门（北面）
	_add_prop(CASTLE, Vector3(0, 0, -bounds_size.y + 1.0), 0.030, 1, 1, Color(1.0, 0.86, 0.8))
	_add_prop(TOWER, Vector3(-9.0, 0, -bounds_size.y + 2.5), 0.022, 1, 1, Color(1.0, 0.86, 0.8))
	_add_prop(TOWER, Vector3(9.0, 0, -bounds_size.y + 2.5), 0.022, 1, 1, Color(1.0, 0.86, 0.8))
	_add_prop(BARRACKS, Vector3(-14.0, 0, -bounds_size.y + 6.0), 0.020, 1, 1, Color(1.0, 0.84, 0.78))
	_add_prop(BARRACKS, Vector3(14.0, 0, -bounds_size.y + 6.0), 0.020, 1, 1, Color(1.0, 0.84, 0.78))
	_add_prop(HOUSE1, Vector3(-19.0, 0, -bounds_size.y + 11.0), 0.020, 1, 1, Color(1.0, 0.88, 0.82))
	_add_prop(HOUSE2, Vector3(19.0, 0, -bounds_size.y + 11.0), 0.020, 1, 1, Color(1.0, 0.88, 0.82))
	_add_prop(HOUSE1, Vector3(-22.0, 0, -bounds_size.y + 3.0), 0.020, 1, 1, Color(1.0, 0.88, 0.82))
	_add_prop(HOUSE2, Vector3(22.0, 0, -bounds_size.y + 3.0), 0.020, 1, 1, Color(1.0, 0.88, 0.82))

	# 草木岩石
	for i in range(46):
		var x := _rng.randf_range(-bounds_size.x + 2.0, bounds_size.x - 2.0)
		var z := _rng.randf_range(-bounds_size.y + 3.0, bounds_size.y - 2.0)
		if absf(x) < 3.5 and z < bounds_size.y - 4.0:
			continue
		if z < -bounds_size.y + 13.0:
			continue
		var r := _rng.randf()
		if r < 0.45:
			_add_prop(TREE if _rng.randf() < 0.5 else TREE2, Vector3(x, 0, z), _rng.randf_range(0.010, 0.015), 6, 3)
		elif r < 0.75:
			_add_prop(ROCK if _rng.randf() < 0.5 else ROCK2, Vector3(x, 0, z), _rng.randf_range(0.010, 0.014), 1, 1, Color(1.35, 1.35, 1.35))
		else:
			_add_prop(BUSH, Vector3(x, 0, z), _rng.randf_range(0.010, 0.015), 1, 1, Color(1.2, 1.25, 1.1))

func _add_prop(tex: Texture2D, pos: Vector3, px: float, hframes: int = 1, frame: int = 0, tint: Color = Color(1, 1, 1)) -> void:
	var s := Sprite3D.new()
	s.texture = tex
	s.hframes = maxi(hframes, 1)
	s.vframes = 1
	s.frame = clampi(frame, 0, maxi(hframes, 1) - 1)
	s.pixel_size = px
	s.alpha_cut = SpriteBase3D.ALPHA_CUT_DISCARD
	s.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
	s.double_sided = true
	s.shaded = false
	s.modulate = tint
	s.position = pos + Vector3(0.0, TexGen.foot_offset_px(tex) * px, 0.0)
	add_child(s)

func _build_camera() -> void:
	camera = Camera3D.new()
	camera.fov = 34.0
	camera.far = 200.0
	camera.position = cam_offset
	add_child(camera)
	camera.look_at(Vector3.ZERO, Vector3.UP)
	var light := DirectionalLight3D.new()
	light.rotation_degrees = Vector3(-62, 38, 0)
	light.light_energy = 0.9
	light.shadow_enabled = false
	add_child(light)
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.12, 0.13, 0.17)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.65, 0.68, 0.75)
	env.ambient_light_energy = 0.7
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)

func spawn_player() -> void:
	player = PlayerUnit.new()
	player.arena = self
	player.camera = camera
	player.position = Vector3(0, 0, 6.0)
	add_child(player)
	player.hp_changed.connect(_on_player_hp)
	player.xp_changed.connect(_on_player_xp)
	player.level_gained.connect(_on_level_gained)
	player.died.connect(func(): emit_signal("player_died"))
	player.skill_used.connect(_on_skill_used)

# ------------------------------------------------------------------ 波次
func start_level() -> void:
	running = true
	finished = false
	wave_index = -1
	wave_timer = 1.0
	emit_signal("notice", level.get("intro", ""))

func _process(delta: float) -> void:
	elapsed += delta
	if not running:
		return
	_update_camera(delta)
	_update_spawns(delta)
	_update_pickups(delta)
	_update_areas(delta)
	_update_turrets(delta)
	_update_boss()
	_update_wave(delta)

func _update_camera(delta: float) -> void:
	if camera == null or player == null:
		return
	var focus: Vector3 = player.global_position
	var target: Vector3 = focus + cam_offset
	camera.global_position = camera.global_position.lerp(target, clampf(delta * 6.0, 0.0, 1.0))
	camera.look_at(focus + Vector3(0, 1.0, 0), Vector3.UP)

func _update_wave(delta: float) -> void:
	if spawn_queue.size() > 0 or enemies.size() > 0:
		return
	if wave_index < 0:
		wave_timer -= delta
		if wave_timer <= 0.0:
			_start_wave(0)
		return
	# 本波已清空
	emit_signal("wave_cleared", wave_index)
	var next_index: int = wave_index + 1
	if next_index >= waves.size():
		if not finished:
			finished = true
			emit_signal("boss_defeated")
		return
	wave_timer = 2.4
	wave_index = next_index
	var prev_stage: String = waves[next_index - 1].get("stage_name", "")
	var next_stage: String = waves[next_index].get("stage_name", "")
	if next_stage != prev_stage:
		emit_signal("stage_changed", next_stage)
		emit_signal("level_up_ready")

func _start_wave(index: int) -> void:
	wave_index = index
	var w: Dictionary = waves[index]
	wave_elapsed = 0.0
	spawn_queue.clear()
	var t := 0.6
	for group in w.get("spawns", []):
		var type_id: String = group[0]
		var count: int = int(group[1])
		for i in range(count):
			spawn_queue.append({"type": type_id, "at": t})
			t += 0.22
		t += 0.5
	if w.has("elite"):
		for i in range(int(w.get("elite_count", 1))):
			spawn_queue.append({"type": w["elite"], "at": t + 0.3 * i})
			t += 0.3
	if w.has("elite2"):
		spawn_queue.append({"type": w["elite2"], "at": t})
		t += 0.3
	if w.has("boss"):
		spawn_queue.append({"type": w["boss"], "at": t + 0.6})
	emit_signal("wave_started", index, waves.size(), w.get("note", ""))

func _update_spawns(delta: float) -> void:
	if spawn_queue.is_empty():
		return
	wave_elapsed += delta
	while not spawn_queue.is_empty() and float(spawn_queue[0]["at"]) <= wave_elapsed:
		var item: Dictionary = spawn_queue.pop_front()
		_spawn_enemy(item["type"])

func _spawn_enemy(type_id: String) -> void:
	var e := EnemyUnit.new()
	e.setup(type_id, self, player)
	var pos := _random_spawn_point()
	e.position = pos
	add_child(e)
	e.died.connect(_on_enemy_died)
	enemies.append(e)
	if e.is_boss:
		boss = e
		emit_signal("boss_spawned", e)
		emit_signal("notice", "%s 现身！" % e.data.get("name", "首领"))

func _random_spawn_point() -> Vector3:
	var ang := _rng.randf() * TAU
	var r := _rng.randf_range(bounds_size.x * 0.38, bounds_size.x * 0.62)
	var p := Vector3(cos(ang) * r, 0, sin(ang) * r * 0.8)
	if player != null:
		p += Vector3(player.global_position.x * 0.25, 0, player.global_position.z * 0.25)
	return clamp_to_bounds(p)

func _update_boss() -> void:
	if boss == null or not is_instance_valid(boss):
		return
	emit_signal("boss_hp_changed", maxf(boss.hp, 0.0), boss.max_hp)

func _on_enemy_died(e: Node) -> void:
	enemies.erase(e)
	kills += 1
	if player != null:
		player.on_kill(e)
	emit_signal("enemy_killed", str(e.data.get("name", "黄巾")))
	_spawn_pickup(e.global_position, float(e.xp_value))
	if e.is_boss:
		boss = null
		emit_signal("boss_defeated")

# ------------------------------------------------------------------ 经验珠
func _spawn_pickup(pos: Vector3, value: float) -> void:
	var s := Sprite3D.new()
	s.texture = TexGen.orb_texture(Color(0.55, 0.9, 1.0, 0.95), 32)
	s.pixel_size = 0.05
	s.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	s.alpha_cut = SpriteBase3D.ALPHA_CUT_DISCARD
	s.position = pos + Vector3(0, 0.7, 0)
	add_child(s)
	pickups.append({"node": s, "value": value, "t": 0.0})

func _update_pickups(delta: float) -> void:
	for item in pickups.duplicate():
		var n: Node3D = item["node"]
		if not is_instance_valid(n):
			pickups.erase(item)
			continue
		item["t"] = float(item["t"]) + delta
		n.position.y = 0.7 + sin(float(item["t"]) * 3.0) * 0.12
		if player == null:
			continue
		var d: Vector3 = player.global_position - n.position
		d.y = 0.0
		if d.length() < 2.4:
			n.position += d.normalized() * 7.0 * delta
		if d.length() < 0.6:
			player.add_xp(float(item["value"]))
			pickups.erase(item)
			n.queue_free()

# ------------------------------------------------------------------ 伤害
func damage_cone(center: Vector3, dir: Vector3, angle_deg: float, radius: float, mult: float, flags: Dictionary) -> int:
	var hit := 0
	var half := deg_to_rad(angle_deg) * 0.5
	for e in enemies.duplicate():
		if not is_instance_valid(e) or not e.alive:
			continue
		var to: Vector3 = e.global_position - center
		to.y = 0.0
		var dist: float = to.length()
		if dist > radius:
			continue
		if dist > 0.05 and absf(dir.angle_to(to)) > half:
			continue
		damage_enemy(e, mult, flags, player)
		hit += 1
	return hit

func damage_radius(center: Vector3, radius: float, mult: float, flags: Dictionary) -> int:
	var hit := 0
	for e in enemies.duplicate():
		if not is_instance_valid(e) or not e.alive:
			continue
		var to: Vector3 = e.global_position - center
		to.y = 0.0
		if to.length() > radius:
			continue
		var f := flags.duplicate()
		if flags.has("knockback"):
			f["knockback"] = to.normalized() * float(flags["knockback"])
		damage_enemy(e, mult, f, player)
		hit += 1
	return hit

func damage_enemy(e: Node, mult: float, flags: Dictionary, source: Node, use_mult: bool = true) -> float:
	if e == null or not is_instance_valid(e) or not e.alive:
		return 0.0
	var base: float = 0.0
	var p: Node = source if source != null else player
	if use_mult and p != null and "atk" in p:
		base = float(p.atk) * mult
	else:
		base = mult
	var crit := false
	if use_mult and p != null and "crit_chance" in p:
		crit = _rng.randf() < float(p.crit_chance)
		if crit:
			base *= float(p.crit_mult)
	if e.has_method("take_damage"):
		e.take_damage(base, flags)
	if use_mult and player != null:
		player.rage = minf(player.rage_max, player.rage + base * 0.35)
	_float_text(e.global_position + Vector3(0, 1.6, 0), str(int(round(base))), Color(1, 0.95, 0.7) if not crit else Color(1, 0.65, 0.3))
	return base

func area_blast(pos: Vector3, radius: float, value: float, flags: Dictionary, use_mult: bool) -> void:
	if use_mult:
		damage_radius(Vector3(pos.x, 0, pos.z), radius, value, flags)
		_visual_blast(pos, Color(1.0, 0.85, 0.4))
	else:
		if player != null and is_instance_valid(player):
			var d: Vector3 = player.global_position - Vector3(pos.x, 0, pos.z)
			d.y = 0.0
			if d.length() <= radius:
				player.take_damage(value, {})
		_visual_blast(pos, Color(0.7, 0.85, 1.0))

func _visual_blast(pos: Vector3, color: Color) -> void:
	var s := Sprite3D.new()
	s.texture = TexGen.disc_texture(Color(color.r, color.g, color.b, 0.9), 64, 0.6)
	s.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	s.pixel_size = 0.08
	s.position = pos
	add_child(s)
	var tw := create_tween()
	tw.tween_property(s, "scale", Vector3(2.2, 2.2, 2.2), 0.25)
	tw.parallel().tween_property(s, "modulate:a", 0.0, 0.25)
	tw.tween_callback(s.queue_free)

# ------------------------------------------------------------------ 技能效果
func spawn_area(kind: String, pos: Vector3, radius: float, duration: float, mult: float) -> void:
	var root := Node3D.new()
	root.position = Vector3(pos.x, 0, pos.z)
	add_child(root)

	var color := Color(1.0, 0.45, 0.15, 0.75) if kind == "fire" else Color(0.35, 0.65, 1.0, 0.7)
	var disc := Sprite3D.new()
	disc.texture = TexGen.disc_texture(color, 96, 0.45)
	disc.rotation.x = -PI * 0.5
	disc.pixel_size = radius * 2.0 / 96.0
	disc.modulate = Color(1, 1, 1, 0.85)
	root.add_child(disc)

	var ring := Sprite3D.new()
	ring.texture = TexGen.ring_texture(Color(color.r, color.g, color.b, 0.95), 128)
	ring.rotation.x = -PI * 0.5
	ring.pixel_size = radius * 2.0 / 128.0
	ring.position = Vector3(0, 0.03, 0)
	root.add_child(ring)

	if kind == "fire":
		for i in range(7):
			var f := Sprite3D.new()
			f.texture = preload("res://assets/effects/fire2.png")
			f.pixel_size = 0.05
			f.billboard = BaseMaterial3D.BILLBOARD_ENABLED
			f.position = Vector3(_rng.randf_range(-radius, radius) * 0.8, 0.4, _rng.randf_range(-radius, radius) * 0.8)
			f.modulate = Color(1, 1, 1, 0.9)
			root.add_child(f)
			var tw := create_tween().set_loops()
			tw.tween_property(f, "position:y", 1.1, 0.45).set_trans(Tween.TRANS_SINE)
			tw.tween_property(f, "position:y", 0.4, 0.45).set_trans(Tween.TRANS_SINE)

	areas.append({"node": root, "kind": kind, "radius": radius, "life": duration, "tick": 0.0, "mult": mult})
	var tw2 := create_tween()
	tw2.tween_interval(duration)
	tw2.tween_callback(func():
		if is_instance_valid(root):
			root.queue_free())

func _update_areas(delta: float) -> void:
	for a in areas.duplicate():
		if not is_instance_valid(a.get("node")):
			areas.erase(a)
			continue
		a["tick"] = float(a["tick"]) - delta
		if float(a["tick"]) > 0.0:
			continue
		a["tick"] = 0.5
		var center: Vector3 = a["node"].position
		var radius: float = a["radius"]
		for e in enemies.duplicate():
			if not is_instance_valid(e) or not e.alive:
				continue
			var to: Vector3 = e.global_position - center
			to.y = 0.0
			if to.length() > radius:
				continue
			damage_enemy(e, float(a["mult"]) * 0.5, {}, player)
			if a["kind"] == "array":
				e.set("dmg_reduction", 0.25)

func spawn_turrets(pos: Vector3, count: int, duration: float) -> void:
	for i in range(count):
		var t := Node3D.new()
		t.position = Vector3(pos.x + (i - (count - 1) * 0.5) * 2.0, 0, pos.z + 1.0)
		add_child(t)
		var s := Sprite3D.new()
		s.texture = preload("res://assets/units/blue/Pawn/Pawn_Idle.png")
		s.hframes = 8
		s.pixel_size = 0.03
		s.alpha_cut = SpriteBase3D.ALPHA_CUT_DISCARD
		s.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
		s.offset = Vector2(0, -24)
		s.position = Vector3(0, 1.0, 0)
		t.add_child(s)
		turrets.append({"node": t, "life": duration, "cd": 0.4 + 0.3 * i})
		var tw := create_tween()
		tw.tween_interval(duration)
		tw.tween_callback(func():
			if is_instance_valid(t):
				t.queue_free()
			turrets.erase(turrets[0] if turrets.size() > 0 and turrets[0].get("node") == t else {}))

func _update_turrets(delta: float) -> void:
	for t in turrets.duplicate():
		if not is_instance_valid(t.get("node")):
			turrets.erase(t)
			continue
		t["life"] = float(t["life"]) - delta
		t["cd"] = float(t["cd"]) - delta
		if float(t["cd"]) > 0.0:
			continue
		var target: Node3D = _nearest_enemy(t["node"].position)
		if target == null:
			continue
		t["cd"] = 0.75
		var dir: Vector3 = (target.global_position - t["node"].position)
		dir.y = 0.0
		spawn_projectile("arrow", t["node"].position + Vector3(0, 1.0, 0), dir.normalized(), 14.0, 0.55, 0, {"mult": true})

func charm_enemies(center: Vector3, radius: float, duration: float) -> int:
	var hit := 0
	for e in enemies.duplicate():
		if not is_instance_valid(e) or not e.alive:
			continue
		var to: Vector3 = e.global_position - center
		to.y = 0.0
		if to.length() > radius:
			continue
		e.set("charm", maxf(float(e.charm), duration))
		hit += 1
	return hit

func heal_allies(center: Vector3, radius: float, amount: float) -> void:
	for e in enemies.duplicate():
		if not is_instance_valid(e) or not e.alive:
			continue
		var to: Vector3 = e.global_position - center
		to.y = 0.0
		if to.length() > radius:
			continue
		e.hp = minf(e.max_hp, e.hp + amount)
		if e.head_bar != null:
			e.head_bar.set_hp(e.hp)

func spawn_projectile(kind: String, pos: Vector3, dir: Vector3, speed: float, value: float, pierce: int = 0, flags: Dictionary = {}) -> void:
	var p := Projectile.new()
	add_child(p)
	p.setup(self, kind, pos, dir, speed, value, pierce, flags, bool(flags.get("mult", false)))

func random_enemy_except(exclude: Node) -> Node3D:
	var pool: Array = []
	for e in enemies:
		if e != exclude and is_instance_valid(e) and e.alive:
			pool.append(e)
	if pool.is_empty():
		return null
	return pool[_rng.randi() % pool.size()]

func _nearest_enemy(pos: Vector3) -> Node3D:
	var best: Node3D = null
	var best_d := 1e9
	for e in enemies:
		if not is_instance_valid(e) or not e.alive:
			continue
		var d: float = (e.global_position - pos).length_squared()
		if d < best_d:
			best_d = d
			best = e
	return best

# ------------------------------------------------------------------ 工具
func clamp_to_bounds(pos: Vector3) -> Vector3:
	var p := pos
	p.x = clampf(p.x, -bounds_size.x + 1.0, bounds_size.x - 1.0)
	p.z = clampf(p.z, -bounds_size.y + 1.0, bounds_size.y - 1.0)
	p.y = 0.0
	return p

func _float_text(pos: Vector3, text: String, color: Color) -> void:
	var l := Label3D.new()
	l.text = text
	l.font = FONT
	l.font_size = 32
	l.pixel_size = 0.008
	l.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	l.no_depth_test = true
	l.modulate = color
	l.outline_size = 14
	l.outline_modulate = Color(0, 0, 0, 0.85)
	l.position = pos
	add_child(l)
	var tw := create_tween()
	tw.tween_property(l, "position:y", pos.y + 1.4, 0.6)
	tw.parallel().tween_property(l, "modulate:a", 0.0, 0.6)
	tw.tween_callback(l.queue_free)

func _on_player_hp(hp: float, max_hp: float) -> void:
	emit_signal("player_hp_changed", hp, max_hp)

func _on_player_xp(xp: float, need: float, level: int) -> void:
	emit_signal("xp_changed", xp, need, level)

func _on_level_gained(_level: int) -> void:
	emit_signal("level_up_ready")

func _on_skill_used(slot: int, skill_id: String) -> void:
	var skill: Dictionary = Data.skill_by_id(skill_id)
	emit_signal("skill_ready", slot, skill_id, float(skill.get("cd", 8.0)))
	emit_signal("notice", "%s 发动！%s" % [skill.get("general", ""), skill.get("name", "")])
