#!/usr/bin/env python3
"""Compose an overlay centered onto the baseplate at a given width ratio."""
import argparse
from pathlib import Path

from PIL import Image

TEXT_WIDTH_RATIO = 0.74

HERE = Path(__file__).resolve().parent
DEFAULT_BASE = HERE / "baseplate.png"
DEFAULT_OVERLAY = HERE / "text-stacked.png"
DEFAULT_DST = HERE / "app-icon.png"


def trim_transparent(image, alpha_threshold):
    alpha = image.getchannel("A")
    if alpha_threshold > 0:
        alpha = alpha.point(lambda value: 255 if value > alpha_threshold else 0)
    bbox = alpha.getbbox()
    if bbox is None:
        raise ValueError("overlay has no visible pixels")
    return image.crop(bbox)


def compose(base_path, overlay_path, dst, ratio, trim_alpha=None, offset=(0, 0)):
    base = Image.open(base_path).convert("RGBA")
    overlay = Image.open(overlay_path).convert("RGBA")
    if trim_alpha is not None:
        overlay = trim_transparent(overlay, trim_alpha)
    w = round(base.width * ratio)
    h = round(overlay.height * w / overlay.width)
    overlay = overlay.resize((w, h), Image.LANCZOS)
    x = (base.width - w) // 2 + offset[0]
    y = (base.height - h) // 2 + offset[1]
    base.alpha_composite(overlay, (x, y))
    base.save(dst)
    return base, (w, h), (x, y)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base", nargs="?", type=Path, default=DEFAULT_BASE,
                        help="baseplate image (defaults to docs/logo/baseplate.png)")
    parser.add_argument("overlay", nargs="?", type=Path, default=DEFAULT_OVERLAY,
                        help="overlay image (defaults to docs/logo/text-stacked.png)")
    parser.add_argument("dst", nargs="?", type=Path, default=DEFAULT_DST,
                        help="output (defaults to docs/logo/app-icon.png)")
    parser.add_argument("-r", "--ratio", type=float, default=TEXT_WIDTH_RATIO,
                        help=f"overlay width as a fraction of baseplate width (default {TEXT_WIDTH_RATIO})")
    parser.add_argument("--trim-alpha", type=int, metavar="THRESHOLD",
                        help="crop transparent padding using an alpha threshold from 0 to 255")
    parser.add_argument("--offset-x", type=int, default=0,
                        help="horizontal offset from center in pixels (default 0)")
    parser.add_argument("--offset-y", type=int, default=0,
                        help="vertical offset from center in pixels (default 0)")
    args = parser.parse_args()
    if args.ratio <= 0:
        parser.error("--ratio must be greater than 0")
    if args.trim_alpha is not None and not 0 <= args.trim_alpha <= 255:
        parser.error("--trim-alpha must be between 0 and 255")
    img, size, pos = compose(
        args.base, args.overlay, args.dst, args.ratio, args.trim_alpha,
        (args.offset_x, args.offset_y))
    print(f"{args.base.name} + {args.overlay.name} -> {args.dst}  "
          f"{img.width}x{img.height}  overlay {size[0]}x{size[1]} at {pos}")


if __name__ == "__main__":
    main()
