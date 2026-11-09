"""Review sheet of the shipped strategy assets: python tools/strategy-art/final_sheet.py <out.png>"""
import os, sys
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
A = os.path.join(ROOT, 'public', 'assets', 'strategy')
D = ['docks', 'foundry', 'spire', 'market', 'stacks', 'undercity']
S = ['kingpin', 'lt-arms', 'lt-narcotics', 'lt-protection'] + ['crew-%d' % i for i in range(1, 7)]
W = 1800
sheet = Image.new('RGB', (W, 1900), (24, 24, 28))
d = ImageDraw.Draw(sheet)
y = 6
d.text((8, y), 'emblems (on dark grey, transparent webp)', fill=(255, 255, 255)); y += 16
for i, n in enumerate(D):
    e = Image.open(os.path.join(A, 'emblems', n + '.webp')).convert('RGBA').resize((200, 200))
    bg = Image.new('RGBA', (200, 200), (60, 60, 66, 255)); bg.alpha_composite(e)
    sheet.paste(bg.convert('RGB'), (8 + i * 205, y)); d.text((12 + i * 205, y + 2), n, fill=(255, 255, 255))
y += 210
d.text((8, y), 'skylines (1024x512)', fill=(255, 255, 255)); y += 16
for i, n in enumerate(D):
    s = Image.open(os.path.join(A, 'skylines', n + '.webp')).convert('RGB').resize((440, 220))
    sheet.paste(s, (8 + (i % 4) * 445, y + (i // 4) * 225)); d.text((12 + (i % 4) * 445, y + (i // 4) * 225 + 2), n, fill=(255, 255, 255))
# tables of textures beside the second skyline row
for j, (n, f) in enumerate([('table', 'table.webp'), ('board', 'corkboard.webp')]):
    t = Image.open(os.path.join(A, 'textures', f)).convert('RGB').resize((220, 220))
    sheet.paste(t, (8 + 2 * 445 + j * 225, y + 225)); d.text((12 + 2 * 445 + j * 225, y + 227), 'texture ' + n, fill=(255, 255, 255))
y += 460
d.text((8, y), 'case board portraits (768x1024)', fill=(255, 255, 255)); y += 16
for i, n in enumerate(S):
    p = Image.open(os.path.join(A, 'portraits', n + '.webp')).convert('RGB').resize((174, 232))
    sheet.paste(p, (8 + i * 178, y)); d.text((12 + i * 178, y + 2), n, fill=(255, 255, 255))
y += 240
sheet.crop((0, 0, W, y)).save(sys.argv[1])
print(sys.argv[1], (W, y))
