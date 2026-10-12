# Harness UI adapter registry

Status: in-progress (steps 0-2 done; branch `refactor/harness-ui-adapter`) · Updated: 2026-10-12
Goal: Desktop renderer chat surfaces resolve per-harness behavior through the shared static harness tables plus per-harness renderer controls and store strategies, so adding or changing a harness edits its own modules instead of `=== '<harnessId>'` branches across the composer, status bar and chat store.
Long-term docs affected: `.claude/skills/superone-harness/references/integration.md` and `experiences.md` (model, permission and slash checklists become "fill the harness modules"), `.claude/skills/superone-harness/references/new-harness.md` (P0 catalog table), `apps/desktop/docs/agent-reference/architecture.md` (new "Harness UI modules" section)

## Why

The renderer session client removed the local × remote multiplication. The
harness multiplication remains:

- 443 lines with a literal harness comparison (`===`/`!==`/`case` on
  `claude|codex|acp|opencode|cursor|dsh`) in 77 renderer files; 285 of them in
  `components/chat` and `stores/chat-store`. These are matching lines, not
  expressions. Baseline command under Verification.
- Two if-chain dispatchers pick six model selectors (`components/chat/ModelSelector.tsx`)
  and six permission selectors (`chat-status-bar/StatusBarPermission.tsx`);
  `HarnessPermissionPopover.tsx` and `useCollabLaunchModelSelector.tsx`
  (585 lines, 34 matching lines) re-implement the same choices for launch rows.
- Store code branches per harness for model/effort fields (`store-helpers.ts:48-53`,
  `side-chat.ts`, `agent-defaults.ts`, `persistence.ts:10-36`,
  `session-lifecycle.ts`, `event-slice.ts`), turn payloads (`session-turn.ts`),
  plan/permission cycling (`interaction.ts:371-429`), harness switching
  (`harness-selection.ts`) and send/slash policy (`send-message.ts`,
  `session-send-request.ts`, `ChatInput.tsx`).
- The harness skill already says "declare support through shared capability
  data" and calls everything outside `HarnessResourcesMap`/`SessionBackend`
  "a silent enumeration"; the code has not caught up.

## Starting point (verified 2026-10-12)

| Piece | State |
|---|---|
| `HARNESS_CAPABILITIES` (`packages/shared/src/harness/harness-capabilities.ts`) | Static flags per harness (`supportsMcp`, `supportsPlanMode`, `supportsQueuedSteer`, `supportsAdditionalDirs`, `supportsFork`, `goal`, `modUi`, `promptKeywords`, `displayName`, …). 8 renderer files read it. No model, effort, permission or slash data. |
| `HARNESS_LAUNCH_OPTIONS` (`packages/shared/src/launch-options.ts`) | Launch-row `permissionModes`/`sandboxModes` per harness; Codex/ACP/OpenCode/dsh have no sandbox modes. Used by `HarnessPermissionPopover`, `SessionDefaultsSection`, `sessionDefaultsForHarness`, desktop main and mobile. |
| Session defaults (`packages/shared/src/harness/session-defaults.ts:51-66`) | Configured mode if offered, else the first offered mode (dsh → `plan`). Launch rows instead fall back to `cursor ? 'agent' : 'default'` (`SessionAgentsConfirmPrompt.tsx:413`, `AutomationConfirmPrompt.tsx:251`). The two disagree for dsh today. |
| `harness-sandbox.ts` (shared) | Composer sandbox chip semantics: toggle for `claude`/`cursor`, `harnessSandboxModes` returns `off/on/auto` for every non-Cursor harness, plus coercion, support level and preset-derived chip. Not the same table as launch `sandboxModes`. |
| Permission presentation | Per-harness TSX lists in desktop (`PermissionModeList`, `CodexPermissionPresetList`, `AcpPermissionModeList`, `CursorPermissionModeList`, `deepseekPermissionModes.ts`). Codex session offers four presets (read-only, default, auto-review, full access; `CodexPermissionPresetList.tsx:18-63`); launch rows express three permission modes. Mobile generates `permission-modes.generated.json` from the desktop lists; its dsh entries are hand-written preset copy (`apps/mobile/scripts/generate-permission-modes.ts:31-36`). |
| Resource registry | `HarnessHandlerMap` (`stores/chat-store/harness/harness-handler.ts`, instances `stores/chat-store/index.ts:352-378`) — mapped type over `HarnessId`, covers `connect`/`apply` of resource bundles only. |
| Model selector view | `GroupedModelEffortSelector.tsx` has a harness-neutral prop surface (`models`/`modelGroups`, `effortOptions`, `modes`, `agents`, `providers`, `optionParams`). All six composer selectors and the launch hook render it. ACP effort comes from `selectedAcpModeId` when the mode config is an effort (`AcpModelSelector.tsx:84-95`). |
| Launch rows | `useCollabLaunchModelSelector` takes `{ harnessId, profile, catalog: 'local' \| 'profile', … }` (`SessionAgentsConfirmPrompt.tsx:229-241`). ACP is served from profile models/efforts (`:379-385`, `:488-492`), not from the live ACP agent catalog. Remote launches read only the target profile. |
| Session fields | One DB column `selected_model`/`selected_effort`; the renderer splits Codex into `selectedCodexModel`/`selectedCodexReasoningEffort` with `*UserChosen` flags, and main's settings broadcast and golden fixtures carry those names. Manual pick sets the flag; default recomputation and late hydration must not overwrite a manual pick (`codex-slice.ts:50-51`, `persistence.ts:10-36`). |
| Send policy | `shouldQueueUserSend` (`session-send-request.ts:3-5`): OpenCode queues but has no steer; Codex queues only for runs, not control commands. Raw-send slash intercepts (`send-message.ts:457-489`) are a separate entry from the `ChatInput` popup selection. Cursor flips to streaming optimistically (`input-request-send.ts:36-56`). |
| Display labels | `BrandColorPopover` `HARNESS_LABEL` repeats base harness names. `MentionPopup.tsx:226-231` shows the ACP agent (Grok/ACP) and `HarnessPreferencePicker.tsx:303-307` uses localized copy ("Claude Code"). `ProviderLabel.tsx` is an API-provider brand registry, `OnboardingDiscover.tsx:81-85` uses SDK labels and `session-menu-items.ts:45-53` uses "Claude Code"/"Grok (ACP)"; those are different vocabularies. |
| Mobile | Consumes `RemoteSystemInfo` (built per harness in `main/agent/remote-harness-system-info.ts`) plus `HARNESS_LAUNCH_OPTIONS`/`HARNESS_CAPABILITIES`. |

## Design

```
packages/shared (static, serializable; desktop, mobile, main)
  HARNESS_CAPABILITIES   flags + displayName; later composer flags
                         (softCancel, busySlashAllowlist?, slashArgsInFilter, includeHiddenSlash)
  HARNESS_LAUNCH_OPTIONS { permissionModes, sandboxModes, defaultPermissionMode }

apps/desktop/src/renderer/src/harness-ui/<harnessId>/
  controls.tsx     React components, each calling its own hooks in a fixed order
                     ModelControl, PermissionControl, LaunchModelControl
  strategy.ts      pure functions, no React, no component imports
                     selection, turnSettings, planToggle, nextPermission,
                     queuePolicy, slash, placeholder, onSelect/resetFields
apps/desktop/src/renderer/src/harness-ui/
  controls.ts      HARNESS_CONTROLS:   { [H in HarnessId]: HarnessControls }
  strategies.ts    HARNESS_STRATEGIES: { [H in HarnessId]: HarnessStrategy }
```

- **Static vs behavioral.** Data that mobile or main need lives in the two
  existing shared tables, both already exhaustive over `HarnessId`; no wrapper
  table is added on top of them. `harness-sandbox.ts` keeps its semantics.
- **One default permission mode per harness.** `defaultPermissionMode` is the
  harness's own recommended default, separate from `permissionModes` (display
  order). Session defaults, launch rows, settings and mobile all fall back to
  it. dsh uses upstream's default preset `workspace-write` (`default`), not
  the first-listed read-only `plan`.
- **Components dispatch, hooks do not.** Registries return components. A
  dispatcher renders `<Controls.ModelControl />` for the active harness; hooks
  run inside that component, so switching harness remounts instead of changing
  hook order in one component. The launch row does the same with
  `LaunchModelControl`.
- **Store strategies are pure.** The chat store imports `strategies.ts` only,
  never the TSX controls, so the store stays free of selector code and startup
  imports do not grow.
- **Strategy inputs are explicit.** Turn settings take
  `{ session, project, catalog, turn: { firstTurn, queued, inputRequest, turnKind, choices, threadId } }`,
  keeping today's independent `SessionTurnOptions` fields (a form can be
  queued), and return typed harness settings only. Host filtering, the common envelope
  and `createSession.settings` assembly stay in `session-turn.ts`.
- **Selection carries intent.** `selection.read(session)` returns
  `{ model, effort, modelUserChosen, effortUserChosen }`;
  `selection.patch(session, change, { userChosen })` writes the harness's own
  fields. A default refresh passes `userChosen: false` and does not overwrite a
  manual pick; a manual model pick keeps today's effort-flag reset. ACP effort
  reads and writes `selectedAcpModeId` when the mode config is an effort.
- **Exhaustive by type, explicit unsupported.** All registries are mapped types
  over `HarnessId`; a new harness fails typecheck until its modules exist. A
  missing optional slot renders the documented unsupported state, never a
  Claude fallback.
- **Wire fields stay.** `selectedCodexModel` and friends remain in
  `PerSessionState`, events and persistence. Merging them into `selectedModel`
  touches main, chat-core and golden fixtures and belongs to direction 2
  (store as projection).
- **Encapsulation covers the generic paths.** After this plan, generic code
  (composer, status bar, launch rows, send, switch, defaults, restore) reaches
  harness fields only through strategies. Owning features keep direct access
  to their wire fields: Codex reducers, realtime voice, `/review`, async
  questions, elicitation forms; Claude Ultracode/fast mode; Grok `/recap` and
  rate-limit icon; ACP context window; dsh presets; Cursor model params.
  Physically moving fields under `harnessState` belongs to direction 2,
  because `ChatCoreSession` is shared with mobile.
- **Grok stays an ACP agent.** `isGrokAcpAgent` decisions move into the ACP
  strategy, not a new `HarnessId`.

## Out of scope

- Settings/resource pages that pick IPC by provider (`stores/settings.ts`,
  `lib/remote-resource-ops.ts`, `McpPage`/`SkillsPage`/`PluginsPage`,
  `AddServerPanel`, `HarnessesSettingsPage`, `AutomationDialog`). They are a
  resource-IPC adapter, a separate track after this one.
- Moving the `RemoteSystemInfo` projection out of desktop main; deleting the
  mobile permission generator.
- Store shape changes (direction 2) and DB/wire field renames.

## Steps

Each step is one or more commits that leave the app working. Per step run the
affected tests (paths below), `bun run typecheck:web` and, when shared changes,
`bun run typecheck:node`.

0. **Pin today's behavior.**
   - Characterization tests for `session-turn.ts`: the full
     `sessionTurnRequest` and `createSession.settings` for all six harnesses,
     local and node project keys, untouched defaults vs manual picks, and
     the independent turn flags (`firstTurn`, `queued`, `inputRequest`,
     `turnKind`), including a queued form. Include Codex activation
     replay (old choices + new `threadId`) and assert absent fields.
   - Ratchet test (see Verification) with today's per-file counts.
1. **Shared defaults (done).** `HARNESS_LAUNCH_OPTIONS.defaultPermissionMode`
   replaces every "first offered mode" fallback (`sessionDefaultsForHarness`,
   `SessionDefaultsSection`, `HarnessPermissionPopover` for both launch rows,
   mobile collab request, agent config fields and preview). dsh now starts in
   `default`. `BrandColorPopover` `HARNESS_LABEL` reads
   `capabilities.displayName`; ACP agent names and localized copy stay.
2. **Dispatch wrappers.** Create `harness-ui/` with `controls.tsx` per harness
   wrapping the existing selectors unchanged. Replace the `ModelSelector` and
   `StatusBarPermission` if-chains; the ACP `PermissionControl` keeps both
   `AcpPermissionSelector` and `AcpModeSelector`.
3. **Permission presentation.** Merge the five vocabulary files into one table
   per harness that keeps distinct session and launch vocabularies (the four
   Codex session presets; the three Codex launch modes; dsh native preset copy
   for session and mobile; current launch copy). `HarnessPermissionPopover`
   reads it. The mobile generator reads the table; the regenerated JSON is
   byte-identical.
4. **Selection, defaults and restore.** Add `selection` and route the generic
   paths: `store-helpers` (prewarm hint), `side-chat`, `agent-defaults`,
   `persistence.restorePersistedSelection`, `session-lifecycle.ts:222-230,475-552,619-639`
   (new/reset/ACP seeding), `event-slice.ts:64-77,825-860` (UI vs host snapshot
   merge), `index.ts:888-902` (restore), `ContextUsage`. Tests: default refresh
   does not override a manual pick, late hydration keeps the newer choice,
   remote catalogs stay isolated, side chats write scoped.
5. **Launch rows.** Each harness gets `LaunchModelControl` built from the same
   prop helpers as its composer control; `useCollabLaunchModelSelector`'s
   per-harness branches move into them. ACP unifies the profile path with the
   live agent catalog for local launches; remote launches still read only the
   target profile and never write the parent session. Tests remount one tree
   while switching harness and while a profile loads, and cover Grok legacy
   effort, `reasoning_effort` config, a true ACP mode and ACP OpenCode grouping.
6. **Turn payload.** Move per-harness blocks of `session-turn.ts` into
   `strategy.turnSettings`. Step 0 tests pass unchanged.
7. **Switch, interaction and send policy.** `harness-selection.ts`
   seed/reset → `onSelect`/`resetFields`; `interaction.ts` cycle/plan toggle →
   `nextPermission`/`planToggle`; `session-send-request.ts` →
   `queuePolicy` (queue and steer stay separate decisions); Cursor optimistic
   streaming in `input-request-send.ts`; `send-command-policy.ts` and
   `StopButton` → descriptor `composer` flags.
8. **Slash and placeholder.** One `slash` strategy serves both the
   `ChatInput` popup selection and the raw-send intercepts in
   `send-message.ts:457-489`. Keep host-only commands that send no turn, Grok
   `/recap`, Cursor `promptBody` expansion and Codex `/plan`/`/review`. Move
   `resolveChatInputPlaceholder`, `computeMatchingSlashCommands`,
   `ProviderSlashPopup` and the dirs hint (`supportsAdditionalDirs`). Scenario
   tests: select from the popup and type-and-send for each intercepted command.
   `ChatSuggestions` picker icons, enabled checks and provider hint move to the
   descriptor and controls.
9. **Close out.** Lower the ratchet allowlist to the owning-feature residue,
   fold the stable rules into the long-term docs and harness skill, delete
   this plan.

## Verification

Baseline (from `apps/desktop/src/renderer/src`):

```bash
grep -rEn --include='*.ts' --include='*.tsx' \
  "(===|!==) ?'(claude|codex|acp|opencode|cursor|dsh)'|case '(claude|codex|acp|opencode|cursor|dsh)'" . \
  | grep -vE '\.(test|stories)\.' | wc -l      # 443 matching lines on 2026-10-12
```

Ratchet: a renderer vitest parses non-test sources with
`@typescript/typescript6` (already a desktop devDependency; `createSourceFile`)
and counts `===`/`!==` comparisons with a harness-id string literal on either
side, plus `case` labels, then compares per-file counts with `harness-ui/ratchet-allowlist.json`
(`{ file: { count, reason } }`). A file above its count fails; a file below
must lower its entry. Exempt: `harness-ui/<harnessId>/**`,
`stores/chat-store/harness/**`, `codex-slice.ts`, `opencode-slice.ts`.
`claude-slice.ts` is not exempt (it holds ACP and Cursor branches). The
desktop app has no ESLint; this test is the guard. The scan is intentionally
literal-only (no type information), which is enough to stop new branches.
Its baseline is 475 comparisons in 74 files (it also sees multi-line and
double-quoted comparisons the grep above misses). Test:
`harness-ui/harness-branch-ratchet.test.ts`; payload pins:
`stores/chat-store/helpers/session-turn-harness-payload.test.ts`.

Target: in `components/chat` + `stores/chat-store`, outside exempt paths, only
owning-feature residue remains, each entry with a reason. Out-of-scope
settings files keep their counts.

Per step: the existing tests next to each touched module
(`model-selector/*.test.tsx`, `stores/chat-store/helpers/{session-turn,interaction,session-lifecycle,persistence,send-message}.test.ts`,
`stores/chat-store/selectors.test.ts`) stay green.

Storybook: per harness, `ModelControl` and `PermissionControl` through the
registry (loading, empty catalog, error, locked/unsupported), next to the
existing `GroupedModelEffortSelector` stories.

Dev build over CDP after steps 2, 5 and 7: for each enabled harness, switch
harness on an empty draft, pick model/effort/permission, toggle plan with the
shortcut, send one turn and one queued turn, and compare the turn request in
the event trace with the step 0 expectations.
