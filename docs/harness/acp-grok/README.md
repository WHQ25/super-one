# Grok (ACP) integration

Pin: `@agentclientprotocol/sdk` `^1.4.0` (installed 1.4.0) · Ledger version: not started ·
Last updated: 2026-09-29

## Upstream

- Protocol: [Agent Client Protocol](https://agentclientprotocol.com) through
  `@agentclientprotocol/sdk`, plus xAI's `_x.ai` extension notifications.
- Runtime: the user's own `grok` binary (Grok Build), launched as an ACP agent; SuperOne
  does not pin it.
- The SDK dependency is a caret range. Pin it exactly before starting a ledger.

## Integration shape

| Runtime | Entry | Notes |
|---|---|---|
| Desktop sessions | `apps/desktop/src/main/session/backends/acp-backend.ts` | |
| Core | `packages/acp/src` | `agent-event-mapper.ts`, `permission-map.ts`, `xai-event-map.ts`, `xai-elicit.ts` |
| Runtime discovery | `packages/runtime/src/harness/grok-runtime.ts` | Resolves `grok` |

## Pin locations

| Location | What |
|---|---|
| `packages/acp/package.json` | `@agentclientprotocol/sdk` |
| `apps/desktop/package.json` | `@agentclientprotocol/sdk` |

## Documents

- Design notes: [grok-acp-permissions.md](grok-acp-permissions.md),
  [grok-build-parity.md](grok-build-parity.md),
  [grok-xai-ext-notifications.md](grok-xai-ext-notifications.md)
- [api-surface.md](api-surface.md) · [contracts.md](contracts.md) · [backlog.md](backlog.md)
- Upgrade docs: none yet; add `upgrades/<version>.md` with the next bump

## Version history

| Version | Date | Status | Upgrade doc | Commit |
|---|---|---|---|---|
