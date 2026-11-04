# -*- coding: utf-8 -*-
"""校验渲染：临时加相机/灯光出图，不写入 .blend"""
import bpy, math, os, sys
from mathutils import Vector

OUT = os.path.join(os.path.dirname(bpy.data.filepath), 'preview')
os.makedirs(OUT, exist_ok=True)

try:
    bpy.context.scene.render.engine = 'BLENDER_EEVEE_NEXT'
except TypeError:
    bpy.context.scene.render.engine = 'BLENDER_EEVEE'
sc = bpy.context.scene
sc.render.resolution_x = 1400
sc.render.resolution_y = 1000
sc.render.resolution_percentage = 100
sc.render.film_transparent = False
try:
    sc.eevee.taa_render_samples = 24
except Exception:
    pass

# 临时太阳 + 背景
sun = bpy.data.objects.new('TmpSun', bpy.data.lights.new('TmpSun', 'SUN'))
sun.data.energy = 4.0
sun.rotation_euler = (math.radians(55), 0, math.radians(35))
bpy.context.scene.collection.objects.link(sun)
bpy.context.scene.world = bpy.data.worlds.new('TmpWorld')
bpy.context.scene.world.use_nodes = True
bg = bpy.context.scene.world.node_tree.nodes['Background']
bg.inputs[0].default_value = (0.55, 0.70, 0.88, 1)
bg.inputs[1].default_value = 1.0

cam_data = bpy.data.cameras.new('TmpCam')
cam = bpy.data.objects.new('TmpCam', cam_data)
bpy.context.scene.collection.objects.link(cam)
sc.camera = cam


def shot(name, loc, look, ortho=None, lens=50):
    cam.location = loc
    d = Vector(look) - Vector(loc)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    if ortho:
        cam_data.type = 'ORTHO'
        cam_data.ortho_scale = ortho
    else:
        cam_data.type = 'PERSP'
        cam_data.lens = lens
    sc.render.filepath = os.path.join(OUT, name.replace('.png', '.jpg'))
    sc.render.image_settings.file_format = 'JPEG'
    sc.render.image_settings.quality = 88
    bpy.ops.render.render(write_still=True)
    print('rendered', sc.render.filepath)


# 1) 回澜阁 3/4 透视
shot('01_pavilion_persp.png', (-26, -30, 16), (0, 0, 6.5), lens=60)
# 2) 回澜阁 正南立面
shot('02_pavilion_south.png', (0, -60, 7.0), (0, 0, 7.0), ortho=26)
# 3) 回澜阁 正东立面
shot('03_pavilion_east.png', (60, 0, 7.0), (0, 0, 7.0), ortho=26)
# 4) 回澜阁 平面
shot('04_pavilion_top.png', (0, 0, 60), (0, 0, 0), ortho=24)
# 5) 栈桥 + 回澜阁 全景（东南侧俯视）
shot('05_whole_persp.png', (-150, -170, 95), (0, 120, 0), lens=40)
# 6) 栈桥 全局平面（正交感强的正上方，正射 640 m 覆盖全长）
shot('06_whole_top.png', (0, 200, 500), (0, 200, 0), ortho=640)
# 7) 栈桥 侧面立面（南端在左）
shot('07_bridge_side.png', (-420, 200, 3), (0, 200, 3), ortho=640)
# 8) 南端平面（回澜阁 + 个字形防波堤 + 三角形桥头）
shot('08_south_end_plan.png', (0, 2, 220), (0, 2, 0), ortho=150)
print('PREVIEW DONE')
