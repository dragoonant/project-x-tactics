r"""Joint table from UniRig's predicted skeleton (skeleton stage only), by topology (no bone indices).

Run with the Hunyuan3D-2.1 venv python:
  python tools/anim/a1_skel.py <body.glb> <unirig_skeleton.fbx> <out.joints.json>

UniRig normalises the input mesh to a [-1, 1] box (uniform scale, bbox centre), so skeleton coordinates map back as
p = bbox_centre + sk * (max_extent / 2). The mapping then follows the tree: root = pelvis; the up-going chain to the first
three-way fork = spine; at the fork the centre chain = neck/head, the two lateral chains = arms; the two down-going chains
from the spine base = legs; left/right by the sign of x (character left = +X, front = -Y in Blender). Both sides are averaged
(mirrored) so the table is symmetric. Output keys are the same as the A0 table `J` of rig_a.py.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Vector


def mesh_bbox(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    pts = []
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            pts += [o.matrix_world @ v.co for v in o.data.vertices]
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    return lo, hi, pts


def load_skeleton(fbx):
    bpy.ops.import_scene.fbx(filepath=fbx)
    arm = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE'][0]
    B = {}
    for b in arm.data.bones:
        B[b.name] = {'head': arm.matrix_world @ b.head_local, 'tail': arm.matrix_world @ b.tail_local,
                     'parent': b.parent.name if b.parent else None, 'kids': [c.name for c in b.children]}
    return B


def chain_down(B, start):
    """first-child path from `start`"""
    out = [start]
    while B[out[-1]]['kids']:
        ks = B[out[-1]]['kids']
        out.append(ks[0] if len(ks) == 1 else max(ks, key=lambda k: subtree_len(B, k)))
    return out


def subtree(B, b):
    s = [b]
    for k in B[b]['kids']:
        s += subtree(B, k)
    return s


def subtree_len(B, b):
    return len(subtree(B, b))


def max_z(B, b):
    return max(max(B[x]['head'][2], B[x]['tail'][2]) for x in subtree(B, b))


def min_z(B, b):
    return min(min(B[x]['head'][2], B[x]['tail'][2]) for x in subtree(B, b))


def max_absx(B, b):
    return max(max(abs(B[x]['head'][0]), abs(B[x]['tail'][0])) for x in subtree(B, b))


def crotch_z(pts, cx, zfloor, H):
    """Lowest height at which the mid-line (|x - cx| < 0.04, any y) is solid: the crotch. None if not found."""
    bins = {}
    for p in pts:
        if abs(p[0] - cx) < 0.04:
            k = int((p[2] - zfloor) / 0.02)
            bins[k] = bins.get(k, 0) + 1
    hi_ref = sorted(bins.get(k, 0) for k in range(int(0.55 * H / 0.02), int(0.7 * H / 0.02)))
    if not hi_ref:
        return None
    ref = hi_ref[len(hi_ref) // 2]
    for k in range(int(0.12 * H / 0.02), int(0.45 * H / 0.02)):
        if bins.get(k, 0) > 0.5 * ref and bins.get(k + 1, 0) > 0.5 * ref and bins.get(k + 2, 0) > 0.5 * ref:
            return zfloor + k * 0.02
    return None


def map_skeleton(B):
    roots = [b for b in B if B[b]['parent'] is None]
    root = max(roots, key=lambda r: subtree_len(B, r))
    legs, spine = [], [root]
    cur = root
    fork = None
    for _ in range(12):
        kids = B[cur]['kids']
        down = [k for k in kids if max_z(B, k) < B[cur]['head'][2] + 0.02 * 1 and min_z(B, k) < B[cur]['head'][2] - 0.1]
        legs += down
        up = [k for k in kids if k not in down]
        if len(up) >= 2:
            fork = cur
            break
        if not up:
            break
        cur = up[0]
        spine.append(cur)
    if fork is None or len(legs) != 2:
        raise RuntimeError(f'topology not a biped: fork={fork} legs={legs}')
    kids = B[fork]['kids']
    cx = B[root]['head'][0]
    neck_k = [k for k in kids if abs(B[k]['head'][0] - cx) < 0.06 and max_absx(B, k) < 0.2]
    arms = [k for k in kids if k not in neck_k]
    if len(neck_k) != 1 or len(arms) != 2:
        # fall back: neck = highest centred kid
        neck_k = [max(kids, key=lambda k: max_z(B, k) - 10 * max_absx(B, k))]
        arms = [k for k in kids if k not in neck_k]
    if len(arms) != 2:
        raise RuntimeError(f'arms not found at fork {fork}: kids {kids}')
    return root, spine, fork, neck_k[0], arms, legs


def arm_joints(B, k):
    ch = chain_down(B, k)
    h = lambda i: B[ch[i]]['head']
    first = B[ch[0]]
    d1 = first['tail'] - first['head']
    l1 = d1.length
    l2 = (B[ch[1]]['tail'] - B[ch[1]]['head']).length if len(ch) > 1 else 1
    clav = len(ch) >= 5 and l1 < 0.85 * l2 and abs(d1[2]) < 0.6 * max(abs(d1[0]), 1e-6)
    i = 1 if clav else 0
    j = {'upperarm': h(i), 'lowerarm': h(i + 1), 'hand': h(i + 2)}
    j['hand_tip'] = B[ch[i + 2]]['tail']
    j['clavicle'] = h(0) if clav else None
    return j


def leg_joints(B, k):
    ch = chain_down(B, k)
    j = {'thigh': B[ch[0]]['head'], 'calf': B[ch[1]]['head'], 'foot': B[ch[2]]['head']}
    if len(ch) >= 4:
        j['ball'] = B[ch[3]]['head']
        j['leaf'] = B[ch[3]]['tail']
    else:
        j['leaf'] = B[ch[2]]['tail']
        j['ball'] = B[ch[2]]['head'] * 0.35 + B[ch[2]]['tail'] * 0.65
    return j


def main():
    body, fbx, out = [os.path.abspath(a) for a in sys.argv[1:4]]
    lo, hi, pts = mesh_bbox(body)
    centre = (lo + hi) / 2
    E = max(hi - lo)
    B = load_skeleton(fbx)
    for b in B.values():
        b['head'] = centre + b['head'] * (E / 2)
        b['tail'] = centre + b['tail'] * (E / 2)
    root, spine, fork, neck_k, arms, legs = map_skeleton(B)
    print('MAP root', root, 'spine', spine, 'fork', fork, 'neck', neck_k, 'arms', arms, 'legs', legs)
    side = lambda k: 'l' if B[k]['tail'][0] > centre[0] else 'r'
    A = {side(k): arm_joints(B, k) for k in arms}
    G = {side(k): leg_joints(B, k) for k in legs}
    assert set(A) == {'l', 'r'} and set(G) == {'l', 'r'}, (A.keys(), G.keys())
    mir = lambda v: Vector((2 * centre[0] - v[0], v[1], v[2]))

    def avg(name, d):
        l, r = d['l'][name], d['r'][name]
        if l is None or r is None:
            return None
        rm = mir(r)
        return (l + rm) / 2

    cx = centre[0]
    sp = [B[b]['head'] for b in spine]               # pelvis root, spine bones..., up to the fork bone
    chest = B[fork]
    # spine_01..03 heads
    inner = spine[1:]
    if len(inner) >= 3:
        s1, s2, s3 = B[inner[0]]['head'], B[inner[len(inner) // 2]]['head'], B[inner[-1]]['head']
    elif len(inner) == 2:
        s1, s3 = B[inner[0]]['head'], B[inner[1]]['head']
        s2 = (s1 + s3) / 2
    else:
        p0, p1 = B[root]['head'], chest['tail']
        s1, s2, s3 = p0 * 0.75 + p1 * 0.25, p0 * 0.5 + p1 * 0.5, p0 * 0.25 + p1 * 0.75
    nk = chain_down(B, neck_k)
    neck_head = B[nk[0]]['head']
    head_head = B[nk[1]]['head'] if len(nk) >= 2 else (B[nk[0]]['head'] * 0.5 + B[nk[0]]['tail'] * 0.5)
    head_tip = B[nk[-1]]['tail']
    J = {'pelvis': B[root]['head'] * 0.35 + B[root]['tail'] * 0.65, 'spine_01': s1, 'spine_02': s2, 'spine_03': s3, 'neck_01': neck_head, 'Head': head_head, 'Head_tip': head_tip}
    for k in ('pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head', 'Head_tip'):
        J[k] = Vector((cx, J[k][1], J[k][2]))
    up = avg('upperarm', A)
    clavh = avg('clavicle', A)
    if clavh is None:
        clavh = Vector((cx, up[1], up[2])) * 0.72 + up * 0.28
        clavh = Vector((cx + (up[0] - cx) * 0.3, up[1], up[2] + 0.02))
    J['clavicle_l'] = clavh
    for n, key in (('upperarm_l', 'upperarm'), ('lowerarm_l', 'lowerarm'), ('hand_l', 'hand'), ('hand_l_tip', 'hand_tip')):
        J[n] = avg(key, A)
    for n, key in (('thigh_l', 'thigh'), ('calf_l', 'calf'), ('foot_l', 'foot'), ('ball_l', 'ball'), ('ball_leaf_l', 'leaf')):
        J[n] = avg(key, G)
    # UniRig predicts a generic human: the hips come out about 0.15 too high for our short-legged figures. Re-derive the lower body
    # from the mesh: crotch height from the sagittal slice (when a coat hides the gap, fall back to the height prior).
    H_fig = hi[2] - lo[2]
    prior = lo[2] + 0.30 * H_fig
    zc = crotch_z(pts, cx, lo[2], H_fig)
    hip_z = prior
    if zc is not None and prior - 0.12 * H_fig / 1.8 < zc + 0.06 * H_fig / 1.8 < prior + 0.12 * H_fig / 1.8:
        hip_z = zc + 0.06 * H_fig / 1.8
    sc = H_fig / 1.8
    J['thigh_l'] = Vector((J['thigh_l'][0], J['thigh_l'][1], hip_z))
    ank = J['foot_l']
    kz = ank[2] + 0.44 * (hip_z - ank[2])
    t = (kz - ank[2]) / max(hip_z - ank[2], 1e-6)
    J['calf_l'] = Vector((ank[0] + (J['thigh_l'][0] - ank[0]) * t, J['calf_l'][1], kz))
    J['pelvis'] = Vector((cx, J['pelvis'][1], hip_z + 0.06 * sc))
    J['spine_01'] = Vector((cx, J['spine_01'][1], J['pelvis'][2] + 0.35 * (J['spine_02'][2] - J['pelvis'][2])))
    J['Head_tip'] = Vector((cx, J['Head_tip'][1], hi[2] - 0.03 * sc))
    ank = J['foot_l']
    J['ball_l'] = Vector((ank[0] + (J['ball_l'][0] - ank[0]) * 0.3, ank[1] + (J['ball_l'][1] - ank[1]) * 0.85, J['ball_l'][2]))
    J['ball_leaf_l'] = J['ball_l'] + Vector((0, -0.11 * sc, -0.01))
    print('LOWER BODY crotch', zc, 'hip', hip_z)
    # keep the left side on the +X side of the centre line, in absolute coordinates (the rig is built around x = 0)
    out_J = {}
    for k, v in J.items():
        out_J[k] = [round(v[0] - cx, 4), round(v[1], 4), round(v[2], 4)]
    # feet must be above the floor (UniRig overshoots the soles)
    zmin = lo[2]
    for n in ('ball_leaf_l', 'ball_l', 'foot_l'):
        out_J[n][2] = max(out_J[n][2], round(zmin + {'ball_leaf_l': 0.025, 'ball_l': 0.05, 'foot_l': 0.11}[n], 4))
    report = {'bbox_lo': list(lo), 'bbox_hi': list(hi), 'raw_asymmetry': {n: round((A['l'][n] - mir(A['r'][n])).length, 3) for n in ('upperarm', 'lowerarm', 'hand')}}
    json.dump({'J': out_J, 'report': report, 'map': {'root': root, 'spine': spine, 'fork': fork, 'neck': nk, 'arms': arms, 'legs': legs}}, open(out, 'w'), indent=1)
    print('JOINTS', json.dumps(out_J))


main()
