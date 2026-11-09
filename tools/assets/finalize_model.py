r"""Make a game-ready GLB: scaled to inches, centred, standing on a plain black base.

Run with the 2.1 venv (it has bpy):
  ..\Hunyuan3D-2.1\.venv\Scripts\python.exe finalize_model.py in.glb out.glb --height 1.8 --base 40 [--base2 42]

Output contract: y up, 1 unit = 1 inch, origin at the bottom centre of the base,
figure front faces +Z, texture embedded as JPEG.
"""
import argparse
import math
import os

import bpy
from mathutils import Vector

ap = argparse.ArgumentParser()
ap.add_argument('src')
ap.add_argument('dst')
ap.add_argument('--height', type=float, required=True, help='figure height in inches, excluding base')
ap.add_argument('--base', type=float, default=0, help='base diameter (or length) in mm')
ap.add_argument('--base2', type=float, help='base width in mm for oval bases')
ap.add_argument('--fit', type=float, help='max footprint (mm) of the figure on the ground plane; shrinks the figure uniformly if wider')
ap.add_argument('--yaw', type=float, default=0.0, help='degrees to rotate the figure about the vertical')
args = ap.parse_args()

BASE_H = 0.0  # no extra plate: the figure's own painted base stays (tools/assets variant)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(args.src))

meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
if len(meshes) > 1:
    bpy.ops.object.join()
fig = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(bpy.context.scene.objects):
    if o != fig:
        bpy.data.objects.remove(o)

import math
fig.rotation_mode = 'XYZ'  # glTF import leaves QUATERNION mode, which ignores rotation_euler
fig.rotation_euler[2] = math.radians(args.yaw)
bpy.ops.object.transform_apply(rotation=True)

pts = [Vector(v.co) for v in fig.data.vertices]
lo = Vector([min(p[i] for p in pts) for i in range(3)])
hi = Vector([max(p[i] for p in pts) for i in range(3)])
s = args.height / (hi.z - lo.z)
if args.fit:
    cx, cy = (lo.x + hi.x) / 2, (lo.y + hi.y) / 2
    zcut = lo.z + 0.2 * (hi.z - lo.z)
    span = 2 * max(math.hypot(p.x - cx, p.y - cy) for p in pts if p.z < zcut) * s
    if span > args.fit / 25.4:
        s *= (args.fit / 25.4) / span
        print('fit: shrank to', round(s * (hi.z - lo.z), 2), 'in tall')
fig.scale = (s, s, s)
fig.location = (-(lo.x + hi.x) / 2 * s, -(lo.y + hi.y) / 2 * s, BASE_H - lo.z * s)
bpy.ops.object.transform_apply(location=True, scale=True)
fig.name = 'figure'

# Hunyuan exports fully metallic materials, which render near-black without an
# environment map; painted miniatures should be matte.
for m in fig.data.materials:
    if m and m.use_nodes:
        p = m.node_tree.nodes.get('Principled BSDF')
        if p:
            for name, value in (('Metallic', 0.0), ('Roughness', 0.75)):
                sock = p.inputs[name]
                for link in list(sock.links):
                    m.node_tree.links.remove(link)
                sock.default_value = value

os.makedirs(os.path.dirname(os.path.abspath(args.dst)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=os.path.abspath(args.dst), export_format='GLB',
                          export_image_format='JPEG', export_yup=True)
print(f'{args.dst}: {len(fig.data.polygons)} faces, {os.path.getsize(args.dst) / 1e6:.2f} MB')
