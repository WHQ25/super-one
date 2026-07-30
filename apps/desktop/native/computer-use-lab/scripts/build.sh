#!/usr/bin/env bash
# Build SuperOne CU Lab.app — deterministic Computer Use test target.
#
#   ./scripts/build.sh
#   ./scripts/build.sh arm64
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_ARCH="${1:-native}"
if [[ "$TARGET_ARCH" == "native" ]]; then
  TARGET_ARCH="$(uname -m)"
fi
if [[ "$TARGET_ARCH" == "x86_64" ]]; then
  TARGET_ARCH="x64"
fi
if [[ "$TARGET_ARCH" == "arm64" ]]; then
  SWIFT_TARGET="arm64-apple-macos14.0"
elif [[ "$TARGET_ARCH" == "x64" ]]; then
  SWIFT_TARGET="x86_64-apple-macos14.0"
else
  echo "unsupported arch: $TARGET_ARCH" >&2
  exit 1
fi

APP_NAME="SuperOne CU Lab"
BUNDLE_ID="com.superone.computer-use.lab"
DIST="${SUPERONE_CU_LAB_DIST:-$ROOT/dist}"
APP="$DIST/${APP_NAME}.app"
MACOS_DIR="$APP/Contents/MacOS"
OUT="$MACOS_DIR/$APP_NAME"
BUILD_DIR="$ROOT/.build/$TARGET_ARCH"
MODULE_CACHE="$BUILD_DIR/modcache"
TMPDIR_BUILD="$BUILD_DIR/tmp"

mkdir -p "$MACOS_DIR" "$BUILD_DIR" "$MODULE_CACHE" "$TMPDIR_BUILD" "$APP/Contents"

SOURCES=()
while IFS= read -r f; do
  SOURCES+=("$f")
done < <(find "$ROOT/Sources" -name '*.swift' | sort)

if [[ ${#SOURCES[@]} -eq 0 ]]; then
  echo "no Sources/*.swift found" >&2
  exit 1
fi

echo "→ compiling ${#SOURCES[@]} swift files ($SWIFT_TARGET)"
export TMPDIR="$TMPDIR_BUILD"
swiftc -O \
  -target "$SWIFT_TARGET" \
  -module-cache-path "$MODULE_CACHE" \
  -o "$OUT" \
  "${SOURCES[@]}"

chmod +x "$OUT"
cp "$ROOT/Info.plist" "$APP/Contents/Info.plist"
printf 'APPL????' > "$APP/Contents/PkgInfo"

IDENTITY="${SUPERONE_CU_LAB_CODESIGN_IDENTITY:--}"
echo "→ codesign identity=$IDENTITY"
codesign --force --deep --sign "$IDENTITY" "$APP"

echo "✓ $APP"
echo "  bundleId=$BUNDLE_ID"
echo "  open \"$APP\""
