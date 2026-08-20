# chat-core extraction spike (WP-01 / 0.5)

Status: **recorded** — 2026-08-14  
Plan: `docs/design/flutter-to-expo-migration-plan.md` C0.5 / WP-01  
Scope: invert `../index` back-edges in `event-reducer`. **No package cutover.**

---

## Verdict

`applyEventToSession` (~1.9k LOC) **can** drop the Zustand barrel without dragging slices.

| Gate | Result |
|------|--------|
| Invert `persistStreamingToolInput` / `markMessageEventApplied` / `DEFAULT_PROVIDER` | **done** — live in `event-reducer/transformers.ts`; `index.ts` re-exports |
| ≥1 family builds clean of `../index`, `@/components`, `window`, module Maps | **lifecycle** |
| Full reducer free of `@/components` / `window` / Maps / `Date.now` | **not this spike** — WP-11 |
| Production package `@superone/chat-core` | **not this spike** |

No narrow-family fallback was needed. Do **not** ship a half-package.

---

## What moved

| Symbol | Classification | Action |
|--------|----------------|--------|
| `persistStreamingToolInput` | Pure transformer | Moved out of `index.ts` |
| `markMessageEventApplied` | Pure transformer | Moved out of `index.ts` |
| `DEFAULT_PROVIDER` | Constant | Moved out of `index.ts` |

`index.ts` still re-exports all three so existing store consumers are unchanged.

---

## Impurity map (remaining — WP-11)

### Must relocate (pure, currently under `@/components`)

WP-11 is the **sole writer** for these predicate files.

| File | Import | Symbols |
|------|--------|---------|
| `content.ts` | `@/components/chat/media-generation` | `isMediaGenerateVideoTool`, `isMediaVideoStatusTool` |
| `tool.ts` | `@/components/chat/tool-display` | `extractPartialToolInput` |

`index.ts` (the store barrel, not the reducer) also imports `extractPartialToolInput` and `PERMISSION_MODES` from components. Out of WP-01 scope.

### Must inject as ports (real impurities)

```ts
export interface ChatCorePorts {
  now(): number
  id(prefix: string): string
  trace?(channel: string, name: string, payload: unknown): void
}
```

| Impurity | Where | Port |
|----------|-------|------|
| `Date.now()` → `lastEventAt` | lifecycle, content, tool, usage, codex | `now()` |
| `Date.now()` → generated ids | slash (`compact_`, `slash-debug-`, `slash-hint-`, insight ids) | `id()` / `now()` |
| `window.app.trace` | `tool.ts` `tool_input_delta` | `trace()` |
| `console.log` | `lifecycle.ts` `session_init` | drop or `trace()` |

Default desktop adapter: `now: () => Date.now()`, `trace: window.app?.trace`. Tests pass a frozen clock.

### Must not stay as module globals

`event-reducer/shared.ts`:

- `streamingToolInputRaw`
- `streamingPreviewLastUpdate`
- `streamingToolInputOwners`

These are session-scoped side state. WP-11: port-owned maps **or** fold into `ChatCoreSession` with a stable test API. Prefer a port. Existing `tool.test.ts` already treats them as a testable API (`clear` / `set` / `has`).

`_streamingToolInputPreviews` on `PerSessionState` is already state. The raw Maps are the leak.

### Must not import (already clean after this spike)

Reducer implementation files no longer import:

- `../index`
- `zustand`
- `../slices/*`
- `@/stores/*`

Enforced by `event-reducer/boundary.spike.test.ts`.

### Cycle still open (WP-11)

`defaults.ts` re-exports cache invalidators from `index.ts`. Creating a default session in tests still pulls the store barrel. Not a reducer import; still blocks a clean `chat-core` package until broken.

### `codex-helpers` (WP-11 / WP-12)

`upsertCodexItem` and token helpers in `helpers/codex-helpers.ts` are mixed with store-bound helpers (`ChatStore`, `getActivePerSession`). `codex.ts` already imports the pure `upsertCodexItem`. Split the file before package extract so boundary CI does not pull persistence.

---

## Family scorecard

| Family | `../index` | `@/components` | `window` | Maps | `Date.now` |
|--------|:---:|:---:|:---:|:---:|:---:|
| lifecycle | clean | clean | clean | clean | yes |
| content | clean | media-generation | — | reads Maps | yes |
| tool | clean | tool-display | trace | writes Maps | yes |
| usage / codex / slash | clean | — | — | — | yes |
| permission / question-plan / todos / message-complete | clean | — | — | — | — |
| ACP cases in `index.ts` | clean | — | — | — | — |

---

## What WP-11 must still do

1. Relocate media / tool-display predicates (sole writer).
2. Inject `ChatCorePorts` (`now`, `id`, `trace`); delete `window` / `console.log`.
3. Lift streaming Maps into a port or session-scoped test API.
4. Break `defaults.ts` ↔ `index.ts`.
5. Split pure vs store-bound `codex-helpers`.
6. Type `ChatCoreSession` / `ChatCorePatch` from WP-02; keep one `applyEventToSession`.

Do **not** fork the reducer or cut over mobile until remote-relevant families are complete.
