# OpenCode `@opencode/client` 2.0.27 → 2.3.2

Status: executed · Client: `@opencode/client` 2.3.2 · Date: 2026-11-22

## 1. Scope

Upgrade the shared desktop and remote-node V2 client pin from `@opencode/client`
`2.0.27` to `2.3.2` and migrate deprecated V2 routes currently used by
SuperOne to their `experimental.*` replacements before the next minor removes
the aliases. Keep the legacy 1.x `@opencode-ai/sdk` path untouched.

## 2. Upstream changes

| Version | Change | Tag | Note |
|---|---|---|---|
| 2.3.2 client | Generated `session.log`, `session.instructions.entry.*`, `mcp.add/remove/connect/disconnect`, `session.stats/import/export/skill/wait`, `generate.*`, `file.write`, `config.update`, `integration.wellknown.add`, `migration.v1.status` moved under `experimental.*` | [impact] | Old top-level paths remain `@deprecated` until the next minor |
| 2.3.2 client | `ExperimentalMcpAddInput` replaces deprecated `McpAddInput` | [impact] | Used by `OpenCodeV2McpConfig` |
| 2.3.2 client | `event.subscribe` wrapper keeps `SharedEvents.SubscribeOptions` single-object `{ signal?, types? }` signature in `OpenCodeClient`, while raw generated client takes `(input?, requestOptions?)` | [none] | Existing `sdk.event.subscribe({ signal })` remains valid through `OpenCodeClient` |
| 2.3.2 client | New `experimental.usage.limits`, `experimental.media.get`, `experimental.blob.get`, `withMediaRefs`, `SessionPromptInput.files[].source`, `experimental.automation.*`, `experimental.artifacts.*`, `experimental.voice.*`, `permission.saved.update` | [benefit] | Candidates for follow-up adoption |

## 3. Surface diff

- Migrated used routes in `packages/opencode/src/opencode-v2-client.ts`:
  - `sdk.session.log` → `sdk.experimental.session.log`
  - `sdk.session.instructions.entry.put` → `sdk.experimental.session.instructions.entry.put`
  - `sdk.mcp.add` / `connect` / `disconnect` → `sdk.experimental.mcp.add` / `connect` / `disconnect`
- Migrated wire type in `packages/opencode/src/opencode-v2-types.ts`:
  - `McpAddInput` → `ExperimentalMcpAddInput`

## 4. Required changes

| Upstream change | SuperOne change |
|---|---|
| Pin bump | Update `@opencode/client` to `2.3.2` in `packages/opencode/package.json` and `apps/desktop/package.json` and refresh `bun.lock` |
| Deprecated routes | Move `session.log`, `session.instructions.entry.put`, and `mcp.add/connect/disconnect` calls to `sdk.experimental.*` |
| Deprecated types | Switch `OpenCodeV2McpConfig` to `ExperimentalMcpAddInput['config']` |

## 5. Adopted capabilities

- [PLANNED] Landed: `@opencode/client` `2.3.2` pin and `experimental.*` route/type migration.
- [DEFERRED] `experimental.usage.limits`, `withMediaRefs` / `experimental.media.get`, `event.subscribe` type filtering, `permission.saved.update`.

## 6. Verification

- `bun run typecheck:node` and `bunx tsc --noEmit -p packages/opencode/tsconfig.json` passed after all edits.
- `packages/opencode` unit tests (`bunx vitest run packages/opencode/src/ --exclude "**/*-live.test.ts"`): 14 files, 44 tests passed.
- Desktop OpenCode unit tests (`cd apps/desktop && bunx vitest run src/main/opencode/ src/main/session/backends/opencode-backend.test.ts --exclude "**/*-live.test.ts"`): 14 files, 161 tests passed.
- Not verified live: end-to-end execution against a live `opencode` 2.3.x CLI binary.

## 7. Follow-ups

Evaluate `experimental.usage.limits` and `withMediaRefs` in `docs/harness/opencode/backlog.md` when ready to wire usage limits and media refs.
