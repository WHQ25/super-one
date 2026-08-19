# SuperOne UI Plugin System — Design Notes (Draft)

Status: **design only, not implemented.** Written 2026-08-19 after reading
dsh's `@deepseek-ai/dsh-client-ui-slots` (1192-line core + `web-react`
renderer). Implementation is deliberately deferred; the dsh *host*-side
runtime plugin work proceeds independently and does not depend on this.

## 1. Why

Two problems meet at the same mechanism.

**The internal one, today.** `apps/desktop/src/renderer/src/components/chat/ToolBlock.tsx`
is 2360 lines of `toolName === 'Bash'` / `=== 'Edit'` / `=== 'AskUserQuestion'`
dispatch, in a directory holding 356 files. Every new tool with a bespoke view
widens one file that is already five times over this repo's own 500-line
refactor threshold. A keyed registry is the standard answer, and we would want
one even with no plugins in the picture.

**The external one, later.** Third-party UI for agent surfaces. dsh has an
ecosystem shape for this (`dsh-client-ui-*`), but it is bound to *dsh's own
browser client* — its slots are declared by `dsh-client-ui-conversation`, which
is an entire chat interface. Adopting it would mean dsh sessions wear dsh's UI,
forfeiting the cross-harness uniformity that is SuperOne's reason to exist.

The resolution is that **SuperOne is a peer UI runtime client**, not a consumer
of dsh's. dsh's architecture is Host ↔ api-contracts ↔ Client; `dsh-client-*` is
one client implementation and SuperOne is another (one that skips the wire and
reads `session/event` in-process). So SuperOne gets its *own* slot vocabulary,
keyed off its own `AgentEvent` model — which makes every plugin written against
it automatically cross-harness: one tool renderer serves Claude, Codex, ACP,
OpenCode, Cursor and dsh alike.

**Order of value:** the refactor pays for itself before any plugin exists. Ship
the registry as an internal mechanism, let the built-in renderers be its first
registrants, and plugin loading becomes a later, additive concern.

## 2. What we took from dsh's `ui-slots`

Six ideas worth copying, and the reasoning behind each.

### 2.1 The slot map is an empty interface grown by declaration merging

```ts
export interface SlotMap {}   // ui-slots/src/index.ts:24
```

Each package adds its keys through `declare module`. Cross-package type safety
with **no central registry file** — adding a slot never edits the core. This is
the same trick `SessionEventMap` uses on the dsh host side, and the same reason
it works there: the compiler assembles the union, so nobody owns the list.

### 2.2 Declaration = render authorization = runtime spec, one table

`register({ name, children, store, inject, ...kind }, Component)` contributes a
component *and* declares its child slots in one call. Consequences:

- A component may only render child slots it declared (`SlotOwnershipError` is
  the plain-JS backstop; typed callers are narrowed statically).
- Disposing an entry **recursively collapses** its declared child slots — ledger
  rows, contributions and store mounts die on one lifecycle axis.

One table means the authorization question ("may this component render that
slot?") and the lifecycle question ("what dies with it?") have the same answer,
so they cannot drift.

### 2.3 The core is React-free and framework-free

The only currency at the boundary is:

```ts
interface HostObservable<T> { getSnapshot(): T; subscribe(fn: () => void): () => void }
```

`useSyncExternalStore` binding happens in the *renderer*, not the registry.
dsh's own words: "Engine products and the renderer host contract carry bare
snapshot sources, never React hooks — hook binding belongs to the render
machinery." This is what makes the core unit-testable without a DOM, and it is
the single most transferable decision in the whole design.

### 2.4 Four slot kinds, and `chain` is the interesting one

| kind | dispatch |
|---|---|
| `single` | one occupant |
| `list` | ordered, all render (`order`) |
| `keyed` | dispatch site supplies `entryKey` — tool name, panel id |
| `chain` | **entries self-nominate** |

A chain registration carries a pure `select(owner) => M \| null`. The first
non-null return elects that entry and becomes its `matched` prop; ties break by
ascending `priority`, then registration order; all-null falls back to the
owner's `renderSlotChain` fallback.

The dispatch site therefore **does not need to know who exists**. For "render
this message content block", where candidates match on payload shape rather than
on a name, this is strictly better than a keyed map.

### 2.5 Crash abdication turns error boundaries into a fallback chain

A cell may hold several candidates; the render read is "first live,
non-abdicated entry in priority order". On a render crash,
`reportEntryError(key, entry, error, { abdicate: true })` retires that entry from
the cell — one-shot — and **the next candidate renders instead**. The
registration stays on the ledger; only its claim on that cell is dropped.

A third-party renderer that throws degrades to the built-in generic card rather
than blanking the message. That property is what makes third-party UI tolerable
at all.

### 2.6 Validate at registration, fail loud

Undeclared-slot registration, duplicate child declaration, one shared store
handle under two scopes, a chain registration without `select` — all throw at
`register`. Plus `StaleAuthorizationError` at call time, when a retained
`renderSlot` closure is invoked after its declaring entry was disposed.

Two smaller details worth keeping:

- **Locale derives `t` from `(namespace, revision)`.** A locale switch hands out
  *new function references*, so memoized components re-render naturally with no
  manual invalidation anywhere.
- **The per-session standard kit publishes through one atomic source.** Current
  selection and provider roster move together, so a stable session id can never
  strand mounted entries on an obsolete hook/prop schema.

### 2.7 What we are NOT taking

- **The four-share `ComposedProps` intersection** (`PropsRuntime` ∩
  `PropsRenderSlots` ∩ `PropsStore` ∩ business `inject`). Powerful, but it is a
  large type-level construction whose payoff scales with ecosystem size. Start
  with runtime + child-render shares; add the rest when a real plugin needs it.
- **`defineStore` / store seats.** SuperOne already has Zustand. A second state
  mechanism inside the slot system would be two ways to say one thing. See §5.
- **`ctx.slots.inject` declaration injection.** It exists to decouple a
  contributor's plugin lifecycle from its declarer's under Cordis fiber rules.
  We have no Cordis in the renderer; revisit only if P3 loading needs it.

## 3. The SuperOne slot map (first cut)

Keys are named for SuperOne's own surfaces and keyed off SuperOne's
`AgentEvent` model — never off any harness's wire vocabulary. That is what makes
a plugin cross-harness.

| key | kind | scope | purpose |
|---|---|---|---|
| `chat.tool.view` | keyed (tool name) | session | tool block body — the ToolBlock.tsx replacement |
| `chat.message.block` | chain | session | message content blocks nominating on payload shape |
| `chat.composer.dock` | list | session | docked strips above the input (todo plan, queued rows) |
| `chat.statusbar.item` | list | session | status bar entries |
| `session.view` | list | session | session view tabs (chat, trajectory, …) |
| `sidebar.section` | list | root | sidebar sections |
| `activity.panel` | keyed | root | Activity dockview panels |
| `settings.tab` | list | root | settings pages |

`scope` mirrors dsh's `root | session-maybe | session`: it decides which
standard kit a component receives, and (for `session`) what a re-created scope
invalidates.

## 4. Bootstrapping: the built-ins register first

The migration is the proof. `chat.tool.view` opens first, and every existing
bespoke view — `BashTerminalView`, `EditDiff`, `AskUserQuestionPrompt`,
`BrowserToolBlock`, `ComputerUseToolBlock`, `ImageGenToolBlock`, … — becomes a
registration rather than a branch in a 2360-line switch. If the design cannot
express what those already do, it is not ready for third parties.

Expected fallout, in the good sense: `ToolBlock.tsx` stops growing per tool, and
`isHiddenToolBlock`-style implicit contracts (see the image-gallery note in
memory) become explicit slot occupancy.

## 5. Boundary with Zustand

The slot registry owns **what renders where and for how long**. It owns no
application state. Components reach existing stores exactly as today.

The one rule: a slot component must not subscribe to a store during render in a
way that outlives its entry. Entry disposal collapses the subtree; a subscription
that survives it is the same stale-authorization bug `StaleAuthorizationError`
guards on the render side.

## 6. Phasing

| phase | content | gate |
|---|---|---|
| P1 | slot core (no React, unit-tested: register, declaration collapse, abdication, validation) + React renderer + `chat.tool.view` only; migrate ToolBlock | internal refactor, no plugin surface |
| P2 | `chat.message.block`, `chat.composer.dock`, `chat.statusbar.item`, `session.view` | still internal |
| P3 | plugin loading + trust | needs §7 decided |
| P4 | author-facing type package (`declare module` half), docs, examples | needs a real third-party author |

P1 and P2 are pure refactors and carry no security surface at all.

## 7. Trust — the thing to decide before P3

A UI plugin runs **inside the renderer with full React privileges**: it can read
every Zustand store and issue IPC. This is the *opposite* trust model from
mini-apps, which are sandboxed iframes with a mediated bridge. dsh has the same
property (its client plugins are ordinary npm packages).

So installing a UI plugin is closer to installing a VS Code extension than to
opening a web page, and it must be presented that way. Nothing in P1/P2 touches
this; P3 cannot start without an answer.

## 8. Relationship to the dsh integration

**Fully decoupled, deliberately.** The dsh integration consumes the community's
*host*-side ecosystem (tools, model adapters, executors, skills, workflows) via
runtime plugin installation. UI goes through this system instead, and serves
every harness. Neither track blocks the other.

A consequence worth stating plainly: an existing third-party `dsh-client-ui-*`
package **will not run in SuperOne**, and is not meant to. Its author would
write a SuperOne slot registration instead — for a larger audience, since it
would then serve every harness rather than dsh alone.

## 9. Open questions

1. **Do slot components get `t` (i18n) as a standard prop**, and does SuperOne's
   i18n support the `(namespace, revision)` derivation that makes locale
   switching automatic? Worth checking `@superone/shared/i18n` before P1.
2. **Does `chat.tool.view` key on the canonical tool name** (the mapper's
   `Read`/`Bash`/`Edit`) or the raw per-harness name? Canonical is the
   cross-harness answer, but it makes the mapper's rename table part of the
   plugin contract.
3. **Where does the mosaic per-pane brand scope sit** relative to slot scopes?
   Panes already re-declare `.brand-scope`; a session-scoped slot inside a pane
   must inherit the pane's scope, not the active session's.
