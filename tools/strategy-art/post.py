"""S-art post-processing.
  python tools/strategy-art/post.py sheet <rawdir> <prefix> <out.png> [cell_w]   candidate contact sheet (labelled)
  python tools/strategy-art/post.py build <rawdir> <picks.json>                  write public/assets/strategy images
picks.json: {"emblem-docks": 2, "sky-docks": 1, "portrait kingpin": 3, ...} (candidate index, 1-based)
"""
import sys, os, json, glob, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps, ImageChops
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'assets', 'strategy')
DISTRICTS = ['docks', 'foundry', 'spire', 'market', 'stacks', 'undercity']
SLOTS = ['kingpin', 'lt-arms', 'lt-narcotics', 'lt-protection'] + ['crew-%d' % i for i in range(1, 7)]
YELLOW = np.array([244, 196, 24], dtype=np.float32)


def sheet(raw, prefix, out, cw=300):
    files = sorted(glob.glob(os.path.join(raw, prefix + '*_*.png')))
    ims = [(os.path.basename(f)[:-4], Image.open(f).convert('RGB')) for f in files]
    if not ims:
        print('none'); return
    cols = 4
    ch = int(cw * ims[0][1].height / ims[0][1].width)
    rows = (len(ims) + cols - 1) // cols
    sh = Image.new('RGB', (cols * cw, rows * (ch + 18)), (20, 20, 22))
    d = ImageDraw.Draw(sh)
    for i, (n, im) in enumerate(ims):
        x, y = (i % cols) * cw, (i // cols) * (ch + 18)
        sh.paste(im.resize((cw, ch)), (x, y + 18))
        d.text((x + 4, y + 3), n, fill=(255, 255, 255))
    sh.save(out)
    print(out, sh.size)


def load(raw, name, k):
    return Image.open(os.path.join(raw, '%s_%d.png' % (name, k))).convert('RGB')


def emblem(im):
    a = np.asarray(im, dtype=np.float32) / 255.0
    lum = a.max(axis=2)
    alpha = np.clip((lum - 0.12) / 0.45, 0, 1)
    rgb = np.broadcast_to(YELLOW, a.shape[:2] + (3,))
    out = np.dstack([rgb, alpha[..., None] * 255]).astype(np.uint8)
    e = Image.fromarray(out, 'RGBA')
    bb = e.getchannel('A').point(lambda v: 255 if v > 20 else 0).getbbox()
    if bb:
        m = 28
        e = e.crop((max(bb[0] - m, 0), max(bb[1] - m, 0), min(bb[2] + m, e.width), min(bb[3] + m, e.height)))
        s = max(e.size)
        sq = Image.new('RGBA', (s, s), (0, 0, 0, 0))
        sq.paste(e, ((s - e.width) // 2, (s - e.height) // 2))
        e = sq
    return e.resize((512, 512), Image.LANCZOS)


def skyline(im):
    w, h = im.size
    th = int(w / 2)  # 2:1 strip
    top = int((h - th) * 0.55)
    im = im.crop((0, top, w, top + th))
    return im.resize((1024, 512), Image.LANCZOS)


def portrait(im, seed):
    rnd = np.random.default_rng(seed)
    g = ImageOps.grayscale(im)
    g = ImageOps.autocontrast(g, cutoff=1)
    a = np.asarray(g, dtype=np.float32) / 255.0
    a = np.clip((a - 0.5) * 1.15 + 0.5, 0, 1)
    h, w = a.shape
    yy, xx = np.mgrid[0:h, 0:w]
    vig = 1 - 0.35 * (((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2) / 2
    a = a * vig + rnd.normal(0, 0.055, a.shape)
    a = np.clip(a, 0, 1)
    tint = np.dstack([a * 1.0, a * 0.94, a * 0.82])
    tint = np.clip(tint * 0.92 + 0.04, 0, 1)
    ph = Image.fromarray((tint * 255).astype(np.uint8), 'RGB').filter(ImageFilter.GaussianBlur(0.5))
    # printed photo: off-white paper border
    b = 26
    paper = Image.new('RGB', (w + 2 * b, h + 2 * b + 18), (228, 222, 208))
    paper.paste(ph, (b, b))
    pa = np.asarray(paper, dtype=np.float32) + rnd.normal(0, 3, (paper.height, paper.width, 1))
    paper = Image.fromarray(np.clip(pa, 0, 255).astype(np.uint8), 'RGB')
    return paper.resize((768, 1024), Image.LANCZOS)


def tex(im, size=1024):
    return im.resize((size, size), Image.LANCZOS)


def build(raw, picks):
    P = json.load(open(picks))
    for sub in ['emblems', 'skylines', 'portraits', 'textures']:
        os.makedirs(os.path.join(OUT, sub), exist_ok=True)
    for d in DISTRICTS:
        emblem(load(raw, 'emblem-' + d, P['emblem-' + d])).save(os.path.join(OUT, 'emblems', d + '.webp'), quality=90, method=6)
        skyline(load(raw, 'sky-' + d, P['sky-' + d])).save(os.path.join(OUT, 'skylines', d + '.webp'), quality=78, method=6)
    for i, s in enumerate(SLOTS):
        portrait(load(raw, s, P[s]), 100 + i).save(os.path.join(OUT, 'portraits', s + '.webp'), quality=80, method=6)
    tex(load(raw, 'tex-table', P['tex-table'])).save(os.path.join(OUT, 'textures', 'table.webp'), quality=80, method=6)
    tex(load(raw, 'tex-corkboard', P['tex-corkboard'])).save(os.path.join(OUT, 'textures', 'corkboard.webp'), quality=80, method=6)
    print('built')


if __name__ == '__main__':
    c = sys.argv[1]
    if c == 'sheet':
        sheet(sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5]) if len(sys.argv) > 5 else 300)
    elif c == 'build':
        build(sys.argv[2], sys.argv[3])
