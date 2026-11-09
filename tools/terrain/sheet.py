"""Contact sheet of the 4 concept candidates of each slug: python sheet.py <slug> [...]  -> art/terrain/concepts/sheet_<slug>.jpg (2x2, 400 px cells, numbered)."""
import sys, os
from PIL import Image, ImageDraw
root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
d = os.path.join(root, 'art', 'terrain', 'concepts')
for slug in sys.argv[1:]:
    sh = Image.new('RGB', (800, 800), 'white')
    for k in range(4):
        p = os.path.join(d, f'{slug}_{k + 1}.png')
        if not os.path.exists(p):
            continue
        im = Image.open(p).convert('RGB').resize((400, 400))
        ImageDraw.Draw(im).text((8, 8), str(k + 1), fill=(255, 0, 0))
        sh.paste(im, ((k % 2) * 400, (k // 2) * 400))
    sh.save(os.path.join(d, f'sheet_{slug}.jpg'), quality=85)
    print(slug)
