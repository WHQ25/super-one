# CLI guidance

Headless SuperOne node: authenticated HTTP/WebSocket RPC, projects/files/git,
control leases, sessions, and harness execution. Root repository rules apply.

## Ownership and behavior

- Production `session.*` RPC uses `createProductionTurnRunner` in
  `src/session/codex-turn-runner.ts`: Claude/Codex runners plus ACP, OpenCode,
  and Cursor package adapters. Inspect that dispatcher for current support.
  Simulation is opt-in for tests (`allowSimulatedFallback: true`); missing
  production binaries or unsupported harnesses fail closed.
- `HarnessManager` persists installation readiness. The advertised harness list
  includes enabled, ready harnesses; `session.create` checks readiness.
  Catalog id `acp-grok` and session id `acp` are different contracts.
- `@superone/runtime/session` owns lifecycle, leases, event persistence, and
  permission waiters. CLI supplies SQLite and environment ports. Structured
  events and legacy deltas must not emit the same text twice.
- Permission responses settle once. Permission, question, and plan prompts have no
  deadline (desktop parity); interrupt/close deny pending work and emit terminal
  events. Do not introduce busy polling or a second permission path.
- Remote capabilities go through CLI RPC → environment gateway → renderer by
  `connectionId`. Remote project keys must not reach a local SessionManager path.

## Find the relevant code

| Area | Entry |
|---|---|
| Commands, startup, pairing | `src/cli.ts` |
| RPC dispatch | `src/rpc/handlers.ts` |
| HTTP health and authenticated WebSocket | `src/server/node-server.ts` |
| Files and git | `src/workspace/` |
| Sessions and runner wiring | `src/session/`, `packages/runtime/src/session/` |
| Node binary/tarball packaging | `scripts/build-dist.ts` |
| Local/Docker verification | [labs.md](docs/agent-reference/labs.md) |

## Commands and verification

From the repository root, use `bun run dev:cli` for a foreground node or
`bun run dev:cli:lab` for the local lab. Use `bun run dev:cli:lab:restart` after
runtime changes when testing that lab; neither local nor Docker labs hot-reload.
Use Docker only when the task needs its Linux/SSH environment.

Run targeted Vitest files from `apps/cli` for the changed RPC/runner behavior;
`bun run test:cli` is the full CLI suite and follows the root explicit-request rule.
Packaging commands live in `apps/cli/package.json`; publishing follows the
repository release skill. Do not infer permission to restart unrelated nodes or
publish from permission to edit source.
