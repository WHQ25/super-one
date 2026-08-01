#!/usr/bin/env bash
# Local remote-node lab: run superone CLI on the host as a standalone backend,
# then pair the desktop to it over loopback HTTP/WS (same protocol as Docker
# SSH lab — not Electron IPC).
#
# Why this exists:
# - Docker lab is for Linux/SSH/systemd realism, but harness credentials
#   (Claude CLI, Codex login, etc.) live on the host and are painful to re-auth
#   inside a container.
# - Local lab uses the host Unix user + $HOME credentials while still exercising
#   the remote EnvironmentGateway / authenticated RPC path.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI_DIR="${ROOT}/apps/cli"

# Isolated from production ~/.superone/node so lab state never clobbers a real install.
LAB_HOME="${SUPERONE_NODE_HOME:-${HOME}/.superone/node-dev-lab}"
# Default 7789 so Docker SSH-forward on 7788 can run at the same time.
LAB_HOST="${SUPERONE_NODE_HOST:-127.0.0.1}"
LAB_PORT="${SUPERONE_NODE_PORT:-7789}"
LAB_LABEL="${SUPERONE_NODE_LABEL:-local-dev-lab}"
PID_FILE="${LAB_HOME}/lab.pid"
LOG_FILE="${LAB_HOME}/lab.log"

export SUPERONE_NODE_HOME="${LAB_HOME}"
export SUPERONE_NODE_HOST="${LAB_HOST}"
export SUPERONE_NODE_PORT="${LAB_PORT}"

# Lab harness overrides: pick host CLIs when present so Claude/Codex turns work
# without managed install (inherits $HOME credentials). Only set when unset so
# callers can still pin an explicit path.
if [[ -z "${SUPERONE_CLAUDE_BINARY:-}" ]]; then
  if command -v claude >/dev/null 2>&1; then
    export SUPERONE_CLAUDE_BINARY="$(command -v claude)"
  fi
fi
if [[ -z "${SUPERONE_CODEX_BINARY:-}" ]]; then
  if command -v codex >/dev/null 2>&1; then
    export SUPERONE_CODEX_BINARY="$(command -v codex)"
  fi
fi

usage() {
  cat <<EOF
Usage: scripts/remote-cli-local.sh <command>

Local remote-node lab (host process, remote protocol).

Commands:
  start           Start lab node in background (tsx, Node — not bun)
  stop            Stop lab node
  restart         stop + start
  status          Process + /health
  logs            Tail lab.log
  pair            pair-create (prints JSON incl. pairingToken)
  smoke           start → health → pair (prints pairRemote snippet)
  fg              Start in foreground (for debugging)

Env (optional):
  SUPERONE_NODE_HOME   data dir (default: ~/.superone/node-dev-lab)
  SUPERONE_NODE_HOST   bind host (default: 127.0.0.1)
  SUPERONE_NODE_PORT   bind port (default: 7789)
  SUPERONE_NODE_LABEL  node label (default: local-dev-lab)

Desktop pair (after pair):
  await window.environment.pairRemote({
    baseUrl: 'http://${LAB_HOST}:${LAB_PORT}',
    pairingToken: '<token>',
    label: '${LAB_LABEL}',
  })
EOF
  exit 1
}

need_node() {
  command -v node >/dev/null || {
    echo "node not found (need Node >=20; do not use bun for CLI runtime)" >&2
    exit 1
  }
}

cli_tsx() {
  # Prefer package-local tsx so we do not depend on a global install.
  (
    cd "${CLI_DIR}"
    if command -v bunx >/dev/null 2>&1; then
      bunx tsx src/cli.ts "$@"
    else
      npx --yes tsx src/cli.ts "$@"
    fi
  )
}

is_running() {
  if [[ -f "${PID_FILE}" ]]; then
    local pid
    pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      return 0
    fi
  fi
  return 1
}

base_url() {
  echo "http://${LAB_HOST}:${LAB_PORT}"
}

cmd_start() {
  need_node
  mkdir -p "${LAB_HOME}"
  if is_running; then
    echo "already running pid=$(cat "${PID_FILE}") home=${LAB_HOME} url=$(base_url)"
    return 0
  fi
  # Drop stale pid
  rm -f "${PID_FILE}"

  echo "Starting local remote node..."
  echo "  SUPERONE_NODE_HOME=${LAB_HOME}"
  echo "  url=$(base_url)"
  echo "  log=${LOG_FILE}"
  if [[ -n "${SUPERONE_CLAUDE_BINARY:-}" ]]; then
    echo "  SUPERONE_CLAUDE_BINARY=${SUPERONE_CLAUDE_BINARY}"
  else
    echo "  SUPERONE_CLAUDE_BINARY=(unset — Claude turns fail until set or harness enable)"
  fi
  if [[ -n "${SUPERONE_CODEX_BINARY:-}" ]]; then
    echo "  SUPERONE_CODEX_BINARY=${SUPERONE_CODEX_BINARY}"
  fi

  # Background: same entry as package "dev" but detached + isolated home/port.
  # Host $HOME is inherited so Claude/Codex/Grok user credentials stay available.
  (
    cd "${CLI_DIR}"
    if command -v bunx >/dev/null 2>&1; then
      nohup bunx tsx src/cli.ts start --foreground \
        --host "${LAB_HOST}" \
        --port "${LAB_PORT}" \
        --label "${LAB_LABEL}" \
        >>"${LOG_FILE}" 2>&1 &
    else
      nohup npx --yes tsx src/cli.ts start --foreground \
        --host "${LAB_HOST}" \
        --port "${LAB_PORT}" \
        --label "${LAB_LABEL}" \
        >>"${LOG_FILE}" 2>&1 &
    fi
    echo $! >"${PID_FILE}"
  )

  # Wait for health
  local url
  url="$(base_url)/health"
  for _ in $(seq 1 40); do
    if curl -sf "${url}" >/dev/null 2>&1; then
      echo "healthy: ${url}"
      echo "pid=$(cat "${PID_FILE}")"
      return 0
    fi
    sleep 0.25
  done
  echo "node did not become healthy; last log lines:" >&2
  tail -n 40 "${LOG_FILE}" >&2 || true
  exit 1
}

cmd_stop() {
  if ! is_running; then
    echo "not running"
    rm -f "${PID_FILE}"
    return 0
  fi
  local pid
  pid="$(cat "${PID_FILE}")"
  echo "stopping pid=${pid}"
  kill "${pid}" 2>/dev/null || true
  for _ in $(seq 1 40); do
    if ! kill -0 "${pid}" 2>/dev/null; then
      rm -f "${PID_FILE}"
      echo "stopped"
      return 0
    fi
    sleep 0.1
  done
  echo "escalating SIGKILL" >&2
  kill -9 "${pid}" 2>/dev/null || true
  rm -f "${PID_FILE}"
}

cmd_restart() {
  cmd_stop || true
  cmd_start
}

cmd_status() {
  if is_running; then
    echo "process: running pid=$(cat "${PID_FILE}")"
  else
    echo "process: not running"
  fi
  echo "home: ${LAB_HOME}"
  echo "url:  $(base_url)"
  if curl -sf "$(base_url)/health" >/dev/null 2>&1; then
    echo "health: ok"
    curl -s "$(base_url)/health" || true
    echo
  else
    echo "health: unreachable"
  fi
}

cmd_logs() {
  mkdir -p "${LAB_HOME}"
  touch "${LOG_FILE}"
  tail -n 100 -f "${LOG_FILE}"
}

cmd_pair() {
  need_node
  mkdir -p "${LAB_HOME}"
  # pair-create must use the same SUPERONE_NODE_HOME as the running node.
  cli_tsx pair-create
}

cmd_fg() {
  need_node
  mkdir -p "${LAB_HOME}"
  echo "foreground local remote node home=${LAB_HOME} url=$(base_url)"
  echo "Ctrl-C to stop"
  cli_tsx start --foreground --host "${LAB_HOST}" --port "${LAB_PORT}" --label "${LAB_LABEL}"
}

cmd_smoke() {
  cmd_start
  echo "--- pair ---"
  local json
  json="$(cmd_pair)"
  echo "${json}"
  local token
  token="$(
    printf '%s' "${json}" | node -e '
      let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{
        try { const j=JSON.parse(s); process.stdout.write(j.pairingToken||j.token||""); }
        catch { process.exit(2); }
      });
    '
  )"
  if [[ -z "${token}" ]]; then
    echo "failed to parse pairingToken from pair-create output" >&2
    exit 1
  fi
  cat <<EOF

--- desktop (DevTools) ---
await window.environment.pairRemote({
  baseUrl: '$(base_url)',
  pairingToken: '${token}',
  label: '${LAB_LABEL}',
})

Or Remote Control UI: add device with direct URL $(base_url) if available.
Node data dir: ${LAB_HOME}
Host credentials (Claude/Codex/Grok under \$HOME) are visible to this process.
EOF
}

cmd="${1:-}"
case "${cmd}" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  restart) cmd_restart ;;
  status) cmd_status ;;
  logs) cmd_logs ;;
  pair) cmd_pair ;;
  smoke) cmd_smoke ;;
  fg) cmd_fg ;;
  -h | --help | help | '') usage ;;
  *)
    echo "unknown command: ${cmd}" >&2
    usage
    ;;
esac
