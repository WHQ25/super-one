# Grok (ACP) integration

Pin: `@agentclientprotocol/sdk` `^1.4.0` (installed 1.4.0) · Ledger version: not started ·
Last updated: 2026-10-04

## Upstream

- Protocol: [Agent Client Protocol](https://agentclientprotocol.com) through
  `@agentclientprotocol/sdk`, plus xAI's `_x.ai` extension notifications.
- Runtime: the user's own `grok` binary (Grok Build), launched as an ACP agent; SuperOne
  does not pin it. Each source check is still an upgrade doc. The version is
  `xai-grok-version`'s crate version plus the grok-build commit that was read
  (`<crate>+<shortsha>`). A release binary stamps `GROK_VERSION` and can be ahead
  of that crate version; record both when they differ.
- The SDK dependency is a caret range. Pin it exactly before starting a ledger.
  That pin is separate from the grok-build upgrade trail.

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

- Runtime contracts: [grok-acp-permissions.md](grok-acp-permissions.md),
  [grok-build-parity.md](grok-build-parity.md),
  [grok-xai-ext-notifications.md](grok-xai-ext-notifications.md)
- [api-surface.md](api-surface.md) · [contracts.md](contracts.md) · [backlog.md](backlog.md)
- Upgrade docs: [upgrades/](upgrades/) — one file per grok-build revision that was read

## Version history

| Version | Date | Status | Upgrade doc | Commit |
|---|---|---|---|---|
| grok 1.0.46 installed | 2026-10-04 | not in the public source | — | `2765805b9442` is not in the local clone or on `origin` |
| grok 1.0.45 (2bdd1d6a) | 2026-10-04 | executed | [1.0.45+2bdd1d6a](upgrades/1.0.45+2bdd1d6a.md) | public `origin/main` that was read; crate `1.0.45`; `SOURCE_REV` `559751fd` |
| grok 1.0.32 (48271133) | 2026-10-04 | planned | [1.0.32+48271133](upgrades/1.0.32+48271133.md) | stale checkout that was read; 6 commits behind `origin/main` |
