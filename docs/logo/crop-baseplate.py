#!/usr/bin/env python3
"""One-off: crop baseplate.png's black outer ring with per-corner radii fitted to the source.

examples:
  crop-baseplate.py                    use the default radii below
  crop-baseplate.py -r 260             set all four corners to 260
  crop-baseplate.py --tl 250 --br 240  tweak individual corners
"""
import argparse
from pathlib import Path

import numpy as np
from PIL import Image

CROP_BOX = (6, 5, 1248, 1251)
CORNER_RADII = {"tl": 247, "tr": 250, "bl": 238, "br": 233}
SUPERSAMPLE = 4

HERE = Path(__file__).resolve().parent
DEFAULT_SRC = HERE / "baseplate.png"
DEFAULT_DST = HERE / "baseplate-rounded.png"


def per_corner_mask(canvas_size, box, radii):
    ss = SUPERSAMPLE
    l, t, r, b = (v * ss for v in box)
    w, h = r - l, b - t
    rect = np.full((h, w), 255, np.uint8)
    for name, (cx, cy) in {"tl": (0, 0), "tr": (w, 0), "bl": (0, h), "br": (w, h)}.items():
        rr = radii[name] * ss
        if rr <= 0:
            continue
        ax, ay = (cx + rr if cx == 0 else cx - rr), (cy + rr if cy == 0 else cy - rr)
        ys = 0 if cy == 0 else h - rr
        xl = 0 if cx == 0 else w - rr
        yy, xx = np.mgrid[ys:ys + rr, xl:xl + rr].astype(float)
        outside = (xx + 0.5 - ax) ** 2 + (yy + 0.5 - ay) ** 2 > rr * rr
        rect[ys:ys + rr, xl:xl + rr][outside] = 0
    canvas = np.zeros((canvas_size[1] * ss, canvas_size[0] * ss), np.uint8)
    canvas[t:b, l:r] = rect
    return Image.fromarray(canvas, "L").resize(canvas_size, Image.LANCZOS)


def crop_baseplate(src, dst, radii):
    img = Image.open(src).convert("RGBA")
    img.putalpha(per_corner_mask(img.size, CROP_BOX, radii))
    img.save(dst)
    return img


def resolve_radii(args):
    radii = dict(CORNER_RADII)
    if args.radius is not None:
        radii = {corner: args.radius for corner in radii}
    for corner in radii:
        value = getattr(args, corner)
        if value is not None:
            radii[corner] = value
    return radii


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("src", nargs="?", type=Path, default=DEFAULT_SRC,
                        help="source baseplate (defaults to docs/logo/baseplate.png)")
    parser.add_argument("dst", nargs="?", type=Path, default=DEFAULT_DST,
                        help="output (defaults to docs/logo/baseplate-rounded.png)")
    parser.add_argument("-r", "--radius", type=int,
                        help="set all four corner radii at once")
    for corner in CORNER_RADII:
        parser.add_argument(f"--{corner}", type=int,
                            help=f"{corner} corner radius (default {CORNER_RADII[corner]})")
    args = parser.parse_args()

    radii = resolve_radii(args)
    img = crop_baseplate(args.src, args.dst, radii)
    print(f"{args.src} -> {args.dst}  {img.width}x{img.height}  radii {radii}")


if __name__ == "__main__":
    main()
