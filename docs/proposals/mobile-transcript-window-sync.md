# Mobile transcript windows and incremental cache synchronization

Status: accepted (Phase 0 decisions below) · Updated: 2026-10-13

## Problem

Opening a mobile session currently requests the newest eight messages, not eight
turns. A message can contain a very long agent reply. A live session also returns
active-turn messages outside that page, so neither eight messages nor one active
turn provides a useful bound on transfer size, parsing work, or rendering work.

The phone already caches transcripts and merges fresh history by message ID.
However, restore first downloads the newest eight messages even when their
content is cached. This deduplicates local rows after transfer rather than
avoiding redundant transfer. A previously streaming message can also change
without creating a new message ID.

Desktop transcript virtualization limits mounted rows and segments. Mobile has
bounded message rendering and deferred details, but these do not make an entire
long message cheap to download or parse. Transport windows and rendering windows
need to operate inside messages as well as between messages.

## Desired behavior

- On a cold open, show the latest content sufficient for approximately one
  viewport, with a small overscan. This may be only the tail of one agent reply.
- On reopening a cached session, reuse unchanged content and download only new
  or changed content needed by the visible window, plus current session state.
- If six complete, unchanged messages are cached and two were added, transfer
  only the needed portions of the two new messages. If the sixth message was
  still streaming, synchronize its missing content or edits too.
- Scrolling upward loads older content, including earlier portions of the same
  message, without moving the user's visible anchor.
- Continue a running reply from the restored position without missing or
  duplicating text, tools, status transitions, or user interactions.
- Keep permissions, questions, todos, usage, voice controls, and agent settings
  correct even when their originating transcript content is outside the window.

## Scope

Introduce a shared, opt-in transcript-window contract implemented by execution
hosts and consumed by mobile. Preserve the existing full-message APIs for other
clients. Reuse shared segmentation where appropriate; do not require a desktop
transport migration as part of this work.

This proposal does not change provider history or discard canonical messages.
The host retains authoritative full content. The phone stores explicitly partial
projections and must never represent them as complete canonical messages.

## Content window model

A window consists of ordered, addressable fragments rather than full messages.
Each fragment identifies its message, content block, range, and revision, with
enough lightweight message metadata to preserve identity and presentation.
Separate completeness flags and older/newer cursors describe unloaded content.

Use stable block identities and bounded fragments within oversized text blocks.
A single paragraph, code fence, table, tool block, or metadata field must not
silently bypass the size bound. Heavy tool bodies, diffs, images, and embedded
app resources continue to use references and explicit loading.

Markdown fragments need rendering context: fence language and continuation,
list/table context, and necessary reference definitions. Do not render arbitrary
string slices as independent complete Markdown documents. Prefer reusable
semantic segmentation, but split oversized semantic blocks with an explicit
continuation representation. Stable fragment identity must survive streaming
appends; edits may invalidate only the affected range and its parsing context.

The client sends viewport dimensions and a bounded content budget. The host
estimates enough tail content for a viewport plus overscan; after layout, the
client fills any remaining space through bounded requests. Exact screen filling
cannot be calculated by the host because fonts, wrapping, and expanded details
are client-dependent. Hard serialized-byte and fragment limits take precedence
over the estimate, including for the first fragment. Initial tuning values must
come from measurements, rather than another fixed message count.

## Proposed protocol

Names below are illustrative and remain subject to contract review.

`session.transcriptWindow` accepts a session reference, tail or stable fragment
anchor, direction, viewport hint, hard byte/fragment budgets, and an optional
cache checkpoint. It returns:

- A window manifest containing ordered fragment IDs, revisions, coverage, and
  metadata references.
- Bodies only for fragments missing from or changed since the client's cache.
- Explicit replacement, deletion, and invalidation operations where needed.
- Older/newer fragment cursors, including positions within a single message.
- Current session state and restore facts on opening/restoring, independently
  of which transcript fragments are included.
- An atomic stream cursor and checkpoint covering the returned state, manifest,
  and content revisions.

Use the existing environment/session identity and authentication boundary.
Capability negotiation selects this contract only on hosts that implement it.
The legacy restore path remains available for older hosts; report its different
performance characteristics in diagnostics.

The snapshot cursor and cached baseline cursor have different meanings. A fresh
cursor must not imply that omitted content was synchronized. Checkpoints record
only acknowledged fragment coverage and versions. Paged content-only responses
must not replace authoritative restore state with defaults or advance unrelated
coverage.

## Cache synchronization and deduplication

Cache keys include execution environment, session, transcript generation, and
projection/schema version. Preserve the last acknowledged checkpoint and a
bounded manifest of cached fragment revisions. Persist bodies and their coverage
atomically with the checkpoint; never advertise a body that was evicted or only
partially written.

The host validates the checkpoint and compares revisions before transmitting
bodies. An unchanged fragment is referenced and reused locally. An append sends
only the appended range when its base revision is available. An edit, completion
rewrite, deletion, or reorder uses an explicit patch or bounded replacement,
not an assumption that complete messages are immutable.

Do not send every cached ID on each open. Use a compact checkpoint plus bounded
coverage information; maintain a bounded change log or equivalent revision
index to find changes without replaying the entire session to the phone.

If the host no longer retains the required change history, the epoch/generation
changed, or a cache body is missing, reconcile the requested window against a
fresh bounded manifest. Reuse validated matching fragments and fetch the rest.
Recovery must not require an unbounded full-transcript transfer.

Deduplicate at both layers: version/operation identity prevents repeated live
application, while fragment identity and revision prevent duplicate cached
content. Message ID alone cannot detect a growing reply. Cache metadata and
eviction must remain bounded as users visit many sessions.

## Running-session delivery

Capture state and the transcript window at one authoritative cursor, then follow
updates strictly after that cursor. Buffer events while restoration runs, apply
each applicable operation once, and ignore updates from superseded session
switches. Preserve existing control acquisition and release semantics.

A partial transcript cannot safely enter the existing reducer as a complete
`ChatMessage`: content indexes and offsets would refer to missing bodies.
Keep the mobile window projection separate from canonical message reduction,
using versioned fragment operations for transcript updates and the shared
state reducer for non-content runtime state.

Bound ongoing delivery too. Subscribe to the visible window and the live tail;
send lightweight revision/manifest changes for unloaded ranges and fetch their
bodies when needed. Do not ship an entire growing reply on a completion event,
or forward bulk canonical events that defeat the initial-window budget. Enforce
backpressure and bounded batches; a missed version triggers bounded window
reconciliation.

If the user scrolls away from the tail, preserve their anchor and show new-content
availability without forcing a jump. Returning to the tail fetches its bounded
latest window. State updates, pending interactions, and turn completion remain
deliverable regardless of the loaded content range.

## Mobile rendering and navigation

RN owns the window cache and synchronization. The WebView renders fragment
patches through the existing acknowledged delivery mechanism. Avoid injecting
full messages or accumulated full text on every streaming tick.

Render message identity once per visible continuation group and make earlier
unloaded content discoverable. Preserve selection, tool expansion, and scroll
anchors by stable IDs. History-index jumps resolve a fragment window around the
target message; they must not restore the whole target reply. Copy/export or
actions needing complete content explicitly fetch it rather than copying a
partial reply as if it were complete.

## Alternatives

- Lowering the eight-message limit: still unbounded for one long reply and
  still repeats cached bodies.
- UI virtualization alone: reduces mounted DOM but leaves transfer and parsing
  costs intact.
- Cached-message IDs plus new-message paging: misses edits and streaming growth
  within existing IDs.
- Replaying every event since the previous visit: can be much larger than the
  visible content and requires a complete reducer baseline.
- Arbitrary text truncation: breaks Markdown context, content offsets, and
  user actions unless partial content has an explicit contract.

## Validation and acceptance

Measure before/after with identical fixtures and network conditions. Record
request/response bytes, duplicate body bytes, host projection time, native
decode/merge time, bridge bytes, first visible paint, restore completion, and
retained memory. Existing restore timings do not include WebView first paint.

Required scenarios:

1. Cold open with one extremely long reply: first transfer and parsing stay
   bounded; the latest portion appears and earlier portions load on upward scroll.
2. Six cached complete messages plus two new messages: unchanged cached bodies
   are not resent; only needed new content and current state are transferred.
3. Reopen mid-stream: synchronize additions to the existing reply; snapshot/live
   overlap, completion rewrites, and repeated frames produce no gaps or duplicates.
4. Long active turns with many tools: no full-active-turn payload escape hatch.
5. Giant paragraph, code fence, table, and deferred result: respect budgets and
   retain valid continuation rendering.
6. Rapid A/B switching, reconnect, epoch change, expired checkpoint, cache
   eviction, edits/deletes, and history jumps: reconcile within a bounded window.
7. Pending permissions/questions, todos, usage, voice state, and settings restore
   correctly even when associated content is unloaded.
8. Narrow/wide layouts and changing viewport size preserve anchors and fill the
   viewport progressively; old hosts retain functional legacy behavior.

Automated coverage belongs at the shared contract, host projection, relay
synchronization, mobile cache, and WebView delivery layers. Add reproducible
stories for partial-message continuations and loading/error states, then verify
the switch-to-running-session transition on a real mobile client. Set numeric
latency and memory targets after collecting baseline measurements; enforce byte
budgets and zero unchanged-body retransmission as protocol invariants.

## Decisions (Phase 0)

**Segmentation.** Windows do not reuse `splitTextIntoBlocks`: it runs on loads
only and highlights whole texts. A window cuts the *phone projection* of a
message (`projectProgressiveMessage` + `stripMessagesForRemote`, without the
load-only text split and highlight tokens) so a loaded and a live-reduced
message cut the same way. Text and plan blocks are sliced greedily: a cut is
fixed once the 4096 characters after the previous cut exist, and prefers a
paragraph break, then a line break, then a space, else a hard cut that keeps
surrogate pairs whole. Cuts therefore never move as a reply grows; only the
last slice does. A slice starting inside a code fence, table or insight carries
the fence line, the table's header and delimiter rows, or the insight header as
context. Every other block is one atomic fragment; one whose projection exceeds
32 KiB becomes an `omitted` placeholder rather than escaping the budget.
Attachments are fragments of their own, so previews never inflate the meta.
Block keys are the provider id, the tool id, or type + parent + ordinal.

**Revisions and checkpoints.** A fragment's revision is a 64-bit digest of its
projected body. Hosts store nothing new: neither the node read model nor the
desktop session keeps per-block versions, and digests make the checkpoint
self-validating. A request carries coverage for the window the client holds
(`[key, digest]` pairs, capped at 512); the host omits matching bodies. An epoch
change, an expired change log, a cache eviction and an edit all reduce to the
same path: compare digests in the requested bounded range, send the rest.
`omittedBefore`/`omittedAfter` and older/newer anchors describe what is not
loaded. A client that cannot resolve a body it was told it holds re-requests
without claiming it.

**Live delivery.** A window-mode connection does not receive transcript content
events. After each stream frame the host re-fragments the messages that changed
(by object identity, resuming text cuts), diffs them against the window it
served that connection, and sends one `transcript_window` event: appended text
for a grown slice (digest-checked by the client), new bodies for changed
fragments, removals and the held order. Content-only events (text, thinking and
plan deltas, `tool_input_delta`, `tool_progress`, `message_timestamp`,
`content_retracted`, `mcp_app_updated`, `suggested_task_updated`,
`checkpoint_captured`) are withheld; events that also carry state are forwarded
with message bodies removed (`message_start`, `user_message_appended`,
`queued_message_consumed` rows; `message_complete`'s Codex items and final
response). New messages outside the held window, or behind a detached window,
update only `total`.

**Rewriting events (0.4).** Host-side diffing covers every rewrite uniformly:
`content_retracted`, Codex final-response replacement, `replace` deltas,
sealing, compaction dividers, slash-command rows, task patches and send
failures all surface as changed digests or order. No rewrite ships a whole
reply: a new or rewritten message is bounded by the live budget like a load.

**State versus content (0.5).** The phone reduces every forwarded event with the
shared chat-core reducer over the materialized window messages and discards the
reducer's `messages` patch; transcript content comes only from the window.
Todos already reach the phone from host state and `todos_updated`, because the
phone profile rewrites todo tool calls. Pending interactions, usage, goal,
voice and settings come from load state and their own events.

**Initial budgets** (to be tuned from device measurements): 128 KiB and 48
fragments per window, a visible-text target of three phone screens (about 6,000
characters), and a 2 MiB cached window per session inside the existing blob pool.

## Current code references

- [Mobile open and restore](../../apps/mobile/src/runtime.ts)
- [Mobile session navigation](../../apps/mobile/src/navigation/mobile-app.tsx)
- [Cached history merge and restore requests](../../packages/relay-client/src/restore.ts)
- [Cursor-based live following](../../packages/relay-client/src/session-feed.ts)
- [Shared load contract](../../packages/shared/src/environment/session-messages.ts)
- [Active-turn supplementation](../../packages/shared/src/environment/session-message-range.ts)
- [Desktop session read model](../../apps/desktop/src/main/node-host/desktop-session-reads.ts)
- [Desktop transcript virtualization](../../apps/desktop/src/renderer/src/components/chat/VirtualTranscriptList.tsx)
- [Mobile transcript guidance](../../apps/mobile/docs/agent-reference/transcript.md)
