# usage: python contact.py <out.png> <cols> <img1> [img2 ...]   (labels = file stem / parent folder)
import sys, os
from PIL import Image, ImageDraw
out, cols, files = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
W, H = 480, 360
rows = (len(files) + cols - 1) // cols
sheet = Image.new('RGB', (W * cols, (H + 24) * rows), 'white')
d = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    im = Image.open(f).convert('RGB'); im.thumbnail((W, H))
    x, y = (i % cols) * W, (i // cols) * (H + 24)
    sheet.paste(im, (x + (W - im.width) // 2, y + 24))
    d.text((x + 6, y + 6), f"{i + 1}: {os.path.basename(os.path.dirname(f))}/{os.path.basename(f)}", fill='black')
os.makedirs(os.path.dirname(out), exist_ok=True)
sheet.save(out)
