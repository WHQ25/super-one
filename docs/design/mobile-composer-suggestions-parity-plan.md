# Mobile composer suggestions parity plan

Status: revision 2, 2026-09-07. Revised after a code-verified review by a Codex
reviewer session; every correction below was re-verified against the source
before being folded in.

Scope: bring the mobile `/` (slash command) and `@` (mention) overlays to
**suggestion-discovery parity** with the desktop `ChatInput` popups, and give
both a preview page and a UI test that can reach the states a healthy session
never reaches.

The title is deliberately narrower than "full parity". Stateful slash surfaces,
hardware-keyboard navigation and command *actions* that open panels are explicit
non-goals — see §7.

## 1. Current state

### Desktop (the reference)

| Concern | Module |
|---|---|
| Slash filter + rank + group | `apps/desktop/src/renderer/src/components/chat/chat-input/computeMatchingSlashCommands.ts` |
| Fuzzy scorer | `apps/desktop/src/renderer/src/lib/fuzzy-match.ts` |
| Group → flat index space | `apps/desktop/src/renderer/src/components/chat/popup-groups.tsx` |
| Built-in mention ranking | `apps/desktop/src/renderer/src/components/chat/mention-capability-match.ts` |
| `@session` grammar + paging | `apps/desktop/src/renderer/src/components/chat/session-mention-query.ts` |
| Mention popup render | `apps/desktop/src/renderer/src/components/chat/MentionPopup.tsx` |
| Slash popup render | `ChatInput.tsx` ~1787–1850 |

### Mobile (today)

| Concern | Module |
|---|---|
| Slash filter | `apps/mobile/src/slash.ts` |
| Mention query / insert / parse | `apps/mobile/src/mentions.ts` |
| Capability merge | `apps/mobile/src/composer-state.ts` |
| Search orchestration | `apps/mobile/src/navigation/use-composer-suggestions.ts` |
| Both overlays' render | `apps/mobile/src/ui/composer-suggestions.tsx` |
| Native chip selection | `apps/mobile/src/mention-selection.ts` |
| Host RPC | `apps/mobile/src/mention-search.ts` |

### Correction to revision 1

Revision 1 claimed mobile "has no grouping layer, and that is the root cause of
every ordering divergence". **That is wrong.** Mobile groups in the renderer:
`composer-suggestions.tsx:42` hard-codes Commands-then-Skills,
`composer-suggestions.tsx:89` hard-codes the mention group order. What is missing
is a *shared grouping contract* and a *flat navigable order*, not grouping as
such.

The practical consequence: **swapping in a shared matcher does not close S1.**
The renderer would still put Skills after Commands regardless of score.
Divergence has four independent sources — catalog, match, mode, render — and a
gap is only closed when all four agree.

`fuzzyMatch` in `slash.ts` is behaviourally identical to `lib/fuzzy-match.ts`.
But the *call contracts* differ: desktop lowercases the query before scoring
(`computeMatchingSlashCommands.ts:60`), mobile passes it raw (`slash.ts:99`).
Identical helpers do not make identical callers — this is why Phase 1 below is
scoped to helper extraction only.

## 2. Gap inventory

### Slash

| # | Gap | Verified detail |
|---|---|---|
| S1 | Group ranking | Desktop `rankAndGroup` puts the group holding the best score first (`computeMatchingSlashCommands.ts:22`); mobile fixes Commands-then-Skills in the renderer (`composer-suggestions.tsx:42`). Closing this needs matcher **and** renderer. |
| S2 | Multi-line drafts | Desktop matches on the first line (`:51`); mobile bails on any whitespace (`slash.ts:98`). **Blocked by S10 — do not relax without it.** |
| S3 | Codex commands with spaces | Desktop exempts Codex from the space bail and from hiding `debug`/`keybindings-help` (`:53`); mobile has no provider awareness (`slash.ts:102`). |
| S4 | Caret position | Desktop opens whenever the draft starts with `/`; mobile also requires a collapsed caret at end of text (`use-composer-suggestions.ts:41`). |
| S5 | Dismiss / re-arm | **Corrected:** desktop clears `slashDismissed` on *every* non-programmatic edit and keeps it set after a programmatic content set (`ChatInput.tsx:1519–1524`) — not "re-arms on the next `/`". Mobile has no dismiss at all. |
| S6 | Catalog readiness | **Corrected:** mobile has no "no commands" empty state — the whole overlay unmounts (`composer-suggestions.tsx:40`). Beyond the missing spinner, the catalog is written once at `runtime.ts:204` and the hook only recomputes on text/caret change (`use-composer-suggestions.ts:41`), so there is no readiness subscription. |
| S7 | `slash_command_output` | **Corrected and enlarged.** The host drops the event before the wire: it is in `SKIPPED_EVENTS` (`apps/desktop/src/main/remote-control-service.ts:47`). `@superone/chat-core` already reduces it (`packages/chat-core/src/slash.ts:227`) and mobile uses that reducer (`runtime.ts:472`) — but mobile never sets `_pendingSlashCommand`, so simply un-skipping the event yields `Command / executed.` and mis-routes the compact/report branches. This needs a closed loop: transport → command association → reduction → presentation → clear/restore. |
| S8 | Stateful surfaces **and command actions** | **Enlarged.** Not only `/mcp` and `/workflow(s)`: Cursor commands expand a `promptBody` on select (`ChatInput.tsx:601`) and Codex `/plan` / `/review` switch mode or open a panel rather than inserting text (`ChatInput.tsx:633`). Mobile's `parseSlashCommand` (`slash.ts:61`) drops `promptBody` and `onSelect` only carries a name. |
| S9 | **New — no catalog before a session exists** | `use-composer-suggestions.ts:42` reads `runtime?.slashCommands` only; the idle branch handles mentions alone (`:49`). The new-session landing has no slash suggestions at all. |
| S10 | **New — command select destroys the draft** | Desktop uses `replaceFirstLineWith` (`ChatInput.tsx:649`). Mobile calls `replaceText` (`mobile-app.tsx:1251`), which in the native editor replaces `start: 0 … end: text.length` and clears all tokens (`native-composer-input.tsx:49`); the fallback overwrites the whole draft. Today this is masked because S2/S4 keep the overlay closed whenever the draft has whitespace. **Relaxing S2 or S4 without a first-line-scoped transaction opens a data-loss path, including chip loss.** |

### Mention

| # | Gap | Verified detail |
|---|---|---|
| M1 | Directory browsing | Desktop browse mode + `listDirectory` + Tab drill + breadcrumbs (`MentionPopup.tsx:298`); mobile is search-only (`use-composer-suggestions.ts:35`). The `dir-entry` branches in `mentions.ts` and `mention-selection.ts` exist but have no producer. |
| M2 | `@session` portal | Desktop three-phase grammar with paged loading; mobile has none. Also blocked by `extractMentionQuery` rejecting spaces. **`search_sessions` cannot back it** — see D7. |
| M3 | Match highlighting | **Narrowed.** `parseMentionItems` (`mentions.ts:44`) does drop `matchIndices`, but host app rows never carry them (`remote-mention-search.ts:54,60`), capability/agent rows are matched locally, and file indices are over the **full path** while mobile renders the basename (`composer-suggestions.tsx:98`) — desktop remaps both under a scope (`MentionPopup.tsx:784`). Browse rows have no query to highlight. So: remap, do not forward blindly. |
| M4 | Built-in ranking | **Narrowed.** `@co` preferring Codex is *within* the agent-profile group (`MentionPopup.tsx:589`), and capabilities still sort before agent profiles (`:176`). Empty query keeps catalog order (`:608`, `:672`). Apply the rank inside each group, not globally, and skip the tie-breaker on empty query. |
| M5 | Disabled capabilities | Desktop keeps them visible but unselectable (`MentionPopup.tsx:649`); mobile filters them out (`composer-state.ts:17`). |
| M6 | Group order | Desktop `capability → agent-profile → session-project → session → desktop-app → agent → miniapp → file` (`:176`); mobile `Agents → Capabilities → Sessions → Apps → Files & folders → Other`, with merged groups. |
| M7 | Additional dirs / scope | `search_mentions` carries neither (`agent-types.ts:4405`). |
| M8 | Keyboard navigation | **Cut — see §7 and D4.** |
| M9 | Empty states | Desktop varies by mode; mobile shows one `No matches`. Cannot be fully closed before M1/M2 exist. |
| M10 | **New — empty `@` floods with apps** | Desktop requires a non-empty query before matching installed apps (`MentionPopup.tsx:729`); `matchesRemoteMentionApp` returns `true` for an empty needle and the host returns up to 12 app rows each (`remote-mention-search.ts:15,56`). Desktop also fuzzy-matches where the host substring-matches. |
| M11 | **New — no debounce or dedup** | Desktop debounces file search 150 ms (`MentionPopup.tsx:443`); mobile fires an RPC on every text *and* selection change (`use-composer-suggestions.ts:35`), and each host call re-discovers apps and decodes icons (`remote-mention-search.ts:39`). |
| M12 | **New — multi-root identity dropped** | The host returns `rootPath` for multi-root results (`packages/runtime/src/fs/fuzzy.ts:102`); `parseMentionItems` discards it and dedup keys on `kind:path` only (`composer-state.ts:24`). Enabling `additionalDirs` without a root identity produces collisions. |
| M13 | **New — the two editors serialize differently** | The fallback path ends in `changeText` and flattens to plain text (`composer-draft-state.ts:13`); the native path serializes typed tags (`mention-document.ts:99`). A fallback `@<sessionId>` is not the native `superone-session` tag. Session and directory selection must define the fallback's sendable semantics, and tests must assert the **sent payload**, not pixels. |
| M14 | **New — cwd identity** | `search_mentions` resolves against the host's active-session `cwd` (`agent-service.ts:1028`) and the request carries no `sessionId`. Browsing from the project root would point at a different checkout inside a worktree session. Browse, search and insert must all resolve against one root. |

### Preview / UI test

| # | Gap |
|---|---|
| P1 | `ShellPreview.tsx:325` passes `slashHits={[]}` and `:328` an empty `onSlash` — the slash overlay cannot render in the preview. |
| P2 | No preview page for the overlay states. (A mention fixture at `ShellPreview.tsx:201` and the `Chip editor` page do exist; this is a gap, not a blank slate.) |
| P3 | No slash or mention Maestro flow. |
| P4 | `vitest.config.ts:5` includes `src/**/*.test.ts` only; no RNTL. |

## 3. Design decisions

**D1 — Share the pure layer, scoped tightly.** Move to `packages/shared` as leaf
modules: the fuzzy scorer, `matchBuiltinMention` / `compareBuiltinMentionMatches`,
generic `groupItems`, and the `@session` *grammar* (parse / scope / choices /
title match / hint). Share semantics and algorithms; leave group order,
interaction and localisation to each app's adapter. Desktop keeps re-export
shims. No DOM, store, or `window.environment` adapter enters shared.

Note `groupItems` silently drops keys absent from `order`
(`popup-groups.tsx:14`); the mobile adapter must handle unknown kinds explicitly
or rows will vanish after the move.

**D2 — Slash matcher core is shared; popup ownership is not.** Move the
filter/rank core keyed on `HarnessId`. Leave "is this an args-mode line" and
"which popup owns this" in each app — the workflow predicate is not load-bearing
for mobile, since non-Codex lines with a space bail anyway
(`computeMatchingSlashCommands.ts:57`).

**D3 — A small derived-mode module on mobile, not a full reducer.**
`deriveMode(query, context) → { mode: 'search' | 'browse' | 'session', scopeDir,
sessionPhase }` as a pure function; store only what cannot be derived. The action
type must distinguish `navigate(query)` from `select(resource)` explicitly —
kind alone cannot express "enter this folder" versus "insert this folder".
Pure tests do not replace editor-ACK tests.

**D4 — Hardware-keyboard navigation is cut.** RN `onKeyPress` is soft-keyboard
only on Android (`react-native/Libraries/Components/TextInput/TextInput.d.ts:895`,
and the [official docs](https://reactnative.dev/docs/textinput#onkeypress)), the
`Keyboard` module exposes no physical-keyboard signal, and the production input
is not an RN `TextInput` at all — it is a custom Expo view whose module emits
only `onDocumentChange` / `onContentHeightChange` / `onSubmit`
(`modules/mention-editor/ios/MentionEditorModule.swift:7`). Real support means a
Swift/Kotlin key bridge with Enter-priority and IME handling. That is its own
project, not a trailing phase.

**D5 — Capability negotiation, not a post-filter.** An older host runs a global
top-20 search and returns it (`remote-mention-search.ts:72`); the in-scope
results may already have been ranked out, so client filtering cannot reconstruct
them, and `additionalDirs` cannot be synthesised at all. Add `scopeDir` /
`additionalDirs` to `search_mentions` **and** have the response echo which
options it applied. When the echo is absent, fall back to `list_directory`'s
known direct children — an honestly limited result, not a truncated one
presented as scoped. Keep a segment-aware, root-aware post-filter as defence
(never a bare `startsWith`, or `src` matches `src-old`).

**D6 — Mirror `EXCLUDED_DIRS`, plus an opt-in host-side gitignore layer.**
Desktop's directory listing filters only a fixed `EXCLUDED_DIRS` set
(`agent-service.ts:2469`) and never reads `.gitignore`; the *search* path
respects `.gitignore` but deliberately re-adds current-directory entries
(`fuzzy-file-search.ts:105,220`).

Baseline: pass `showHidden: true` and mirror `EXCLUDED_DIRS`. That set already
covers `node_modules`, `dist`, `build`, `.next`, `.cache` and friends
(`packages/runtime/src/fs/list-files.ts:6`), so it carries most of the value on
its own. It currently lives in `@superone/runtime` (a Node package Metro cannot
import), so the **data** moves to a leaf `@superone/shared` module that runtime
re-imports — a DRY fix, not a copy.

On top of that, mention browsing asks the host to apply `.gitignore`, via a
narrow `ignoreMode: 'excluded-dirs' | 'gitignore'` on the browse request (the
host already has both the file and the `ignore` package). **This is a
deliberate, user-approved mobile-only divergence from desktop browse**, on the
grounds that a phone has no keyboard to type past project-specific noise. It is
documented here so a later reader does not "fix" it back to desktop behaviour.
The incremental effect over the baseline is small — project-local ignores such
as `coverage/` and generated output.

**D7 — The session portal pages over `list_sessions`, not `search_sessions`.**
`search_sessions` is a global SQL title `LIKE`, capped at 200, with no offset and
no project scope (`db-sessions.ts:464`, `agent-types.ts:4389`). Desktop's loader
scans per project with fuzzy filtering and early stop
(`session-mention-query.ts:305,323`). The injected loader interface is
`listProjectPage(projectKey, limit, offset)` over the existing `list_sessions`
(`agent-types.ts:4385`), with a cancellation token and a scan budget. Desktop's
own adapter goes through `window.environment` (`lib/session-list-ops.ts:4`), not
`window.agent`.

**D8 — Do not freeze desktop's parser ambiguities into a shared contract.** The
grammar splits the project token on the first whitespace and picks the first
label-exact match (`session-mention-query.ts:136,237`), which is ambiguous for
project names containing spaces, duplicate leaf names, and a project literally
named `all`. Ship the shared grammar with tests that pin the current behaviour
and a `TODO` naming the fix (stable `projectKey` selection or quoting).

## 4. Phases

Reordered so each commit leaves the app strictly better. The rule: **a gap is
closed only when catalog, match, mode and render all agree** — no phase claims a
gap it can only half-close.

| # | Phase | Contents | Closes |
|---|---|---|---|
| 1 | Preview + test scaffolding | Preview route + injectable fixture skeleton; `ShellPreview` feeds real `slashHits` / `onSlash`; a preview toggle between the **native** and **fallback** editors; RNTL + `*.test.tsx` wired into `vitest.config.ts` with one real component test per overlay. Covers only states that exist today. | P1, P3 (partial), P4 |
| 2 | Helper extraction | Move the identical helpers (D1/D2 core, D8 grammar) into shared with tests; desktop shims. **Mobile keeps its current behaviour** — no call-contract switch here. | — (enabling) |
| 3 | Slash closed loop | S9 idle catalog + S6 readiness/loading/empty + provider awareness (S3) + shared matcher and renderer order together (S1) + **first-line-scoped edit transaction (S10)**, and only then S2/S4 + dismiss (S5). Preview states and Maestro flow land with it. | S1–S6, S9, S10 |
| 4 | Mention row model | M3 (with index remapping), M4 (within-group), M5, M6, M10, M11, plus the M9 states reachable today. | M3–M6, M9 (partial), M10, M11 |
| 5 | Directory browsing | `deriveMode` (D3) + `list_directory` producer + `EXCLUDED_DIRS` move to shared + `ignoreMode` gitignore layer (D6) + root identity (M14, M12) + **scoped search protocol (D5, M7)** + both editors' navigate/select transactions (M13). | M1, M7, M12, M14 |
| 6 | Session portal | Shared grammar + `listProjectPage` loader (D7) + spaces in the title phase + paging + per-phase empty states + both editors' selection and serialisation. | M2, M9 (rest), M13 |
| 7 | `slash_command_output` | Standalone end-to-end: un-skip on the host, associate the command name on mobile, reduce, present, clear/restore. | S7 |
| 8 | `/mcp` read-only sheet | Separate, small. | S8 (partial) |
| 9 | `/workflow` + `/workflows` | User decision, against the reviewer's advice. Ships last because it is the largest surface with the least discovery value: a runs list for `/workflows`, and an argument builder for `/workflow` sized for a phone. A launcher that runs a workflow is **not** read-only, so it needs a confirm step and a clear permission story before it can appear in the catalog. | S8 (rest) |

Phase 5 cannot defer the scoped-search protocol to a later phase: the first
character typed after entering `@src/` needs it.

## 4a. Implementation log

**Phase 1 — done (2026-09-07).**

- Component tests run on **jest-expo**, not vitest. Vitest was attempted first
  and fails at React Native's lazy `require()` boundary (see §6). The mobile
  workspace now has two runners: `bun run test` runs both, `test:components`
  runs jest alone. 12 component tests over `SlashSuggestions` and
  `MentionSuggestions` cover grouping, counts, argument hints, the basename
  fallback, which callback a tap fires, and the loading / error+retry / no-match
  / closed branches.
- Two footguns hit on the way, both recorded in `apps/mobile/CLAUDE.md`: RNTL 14's
  `render` is **async**, and bun leaves a nested `apps/mobile/node_modules/react`
  beside the hoisted root copy, which gives hooks a null dispatcher until
  `jest.config.js` maps `^react$` to one of them.
- `ShellPreview` now feeds `slashHits` from the real `filterSlashCommands` over
  `previewSlashCatalog` and `onSlash` completes the draft — P1 closed.
- New `Composer suggestions` preview page (`ComposerSuggestionsGallery`) walks
  every overlay state through the shipping components.
- The preview chat page gained an **Editor: native / Editor: fallback** toggle,
  and mention hits are now computed for both paths. This is the R1 mitigation:
  before it, the preview could only ever exercise the native editor.
- Maestro flows `composer-suggestions.yaml` (gallery) and `composer-slash.yaml`
  (wiring, both editors). **Both pass on iOS in light and dark**; the full
  18-flow suite passes too. Getting there required building the Expo dev client
  (`expo run:ios`), which had never been built on this machine.
- The fallback toggle earned its keep on its first run: `composer-slash.yaml`
  caught that the preview's `onSlash` only handled the native branch, so with the
  fallback editor mounted the draft never changed and the overlay stayed open.
  That is precisely the R1 failure mode, found by the thing built to find it.
- `previewSlashCatalog` gained `create-release-notes` so that `/rel` scores the
  `release` **skill** above every command. Mobile still renders Commands first,
  which makes the S1 gap visible in the preview today and will prove the fix in
  Phase 3.

**Phase 2 — done (2026-09-07).** Five leaf modules now live in
`packages/shared`, desktop reaches them through shims, and **no behaviour
changed on either side**.

| Shared module | Desktop | Mobile |
|---|---|---|
| `fuzzy-match` | `lib/fuzzy-match.ts` re-exports (8 import sites untouched) | `slash.ts` deleted its byte-identical copy; `add-project-state` and `project-picker-state` now import it from its real home instead of from the slash module |
| `mention-capability-match` | shim | not yet consumed (Phase 4) |
| `popup-groups` | `popup-groups.tsx` re-exports `groupItems`, keeps `PopupSectionHeader` | not yet consumed (Phase 4) |
| `session-mention-query` | shim binds the `window.environment` loader | not yet consumed (Phase 6) |
| `slash-command-match` | `computeMatchingSlashCommands` shrank to policy + one call | not yet consumed (Phase 3) |

Three decisions worth recording:

- **The session loader is shared, the fetch is injected.** The scan/filter
  algorithm is app-agnostic; only the page fetch differs. The injected
  `SessionMentionPageLoader` returns `{ sessions, hasMore }` so a backend that
  knows the total does not have to fake a full page to say "keep going" — the
  old code inferred `hasMore` from `length >= limit`. That is the one shape
  change, and Phase 6 depends on it.
- **Mobile did not adopt the shared slash matcher.** Its call contract still
  differs (raw vs lowercased query, which changes the exact-case scoring bonus),
  and adopting it here would have been the behaviour change this phase promised
  not to make. Phase 3 flips it.
- **The grammar's ambiguities were pinned, not fixed.** Scope resolution matches
  on display label, so duplicate leaf names, labels containing a space and a
  project named `all` are all ambiguous. Documented at the call site with the
  fix deferred to the popup that would offer the disambiguation.

Verification: desktop `vitest related` over the five changed files — 167 files,
2312 tests, green. Mobile 336 + 12, green. Full-workspace typecheck clean apart
from a **pre-existing** failure in `packages/relay-client/src/presence.test.ts`
(four `TS2493` tuple-index errors, present on a clean tree, introduced by
`63c2e1c0`); not touched here.

**Phase 3 — not started.**

## 5. Risks, reordered

- **R1 (was R4) — the two editors are two products, not one with a fallback.**
  They already differ in what they send: fallback flattens to text
  (`composer-draft-state.ts:13`), native serialises typed tags
  (`mention-document.ts:99`). The native path is transactional — a command is
  issued, and the editor may reject it (`native-composer-input.tsx:31,58`). A tap
  must not advance the browse state when the editor rejected the replacement.
  Acceptance must assert the **sent payload** on both paths, and cover typing
  races, double taps, IME composition, selection preservation, session switch and
  remount.
- **R2 — protocol compatibility.** Older hosts silently return unscoped, possibly
  truncated results (D5). Detect, do not paper over.
- **R3 — root identity.** Worktree sessions resolve `search_mentions` against the
  session cwd; browse must not use the project root (M14).
- **R4 — unbounded work.** Session scan has no upper bound; the mention list is a
  `ScrollView` that mounts everything; the host re-decodes app icons per
  keystroke (M11).
- **R5 — shared-package blast radius.** Real but narrower than revision 1 claimed:
  shared tests are already in the desktop vitest `include`
  (`apps/desktop/vitest.config.ts:29`). Adding leaf modules does not endanger
  existing consumers; *changing* an existing helper's behaviour would. Gate on
  targeted pure tests, the shim's own tests, and typecheck + Metro resolution —
  **not** on a full desktop suite run, which the root `CLAUDE.md` reserves for an
  explicit human decision.
- **R6 — preview drift.** Every new state ships with its preview entry, in the
  same commit as the feature. Do not build a screenshot-only component twin.

## 6. Test strategy

- **Pure vitest** for grammar, ranking, grouping, `deriveMode`, path/root
  helpers, and the first-line edit transaction.
- **Maestro** for pixels and for the two-editor matrix, driven by preview URLs
  that jump straight to a state.
- **`@testing-library/react-native` is added** (user decision, overriding the
  reviewer's recommendation to defer). It covers the overlay components
  themselves: row rendering per group, disabled rows being unselectable,
  empty/loading/error branches, and which callback a tap fires. It explicitly
  does **not** cover the native editor ACK path — that stays with Maestro and
  payload assertions, because RNTL cannot reach Swift/Kotlin.

  **It runs on jest-expo, not vitest.** Vitest was tried first and does not
  work: React Native reaches its internals through lazy `require()` calls inside
  `react-native/index.js`, which escape Vite's ESM pipeline and land in Node as
  unparsable Flow source — `ssr.noExternal`, `server.deps.inline` and a
  per-file-group babel plugin all fail to intercept them. jest-expo reuses
  Metro's own transform. So the mobile workspace now has two runners by design:
  `*.test.ts` on vitest (fast, pure), `*.test.tsx` on jest. The footguns
  (async `render`, the duplicate React copy) are recorded in
  `apps/mobile/CLAUDE.md`.

## 7. Explicit non-goals

Stated so "parity" is not read as a promise:

- **Hardware-keyboard navigation and the footer legend (D4)** — the only cut the
  user accepted. RN cannot deliver physical key events to the custom native
  editor without a Swift/Kotlin bridge, which is its own project.
- Command actions that open a desktop panel or switch mode (Codex `/plan`,
  `/review`) and Cursor `promptBody` expansion — deferred to a follow-up, after
  the discovery surface lands. Tracked as the S8 remainder, not dropped.
- `/add-dir`, `/side`, mini-app iframe mention targets.

In scope by user decision, against the reviewer's recommendation: RNTL (§6),
`/workflow` + `/workflows` (Phase 9), and gitignore-aware browsing (D6).

## 8. Review trail

Revision 2 folds in a code-verified review. Every correction below was
independently re-verified against the source before adoption.

**Corrections adopted:** the grouping-layer claim (§1), S5 re-arm semantics, S6
scope, S7 layering, S8 scope, M3 index remapping, M4 within-group ranking, the D6
gitignore premise, and the `search_sessions` capability mismatch (D7).
**New gaps adopted:** S9, S10, M10–M14. **Phasing** reordered; **R4 promoted to
R1**; R1 demoted and corrected.

**Reviewer recommendations the user overrode**, kept in scope with the reviewer's
objection recorded so the trade-off stays visible: adding RNTL (§6), shipping
`/workflow` + `/workflows` (Phase 9), and gitignore-aware browsing (D6). Only the
hardware-keyboard cut (D4) was accepted — and that one rests on a platform fact,
not a preference.
