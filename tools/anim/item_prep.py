r"""Normalise a Hunyuan item mesh into the item frame of figures.json (Blender: x along the length, FRONT end at -X, z up, centred in
x and y, z from 0 to the height), scale the length, matte the materials, write art/rig/raw/items/<id>.glb and its dims.
Run with the Hunyuan3D-2.1 venv python:
  python tools/anim/item_prep.py <id> [--flipx] [--flipz] [--yaw90] [--len L]
Writes <id>.glb (glTF export) and <id>.dims.json (length, height, width, tip and tail heights).
"""
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
RAW = os.path.join(ROOT, 'art', 'rig', 'raw')
cfg = json.load(open(os.path.join(ROOT, 'tools', 'anim', 'figures.json')))['items']
iid = sys.argv[1]
it = cfg[iid]
flipx, flipz, yaw90 = '--flipx' in sys.argv, '--flipz' in sys.argv, '--yaw90' in sys.argv
length = float(sys.argv[sys.argv.index('--len') + 1]) if '--len' in sys.argv else it['len']
os.makedirs(os.path.join(RAW, 'items'), exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(RAW, iid + '.textured.glb'))
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
if len(meshes) > 1:
    bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
ob.name = iid
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(bpy.context.scene.objects):
    if o != ob:
        bpy.data.objects.remove(o)
tris0 = sum(len(p.vertices) - 2 for p in ob.data.polygons)
if tris0 > 3000:   # item budget: at most 3k triangles
    bpy.context.view_layer.objects.active = ob
    md = ob.modifiers.new('dec', 'DECIMATE')
    md.ratio = 2900.0 / tris0
    md.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier='dec')
me = ob.data
P =[v.co.copy() for v in me.vertices]
n = len(P)
mean = sum(P, Vector()) / n


def eig3(C):
    """principal axes of a symmetric 3x3 matrix by power iteration with deflation"""
    axes = []
    M = [r[:] for r in C]
    for _ in range(3):
        v = Vector((1.0, 0.7, 0.3))
        for _ in range(80):
            w = Vector((sum(M[i][j] * v[j] for j in range(3)) for i in range(3)))
            if w.length < 1e-12:
                break
            v = w.normalized()
        lam = sum(v[i] * sum(M[i][j] * v[j] for j in range(3)) for i in range(3))
        axes.append((lam, v.copy()))
        for i in range(3):
            for j in range(3):
                M[i][j] -= lam * v[i] * v[j]
    return axes


C = [[sum((p[i] - mean[i]) * (p[j] - mean[j]) for p in P) / n for j in range(3)] for i in range(3)]
axes = eig3(C)
kind = it['kind']
if kind == 'upright':
    # keep the original up axis (Blender z); width axis = the larger horizontal extent
    ex = max(p.x for p in P) - min(p.x for p in P)
    ey = max(p.y for p in P) - min(p.y for p in P)
    if ey > ex:
        yaw90 = True
    R = Matrix.Rotation(math.radians(90 if yaw90 else 0), 3, 'Z')
else:
    ax = axes[0][1]
    if abs(ax.z) > 0.8:   # length axis came out vertical: lay it down
        R = Matrix.Rotation(math.radians(-90), 3, 'Y') if ax.z > 0 else Matrix.Rotation(math.radians(90), 3, 'Y')
    else:
        h = Vector((ax.x, ax.y, 0)).normalized()
        R = Matrix.Rotation(-math.atan2(h.y, h.x), 3, 'Z')
Q = [R @ (p - mean) for p in P]
if kind != 'upright':
    # sign: front (-X) end is the thin end for guns, the thick end for melee heads
    lo = min(q.x for q in Q); hi = max(q.x for q in Q)
    span = hi - lo
    def spread(sel):
        zs = [q.z for q in sel]
        ys = [q.y for q in sel]
        return (max(zs) - min(zs)) * (max(ys) - min(ys)) if zs else 0.0
    left = [q for q in Q if q.x < lo + 0.12 * span]
    right = [q for q in Q if q.x > hi - 0.12 * span]
    sl, sr = spread(left), spread(right)
    want_front_thin = it.get('front', 'thin') == 'thin'
    front_is_left = (sl <= sr) if want_front_thin else (sl >= sr)
    if not front_is_left:
        Q = [Vector((-q.x, -q.y, q.z)) for q in Q]
    # up: the grip and magazine hang below, sights and scopes sit on top: the centre of mass of the middle 60% is below the bbox centre
    zmid = (max(q.z for q in Q) + min(q.z for q in Q)) / 2
    mid = [q for q in Q if abs(q.x) < 0.3 * span]
    com = sum(q.z for q in mid) / max(len(mid), 1)
    if iid in ('baton', 'club', 'maul', 'handset', 'injector'):
        up_ok = True
    else:
        up_ok = com < zmid
    if not up_ok:
        Q = [Vector((-q.x, q.y, -q.z)) for q in Q]
if flipx:
    Q = [Vector((-q.x, -q.y, q.z)) for q in Q]
if flipz:
    Q = [Vector((q.x, -q.y, -q.z)) for q in Q]
xs = [q.x for q in Q]; ys = [q.y for q in Q]; zs = [q.z for q in Q]
if kind == 'upright':
    key = max(xs) - min(xs) if it.get('upright') == 'width' else max(zs) - min(zs)
    s = length / key
else:
    s = length / (max(xs) - min(xs))
cx, cy, cz = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2, min(zs)
for v, q in zip(me.vertices, Q):
    v.co = Vector(((q.x - cx) * s, (q.y - cy) * s, (q.z - cz) * s))
me.update()
xs = [v.co.x for v in me.vertices]; ys = [v.co.y for v in me.vertices]; zs = [v.co.z for v in me.vertices]
L, W, Hh = max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)
span = L
def zrange(sel):
    z = [v.co.z for v in sel]
    return (min(z), max(z)) if z else (0, 0)
tip = zrange([v for v in me.vertices if v.co.x < min(xs) + 0.1 * span])
tail = zrange([v for v in me.vertices if v.co.x > max(xs) - 0.1 * span])
for m in me.materials:
    if m and m.use_nodes:
        pb = m.node_tree.nodes.get('Principled BSDF')
        if pb:
            for name, value in (('Metallic', 0.0), ('Roughness', 0.75)):
                sock = pb.inputs[name]
                for link in list(sock.links):
                    m.node_tree.links.remove(link)
                sock.default_value = value
out = os.path.join(RAW, 'items', iid + '.glb')
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_image_format='JPEG', export_yup=True)
dims = {'id': iid, 'length': L, 'width': W, 'height': Hh, 'tip_z': tip, 'tail_z': tail, 'faces': len(me.polygons)}
json.dump(dims, open(os.path.join(RAW, 'items', iid + '.dims.json'), 'w'), indent=1)
print('ITEM', iid, json.dumps({k: (round(v, 3) if isinstance(v, float) else v) for k, v in dims.items()}), os.path.getsize(out) / 1e6, 'MB')
