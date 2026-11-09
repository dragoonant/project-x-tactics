"""Post-process the Blender exports: write public/assets/anim/sockets.json (glTF-space socket matrices, clip stride speeds)
and copy the raw GLBs to a scratch folder for gltf-transform optimisation. Plain python + numpy.
usage: python tools/anim/finalize_a0.py
"""
import json, os, struct, shutil
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
RAW = os.path.join(ROOT, 'art', 'anim-spike', 'raw')
OUT = os.path.join(ROOT, 'public', 'assets', 'anim')
os.makedirs(OUT, exist_ok=True)
C = np.array([[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]], float)  # Blender (z up, front -Y) -> glTF (y up, front +Z)
Ci = np.linalg.inv(C)


def read_glb(path):
    b = open(path, 'rb').read()
    n = struct.unpack('<I', b[12:16])[0]
    return json.loads(b[20:20 + n])


def local(n):
    if 'matrix' in n:
        return np.array(n['matrix'], float).reshape(4, 4).T
    t = np.array(n.get('translation', [0, 0, 0]), float)
    q = np.array(n.get('rotation', [0, 0, 0, 1]), float)
    s = np.array(n.get('scale', [1, 1, 1]), float)
    x, y, z, w = q
    R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    M = np.eye(4); M[:3, :3] = R * s; M[:3, 3] = t
    return M


def node_world(j, name):
    nodes = j['nodes']
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get('children', []):
            parent[c] = i
    idx = [i for i, n in enumerate(nodes) if n.get('name') == name][0]
    M = np.eye(4)
    while True:
        M = local(nodes[idx]) @ M
        if idx not in parent:
            break
        idx = parent[idx]
    return M


def mat(rows):
    return np.array(rows, float)


def stride_speed(rows):
    """Ground speed (figure units/s) at which the planted foot does not slide: backward foot speed while the foot is on the floor."""
    out = []
    for side in ('ball_l', 'ball_r'):
        z = np.array([r[side][2] for r in rows]); y = np.array([r[side][1] for r in rows])
        stance = z < z.min() + 0.012
        v = np.diff(y) * 30.0  # +Y is backwards in Blender (the figure faces -Y)
        sel = [i for i in range(len(v)) if stance[i] and stance[i + 1]]
        if sel:
            out.append(np.array(v)[sel])
    allv = np.concatenate(out)
    return float(np.median(allv)), float(np.std(allv) / max(abs(np.median(allv)), 1e-6))


rigs = {}
labels = {'a': 'A: library skeleton + auto weights', 'b': 'B: UniRig skeleton + auto weights'}
for r in ('a', 'b'):
    j = read_glb(os.path.join(RAW, f'enforcer-{r}.glb'))
    s = json.load(open(os.path.join(RAW, f'{r}-socket.json')))
    B = mat(s['hand_r_rest'])
    Mw = node_world(j, 'hand_r')
    errA = np.abs(Mw - C @ B).max()
    errB = np.abs(Mw - C @ B @ Ci).max()
    conv = 'A' if errA < errB else 'B'
    Sb = mat(s['S_blender'])
    Sg = Sb @ Ci if conv == 'A' else C @ Sb @ Ci   # derived: A -> S_b C^-1 ; B -> C S_b C^-1 (see animlib)
    if conv == 'B':
        Sg = C @ Sb @ Ci
    gl = (C @ np.array(list(s['grip_l']) + [1.0]))[:3]
    mz = (C @ np.array(list(s['muzzle']) + [1.0]))[:3]
    clips = {}
    for name in ('idle', 'walk', 'aim', 'fire', 'hit'):
        rows = json.load(open(os.path.join(RAW, f'{r}-rows-{name}.json')))
        loop = name in ('idle', 'walk')
        c = {'duration': round((len(rows) if loop else len(rows) - 1) / 30.0, 4), 'loop': loop}
        if name == 'walk':
            sp, rel = stride_speed(rows)
            c['speed'] = round(sp, 4)
            c['stanceSpeedRelStd'] = round(rel, 3)
        clips[name] = c
    rigs[r] = {'file': f'enforcer-{r}.glb', 'label': labels[r], 'sockets_convention': conv, 'convention_err': [float(errA), float(errB)],
               'rightHand': {'bone': 'hand_r', 'matrix': Sg.round(6).tolist()},
               'leftHand': {'bone': 'hand_l', 'weaponLocalGrip': [round(float(x), 5) for x in gl]},
               'muzzle': [round(float(x), 5) for x in mz], 'clips': clips}
    print(r, 'convention', conv, errA, errB, clips['walk'])
doc = {'note': 'glTF space (y up, front +Z, 1 unit = 1 inch). rightHand.matrix is row-major: weapon-local -> right-hand bone-local. '
               'leftHand.weaponLocalGrip is the fore-end grip point in weapon-local coordinates; the left arm is solved onto it inside the baked clips. '
               'clips.walk.speed is the ground speed (figure units/s) at which the baked walk does not skate.',
       'weapon': 'shotgun.glb', 'tile': 1, 'rigs': rigs}
json.dump(doc, open(os.path.join(OUT, 'sockets.json'), 'w'), indent=1)
scratch = os.path.join(RAW, '..', 'scratch'); os.makedirs(scratch, exist_ok=True)
for f in ('enforcer-a.glb', 'enforcer-b.glb'):
    shutil.copy(os.path.join(RAW, f), os.path.join(scratch, f))
shutil.copy(os.path.join(RAW, 'shotgun.final.glb'), os.path.join(scratch, 'shotgun.glb'))
