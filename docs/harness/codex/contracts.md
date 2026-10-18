# Codex behavioral contracts

Upstream behavior SuperOne depends on that the app-server schema does not state.
"Observed" names the version and method; re-check an entry when an upgrade touches
its area. Realtime is experimental upstream (`features.realtime_conversation`,
enabled by `apps/desktop/src/main/codex/app-server-connection.ts`).

## Remote plugin catalog identity

- **Behavior:** A remote-only marketplace has `path: null`; its plugin source is
  `{ type: "remote" }` and has no local filesystem path, including after install.
  `plugin/read` and `plugin/install` require `remoteMarketplaceName` plus the
  backend `remotePluginId` in `pluginName`. Local marketplace entries retain
  `marketplacePath` plus their local plugin name. Display names and local plugin
  keys are not backend remote IDs.
- **Observed:** Exact 0.163.0 protocol/source and a live read-only `plugin/list`
  on 2026-10-18. Remote read/install request shapes are covered by fixtures;
  no live installation was performed.
- **Depends on it:** Desktop `codex-plugins-service.ts` and shared
  `codex-admin.ts` retain remote marketplaces. Both use
  `packages/codex/src/plugin-target.ts` to address read/install requests.
  Desktop displays remote artwork URLs and catalog versions without reading a
  local manifest or scanning files when no source path exists.
- **Guard:** Desktop `codex-plugins-service.test.ts`, node
  `codex-handlers.test.ts`, and the `CodexRemoteMarketplace` PluginsPage story.
  Remote skill file exploration and plugin onboarding remain outside this path.

## Curated plugin home

- **Behavior:** The Codex app's plugin home is `GET /ps/plugins/home` on the
  ChatGPT plugin service, not `featuredPluginIds` and not the full
  `plugin/list` catalog. Observed on 2026-10-18: 17 ordered sections, nine
  plugins each. The app renders six per section. Opening a category calls
  `GET /ps/plugin-categories/{urlSlug}/plugins?scope=GLOBAL&limit=50` and
  follows `pagination.next_page_token` as `pageToken`. The slug is the home
  section `url_slug`. The server returns up to about 700 plugins per page.
  Popular is one page of 50. Productivity is 1640 plugins across three pages.
  Opening a plugin calls `GET /ps/plugins/{pluginId}`. That document's
  `release.interface` carries the long description, developer, category,
  version, https links, capabilities, and screenshots. Apps come from
  `release.app_templates` (name, description, and logo). Skills come from
  `release.skills`, using the skill name, short description, and icon. MCP
  names come from `release.mcp_servers`. Installed state is
  not on the document; the page stamps it from `plugin/installed`. The page
  does not call `plugin/read` or `plugin/list`. A card installs with
  `plugin/install` using `remoteMarketplaceName: openai-curated-remote` and
  `pluginName` set to the
  plugin id, without listing the catalog. `NOT_AVAILABLE` and
  `DISABLED_BY_ADMIN` are not installable. Public search is `plugin/search`
  and is not sent for an empty term. Personal plugins are `plugin/list` with
  `marketplaceKinds` `created-by-me-remote` and `shared-with-me` only.
- **Observed:** Live read-only home, category, and plugin-detail responses
  and the installed Codex app client, 2026-10-18, Codex 0.163.0. No plugin
  was installed. The sampled detail document was the GitHub curated plugin.
- **Depends on it:** Desktop `codex-plugin-home.ts` fetches the shelves,
  category pages, and plugin documents with the existing Codex login and does
  not return the access token. The Codex plugins page renders those shelves,
  category pages, and plugin pages and does not call the unfiltered
  `plugin/list`.
- **Guard:** `packages/shared/src/codex-plugin-shelf.test.ts`,
  `codex-plugin-home.test.ts`, `CodexPluginDirectory.test.tsx`, and the
  `Settings/Harnesses/Plugins/Codex` stories.

## Compaction boundaries inside a turn

`contextCompaction` items have their own IDs. SuperOne deduplicates their
completion by item ID, allowing multiple compactions within one turn. The
legacy `thread/compacted` notification is a fallback when no item lifecycle is
active; it must not duplicate a completed item. Covered by mapper fixtures,
without a live provider acceptance run.

Boundary rows persist a cursor into the original provider message. Desktop and
mobile split its display at that cursor while later output keeps the original
message ID. Accepted async answers capture the same cursor before
steering, so subsequent output appears below the answer bubble immediately.

## Turn content

Codex turns reach clients as shared content blocks; see
[chat-core](../../architecture/chat-core.md#codex-turns) for the stored format
and legacy item history.

### Item text only grows, and text items do not interleave

- **Behavior:** Agent message, plan and reasoning text is append-only: a
  completed item's text extends its accumulated deltas. A text item's deltas
  arrive between its own `item/started` and `item/completed`. A command's output
  can still arrive after a later item starts (a steered user message).
- **Observed:** 0.162.1 with `gpt-6.1-sol`, recorded by
  `packages/codex/scripts/record-turns.ts` into `packages/codex/src/fixtures/recordings/`
  (raw notifications, machine paths and user name replaced). `todo_list`, image
  generation, async questions, MCP auth and strict-review errors were not
  reproducible live; their tests use hand-built items.
- **Depends on it:** `createCodexContentStream` (`packages/shared/src/codex-content.ts`)
  sends each item's latest state as id-located deltas: text as appended
  suffixes (`replace` only for a non-prefix rewrite), tools as upserts by call id.
- **Guard:** `packages/codex/src/fixtures/codex-content.recordings.test.ts`
  (the stream reduces to `codexItemsToContent` of the final items), desktop
  `event-reducer/codex-content.recordings.test.ts` (chat-core renders the same
  turn) and shared `codex-content.test.ts`.

### Item mapping

| Item | Content |
|---|---|
| `agent_message` | `text {id}`; an async question keeps `codexAsyncQuestions` on the block and draws nothing |
| `reasoning` | `thinking {id, startedAt, endedAt}` |
| `plan` | `plan {id}`; approval stays `codex_plan_approval` and `metadata.codex.planApproval`, drawn on the latest plan |
| `command_execution` | `Bash` `tool_use {command, cwd, commandActions}`, output as `outputDelta`; `tool_result {summary, exitCode}`, `isError` only when failed without an exit code |
| `file_change` | one `FileChange` `tool_use` per change (`<item id>:<index>`) with its `tool_result`; a failed item without changes is one error row |
| `mcp_tool_call` | `mcp__<server>__<tool>` with `app`, `suggestedTask` and `authRequired`; the result is its text, else JSON |
| `web_search` | `WebSearch` |
| `collab_tool_call` | an `Agent` container (`taskThreadId`, `taskStatus` once terminal, usage, result text) whose own `childItems` become child blocks; a completed `wait` is hidden; close or resume without output is dropped |
| `todo_list` | a hidden `TodoWrite` call without a result; producers send `todos_updated` for the live list |
| `error` | `notice {level: 'error'}`, hidden when the message itself failed |
| `review` | `review {phase}` |
| `compaction` | `notice {kind: 'compaction'}`, drawn like the compact marker |
| `image_generation` | a hidden `ImageGeneration` call with its status in the input, collected into the turn-end gallery |

Codex 0.162 reports spawned and follow-up subagents only as `subAgentActivity`
metadata; `collabAgentToolCall` remains for `wait`, and stored `spawnAgent`
items still map to Agent cards.

## Shell command presentation

### One execution can contain multiple read/search/list actions

- **Behavior:** `commandActions` describes an ordered array, while output, status
  and exit code belong to the containing command execution. Consecutive reads
  can produce multiple actions. Best-effort upstream parsing can mark
  `cat a.ts b.ts` unknown or report only the first file for multi-file `head` / `sed`.
- **Observed:** 0.159.0 local source inspection, `shell-command/src/parse_command.rs`
  and `app-server-protocol/src/protocol/v2/item.rs`; not a live provider probe.
- **Depends on it:** `packages/codex/src/command-item.ts` retains execution `cwd`
  and all actions for desktop and CLI. `packages/shared/src/codex-command-actions.ts`
  supplements literal reads using a bounded grammar for `cat`, `head`, `tail`
  and numeric `sed -n` print ranges. Variables, globs, redirects, pipes and
  unsupported scripts are left to upstream metadata; unknown mixed actions stay
  Bash. Relative operands use the execution directory, preserving upstream paths
  when that directory is unavailable or disagrees with an individual action.
  Desktop/mobile use one expandable call with file/action rows and one shared
  Command section for command/output, using the Claude Bash edit layout.
  Exploration groups count unique
  full read paths, not calls. Remote projection resolves paths before truncating
  commands; full output remains deferred until expansion.
- **Guard:** Shared `codex-command-actions.test.ts`, Codex `command-item.test.ts`,
  desktop `CodexCommandBlock.test.tsx` / `progressive-tools.test.ts`, and mobile
  `e2e/codex-command-actions.spec.ts` cover multi-file recognition, mixed actions,
  path/count preservation, previews, combined output and deferred retry.

## Models and thread forks

### Cold resume keeps the host's current explicit permission policy

- **Behavior:** 0.163.0 restores provider-owned historical permissions when
  loading a cold thread, but explicit resume sandbox/approval/network settings
  still take precedence. SuperOne continues sending the current host policy.
  Its permission preset is a live session setting, not a persisted grant;
  application restart initializes it from host defaults.
- **Observed:** CDP cold restart retained the provider thread and history. A
  current read-only selection replaced the previous workspace-write policy;
  the resumed rollout recorded `approval_policy: on-request` and
  `sandbox_policy.type: read-only`.
- **Guard:** `codex-backend.test.ts`, `app-server-connection.test.ts`, and
  `session-settings.contract.test.ts` (permission preset lifetime).

### Interrupting a turn does not guarantee terminating its native shell

- **Behavior:** `turn/interrupt` cancels the turn and active Code Mode cells.
  Native unified-exec processes have separate background-terminal ownership
  and termination APIs; turn completion is not proof of OS-process exit.
- **Observed:** 0.163.0 CDP interrupted an active `sleep 30` turn in about three
  seconds, cleared the busy state and preserved the next queued message.
  Later timeline lookup still showed the native command's successful output.
  The task-abort path inspected in 0.162.1 is equivalent; no old-binary live
  reproduction was performed.
- **Depends on it:** Host cancellation must fence late events and must not
  equate an interrupted assistant turn with proof that all shell work stopped.
  Explicit terminal cleanup remains a separate product decision (backlog #25).

### Prediction protocol declarations do not imply a working suggestion engine

- **Behavior:** 0.163.0 declares experimental `thread/prediction/request` and
  `thread/prediction/updated { threadId, sourceTurnId, result }`, but the server
  returns JSON-RPC `-32601` with `thread/prediction/request is not implemented yet`.
  The release source contains no prediction notification producer. These facts
  apply to the dedicated RPC/event, not to client-driven generation. The
  official app uses experimental ephemeral `thread/fork` plus ordinary
  `turn/start`, which works on 0.163.0. See [prompt-prediction.md](prompt-prediction.md).
  A dedicated-event completed result allows nullable `text`; a failed result
  contains no suggestion.
- **Observed:** Exact `rust-v0.163.0` source and an isolated npm-binary RPC check
  on 2026-10-17. Its stable generated notification schema includes the event
  despite the experimental source annotation and unavailable implementation.
  A subsequent inspection of installed official app 26.1007.71326 and a live
  0.163.0 inference probe verified the separate fork-based generator.
- **Depends on it:** `packages/codex/src/prompt-prediction.ts` is shared by the
  desktop notification dispatcher and node client observer, both alive between
  turns. It accepts only the current root thread's latest observed successful
  `sourceTurnId` after `turn/completed`. Unknown, child, older, active, failed and
  interrupted turns cannot update the composer. A new full input invalidates
  the previous source before its submission RPC; new turn/compaction notifications
  also invalidate it. Failed, null or blank prediction results clear a shown
  suggestion through an empty `prompt_suggestion` event. Desktop reuses ghost text
  and Tab-to-fill; mobile reuses tappable rows. Neither edits a nonempty draft or
  sends input automatically. Node delivery uses the session's ambient sink after
  the original user request settles.
- **Guard:** `prompt-prediction.test.ts`, desktop dispatcher-to-chat-core tests,
  node fake-process tests (including an aborted settled request), shared reducer
  and existing composer tests. Upgrade smoke confirms the unavailable request.
  No product generator or extra inference call has been added. Fork-based
  suggestion generation was exercised separately; native prediction-event
  production remains unavailable in this release.

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

### Explicit provider catalogs are authoritative

- **Behavior:** With `model_catalog_url`, 0.160.0 does not merge bundled models,
  matches metadata by exact model ID, requires unique non-empty slugs, and clears
  runtime/disk catalog entries after failed refresh. An empty catalog without an
  explicitly configured model fails startup rather than choosing a bundled model.
- **Observed:** 0.160.0 upstream [PR #49135](https://github.com/openai/codex/pull/49135)
  and its regression tests; not exercised against a live custom catalog here.
- **Depends on it:** `apps/desktop/src/main/codex/codex-experiment-service.ts#fetchModelsFromAppServer`
  for app-server catalog configurations. SuperOne's custom-provider `/models`
  fetch and application cache are separate and do not inherit this behavior.
- **Guard:** Upstream model-manager/model-list tests; SuperOne custom-provider
  tests guard its separate path. No dedicated live explicit-catalog check.

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

## Inline code review

### Review results belong to the submitted turn, not its worker

- **Behavior:** `review/start { delivery: "inline" }` returns a review turn ID.
  In 0.162.1, a subsequent `turn/started` can identify an internal worker with
  a different ID and `rootTurnId` equal to the submitted review ID. Review
  items and `turn/completed` use the submitted ID. Replacing the active review
  with the worker drops its output and completion; Stop also addresses the
  wrong turn.
- **Observed:** 2026-10-12 real desktop review of an isolated public git fixture
  with 0.162.1. The pre-migration build dropped the completed review even though
  its raw notification trace and provider rollout contained the findings.
- **Depends on it:** Desktop captures `review/start`'s turn for event filtering,
  metadata and interruption. Desktop and the shared node client ignore that
  review's worker-start notification while waiting for its completion.
- **Guard:** Desktop `codex-review-turn.test.ts` covers findings, completion and
  interruption; shared `review-turn.test.ts` checks one completion and retained
  identity. Real desktop and isolated CLI node reviews each complete once and return
  their findings.

## Realtime voice

### Voice samples come from ChatGPT HTTP, independently of the selectable catalog

- **Behavior:** `GET /backend-api/settings/voices` with `voice_mode=wingman` and
  `spoken_language` returns primary language/accent labels in `accent` and
  prerecorded `preview_url` values. These are public
  HTTPS samples on `persistent.oaistatic.com`. The HTTP catalog can differ from
  App Server's supported voices; never use it to expand the selectable catalog.
  The official client maps account IDs `fathom`, `glimmer`, and `orbit` to realtime
  IDs `arbor`, `sol`, and `spruce`. Unknown aliases must not be guessed.
- **Observed:** Installed Codex App 26.1013.40934 and live Codex OAuth requests on
  2026-10-18. Chromium `net.fetch` succeeded where plain Bun fetch returned a
  Cloudflare challenge. The catalog returned 24 samples; Cove downloaded without
  authorization and completed HTML audio playback. This is an internal client
  endpoint, so failure must leave voice selection usable.
- **Depends on it:** Desktop preloads metadata for the default Codex account
  alongside the selectable catalog when preferences mount. The picker becomes
  available after metadata settles, so its first visible list is already grouped.
  Closing and reopening retain the metadata without a second request or
  regrouping. Credentials remain in main and are never refreshed by this reader.
  Results are discarded if the default account or
  credentials change. Closing, selecting a voice, disabling or unmounting the
  picker stops playback; late results cannot revive a previous player.
  Group supported voices by their upstream `accent`, translating known labels
  and retaining unknown labels. Unlabelled voices go under Other; a failed
  metadata request preserves the flat selectable list. Accent describes the
  primary voice style, not an exhaustive supported-language list.
- **Guard:** `codex-voice-previews.test.ts`, `codex-voice-ipc.test.ts` and
  `CodexRealtimeVoicePreference.test.tsx`; colocated stories cover loading,
  missing samples, retry, playback failure and narrow Chinese dark layouts.

### V3 owns its catalog but still uses the legacy default field

- **Behavior:** 0.163.0 validates v3 voices against the dedicated `voices.v3`
  catalog (25 voices). `voices.v1` remains the nine legacy voices and
  `defaultV1` is still the default for v3; there is no `defaultV3` field.
  Prefer a nonempty v3 list and fall back to v1 for older runtimes. Validate
  the default against the chosen list, and reject an unusable catalog.
- **Observed:** Exact `rust-v0.163.0` source and pinned npm binary; SuperOne
  already sends `version: v3` and needs no realtime model override.
- **Depends on it:** `codex-realtime.ts#mapCodexRealtimeVoiceCatalog` and the
  shared string-based voice preference used by desktop and phone.
- **Guard:** `codex-realtime.test.ts` covers dedicated v3, legacy/empty-v3
  fallback, malformed entries, duplicates and missing/mismatched defaults.
  `CodexRealtimeVoicePreference.stories.tsx` covers 25 choices and selection,
  loading/error/disabled states, and the narrow Chinese dark layout.

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
  (feature flag); `codex-realtime-lifecycle.test.ts` (closure barrier and delegated-task continuation).

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
- **Local form resources:** file/directory `userOptions` require an enabled stdio
  config and a main-process native picker. Only that pending form field's trusted
  picked URIs augment structural answer validation; renderer paths never grant
  access. Main rechecks pending ownership and session/account/configuration after
  async work and before accept. `resource_link` previews read the declared option
  target through the original eliciting server/thread; native provider caps apply,
  without another local IPC cap. Tool previews, remote/phone pickers and previews
  are deferred. Phone clients reject implicit selection and retain supplied
  explicit options.


### Paired-phone voice retains the desktop thread and its account

- **Behavior:** The phone creates a native WebRTC offer and sends it through its
  authenticated LAN/relay channel. Desktop uses the existing Session/account to
  call `thread/realtime/start`. Only the initiating endpoint receives the answer;
  audio flows between the phone and the service. No account credential or
  ephemeral API token is sent to the phone.
- **Ownership:** One host reservation covers starting, active and stopping calls
  across renderer windows and phones. Endpoint identity, attempt ID, host epoch
  and generation fence readiness, stop and stale signaling. Session retains the
  phone's call interest through navigation; confirmed teardown releases it.
- **Teardown:** A stop RPC receipt alone does not free the reservation. Voice
  closure or authoritative runtime disposal does. An uncertain start retains a
  cleanup handle; a cleanup failure holds admission until teardown is confirmed.
  Voice stop does not interrupt the ordinary Codex turn or its pending approvals.
- **Privacy:** SDP bypasses Session reduction, normal event fanout and replay.
  Generic broadcasters refuse signaling events. Trace serialization redacts SDP
  fields and echoed SDP in errors, including app-server wire/receipt diagnostics.
- **Guard:** `realtime-voice-host.test.ts`, `realtime-voice-interest.test.ts`,
  `agent-service.test.ts` (actual remote ingress), `session.test.ts`,
  `event-trace.test.ts`, `mobile-broadcaster.test.ts`,
  `codex-realtime-selection.test.ts` and mobile `src/voice/*test*`.
- **Boundary:** Native builds and mocks do not establish actual upstream mobile
  media behavior. The real acceptance matrix is in
  [mobile voice](../../features/mobile-codex-realtime-voice.md).

## Subagent creation metadata and turn provenance

- **Observed:** pinned `rust-v0.162.1` protocol/source; integration checked with
  protocol fixtures, not a new authenticated live subagent run.
- **Resolved versus requested:** native `ThreadItem.subAgentActivity` carries
  nullable `model` and `reasoningEffort` resolved at creation. Legacy
  `collabAgentToolCall` carries requested spawn values. The shared collab mapper
  stores requested values per receiver in `agentsStates.requestedConfiguration`;
  it never substitutes them for confirmed creation configuration or copies
  unrelated values from multi-child wait/input tools.
- **Data-only activity:** `codex_subagent_activity` records item identity, source
  thread/turn, child thread/path, kind and available configuration. The shared
  reducer stores deduplicated activities and a per-child creation snapshot in
  `CodexTurnInfo.subagents`, alongside requested configuration and child turn
  provenance. Sparse interactions and terminal records do not clear creation
  fields. No parent defaults are guessed. These records do not
  append transcript content or create additional cards; UI consumption and
  native-activity lifecycle presentation remain deferred.
- **Turns:** `codex_turn_metadata` stores genuine provider thread/turn/root IDs.
  Old/null roots remain unknown, and sparse completion does not erase a known
  root for the same turn. Root-thread notifications update the owning message;
  child listeners retain provenance per turn in `agentsStates.turns`, including
  after the parent turn has ended. A reused child has separate records for each
  turn rather than one permanent root attribution.
- **Requests:** desktop `CodexRunRequest`/`CodexSendExtras`, the shared App Server
  client, node live-turn helper and lease-gated node send options accept explicit
  `parentTurnId`/`rootTurnId`. Callers must supply provider IDs from the originating
  Codex turn. No automatic SuperOne session/message-ID conversion is performed.
  Requests are retained as `requestedProvenance`, separately from returned root
  identity: `turn/start` can add input to an active turn, in which case upstream
  ignores attribution. `turn/steer`, review and compact do not send these fields.
  The upstream `Turn` response reports root identity, **not** parent identity;
  no confirmed parent is fabricated. Automatic collaboration attribution and
  permission-context use are deferred; attribution grants no authorization.
- **Delivery:** shared events and complete-message metadata retain these fields
  through persistence/replay and compact phone snapshots/events without loading
  tool detail. Compact collab deltas carry the new metadata index separately from
  the existing omitted `agentsStates`; the UI retains its current read behavior.
  Desktop fork activity uses the owning collaboration item/message,
  while source thread and turn identities remain explicit. The shared completion
  reducer merges data instead of replacing it with a sparse terminal snapshot.
- **Guards:** `packages/codex/src/protocol-v162.test.ts`,
  `packages/chat-core/src/codex-metadata.test.ts`, desktop `codex-turn.test.ts`,
  `codex-backend.test.ts`, `codex-fork-listener.test.ts`,
  `remote/progressive-session.test.ts`, the node Codex runner/client/live-turn
  tests, and runtime turn-source/queue tests.

### Data-layer validation (2026-10-11)

- 297 targeted tests across desktop, shared Codex, chat-core, node CLI and runtime
  cover source identity, nullable/partial values, duplicate activity, late fork
  delivery, per-turn roots, sparse completion, replay, requested attribution and
  compact phone projection. The UI does not read the new metadata.
- Desktop main, shared Codex and CLI typechecks pass. Chat-core and desktop
  renderer production plus other tests pass with only the unchanged failing
  test files excluded: `packages/chat-core/src/realtime.test.ts:26-27` (phase on
  a broad AgentEvent union) and renderer `session-chip.test.tsx:40,45` (Element
  passed to a narrower DOM matcher). Full typechecks still report those errors.
- Harness API inventory and whitespace checks pass. Authenticated native subagent
  turns and a physical phone session were not exercised in this change.
