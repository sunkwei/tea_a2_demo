extends Node3D
class_name Main
## 游戏流程：标题 → 战斗 → 升级三选一 → 结算。

enum State { TITLE, PLAYING, CHOOSING, PAUSED, DEFEAT, VICTORY }

const RARITY_WEIGHT := {1: 100, 2: 58, 3: 28, 4: 12}

var state: int = State.TITLE
var arena: Arena = null
var hud: HUD = null
var pending_cards: int = 0
var current_cards: Array = []
var rng := RandomNumberGenerator.new()
var _shot_timer: float = 0.0
var _shot_path: String = ""
var _shot_delay: float = 3.0
var _shot_ticks: int = 0

func _dbg(msg: String) -> void:
	var f := FileAccess.open("res://shots/shot_debug.txt", FileAccess.READ_WRITE if FileAccess.file_exists("res://shots/shot_debug.txt") else FileAccess.WRITE)
	if f == null:
		return
	f.seek_end()
	f.store_line(msg)
	f.close()

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	rng.randomize()
	hud = HUD.new()
	add_child(hud)
	hud.card_chosen.connect(_on_card_chosen)
	hud.start_pressed.connect(start_game)
	hud.restart_pressed.connect(restart)

	arena = Arena.new()
	add_child(arena)
	arena.build_world()
	_connect_arena()
	hud.bind(arena)
	_grant_starting_skill()
	_parse_cmdline()

func _connect_arena() -> void:
	arena.wave_started.connect(_on_wave_started)
	arena.stage_changed.connect(_on_stage_changed)
	arena.boss_spawned.connect(_on_boss_spawned)
	arena.boss_hp_changed.connect(_on_boss_hp_changed)
	arena.boss_defeated.connect(_on_victory)
	arena.player_died.connect(_on_defeat)
	arena.level_up_ready.connect(_on_level_up_ready)
	arena.enemy_killed.connect(func(_n): hud.set_kills(arena.kills))
	arena.notice.connect(hud.notice)
	arena.player_hp_changed.connect(_on_player_hp)

func _grant_starting_skill() -> void:
	var skill: Dictionary = Data.skill_by_id("guanyu_crescent")
	if skill.is_empty() or arena.player == null:
		return
	arena.player.skill_slots.append({"id": skill["id"], "cd": 0.0, "cd_max": float(skill.get("cd", 8.0))})
	arena.player.recalc_stats()
	hud._refresh_skills()

# ------------------------------------------------------------------ 流程
func start_game() -> void:
	if state == State.PLAYING:
		return
	state = State.PLAYING
	get_tree().paused = false
	hud.hide_title()
	hud.hud_root.visible = true
	arena.start_level()
	hud.notice("第一关 · 黄巾之乱 —— 广宗道")

func restart() -> void:
	get_tree().paused = false
	if arena != null:
		arena.queue_free()
	arena = Arena.new()
	add_child(arena)
	arena.build_world()
	_connect_arena()
	hud.bind(arena)
	_grant_starting_skill()
	state = State.PLAYING
	hud.hide_title()
	hud.result_root.visible = false
	hud.hud_root.visible = true
	arena.start_level()
	hud.notice("再战广宗道！")

func _process(delta: float) -> void:
	if arena != null and is_instance_valid(arena) and state == State.PLAYING:
		hud.set_time(arena.elapsed)
	if _shot_timer > 0.0:
		_shot_timer -= delta
		_shot_ticks += 1
		if _shot_ticks % 30 == 0:
			_dbg("[tick] timer=" + str(_shot_timer))
		if _shot_timer <= 0.0:
			_dbg("[tick] firing capture")
			_capture_shot()

## 命令行：--shot=路径.png [--shot-delay=秒] [--auto]
func _parse_cmdline() -> void:
	var user_args := OS.get_cmdline_user_args()
	print("[cmd] user args = ", user_args)
	for a in user_args:
		var parts := a.split("=")
		if parts.size() < 2:
			continue
		if parts[0] == "--shot":
			_shot_path = parts[1]
		elif parts[0] == "--shot-delay":
			_shot_delay = float(parts[1])
	if _shot_path != "":
		_shot_timer = _shot_delay
		start_game()

func _capture_shot() -> void:
	_dbg("[shot] capture start " + _shot_path)
	await RenderingServer.frame_post_draw
	_dbg("[shot] frame drawn")
	var img := get_viewport().get_texture().get_image()
	if img != null:
		var out_path := _shot_path
		if not out_path.begins_with("res://") and not out_path.begins_with("user://"):
			out_path = ProjectSettings.globalize_path("res://" + out_path)
		var err := img.save_png(out_path)
		_dbg("[shot] saved " + out_path + " err=" + str(err) + " size=" + str(img.get_size()))
	else:
		_dbg("[shot] viewport image is null")
	get_tree().quit()

func _unhandled_input(event: InputEvent) -> void:
	if not (event is InputEventKey) or not event.pressed or event.echo:
		return
	var key: int = event.keycode
	match state:
		State.TITLE:
			if key == KEY_SPACE or key == KEY_ENTER or key == KEY_KP_ENTER:
				start_game()
		State.PLAYING:
			if key == KEY_ESCAPE or key == KEY_P:
				_pause(true)
		State.PAUSED:
			if key == KEY_ESCAPE or key == KEY_P:
				_pause(false)
		State.CHOOSING:
			if key == KEY_1:
				_on_card_chosen(0)
			elif key == KEY_2:
				_on_card_chosen(1)
			elif key == KEY_3:
				_on_card_chosen(2)
		State.DEFEAT, State.VICTORY:
			if key == KEY_R:
				restart()

func _pause(on: bool) -> void:
	if on:
		state = State.PAUSED
		get_tree().paused = true
		hud.show_pause(true)
	else:
		state = State.PLAYING
		get_tree().paused = false
		hud.show_pause(false)

# ------------------------------------------------------------------ 事件
func _on_wave_started(index: int, total: int, note: String) -> void:
	hud.set_wave(index, total)
	if note != "":
		hud.notice(note)

func _on_stage_changed(stage_name: String) -> void:
	hud.set_stage(stage_name)
	hud.notice(stage_name)

func _on_boss_spawned(enemy: Node) -> void:
	hud.set_boss(true, enemy.hp, enemy.max_hp, str(enemy.data.get("name", "首领")))

func _on_boss_hp_changed(hp: float, max_hp: float) -> void:
	hud.set_boss(true, hp, max_hp, hud.lbl_boss.text)

func _on_player_hp(hp: float, max_hp: float) -> void:
	hud._on_hp_changed(hp, max_hp)

func _on_level_up_ready() -> void:
	pending_cards += 1
	if state == State.PLAYING:
		_open_cards()

func _open_cards() -> void:
	if pending_cards <= 0:
		return
	current_cards = _roll_cards()
	if current_cards.is_empty():
		pending_cards -= 1
		return
	state = State.CHOOSING
	get_tree().paused = true
	hud.show_cards(current_cards)

func _on_card_chosen(index: int) -> void:
	if state != State.CHOOSING:
		return
	if index < 0 or index >= current_cards.size():
		return
	var skill: Dictionary = current_cards[index]
	_apply_skill(skill)
	pending_cards = maxi(pending_cards - 1, 0)
	hud.hide_cards()
	if pending_cards > 0:
		_open_cards()
		return
	state = State.PLAYING
	get_tree().paused = false

func _apply_skill(skill: Dictionary) -> void:
	var p: Node = arena.player
	if p == null:
		return
	if skill.get("kind", "") == "active":
		var entry := {"id": skill["id"], "cd": 0.0, "cd_max": float(skill.get("cd", 8.0))}
		if p.skill_slots.size() >= 3:
			p.skill_slots.pop_front()
		p.skill_slots.append(entry)
	else:
		SkillSystem.apply_passive(p, skill)
	p.recalc_stats()
	hud._refresh_skills()
	hud.notice("习得 %s" % SkillSystem.describe(skill))

## 抽取三张卡（按稀有度加权，且不重复给已满层被动）
func _roll_cards() -> Array:
	var pool: Array = []
	for s in Data.SKILLS:
		var id: String = s["id"]
		if s.get("kind", "") == "active":
			var owned := false
			for slot in arena.player.skill_slots:
				if slot["id"] == id:
					owned = true
			if owned:
				continue
		else:
			if int(arena.player.passives.get(id, 0)) >= 2:
				continue
		pool.append(s)
	var result: Array = []
	for i in range(3):
		if pool.is_empty():
			break
		var total := 0.0
		for s in pool:
			total += float(RARITY_WEIGHT.get(int(s.get("rarity", 1)), 50))
		var roll := rng.randf() * total
		var acc := 0.0
		var chosen: Dictionary = pool[0]
		for s in pool:
			acc += float(RARITY_WEIGHT.get(int(s.get("rarity", 1)), 50))
			if roll <= acc:
				chosen = s
				break
		result.append(chosen)
		pool.erase(chosen)
	return result

# ------------------------------------------------------------------ 结算
func _on_victory() -> void:
	if state == State.VICTORY:
		return
	state = State.VICTORY
	get_tree().paused = true
	hud.set_boss(false)
	hud.show_result(true, _stats_text())

func _on_defeat() -> void:
	if state == State.DEFEAT:
		return
	state = State.DEFEAT
	get_tree().paused = true
	hud.show_result(false, _stats_text())

func _stats_text() -> String:
	var p: Node = arena.player
	var skills: Array = []
	if p != null:
		for s in p.skill_slots:
			var sk: Dictionary = Data.skill_by_id(s["id"])
			skills.append("%s·%s" % [sk.get("general", ""), sk.get("name", "")])
		for id in p.passives.keys():
			var sk2: Dictionary = Data.skill_by_id(str(id))
			skills.append("%s·%s" % [sk2.get("general", ""), sk2.get("name", "")])
	return "存活 %02d:%02d　斩敌 %d　等级 %d\n习得武技：%s" % [
		int(arena.elapsed) / 60, int(arena.elapsed) % 60,
		arena.kills, p.level if p != null else 1,
		"、".join(skills) if not skills.is_empty() else "无",
	]
