r"""Shared Blender (bpy 4.0, Hunyuan3D-2.1 venv) helpers for the A0 rig spike.

Retargeting method (pure rotation maths, no constraints):
  world delta of every source bone (posed world rotation * rest world rotation^-1) is applied to the same bone's rest
  world rotation on the target rig. Arms use a "T reference" (the target arm swung up to horizontal) because the source
  library is in a T pose and our figure in an A pose, so the delta means the same thing on both. The pelvis translation
  delta is scaled by the target/source leg-length ratio. Optionally the left arm is solved with two-bone IK onto the
  weapon's fore-end grip so both hands stay on the gun.
"""
import math
import os

import bpy
from mathutils import Matrix, Quaternion, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
SRC_BONES = ['root', 'pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head',
             'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r',
             'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r']
ARM_CHAIN = {'l': ['upperarm_l', 'lowerarm_l', 'hand_l'], 'r': ['upperarm_r', 'lowerarm_r', 'hand_r']}
FPS = 30


def ual_path():
    d = os.path.join(ROOT, 'tools', 'anim', 'vendor', 'ual')
    return os.path.join(d, os.listdir(d)[0], 'Unreal-Godot', 'UAL1_Standard.glb')


def clean_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.context.scene.objects if o not in before]


def import_ual():
    objs = import_glb(ual_path())
    arm = [o for o in objs if o.type == 'ARMATURE'][0]
    for o in objs:
        if o.type != 'ARMATURE':
            bpy.data.objects.remove(o)
    return arm


def rest_rot(arm, name):
    return arm.data.bones[name].matrix_local.to_3x3().normalized()


def rest_head(arm, name):
    return arm.data.bones[name].head_local.copy()


def clip_names():
    return {a.name.replace('_Armature', ''): a for a in bpy.data.actions}


class Retarget:
    """Retarget from the UAL armature `src` onto armature `tgt` (bone names given by `mapping` src->tgt)."""

    def __init__(self, src, tgt, mapping, arm_abduct_deg=14.0):
        self.src, self.tgt, self.map = src, tgt, mapping
        self.order = [b for b in SRC_BONES if b in mapping]
        self.tname = {s: mapping[s] for s in self.order}
        self.Rt = {s: rest_rot(tgt, self.tname[s]) for s in self.order}
        self.Rs = {s: rest_rot(src, s) for s in self.order}
        self.Ht = {s: rest_head(tgt, self.tname[s]) for s in self.order}
        self.Hs = {s: rest_head(src, s) for s in self.order}
        # parent relation restricted to mapped bones (nearest mapped ancestor)
        self.parent = {}
        for s in self.order:
            p = src.data.bones[s].parent
            while p is not None and p.name not in mapping:
                p = p.parent
            self.parent[s] = p.name if p else None
        # target-rig parent (for rest-relative rotation) must be the actual parent bone of the target armature
        self.tparent = {}
        for s in self.order:
            p = tgt.data.bones[self.tname[s]].parent
            self.tparent[s] = p.name if p else None
        inv = {v: k for k, v in mapping.items()}
        self.tparent_src = {s: (inv.get(self.tparent[s]) if self.tparent[s] else None) for s in self.order}
        # T reference for the arms
        self.Rref = dict(self.Rt)
        self.abduct = {}
        for side, sx in (('l', 1.0), ('r', -1.0)):
            u, lo = ARM_CHAIN[side][0], ARM_CHAIN[side][1]
            d = (self.Ht[lo] - self.Ht[u]).normalized()
            q = d.rotation_difference(Vector((sx, 0, 0)))
            for b in ARM_CHAIN[side]:
                self.Rref[b] = q.to_matrix() @ self.Rt[b]
            # outward swing of the whole arm (about the forward axis); left arm goes towards +X
            self.abduct[side] = Quaternion((0, 1, 0), math.radians(arm_abduct_deg) * (-sx))
        # leg-length ratio (hip to ankle) for the pelvis translation
        lt = (self.Ht['thigh_l'] - self.Ht['foot_l']).length
        ls = (self.Hs['thigh_l'] - self.Hs['foot_l']).length
        self.k = lt / ls
        self.pelvis_src_rest = self.Hs['pelvis'].copy()

    # -- source evaluation -------------------------------------------------------------------------------------
    def src_state(self, action, frame):
        self.src.animation_data_create()
        self.src.animation_data.action = action
        f = math.floor(frame)
        bpy.context.scene.frame_set(f, subframe=frame - f)
        rot, pelvis = {}, None
        for s in self.order:
            pb = self.src.pose.bones[s]
            rot[s] = pb.matrix.to_3x3().normalized() @ self.Rs[s].inverted()
        pelvis = self.src.pose.bones['pelvis'].head.copy() - self.pelvis_src_rest
        return rot, pelvis

    # -- target rotations from deltas --------------------------------------------------------------------------
    def target_world(self, delta, overrides=None):
        R = {}
        for s in self.order:
            R[s] = delta[s] @ self.Rref[s]
            side = s[-1] if s.endswith('_l') or s.endswith('_r') else None
            if s in ARM_CHAIN.get(side or 'x', []):
                R[s] = self.abduct[side].to_matrix() @ R[s]
        if overrides:
            R.update(overrides)
        return R

    def fk(self, R, dpelvis):
        """World head positions for the mapped bones, given world rotations R and a pelvis translation."""
        H = {}
        for s in self.order:
            p = self.tparent_src[s]
            if p is None:
                H[s] = self.Ht[s].copy()
                if s == 'pelvis':
                    H[s] += dpelvis
            else:
                dR = R[p] @ self.Rt[p].inverted()
                H[s] = H[p] + dR @ (self.Ht[s] - self.Ht[p])
                if s == 'pelvis':
                    H[s] += dpelvis
        return H

    def two_bone_ik(self, side, R, H, wrist_target):
        u, lo, h = ARM_CHAIN[side]
        S, E, W = H[u], H[lo], H[h]
        l1, l2 = (E - S).length, (W - E).length
        T = wrist_target
        d = T - S
        dist = min(max(d.length, abs(l1 - l2) + 1e-4), l1 + l2 - 1e-4)
        dn = d.normalized()
        # pole: keep the existing elbow side
        v = E - S
        pole = v - dn * v.dot(dn)
        if pole.length < 1e-5:
            pole = Vector((1.0 if side == 'l' else -1.0, 0, -1.0))
        pole.normalize()
        a = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)
        a = min(1.0, max(-1.0, a))
        ang = math.acos(a)
        E_new = S + (dn * math.cos(ang) + pole * math.sin(ang)) * l1
        W_new = S + dn * dist
        Qu = (E - S).rotation_difference(E_new - S)
        Ru = Qu.to_matrix() @ R[u]
        d_l = Qu.to_matrix() @ (W - E)
        Ql = d_l.rotation_difference(W_new - E_new)
        R2 = dict(R)
        R2[u] = Ru
        R2[lo] = Ql.to_matrix() @ Qu.to_matrix() @ R[lo]
        R2[h] = Ql.to_matrix() @ Qu.to_matrix() @ R[h]
        return R2

    # -- write pose basis ----------------------------------------------------------------------------------------
    def basis_from_world(self, R, dpelvis):
        out = {}
        Rpos = {}
        for s in self.order:
            p = self.tparent_src[s]
            if p is None:
                base = self.Rt[s]
            else:
                base = R[p] @ (self.Rt[p].inverted() @ self.Rt[s])
            q = (base.inverted() @ R[s]).to_quaternion()
            out[s] = q
        loc = self.Rt['pelvis'].inverted() @ dpelvis
        return out, loc


# ---------------------------------------------------------------------------------------------------------------------
ARMS = ['clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r']
UPPER = ['spine_02', 'spine_03', 'neck_01', 'Head', 'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l',
         'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r']
C_B2G = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))  # Blender (z up) -> glTF (y up)


def action_of(name):
    return bpy.data.actions[name + '_Armature']


def bake_clip(rt, name, lower, upper=None, loop=True, hold=0.0, weapon=None, metrics=None, dz=0.0, write=True, upper_set=None):
    """Create an action `name` on rt.tgt. weapon = dict(S=Matrix (weapon->hand_r bone world), grip_l=Vector (weapon local),
    palm=float) enables left-hand IK to the weapon. Returns list of per-frame metric dicts."""
    sc = bpy.context.scene
    sfps = sc.render.fps / sc.render.fps_base
    la = action_of(lower)
    ua = action_of(upper) if upper else None
    l0, l1 = la.frame_range
    dur = (l1 - l0) / sfps
    n = max(1, round(dur * FPS))
    nsamp = n if loop else n + 1
    total = nsamp + (round(hold * FPS) if hold else 0)
    tgt = rt.tgt
    tgt.animation_data_create()
    act = bpy.data.actions.new(name) if write else None
    if write:
        tgt.animation_data.action = act
    for pb in tgt.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    rows = []
    prev_q = {}
    for i in range(total):
        j = min(i, nsamp - 1)
        t = j / FPS
        fl = min(l0 + t * sfps, l1)
        dl, dp = rt.src_state(la, fl)
        delta = dict(dl)
        if ua:
            u0, u1 = ua.frame_range
            fu = u0 + (t / max(dur, 1e-6)) * (u1 - u0)
            fu = min(fu, u1)
            du, _ = rt.src_state(ua, fu)
            for b in (upper_set or UPPER):
                if b in du:
                    delta[b] = du[b]
        dP = dp * rt.k + Vector((0, 0, dz))
        R = rt.target_world(delta)
        H = rt.fk(R, dP)
        row = {'i': i}
        if weapon:
            hr = rt.Hn('hand_r', H)
            Whand = Matrix.Translation(H['hand_r']) @ R['hand_r'].to_4x4()
            Wep = Whand @ weapon['S']
            grip_w = Wep @ weapon['grip_l']
            ydir = R['hand_l'] @ Vector((0, 1, 0))
            wt = grip_w - ydir * weapon['palm']
            R2 = rt.two_bone_ik('l', R, H, wt)
            H2 = rt.fk(R2, dP)
            row['ik_err'] = (H2['hand_l'] - wt).length
            R, H = R2, H2
            Whand = Matrix.Translation(H['hand_r']) @ R['hand_r'].to_4x4()
            Wep = Whand @ weapon['S']
            row['muzzle'] = tuple(Wep @ weapon['muzzle'])
        row.update({k: tuple(H[k]) for k in ('foot_l', 'foot_r', 'ball_l', 'ball_r', 'pelvis', 'hand_r', 'hand_l')})
        rows.append(row)
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
    # park on an NLA track so the exporter writes it as its own animation
    tr = tgt.animation_data.nla_tracks.new()
    tr.name = name
    tr.strips.new(name, 0, act)
    tgt.animation_data.action = None
    if loop:
        act['loop'] = True
    return rows


def rt_hn(self, name, H):
    return H[name]


Retarget.Hn = rt_hn


def foot_metrics(rows, speed_guess=None):
    """Foot plant statistics from baked rows (world positions, blender z-up, units = inches).
    plant = max horizontal drift of the lowest foot while it is within 0.02 of the floor, in 1/10 of the stride."""
    import statistics
    out = {}
    for side in ('l', 'r'):
        key = 'ball_' + side
        zs = [r[key][2] for r in rows]
        ys = [r[key][1] for r in rows]
        xs = [r[key][0] for r in rows]
        out['ball_' + side] = {'zmin': min(zs), 'zmax': max(zs), 'y_range': max(ys) - min(ys), 'x_range': max(xs) - min(xs)}
    return out


def render_previews(arm, S, outd, clips, n=8, size=420, hand='hand_r'):
    """Workbench frames (front and 3/4 views) of baked actions with the weapon attached via S (weapon -> hand bone)."""
    import math as _m
    os.makedirs(outd, exist_ok=True)
    objs = import_glb(os.path.join(ROOT, 'art', 'anim-spike', 'raw', 'shotgun.final.glb'))
    gun = [o for o in objs if o.type == 'MESH'][0]
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
    cam.data.ortho_scale = 2.4
    # NLA tracks would add to the action: mute them while previewing
    tracks = list(arm.animation_data.nla_tracks)
    for t in tracks:
        t.mute = True
    for name in clips:
        act = bpy.data.actions[name]
        arm.animation_data.action = act
        f0, f1 = act.frame_range
        loop = bool(act.get('loop'))
        for k in range(n):
            f = f0 + (f1 - f0) * k / (n if loop else n - 1)
            sc.frame_set(int(f), subframe=f - int(f))
            gun.matrix_world = arm.matrix_world @ arm.pose.bones[hand].matrix @ S
            for vn, loc in (('front', (0, -10, 0.9)), ('tq', (-6, -6, 3.0))):
                cam.location = loc
                cam.rotation_euler = (Vector((0, 0, 0.9)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
                sc.render.filepath = os.path.join(outd, f'{name}_{k}_{vn}.png')
                bpy.ops.render.render(write_still=True)
    arm.animation_data.action = None
    for t in tracks:
        t.mute = False
    bpy.data.objects.remove(gun)
