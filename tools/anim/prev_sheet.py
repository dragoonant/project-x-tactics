r"""Dev montage of the Blender workbench previews: python tools/anim/prev_sheet.py <kind> <clip>[,<clip>...] [front|tq] -> art/rig/raw/prev/<kind>/sheet.png"""
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
d = os.path.join(ROOT, 'art', 'rig', 'raw', 'prev', sys.argv[1])
clips = sys.argv[2].split(',')
views = sys.argv[3].split(',') if len(sys.argv) > 3 else ['front', 'tq']
size = 300
rows = []
for c in clips:
    for v in views:
        fs = sorted(f for f in os.listdir(d) if f.startswith(c + '_') and f.endswith(f'_{v}.png') and f[len(c) + 1:].split('_')[0].isdigit())
        rows.append((c, v, fs))
w = max(len(r[2]) for r in rows)
sheet = Image.new('RGB', (size * w, size * len(rows)), (30, 30, 30))
dr = ImageDraw.Draw(sheet)
for ri, (c, v, fs) in enumerate(rows):
    for ci, f in enumerate(fs):
        im = Image.open(os.path.join(d, f)).convert('RGB').resize((size, size))
        sheet.paste(im, (ci * size, ri * size))
        dr.text((ci * size + 4, ri * size + 4), f'{c} {v} {ci}', fill=(255, 255, 0))
out = os.path.join(d, 'sheet.png')
sheet.save(out)
print(out)
