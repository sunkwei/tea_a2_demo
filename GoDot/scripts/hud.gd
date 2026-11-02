extends CanvasLayer
class_name HUD
## 全部界面：标题页 / 战斗 HUD / 三选一卡牌 / 暂停 / 结算。

signal card_chosen(index: int)
signal start_pressed()
signal restart_pressed()
signal resume_pressed()

const FONT := preload("res://assets/fonts/fusion-pixel-12px-zh_hans.ttf")
const COL_GOLD := Color(0.95, 0.82, 0.45)
const COL_INK := Color(0.09, 0.1, 0.13, 0.92)

var arena: Node = null
var player: Node = null

# 标题页
var title_root: Control
var title_hint: Label
# 战斗 HUD
var hud_root: Control
var lbl_level: Label
var lbl_stage: Label
var lbl_wave: Label
var lbl_kills: Label
var lbl_time: Label
var bar_hp: ProgressBar
var bar_rage: ProgressBar
var bar_xp: ProgressBar
var lbl_hp: Label
var boss_root: Control
var bar_boss: ProgressBar
var lbl_boss: Label
var skill_slots: Array = []
var lbl_notice: Label
# 卡牌
var card_root: Control
var card_panels: Array = []
# 结算 / 暂停
var result_root: Control
var lbl_result: Label
var lbl_stats: Label
var pause_root: Control

var _notice_time: float = 0.0

func _ready() -> void:
	layer = 10
	process_mode = Node.PROCESS_MODE_ALWAYS
	_build_title()
	_build_hud()
	_build_cards()
	_build_result()
	_build_pause()
	show_title()

# ------------------------------------------------------------------ 构件
func _label(text: String, size: int = 12, color: Color = Color(0.94, 0.94, 0.9), align: int = HORIZONTAL_ALIGNMENT_LEFT) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", FONT)
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.9))
	l.add_theme_constant_override("outline_size", 6)
	l.horizontal_alignment = align
	return l

func _panel(color: Color = COL_INK, border: Color = Color(0.35, 0.3, 0.22, 0.9)) -> PanelContainer:
	var p := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = color
	sb.border_color = border
	sb.set_border_width_all(2)
	sb.set_content_margin_all(10)
	p.add_theme_stylebox_override("panel", sb)
	return p

func _bar(width: float, height: float, fill_color: Color) -> ProgressBar:
	var b := ProgressBar.new()
	b.custom_minimum_size = Vector2(width, height)
	b.show_percentage = false
	b.max_value = 100.0
	b.value = 100.0
	var bg := StyleBoxFlat.new()
	bg.bg_color = Color(0.08, 0.08, 0.1, 0.95)
	bg.border_color = Color(0.35, 0.33, 0.28, 0.9)
	bg.set_border_width_all(1)
	var fg := StyleBoxFlat.new()
	fg.bg_color = fill_color
	b.add_theme_stylebox_override("background", bg)
	b.add_theme_stylebox_override("fill", fg)
	return b

# ------------------------------------------------------------------ 标题页
func _build_title() -> void:
	title_root = Control.new()
	title_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	title_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(title_root)

	var dim := ColorRect.new()
	dim.color = Color(0.05, 0.06, 0.09, 0.72)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	dim.mouse_filter = Control.MOUSE_FILTER_IGNORE
	title_root.add_child(dim)

	var box := VBoxContainer.new()
	box.set_anchors_preset(Control.PRESET_CENTER)
	box.alignment = BoxContainer.ALIGNMENT_CENTER
	box.add_theme_constant_override("separation", 12)
	box.grow_horizontal = Control.GROW_DIRECTION_BOTH
	box.grow_vertical = Control.GROW_DIRECTION_BOTH
	title_root.add_child(box)

	var t := _label("GoDot · 三国肉鸽", 48, COL_GOLD, HORIZONTAL_ALIGNMENT_CENTER)
	box.add_child(t)
	box.add_child(_label("第一关 · 黄巾之乱 —— 广宗道", 24, Color(0.9, 0.85, 0.75), HORIZONTAL_ALIGNMENT_CENTER))
	box.add_child(_label("WASD/方向键 移动　鼠标左键/J 普攻　空格 翻滚　1 2 3 释放武技　ESC 暂停", 12, Color(0.8, 0.85, 0.9), HORIZONTAL_ALIGNMENT_CENTER))
	box.add_child(_label("武技来自三国名将：关羽 / 张飞 / 赵云 / 诸葛亮 / 吕布 / 黄忠 / 马超 / 周瑜 / 曹操 …", 12, Color(0.75, 0.8, 0.86), HORIZONTAL_ALIGNMENT_CENTER))

	title_hint = _label("按 空格 或 回车 开始征讨", 24, Color(1, 1, 1), HORIZONTAL_ALIGNMENT_CENTER)
	box.add_child(title_hint)

func hide_title() -> void:
	title_root.visible = false

func show_title() -> void:
	title_root.visible = true
	hud_root.visible = false
	card_root.visible = false
	result_root.visible = false
	pause_root.visible = false

# ------------------------------------------------------------------ 战斗 HUD
func _build_hud() -> void:
	hud_root = Control.new()
	hud_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	hud_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(hud_root)

	# 左上：关卡信息
	var top_left := VBoxContainer.new()
	top_left.position = Vector2(18, 14)
	top_left.add_theme_constant_override("separation", 2)
	hud_root.add_child(top_left)
	lbl_level = _label("第一关 · 黄巾之乱 · 广宗道", 24, COL_GOLD)
	top_left.add_child(lbl_level)
	lbl_stage = _label("阶段一 · 村口哨所", 12, Color(0.86, 0.9, 0.95))
	top_left.add_child(lbl_stage)
	lbl_wave = _label("第 0 / 15 波", 12, Color(0.86, 0.9, 0.95))
	top_left.add_child(lbl_wave)

	# 右上：统计
	var top_right := VBoxContainer.new()
	top_right.position = Vector2(1000, 14)
	top_right.add_theme_constant_override("separation", 2)
	hud_root.add_child(top_right)
	lbl_kills = _label("斩敌 0", 12, Color(0.9, 0.85, 0.75), HORIZONTAL_ALIGNMENT_RIGHT)
	top_right.add_child(lbl_kills)
	lbl_time = _label("00:00", 12, Color(0.8, 0.85, 0.9), HORIZONTAL_ALIGNMENT_RIGHT)
	top_right.add_child(lbl_time)

	# 顶部中央：Boss 血条
	boss_root = VBoxContainer.new()
	boss_root.set_anchors_preset(Control.PRESET_CENTER_TOP)
	boss_root.position = Vector2(-230, 12)
	boss_root.add_theme_constant_override("separation", 2)
	boss_root.visible = false
	hud_root.add_child(boss_root)
	lbl_boss = _label("大贤良师·张角", 24, Color(0.95, 0.5, 0.45), HORIZONTAL_ALIGNMENT_CENTER)
	boss_root.add_child(lbl_boss)
	bar_boss = _bar(460, 20, Color(0.78, 0.2, 0.25))
	boss_root.add_child(bar_boss)

	# 左下：血量 / 怒气 / 经验
	var bottom_left := VBoxContainer.new()
	bottom_left.position = Vector2(18, 606)
	bottom_left.add_theme_constant_override("separation", 4)
	hud_root.add_child(bottom_left)

	var hp_row := HBoxContainer.new()
	hp_row.add_theme_constant_override("separation", 8)
	bottom_left.add_child(hp_row)
	hp_row.add_child(_label("气血", 12, Color(0.9, 0.8, 0.8)))
	bar_hp = _bar(230, 18, Color(0.82, 0.22, 0.24))
	hp_row.add_child(bar_hp)
	lbl_hp = _label("120/120", 12, Color(0.95, 0.9, 0.9))
	hp_row.add_child(lbl_hp)

	var rage_row := HBoxContainer.new()
	rage_row.add_theme_constant_override("separation", 8)
	bottom_left.add_child(rage_row)
	rage_row.add_child(_label("怒气", 12, Color(0.9, 0.85, 0.6)))
	bar_rage = _bar(230, 12, Color(0.95, 0.72, 0.25))
	rage_row.add_child(bar_rage)

	var xp_row := HBoxContainer.new()
	xp_row.add_theme_constant_override("separation", 8)
	bottom_left.add_child(xp_row)
	xp_row.add_child(_label("等级", 12, Color(0.75, 0.9, 0.95)))
	bar_xp = _bar(230, 12, Color(0.35, 0.75, 0.95))
	xp_row.add_child(bar_xp)

	# 右下：武技槽
	var bottom_right := HBoxContainer.new()
	bottom_right.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	bottom_right.position = Vector2(-330, -108)
	bottom_right.add_theme_constant_override("separation", 8)
	hud_root.add_child(bottom_right)
	for i in range(3):
		var slot := _build_skill_slot(i)
		skill_slots.append(slot)
		bottom_right.add_child(slot["root"])

	# 中下方提示
	lbl_notice = _label("", 24, Color(1, 0.95, 0.8), HORIZONTAL_ALIGNMENT_CENTER)
	lbl_notice.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	lbl_notice.position = Vector2(-300, -170)
	lbl_notice.custom_minimum_size = Vector2(600, 0)
	lbl_notice.modulate.a = 0.0
	hud_root.add_child(lbl_notice)

func _build_skill_slot(index: int) -> Dictionary:
	var root := VBoxContainer.new()
	root.custom_minimum_size = Vector2(96, 92)
	root.add_theme_constant_override("separation", 2)
	var frame := _panel(Color(0.1, 0.11, 0.15, 0.85), Color(0.4, 0.36, 0.26, 0.9))
	frame.custom_minimum_size = Vector2(96, 60)
	root.add_child(frame)
	var inner := VBoxContainer.new()
	inner.add_theme_constant_override("separation", 0)
	frame.add_child(inner)
	var key := _label(str(index + 1), 12, COL_GOLD, HORIZONTAL_ALIGNMENT_CENTER)
	inner.add_child(key)
	var name_lbl := _label("—", 12, Color(0.92, 0.92, 0.88), HORIZONTAL_ALIGNMENT_CENTER)
	inner.add_child(name_lbl)
	var cd_lbl := _label("", 12, Color(0.75, 0.85, 0.95), HORIZONTAL_ALIGNMENT_CENTER)
	inner.add_child(cd_lbl)
	return {"root": root, "key": key, "name": name_lbl, "cd": cd_lbl, "frame": frame, "skill_id": ""}

# ------------------------------------------------------------------ 三选一
func _build_cards() -> void:
	card_root = Control.new()
	card_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	card_root.visible = false
	add_child(card_root)

	var dim := ColorRect.new()
	dim.color = Color(0.04, 0.05, 0.07, 0.78)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	card_root.add_child(dim)

	var title := _label("武技三选一", 36, COL_GOLD, HORIZONTAL_ALIGNMENT_CENTER)
	title.set_anchors_preset(Control.PRESET_CENTER_TOP)
	title.position = Vector2(-220, 60)
	title.custom_minimum_size = Vector2(440, 0)
	card_root.add_child(title)

	var row := HBoxContainer.new()
	row.set_anchors_preset(Control.PRESET_CENTER)
	row.position = Vector2(-360, 130)
	row.add_theme_constant_override("separation", 24)
	card_root.add_child(row)

	for i in range(3):
		var panel := PanelContainer.new()
		panel.custom_minimum_size = Vector2(220, 300)
		panel.mouse_filter = Control.MOUSE_FILTER_STOP
		row.add_child(panel)
		var sb := StyleBoxFlat.new()
		sb.bg_color = Color(0.1, 0.11, 0.15, 0.95)
		sb.border_color = Color.WHITE
		sb.set_border_width_all(3)
		sb.set_content_margin_all(12)
		panel.add_theme_stylebox_override("panel", sb)
		panel.gui_input.connect(_on_card_input.bind(i))

		var vb := VBoxContainer.new()
		vb.add_theme_constant_override("separation", 6)
		panel.add_child(vb)

		var icon := TextureRect.new()
		icon.custom_minimum_size = Vector2(0, 64)
		icon.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		icon.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		icon.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		vb.add_child(icon)

		var general := _label("武将", 24, COL_GOLD, HORIZONTAL_ALIGNMENT_CENTER)
		vb.add_child(general)
		var sname := _label("技能", 24, Color(1, 1, 1), HORIZONTAL_ALIGNMENT_CENTER)
		vb.add_child(sname)
		var rarity := _label("稀有度", 12, Color(0.8, 0.8, 0.85), HORIZONTAL_ALIGNMENT_CENTER)
		vb.add_child(rarity)
		var desc := _label("", 12, Color(0.86, 0.88, 0.92), HORIZONTAL_ALIGNMENT_CENTER)
		desc.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		desc.custom_minimum_size = Vector2(196, 0)
		vb.add_child(desc)
		var hint := _label("按 %d 选取" % (i + 1), 12, Color(0.7, 0.85, 0.95), HORIZONTAL_ALIGNMENT_CENTER)
		vb.add_child(hint)

		card_panels.append({"panel": panel, "icon": icon, "general": general, "name": sname, "rarity": rarity, "desc": desc, "style": sb})

func _on_card_input(event: InputEvent, index: int) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		card_chosen.emit(index)

func show_cards(skills: Array) -> void:
	card_root.visible = true
	for i in range(card_panels.size()):
		var c: Dictionary = card_panels[i]
		if i >= skills.size():
			c["panel"].visible = false
			continue
		var s: Dictionary = skills[i]
		c["panel"].visible = true
		var icon: TextureRect = c["icon"]
		if ResourceLoader.exists(str(s.get("icon", ""))):
			icon.texture = load(str(s["icon"]))
		icon.modulate = Color(s.get("tint", Color.WHITE))
		var g: Label = c["general"]
		g.text = str(s.get("general", ""))
		g.add_theme_color_override("font_color", s.get("tint", COL_GOLD))
		var nm: Label = c["name"]
		nm.text = str(s.get("name", ""))
		var rr: Label = c["rarity"]
		rr.text = "%s · %s" % [SkillSystem.rarity_name(int(s.get("rarity", 1))), "主动" if s.get("kind", "") == "active" else "被动"]
		rr.add_theme_color_override("font_color", SkillSystem.rarity_color(int(s.get("rarity", 1))))
		var d: Label = c["desc"]
		d.text = str(s.get("desc", ""))
		var st: StyleBoxFlat = c["style"]
		st.border_color = SkillSystem.rarity_color(int(s.get("rarity", 1)))

func hide_cards() -> void:
	card_root.visible = false

# ------------------------------------------------------------------ 结算 / 暂停
func _build_result() -> void:
	result_root = Control.new()
	result_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	result_root.visible = false
	add_child(result_root)
	var dim := ColorRect.new()
	dim.color = Color(0.04, 0.04, 0.06, 0.85)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	result_root.add_child(dim)
	var box := VBoxContainer.new()
	box.set_anchors_preset(Control.PRESET_CENTER)
	box.alignment = BoxContainer.ALIGNMENT_CENTER
	box.add_theme_constant_override("separation", 14)
	box.grow_horizontal = Control.GROW_DIRECTION_BOTH
	box.grow_vertical = Control.GROW_DIRECTION_BOTH
	result_root.add_child(box)
	lbl_result = _label("胜利", 48, COL_GOLD, HORIZONTAL_ALIGNMENT_CENTER)
	box.add_child(lbl_result)
	lbl_stats = _label("", 12, Color(0.9, 0.92, 0.95), HORIZONTAL_ALIGNMENT_CENTER)
	box.add_child(lbl_stats)
	box.add_child(_label("按 R 再战一场", 24, Color(1, 1, 1), HORIZONTAL_ALIGNMENT_CENTER))

func show_result(victory: bool, stats: String) -> void:
	result_root.visible = true
	lbl_result.text = "广宗道大捷！" if victory else "全军覆没"
	lbl_result.add_theme_color_override("font_color", COL_GOLD if victory else Color(0.9, 0.4, 0.35))
	lbl_stats.text = stats

func _build_pause() -> void:
	pause_root = Control.new()
	pause_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	pause_root.visible = false
	add_child(pause_root)
	var dim := ColorRect.new()
	dim.color = Color(0.04, 0.05, 0.07, 0.7)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	pause_root.add_child(dim)
	var l := _label("已暂停　ESC 继续", 36, Color(1, 1, 1), HORIZONTAL_ALIGNMENT_CENTER)
	l.set_anchors_preset(Control.PRESET_CENTER)
	pause_root.add_child(l)

func show_pause(v: bool) -> void:
	pause_root.visible = v

# ------------------------------------------------------------------ 运行时更新
func bind(a: Node) -> void:
	arena = a
	player = a.player
	if player == null:
		return
	player.hp_changed.connect(_on_hp_changed)
	player.xp_changed.connect(_on_xp_changed)
	player.stats_changed.connect(_on_stats_changed)
	_on_hp_changed(player.hp, player.max_hp)
	_on_xp_changed(player.xp, player.xp_next, player.level)
	_refresh_skills()

func _on_hp_changed(hp: float, max_hp: float) -> void:
	bar_hp.max_value = max_hp
	bar_hp.value = maxf(hp, 0.0)
	lbl_hp.text = "%d/%d" % [int(ceil(hp)), int(max_hp)]

func _on_xp_changed(xp: float, need: float, level: int) -> void:
	bar_xp.max_value = maxf(need, 1.0)
	bar_xp.value = clampf(xp, 0.0, need)

func _on_stats_changed() -> void:
	_refresh_skills()

func _refresh_skills() -> void:
	if player == null:
		return
	for i in range(skill_slots.size()):
		var slot: Dictionary = skill_slots[i]
		if i < player.skill_slots.size():
			var s: Dictionary = player.skill_slots[i]
			slot["skill_id"] = s["id"]
			var skill: Dictionary = Data.skill_by_id(s["id"])
			var nm: Label = slot["name"]
			nm.text = str(skill.get("name", ""))
			nm.add_theme_color_override("font_color", skill.get("tint", Color.WHITE))
			var cd: Label = slot["cd"]
			cd.text = "%.1f" % float(s["cd"]) if float(s["cd"]) > 0.0 else "就绪"
		else:
			slot["skill_id"] = ""
			var nm2: Label = slot["name"]
			nm2.text = "—"
			var cd2: Label = slot["cd"]
			cd2.text = ""

func set_wave(index: int, total: int) -> void:
	lbl_wave.text = "第 %d / %d 波" % [index + 1, total]

func set_stage(name: String) -> void:
	lbl_stage.text = name

func set_kills(k: int) -> void:
	lbl_kills.text = "斩敌 %d" % k

func set_time(t: float) -> void:
	lbl_time.text = "%02d:%02d" % [int(t) / 60, int(t) % 60]

func set_boss(visible_flag: bool, hp: float = 0.0, max_hp: float = 1.0, name_text: String = "") -> void:
	boss_root.visible = visible_flag
	if visible_flag:
		bar_boss.max_value = maxf(max_hp, 1.0)
		bar_boss.value = clampf(hp, 0.0, max_hp)
		lbl_boss.text = name_text

func notice(text: String) -> void:
	if text == "":
		return
	lbl_notice.text = text
	lbl_notice.modulate.a = 1.0
	_notice_time = 2.2

func _process(delta: float) -> void:
	if _notice_time > 0.0:
		_notice_time -= delta
		if _notice_time < 0.6:
			lbl_notice.modulate.a = maxf(_notice_time / 0.6, 0.0)
	if player != null and is_instance_valid(player):
		bar_rage.value = clampf(player.rage, 0.0, player.rage_max)
		if player.berserk > 0.0:
			lbl_notice.text = "无双！"
			lbl_notice.modulate.a = 1.0
		_refresh_cd()

func _refresh_cd() -> void:
	if player == null or not is_instance_valid(player):
		return
	for i in range(mini(skill_slots.size(), player.skill_slots.size())):
		var slot: Dictionary = skill_slots[i]
		var cd: Label = slot["cd"]
		var s: Dictionary = player.skill_slots[i]
		cd.text = "%.1f" % float(s["cd"]) if float(s["cd"]) > 0.0 else "就绪"
