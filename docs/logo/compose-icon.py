#!/usr/bin/env python3
"""Compose the stacked text logo centered onto the baseplate at a given width ratio."""
import argparse
from pathlib import Path

from PIL import Image

TEXT_WIDTH_RATIO = 0.74

HERE = Path(__file__).resolve().parent
DEFAULT_BASE = HERE / "baseplate.png"
DEFAULT_TEXT = HERE / "text-stacked.png"
DEFAULT_DST = HERE / "app-icon.png"


def compose(base_path, text_path, dst, ratio):
    base = Image.open(base_path).convert("RGBA")
    text = Image.open(text_path).convert("RGBA")
    w = round(base.width * ratio)
    h = round(text.height * w / text.width)
    text = text.resize((w, h), Image.LANCZOS)
    x = (base.width - w) // 2
    y = (base.height - h) // 2
    base.alpha_composite(text, (x, y))
    base.save(dst)
    return base, (w, h), (x, y)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base", nargs="?", type=Path, default=DEFAULT_BASE,
                        help="baseplate image (defaults to docs/logo/baseplate.png)")
    parser.add_argument("text", nargs="?", type=Path, default=DEFAULT_TEXT,
                        help="text logo (defaults to docs/logo/text-stacked.png)")
    parser.add_argument("dst", nargs="?", type=Path, default=DEFAULT_DST,
                        help="output (defaults to docs/logo/app-icon.png)")
    parser.add_argument("-r", "--ratio", type=float, default=TEXT_WIDTH_RATIO,
                        help=f"text width as a fraction of baseplate width (default {TEXT_WIDTH_RATIO})")
    args = parser.parse_args()
    img, size, pos = compose(args.base, args.text, args.dst, args.ratio)
    print(f"{args.base.name} + {args.text.name} -> {args.dst}  "
          f"{img.width}x{img.height}  text {size[0]}x{size[1]} at {pos}")


if __name__ == "__main__":
    main()
