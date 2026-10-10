# Mobile remote control protocol

The paired phone uses the same generation-3 RPC, topic streams and control leases
as a controller desktop. Its encrypted channel remains the phone link; it needs
no node pairing. The reducer and RN ↔ WebView contract are in
[chat-core.md](chat-core.md), cryptographic vectors in
[relay-crypto.md](relay-crypto.md), and phone discovery and reconnect in
[transport.md](../../apps/mobile/docs/agent-reference/transport.md).

| Boundary | Code |
|---|---|
| RPC, topics, scoped resources, framing | `packages/shared/src/environment/` |
| Shared dispatcher and connection delivery | `packages/runtime/src/server/`, `packages/runtime/src/stream/delivery/` |
| Desktop domain and paired endpoint | `apps/desktop/src/main/node-host/desktop-domain.ts`, `phone-endpoint.ts` |
| Authenticated LAN / relay adapters | `apps/desktop/src/main/lan-server.ts`, `remote-control-service.ts`, `remote/phone-link-host.ts` |
| Phone protocol and control proofs | `packages/relay-client/src/phone-protocol.ts`, `control-leases.ts` |
| Phone session restore and reducer | `packages/relay-client/src/restore.ts`, `apps/mobile/src/runtime.ts` |

## Authenticated compatibility and identity

The phone link handshake authenticates `host { appVersion, protocol,
environmentId }` alongside the host name and LAN addresses. The client requires
SuperOne **0.73.0-alpha.1 or later**, protocol generation 3 and a canonical
identity before sending an application RPC. An older or unreported host raises
`DesktopUpgradeRequiredError`; the native upgrade sheet shows the floor, saves
the pairing and offers Reconnect or My Devices. There are no legacy probes.
Desktop publication precedes the mobile update that enforces this floor.

The desktop domain owns one identity, database, lease service, idempotency store,
event log and session host. Disabling controller access stops its listener only;
the local window and paired phones continue using the domain. An existing local
identity can remain an alias of the canonical node-host identity; the endpoint
normalizes aliases before resource lookup, authorization and lease checks.
Session links and stored metadata therefore keep resolving without rewriting
links or repairing pairings. See [remote-node-service.md](remote-node-service.md).

## Framing and receipts

Each authenticated `rpc` link header carries one native protocol frame. Before
the generation handshake it is JSON, so an incompatible peer can read the
refusal; afterwards both directions use the shared `WireEncoder` / `WireDecoder`
(`packages/shared/src/environment/wire.ts`). The transport seals each fragment
separately. Phone requests travel in `command` envelopes, host protocol frames
in addressed `terminal` envelopes; these are relay transport containers, not
application command types. LAN and relay use identical application framing.

- A five-byte header carries the flag and authenticated original JSON length.
  Raw data is flag 0, raw DEFLATE flag 1. DEFLATE is considered above 512 bytes
  and kept only when smaller. Flag 4 compresses control replies against the
  generation's frozen schema vocabulary; flag 3 compresses pushes against the
  preceding 32 KiB of pushed plaintext. Pushes retain their order and history
  independently of control replies.
- Frames above 256 KiB use flag-2 fragments with a message id, index and total.
  The decoder bounds concurrent reassembly and aggregate bytes. Completed JSON
  is capped at 32 MiB; inflation checks its authenticated length and rejects
  malformed flags, corrupt data and oversized input. Expo uses a pure-JS
  inflater, with no Node transport dependency.
- `WireOutbox` serves the control lane before queued stream frames, including
  between fragments of a large result. A connection has a 4 MiB stream budget;
  congestion degrades the affected topic to `resnapshot` rather than retaining
  an unbounded stream. A new channel gets fresh compression and stream state.
- `RpcConnection` / `RpcInbox` own pending receipts and timeouts. An opening or
  replaced socket rejects pending RPCs; late frames from it are ignored.
  Identical selected in-flight reads share a request, without memoizing results.
  Mutations carry durable idempotency keys and controlled resource mutations
  also carry the admitted lease id and generation.
- Replies are bound to the link and channel that requested them. Async work
  cannot write a response on a replacement channel. Client-scoped pushes, such
  as composer requests and control loss, go only to the authenticated recipient.
- The secure channel supplies frame ordering and replay rejection. There is no
  application-envelope ACK; `AgentEvent.seq` remains the session-log sequence,
  independent of relay envelope numbers.

The LAN listener accepts only private-network peers (loopback, RFC 1918,
link-local, unique-local IPv6 and Tailscale), as the node listener does. Full
framing and backpressure contracts are in
[remote-node-service.md](remote-node-service.md#wire-framing).

## Topics and per-connection delivery

Main events enter `SessionEventHub`, tagged with their source. Bookkeeping,
automation, notification and collaboration consumers remain source-based.
Frontends subscribe through `TopicHub` to scoped `session`, `sessionList`,
`projects`, `drafts`, `terminal`, `terminalList` and `environment` topics.
`topic.subscribe`, `topic.update` and `topic.unsubscribe` own interest. Reading a
resource never grants mutation control. Lists have snapshot/version recovery;
terminals have an attach snapshot and output sequence; a recovery signal names
its topic. Terminal-list readers receive metadata, not terminal output.

Each connection has one `ConnectionDelivery`: tier, surface, projection,
expanded detail and throttle state. IPC is `local`; LAN, Tailscale, direct and
SSH are `lan`; relay is `relay`, taken from the chosen route rather than its
URL. A local renderer keeps its batching and Codex patch baselines. A phone uses
the `phone` surface on either link tier. Open, history, live events and detail
all use this same connection policy.

The delivery profile accumulates todo input before filtering phone-omitted
state, applies relay truncation and progress throttling, then performs phone
presentation shaping (paths, thumbnails, highlighting and heavy tool bodies).
Desktop reads are injected ports; the pipeline itself lives in runtime.
Streaming text waits up to 33 ms; non-text events flush immediately. Remote
batches cap at 64 KiB / 128 events. Sequenced deltas can share a frame but are
not coalesced away, preserving cursor deduplication.

Relay draft autosaves are coalesced per draft over five seconds; LAN readers
receive each save immediately. A coalesced notice declares `afterVersion` and
the final cursor, so the phone validates the whole compacted version span
without inferring missing events. Lease/delete notices are immediate and flush
the preceding span; disposal or removing draft interest cancels pending saves.

The renderer follows the union of open windows' interest and still broadcasts
to windows. Remote-session interest is shared by the desktop, controllers and
routed phones; each frontend retains its own delivery and detail state.
`stream/wire-baseline.test.ts` drives the production native encrypted endpoint
and Expo decoder against immutable pre-cutover recordings for a live turn,
open, history and detail. Bytes and frames must stay within that baseline.

## Sessions on a remote node

The phone reaches another execution environment through its paired desktop.
`RoutedPhoneRpcRouter` forwards scoped native methods and streams to that
source; it does not translate application commands. Capabilities are exact
served methods in the target descriptor. Local-only client methods remain on
the paired desktop, while resource methods retain their target environment.

The shared node feed reference-counts interest across the desktop's own window,
controllers and routed phones. Detail RPCs go to the source even when the
routing desktop has only summaries. A lost cursor, epoch or route-tier change
realigns through an atomic snapshot; recovery does not infer a transcript
prefix and synthesize missed output. A link reset starts a new native restore.

The authenticated desktop holds a node lease with `phone:<deviceId>` as its
delegate; its own window uses `yields`. `RoutedPhoneGrants` serializes admission
and retirement per resource. Overlapping LAN and relay links for one pairing
share a proof, and only the final link retires it. Exact upstream revocation
and expiry invalidate the matching proof and notify the SDK. An older loss
notice cannot revoke a newer grant, including a notice arriving before its
acquire receipt. Routed renderer presence derives from the current lease and
source session metadata, rather than another ownership authority.

## Atomic open, history and control

`restoreSession` buffers events, resolves the authenticated project ref and
reads `session.load` with its descriptor. The atomic load contains the newest
8 projected messages, reducer state, active turn, host restore facts and an
epoch/version cursor. Defaults omitted from compact wire state are restored
with `createDefaultChatCoreSession`. Cached complete rows merge with the fresh
tail; a bounded `session.load` after-anchor walk fills a reconnect gap, falling
back to a newest page when the anchor is gone or the gap is too long.

The phone explicitly acquires control, then subscribes to the session topic
from the load cursor. It releases buffered events in order, dropping another
environment/session and sequences at or before the snapshot version. Pending
interactions, settings, queues, usage, goal, sandbox, worktree and voice state
are restored atomically; a property reported only on change is not dependent
on a new event after reconnect. Host refusals settle to the workspace instead
of repeatedly redialling a healthy link.

Session and terminal mutations are fenced by the domain's existing
`ControlLeaseService`, across IPC, phones and controller desktops. Backends
remain unaware of frontend ownership. The SDK renews retained proofs, and
stopping an owned session releases its grant and topic stream. Takeover,
expiry, removal and channel loss invalidate admitted proofs; async mutations
recheck the exact proof before applying their result.

Earlier pages and anchored jumps use `session.load` with `includeState: false`;
`session.historyIndex` supplies message ids, bounded question/reply previews
and compact markers. The full index does not contain tool bodies. Sparse pages
merge by index position and only a contiguous DOM window is mounted.

### Hidden detail

The projection replaces bulky reasoning, tool bodies, command output, diffs
and subagent children with an opaque `remoteDetail` reference. Collapsed
summaries, file paths, line counts, status and usage remain visible. Widgets,
media, questions, todos, plans and report-findings retain their required input.

`session.subscribeDetail` returns revision 0 and registers connection interest;
`remote_detail` packets carry `{ subscriptionId, revision, offset, text }`.
The shared `createDetailClient` buffers packets before the snapshot, ignores
stale revisions and applies common-prefix replacement. A gap shows Retry.
Collapse/unmount calls `session.unsubscribeDetail`; connection disposal clears
interests. Completed text has a 1,000,000 UTF-16-unit LRU keyed by environment,
session and detail ref.

`DetailScopeProvider` supplies the session's client to the rows. The phone
uses `document-detail.ts` through RN's native bridge; the desktop uses its IPC
detail client and existing presenters. Dedicated tools load when shown,
expandable rows and subagent/workflow/collaboration cards load when opened.

## Attachments (phone → host)

Attachments travel as `session.send.images` (`ImageAttachment` with base64). The
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

The native dispatcher checks access and the admitted control proof, then
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
resolves `{ duplicate: true }` and the phone's `session.send` receipt carries
the same flag, so either client stops waiting for a reply. A queued send the backend refuses becomes a
failed row in the transcript, like any other.

The phone sends every turn, with or without attachments, as a request with a
`requestId`. An error or timeout reduces to `user_message_send_failed`, which
keeps the optimistic bubble with Resend and Edit; Edit returns its text and
attachments to the composer. The composer can therefore clear as soon as the
turn is dispatched. Before a session exists, an attachment draft stays in the
composer until `session.create` succeeds.

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
256 px thumbnails, and the original is fetched on demand with `session.attachment`
(`packages/runtime/src/stream/delivery/remote-content.ts`,
`apps/desktop/src/main/remote/attachment-thumbnail.ts`).

## Not implemented

- Conditional catalog reads (`ifNoneMatch` → `{ unchanged: true }`).
- A generic batch-read method; independent reads are separate RPCs.
- Content-hash MCP icon reads; `mcp.icons` currently returns the server map.
