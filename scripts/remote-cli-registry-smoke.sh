#!/usr/bin/env bash
# Product-path smoke: clean Linux Docker host + npm registry install + SSH bootstrap.
# Distinct from dev:cli:docker (monorepo+tsx lab).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOCKER_DIR="${ROOT}/apps/cli/docker"
COMPOSE_FILE="${DOCKER_DIR}/docker-compose.clean.yml"
COMPOSE=(docker compose -f "${COMPOSE_FILE}")
LAB_KEY_DIR="${DOCKER_DIR}/lab-keys"
LAB_KEY="${LAB_KEY_DIR}/id_ed25519"
LAB_PUB="${LAB_KEY_DIR}/id_ed25519.pub"
AUTH_KEYS="${LAB_KEY_DIR}/authorized_keys"

SSH_PORT="${SUPERONE_SMOKE_SSH_PORT:-2223}"
CLI_VERSION="${SUPERONE_SMOKE_CLI_VERSION:-0.49.5-alpha}"

need_docker() {
  command -v docker >/dev/null || { echo "docker not found" >&2; exit 1; }
}

ensure_lab_keys() {
  mkdir -p "${LAB_KEY_DIR}"
  if [[ ! -f "${LAB_KEY}" ]]; then
    echo "Generating lab SSH keypair..."
    ssh-keygen -t ed25519 -N '' -f "${LAB_KEY}" -C 'superone-docker-lab' >/dev/null
  fi
  cp "${LAB_PUB}" "${AUTH_KEYS}"
  chmod 600 "${LAB_KEY}" "${AUTH_KEYS}" 2>/dev/null || true
}

cmd_up() {
  need_docker
  ensure_lab_keys
  # Stop monorepo docker lab if it is still claiming sshd image build context (optional).
  "${COMPOSE[@]}" up --build -d
  echo "Waiting for clean-host SSH on :${SSH_PORT}..."
  for i in $(seq 1 60); do
    if ssh -p "${SSH_PORT}" \
      -i "${LAB_KEY}" \
      -o IdentitiesOnly=yes \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      -o BatchMode=yes \
      -o ConnectTimeout=2 \
      -o LogLevel=ERROR \
      "superone@127.0.0.1" 'echo SUPERONE_SSH_OK' 2>/dev/null | grep -q SUPERONE_SSH_OK; then
      echo "SSH ready."
      return 0
    fi
    sleep 1
  done
  echo "SSH not ready; container logs:" >&2
  "${COMPOSE[@]}" logs --tail 80
  exit 1
}

cmd_down() {
  need_docker
  "${COMPOSE[@]}" down --remove-orphans
}

cmd_smoke() {
  cmd_up
  export SUPERONE_SMOKE_SSH_PORT="${SSH_PORT}"
  export SUPERONE_SMOKE_CLI_VERSION="${CLI_VERSION}"
  export SUPERONE_SMOKE_IDENTITY="${LAB_KEY}"
  echo "Running registry bootstrap smoke (CLI ${CLI_VERSION})..."
  # bun can execute TS imports into desktop/cli modules without a separate build.
  (cd "${ROOT}" && bun scripts/registry-bootstrap-smoke.ts)
}

case "${1:-smoke}" in
  up) cmd_up ;;
  down) cmd_down ;;
  smoke) cmd_smoke ;;
  *)
    echo "Usage: $0 {up|down|smoke}" >&2
    exit 1
    ;;
esac
