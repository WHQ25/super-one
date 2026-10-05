# Chat composer slot

Desktop chat renders one composer in a shared slot below the transcript. The
slot's registry resolves the current entry by priority: session decisions,
MCP App consent, an explicitly opened composer, realtime voice, then the regular
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

## Decision queue

Each session owns its pending decisions. Desktop displays them in this stable
order: permissions in arrival order, then AskUserQuestion, then full-screen plan
approval. Only the first item is interactive. Answering an item advances the
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
drops for 200 ms, the incoming one rises for 240 ms, then the slot eases to its
new height for 200 ms. Request identity also triggers a handoff between two
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
Decision buttons and newly mounted MCP form fields do not take focus when the editor was focused within the last
second, and the base composer does not auto-focus on return when no focus needs
restoring. The restore request targets the owning session and is issued after
the editor mounts; old restore requests do not take focus on later mounts.

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
