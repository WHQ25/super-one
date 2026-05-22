#!/usr/bin/env python3
"""Remove a solid/near-solid background color from images and write transparent PNGs."""
import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import binary_dilation, binary_erosion, uniform_filter


def estimate_background(arr, border):
    frame = np.concatenate([
        arr[:border].reshape(-1, 3),
        arr[-border:].reshape(-1, 3),
        arr[:, :border].reshape(-1, 3),
        arr[:, -border:].reshape(-1, 3),
    ])
    return np.median(frame, axis=0)


def reference_foreground(arr, solid, band):
    core = binary_erosion(solid, iterations=band)
    blur = band * 6 + 1
    weight = uniform_filter(core.astype(np.float32), size=blur)
    ref = np.dstack([uniform_filter(arr[:, :, c] * core, size=blur) for c in range(3)])
    safe = weight > 1e-3
    ref[safe] /= weight[safe][:, None]
    ref[~safe] = arr[~safe]
    return ref


def remove_background(path, out_path, inner, outer, border, band, bg_override):
    img = Image.open(path).convert("RGB")
    arr = np.asarray(img).astype(np.float32)

    bg = np.array(bg_override, np.float32) if bg_override else estimate_background(arr, border)
    dist = np.sqrt(((arr - bg) ** 2).sum(axis=2))
    alpha = np.clip((dist - inner) / max(outer - inner, 1e-6), 0.0, 1.0)

    solid = alpha >= 0.95
    ref = reference_foreground(arr, solid, band)
    edge = binary_dilation(solid, iterations=band) & binary_dilation(~solid, iterations=band)

    dc = arr[edge] - bg
    df = ref[edge] - bg
    alpha[edge] = np.clip((dc * df).sum(axis=1) / np.maximum((df * df).sum(axis=1), 1e-6), 0.0, 1.0)

    mix = (alpha > 0.0) & (alpha < 1.0)
    a = alpha[mix][:, None]
    rgb = arr.copy()
    rgb[mix] = np.clip((arr[mix] - (1.0 - a) * bg) / a, 0.0, 255.0)

    out = np.dstack([
        np.clip(rgb, 0.0, 255.0).astype(np.uint8),
        np.round(alpha * 255.0).astype(np.uint8),
    ])
    Image.fromarray(out, "RGBA").save(out_path)
    return bg, int((alpha == 0.0).sum()), int(mix.sum()), alpha.size


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inputs", nargs="+", type=Path, help="image files to process")
    parser.add_argument("--inner", type=float, default=44.0,
                        help="color distance at or below which a pixel is fully transparent")
    parser.add_argument("--outer", type=float, default=100.0,
                        help="color distance at or above which a pixel is fully opaque")
    parser.add_argument("--border", type=int, default=6,
                        help="border width in pixels sampled to auto-detect the background color")
    parser.add_argument("--band", type=int, default=4,
                        help="half-width in pixels of the edge band that gets alpha refined and despilled")
    parser.add_argument("--bg", type=int, nargs=3, metavar=("R", "G", "B"),
                        help="override the auto-detected background color")
    parser.add_argument("--suffix", default="-nobg", help="suffix appended to output file names")
    parser.add_argument("--outdir", type=Path, help="output directory (defaults next to each input)")
    args = parser.parse_args()

    failed = False
    for path in args.inputs:
        if not path.is_file():
            print(f"skip (not found): {path}", file=sys.stderr)
            failed = True
            continue
        out_dir = args.outdir or path.parent
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"{path.stem}{args.suffix}.png"

        bg, transparent, mixed, total = remove_background(
            path, out_path, args.inner, args.outer, args.border, args.band,
            tuple(args.bg) if args.bg else None,
        )
        print(f"{path.name} -> {out_path.name}  "
              f"bg=rgb({int(bg[0])},{int(bg[1])},{int(bg[2])})  "
              f"transparent={100.0 * transparent / total:.1f}%  refined={mixed}px")

    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
