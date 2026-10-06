# Input surfaces: execution

Status: in-progress · Updated: 2026-10-06
Goal: Deliver the composer registry, native media modes and session-owned declarative input v1, then design WebView composers and manifest entry points.
Proposal: [input-surfaces.md](../proposals/input-surfaces.md)
Long-term docs affected: [composer.md](../features/composer.md); [desktop mini-app manual](../../apps/desktop/docs/agent-reference/miniapps.md); [mobile composer manual](../../apps/mobile/docs/agent-reference/composer.md); mini-app/widget/product tool guides

Phases 1–3 v1 are delivered after Codex/Claude design and implementation review;
their explicitly deferred extensions are not delivery claims.
Phase 4 retains its own prerequisites. The Phase 3 design removes the need to
wait for the full MiniappAgentAPI/EventAPI or to migrate existing phone sheets.

## Baseline (2026-10-04)

Facts the proposal's "current state" table does not yet reflect:

- `ComposerSwitch` (`components/chat/ComposerSwitch.tsx`) is already generic over
  a string union and owns the drop/rise hand-off, height pinning and `align`.
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

Model source decided on 2026-10-06: use the existing media-gen registry before
the AI gateway exists, then migrate the routing when the gateway is available.

- [x] 2.1 Composer stack: a per-session store with `open(id, opts)` → Promise,
  `once` push/pop and `sticky` base replacement. Decision tier still wins.
- [x] 2.2 Main: `media:generate` IPC over `generateAndRecord({ source: 'human' })`,
  abortable, routed through `window.environment` for remote nodes.
- [x] 2.3 `ImageComposer`: prompt, reference images, size/aspect, model picker from
  the `media:image` consumer; `sticky` mode with a toggle back to chat.
- [x] 2.4 Entry points: host slash command `/image` (added next to `/add-dir`,
  `/side`, `/goal`) and a composer-toolbar mode button.
- [x] 2.5 Output: `agent` — attach the generated images to the chat draft and send;
  `caller` — results stay in the composer with copy / save / insert-to-draft.
  `session` output waits for proposal open question 1.
- [x] Video composer follows the same shape; generation is async
  (`media_video_status`), so it needs a pending result row.

## Phase 3 — agreed v1 implementation

Design: [proposal §9](../proposals/input-surfaces.md#9-phase-3--agreed-declarative-input-v1).
Codex and Claude agreed on 2026-10-06 to reuse the Host prompt pipeline with
`requestKind: 'input_request'` and flat `requestedSchema`. Preserve existing
native media modes, permission effects and generic execution timeouts.

V1: once-only agent caller output (local/node), local mini-app and widget forms,
and native phone composer-slot rendering for local host forms. Follow-up 3.7
unifies mini-app/widget frontends with caller/agent output and keeps the same
Node contract. External sticky, remote mini-app forms and node file fields are
deferred extensions. WebView/manifest work stays
Phase 4. This replaces the earlier draft's generalized composer protocol and
Host Action deadline extension.

### Source audit and review corrections

- Shared schema-form parsing, defaults, stepping and structural checks already
  cover the form contract; avoid another field-descriptor engine.
- HostConfirmRegistry and Session pending restore already supply local
  settle-once ownership and cross-window/phone visibility.
- Application forms must be excluded from question/plan/consent blocking gates,
  not merely sorted to the end of the permission array.
- Node's existing pendingInteraction is a single slot; new form waiters need an
  independent collection so parallel input and permissions remain answerable.
- Mini-app Host Actions time out at 60 seconds; tool and remote Host Action
  execution use 120 seconds. Dedicated app form messages avoid the first;
  inline tool awaits retain the latter. No generic deadline/lease change.
- Desktop free text already uses AutoResizeTextarea. Phone fields need growth
  and native composer-slot integration, without migrating old sheets.
- Mobile Remote Control currently addresses desktop-owned sessions. Do not
  claim phone/node access or hide unsupported remote app/file paths.

### 3.1 Shared contracts and local request service — Claude

- [x] Add InputRequestSpec/Meta/Origin/Outcome, requestedSchema admission and
  deterministic message formatting in a Metro-safe shared module.
- [x] Add the PermissionRequest family and widget send/upload declarations.
- [x] Make HostConfirmRegistry timeout optional; preserve existing deadlines.
- [x] Add local waiters, validation/file proof, respondToPermission routing,
  session/owner cleanup and caps. Missing formAnswers never settles a form.
- [x] Verify false/optional values, unsupported/capped forms, late responses,
  cancellation, file proof and app-host/session disposal.

### 3.2 Node and agent tool — Claude

- [x] (Historical) Register composer_request on desktop and as node-local on
  remote nodes. This agent-facing MCP entry point has since been removed; the
  shared mini-app/widget composer APIs remain.
- [x] Preserve own-session/internal-child guards and neutral cancellation.
- [x] Verify descriptor/admission parity and Claude/Codex/Grok pinned MCP timeout
  configuration. Test node permission/form concurrency and waits/abort without
  generic Host Action claims or polling.

### 3.3 Desktop slot, priority and portable tool row — Codex

- [x] Add a shared family classifier for decision versus app/widget input.
- [x] Select real permission → question → agent input → plan → consent → app
  input → native mode/text. Preserve focus/drafts, animation and inert state.
- [x] Render Submit/Cancel and trusted origin with the existing form body,
  growing text, IME behavior and keyboard guard.
- [x] Generalize resource controls for input_request independently of harness.
- [x] Add shared tool-row states/i18n and production stories; avoid duplicating
  the live form in the transcript.

### 3.4 Native phone forms and file uploads — Codex UI / Claude transport

- [x] Reuse RN schema fields/steps in a native composer-slot form. Existing
  permission/plan sheets and transcript questions keep their behavior.
- [x] Preserve local form/chat drafts under navigation and higher-priority
  prompts; disable offline submission and honor restore/settlement.
- [x] Add one-row growing free text, explicit submit, keyboard-aware scrolling
  and supported keyboard behavior in focused native modules.
- [x] Add host-approved file selection/upload: request/field proof and host-owned
  staging directory, with picker cancellation/upload error/retry states.
- [x] Verify old-phone missing answers, priority, uploads, restore and layouts
  using native tests/previews; report any unavailable live device verification.

### 3.5 Mini-app and widget entry points — Claude backend / Codex bridges

- [x] Add trusted tool ctx.session/callId/signal and main-handled composer
  open/cancel/settled messages, separate from the 60-second host-action bridge.
- [x] Require invocation/unique-authorized-holder or explicit session; fail
  ambiguous/remote targets. Bind app disposal and optional signal cleanup.
- [x] Preserve 120-second tool timeout, propagate tool-abort, and document
  starting a form independently instead of awaiting it inside a tool handler.
- [x] Add window.requestInput and desktop/portable/native bridges with captured
  completed message/session ownership. No arbitrary target or frame reply API.
- [x] Carry widget values through normal send with stable clientMessageId;
  Host claim/validation generates content, and normal retry retains it without
  overwriting the existing chat draft.
- [x] Verify multi-holder/call attribution, iframe source checks, widget caps,
  interrupt/disposal, ordinary send failure/retry and unsupported remote cases.

### 3.7 Unified frontend API follow-up — both (2026-10-06)

User decision: mini-app HTML and Widgets share
`window.superone.composer.open(spec, { output? })`; the mini-app Node Host keeps
the same contract plus trusted session/signal options. Default caller returns
values; explicit agent sends a user message and returns status only. Legacy
widget requestInput keeps opening-only agent acknowledgement. Phase 4 is unchanged.

- [x] Share author-facing types and the self-contained frontend SDK factory.
- [x] Route desktop mini-app/widget and portable/native widget calls with trusted
  app/message/session identity; no frontend-selected target or AbortSignal.
- [x] Separate request owner/quota from opening view/Host lifetime; caller view
  release cancels, agent forms stay, and Host exit preserves frontend forms.
- [x] Use private phone completion events, one reconnect read and offline release
  queues, without human-wait timers or polling.
- [x] Fix subframe navigation cancellation and settle still-live guests on rebind.
- [x] Complete production Storybook round trips, scoped checks and shared manuals.

Delivered: shared default-caller frontend and Node contracts, explicit agent
output, holder-scoped disposal and phone completion/recovery. Fourteen affected
test files cover 141 cases; desktop web/node and mobile typechecks pass, and the
mobile chat-view production bundle builds. `Chat/ComposerBridge` production
stories exercise the actual iframe SDK with caller/agent submission, neutral
cancel, admission failure and a 300px dark/zh growing form. Host ports in these
stories and mobile relay regressions are isolated stubs; no live paired-device
end-to-end or provider calls were made for this follow-up. Standalone generated
frontend/Host author declarations were also checked with strict TypeScript.

### 3.6 Review, verification and documentation — both

- [x] Review the integrated implementation with both agents, correcting any
  ownership/priority/lifecycle issues before declaring delivery.
- [x] Run affected contract/main/runtime/CLI/renderer/mobile tests and relevant
  typechecks. Keep unrelated browser/activity/remote-control work intact.
- [x] Inspect production desktop stories and RN previews in light/dark, zh/en
  and narrow layouts. No paid provider calls or release work.
- [x] Update implemented long-term composer, mini-app/widget and phone manuals;
  mark only verified v1 work complete and retain explicit extension boundaries.

Delivered (2026-10-06): shared contracts, local/node waiters,
agent/mini-app entry points, desktop and native phone composer forms, and
widget bridges are implemented. Invalid widget answers restore the editable
form and discard the rejected bubble; transport failures retain the original
send for same-id retry, while settled requests have no resend action. Drafts
survive priority preemption and session navigation; async responses stay bound
to their captured session. Native previews cover pending/retry/offline/file and
unsupported-directory states through the production composer component. Shared
desktop/portable tool rows show status and title without duplicating the form or
revealing submitted values. Long-term composer, mini-app/widget and phone
manuals describe the implemented API and fixed execution deadlines.

Phase 3 verification:

- Integrated contract/local service/node mapping/mini-app/desktop send and UI
  batch: 13 files, 156 tests passed. Additional tool-row/presentation batch:
  68 tests passed; portable widget source/ack/error bridge: 19 passed.
- Mobile runtime receipt/event rejection and retry batch: 32 tests passed;
  native action validation/forwarding: 35 passed; ownership/preview route batch:
  21 passed. Native form, legacy schema sheet and chat-screen checks: 15 passed.
  These focused batches overlap; counts are not a unique-test total.
- Claude verified affected main/agent/CLI/runtime MCP registration, waiter
  validation/cleanup, node permission/input concurrency, mini-app lifecycle,
  relay and timeout behavior through focused tests. Both agents reviewed the
  integrated ownership, priority, failure recovery, tool row and manuals.
- Renderer, main, mobile, runtime and CLI typechecks pass; phone chat-view bundle
  builds. No full test suite, paid provider calls or release work was run.
- Production Storybook checked light/en and narrow dark/zh. Empty desktop text
  is one row and grows on wrapping/newlines; failed submission keeps its draft
  and succeeds on retry; the narrow form has no horizontal overflow.
- Production iOS preview checked light/en and dark/zh. Native text uses
  intrinsic layout with min/max height: empty and cleared text stays one row,
  wrapping/newlines grow, long input caps at 144 points and scrolls. Submit and
  Cancel remain above the software keyboard; retry preserves multiline values.
  Live inspection caught and fixed an explicit-height clipping bug missed by
  mocked layout tests. The preview uses local fixtures, not a live relay.
- File proof/upload failure and retry are automated/fixture checks. Real phone
  relay upload and Android layouts were not exercised live. Pinned Codex and
  the stdio bridge no longer impose their former short human-input timeout;
  live Claude/Grok/ACP timeout behavior remains unverified. Source/config and
  registration checks do not claim a real long-running provider round-trip.

## Phase 4 — prerequisites only

| Phase | Blocked on |
|---|---|
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
- [x] 2.1 Composer stack
- [x] 2.2–2.5 Image generation, composer, entry points and output
- [x] Native video composer and durable pending jobs
- [x] Phase 3 source audit and Codex/Claude design agreement
- [x] Phase 3 v1 implementation (3.1–3.6)
- [x] Phase 3 frontend/Node composer contract unification (3.7)

Phase 1 delivered on 2026-10-05. Desktop now resolves and renders the decision,
MCP App consent, realtime voice, and text composers through the registry. The
decision composer queues permissions and questions without a position counter;
plan approval follows in the original full-screen review. Draft restoration,
focus handoff, and shortcut guards are covered by focused tests. Phase 2 is
delivered. Phase 3 v1 is delivered after Codex/Claude review and focused
verification; Phase 4 remains future work.

Step 2.1 adds a renderer-local stack keyed by project and session, native
registration, and `composerForSession(target).open(id, opts)`. Temporary entries
return to the previous mode, persistent modes stay after their first submission,
and approvals retain priority. Draft state survives preemption; abort, session
removal, mode replacement and registration disposal settle requests safely.

Step 2.1 verification:

- `bun run typecheck:web`.
- Six focused Vitest files, 71 tests passed: stack lifecycle, composer priority,
  slot transitions, ChatContent, focus restoration and draft restoration.
- `ComposerSlotFlow` production stories cover persistent → temporary → permission
  → temporary → persistent → text, preserving both form drafts and the chat draft
  with its attachment. Checked wide light/en and narrow dark/zh layouts.

Steps 2.2–2.5 and video delivered on 2026-10-06. The native modes use the
existing media-gen consumers and human history records. Both toolbar and slash
entry points capture the session before loading. Results support copying,
saving, rich-draft insertion and ordinary agent sending. Images are abortable;
video submission returns a durable task id with manual / 30-second checks,
pause and recovery. Remote files use the existing Host sync zone; unsynced video
paths are withheld from agent drafts. The `session` output question stays parked.

Phase 2 verification:

- `bun run typecheck:web` and `bun run typecheck:node`.
- Ten focused Vitest files, 120 tests: human generation, model filtering,
  cancellation isolation, real sync-zone delivery against a fake remote RPC,
  video recovery / coalesced checks, UI preemption, ordinary chat input, composer
  stacks and rich result insertion / sending.
  Remote draft preparation is covered too: no agent turn, coalesced opens,
  retained edits and navigation, and no new conversation on transport failure.
- Production `ComposerSlotFlow` image and video stories pass in wide light/en
  and 320px dark/zh panes. Image generation completes behind a permission and
  returns without losing its prompt; both media kinds insert results while
  retaining the original chat draft and attachment.
- Provider generation is stubbed at the external boundary for verification;
  no paid image or video generation requests were made.

Verification completed:

- `bun run typecheck:web`
- Focused Vitest suite for composer resolution, sequential decisions, focus and draft
  restoration, plan approval, permission shortcuts, and chat composer switching.
- All ten host confirmation families route through the permission queue. Keyed
  handoffs animate consecutive permissions, permission-to-question, and MCP App
  consent transitions with the existing voice composer choreography; outgoing
  requests stay visible and inert. Consent count indicators are omitted too.

## Decisions needed

1. Resolved: phase 2 uses the existing media-gen registry and migrates later.
2. Resolved: native phone composer-slot forms; keep current permission/plan
   sheets and transcript questions. Old prompt migration is independent.
3. Resolved: Phase 3 v1 design is accepted after Codex/Claude discussion;
   user authorized implementation after agreement.
4. No additional approval is needed for implementation and focused verification.
   Deferred extensions are listed explicitly in Phase 3 and proposal §9.
