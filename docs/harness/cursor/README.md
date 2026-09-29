# Cursor SDK integration

Pin: `@cursor/sdk` `1.0.30` · Ledger version: not started · Last updated: 2026-09-29

## Upstream

- Package: [`@cursor/sdk`](https://www.npmjs.com/package/@cursor/sdk) plus one native
  package per platform (`@cursor/sdk-<os>-<arch>`).
- Surface source: `dist/esm/index.d.ts` / `public-api.d.ts` in the package.

## Integration shape

Native SDK with its local session store. SuperOne tools use HTTP MCP; local
custom SDK tools provide session metadata and the question bridge.

| Runtime | Entry | Notes |
|---|---|---|
| Desktop sessions | `apps/desktop/src/main/session/backends/cursor-backend.ts` | |
| Core | `packages/cursor/src` | Event mapping and SDK wiring |

## Pin locations

| Location | What |
|---|---|
| `packages/cursor/package.json` | `@cursor/sdk` and five native packages |
| `apps/desktop/package.json` | the same set |

## Documents

- [cursor-sdk-harness.md](cursor-sdk-harness.md) — runtime integration and decisions D1–D11
- [cursor-auth-local-login.md](cursor-auth-local-login.md) — API key, SDK browser login and vault ownership
- [api-surface.md](api-surface.md) · [contracts.md](contracts.md) · [backlog.md](backlog.md)
- Upgrade docs: none yet; add `upgrades/<version>.md` with the next bump

## Version history

| Version | Date | Status | Upgrade doc | Commit |
|---|---|---|---|---|
| 1.0.30 | 2026-09-05 | executed | — | `8dbf37fd7` (dependency group bump) |
| 1.0.27 | 2026-08-12 | executed | — | `91ce4bff0` |
| 1.0.24 | 2026-07-25 | executed | — | `7c4c43d7c` (initial integration) |
