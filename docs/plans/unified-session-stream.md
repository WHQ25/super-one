# Unified session stream

Status: in-progress · Updated: 2026-10-10
Goal: Every consumer of session data (renderer, controlling desktop, relayed phone, in-process services) reads one log per node through one subscription contract with its own profile.
Proposal: [unified-session-stream.md](../proposals/unified-session-stream.md)
Long-term docs affected: [chat-core.md](../architecture/chat-core.md), [mobile-remote-control.md](../architecture/mobile-remote-control.md), [remote-node-service.md](../architecture/remote-node-service.md) §5.2, §8, §9; `apps/desktop/docs/agent-reference/architecture.md`

## Coordination

- [desktop-node-orchestration.md](desktop-node-orchestration.md) step 1 (`SessionHostPort`) and step 2 (desktop durable log) are the same work as phases 3–4 here. Do them once, under this plan's contracts.
- [remote-fork-history.md](remote-fork-history.md) builds on the node message catalog. Phase 4 replaces that catalog with the shared read model; land the fork work first or build it on the read model.
- Each phase is a separate branch and ships on its own. The phone wire format never changes; a golden test on mobile frames guards it from phase 2 on.
- Schema changes follow the additive-only migration policy (`apps/desktop/docs/agent-reference/architecture.md`, "Schema changes").

## 1. Session-owned resolutions and one renderer publish point

- `Session` announces `interaction_resolved` when it handles a permission, question or plan response, and drops any later announcement of the same request. Every caller gets it once: renderer IPC, phone commands, desktop-node RPC (`DesktopSessionHost` calls `Session` directly and announced nothing before), and the backends and host confirm registries that announce their own (DeepSeek, OpenCode, Cursor, ACP elicitation, Codex MCP App abort, `HostConfirmRegistry`). `AgentService` no longer synthesizes resolutions.
- Presence and the `BROADCAST_SESSION_SETTING` fallback go through `publishAgentEvent` (renderer batcher and notifications).
- Progress (2026-10-10): done on `refactor/unified-session-stream` (`0d119e8e2`, `a9e616fe1`). Session unit tests cover each announcement path; AgentService tests assert delegation only; node-host integration tests pass.
- Moved out, found while implementing:
  - The remote-node sink stays a direct send until phase 3. Through the renderer transport its Codex items would become patches against baselines a remote rehydrate never resets, appending to the rehydrated item. Phase 3 replaces the sink.
  - Replay events of a newly registered session reaching every `onAny` consumer are not a leak: that is how the renderer and phones learn a session's initial settings and catalogs. They become snapshot state in phase 4.
  - `provider_changed` and `additional_dirs_changed` have no session; they move to the `environment` topic in phase 3.
  - The `SessionEventHub` with subscribed consumers comes with the profiles in phase 2.

## 2. Shared stages and profiles

- Add `SessionEventHub` in desktop main. Every event leaves through it; the renderer transport, `notificationService`, mobile, `scheduledSendService`, the collaboration monitor and the MCP Apps executor subscribe to it with their profiles.
- Add a recorder that captures the hub's pre-profile events, and at each event the observable `Session`/backend state (status, pending interactions, settings, queue, todos, goal), in dev builds behind trace. Record fixtures: Claude and Codex turns with tools, interactions, settings changes, subagents, a large `Write`, a long Codex command.
- Add the stage and profile module in `packages/runtime/src/stream/`. Stages take filesystem and clock access through ports.
- Rebuild `renderer-agent-event-transport.ts` as the `local-ui` profile, and `MobileBroadcaster` projection plus the `RemoteControlService.sendAgentEvent` chain as the `mobile` profile, in today's order: project, accumulate, filter, truncate, throttle, rewrite, enrich, strip, coalesce, batch, encode. Sealing per channel stays in the transport. Delete `RemoteEventBatcher`.
- Acceptance: on the recorded fixtures, both profiles emit byte-identical frames to the code they replace (golden test; it stays as the phone wire guard).

## 3. Node push

- Contracts in `packages/shared/src/environment/`: `SourceCursor`, `FrameCoverage`, `StreamTopic`, `subscribe`, `ack`, `StreamFrame`, `cursor_too_old`.
- Node schema (additive): a per-session `version` on `environment_events` and the process `epoch`. New rows get versions from the session's head; a cursor before a session's first versioned row resumes through a snapshot.
- Node: the session row, its event and the idempotency receipt commit in one transaction before publication (the open invariant in remote-node-service.md §8). `session.get` + `messages.list` return the cursor they reflect (applied-position barrier).
- Node: `session.subscribe` pushes over the WebSocket with server-side topic filtering, coverage and resume. `session.events` honors aggregate filters. In this phase every event is still durable, so coverage is contiguous by construction.
- Session, project and draft list mutations emit events on their topics; environment-aggregate events (`provider_changed`) go to the `environment` topic with an environment-state snapshot. Enumerate the producers first, including session tags (persisted today without an event).
- Raise the minimum protocol generation; the desktop offers the node upgrade through its existing flow.
- Desktop: one upstream subscription per connection feeds the hub, which then carries remote-node events to notifications and the renderer batcher like local ones. It replaces the remote-node sink, `EnvironmentHost.runSessionEventDrain`, the `RemoteEnvironmentGateway.subscribeEvents` poller and `collaboration-remote-watch.ts`; the watcher keeps its wake-and-cursor transaction. Cursors persist per connection and topic (additive desktop table).
- Acceptance:
  - No session read polling against a node; lease renewal and heartbeats remain.
  - A turn started on a node by another client appears in an open idle session on the desktop without rehydrate.
  - Disconnect mid-turn and reconnect: complete ordered transcript, no rehydrate.
  - Desktop restart with a remote child running: the parent is woken once.
  - A node below the new generation is refused with the upgrade offer.
- Progress (2026-10-10): done on `refactor/unified-session-stream` (`55d66661f`…`4e0a535e2`). `session.subscribe` pushes per connection (`event-stream.ts`); the desktop keeps one `RemoteSessionFeed` per node shared by the chat, phones and the child watcher, follows every open remote session, refreshes remote session lists from list events (`session.tags_changed` added), and routes remote events through the renderer transport with per-session Codex baseline reset on rehydrate. Protocol generation 2; an older node is offered the upgrade from its refusal. Unit and CLI integration tests pass; the node lab run is still due.
- Moved out, found while implementing:
  - `SourceCursor`, `FrameCoverage`, `ack`, `cursor_too_old`, the per-session `version` and the `epoch` only mean something once events leave the durable log; they land with the ring in phase 4. Frames carry the scanned environment `sequence`, which covers every durable event.
  - The applied-position barrier lands on the phase 4 `snapshot`: `session.get` and `messages.list` are replaced there, and a cursor on two separate reads cannot be exact.
  - Node session rows are written before their events, synchronously, so no reader sees an event before its row. One transaction with the receipt comes with the message commit transaction in phase 4.
  - Persisted per-connection cursors are not needed: the child watcher keeps its cursors in grants, the chat resumes in memory across reconnects and rehydrates after a restart.
  - Node project, draft and provider topics have no consumer: node projects and providers change only through the controlling desktop's own calls, and drafts are desktop-only. Add them with the first consumer.

## 4. Durable log, streaming ring and read model on every node

- Classify durability by payload and phase (proposal §3.1). Tool starts and results, consolidated tool input, and `codex_item_delta` `started`/`completed` are durable; text and thinking deltas, `tool_input_delta`, `codex_item_delta` `updated` and `tool_progress` go to the ring.
- Streaming ring in the runtime with a byte cap; dropped on message commit; latest entry per item for `codex_item_delta` `updated`. A resume over an evicted range gets the message's partial content from the read model.
- Message commit writes the consolidated message row in the same transaction as the completion event; frames covering retired versions carry that row.
- Read model in the runtime (proposal §3.3), starting from the desktop dialect reducers (`applyClaudeEventToRuntime`, `applyCodexEventToRuntime`, the Codex completion branch). Shadow run per [Shadow comparison](#shadow-comparison); switch when it agrees.
- Desktop: every session writes the runtime `EventLog` (not only sessions a controller started), with commit before publish in place of fan-out then persist. Additive tables.
- CLI: stops writing one row per delta; existing rows stay.
- Bootstrap, at version 0 of a new epoch, persisted as a checkpoint:
  - desktop sessions: their stored messages;
  - CLI sessions: their full current display catalog (`transcript_json` expanded with tool and content blocks from the existing log, inherited fork history, MCP App updates). Building it is a projection only; no recorded action runs again.
- One `snapshot(ref, page)` replaces `getLiveSnapshots`, `buildRemoteSessionSnapshot`, `buildProgressiveBootstrap`, `linkBootstrap`, and node `session.get` + `messages.list`.
- Acceptance:
  - Reconnect inside an unfinished message after several of its tools completed: completed tools from the durable tier, text from the ring, no gap.
  - Reconnect across a compacted Codex item and across `mobile`-filtered events: coverage contiguous, no false gap.
  - Reconnect with several sessions streaming at once.
  - Ring eviction: resume over the evicted range returns the partial content.
  - Kill a node mid-turn and restart: the turn is interrupted, pending interactions are cleared, committed content is intact.
  - Ring peak memory measured on the recorded workloads and on ten concurrent sessions, within the cap.
  - A CLI session with tool calls and an MCP App shows the same content before and after the upgrade.
  - The previous release opens the migrated database and lists its sessions.
- Progress (2026-10-10): node side done (`ae010aa3c`…`e1179e522`). `EventLog` classifies by payload (`streamingEventKey`), versions every session event, holds streaming events in `StreamingRing` (16 MiB cap; peak 164 KiB on ten concurrent recorded sessions) and retires them on commit (`committedStreamingMessage`). `SessionReadModel` reduces with chat-core, checkpoints messages and state in the committing transaction, replays durable events above the checkpoint after a restart, and bootstraps older sessions once from the catalog. `session.load` serves it; `session.messages.list` and MCP App lookups read it. Restart records the interruption and cleared prompts as events. The desktop opens remote sessions at a `session.load` barrier, resumes its stream by version, and resyncs only sessions the node names. Shadow test: read model equals direct reduction on all five recordings.
- Moved out or changed, found while implementing:
  - Gaps are signalled by `resnapshot` (per session) instead of per-frame `FrameCoverage` ranges: every event carries its version, the node knows the reader's versions, so it decides gaps itself; frames covering retired versions do not carry the committed row, the reader reads the snapshot.
  - Desktop sessions stay on the desktop's own persistence: its `Session` is already the read model, local subscribers are in-process and need no resume positions, and opening the node database for every desktop at startup only to record them would add startup work. The desktop node host records the sessions a controller started, as before. Revisit if crash recovery of an in-flight desktop turn is wanted.
  - Replacing `getLiveSnapshots`, `buildRemoteSessionSnapshot`, `buildProgressiveBootstrap` and `linkBootstrap` with `snapshot` moves to phase 5, where the renderer and phones read through the contract.
  - The event mapper gave a synthesized `message_start` the envelope's `seq`, so chat-core dropped the envelope's own event as a replay; fixed in the mapper.

## 5. Renderer on the contract, federated phone sessions

- The renderer reads and writes through `EnvironmentClient` keyed by `SessionRef`, for local and remote sessions. `LocalEnvironmentGateway` serves the full session port. IPC sends each subscription's frames only to its window.
- Delete the second hydrate stack (`remote-session-ops.ts` hydrate and merge, `node-session-messages.ts` reconciliation) and the remote-key branches in the renderer.
- Federation: the node runs the `mobile` profile for a relayed phone; the desktop forwards frames, seals per phone channel and forwards `detail` topics. When its upstream resumes across a retired or evicted range, or resnapshots, it sends the affected phones `reset` so they restore (proposal §3.6). `environment-commands.ts` drops its reducer and projection. Its device map stays until phase 6.
- Acceptance:
  - The same chat-store path serves a local, a CLI-node and a desktop-node session.
  - A phone on a CLI-node session shows the same transcript as the desktop.
  - The mobile frame golden test passes unchanged; a phone build from before this phase works against the new desktop.
  - That older phone stays connected while the desktop's upstream to the node drops across a message completion and across a ring eviction: it ends with the complete transcript.

## 6. Control

- `ControlLease` holders become per downstream client: a desktop acquires for delegated holders (its authenticated client id plus a device id), and the node treats them as distinct.
- `Session` owner/subscribers move onto leases. A phone opening a session acquires control and the desktop UI shows observation mode, as today.
- Remove the device map in `environment-commands.ts`.
- Drafts keep `draft-control.ts`.
- Acceptance: two phones and the desktop UI racing on one CLI-node session end with one holder; the others get `failed_precondition`; Disconnect and Reconnect on the banner still hand control back and forth.

## Shadow comparison

- Input: the phase 2 recordings (full pre-profile events, including lifecycle, settings and interactions) for the Claude and Codex dialects, with a fixed clock and id ports.
- Observable projection compared:
  - per message: id, role, ordered blocks (type, text, tool name, input, result summary and status), completion metadata (usage, cost);
  - session state: status, pending interactions, settings, queue, todos, goal.
- Messages: run the dialect reducers and the read model on each recording and compare the message projection.
- Session state: compare the read model's state at each event against the `Session`/backend state the recorder captured; the dialect reducers do not hold it.
- Any difference fails.

## Verification

- Unit, golden and shadow tests per phase in the touched packages.
- Node lab (`bun run dev:cli:lab`) for phases 3–6: idle traffic, disconnect mid-turn, node restart with a pending interaction, older-node refusal.
- Live phone pairing for phases 1, 2, 5 and 6, including a phone build from before the change.
- Record each baseline in the proposal §7 before and after its phase.
