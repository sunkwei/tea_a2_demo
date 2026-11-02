class_name AnimSprite
extends Sprite3D
## 像素角色精灵：负责贴图切换、帧动画、朝向翻转。

var _fps: float = 8.0
var _frame: int = 0
var _acc: float = 0.0
var _loop: bool = true
var _playing: bool = false
var _finished: bool = false

func setup(tex: Texture2D, frames: int, px: float) -> void:
	texture = tex
	vframes = 1
	hframes = maxi(frames, 1)
	frame = 0
	pixel_size = px
	alpha_cut = SpriteBase3D.ALPHA_CUT_DISCARD
	alpha_scissor_threshold = 0.5
	texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
	double_sided = true
	shaded = false
	centered = true
	no_depth_test = false

func play(tex: Texture2D, frames: int, fps: float, loop: bool = true) -> void:
	if tex == null:
		_playing = false
		return
	if texture != tex:
		texture = tex
		vframes = 1
		frame = 0
		_acc = 0.0
	hframes = maxi(frames, 1)
	_fps = maxf(fps, 0.1)
	_loop = loop
	_playing = true
	_finished = false
	_frame = clampi(_frame, 0, hframes - 1)

func stop() -> void:
	_playing = false

func is_finished() -> bool:
	return _finished

func _process(delta: float) -> void:
	if not _playing or hframes <= 1:
		return
	_acc += delta * _fps
	while _acc >= 1.0:
		_acc -= 1.0
		if _frame + 1 >= hframes:
			if _loop:
				_frame = 0
			else:
				_frame = hframes - 1
				_playing = false
				_finished = true
				break
		else:
			_frame += 1
	frame = clampi(_frame, 0, hframes - 1)

## 让精灵始终面向相机（固定朝向的 2.5D 观感），并按移动方向水平翻转。
func face_camera(camera_yaw: float, facing: float) -> void:
	rotation.y = camera_yaw
	flip_h = facing < 0.0
