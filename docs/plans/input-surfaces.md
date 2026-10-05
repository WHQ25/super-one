# Input surfaces: execution

Status: in-progress · Updated: 2026-10-05
Goal: Turn the desktop composer slot into a registry of composers, move permissions and questions into it while preserving full-screen plan review, then let users open native image composers through the same slot.
Proposal: [input-surfaces.md](../proposals/input-surfaces.md)
Long-term docs affected: new `docs/features/composer.md` (slot, priority, decision-prompt rules); [apps/desktop/CLAUDE.md](../../apps/desktop/CLAUDE.md) routing row

This plan covers proposal phases 1 and 2 in detail. Phases 3 and 4 are listed
with their prerequisites only; they wait on proposal open questions 2–3 and on
[miniapp-event-api.md](../proposals/miniapp-event-api.md).

## Baseline (2026-10-04)

Facts the proposal's "current state" table does not yet reflect:

- `ComposerSwitch` (`components/chat/ComposerSwitch.tsx`) is already generic over
  a string union and owns the drop/rise hand-off, height pinning and `alignTo`.
  It has three kinds: `text`, `voice`, `app-consent`. The kind is derived inline
  in `ChatContent.tsx` (`appConsent ? … : showRealtimeComposer ? … : 'text'`).
- `McpAppConsentComposer` is the first composer that already follows the model:
  it replaces the slot, queues with a `1/N` counter, leaves Enter unbound and
  only takes focus from `body`.
- Decision prompts are not in the slot:
  - `SessionDecisionPrompts` renders `PermissionPrompt` and
    `AskUserQuestionPrompt` stacked above `ChatInput` inside both
    `ChatComposerShell` and `RealtimeCallComposer`. Both can show at once.
  - `PlanApprovalPrompt` replaces the whole chat body (transcript included).
  - Permissions show `pendingPermissions[0]` with no counter; question and plan
    are single slots in `packages/chat-core` (a new one overwrites).
  - `PermissionPrompt` autofocuses its first button and binds Enter = allow on
    `window` (gated by `isFocusInChat`), so a prompt arriving mid-typing can take
    the user's Enter.
- MCP elicitation is a `PermissionRequest` with `requestKind: 'mcp_elicitation'`,
  answered in `PermissionPrompt` through `SchemaFormComposer`.
- Drafts survive unmounting `ChatInput`: `draftText` / `draftJson` /
  attachments live per session in the chat store and `useComposerDraftSync`
  restores them on mount.
- Collaboration children's prompts are never forwarded to the parent (rule 3 is
  already true; keep it).
- `MiniWindowApp` mounts a full `SessionPane`, so it is not session-less today.
- Media: `main/media-gen/history.ts` `generateAndRecord` already accepts
  `source: 'human'`, but only `media-tools.ts` (agent) calls it. There is no
  renderer IPC for user-initiated generation and no media library UI.
- On mobile, permission and plan approvals use native sheets and can collapse
  into `pending-prompt-bar.tsx`; AskUserQuestion renders in the chat transcript.

## Phase 1 — registry and decision composer (desktop)

Each step is one commit and leaves the app shippable.

### 1.1 Composer resolution, no behavior change

- Add `components/chat/composer-slot/resolve-composer.ts`: a pure function from
  slot inputs (`needsDecision`, `appConsent`, `voiceEngaged`, …) to a composer
  id, with tiers `decision > app > mode > base`. `text` is the base entry, not a
  special case.
- Add `composer-registry.tsx`: `id → render(sessionId)` map consumed by
  `ComposerSwitch.render`. `ChatContent` stops hard-coding the ternary.
- Unit-test the resolver (tier order, app never over decision).
- Add the missing `ComposerSwitch.stories.tsx` with a control that swaps kinds.

No stack yet: every Phase 1 composer is derived from session state. The
`once`/`sticky` stack arrives in 2.1, when the first caller opens a composer.

### 1.2 Decision composer

- New `DecisionComposer` that owns the queue for one session:
  `pendingPermissions[]`, then `pendingQuestion` (fixed order; requests carry
  no arrival time). Plan approval follows in its original full-screen review.
  No decision position or remaining-count indicator is shown (user decision,
  2026-10-05).
- It renders the existing `PermissionPrompt` / `AskUserQuestionPrompt` bodies;
  their answering paths (`useScopedSessionActions` → IPC) do not change.
- Register it at the `decision` tier; remove `SessionDecisionPrompts` from
  `ChatComposerShell` and `RealtimeCallComposer`. `ChatInput` now unmounts while
  a prompt is pending.
- Preserve: remote-locked / worktree-removed / harness-disabled states still
  win over prompts (today the shell's early returns hide them).
- Stories: queue of mixed kinds, elicitation form, long command, narrow.

### 1.3 Preserve full-screen plan approval

- Keep `PlanApprovalPrompt` as the original chat-body replacement, with its
  existing review and approval controls (user decision, 2026-10-05).
- Permissions and questions are answered first; then plan review takes over
  the chat pane. MCP App consent waits until the plan is answered too.
- Extend `ComposerSwitch` with `maxHeight` for tall permission and question
  forms, and check the hand-off animation.

### 1.4 Draft and misfire rules

- Draft: test that text, TipTap doc and attachments typed before a prompt return
  after it resolves (store already holds them; the test locks it in).
- Focus: record editor focus before the swap and restore it after the base
  composer remounts (`useRestoreChatInputFocus` today assumes the editor stays
  mounted).
- No focus steal: a decision composer only autofocuses if focus was not in the
  editor within the last ~1 s (same idea as `McpAppConsent`'s `body` check).
- Guard: Enter, Space and digit shortcuts are ignored for a short window after a
  prompt appears (start at 500 ms, tune). High-risk prompts —
  `terminal_command_confirm`, Bash-like tools, `defaultToNo` — accept only a
  click or ⌘↵.
- Tests: keydown within the guard window does not answer; ⌘↵ does.

### 1.5 Docs and cleanup

- Write `docs/features/composer.md` (slot, tiers, decision queue, draft and
  misfire invariants); route it from `apps/desktop/CLAUDE.md`.
- Update the proposal's "current state" and mark phase 1 done there.

## Phase 2 — native image composer (desktop)

Prerequisite: decide where image composers get their models before the AI
gateway exists (see "Decisions needed").

- 2.1 Composer stack: a per-session store with `open(id, opts)` → Promise,
  `once` push/pop and `sticky` base replacement. Decision tier still wins.
- 2.2 Main: `media:generate` IPC over `generateAndRecord({ source: 'human' })`,
  abortable, routed through `window.environment` for remote nodes.
- 2.3 `ImageComposer`: prompt, reference images, size/aspect, model picker from
  the `media:image` consumer; `sticky` mode with a toggle back to chat.
- 2.4 Entry points: host slash command `/image` (added next to `/add-dir`,
  `/side`, `/goal`) and a composer-toolbar mode button.
- 2.5 Output: `agent` — attach the generated images to the chat draft and send;
  `caller` — results stay in the composer with copy / save / insert-to-draft.
  `session` output waits for proposal open question 1.
- Video composer follows the same shape once 2.x lands; generation is async
  (`media_video_status`), so it needs a pending result row.

## Phase 3–4 — prerequisites only

| Phase | Blocked on |
|---|---|
| 3. Declarative API (mini-apps, widgets, agents) + phone rendering | Open Q2 (`composer_request` vs AskUserQuestion); mini-app API surface in [miniapp-agent-api.md](../proposals/miniapp-agent-api.md); moving phone prompts from sheets to the composer bar |
| 4. WebView composers, tool intercepts, manifest entry points | Open Q3 (phone fallback); [miniapp-event-api.md](../proposals/miniapp-event-api.md) §4.2 |

## Verification

- Automated verification completed:
  - `bun run typecheck:web`.
  - Focused Vitest suite: 13 files, 223 tests passed.
- [x] Storybook: inspect stories in light/dark, zh/en, and a narrow pane.
- [x] Dev build over CDP ([self-verify.md](../../apps/desktop/docs/agent-reference/self-verify.md)):
  Claude permission while typing, AskUserQuestion during a voice call, plan
  approval in a narrow mosaic pane, MCP App consent queued behind a permission.

CDP verification uses isolated preview session state and local response stubs;
no real commands or model requests are executed. It covers native Enter/Space
protection, Command+Enter, sequential decisions without a counter, original
full-screen plan review and feedback, text/rich-text/attachment restoration,
focus restoration after a direct plan, and a later return without focus steal.

## Progress

- [x] 1.1 Composer resolution
- [x] 1.2 Decision composer
- [x] 1.3 Preserve full-screen plan approval
- [x] 1.4 Draft and misfire rules
- [x] 1.5 Docs and cleanup
- [ ] 2.1–2.5 Image composer

Phase 1 delivered on 2026-10-05. Desktop now resolves and renders the decision,
MCP App consent, realtime voice, and text composers through the registry. The
decision composer queues permissions and questions without a position counter;
plan approval follows in the original full-screen review. Draft restoration,
focus handoff, and shortcut guards are covered by focused tests. Phases 2–4
remain future work.

Verification completed:

- `bun run typecheck:web`
- Focused Vitest suite for composer resolution, sequential decisions, focus and draft
  restoration, plan approval, permission shortcuts, and chat composer switching.
- All ten host confirmation families route through the permission queue. Keyed
  handoffs animate consecutive permissions, permission-to-question, and MCP App
  consent transitions with the existing voice composer choreography; outgoing
  requests stay visible and inert. Consent count indicators are omitted too.

## Decisions needed

1. Phase 2 model source before the AI gateway: call the existing media-gen
   registry now and swap later, or wait for the gateway.
2. Phone decision prompts: keep sheets through phase 2, or move them into the
   composer bar alongside desktop phase 1.
3. Proposal status: mark it `accepted` for phases 1–2 and link this plan.
