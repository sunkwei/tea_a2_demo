# -*- coding: utf-8 -*-
"""
青岛栈桥 & 回澜阁 — Blender 建模脚本
=========================================
单位：米
坐标：原点 O(0,0,0) = 回澜阁八角亭台基几何中心，Z=0 = 台基顶面
      +Y = 正北（指向岸边，栈桥自南向北延伸）
      +X = 正东，+Z = 向上
海平面 Z = -4.0 m，栈桥桥面 Z = -0.60 m

尺寸依据见 zhanqiao/dims.md：
  · 百度百科《栈桥及回澜阁》、青岛晚报、青岛政务网、《青岛市地名保护名录》
  · 1933 年《前海栈桥南段改筑钢筋混合土设计图》（Wikimedia Commons）
    —— 回澜阁立面比例按该图纸逐像素量取

运行：
  blender -b --factory-startup --python zhanqiao/build_zhanqiao.py
"""
import bpy
import math
from mathutils import Vector

TAU = math.pi * 2
R8 = math.pi / 4          # 八角 45°
COS22 = math.cos(math.pi / 8)
CORNER0 = math.pi / 8    # 八角转角方位（角点在 22.5° + k·45°）

# ============================== 参数表 ==============================
P = {
    # ---- 回澜阁 台基（八角，面积 2√2·R² ≈ 151 m²，与文献“占地 151 m²”吻合）----
    'plat_R': 7.30,        # 台基八角外接圆半径（对角宽 14.6 m）
    'plat_bot': -3.60,
    'plat_bot_R': 8.40,    # 台基下口外接圆半径（放坡）
    'plat_cope': 0.28,     # 压顶石厚

    # ---- 回澜阁 一层（16 柱：8 转角 + 8 中）----
    'col_R': 5.80,         # 一层转角柱外接圆半径（对角宽 11.6 m）
    'col_r': 0.25,         # 柱半径
    'col_z0': 0.36,        # 柱础顶
    'col_z1': 3.20,        # 一层柱头 = 下檐口

    # ---- 回澜阁 二层（8 柱）----
    'up_R': 3.90,          # 二层转角柱外接圆半径（对角宽 7.8 m）
    'up_r': 0.21,
    'up_z0': 6.10,         # 二层柱脚（下层屋面内环标高）
    'up_z1': 8.90,         # 二层柱头 = 上檐口

    # ---- 屋面（比例据 1933 年设计图量取：下檐宽 350 px；楼面→下檐 55 px，
    #      下檐→上檐 72 px；宝顶 151 px；旗杆顶 212 px）----
    'low_roof': {'R': 7.42, 'z': 3.20, 'apex': 6.10, 'r_top': 3.90,
                 'ext': 0.20, 'lift': 1.20},      # 下檐对角宽 17.8 m
    'up_roof':  {'R': 4.80, 'z': 8.90, 'apex': 11.10, 'r_top': 0.34,
                 'ext': 0.20, 'lift': 0.85},      # 上檐对角宽 11.5 m

    'finial_top': 12.30,   # 宝顶尖
    'flag_top': 13.80,     # 旗杆顶

    # ---- 栈桥 ----
    'sea': -4.00,
    'deck_z': -0.60,       # 桥面标高
    'deck_w': 10.00,       # 桥宽
    'deck_th': 0.55,
    'head_y0': 6.00,       # 三角形桥头 起
    'head_y1': 15.65,      # 三角形桥头 止（桥头长 15.65 m）
    'kong_y0': 15.65,      # 孔桥（透空段）起
    'kong_y1': 165.35,     # 孔桥止（孔桥长 149.7 m）
    'yin_y0': 165.35,      # 引桥（实堤段）起
    'yin_y1': 401.45,      # 引桥止（引桥长 236.1 m，桥身全长 401.45 m）
    'pier_n': 6,           # 孔桥跨数
    'rail_h': 1.10,        # 铁链护栏高
    'rail_step': 2.50,
    'lamp_n': 12,          # 莲花路灯 12 对

    # ---- 防波堤（“个”字形，正北方向留口让栈桥通过）----
    'bw_in': 17.00,        # 内坡脚半径
    'bw_top_in': 20.50,
    'bw_top_out': 25.50,
    'bw_out': 29.00,
    'bw_top_z': -0.25,
    'bw_a0': math.radians(-225.0),   # 起点：西北
    'bw_a1': math.radians(45.0),     # 终点：东北（缺口正对北方栈桥）
}

COLL_NAME = 'Zhanqiao'
C = {}
OBJ = {}

# ============================== 工具函数 ==============================

def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)


def get_coll(name):
    if name in bpy.data.collections:
        return bpy.data.collections[name]
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def make_mat(name, color, rough=0.65, metal=0.0, emit=None, emit_str=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf:
        bsdf.inputs['Base Color'].default_value = (color[0], color[1], color[2], 1.0)
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = metal
        if emit is not None and 'Emission Color' in bsdf.inputs:
            bsdf.inputs['Emission Color'].default_value = (emit[0], emit[1], emit[2], 1.0)
            bsdf.inputs['Emission Strength'].default_value = emit_str
    m.diffuse_color = (color[0], color[1], color[2], 1.0)
    return m


def new_obj(name, verts, faces, mat=None, smooth=False, coll=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    me.update()
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    (coll or get_coll(COLL_NAME)).objects.link(ob)
    if mat is not None:
        ob.data.materials.append(mat)
    return ob


def box(name, loc, size, rot_z=0.0, mat=None, coll=None):
    """直接在网格层面建长方体（不依赖对象缩放，便于 join）"""
    sx, sy, sz = size
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    verts = [(-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
             (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)]
    faces = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1),
             (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    ob = new_obj(name, verts, faces, mat, coll=coll)
    ob.location = loc
    ob.rotation_euler = (0.0, 0.0, rot_z)
    return ob


def add_solidify(ob, thickness, offset=-1.0):
    m = ob.modifiers.new('Solidify', 'SOLIDIFY')
    m.thickness = thickness
    m.offset = offset
    m.use_even_offset = True
    return m


def loft(name, rings, mat=None, smooth=False, cap_start=True, cap_end=True, coll=None):
    n = len(rings[0])
    verts = []
    for r in rings:
        verts.extend(r)
    faces = []
    for s in range(len(rings) - 1):
        a, b = s * n, (s + 1) * n
        for i in range(n):
            j = (i + 1) % n
            faces.append((a + i, a + j, b + j, b + i))
    if cap_start:
        faces.append(tuple(range(n - 1, -1, -1)))
    if cap_end:
        o = (len(rings) - 1) * n
        faces.append(tuple(range(o, o + n)))
    return new_obj(name, verts, faces, mat, smooth, coll)


def ring_circle(r, z, n=48, offset=0.0, cx=0.0, cy=0.0):
    return [(cx + r * math.cos(offset + i * TAU / n),
             cy + r * math.sin(offset + i * TAU / n), z) for i in range(n)]


def ring_octagon(R, z, offset=CORNER0, cx=0.0, cy=0.0):
    return [(cx + R * math.cos(offset + i * R8),
             cy + R * math.sin(offset + i * R8), z) for i in range(8)]


def prism_from_poly(name, poly, z0, z1, mat=None, coll=None):
    r0 = [(x, y, z0) for x, y in poly]
    r1 = [(x, y, z1) for x, y in poly]
    return loft(name, [r0, r1], mat, coll=coll)


def beam(name, p0, p1, w, h, mat=None, coll=None):
    """两点之间的方棱柱：局部 Z 沿 p0→p1，w=局部X 尺寸，h=局部Y 尺寸"""
    p0 = Vector(p0)
    p1 = Vector(p1)
    d = p1 - p0
    L = d.length
    verts = []
    for sgn in (-0.5, 0.5):
        for sy, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            verts.append((sy * w / 2, sz * h / 2, sgn * L))
    faces = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1),
             (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    ob = new_obj(name, verts, faces, mat, coll=coll)
    ob.location = (p0 + p1) / 2
    ob.rotation_mode = 'QUATERNION'
    ob.rotation_quaternion = d.to_track_quat('Z', 'Y')
    return ob


def cyl(name, r, z0, z1, loc=(0, 0), n=20, mat=None, coll=None):
    verts, faces = [], []
    for k, z in enumerate((z0, z1)):
        for i in range(n):
            a = TAU * i / n
            verts.append((r * math.cos(a), r * math.sin(a), z))
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    faces.append(tuple(range(n - 1, -1, -1)))
    faces.append(tuple(range(n, 2 * n)))
    ob = new_obj(name, verts, faces, mat, coll=coll)
    ob.location = (loc[0], loc[1], 0)
    return ob


def join_objs(objs, name):
    objs = [o for o in objs if o]
    if not objs:
        return None
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    objs[0].name = name
    return objs[0]


def clone(obj, loc=(0, 0, 0), rot_z=0.0, name=None, coll=None):
    nb = obj.copy()
    nb.data = obj.data
    nb.location = loc
    nb.rotation_euler = (0, 0, rot_z)
    if name:
        nb.name = name
    (coll or get_coll(COLL_NAME)).objects.link(nb)
    return nb


# ============================== 屋面（八角重檐攒尖） ==============================

def build_roof(name, cfg, mat, seg_per_face=32, corner_pow=2.4, thickness=0.22,
                M=16, offset=CORNER0):
    """八角攒尖顶：檐口角部起翘（半径外扩 + 标高抬高），屋面凹曲（举折）"""
    R, z, apex, r_top = cfg['R'], cfg['z'], cfg['apex'], cfg['r_top']
    ext, lift = cfg['ext'], cfg['lift']
    N = 8 * seg_per_face
    verts, faces, rows = [], [], []
    for i in range(N + 1):
        th = TAU * i / N
        w = abs(math.cos(4 * (th - offset))) ** corner_pow     # 1=角部 0=檐口中部
        Re = R * (1 + ext * w)
        ze = z + lift * w
        p = 1.0 + 1.30 * (1 - w)                               # 中部凹曲、角部成脊
        row = []
        for j in range(M + 1):
            s = j / M
            r = Re * (1 - s) + r_top * s
            zz = ze + (apex - ze) * (s ** p)
            row.append(len(verts))
            verts.append((r * math.cos(th), r * math.sin(th), zz))
        rows.append(row)
    for i in range(N):
        for j in range(M):
            faces.append((rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]))
    ob = new_obj(name, verts, faces, mat, smooth=True)
    add_solidify(ob, thickness, offset=-1.0)
    return ob


def build_hip_ridges(name, cfg, mat, corners=8, offset=CORNER0, w=0.28, h=0.24):
    """8 条垂脊：沿角部自檐口起翘点直到宝顶"""
    R, z, apex, r_top = cfg['R'], cfg['z'], cfg['apex'], cfg['r_top']
    ext, lift = cfg['ext'], cfg['lift']
    objs = []
    for k in range(corners):
        th = offset + k * R8
        Re = R * (1 + ext)
        ze = z + lift
        p0 = (Re * math.cos(th), Re * math.sin(th), ze - 0.06)
        p1 = (r_top * math.cos(th), r_top * math.sin(th), apex - 0.12)
        objs.append(beam(f'{name}_r{k}', p0, p1, w, h, mat))
    return join_objs(objs, name)


# ============================== 回澜阁 ==============================

def build_pavilion():
    coll = get_coll(COLL_NAME)
    R = P['plat_R']
    z0, z1 = P['col_z0'], P['col_z1']

    # ---------- 台基 ----------
    base = loft('HuilanGe_Platform',
                [ring_octagon(P['plat_bot_R'], P['plat_bot']),
                 ring_octagon(R, P['plat_bot'] + 0.45),
                 ring_octagon(R, -P['plat_cope'])],
                C['stone'], coll=coll)
    cope = loft('HuilanGe_PlatformCoping',
                [ring_octagon(R + 0.18, -P['plat_cope']),
                 ring_octagon(R + 0.18, 0.0)],
                C['stone_dark'], coll=coll)
    floor = loft('HuilanGe_TerraceFloor',
                 [ring_octagon(R - 0.02, 0.0), ring_octagon(R - 0.02, 0.06)],
                 C['stone'], coll=coll)

    # ---------- 一层柱网 ----------
    col_R, col_r = P['col_R'], P['col_r']
    corners = [(col_R * math.cos(CORNER0 + i * R8),
                col_R * math.sin(CORNER0 + i * R8)) for i in range(8)]
    mids = [(col_R * COS22 * math.cos(i * R8),
             col_R * COS22 * math.sin(i * R8)) for i in range(8)]
    ring = []                                   # 16 根，按方位角顺序：角柱、中柱交替
    for k in range(8):
        ring.append(corners[k])
        ring.append(mids[k])

    parts = []
    for (x, y) in ring:
        parts.append(cyl(f'colbase_{len(parts)}', col_r + 0.07, 0.0, 0.36,
                         (x, y), 20, C['stone']))
        parts.append(cyl(f'col_{len(parts)}', col_r, z0, z1, (x, y), 20, C['red']))
    columns = join_objs(parts, 'HuilanGe_Columns_L1')

    # 额枋 / 檐檩 / 垫板（每面 3 跨）
    beams = []
    for i in range(16):
        a = Vector((ring[i][0], ring[i][1], 0))
        b = Vector((ring[(i + 1) % 16][0], ring[(i + 1) % 16][1], 0))
        for (zz, w, h, mat) in ((z1 - 0.22, 0.20, 0.30, C['red']),
                                (z1 - 0.02, 0.26, 0.16, C['red_dark']),
                                (z1 - 0.52, 0.14, 0.34, C['red_dark'])):
            beams.append(beam(f'lin{i}_{zz}',
                              (a.x, a.y, zz), (b.x, b.y, zz), w, h, mat))
    lintels = join_objs(beams, 'HuilanGe_Lintels_L1')

    # 一层墙身 + 仿古窗扇（16 开间）
    walls = []
    for i in range(16):
        a = Vector((ring[i][0], ring[i][1], 0))
        b = Vector((ring[(i + 1) % 16][0], ring[(i + 1) % 16][1], 0))
        mid = (a + b) / 2
        d = b - a
        L = d.length
        ang = math.atan2(d.y, d.x)
        walls.append(box(f'w{i}', (mid.x, mid.y, (0.06 + z1 - 0.30) / 2),
                         (L - 0.10, 0.12, z1 - 0.36), ang, C['red']))
        wl = L - 0.80
        wh = z1 - 1.75
        wz = 0.95 + wh / 2
        nx, ny = d.y / L, -d.x / L            # 外法线
        off = 0.12 / 2 + 0.09 / 2 + 0.015
        wx, wy = mid.x + nx * off, mid.y + ny * off
        walls.append(box(f'wf{i}', (wx, wy, wz), (wl, 0.09, wh), ang, C['wood']))
        for k in range(4):
            u = -0.5 + (k + 1) / 5.0
            px = wx + math.cos(ang) * wl * u
            py = wy + math.sin(ang) * wl * u
            walls.append(box(f'wm{i}_{k}', (px, py, wz), (0.07, 0.07, wh), ang, C['red_dark']))
    wall_objs = join_objs(walls, 'HuilanGe_Walls_L1')
    for m in (C['red'], C['wood'], C['red_dark']):
        wall_objs.data.materials.append(m)

    # ---------- 二层 ----------
    up_R, up_r = P['up_R'], P['up_r']
    uz0, uz1 = P['up_z0'], P['up_z1']
    uc = [(up_R * math.cos(CORNER0 + i * R8),
           up_R * math.sin(CORNER0 + i * R8)) for i in range(8)]

    parts = []
    for (x, y) in uc:
        parts.append(cyl(f'uc_{len(parts)}', up_r + 0.05, uz0, uz0 + 0.20,
                         (x, y), 18, C['red_dark']))
        parts.append(cyl(f'uc2_{len(parts)}', up_r, uz0 + 0.20, uz1,
                         (x, y), 18, C['red']))
    up_cols = join_objs(parts, 'HuilanGe_Columns_L2')

    beams = []
    for i in range(8):
        p0 = Vector((uc[i][0], uc[i][1], 0))
        p1 = Vector((uc[(i + 1) % 8][0], uc[(i + 1) % 8][1], 0))
        mid = (p0 + p1) / 2
        d = p1 - p0
        L = d.length
        ang = math.atan2(d.y, d.x)
        beams.append(beam(f'ub{i}', (p0.x, p0.y, uz1 - 0.20),
                          (p1.x, p1.y, uz1 - 0.20), 0.18, 0.26, C['red']))
        beams.append(beam(f'ue{i}', (p0.x, p0.y, uz1 - 0.02),
                          (p1.x, p1.y, uz1 - 0.02), 0.24, 0.14, C['red_dark']))
        beams.append(box(f'uw{i}', (mid.x, mid.y, (uz0 + uz1 - 0.25) / 2),
                         (L - 0.12, 0.10, uz1 - 0.25 - uz0), ang, C['red']))
        wl = L - 0.60
        wh = uz1 - uz0 - 1.05
        wz = uz0 + 0.45 + wh / 2
        nx, ny = d.y / L, -d.x / L            # 外法线
        off = 0.10 / 2 + 0.08 / 2 + 0.015
        wx, wy = mid.x + nx * off, mid.y + ny * off
        beams.append(box(f'uwf{i}', (wx, wy, wz), (wl, 0.08, wh), ang, C['wood']))
        for k in range(5):
            u = -0.5 + (k + 1) / 6.0
            px = wx + math.cos(ang) * wl * u
            py = wy + math.sin(ang) * wl * u
            beams.append(box(f'uwm{i}_{k}', (px, py, wz), (0.06, 0.06, wh), ang, C['red_dark']))
    up_beams = join_objs(beams, 'HuilanGe_Lintels_L2')
    for m in (C['red'], C['red_dark'], C['wood']):
        up_beams.data.materials.append(m)

    up_floor = loft('HuilanGe_Floor_L2',
                    [ring_octagon(up_R - 0.12, uz0 - 0.18), ring_octagon(up_R - 0.12, uz0)],
                    C['wood'], coll=coll)

    # ---------- 屋面 ----------
    build_roof('HuilanGe_Roof_Lower', P['low_roof'], C['tile_yellow'])
    build_hip_ridges('HuilanGe_Ridges_Lower', P['low_roof'], C['tile_yellow'])
    build_roof('HuilanGe_Roof_Upper', P['up_roof'], C['tile_yellow'])
    build_hip_ridges('HuilanGe_Ridges_Upper', P['up_roof'], C['tile_yellow'])

    skirt = loft('HuilanGe_RoofSkirt',
                 [ring_octagon(P['low_roof']['r_top'] + 0.10, P['low_roof']['apex'] - 0.05),
                  ring_octagon(P['low_roof']['r_top'] + 0.10, P['low_roof']['apex'] + 0.75)],
                 C['red'], coll=coll)

    # ---------- 宝顶 + 旗杆 ----------
    zt = P['up_roof']['apex']
    parts = []
    parts.append(cyl('fin0', 0.85, zt - 0.05, zt + 0.50, (0, 0), 24, C['tile_yellow']))
    parts.append(cyl('fin1', 0.52, zt + 0.50, zt + 0.95, (0, 0), 24, C['tile_yellow']))
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=0.62,
                                         location=(0, 0, zt + 1.18))
    sph = bpy.context.object
    sph.data.materials.append(C['tile_yellow'])
    parts.append(sph)
    bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=0.58, radius2=0.10, depth=0.62,
                                    location=(0, 0, zt + 1.72))
    cone = bpy.context.object
    cone.data.materials.append(C['tile_yellow'])
    parts.append(cone)
    parts.append(cyl('fin4', 0.14, zt + 2.03, zt + 2.50, (0, 0), 16, C['tile_yellow']))
    finial = join_objs(parts, 'HuilanGe_Finial')

    pole = cyl('HuilanGe_FlagPole', 0.055, P['finial_top'] - 0.30, P['flag_top'],
               (0, 0), 12, C['metal'])
    flag = new_obj('HuilanGe_Flag',
                   [(0.05, 0, 0), (1.25, 0, -0.12), (0.05, 0, -0.62)],
                   [(0, 1, 2)], C['red'], coll=coll)
    flag.location = (0, 0, P['flag_top'] - 0.10)

    # ---------- 台基栏杆（望柱 + 栏板）----------
    rail_parts = []
    ring8 = ring_octagon(R - 0.35, 0.06)
    for i in range(8):
        a = Vector(ring8[i][:2])
        b = Vector(ring8[(i + 1) % 8][:2])
        for t in (0.05, 0.5, 0.95):
            p = a.lerp(b, t)
            rail_parts.append(box(f'post{i}_{t}', (p.x, p.y, 0.06 + 0.45),
                                  (0.17, 0.17, 0.90), 0, C['stone_dark']))
        d = b - a
        ang = math.atan2(d.y, d.x)
        mid = (a + b) / 2
        rail_parts.append(box(f'panel{i}', (mid.x, mid.y, 0.50),
                              (d.length - 0.34, 0.08, 0.52), ang, C['stone_dark']))
    join_objs(rail_parts, 'HuilanGe_TerraceRailing')

    # ---------- 匾额（北面）----------
    y_face = col_R * COS22
    plaque = box('HuilanGe_Plaque', (0.0, y_face + 0.14, z1 - 0.72),
                 (2.40, 0.14, 0.92), 0, C['gold'])
    plaque.name = 'HuilanGe_Plaque'


# ============================== 栈桥 ==============================

def build_bridge():
    coll = get_coll(COLL_NAME)
    dz = P['deck_z']
    hw = P['deck_w'] / 2

    # 三角形桥头
    head_poly = [(-hw, P['head_y0']), (hw, P['head_y0']),
                 (11.0, P['head_y1']), (-11.0, P['head_y1'])]
    prism_from_poly('Zhanqiao_BridgeHead', head_poly, P['sea'], dz, C['stone'], coll)
    prism_from_poly('Zhanqiao_BridgeHeadCoping',
                    [(-hw, P['head_y0']), (hw, P['head_y0']),
                     (11.25, P['head_y1']), (-11.25, P['head_y1'])],
                    dz, dz + 0.18, C['stone_dark'], coll)

    # 引桥（北段实堤）
    prism_from_poly('Zhanqiao_Approach',
                    [(-hw, P['yin_y0']), (hw, P['yin_y0']),
                     (hw, P['yin_y1']), (-hw, P['yin_y1'])],
                    P['sea'], dz - P['deck_th'], C['stone'], coll)
    prism_from_poly('Zhanqiao_ApproachCoping',
                    [(-hw - 0.25, P['yin_y0']), (hw + 0.25, P['yin_y0']),
                     (hw + 0.25, P['yin_y1']), (-hw - 0.25, P['yin_y1'])],
                    dz - P['deck_th'], dz, C['stone_dark'], coll)

    # 孔桥（南段透空桥：拱券 + 桥墩）
    ky0, ky1 = P['kong_y0'], P['kong_y1']
    span = (ky1 - ky0) / P['pier_n']
    ys, bots = [], []
    for i in range(P['pier_n']):
        a = ky0 + i * span
        b = a + span
        spring = P['sea'] + 1.10
        r = min((b - a) / 2 - 1.6, 6.0)
        ns = 28
        for k in range(ns + 1):
            t = k / ns
            y = a + 1.6 + (b - a - 3.2) * t
            u = max(-1.0, min(1.0, (y - (a + 1.6 + r)) / r))
            ys.append(y)
            bots.append(spring + r * math.sqrt(max(0.0, 1 - u * u)))
        ys.append(b - 1.6)
        bots.append(P['sea'])
        ys.append(b)
        bots.append(P['sea'])
    ys.append(ky1)
    bots.append(P['sea'])
    order = sorted(range(len(ys)), key=lambda i: ys[i])
    ys_s = [ys[i] for i in order]
    bot_s = [bots[i] for i in order]

    def wall_strip(name, ys_, bots, top, x_center, thick, mat):
        verts, faces = [], []
        for y, b in zip(ys_, bots):
            verts.append((x_center - thick / 2, y, b))
            verts.append((x_center + thick / 2, y, b))
            verts.append((x_center + thick / 2, y, top))
            verts.append((x_center - thick / 2, y, top))
        for i in range(len(ys_) - 1):
            a, b = i * 4, (i + 1) * 4
            for k in range(4):
                k2 = (k + 1) % 4
                faces.append((a + k, a + k2, b + k2, b + k))
        faces.append((0, 3, 2, 1))
        o = (len(ys_) - 1) * 4
        faces.append((o, o + 1, o + 2, o + 3))
        return new_obj(name, verts, faces, mat, coll=coll)

    wall_strip('Zhanqiao_KongWall_W', ys_s, bot_s, dz - P['deck_th'],
               -hw + 0.35, 0.70, C['stone'])
    wall_strip('Zhanqiao_KongWall_E', ys_s, bot_s, dz - P['deck_th'],
               hw - 0.35, 0.70, C['stone'])

    piers = []
    for i in range(P['pier_n'] + 1):
        y = ky0 + i * span
        for x in (-hw + 1.4, hw - 1.4):
            piers.append(box(f'pier{i}_{x}', (x, y, (P['sea'] + dz - P['deck_th']) / 2),
                              (2.2, 2.6, dz - P['deck_th'] - P['sea']), 0, C['stone']))
    join_objs(piers, 'Zhanqiao_Piers')

    prism_from_poly('Zhanqiao_Deck_Kong',
                    [(-hw, ky0), (hw, ky0), (hw, ky1), (-hw, ky1)],
                    dz - P['deck_th'], dz, C['concrete'], coll)
    prism_from_poly('Zhanqiao_Coping_Kong',
                    [(-hw - 0.25, ky0), (hw + 0.25, ky0),
                     (hw + 0.25, ky1), (-hw - 0.25, ky1)],
                    dz - 0.18, dz + 0.10, C['stone_dark'], coll)


# ============================== 栏杆 / 路灯 / 防波堤 ==============================

def make_chain(name, p0, p1, sag=0.16, r=0.035, seg=6):
    p0 = Vector(p0)
    p1 = Vector(p1)
    pts = []
    for i in range(seg + 1):
        t = i / seg
        p = p0.lerp(p1, t)
        p.z -= sag * math.sin(math.pi * t)
        pts.append(p)
    cu = bpy.data.curves.new(name + '_cu', 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = r
    cu.bevel_resolution = 2
    sp = cu.splines.new('POLY')
    sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        sp.points[i].co = (p.x, p.y, p.z, 1.0)
    cu.materials.append(C['metal'])
    ob = bpy.data.objects.new(name, cu)
    get_coll(COLL_NAME).objects.link(ob)
    return ob


def build_railing():
    coll = get_coll(COLL_NAME)
    dz = P['deck_z']
    hw = P['deck_w'] / 2
    segs = [('head', P['head_y0'], P['head_y1'], 11.0),
            ('kong', P['kong_y0'], P['kong_y1'], hw),
            ('yin', P['yin_y0'], P['yin_y1'], hw)]

    post = cyl('Zhanqiao_RailPost', 0.055, 0.0, P['rail_h'], (0, 0), 10, C['metal'])
    posts, chains = [], []
    for tag, a, b, w in segs:
        n = max(2, int((b - a) / P['rail_step']))
        step = (b - a) / n
        for side in (-1, 1):
            x = side * (w - 0.30)
            prev = None
            for i in range(n + 1):
                y = a + i * step
                posts.append(clone(post, (x, y, dz), name=f'RailPost_{tag}{side}_{i}', coll=coll))
                cur = (x, y, dz + P['rail_h'] - 0.10)
                if prev:
                    chains.append(make_chain(f'Chain_{tag}{side}_{i}', prev, cur))
                prev = cur
    join_objs(posts, 'Zhanqiao_RailPosts')
    join_objs([c for c in chains if c], 'Zhanqiao_Chains')


def build_lamps():
    coll = get_coll(COLL_NAME)
    dz = P['deck_z']
    hw = P['deck_w'] / 2
    parts = []
    parts.append(cyl('lp0', 0.16, dz, dz + 0.30, (0, 0), 14, C['metal']))
    parts.append(cyl('lp1', 0.10, dz + 0.30, dz + 3.85, (0, 0), 14, C['metal']))
    parts.append(cyl('lp2', 0.13, dz + 3.85, dz + 4.05, (0, 0), 14, C['metal']))
    for k in range(8):
        ang = k * TAU / 8
        bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=0.20, radius2=0.02, depth=0.60,
                                        location=(math.cos(ang) * 0.26, math.sin(ang) * 0.26,
                                                  dz + 4.05))
        o = bpy.context.object
        o.rotation_euler = (math.radians(120), 0, ang)
        o.data.materials.append(C['metal'])
        parts.append(o)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=10, radius=0.19,
                                         location=(0, 0, dz + 4.30))
    e = bpy.context.object
    e.data.materials.append(C['lamp'])
    parts.append(e)

    lamp = join_objs(parts, 'Zhanqiao_LotusLamp')
    n = P['lamp_n']
    y0, y1 = P['head_y1'] + 4.0, P['yin_y1'] - 6.0
    for i in range(n):
        y = y0 + (y1 - y0) * i / (n - 1)
        for side in (-1, 1):
            clone(lamp, (side * (hw - 0.85), y, 0), name=f'Lamp_{i}_{side}', coll=coll)
    bpy.data.objects.remove(lamp, do_unlink=True)


def build_breakwater():
    """“个”字形半圆防波堤：花岗岩砌筑，北面留口"""
    coll = get_coll(COLL_NAME)
    a0, a1 = P['bw_a0'], P['bw_a1']
    n = 120
    prof = [(P['bw_in'], P['sea'] - 0.4),
            (P['bw_top_in'], P['bw_top_z']),
            (P['bw_top_out'], P['bw_top_z']),
            (P['bw_out'], P['sea'] - 0.4)]
    m = len(prof)
    verts, faces = [], []
    for i in range(n + 1):
        a = a0 + (a1 - a0) * i / n
        ca, sa = math.cos(a), math.sin(a)
        verts.extend([(r * ca, r * sa, z) for r, z in prof])
    for i in range(n):
        a, b = i * m, (i + 1) * m
        for k in range(m - 1):
            faces.append((a + k, a + k + 1, b + k + 1, b + k))
    faces.append(tuple(range(m - 1, -1, -1)))
    o = n * m
    faces.append(tuple(range(o, o + m)))
    new_obj('Zhanqiao_Breakwater', verts, faces, C['rock'], coll=coll)

    prof2 = [(P['bw_top_in'], P['bw_top_z']),
             (P['bw_top_in'], P['bw_top_z'] + 0.22),
             (P['bw_top_out'], P['bw_top_z'] + 0.22),
             (P['bw_top_out'], P['bw_top_z'])]
    verts, faces = [], []
    for i in range(n + 1):
        a = a0 + (a1 - a0) * i / n
        ca, sa = math.cos(a), math.sin(a)
        verts.extend([(r * ca, r * sa, z) for r, z in prof2])
    for i in range(n):
        a, b = i * m, (i + 1) * m
        for k in range(m):
            k2 = (k + 1) % m
            faces.append((a + k, a + k2, b + k2, b + k))
    new_obj('Zhanqiao_BreakwaterCoping', verts, faces, C['stone_dark'], coll=coll)


# ============================== 主流程 ==============================

def main():
    clear_scene()
    global C
    C['stone'] = make_mat('Stone_Granite', (0.56, 0.55, 0.52), rough=0.85)
    C['stone_dark'] = make_mat('Stone_Dark', (0.38, 0.37, 0.36), rough=0.9)
    C['concrete'] = make_mat('Concrete', (0.66, 0.65, 0.62), rough=0.9)
    C['rock'] = make_mat('Rock_Embankment', (0.42, 0.40, 0.37), rough=0.95)
    C['red'] = make_mat('Lacquer_Red', (0.52, 0.07, 0.05), rough=0.45)
    C['red_dark'] = make_mat('Lacquer_Red_Dark', (0.28, 0.04, 0.03), rough=0.55)
    C['wood'] = make_mat('Window_Wood', (0.72, 0.62, 0.45), rough=0.6)
    C['tile_yellow'] = make_mat('Glazed_Tile_Yellow', (0.86, 0.66, 0.12), rough=0.22)
    C['metal'] = make_mat('Iron_Chain', (0.14, 0.14, 0.15), rough=0.45, metal=0.85)
    C['gold'] = make_mat('Plaque_Gold', (0.78, 0.62, 0.22), rough=0.35, metal=0.6)
    C['lamp'] = make_mat('Lamp_Glow', (1.0, 0.92, 0.72), rough=0.3,
                         emit=(1.0, 0.88, 0.62), emit_str=3.0)

    get_coll(COLL_NAME)
    build_pavilion()
    build_bridge()
    build_railing()
    build_lamps()
    build_breakwater()

    emp = bpy.data.objects.new('ORIGIN_HuilanGe_Center', None)
    emp.empty_display_type = 'PLAIN_AXES'
    emp.empty_display_size = 2.0
    emp.location = (0, 0, 0)
    get_coll(COLL_NAME).objects.link(emp)

    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.unit_settings.scale_length = 1.0
    sc.unit_settings.length_unit = 'METERS'

    out = bpy.path.abspath('//zhanqiao/zhanqiao.blend')
    bpy.ops.wm.save_as_mainfile(filepath=out)

    faces = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
    print('=== BUILD DONE ===')
    print('objects:', len(bpy.data.objects), ' faces:', faces)
    print('saved:', out)


main()
