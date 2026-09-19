# Blender headless: 程序化建模超跑 + 轿车，导出 GLB
# 坐标约定：脚本内统一用「游戏坐标」(x右, y上, z车头前)，写出时转 Blender(x, -z, y)
import bpy, math, sys, os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets')
os.makedirs(OUT, exist_ok=True)

# ---------- 清空场景 ----------
bpy.ops.wm.read_factory_settings(use_empty=True)

def C(x, y, z):
    """游戏坐标 -> Blender 坐标"""
    return (x, -z, y)

# ---------- 材质 ----------
def S(r, g, b):
    """sRGB 0-255 -> 线性 0-1（Blender 色槽/导出因子均为线性）"""
    return ((r/255)**2.2, (g/255)**2.2, (b/255)**2.2)

def mat(name, color, metallic=0.0, rough=0.5, coat=0.0, emit=None, estr=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = rough
    ci = bsdf.inputs.get('Coat Weight') or bsdf.inputs.get('Clearcoat')
    if ci: ci.default_value = coat
    if emit is not None:
        ei = bsdf.inputs.get('Emission Color') or bsdf.inputs.get('Emission')
        if ei: ei.default_value = (*emit, 1)
        es = bsdf.inputs.get('Emission Strength')
        if es: es.default_value = estr
    return m

MATS = {
    'Paint':    mat('Paint',    S(196, 30, 22),  metallic=0.15, rough=0.28, coat=0.8),
    'Glass':    mat('Glass',    S(8, 13, 20),    metallic=0.1, rough=0.05),
    'Trim':     mat('Trim',     S(6, 7, 9),      metallic=0.3, rough=0.6),
    'Chrome':   mat('Chrome',   S(225, 230, 236), metallic=1.0, rough=0.15),
    'Tire':     mat('Tire',     S(22, 22, 23),   rough=0.95),
    'Rim':      mat('Rim',      S(200, 206, 214), metallic=0.95, rough=0.22),
    'Disc':     mat('Disc',     S(115, 120, 127), metallic=0.8, rough=0.4),
    'Caliper':  mat('Caliper',  S(200, 24, 16),  rough=0.35),
    'Head':     mat('Head',     S(14, 16, 20),   rough=0.2, emit=S(207, 230, 255), estr=6),
    'Tail':     mat('Tail',     S(30, 4, 4),     rough=0.2, emit=S(255, 40, 26), estr=5),
    'Plate':    mat('Plate',    S(232, 235, 240), rough=0.5),
    'SedanPaint': mat('SedanPaint', S(70, 108, 168), metallic=0.3, rough=0.35, coat=0.6),
}

def assign(obj, m):
    obj.data.materials.append(m)

# ---------- 平滑法线（版本安全） ----------
def smooth_mesh(me, verts, faces):
    # 手动面积加权顶点法线，避免依赖各版本 shade_smooth 行为
    ns = [[0.0, 0.0, 0.0] for _ in verts]
    for f in faces:
        if len(f) < 3: continue
        a, b, c = [verts[f[i]] for i in range(3)]
        u = (b[0]-a[0], b[1]-a[1], b[2]-a[2])
        v = (c[0]-a[0], c[1]-a[1], c[2]-a[2])
        n = (u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0])
        for vi in f:
            ns[vi][0]+=n[0]; ns[vi][1]+=n[1]; ns[vi][2]+=n[2]
    flat = []
    for n in ns:
        l = math.sqrt(n[0]**2+n[1]**2+n[2]**2) or 1.0
        flat.append((n[0]/l, n[1]/l, n[2]/l))
    try:
        me.normals_split_custom_set_from_vertices(flat)
    except Exception:
        for p in me.polygons:
            p.use_smooth = True

# ---------- 放样 ----------
def loft(name, sections, matl, radial=20, top_exp=0.9, bot_sq=0.45, parent=None):
    # sections: [(z, w, yb, yt)] 游戏坐标
    verts, faces = [], []
    n = len(sections)
    for (z, w, yb, yt) in sections:
        ym = (yt+yb)/2; ry = (yt-yb)/2
        for k in range(radial):
            th = k/radial*math.tau
            c, s = math.cos(th), math.sin(th)
            px = w * (1 if c >= 0 else -1) * abs(c)**0.72
            py = ym + ry*(s**top_exp if s >= 0 else bot_sq*s)
            verts.append(C(px, py, z))
    for i in range(n-1):
        for k in range(radial):
            a = i*radial+k; b = i*radial+(k+1) % radial
            c2 = (i+1)*radial+k; d = (i+1)*radial+(k+1) % radial
            faces.append((a, c2, b)); faces.append((b, c2, d))
    # 端盖
    for ring, flip in ((0, True), (n-1, False)):
        z = sections[ring][0]
        yb, yt = sections[ring][2], sections[ring][3]
        ci = len(verts)
        verts.append(C(0, (yt+yb)/2, z))
        for k in range(radial):
            a = ring*radial+k; b = ring*radial+(k+1) % radial
            faces.append((ci, b, a) if flip else (ci, a, b))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces); me.update()
    smooth_mesh(me, verts, faces)
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    assign(obj, matl)
    if parent: obj.parent = parent
    return obj

# ---------- 盒体（带小圆角） ----------
def box(name, dims, loc, matl, rot=(0,0,0), bevel=0.015, parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=C(*loc), rotation=rot_bl(rot))
    o = bpy.context.active_object
    o.name = name
    o.scale = (dims[0], dims[2], dims[1])   # 游戏 dims (x宽,y高,z长) -> blender (x, z长, y高)
    bpy.ops.object.transform_apply(scale=True)
    if bevel > 0:
        be = o.modifiers.new('bev', 'BEVEL'); be.width = bevel; be.segments = 2
        bpy.context.view_layer.objects.active = o
        try: bpy.ops.object.modifier_apply(modifier='bev')
        except Exception: pass
    assign(o, matl)
    if parent: o.parent = parent
    return o

def rot_bl(rot):
    # 游戏空间欧拉角近似转换（仅用于小角度装饰件）
    return (rot[0], -rot[2], rot[1])

def cyl(name, r, depth, loc, matl, axis='x', parent=None, verts=16):
    # axis='x' 表示沿游戏 X 轴（车轮轴）
    rot = (0, math.pi/2, 0) if axis == 'x' else (math.pi/2, 0, 0) if axis == 'z' else (0,0,0)
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=C(*loc), rotation=rot)
    o = bpy.context.active_object; o.name = name
    assign(o, matl)
    if parent: o.parent = parent
    return o

def torus(name, major, minor, loc, matl, parent=None):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor,
        major_segments=24, minor_segments=10, location=C(*loc), rotation=(0, math.pi/2, 0))
    o = bpy.context.active_object; o.name = name
    assign(o, matl)
    if parent: o.parent = parent
    return o

def empty(name, loc, parent=None):
    o = bpy.data.objects.new(name, None)
    o.location = C(*loc)
    bpy.context.collection.objects.link(o)
    if parent: o.parent = parent
    return o

# ============================================================
#  超级跑车
# ============================================================
root = empty('Supercar', (0,0,0))

body = loft('Body', [
    ( 2.32, 0.52, 0.20, 0.44),
    ( 2.16, 0.72, 0.10, 0.52),
    ( 1.90, 0.85, 0.09, 0.56),
    ( 1.55, 0.97, 0.09, 0.63),   # 前轮拱加宽
    ( 1.10, 0.94, 0.10, 0.70),
    ( 0.55, 0.95, 0.10, 0.73),
    (-0.10, 0.96, 0.10, 0.74),
    (-0.80, 0.98, 0.10, 0.78),   # 引擎甲板抬高
    (-1.40, 1.01, 0.11, 0.74),   # 后轮拱外扩
    (-1.90, 0.94, 0.15, 0.70),
    (-2.22, 0.80, 0.26, 0.63),
], MATS['Paint'], radial=22, parent=root)

loft('Glass', [
    ( 1.02, 0.66, 0.60, 0.66),
    ( 0.72, 0.74, 0.66, 0.93),
    ( 0.28, 0.77, 0.68, 1.02),
    (-0.28, 0.76, 0.68, 1.03),
    (-0.86, 0.72, 0.70, 0.95),
    (-1.34, 0.62, 0.72, 0.79),
], MATS['Glass'], radial=16, top_exp=0.8, parent=root)

# 空力 & 装饰
box('Splitter', (1.56, 0.05, 0.30), (0, 0.09, 2.22), MATS['Trim'], parent=root)
box('Grille',   (0.92, 0.13, 0.06), (0, 0.27, 2.30), MATS['Trim'], parent=root)
box('SkirtR',   (0.10, 0.09, 2.55), ( 0.95, 0.12, -0.12), MATS['Trim'], parent=root)
box('SkirtL',   (0.10, 0.09, 2.55), (-0.95, 0.12, -0.12), MATS['Trim'], parent=root)
box('Diffuser', (1.34, 0.15, 0.32), (0, 0.21, -2.14), MATS['Trim'], parent=root)
for i in (-1.5, -0.5, 0.5, 1.5):
    box('Fin', (0.025, 0.13, 0.30), (i*0.3, 0.20, -2.16), MATS['Trim'], bevel=0, parent=root)
box('Wing',   (1.48, 0.035, 0.30), (0, 1.02, -2.02), MATS['Paint'], rot=(0.12,0,0), parent=root)
box('WingPR', (0.06, 0.26, 0.16), ( 0.44, 0.87, -1.99), MATS['Trim'], parent=root)
box('WingPL', (0.06, 0.26, 0.16), (-0.44, 0.87, -1.99), MATS['Trim'], parent=root)
box('MirBaseR',(0.05,0.04,0.14), ( 0.97, 0.80, 0.66), MATS['Trim'], parent=root)
box('MirBaseL',(0.05,0.04,0.14), (-0.97, 0.80, 0.66), MATS['Trim'], parent=root)
box('MirrorR',(0.16, 0.09, 0.07), ( 1.04, 0.83, 0.62), MATS['Paint'], parent=root)
box('MirrorL',(0.16, 0.09, 0.07), (-1.04, 0.83, 0.62), MATS['Paint'], parent=root)
# 灯
box('HeadR', (0.36, 0.08, 0.22), ( 0.52, 0.55, 2.06), MATS['Head'], rot=(0,-0.25,-0.2), parent=root)
box('HeadL', (0.36, 0.08, 0.22), (-0.52, 0.55, 2.06), MATS['Head'], rot=(0,0.25,-0.2), parent=root)
box('DRL_R', (0.30, 0.03, 0.05), ( 0.55, 0.44, 2.24), MATS['Head'], parent=root)
box('DRL_L', (0.30, 0.03, 0.05), (-0.55, 0.44, 2.24), MATS['Head'], parent=root)
box('TailBar',(1.38, 0.06, 0.05), (0, 0.60, -2.26), MATS['Tail'], parent=root)
# 排气
cyl('ExhaustR', 0.05, 0.18, ( 0.30, 0.30, -2.26), MATS['Chrome'], axis='z', parent=root)
cyl('ExhaustL', 0.05, 0.18, (-0.30, 0.30, -2.26), MATS['Chrome'], axis='z', parent=root)
box('Plate', (0.34, 0.11, 0.02), (0, 0.42, -2.27), MATS['Plate'], parent=root)
box('Floor', (1.62, 0.07, 4.10), (0, 0.075, 0), MATS['Trim'], bevel=0, parent=root)

# 车轮：pivot(转向) -> spin(滚动) -> 胎/毂/辐条/盘；卡钳静止
def wheel(tag, x, z):
    piv = empty('Wheel'+tag, (x, 0.335, z), root)
    spin = empty('Spin'+tag, (0,0,0), piv)
    torus('Tire'+tag, 0.24, 0.098, (0,0,0), MATS['Tire'], spin)
    cyl('Rim'+tag, 0.205, 0.20, (0,0,0), MATS['Rim'], axis='x', parent=spin, verts=20)
    for i in range(5):
        sp = box('Spoke'+tag, (0.23, 0.38, 0.06), (0,0,0), MATS['Trim'], bevel=0.01, parent=spin)
        # 辐条绕轮轴（游戏X/BlenderX）旋转
        sp.rotation_euler = (i/5*math.tau, 0, 0)
    cyl('Disc'+tag, 0.155, 0.09, (0,0,0), MATS['Disc'], axis='x', parent=spin, verts=18)
    cal = box('Caliper'+tag, (0.07, 0.14, 0.10), (0, 0.06, 0.10), MATS['Caliper'], parent=piv)
    return piv

wheel('FL',  0.80,  1.45); wheel('FR', -0.80,  1.45)
wheel('RL',  0.80, -1.45); wheel('RR', -0.80, -1.45)

# ============================================================
#  交通轿车
# ============================================================
sroot = empty('Sedan', (0,0,0))
loft('SedanBody', [
    ( 2.05, 0.72, 0.22, 0.55),
    ( 1.60, 0.84, 0.14, 0.68),
    ( 0.60, 0.88, 0.13, 0.80),
    (-0.60, 0.88, 0.13, 0.80),
    (-1.70, 0.84, 0.16, 0.72),
    (-2.10, 0.72, 0.26, 0.62),
], MATS['SedanPaint'], radial=12, parent=sroot)
loft('SedanGlass', [
    ( 0.85, 0.62, 0.72, 0.78),
    ( 0.30, 0.70, 0.78, 1.10),
    (-0.55, 0.70, 0.78, 1.10),
    (-1.15, 0.60, 0.74, 0.82),
], MATS['Glass'], radial=12, top_exp=0.8, parent=sroot)
for sx in (0.5, -0.5):
    box('SHead', (0.30, 0.08, 0.06), (sx, 0.55, 2.06), MATS['Head'], parent=sroot)
    box('STail', (0.32, 0.08, 0.05), (sx, 0.58, -2.12), MATS['Tail'], parent=sroot)
for i, (x, z) in enumerate(((0.78,1.3),(-0.78,1.3),(0.78,-1.35),(-0.78,-1.35))):
    cyl('SWheel%d'%i, 0.32, 0.22, (x, 0.32, z), MATS['Tire'], axis='x', parent=sroot, verts=14)

# ============================================================
#  导出（Blender Z-up -> glTF Y-up 由导出器自动转换）
# ============================================================
def export_sel(rootlist, path):
    bpy.ops.object.select_all(action='DESELECT')
    def sel(o):
        o.select_set(True)
        for ch in o.children: sel(ch)
    for r in rootlist: sel(r)
    kw = dict(filepath=path, export_format='GLB', export_apply=True,
              export_yup=True, export_animations=False, export_skins=False,
              export_morph=False, export_cameras=False, export_lights=False)
    try:
        bpy.ops.export_scene.gltf(use_selection=True, **kw)
    except TypeError:
        bpy.ops.export_scene.gltf(**kw)
    print('EXPORTED', path)

export_sel([root], os.path.join(OUT, 'car.glb'))
export_sel([sroot], os.path.join(OUT, 'sedan.glb'))
print('DONE')
