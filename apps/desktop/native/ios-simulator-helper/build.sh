#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="${1:-$ROOT/build}"
OUT="$OUT_DIR/superone-ios-simulator-helper"
TMP="$OUT.tmp.$$"
TARGET="$(uname -m)-apple-macosx13.0"

mkdir -p "$OUT_DIR/module-cache" "$OUT_DIR/tmp"
trap 'rm -f "$TMP"' EXIT
export TMPDIR="$OUT_DIR/tmp"

for unit in HIDBridge OrientationBridge AccessibilityBridge; do
  xcrun clang \
    -c -fobjc-arc -O2 -fmodules -fmodules-cache-path="$OUT_DIR/module-cache" -target "$TARGET" \
    "$ROOT/Sources/$unit.m" \
    -o "$OUT_DIR/$unit.o"
done

xcrun swiftc \
  -O -whole-module-optimization -swift-version 5 -target "$TARGET" \
  -module-cache-path "$OUT_DIR/module-cache" \
  -import-objc-header "$ROOT/Sources/BridgingHeader.h" \
  -framework Foundation -framework CoreGraphics -framework CoreImage -framework CoreMedia \
  -framework CoreVideo -framework IOSurface -framework VideoToolbox -framework AppKit \
  -framework Vision \
  "$OUT_DIR/HIDBridge.o" "$OUT_DIR/OrientationBridge.o" "$OUT_DIR/AccessibilityBridge.o" \
  "$ROOT/Sources/CoreSimulatorBridge.swift" \
  "$ROOT/Sources/H264Encoder.swift" \
  "$ROOT/Sources/FrameAnalysis.swift" \
  "$ROOT/Sources/FramebufferStream.swift" \
  "$ROOT/Sources/main.swift" \
  -o "$TMP"

# Runs inside the guest, so it is built for the simulator SDK. Optional: without it
# the helper still previews and drives a foldable, it just cannot move the hinge.
GUEST="$OUT_DIR/superone-ios-fold"
if xcrun --sdk iphonesimulator --show-sdk-path >/dev/null 2>&1; then
  xcrun -sdk iphonesimulator clang \
    -fobjc-arc -O2 -arch "$(uname -m)" -mios-simulator-version-min=17.0 \
    -fmodules -fmodules-cache-path="$OUT_DIR/module-cache" \
    -framework Foundation \
    -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __entitlements \
    -Xlinker "$ROOT/Sources/Guest/FoldTool.entitlements" \
    "$ROOT/Sources/Guest/FoldTool.m" \
    -o "$GUEST"
  codesign --force --sign - "$GUEST" >/dev/null
fi

chmod +x "$TMP"
mv -f "$TMP" "$OUT"
trap - EXIT
echo "$OUT"
