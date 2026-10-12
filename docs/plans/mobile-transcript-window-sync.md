# Mobile transcript windows and incremental cache synchronization

Status: in progress — Phase 0 decisions recorded in the proposal; Phase 1 contract landed · Updated: 2026-10-13
Proposal: [mobile-transcript-window-sync.md](../proposals/mobile-transcript-window-sync.md)
Goal: Opening or reopening a mobile session transfers, parses and paints a bounded fragment window, never resends unchanged cached bodies, and continues a running reply without gaps or duplicates.
Long-term docs affected: `docs/architecture/mobile-remote-control.md` (atomic open, progressive loading), `docs/architecture/chat-core.md` (content/state split, if it changes), `apps/mobile/docs/agent-reference/transcript.md`, `apps/mobile/docs/agent-reference/transport.md`.

## Current state (verified 2026-10-13)

Host side:

- `session.load` is a shared handler (`packages/runtime/src/server/rpc-dispatch.ts:311` → `rpc-session-reads.ts:22`) over `SessionHostPort.load`. There are two implementations. The CLI/node uses `SessionRuntime.load` → `SessionReadModel.snapshot` (`packages/runtime/src/session/read-model.ts:79`). Desktop uses `DesktopSessionReads.load` (`apps/desktop/src/main/node-host/desktop-session-reads.ts:207`).
- A phone connection is summarized in `deliverLoad` (`packages/runtime/src/server/session-delivery.ts:24`), which runs `projectProgressiveMessage` and then `stripMessagesForRemote`. Thinking and tool bodies become `remoteDetail` refs, but **text blocks stay whole**. `splitTextIntoBlocks` (`packages/runtime/src/stream/delivery/split-text-blocks.ts:11`) splits text at fences, tables and insights **on loads only**, so a loaded message and a live-reduced one have different block lists.
- Routed phones get the **full** upstream load and keep up to 400 reduced messages (`apps/desktop/src/main/node-host/routed-phone-delivery.ts:12`). This path skips any window budget.
- No per-message or per-block revision is stored. The event log has `sequence`, `epoch` and a per-session `sessionVersion`. Streaming deltas get a version but no sequence (`event-log.ts:62`), and the read-model checkpoint finds dirty rows by object identity (`read-model.ts:201`).
- `session.historyIndex` is served only by desktop, as a phone extension (`apps/desktop/src/main/remote/phone-methods.ts:90`).
- Live traffic on a summarized connection: text deltas pass through and are folded (`session-delivery.ts:75`). `message_complete` carries only `{messageId, metadata}`. `message_start` and `user_message_appended` carry the full projected message.

Mobile side:

- `restoreSession` (`packages/relay-client/src/restore.ts`) loads the newest 8 messages, merges the cache by id overlap, and fills a gap with after-anchor pages (40 messages × up to 20 pages).
- The cache is stored under `session-v1\0<projectPath>\0<sessionId>` in the per-pairing blob pool (`apps/mobile/src/session-transcript-cache.ts`). It holds complete messages only, at most 200 messages or 8 MiB, with LRU over a shared 512 MiB cap.
- `ChatRuntime` reduces every `AgentEvent` with chat-core into whole `ChatMessage`s. Deltas merge by block id or into the last text/thinking block (`packages/shared/src/content-delta.ts:152,187`). `tool_result` parses the full `tool_use` input to update todos and tasks (`packages/chat-core/src/content.ts:85`).
- The chat-view window counts **messages**: 8 initial, 40 mounted (`packages/chat-view/src/chat-window.ts`). Rendered rows are `transcriptSegments`, so one long reply is a single unit.
- Copy assumes the complete text: `getAssistantCopyText`, user copy, code block copy, Codex plan.
- `ChatRuntime.restoreMetrics` has no WebView first-paint time. A payload benchmark exists at `apps/desktop/scripts/benchmark-mobile-payload.ts`.

## Phase 0 — Baseline and spikes (decisions back into the proposal)

Each spike ends with a decision written into the proposal. The proposal moves to `accepted` once 0.2–0.5 are settled.

### 0.1 Fixtures and baseline

- Add deterministic fixtures:
  - one very long reply (≥1 MB of text);
  - a long active turn with many tools;
  - a giant paragraph, a giant code fence, a giant table, and a deferred result;
  - 6 cached complete messages plus 2 new ones;
  - a reopen in the middle of a stream.
- Extend `benchmark-mobile-payload.ts` to record request/response bytes, duplicate body bytes, host projection time and bridge bytes.
- Add a WebView first-paint mark on the mobile side, from the transcript delivery `transcriptApplied` of the first hydrate.
- Record a baseline for the legacy path on a real device over LAN and relay. These numbers set the initial budgets later; no fixed message count.

### 0.2 Segmentation and continuation

- Evaluate `splitTextIntoBlocks` as the fragment primitive.
- Define one deterministic block key per content block. Base it on `contentKeys` (`packages/shared/src/transcript-boundary.ts:17`), plus an explicit id where one exists.
- Define how oversized blocks are cut: at a paragraph or line boundary inside text; at a line inside a fence, carrying the fence language and an open/close flag; at a row inside a table, repeating the header row.
- Required outcome: load and live use the **same** segmentation, which removes today's block mismatch. A streaming append extends only the tail fragment; earlier fragment ids stay stable.

### 0.3 Revision and change index

- Choose the storage for a per-block revision: the `sessionVersion` of the block's last mutation.
  - Node: a column or side table next to `session_messages`.
  - Desktop: derived from replay events, or held in a revision map kept with the live snapshot.
- Choose the retention for the change log.
- Choose the checkpoint format: an `{epoch, generation, version}` triple plus a compact coverage list of block ranges and revisions. It must not carry every cached id.
- Define how an expired checkpoint reconciles against a fresh manifest.

### 0.4 Inventory of content-mutating events

List every event that rewrites existing content rather than appending to it, such as `content_retracted`, the Codex `finalResponse` replacement in `message-complete.ts`, `sealStreamingTools`, and compaction. Map each one to a fragment operation: append, replace range, delete, or invalidate. Find any event that could ship a whole reply, such as a Codex final response carried in metadata, or a giant user paste in `user_message_appended`.

### 0.5 Split content events from state events on the phone

Classify every chat-core event as either:

- **transcript content**, which goes to the fragment store; or
- **runtime state** (status, pending interactions, todos, usage, goal, voice, settings), which goes to the reducer on a message-less session.

Confirm that state never needs a message body. For example, todos must come from the host's state and runtime events, not from `tool_result` parsing `tool_use` input. Reuse chat-core's split if it already has one; otherwise add a shared classifier.

## Phase 1 — Shared contract

New module: `packages/shared/src/environment/transcript-window.ts`.

- **Types.** Request: session ref, tail or anchor fragment, direction, viewport hint, byte and fragment budgets, optional checkpoint. Result: manifest, bodies for missing or changed fragments only, ops, older/newer cursors, state and restore facts on open, an atomic cursor, and the new checkpoint.
- **Pure functions, shared by both hosts.** `fragmentMessage(message, budget)`, `diffManifest(manifest, checkpoint)`, and `enforceBudget`. The hard byte limit applies to the serialized size, including the first fragment.
- **Pure client store.** `applyWindowResult`, `applyFragmentOps`, and `applyLiveContentEvent`, which appends a text delta to the tail fragment of its block. Coverage and completeness flags are explicit; a partial message is never exposed as a `ChatMessage`.
- **Tests.** Fragment determinism; id stability under appends; continuation context for fence, table and list; budget edge cases (one fragment larger than the budget, an empty session); manifest diffs for append, edit, delete and reorder.

## Phase 2 — Host projection

- Implement the revision index from 0.3 in `SessionReadModel` and in `DesktopSessionReads`.
- Add a `session.transcriptWindow` handler to `HANDLERS` (`rpc-dispatch.ts`) on top of `SessionHostPort`. A host that cannot serve it lists it in `unservedMethods`; it is then left out of `capabilities.methods`.
- Projection order: `projectProgressiveMessage` / `stripMessagesForRemote` first, so detail refs and thumbnails are kept, then fragmenting. Reuse the `session.load` path for state, restore facts and the cursor, read at the same position.
- Routed phones: `RoutedPhoneDelivery` forwards the window request to the upstream node and relays its bounded result. Never fall back to the 400-message full load while in window mode.
- Serve `session.historyIndex` from the node too, by moving `extendHistoryIndex` over outline messages into a shared handler, so window jumps work on remote sessions.
- **Tests.** Handler validation; atomic cursor; bodies omitted for an unchanged checkpoint; the append-only range for a growing reply; reconcile after an epoch change or an expired checkpoint; the byte limit always honoured, including on the routed path; the node history index matches desktop for the same transcript.

## Phase 3 — Bounded live delivery

- Window-mode connections subscribe to the visible window and the live tail.
- For an unloaded range, send revision or manifest notices instead of bodies.
- Bound `message_start` and `user_message_appended`, and any rewrite found in 0.4, by sending a manifest plus a tail fragment instead of the whole message.
- Keep folding deltas and batching. A version gap triggers a bounded window reconcile, not a full restore.
- **Tests.** Overlap between snapshot and live events; repeated frames; a completion rewrite; a missed version.

## Phase 4 — Mobile runtime and cache

- **`relay-client`.** Add a `restoreWindow` path next to `restoreSession`, chosen when `descriptor.capabilities.methods` includes `session.transcriptWindow`. Keep the same buffer → load → acquire control → follow ordering. The legacy path stays, and diagnostics log which mode ran.
- **Cache v2.** Use the key `session-window-v1\0<environmentId>\0<sessionId>\0<generation>\0<schema>`. Write bodies, manifest and checkpoint together as one blob in the existing pool, so the cache never advertises an evicted body. Bound it per session and globally through the existing LRU. A v1 entry is treated as a cache miss.
- **`ChatRuntime`.** Content comes from the fragment store (0.5); runtime state comes from the reducer on a message-less session. Upward loads and history jumps request fragment windows. A superseded session switch is ignored through the existing `restoreGeneration`.
- **Tests.** `restore.test.ts` style tests for the six-plus-two case, reopening mid-stream, rapid A/B switching, and eviction or a corrupt cache.

## Phase 5 — WebView rendering

- Add fragment patches and fragment order payloads to `TranscriptProjection` / `TranscriptDelivery`, keeping the same ACK and coalescing rules.
- In chat-view, the window unit becomes a fragment, with a ceiling on fragments and bytes instead of 40 messages.
  - Message identity renders once per continuation group.
  - An "earlier content" affordance loads upward inside the message.
  - Anchors are kept by fragment id.
  - New content shows as available when the user is away from the tail.
- Copy and export of a partial message fetch the full content explicitly, with a loading or error state. The copy functions listed above become partial-aware.
- History jumps and the tick rail resolve to a fragment window around the target message.
- **Stories** (colocated in `packages/chat-view`):
  - partial continuation;
  - a continuation that splits a giant fence or table;
  - the earlier-content loader in its loading, error/retry and success states;
  - copy of a partial message while it fetches;
  - narrow layout and dark mode.
- **E2E.** Extend `packages/chat-view/e2e` history-navigation and live-stream specs to fragment windows.

## Phase 6 — Validation, docs and cleanup

- Re-run 0.1 on the same fixtures and network. Check proposal scenarios 1–8. Zero retransmission of unchanged bodies and the byte limits are asserted in tests.
- On a real device: switch into a running session, then use the node lab (`bun run dev:cli:lab`) for a remote node and a routed phone.
- Update the long-term docs listed above. Delete this plan and the proposal in the same change.

## Commit slicing

Each phase lands as one or more independent commits. Phases 1–2 leave behaviour unchanged, because the method is not yet used. Phase 4 switches phones on, behind capability negotiation, and needs Phase 3 in place first. Phase 5 can be built against stub results once Phase 1 has landed.
