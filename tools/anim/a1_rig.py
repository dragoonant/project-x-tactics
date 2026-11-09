r"""A1/A2: rig one figure (UAL skeleton fitted to the joint table from UniRig, Blender auto weights, items attached), bake all of
its canonical clips and export a GLB. Run with the Hunyuan3D-2.1 venv python (bpy 4.0):
  python tools/anim/a1_rig.py <kind> [--body f.glb] [--joints f.json] [--clips a,b] [--preview] [--out f.glb]
Outputs in art/rig/raw/: <kind>.rigged.glb, <kind>.meta.json (clips, speeds, attachments in glTF space, metrics).
"""
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import animlib as L  # noqa: E402
import a1lib as A  # noqa: E402
import a1_clips  # noqa: E402
import a1_catalog as C  # noqa: E402

RAW = os.path.join(A.ROOT, 'art', 'rig', 'raw')
CFG = json.load(open(os.path.join(A.ROOT, 'tools', 'anim', 'figures.json')))
kind = sys.argv[1]
arg = lambda n, d=None: sys.argv[sys.argv.index('--' + n) + 1] if '--' + n in sys.argv else d
fig = dict(CFG['figures'][kind])
BODY = arg('body', os.path.join(RAW, kind + '.body.glb'))
JOINTS = arg('joints', os.path.join(RAW, kind + '.joints.json'))
OUT = arg('out', os.path.join(RAW, kind + '.rigged.glb'))
want = arg('clips').split(',') if arg('clips') else fig['clips']
ABDUCT = float(arg('abduct', 14.0))
Cg2b = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))  # Blender -> glTF


def item_dims(iid):
    p = os.path.join(RAW, 'items', iid + '.dims.json')
    if os.path.exists(p):
        return json.load(open(p))
    ln = CFG['items'][iid]['len']          # item not generated yet: placeholder box so the sockets can be developed
    print('PLACEHOLDER dims for', iid)
    return {'id': iid, 'length': ln, 'width': 0.1 * ln, 'height': (1.0 if iid == 'riot-shield' else 0.8 if iid == 'case' else 0.22) * (ln if iid not in ('riot-shield', 'case') else ln)}


def frame_of(rg, arch_clip, t=0.0, end=False):
    rt = rg.rt
    a = rg.action(arch_clip)
    f = a.frame_range[1] if end else a.frame_range[0]
    d, _ = rt.src_state(a, f)
    R = rt.target_world(d)
    return R, rt.fk(R, Vector((0, 0, 0)))


def basis_from_front(fdir, up=Vector((0, 0, 1))):
    """item rotation so that item -X (the front end) points along fdir, item z as close to `up` as possible"""
    x_w = -fdir.normalized()
    z_w = (up - x_w * up.dot(x_w))
    if z_w.length < 1e-4:
        z_w = Vector((0, 1, 0))
    z_w.normalize()
    y_w = z_w.cross(x_w)
    return Matrix((x_w, y_w, z_w)).transposed()


def hand_socket(rg, iid, side, R, H, fdir, grip_key='grip_r', up=Vector((0, 0, 1)), palm=0.07):
    """Item -> hand bone socket in the given reference pose: the item's grip point at the palm, front end along fdir."""
    it = CFG['items'][iid]
    d = item_dims(iid)
    Lg, Hg = d['length'], d['height']
    Rw = basis_from_front(fdir, up)
    g = it[grip_key]
    grip = Vector((-Lg / 2 + g[0] * Lg, 0.0, g[1] * Hg))
    hand = 'hand_' + side
    ydir = R[hand] @ Vector((0, 1, 0))
    p_palm = H[hand] + ydir * palm
    Wm = Matrix.Translation(p_palm - Rw @ grip) @ Rw.to_4x4()
    Whand = Matrix.Translation(H[hand]) @ R[hand].to_4x4()
    S = Whand.inverted() @ Wm
    m = it['muzzle']
    return {'id': iid, 'bone': hand, 'S': S, 'palm': palm, 'Lg': Lg, 'Hg': Hg,
            'grip_r': grip, 'muzzle': Vector((-Lg / 2 + m[0] * Lg, 0.0, m[1] * Hg)),
            'grip_l': (Vector((-Lg / 2 + it['grip_l'][0] * Lg, 0.0, it['grip_l'][1] * Hg)) if 'grip_l' in it else None)}


def gun_socket(rg, iid):
    """A0 method: the barrel runs along the forearm in the aim pose, up = world up; right hand."""
    R, H = frame_of(rg, 'Pistol_Aim_Neutral', end=True)
    f = (H['hand_r'] - H['lowerarm_r']).normalized()
    return hand_socket(rg, iid, 'r', R, H, f)


def melee_socket(rg, iid, ref_clip, tilt=(0.0, -0.55, 0.84), side='r', grip_key='grip_r'):
    R, H = frame_of(rg, ref_clip)
    return hand_socket(rg, iid, side, R, H, Vector(tilt), grip_key=grip_key)


def upright_socket(rg, iid, bone, ref_clip, side):
    """shield (forearm) or case (hand): upright item, face towards -Y, placed in the reference pose"""
    d = item_dims(iid)
    R, H = frame_of(rg, ref_clip)
    if iid == 'riot-shield':
        mid = (H['lowerarm_' + side] + H['hand_' + side]) / 2
        Rw = Matrix.Identity(3)
        c = Vector((-0.0, d['height'] / 2 * 0 + 0.0, d['height'] / 2))
        p = mid + Vector((0.24, -0.08, -0.05))   # outboard of the left forearm: the shield stands at the figure's left, not over the face
        Wm = Matrix.Translation(p - c) @ Rw.to_4x4()
        bone_name = 'lowerarm_' + side
    else:
        Rw = Matrix(((0, 1, 0), (-1, 0, 0), (0, 0, 1)))   # width along world Y, thickness along X
        grip = Vector((0, 0, d['height']))
        hand = 'hand_' + side
        ydir = R[hand] @ Vector((0, 1, 0))
        p = H[hand] + ydir * 0.06
        Wm = Matrix.Translation(p - Rw @ grip) @ Rw.to_4x4()
        bone_name = hand
    Wb = Matrix.Translation(H[bone_name]) @ R[bone_name].to_4x4()
    return {'id': iid, 'bone': bone_name, 'S': Wb.inverted() @ Wm, 'palm': 0.0, 'Lg': d['length'], 'Hg': d['height'], 'muzzle': Vector((0, 0, 0))}


def to_gltf_matrix(S):
    """item-local (glTF) -> bone-local (glTF), row-major list: Sg = S_b @ C^-1 for the convention checked at export."""
    return S @ Cg2b.inverted()


def main():
    L.clean_scene()
    objs = A.L.import_glb(BODY)
    mesh = [o for o in objs if o.type == 'MESH'][0]
    mesh.name = kind
    for o in objs:
        if o.type != 'MESH':
            bpy.data.objects.remove(o)
    # triangle budget (coordinator): at most 20k triangles per rigged body, decimated before weighting
    src =L.import_ual()
    bpy.context.scene.render.fps = 24
    J = json.load(open(JOINTS))['J']
    if fig.get('arms_from'):   # UniRig's arms were off for this body (bone heat could not solve): borrow the arm joints of a figure with the same pose and cut
        Jo = json.load(open(os.path.join(RAW, fig['arms_from'] + '.joints.json')))['J']
        for k in ('clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'hand_l_tip'):
            J[k] = Jo[k]
        print('ARMS borrowed from', fig['arms_from'])
    tgt = A.build_target(src, J)
    coat = None
    if fig.get('coat'):
        h = fig['height']
        coat = dict(z_top=J['thigh_l'][2] + 0.02 * h / 1.8, z_bot=J['calf_l'][2] - 0.05 * h / 1.8, keep=float(arg('coat_keep', 0.35)), x_leg=J['thigh_l'][0] * 0.55)
    A.skin(mesh, tgt, coat=coat)
    tris = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
    if tris > 24000 and '--decimate' in sys.argv:   # NOT default: Blender decimation of the UV-split mesh leaves holes; the budget is met in Hunyuan (faceCount)
        bpy.ops.object.select_all(action='DESELECT')
        mesh.select_set(True)
        bpy.context.view_layer.objects.active = mesh
        mod = mesh.modifiers.new('dec', 'DECIMATE')
        mod.ratio = 19500.0 / tris
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_move_to_index(modifier='dec', index=0)
        bpy.ops.object.modifier_apply(modifier='dec')
    TRIS[0] = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
    print('TRIS', tris, '->', TRIS[0])
    rg = A.Rig(src, tgt, abduct=ABDUCT)
    arch = fig['arch']

    # ---- items and sockets -------------------------------------------------------------------------------------------
    attachments, sockets = [], {}
    wp = None
    if fig['right']:
        kind_r = CFG['items'][fig['right']]['kind']
        if kind_r in ('gun', 'gun1'):
            wp = gun_socket(rg, fig['right'])
        else:
            wp = melee_socket(rg, fig['right'], 'Sword_Idle' if arch == 'melee' else 'Idle_Loop')
        sockets['right'] = wp
        attachments.append(wp)
    if fig.get('swap'):
        sw = melee_socket(rg, fig['swap'], 'Pistol_Idle_Loop', tilt=(0.0, -0.5, 0.86))
        sockets['swap'] = sw
        attachments.append(sw)
    if fig['left']:
        li = fig['left']
        k = CFG['items'][li]['kind']
        if k == 'upright':
            ls = upright_socket(rg, li, 'lowerarm_l' if li == 'riot-shield' else 'hand_l', 'Pistol_Idle_Loop' if li == 'riot-shield' else 'Idle_Loop', 'l')
        else:
            tilt = {'baton': (0.0, -0.75, -0.65), 'handset': (0.0, -0.25, 0.95), 'injector': (0.0, -0.75, 0.65)}.get(li, (0, -0.6, 0.8))
            ls = melee_socket(rg, li, 'Idle_Loop', tilt=tilt, side='l')
        sockets['left'] = ls
        attachments.append(ls)
    fig['two_hand'] = arch == 'long' or (arch == 'melee' and 'grip_l' in CFG['items'].get(fig['right'] or '', {}))

    # ---- clips -----------------------------------------------------------------------------------------------------------
    bpy.context.scene.render.fps = 24
    B = a1_clips.Builder(rg, fig, wp if (fig['two_hand'] and wp and wp.get('grip_l') is not None) else None)
    B.full_wp = wp
    clips, meta = {}, {'kind': kind, 'height': fig['height'], 'triangles': TRIS[0], 'clips': {}, 'metrics': {}}
    for name in want:
        built = C.build_clip(B, name)
        if built is None:
            print('SKIP clip', name)
            continue
        frames, loop, dur = built
        rows = rg.bake(name, frames, loop)
        n = len(frames)
        meta['clips'][name] = {'duration': round((n if loop else n - 1) / FPS_, 4), 'loop': bool(loop), 'frames': n}
        clips[name] = rows
        if name in ('walk', 'run'):
            sp, rel = stride_speed(rows, 0.012 if name == 'walk' else 0.045)
            meta['clips'][name]['speed'] = round(sp, 4)
            meta['metrics'][name] = {'stanceSpeedRelStd': round(rel, 3)}
        print('CLIP', name, n, 'frames', loop)
    bpy.context.scene.render.fps = FPS_

    # ---- tearing metric ----------------------------------------------------------------------------------------------------
    if '--stretch' in sys.argv:
        bpy.context.scene.render.fps = 24
        for name in ('walk', 'run', 'surrender', 'downed', 'cower'):
            if name in clips:
                act = bpy.data.actions[name]
                n = int(act.frame_range[1])
                res = A.edge_stretch(mesh, tgt, act, [int(n * k / 5) for k in range(6)])
                meta['metrics'].setdefault(name, {})['edge_stretch'] = {'p999': round(max(r['p999'] for r in res), 3), 'max': round(max(r['max'] for r in res), 3)}
                print('STRETCH', name, meta['metrics'][name]['edge_stretch'])
        bpy.context.scene.render.fps = FPS_

    # ---- preview ---------------------------------------------------------------------------------------------------------
    if '--preview' in sys.argv:
        render_previews(rg, mesh, sockets, [c for c in clips], arg('pdir', os.path.join(RAW, 'prev', kind)))

    # ---- export --------------------------------------------------------------------------------------------------------------
    bpy.data.objects.remove(src)
    tgt.animation_data.action = None
    bpy.ops.object.select_all(action='DESELECT')
    mesh.select_set(True)
    tgt.select_set(True)
    for o in list(bpy.context.scene.objects):
        if o not in (mesh, tgt):
            bpy.data.objects.remove(o)
    meta['attachments'] = []
    hand_rest = {b: [list(r) for r in tgt.data.bones[b].matrix_local] for b in ('hand_r', 'hand_l', 'lowerarm_l', 'lowerarm_r')}
    for s in attachments:
        meta['attachments'].append({'id': s['id'], 'bone': s['bone'], 'S_blender': [list(r) for r in s['S']],
                                    'muzzle_blender': list(s['muzzle']), 'Lg': s['Lg'], 'Hg': s['Hg']})
    meta['bone_rest'] = hand_rest
    json.dump(meta, open(os.path.join(RAW, kind + '.meta.json'), 'w'), indent=1)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_image_format='JPEG', export_yup=True,
                              export_animations=True, export_nla_strips=True, export_force_sampling=True,
                              export_frame_range=False, export_def_bones=False, export_apply=False)
    print('EXPORTED', OUT, round(os.path.getsize(OUT) / 1e6, 2), 'MB')


FPS_ = L.FPS
TRIS = [0]


def stride_speed(rows, thr=0.012):
    import statistics
    out = []
    for side in ('ball_l', 'ball_r'):
        z = [r[side][2] for r in rows]
        y = [r[side][1] for r in rows]
        stance = [zz < min(z) + thr for zz in z]
        v = [(y[i + 1] - y[i]) * FPS_ for i in range(len(y) - 1) if stance[i] and stance[i + 1]]
        out += v
    if not out:
        return 0.0, 0.0
    med = statistics.median(out)
    return med, (statistics.pstdev(out) / max(abs(med), 1e-6))


def render_previews(rg, mesh, sockets, clips, outd, n=6, size=380):
    """Workbench contact frames of the baked actions with the items attached (dev check; final media come from the lab page)."""
    tgt = rg.tgt
    os.makedirs(outd, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = 'TEXTURE'
    w = bpy.data.worlds.new('w')
    w.color = (0.75, 0.75, 0.75)
    sc.world = w
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 2.3
    items = []
    for key, s in sockets.items():
        p = os.path.join(RAW, 'items', s['id'] + '.glb')
        if not os.path.exists(p):
            continue
        objs = L.import_glb(p)
        m = [o for o in objs if o.type == 'MESH'][0]
        for o in objs:
            if o is not m:
                bpy.data.objects.remove(o)
        items.append((m, s))
    tracks = list(tgt.animation_data.nla_tracks)
    for t in tracks:
        t.mute = True
    hide = {'swap'}
    for name in clips:
        act = bpy.data.actions[name]
        tgt.animation_data.action = act
        f0, f1 = act.frame_range
        loop = bool(act.get('loop'))
        for k in range(n):
            f = f0 + (f1 - f0) * k / (n if loop else n - 1)
            sc.frame_set(int(f), subframe=f - int(f))
            for m, s in items:
                m.hide_render = s['id'] == (sockets.get('swap') or {}).get('id') and name not in ('melee',)
                if s['id'] == (sockets.get('right') or {}).get('id') and name == 'melee' and 'swap' in sockets:
                    m.hide_render = True
                m.matrix_world = tgt.matrix_world @ tgt.pose.bones[s['bone']].matrix @ s['S']
            ctr = Vector((0, 0, 0.8)) if name not in ('downed', 'death') else Vector((0, 0.6, 0.3))
            for vn, loc in (('front', (0, -10, 0.9)), ('tq', (-6, -6, 3.0))):
                cam.location = loc
                cam.rotation_euler = (Vector((0, 0.3, 0.9)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
                sc.render.filepath = os.path.join(outd, f'{name}_{k}_{vn}.png')
                bpy.ops.render.render(write_still=True)
    tgt.animation_data.action = None
    for t in tracks:
        t.mute = False
    for m, s in items:
        bpy.data.objects.remove(m)


main()
