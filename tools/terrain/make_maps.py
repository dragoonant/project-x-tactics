"""Flux output -> seamless tile + normal + roughness (WebP) + 3x3 tiling check sheet.

usage: python make_maps.py   (run from the repo root; picks are listed below)
Seamless method: two 1-D passes; each blends the image with a copy rolled by half the size, weighted so the original
edges take the rolled pixels (which are neighbours across the wrap) and the centre keeps the original.
The door panel is a single non-repeating panel, so it is not made seamless.
"""
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

RAW = 'art/terrain-spike/raw/tex'
OUT = 'public/assets/terrain/textures'
SHEETS = 'art/terrain-spike'

# slug: (raw file, seamless, normal strength)
PICKS = {
    'asphalt': ('asphalt_1.png', True, 2.2),
    'brick': ('brick_1.png', True, 3.0),
    'corrugated': ('corrugated_1.png', True, 3.0),
    'tilefloor': ('tilefloor_1.png', True, 2.4),
    'steeldoor': ('steeldoor_1.png', False, 2.0),
}


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def seamless(img):
    a = img.astype(np.float32)
    for axis in (1, 0):
        n = a.shape[axis]
        u = (np.arange(n) + 0.5) / n
        wgt = smoothstep(0.0, 0.5, 1 - np.abs(2 * u - 1))  # 0 at the edges, 1 at the centre
        wgt = wgt.reshape((1, n, 1) if axis == 1 else (n, 1, 1))
        a = a * wgt + np.roll(a, n // 2, axis=axis) * (1 - wgt)
    return np.clip(a, 0, 255).astype(np.uint8)


def luma(a):
    return (0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]) / 255.0


def blur(x, s):
    return ndi.gaussian_filter(x, s, mode='wrap')


def height_map(a):
    l = luma(a)
    return 0.6 * blur(l, 1.2) + 0.4 * blur(l, 6.0)


def normal_map(h, strength):
    gx = ndi.sobel(h, axis=1, mode='wrap') / 8.0
    gr = ndi.sobel(h, axis=0, mode='wrap') / 8.0
    nx, ny, nz = -gx * strength * 8, gr * strength * 8, np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    n = np.stack([nx / ln, ny / ln, nz / ln], -1)
    return ((n * 0.5 + 0.5) * 255).astype(np.uint8)


def roughness(slug, a):
    r, g, b = [a[..., i].astype(np.float32) / 255 for i in range(3)]
    l = luma(a)
    chroma = blur(np.max(a, -1).astype(np.float32) / 255 - np.min(a, -1).astype(np.float32) / 255, 3)
    if slug == 'asphalt':
        # puddles are the tinted (purple / teal) patches: low roughness there
        puddle = smoothstep(0.10, 0.22, chroma)
        return np.clip(0.9 - 0.72 * puddle - 0.12 * blur(l, 4), 0.08, 1), puddle
    if slug == 'brick':
        return np.clip(0.78 + 0.2 * (1 - blur(l, 2)), 0, 1), None
    if slug == 'corrugated':
        rust = smoothstep(0.05, 0.25, blur(r - b, 2))
        return np.clip(0.5 + 0.4 * rust, 0, 1), None
    if slug == 'tilefloor':
        return np.clip(0.42 + 0.5 * (1 - smoothstep(0.1, 0.45, blur(l, 2))), 0, 1), None
    if slug == 'steeldoor':
        scr = smoothstep(0.02, 0.12, l - blur(l, 4))
        rust = smoothstep(0.05, 0.25, blur(r - b, 2))
        return np.clip(0.5 - 0.2 * scr + 0.4 * rust, 0, 1), None
    return np.full_like(l, 0.7), None


def save_webp(arr, path, q):
    Image.fromarray(arr).save(path, 'WEBP', quality=q, method=6)


def main():
    os.makedirs(OUT, exist_ok=True)
    only = sys.argv[1:] or list(PICKS)
    for slug in only:
        fn, seam, strength = PICKS[slug]
        a = np.array(Image.open(os.path.join(RAW, fn)).convert('RGB'))
        if seam:
            a = seamless(a)
        h = height_map(a)
        rough, puddle = roughness(slug, a)
        if puddle is not None:
            h = h * (1 - 0.85 * puddle) + blur(h, 8) * 0.85 * puddle  # puddles are flat
        n = normal_map(h, strength)
        r8 = (rough * 255).astype(np.uint8)
        save_webp(a, f'{OUT}/{slug}_color.webp', 86)
        save_webp(n, f'{OUT}/{slug}_normal.webp', 90)
        save_webp(np.stack([r8, r8, r8], -1), f'{OUT}/{slug}_rough.webp', 85)
        # 3x3 check sheet (colour), downsized to 1536 so the file stays small
        im = Image.fromarray(a)
        sheet = Image.new('RGB', (3 * 512, 3 * 512))
        t = im.resize((512, 512), Image.LANCZOS)
        for i in range(3):
            for j in range(3):
                sheet.paste(t, (i * 512, j * 512))
        sheet.save(f'{SHEETS}/tilecheck-{slug}.jpg', quality=85)
        print(slug, 'ok', [os.path.getsize(f'{OUT}/{slug}_{k}.webp') // 1024 for k in ('color', 'normal', 'rough')], 'KB')


main()
