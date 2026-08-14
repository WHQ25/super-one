#!/usr/bin/env bash
# Install the SuperOne-managed Claude binary into the layout the desktop app
# already knows how to resolve:
#
#   ~/.superone/harness/claude/versions/<pin>/
#     lib/node_modules/@anthropic-ai/claude-agent-sdk-<platform>/claude
#   ~/.superone/harness/claude/current
#
# Use this when a packaged upgrade whitescreens because the first-launch
# download has not finished (or failed). After the script succeeds, fully quit
# SuperOne and relaunch — the in-process miss cache only clears on restart.
#
# Usage:
#   ./scripts/install-claude-harness.sh
#   ./scripts/install-claude-harness.sh --version 0.3.232 --force
#   SUPERONE_HARNESS_HOME=/custom/harness ./scripts/install-claude-harness.sh
#
# macOS / Linux only. Windows: scripts/install-claude-harness.ps1

set -euo pipefail

DEFAULT_VERSION="0.3.232"
CDN_BASE="https://dl.super-one.dev"
NPM_REGISTRY="https://registry.npmjs.org"

VERSION="${SUPERONE_CLAUDE_SDK_VERSION:-$DEFAULT_VERSION}"
HARNESS_HOME="${SUPERONE_HARNESS_HOME:-}"
FORCE=0

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Download the Claude Agent SDK native binary SuperOne expects and install it
under ~/.superone/harness (or SUPERONE_HARNESS_HOME).

Options:
  --version VER   Runtime pin (default: ${DEFAULT_VERSION}, or SUPERONE_CLAUDE_SDK_VERSION)
  --home DIR      Harness root (default: \$SUPERONE_HARNESS_HOME or ~/.superone/harness)
  --force         Re-download even if the binary is already present
  -h, --help      Show this help

After it finishes, fully quit SuperOne (Cmd+Q / not just close the window)
and open it again.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      VERSION="${2:?--version requires a value}"
      shift 2
      ;;
    --home)
      HARNESS_HOME="${2:?--home requires a value}"
      shift 2
      ;;
    --force)
      FORCE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "${VERSION}" || "${VERSION}" == *..* || "${VERSION}" == */* || "${VERSION}" == *\\* ]]; then
  echo "error: invalid --version: ${VERSION}" >&2
  exit 2
fi

if [[ -z "${HARNESS_HOME}" ]]; then
  HARNESS_HOME="${HOME}/.superone/harness"
fi

detect_pkg() {
  local uname_s uname_m
  uname_s="$(uname -s)"
  uname_m="$(uname -m)"

  local os arch
  case "${uname_s}" in
    Darwin) os="darwin" ;;
    Linux) os="linux" ;;
    *)
      echo "error: unsupported OS: ${uname_s} (this script is macOS / Linux only)" >&2
      exit 1
      ;;
  esac

  case "${uname_m}" in
    arm64|aarch64) arch="arm64" ;;
    x86_64|amd64) arch="x64" ;;
    *)
      echo "error: unsupported arch: ${uname_m}" >&2
      exit 1
      ;;
  esac

  local musl=""
  if [[ "${os}" == "linux" ]]; then
    if [[ -f /etc/alpine-release ]] || ls /lib/ld-musl* >/dev/null 2>&1; then
      musl="-musl"
    fi
  fi

  echo "@anthropic-ai/claude-agent-sdk-${os}-${arch}${musl}"
}

download() {
  local url="$1"
  local dest="$2"
  local max_time="${3:-0}"
  if command -v curl >/dev/null 2>&1; then
    local args=(-fL --retry 2 --retry-delay 1 --connect-timeout 15 -o "${dest}" "${url}")
    if [[ "${max_time}" -gt 0 ]]; then
      args+=(--max-time "${max_time}")
    fi
    curl "${args[@]}" || return 1
  elif command -v wget >/dev/null 2>&1; then
    wget -O "${dest}" "${url}" || return 1
  else
    echo "error: need curl or wget to download ${url}" >&2
    exit 1
  fi
}

write_json_file() {
  local kind="$1"
  local dest="$2"
  local runtime_version="$3"
  local install_root="$4"
  local package_spec="$5"
  local now_ms
  now_ms="$(python3 -c 'import time; print(int(time.time() * 1000))' 2>/dev/null || echo $(($(date +%s) * 1000)))"

  if command -v python3 >/dev/null 2>&1; then
    KIND="${kind}" VERSION="${runtime_version}" INSTALL_ROOT="${install_root}" \
      PACKAGE_SPEC="${package_spec}" NOW_MS="${now_ms}" DEST="${dest}" python3 - <<'PY'
import json, os
kind = os.environ["KIND"]
payload = {
    "runtimeVersion": os.environ["VERSION"],
    "updatedAt": int(os.environ["NOW_MS"]),
}
if kind == "current":
    payload["installRoot"] = os.environ["INSTALL_ROOT"]
else:
    payload.update({
        "harnessId": "claude",
        "packageSpec": os.environ["PACKAGE_SPEC"],
        "source": "manual-script",
        "installedAt": int(os.environ["NOW_MS"]),
    })
with open(os.environ["DEST"], "w", encoding="utf-8") as f:
    json.dump(payload, f, indent=2)
    f.write("\n")
PY
    return
  fi

  if [[ "${kind}" == "current" ]]; then
    cat >"${dest}" <<EOF
{
  "runtimeVersion": "${runtime_version}",
  "installRoot": "${install_root}",
  "updatedAt": ${now_ms}
}
EOF
  else
    cat >"${dest}" <<EOF
{
  "harnessId": "claude",
  "runtimeVersion": "${runtime_version}",
  "packageSpec": "${package_spec}",
  "source": "manual-script",
  "installedAt": ${now_ms}
}
EOF
  fi
}

NPM_NAME="$(detect_pkg)"
BIN_NAME="claude"
PREFIX="${HARNESS_HOME}/claude"
VERSION_DIR="${PREFIX}/versions/${VERSION}"
PKG_DIR="${VERSION_DIR}/lib/node_modules/${NPM_NAME}"
BIN_PATH="${PKG_DIR}/${BIN_NAME}"
ARTIFACT_DIR="${NPM_NAME#@}"
ARTIFACT_DIR="${ARTIFACT_DIR//\//--}"
CDN_URL="${CDN_BASE}/harness/artifacts/${ARTIFACT_DIR}/${VERSION}.tgz"
NPM_URL="${NPM_REGISTRY}/${NPM_NAME}/-/${NPM_NAME##*/}-${VERSION}.tgz"

echo "SuperOne Claude harness install"
echo "  pin:     ${VERSION}"
echo "  package: ${NPM_NAME}"
echo "  home:    ${HARNESS_HOME}"

if [[ "${FORCE}" -eq 0 && -f "${BIN_PATH}" && -x "${BIN_PATH}" ]]; then
  echo "Binary already present: ${BIN_PATH}"
  write_json_file meta "${VERSION_DIR}/install-meta.json" "${VERSION}" "${VERSION_DIR}" "${NPM_NAME}@${VERSION}"
  tmp_current="${PREFIX}/.current.$$.$RANDOM.tmp"
  mkdir -p "${PREFIX}"
  write_json_file current "${tmp_current}" "${VERSION}" "${VERSION_DIR}" "${NPM_NAME}@${VERSION}"
  mv -f "${tmp_current}" "${PREFIX}/current"
  echo "Pointer updated: ${PREFIX}/current"
  echo
  echo "Fully quit SuperOne and relaunch."
  exit 0
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/superone-claude-XXXXXX")"
cleanup() {
  rm -rf "${WORK}"
  rm -f "${PREFIX}/.current.$$."*".tmp" 2>/dev/null || true
}
trap cleanup EXIT

TGZ="${WORK}/pkg.tgz"
echo "Downloading ${CDN_URL}"
if ! download "${CDN_URL}" "${TGZ}" 25; then
  echo "CDN failed, falling back to npm: ${NPM_URL}"
  download "${NPM_URL}" "${TGZ}"
fi

EXTRACT="${WORK}/out"
mkdir -p "${EXTRACT}"
tar -xzf "${TGZ}" -C "${EXTRACT}"
if [[ ! -d "${EXTRACT}/package" ]]; then
  echo "error: tarball has no package/ directory" >&2
  exit 1
fi
if [[ ! -f "${EXTRACT}/package/${BIN_NAME}" ]]; then
  echo "error: tarball is missing ${BIN_NAME}" >&2
  exit 1
fi

mkdir -p "$(dirname "${PKG_DIR}")"
rm -rf "${PKG_DIR}"
mkdir -p "${VERSION_DIR}"
mv "${EXTRACT}/package" "${PKG_DIR}"
chmod +x "${PKG_DIR}/${BIN_NAME}"

if [[ ! -x "${BIN_PATH}" ]]; then
  echo "error: installed binary is not executable: ${BIN_PATH}" >&2
  exit 1
fi

write_json_file meta "${VERSION_DIR}/install-meta.json" "${VERSION}" "${VERSION_DIR}" "${NPM_NAME}@${VERSION}"
mkdir -p "${PREFIX}"
tmp_current="${PREFIX}/.current.$$.$RANDOM.tmp"
write_json_file current "${tmp_current}" "${VERSION}" "${VERSION_DIR}" "${NPM_NAME}@${VERSION}"
mv -f "${tmp_current}" "${PREFIX}/current"

echo "Installed: ${BIN_PATH}"
echo "Pointer:   ${PREFIX}/current -> ${VERSION}"
echo
echo "Fully quit SuperOne (Cmd+Q) and open it again."
echo "The running process caches a missing binary and will not pick this up until restart."
