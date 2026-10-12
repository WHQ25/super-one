# Unified turn view

Status: in-progress (steps 0-4, 5a-5e done; 4 landed before 3) · Updated: 2026-10-12
Goal: Every harness's assistant turn reaches the UI as `message.content` ContentBlocks and renders through one `TurnBody`, on desktop and in the phone chat-view; Codex thread items are translated at the integration layer and no longer reach a renderer.
Long-term docs affected: [chat-core.md](../architecture/chat-core.md), [mobile-remote-control.md](../architecture/mobile-remote-control.md) (hidden-detail refs), [mcp-apps.md](../features/mcp-apps.md) (Codex rows), [codex contracts](../harness/codex/contracts.md) and [api-surface](../harness/codex/api-surface.md), `apps/desktop/docs/agent-reference/architecture.md`, `.agents/skills/superone-harness/references/event-contract.md`

## Why

Two data models produce two turn renderers, so every cross-cutting feature is
written twice (virtualization in `12f01d2d6`, copy, compact collapse, process
stats, seal, mobile projection):

| Data | Renderer | Harnesses |
|---|---|---|
| `message.content` ContentBlocks | `chat-view/presenters/ClaudeTurnBody.tsx` (571 lines; generic despite the name) | claude, acp, opencode, cursor, dsh |
| `message.metadata.codex.items` (`CodexThreadItem`) | `chat-view/presenters/CodexTurnView.tsx` (829) + desktop `components/chat/CodexTurnView.tsx` (145) + `codex-item-renderer.tsx` + `CODEX_PARTS` in `PortableTurnAdapters.tsx` | codex |

The two dispatch points disagree: `PortableMessage.tsx:134` checks
`Boolean(metadata.codex)`, `ChatMessage.tsx:153` checks `providerId === 'codex'`.
The harness rule — translate the provider protocol into `AgentEvent` at the
integration layer — is broken by `codex_item_delta`, which carries the
provider's item shape into presenters, the mobile projection, the node
catalog and main's persistence dialect.

## Starting point (verified 2026-10-12, branch rebased on `main` `12f01d2d6`)

| Piece | State |
|---|---|
| Producers | Two, not sharing a mapper: desktop main `main/codex/codex-turn.ts` (`mapThreadItemFromAppServer` :309) → `session/backends/codex-backend.ts` `buildCallbacks` :1877-1990; and `packages/codex/src/agent-event-mapper.ts` (`createCodexAgentEventMapper` :382) used by the CLI node (`apps/cli/src/session/codex-live-turn.ts:132`). |
| Codex wire | `message_start {content: []}`, `codex_thread_started`, `codex_turn_metadata`, `codex_subagent_activity`, `codex_item_delta {phase, item, subagents?}` (every delta carries the **full accumulated item**), `codex_mcp_startup`, `message_usage`, `compact_boundary`, `message_complete {metadata.codex}`. No producer emits `content_delta`. `codex_item_patch` is synthesized only by `runtime/stream/delivery/local-delivery.ts` (`makeCodexPatch` :37-71). |
| Content of a Codex message | Empty while streaming; replaced by `[{type:'text', text: finalResponse}]` on completion (chat-core `message-complete.ts:102`; main `codex-session-runtime.ts:363,370`; `session.ts:2443` result rebuild). All rows live only in `metadata.codex.items`. |
| Item kinds | `agent_message` (incl. `delivery:'async'` + `questions`), `reasoning`, `plan`, `command_execution` (`aggregatedOutput`, `exitCode`, `commandActions`), `file_change` (`changes[]`, possibly empty on failure), `mcp_tool_call` (`app`, `mcpAppUi`, `appContext`, `authRequired`, `suggestedTask`, `result`/`error`), `web_search`, `todo_list`, `error`, `review` (entered/exited), `compaction`, `collab_tool_call` (spawn/sendInput/wait/close/resume; `agentsStates`; recursive `childItems` per thread, attached to the call that produced them), `image_generation`, `video_generation` (only from `generative-ui/native-widget-payload.ts:210`). `agent-types.ts:343-559`. |
| Command semantics | Non-zero exit is an outcome, not a tool error: only `failed` without `exitCode` is an error (`shared/codex-command-status.ts:8`). The row shows exit code and, expanded, every parsed action (`CodexCommandBlock.tsx:47,54`). |
| Persistence | `chat_messages.metadata_json`. Main reduces via the codex dialect (`message-dialect.ts`, `session.ts` `applyCodexDialectEvent` :2412-2497, `codex-session-runtime.ts`) and rebuilds `metadata.codex` on completion; chat-core rebuilds it with a different field set (`message-complete.ts:68-95`). `rowToChatMessage` (`session-repo.ts:47`) re-seals items on read. A `full` persist rewrites every in-memory row (`session-repo.ts:517`). |
| Todos | Codex cold restore scans history items (`stores/chat-store/helpers/codex-todo.ts:20`); `todos_updated` is memory-only (`chat-core/src/todos.ts:6`, main `session.ts:2257`). Claude todos come from `TodoWrite`/`TaskCreate`/`TaskUpdate` results in content (`chat-core/src/content.ts:83`). |
| Thread restore | `main/codex/codex-realtime.ts` `mapTimelineThreadMessages` :231-388 maps provider history to items (incl. `compaction`, drawn by `codex-item-renderer.tsx:276`); `shared/realtime-thread-messages.ts` `mergeCodexThreadMessages` overlays by `turnId` and aligns async answers by `agent_message.questions`. Fixture `codex-thread-restore-fixture.ts`. |
| Seal | `sealStreamingTools` (content) and `sealCodexItems`/`sealCodexMetadata` (items; image/video exempt; status only, output kept) in `shared/content-delta.ts`. |
| Mobile | Phone reduces with chat-core. `stripMessagesForRemote` passes Codex messages unchanged (`remote-content.ts:675`). The progressive projection maps `codex.items` unconditionally (`projection.ts:59`) and serves Codex detail refs `item`/`nested-item`/`reasoning` (`progressive-tools.ts:203-256`); `DeferredTool.tsx:8` spreads the returned detail. The handshake enforces only a desktop floor (0.73.0-alpha.1, `mobile-remote-control.md:21`), so new phones talk to hosts that still emit items, and a new desktop can meet a phone whose chat-view OTA is older. |
| Remote node | Stores every event verbatim (`session-runtime.ts:1559`); `message-catalog.ts` rebuilds content from `content_delta`, and `mcp-apps-catalog.ts:17,31` re-attaches every logged `codex_item_delta` item to history (`message-catalog.ts:479`). Old node logs keep items forever. |
| Non-render readers of `codex.items` | copy (`getAssistantCopyText`), compact pinning (`isCodexPinnedSegment`), stats (`summarizeCodexProcess`), footer MCP startup gating (`ChatMessageFooter.tsx:174`), media (`media-generation.ts`), widgets (`use-widget-input-request`), MCP apps (`mcp-apps-state.ts`, node `mcp-apps-catalog.ts`), `suggested-task.ts`, async questions (`codex-async-question.ts`, main `remote-async-question.ts`, `input-requests.ts`), todos (`codex-todo.ts`), realtime (`realtime-turn-activities.ts`, `realtime-thread-messages.ts`, `codex-timeline-rows.ts`), usage (`usage-stats-service.ts`), archive text (`session-transcript-view.ts`), store helpers (`codex-helpers.ts`), `ForkedThreadView.tsx`. |
| Dead shared shapes | ContentBlock `codex_plan` / `codex_image_generation` / `codex_collab` (`agent-types.ts:233-235`): no producer since `13f51706e`; readers are `session-transcript-view.ts:63` and the abandoned Flutter client. |
| Ratchet | `harness-branch-ratchet` counts `ChatMessage.tsx` = 1 ("Codex message rendering"); 56 files / 281 branches. chat-view is not counted. |
| Turn diffs | Not consumed anywhere; `turn/diff/updated` only covers `apply_patch` (codex contracts). |

## Design

```
Codex app-server ─▶ codex-turn.ts / packages/codex mapper
                       └─ shared createCodexContentStream (one translator, both producers)
                            ├─ content_delta   text · thinking · tool_use(+outputDelta) · tool_result · plan · review · notice
                            └─ codex_* kept for thread/turn identity, usage, provenance, MCP startup, plan approval
legacy items (rows, old hosts, old nodes, node logs, thread restore)
                    ─▶ codexItemsToContent  (pure, per-item cached)
chat-core ─▶ message.content ─▶ TurnBody (desktop parts | portable parts)
```

### Format discriminator

A Codex message is **legacy** when `metadata.codex.items` is non-empty. New
producers write `metadata.codex` with `items: []`, so every old client that
reads `codex.items.map(...)` stays crash-free and falls back to its text view.
`CodexTurnInfo.items` stays required; reads that assume non-empty items are
audited in step 2.

### One translator

`packages/shared/src/codex-content.ts` (chat-core, main, runtime and the CLI
node all need it):

- `codexItemToBlocks(item)` — pure, deterministic ids; `codexItemsToContent(items)`
  concatenates it with a per-item identity cache, so a legacy update
  re-projects only the changed item.
- `createCodexContentStream()` — stateful; turns successive full-item deltas
  into `content_delta` ops (below).
- Invariant over recordings: reducing the stream's events through
  `applyContentDelta` equals `codexItemsToContent(finalItems)`.
- Live projection never seals; only terminal events (interrupt, error,
  persisted reads) seal, via `sealStreamingTools`.

### Item → shared contract

| Codex item | Shared representation | Parity notes |
|---|---|---|
| `agent_message` | `text {id}` | Async-question items keep `questions` on the block (`codexAsyncQuestions`, already persisted on answer bubbles); TurnBody renders nothing for them, as today. Archive text excludes them, as today. |
| `reasoning` | `thinking {id, startedAt, endedAt}` | `remoteDetail` carried over; progressive thinking detail is located by id. |
| `plan` | `plan {id, text}` (new, generic) | Replaces dead `codex_plan`; upserted by id. Plan approval stays harness-owned (`codex_plan_approval`, `metadata.codex.planApproval`, `approveCodexPlan`); TurnBody draws the latest plan's actions through a host part. |
| `command_execution` | `tool_use` `Bash {command, cwd, commandActions?}`; output streams as `outputDelta` into `tool_use.liveOutput`; terminal → `tool_result {summary: output, exitCode, isError: failed && exitCode === undefined}` | `commandActions` is a generic "parsed actions" input field (normalized `read`/`search`/`listFiles`/`unknown`). The shared Bash row draws the action icon/list and exit code; a Bash call whose actions are all read-only joins the collapsible read/search grouping that replaces `CodexCommandGroup`. No lossy rename to Read/Grep/LS. |
| `file_change` | one `FileChange` `tool_use` per change (`id = item.id:index`, `{file_path, kind, diff}`, `toolLineDelta`) + `tool_result` | A failed item with no changes yields one error `FileChange` row, as today (`codex-item-renderer.tsx:205`). |
| `mcp_tool_call` | `tool_use` `mcp__<server>__<tool>` with `app`, `suggestedTask`; `tool_result` with the text result, else JSON/structured fallback, `isError` | MCP App attachment rides the shared `ToolAppAttachment` path (`mcp-apps.md`); authoritative App updates/clears must survive re-projection. `authRequired` becomes a typed field drawn by the ToolBlock's auth action. |
| `web_search` | `WebSearch {query}` + `tool_result` | |
| `collab_tool_call` | spawn **and** sendInput/resume with child output → `Agent` `tool_use` container: `taskThreadId`, `taskDescription` from nickname/role, `taskStatus` only when terminal (completed→`completed`, errored→`failed`, shutdown/notFound→`stopped`; running/pendingInit omit it, per the shared lifecycle `agent-types.ts:151`), the original Codex state as a diagnostic field, `taskUsage` from tokens, `taskResultText` from message, follow-up flag in input; the call's own `childItems` → child blocks with `parentToolUseId` = that container. wait → generic row, hidden once completed; close/resume without output dropped, as today | Attribution comes from each call's own `childItems`, not "latest call". `ForkedThreadView` and fork navigation read `taskThreadId` and the container's child blocks. |
| `todo_list` | hidden `TodoWrite` `tool_use` (no result: the item updates in place) | Live updates set the session `todos` (legacy: the wire shim; new format: `todos_updated`); cold restore reads the latest open `TodoWrite`. The row is hidden for parity. |
| `error` (non-terminal) | `notice {id, level:'error', text}` (new, generic) | Hidden when the message itself failed (footer owns it). |
| `review` | `review {id, phase, text}` (new, generic) | |
| `compaction` | `notice {id, level:'info', kind:'compaction'}` drawn like the compact marker | Covers persisted/restored compaction items; live compaction keeps `compact_boundary`. |
| `image_generation` | hidden `ImageGeneration` `tool_use` whose input carries status, saved/preview/reference paths, params, warnings, failure; collected into the turn-end gallery by the shared media collector | Status lives in input, so `sealStreamingTools` cannot freeze a cross-turn render. |
| `video_generation` | not a Codex protocol item; keep its native-widget consumer (verify in step 5) | |
| turn diffs | **explicitly unsupported**, as today; per-file `FileChange` rows and their stats are the file-change surface | |

`codex_plan` / `codex_image_generation` / `codex_collab` are deleted from the
union; `plan` / `review` / `notice` are added without a `codex_` prefix and
get archive-text semantics in `session-transcript-view.ts`.

### Content-delta ops (step 2)

- Blocks may carry an `id`. Deltas locate their target by `type + parentToolUseId + id`;
  without `id`, today's positional merge is unchanged.
- `text` / `thinking` with `id`: **append** by default; `replace: true` for a
  non-prefix rewrite. `plan` / `review` / `notice`: **upsert** by id.
- `tool_use` gains `outputDelta` (appended to `liveOutput`). `liveOutput` is
  durable content, so Stop, reconnect and snapshots keep partial output; the
  terminal `tool_result` carries the final output and the reducer drops
  `liveOutput`. No new event type, no transient buffer.
- Batcher/coalescer keys include the block id (`agent-event-batcher.ts:21,53`);
  summarized phone projections drop `liveOutput` as they truncate results.

### Persisted history: read-time adapter, not a migration

`withCodexContent(message)` derives content from legacy items. Applied at:

1. chat-core ingress: hydrate and the legacy `codex_item_delta` /
   `codex_item_patch` / complete / interrupt / error reducers re-derive content
   **after** their own writes (so the `finalResponse` overwrite cannot erase it);
2. main keeps legacy messages in their stored shape (runtime, rows,
   `Session.snapshot`): the stored text (`finalResponse`, or the interrupt
   notice) cannot be rebuilt from items, so a derived runtime would lose it on
   write-back. Main readers that need content apply the read view at use (5c);
   old clients keep receiving exactly what they read today;
3. thread restore (`mapTimelineThreadMessages`) and the node message catalog
   over old event logs produce legacy messages that clients derive at ingress
   like any other transcript; old-host hidden-detail responses (`{item}` JSON →
   shared detail) get a phone adapter in 5e.

Why not a migration:

- **Downgrade.** Older builds render Codex turns from `items`; rewriting rows
  breaks them, and writing both doubles every Codex row.
- **It would not remove code.** New phones talk to pre-change desktops, desktops
  to older CLI nodes, and node logs keep `codex_item_delta`; the translator is
  needed regardless.
- **Startup cost.** A JSON rewrite of every Codex row would run on the startup path.

New rows (after step 6) carry content and `items: []`. Older builds show
their text fallback for them — an accepted downgrade limitation. Two kinds of
compatibility code result, documented separately:

- **Wire shim** — chat-core handling of live `codex_item_delta` /
  `codex_item_patch`. Removable once the phone's desktop floor and the
  supported node version pass the step-6 releases.
- **History adapters** — persisted-row read view, hydrate, thread restore,
  node-log translation, old `{item}` detail responses. Version floors do not
  convert stored history, so these stay until that history is migrated or
  retired by a separate decision.

### Streaming and completion

- Producer-side suffix diffing replaces `makeCodexPatch`; per-item Codex
  coalescing goes away with `codex_item_delta`.
- `sealStreamingTools` covers every new Codex tool row; `sealCodexItems` stays
  for legacy items (history adapters keep it).
- New-format `message_complete` never replaces content; `finalResponse` stays in
  metadata. Main's Codex dialect reduces content with `applyContentDelta`; the
  three completion rebuilds (`session.ts` result, `codex-session-runtime.ts`,
  chat-core `message-complete.ts`) use one field list with a survival test.

### Rendering

- `ClaudeTurnBody` → `TurnBody`; `CLAUDE_PARTS` → the one portable part set.
  New cases: `plan`, `review`, `notice`. New optional host parts: plan actions,
  subagent thread navigation, MCP auth action. The Bash row draws `liveOutput`,
  exit code and `commandActions`. Virtualization is already shared.
- Both dispatch points render every assistant turn through `TurnBody`
  (desktop inside `ModMessageScope`, so Codex turns gain mod sites).
- Deleted at the end: chat-view and desktop `CodexTurnView.tsx`,
  `codex-item-renderer.tsx`, `CODEX_PARTS`/`CODEX_RUNTIME`, `PortableCodexTurn`,
  `CodexCommandBlock`, Codex collab presenters not reused by the subagent part,
  `isCodexPinnedSegment`, `summarizeCodexProcess`, Codex branches in
  copy/media/widget/footer readers, `projectCodexTool`. The ratchet allowance
  for `ChatMessage.tsx` is deleted. Server-side Codex detail refs stay with the history adapters.

## Steps

Each step is one commit, or a short series as noted, that keeps every harness
rendering. Steps 1-5 do not change what producers emit.

0. **Recordings.** Record real Codex app-server turns covering every item kind
   (commands incl. compound read/search/list and non-zero exit, file changes
   incl. failed-empty, MCP + MCP App + auth, web search, reasoning, plan +
   approval, review, collab spawn/sendInput/wait with child items, todo,
   image generation, async question, error, compaction via thread restore,
   interrupt, steer). Fixtures under `packages/codex`. Record here whether
   text/reasoning/plan deltas are prefix-extensions and whether item updates
   interleave. `test(codex): …`
1. **Rename.** `ClaudeTurnBody` → `TurnBody` (presenter, desktop re-export,
   `CLAUDE_PARTS`, virtualization test, stories, boundary test). No behavior change.
2. **Contract.** Block ids and append/replace/upsert ops in `applyContentDelta`;
   `tool_use.outputDelta`/`liveOutput`, `tool_result.exitCode`, `commandActions`,
   `taskThreadId`, MCP `authRequired`; `plan`/`review`/`notice` replacing the
   dead `codex_*` blocks; batcher keys; remote/progressive projection
   (thinking-by-id, `liveOutput` drop); archive text; audit of `codex.items`
   reads for the `items: []` format (`projection.ts:59` and peers). Unit tests
   for adjacent different ids, non-prefix rewrite, timestamp-only updates.
3. **Render the new shapes.** TurnBody cases and host parts (plan actions,
   thread navigation, MCP auth, Bash `liveOutput`/exit code/actions, image
   gallery from `ImageGeneration`, hidden completed wait, hidden `TodoWrite`).
   Stories: streaming/sealed, error, long content, narrow, light/dark.
4. **Translator.** `codexItemToBlocks` / `codexItemsToContent` /
   `createCodexContentStream` with the stream ≡ projection invariant over the
   step-0 recordings. A parity story renders each recording through
   `TurnBody` next to `CodexTurnView`.
5. **Read-time adapter and render switch** (series):
   - 5a chat-core ingress derivation (hydrate, legacy delta/patch, complete,
     interrupt, error), no sealing of live projections; a test feeds recorded
     legacy streams end to end.
   - 5b (re-scoped, see Step 3-5a notes) thread restore needs no adapter of
     its own: restored `contextCompaction` items translate to compaction notices
     and the realtime timeline is derived at client ingress. Main keeps the
     stored shape; the old-host `{item}` detail adapter moves to 5e, where the
     phone first draws Codex rows from content.
   - 5c non-render readers read content (copy, compact, stats, footer MCP
     startup, media, widgets, MCP apps state, suggested task, async question
     queue + main readers, todos, realtime activities/thread merge, usage,
     `ForkedThreadView`).
   - 5d desktop `ChatMessage` dispatch → `TurnBody`; delete the desktop Codex
     turn path; lower the ratchet.
   - 5e `PortableMessage` → `TurnBody` with the old-host `{item}` detail
     adapter; delete `PortableCodexTurn`,
     `CODEX_PARTS`, chat-view `CodexTurnView`; `build:chat-view`; boundary test.
6. **Producers** (series): 6a desktop `codex-turn.ts`/`codex-backend.ts` emit
   through `createCodexContentStream` with `items: []`; main Codex dialect
   persists content; one completion field list. 6b `packages/codex` mapper for
   the CLI node. **Release gate:** the mobile OTA with 5e is published first,
   and an old-chat-view check (previous release's chat-view + chat-core fed
   new-format streaming, snapshot and completion fixtures) shows text-only
   rendering without exceptions and without child-thread text mixed in. If the
   handshake can report the phone's chat-view build, gate on it instead.
7. **Cleanup.** Remove `makeCodexPatch`, `projectCodexTool` for new-format
   messages, Codex per-item coalescing and unused exports. Legacy `items`
   stay on legacy messages everywhere: they are the baseline for late fork /
   image deltas to an already completed turn (`codex-backend.ts:1940-1946`,
   `chat-core/src/codex.ts:132-141`); a "complete → restore snapshot → late
   fork delta" test pins this. The wire shim and history adapters stay.
8. **Docs.** Fold decisions into the long-term docs listed above (one
   rendering path, translator and content ops, format discriminator, wire shim and
   history adapters with their removal conditions, downgrade limitation, unsupported turn diffs);
   delete this plan.

## Step 0 findings (2026-10-12, Codex 0.162.1, `gpt-6.1-sol`)

Recorded by `packages/codex/scripts/record-turns.ts` into
`packages/codex/src/fixtures/recordings/` (11 scenarios, raw app-server
notifications, machine paths and user name replaced):

- Agent message, plan and reasoning text is **append-only**: every completed
  item's text extends the accumulated deltas; no non-prefix rewrite was seen.
  `replace` stays as the safety valve, not the common path.
- **No interleaved text items.** Each item's deltas arrive between its own
  `item/started` and `item/completed`. A command's output can arrive after a
  later item starts (a steered user message), which id-located tool upserts
  already handle.
- Review mode yields `enteredReviewMode` / `exitedReviewMode` plus ordinary
  reasoning and commands; manual compaction yields `contextCompaction` items;
  collab yields `collabAgentToolCall` and `subAgentActivity` items with child
  thread notifications on the same connection.
- Not reproducible live with this model/config: `todo_list` (the model never
  called `update_plan`), image generation, async questions, MCP auth and
  strict-review errors. Their translator tests use hand-built items from the
  existing mapper tests.

## Step 3-5a notes

- Codex 0.162 reports spawned and follow-up subagents only as
  `subAgentActivity` (metadata); `collabAgentToolCall` remains for `wait`.
  Legacy `spawnAgent` items still map to Agent cards, and the shared
  `SubagentBlock` full view replaces `ForkedThreadView` in 5d.
- The read view is `withCodexContent` / `withCodexContents`
  (`codex-content.ts`). chat-core re-derives every message an event wrote in
  `applyEventToSession`; hydration applies it at the desktop live-snapshot
  merge, `_mergePersistedMessages` (stored rows), `hydrateRemoteSession`, the realtime timeline,
  and the mobile runtime's `hydrated()` (cache, restore, pages, realtime thread).
- Items stay the stored truth, so writers that patch a derived block also patch
  its item (`applySuggestedTaskUpdate`; `updateMcpAppAttachments` already did).
- Main never derives into its runtime or rows (see Persisted history, 2).
- 5d: desktop renders every turn through `TurnBody`. Summarized remote rows
  read an old-host `{ item }` detail through `codexItemDetail` (so the detail
  adapter landed in 5d, not 5e). Codex fork navigation (`ForkedThreadView`)
  is gone; an agent card's own full view replaces it, without the per-thread
  aggregation across follow-ups or the "forked" badge. A follow-up that
  could not be delivered shows the shared failed card, not the Codex-only
  failure copy.
- 5e: the phone renders every turn through `TurnBody`; the latest plan answers
  through `codexPlanApproval`. The Codex gallery, pinning and process-stats
  branches went with the render paths. Derivation parity found here: a
  summarized collab shell has no agent state, so its card reads role `agent`
  and completes with its call; a lone file's line counts may sit on the patch
  item; a host returns a command's output beside its item; a command group
  counts each file once. A patch now counts one call per file row. The chat
  document and its e2e fixtures receive derived content, as from the runtime.
- Left for later steps: `stripMessagesForRemote` and usage-stats
  `harnessOf` key on bare `metadata.codex` and must use `isLegacyCodexMessage`
  before step 6; Codex trace diagnostics are retargeted in step 7.
- Shared readers read `readableContent(message)`, the same view without the
  message wrapper, so main and CLI callers need no adapter of their own.
- Todos have one carrier, the session `todos`: a legacy `todo_list` item sets
  it like a `TodoWrite` result, and cold restore rebuilds it for every harness
  from the latest whole-list `TodoWrite` that is still open
  (`restoredTodos`). The hidden call has no result, because Codex updates one
  item in place; step 6 producers emit `todos_updated` for live updates. Error notices on a failed message are filtered
  at the 5d/5e dispatch sites.

## Risks

| Risk | Mitigation |
|---|---|
| Codex rewrites text non-monotonically or interleaves items | Id-located append/replace (step 2); step-0 recordings decide which op the stream uses. |
| Parity gaps (action lists, exit codes, failed-empty file change, collab follow-ups, plan footer, MCP auth/JSON fallback/App updates, image fields, hidden error/wait/todo) | Mapping table above; step-4 parity stories over real recordings; e2e specs `codex-command-*`, `file-change`, `async-question`, `realtime-*`, `turn-error-layout` migrated, not deleted. |
| Legacy turn loses rows at completion | 5a (chat-core) and 5b (main live runtime) derive after every legacy terminal write; tests assert tools survive complete/interrupt/error and a late fork delta after completion. |
| Metadata field drift across the three completion rebuilds | One field list in 6a with a survival test across main and chat-core. |
| Old phone ↔ new desktop | `items: []` keeps old clients crash-free; release gate in step 6. |
| New phone ↔ old desktop / desktop ↔ old node | Legacy ingress (5a), old detail adapter and node-log translation (5b), all fed by recordings. |
| Row doubling on re-save | Stored-shape serializer (5b) with a test that a `full` persist leaves legacy rows byte-identical in shape. |
| Hot-path cost on long legacy turns | Per-item identity cache: a delta re-projects only its item; benchmark with `bench-content-block-turn.ts` on a long recording. |
| Abandoned Flutter client | Out of scope; it cannot pass the current handshake floor. |

## Verification

- Per step: `bunx vitest related` on changed files (from `apps/desktop`); shared,
  chat-core, runtime, codex and CLI tests touched by the step. Gate list beyond
  new tests: `chat-core/src/mcp-app-completion.test.ts`, `codex-metadata.test.ts`,
  `message-complete`, `codex-interrupt-seal`, `runtime/src/session/mcp-apps-catalog.test.ts`,
  `runtime/src/stream/delivery/projection.test.ts`, `chat-view/src/codex-collab-detail.test.ts`,
  `codex-command-status.test.ts`, desktop `codex-backend.test.ts` (steer owner),
  async-question queue, thread-restore fixtures, CLI delivery. Main-process
  tests failing with sandbox EPERM re-run unsandboxed per file.
- Ratchet after 5d: `bunx vitest run src/renderer/src/harness-ui/harness-branch-ratchet.test.ts`,
  allowance lowered with `UPDATE_HARNESS_RATCHET=1`.
- chat-view e2e specs listed under Risks; `bun run build:chat-view` after 5e.
- Storybook: TurnBody stories for new blocks (step 3), parity stories (step 4).
- Live after 5d and after 6a: a dev build over CDP (`self-verify.md`) with a
  real Codex session through the recorded scenarios plus an old Codex session
  from the user database; the phone via simulator with a fresh
  `build:chat-view`; a CLI node session after 6b.
