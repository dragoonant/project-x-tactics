# python sheet_dir.py <dir> <clip> [out.png]  : 2 rows (front, 3/4) x 8 columns contact sheet of preview frames
import sys, os
from PIL import Image, ImageDraw
d, clip = sys.argv[1], sys.argv[2]
out = sys.argv[3] if len(sys.argv) > 3 else os.path.join(d, f'sheet_{clip}.png')
ims = [[Image.open(os.path.join(d, f'{clip}_{k}_{v}.png')).convert('RGB') for k in range(8)] for v in ('front', 'tq')]
w, h = ims[0][0].size
s = Image.new('RGB', (w * 8, h * 2), 'white')
for r in range(2):
    for k in range(8):
        s.paste(ims[r][k], (k * w, r * h))
        ImageDraw.Draw(s).text((k * w + 4, r * h + 4), f'{clip} {k}', fill=(0, 0, 0))
s.save(out)
