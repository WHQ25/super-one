#!/usr/bin/env python3
"""Scale a source image to the macOS app icon size and write it to build/icon.png."""
import argparse
from pathlib import Path

from PIL import Image

ICON_SIZE = 1024

HERE = Path(__file__).resolve().parent
DEFAULT_SRC = HERE / "logo.png"
DEFAULT_DST = HERE.parents[1] / "apps" / "desktop" / "build" / "icon.png"


def make_icon(src, dst):
    icon = Image.open(src).resize((ICON_SIZE, ICON_SIZE), Image.LANCZOS)
    dst.parent.mkdir(parents=True, exist_ok=True)
    icon.save(dst)
    return icon


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("src", nargs="?", type=Path, default=DEFAULT_SRC,
                        help="source image (defaults to docs/logo/logo.png)")
    parser.add_argument("dst", nargs="?", type=Path, default=DEFAULT_DST,
                        help="output icon (defaults to apps/desktop/build/icon.png)")
    args = parser.parse_args()
    icon = make_icon(args.src, args.dst)
    print(f"{args.src} -> {args.dst}  {icon.width}x{icon.height} {icon.mode}")


if __name__ == "__main__":
    main()
