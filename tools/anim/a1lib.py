r"""A1 shared Blender helpers (bpy 4.0, run with the Hunyuan3D-2.1 venv python).

Builds on the A0 `animlib` (rotation-delta retarget onto a Quaternius UAL skeleton fitted to our mesh) and adds:
  - the library path from the main checkout (the CC0 pack is git-ignored and lives only there),
  - build_target / skin with an explicit joint table (from UniRig's predicted skeleton, see a1_skel.py),
  - a pose solver for authored clips: world-rotation modifiers + two-bone IK for arms and legs + ground contact,
  - clip baking from (R, pelvis) frames, left-hand IK onto two-handed items, edge-stretch metric for tearing.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector, Euler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import animlib as L  # noqa: E402

FPS = L.FPS
ROOT = L.ROOT


def main_root():
    d = ROOT
    while os.path.basename(d) != 'project-x' and os.path.dirname(d) != d:
        d = os.path.dirname(d)
    return d


def _ual_path():
    base = os.path.join(main_root(), 'tools', 'anim', 'vendor', 'ual')
    return os.path.join(base, os.listdir(base)[0], 'Unreal-Godot', 'UAL1_Standard.glb')


L.ual_path = _ual_path

SIDE = {'l': 1.0, 'r': -1.0}
LEG_CHAIN = {'l': ['thigh_l', 'calf_l', 'foot_l'], 'r': ['thigh_r', 'calf_r', 'foot_r']}


# ---------------------------------------------------------------------------------------------------------------------
# fitting the library skeleton to a joint table
def mirror(v):
    return Vector((-v[0], v[1], v[2]))


def build_target(src, J):
    """Copy of the A0 build_target with an explicit joint table J (left side +X, Blender z up, front -Y)."""
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
        heads[a], tails[a] = P(a), P(b)
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
    for b in eb:
        b.use_connect = False
    for name, h in heads.items():
        if name in eb and h is not None:
            eb[name].head = h
            eb[name].tail = tails[name]
    for b in eb:
        if b.name == 'root':
            continue
        if (b.tail - b.head).length < 1e-4:
            b.tail = b.head + Vector((0, 0, 0.02))
    bpy.ops.object.mode_set(mode='OBJECT')
    for b in tgt.data.bones:
        b.use_deform = not any(k in b.name for k in ('index', 'middle', 'pinky', 'ring', 'thumb', 'leaf')) and b.name != 'root'
    return tgt


def skin(mesh, tgt, coat=None):
    """Blender automatic weights on a welded copy, copied back to the original vertices by position (A0 method).
    coat = dict(z_top, z_bot, keep): optional influence reduction of the leg bones on a long garment (see reduce_leg_influence)."""
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
    if coat:
        reduce_leg_influence(mesh, tgt, **coat)


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


def reduce_leg_influence(mesh, tgt, z_top, z_bot, keep=0.35, x_leg=None):
    """Long garments (coats, aprons, cloaks): between z_bot (about the knee) and z_top (about the hip) scale down the thigh and
    calf weights of vertices that are away from the leg's own volume (|x| < x_leg, i.e. the skirt in front of or behind the
    legs) and give the removed weight to the pelvis, so the skirt follows the hips instead of tearing between the legs."""
    me = mesh.data
    vg = {g.name: g.index for g in mesh.vertex_groups}
    leg = [vg[n] for n in ('thigh_l', 'thigh_r', 'calf_l', 'calf_r') if n in vg]
    pel = vg.get('pelvis')
    n_changed = 0
    for v in me.vertices:
        z = v.co.z
        if z > z_top or z < z_bot or abs(v.co.x) > (x_leg if x_leg is not None else 1e9):
            continue
        f = keep
        moved = 0.0
        for g in v.groups:
            if g.group in leg:
                nw = g.weight * f
                moved += g.weight - nw
                mesh.vertex_groups[g.group].add([v.index], nw, 'REPLACE')
        if moved > 1e-6 and pel is not None:
            cur = 0.0
            for g in v.groups:
                if g.group == pel:
                    cur = g.weight
            mesh.vertex_groups[pel].add([v.index], cur + moved, 'REPLACE')
            n_changed += 1
    print('COAT leg influence reduced on', n_changed, 'vertices')


# ---------------------------------------------------------------------------------------------------------------------
# generic two-bone IK on the world-rotation representation used by animlib.Retarget
def ik_chain(rt, chain, R, H, target, pole):
    """Rotate chain[0] (upper) and chain[1] (lower) so the end point (head of the third bone) reaches `target`.
    chain bones are source names (animlib naming). pole = a direction hint for the middle joint."""
    u, lo, h = chain
    S, E, W = H[u], H[lo], H[h]
    l1, l2 = (E - S).length, (W - E).length
    d = target - S
    dist = min(max(d.length, abs(l1 - l2) + 1e-4), l1 + l2 - 1e-4)
    dn = d.normalized()
    pl = pole - dn * pole.dot(dn)
    if pl.length < 1e-5:
        v = E - S
        pl = v - dn * v.dot(dn)
    pl.normalize()
    a = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)
    ang = math.acos(min(1.0, max(-1.0, a)))
    E_new = S + (dn * math.cos(ang) + pl * math.sin(ang)) * l1
    W_new = S + dn * dist
    Qu = (E - S).rotation_difference(E_new - S)
    d_l = Qu.to_matrix() @ (W - E)
    Ql = d_l.rotation_difference(W_new - E_new)
    R2 = dict(R)
    R2[u] = Qu.to_matrix() @ R[u]
    R2[lo] = Ql.to_matrix() @ Qu.to_matrix() @ R[lo]
    R2[h] = Ql.to_matrix() @ Qu.to_matrix() @ R[h]
    return R2


def subtree(rt, bone):
    """Bones (source names) below `bone` including itself, in rt.order."""
    out = {bone}
    for s in rt.order:
        p = rt.tparent_src[s]
        if p in out:
            out.add(s)
    return [s for s in rt.order if s in out]


def rot_about(rt, R, bone, Q, pivot_bone=None, H=None, bones=None):
    """Apply world rotation Q (Matrix 3x3) to `bone` and everything below it. (FK positions follow from the parent rotations.)"""
    for s in (bones or subtree(rt, bone)):
        R[s] = Q @ R[s]


def euler_m(rx, ry, rz):
    return Euler((math.radians(rx), math.radians(ry), math.radians(rz)), 'XYZ').to_matrix()


FINGER_FREE = ('hand_l', 'hand_r')


class Rig:
    """Wraps animlib.Retarget with pose solving and baking."""

    def __init__(self, src, tgt, abduct=14.0):
        self.src, self.tgt = src, tgt
        self.mapping = {b: b for b in L.SRC_BONES}
        self.rt = L.Retarget(src, tgt, self.mapping, arm_abduct_deg=abduct)
        rt = self.rt
        self.La = {s: (rt.Ht['upperarm_' + s] - rt.Ht['lowerarm_' + s]).length + (rt.Ht['lowerarm_' + s] - rt.Ht['hand_' + s]).length for s in 'lr'}
        self.Lleg = {s: (rt.Ht['thigh_' + s] - rt.Ht['calf_' + s]).length + (rt.Ht['calf_' + s] - rt.Ht['foot_' + s]).length for s in 'lr'}
        self.Lthigh = (rt.Ht['thigh_l'] - rt.Ht['calf_l']).length
        self.Lshin = (rt.Ht['calf_l'] - rt.Ht['foot_l']).length
        self.rest_pelvis = rt.Ht['pelvis'].copy()
        self.rest_ball_z = min(rt.Ht['ball_l'][2], rt.Ht['ball_r'][2])
        sc = bpy.context.scene
        sc.render.fps = 24
        self.sfps = 24.0

    # ---- source clips -----------------------------------------------------------------------------------------
    def action(self, name):
        return L.action_of(name)

    def lib_delta(self, lower, t, upper=None, upper_set=None, left_from=None, right_from=None, dur=None, loop=True):
        """Sample library clips at time t (seconds, 0..dur). Returns (delta dict, scaled pelvis translation)."""
        rt = self.rt
        la = self.action(lower)
        l0, l1 = la.frame_range
        ldur = (l1 - l0) / self.sfps
        if loop and ldur > 0:
            fl = l0 + ((t / ldur) % 1.0) * (l1 - l0)
        else:
            fl = min(l0 + t * self.sfps, l1)
        dl, dp = rt.src_state(la, fl)
        delta = dict(dl)
        total = dur or ldur
        if upper:
            ua = self.action(upper)
            u0, u1 = ua.frame_range
            fu = u0 + min(t / max(total, 1e-6), 1.0) * (u1 - u0) if not loop else u0 + ((t / max(total, 1e-6)) % 1.0) * (u1 - u0)
            du, _ = rt.src_state(ua, fu)
            for b in (upper_set or L.UPPER):
                if b in du:
                    delta[b] = du[b]
        for side_from, bones in ((left_from, ['clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l']), (right_from, ['clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r'])):
            if side_from:
                nm, ph = side_from
                a2 = self.action(nm)
                f0, f1 = a2.frame_range
                d2, _ = rt.src_state(a2, f0 + (ph % 1.0) * (f1 - f0))
                for b in bones:
                    delta[b] = d2[b]
        return delta, dp * rt.k

    # ---- authored pose ----------------------------------------------------------------------------------------
    def apply_pose(self, R, dP, pose):
        """pose keys (all optional):
        dp (x,y,z) pelvis translation; pelvis_rot (rx,ry,rz deg, about the pelvis head: the whole body);
        spine (rx,ry,rz deg) lean of spine_01 and everything above it; head (rx,ry,rz deg) of neck and head;
        arm_l / arm_r: dict(off=(x,y,z) wrist offset from the shoulder joint in units of the arm length, pole=(x,y,z), in the pelvis frame);
        leg_l / leg_r: dict(ank=(x,y,z) ankle target relative to the rest ankle (world, feet stay on the floor when the pelvis drops),
                            pole=(x,y,z), pitch=deg foot pitch);
        ground: dict(contacts...) handled by ground()."""
        rt = self.rt
        R = dict(R)
        dP = Vector(dP) + Vector(pose.get('dp', (0, 0, 0)))
        Qp = euler_m(*pose['pelvis_rot']) if 'pelvis_rot' in pose else Matrix.Identity(3)
        if 'pelvis_rot' in pose:
            rot_about(rt, R, 'pelvis', Qp)
        if 'spine' in pose:
            rot_about(rt, R, 'spine_01', euler_m(*pose['spine']))
        if 'spine3' in pose:
            rot_about(rt, R, 'spine_03', euler_m(*pose['spine3']))
        if 'head' in pose:
            rot_about(rt, R, 'neck_01', euler_m(*pose['head']))
        H = rt.fk(R, dP)
        for side in 'lr':
            key = 'leg_' + side
            if key in pose:
                lp = pose[key]
                tgt = rt.Ht['foot_' + side] + Vector(lp.get('ank', (0, 0, 0)))
                if lp.get('rel_pelvis'):
                    tgt = H['pelvis'] + Qp @ (rt.Ht['foot_' + side] - rt.Ht['pelvis'] + Vector(lp.get('ank', (0, 0, 0))))
                R = ik_chain(rt, LEG_CHAIN[side], R, H, tgt, Vector(lp.get('pole', (0, -1, 0))))
                pit = euler_m(lp.get('pitch', 0.0), 0, 0)
                for b in ('foot_' + side, 'ball_' + side):
                    R[b] = pit @ rt.Rt[b]
                H = rt.fk(R, dP)
        for side in 'lr':
            key = 'arm_' + side
            if key in pose:
                ap = pose[key]
                S = H['upperarm_' + side]
                off = Vector(ap['off']) * self.La[side]
                tgt = S + Qp @ off if ap.get('body_frame') else S + off
                pole = Vector(ap.get('pole', (SIDE[side], 0.3, -0.3)))
                if ap.get('body_frame'):
                    pole = Qp @ pole
                R = ik_chain(rt, L.ARM_CHAIN[side], R, H, tgt, pole)
                if 'hand_rot' in ap:
                    R['hand_' + side] = euler_m(*ap['hand_rot']) @ R['hand_' + side]
                H = rt.fk(R, dP)
        return R, dP

    # ---- contacts -----------------------------------------------------------------------------------------------
    def contact_need(self, H, contacts):
        """Lift needed (>= 0) so that every contact point is above its radius: contacts = {bone: radius}."""
        need = 0.0
        for b, r in contacts.items():
            need = max(need, r - H[b][2])
        return need

    # ---- weapons --------------------------------------------------------------------------------------------------
    def left_hand_ik(self, R, dP, weapon):
        rt = self.rt
        H = rt.fk(R, dP)
        Whand = Matrix.Translation(H['hand_r']) @ R['hand_r'].to_4x4()
        Wep = Whand @ weapon['S']
        grip_w = Wep @ weapon['grip_l']
        ydir = R['hand_l'] @ Vector((0, 1, 0))
        wt = grip_w - ydir * weapon['palm']
        R2 = rt.two_bone_ik('l', R, H, wt)
        H2 = rt.fk(R2, dP)
        return R2, (H2['hand_l'] - wt).length

    # ---- baking ---------------------------------------------------------------------------------------------------
    def bake(self, name, frames, loop, write=True):
        """frames: list of (R, dP). Writes an action `name` on the target armature, parks it on an NLA track. Returns rows."""
        rt, tgt = self.rt, self.tgt
        tgt.animation_data_create()
        act = bpy.data.actions.new(name) if write else None
        if write:
            tgt.animation_data.action = act
        for pb in tgt.pose.bones:
            pb.rotation_mode = 'QUATERNION'
        prev_q = {}
        rows = []
        for i, (R, dP) in enumerate(frames):
            H = rt.fk(R, dP)
            rows.append({k: tuple(H[k]) for k in ('foot_l', 'foot_r', 'ball_l', 'ball_r', 'pelvis', 'hand_r', 'hand_l', 'calf_l', 'calf_r', 'Head')})
            if not write:
                continue
            q, loc = rt.basis_from_world(R, dP)
            for s in rt.order:
                pb = tgt.pose.bones[rt.tname[s]]
                qq = q[s]
                if s in prev_q and prev_q[s].dot(qq) < 0:
                    qq = -qq
                prev_q[s] = qq
                pb.rotation_quaternion = qq
                pb.keyframe_insert('rotation_quaternion', frame=i)
            pp = tgt.pose.bones[rt.tname['pelvis']]
            pp.location = loc
            pp.keyframe_insert('location', frame=i)
        if not write:
            return rows
        act.use_fake_user = True
        tr = tgt.animation_data.nla_tracks.new()
        tr.name = name
        tr.strips.new(name, 0, act)
        tgt.animation_data.action = None
        act['loop'] = bool(loop)
        return rows


def edge_stretch(mesh, arm, action, frames, sample=60000):
    """Tearing metric: evaluate the skinned mesh at the given frames of `action` (set directly on the armature) and return, per
    frame, the 99.9th percentile and max of (posed edge length / rest edge length) over a random sample of edges."""
    import random
    me = mesh.data
    rest = [v.co.copy() for v in me.vertices]
    edges = [(e.vertices[0], e.vertices[1]) for e in me.edges]
    random.seed(1)
    if len(edges) > sample:
        edges = random.sample(edges, sample)
    rl = [max((rest[a] - rest[b]).length, 1e-5) for a, b in edges]
    arm.animation_data_create()
    tracks = list(arm.animation_data.nla_tracks)
    for t in tracks:
        t.mute = True
    arm.animation_data.action = action
    out = []
    dg = bpy.context.evaluated_depsgraph_get()
    for f in frames:
        bpy.context.scene.frame_set(int(f))
        ev = mesh.evaluated_get(dg)
        m = ev.to_mesh()
        pos = [v.co.copy() for v in m.vertices]
        ratios = sorted(((pos[a] - pos[b]).length / l) for (a, b), l in zip(edges, rl))
        out.append({'f': int(f), 'p999': ratios[int(len(ratios) * 0.999)], 'max': ratios[-1], 'p001': ratios[int(len(ratios) * 0.001)]})
        ev.to_mesh_clear()
    arm.animation_data.action = None
    for t in tracks:
        t.mute = False
    return out
