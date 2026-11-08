#!/usr/bin/env python3
"""
BUYBUDDY brand renderer.

One source of truth for the logo geometry, rasterised at any size with Pillow:
app icons (Android densities + PWA), splash screens, favicons and marketing art.

The matching vector version for the web lives at web/public/logo/logo-mark.svg —
keep the two in step if the mark changes.

Usage:
    python3 scripts/brand_icons.py            # regenerate every icon + splash
"""
import os
from PIL import Image, ImageDraw, ImageFilter

# ----------------------------------------------------------------------------
# palette
# ----------------------------------------------------------------------------
TILE_TOP = (31, 138, 108)
TILE_MID = (23, 107, 85)
TILE_END = (10, 52, 42)
BAG_TOP = (255, 255, 255)
BAG_END = (234, 243, 239)
SPARK_A = (255, 176, 102)
SPARK_B = (228, 121, 47)

SS = 4  # supersampling factor for smooth edges


def _lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def _gradient(size, stops):
    """Vertical multi-stop gradient image."""
    w, h = size
    img = Image.new('RGB', (w, h))
    px = img.load()
    segments = [(i / (len(stops) - 1), c) for i, c in enumerate(stops)]
    for y in range(h):
        t = y / max(1, h - 1)
        for (p0, c0), (p1, c1) in zip(segments, segments[1:]):
            if p0 <= t <= p1:
                local = (t - p0) / max(1e-6, p1 - p0)
                col = _lerp(c0, c1, local)
                break
        else:
            col = stops[-1]
        for x in range(w):
            px[x, y] = col
    return img


def _diag_gradient(size, c0, c1):
    """Diagonal gradient, used for the accent spark."""
    w, h = size
    img = Image.new('RGB', (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            t = (x / max(1, w - 1) + y / max(1, h - 1)) / 2
            px[x, y] = _lerp(c0, c1, t)
    return img


def logo(size, rounded=True, background=True, glyph_only=False):
    """
    The BUYBUDDY mark: gradient tile, soft top sheen, a white shopping bag whose
    handle is tucked behind the body, and the warm-orange 'buddy' spark.

    Drawn as geometry (not a bitmap) so every size stays crisp.
    """
    import math
    s = size * SS
    canvas = Image.new('RGBA', (s, s), (0, 0, 0, 0))

    if background:
        tile = _gradient((s, s), [TILE_TOP, TILE_MID, TILE_END]).convert('RGBA')
        mask = Image.new('L', (s, s), 0)
        md = ImageDraw.Draw(mask)
        if rounded:
            md.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.235), fill=255)
        else:
            md.rectangle([0, 0, s, s], fill=255)
        canvas.paste(tile, (0, 0), mask)

        # soft sheen across the top-left, blurred so there is no visible edge
        gloss = Image.new('RGBA', (s, s), (0, 0, 0, 0))
        gd = ImageDraw.Draw(gloss)
        gd.ellipse([-s * 0.55, -s * 0.95, s * 1.05, s * 0.46], fill=(255, 255, 255, 34))
        gloss = gloss.filter(ImageFilter.GaussianBlur(s * 0.06))
        if rounded:
            gloss = Image.composite(gloss, Image.new('RGBA', (s, s), (0, 0, 0, 0)), mask)
        canvas.alpha_composite(gloss)

    d = ImageDraw.Draw(canvas)

    # ---- geometry -----------------------------------------------------------
    bw = s * 0.435                     # bag width
    bh = s * 0.335                     # bag height
    bx = (s - bw) / 2
    by = s * 0.435                     # bag top
    radius = int(bw * 0.215)           # generous, modern rounding

    # ---- handle (drawn first so the bag body tucks it in) -------------------
    stroke = max(3, int(s * 0.042))
    hr = s * 0.092                     # handle radius
    hcx = s / 2
    hcy = by + s * 0.022               # handle centre sits just inside the bag top
    pts = []
    for step in range(31):
        a = math.pi + (math.pi * step / 30)      # 180° → 360°
        pts.append((hcx + hr * math.cos(a), hcy + hr * math.sin(a)))
    d.line(pts, fill=(255, 255, 255, 255), width=stroke, joint='curve')
    cap = stroke / 2
    for px_, py_ in (pts[0], pts[-1]):
        d.ellipse([px_ - cap, py_ - cap, px_ + cap, py_ + cap], fill=(255, 255, 255, 255))

    # ---- bag body -----------------------------------------------------------
    body = _gradient((int(bw) + 2, int(bh) + 2), [BAG_TOP, BAG_END]).convert('RGBA')
    body_mask = Image.new('L', body.size, 0)
    ImageDraw.Draw(body_mask).rounded_rectangle(
        [0, 0, body.size[0] - 1, body.size[1] - 1], radius=radius, fill=255
    )
    canvas.paste(body, (int(bx), int(by)), body_mask)


    # ---- buddy spark --------------------------------------------------------
    if not glyph_only:
        r = s * 0.058
        cx, cy = bx + bw - r * 0.05, by - r * 0.72
        spark = _diag_gradient((int(r * 2) + 2, int(r * 2) + 2), SPARK_A, SPARK_B).convert('RGBA')
        smask = Image.new('L', spark.size, 0)
        ImageDraw.Draw(smask).ellipse([0, 0, spark.size[0] - 1, spark.size[1] - 1], fill=255)
        canvas.paste(spark, (int(cx - r), int(cy - r)), smask)
        # white halo separates the spark from the bag
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(255, 255, 255, 235),
                  width=max(2, int(s * 0.012)))
        arm = r * 0.42
        w = max(2, int(s * 0.016))
        d.line([(cx - arm, cy), (cx + arm, cy)], fill=(255, 255, 255, 250), width=w)
        d.line([(cx, cy - arm), (cx, cy + arm)], fill=(255, 255, 255, 250), width=w)

    return canvas.resize((size, size), Image.LANCZOS)


def wordmark(width=1200, height=320, dark_bg=False):
    """Logo tile + 'BUYBUDDY' lockup for banners and the README."""
    s = height
    canvas = Image.new('RGBA', (width, height), (0, 0, 0, 0) if not dark_bg else (12, 59, 48, 255))
    mark = logo(int(s * 0.78))
    canvas.alpha_composite(mark, (int(s * 0.10), int(s * 0.11)))

    d = ImageDraw.Draw(canvas)
    try:
        from PIL import ImageFont
        font = None
        for path in (
            '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
            '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
        ):
            if os.path.exists(path):
                font = ImageFont.truetype(path, int(s * 0.34))
                break
        if font:
            ink = (255, 255, 255, 255) if dark_bg else (10, 52, 42, 255)
            sub = (255, 255, 255, 170) if dark_bg else (107, 124, 118, 255)
            d.text((int(s * 1.02), int(s * 0.24)), 'BUYBUDDY', font=font, fill=ink)
            small = ImageFont.truetype(font.path, int(s * 0.105))
            d.text((int(s * 1.04), int(s * 0.66)), 'YOUR PERSONAL SHOPPING PARTNER', font=small, fill=sub)
    except Exception:
        pass
    return canvas


# ----------------------------------------------------------------------------
# outputs
# ----------------------------------------------------------------------------
def build(repo_root):
    web_icons = os.path.join(repo_root, 'web', 'public', 'icons')
    logo_dir = os.path.join(repo_root, 'web', 'public', 'logo')
    res = os.path.join(repo_root, 'mobile', 'android', 'app', 'src', 'main', 'res')
    os.makedirs(web_icons, exist_ok=True)
    os.makedirs(logo_dir, exist_ok=True)

    # ---- PWA / web ----------------------------------------------------------
    logo(192).save(os.path.join(web_icons, 'icon-192.png'))
    logo(512).save(os.path.join(web_icons, 'icon-512.png'))
    logo(180).save(os.path.join(web_icons, 'apple-touch-icon.png'))
    logo(32).save(os.path.join(web_icons, 'favicon-32.png'))
    logo(512, rounded=False).save(os.path.join(web_icons, 'icon-maskable-512.png'))
    logo(512).save(os.path.join(logo_dir, 'logo-mark-512.png'))
    logo(512, background=False, glyph_only=False).save(os.path.join(logo_dir, 'logo-glyph-512.png'))
    wordmark().save(os.path.join(logo_dir, 'logo-lockup.png'))

    # ---- Android launcher icons --------------------------------------------
    densities = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
    for name, px in densities.items():
        folder = os.path.join(res, f'mipmap-{name}')
        os.makedirs(folder, exist_ok=True)
        icon = logo(px)
        icon.save(os.path.join(folder, 'ic_launcher.png'))

        round_mask = Image.new('L', (px, px), 0)
        ImageDraw.Draw(round_mask).ellipse([0, 0, px - 1, px - 1], fill=255)
        rounded = Image.new('RGBA', (px, px), (0, 0, 0, 0))
        rounded.paste(icon, (0, 0), round_mask)
        rounded.save(os.path.join(folder, 'ic_launcher_round.png'))

        # adaptive foreground: full-bleed tile, glyph within the 66% safe zone
        fg_px = int(px * 108 / 48)
        fg = logo(fg_px, background=False, glyph_only=False)
        # scale the glyph down so launcher masks never clip it
        scaled = fg.resize((int(fg_px * 0.66), int(fg_px * 0.66)), Image.LANCZOS)
        canvas = Image.new('RGBA', (fg_px, fg_px), (0, 0, 0, 0))
        off = (fg_px - scaled.width) // 2
        canvas.alpha_composite(scaled, (off, off))
        canvas.save(os.path.join(folder, 'ic_launcher_foreground.png'))

    # ---- splash -------------------------------------------------------------
    targets = {
        'drawable-port-mdpi': (320, 480), 'drawable-port-hdpi': (480, 800),
        'drawable-port-xhdpi': (720, 1280), 'drawable-port-xxhdpi': (960, 1600),
        'drawable-port-xxxhdpi': (1280, 1920),
        'drawable-land-mdpi': (480, 320), 'drawable-land-hdpi': (800, 480),
        'drawable-land-xhdpi': (1280, 720), 'drawable-land-xxhdpi': (1600, 960),
        'drawable-land-xxxhdpi': (1920, 1280),
    }
    for folder, (w, h) in targets.items():
        path = os.path.join(res, folder)
        os.makedirs(path, exist_ok=True)
        sheet = _gradient((w, h), [TILE_TOP, TILE_MID, TILE_END]).convert('RGBA')
        glyph = logo(int(min(w, h) * 0.42), background=False)
        sheet.alpha_composite(glyph, ((w - glyph.width) // 2, (h - glyph.height) // 2))
        sheet.convert('RGB').save(os.path.join(path, 'splash.png'), 'PNG', optimize=True)

    sheet = _gradient((480, 320), [TILE_TOP, TILE_MID, TILE_END]).convert('RGBA')
    glyph = logo(int(min(480, 320) * 0.42), background=False)
    sheet.alpha_composite(glyph, ((480 - glyph.width) // 2, (320 - glyph.height) // 2))
    sheet.convert('RGB').save(os.path.join(res, 'drawable', 'splash.png'), 'PNG', optimize=True)

    print('brand: icons, lockup and splash regenerated')


if __name__ == '__main__':
    build(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
