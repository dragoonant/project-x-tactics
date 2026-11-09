r"""Gate sheet: the original concept next to the 4 re-pose candidates of one figure (or the items).
usage: python tools/anim/sheet_cands.py <kind> [<kind>...]      (writes art/rig/<kind>/cands.png)
       python tools/anim/sheet_cands.py --items <id>...          (writes art/rig/items/<id>/cands.png)
"""
import json
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
P = json.load(open(os.path.join(ROOT, 'tools', 'anim', 'rig_prompts.json')))
items = '--items' in sys.argv
ids = [a for a in sys.argv[1:] if not a.startswith('--')]
W, H = 480, 360
for k in ids:
    spec = (P['items']['items'] if items else P['pose']['kinds'])[k]
    d = os.path.join(ROOT, 'art', 'rig', 'items' if items else '', k) if items else os.path.join(ROOT, 'art', 'rig', k)
    cands = sorted(f for f in os.listdir(d) if f.startswith('cand_') and f.endswith('.png'))
    imgs = [('original', os.path.join(ROOT, spec['base']))] + [(c[:-4], os.path.join(d, c)) for c in cands]
    sheet = Image.new('RGB', (W * len(imgs), H + 20), (20, 20, 20))
    dr = ImageDraw.Draw(sheet)
    for i, (lab, p) in enumerate(imgs):
        im = Image.open(p).convert('RGB')
        im.thumbnail((W, H))
        sheet.paste(im, (i * W + (W - im.width) // 2, 20))
        dr.text((i * W + 6, 4), f'{k} {lab}', fill=(255, 220, 120))
    sheet.save(os.path.join(d, 'cands.png'))
    print('wrote', os.path.join(d, 'cands.png'))
