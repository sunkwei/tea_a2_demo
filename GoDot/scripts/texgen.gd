class_name TexGen
extends RefCounted
## 程序化生成小贴图（法阵、火海范围、经验珠、光环等）。

static var _foot_cache: Dictionary = {}

## 精灵贴图底部（不透明像素最低点）相对帧中心的像素偏移。
## 用于把角色/道具的脚底精确对齐到地面。
static func foot_offset_px(tex: Texture2D, hframes: int = 1) -> float:
	if tex == null:
		return 0.0
	var key: String = tex.resource_path + "#" + str(hframes)
	if _foot_cache.has(key):
		return float(_foot_cache[key])
	var result := 0.0
	var img: Image = tex.get_image()
	if img != null and not img.is_empty():
		var fw: int = maxi(int(float(img.get_width()) / float(maxi(hframes, 1))), 1)
		var fh: int = img.get_height()
		var frame_img: Image = img.get_region(Rect2i(0, 0, fw, fh))
		var used: Rect2i = frame_img.get_used_rect()
		if used.size.y > 0:
			result = float(used.position.y + used.size.y) - float(fh) * 0.5
	_foot_cache[key] = result
	return result

## 柔边圆盘贴图
static func disc_texture(color: Color, size: int = 96, soft: float = 0.35) -> ImageTexture:
	var img := Image.create(size, size, false, Image.FORMAT_RGBA8)
	var c := float(size) * 0.5
	for y in size:
		for x in size:
			var d: float = Vector2(x - c + 0.5, y - c + 0.5).length() / c
			var a: float = clampf(1.0 - (d - (1.0 - soft)) / soft, 0.0, 1.0)
			a = pow(a, 0.8)
			img.set_pixel(x, y, Color(color.r, color.g, color.b, color.a * a))
	return ImageTexture.create_from_image(img)

## 圆环（法阵刻线）
static func ring_texture(color: Color, size: int = 128) -> ImageTexture:
	var img := Image.create(size, size, false, Image.FORMAT_RGBA8)
	var c := float(size) * 0.5
	for y in size:
		for x in size:
			var d: float = Vector2(x - c + 0.5, y - c + 0.5).length() / c
			var a := 0.0
			if d < 1.0:
				a = clampf(1.0 - absf(d - 0.86) / 0.10, 0.0, 1.0)
				a = maxf(a, clampf(1.0 - absf(d - 0.62) / 0.06, 0.0, 1.0) * 0.7)
			img.set_pixel(x, y, Color(color.r, color.g, color.b, color.a * a))
	return ImageTexture.create_from_image(img)

## 经验珠：小球
static func orb_texture(color: Color, size: int = 32) -> ImageTexture:
	var img := Image.create(size, size, false, Image.FORMAT_RGBA8)
	var c := float(size) * 0.5
	for y in size:
		for x in size:
			var p := Vector2(x - c + 0.5, y - c + 0.5)
			var d := p.length() / c
			var a := clampf(1.0 - (d - 0.55) / 0.45, 0.0, 1.0)
			var shade := clampf(1.0 - p.y / (c * 2.0) * 0.5, 0.3, 1.0)
			img.set_pixel(x, y, Color(color.r * shade, color.g * shade, color.b * shade, color.a * a))
	return ImageTexture.create_from_image(img)
