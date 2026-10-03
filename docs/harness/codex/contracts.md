# Codex behavioral contracts

Upstream behavior SuperOne depends on that the app-server schema does not state.
"Observed" names the version and method; re-check an entry when an upgrade touches
its area. Realtime is experimental upstream (`features.realtime_conversation`,
enabled by `apps/desktop/src/main/codex/app-server-connection.ts`).

## Models and thread forks

### Model discovery depends on the app-server client version

- **Behavior:** The same CLI account and `clientInfo.name: "super-one"` returned
  no `gpt-6.1-sol` from 0.155.1, but returned a visible `gpt-6.1-sol` from 0.159.0.
  A newer official desktop app or global CLI does not change SuperOne's managed
  runtime. Catalog access also depends on account/workspace entitlements.
- **Observed:** 2026-09-30, isolated live `model/list` calls on both versions;
  0.159.0 selected the model and completed two real turns.
- **Depends on it:** `apps/desktop/src/main/codex/codex-experiment-service.ts#fetchModelsFromAppServer`
  and `packages/runtime/src/harness/managed-official.ts#OFFICIAL_CODEX_NPM_VERSION`.
- **Guard:** `packages/runtime/src/harness/managed-official-lockstep.test.ts`
  guards pin equality; entitlement and live catalog visibility require a live check.

### Legacy fork boundaries resolve against provider turns before creating a fork

- **Behavior:** 0.159.0 removes `thread/rollback`. For old SuperOne messages without
  `metadata.codex.turnId`, read descending `thread/turns/list` pages with
  `itemsView: "notLoaded"`, identify the oldest excluded turn, and call
  `thread/fork { beforeTurnId }`. The boundary and later turns are excluded;
  the source history is unchanged. Explicit `lastTurnId` remains inclusive.
- **Observed:** 0.155.1→0.159.0 stable/experimental schema comparison; 0.159.0 live
  two-turn source fork retained its first turn and left both source turns intact.
- **Depends on it:** `packages/codex/src/fork-thread.ts`, shared by desktop and CLI.
- **Guard:** `packages/codex/src/fork-thread.test.ts` and
  `apps/desktop/src/main/session/session-fork.test.ts`; invalid/missing boundaries
  fail before an unbounded fork is created.

## Realtime voice

### A realtime session is a voice connection on the existing thread

- **Behavior:** `thread/realtime/start` attaches a short-lived realtime session
  (`realtimeSessionId`) to an existing, already started or resumed thread; it
  creates no second thread. Work the voice model delegates runs as an ordinary
  turn on that thread, with the thread's sandbox, permission profile and approval
  requests. `thread/timeline/list` returns one timeline mixing `realtime` entries
  (transcript segments, session start/close, promoted items) with turn entries.
- **Observed:** 0.150.1, live voice sessions and rollouts; 0.155.1, experimental
  JSON schema from the pinned binary.
- **Depends on it:** `apps/desktop/src/main/codex/codex-realtime.ts#startCodexRealtime`
  (resolves the thread through `withThreadConnection`, then streams delegated turns
  through the normal turn path in `pumpRealtimeDelegatedTurns`),
  `#listCodexRealtimeTimelinePages` and `#mapCodexRealtimeTimeline` (voice and
  thread views are two projections of one timeline; SuperOne persists only the
  `threadId`).
- **Guard:** `apps/desktop/src/main/codex/codex-realtime.test.ts` (timeline
  projections); `apps/desktop/src/main/codex/app-server-connection.test.ts`
  (feature flag).

### Prompt fields replace defaults; empty is not unset

- **Behavior:** `prompt` replaces Codex's built-in voice backend prompt; a
  non-blank `experimental_realtime_ws_backend_prompt` config beats it, and
  `prompt: ""` clears the built-in prompt instead of leaving it alone.
  `includeStartupContext` appends thread context after whichever prompt won.
  `initialItems` (V3 only, at most 128 items and 8,192 estimated tokens) sit
  beside the prompt. `realtimeStartInstructions` / `realtimeEndInstructions` go to
  the backing Codex model, once per transition into or out of realtime, and each
  replaces Codex's default fragment rather than appending to it.
- **Observed:** 0.150.1, source reading; 0.155.1, source reading
  (`codex-rs/core/src/realtime_prompt.rs#prepare_realtime_backend_prompt`,
  `codex-rs/core/src/context/world_state/realtime.rs`).
- **Depends on it:** `apps/desktop/src/main/codex/codex-realtime.ts#buildCodexRealtimeStartParams`
  sends a field only when its constant in
  `apps/desktop/src/main/agent/superone-system-prompt.ts` (`CODEX_REALTIME_*`) is
  non-blank. Only `initialItems` is sent today, as one `developer` item.
- **Guard:** `apps/desktop/src/main/codex/codex-realtime.test.ts` (blank fields
  absent; the `initialItems` text).

### No realtime model override

- **Behavior:** A model on a Codex-managed realtime session was rejected with
  `Field session.model is not allowed for this Codex realtime session`; the App
  Server picks the realtime model and its required headers. 0.155.1 adds
  `ThreadRealtimeStartParams.model` ("overrides the configured realtime model");
  it has not been exercised.
- **Observed:** 0.150.1, live session error; 0.155.1, schema only.
- **Depends on it:** `apps/desktop/src/main/codex/codex-realtime.ts#buildCodexRealtimeStartParams`
  (never sends `model`).
- **Guard:** `apps/desktop/src/main/codex/codex-realtime.test.ts`
  (`not.toHaveProperty('model')`).

### Delegation envelope and timing are observed, not contracted

- **Behavior:** A delegated request reaches the thread as a user message wrapped
  in `<realtime_delegation>` with `<input>` and an optional `<transcript_delta>`
  (each field capped at 4 KiB); the transcript tail flushed at session end
  (`flushTranscriptTailOnSessionEnd`) adds `<source>transcript_tail_flush</source>`.
  Delegation fires at the voice model's own utterance and intent boundaries, not
  on an interval, and one session can delegate several times. Neither the format
  nor the timing is in the schema.
- **Observed:** format: 0.150.1 rollouts, 0.155.1 source
  (`codex-rs/core/src/context/realtime_delegation.rs`); timing: 0.150.1 rollouts
  only.
- **Depends on it:** `packages/shared/src/realtime-timeline.ts#isRealtimeDelegationText`
  (marks delegated turns in `codex-realtime.ts#mapCodexRealtimeTimeline`; the voice
  view renders them as delegation rows instead of raw XML).
- **Guard:** `packages/shared/src/realtime-timeline.delegation.test.ts` covers the
  parser against fixtures only; unguarded against upstream change.

## Native public MCP Apps

- **Observed:** 2026-10-01, pinned 0.159.0, isolated fixture stdio server:
  the initialize extension reaches the server as
  `capabilities.extensions["io.modelcontextprotocol/ui"].mimeTypes`.
  The model catalog excludes the app-only `fixture_next_page` tool while
  the host can call it with `mcpServer/tool/call {threadId,server,tool,arguments}`.
  A bound `mcpServer/resource/read {threadId,server,uri}` reads its HTML.
- **Item shape:** model calls carry `appContext:null`, content,
  structuredContent and private `_meta`. This fixture emits the legacy
  `mcpAppResourceUri` while `mcpAppUi` is null, even on 0.159.0. Read the
  modern field first, then the pinned schema's legacy compatibility field.
- **Outcome:** no retry after a dispatched call whose reply is lost. The
  node transport must not automatically resend `mcpApps.provider`.
- **Discovery cost (0.159.0, 2026-10-01):** `mcpServerStatus/list` creates
  a discovery connection set rather than reading only the thread's live
  connections. `detail: full` also lists resources and templates from every
  server, including the automatic hosted `codex_apps` server. With Bits &
  Bolts, that took 4.3–9.2 s. `toolsAndAuthOnly` took 93–151 ms after tool
  discovery was warm, but its first hosted tool discovery still took
  3.95–4.78 s. The protocol has no per-server inventory filter.
  Resource reads and tool calls reuse the bound thread and took 9–27 ms.
- **App catalog lifetime:** cache tool descriptors by connection, thread and
  binding configuration, invalidating on reload, startup-status updates and
  sign-in. Missing tools get one single-flight refresh, throttled to one per
  thread every 10 s; `notLoggedIn` snapshots are not retained. The provider
  starts light discovery when a live native App attachment arrives, sharing
  that pending request with View admission. Ordinary thread startup does not
  prewarm; the cold cost is paid once per connection/thread/configuration
  until explicit invalidation (or cache eviction).
  The provider prefers read-content `_meta.ui`; only missing UI metadata requires an
  awaited full-inventory fallback before building the document's CSP.
  Optional tool/server presentation loads after the HTML snapshot is ready;
  its late update is discarded if the attachment binding changes.
- **Guards:** `apps/desktop/src/main/mcp-apps/codex-provider.test.ts`,
  `apps/desktop/src/main/environment/node-rpc-client.test.ts`, and
  `apps/desktop/scripts/check-codex-mcp-apps.ts` (live, isolated auth copy).
- **Child View routing:** recursive `collab_tool_call.childItems` attachments use
  their child thread, not the root. Restoration validates `thread/read` ancestry
  (`source.subAgent.thread_spawn.parent_thread_id`, or `forkedFromId`) before
  `thread/resume`. The validation/resume is single-flight per connection and
  root/child pair. Root session/account/config binding is rechecked before every
  native request; unrelated threads and ancestry cycles fail closed.
- **Child validation:** pinned 0.159 protocol-event replay covers active-turn and
  after-turn fork listeners carrying modern `mcpAppUi`, structured/private result,
  and root-thread isolation. `mcp-apps-subagents.test.ts` covers ancestry and child
  native resource/tool routing. A 2026-10-03 isolated live subagent probe stopped
  at `workspace routing discovery failed`; no live subagent turn was verified.
- **Remote elicitation:** production nodes negotiate `openai/elicitation` form
  and Codex's `openai/standard-form-input` alongside MCP Apps. The native client
  dispatches user-waiting requests independently of its ordered notification and
  RPC-reply reader. Forms reuse SessionRuntime's durable permission waiter and
  lease-gated response RPC; answers are validated before accepting and forms do
  not enter `alwaysAllowedTools`. User-input time is excluded from RPC/turn
  budgets. Form, cancellation, snapshot/replay and per-thread ordering are tested
  with protocol fixtures; this change has no new authenticated live acceptance.
- **Between-turn View forms:** native resource/tool invocation scopes route
  standalone `mcpServer/elicitation/request` (`turnId:null` or absent) to the
  session-lifetime permission handler on desktop and nodes. The pinned schema
  carries thread/server and optional turn correlation, but no tool-call id;
  parallel same-thread/server calls share the host handler and unrelated forms
  do not inherit the scope. The last call ending/cancelling clears the scope's
  form; a single call cannot cancel another call's prompt. Dispatcher notifications
  remain FIFO. The node host callback
  comes from SessionRuntime, not a completed turn's abort signal. Cancellation
  removes the pending approval and does not retry the native tool. Replay tests
  cover idle resource/tool calls, cancellation and subsequent notification order;
  authenticated end-to-end acceptance remains unverified for this change.
  The existing remote provider route does not forward a View's AbortSignal to
  the node. Remote View teardown alone therefore does not cancel the native RPC;
  permission cancel and session interrupt/close still settle its prompt.
