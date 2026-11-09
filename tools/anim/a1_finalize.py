r"""Assemble the A1 deliverables from the Blender exports in art/rig/raw/ (plain python + numpy; use the Hunyuan3D-2.1 venv python):
  python tools/anim/a1_finalize.py [kind ...]     (default: every kind that has a <kind>.rigged.glb)
- computes the glTF-space attachment matrices (row-major, item-local -> bone-local) and muzzles from <kind>.meta.json,
- stages the GLBs in art/rig/scratch/ for `npx @gltf-transform/cli optimize` (run from there, see optimise.ps1 / A1-REPORT),
- rewrites public/assets/anim/manifest.json exactly per spec 30 (merging the kinds finalised in earlier runs).
"""
import json
import os
import shutil
import struct
import sys

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
RAW = os.path.join(ROOT, 'art', 'rig', 'raw')
SCR = os.path.join(ROOT, 'art', 'rig', 'scratch')
OUT = os.path.join(ROOT, 'public', 'assets', 'anim')
C = np.array([[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]], float)   # Blender (z up, front -Y) -> glTF (y up, front +Z)
Ci = np.linalg.inv(C)
CFG = json.load(open(os.path.join(ROOT, 'tools', 'anim', 'figures.json')))


def read_glb(path):
    b = open(path, 'rb').read()
    n = struct.unpack('<I', b[12:16])[0]
    return json.loads(b[20:20 + n])


def local(n):
    if 'matrix' in n:
        return np.array(n['matrix'], float).reshape(4, 4).T
    t = np.array(n.get('translation', [0, 0, 0]), float)
    x, y, z, w = n.get('rotation', [0, 0, 0, 1])
    s = np.array(n.get('scale', [1, 1, 1]), float)
    R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    M = np.eye(4)
    M[:3, :3] = R * s
    M[:3, 3] = t
    return M


def node_world(j, name):
    nodes = j['nodes']
    parent = {c: i for i, n in enumerate(nodes) for c in n.get('children', [])}
    idx = [i for i, n in enumerate(nodes) if n.get('name') == name][0]
    M = np.eye(4)
    while True:
        M = local(nodes[idx]) @ M
        if idx not in parent:
            return M
        idx = parent[idx]


def main():
    kinds = [a for a in sys.argv[1:] if not a.startswith('-')]
    if not kinds:
        kinds = [k for k in CFG['figures'] if os.path.exists(os.path.join(RAW, k + '.rigged.glb'))]
    os.makedirs(os.path.join(SCR, 'items'), exist_ok=True)
    mpath = os.path.join(OUT, 'manifest.json')
    man = json.load(open(mpath)) if os.path.exists(mpath) else {'version': 1, 'skeleton': 'ual-standard', 'figures': {}, 'items': {}}
    man['version'], man['skeleton'] = 1, 'ual-standard'
    used_items = set()
    for kind in kinds:
        meta = json.load(open(os.path.join(RAW, kind + '.meta.json')))
        j = read_glb(os.path.join(RAW, kind + '.rigged.glb'))
        atts = []
        for a in meta['attachments']:
            B = np.array(meta['bone_rest'][a['bone']], float)
            Mw = node_world(j, a['bone'])
            errA, errB = np.abs(Mw - C @ B).max(), np.abs(Mw - C @ B @ Ci).max()
            if errA > 1e-3:
                print('WARNING convention check failed for', kind, a['bone'], errA, errB)
            Sb = np.array(a['S_blender'], float)
            Sg = Sb @ Ci
            mz = (C @ np.array(list(a['muzzle_blender']) + [1.0]))[:3]
            atts.append({'id': a['id'], 'bone': a['bone'], 'matrix': [round(float(x), 6) for x in Sg.reshape(-1)], 'muzzle': [round(float(x), 5) for x in mz]})
            used_items.add(a['id'])
        clips = {}
        for name, c in meta['clips'].items():
            e = {'duration': c['duration'], 'loop': c['loop']}
            if 'speed' in c:
                e['speed'] = c['speed']
            clips[name] = e
        man['figures'][kind] = {'file': kind + '.glb', 'height': meta['height'], 'clips': clips, 'attachments': atts}
        shutil.copyfile(os.path.join(RAW, kind + '.rigged.glb'), os.path.join(SCR, kind + '.glb'))
        print(kind, 'clips', len(clips), 'attachments', [a['id'] for a in atts], 'tris', meta.get('triangles'))
    for iid in sorted(used_items):
        src = os.path.join(RAW, 'items', iid + '.glb')
        if os.path.exists(src):
            shutil.copyfile(src, os.path.join(SCR, 'items', iid + '.glb'))
            man['items'][iid] = {'file': f'items/{iid}.glb'}
    json.dump(man, open(mpath, 'w'), indent=1)
    print('manifest written:', len(man['figures']), 'figures,', len(man['items']), 'items')


main()
