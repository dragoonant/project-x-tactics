r"""Render the prepared items (art/rig/raw/items/<id>.glb) side by side from the side (+Y camera looking at -X front on the left) to check
orientation: front end must be on the LEFT, up must be up. usage: python tools/anim/item_check.py id [id...] -> art/rig/raw/items/check.png"""
import os
import sys

import bpy
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
RAW = os.path.join(ROOT, 'art', 'rig', 'raw', 'items')
ids = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.render.resolution_x, sc.render.resolution_y = 380 * len(ids), 300
sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = 'TEXTURE'
w = bpy.data.worlds.new('w'); w.color = (0.8, 0.8, 0.8); sc.world = w
x = 0.0
for i in ids:
    before = set(sc.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(RAW, i + '.glb'))
    new = [o for o in sc.objects if o not in before]
    for o in new:
        if o.parent is None:
            o.location.x += x
    ms = [o for o in new if o.type == 'MESH']
    x += 1.6
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
sc.collection.objects.link(cam)
sc.camera = cam
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 1.6 * len(ids)
cam.location = (x / 2 - 0.8, 5, 0.4)
cam.rotation_euler = (Vector((0, 0, 0)) - Vector((0, 5, 0))).to_track_quat('-Z', 'Y').to_euler()
cam.rotation_euler = (1.5708, 0, 3.14159)   # look along -Y... front end (-X) appears on the right from +Y; flip so it reads on the left
cam.location = (x / 2 - 0.8, -5, 0.4)
cam.rotation_euler = (1.5708, 0, 0)
sc.render.filepath = os.path.join(RAW, 'check.png')
bpy.ops.render.render(write_still=True)
