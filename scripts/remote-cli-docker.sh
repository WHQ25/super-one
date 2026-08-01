#!/usr/bin/env bash
# Helper for apps/cli Docker SSH lab (scheme B).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOCKER_DIR="${ROOT}/apps/cli/docker"
COMPOSE_FILE="${DOCKER_DIR}/docker-compose.yml"
COMPOSE=(docker compose -f "${COMPOSE_FILE}")
LAB_KEY_DIR="${DOCKER_DIR}/lab-keys"
LAB_KEY="${LAB_KEY_DIR}/id_ed25519"
LAB_PUB="${LAB_KEY_DIR}/id_ed25519.pub"
AUTH_KEYS="${LAB_KEY_DIR}/authorized_keys"

SSH_PORT="${SUPERONE_DOCKER_SSH_PORT:-2222}"
LOCAL_PORT="${SUPERONE_DOCKER_LOCAL_PORT:-7788}"
REMOTE_NODE_PORT="${SUPERONE_NODE_PORT:-7788}"
SSH_USER="${SUPERONE_SSH_USER:-superone}"
SSH_HOST="${SUPERONE_SSH_HOST:-127.0.0.1}"
NODE_HOME_IN_CT="${SUPERONE_NODE_HOME:-/home/superone/.superone/node}"

usage() {
  cat <<'EOF'
Usage: scripts/remote-cli-docker.sh <command>

Commands:
  up              Ensure lab SSH keys, build/start container, wait healthy
  down            Stop and remove the container
  logs            Tail container logs
  status          Container + in-container health (via ssh)
  ssh             Interactive SSH into the container
  pair            Create a one-time pairing token (stdout JSON)
  forward         Open SSH local forward (blocks): localhost:7788 → container loopback
  health          curl /health through an ephemeral local forward
  smoke           up → pair → health via forward

Env:
  SUPERONE_DOCKER_SSH_PORT   host SSH port (default 2222)
  SUPERONE_DOCKER_LOCAL_PORT local forward port (default 7788)
EOF
  exit 1
}

need_docker() {
  command -v docker >/dev/null || { echo "docker not found" >&2; exit 1; }
}

ensure_lab_keys() {
  mkdir -p "${LAB_KEY_DIR}"
  if [[ ! -f "${LAB_KEY}" ]]; then
    echo "Generating lab SSH keypair in apps/cli/docker/lab-keys/ ..."
    ssh-keygen -t ed25519 -N '' -f "${LAB_KEY}" -C 'superone-docker-lab' >/dev/null
  fi
  cp "${LAB_PUB}" "${AUTH_KEYS}"
  chmod 600 "${LAB_KEY}" "${AUTH_KEYS}" 2>/dev/null || true
  # Ignore private key in git if user commits docker dir partially.
  if [[ ! -f "${LAB_KEY_DIR}/.gitignore" ]]; then
    cat >"${LAB_KEY_DIR}/.gitignore" <<'GI'
id_ed25519
id_ed25519.pub
authorized_keys
GI
  fi
}

ssh_base() {
  ssh -p "${SSH_PORT}" \
    -i "${LAB_KEY}" \
    -o IdentitiesOnly=yes \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o LogLevel=ERROR \
    "${SSH_USER}@${SSH_HOST}" "$@"
}

cmd_up() {
  need_docker
  ensure_lab_keys
  "${COMPOSE[@]}" up --build -d
  echo "Waiting for container health (first boot installs Linux deps; may take a few minutes)..."
  for i in $(seq 1 180); do
    status="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' superone-remote-cli 2>/dev/null || true)"
    if [[ "${status}" == "healthy" ]]; then
      echo "Container healthy."
      return 0
    fi
    if [[ "${status}" == "exited" ]] || [[ "${status}" == "dead" ]]; then
      echo "Container ${status}; logs:" >&2
      "${COMPOSE[@]}" logs --tail 120
      exit 1
    fi
    sleep 1
  done
  echo "Timed out waiting for healthy; recent logs:" >&2
  "${COMPOSE[@]}" logs --tail 120
  exit 1
}

cmd_down() {
  need_docker
  "${COMPOSE[@]}" down
}

cmd_logs() {
  need_docker
  "${COMPOSE[@]}" logs -f --tail 200
}

cmd_status() {
  need_docker
  ensure_lab_keys
  docker ps --filter name=superone-remote-cli --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
  echo "--- in-container health ---"
  ssh_base "curl -fsS http://127.0.0.1:${REMOTE_NODE_PORT}/health"
  echo
}

cmd_ssh() {
  ensure_lab_keys
  ssh_base
}

cmd_pair() {
  ensure_lab_keys
  # Match container runtime: Node+tsx (Bun NAPI crashes on better-sqlite3).
  ssh_base "cd /work/apps/cli && NODE_PATH=/work/node_modules tsx src/cli.ts pair-create --home '${NODE_HOME_IN_CT}'"
}

cmd_forward() {
  ensure_lab_keys
  echo "Local forward: 127.0.0.1:${LOCAL_PORT} → container 127.0.0.1:${REMOTE_NODE_PORT}"
  echo "Keep this terminal open. Desktop baseUrl: http://127.0.0.1:${LOCAL_PORT}"
  echo "Ctrl-C to stop."
  ssh -p "${SSH_PORT}" \
    -i "${LAB_KEY}" \
    -o IdentitiesOnly=yes \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o LogLevel=ERROR \
    -N -L "${LOCAL_PORT}:127.0.0.1:${REMOTE_NODE_PORT}" \
    "${SSH_USER}@${SSH_HOST}"
}

cmd_health() {
  ensure_lab_keys
  # Background forward, curl from host, then kill.
  ssh -p "${SSH_PORT}" \
    -i "${LAB_KEY}" \
    -o IdentitiesOnly=yes \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o LogLevel=ERROR \
    -o ExitOnForwardFailure=yes \
    -f -N -L "${LOCAL_PORT}:127.0.0.1:${REMOTE_NODE_PORT}" \
    "${SSH_USER}@${SSH_HOST}"
  sleep 0.4
  # Without tunnel, host:7788 should not hit the container node if nothing else listens.
  curl -fsS "http://127.0.0.1:${LOCAL_PORT}/health"
  echo
  pkill -f "ssh.*-i ${LAB_KEY}.*-L ${LOCAL_PORT}:127.0.0.1:${REMOTE_NODE_PORT}" 2>/dev/null || true
}

cmd_smoke() {
  cmd_up
  echo "--- pair-create ---"
  cmd_pair
  echo
  echo "--- health via local forward ---"
  cmd_health
  echo
  # Prove node is not published without tunnel: optional check only if nothing else on 7788.
  echo "Smoke OK. Next:"
  echo "  1) ./scripts/remote-cli-docker.sh forward   # leave running"
  echo "  2) bun run dev"
  echo "  3) DevTools: window.environment.pairRemote({ baseUrl: 'http://127.0.0.1:${LOCAL_PORT}', pairingToken: '...', label: 'docker-ssh-linux' })"
}

main() {
  local cmd="${1:-}"
  shift || true
  case "${cmd}" in
    up) cmd_up "$@" ;;
    down) cmd_down "$@" ;;
    logs) cmd_logs "$@" ;;
    status) cmd_status "$@" ;;
    ssh) cmd_ssh "$@" ;;
    pair) cmd_pair "$@" ;;
    forward) cmd_forward "$@" ;;
    health) cmd_health "$@" ;;
    smoke) cmd_smoke "$@" ;;
    *) usage ;;
  esac
}

main "$@"
