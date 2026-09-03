#!/usr/bin/env python3
"""Compose the alpha-variant app icon: stacked wordmark nudged up, LEGO tile badge below.

The badge is drawn as a moulded tile rather than flat text -- rimmed dark all
round and lit along the top edge -- so it reads as another piece on the plate
instead of an overlay stuck on top of the render.

Full pipeline, mirroring the stable icon:

    python3 make-alpha-icon.py                       # -> app-icon-alpha.png (1254)
    python3 make-app-icon.py app-icon-alpha.png \
        ../../apps/desktop/build/icon-alpha.png      # -> 1024 canvas, 824 body

The second step is not optional: build/icon.png is an 824px body centred on a
1024 canvas, and skipping it would give the two variants different body sizes.
"""
import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
BASE = HERE / "baseplate.png"
OVERLAY = HERE / "text-stacked.png"
FONT = Path("/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf")

TEXT_WIDTH_RATIO = 0.74

# Measured off text-stacked.png: the S runs full height from the left edge to
# 24% of the wordmark width, while "uper" starts 7.8% lower. That step is the
# notch the badge can sit in -- but it is only 7.4% of the wordmark tall, far
# too thin to hold a word on its own, so the top placements borrow plate margin
# above it.
NOTCH_X = 0.245
NOTCH_TOP = 0.005
NOTCH_BOTTOM = 0.078

# How much of the badge width the lettering spans. Tracking is derived from
# this rather than set as a fixed em fraction, so the word keeps filling the
# badge when the badge width changes.
TEXT_FILL = 0.66

# position -> (wordmark lift, badge width, badge aspect).
# Width is a share of the plate, or "wordmark" to match the wordmark exactly,
# or "notch" to span the S/uper step.
PLACEMENTS = {
    "bottom":      (-0.055, 0.42, 0.30),
    "bottom-wide": (-0.055, "wordmark", 0.175),
    "notch":       (0.000, 0.42, 0.135),
    "notch-tall":  (0.030, 0.40, 0.22),
    "top-right":   (0.055, 0.36, 0.26),
    "notch-fill":  (0.030, "notch", 0.20),
    "notch-fill-short": (0.030, "notch", 0.155),
}

# fill, text, and the stud/highlight colour derived from the fill
PALETTES = {
    "yellow": ("#FFC81E", "#201804"),
    "amber":  ("#F2921D", "#1B1206"),
    "red":    ("#DE3B2C", "#FFFFFF"),
    "green":  ("#7AC02A", "#122A06"),
    "cyan":   ("#1FB6CE", "#04222A"),
    "blue":   ("#2D7FE0", "#04182F"),
    "purple": ("#9B4DE0", "#FFFFFF"),
    # Maximum luminance contrast against the near-black plate, and the only
    # option that competes with none of the wordmark hues.
    "white":  ("#E9E9EE", "#17171B"),
    "slate":  ("#2E2E33", "#F2921D"),
}


def hex_rgb(value):
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def shade(rgb, factor):
    return tuple(max(0, min(255, round(c * factor))) for c in rgb)


def draw_badge(size, fill, text_color, label, text_fill=TEXT_FILL):
    """Render the badge at 4x then downsample -- keeps the rounded corners clean."""
    scale = 4
    w, h = size[0] * scale, size[1] * scale
    radius = round(h * 0.30)
    tile = Image.new("RGBA", (w, h), (0, 0, 0, 0))

    # Vertical gradient body: brighter at the top, like a lit plastic surface.
    grad = Image.new("RGBA", (1, h))
    for y in range(h):
        t = y / max(1, h - 1)
        grad.putpixel((0, y), (*shade(fill, 1.10 - 0.28 * t), 255))
    grad = grad.resize((w, h))

    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, fill=255)
    tile.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(tile)
    edge = round(scale * 1.6)
    # A moulded piece is rimmed dark all round and lit only along the top edge.
    # Shading the bottom with an arc instead reads as a scratch across the tile.
    d.rounded_rectangle([0, 0, w - 1, h - 1], radius=radius,
                        outline=(*shade(fill, 0.66), 170), width=edge)
    d.arc([edge // 2, edge // 2, w - 1 - edge // 2, h - 1 - edge // 2],
          start=185, end=355, fill=(*shade(fill, 1.34), 225), width=edge)

    font_size = round(h * 0.50)
    font = ImageFont.truetype(str(FONT), font_size)
    glyphs = [(ch, d.textlength(ch, font=font)) for ch in label]
    natural = sum(gw for _, gw in glyphs)
    # Spread the letters to the target span instead of using a fixed tracking,
    # so a wider badge is filled by the word rather than by empty plastic.
    tracking = max(round(font_size * 0.08),
                   round((w * text_fill - natural) / max(1, len(glyphs) - 1)))
    total = natural + tracking * (len(glyphs) - 1)
    box = d.textbbox((0, 0), label, font=font)
    x = (w - total) / 2
    y = (h - (box[3] - box[1])) / 2 - box[1]
    for ch, gw in glyphs:
        # A hair of dark relief under the glyph, as if stamped into the tile.
        d.text((x, y + scale), ch, font=font, fill=(*shade(fill, 0.55), 150))
        d.text((x, y), ch, font=font, fill=(*text_color, 255))
        x += gw + tracking

    return tile.resize(size, Image.LANCZOS)


def build(palette_name, dst, label="ALPHA", position="bottom-wide", text_fill=TEXT_FILL):
    fill = hex_rgb(PALETTES[palette_name][0])
    text_color = hex_rgb(PALETTES[palette_name][1])
    lift, badge_w_ratio, badge_aspect = PLACEMENTS[position]

    base = Image.open(BASE).convert("RGBA")
    overlay = Image.open(OVERLAY).convert("RGBA")

    tw = round(base.width * TEXT_WIDTH_RATIO)
    th = round(overlay.height * tw / overlay.width)
    overlay = overlay.resize((tw, th), Image.LANCZOS)
    tx = (base.width - tw) // 2
    ty = (base.height - th) // 2 + round(base.height * lift)
    base.alpha_composite(overlay, (tx, ty))

    if badge_w_ratio == "notch":
        bw = round(tw * (1 - NOTCH_X))
    elif badge_w_ratio == "wordmark":
        bw = tw
    else:
        bw = round(base.width * badge_w_ratio)
    bh = round(bw * badge_aspect)

    if position.startswith("bottom"):
        bx = (base.width - bw) // 2
        by = ty + th + round(base.height * 0.055)
    else:
        # Right-aligned with the wordmark so the badge closes the notch instead
        # of floating in the margin, and its baseline meets the top of "uper".
        bx = tx + tw - bw
        by = ty + round(th * NOTCH_BOTTOM) - bh
        if position == "top-right":
            by -= round(base.height * 0.012)

    shadow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        [bx, by + round(bh * 0.12), bx + bw, by + bh + round(bh * 0.12)],
        radius=round(bh * 0.30), fill=(0, 0, 0, 150))
    base.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(round(bh * 0.10))))
    base.alpha_composite(draw_badge((bw, bh), fill, text_color, label, text_fill), (bx, by))

    base.save(dst)
    return base


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("palette", nargs="?", default="red", choices=sorted(PALETTES))
    p.add_argument("dst", nargs="?", type=Path, default=HERE / "app-icon-alpha.png")
    p.add_argument("--label", default="ALPHA")
    p.add_argument("--position", default="bottom-wide", choices=sorted(PLACEMENTS))
    a = p.parse_args()
    img = build(a.palette, a.dst, a.label, a.position)
    print(f"{a.palette}/{a.position} -> {a.dst}  {img.width}x{img.height}")


if __name__ == "__main__":
    main()
