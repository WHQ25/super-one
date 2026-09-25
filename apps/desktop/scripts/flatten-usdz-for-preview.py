#!/usr/bin/env python3
"""Create a static, Three.js-readable preview copy of a composed USDZ stage.

Requires the macOS USD `usdcat` command. The output is a derivative for local
preview only: flattening resolves the selected variants and discards controls
needed for a foldable device simulation.
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import tempfile
from pathlib import Path, PurePosixPath
from zipfile import ZIP_STORED, ZipFile

MAX_EXPANDED_BYTES = 256 * 1024 * 1024
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".avif"}


def flatten(source: Path, destination: Path) -> None:
    source = source.resolve(strict=True)
    destination = destination.resolve()
    if source == destination:
        raise ValueError("Output must differ from the source USDZ")
    if source.suffix.lower() != ".usdz" or destination.suffix.lower() != ".usdz":
        raise ValueError("Input and output must both use .usdz")
    usdcat = shutil.which("usdcat")
    if not usdcat:
        raise RuntimeError("usdcat is required (available with macOS USD tools)")

    with tempfile.TemporaryDirectory(prefix="superone-usdz-") as temp:
        flat = Path(temp) / "preview.usda"
        subprocess.run([usdcat, "--flatten", str(source), "-o", str(flat)], check=True, timeout=120)
        text = flat.read_text()
        reference = re.compile(r"@" + re.escape(str(source)) + r"\[([^\]]+)\]@")
        used_paths: set[str] = set()

        def rewrite(match: re.Match[str]) -> str:
            internal = match.group(1)
            path = PurePosixPath(internal)
            if path.is_absolute() or ".." in path.parts or path.suffix.lower() not in IMAGE_SUFFIXES:
                raise ValueError(f"Unexpected USDZ asset reference: {internal}")
            used_paths.add(internal)
            return f"@{internal}@"

        text = reference.sub(rewrite, text)
        # Three's USDAParser loses the material scope after this MaterialX metadata.
        text = re.sub(
            r"^([ \t]*token )outputs:mtlx:surface([ \t]+\()[ \t]*$",
            r"\1outputs_mtlx_surface\2",
            text,
            flags=re.MULTILINE,
        )
        if not used_paths:
            raise ValueError("No embedded image references found; refusing an incomplete preview copy")

        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(destination.name + ".tmp")
        try:
            with ZipFile(source) as original, ZipFile(temporary, "w", compression=ZIP_STORED) as preview:
                names = set(original.namelist())
                missing = used_paths - names
                if missing:
                    raise ValueError(f"Missing USDZ assets: {sorted(missing)[:3]}")
                total = len(text.encode())
                if total > MAX_EXPANDED_BYTES:
                    raise ValueError("Flattened stage exceeds preview limit")
                preview.writestr("preview.usda", text)
                for internal in sorted(used_paths):
                    data = original.read(internal)
                    total += len(data)
                    if total > MAX_EXPANDED_BYTES:
                        raise ValueError("Preview assets exceed expanded size limit")
                    preview.writestr(internal, data)
            temporary.replace(destination)
        finally:
            temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    flatten(args.source, args.destination)
    print(args.destination)
