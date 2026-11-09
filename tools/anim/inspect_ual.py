import bpy, os, sys, glob
d = 'tools/anim/vendor/ual'
f = os.path.join(os.path.abspath(d), os.listdir(d)[0], 'Unreal-Godot', 'UAL1_Standard.glb')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=f)
arm = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE'][0]
print('ARM', arm.name, tuple(arm.location), tuple(arm.rotation_quaternion), tuple(arm.scale), arm.parent)
for o in bpy.context.scene.objects: print('OBJ', o.name, o.type, tuple(round(x,3) for x in o.dimensions))
for b in arm.data.bones:
    if b.name in ('root','pelvis','spine_01','spine_03','neck_01','Head','clavicle_l','upperarm_l','lowerarm_l','hand_l','thigh_l','calf_l','foot_l','ball_l','ball_leaf_l','middle_01_l'):
        print(b.name, [round(x,3) for x in (arm.matrix_world @ b.head_local)], [round(x,3) for x in (arm.matrix_world @ b.tail_local)], b.parent.name if b.parent else None, b.use_connect)
for a in bpy.data.actions:
    if True:
        print(a.name, tuple(a.frame_range), len(a.fcurves))
print(bpy.context.scene.render.fps)
