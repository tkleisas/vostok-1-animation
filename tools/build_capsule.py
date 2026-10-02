"""Rebuild the Vostok 3KA capsule procedurally inside a copy of
vostok-source.blend, then export the whole stack back to GLB.

Real 3KA reference: 2.3 m spherical descent module nesting into a 2.43 m
instrument module (~4.5 m overall), retro-engine bell and pressurant-tank
cluster at the aft end, orientation-jet ring, radiator panels, hatch and
portholes on the sphere, whip antennas.
"""
import bpy, math

BLEND = '/home/tkleisas/Projects/bokontep.gr/three/assets/vostok-source.blend'
OUT = '/tmp/vostok-1-new.glb'
Z0 = 32.05                     # capsule base (mates with Block-E top)

bpy.ops.wm.open_mainfile(filepath=BLEND)
# textures may be packed inside the blend from an older save - force them
# back to the current files on disk before anything is exported
TEXDIR = '/home/tkleisas/Projects/bokontep.gr/three/assets/textures/'
for img in bpy.data.images:
    try:
        if img.packed_file:
            img.unpack(method='REMOVE')   # drop the pack, keep the filepath
        img.filepath = TEXDIR + img.name  # the blend used to point at a stale
        img.reload()                      # temp dir - repoint at the project
        print('reloaded image from disk:', img.name)
    except Exception as e:
        print('image reload skipped:', img.name, e)

# ---- materials ----------------------------------------------------------
def mat(name, rgb, metal=0.0, rough=0.6):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = rough
    return m

hullMat  = mat('Capsule_Hull',  (0.78, 0.80, 0.83), 0.35, 0.45)
darkMat  = mat('Capsule_Dark',  (0.16, 0.15, 0.14), 0.55, 0.45)
glassMat = mat('Capsule_Glass', (0.03, 0.05, 0.08), 0.1, 0.08)
tankMat  = mat('Capsule_Tank',  (0.55, 0.58, 0.62), 0.7, 0.35)
panelMat = mat('Capsule_Panel', (0.90, 0.89, 0.86), 0.1, 0.65)

# ---- helpers ------------------------------------------------------------
made = []
def lathe(name, profile, seg, material, smooth=True):
    rings = list(profile)
    verts, idx = [], []
    for (r, z) in rings:
        if r == 0:
            idx.append([len(verts)]); verts.append((0, 0, z))
        else:
            idx.append(list(range(len(verts), len(verts) + seg)))
            for i in range(seg):
                a = 2 * math.pi * i / seg
                verts.append((r * math.cos(a), r * math.sin(a), z))
    faces = []
    for k in range(len(rings) - 1):
        r0, r1 = rings[k][0], rings[k + 1][0]
        A, B = idx[k], idx[k + 1]
        if r0 == 0 and r1 == 0:
            continue
        if r0 == 0:
            for i in range(seg):
                faces.append((A[0], B[(i + 1) % seg], B[i]))
        elif r1 == 0:
            for i in range(seg):
                faces.append((A[i], A[(i + 1) % seg], B[0]))
        else:
            for i in range(seg):
                ni = (i + 1) % seg
                faces.append((A[i], A[ni], B[ni], B[i]))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.materials.append(material)
    if smooth:
        for p in mesh.polygons:
            p.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    made.append(obj)
    return obj

def uv_sphere(name, loc, r, material, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=24, ring_count=16)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(material)
    for p in o.data.polygons:
        p.use_smooth = True
    made.append(o)
    return o

def cyl(name, loc, r, depth, material, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, rotation=rot, vertices=20)
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(material)
    for p in o.data.polygons:
        p.use_smooth = True
    made.append(o)
    return o

def cone(name, loc, r1, r2, depth, material, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(radius1=r1, radius2=r2, depth=depth, location=loc,
                                    rotation=rot, vertices=16)
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(material)
    for p in o.data.polygons:
        p.use_smooth = True
    made.append(o)
    return o

def box(name, loc, scale, material, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(material)
    made.append(o)
    return o

# ---- main hull: instrument module + descent sphere ----------------------
# cylinder body with a domed shoulder; the sphere (narrower) emerges from
# the open ring at the top, as on the real 3KA
hull_profile = [
    (0.0,   Z0),
    (0.92,  Z0),
    (1.16,  Z0 + 0.17),
    (1.215, Z0 + 0.45),
    (1.215, Z0 + 2.55),          # top of the instrument-module wall
    (1.05,  Z0 + 2.70),          # shoulder rolling into the sphere
    (1.155, Z0 + 2.95),          # sphere equator (r = 1.15)
    (1.081, Z0 + 3.34),
    (0.881, Z0 + 3.69),
    (0.575, Z0 + 3.95),
    (0.200, Z0 + 4.08),
    (0.0,   Z0 + 4.10),
]
lathe('Cap_Hull', hull_profile, 48, hullMat)

# junction ring between the modules
bpy.ops.mesh.primitive_torus_add(major_radius=1.17, minor_radius=0.055,
                                 major_segments=40, minor_segments=10,
                                 location=(0, 0, Z0 + 2.62))
ring = bpy.context.active_object
ring.name = 'Cap_Ring'
ring.data.materials.append(tankMat)
for p in ring.data.polygons:
    p.use_smooth = True
made.append(ring)

# ---- retro engine (TDU-1) bell at the aft centre ------------------------
lathe('Cap_Nozzle', [(0.28, Z0 + 0.12), (0.40, Z0 - 0.15), (0.52, Z0 - 0.40)], 32, darkMat)
lathe('Cap_NozzleIn', [(0.0, Z0 - 0.38), (0.46, Z0 - 0.38), (0.40, Z0 - 0.15), (0.26, Z0 + 0.10)],
      32, darkMat)

# ---- pressurant-tank cluster around the aft end -------------------------
for i in range(8):
    a = 2 * math.pi * i / 8 + 0.39
    uv_sphere('Cap_Tank', (0.88 * math.cos(a), 0.88 * math.sin(a), Z0 + 0.16), 0.175, tankMat)
uv_sphere('Cap_TankC', (0, 0, Z0 + 0.22), 0.24, tankMat)

# ---- orientation-jet nozzles: one ring around the aft cylinder ----------
for i in range(12):
    a = 2 * math.pi * i / 12
    x, y = 1.27 * math.cos(a), 1.27 * math.sin(a)
    # point outward and slightly down
    cone('Cap_Jet', (x, y, Z0 + 0.62), 0.055, 0.028, 0.22, darkMat,
         rot=(0, math.pi / 2 - 0.35, a))

# ---- radiator panels on the instrument module ---------------------------
for i, a in enumerate([0.5, 2.6, 4.3]):
    x, y = 1.23 * math.cos(a), 1.23 * math.sin(a)
    box('Cap_Panel', (x, y, Z0 + 1.45), (0.03, 0.55, 0.75), panelMat, rot=(0, 0, a))

# ---- hatch + portholes on the descent sphere ----------------------------
# sphere centre is at z = Z0+2.95+... equator at Z0+2.95 -> centre z = Z0+2.95
ZC = Z0 + 2.95
def on_sphere(theta, phi, lift=0.0):
    """point on the r=1.15 sphere (centre z=ZC) + surface normal"""
    n = (math.cos(theta) * math.cos(phi), math.cos(theta) * math.sin(phi), math.sin(theta))
    r = 1.15 + lift
    return (r * n[0], r * n[1], ZC + r * n[2]), n

import mathutils
def disc_at(name, theta, phi, radius, depth, material, lift=0.005):
    pos, n = on_sphere(theta, phi, lift)
    # cylinder's local +Z along the surface normal
    q = mathutils.Vector((0, 0, 1)).rotation_difference(mathutils.Vector(n))
    o = cyl(name, pos, radius, depth, material)
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = q
    return o

# main hatch (rim + slightly darker plate)
disc_at('Cap_HatchRim', math.radians(50), 0.0, 0.36, 0.05, tankMat)
disc_at('Cap_Hatch',    math.radians(50), 0.0, 0.32, 0.065, hullMat, lift=0.01)
# Vzor optical window + two portholes
disc_at('Cap_Vzor', math.radians(38), 1.15, 0.16, 0.06, glassMat)
disc_at('Cap_Port1', math.radians(42), -1.05, 0.12, 0.06, glassMat)
disc_at('Cap_Port2', math.radians(60), 2.6, 0.12, 0.06, glassMat)

# ---- whip antennas -------------------------------------------------------
for i, (a, tilt) in enumerate([(0.9, 0.30), (2.8, 0.35), (4.6, 0.28)]):
    pos, n = on_sphere(math.radians(72), a, 0.45)
    q = mathutils.Vector((0, 0, 1)).rotation_difference(mathutils.Vector(n))
    o = cyl('Cap_Antenna', pos, 0.016, 1.1, tankMat)
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = q

# umbilical/service fairing bump on the instrument module
pos = (1.21 * math.cos(3.6), 1.21 * math.sin(3.6), Z0 + 1.0)
uv_sphere('Cap_Fairing', pos, 0.22, hullMat, scale=(1, 1, 1.8))

# ---- remove the old capsule, join the new build under its name ----------
old = bpy.context.scene.objects.get('Vostok_Capsule')
if old:
    bpy.data.objects.remove(old, do_unlink=True)

bpy.ops.object.select_all(action='DESELECT')
for o in made:
    o.select_set(True)
bpy.context.view_layer.objects.active = made[0]
bpy.ops.object.join()
cap = bpy.context.active_object
cap.name = 'Vostok_Capsule'
print('CAPSULE verts:', len(cap.data.vertices), 'dim:', tuple(round(v, 2) for v in cap.dimensions))

# ---- save the source and export the whole stack -------------------------
bpy.ops.wm.save_mainfile(filepath=BLEND)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB')
print('EXPORTED', OUT)
