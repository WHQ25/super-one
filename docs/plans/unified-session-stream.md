# Unified session stream

Status: planned · Updated: 2026-10-10
Goal: Every consumer of session data (renderer, controlling desktop, relayed phone, in-process services) reads one log per node through one subscription contract with its own profile.
Proposal: [unified-session-stream.md](../proposals/unified-session-stream.md)
Long-term docs affected: [chat-core.md](../architecture/chat-core.md), [mobile-remote-control.md](../architecture/mobile-remote-control.md), [remote-node-service.md](../architecture/remote-node-service.md) §5.2, §8, §9; `apps/desktop/docs/agent-reference/architecture.md`

## Coordination

- [desktop-node-orchestration.md](desktop-node-orchestration.md) step 1 (`SessionHostPort`) and step 2 (desktop durable log) are the same work as phases 3–4 here. Do them once, under this plan's contracts.
- [remote-fork-history.md](remote-fork-history.md) builds on the node message catalog. Phase 4 replaces that catalog with the shared read model; land the fork work first or build it on the read model.
- Each phase is a separate branch and ships on its own. The phone wire format never changes; a golden test on mobile frames guards it from phase 2 on.
- Schema changes follow the additive-only migration policy (`apps/desktop/docs/agent-reference/architecture.md`, "Schema changes").

## 1. One publish point on desktop

- Add `SessionEventHub` in desktop main. Every event leaves through it.
- Route the three direct `safeSend(EVENT)` calls in `index.ts` through it: presence (`PresenceCoordinator.broadcastToRenderer`), the remote-node `agentEventSink`, and the `BROADCAST_SESSION_SETTING` fallback.
- Move events `AgentService` synthesizes into their aggregate: `publishSyntheticEvent` and `emitAdditionalDirsChanged` into `Session`, `broadcastProviderChanged` into the environment aggregate.
- `Session` owns interaction resolution: one method resolves a pending interaction and emits `interaction_resolved` once, whatever ended it — a human response over IPC or from a phone (today synthesized in `AgentService`, sometimes alongside a backend emission), a desktop-node RPC response (`DesktopSessionHost` calls `Session` directly and emits nothing today), or a backend cancellation (Cursor question/plan, ACP elicitation completion, Codex MCP App elicitation abort).
- Consumers subscribe to the hub: renderer transport, `notificationService`, mobile (`agentService.notifyEventSubscribers`), `scheduledSendService`, the collaboration monitor, the MCP Apps executor.
- `getReplayEvents` goes only to the listener that attached, never through `onAny`.
- Acceptance:
  - For each resolution path above, the renderer, a subscribed phone and the node-host event log each receive exactly one `interaction_resolved`.
  - Presence, remote-node and settings-fallback events reach `notificationService` and the renderer batcher.
  - Attaching a listener delivers replay events to that listener only.

## 2. Shared stages and profiles

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
- Desktop: one upstream subscription per connection feeds the hub. It replaces `EnvironmentHost.runSessionEventDrain`, the `RemoteEnvironmentGateway.subscribeEvents` poller and `collaboration-remote-watch.ts`; the watcher keeps its wake-and-cursor transaction. Cursors persist per connection and topic (additive desktop table).
- Acceptance:
  - No session read polling against a node; lease renewal and heartbeats remain.
  - A turn started on a node by another client appears in an open idle session on the desktop without rehydrate.
  - Disconnect mid-turn and reconnect: complete ordered transcript, no rehydrate.
  - Desktop restart with a remote child running: the parent is woken once.
  - A node below the new generation is refused with the upgrade offer.

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
