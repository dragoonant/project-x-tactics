r"""Labelled contact sheet for one figure: rows = clip x (front, 3/4), columns = 8 frames. usage: python a1_sheet.py <kind>  -> docs/status/a1/<kind>.png"""
import json
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
kind = sys.argv[1]
man = json.load(open(os.path.join(ROOT, 'public', 'assets', 'anim', 'manifest.json')))['figures'][kind]
FR = os.path.join(ROOT, 'art', 'rig', 'scratch', 'frames', kind)
cw, ch = 225, 285
rows = [(c, v) for c in man['clips'] for v in ('front', 'tq')]
sheet = Image.new('RGB', (cw * 8, ch * len(rows) + 26), (11, 15, 17))
dr = ImageDraw.Draw(sheet)
dr.text((8, 7), f'{kind}: 8 frames per clip, rows front and 3/4 (clips: {", ".join(man["clips"])}). items: {", ".join(a["id"] for a in man["attachments"]) or "none"}', fill=(230, 230, 230))
for r, (clip, v) in enumerate(rows):
    for k in range(8):
        im = Image.open(os.path.join(FR, clip, f'{v}_{k}.png')).convert('RGB').resize((cw, ch), Image.LANCZOS)
        sheet.paste(im, (k * cw, 26 + r * ch))
        dr.text((k * cw + 5, 26 + r * ch + 4), f'{clip} {v} {k}', fill=(200, 220, 255))
os.makedirs(os.path.join(ROOT, 'docs', 'status', 'a1'), exist_ok=True)
sheet.convert('RGB').save(os.path.join(ROOT, 'docs', 'status', 'a1', f'{kind}.png'), optimize=True)
print('wrote', kind)
