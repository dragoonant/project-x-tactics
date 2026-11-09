r"""Orthographic front/side render of a GLB with a measuring grid (for placing joints).
Run with the Hunyuan3D-2.1 venv python (bpy 4.0):  python orth.py in.glb out_prefix
Writes <out_prefix>_front.png (looking along +Y in Blender, i.e. at the figure's front) and _side.png.
Scale: 500 px per unit, image 1100 x 1100, world (x=0, z=0.9) at the image centre.
"""
import math, os, sys
import bpy
from mathutils import Vector

src, prefix = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.render.resolution_x = sc.render.resolution_y = 1100
sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = 'TEXTURE'
sc.render.film_transparent = False
w = bpy.data.worlds.new('w'); w.color = (0.8, 0.8, 0.8); sc.world = w
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = 2.2
for name, loc, rot in (('front', (0, -10, 0.9), (math.pi / 2, 0, 0)), ('side', (10, 0, 0.9), (math.pi / 2, 0, math.pi / 2))):
    cam.location = loc; cam.rotation_euler = rot
    sc.render.filepath = f'{prefix}_{name}.png'
    bpy.ops.render.render(write_still=True)
