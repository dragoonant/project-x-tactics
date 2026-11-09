r"""Item gate sheets: one row per item (original concept + the Flux candidates), several items per image.
usage: python tools/anim/sheet_items.py   (writes art/rig/items/sheet_1.png, sheet_2.png)"""
import json
import os

from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
P = json.load(open(os.path.join(ROOT, 'tools', 'anim', 'rig_prompts.json')))['items']['items']
ids = list(P)
W, H = 340, 255
for sn, chunk in enumerate((ids[:7], ids[7:]), 1):
    sheet = Image.new('RGB', (W * 4, (H + 14) * len(chunk)), (20, 20, 20))
    dr = ImageDraw.Draw(sheet)
    for r, k in enumerate(chunk):
        d = os.path.join(ROOT, 'art', 'rig', 'items', k)
        files = [('original', os.path.join(ROOT, P[k]['base']))] + [(f[:-4], os.path.join(d, f)) for f in sorted(os.listdir(d)) if f.startswith('cand_') and f.endswith('.png')]
        for c, (lab, p) in enumerate(files[:4]):
            im = Image.open(p).convert('RGB')
            im.thumbnail((W, H))
            sheet.paste(im, (c * W, r * (H + 14) + 14))
            dr.text((c * W + 4, r * (H + 14) + 1), f'{k} {lab}', fill=(255, 220, 120))
    sheet.save(os.path.join(ROOT, 'art', 'rig', 'items', f'sheet_{sn}.png'))
    print('wrote sheet', sn)
