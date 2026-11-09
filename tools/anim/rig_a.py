r"""Rig (a): the Universal Animation Library skeleton fitted to the Hunyuan body, Blender automatic weights, clips retargeted.

Run with the Hunyuan3D-2.1 venv python (bpy 4.0.0, Python 3.10):
  python tools/anim/rig_a.py [--out art/anim-spike/raw/enforcer-a.glb]
Outputs (under art/anim-spike/raw/): enforcer-a.glb (skinned mesh + clips), a-metrics.json, a-socket.json (raw socket data).
"""
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import animlib as L  # noqa: E402

RAW = os.path.join(L.ROOT, 'art', 'anim-spike', 'raw')
RIG = sys.argv[sys.argv.index('--rig') + 1] if '--rig' in sys.argv else 'a'
OUT = os.path.join(RAW, f'enforcer-{RIG}.glb')
if '--out' in sys.argv:
    OUT = os.path.abspath(sys.argv[sys.argv.index('--out') + 1])
GRIPL = float(sys.argv[sys.argv.index('--gripl') + 1]) if '--gripl' in sys.argv else 0.58
ABDUCT = float(sys.argv[sys.argv.index('--abduct') + 1]) if '--abduct' in sys.argv else 14.0

# Joint heads of the Enforcer body (inches, Blender z up, front = -Y), measured on the orthographic render with a grid.
# Character-left side (+X); the right side is mirrored.
J = {
    'pelvis': (0, 0.02, 0.60), 'spine_01': (0, 0.01, 0.74), 'spine_02': (0, 0.0, 0.92), 'spine_03': (0, -0.01, 1.08),
    'neck_01': (0, -0.03, 1.27), 'Head': (0, -0.03, 1.36), 'Head_tip': (0, -0.05, 1.76),
    'clavicle_l': (0.06, -0.02, 1.20), 'upperarm_l': (0.33, 0.0, 1.17), 'lowerarm_l': (0.46, 0.0, 0.86),
    'hand_l': (0.50, 0.0, 0.68), 'hand_l_tip': (0.52, -0.01, 0.54),
    'thigh_l': (0.13, 0.03, 0.54), 'calf_l': (0.22, 0.03, 0.31), 'foot_l': (0.29, 0.04, 0.13),
    'ball_l': (0.31, -0.10, 0.05), 'ball_leaf_l': (0.31, -0.22, 0.04),
}


def mirror(v):
    return Vector((-v[0], v[1], v[2]))


def build_target(src):
    tgt = src.copy()
    tgt.data = src.data.copy()
    tgt.name = 'Armature'
    tgt.animation_data_clear()
    bpy.context.scene.collection.objects.link(tgt)
    bpy.context.view_layer.objects.active = tgt
    bpy.ops.object.mode_set(mode='EDIT')
    eb = tgt.data.edit_bones
    heads, tails = {}, {}

    def P(name, side=None):
        v = Vector(J[name])
        return mirror(v) if side == 'r' else v

    for side in ('l', 'r'):
        sfx = '_' + side
        heads['clavicle' + sfx], tails['clavicle' + sfx] = P('clavicle_l', side), P('upperarm_l', side)
        heads['upperarm' + sfx], tails['upperarm' + sfx] = P('upperarm_l', side), P('lowerarm_l', side)
        heads['lowerarm' + sfx], tails['lowerarm' + sfx] = P('lowerarm_l', side), P('hand_l', side)
        heads['hand' + sfx], tails['hand' + sfx] = P('hand_l', side), P('hand_l_tip', side)
        heads['thigh' + sfx], tails['thigh' + sfx] = P('thigh_l', side), P('calf_l', side)
        heads['calf' + sfx], tails['calf' + sfx] = P('calf_l', side), P('foot_l', side)
        heads['foot' + sfx], tails['foot' + sfx] = P('foot_l', side), P('ball_l', side)
        heads['ball' + sfx], tails['ball' + sfx] = P('ball_l', side), P('ball_leaf_l', side)
        heads['ball_leaf' + sfx], tails['ball_leaf' + sfx] = P('ball_leaf_l', side), P('ball_leaf_l', side) + Vector((0, -0.08, 0))
    chain = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head']
    for a, b in zip(chain, chain[1:] + ['Head_tip']):
        heads[a], tails[a] = P(a) if a in J else None, P(b)
    # old (rest) data for the rigid transform of the finger bones, taken before any edit
    old = {b.name: (b.head.copy(), b.tail.copy()) for b in eb}
    for side in ('l', 'r'):
        h_old = old['hand_' + side]
        d_old = (h_old[1] - h_old[0]).normalized()
        d_new = (tails['hand_' + side] - heads['hand_' + side]).normalized()
        q = d_old.rotation_difference(d_new)
        o_old = h_old[0]
        for b in list(eb):
            if b.name.endswith('_' + side) and any(b.name.startswith(p) for p in ('index', 'middle', 'pinky', 'ring', 'thumb')):
                heads[b.name] = heads['hand_' + side] + q @ (old[b.name][0] - o_old)
                tails[b.name] = heads['hand_' + side] + q @ (old[b.name][1] - o_old)
    # apply (children before parents is irrelevant because connect is off)
    for b in eb:
        b.use_connect = False
    for name, h in heads.items():
        if name in eb and h is not None:
            eb[name].head = h
            eb[name].tail = tails[name]
    # keep the root at the origin, pointing along Y as in the library
    for b in eb:
        if b.name in ('root',):
            continue
        if (b.tail - b.head).length < 1e-4:
            b.tail = b.head + Vector((0, 0, 0.02))
    bpy.ops.object.mode_set(mode='OBJECT')
    for b in tgt.data.bones:
        # fingers and leaf bones do not deform: the glove is a mitt, it follows the hand bone rigidly
        b.use_deform = not any(k in b.name for k in ('index', 'middle', 'pinky', 'ring', 'thumb', 'leaf')) and b.name != 'root'
    return tgt


UNIRIG_MAP = {'pelvis': 'bone_0', 'spine_01': 'bone_1', 'spine_02': 'bone_2', 'spine_03': 'bone_3', 'neck_01': 'bone_4', 'Head': 'bone_5',
              'clavicle_l': 'bone_6', 'upperarm_l': 'bone_7', 'lowerarm_l': 'bone_8', 'hand_l': 'bone_9',
              'clavicle_r': 'bone_13', 'upperarm_r': 'bone_14', 'lowerarm_r': 'bone_15', 'hand_r': 'bone_16',
              'thigh_l': 'bone_20', 'calf_l': 'bone_21', 'foot_l': 'bone_22', 'ball_l': 'bone_23',
              'thigh_r': 'bone_24', 'calf_r': 'bone_25', 'foot_r': 'bone_26', 'ball_r': 'bone_27'}


def build_unirig(mesh):
    """Import UniRig's predicted skeleton (normalised to a 2-unit-tall box), fit it to our mesh, rename the humanoid bones."""
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.fbx(filepath=os.path.join(RAW, 'unirig-skeleton.fbx'))
    new = [o for o in bpy.context.scene.objects if o not in before]
    arm = [o for o in new if o.type == 'ARMATURE'][0]
    for o in new:
        if o.type != 'ARMATURE':
            bpy.data.objects.remove(o)
    # normalised box z in [-1, 1] -> our 1.8 tall figure with feet at z = 0
    arm.parent = None
    arm.scale = (0.9, 0.9, 0.9)
    arm.location = (0, 0, 0.9)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for sk, bn in UNIRIG_MAP.items():
        arm.data.bones[bn].name = sk
    arm.name = 'Armature'
    return arm


def skin(mesh, tgt):
    """Blender automatic weights. The raw mesh has split vertices (UV seams) and fails bone heat, so the weights are solved
    on a welded copy and copied to the original vertices by position."""
    import bmesh
    from mathutils.kdtree import KDTree
    weld = mesh.copy()
    weld.data = mesh.data.copy()
    weld.name = 'weld'
    bpy.context.scene.collection.objects.link(weld)
    bm = bmesh.new()
    bm.from_mesh(weld.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(weld.data)
    bm.free()
    print('WELDED', len(mesh.data.vertices), '->', len(weld.data.vertices))
    bpy.ops.object.select_all(action='DESELECT')
    weld.select_set(True)
    tgt.select_set(True)
    bpy.context.view_layer.objects.active = tgt
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    wd = weld.data
    kd = KDTree(len(wd.vertices))
    for v in wd.vertices:
        kd.insert(v.co, v.index)
    kd.balance()
    names = [g.name for g in weld.vertex_groups]
    for n in names:
        mesh.vertex_groups.new(name=n)
    for v in mesh.data.vertices:
        _, j, _ = kd.find(v.co)
        for g in wd.vertices[j].groups:
            if g.weight > 1e-4:
                mesh.vertex_groups[names[g.group]].add([v.index], g.weight, 'REPLACE')
    bpy.data.objects.remove(weld)
    mesh.parent = tgt
    mesh.matrix_parent_inverse = tgt.matrix_world.inverted()
    mod = mesh.modifiers.new('Armature', 'ARMATURE')
    mod.object = tgt
    bpy.ops.object.select_all(action='DESELECT')
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
    fill_unweighted(mesh)


def fill_unweighted(mesh):
    from mathutils.kdtree import KDTree
    me = mesh.data
    w = {v.index: {g.group: g.weight for g in v.groups if g.weight > 1e-6} for v in me.vertices}
    bad = [i for i, d in w.items() if not d]
    print('UNWEIGHTED', len(bad), 'of', len(me.vertices))
    if not bad:
        return
    kd = KDTree(len(me.vertices))
    for v in me.vertices:
        if w[v.index]:
            kd.insert(v.co, v.index)
    kd.balance()
    for i in bad:
        _, j, _ = kd.find(me.vertices[i].co)
        for g, wt in w[j].items():
            mesh.vertex_groups[g].add([i], wt, 'REPLACE')


def weapon_socket(rt, shotgun_dims):
    """Right-hand socket + left-hand grip, from the aim pose (retargeted Pistol_Aim_Neutral at its last frame)."""
    la = L.action_of('Pistol_Aim_Neutral')
    delta, _ = rt.src_state(la, la.frame_range[1])
    R = rt.target_world(delta)
    H = rt.fk(R, Vector((0, 0, 0)))
    f = (H['hand_r'] - H['lowerarm_r']).normalized()
    up = Vector((0, 0, 1))
    x_w = -f  # weapon local -X = barrel
    z_w = (up - x_w * up.dot(x_w)).normalized()
    y_w = z_w.cross(x_w)
    Rw = Matrix((x_w, y_w, z_w)).transposed()
    Lg, Hg = shotgun_dims['length'], shotgun_dims['height']
    # weapon local frame: origin at the length centre, z from 0 (bottom of stock) to Hg; barrel tip at x = -Lg/2
    grip_r = Vector((-Lg / 2 + 0.76 * Lg, 0.0, 0.45 * Hg))      # pistol grip
    grip_l = Vector((-Lg / 2 + GRIPL * Lg, 0.0, 0.62 * Hg))      # pump / fore-end
    muzzle = Vector((-Lg / 2, 0.0, 0.85 * Hg))
    ydir = R['hand_r'] @ Vector((0, 1, 0))
    palm = 0.07
    p_palm = H['hand_r'] + ydir * palm
    Wm = Matrix.Translation(p_palm - Rw @ grip_r) @ Rw.to_4x4()
    Whand = Matrix.Translation(H['hand_r']) @ R['hand_r'].to_4x4()
    S = Whand.inverted() @ Wm
    return {'S': S, 'grip_l': grip_l, 'grip_r': grip_r, 'muzzle': muzzle, 'palm': palm}


def main():
    L.clean_scene()
    body_objs = L.import_glb(os.path.join(RAW, 'enforcer-body.final.glb'))
    mesh = [o for o in body_objs if o.type == 'MESH'][0]
    mesh.name = 'enforcer'
    for o in body_objs:
        if o.type != 'MESH':
            bpy.data.objects.remove(o)
    src = L.import_ual()
    bpy.context.scene.render.fps = 24
    if RIG == 'b':
        tgt = build_unirig(mesh)
        mapping = {b: b for b in UNIRIG_MAP}
    else:
        tgt = build_target(src)
        mapping = {b: b for b in L.SRC_BONES}
    skin(mesh, tgt)
    rt = L.Retarget(src, tgt, mapping, arm_abduct_deg=ABDUCT)
    dims = json.load(open(os.path.join(RAW, 'shotgun-dims.json')))
    wp = weapon_socket(rt, dims)
    bpy.context.scene.render.fps = L.FPS
    spec = [
        ('idle', dict(lower='Pistol_Idle_Loop', loop=True)),
        ('walk', dict(lower='Walk_Loop', upper='Pistol_Idle_Loop', loop=True)),
        ('aim', dict(lower='Pistol_Aim_Neutral', loop=False, hold=1.0)),
        ('fire', dict(lower='Pistol_Shoot', loop=False)),
        ('hit', dict(lower='Hit_Chest', upper='Pistol_Idle_Loop', upper_set=L.ARMS, loop=False)),
    ]
    metrics = {'k_leg_ratio': rt.k, 'abduct_deg': ABDUCT, 'clips': {}}
    for name, kw in spec:
        # the sampling clock of the source depends on the scene fps at import time (24)
        bpy.context.scene.render.fps = 24
        dry = L.bake_clip(rt, name, weapon=wp, write=False, **kw)
        rest_z = min(rt.Ht['ball_l'][2], rt.Ht['ball_r'][2])
        dz = rest_z - min(min(r['ball_l'][2], r['ball_r'][2]) for r in dry)
        rows = L.bake_clip(rt, name, weapon=wp, dz=dz, **kw)
        metrics['clips'][name] = {'frames': len(rows), 'foot': L.foot_metrics(rows),
                                  'ik_err_max': max(r.get('ik_err', 0) for r in rows)}
        json.dump(rows, open(os.path.join(RAW, f'{RIG}-rows-{name}.json'), 'w'))
    bpy.context.scene.render.fps = L.FPS
    if '--preview' in sys.argv:
        L.render_previews(tgt, wp['S'], os.path.join(RAW, f'prev-{RIG}'), [n for n, _ in spec])
    # leave only the target rig and mesh
    bpy.data.objects.remove(src)
    tgt.animation_data.action = None
    bpy.ops.object.select_all(action='DESELECT')
    mesh.select_set(True)
    tgt.select_set(True)
    sock = {'hand_r_rest': [list(r) for r in tgt.data.bones['hand_r'].matrix_local], 'hand_l_rest': [list(r) for r in tgt.data.bones['hand_l'].matrix_local],
            'S_blender': [list(r) for r in wp['S']], 'grip_l': list(wp['grip_l']), 'grip_r': list(wp['grip_r']),
            'muzzle': list(wp['muzzle']), 'palm': wp['palm']}
    json.dump(sock, open(os.path.join(RAW, f'{RIG}-socket.json'), 'w'))
    json.dump(metrics, open(os.path.join(RAW, f'{RIG}-metrics.json'), 'w'), indent=1)
    print('DBG', [(o.name, o.type, [m.type for m in o.modifiers], len(o.vertex_groups), o.parent.name if o.parent else None) for o in bpy.context.scene.objects])
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_image_format='JPEG',
                              export_yup=True, export_animations=True, export_nla_strips=True, export_force_sampling=True,
                              export_frame_range=False, export_def_bones=False, export_apply=False)
    print('EXPORTED', OUT, os.path.getsize(OUT) / 1e6, 'MB')


main()
