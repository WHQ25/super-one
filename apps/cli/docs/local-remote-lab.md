# Local remote-node lab (host process)

Run `superone` **on your Mac/Linux host** as a **standalone remote node**. The
desktop talks to it over authenticated HTTP/WebSocket RPC — the same path as a
real remote environment — **not** via Electron IPC / in-process
`SessionManager`.

## Why not only Docker?

| Lab | Good for | Pain |
|-----|----------|------|
| **Local** (`dev:cli:lab`) | Daily harness/session work; reuses **host** Claude/Codex/Grok logins under `$HOME` | Not a Linux/SSH/systemd fidelity check |
| **Docker SSH** (`dev:cli:docker*`) | Linux install, SSH forward, loopback bind, clean-host realism | Re-auth providers inside the container; no hot-reload; slower loop |

Use **local lab first** when iterating on harness enable, Codex/Claude turns, or
anything that needs host credentials. Keep Docker for “does it work on remote
Linux over SSH?”.

## Architecture

```text
[Desktop Electron Main]
   pairRemote / EnvironmentHost / RemoteEnvironmentGateway
        │  authenticated HTTP + WebSocket RPC
        ▼
[Host process: tsx apps/cli/src/cli.ts start]
   bind 127.0.0.1:7789 (default)
   SUPERONE_NODE_HOME=~/.superone/node-dev-lab
   inherits host $HOME → provider CLIs see real credentials
```

This is intentionally **not** the local desktop execution path
(`LocalEnvironmentGateway` / in-process SessionManager). If you open a remote
project on this environment, chat/terminal/FS go through node RPC.

**Sidebar Files tab:** remote project keys (`remote:<connectionId>:<path>`) use
node RPC: `workspace.listDir` + `git.status`, `workspace.rename` / `move` /
`delete` / `mkdir` / `writeFile`. Drag: local→remote **copy** (Alt=move), remote→
local materializes for Finder/local tree; same-machine lab may drag host paths
directly. **Chat markdown** media (`![…](./x.png|mp4|mp3)`) resolves via
`remote-media://` → `readProjectFile` data URIs. Terminal uses
`RemoteTerminalController`. Per-file transfer/preview cap: 10 MiB.

## Quick start

From monorepo root:

```bash
# terminal A — node (background)
bun run dev:cli:lab
# or smoke: start + health + pair token
bun run dev:cli:lab:smoke

# terminal B — desktop
bun run dev
```

### Pair from the UI (preferred)

1. Open **Remote Control → Control Other Devices** (dev build).
2. Use the **Local lab** card → **Connect lab**.
3. Desktop probes `/health`, mints a pairing token against
   `~/.superone/node-dev-lab`, and pairs over authenticated RPC.

If the card shows **Lab offline**, start the lab first (`bun run dev:cli:lab`).

If connect fails with **`client session revoked` / unauthorized**: the desktop
still holds a refresh credential the lab has revoked (refresh reuse, or an old
pairing after node DB changes). Use **Connect lab** again — it re-pairs when
reconnect is unauthorized. Or **Remove** the paired row under the card, then
Connect lab.

### Pair from DevTools (optional)

```js
await window.environment.pairLocalLab()
// or manually:
await window.environment.pairRemote({
  baseUrl: 'http://127.0.0.1:7789',
  pairingToken: '<from bun run dev:cli:lab:pair>',
  label: 'local-dev-lab',
})
```

`smoke` prints a manual `pairRemote` snippet with a fresh token.

## Commands

| Script | Purpose |
|--------|---------|
| `bun run dev:cli:lab` | Start background lab node |
| `bun run dev:cli:lab:stop` | Stop |
| `bun run dev:cli:lab:restart` | Restart after CLI code changes |
| `bun run dev:cli:lab:status` | PID + `/health` |
| `bun run dev:cli:lab:logs` | Tail lab log |
| `bun run dev:cli:lab:pair` | `pair-create` against lab home |
| `bun run dev:cli:lab:smoke` | start → health → pair + DevTools snippet |
| `bun run dev:cli:lab:fg` | Foreground (debug) |

Underlying helper: [`scripts/remote-cli-local.sh`](../../../scripts/remote-cli-local.sh).

## Defaults (overridable)

| Env | Default | Notes |
|-----|---------|--------|
| `SUPERONE_NODE_HOME` | `~/.superone/node-dev-lab` | Isolated from production `~/.superone/node` |
| `SUPERONE_NODE_HOST` | `127.0.0.1` | Loopback only |
| `SUPERONE_NODE_PORT` | `7789` | Leaves `7788` free for Docker SSH forward |
| `SUPERONE_NODE_LABEL` | `local-dev-lab` | Environment label after pair |

## Credentials / harnesses

**Model turns do not use the host’s global `claude` / interactive CLI binary.**

| Harness | Binary source | Auth reused from host |
|---------|---------------|------------------------|
| **Claude** | `@superone/claude` → Agent SDK optional platform package (`claude-agent-sdk-*-*`), or SuperOne `harness enable claude` managed package | `$HOME` login (e.g. `~/.claude`) + optional node ProviderStore API keys |
| **Codex** | SuperOne `harness enable codex` managed package `command`, or optional `SUPERONE_CODEX_BINARY` pin | host Codex login / node ProviderStore |

- Lab process runs as **your** user with **host** `$HOME` so existing logins apply.
- Managed harness install state lives under `SUPERONE_NODE_HOME` (lab:
  `~/.superone/node-dev-lab`).
- `dev:cli:lab` does **not** auto-set `SUPERONE_CLAUDE_BINARY` from `which claude`.

| Env | Purpose |
|-----|---------|
| `SUPERONE_CODEX_BINARY` | Optional pin for Codex App Server binary (lab may auto-pick host `codex` if unset) |
| `SUPERONE_CLAUDE_BINARY` | **Escape hatch only** — last resort after SDK package; do not use for normal lab |

### Claude turns (Stage 5-E Agent SDK + permissions)

Production multi-dispatch runs Claude via **`@superone/claude`** (official Claude
Agent SDK `query()`, same family as desktop — not print-mode):

```text
SDK query({ prompt, options: { pathToClaudeCodeExecutable, resume, canUseTool, … } })
  → SessionTurnEvent (onEvent) + providerResume claude-session:<id>
```

Binary resolution: managed enable package → **SDK platform binary** → env pin.

- Host `$HOME` credentials (Claude Code OAuth under `~/.claude`) are inherited —
  SuperOne does **not** require the remote/host `claude` CLI binary.
- Node ProviderStore holds API keys when you configure Providers under the lab host.
- `providerResume` is stored as `claude-session:<id>` for multi-turn SDK `resume`.
- Tool permissions: SDK **`canUseTool`** → TurnRunner **`onPermission`** →
  durable `session.permission_requested` → desktop `session.respondPermission`.

```bash
# Normal lab — SDK package + host login, no claude binary override
bun run dev:cli:lab:restart
```

`session.create` with harness `claude` succeeds when the Agent SDK platform
package is installed (monorepo `bun install` / node_modules optional deps) or
when managed enable left a catalog `command`. Clients with the control lease
call `session.respondPermission`; unauthorized clients stay fail-closed.

If send fails with “binary not available”, reinstall optional deps for
`@anthropic-ai/claude-agent-sdk` (do not omit optional packages), then restart lab.


## After CLI code changes

Like Docker, the **running** process does not hot-reload:

```bash
bun run dev:cli:lab:restart
# then desktop Reconnect on that environment if needed
```

## What Docker is still for

- Clean Linux host + `systemd-user`
- SSH discovery / local forward / host key behavior
- “no host credentials” isolation tests

Do not drop Docker; **prefer local lab for daily harness iteration**.
