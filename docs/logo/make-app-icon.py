#!/usr/bin/env python3
"""Scale a source image onto the macOS 824/1024 icon grid and write it to build/icon.png."""
import argparse
from pathlib import Path

from PIL import Image

ICON_SIZE = 1024
BODY_SIZE = 824

HERE = Path(__file__).resolve().parent
DEFAULT_SRC = HERE / "app-icon.png"
DEFAULT_DST = HERE.parents[1] / "apps" / "desktop" / "build" / "icon.png"


def make_icon(src, dst, body_size):
    body = Image.open(src).convert("RGBA").resize((body_size, body_size), Image.LANCZOS)
    canvas = Image.new("RGBA", (ICON_SIZE, ICON_SIZE), (0, 0, 0, 0))
    offset = (ICON_SIZE - body_size) // 2
    canvas.paste(body, (offset, offset), body)
    dst.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(dst)
    return canvas


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("src", nargs="?", type=Path, default=DEFAULT_SRC,
                        help="source image (defaults to docs/logo/app-icon.png)")
    parser.add_argument("dst", nargs="?", type=Path, default=DEFAULT_DST,
                        help="output icon (defaults to apps/desktop/build/icon.png)")
    parser.add_argument("-b", "--body", type=int, default=BODY_SIZE,
                        help=f"icon body size on the {ICON_SIZE} canvas (default {BODY_SIZE})")
    args = parser.parse_args()
    icon = make_icon(args.src, args.dst, args.body)
    print(f"{args.src} -> {args.dst}  {icon.width}x{icon.height}  body {args.body}")


if __name__ == "__main__":
    main()
