r"""Copy the picked candidates to art/rig/<kind>/pick.png and the gate sheets to cands.jpg (small, tracked); the raw candidates stay local.
usage: python tools/anim/rig_picks.py   (reads art/rig/picks.json and art/rig/items/picks.json)"""
import json
import os
import shutil

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
RIG = os.path.join(ROOT, 'art', 'rig')
for kind, n in json.load(open(os.path.join(RIG, 'picks.json'))).items():
    d = os.path.join(RIG, kind)
    shutil.copyfile(os.path.join(d, f'cand_{n}.png'), os.path.join(d, 'pick.png'))
    if os.path.exists(os.path.join(d, 'cands.png')):
        Image.open(os.path.join(d, 'cands.png')).convert('RGB').save(os.path.join(d, 'cands.jpg'), quality=82)
p = os.path.join(RIG, 'items', 'picks.json')
if os.path.exists(p):
    for iid, n in json.load(open(p)).items():
        d = os.path.join(RIG, 'items', iid)
        shutil.copyfile(os.path.join(d, f'cand_{n}.png'), os.path.join(d, 'pick.png'))
    for s in (1, 2):
        q = os.path.join(RIG, 'items', f'sheet_{s}.png')
        if os.path.exists(q):
            Image.open(q).convert('RGB').save(os.path.join(RIG, 'items', f'sheet_{s}.jpg'), quality=82)
print('ok')
