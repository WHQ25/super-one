# CLAUDE.md — `apps/cli` (`@superone/cli`)

Headless SuperOne node: WebSocket RPC server, workspace FS/git, pairing, systemd install, and the Docker SSH remote-lab used with desktop Remote Control.

For monorepo layout, root commands, and shared conventions, see the **repo-root `CLAUDE.md`**. This file is loaded additively when you work inside `apps/cli/`.

## Commands

```bash
# From repo root
bun run dev:cli                 # Local foreground node (tsx) — production-ish home/port
bun run test:cli                # CLI vitest suite

# Local remote lab (host process, remote protocol — preferred for harness/cred work)
bun run dev:cli:lab             # start background lab on :7789, home ~/.superone/node-dev-lab
bun run dev:cli:lab:smoke       # start + health + pair + DevTools snippet
bun run dev:cli:lab:pair        # pair-create
bun run dev:cli:lab:restart     # after CLI code changes
bun run dev:cli:lab:stop

# Docker SSH remote lab (Linux/SSH fidelity — see docker/README.md)
bun run dev:cli:docker          # build + start container
bun run dev:cli:docker:smoke    # up + healthy + pair smoke
bun run dev:cli:docker:forward  # keep ssh -L open
bun run dev:cli:docker:pair     # pair-create inside lab
bun run dev:cli:docker:down     # stop lab
```

**Prefer local lab** when iterating harnesses or anything that needs host Claude/Codex/Grok
credentials. Docker does not see host `$HOME` logins and forces re-auth. Local lab is still a
**remote node** (HTTP/WS RPC + pairing), not Electron IPC. Full notes:
[`docs/local-remote-lab.md`](./docs/local-remote-lab.md).

### Manual test: desktop ↔ local lab (UI)

Use this when verifying remote protocol / harness / session work without Docker.

```bash
# Terminal A — host-process node (loopback :7789, home ~/.superone/node-dev-lab)
bun run dev:cli:lab

# Terminal B — Electron (dev build only shows the Local lab card)
bun run dev
```

1. In the app: **Remote Control → Control Other Devices**.
2. Open the **Local lab** card (dashed border, top of the channel list).
3. Status should show **Lab online** and `http://127.0.0.1:7789`.
   - If **Lab offline**: lab is not running → start Terminal A, then hit refresh.
4. Click **Connect lab** (or **Reconnect lab** if already paired).
5. Expect a success toast; the paired row appears under the card (connect / disconnect / remove).
6. Open a remote project on that environment and exercise chat/terminal as needed.
7. **Files tab:** list + git decorations + **preview/edit** (`readProjectFile` /
   `saveFile` / `git.diff` over RPC); rename, drag-move, delete; drag
   **local→remote** (copy) and **remote→local**. Per-file cap **10 MiB**.
   Restart lab after CLI workspace changes: `bun run dev:cli:lab:restart`.

**What the button does:** `GET /health` → if not already paired for that baseUrl, mint a
pairing token via monorepo `pair-create` against `SUPERONE_NODE_HOME` →
`pairRemote` / `connect` (IPC: `environment:localLabStatus`, `environment:pairLocalLab`).

**DevTools fallback** (optional):

```js
await window.environment.pairLocalLab()
// or: await window.environment.localLabStatus()
```

After changing `apps/cli/src/**`, restart the lab (`bun run dev:cli:lab:restart`) before
re-testing — the running process does not hot-reload.

Package-local: `bun run dev` / `bun run test` / `bun run build:dist` from `apps/cli/`.

## Session surface (remote chat)

Production CLI always exposes `session.*` RPC (list/create/get/send/interrupt/close/remove/rename + control leases + events). Turn execution uses the injectable multi-harness runner (currently simulated adapters until real provider CLIs are wired). Desktop routes remote chat through `EnvironmentHost` → `RemoteEnvironmentGateway` → these RPCs.

**Harness catalog (Phase 3 Stage 1–2):** `HarnessManager` persists installation intent/readiness in SQLite. `environment.descriptor.capabilities.harnessIds` lists only enabled+ready harnesses (default empty in production). `session.create` fails closed if the harness is not ready. Admin catalog RPC: `harness.list`, `harness.show` (catalog ids include `acp-grok`; session wire id for Grok remains legacy `acp`). `simulatedHarness: true` pre-marks all harnesses ready for contract tests only.

**CLI:** `superone harness list|show|enable|disable|configure|doctor|repair` operates on `$HOME/.superone/node` (no public `--home`; `SUPERONE_NODE_HOME` for tests). Managed enable requires a release manifest (`$NODE_HOME/release-manifest.json` or `SUPERONE_HARNESS_MANIFEST`) and offline `--artifact` matching the pinned SHA-256; installs under `releases/<cliVersion>/harnesses/<id>/`.

**Stage 4 Codex turns:** production node startup uses a real Codex App Server client (`codex-app-server-client` + `codex-turn-runner`) when a codex binary is resolvable (`harness catalog command`, `SUPERONE_CODEX_BINARY`). Tests keep `simulatedHarness: true` for multi-harness simulated turns. Without a binary, production fails closed on codex turns. Codex uses **`onDelta` only** (no structured `onEvent` text).

**Stage 5-A durable turn events:** `TurnRunner` accepts optional `onEvent(SessionTurnEvent)` for structured text/tool/permission/status. Runtime projects these into the SQLite environment event log (`session.tool_*`, `session.status_changed`, `session.assistant_text`, …) via `EventLog.appendSession`. Contracts live in `@superone/shared/environment` (`session-events.ts`).

**Stage 5-E Claude Agent SDK turns:** `createProductionTurnRunner` multi-dispatches `claude` → `@superone/claude` (`runClaudeSdkTurn` + Agent SDK `query`) via `claude-turn-runner`. Binary defaults to the **SDK optional platform package** (same as desktop); optional overrides: harness catalog `command`, `SUPERONE_CLAUDE_BINARY`. Emits structured **`onEvent`**, persists `providerResume` as `claude-session:<id>`. Host `$HOME` credentials apply in local lab. Stage 5-B print client is legacy only.

**Codex App Server turns:** production path uses `@superone/codex` (`openCodexAppServer` / `runCodexAppServerTurn`); `apps/cli` re-exports via `codex-app-server-client.ts` for stable local imports. Desktop still has a richer app-server connection pool.

**Session runtime:** logic lives in `@superone/runtime/session` (ports for store / event log / lease). CLI wires SQLite via `sqlite-session-store.ts` and a thin `SessionRuntime` subclass keeping the historical constructor for tests.

**ACP / OpenCode on node:** `@superone/acp` and `@superone/opencode`.
- OpenCode: real `opencode serve` + SDK turn when `SUPERONE_OPENCODE_BINARY` (or runner `binaryPath`) points at an existing binary; else simulated.
- ACP: real agent process when `SUPERONE_ACP_BINARY` / `SUPERONE_ACP_COMMAND` set; else simulated.
- Fail closed when `allowSimulatedFallback: false` and no binary. Desktop still has fuller ACP/OpenCode backends.

**Harness reuse:** node Claude must not be a permanent print-mode side track — same Agent SDK family as desktop (see `docs/design/remote-node-service.md` §5.1).

**Stage 5-D permissions:** `SessionRuntime` parks turns on a single-settlement permission waiter. Claude maps SDK **`canUseTool`** → TurnRunner **`onPermission`** → durable `session.permission_requested` → `session.respondPermission`.

**Stage 5 Claude + permission respond (5-D):** SessionRuntime parks turns on a promise waiter when the runner calls `onPermission` (no busy-poll / `_lastPermission`). Control-lease holders call `session.respondPermission` (`allow` | `deny` | `allow_always`); timeout / interrupt / close settle as `deny` with durable `permission_timeout` / `permission_aborted`. Desktop remote send returns early when `pendingInteraction` is set so the permission prompt can render; respond re-hydrates the node session after the turn unblocks. Lab enable for Claude: set `SUPERONE_CLAUDE_BINARY` to a host `claude` executable (see `docs/local-remote-lab.md`); runner wiring is Stage 5-E (`claude-turn-runner` + `@superone/claude`).

When adding a **user-visible capability that must work on a remote host**, add or extend a CLI RPC first, then thin `environment:*` IPC + renderer routing by `connectionId`. Do not teach the product path to call local SessionManager for remote project keys (`remote:<connectionId>:<path>`).

## ⚠️ Labs do not hot-reload CLI code

**Local lab** and **Docker lab** both keep the node process in memory. After
changing `apps/cli/src/**` (or shared packages the node imports):

```bash
bun run dev:cli:lab:restart          # local lab
# or
docker restart superone-remote-cli   # docker lab
```

Desktop may need **Reconnect** on that environment. Upload-install paths still
need `bun run build:dist` + re-upload.

### Docker lab details

The remote lab (`superone-remote-cli`) **mounts the monorepo** and runs:

```text
tsx src/cli.ts start --foreground …
```

`tsx` here is **not** in watch mode. Editing `apps/cli/src/**` (or shared packages the node imports) updates files on disk, but the **already-running node process keeps the old code in memory**.

Symptoms when you forget to restart:

- `unknown method: …` for newly added RPC handlers (e.g. `fs.listDir`)
- Fixed bugs still repro on the paired remote
- Desktop (hot-reloaded) calls new RPCs; remote still serves the previous process

### Agent rule (required)

Whenever you **change CLI runtime behavior** (RPC handlers, auth, workspace FS, session, install, protocol) and the user is (or may be) testing against the Docker remote lab:

1. **Remind the user** that the lab must pick up the new code.
2. Prefer offering (or running, if they want) a restart:

```bash
docker restart superone-remote-cli
# wait until healthy:
docker inspect --format='{{.State.Health.Status}}' superone-remote-cli
```

3. Note that restart drops SSH local-forwards; desktop may need **Reconnect** on that environment.

If they use **upload install** (tarball under `apps/cli/dist/`) instead of the live-mounted lab, remind them to rebuild dist and re-upload — a restart alone is not enough:

```bash
# from apps/cli
bun run build:dist
# then desktop Remote Control → install source "upload"
```

Do **not** assume “desktop hot reload” covers the remote node.

## Layout (quick map)

| Path | Role |
|------|------|
| `src/cli.ts` | CLI entry (`start`, `pair-create`, systemd helpers) |
| `src/rpc/handlers.ts` | RPC method dispatch (`fs.*`, `workspace.*`, `project.*`, …) |
| `src/server/node-server.ts` | HTTP health + authenticated WebSocket RPC |
| `src/workspace/` | Project registry, FS, git, watches |
| `src/session/` | Session runtime / leases / events (when harness wired) |
| `docker/` | SSH remote Linux lab (sshd + node on loopback) |
| `scripts/build-dist.ts` | Packaged node binary/tarball for upload install |

More lab detail: [`docker/README.md`](./docker/README.md). Design notes: `docs/design/remote-node-service.md` (repo root).
