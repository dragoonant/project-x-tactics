r"""Raw Hunyuan prop GLB -> game-ready GLB: joined, decimated to <= N triangles, matte, scaled to tile units, standing on y = 0
centred on the origin. Run with the Hunyuan 2.1 venv (it has bpy):
  python finalize_prop.py in.glb out.glb --fit foot --target 0.92 [--tris 6000] [--yaw 0]
--fit foot: the larger horizontal side becomes `target` tiles; --fit height: the height becomes `target` tiles.
1 unit = 1 tile (the game's world unit). Texture is re-encoded as JPEG by the glTF exporter; gltf-transform converts it to WebP after.
"""
import argparse
import math
import os

import bpy
from mathutils import Vector

ap = argparse.ArgumentParser()
ap.add_argument('src')
ap.add_argument('dst')
ap.add_argument('--fit', choices=['foot', 'height'], required=True)
ap.add_argument('--target', type=float, required=True)
ap.add_argument('--tris', type=int, default=6000)
ap.add_argument('--yaw', type=float, default=0.0)
args = ap.parse_args()

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
ob = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(bpy.context.scene.objects):
    if o != ob:
        bpy.data.objects.remove(o)

# triangulate, then collapse-decimate to the triangle budget
tri = ob.modifiers.new('tri', 'TRIANGULATE')
bpy.ops.object.modifier_apply(modifier=tri.name)
n0 = len(ob.data.polygons)
if n0 > args.tris:
    dec = ob.modifiers.new('dec', 'DECIMATE')
    dec.decimate_type = 'COLLAPSE'
    dec.ratio = args.tris / n0
    dec.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=dec.name)
n1 = len(ob.data.polygons)

ob.rotation_mode = 'XYZ'
ob.rotation_euler[2] = math.radians(args.yaw)
bpy.ops.object.transform_apply(rotation=True)
pts = [Vector(v.co) for v in ob.data.vertices]
lo = Vector([min(p[i] for p in pts) for i in range(3)])
hi = Vector([max(p[i] for p in pts) for i in range(3)])
size = hi - lo  # blender: x, y horizontal, z up
s = args.target / (max(size.x, size.y) if args.fit == 'foot' else size.z)
ob.scale = (s, s, s)
ob.location = (-(lo.x + hi.x) / 2 * s, -(lo.y + hi.y) / 2 * s, -lo.z * s)
bpy.ops.object.transform_apply(location=True, scale=True)
ob.name = 'prop'

for m in ob.data.materials:
    if m and m.use_nodes:
        p = m.node_tree.nodes.get('Principled BSDF')
        if p:
            for name, value in (('Metallic', 0.0), ('Roughness', 0.8)):
                sock = p.inputs[name]
                for link in list(sock.links):
                    m.node_tree.links.remove(link)
                sock.default_value = value

os.makedirs(os.path.dirname(os.path.abspath(args.dst)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=os.path.abspath(args.dst), export_format='GLB', export_image_format='JPEG', export_yup=True)
print(f'{args.dst}: {n0} -> {n1} tris, size {size.x * s:.3f} x {size.y * s:.3f} x {size.z * s:.3f} (x, y, up) tiles, {os.path.getsize(args.dst) / 1e6:.2f} MB')
