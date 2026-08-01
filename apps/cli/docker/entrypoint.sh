#!/usr/bin/env bash
# Start superone on loopback (Node runtime), then sshd in the foreground.
set -euo pipefail

NODE_HOME="${SUPERONE_NODE_HOME:-/home/superone/.superone/node}"
NODE_HOST="${SUPERONE_NODE_HOST:-127.0.0.1}"
NODE_PORT="${SUPERONE_NODE_PORT:-7788}"
WORK_DIR="${WORK_DIR:-/work}"
LABEL="${SUPERONE_NODE_LABEL:-docker-ssh-linux}"
LOG_DIR="${NODE_HOME}/logs"
NODE_LOG="${LOG_DIR}/node.log"

mkdir -p "${NODE_HOME}/secrets" "${LOG_DIR}" /home/superone/.bun /home/superone/.npm "${WORK_DIR}/node_modules"
chown -R superone:superone /home/superone "${WORK_DIR}/node_modules" || true
chmod 700 "${NODE_HOME}" "${NODE_HOME}/secrets" || true

if [[ -f /authorized_keys ]]; then
  install -o superone -g superone -m 600 /authorized_keys /home/superone/.ssh/authorized_keys
fi

ensure_deps() {
  if [[ ! -f "${WORK_DIR}/package.json" ]]; then
    echo "[entrypoint] ERROR: monorepo not mounted at ${WORK_DIR}" >&2
    exit 1
  fi
  cd "${WORK_DIR}"

  if [[ -f node_modules/.superone-docker-linux-ok ]] \
    && [[ -d node_modules/better-sqlite3 ]] \
    && [[ -d node_modules/ws ]] \
    && node -e "require('node-pty')" >/dev/null 2>&1; then
    echo "[entrypoint] Linux node_modules already prepared"
    return 0
  fi

  echo "[entrypoint] bun install (Linux volume; host node_modules not used)..."
  if ! bun install --ignore-scripts --frozen-lockfile; then
    echo "[entrypoint] frozen-lockfile failed; retry without freeze"
    bun install --ignore-scripts
  fi

  echo "[entrypoint] building better-sqlite3 for Linux (node ABI)..."
  if [[ -d node_modules/better-sqlite3 ]]; then
    # Build against the Node we will use at runtime (not Bun NAPI).
    (cd node_modules/better-sqlite3 && npm run install --silent) \
      || (cd node_modules/better-sqlite3 && node-gyp rebuild) \
      || true
  fi

  echo "[entrypoint] building node-pty for Linux (node ABI)..."
  if [[ -d node_modules/node-pty ]]; then
    (cd node_modules/node-pty && npm run install --silent) \
      || (cd node_modules/node-pty && node-gyp rebuild) \
      || true
  fi

  # tsx to run TypeScript CLI under Node
  if [[ ! -d node_modules/tsx ]]; then
    echo "[entrypoint] installing tsx for Node CLI runner..."
    npm install --no-save --prefix "${WORK_DIR}" tsx@4 >/dev/null 2>&1 \
      || npm install --no-save -g tsx@4
  fi

  if [[ ! -d node_modules/ws ]]; then
    echo "[entrypoint] ERROR: install incomplete (ws missing)" >&2
    ls -la node_modules 2>/dev/null | head || true
    exit 1
  fi

  touch node_modules/.superone-docker-linux-ok
  chown -R superone:superone node_modules /home/superone/.bun /home/superone/.npm || true
  echo "[entrypoint] deps ready"
}

ensure_deps

# Prefer local tsx; fall back to PATH / npx.
if [[ -x "${WORK_DIR}/node_modules/.bin/tsx" ]]; then
  TSX_BIN="${WORK_DIR}/node_modules/.bin/tsx"
elif command -v tsx >/dev/null 2>&1; then
  TSX_BIN="$(command -v tsx)"
else
  npm install -g tsx@4 >/dev/null 2>&1 || true
  TSX_BIN="$(command -v tsx || echo npx --yes tsx)"
fi

echo "[entrypoint] starting superone via Node+tsx on ${NODE_HOST}:${NODE_PORT} (SSH -L only)"
# Bun crashes on better-sqlite3 NAPI; Node is the supported runtime for this native addon.
su -s /bin/bash superone -c "
  cd '${WORK_DIR}/apps/cli' && \
  export NODE_PATH='${WORK_DIR}/node_modules' && \
  exec ${TSX_BIN} src/cli.ts start \
    --foreground \
    --host '${NODE_HOST}' \
    --port '${NODE_PORT}' \
    --home '${NODE_HOME}' \
    --label '${LABEL}'
" >>"${NODE_LOG}" 2>&1 &
NODE_PID=$!

cleanup() {
  echo "[entrypoint] shutting down..."
  kill "${NODE_PID}" 2>/dev/null || true
  wait "${NODE_PID}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

for i in $(seq 1 90); do
  if curl -fsS "http://${NODE_HOST}:${NODE_PORT}/health" >/dev/null 2>&1; then
    echo "[entrypoint] node healthy: http://${NODE_HOST}:${NODE_PORT}/health"
    break
  fi
  if ! kill -0 "${NODE_PID}" 2>/dev/null; then
    echo "[entrypoint] node process exited early; last log:"
    tail -n 200 "${NODE_LOG}" || true
    exit 1
  fi
  sleep 0.5
  if [[ "${i}" -eq 90 ]]; then
    echo "[entrypoint] node health timeout; log:"
    tail -n 200 "${NODE_LOG}" || true
    exit 1
  fi
done

echo "[entrypoint] sshd on :22 (host 2222). Lab key: apps/cli/docker/lab-keys/id_ed25519"
echo "[entrypoint] forward: ssh -p 2222 -i apps/cli/docker/lab-keys/id_ed25519 -L 7788:127.0.0.1:7788 superone@127.0.0.1"
exec /usr/sbin/sshd -D -e
