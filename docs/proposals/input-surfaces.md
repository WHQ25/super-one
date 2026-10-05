# Input surfaces: composers and entry points

Status: accepted for phases 1–3 · Updated: 2026-10-06

Phase 3 v1 was delivered after Codex/Claude design and implementation review on
2026-10-06. Scope and verification limits are recorded in the execution plan;
Phase 4 and deferred extensions remain future work.
See the [execution plan](../plans/input-surfaces.md).

Scope: make the composer slot programmable. A **composer** is a self-contained
input surface that produces one submission — the chat composer, a permission
prompt, an image-generation form, a mini-app form. Users, mini-apps, widgets
and agents open composers through one API, and fixed patterns (image, video,
decision prompts) become reusable composers any caller can open. Entry points
(composer buttons, slash commands, menus) are how composers are reached.
Related: [miniapp-event-api.md](miniapp-event-api.md),
[ai-gateway.md](ai-gateway.md), [miniapp-agent-api.md](miniapp-agent-api.md).

## 1. Decisions

| Question | Decision |
|---|---|
| Unit | A composer: a self-contained input surface carrying every input it needs (text, choices, attachments, parameters) and producing one submission. |
| Slot | The composer slot shows exactly one composer. No stacking of prompts above the chat composer. |
| Default composer | Today's chat composer — one registry entry, not a special case. |
| Decision prompts | Permission and AskUserQuestion replace the default composer in the slot. Plan approval keeps its original full-screen review. Pending decisions are processed one at a time without a queue counter. |
| Reuse | Built-in patterns (image, video, decision prompts) are registered composers any caller can open. |
| Cross-platform | Declarative composers are preferred: the host renders them with native controls on desktop and phone. |

## 2. Current state

| Piece | Where | State |
|---|---|---|
| Composer slot | `ComposerSwitch` plus `composer-slot/resolve-composer.ts` and `composer-registry.tsx` | Registry selects decisions, agent forms, MCP App consent, app/widget forms, native media modes, realtime voice or text; the slot keeps its hand-off animation and height alignment |
| Decision prompts | `DecisionComposer` (`PermissionPrompt`, `AskUserQuestionPrompt`) and `PlanApprovalPrompt` | Permissions and questions replace the base composer and run one at a time without a counter. Plan approval retains the original full-screen review after those decisions |
| Tool intercepts | `manifest.tools[].renderer.intercept` | WebView input before a mini-app tool runs, rendered in the transcript |
| Media generation | `media_*` MCP tools and native image/video composers | Users open native modes from the toolbar or `/image` / `/video`; results support caller and agent output. Models use the existing media-gen consumers |
| Mini window | `apps/desktop/src/renderer/src/components/MiniWindowApp.tsx` | Mounts a full `SessionPane`; it is not session-less today |
| Declarative input | `composer_request`, frontend `window.superone.composer.open`, Node `context.composer.open` | Once-only Host-owned forms reuse schema validation and pending restore. Frontends share default caller output and explicit agent output |
| Phone | `apps/mobile/src/navigation/mobile-app.tsx`, `InputRequestComposer`, `packages/chat-view/src/PortableDecisionCards.tsx`, and `pending-prompt-bar.tsx` | New local-host forms render in the native composer slot with growing text and bound file uploads. Permission/plan sheets and transcript questions retain their entry points |

## 3. Composer model

| Dimension | Values | Notes |
|---|---|---|
| Source | `native` / `declarative` / `webview` | Native: chat, voice, image, video, decision prompts. Declarative: fields described by a spec, rendered by the host. WebView: mini-app HTML, like popover templates. |
| Opened by | user / mini-app / widget / agent | Users via mode picker or slash command; apps and widgets via API; agents via a tool or a pending interaction. |
| Lifetime | `once` / `sticky` | `once` returns to the composer underneath after submit or cancel. `sticky` stays until the user switches (e.g. an image mode). |
| Output | `caller` / `agent` / `session` | See §6. |

```ts
const result = await context.composer.open({
  title: 'Report a bug',
  requestedSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', title: 'Title' },
      severity: { type: 'string', title: 'Severity', enum: ['low', 'high'] },
    },
    required: ['title'],
  },
  submitLabel: 'Report',
}, { session: ctx.session, signal: ctx.signal })

// The existing native API remains desktop-only and in-process.
await composerForSession({ projectPath, sessionId }).open('superone.image', {
  prefill: { prompt },
})
```

## 4. Slot and priority

- One composer is visible. Opening a `once` composer pushes it; submit or cancel
  pops back to what was underneath. A `sticky` composer replaces the base.
- HITL composers (permission, question, plan approval) take priority over
  everything else. An app or widget composer never covers them.
- Several pending prompts are answered one by one without a position counter.
  Plan approval retains its original full-screen review (user decision,
  2026-10-05).
- The slot may grow up to a cap for tall content (a form, a diff) so the
  transcript above stays visible. `ComposerSwitch` already owns the height
  hand-off.

## 5. Decision prompts as composers

Each prompt composer carries all its inputs. Permission: allow, deny, deny with
feedback (a text field), stop. AskUserQuestion: options plus an "other" text
field. Plan approval: approve, revise with feedback.

Rules:

1. **Draft preserved.** An unsent draft in the default composer survives the
   replacement and is restored when the prompt resolves.
2. **No misfire.** A prompt that appears while the user is typing does not take
   the pending keystrokes: no auto-focus steal, and a short guard before Enter
   can answer. High-risk approvals (running a command) need an explicit click or
   a dedicated shortcut.
3. **Own session only.** A collaboration child's prompts stay in the child; the
   parent shows at most a notice, not a composer.
4. **App-owned answers (Phase 4).** When a mini-app intercepts an answerable event
   ([miniapp-event-api.md](miniapp-event-api.md) §4.2), it registers its own
   prompt composer in place of the default one.

## 6. Output

| Output | Example | Behavior |
|---|---|---|
| `caller` | A mini-app collecting structured input | Returned to the caller; nothing enters the transcript |
| `agent` | A bug-report form | Rendered into a message with attachments and sent as a normal turn |
| `session` | A quick image inside a session | Runs directly — e.g. `generateImage` through the AI gateway — without an agent turn; the result is recorded in the session (open question 1) |

The image and video composers currently use the media-gen consumers. Model
choice, routing and metering move to the AI gateway when it is available.

## 7. Hosts

- The session composer slot.
- The mini window currently hosts a full session. Session-less use and media
  library output remain proposed future hosts, outside Phase 3.
- Mini-app panels, which can embed a built-in composer instead of rebuilding
  it.
- The phone, rendering declarative composers natively in the composer bar.
  WebView composers need a mobile fallback (open question 3).

## 8. Entry points

Contribution points declared in the manifest and rendered by the host: composer
buttons, slash commands, mention sources, message context-menu items and
sidebar entries. Most entry points open a composer, which is why both live in
this proposal.

## 9. Phase 3 — agreed declarative input v1

### 9.1 Reuse the Host prompt contract

A declarative form is a new `input_request` Host prompt family on the existing
HITL pipeline. It carries `PermissionRequest.schemaForm` plus trusted input
metadata; it uses Session events, pending-interaction restore and
`respondToPermission(..., formAnswers)`. It collects input, without granting
permission for another effect. Existing approval executors retain their checks.

Use `requestedSchema`, the flat elicitation JSON Schema already admitted by
`parseSchemaForm` and validated by `acceptedElicitationContent`. Reuse scalar,
choice, text-list and explicit resource fields, defaults and stepping. File
selection uses `resource` with `userOptions: { kind: 'file' }`, not a second
attachment-id model. Unsupported forms reject as a whole. Labels and titles
are plain text; schema caps and validation remain server-owned.

There is no new composer RPC family, spec revision, receipt service or capability
negotiation. `HostConfirmRegistry` supports an omitted timeout for this family;
existing confirmation deadlines remain unchanged. Input has no automatic
expiry. Every answer, caller abort, owner disposal or session deletion emits
one terminal `interaction_resolved` event and settles the waiter once.

### 9.2 Public contract and scope

```ts
interface InputRequestSpec {
  title: string
  description?: string
  requestedSchema: Record<string, unknown>
  submitLabel?: string
}

type InputRequestOutcome =
  | { status: 'submitted'; values: Record<string, SchemaFormValue> }
  | { status: 'cancelled'; reason:
      'user' | 'aborted' | 'owner_disposed' | 'session_removed' }

interface InputRequestMeta {
  title: string
  description?: string
  submitLabel?: string
  origin: { kind: 'agent' }
    | { kind: 'miniapp'; appId: string; appName?: string }
    | { kind: 'widget'; messageId: string }
  output: 'caller' | 'agent'
}
```

| Caller | Entry | v1 result and ownership |
|---|---|---|
| Agent | `composer_request({ title, requestedSchema, description?, submitLabel? })` | Once/caller; local and node sessions; result returns to the running tool call |
| Mini-app frontend and Widget | `window.superone.composer.open(spec, { output? })` | Shared once-only contract; default caller returns values, agent sends a user message and returns status only; host-bound identity |
| Mini-app Node Host | `context.composer.open(spec, { output?, session?, signal? })` | Same spec/output/outcome contract plus trusted session and AbortSignal; desktop-owned local sessions |
| Legacy Widget | `window.requestInput(spec)` | Agent output with opening-only acknowledgement, retained for compatibility |

Native media modes keep their existing sticky/caller/agent behavior. External
sticky forms and remote mini-app forms are explicitly deferred extensions.
The frontend/API unification follow-up was accepted on 2026-10-06. It shares
import-free author types and the frontend SDK factory across mini-apps and
widgets, with Node retaining the same contract. WebView composers and manifest
contribution points remain Phase 4. Remote agent forms support portable fields;
file-picker fields reject explicitly until node file selection is supported.
This release does not claim phone access to node sessions: the current mobile
remote-control path addresses desktop-owned sessions.

A missing mini-app session resolves only from a trusted invocation or exactly
one authorized session in that project. Multiple holders require an explicit
session; active/first-holder selection is forbidden. Handler context adds
`ctx.session`, `ctx.callId` and `ctx.signal` without changing existing handlers.
App authorization is checked on admission and response. Session-less calls do
not create a conversation implicitly.

Widget callers cannot supply a target or origin. The host validates that the
captured message is a completed widget in that session, with at most one live
request per message. Apps are capped at four live requests per app/session.
Historical rendering does not replay previous opens. Widget inputs that need
local caller-side interaction can continue to use their own HTML controls.

### 9.3 Priority and lifecycle

Selection order is:

1. Real permission requests.
2. Existing AskUserQuestion.
3. Agent-origin input requests.
4. Existing full-screen plan approval.
5. MCP App consent.
6. Mini-app/widget input requests.
7. Native mode, voice or ordinary text composer.

This is a presentation distinction within existing transport, not another
permission pipeline. App forms are excluded from the decision/plan blocking
gates, so an earlier app form cannot hide a later approval. The same family
classifier is shared by desktop and phone. No pending-request counter appears.

Desktop owns local waiters; node SessionRuntime owns remote agent waiters.
Renderers and phones present them. Node inputs live in a small independent
collection, included in snapshots and busy/idle/disposal checks. They neither
evict nor are evicted by the existing single `pendingInteraction` slot.

Preemption and transport disconnect preserve a live request. Reconnect restores
pending interactions before enabling actions. A frontend's true disposal,
reload or session rebind releases caller forms; agent forms remain in the
session. Visibility-based tool caching keeps interactive WebViews mounted.
Node Host exit closes only Host-opened forms. Drafts remain client-local. A turn interrupt
cancels agent inputs but preserves unrelated app/widget forms in the reducer.
Session end/deletion and app-host death close their own forms. Restart cannot
restore an orphaned waiter as active work.

Submit requires an explicit `formAnswers` object, including an empty object for
an empty form. Missing/invalid answers leave the request pending; this prevents
old phones from accepting a form without its values. Cancel/deny is neutral,
with no automatic retry. Duplicate or late answers cannot settle twice.

### 9.4 Human wait and file proof

`composer_request` is node-local on remote nodes, excluded from generic Host
Action claim/dispatch. Keep AskUserQuestion alongside it. Internal harness
children sharing a parent's MCP session cannot place a form in that parent;
a distinct authenticated SuperOne child session owns its own form.

Mini-app forms use dedicated child/main messages, not the renderer Host Action
bridge with its 60-second timer. `open()` may remain pending independently of a
mini-app tool invocation. A handler can start a form, return, then consume the
outcome in its long-lived Node Host. If it awaits inline or passes `ctx.signal`,
the existing 120-second tool budget/abort still applies. Do not extend generic
Host Action deadlines, claim leases or mini-app execution timeouts. An agent
that needs input inside its current turn uses `composer_request` itself.
Verify pinned MCP client timeout configuration; source/config checks do not
substitute for a paid live harness run.

Files are backed by trusted picker/upload proof, not arbitrary submitted paths.
Generalize existing form resource context/picked sets for the new family.
Phone uploads carry the request and field identity; the host chooses a
session-scoped destination, records the completed resource in that request,
and returns it to the field. Existing MIME/count/byte/path constraints apply.
Picker cancellation leaves the form open; upload failure is retryable and
unfinished uploads block submit. Bytes do not ride prompt event snapshots.

### 9.5 Widget output and UI

Widget submission carries the original request/values through ordinary send
admission with a stable `clientMessageId`. The host validates and claims the
request first, derives deterministic title/label/value content, and ignores
client-supplied replacement content. Retries with the same id are idempotent;
a different claimant fails. Normal failed-send/retry UI retains the content.
Never overwrite or send the existing unsent chat draft as part of this form.

Reuse the desktop schema-form body and its one-row auto-growing text inputs.
New input prompts show their title, trusted origin, Submit and Cancel, without
permission Allow/Decline language. Enter advances/submits; Shift/Alt+Enter adds
a newline. Preserve IME, platform keycaps, hint animation, reduced motion,
focus preservation and the 500 ms activation guard. Covered forms are inert.

Phone renders these new forms natively in the composer slot, reusing RN schema
fields/stepping, a keyboard-aware height cap and a fixed action row. Free text
starts at one row and grows; soft Return inserts a newline and submit remains
explicit. Existing permission/plan sheets and transcript questions stay in
place and preempt an app form. The chat draft survives the replacement.

The shared tool row shows waiting, submitted, cancelled, closed or failed, summarized by
the form title. There is one live answer surface, not a second transcript form.
App caller results do not enter the transcript. Agent results return through
the tool; widget results enter the normal message path only after submit.

### 9.6 Delivery criteria

Verify schema admission and file proof, own-session attribution, real decision
priority, node permission/input concurrency, terminal cleanup, app interruption,
restore, old-phone missing answers and duplicate submissions. Cover widget
normal-send admission/failure/retry, mono-/multi-holder app calls and preserved
120-second generic timeouts. Test actual desktop/node MCP registration and
canonical tool naming for Claude, Codex and Grok without paid generation.

Production Storybook and RN previews cover all supported fields, long content,
narrow/light/dark/zh/en, preemption, IME, invalid input, picker/upload failure
and retry. State source-only harness checks and unavailable live device checks
explicitly. Phase 3 is delivered only after these paths are usable and checked.

## 10. Phases

1. Composer registry behind `ComposerSwitch`; decision prompts move into the
   slot as composers. **Delivered for desktop; see the [execution plan](../plans/input-surfaces.md).**
2. Native image and video composers, opened by users (mode picker, slash
   command) with `caller` and `agent` output. **Delivered for desktop, including durable video jobs; see the [composer contract](../features/composer.md).**
3. Declarative composer API for mini-apps, widgets and agents; phone rendering.
   **Delivered v1 in §9; see the [execution plan](../plans/input-surfaces.md) for verification and limits. Deferred extensions are explicit.**
4. WebView composers, absorbing tool intercepts; manifest entry points.

## 11. Open questions

1. `session` output: record user-initiated results as a new event (e.g.
   `user_action`) that enters the agent's context with the next message, show
   them without entering context, or drop `session` and route through the agent.
2. Resolved for Phase 3 v1: `composer_request` complements AskUserQuestion;
   reuse the Host prompt/schema-form pipeline and render new phone forms in
   the native composer slot (§9).
3. WebView composers on the phone: fallback UI or a mobile WebView path.
4. Guard length and shortcut design for the misfire rule.
