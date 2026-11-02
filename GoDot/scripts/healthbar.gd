class_name HealthBar3D
extends Node3D
## 头顶血条（3D）：深色底 + 红色填充，靠近地面时也能看清。

var _bg: MeshInstance3D
var _fill: MeshInstance3D
var _max_hp: float = 1.0
var _width: float = 1.1

func setup(max_hp: float, width: float = 1.1, height: float = 0.14) -> void:
	_max_hp = maxf(max_hp, 1.0)
	_width = width
	_bg = MeshInstance3D.new()
	_bg.mesh = QuadMesh.new()
	_bg.mesh.size = Vector2(width, height)
	_bg.material_override = _mat(Color(0.08, 0.07, 0.09, 0.9))
	_bg.rotation.x = -PI * 0.5
	_bg.position = Vector3(0, 0.012, 0)
	add_child(_bg)

	_fill = MeshInstance3D.new()
	_fill.mesh = QuadMesh.new()
	_fill.mesh.size = Vector2(width - 0.04, height - 0.04)
	_fill.material_override = _mat(Color(0.85, 0.22, 0.2, 1.0))
	_fill.rotation.x = -PI * 0.5
	_fill.position = Vector3(0, 0.02, 0)
	add_child(_fill)

func set_hp(hp: float) -> void:
	if _fill == null:
		return
	var r: float = clampf(hp / _max_hp, 0.0, 1.0)
	_fill.scale.x = maxf(r, 0.001)
	_fill.position.x = -(_width - 0.04) * (1.0 - r) * 0.5

func set_color(c: Color) -> void:
	if _fill == null:
		return
	_fill.material_override = _mat(c)

static func _mat(c: Color) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.no_depth_test = false
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	return m
