"""python compose_before_after.py before.png after.png out.png : the two shots side by side at full size, labelled."""
import sys
from PIL import Image, ImageDraw
a, b, out = Image.open(sys.argv[1]).convert('RGB'), Image.open(sys.argv[2]).convert('RGB'), sys.argv[3]
w, h = a.size
sheet = Image.new('RGB', (2 * w + 6, h + 28), (8, 10, 14))
sheet.paste(a, (0, 28))
sheet.paste(b, (w + 6, 28))
d = ImageDraw.Draw(sheet)
d.text((10, 8), 'BEFORE  ?terrain=v1', fill=(255, 176, 0))
d.text((w + 16, 8), 'AFTER  default (terrain v2, T1)', fill=(67, 224, 138))
sheet.save(out)
