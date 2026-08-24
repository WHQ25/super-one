#!/usr/bin/env bash
# Build SuperOne Computer Use helper .app
#
#   ./scripts/build.sh          # dev (default) → SuperOne Dev Computer Use.app
#   ./scripts/build.sh dev
#   ./scripts/build.sh release arm64  # target architecture is optional
#
# Signing (critical for TCC persistence):
#   Prefer a stable codesign identity so Accessibility / Screen Recording grants
#   survive rebuilds. Ad-hoc (`-`) changes CDHash after every recompile and macOS
#   treats Screen Recording as a new app.
#
#   Override: SUPERONE_CU_CODESIGN_IDENTITY="Developer ID Application: …"
#   Force ad-hoc: SUPERONE_CU_CODESIGN_IDENTITY="-"
#
# Skip rebuild when sources are unchanged (unless FORCE=1):
#   SUPERONE_CU_HELPER_FORCE_BUILD=1 ./scripts/build.sh dev
#
set -euo pipefail

VARIANT="${1:-dev}"
if [[ "$VARIANT" != "dev" && "$VARIANT" != "release" ]]; then
  echo "usage: $0 [dev|release] [arm64|x64|native]" >&2
  exit 1
fi

TARGET_ARCH="${2:-native}"
if [[ "$TARGET_ARCH" == "native" ]]; then
  TARGET_ARCH="$(uname -m)"
fi
if [[ "$TARGET_ARCH" == "x86_64" ]]; then
  TARGET_ARCH="x64"
fi
if [[ "$TARGET_ARCH" != "arm64" && "$TARGET_ARCH" != "x64" ]]; then
  echo "unsupported architecture: $TARGET_ARCH (expected arm64 or x64)" >&2
  exit 1
fi

if [[ "$TARGET_ARCH" == "arm64" ]]; then
  SWIFT_TARGET="arm64-apple-macos14.0"
  MACHO_ARCH="arm64"
else
  SWIFT_TARGET="x86_64-apple-macos14.0"
  MACHO_ARCH="x86_64"
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="${SUPERONE_CU_HELPER_DIST:-$ROOT/dist}"
BUILD_DIR="$ROOT/.build/$TARGET_ARCH"
BUILD_TMP_DIR="$BUILD_DIR/tmp"
MODULE_CACHE_DIR="$BUILD_DIR/modcache"

if [[ "$VARIANT" == "dev" ]]; then
  APP_NAME="SuperOne Dev Computer Use"
  PLIST_SRC="$ROOT/Info-dev.plist"
  BUNDLE_ID="com.superone.computer-use.dev"
else
  APP_NAME="SuperOne Computer Use"
  PLIST_SRC="$ROOT/Info-release.plist"
  BUNDLE_ID="com.superone.computer-use"
fi

APP="$DIST/${APP_NAME}.app"
BIN_NAME="$APP_NAME"
MACOS_DIR="$APP/Contents/MacOS"
OUT="$MACOS_DIR/$BIN_NAME"

# Remove the other variant's stale app name if present (avoid TCC confusion)
if [[ "$VARIANT" == "dev" ]]; then
  rm -rf "$DIST/SuperOne Computer Use.app"
else
  rm -rf "$DIST/SuperOne Dev Computer Use.app"
fi

# ── Incremental: skip compile when binary is newer than sources ─────────────
SOURCES=(
  "$ROOT/Sources/main.swift"
  "$ROOT/Sources/Capture.swift"
  "$ROOT/Sources/CoordinateSpace.swift"
  "$ROOT/Sources/Input.swift"
  "$ROOT/Sources/AxTree.swift"
  "$ROOT/Sources/RootDiscovery.swift"
  "$ROOT/Sources/AgentCursorVisuals.swift"
  "$ROOT/Sources/AgentOverlay.swift"
  "$ROOT/Sources/PictureInPicture.swift"
  "$ROOT/Sources/ActionRecording.swift"
  "$ROOT/Sources/WindowPlacement.swift"
  "$ROOT/Sources/CursorMotionModel.swift"
  "$ROOT/Sources/CursorMotionHeading.swift"
  "$ROOT/Sources/CursorVisualDynamics.swift"
  "$ROOT/Sources/CursorMotionGeometry.swift"
  "$ROOT/Resources/en.lproj/Localizable.strings"
  "$ROOT/Resources/zh-Hans.lproj/Localizable.strings"
  "$ROOT/../../../../docs/logo/computer-use-helper-icon.png"
  "$PLIST_SRC"
  "$ROOT/scripts/build.sh"
)
need_build=0
if [[ "${SUPERONE_CU_HELPER_FORCE_BUILD:-0}" == "1" ]]; then
  need_build=1
elif [[ ! -x "$OUT" ]]; then
  need_build=1
elif ! lipo -archs "$OUT" 2>/dev/null | tr ' ' '\n' | grep -qx "$MACHO_ARCH"; then
  need_build=1
else
  for f in "${SOURCES[@]}"; do
    if [[ -f "$f" && "$f" -nt "$OUT" ]]; then
      need_build=1
      break
    fi
  done
fi

# ── Pick codesign identity (stable Team ID keeps TCC across rebuilds) ───────
pick_identity() {
  if [[ -n "${SUPERONE_CU_CODESIGN_IDENTITY:-}" ]]; then
    echo "$SUPERONE_CU_CODESIGN_IDENTITY"
    return
  fi
  # Prefer Developer ID (same as shipping apps) then Apple Development.
  local id
  id=$(security find-identity -v -p codesigning 2>/dev/null \
    | sed -n 's/.*"\(Developer ID Application: .*\)"/\1/p' | head -1 || true)
  if [[ -n "$id" ]]; then
    echo "$id"
    return
  fi
  id=$(security find-identity -v -p codesigning 2>/dev/null \
    | sed -n 's/.*"\(Apple Development: .*\)"/\1/p' | head -1 || true)
  if [[ -n "$id" ]]; then
    echo "$id"
    return
  fi
  echo "-"
}

SKIP_CODESIGN="${SUPERONE_CU_SKIP_CODESIGN:-0}"
IDENTITY="-"
if [[ "$SKIP_CODESIGN" != "1" ]]; then
  IDENTITY="$(pick_identity)"
fi

if [[ "$need_build" == "0" ]]; then
  if [[ "$SKIP_CODESIGN" == "1" ]]; then
    echo "[build] up-to-date, skip compile: $APP ($MACHO_ARCH)"
    exit 0
  fi
  # Still re-sign if identity changed (e.g. previously ad-hoc, now Developer ID).
  current_team=$(codesign -dv --verbose=4 "$APP" 2>&1 | awk -F= '/^TeamIdentifier=/{print $2; exit}' || true)
  if [[ "$IDENTITY" != "-" && ( -z "$current_team" || "$current_team" == "not set" ) ]]; then
    echo "[build] binary up-to-date but ad-hoc/unsigned — re-signing with stable identity"
    codesign --force --deep --sign "$IDENTITY" --timestamp=none --options runtime "$APP" 2>/dev/null \
      || codesign --force --deep --sign "$IDENTITY" --timestamp=none "$APP"
    echo "[build] signed: $IDENTITY"
    echo "[build] CDHash: $(codesign -dv --verbose=4 "$APP" 2>&1 | awk -F= '/^CDHash=/{print $2; exit}')"
    echo "[build] Team: $(codesign -dv --verbose=4 "$APP" 2>&1 | awk -F= '/^TeamIdentifier=/{print $2; exit}')"
    echo "[build] Grant Accessibility + Screen Recording once for **${APP_NAME}** (grants stick after this sign)."
    exit 0
  fi
  echo "[build] up-to-date, skip compile: $APP"
  echo "[build] identity: $(codesign -dv --verbose=4 "$APP" 2>&1 | awk -F= '/^Authority=/{print $2; exit; exit}') / Team=$(codesign -dv --verbose=4 "$APP" 2>&1 | awk -F= '/^TeamIdentifier=/{print $2; exit}')"
  exit 0
fi

mkdir -p "$MACOS_DIR" "$APP/Contents/Resources" "$BUILD_TMP_DIR" "$MODULE_CACHE_DIR"
cp "$PLIST_SRC" "$APP/Contents/Info.plist"
# The cursor glyph is drawn procedurally (AgentCursorGlyph) — no bitmap to ship.
# NOTICE.md still must go in the bundle: CursorMotionModel.swift is vendored MIT.
cp "$ROOT/Resources/NOTICE.md" "$APP/Contents/Resources/"
ditto "$ROOT/Resources/en.lproj" "$APP/Contents/Resources/en.lproj"
ditto "$ROOT/Resources/zh-Hans.lproj" "$APP/Contents/Resources/zh-Hans.lproj"

ICON_SOURCE="$ROOT/../../../../docs/logo/computer-use-helper-icon.png"
ICONSET="$BUILD_TMP_DIR/ComputerUseIcon.iconset"
rm -rf "$ICONSET"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$ICON_SOURCE" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  retina=$((size * 2))
  sips -z "$retina" "$retina" "$ICON_SOURCE" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/ComputerUseIcon.icns"
rm -rf "$ICONSET"

export TMPDIR="$BUILD_TMP_DIR"
export SDKROOT="${SDKROOT:-/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk}"
if [[ ! -d "$SDKROOT" ]]; then
  SDKROOT="$(xcrun --show-sdk-path 2>/dev/null || true)"
fi

echo "[build] variant=$VARIANT arch=$TARGET_ARCH bundleId=$BUNDLE_ID"
echo "[build] compiling helper → $OUT"
swiftc -O \
  -target "$SWIFT_TARGET" \
  -module-cache-path "$MODULE_CACHE_DIR" \
  ${SDKROOT:+-sdk "$SDKROOT"} \
  -o "$OUT" \
  "$ROOT/Sources/main.swift" \
  "$ROOT/Sources/Capture.swift" \
  "$ROOT/Sources/CoordinateSpace.swift" \
  "$ROOT/Sources/Input.swift" \
  "$ROOT/Sources/AxTree.swift" \
  "$ROOT/Sources/RootDiscovery.swift" \
  "$ROOT/Sources/Mirror.swift" \
  "$ROOT/Sources/Ocr.swift" \
  "$ROOT/Sources/AgentCursorVisuals.swift" \
  "$ROOT/Sources/AgentOverlay.swift" \
  "$ROOT/Sources/PictureInPicture.swift" \
  "$ROOT/Sources/ActionRecording.swift" \
  "$ROOT/Sources/WindowPlacement.swift" \
  "$ROOT/Sources/CursorMotionModel.swift" \
  "$ROOT/Sources/CursorMotionHeading.swift" \
  "$ROOT/Sources/CursorVisualDynamics.swift" \
  "$ROOT/Sources/CursorMotionGeometry.swift"

chmod +x "$OUT"

if [[ "$SKIP_CODESIGN" == "1" ]]; then
  echo "[build] codesign deferred to electron-builder"
elif [[ "$IDENTITY" == "-" ]]; then
  echo "[build] codesign identity: $IDENTITY"
  codesign --force --deep --sign - "$APP"
  echo "[build] signed (ad-hoc) — WARNING: Screen Recording TCC often resets after every rebuild."
  echo "[build] Install an Apple Development / Developer ID cert, or set SUPERONE_CU_CODESIGN_IDENTITY."
else
  echo "[build] codesign identity: $IDENTITY"
  # timestamp=none for local/dev speed; runtime flag when Developer ID supports it.
  if codesign --force --deep --sign "$IDENTITY" --timestamp=none --options runtime "$APP" 2>/tmp/cu-codesign.err; then
    :
  else
    # Fallback without hardened runtime (some Apple Development certs)
    codesign --force --deep --sign "$IDENTITY" --timestamp=none "$APP"
  fi
  echo "[build] signed (stable): $IDENTITY"
fi

echo "[build] bundle id: $BUNDLE_ID"
if [[ "$SKIP_CODESIGN" != "1" ]]; then
  echo "[build] CDHash: $(codesign -dv --verbose=4 "$APP" 2>&1 | awk -F= '/^CDHash=/{print $2; exit}')"
  echo "[build] Team: $(codesign -dv --verbose=4 "$APP" 2>&1 | awk -F= '/^TeamIdentifier=/{print $2; exit}')"
fi
echo "[build] Grant Accessibility + Screen Recording for: **${APP_NAME}** (not SuperOne main app)."
echo "[build] SuperOne restarts the helper automatically after a new Screen Recording grant."
if [[ "$VARIANT" == "dev" ]]; then
  echo "[build] Dev: SuperOne electron-vite will start/stop this app with the host process."
  echo "[build] Subsequent \`bun run dev\` skips rebuild when Sources/ are unchanged."
fi
