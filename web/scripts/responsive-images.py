#!/usr/bin/env python3
"""
Build the small versions of every product photo.

A category tile is drawn 92 CSS px wide; a product card about 170. Both were
being fed the full 640x640 JPEG — 40 to 75 KB each, 380 KB of the home screen on
a 2 MB photo. This writes WebP and JPEG versions at 160 and 400 px next to the
original (never replacing it, so the product page keeps its detail), and the
app picks one with <picture>/srcset.

Run from web/:  python3 scripts/responsive-images.py
"""
import os
import re
from PIL import Image

SRC = 'public/img/products'
SIZES = [160, 240, 400]
QUALITY = {'webp': 74, 'jpg': 76}

made = 0
saved_before = 0
saved_after = 0
for name in sorted(os.listdir(SRC)):
    if not name.lower().endswith(('.jpg', '.jpeg', '.png')):
        continue
    # never re-encode our own output (a 400 px version of a 400 px version)
    if re.search(r'-\d+\.(jpe?g|png)$', name, re.I):
        continue
    stem = os.path.splitext(name)[0]
    path = os.path.join(SRC, name)
    im = Image.open(path).convert('RGB')
    saved_before += os.path.getsize(path)
    after = 0
    for size in SIZES:
        out = im.resize((size, size), Image.LANCZOS)
        webp = os.path.join(SRC, f'{stem}-{size}.webp')
        out.save(webp, 'WEBP', quality=QUALITY['webp'], method=6)
        jpg = os.path.join(SRC, f'{stem}-{size}.jpg')
        out.save(jpg, 'JPEG', quality=QUALITY['jpg'], optimize=True, progressive=True)
        after += os.path.getsize(webp)
        made += 2
    # the same 640 px, re-encoded: the hero banner is drawn full width at 2x and
    # was shipping the original 75 KB JPEG where 43 KB of WebP is identical
    full = os.path.join(SRC, f'{stem}-640.webp')
    im.save(full, 'WEBP', quality=QUALITY['webp'], method=6)
    made += 1
    saved_after += after

print(f'wrote {made} files')
print(f'originals: {saved_before/1024:.0f} KB -> the 160+400 webp pair: {saved_after/1024:.0f} KB')
