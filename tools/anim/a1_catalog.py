r"""A1/A2 clip catalogue: one function per canonical clip (spec 30 section 2). Library clips come from the CC0 UAL pack, the rest are
authored with the pose solver of a1lib (see a1_clips.Builder). Every function returns (frames, loop, duration)."""
import math

from mathutils import Matrix, Vector

import animlib as L
from a1_clips import Builder, FPS  # noqa: F401


# ---------------------------------------------------------------------------------------------------------------------
def arm_off(B, R, side):
    """current wrist offset from the shoulder joint, in units of the arm length"""
    H = B.rt.fk(R, Vector((0, 0, 0)))
    return tuple((H['hand_' + side] - H['upperarm_' + side]) / B.rg.La[side])


def has_arms(B):
    return B.idle_src is not None


def lib_clip(B, lower, loop, upper=None, upper_set=None, hold=0.0, mirror=False, left_from=None, right_from=None, ground='feet', contacts=None, ik=None):
    fn, dur = B.lib_fn(lower, upper=upper, upper_set=upper_set, loop=loop, left_from=left_from, right_from=right_from, mirror=mirror)
    n = B.n_frames(dur, loop, hold)
    if ground == 'feet0contacts':
        frames = B.frames(n, fn, ground=None, ik=ik)
        rt, rg = B.rt, B.rg
        H0 = rt.fk(frames[0][0], frames[0][1])
        dz0 = rg.rest_ball_z - min(H0['ball_l'][2], H0['ball_r'][2])
        for fr in frames:
            fr[1] = fr[1] + Vector((0, 0, dz0))
        needs = [max(0.0, rg.contact_need(rt.fk(R, dP), contacts)) for R, dP in frames]
        k = 3
        sm = [max(needs[i], sum(needs[max(0, i - k): i + k + 1]) / len(needs[max(0, i - k): i + k + 1])) for i in range(len(needs))]
        for fr, nd in zip(frames, sm):
            fr[1] = fr[1] + Vector((0, 0, nd))
        return frames, loop, dur
    return B.frames(n, fn, ground=ground, contacts=contacts, ik=ik), loop, dur


def lying_contacts(sc):
    return {'pelvis': 0.14 * sc, 'spine_02': 0.15 * sc, 'spine_03': 0.16 * sc, 'Head': 0.15 * sc, 'hand_l': 0.05 * sc, 'hand_r': 0.05 * sc,
            'calf_l': 0.07 * sc, 'calf_r': 0.07 * sc, 'ball_l': 0.03 * sc, 'ball_r': 0.03 * sc}


def kneel_contacts(sc):
    return {'calf_l': 0.085 * sc, 'calf_r': 0.085 * sc, 'ball_l': 0.035 * sc, 'ball_r': 0.035 * sc, 'foot_l': 0.05 * sc, 'foot_r': 0.05 * sc}


def idle_base_R(B):
    return B.rt.target_world(B.base_delta(B.idle_src or 'Idle_Loop'))


# ---------------------------------------------------------------------------------------------------------------------
# library based clips
def clip_idle(B):
    return lib_clip(B, B.idle_src or 'Idle_Loop', True, left_from=B.left_from)


def clip_walk(B):
    return lib_clip(B, 'Walk_Loop', True, upper=B.idle_src, left_from=B.left_from)


def clip_run(B):
    return lib_clip(B, 'Jog_Fwd_Loop', True, upper=B.idle_src, left_from=B.left_from)


def clip_aim(B):
    return lib_clip(B, 'Pistol_Aim_Neutral', False, hold=1.0, left_from=B.left_from)


def clip_fire(B):
    return lib_clip(B, 'Pistol_Shoot', False, left_from=B.left_from)


def clip_hit(B):
    return lib_clip(B, 'Hit_Chest', False, upper=B.idle_src, upper_set=L.ARMS if has_arms(B) else None, left_from=B.left_from)


def clip_cover(B):
    return lib_clip(B, 'Crouch_Idle_Loop', True, upper=B.idle_src, upper_set=L.ARMS if has_arms(B) else None, left_from=B.left_from)


def clip_death(B):
    return lib_clip(B, 'Death01', False, ground='feet0contacts', contacts=lying_contacts(B.sc), ik=False)


def clip_bash(B):
    # shield bash: the lead (left) arm of the library jab carries the forearm shield forward
    return lib_clip(B, 'Punch_Jab', False, upper=None, ik=False)


def clip_melee(B):
    arch = B.arch
    if arch == 'melee':       # two hands on the club
        return lib_clip(B, 'Sword_Attack', False)
    if arch == 'guard':       # one-handed maul, shield arm stays up
        return lib_clip(B, 'Sword_Attack', False, left_from=('Pistol_Idle_Loop', 0.0))
    # pistol arch (baton in the left hand): mirrored swing, the right (pistol) arm stays ready
    return lib_clip(B, 'Sword_Attack', False, mirror=True, right_from=('Pistol_Idle_Loop', 0.0))


def clip_panic(B):
    rg = B.rg
    la = rg.action('Jog_Fwd_Loop')
    dur = (la.frame_range[1] - la.frame_range[0]) / rg.sfps

    def post(i, t, R, dP):
        w = 2 * math.pi * t / dur
        pose = {'arm_l': dict(off=(0.22, -0.30 + 0.16 * math.sin(w), 0.72 + 0.14 * math.cos(w)), pole=(1, 0.2, -0.3)),
                'arm_r': dict(off=(-0.22, -0.30 - 0.16 * math.sin(w), 0.72 - 0.14 * math.cos(w)), pole=(-1, 0.2, -0.3)),
                'head': (-6, 0, 0)}
        return rg.apply_pose(R, dP, pose)
    fn, dur = B.lib_fn('Jog_Fwd_Loop', loop=True, post=post)
    n = B.n_frames(dur, True)
    return B.frames(n, fn, ground='feet', ik=False), True, dur


# ---------------------------------------------------------------------------------------------------------------------
# authored clips
def kneel_pose(B, hands, head=(0, 0, 0), spine=(0, 0, 0)):
    rg, rt, sc = B.rg, B.rt, B.sc
    thigh_z = rt.Ht['thigh_l'][2]
    knee_r = 0.085 * sc
    dz = -(thigh_z - (knee_r + rg.Lthigh * 0.97))
    hip = rt.Ht['thigh_l']
    ank = rt.Ht['foot_l']
    tgt = Vector((hip[0] * 0.92, hip[1] + rg.Lshin * 0.98, 0.07 * sc))
    off = tgt - ank
    leg = dict(ank=tuple(off), pole=(0, -1, -0.35), pitch=170.0)
    legr = dict(ank=(-off[0], off[1], off[2]), pole=(0, -1, -0.35), pitch=170.0)
    pose = dict(dp=(0, 0.0, dz), leg_l=leg, leg_r=legr, spine=spine, head=head)
    pose.update(hands)
    return pose


def clip_surrender(B):
    hands = {'arm_l': dict(off=(0.20, -0.08, 0.80), pole=(1, 0.5, -0.1)), 'arm_r': dict(off=(-0.20, -0.08, 0.80), pole=(-1, 0.5, -0.1))}
    pose = kneel_pose(B, hands, head=(8, 0, 0), spine=(-2, 0, 0))
    keys = [(0.0, pose), (1.6, pose)]
    frames, dur = B.authored(keys, 1.6, True, contacts=kneel_contacts(B.sc), breath=(1.0, 0.5), ik=False)
    return frames, True, dur


def clip_cuffed(B):
    hands = {'arm_l': dict(off=(-0.38, 0.42, -0.98), pole=(1, 0.6, 0.0)), 'arm_r': dict(off=(0.38, 0.42, -0.98), pole=(-1, 0.6, 0.0))}
    pose = kneel_pose(B, hands, head=(20, 0, 0), spine=(7, 0, 0))
    keys = [(0.0, pose), (1.8, pose)]
    frames, dur = B.authored(keys, 1.8, True, contacts=kneel_contacts(B.sc), breath=(0.8, 0.4), ik=False)
    return frames, True, dur


def clip_downed(B):
    sc = B.sc
    dz = -(B.rest_pelvis_z - 0.15 * sc)
    pose = dict(dp=(0, 0.0, dz), pelvis_rot=(-90.0, 0, 0),
                leg_l=dict(ank=(-0.02, 0.0, 0.28 * sc), pole=(0, -1, 0), rel_pelvis=True, pitch=-10.0),
                leg_r=dict(ank=(0.0, 0.0, 0.0), pole=(0, -1, 0), rel_pelvis=True, pitch=0.0),
                arm_r=dict(off=(0.55, -0.12, -0.42), pole=(-1, 0.6, 0), body_frame=True),
                arm_l=dict(off=(0.60, 0.25, -0.80), pole=(1, 0.5, 0), body_frame=True),
                spine=(0, 0, 0), head=(0, 0, 14))
    keys = [(0.0, pose), (2.0, pose)]
    frames, dur = B.authored(keys, 2.0, True, contacts=lying_contacts(sc), breath=(1.6, 0.3), ik=False)
    return frames, True, dur


def clip_cower(B):
    sc = B.sc
    dz = -0.24 * sc
    pose = dict(dp=(0, 0.14, dz), spine=(38, 0, 0), head=(14, 0, 0),
                leg_l=dict(ank=(0, 0, 0), pole=(0.3, -1, 0.3)), leg_r=dict(ank=(0, 0, 0), pole=(-0.3, -1, 0.3)),
                arm_l=dict(off=(0.04, -0.52, 0.34), pole=(1, -0.2, -0.6)), arm_r=dict(off=(-0.04, -0.52, 0.34), pole=(-1, -0.2, -0.6)))
    keys = [(0.0, pose), (1.0, pose)]
    frames, dur = B.authored(keys, 1.0, True, contacts={'ball_l': 0.03 * sc, 'ball_r': 0.03 * sc}, breath=(1.2, 0.0), tremor=1.0, ik=False)
    return frames, True, dur


def clip_point(B):
    R0 = idle_base_R(B)
    base_l, base_r = arm_off(B, R0, 'l'), arm_off(B, R0, 'r')
    key_base = dict(arm_l=dict(off=base_l, pole=(1, 0.3, -0.3)), arm_r=dict(off=base_r, pole=(-1, 0.3, -0.3)), spine=(0, 0, 0), head=(0, 0, 0))
    key_pt = dict(arm_l=dict(off=(0.15, -0.45, 0.62) if B.fig.get('left') == 'handset' else base_l, pole=(1, 0.3, -0.3)),
                  arm_r=dict(off=(-0.12, -0.97, 0.16), pole=(-1, 0.2, -0.4)), spine=(0, 0, -6), head=(0, 0, -8))
    keys = [(0.0, key_base), (0.35, key_pt), (1.0, key_pt), (1.35, key_base)]
    base = B.base_delta(B.idle_src or 'Idle_Loop')
    frames, dur = B.authored(keys, 1.35, False, base=base, contacts=None, ground='feet', breath=None, ik=False)
    return frames, False, dur


def clip_throw(B):
    R0 = idle_base_R(B)
    base_l, base_r = arm_off(B, R0, 'l'), arm_off(B, R0, 'r')
    keep_r = dict(off=base_r, pole=(-1, 0.3, -0.3))
    k0 = dict(arm_l=dict(off=base_l, pole=(1, 0.3, -0.3)), arm_r=keep_r, spine=(0, 0, 0), head=(0, 0, 0))
    k1 = dict(arm_l=dict(off=(0.10, 0.60, 0.55), pole=(1, 0.8, 0.0)), arm_r=keep_r, spine=(-8, 0, 28), head=(0, 0, 10))
    k2 = dict(arm_l=dict(off=(0.0, -0.95, 0.35), pole=(1, -0.2, -0.3)), arm_r=keep_r, spine=(12, 0, -22), head=(0, 0, -10))
    k3 = dict(arm_l=dict(off=(-0.18, -0.55, -0.55), pole=(1, -0.2, -0.3)), arm_r=keep_r, spine=(22, 0, -30), head=(6, 0, -12))
    keys = [(0.0, k0), (0.30, k1), (0.52, k2), (0.74, k3), (1.2, k0)]
    base = B.base_delta(B.idle_src or 'Idle_Loop')
    frames, dur = B.authored(keys, 1.2, False, base=base, ground='feet', breath=None, ik=False)
    return frames, False, dur


def build_clip(B, name):
    f = globals().get('clip_' + name.replace('-', '_'))
    return f(B) if f else None
