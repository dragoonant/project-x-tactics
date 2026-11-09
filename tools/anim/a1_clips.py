r"""A1/A2 clip catalogue: builds the per-frame (world rotations, pelvis) lists for every canonical clip of a figure.
Library clips come from the Quaternius UAL pack (CC0); the rest are authored poses (keys interpolated with easing, solved per
frame with two-bone IK and ground contacts, small breathing loops). Left-hand IK onto two-handed items is baked into every frame.
All coordinates are Blender world: x = character left, y = back, z = up, front = -Y; inches (figure about 1.8 tall).
"""
import math

from mathutils import Matrix, Vector

import animlib as L
import a1lib as A

FPS = L.FPS
ARMS_L = ['clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l']
ARMS_R = ['clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r']


# ---------------------------------------------------------------------------------------------------------------------
def lerp_val(a, b, u):
    if isinstance(a, dict):
        return {k: (lerp_val(a[k], b[k], u) if k in b else a[k]) for k in a}
    if isinstance(a, (tuple, list)):
        return tuple(lerp_val(x, y, u) for x, y in zip(a, b))
    if isinstance(a, (int, float)) and not isinstance(a, bool):
        return a + (b - a) * u
    return a


def smooth(u):
    u = min(max(u, 0.0), 1.0)
    return u * u * (3 - 2 * u)


def sample_keys(keys, t):
    if t <= keys[0][0]:
        return keys[0][1]
    for (t0, p0), (t1, p1) in zip(keys, keys[1:]):
        if t <= t1:
            return lerp_val(p0, p1, smooth((t - t0) / max(t1 - t0, 1e-6)))
    return keys[-1][1]


def add3(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def breathe(pose, t, T, amp=1.0, sway=0.0):
    p = dict(pose)
    w = 2 * math.pi * t / T
    s = p.get('spine', (0, 0, 0))
    p['spine'] = add3(s, (1.1 * amp * math.sin(w), 0.6 * sway * math.sin(w), 0.5 * sway * math.sin(w + 1.0)))
    h = p.get('head', (0, 0, 0))
    p['head'] = add3(h, (-0.6 * amp * math.sin(w), 0, 0.8 * sway * math.sin(w + 0.5)))
    return p


def mirror_delta(delta):
    """Mirror a world-rotation delta set across the YZ plane and swap left and right bones."""
    M = Matrix(((-1, 0, 0), (0, 1, 0), (0, 0, 1)))
    out = {}
    for b, d in delta.items():
        if b.endswith('_l'):
            out[b[:-2] + '_r'] = M @ d @ M
        elif b.endswith('_r'):
            out[b[:-2] + '_l'] = M @ d @ M
        else:
            out[b] = M @ d @ M
    return out


# ---------------------------------------------------------------------------------------------------------------------
class Builder:
    def __init__(self, rg, fig, wp):
        self.rg, self.rt = rg, rg.rt
        self.fig = fig
        self.wp = wp               # right-hand gun/melee socket dict or None
        self.arch = fig['arch']
        self.sc = fig['height'] / 1.8
        self.ik = self.arch == 'long' or fig.get('two_hand')
        self.idle_src = {'long': 'Pistol_Idle_Loop', 'pistol': 'Pistol_Idle_Loop', 'guard': 'Pistol_Idle_Loop',
                         'melee': 'Idle_Loop', 'none': None}[self.arch]
        self.left_from = ('Idle_Loop', 0.0) if self.arch == 'pistol' else None
        self.rest_pelvis_z = rg.rest_pelvis[2]

    # ---- generic frame assembly ------------------------------------------------------------------------------------
    def frames(self, n, fn, ground='feet', contacts=None, ik=None, smooth_lift=True):
        """fn(i, t) -> (R, dP). Applies left-hand IK if wanted, then ground contact. Returns list of [R, dP]."""
        rg, rt = self.rg, self.rt
        use_ik = self.ik if ik is None else ik
        out = []
        for i in range(n):
            R, dP = fn(i)
            if use_ik and self.wp is not None:
                R, err = rg.left_hand_ik(R, dP, self.wp)
            out.append([R, Vector(dP)])
        if ground == 'feet':
            lows = [min(rt.fk(R, dP)['ball_l'][2], rt.fk(R, dP)['ball_r'][2]) for R, dP in out]
            dz = rg.rest_ball_z - min(lows)
            for fr in out:
                fr[1] = fr[1] + Vector((0, 0, dz))
        elif ground == 'contacts':
            needs = []
            for R, dP in out:
                H = rt.fk(R, dP)
                needs.append(max(0.0, rg.contact_need(H, contacts)))
            if smooth_lift and len(needs) > 4:
                k = 3
                sm = []
                for i in range(len(needs)):
                    w = needs[max(0, i - k): i + k + 1]
                    sm.append(max(needs[i], sum(w) / len(w)))
                needs = sm
            for fr, nd in zip(out, needs):
                fr[1] = fr[1] + Vector((0, 0, nd))
        return out

    def lib_fn(self, lower, upper=None, upper_set=None, loop=True, dur=None, left_from=None, right_from=None, mirror=False, post=None):
        rg, rt = self.rg, self.rt
        la = rg.action(lower)
        ldur = (la.frame_range[1] - la.frame_range[0]) / rg.sfps
        dur = dur or ldur

        def fn(i):
            t = i / FPS
            delta, dP = rg.lib_delta(lower, t if loop else min(t, ldur), upper=upper, upper_set=upper_set,
                                     left_from=left_from, right_from=right_from, dur=dur, loop=loop)
            if mirror:
                delta = mirror_delta(delta)
                dP = Vector((-dP[0], dP[1], dP[2]))
            R = rt.target_world(delta)
            if post:
                R, dP = post(i, t, R, dP)
            return R, dP
        return fn, dur

    def n_frames(self, dur, loop, hold=0.0):
        n = max(1, round(dur * FPS))
        return (n if loop else n + 1) + (round(hold * FPS) if hold else 0)

    def base_delta(self, name='Idle_Loop', phase=0.0):
        rg = self.rg
        a = rg.action(name)
        f0, f1 = a.frame_range
        d, _ = rg.rt.src_state(a, f0 + (phase % 1.0) * (f1 - f0))
        return d

    # ---- authored pose clips -------------------------------------------------------------------------------------------
    def authored(self, keys, dur, loop, base=None, left_hold=None, hold=0.0, breath=(1.0, 0.0), T=None, contacts=None, ground='contacts',
                 base_clip=None, ik=False, tremor=0.0, extra=None):
        """keys = [(t, pose)] on top of the base delta set (default: relaxed Idle_Loop frame 0)."""
        rg, rt = self.rg, self.rt
        base_d = base or self.base_delta()
        n = self.n_frames(dur, loop, hold)
        T = T or dur
        arm_hold = self.rg.lib_delta  # noqa: F841

        def fn(i):
            t = min(i / FPS, dur) if not loop else (i / FPS)
            pose = sample_keys(keys, t if not loop else t % dur if dur > 0 else 0.0)
            if breath:
                pose = breathe(pose, t, T, amp=breath[0], sway=breath[1])
            if tremor:
                w = 2 * math.pi * 7 * t
                s = pose.get('spine', (0, 0, 0))
                pose = dict(pose)
                pose['spine'] = add3(s, (0.4 * tremor * math.sin(w), 0.9 * tremor * math.sin(w * 1.3 + 1), 0.6 * tremor * math.sin(w * 0.9 + 2)))
            R = rt.target_world(base_d)
            if base_clip:
                dd, dp0 = rg.lib_delta(base_clip, t, loop=True)
                R = rt.target_world(dd)
            R, dP = rg.apply_pose(R, Vector((0, 0, 0)), pose)
            if extra:
                R, dP = extra(i, t, R, dP)
            return R, dP
        return self.frames(n, fn, ground=ground, contacts=contacts, ik=ik), dur
