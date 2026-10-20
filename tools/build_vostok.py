"""Build an accurate Vostok 8K72K (Vostok-K) launch vehicle + 3KA spacecraft.

Everything is generated procedurally, in metres, with the rocket standing on
the origin and its base at z = 0.  The exported GLB is Y-up (glTF convention)
and keeps the part names used by launch.js / main.js:

    Core_Stage1        Block A core (RD-108, four chambers + four verniers)
    Booster_1..4       Blocks B,V,G,D strap-ons (RD-107)
    Fin_1..4           stabilisers on the strap-ons
    Lattice_Frame      open interstage truss between Block A and Block E
    BlockE_Stage3      Block E third stage (RD-0109)
    Payload_Fairing_L  left half of the two-petal payload shroud
    Payload_Fairing_R  right half
    Vostok_Capsule     empty parent of the spacecraft
      Vostok_PA        instrument module (TDU-1, RCS, tanks, radiators)
      Vostok_SA        spherical descent module (heat shield, hatch, Vzor)

Dimensions follow the published 8K72K figures: 38.36 m overall, 10.3 m span
over the fins, 2.95 m core, 2.68 m strap-ons (19.8 m long), 2.7 m fairing,
and a 4.55 m / 2.3 m 3KA spacecraft (2.25 m PA + 2.30 m SA).  Masses are in
launch.js.

Run with:
    blender --background --factory-startup --python tools/build_vostok.py
"""
import bpy
import bmesh
import math
import os
from mathutils import Vector, Matrix

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BLEND = os.path.join(ROOT, 'assets', 'vostok-source.blend')
OUT = os.path.join(ROOT, 'assets', 'vostok-1.glb')
FONT_PATH = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
EMBLEM_PATH = os.path.join(ROOT, 'tools', 'emblem_source.png')
STAR_PATH = os.path.join(ROOT, 'tools', 'star_source.png')

TAU = 2 * math.pi

# --------------------------------------------------------------------------
#  scene reset
# --------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'

# --------------------------------------------------------------------------
#  materials
# --------------------------------------------------------------------------
def mat(name, rgb, metal=0.0, rough=0.5, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = False
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, alpha)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if alpha < 1.0:
        b.inputs['Alpha'].default_value = alpha
        m.surface_render_method = 'DITHERED'
    return m

WHITE  = mat('Hull_White',      (0.66, 0.67, 0.66), 0.02, 0.52)
WHITE2 = mat('Hull_White_B',    (0.61, 0.62, 0.62), 0.02, 0.56)
GREY   = mat('Hull_Grey',       (0.38, 0.40, 0.41), 0.25, 0.48)
DARK   = mat('Engine_Dark',     (0.075, 0.070, 0.065), 0.72, 0.36)
RED    = mat('Soviet_Red',      (0.55, 0.055, 0.045), 0.00, 0.50)
BLACK  = mat('Black_Mark',      (0.035, 0.035, 0.038), 0.10, 0.55)
METAL  = mat('Lattice_Metal',   (0.46, 0.48, 0.51), 0.92, 0.34)
CAP_HULL  = mat('Capsule_Hull', (0.50, 0.53, 0.56), 0.68, 0.34)
CAP_DARK  = mat('Capsule_Dark', (0.095, 0.09, 0.085), 0.35, 0.50)
CAP_GLASS = mat('Capsule_Glass',(0.025, 0.035, 0.045), 0.10, 0.10)
CAP_HEAT  = mat('Capsule_HeatShield', (0.17, 0.13, 0.10), 0.05, 0.82)
CAP_GOLD  = mat('Capsule_Foil', (0.52, 0.39, 0.14), 0.90, 0.28)
CAP_PANEL = mat('Capsule_Panel',(0.74, 0.73, 0.69), 0.10, 0.60)

# Hammer-and-sickle decal: the authentic public-domain source is kept in
# tools/emblem_source.png and mapped onto a thin curved sheet so it hugs the
# tank instead of clipping through it.
emblem_img = bpy.data.images.load(EMBLEM_PATH)
emblem_img.alpha_mode = 'STRAIGHT'
EMBLEM = bpy.data.materials.new('Emblem_Red')
EMBLEM.use_nodes = True
EMBLEM.use_backface_culling = False
eb = EMBLEM.node_tree.nodes['Principled BSDF']
et = EMBLEM.node_tree.nodes.new('ShaderNodeTexImage')
et.image = emblem_img
et.interpolation = 'Linear'
EMBLEM.node_tree.links.new(et.outputs['Color'], eb.inputs['Base Color'])
EMBLEM.node_tree.links.new(et.outputs['Alpha'], eb.inputs['Alpha'])
eb.inputs['Roughness'].default_value = 0.55
eb.inputs['Metallic'].default_value = 0.0
EMBLEM.surface_render_method = 'BLENDED'

# Red-star decal: same curved-decal treatment, so the star follows the tank
# instead of being a flat tangent plate whose corners lift off the surface.
star_img = bpy.data.images.load(STAR_PATH)
star_img.alpha_mode = 'STRAIGHT'
STAR = bpy.data.materials.new('Star_Red')
STAR.use_nodes = True
STAR.use_backface_culling = False
sb = STAR.node_tree.nodes['Principled BSDF']
st = STAR.node_tree.nodes.new('ShaderNodeTexImage')
st.image = star_img
st.interpolation = 'Linear'
STAR.node_tree.links.new(st.outputs['Color'], sb.inputs['Base Color'])
STAR.node_tree.links.new(st.outputs['Alpha'], sb.inputs['Alpha'])
sb.inputs['Roughness'].default_value = 0.55
sb.inputs['Metallic'].default_value = 0.0
STAR.surface_render_method = 'BLENDED'

FONT = bpy.data.fonts.load(FONT_PATH)


# --------------------------------------------------------------------------
#  low-level mesh helpers
# --------------------------------------------------------------------------
def mesh_object(name, verts, faces, material, smooth=False):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    me.update()
    if material is not None:
        me.materials.append(material)
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    # outward-facing normals; harmless for closed meshes, helpful for shells
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    return ob


def lathe(name, profile, seg, material, theta0=0.0, theta1=TAU, smooth=True,
          close_bottom=True, close_top=True):
    """Surface of revolution. profile = [(radius, z), ...] bottom -> top.

    A zero radius turns into a pole vertex. A full 2*pi sweep wraps the ring;
    a partial sweep leaves an open shell (used for the two fairing petals).
    """
    full = abs((theta1 - theta0) - TAU) < 1e-6
    n = seg if full else seg + 1
    rings = []
    verts = []
    for r, z in profile:
        if r < 1e-6:
            rings.append([len(verts)])
            verts.append((0.0, 0.0, z))
        else:
            ring = []
            for i in range(n):
                a = theta0 + (theta1 - theta0) * (i / seg)
                ring.append(len(verts))
                verts.append((r * math.cos(a), r * math.sin(a), z))
            rings.append(ring)

    faces = []
    for k in range(len(rings) - 1):
        A, B = rings[k], rings[k + 1]
        if len(A) == 1 and len(B) == 1:
            continue
        if len(A) == 1:
            for i in range(seg):
                ni = (i + 1) % n if full else i + 1
                faces.append((A[0], B[ni], B[i]))
        elif len(B) == 1:
            for i in range(seg):
                ni = (i + 1) % n if full else i + 1
                faces.append((A[i], A[ni], B[0]))
        else:
            for i in range(seg):
                ni = (i + 1) % n if full else i + 1
                faces.append((A[i], A[ni], B[ni], B[i]))

    # end caps (the body ends are hidden but keep the mesh watertight)
    if close_bottom and len(rings[0]) > 1:
        c = len(verts); verts.append((0.0, 0.0, profile[0][1]))
        for i in range(seg):
            ni = (i + 1) % n if full else i + 1
            faces.append((c, rings[0][ni], rings[0][i]))
    if close_top and len(rings[-1]) > 1:
        c = len(verts); verts.append((0.0, 0.0, profile[-1][1]))
        for i in range(seg):
            ni = (i + 1) % n if full else i + 1
            faces.append((c, rings[-1][i], rings[-1][ni]))

    return mesh_object(name, verts, faces, material, smooth)


def solidify(ob, thickness):
    m = ob.modifiers.new('shell', 'SOLIDIFY')
    m.thickness = thickness
    m.offset = 0.0
    m.use_rim = True
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.modifier_apply(modifier=m.name)
    ob.select_set(False)
    return ob


def join(objs, name, material=None):
    objs = [o for o in objs if o is not None]
    if not objs:
        return None
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.object
    ob.name = name
    if material is not None:
        ob.data.materials.clear()
        ob.data.materials.append(material)
    bpy.ops.object.select_all(action='DESELECT')
    return ob


def parent(child, par):
    child.parent = par
    child.matrix_parent_inverse = par.matrix_world.inverted()
    return child


def cylinder(name, r, depth, loc, material, verts=24, rot=(0, 0, 0), smooth=True):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth,
                                        location=loc, rotation=rot)
    ob = bpy.context.active_object
    ob.name = name
    if material:
        ob.data.materials.append(material)
    if smooth:
        for p in ob.data.polygons:
            p.use_smooth = True
    return ob


def cone(name, r1, r2, depth, loc, material, verts=24, rot=(0, 0, 0), smooth=True):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2,
                                    depth=depth, location=loc, rotation=rot)
    ob = bpy.context.active_object
    ob.name = name
    if material:
        ob.data.materials.append(material)
    if smooth:
        for p in ob.data.polygons:
            p.use_smooth = True
    return ob


def rod(name, p0, p1, r, material, sides=8):
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    L = d.length
    if L < 1e-6:
        return None
    ob = cylinder(name, r, L, (p0 + p1) * 0.5, material, verts=sides)
    ob.rotation_mode = 'QUATERNION'
    ob.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    return ob


def torus(name, major, minor, z, material, seg=32, mseg=6):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor,
                                     major_segments=seg, minor_segments=mseg,
                                     location=(0, 0, z))
    ob = bpy.context.active_object
    ob.name = name
    if material:
        ob.data.materials.append(material)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def box(name, size, loc, material, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if material:
        ob.data.materials.append(material)
    return ob


# --------------------------------------------------------------------------
#  decals (geometry, not textures: crisp at any distance, no atlas seams)
# --------------------------------------------------------------------------
def text_object(body, size, material, name='text'):
    cu = bpy.data.curves.new(name, 'FONT')
    cu.body = body
    cu.font = FONT
    cu.size = size
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    cu.extrude = 0.0035
    cu.bevel_depth = 0.0
    ob = bpy.data.objects.new(name, cu)
    scene.collection.objects.link(ob)
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.convert(target='MESH')
    ob = bpy.context.object
    ob.data.materials.append(material)
    bpy.ops.object.select_all(action='DESELECT')
    return ob


def place_on_cylinder(ob, theta, z, radius, tilt=0.0):
    """Put a flat decal on the outside of a cylinder, upright and readable."""
    n = Vector((math.cos(theta), math.sin(theta), 0.0))
    up = Vector((0.0, 0.0, 1.0))
    if abs(tilt) > 1e-9:
        n = Vector((math.cos(theta), math.sin(theta), math.tan(tilt))).normalized()
        up = (Vector((0, 0, 1)) - n * math.sin(tilt)).normalized()
    t = up.cross(n).normalized()
    up = n.cross(t).normalized()
    R = Matrix(((t.x, up.x, n.x),
                (t.y, up.y, n.y),
                (t.z, up.z, n.z))).to_4x4()
    pos = Vector((radius * math.cos(theta), radius * math.sin(theta), z))
    ob.matrix_world = Matrix.Translation(pos) @ R
    return ob


def vertical_text(text, theta, z_top, size, material, radius_fn, parent_obj,
                 spacing=1.04, tilt=0.0):
    """One character below another, as on the original 8K72K livery."""
    objs = []
    for i, ch in enumerate(text):
        if ch == ' ':
            continue
        ob = text_object(ch, size, material, name='mark_%s_%d' % (text, i))
        z = z_top - i * size * spacing
        place_on_cylinder(ob, theta, z, radius_fn(z) + 0.012, tilt=tilt)
        parent(ob, parent_obj)
        objs.append(ob)
    return objs


def curved_decal(name, theta, zc, width, height, radius, parent_obj=None,
                 material=None, nu=8, nv=8):
    """A texture-mapped sheet wrapped around a cylinder (emblem/star)."""
    verts, uvs, faces = [], [], []
    for j in range(nv + 1):
        v = j / nv
        z = zc - height / 2 + v * height
        for i in range(nu + 1):
            u = i / nu
            a = theta + (u - 0.5) * width / radius
            verts.append((radius * math.cos(a), radius * math.sin(a), z))
            uvs.append((u, v))
    for j in range(nv):
        for i in range(nu):
            k = j * (nu + 1) + i
            faces.append((k, k + 1, k + nu + 2, k + nu + 1))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    me.update()
    me.materials.append(material or EMBLEM)
    uv = me.uv_layers.new(name='UVMap')
    for li, loop in enumerate(me.loops):
        uv.data[li].uv = uvs[loop.vertex_index]
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    if parent_obj is not None:
        parent(ob, parent_obj)
    return ob


def star(name, outer, inner, material, theta, z, radius, parent_obj):
    """A red star painted onto the curved tank surface.

    The source star is an alpha texture, so its silhouette can follow the
    cylinder exactly; there is no flat plate to lift off at the corners.
    """
    size = outer / 0.48
    return curved_decal(name, theta, z, size, size, radius, parent_obj,
                        material=STAR, nu=14, nv=10)


# --------------------------------------------------------------------------
#  dimensions
# --------------------------------------------------------------------------
H_TOTAL = 38.36
CORE_R = 1.475          # 2.95 m Block A
BOOST_R = 1.34          # 2.68 m strap-on
BOOST_L = 19.8
BOOST_C = CORE_R + BOOST_R - 0.04   # centres; the mating faces are flattened
FAIR_R = 1.35
CORE_TOP = 27.80
TRUSS_TOP = 30.20
BLE_TOP = 32.84
PA_TOP = 35.09
SA_C = PA_TOP + 1.15    # sphere centre
SA_TOP = SA_C + 1.15
CAP_MID = (BLE_TOP + SA_TOP) * 0.5
FAIR_TIP = H_TOTAL

def fair_radius(z):
    # The real shroud is a long cylinder that clears the whole 3KA sphere,
    # closed by a short ogive nose.  A pure ogive from the base would cut
    # through the capsule.
    if z <= 37.10:
        return FAIR_R
    t = max(0.0, min(1.0, (z - 37.10) / (FAIR_TIP - 37.10)))
    return FAIR_R * (1.0 - t) ** 0.72

def core_radius(z):
    if z < 2.1:
        return 1.10 + (CORE_R - 1.10) * (z - 1.2) / 0.9
    if z > 26.2:
        return CORE_R + (1.26 - CORE_R) * (z - 26.2) / (CORE_TOP - 26.2)
    return CORE_R

def boost_radius(z):
    # lower cylinder -> long cone -> conical nose
    if z < 2.4:
        return BOOST_R
    if z < 15.4:
        return BOOST_R + (1.02 - BOOST_R) * ((z - 2.4) / 13.0)
    t = (z - 15.4) / (BOOST_L - 15.4)
    return 1.02 * (1.0 - t) ** 1.35


# ==========================================================================
#  1. CORE STAGE (Block A)
# ==========================================================================
core_profile = [
    (0.0, 1.05), (0.98, 1.05), (1.18, 1.20), (1.38, 1.55),
    (CORE_R, 2.10), (CORE_R, 26.20), (1.40, 27.00), (1.26, CORE_TOP),
    (0.0, CORE_TOP),
]
core = lathe('Core_Stage1', core_profile, 64, WHITE, smooth=True)
# bake the object's transform: the app moves the object node directly
core.location = (0, 0, 0)

# ---- RD-108: four main chambers + four verniers -------------------------
engines = []
for i in range(4):
    a = math.pi / 4 + i * math.pi / 2
    ex, ey = 0.80 * math.cos(a), 0.80 * math.sin(a)
    b = lathe('core_bell_%d' % i,
              [(0.10, 1.35), (0.15, 1.15), (0.22, 0.72), (0.31, 0.30), (0.36, 0.02)],
              24, DARK, smooth=True)
    b.location = (ex, ey, 0)
    engines.append(b)
    # turbopump / gimbal block above the chamber
    engines.append(cylinder('core_tp_%d' % i, 0.16, 0.36, (ex, ey, 1.58), DARK, 16))
for i in range(4):
    a = i * math.pi / 2 + math.pi / 4
    ex, ey = 1.26 * math.cos(a), 1.26 * math.sin(a)
    b = lathe('core_ver_%d' % i,
              [(0.055, 1.25), (0.085, 1.08), (0.12, 0.86), (0.15, 0.72)],
              16, DARK, smooth=True)
    b.location = (ex, ey, 0)
    engines.append(b)
engines = join(engines, 'Core_Engines', DARK)
parent(engines, core)

# ---- panel seams, raceway, hatches -------------------------------------
details = []
for z in [2.15, 6.0, 10.0, 14.0, 18.0, 22.0, 25.8, 26.9]:
    details.append(torus('core_seam_%d' % int(z * 10), core_radius(z) + 0.004, 0.007,
                         z, GREY, 64, 5))
# cable raceway down one side, with clamps
for i in range(18):
    z = 3.0 + i * 1.35
    details.append(box('core_clamp_%d' % i, (0.16, 0.10, 0.045),
                       (core_radius(z) * math.cos(0.35), core_radius(z) * math.sin(0.35), z),
                       GREY))
race = []
for i in range(20):
    z0 = 2.4 + i * 1.28
    z1 = z0 + 1.30
    r0, r1 = core_radius(z0) + 0.055, core_radius(z1) + 0.055
    race.append(rod('race_%d' % i, (r0 * math.cos(0.35), r0 * math.sin(0.35), z0),
                    (r1 * math.cos(0.35), r1 * math.sin(0.35), z1), 0.045, GREY, 6))
details += race
# a few service hatches
for z, a, r in [(4.0, 1.2, 0.22), (11.0, 2.5, 0.18), (19.0, 5.0, 0.25), (24.0, 3.8, 0.18)]:
    rr = core_radius(z) + 0.008
    c = cylinder('core_hatch_%d' % int(z), r, 0.03,
                 (rr * math.cos(a), rr * math.sin(a), z), GREY, 20,
                 rot=(0, math.pi / 2, a))
    details.append(c)
details = join(details, 'Core_Details', GREY)
parent(details, core)

# ---- livery: CCCP, ВОСТОК, red stars and the state emblem --------------
# Put the markings right around the core so at least one set faces every
# launch-camera angle.  These are large enough to read from the pad.
marks = []
for theta in (0.0, math.pi):
    marks += vertical_text('CCCP', theta, 26.4, 0.85, RED, core_radius, core, spacing=1.05)
for theta in (math.pi / 2, 3 * math.pi / 2):
    marks += vertical_text('ВОСТОК', theta, 25.4, 0.55, RED, core_radius, core, spacing=1.05)
marks = join(marks, 'Core_Markings', RED)
parent(marks, core)
stars = []
for theta in (math.pi / 4, 5 * math.pi / 4):
    stars.append(star('core_star_%d' % int(theta * 100), 0.90, 0.36, RED,
                      theta, 21.2, core_radius(21.2) + 0.03, core))
stars = join(stars, 'Core_Stars')
parent(stars, core)
emblems = []
for theta in (3 * math.pi / 4, 7 * math.pi / 4):
    emblems.append(curved_decal('core_emblem_%d' % int(theta * 100), theta,
                                22.8, 1.25, 1.25, core_radius(22.8) + 0.065, core))
emblems = join(emblems, 'Core_Emblems')
parent(emblems, core)


# ==========================================================================
#  2. STRAP-ON BOOSTERS + FINS
# ==========================================================================
def booster_profile():
    return [
        (0.0, 0.92), (0.94, 0.92), (1.16, 1.04), (BOOST_R, 1.55),
        (BOOST_R, 2.40), (1.24, 6.0), (1.14, 10.0), (1.06, 14.0),
        (1.02, 15.4), (0.93, 16.6), (0.78, 17.6), (0.55, 18.5),
        (0.30, 19.2), (0.10, 19.7), (0.0, BOOST_L),
    ]

boosters = []
for i in range(4):
    a = i * math.pi / 2
    cx, cy = BOOST_C * math.cos(a), BOOST_C * math.sin(a)
    body = lathe('Booster_%d' % (i + 1), booster_profile(), 48, WHITE, smooth=True)
    body.location = (cx, cy, 0)

    # RD-107: four main chambers + two verniers, all inside the skirt
    eng = []
    for j in range(4):
        aa = math.pi / 4 + j * math.pi / 2
        ex, ey = cx + 0.48 * math.cos(aa), cy + 0.48 * math.sin(aa)
        b = lathe('booster_bell_%d_%d' % (i, j),
                  [(0.085, 1.25), (0.12, 1.06), (0.18, 0.72), (0.25, 0.32), (0.29, 0.02)],
                  20, DARK, smooth=True)
        b.location = (ex, ey, 0)
        eng.append(b)
    for j in range(2):
        aa = a + math.pi / 2 * (1 if j == 0 else -1)
        ex, ey = cx + 0.92 * math.cos(aa), cy + 0.92 * math.sin(aa)
        b = lathe('booster_ver_%d_%d' % (i, j),
                  [(0.045, 1.10), (0.065, 0.94), (0.09, 0.72)],
                  12, DARK, smooth=True)
        b.location = (ex, ey, 0)
        eng.append(b)
    eng = join(eng, 'Booster_%d_Engines' % (i + 1), DARK)
    parent(eng, body)

    # tank seams + a small umbilical fairing on the inboard side
    det = []
    for z in [1.55, 2.4, 6.0, 10.0, 14.0, 15.4]:
        rr = boost_radius(z) + 0.003
        det.append(torus('boost_seam_%d_%d' % (i, int(z * 10)), rr, 0.006, z, GREY, 48, 5))
    # move the seam rings to the booster centre
    for o in det:
        o.location.x += cx
        o.location.y += cy
    # cable conduit on the inboard-facing side
    for z0 in [3.0, 7.0, 11.0]:
        rr = boost_radius(z0) + 0.05
        p0 = (cx + rr * math.cos(a + math.pi), cy + rr * math.sin(a + math.pi), z0)
        p1 = (cx + rr * math.cos(a + math.pi), cy + rr * math.sin(a + math.pi), z0 + 3.6)
        det.append(rod('boost_race_%d_%d' % (i, z0), p0, p1, 0.035, GREY, 6))
    det = join(det, 'Booster_%d_Details' % (i + 1), GREY)
    parent(det, body)

    # outboard livery: a large red star plus CCCP down the upper tank
    star('Booster_%d_Star' % (i + 1), 0.82, 0.33, RED, a,
         10.5, boost_radius(10.5) + 0.03 + BOOST_C, body)
    bmarks = []
    for k, ch in enumerate('CCCP'):
        z = 15.25 - k * 0.34 * 1.05
        ob = text_object(ch, 0.34, RED, name='boost_cccp_%d_%d' % (i, k))
        place_on_cylinder(ob, a, z, BOOST_C + boost_radius(z) + 0.015)
        parent(ob, body)
        bmarks.append(ob)
    bmarks = join(bmarks, 'Booster_%d_Markings' % (i + 1), RED)
    parent(bmarks, body)
    boosters.append(body)

    # ---- stabiliser fin, a flat swept wedge ---------------------------
    radial = Vector((math.cos(a), math.sin(a), 0))
    tangent = Vector((-math.sin(a), math.cos(a), 0))
    pts = [(3.25, 0.72), (5.15, 1.02), (5.15, 1.46), (3.25, 2.16)]
    verts = []
    for s in (-0.055, 0.055):
        for r, z in pts:
            v = radial * r + Vector((0, 0, z)) + tangent * s
            verts.append((v.x, v.y, v.z))
    faces = [(0, 1, 2, 3), (7, 6, 5, 4),
             (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    fin = mesh_object('Fin_%d' % (i + 1), verts, faces, WHITE, smooth=False)

# ==========================================================================
#  3. INTERTAGE TRUSS (open lattice between Block A and Block E)
# ==========================================================================
tr = []
for i in range(8):
    a = i * TAU / 8
    tr.append(rod('truss_v_%d' % i,
                  (1.10 * math.cos(a), 1.10 * math.sin(a), CORE_TOP),
                  (1.10 * math.cos(a), 1.10 * math.sin(a), TRUSS_TOP), 0.055, METAL, 6))
for z in (CORE_TOP, TRUSS_TOP):
    for i in range(8):
        a0, a1 = i * TAU / 8, (i + 1) * TAU / 8
        tr.append(rod('truss_ring_%d_%d' % (int(z), i),
                      (1.10 * math.cos(a0), 1.10 * math.sin(a0), z),
                      (1.10 * math.cos(a1), 1.10 * math.sin(a1), z), 0.045, METAL, 6))
for i in range(8):
    a0, a1 = i * TAU / 8, (i + 1) * TAU / 8
    for z0, z1 in ((CORE_TOP, TRUSS_TOP), (CORE_TOP + 0.8, TRUSS_TOP - 0.8)):
        tr.append(rod('truss_d_%d_%d' % (i, int(z0 * 10)),
                      (1.10 * math.cos(a0), 1.10 * math.sin(a0), z0),
                      (1.10 * math.cos(a1), 1.10 * math.sin(a1), z1), 0.035, METAL, 5))
lattice = join(tr, 'Lattice_Frame', METAL)


# ==========================================================================
#  4. BLOCK E (third stage)
# ==========================================================================
ble_profile = [
    (0.0, 29.90), (0.78, 29.90), (1.06, 30.05), (1.22, 30.35),
    (1.28, 30.8), (1.28, 32.25), (1.18, 32.55), (1.10, BLE_TOP),
    (0.0, BLE_TOP),
]
ble = lathe('BlockE_Stage3', ble_profile, 48, WHITE, smooth=True)
# RD-0109 bell, hanging down through the truss
ble_eng = [lathe('ble_bell', [(0.07, 30.0), (0.11, 29.75), (0.17, 29.35),
                              (0.24, 28.85), (0.28, 28.55)], 24, DARK, smooth=True)]
ble_eng.append(cylinder('ble_tp', 0.20, 0.38, (0, 0, 30.15), DARK, 16))
ble_eng = join(ble_eng, 'BlockE_Engines', DARK)
parent(ble_eng, ble)

ble_det = []
for z in (30.35, 30.8, 32.25):
    ble_det.append(torus('ble_seam_%d' % int(z * 10), 1.28 + 0.003, 0.006, z, GREY, 48, 5))
for (z, a, r) in [(31.4, 0.7, 0.18), (31.4, 3.5, 0.18)]:
    ble_det.append(cylinder('ble_hatch_%d' % int(z * 10 + a), r, 0.03,
                            (1.285 * math.cos(a), 1.285 * math.sin(a), z), GREY, 18,
                            rot=(0, math.pi / 2, a)))
ble_det = join(ble_det, 'BlockE_Details', GREY)
parent(ble_det, ble)


# ==========================================================================
#  5. PAYLOAD FAIRING — two petals
# ==========================================================================
# ogive shell; the two halves split along the X axis
fair_profile = []
Nz = 40
for i in range(Nz + 1):
    t = i / Nz
    z = 32.70 + t * (FAIR_TIP - 32.70)
    fair_profile.append((fair_radius(z), z))
fair_profile[0] = (FAIR_R, 32.70)

for side, (t0, t1) in (('L', (-math.pi / 2, math.pi / 2)),
                       ('R', (math.pi / 2, 3 * math.pi / 2))):
    half = lathe('Payload_Fairing_' + side, fair_profile, 48, WHITE,
                 theta0=t0, theta1=t1, smooth=True, close_bottom=False, close_top=False)
    solidify(half, 0.060)
    det = []
    # base ring + two stiffening hoops
    for z, r in ((32.78, FAIR_R + 0.065), (34.2, FAIR_R + 0.062),
                 (36.4, FAIR_R + 0.062)):
        # partial band, open top and bottom (no fan caps to the axis)
        ring = lathe('fair_band_%s_%d' % (side, int(z * 10)),
                     [(r, z - 0.025), (r, z + 0.025)], 40, GREY,
                     theta0=t0, theta1=t1, smooth=True,
                     close_bottom=False, close_top=False)
        det.append(ring)
    # long cable conduit on each half
    a = (t0 + t1) * 0.5 + (0.55 if side == 'L' else -0.55)
    for z0 in (33.0, 34.4, 35.8):
        z1 = min(z0 + 1.2, 36.4)
        det.append(rod('fair_race_%s_%d' % (side, int(z0 * 10)),
                       ((fair_radius(z0) + 0.05) * math.cos(a),
                        (fair_radius(z0) + 0.05) * math.sin(a), z0),
                       ((fair_radius(z1) + 0.05) * math.cos(a),
                        (fair_radius(z1) + 0.05) * math.sin(a), z1), 0.035, GREY, 6))
    det = join(det, 'Fairing_%s_Details' % side, GREY)
    parent(det, half)

    # CCCP, a red star and a hammer-and-sickle on each petal, big enough to
    # read from the ground and kept clear of the split line at +/-Y
    theta = 0.0 if side == 'L' else math.pi
    star_a = -math.pi / 4 if side == 'L' else 3 * math.pi / 4
    emb_a = math.pi / 4 if side == 'L' else 5 * math.pi / 4
    marks = vertical_text('CCCP', theta, 36.85, 0.64, RED,
                          lambda z: fair_radius(z) + 0.055, half, spacing=1.05)
    marks = join(marks, 'Fairing_%s_Markings' % side, RED)
    parent(marks, half)
    star('Fairing_%s_Star' % side, 0.55, 0.22, RED,
         star_a, 34.55, fair_radius(34.55) + 0.07, half)
    emb = curved_decal('Fairing_%s_Emblem' % side, emb_a, 35.15, 0.95, 0.95,
                       fair_radius(35.15) + 0.065, half)
    parent(emb, half)


# ==========================================================================
#  6. VOSTOK 3KA — instrument module + descent module
# ==========================================================================
cap = bpy.data.objects.new('Vostok_Capsule', None)
scene.collection.objects.link(cap)

# ---- 6a. instrument module (PA) ---------------------------------------
pa_profile = [
    (0.0, BLE_TOP), (0.88, BLE_TOP), (1.02, BLE_TOP + 0.08),
    (1.20, BLE_TOP + 0.32), (1.215, BLE_TOP + 0.55),
    (1.215, PA_TOP - 0.75), (1.16, PA_TOP - 0.35),
    (1.15, PA_TOP), (0.0, PA_TOP),
]
pa = lathe('Vostok_PA', pa_profile, 48, CAP_HULL, smooth=True)
parent(pa, cap)

pa_eng = []
# TDU-1 retro engine at the aft centre
pa_eng.append(lathe('tdu_bell', [(0.10, BLE_TOP + 0.20), (0.16, BLE_TOP + 0.02),
                                 (0.24, BLE_TOP - 0.22), (0.30, BLE_TOP - 0.42)],
                    24, CAP_DARK, smooth=True))
# 16 cold-gas attitude thrusters: two rings of eight
for ring, z in ((0, BLE_TOP + 0.62), (1, BLE_TOP + 1.55)):
    for i in range(8):
        a = i * TAU / 8 + (0.2 if ring else 0.0)
        pos = (1.24 * math.cos(a), 1.24 * math.sin(a), z)
        pa_eng.append(cone('pa_jet_%d_%d' % (ring, i), 0.055, 0.022, 0.20, pos,
                           CAP_DARK, 12, rot=(0, math.pi / 2 - 0.35, a)))
pa_eng = join(pa_eng, 'Vostok_PA_Engines', CAP_DARK)
parent(pa_eng, pa)

pa_det = []
# pressurant tank cluster and retro-engine plumbing at the aft end
for i in range(8):
    a = i * TAU / 8 + 0.39
    pa_det.append(cylinder('pa_tank_%d' % i, 0.13, 0.34,
                           (0.86 * math.cos(a), 0.86 * math.sin(a), BLE_TOP + 0.42),
                           CAP_GOLD, 12))
# radiator shutters on four sides
for i in range(4):
    a = i * TAU / 4 + 0.5
    pa_det.append(box('pa_rad_%d' % i, (0.02, 0.42, 0.82),
                      (1.23 * math.cos(a), 1.23 * math.sin(a), BLE_TOP + 1.12),
                      CAP_PANEL, rot=(0, 0, a)))
# antenna dipoles
for i, a in enumerate((0.8, 2.6, 4.5)):
    pa_det.append(rod('pa_ant_%d' % i,
                      (1.10 * math.cos(a), 1.10 * math.sin(a), PA_TOP - 0.10),
                      (1.38 * math.cos(a), 1.38 * math.sin(a), PA_TOP + 0.45),
                      0.014, CAP_DARK, 5))
pa_det = join(pa_det, 'Vostok_PA_Details')
parent(pa_det, pa)

# ---- 6b. descent module (SA), 2.30 m sphere ---------------------------
sa_profile = [
    (0.0, PA_TOP), (0.36, PA_TOP + 0.01), (0.68, PA_TOP + 0.07),
    (0.92, PA_TOP + 0.26), (1.07, PA_TOP + 0.53), (1.14, PA_TOP + 0.84),
    (1.15, SA_C), (1.14, SA_C + 0.31), (1.07, SA_C + 0.62),
    (0.92, SA_C + 0.89), (0.68, SA_C + 1.08), (0.36, SA_C + 1.13),
    (0.0, SA_TOP),
]
sa = lathe('Vostok_SA', sa_profile, 56, CAP_HULL, smooth=True)
parent(sa, cap)

# heat shield: the reentry face, on the PA side of the sphere
hs = lathe('Vostok_SA_HeatShield',
           [(0.0, PA_TOP - 0.015), (0.72, PA_TOP + 0.01), (1.04, PA_TOP + 0.22),
            (1.16, PA_TOP + 0.52)], 48, CAP_HEAT, smooth=True)
parent(hs, sa)

sa_det = []
# main hatch, hinged on the side (the cosmonaut's ejection route)
hatch_a = 0.10
zc = SA_C - 0.10
rr = 1.15 + 0.012
hatch_dir = Vector((math.cos(hatch_a), math.sin(hatch_a), 0))
hatch_center = hatch_dir * rr + Vector((0, 0, zc))
# rim
sa_det.append(torus('sa_hatch_rim', 0.37, 0.035, 0.0, CAP_DARK, 32, 6))
# reposition the torus: it is created in the XY plane, rotate it to face out
rim = sa_det[-1]
rim.rotation_mode = 'QUATERNION'
rim.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(hatch_dir)
rim.location = hatch_center
# hatch plate
plate = cylinder('sa_hatch', 0.33, 0.06, hatch_center, CAP_PANEL, 28,
                 rot=(0, math.pi / 2, hatch_a))
sa_det.append(plate)
# a small handle
sa_det.append(box('sa_hatch_handle', (0.03, 0.20, 0.035),
                  hatch_center + hatch_dir * 0.03 + Vector((0, 0, 0.22)), CAP_DARK,
                  rot=(0, 0, hatch_a)))
# Vzor optical window near the cosmonaut's feet
for (a, z, r) in [(0.62, PA_TOP + 0.52, 0.16), (2.35, SA_C + 0.25, 0.11),
                  (4.20, SA_C + 0.25, 0.11)]:
    pos = Vector((1.15 * math.cos(a), 1.15 * math.sin(a), z))
    sa_det.append(cylinder('sa_port_%d' % int(a * 100), r, 0.05, pos, CAP_GLASS, 20,
                           rot=(0, math.pi / 2, a)))
# whip antennas
for i, a in enumerate((1.1, 2.9, 4.8)):
    p0 = Vector((1.10 * math.cos(a), 1.10 * math.sin(a), SA_C + 0.52))
    p1 = p0 + Vector((0.42 * math.cos(a), 0.42 * math.sin(a), 0.85))
    sa_det.append(rod('sa_ant_%d' % i, p0, p1, 0.014, CAP_DARK, 5))
sa_det = join(sa_det, 'Vostok_SA_Details')
parent(sa_det, sa)

# ==========================================================================
#  7. save + export
# ==========================================================================
# The app addresses the top-level parts by name and writes their .position
# directly when staging.  Those parts therefore need an identity object
# transform with their geometry baked in world coordinates.  (The lathe
# bodies are already built that way; the joined truss is not.)
bpy.context.view_layer.update()

def bake_identity(ob, fix_children=False):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if fix_children:
        # children were parented with the old object matrix inverted; after
        # baking the parent is identity, so their parent-inverse must be too
        for ch in ob.children:
            ch.matrix_parent_inverse = Matrix.Identity(4)
    bpy.ops.object.select_all(action='DESELECT')

# top-level parts are addressed by name and moved by launch.js; keep their
# object transforms identity with the geometry baked in world space
for b in boosters:
    bake_identity(b, fix_children=True)
bake_identity(lattice)

# the empty parent must stay at the origin: transform_apply on an empty is a
# no-op, but re-assert it in case the parenting math moved it
cap.location = (0, 0, 0)
cap.rotation_euler = (0, 0, 0)
cap.scale = (1, 1, 1)

# quick sanity report
print('--- VOSTOK 8K72K ---')
for o in scene.objects:
    if o.type == 'MESH' and o.name.split('_')[0] in (
            'Core', 'Booster', 'Fin', 'BlockE', 'Lattice', 'Payload',
            'Vostok', 'Fairing'):
        bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
        print('%-22s v=%5d  z=(%6.2f,%6.2f)' %
              (o.name, len(o.data.vertices), min(v.z for v in bb), max(v.z for v in bb)))
print('capsule centre (CAP_LOCAL_Y):', round(CAP_MID, 3))
print('total height:', max((o.matrix_world @ Vector(c)).z
                           for o in scene.objects if o.type == 'MESH'
                           for c in o.bound_box))

bpy.ops.wm.save_as_mainfile(filepath=BLEND)
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format='GLB', use_selection=False,
    export_apply=True, export_yup=True, export_texcoords=True,
    export_normals=True, export_materials='EXPORT', export_cameras=False,
    export_lights=False, export_animations=False, export_extras=False,
)
print('EXPORTED', OUT)
