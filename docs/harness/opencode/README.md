# OpenCode integration

Pin: `@opencode-ai/sdk` `^1.18.26` (installed 1.18.26) · Ledger version: not started ·
Last updated: 2026-09-29

## Upstream

- Client: [`@opencode-ai/sdk`](https://www.npmjs.com/package/@opencode-ai/sdk), with
  `@opencode-ai/models` `^0.0.62` for the model catalog.
- Runtime: the user's own `opencode` binary, found on `PATH`; SuperOne does not pin it.
- The SDK dependency is a caret range. Pin it exactly before starting a ledger, or the
  ledger version cannot be stated.

## Integration shape

| Runtime | Entry | Notes |
|---|---|---|
| Desktop sessions | `apps/desktop/src/main/session/backends/opencode-backend.ts` | |
| Core | `packages/opencode/src` | `agent-event-mapper.ts`, `parse.ts` |
| Runtime discovery | `packages/runtime/src/harness/enable.ts` | Resolves `opencode` on `PATH` |

## Pin locations

| Location | What |
|---|---|
| `packages/opencode/package.json` | `@opencode-ai/sdk` |
| `apps/desktop/package.json` | `@opencode-ai/sdk`, `@opencode-ai/models` |

## Documents

- [api-surface.md](api-surface.md) · [contracts.md](contracts.md) · [backlog.md](backlog.md)
- Upgrade docs: none yet; add `upgrades/<version>.md` with the next bump

## Version history

| Version | Date | Status | Upgrade doc | Commit |
|---|---|---|---|---|
