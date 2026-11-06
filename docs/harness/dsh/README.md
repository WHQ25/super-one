# DeepSeek harness (dsh) integration

Pin: `@deepseek-ai/dsh-*` `0.2.2-rc.1` · Ledger version: `0.2.2-rc.1` (manual inventory) · Last updated: 2026-11-06

## Upstream

- Packages: 136 `@deepseek-ai/*` packages from npm: the `dsh-*` family at the pinned
  version, plus the cordis family on its own versions (`cordis` 4.1.0,
  group/loader/include 1.1.0, timer 1.2.0,
  `schemastery` 3.19.0). Only the `next` dist-tag is followed;
  peers are exact, so the whole family moves together.
- Surface source: the Cordis services and plugins each package declares. Version strategy:
  [deepseek-harness-integration.md §11](deepseek-harness-integration.md).

The embedded runtime requires Node **24.9+**. Electron 44.9.3 provides Node
24.22.0; Windows PTC uses an external Node and must meet the same minimum.

## Integration shape

dsh runs in-process as a Cordis tree inside Electron main, not as a child CLI.

| Runtime | Entry | Notes |
|---|---|---|
| Desktop sessions | `apps/desktop/src/main/session/backends/deepseek-backend.ts`, `apps/desktop/src/main/deepseek/deepseek-runtime-host.ts` | Session lifecycle, host plane |
| Core | `packages/deepseek/src` | `tree.ts` mounts the plugin tree, `runtime.ts` |

## Pin locations

| Location | What |
|---|---|
| `packages/deepseek/package.json` | every `@deepseek-ai/*` and cordis package |
| `apps/desktop/package.json` | the same set |
| `packages/deepseek/src/bundled-plugins.ts` | diagnostic catalog versions |
| Root `package.json`, `patches/` | Electron subprocess runner patch keyed by version |
| `apps/desktop/resources/agent-presets/` | reviewed upstream preset declarations |

## Documents

- [deepseek-harness-integration.md](deepseek-harness-integration.md) — runtime composition,
  ownership and decisions; the historical embedding [spike](deepseek-harness-spike.mjs)
  is retained separately from the maintained runtime tests
- [api-surface.md](api-surface.md) · [contracts.md](contracts.md) · [backlog.md](backlog.md)
- [upgrades/](upgrades/)

## Version history

| Version | Date | Status | Upgrade doc | Commit |
|---|---|---|---|---|
| 0.2.2-rc.1 | 2026-11-06 | executed | [0.2.2-rc.1](upgrades/0.2.2-rc.1.md) | — |
| 0.1.7-rc.1 | 2026-09-24 | executed | [0.1.7-rc.1](upgrades/0.1.7-rc.1.md) | `52a63be9a` |
| 0.1.1-rc.2 | 2026-08-23 | executed | [0.1.1-rc.2](upgrades/0.1.1-rc.2.md) | `f205e572d` |
| 0.1.0-rc.8 | 2026-08-20 | executed | [0.1.0-rc.8](upgrades/0.1.0-rc.8.md) | `0cd3cc94a` |
