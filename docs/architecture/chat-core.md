# Chat core and the chat-view host

`@superone/chat-core` is the one reducer that turns `AgentEvent`s into chat
session state, on the desktop and on the phone. `@superone/chat-view` is the
React DOM renderer that paints that state, inside the desktop renderer and inside
the phone's chat WebView. This doc covers ownership, the reducer contract, the
boundary rules, and the RN ↔ WebView host protocol. The phone ↔ host wire beyond
the reducer (framing, coalescing, progressive loading, attachments) is in
[mobile-remote-control.md](mobile-remote-control.md).

## Why one shared reducer

- **No double implementation.** The phone reduces the same events with the same
  code as the desktop. A new `AgentEvent` type or reducer fix reaches both clients
  in one change; a separately written mobile schema drifts silently at runtime.
- **Protocol fixes ship over the air.** The reducer, the renderer and the
  transport are JS, so they ship as Expo updates (`apps/mobile/src/updates`)
  instead of waiting for a native store release.
- **Web-shaped content renders in a DOM.** Markdown, LaTeX, mermaid, code
  highlighting and agent-authored widgets are HTML problems. The phone paints them
  in a WebView with the desktop's own presenters instead of re-implementing them
  natively. Native React Native owns input, navigation, sheets and transport.

## Ownership

| Package | Owns |
|---|---|
| `packages/chat-core` | `applyEventToSession` (`src/reducer.ts`) and every reducer family (`lifecycle`, `content`, `tool`, `permission`, `question-plan`, `slash`, `codex`, `usage`, `message-complete`, `todos`, `send-failure`); `ChatCoreSession` / `ChatCorePatch` (`src/types.ts`); `createDefaultChatCoreSession` (`src/defaults.ts`); ports (`src/ports.ts`); the hidden-detail client `createDetailClient` (`src/detail.ts`, see [Hidden detail](mobile-remote-control.md#hidden-detail)) |
| `packages/chat-view` | Shared presenters (`src/presenters/*`), the phone document (`ChatView.tsx`, `main.tsx`), the host protocol (`src/protocol.ts`, `src/bridge.ts`), the detail scope rows read (`src/detail-scope.tsx`), the separate terminal document (`terminal-main.ts`) |
| `apps/desktop/src/renderer/src/stores/chat-store/event-reducer/*` | Re-export shims plus the desktop ports adapter in `index.ts` |
| `apps/desktop/src/renderer/src/components/chat/*` | Desktop containers that import presenters from `@superone/chat-view` |
| `apps/mobile/src/runtime.ts` (`ChatRuntime`) | The phone's session state, reduced through chat-core |

Reducer and presenter fixes go in `packages/chat-core` and `packages/chat-view`,
with their tests there. Never patch a desktop shim: `event-reducer/*.ts` files only
re-export `@superone/chat-core`, and a fix applied there is lost or forks the
reducer.

## Desktop session commands

The desktop renderer uses `lib/session-client.ts` and the environment gateway
for local and node sessions. `session-turn.ts` prepares every harness's turn:
resolve the pending worktree, create the host session with the draft's selections,
apply successful app grants, build ordered content blocks and prompt suffixes,
then admit `session.send` with a stable `clientMessageId`. Only confirmed mini-app
tool registrations and successful desktop-app grants produce authorization
reminders. Queueing, retry/resend and input-request answers
use this same pipeline. Codex supplies run/review/compact through `turnKind`;
assistant text, status, thread identity and token accounting come from events.

An unsent draft keeps picker choices in renderer state. Once the host owns it,
`session.patchSettings` writes and broadcasts those choices under its control
lease. Create persists provider identity before a record can be read back, so a
new Codex or ACP session cannot be mistaken for the database's default harness.
A send captures its picker choices before activation replay; the turn keeps those
choices while taking any restored thread identity from the live session.

Phone pickers likewise stay local until a send. The host `Session` commits the
settings an accepted send carries (model, effort, Codex tier/permission
preset/collaboration mode, OpenCode agent) before backend execution: it updates
its authoritative state, persists the durable fields through the user-row write
and publishes `agent_setting_change`; subscribers may receive it afterwards. A
queued turn commits when consumed, before it runs, on every harness with a host
queue; a setting picked again after the turn was queued keeps the newer pick,
while the turn's other settings still commit. Outside Codex a queued effort
change runs after the current turn through the normal restart path. A turn
already owned by a backend keeps its captured execution parameters; a newer
pick remains the host default for later sends, which restart when needed.
A queued send promoted to that path for any reason drops the selections replaced since
its admission, so it runs on the session's newer state.
An omitted field keeps the current value; an explicit `null`/off clears it.
Model, effort, credential and Codex tier are stored; Ultracode, presets and
modes are live-session state. A settings patch reaches a warm non-Codex runtime
through a live model switch that the next send waits for; a refused switch
rebuilds the runtime on the host's model. Session-owned selections the runtime
has no kept default for (Codex permission preset and collaboration mode,
OpenCode agent) are filled from session state into every outbound turn that
omits them; turn and provider fields such as priority or thread identity are not.
The OpenCode runtime keeps no model or effort between turns, so its backend
keeps the selection a settings change or a turn's explicit values set, and
fills omitting turns from it. Clearing the OpenCode agent restarts the
runtime at the next send. OpenCode 1.x drops its sticky local agent and follows
its native default; OpenCode 2.x retains the server session's current agent
because switching it requires a concrete agent id. Every committed
`AppSettings` write
announces itself at the storage boundary, so writers outside the central patch
applier, and a patch whose side effects fail, still reach renderer subscribers.
Cold restore reads `session.load` with stored settings and the full requested
transcript; metadata reads do not start a runtime.

Local admission runs through `InProcessRpcClient` and `DesktopSessionHost`; local
events already reach the renderer through its hub and never install a second
mapped follower. Node open/send use a follower with snapshot/version recovery.
These delivery adapters feed the same reducer. Session-scoped writes retain
explicit project/session identity across asynchronous work, independently of the
currently focused pane.

## Reducer contract

```ts
applyEventToSession(session: ChatCoreSession, event: AgentEvent, ports?: ChatCorePorts): ChatCorePatch
```

- Pure: returns a patch, never mutates. `ChatCorePatch` is
  `Partial<ChatCoreSession>`; callers merge it structurally
  (`{ ...session, ...patch }`). Events the chat does not model fall through to `{}`.
- `ChatCoreSession` is the set of fields the reducer reads or writes. Composer,
  navigation and other desktop-only fields (drafts, attachments, mentions, title,
  git/worktree UI) are deliberately outside it. Desktop's `PerSessionState` is a
  superset; the desktop adapter casts the patch back to `Partial<PerSessionState>`.
- Adding state the reducer writes means adding it to `ChatCoreSession` and a
  default in `createDefaultChatCoreSession`. There is no separate key table to
  maintain; the type is the contract.
- `model_fallback` has no patch key: the host appends a transcript row, and the
  renderer paints that row.

### Ports

```ts
interface ChatCorePorts {
  now(): number
  id(prefix: string): string
  trace?(channel: string, name: string, payload: unknown): void
  streaming: StreamingToolInputStore
}
```

Clock, ids, tracing and the streaming tool-input buffer are injected, so the
package reads no browser or Electron globals. `StreamingToolInputStore` holds the
raw partial JSON of streaming tool inputs, keyed by tool use and owner session;
`createStreamingToolInputStore()` gives a host an isolated instance. The only
mutable module-level state in the package is the default store behind
`defaultChatCorePorts`, confined to `ports.ts`. Desktop passes
`defaultChatCorePorts` plus `trace: window.app?.trace`; the phone uses the
defaults. On the phone the streaming store stays empty because the host never
forwards `tool_input_delta` (see [Remote-omitted events](#remote-omitted-events)).

`packages/chat-core/src/oracle.test.ts` replays recorded desktop sessions
(`src/fixtures/recorded.generated.ts`, regenerated by `bun run fixtures:export` in
the package) and snapshots the reduced state.

## Boundary rules

Enforced by source-scanning tests; a violation fails the suite.

| Test | Bans |
|---|---|
| `packages/chat-core/src/boundary.test.ts` | Imports of `zustand`, `electron`, the desktop `@/` alias, any `apps/desktop` path, parent (`../`) imports; `window.` access; a module-scope `new Map` (no hidden module state; state shared across sessions comes through ports) |
| `packages/chat-view/src/boundary.test.ts` | Across the package: `@/` alias, `zustand`, `electron`, desktop preload bridges (`window.agent`, `window.app`, `window.browserHost`, `window.electron`, `window.environment`, `window.miniapp`, `window.terminal`), and any composer (`ChatInput`, `<textarea>`). Also asserts phone assistant turns render through the shared `TurnBodyPresenter` and `ToolGroupPresenter` rather than local copies |
| `packages/chat-view/src/presenters/boundary.test.ts` | In presenters: `@/` alias, `zustand`, `electron`, parent imports, desktop `ToolBlock` imports, desktop preload bridges |
| `apps/desktop/src/renderer/src/stores/chat-store/event-reducer/boundary.spike.test.ts` | In the desktop shims: `../index`, `zustand`, `../slices/`, `@/stores/`, `@/components/`; `window.` anywhere but `index.ts`; any family file that does not re-export from `@superone/chat-core` |

DOM `window` (scroll, resize) is allowed in chat-view: it is that renderer's own
document.

## User bubble

A user message's content is one presenter on both hosts:
`UserMessageContentPresenter` (`presenters/UserMessageContent.tsx`) draws quoted
selections, then the blocks in written order — attachments as inline chips, text
through `UserTextPresenter` (mentions, paste chips, prompt keywords), tool calls
as the host's `Block`. The composer's chips (attachment, paste, quotes, mention
icons) are the same presenters. What differs per host is a `UserBubblePorts`
object (`presenters/user-bubble-ports.tsx`) provided by context:

| Port | Desktop (`components/chat/user-bubble-ports.tsx`) | Phone (`portable-user-bubble-ports.tsx`) |
|---|---|---|
| `MentionIcon` | mini-app / desktop-app / MCP icons from stores and IPC, image file thumbnails | `mentionArtwork` and `mcpIcons` from the projection |
| `FileMention` | click opens, icon drags, right-click file menu | tap → `previewFile` |
| `McpMention`, `ChipCard` | hover cards | tap popover; no hover card |
| `AttachmentViewer` | image lightbox, PDF dialog | picture: `loadAttachment` → native `previewImage`; PDF: `previewAttachment` → file preview page |
| `QuoteBody` | highlighted against the project file | plain text |

Only artwork and interaction are host-bound; labels, chip chrome, copy
attributes and which keywords are painted stay in the presenters.

## Assistant turn

Every harness's assistant turn is `message.content`, and both hosts draw it
with `TurnBodyPresenter` (`presenters/TurnBody.tsx`): the desktop with its parts
in `components/chat/ChatMessage.tsx`, the phone with the portable parts in
`PortableTurnAdapters.tsx`. A harness feature needs a content block or an
event, not a renderer branch.

Content blocks may carry an `id`. `applyContentDelta`
(`packages/shared/src/content-delta.ts`) finds a delta's block by type,
`parentToolUseId` and `id`: `text` and `thinking` append (`replace: true`
rewrites), `plan`, `review` and `notice` upsert; without an id the positional
merge applies. A running command streams `tool_use.outputDelta` into
`liveOutput`, which is durable content, so Stop, reconnect and snapshots keep
partial output; its `tool_result` carries the final output and drops
`liveOutput`. Turn diffs are not supported; per-file `FileChange` rows are the
file-change surface.

### Codex turns

Codex app-server items are translated at the integration layer by
`createCodexContentStream` (`packages/shared/src/codex-content.ts`). Desktop
`codex-backend.ts` and the CLI node's `packages/codex` mapper send
`content_delta` (and `todos_updated` for a todo list) and complete with
`metadata.codex` whose `items` is empty; `codex_*` events carry only thread and
turn identity, usage, provenance, MCP startup and plan approval. The item
mapping is in [Codex contracts](../harness/codex/contracts.md#turn-content).

Turns stored before that carry their rows in `metadata.codex.items`
(`isLegacyCodexMessage`). They are history, not a wire format.
`withCodexContent` / `withCodexContents` derive their content at client
ingress: chat-core `applyEventToSession` after every write, desktop hydration
and snapshot merges, and the mobile runtime's `hydrated()`. Shared readers use
`readableContent`. Main keeps them in their stored shape, because their stored
text (final response or interrupt notice) cannot be rebuilt from items, and
`transcriptSegments` still cuts them by item. These adapters stay until stored
legacy history is migrated or retired. Older builds show only the text of a
content-shaped Codex turn. Clients and hosts update together, so no version
skew is handled: a host that still streams items is not read live.

## State split on the phone

RN holds the complete `ChatCoreSession` in `ChatRuntime.session` and applies every
patch to it. The WebView receives a projection, never the session:

- **WebView** gets `ReductionProjection` (`packages/chat-view/src/protocol.ts`):
  transcript rows, and the `SessionProjection` facts a turn cannot derive itself
  (session status, streaming token counts, compact/recap state, API retry, the
  pending-turn line, project root for link resolution), plus display-only extras
  (labels, mention artwork, MCP icons, history flags) and a `pendingPermission`
  summary (`requestId`, `toolName`, `toolUseId`) that marks the waiting tool row.
  Queued messages are drawn here too, after the transcript as on the desktop: the
  sent user bubble dimmed, its steer/edit taps sent back as `queuedMessageAction`.
- **RN** keeps everything else and renders it natively: pending permissions,
  questions and plan approvals (native sheets), permission mode, model / effort /
  harness settings, todos, prompt suggestions. The WebView never
  owns a picker or a sheet.

The principle: the WebView gets what the transcript paints and nothing that drives
input. When a presenter needs a new session fact, add it to `SessionProjection`
rather than sending the session.

## Remote-omitted events

The host drops some events before they reach any phone: `SKIPPED_EVENTS` in
`apps/desktop/src/main/remote-control-service.ts`. They feed desktop-only state
or bookkeeping the phone does not render (hooks, persisted-file notices,
elicitation completion, checkpoints, stream start/stop markers, streaming tool
input, subagent token usage). Consequences for the phone's
reduced state:

- `_streamingToolInputPreviews` stays empty (no `tool_input_delta`).
- `subagentTokens` does not advance from `subagent_usage`; subagent cards update
  from `task_progress` / `task_notification`.
- There is no rewind UI (no `checkpoint_captured`).

Also on that path: `tool_progress` is throttled to one per 2 s, and
`slash_command_output` is forwarded but truncated at 200,000 characters. A test or
oracle scoring the phone must not expect state that only omitted events produce.
Adding a new event type means deciding whether the phone needs it; the default is
to forward.

## Host protocol (RN ↔ chat-view)

Types: `HostInbound` / `HostOutbound` in `packages/chat-view/src/protocol.ts`.
The WebView never reduces `AgentEvent`s. RN reduces through chat-core and sends
pre-reduced projections.

### Transcript delivery

1. `ChatRuntime.ingest` reduces each event, then schedules one paint per
   `AGENT_EVENT_BATCH_MS` (33 ms, `setTimeout`, not rAF). Restore and explicit
   actions flush immediately.
2. `TranscriptDelivery` (`apps/mobile/src/transcript-delivery.ts`) keeps one
   unacknowledged projection in flight and coalesces later snapshots into one
   pending one.
3. `TranscriptProjection` sends only rows whose object identity changed
   (`messagePatches`) and sends `messageOrder` only when rows were inserted,
   removed or reordered. A `hydrate` sends the full `messages` array and supersedes
   pending work.
4. Every delivery carries `{ channelId, sequence }`. The document
   (`packages/chat-view/src/bridge.ts`) answers `transcriptApplied`; duplicates
   are acknowledged without reapplying and retired channels are ignored. A missing
   receipt retransmits the same projection after 1 s. Only an acknowledged paint
   can be followed by a diff.

Realtime voice segments are merged into the message list before projection
(`apps/mobile/src/navigation/use-transcript-sync.ts`).

### Inbound (RN → WebView)

| Message | Role |
|---|---|
| `initialize` / `hydrate` / `reset` | Full baseline; `reset` clears the document (sent when the new-session landing shows, so an old transcript cannot leak into the next first send) |
| `applyReductionPatch` | Changed rows, order and facts (above) |
| `prependHistory` | Older page from `loadEarlier` |
| `detailUpdate` | Streamed hidden detail for an expanded row |
| `setConnection { state, epoch }` | Connection state; epoch changes when a restore releases its buffer |
| `setTheme` / `setViewport` | Theme hue and scheme from the shell; safe area, font scale, locale |
| `setWindow` / `scrollToTurn` | DOM window range and jumps |
| `nativeActionResult` / `nativeActionProgress` | Replies to `requestNative` |
| `channelToken` | Per-document secret, sent after `ready` (see [Trust](#trust)) |

### Outbound (WebView → RN)

| Message | Role |
|---|---|
| `ready` | Document (re)loaded: RN re-sends theme, viewport and connection, then hydrates |
| `transcriptApplied` | Delivery receipt |
| `viewState` | Window range, bottom pin, anchor and expanded keys, persisted by RN (`apps/mobile/src/chat-view-state.ts`) |
| `requestNative` | Host actions: files, links, image and video loading, previews, detail subscriptions, history paging and navigation, failed-send resend/edit, widget saving. Handlers: `apps/mobile/src/native-actions.ts` |
| `error { fatal }` | Triggers bounded reload + hydrate (`apps/mobile/src/chat-view-recovery.ts`) |

### Trust

The native bridge reaches every frame in the WebView, not only the chat
document: iOS registers `webkit.messageHandlers.ReactNativeWebView` in all
frames, and Android injects `ReactNativeWebView` into every origin. Frames
inside the transcript (widget iframes) must not act as the document:

- RN answers `ready` with `channelToken` through `injectJavaScript`, which runs
  only in the main frame. The document attaches it to every outbound message as
  `channel` and holds non-boot messages until it arrives. RN
  (`apps/mobile/src/screens/chat-webview-channel.ts`) drops anything without the
  current token; before one is issued only `ready` and a fatal `error` pass, and
  a main-frame load start clears it.
- The document applies `message` events only from its embedding host (no
  source, or `window.parent`); RN itself delivers through `__applyHost`.
- The document's CSP is `frame-src 'none'` (`packages/chat-view/index.html`).
  `srcdoc` frames still load, but a frame cannot navigate itself to a new
  document. This matters on Android, where an `https:` sub-frame navigation
  never reaches `onShouldStartLoadWithRequest`.

### Document rules

- The WebView owns full-screen scroll; header and native `TextInput` are RN
  overlays. Never nest the chat WebView in an RN `ScrollView`. There is no
  composer in chat-view.
- DOM windowing is mandatory: `CHAT_WINDOW` in
  `packages/chat-view/src/chat-window.ts` (8 initial turns, 40 mounted at most).
- Code widgets (`widget_show`) render in a sandboxed iframe inside the document
  (`PortableWidgetBlock.tsx`), sharing `buildWidgetSrcdoc` with the desktop.
  Mini-app renderers are not supported on the phone: they need the desktop's
  mini-app host, so `miniapp_call` rows show a header card only
  (`PortableToolRow.tsx`).
- The terminal is a separate WebView document with its own channel
  (`type: 'terminal'` frames). Terminal frames never touch event buffering,
  sequence tracking or ACKs.
- `generated-host-html.ts` and `generated-terminal-html.ts` are build output
  (`bun run build:chat-view`), gitignored.

## Open, reconnect and buffering

Every restore is buffer-first, owned by the client (`restoreSession` in
`packages/relay-client/src/restore.ts`, `EventBuffer` in `buffer.ts`):

```
startBuffering
  → session.load (atomic state, projected page, active turn and cursor)
  → merge cached complete rows / bounded after-anchor history
  → control.acquire, then topic.subscribe from the snapshot cursor
  → release newer buffered batches in order, epoch += 1
```

- Native topic batches queue while buffering. Reconnect or `resnapshot` performs
  the same atomic load; the source environment and cursor decide which events
  can apply, including when the paired desktop routes a node session.
- `ChatRuntime` seeds the load's reducer state and host facts (live turn, pending
  interactions, usage, sandbox, worktree, voice segments and goal), then replays
  only batches newer than the snapshot version before hydrating the document.
  Compact wire defaults are restored with `createDefaultChatCoreSession`.
  Harness properties reported only on change are already in the atomic state.
- Older runtime epochs are dropped; overlapping restores commit only their
  newest generation. The authenticated desktop-version and generation gate
  rejects unsupported hosts before restore; there are no old-command probes.
- Cache merge, reconnect backoff, liveness probing and discovery are phone-side:
  [transport.md](../../apps/mobile/docs/agent-reference/transport.md).

## Transports

`RelayClient` (`packages/relay-client/src/client.ts`) has exactly one active
socket; connecting over LAN replaces relay and vice versa. The desktop's per-link native wire seals protocol frames on the channel that
requested or subscribed to them (`node-host/phone-endpoint.ts`).

Frame handling is `handleInboundFrame` in `packages/relay-client/src/frames.ts`:

- The envelope sequence is ignored. The secure channel orders and deduplicates
  every sealed frame (a replayed or reordered one fails to open), so there is
  no envelope ACK.
- Frames are sealed for one connection's channel
  ([relay-crypto.md](relay-crypto.md#phone-link)), so a reconnect over either
  transport asks for no replay and is a full restore.
- The envelope sequence is never written onto `AgentEvent.seq`, which the
  session assigns for replay deduplication.
