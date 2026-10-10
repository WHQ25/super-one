# Mobile remote control protocol

How the phone and a desktop host talk beyond the shared reducer: payload framing,
host-side event batching, request/response binding, progressive session loading,
and attachments. The reducer, the RN ↔ WebView host protocol, buffer-first restore
and ACK rules are in [chat-core.md](chat-core.md). Encryption and golden vectors
are in [relay-crypto.md](relay-crypto.md). Phone-side discovery, reconnect and
caches are in [transport.md](../../apps/mobile/docs/agent-reference/transport.md).

| Side | Code |
|---|---|
| Command and event types | `RemoteCommand`, `AgentEvent` in `packages/shared/src/agent-types.ts` |
| Host transport | `apps/desktop/src/main/remote-control-service.ts` (relay), `apps/desktop/src/main/lan-server.ts` (LAN), `apps/desktop/src/main/remote/*` |
| Host command handlers | `apps/desktop/src/main/agent/agent-service.ts` |
| Phone transport | `packages/relay-client/src/*` (`RelayClient` in `client.ts`) |
| Phone session | `apps/mobile/src/runtime.ts` (`ChatRuntime`) |

## Payload framing

Every application payload is one sealed frame of the phone's per-connection
channel, base64 encoded inside a JSON envelope (`{ type, data, … }`); the sealed
body carries an authenticated link header before the payload
([relay-crypto.md](relay-crypto.md#phone-link)). The two directions differ on purpose:

- **Host → phone** (events, responses, terminal frames): the plaintext is a
  five-byte header, `flag:u8` (`0x00` raw, `0x01` raw DEFLATE) and the original
  JSON byte length as `u32be`, followed by the body. The header is inside the
  authenticated plaintext. Encoder: `frameHostPayload` in
  `apps/desktop/src/main/remote/payload-codec.ts`, using `frameRemotePayload` from
  `packages/shared/src/remote-payload.ts`; the frame is built once and sealed
  per phone channel. Decoder: `decodeHostPlaintext` in
  `packages/relay-client/src/host-payload.ts`.
- **Phone → host** (commands): plain JSON, no header, no compression
  (`RelayClient#sendCommand` in `packages/relay-client/src/client.ts`). Compressing this
  direction would cost phone CPU and has not been shown to pay off; add it only on
  measured benefit, as a header change on both sides.

Rules:

- The host deflates only when the JSON exceeds 512 bytes, on Node's zlib worker
  pool so Electron main is not blocked, and keeps the deflated body only if it
  is smaller than the raw JSON.
- JSON is capped at 32 MiB (`MAX_REMOTE_PAYLOAD_BYTES`) on both sides. The phone
  rejects ciphertext above the matching base64 bound before decrypting, and
  inflates into a buffer sized from the authenticated length plus one byte, so a
  corrupt or lying stream cannot allocate unbounded memory. Unknown flags, corrupt
  streams and size mismatches are errors.
- Responses are chunked after encryption: ciphertext over 800,000 characters
  (`REMOTE_RESPONSE_CHUNK_CHARS`) goes out as `response_chunk` frames. The phone
  (`packages/relay-client/src/rpc.ts#ingestChunk`) validates index, total, chunk
  size and aggregate size, reassembles, then decrypts and inflates once. Event
  frames are not chunked; the batcher bounds them.
- Relay and LAN use the same framing. Compression is inside the ciphertext, so
  the relay forwards opaque payloads and its envelopes and control frames are
  unaffected. There is no version negotiation: desktop and phone upgrade together,
  and phones paired before per-device channel secrets must pair again.
- The LAN server listens on every interface but drops peers outside private
  networks (loopback, RFC 1918, link-local, IPv6 unique-local, Tailscale) on
  `connection`, like the desktop node ([remote-node-service.md §11.3](remote-node-service.md)).
- Fixture: [`host-payload-v1.json`](../../packages/relay-client/src/fixtures/host-payload-v1.json)
  holds raw and deflated frames, checked by `host-payload.test.ts`.

## Host event pipeline

Every event in desktop main leaves through `SessionEventHub`
(`apps/desktop/src/main/stream/session-event-hub.ts`), tagged with where it
entered (a local `Session`, environment state, lists, presence, a remote node).
In-process consumers subscribe by source; frontends receive by topic. Each event
is published to its one topic (`publishHubEvent` in `stream/desktop-topics.ts`),
and a local session's event first publishes its `session_activity` summary to
the session list topic. Each online phone holds a topic connection
(`remote/phone-topics.ts`): the session list, projects, drafts, terminal list
and environment notices always; a session while the phone subscribes to or
controls it; a terminal while it watches or controls it.

`MobileBroadcaster` (`apps/desktop/src/main/remote/mobile-broadcaster.ts`) is the
phones' delivery group: the topic hub hands it each item once with the phones
it reached. List and environment topics go to every phone; a session's events
go to the phones its topic reached and, for progressive devices, get the
summary projection ([below](#progressive-session-loading)).
`RemoteControlService#sendAgentEvent` then runs the `mobile` profile
(`MobileEventProfile`, `apps/desktop/src/main/stream/mobile-profile.ts`) and
batches before encryption. A golden test on recorded sessions
(`profiles.golden.test.ts`) pins the frames this produces; it is the phone wire
guard.

1. Drop `SKIPPED_EVENTS`, throttle `tool_progress`, truncate
   `slash_command_output` ([chat-core.md](chat-core.md#remote-omitted-events)).
2. Strip or summarize heavy tool payloads
   (`apps/desktop/src/main/remote-content.ts`): bash output, todo tool results,
   project paths.
3. Batch per target set with the shared `createEventBatcher`
   (`packages/runtime/src/stream/event-batcher.ts`, also the renderer
   transport's batcher):
   - Only `content_delta` and `codex_item_delta` wait, up to 33 ms. Any other
     event flushes the batch it joins immediately, so completions, status
     changes, interactions and interrupts are never delayed behind text.
   - A change of target devices flushes first; a batch never mixes recipient
     sets. Batches are also capped at 64 KiB and 128 events.
   - `coalesceAgentEventBatch` (`packages/shared/src/agent-event-batcher.ts`)
     folds only adjacent unsequenced text/thinking deltas of the same block, and
     successive `codex_item_delta` snapshots of the same item. Deltas carrying
     `seq` may share a frame but are never folded, so replay deduplication can
     advance one sequence at a time.
   - Non-`AgentEvent` payloads sent through `sendEventToMobile` flush the batcher
     first, preserving order.
4. One serial queue frames each batch once, then seals one copy per phone
   channel: relay copies are addressed to that phone, LAN copies go to its
   socket, and each copy is ordered by that phone's channel sequence. Phones
   without a channel get nothing. Terminal frames use their own serial queue.

`stop()` disposes the batcher and bumps `sendGeneration`; queued work from the old
generation is discarded rather than sent on a new connection.

### Sessions on a remote node

A phone reaches a CLI-node or desktop-node session only through its paired
desktop (`apps/desktop/src/main/remote/environment-commands.ts`); there is no
phone-to-node link. The desktop opens the session at a `session.load` barrier,
follows it on its one node subscription ([remote-node-service.md](remote-node-service.md#92-event-log)),
reduces the node's events with chat-core, and sends them through the same
`mobile` profile. The node runs no phone profile: the desktop already holds
that projection state, and the wire stays the desktop's.

- A connected phone does not restore on the relay's `reset` frame. When the
  node reports that events the phone missed are gone (`resnapshot`), the
  desktop reloads the snapshot and sends the difference as `message_start`,
  `content_delta` and terminal events (`routed-catch-up.ts`). A phone whose
  messages are not a prefix of the snapshot gets `status_change: error`.
- The desktop holds the node's control lease for each phone with the phone's
  device id as `delegate`; its own window acquires with `yields`. A second
  phone is refused while one holds the session.
- While a phone holds it, the desktop window shows observation mode for that
  node session (`remote_session_start` presence). Disconnect there kicks the
  phone (`session_kicked`) and releases its lease.

## Requests and responses

- `RelayClient.request` attaches a `requestId` and times out after 15 s.
  Identical in-flight reads (`get_git_info`, `get_system_info`,
  `get_project_resources`, `list_sessions`, `list_drafts`,
  `list_pinned_sessions`) share one request (`request-coalescer.ts`); completed
  results are never memoized there. `send` is fire-and-forget.
- **Responses are bound to the connection the command arrived on.** The relay
  responder captures the socket, `sendGeneration` and the phone's channel when the
  command arrives and drops the response if any changed, including after the
  asynchronous compression step. The LAN responder captures the originating
  socket and its channel. A response
  therefore never lands on a newer connection that did not ask for it.
- On the phone, opening a socket fails every pending RPC (`connection replaced`)
  and frames from a replaced socket are ignored.
- Late responses are checked against the request that is still current, not
  just the connection:
  - `ChatRuntime.restoreGeneration` guards restore, history paging, the history
    index, anchor jumps and send receipts; a switched session discards them.
  - The shell's project and branch loads (`openProject`, `loadShellDetails`,
    branch lists in `apps/mobile/src/navigation/mobile-app.tsx`) compare a request
    counter and the client identity before applying, so a slow reply cannot
    overwrite a newer project selection.

## Progressive session loading

The phone opens a bounded summary of a session; the persisted host transcript
stays complete.

### Open

`subscribe_session { progressive: true }` subscribes the device, replays pending
events, and answers with `buildProgressiveBootstrap`
(`apps/desktop/src/main/agent/progressive-bootstrap.ts`): the newest 8 messages
as a summary projection, the history cursor, `navigationAvailable: true`, the
harness id, and the session snapshot, in one response. The phone reveals its
cached page first when it has one and merges it with this page.

Older hosts that answer `subscribe_session` without a history page get the
fallback in `packages/relay-client/src/restore.ts`: without a cached transcript,
`load_session_messages { limit: 8 }` then `get_session_state` if the subscription
did not include a snapshot. With cached complete rows, restore first asks for
messages after the last cached ID and falls back to the newest page if that
anchor fails. Without `navigationAvailable` the phone keeps the rail over loaded
history only. Keep this compatibility path covered by `restore.test.ts`.

No minimum desktop version is currently enforced by this protocol. The product
policy is to introduce a minimum supported desktop version and retain tested
fallbacks within that supported range. The floor, version handshake and rollout
remain planned in [mobile desktop compatibility](../tasks/mobile-desktop-compatibility/README.md);
the planned gate must not be described as active before it is implemented.

`loadEarlier` fetches one older page by cursor (`load_session_messages
{ cursor, limit: 24 }`), deduplicates against live rows, and keeps the scroll
anchor.

### Hidden detail

The projection (`apps/desktop/src/main/remote/progressive-session.ts`,
`progressive-tools.ts`) empties bulky content and replaces it with an opaque
`remoteDetail` reference (`[messageId, kind, key]`): thinking blocks, Codex
reasoning items, tool inputs and results, command output, file diffs, and the
children of subagent cards. What the row must show collapsed stays: tool summary
and file path, `+N -M` line deltas, subagent usage and status, bash-edit file
totals. Widgets, media and image tools, questions, todos, plan-mode and
report-findings tools are not deferred (`deferTool`). Live events for progressive
devices go through `projectProgressiveEvent`, so the same projection applies to
streaming, completion metadata and reconnect snapshots.

Expanding a row:

1. The document asks RN (`subscribeDetail`), RN sends
   `subscribe_detail { detailRef, subscriptionId }`. The host registers the
   interest for that device and answers with a revision-0 snapshot. A device holds
   at most 64 detail subscriptions, and only for its current progressive session.
2. As the message changes, the host emits `remote_detail` events to that device:
   `{ subscriptionId, revision, offset, text }`, where `offset` is the length of
   the unchanged common prefix and `text` the new suffix. Prefix replacement
   covers both appended reasoning and tool JSON whose closing characters move.
   Suffixes are split into 64,000-character packets.
3. The document (`packages/chat-view/src/use-deferred-text.ts`) buffers packets
   that arrive before the snapshot, applies them in revision order, and ignores
   stale revisions. A gap (offset beyond the current text) surfaces as an error
   with Retry.
4. Collapse or unmount sends `unsubscribe_detail`. Subscribing to another
   session, `leave_session` and `unsubscribe_session` drop all of a device's
   interests.

Completed detail text is cached in the document in an LRU bounded to 1,000,000
UTF-16 code units (`packages/chat-view/src/detail-cache.ts`); reopening a cached
completed block does not fetch again.

### History navigation

`get_session_history_index` (`apps/desktop/src/main/session/history-navigation.ts`)
returns every message id, a turn outline with question/reply previews capped at
160 characters (`HISTORY_PREVIEW_LENGTH`), and compact markers
(`SessionHistoryIndex` in `packages/shared/src/session-history-index.ts`). SQLite
extracts only text previews; tool bodies, reasoning and metadata never enter the
response. The index covers the whole session and is not paged. The document
requests it through RN (`loadNavigationIndex`) without blocking the first paint,
and `ChatRuntime` extends it locally as new turns arrive.

A jump outside loaded rows uses `load_session_messages { anchorId, direction:
'around' | 'before' | 'after', limit: 8 }`; the host seeks the anchor directly
(limit clamped to 1–40) instead of walking pages. Pages merge by index position
(`mergeIndexedHistory`), so the loaded transcript can be sparse: the rail shows
the full timeline, and crossing a gap requests the neighboring page first. Only a
contiguous window is mounted. Both commands check project/session access.

## Attachments (phone → host)

Attachments travel as `send_message.images` (`ImageAttachment` with base64). The
phone re-encodes pictures before sending
([transcript.md](../../apps/mobile/docs/agent-reference/transcript.md)).

### Limits and admission

`packages/shared/src/attachment-validation.ts` is shared by composers and hosts:

| Limit | Value |
|---|---|
| Decoded bytes per file (`MAX_ATTACHMENT_BYTES`) | 4,000,000 |
| Files per turn (`MAX_TURN_ATTACHMENTS`) | 8 |
| Decoded bytes per turn (`MAX_TURN_ATTACHMENT_BYTES`) | 12,000,000 |
| Serialized text + attachments (`MAX_ATTACHMENT_TURN_JSON_BYTES`) | 20,000,000 |

Base64 and padding are validated, and the sniffed signature must be JPEG, PNG,
GIF, WebP or PDF and match the declared MIME type. The phone runs the same check
before sending.

On the host, `send_message` runs inside `withTurnReceipt`
(`apps/desktop/src/main/remote/turn-receipt.ts`): access check, then
`admitTurnAttachments` (`packages/shared/src/attachment-turn.ts`) validates and
writes every file under `$TMPDIR/super-one-attachments` before the turn is
recorded or queued. The receipt `{ ok: true }` is sent when the session admits the
turn, not when the provider finishes. A refusal before admission answers the
request with an error; a failure after admission reaches the device as
`user_message_send_failed`, unless the input already reached the agent. Each
backend (and each node `TurnRunner`) calls `onInputAccepted` immediately before
the call that submits the input — prompt RPC, SDK stream push — so a failure
with an uncertain outcome counts as delivered; agent output also counts, while
lifecycle events the backend emits itself (`message_start`, status) do not.
When the input never reached the agent (the runtime would not start, the
backend failed before submitting), `Session` drops the empty assistant rows
the backend opened (`discardedMessageIds` on the event) and records the failure
on the user row (`metadata.sendFailure`), so
a phone that was disconnected, or a reloaded window, restores it as a failed
send. Resend without the original request (`failedMessageResend` in
`packages/shared/src/send-failure.ts`) sends the row again under its own id; the
host reuses the row, clears its failure and broadcasts `user_message_send_retried`
so every other client drops its Resend. A send of an id the host already took
(admitted, queued, answered or running) is held, not run again: `Session.send`
resolves `{ duplicate: true }` and the phone's `send_message` receipt carries
the same flag, so either client stops waiting for a reply. A queued send the backend refuses becomes a
failed row in the transcript, like any other.

The phone sends every turn, with or without attachments, as a request with a
`requestId`. An error or timeout reduces to `user_message_send_failed`, which
keeps the optimistic bubble with Resend and Edit; Edit returns its text and
attachments to the composer. The composer can therefore clear as soon as the
turn is dispatched. Before a session exists, an attachment draft stays in the
composer until `create_session` succeeds.

### Delivery to the agent

Every harness adapter calls `buildAttachmentTurn`, which reuses the admission
write and produces a path note (`name → path`) appended to the prompt:

- **Claude, ACP, OpenCode, Cursor, DeepSeek, and the CLI remote node's Claude
  runner:** images go inline as image blocks and by path, so the model sees the
  picture without a `Read` call while file-path tools (image editing,
  `reference_image_paths`) still get a path.
- **Codex (desktop and CLI):** `buildCodexAttachmentInput` sends the text plus one
  `localImage` item per saved image; Codex reads the file itself and inlines it.
- **PDFs** are path-only everywhere: inlining a long PDF can consume the context
  in one turn, so the agent reads the pages it needs.

A file that cannot be saved fails the send with a retryable error rather than
degrading to inline-only delivery.

The phone does not pay for its own bytes twice: the host echoes
`user_message_appended` to the sending device without base64, transcripts carry
256 px thumbnails, and the original is fetched on demand with `get_attachment`
(`apps/desktop/src/main/remote/attachment-echo.ts`, `attachment-thumbnail.ts`).

## Not implemented

- Conditional fetch (`ifNoneMatch` → `{ unchanged: true }`) for catalog RPCs.
- `subscribe_session { afterMessageId }` delta paging; restore always returns the
  newest page and merges on the phone.
- A generic `batch` read command; independent reads are separate requests.
- `get_mcp_icon_bytes` / content-hash MCP icons; `get_mcp_icons` returns the
  full server name → icon src map (https or data URI) on every call.
