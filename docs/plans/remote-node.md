# Remote node: open work

Status: in-progress · Updated: 2026-09-30
Goal: Close the gaps between the remote node as built and the architecture in the long-term doc, then converge the local desktop runtime onto the same node path.
Long-term docs affected: [remote-node-service.md](../architecture/remote-node-service.md), [runtime-delivery.md](../harness/runtime-delivery.md), [session-sync-zone.md](../architecture/session-sync-zone.md)

## Known drift (code vs decided behavior)

- `apps/cli/src/cli.ts` still exposes a public `--home DIR` on `start`,
  `pair-create`, `status`, `identity`, `identity regenerate`, `install-systemd`.
  Decision: no public data-dir override; keep only `SUPERONE_NODE_HOME` for
  tests/labs.
- Grok id split: catalog `acp-grok`, but `session.create` normalizes to wire `acp`
  and `capabilities.harnessIds` advertises `acp`. Migrate new Grok Sessions to
  `acp-grok` without rewriting custom ACP profiles.
- `normalizeCapabilities` (`packages/shared/src/environment/capabilities.ts`)
  keeps only `claude | codex | acp | opencode`, so a client drops `cursor` and
  `dsh` (and `acp-grok`) advertised by a node.
- Descriptor reports `mcp: false` although the node serves `skills.*` / `mcp.*`
  RPC and merges MCP config into Claude turns.
- Node ACP/OpenCode runners only use `SUPERONE_ACP_BINARY` /
  `SUPERONE_OPENCODE_BINARY`; `apps/cli/src/runtime.ts` never passes the
  catalog command saved by `harness enable --command`, and
  `harness-host.ts` `isRunnableWithoutCatalog` is env-only too.
- Idempotency is not transactional: `apps/cli/src/auth/idempotency.ts` runs the
  command, then stores the receipt; session row and event append are separate
  writes in `SessionRuntime`.
- `pack-npm.ts` maps `-beta` → `beta` and `apps/cli/README.md` documents it, but
  there is no beta channel and `publish-cli.yml` derives only `alpha | latest`.
- Stale comments: `apps/cli/src/session/harness-cli.ts` (header/usage: "signed
  CDN download is still deferred", "Stage 2"), `packages/runtime/src/harness/managed-release.ts`
  ("Network download is still deferred", `$NODE_HOME/release-manifest.json`),
  `apps/cli/src/session/harness-runners.ts` ("simulated until real clients"),
  `apps/cli/src/cli.ts` ("Collaboration still requires simulatedHarness"),
  `scripts/publish-harness-artifacts.ts` ("alpha|beta|stable").
- `EnvironmentHost.upgradeRemoteNode()` error hint hardcodes
  `npm install -g @super-one/cli@alpha`.

## Remote Agent Session

- Single-transaction receipt + state + events for mutating RPC.
- Event-log snapshots/compaction; emit `cursor_too_old` with a resnapshot
  signal (`snapshot_required` is not defined yet).
- `dsh` node turn runner (currently fails closed).
- Full ACP/OpenCode protocol readiness probes (today: path exists + executable).
- Harness CLI: `--env-file`, `--server-password-stdin`, `--clear-server-password`,
  `--clear-env`, `--startup-timeout`, `--initialize-timeout`; live Session drain
  on `disable`; `repair` without `--artifact`.
- Node-side managed-runtime alignment on CLI upgrade, with CLI + runtime
  activation committed or rolled back together.
- Signed release/harness manifests (today SHA-256 digests only).
- Per-harness recovery capability record (`inFlightTurnReattach`,
  `pendingInteractionRestore`, `providerCrashRecovery`) if per-harness
  guarantees diverge; today only environment-level `coldSessionResume` /
  `turnReattach`.
- Codex node auth persistence across node restart.

## Harness and collaboration parity

- Desktop thin-wrap onto `@superone/claude` (`ClaudeLiveSession`) instead of
  `apps/desktop/src/main/agent/claude-query.ts`.
- Remote resource/provider-setup UI wiring on desktop.
- Cross-environment collaboration spawn (local agent launching a child Session
  on a node, controller-owned grant and mailbox via Host Actions).

## Endpoints and identity

- Node-side Tailscale endpoint provider (discovery, optional Serve).
- Environment relay transport: only `packages/shared/src/environment/relay-framing.ts`
  exists; `relay` is excluded from `CONNECTABLE_ENDPOINT_KINDS`.
- Mobile environment client on `ConnectionSupervisorCore` with secure-store and
  socket adapters.
- Administrative lease takeover (generation bump + audit event).
- `superone identity adopt` for legitimate host migration.

## Install and upgrade

- Packaged desktop ships no upload artifacts: nothing populates
  `resources/superone-dist` (`dist-locator.ts`).
- External upgrade launcher: compatibility check, SQLite backup, drain
  `wait|cancel|force`, atomic switch, health check, rollback.
- Runtime-bundled signed artifact as the default for clean hosts.
- `systemd-system` installer; general uninstall with explicit data removal.

## Local runtime convergence (desktop as node)

One execution model: the desktop's local environment runs through the same
node server and `EnvironmentGateway` path as remote. Desktop B as an
execution node for agent orchestration goes first; see
[desktop-node-orchestration.md](desktop-node-orchestration.md).

- Server core is extracted to `packages/runtime/src/server/`, but only
  `apps/cli` consumes it; the desktop does not embed it.
- `LocalEnvironmentGateway` Session port wires only `list`; create/send/control
  throw and local Sessions still use agent IPC.
- Ownership merge: control lease becomes the single steering authority.
- Desktop event log with `afterSequence` recovery.
- Lifecycle: app-lifecycle backend by default; optional always-on service
  (launchd / Windows Service / systemd-user) toggled from Settings; quit prompt
  when local work would be interrupted; pairing so another client can attach.

## Validation not yet run

- Clean supported Linux host: desktop install → logout persistence (linger) →
  desktop restart reconnect → revocation → identity regenerate after clone.
- SSH matrix: `~/.ssh/config` aliases, ProxyJump, agent, askpass cancel, host key
  mismatch, stale tunnel, pairing token absent from argv/history/logs.
- Disconnect mid-turn and reconnect with complete ordered transcript; node
  restart with pending interaction; provider crash.
- Two clients racing control and approval across endpoint failover.
- Large transfer bounds on a real remote.
