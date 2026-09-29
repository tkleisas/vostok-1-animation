"""Generate a Vostok-era cosmonaut with MakeHuman (MPFB), dress it in an
SK-1-style orange suit with a white helmet, export to GLB.

The figure is used at pad scale (1 unit = 1 m), so silhouette and colours
matter more than fine detail: orange pressure suit, white helmet with a
smoked visor, life-support backpack. Face skin is kept through the visor.
"""
import bpy, math

OUT = '/tmp/gagarin.glb'

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.preferences.addon_enable(module='bl_ext.blender_org.mpfb')

from bl_ext.blender_org.mpfb.services.humanservice import HumanService
from bl_ext.blender_org.mpfb.services.targetservice import TargetService

# --- base human: male, 27 years old, short and wiry (Gagarin was 1.57 m) --
macro = TargetService.get_default_macro_info_dict()
macro['gender'] = 1.0        # male (keys are lowercase - see MPFB docs)
macro['cupsize'] = 0.0
macro['age'] = 0.25          # 27 years old
macro['height'] = 0.47       # Gagarin was short, ~1.57 m
macro['muscle'] = 0.55
macro['weight'] = 0.50

human = HumanService.create_human(feet_on_ground=True, scale=0.1,
                                  macro_detail_dict=macro)
# take the EVALUATED mesh: macro phenotype (shape keys) AND the helper mask
# baked in one step - clearing shape keys instead would silently revert the
# body to the default phenotype, and an unapplied mask exports the helper
# geometry as a robe over the legs
dg = bpy.context.evaluated_depsgraph_get()
eval_mesh = bpy.data.meshes.new_from_object(human.evaluated_get(dg))
baked = bpy.data.objects.new('Human', eval_mesh)
baked.matrix_world = human.matrix_world
bpy.context.scene.collection.objects.link(baked)
bpy.data.objects.remove(human, do_unlink=True)
human = baked
bpy.context.view_layer.update()

H = human.dimensions.z
print('HUMAN height:', round(H, 3), 'verts:', len(human.data.vertices))

# --- materials ------------------------------------------------------------
def mkmat(name, rgb, metal=0.0, rough=0.7, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    b.inputs['Alpha'].default_value = alpha
    if alpha < 1.0:
        m.surface_render_method = 'DITHERED'
    return m

suitMat   = mkmat('Suit_Orange', (0.88, 0.28, 0.05), 0.0, 0.85)
skinMat   = mkmat('Skin',        (0.72, 0.52, 0.40), 0.0, 0.55)
helmetMat = mkmat('Helmet',      (0.92, 0.92, 0.90), 0.15, 0.35)
visorMat  = mkmat('Visor',       (0.02, 0.03, 0.05), 0.1, 0.3, alpha=0.62)
gearMat   = mkmat('Gear',        (0.45, 0.46, 0.48), 0.5, 0.5)

# --- suit: orange everywhere except the head ------------------------------
me = human.data
me.materials.clear()
me.materials.append(suitMat)     # index 0
me.materials.append(skinMat)     # index 1
neckZ = H * 0.855
for p in me.polygons:
    p.material_index = 1 if p.center.z > neckZ else 0

made = [human]

def uv_sphere(name, loc, r, material, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=28, ring_count=20)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(material)
    for p in o.data.polygons:
        p.use_smooth = True
    made.append(o)
    return o

def box(name, loc, scale, material):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(material)
    made.append(o)
    return o

# --- helmet: shell + smoked visor + neck ring -----------------------------
# the human faces -Y; head centre sits ~0.885 H
headZ = H * 0.905
uv_sphere('Helmet',  (0, -0.010, headZ), 0.158, helmetMat, scale=(1, 1, 1.12))
uv_sphere('Visor',   (0, -0.085, headZ - 0.02), 0.150, visorMat, scale=(1, 0.72, 0.92))
bpy.ops.mesh.primitive_torus_add(major_radius=0.115, minor_radius=0.028,
                                 major_segments=28, minor_segments=10,
                                 location=(0, 0, headZ - 0.150))
ring = bpy.context.active_object
ring.name = 'NeckRing'
ring.data.materials.append(gearMat)
made.append(ring)

# --- life-support backpack + chest pack -----------------------------------
box('Backpack', (0, 0.155, H * 0.62), (0.16, 0.09, 0.23), gearMat)
box('Chestpack', (0, -0.135, H * 0.66), (0.12, 0.06, 0.14), gearMat)

# --- boots: calf-high leather boots over the suit ------------------------
bootMat = mkmat('Boots', (0.10, 0.09, 0.08), 0.1, 0.55)

def lathe(name, profile, seg, material, loc=(0, 0, 0)):
    verts, faces, idx = [], [], []
    for (r, z) in profile:
        if r == 0:
            idx.append([len(verts)]); verts.append((0, 0, z))
        else:
            idx.append(list(range(len(verts), len(verts) + seg)))
            for i in range(seg):
                a = 2 * math.pi * i / seg
                verts.append((r * math.cos(a), r * math.sin(a), z))
    for k in range(len(profile) - 1):
        A, B = idx[k], idx[k + 1]
        if len(A) == 1 and len(B) == 1: continue
        if len(A) == 1:
            for i in range(seg): faces.append((A[0], B[(i + 1) % seg], B[i]))
        elif len(B) == 1:
            for i in range(seg): faces.append((A[i], A[(i + 1) % seg], B[0]))
        else:
            for i in range(seg):
                ni = (i + 1) % seg
                faces.append((A[i], A[ni], B[ni], B[i]))
    m = bpy.data.meshes.new(name)
    m.from_pydata(verts, [], faces)
    m.materials.append(material)
    for p in m.polygons: p.use_smooth = True
    o = bpy.data.objects.new(name, m)
    o.location = loc
    bpy.context.scene.collection.objects.link(o)
    made.append(o)
    return o

def make_boots():
    """Boots from the body's own foot geometry: duplicate the foot vertices,
    inflate them around the measured ankle centre, add a calf shaft. Fits by
    construction instead of by guessed offsets."""
    import mathutils
    vs = human.data.vertices
    for sx in (-1, 1):
        ankle = [v.co for v in vs if 0.13 < v.co.z < 0.22 and (v.co.x < 0) == (sx < 0)]
        if not ankle:
            continue
        c = mathutils.Vector((0, 0, 0))
        for v in ankle:
            c += v
        c /= len(ankle)
        foot = [v.co.copy() for v in vs if v.co.z < 0.145 and (v.co.x < 0) == (sx < 0)]
        c2 = mathutils.Vector((0, 0, 0))
        for v in foot:
            c2 += v
        c2 /= len(foot)
        verts, faces = [], []
        for v in foot:
            d = v - c2
            verts.append((c2.x + d.x * 1.50, c2.y + d.y * 1.40, max(-0.005, c2.z + d.z * 1.30)))
        # a simple convex hull-ish rebuild is overkill: reuse the foot's own
        # polygons restricted to the foot vertex set
        old_index = {i: n for n, i in enumerate(
            i for i, v in enumerate(vs) if v.co.z < 0.145 and (v.co.x < 0) == (sx < 0))}
        for p in human.data.polygons:
            if all(vi in old_index for vi in p.vertices):
                faces.append(tuple(old_index[vi] for vi in p.vertices))
        m = bpy.data.meshes.new('BootFoot')
        m.from_pydata(verts, [], faces)
        m.materials.append(bootMat)
        for p in m.polygons:
            p.use_smooth = True
        o = bpy.data.objects.new('BootFoot', m)
        bpy.context.scene.collection.objects.link(o)
        made.append(o)
        shaft_profile = [(0.060, 0.0), (0.075, 0.06), (0.078, 0.16),
                         (0.072, 0.26), (0.0, 0.29)]
        lathe('BootShaft', shaft_profile, 20, bootMat, loc=(c.x, c.y, 0.02))

make_boots()

# --- join everything into one figure --------------------------------------
bpy.ops.object.select_all(action='DESELECT')
for o in made:
    o.select_set(True)
bpy.context.view_layer.objects.active = human
bpy.ops.object.join()
fig = bpy.context.active_object
fig.name = 'Cosmonaut'
print('FIGURE verts:', len(fig.data.vertices))

bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB')
print('EXPORTED', OUT)
