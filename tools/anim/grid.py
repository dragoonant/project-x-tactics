# overlay a measuring grid on orth.py renders: python grid.py <prefix>
import sys
from PIL import Image, ImageDraw
p = sys.argv[1]
for n in ('front', 'side'):
    im = Image.open(f'{p}_{n}.png').convert('RGB'); d = ImageDraw.Draw(im)
    for k in range(0, 20):
        z = k * 0.1; y = 550 - (z - 0.9) * 500
        d.line([(0, y), (1100, y)], fill=(255, 0, 0) if k % 5 == 0 else (255, 190, 190), width=1); d.text((2, y - 10), f'{z:.1f}', fill=(200, 0, 0))
    for k in range(-5, 6):
        x = 550 + k * 0.1 * 500
        d.line([(x, 0), (x, 1100)], fill=(0, 0, 255) if k == 0 else (190, 190, 255), width=1); d.text((x + 2, 2), f'{k * 0.1:.1f}', fill=(0, 0, 200))
    im.save(f'{p}_{n}_grid.png')
