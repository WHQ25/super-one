#!/usr/bin/env bash
# Ad-hoc sign the unsigned local build produced by `build:mac-dev`.
#
# That build runs electron-builder with CSC_IDENTITY_AUTO_DISCOVERY=false, so
# nothing signs the bundle. Two things break as a result, and one signature
# fixes both:
#
#   1. Finder refuses to launch it. Running the executable directly from a
#      shell still works -- the kernel accepts Electron's linker-signed adhoc
#      binary -- which is why this looks like "it built fine but won't open".
#   2. The nested Computer Use helper never gets `_CodeSignature/CodeResources`.
#      `helperBundleFingerprint` requires that file, so the app boots and then
#      reports "Packaged Computer Use helper is incomplete".
#
# `--deep` is what reaches the nested helper. It is discouraged for release
# signing (each nested bundle should be signed on its own terms) but is exactly
# right here: this signature exists to satisfy local execution, and the release
# path signs properly with a real identity.
set -euo pipefail

VARIANT="${SUPERONE_VARIANT:-dev}"
DIST="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/dist/${VARIANT}"

APP="$(find "$DIST" -maxdepth 2 -name '*.app' -print -quit 2>/dev/null || true)"
if [[ -z "$APP" ]]; then
  echo "[adhoc-sign] no .app under ${DIST} — nothing to sign" >&2
  exit 0
fi

echo "[adhoc-sign] ${APP}"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"
echo "[adhoc-sign] ok — open with: open '${APP}'"
