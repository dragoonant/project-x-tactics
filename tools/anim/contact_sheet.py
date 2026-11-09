"""One labelled contact sheet per rig: 8 frames per clip, front and 3/4 views.  python contact_sheet.py a b"""
import os, sys
from PIL import Image, ImageDraw
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
FR = os.path.join(ROOT, 'art', 'anim-spike', 'scratch', 'frames')
OUT = os.path.join(ROOT, 'docs', 'status', 'a0')
LABEL = {'a': 'Rig A: library skeleton + Blender auto weights', 'b': 'Rig B: UniRig skeleton + Blender auto weights'}
cw, ch = 252, 312
for rig in sys.argv[1:]:
    rows = []
    for clip in ('idle', 'walk', 'aim', 'fire', 'hit'):
        d = os.path.join(FR, rig, clip)
        n = len([f for f in os.listdir(d) if f.startswith('front_')])
        idx = [round(k * (n - 1) / 7) for k in range(8)]
        for v in ('front', 'tq'):
            rows.append((clip, v, idx, d))
    sheet = Image.new('RGB', (cw * 8, ch * len(rows) + 28), (11, 15, 17))
    dr = ImageDraw.Draw(sheet)
    dr.text((8, 8), LABEL[rig] + '   (rows: clip, view; columns: 8 frames evenly across the clip)', fill=(230, 230, 230))
    for r, (clip, v, idx, d) in enumerate(rows):
        for c, k in enumerate(idx):
            im = Image.open(os.path.join(d, f'{v}_{k:03d}.png')).convert('RGB').resize((cw, ch), Image.LANCZOS)
            sheet.paste(im, (c * cw, 28 + r * ch))
            dr.text((c * cw + 6, 28 + r * ch + 4), f'{rig} {clip} {v} f{k}', fill=(200, 220, 255))
    sheet.save(os.path.join(OUT, f'sheet-{rig}.png'))
    print('wrote', rig)
