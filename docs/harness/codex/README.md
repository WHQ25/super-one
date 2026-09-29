# Codex integration

Pin: `@openai/codex` `0.155.1` · Ledger version: not started · Last updated: 2026-09-29

## Upstream

- Package: [`@openai/codex`](https://www.npmjs.com/package/@openai/codex) (npm wrapper
  around the Rust `codex` binary). Stable releases only; `-alpha` builds are not followed.
- Changelog: [openai/codex releases](https://github.com/openai/codex/releases) (`rust-v<version>` tags).
- Surface source: the app-server JSON-RPC protocol. `codex app-server generate-json-schema`
  (and `--experimental`) from the pinned binary; read the tag, not a local `main` checkout.
  A future ledger splits stable and experimental `ClientRequest`, `ServerRequest` and
  `ServerNotification`.

## Integration shape

Desktop spawns `codex app-server` and speaks JSON-RPC over stdio with
`experimentalApi` enabled.

| Runtime | Entry | Notes |
|---|---|---|
| Desktop sessions | `apps/desktop/src/main/session/backends/codex-backend.ts`, `apps/desktop/src/main/codex/app-server-connection.ts` | Thread and turn lifecycle, server requests |
| Shared core | `packages/codex/src` | `agent-event-mapper.ts`, per-version protocol shims (`protocol-v154.ts`, …), `fork-thread.ts` |
| Remote node | `apps/cli/src/session/codex-turn-runner.ts` | Uses `packages/codex` |

## Pin locations

| Location | What |
|---|---|
| `apps/desktop/package.json` | `@openai/codex` dependency |
| `packages/runtime/src/harness/managed-official.ts` | `OFFICIAL_CODEX_NPM_VERSION`, the managed install |

`packages/runtime/src/harness/managed-official-lockstep.test.ts` keeps them equal.

## Documents

- [multi-account.md](multi-account.md) — ChatGPT accounts bound per conversation
- [api-surface.md](api-surface.md) · [contracts.md](contracts.md) · [backlog.md](backlog.md)
- [upgrades/](upgrades/) — `0.147/` and `0.154/` are multi-part plans written in Chinese
  before this folder existed.

## Version history

| Version | Date | Status | Upgrade doc | Commit |
|---|---|---|---|---|
| 0.155.1 | 2026-09-22 | executed | — | `a9291b513` |
| 0.154.0 | 2026-09-12 | executed | [0.154](upgrades/0.154/README.md) | `18654457f` |
| 0.153 | 2026-09-04 | executed | — | `92622b658` |
| 0.149 | 2026-08-22 | executed | — | `f53bfa2a0` |
| 0.147.0 | 2026-08-14 | executed | [0.147](upgrades/0.147/README.md) | `04d46bdcd` |
| 0.146.1 | 2026-08-06 | executed | — | `bf57d2e14` |
