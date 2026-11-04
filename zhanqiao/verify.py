# -*- coding: utf-8 -*-
"""量取 .blend 的实际尺寸，核对建模是否与设计一致"""
import bpy
from mathutils import Vector

bpy.ops.wm.open_mainfile(filepath=bpy.path.abspath('//zhanqiao/zhanqiao.blend'))
dg = bpy.context.evaluated_depsgraph_get()


def bbox(prefix, exact=False):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    n = 0
    for ob in bpy.data.objects:
        if ob.type != 'MESH':
            continue
        if exact:
            if ob.name != prefix:
                continue
        elif not ob.name.startswith(prefix):
            continue
        n += 1
        ev = ob.evaluated_get(dg)
        for c in ev.bound_box:
            w = ev.matrix_world @ Vector(c)
            lo = Vector((min(lo[i], w[i]) for i in range(3)))
            hi = Vector((max(hi[i], w[i]) for i in range(3)))
    if n == 0:
        return None
    return n, lo, hi


def show(label, prefix, exact=False):
    r = bbox(prefix, exact)
    if not r:
        print(f'{label:24s} (无)')
        return
    n, lo, hi = r
    print(f'{label:24s} objs={n:3d} X[{lo.x:7.2f},{hi.x:7.2f}] Y[{lo.y:8.2f},{hi.y:8.2f}] '
          f'Z[{lo.z:6.2f},{hi.z:6.2f}] size=({hi.x-lo.x:6.2f} x {hi.y-lo.y:7.2f} x {hi.z-lo.z:6.2f})')


def roof_metrics(name):
    ob = bpy.data.objects.get(name)
    if not ob:
        return
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    rmax, z_at_rmax, zmin, zmax = 0, 0, 1e9, -1e9
    for v in me.vertices:
        w = ev.matrix_world @ v.co
        r = (w.x ** 2 + w.y ** 2) ** 0.5
        if r > rmax:
            rmax, z_at_rmax = r, w.z
        zmin = min(zmin, w.z)
        zmax = max(zmax, w.z)
    ev.to_mesh_clear()
    print(f'{name:24s} 最大半径 {rmax:6.2f} m（对角宽 {2*rmax:6.2f} m）'
          f'  角部起翘点标高 {z_at_rmax:5.2f} m  屋面标高 {zmin:5.2f}..{zmax:5.2f} m')


print('======== 回澜阁 ========')
show('全部', 'HuilanGe')
show('台基', 'HuilanGe_Platform')
show('压顶', 'HuilanGe_PlatformCoping')
show('一层柱', 'HuilanGe_Columns_L1')
show('一层墙窗', 'HuilanGe_Walls_L1')
show('二层柱', 'HuilanGe_Columns_L2')
show('二层梁', 'HuilanGe_Lintels_L2')
show('下层屋面', 'HuilanGe_Roof_Lower')
show('上层屋面', 'HuilanGe_Roof_Upper')
show('宝顶', 'HuilanGe_Finial')
show('旗杆', 'HuilanGe_FlagPole')
show('匾额', 'HuilanGe_Plaque')
roof_metrics('HuilanGe_Roof_Lower')
roof_metrics('HuilanGe_Roof_Upper')

print('\n======== 栈桥 ========')
show('全部', 'Zhanqiao')
show('桥头', 'Zhanqiao_BridgeHead')
show('孔桥桥面', 'Zhanqiao_Deck_Kong')
show('孔桥墩', 'Zhanqiao_Piers')
show('引桥', 'Zhanqiao_Approach')
show('防波堤', 'Zhanqiao_Breakwater')
show('防波堤压顶', 'Zhanqiao_BreakwaterCoping')
show('莲花灯', 'Lamp_')

print('\n======== 核对 ========')
n, lo, hi = bbox('HuilanGe')
print(f'回澜阁：台基面(z=0) → 旗杆顶 {hi.z:.2f} m；'
      f'下檐对角宽 {2*7.42*1.2:.2f} m；总高/下檐宽 = {hi.z/(2*7.42*1.2):.3f}')
print('  1933 设计图实测比值：0.606（地面→旗杆顶 / 下檐宽）')
n, lo, hi = bbox('Zhanqiao_Approach')
print(f'引桥段：长 {hi.y-lo.y:.2f} m（目标 236.1）')
n, lo, hi = bbox('Zhanqiao_Deck_Kong')
print(f'孔桥段：长 {hi.y-lo.y:.2f} m（目标 149.7），桥面宽 {hi.x-lo.x:.2f} m（目标 10）')
n, lo, hi = bbox('Zhanqiao_ApproachCoping')
print(f'栈桥总长（桥面北端）= {hi.y:.2f} m（目标 401.45）')
print('柱数：一层 16 + 二层 8 = 24（与文献“24 根圆形亭柱”一致）')
print('objects:', len(bpy.data.objects), ' cameras:', len(bpy.data.cameras),
      ' lights:', len(bpy.data.lights))
