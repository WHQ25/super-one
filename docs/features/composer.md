# Chat composer slot

Desktop chat renders one composer in a shared slot below the transcript. The
slot's registry resolves the current entry by priority: session decisions,
MCP App consent, app/widget input forms, an explicitly opened composer, realtime voice, then the regular
text composer. A decision pauses the lower-priority composer until it clears. Plan approval retains its
original full-screen review in the chat pane.

## Opening native composers

Native composers register with `registerComposer(id, Component)` and open through
an explicitly scoped `composerForSession({ projectPath, sessionId })` handle:

```ts
const composer = composerForSession({ projectPath, sessionId })
const result = await composer.open('superone.image', {
  lifetime: 'sticky',
  prefill: { prompt: 'A quiet mountain lake' },
  signal,
})
```

The image id in this example must be registered by the image feature before use.
Unknown ids and missing sessions reject without changing the slot.
Registrations are in-process native components, not a
mini-app or agent API.

Each project/session pair owns a persistent base and a stack of temporary
entries. `once` (the default) pushes an entry; submitting returns its value and
pops it, and cancelling returns `null`. `sticky` replaces the persistent base
without disturbing temporary entries above it. Its first submission resolves
`open()` but leaves the mode visible; cancelling, replacing it, or calling
`returnToChat()` closes it. That method closes all entries for the owning session
and returns to its derived text/voice composer.

Entries expose controlled `value` / `onValueChange` draft state to the component,
so decisions and MCP App consent can temporarily replace it without losing edits.
The component receives `active` and guarded submit/cancel callbacks; outgoing or
covered forms are inert and must not bind active keyboard shortcuts. Read-only
session gates suppress opened composers too. Draft edits update the composer
without rerendering the transcript.

Switching projects, sessions or panes preserves each stack. Deleting its owning
session or project cancels all its requests. An abort signal closes its entry
even after a sticky submission, and unregistering a component closes its entries
in every session. Cancellation settles each promise once and removes listeners.
This state is transient renderer state; it is not saved across app restarts.

## Native image and video generation

The toolbar's attachment icon opens a shared action menu with Add Attachment,
Generate Image and Generate Video. The generation actions open persistent native
composers on every desktop harness. Image and video are separate composers
(`superone.image`, `superone.video`) built from shared parts and laid out like the
chat composer: an Image or Video mode chip whose icon turns into a close control
on hover (the same chip as Codex plan mode), selectors styled like the model
selector, and a status row under the box. Existing chat text, rich content and
attachments stay in the chat draft; supported attached images also seed the
reference list. The image prompt includes the text composer's status-bar height,
so their top edges line up in the bottom-anchored slot. Its reference drop hint
lives in the prompt placeholder, with a toolbar attachment button for choosing
the first reference. The prompt starts at one row and grows with content; Enter
generates, while Shift+Enter and Alt+Enter insert a newline.

Reference images (PNG, JPEG, WebP; up to 8 and 24 MB) are dropped or pasted
anywhere on the box, or picked from the reference area. Video references can be
marked as start frame, end frame or reference; start and end frames are unique.

Reference images reach the provider at full size unless they exceed the model's
input limits. The image and video services shrink only those
(`media-gen/reference-fit.ts`), to the limits in `referenceImageLimits`
(`media-gen/capabilities.ts`).
- The limits follow each model's official API documentation: bytes per image,
  pixel count, longest side, and a request-body cap shared across images.
- They are matched by model id, so a relay serving the model gets the same rules.
- An unrecognised model gets the tightest common limit: 10 MB, 4096 px.
- Minimum sides and aspect bounds are left to the provider's error.

The controls follow the selected model. Each model reports the capabilities of
the adapter that serves it (`media-gen/capabilities.ts`, keyed by adapter kind
and, for New API, by the vendor behind the model id): image aspect ratios and
sizes (pixel sizes or the 1K/2K/4K tiers), and video aspect ratios, resolutions,
durations, seed, audio, watermark, fixed camera, and which reference roles it
reads. A control the model does not read is not shown, and a video model without
image inputs hides the reference area. Switching models keeps values the new
model accepts and resets the rest to Auto. Video resolutions are sent as pixel
sizes, which every adapter maps onto its own tiers; Sora has no ratio control
because its size carries the orientation. A model whose endpoint no adapter
serves gets the common controls.

The toolbar shows at most four controls on one row, in priority order (model,
ratio, size or resolution, duration). The rest (audio, seed, fixed camera,
watermark), and any of the four that do not fit at the current width, live in a
More Settings panel behind a sliders button, where each appears as a labelled
row; on/off options become switches.
Widths come from an invisible copy of the controls, so changing a label or the
pane width re-fits the row.

`openMediaComposer(target, kind, { lifetime, prompt, references, prefill, signal })`
loads and registers both composers lazily, then opens the session's stack. Next
to Generate, a user-started request chooses Generate Here or Ask Agent. Generate
Here calls the provider and keeps the completed result in the composer with Copy,
Save, Insert into Draft, Send to Agent and Use Results actions. Use Results
resolves the open promise; a temporary composer pops and a persistent one stays.
Send to Agent inserts the result into the owning chat draft and sends it through
the ordinary session send path. Image attachments, paste chips and mentions
preserve their order. A failed admission leaves the draft available; retrying
insertion does not duplicate generated attachments. Later edits are not erased by
a send acknowledgement. Insert into Draft returns to the ordinary chat composer.
Ask Agent sends one new user message instead: the prompt and the chosen settings
under the media tool's argument names, with the references as image attachments
whose roles are given by attachment number. Like chat attachments, these keep
their full-size originals, and the message waits until they have reached the
agent. The chat draft is left untouched and the composer closes after the
message is admitted.

An agent's `media_generate_video` call is reviewed in the same video composer,
shown in the decision slot instead of opened on the stack. It starts from the
agent's parameters fitted to the chosen model's capabilities (carried per model
in the confirmation payload) and its reference frames (read-only), and offers the
same controls as a user-started video. There is no run-mode choice, no Auto
values, and no exit chip. Generate replies with the edited parameters in
`formAnswers.paramsJson`, which the tool submits; Reject replies with optional
feedback for the agent. Agent-started image generation has no confirmation yet;
the image composer's selectors and frame are independent of the stack so a
future confirmation can reuse them the same way.

Models are enabled models from the existing `media:image` and `media:video`
consumers, filtered independently by capability and usable credentials. The
selected credential/model pair is validated again before generation; a removed
model does not silently fall back. With no enabled model, the status row links
to Settings → Providers and offers Retry.

The preload `window.environment` media API owns generation, cancellation, video
status and unfinished-job recovery. Provider SDKs and secrets stay on the desktop
Host, which calls the existing media-gen services with `source: 'human'`. Remote
sessions use the same Host credentials and sync-zone artifact delivery as agent
media tools. Desktop paths are retained for previews and saving; remote video
links can enter the agent draft only after delivery to the node finishes.
An unsent remote draft first gets a node session without starting an agent turn;
its latest draft and mosaic pane then adopt that identity before the media mode
opens. Navigation during this preparation does not redirect the request.

Generation runs survive approval or consent preemption without restarting or
sending twice. Closing an entry or destroying its window aborts its image request
or in-flight video submission. Once a video has been submitted, its provider task
id is durable: checks run every 30 seconds while the composer is active, can be
paused or requested manually, and resume from unfinished human jobs when the
composer reopens. Pausing or closing stops future checks; it does not cancel the
provider's render. Concurrent status checks share one fetch/download. Transport
errors retain the pending job for retry. Composer form drafts remain renderer
local; only the submitted video handle survives an app restart. `session` output
and the declarative external composer API remain proposal open questions.

## Decision queue

Each session owns its pending decisions. Desktop displays them in this stable
order: permissions in arrival order, then AskUserQuestion, then full-screen plan
approval. Agent input forms follow AskUserQuestion and precede plan approval.
Only the first item is interactive. Answering an item advances the
queue without displaying a position or remaining-count indicator.

Permissions continue to use `PermissionPrompt`, including MCP elicitation
forms. Questions continue to use the shared question form. Tall permission and
question content is capped and scrolls inside the slot. Plan approval replaces
the chat body with its existing review surface and approval controls once
permissions and questions have cleared.

Worktree-removed, disabled-harness, and remote-locked states retain their
existing read-only behavior and suppress session decision prompts.

## Handoff animation

The slot reuses the realtime voice composer's handoff: the outgoing composer
drops for 200 ms, then the incoming one rises for 240 ms. The slot grows with a
taller newcomer's rise using the same duration and easing, keeping its top
visible. For a shorter newcomer, the slot waits until the rise finishes before
shrinking over 200 ms. Content above the slot stays still throughout: the
transcript keeps its scroll position instead of re-pinning to the bottom, so a
taller composer leaves the displaced tail one scroll away rather than covering
it, and the empty-pane landing stays centred as if the text composer held the
slot. A shorter composer only moves history when the browser must clamp the
scroll position at the bottom. Request identity also
triggers a handoff between two
permissions, a permission and a question, or successive MCP App consents.
The outgoing request remains visible but inert until its exit finishes. Reduced
motion switches immediately. Plan review keeps its existing full-screen flow.
Switching sessions discards the previous session's outgoing snapshot.

All ten SuperOne host confirmation families emit the same `permission_request`
event: terminal commands, configuration, automations, video generation,
collaboration, session cleanup, device control, Computer Use grants, WebMCP
trust, and mini-app calls. They enter the session permission queue regardless
of the active harness; replies resolve the host confirmation before reaching
the harness backend. MCP elicitation forms use the same permission composer.

## Draft, focus, and keyboard rules

The text, rich-text document, and attachments remain in the per-session chat
store while the regular composer unmounts. When the queue clears, the editor
restores focus only if that editor held focus before a decision or opened composer
displaced it.
Side-chat input stays in that transient session store. It never becomes an
environment draft through autosave, navigation, project carry, or quit flush,
even before its first visible message.
Decision buttons and newly mounted MCP form fields do not take focus when the editor was focused within the last
second. The decision prompt's container takes it instead, so the pane keeps its
keyboard shortcuts after the editor unmounts; it leaves focus alone when the person
is working in another surface. Escape in a prompt's text field moves focus to that
container rather than blurring to the page. The base composer does not auto-focus on return when no focus needs
restoring. The restore request targets the owning session and is issued after
the editor mounts; old restore requests do not take focus on later mounts.

Image attachments are downscaled to at most 2000 px for the agent to view: Claude,
ACP and OpenCode get them inline, Codex as `localImage`. When the copy was
downscaled, the full-size original is kept for file-path tools, and the
attachment note names it instead of the copy.
- **Where the original lives:**
  - Local session: the user's own file, or a pasted image beside the turn
    attachments.
  - Remote session: the original goes into the session's sync zone when the
    image is attached, and uploads to the node in the background (see
    [session-sync-zone.md](../architecture/session-sync-zone.md) §6).
- **While it uploads:** a progress ring sits over the chip's dimmed thumbnail,
  and Send is disabled with a waiting spinner. Progress advances a 4 MiB chunk
  at a time, so a spinning arc stands in until the first chunk lands.
- **Upload failures stay in the composer:** the upload finishes before the
  message exists, so a sent bubble never shows one.
- **If the upload fails:** Send stays disabled.
  - The chip offers Retry Upload.
  - When the last chunk may already have landed, retrying is unsafe (E090-3),
    so the chip asks for the attachment to be removed and added again.
- **A missing original:** a send whose original has gone is refused rather
  than naming a dead path.
- **If the original cannot be kept when attaching** (a disk error, or the node
  is unreachable): the image is not attached and a toast says why.
- **Drafts** carry only the original's path, never its bytes.

A session open in more than one window (the main window and a spawned mini
window) shares one draft: text, chips, attachments, browser annotations, and
selections are relayed through the main process, which also seeds a window that
opens the session later. Browser annotations go to the session that owns the
browser tab, so marking a page in the main window fills that session's composer
wherever it is shown. The page's marks follow the chips: removing a chip in any
window, or sending it, drops its mark from the page.

Enter, Space, and digit shortcuts are ignored for 500 ms after a decision
appears. High-risk permission requests—terminal commands, Bash-like tools, and
decline-first requests—require a click or Command+Enter for approval. Keyboard
handling is scoped to the owning chat pane, so prompts in another pane do not
consume the user's keystrokes.

Collaboration-child prompts remain in the child session; they are not forwarded
to the parent composer.

## Decision text fields

Feedback, question answers and option notes start at one row and grow as text
wraps or newlines are inserted. They shrink when content is removed, up to five
visible rows before scrolling internally. Width changes recalculate their height.
On wide panes, single-line decision feedback sits to the right of the action
buttons. If it exceeds that inline width or contains a newline, it animates to
the full row above left-aligned buttons, with a newline shortcut hint on the
right of that action row. Removing enough text restores the
inline layout; narrow panes keep feedback above the buttons. Input key hints
are omitted, while action buttons keep their shortcuts.
The newline hint uses shared keycaps, with Shift/Option symbols on macOS and
Shift/Alt labels on Windows and Linux. It fades in and out; reduced-motion
preferences disable the hint and layout animations.
Enter submits feedback or a complete answer; Shift+Enter and Alt+Enter insert a
newline, matching the text composer. IME composition keeps its Enter key.
Both newline shortcuts preserve native undo and redo history.
The 500 ms guard still blocks accidental submission, while newline shortcuts
remain editable. Enter in high-risk feedback rejects; explicit approval shortcuts
apply outside that field.

Configuration notes and descriptions use the same growing field; Enter does not
apply configuration edits, which still require the confirmation button. Other
scalar settings stay single-line. MCP form free text grows unless it declares a
format, a pattern, or a maximum length of 80 characters or fewer. Those constrained
fields and list-item entry keep their original controls and validation. Touch
question forms retain native Return for newlines and their explicit submit button.

## Declarative input requests

An input request is a session-owned, once-only form with a title, optional
description/submit label, and flat MCP elicitation `requestedSchema`. It reuses
shared parsing, validation, fields and steps. Nested objects and OpenAI preview
descriptors are rejected. The `permission_request` transport carries
`requestKind: 'input_request'` and trusted origin/output metadata; it represents
input rather than approval.

The complete priority is real permissions → questions → agent input → full-screen
plan → MCP App consent → app/widget input → opened native composer → voice/text.
App/widget forms do not block questions, plans or consent. Covered forms retain
values, current step and picked resources across session navigation. Submission,
cancellation or owner/session disposal releases the form. An unrelated agent
interruption preserves app/widget forms. Drafts are local to each client and do
not persist across app restarts.

- Mini-app frontends and widgets call `window.superone.composer.open(spec,
  { output? })`. Default `caller` output returns `{ status: 'submitted', values }`
  only to the opening view. `agent` sends a normal user message and returns
  `{ status: 'submitted' }` without values. Both wait for submission or neutral
  cancellation; admission failures reject. The container supplies identity.
- A local mini-app Node Host uses the same spec/output/outcome contract at
  `context.composer.open(spec, { output?, session?, signal? })`. The session must
  authorize the app; an omitted session requires exactly one authorized holder.
  Only Node accepts trusted session and AbortSignal options.
- Legacy widget `window.requestInput(spec)` keeps `agent` output and opening-only
  acknowledgement. It receives no values.

Closing/reloading a frontend cancels its caller forms. Its agent forms remain
in the session, without delivering values to that view. Host exit closes only
forms the Host opened. Standalone tool views that open a form remain mounted
when scrolled off screen. Host and views share the four-form app/session quota;
widgets retain one live form per completed message.

Phone widgets use a short opening receipt and completion pushed only to the
opening device/view. Human input has no RPC deadline. Disconnect preserves the
form; reconnect reads its outcome once, without polling. Offline releases keep
the original session and are sent when the desktop connection is restored.

The host validates values and generates agent-output message content before accepting
the send. The first accepted submission wins; retrying with its original
`clientMessageId` is idempotent. The unrelated chat draft, mentions and attachments
stay intact. Invalid values restore the editable form with an error and discard
the rejected bubble. Transport errors retain a failed-send bubble and the
original submission for retry. Permanently settled requests have no resend
action. Tool rows show status without duplicating the active form.

File fields use supplied choices and optional `userOptions.kind: 'file'`. Native
picker results or uploads staged for the exact request/field prove selection;
an arbitrary existing path is insufficient. The phone supports files but reports
unsupported directory fields and offers cancellation. Node-owned forms reject
file-picker fields. Native phone forms occupy the composer slot, keep the regular
editor mounted with its draft, and use explicit Submit/Cancel; existing sheets
and transcript questions retain their entry points.

External sticky forms, remote-node mini-app/widget forms and remote-node file
picking are unsupported. Mini-app WebViews on the phone, WebView composer content
and manifest contributions remain separate future work. Form waiters
have no host-owned deadline; generic Host Action and mini-app tool deadlines
remain unchanged. Pinned Codex uses a 24-hour MCP tool limit; the stdio bridge
omits its former short timer for tool calls. Claude SDK and Grok/ACP client
timeout behavior has not been verified with live provider calls.
