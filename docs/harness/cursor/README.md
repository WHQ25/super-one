# Cursor SDK integration

Pin: `@cursor/sdk` `1.3.1` · Ledger version: `1.3.1` partial · Last updated: 2026-11-15

## Upstream

- Package: [`@cursor/sdk`](https://www.npmjs.com/package/@cursor/sdk) plus one native
  package per platform (`@cursor/sdk-<os>-<arch>`).
- Surface source: `dist/esm/index.d.ts` / `public-api.d.ts` in the package.

## Integration shape

Native SDK with its local session store. SuperOne tools use HTTP MCP; the
local custom SDK tool is the question bridge.

| Runtime | Entry | Notes |
|---|---|---|
| Desktop sessions | `apps/desktop/src/main/session/backends/cursor-backend.ts` | |
| Core | `packages/cursor/src` | Event mapping and SDK wiring |

## Pin locations

| Location | What |
|---|---|
| `packages/cursor/package.json` | `@cursor/sdk`, five native packages, and zod `^4.3.6` |
| `apps/desktop/package.json` | the same SDK set |
| `apps/cli/scripts/pack-npm.ts` | reads `@cursor/sdk` from `packages/cursor` |

## Documents

- [cursor-sdk-harness.md](cursor-sdk-harness.md) — runtime integration and decisions D1–D11
- [cursor-auth-local-login.md](cursor-auth-local-login.md) — API key, SDK browser login and vault ownership
- [api-surface.md](api-surface.md) · [contracts.md](contracts.md) · [backlog.md](backlog.md)
- [upgrades/1.3.1.md](upgrades/1.3.1.md) — compact, steer, extra roots

## Version history

| Version | Date | Status | Upgrade doc | Commit |
|---|---|---|---|---|
| 1.3.1 | 2026-11-15 | executed | [1.3.1.md](upgrades/1.3.1.md) | uncommitted |
| 1.0.30 | 2026-09-05 | executed | — | `8dbf37fd7` (dependency group bump) |
| 1.0.27 | 2026-08-12 | executed | — | `91ce4bff0` |
| 1.0.24 | 2026-07-25 | executed | — | `7c4c43d7c` (initial integration) |
