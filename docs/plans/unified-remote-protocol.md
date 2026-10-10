# Unified remote protocol

Status: in progress · Updated: 2026-10-11 (step 6 in progress)
Goal: One backend serves its own window, controller desktops and phones through one topic/connection core, one per-connection delivery policy and one protocol; every existing phone feature runs on it.
Proposal: [unified-remote-protocol.md](../proposals/unified-remote-protocol.md)
Long-term docs affected: [mobile-remote-control.md](../architecture/mobile-remote-control.md), [remote-node-service.md](../architecture/remote-node-service.md), [chat-core.md](../architecture/chat-core.md), [relay-crypto.md](../architecture/relay-crypto.md) (framing), `apps/desktop/docs/agent-reference/architecture.md`, `apps/desktop/CLAUDE.md` (session control boundary), `apps/mobile/docs/agent-reference/transport.md`

Scope is proposal phases 1–4. Poll-to-push for terminals and watched
directories, Git/workspace parity on the desktop node, configuration families
and features the phone does not have today are phase 5 and get their own plan.
This plan absorbs the former mobile-desktop-compatibility plan (deleted in step 6).

## Starting point (verified 2026-10-10)

| Piece | Where | State |
|---|---|---|
| Desktop hub | `apps/desktop/src/main/stream/session-event-hub.ts`; consumers in `apps/desktop/src/main/index.ts` | `AgentEvent` only, routed by `HubSource`; no topic interest or per-connection state. Terminals bypass it (IPC and `remote/terminal-broadcaster.ts`). |
| Renderer delivery | `agent/renderer-agent-event-transport.ts` | `local-ui` profile: batching plus per-item Codex patch baselines. Broadcast to every window. |
| Phone delivery | `stream/mobile-profile.ts` (`MobileProfilePorts`, accumulate → filter → throttle → rewrite → enrich → strip), `remote/mobile-broadcaster.ts` (live progressive projection), `agent/progressive-bootstrap.ts` (open/history), `remote/progressive-session.ts`, `remote/progressive-tools.ts`, `remote/detail-command.ts`, `remote-control-service.ts`, `remote/payload-codec.ts` | Golden test `stream/profiles.golden.test.ts` checks payload JSON after the profile with the sender stubbed; it does not cover projection, bootstrap, DEFLATE, sealing or chunking. |
| Phone commands | `AgentService.handleRemoteCommand` (`agent/agent-service.ts`, ~100 cases, incl. `node_mint`/`node_pair` and composer/widget forms), `remote/*`; routed node sessions `remote/environment-commands.ts`; internal caller `mcp-apps/executor.ts` | Keyed by `projectPath`/session id; per-device transport `'lan' \| 'relay'` known. Routed phones reduce locally, re-project, and open their own `subscribeEvents` stream. |
| Phone client | `packages/relay-client` (`client.ts`, `rpc.ts` `RpcInbox`, `request-coalescer.ts`, `phone-link.ts`), `apps/mobile/src`, `packages/chat-view` | Handshake carries host name and LAN hint, no version. |
| Node protocol | `packages/runtime/src/server/` (`rpc-dispatch.ts`, `event-stream.ts`, `node-server.ts`, `secure-channel-client.ts`); CLI extensions `apps/cli/src/rpc/handlers.ts`; desktop client `environment/node-rpc-client.ts`, `remote-environment-gateway.ts`, `remote-session-feed.ts`, `node-route-resolver.ts` | Aggregate filtering, microtask batching, cursors/epoch/`resnapshot`. Capabilities are family booleans; partial ports declare `servedMethods`. Drafts and harness resources are CLI-only extensions. Protocol generation min = max = 2. No compression, profile or per-connection policy. |
| Desktop as node | `node-host/` | Separate identity under `userData/node-host`; sessions limited to controller-started ones (`desktop-session-host.ts`); Git `fetch`/`worktreeActivate` only. |
| Local gateway | `environment/environment-host.ts`, `local-environment-gateway.ts` | Session create/send/acquire stubbed, `get` returns null; terminals `notWired`; workspace write ignores `expectedHash`. |
| Detail client | `packages/chat-view` (`use-deferred-text.ts` calls the native bridge directly, `detail-cache.ts` keyed by bare ref, `Deferred*.tsx`) | Phone only. Desktop rows render through `GenericToolRowPresenter` and do not read `remoteDetail`. |
| Control | `session/session.ts` owner model; `terminal/terminal-ownership.ts`; `packages/runtime/src/lease/control-lease.ts` | Lease service covers sessions and terminals on nodes; terminal acquire passes no `delegate`/`yields`. Local sessions and terminals use owner objects. |
| Identity | `environment/session-identity.ts`, `local-identity.ts` vs `node-host/node-host-server.ts` | One desktop has two environment ids: local and node host. Lease keys include the environment id. |

## Steps

The phone stays on the old wire until step 6. Steps 1–3 extract and reconnect
existing behavior; old-wire payloads stay the same. Steps 4–5 put the old phone
entry points on the new internals as they land, without flags or a translation
layer.

### 0. Baseline

- Using the existing recorded fixtures, record the current phone wire through
  the real sender and codec: bytes and frame count for a live turn, session
  open, a history page and a detail expansion, on relay.
- Exit: the baseline is a test fixture that later steps compare against.

### 1. Topic and connection core

- Shared core in `@superone/runtime`: topics keyed by scoped refs, connections
  with topics, policy and sink. Extend `openEventStream` for the node side;
  keep its cursors, epochs and `resnapshot`.
- Producers: desktop hub sources, `DesktopSessionHost`'s event log, terminals
  (local IPC and `TerminalBroadcaster` paths), the CLI dispatcher.
- Sinks: renderer, each phone, each controller connection. Bookkeeping,
  automation, collaboration and notification consumers stay source-based.
- Renderer interest: the union of what open windows show, updated on window
  close and session switch; delivery to windows stays a broadcast.
- Recovery per existing phone topic: session list, projects and drafts get an
  initial snapshot, a version and change events (producers: today's mutation
  notices in `session-list-watch.ts` and draft control); terminals keep
  sequence plus attach snapshot. A recovery signal names a scoped topic, not
  only session ids as `SessionStreamFrame.resnapshot` does. No new topic
  kinds.
- Exit: topic routing and per-topic recovery tests; old-wire payloads
  unchanged against step 0.

### 2. Per-connection delivery policy

- Parameterize the existing `mobile` profile through `MobileProfilePorts`; no
  stage plugin framework. Keep accumulate before filter. Split tier stages
  from phone-surface stages.
- One policy covers open, history pages (`progressive-bootstrap.ts`), live
  events (`mobile-broadcaster.ts`) and detail.
- Tier mapping: in-process IPC → `local`; `lan`, `tailscale`, `direct`, `ssh`
  → `lan`; `relay` → `relay`. Taken from the path the supervisor or phone link
  chose, never from the URL (SSH forwards to loopback).
- `local` keeps the renderer transport's batching and Codex patch baselines,
  including baseline reset.
- Move the pipeline into `@superone/runtime` with desktop-only reads behind the
  existing ports.
- Exit: old-wire payloads unchanged against step 0; two connections with
  different policies on one session do not share projection or detail state.

### 3. Shared detail client

- `packages/chat-core`: transport-independent detail state (subscribe,
  unsubscribe, listen through injected ports), revision/offset application and
  the cache, keyed by environment, session and detail ref.
- `packages/chat-view` keeps React, i18n and presentation on top of it.
- Desktop: every row the projection defers reads `remoteDetail` through the
  same state with an IPC port, keeping the desktop presenters:
  `GenericToolRowPresenter`, reasoning, Claude subagent and workflow cards,
  Codex command, file change, MCP and collaboration items. Hydration reuses
  the deferred adapters in `PortableTurnAdapters.tsx` and `DeferredTool.tsx`.
- Exit: tests with a mock transport, including a subagent expansion and a
  Codex diff; desktop Storybook stories for collapsed, loading, error/retry and
  expanded deferred rows (light/dark, narrow).

### 4. Protocol and routing

- Topic subscribe/unsubscribe RPCs; `session.subscribe` becomes one topic kind.
  Detail subscriptions and progressive open/history as RPCs.
- Framing: DEFLATE inside the sealed frame above 512 bytes, chunked responses.
  Backpressure: per-connection byte budget, control events first, over budget
  the topic degrades to `resnapshot`.
- Shared, Metro-safe envelope, receipt/stream handling and request coalescer in
  `@superone/shared`; desktop, CLI and phone keep their own socket adapters. No
  Node transport in Expo.
- Capabilities per method: replace family booleans with served methods in the
  descriptor; carry them through the gateway, preload and UI gating; a routing
  desktop reports each target's methods.
- Generation 3; generation 2 peers are refused.
- Routing: extend `remote-session-feed.ts` into an interest union with ref
  counts across the desktop's own window, controllers and routed phones; the
  session-list observer keeps its notifications; routed phones (still on the
  old wire) join this feed instead of their own stream. Detail requests forward
  to the source environment; the routing desktop does not assume it holds full
  bodies. A tier change realigns through snapshot, not the
  `routed-catch-up.ts` prefix rule.
- Summaries on desktop and CLI nodes turn on only after the above.
- Exit: dev desktops A and B from this worktree (`scripts/desktop-node-lab.ts`)
  over LAN and relay; A over relay within step 0's bytes and frames for the
  same turn; LAN → relay failover mid-turn switches tier without reload;
  generation 2 refused.

### 5. Desktop endpoint for phones

- Split the desktop's always-on domain context (identity, database, leases,
  idempotency, event log, session host) from the optional controller listener
  (LAN/relay node access). Turning controller access off stops the listener
  only; the local window and phones keep the services.
- Phone channel adapter: `phone-link-host.ts`, `remote-control-service.ts`
  and `lan-server.ts` decode protocol messages into the shared dispatcher and
  topic core; responses and pushes return to the asking connection; the actor
  comes from the authenticated pairing. Same channel and keys; no node pairing
  entry. Enabled together with the client in step 6.
- Adapt `SessionManager`, the desktop database and `TerminalManager` to the
  shared ports and wire the local gateway: reads and contracts here; local
  mutation and control turn on with the lease move in step 6, so no resource
  has two authorities at once. The phone endpoint covers every local and archived session it
  can open today. Which sessions a controller desktop sees stays as is.
- Move the CLI-only handlers the phone needs (drafts, harness resources, …)
  into runtime ports on the existing dispatcher and `servedMethods`.
- Coverage list generated from the actual old-command call sites: old command
  → new method, desktop-only client state, routed support. Includes
  phone-assisted desktop pairing (`node_mint`, `node_pair`), composer and
  widget forms, client-scoped methods (push tokens, seen state, presence,
  mobile logs).
- Identity: the node-host identity is canonical for all resources, topics,
  caches and lease keys. A desktop without one initializes it from its local
  id. A desktop that has both keeps the old local id as one alias: session
  links, metadata lookups and the registry resolve the alias before checking
  the real resource; the authenticated descriptor reports the alias and paired
  controllers persist it; the phone handshake reports the canonical id and the
  endpoint normalizes old refs. No link rewriting, no scan for bare session
  ids, no new pairings.
- Conditional writes: file and configuration writes the phone performs today
  carry the existing `expectedHash`/version through local, CLI and desktop
  adapters; add compare-and-write where missing. No general conflict
  framework.
- Authenticated host version and protocol generation in the phone link
  handshake (LAN and relay), so desktops ship it before phones enforce it.
- Exit: a contract suite runs every listed family against the local desktop
  endpoint; routed families against the node lab.

### 6. Leases and phone cut-over

- Local sessions and terminals move to the existing lease service with
  today's takeover rules; `TerminalOwnership` and the `Session` owner model go.
  Terminal acquire gains `delegate`/`yields`. Window and phone actors come
  from the authenticated client and pairing. IPC, phone and controller
  mutations are fenced.
- Phone client speaks the protocol, reusing `RpcInbox` for pending receipts
  and native wire decoding for bounded fragments. `RemoteCommand` phone commands, `environment_command` and
  `handleRemoteCommand` are removed; `mcp-apps/executor.ts` calls the new
  methods.
- Minimum desktop version: an older or unreported host gets upgrade-required;
  no probing or legacy restore paths. Desktop release first, then the mobile
  build/OTA that enforces the floor, through alpha. Delete
  `mobile-desktop-compatibility.md`.
- `apps/desktop/CLAUDE.md` and the desktop architecture manual change their
  session control rule in this step.
- Exit: every coverage-list family on a live pairing over LAN and relay; bytes
  and frames within step 0; fenced contract tests for local mutation and
  control; two phones and a desktop contend for a session and a terminal with
  the expected outcomes.

### 7. Fold into long-term docs

Behavior docs change in the commit that changes the behavior. This step
finishes the long-term docs in the header (model, tiers, topics, protocol),
points code comments there, and deletes this plan and the proposal.

## Step 5 coverage list

From the `RemoteCommand` union (`packages/shared/src/agent-types.ts`,
`DraftRemoteCommand`, `CodexAsyncQuestionAnswerCommand`) and its call sites in
`apps/mobile`, `packages/relay-client` and `mcp-apps/executor.ts`. Existing
methods are the node dispatcher's (`rpc-dispatch.ts`) or the CLI tables moved
into runtime; **new** methods are added in step 5. Client-scoped methods are
served by the paired desktop endpoint only. Routed: served for a node session
through the desktop today (`environment-commands.ts`), by envelope
`environmentId` after the cut-over.

| Old command | Method | Routed |
|---|---|---|
| `create_session` | `session.create` | |
| `send_message` | `session.send` | yes |
| `interrupt` | `session.interrupt` | yes |
| `respond_permission` | `session.respondPermission` | yes |
| `answer_question`, `dismiss_question` | `session.respondQuestion` (`dismiss`) | yes |
| `respond_plan_approval`, `codex_plan_approval` | `session.respondPlan` | yes |
| `codex_async_question_answer` | **`session.answerAsyncQuestion`** | |
| `set_permission_mode`, `set_sandbox_mode`, `set_session_settings`, `set_session_api_provider_id`, `set_session_additional_dirs` | `session.patchSettings` | modes |
| `request_session_recap` | **`session.recap`** | |
| `set_session_goal`, `clear_session_goal` | **`session.setGoal`** | |
| `dequeue_message`, `steer_queued_message` | **`session.dequeue`**, **`session.steer`** | |
| `subscribe_session`, `unsubscribe_session`, `leave_session` | `session.load` + `topic.subscribe` / `topic.update`, `session.acquireControl` / `session.releaseControl` | yes |
| `subscribe_detail`, `unsubscribe_detail` | `session.subscribeDetail`, `session.unsubscribeDetail` | yes |
| `load_session_messages`, `get_session_history_index` | `session.load` (`before` or `anchorId`/`direction`), **`session.historyIndex`** | yes |
| `get_session_state` | `session.load` | yes |
| `get_attachment` | **`session.attachment`** | |
| `mod_ui_request` | `session.modUi` | |
| `mcp_app_request` | **`mcpApps.request`** (frontend View operations) | |
| `list_sessions`, `list_pinned_sessions`, `find_session`, `search_sessions`, `list_session_activity` | **`sessionList.page`**, **`sessionList.pinned`**, **`sessionList.find`**, **`sessionList.search`**, **`session.activity`** (the sidebar's projections) | |
| `pin_session`, `archive_session`, `delete_session`, `fork_session` | `session.setUiFlags` (`isPinned` / `isHidden`), `session.remove`, `session.fork` | |
| `session_link_identity`, `session_link_metadata`, `session_link_resolve` | **`environment.list`**, **`session.linkMetadata`**, **`session.linkResolve`** | |
| `list_drafts`, `save_draft`, `delete_draft` | `draft.list`, `draft.upsert`, `draft.delete` | |
| `open_draft`, `close_draft` | **`draft.open`**, **`draft.close`** (draft lease, `expectedUpdatedAt`) | |
| `composer_open`, `composer_cancel`, `composer_outcome`, `open_widget_input_request` | **`composer.open`**, **`composer.cancel`**, **`composer.outcome`**, **`composer.openInputRequest`** | |
| `save_widget_template` | **`widget.saveTemplate`** | |
| `search_mcp_mentions`, `read_mcp_mentions`, `list_mcp_servers`, `get_mcp_icons` | **`mcp.searchMentions`**, **`mcp.readMentions`**, `mcp.list`, **`mcp.icons`** | |
| `list_directory`, `browse_host_directory`, `create_directory` | **`files.listDir`**, `fs.listDir`, **`files.mkdir`** | |
| `search_files`, `search_mentions`, `get_mention_icons` | `workspace.search`, **`workspace.searchMentions`**, **`workspace.mentionIcons`** | |
| `read_desktop_file`, `read_video_poster` | **`files.read`**, **`files.videoPoster`** | |
| `upload_file`, `upload_file_complete` | **`files.upload`**, **`files.uploadComplete`** (client-minted `uploadId`) | |
| `resolve_favicon` | **`environment.favicon`** | |
| `list_projects`, `add_project`, `add_project_additional_dir`, `remove_project_additional_dir` | `project.list`, `project.open` (`createIfMissing`), `project.update` (`addExtraDirs` / `removeExtraDirs`) | list |
| `get_default_clone_path`, `set_default_clone_path` | **`git.defaultClonePath`**, **`git.setDefaultClonePath`** | |
| `clone_repository`, `search_github_repos` | `git.clone`, **`git.searchGithub`** | |
| `get_git_info`, `get_git_file_status`, `get_git_branches`, `list_git_mention_refs` | `git.status`, `git.status` (`paths`), `git.branches`, `git.mentionRefs` | |
| `switch_git_branch`, `create_git_branch` | `git.switchBranch`, `git.createBranch` | |
| `get_worktree_info`, `get_checked_out_branches` | `git.worktrees`, `git.worktreeCheckedOutBranches` | |
| `list_harness_options`, `get_system_info`, `get_project_resources` | **`harness.options`**, **`harness.systemInfo`**, **`harness.projectResources`** (a routing desktop builds them from the node's `harness.resources`) | yes |
| `get_usage`, `consume_rate_limit_reset`, `list_media_providers` | **`harness.usage`**, **`codex.consumeRateLimitReset`**, **`media.listProviders`** | |
| `terminal_create`, `terminal_subscribe`, `terminal_unsubscribe`, `terminal_input`, `terminal_resize`, `terminal_kill` | `terminal.create`, `terminal.attach` + `topic.subscribe`, `topic.update`, `terminal.write`, `terminal.resize`, `terminal.kill` | |
| `terminal_list`, `terminal_claim` | **`terminal.list`**, `terminal.acquireControl` | |
| `mark_session_seen`, `append_mobile_log` | **`client.markSeen`**, **`client.appendLog`** (client-scoped) | |
| `node_mint`, `node_pair` | **`client.mintNodeCode`**, **`client.pairNode`** (client-scoped) | |
| `environment_command` | removed: the envelope's `environmentId` routes | |

Defined but never sent, removed without a method: `list_models`,
`activate_worktree`, `list_directory_for_add_dir`, `validate_add_dir`,
`list_providers`, `terminal_release`. Presence stays implicit in the
connection; there is no push-token command.

Conditional writes: drafts keep `expectedUpdatedAt` and their lease; MCP app
files keep `ifMatch`; `workspace.writeFile` keeps `expectedHash`. A project's
extra folders change by `addExtraDirs` / `removeExtraDirs` deltas that compose
with concurrent edits (`resolveProjectExtraDirs`), and the default clone path
is a single value whose last write wins, so neither needs a version. Session
and terminal mutations are fenced by leases (step 6).

The phone's composer catalogs come from the desktop that pairs it, not from
the CLI's `harness.resources`, so those handlers stay with the CLI.

## Verification

- Unit, contract and golden tests per step from `apps/desktop`
  (`bunx vitest related …`) and the runtime package.
- Node lab: dev desktops A and B from this worktree on one Mac, then two Macs
  over Tailscale and relay.
- Live phone pairing on the iOS simulator and a device, LAN and relay.
- Bytes and frames against the step 0 baseline at steps 4 and 6 only.

## Progress

- Step 0 done: `apps/desktop/src/main/stream/wire-baseline.test.ts` pins
  `fixtures/wire-baseline.json` (relay bytes, frames and the decoded event
  digest per recording).
- Step 1 done: `TopicHub`, `VersionedTopicLog` and `DeliveryPolicy` in
  `@superone/runtime/stream`; `TopicRef` in `@superone/shared/environment/topics`;
  `openEventStream` filters by topic and names `recover` topics. Desktop
  publishes hub events by topic (`stream/desktop-topics.ts`); the renderer
  (`renderer-interest.ts`) and each phone (`remote/phone-topics.ts`) are
  connections; list/draft/terminal recovery in `stream/topic-recovery.ts`.
  The wire baseline is unchanged.
- Step 2 done: `ConnectionDelivery` (`@superone/runtime/stream/delivery`) holds
  a connection's policy, projection views, detail subscriptions and profile
  state; `EventProfile` splits tier stages (relay: truncate, throttle) from
  phone-surface stages; desktop reads are `RemoteContentPorts`. Phones get one
  delivery each (`remote/phone-deliveries.ts`) for open, history, live and
  detail, and one batcher each; the renderer's `local` tier is
  `createLocalDelivery`. Live relay frames dropped (e.g. 166 → 160 on
  permission-flow) with the same decoded events.
- Step 3 done: `createDetailClient` in `@superone/chat-core` (transport
  injected); the phone document and desktop renderer each provide one through
  `DetailScopeProvider`. Desktop renders `remoteDetail` rows with its own blocks
  (tool, Bash, reasoning, subagent, workflow, Codex command/file change/MCP/
  collab) and routes `remote_detail` to its client; main forwards
  `environment:subscribeDetail` to the gateway's optional
  `sessions.subscribeDetail`, which step 4 implements. Stories:
  `components/chat/DeferredRows.stories.tsx`.
- Step 4 (in progress): generation 3 with wire framing (DEFLATE, fragments)
  after the generation handshake, the per-connection outbox (control first,
  socket high-water mark) and stream flow control (hold while congested,
  resnapshot past the budget). `topic.subscribe` / `topic.update` /
  `topic.unsubscribe` replace `session.subscribe`; node connections deliver
  by policy (relay: summarized load and stream, `session.subscribeDetail`);
  the desktop feed is an interest union that routed phones join, detail
  forwards to the node when the desktop's copy is summarized, and a tier
  change realigns followers through snapshots. The client protocol
  connection and request coalescer are shared (`rpc-connection.ts`).
  Per-method capabilities: descriptors list `methods` derived from the
  dispatcher's handler table plus host extensions; family flags removed
  except `coldSessionResume`/`turnReattach`/`hostActionV1`. Gateway gates
  drafts and the sync zone, agent tools gate archive, and the file tree
  says when a node does not share files (`useEnvironmentServes`).
  Acceptance: `e2e/desktop-node-orchestration.spec.ts` (A and B, scripted
  harness) passes on generation 3; `node-host-protocol.integration.test.ts`
  follows the step 0 recordings from A over the relay at 47–61% of the phone
  link's bytes and fewer frames (push history DEFLATE, a 33 ms batch window,
  folded deltas, summarized tool input left out), and keeps following a
  session across LAN → relay → LAN mid-turn with a realign each time;
  generation 2 refusal is `node-server.secure-channel.test.ts`. Step 4 done.
- Step 5 done: descriptors list only served methods (`unservedMethods`); one
  environment id per desktop (node identity canonical, local id an alias in
  `environmentAliases`); `DesktopDomain` open apart from the controller
  listener, recording every desktop session; host version and generation in
  the phone link handshake. Phone endpoint: `rpc` link frames carry the
  protocol, and each link is a `createConnectionRpc` connection
  (`node-host/phone-endpoint.ts`, shared with node sockets) over the domain's
  phone context: every session to read, workspace files and Git, terminals
  (list, attach, pushed `terminal`/`terminalList` topics), drafts with their
  leases (`draft.*` and `DraftControl` now in the runtime, pushed `drafts`
  topic), project open and extra-folder edits, and the desktop methods in
  `remote/phone-methods.ts` (session list pages, composer catalogs, mentions,
  MCP views, host files, usage, client-scoped methods), sharing their bodies
  with the old commands through `AgentService` methods. Session and terminal
  changes stay refused until step 6. Contract suite:
  `node-host/phone-contract/*.contract.test.ts`. Not wired to live phone
  links until step 6.
- Step 6 (in progress): terminals now use the domain's `ControlLeaseService`;
  `TerminalOwnership` removed. `TerminalLease` derives the writer from the
  authority and retains watchers only. Terminal RPC acquire carries
  `delegate`/`yields`; `bindControlActor` binds a phone to its authenticated
  pairing, refusing payload impersonation. Terminal IPC is extracted into
  `terminal-ipc.ts` and fences write, resize and kill by the sender window;
  explicit reclaim revokes the previous grant. Lease renewal preserves the
  delegate; expiry updates observers. Attach snapshots and pushed control
  hints describe the asking device. The endpoint's terminal writes are now
  served, although live phone links still use the old application protocol.
  `phone-contract/terminals.contract.test.ts` exercises two phones and a
  window over both LAN and relay endpoint policies, including forged delegate,
  stale write, takeover, renewal, release and kill. Remaining: phone client/link cut-over and
  old command removal, minimum-version floor and release ordering, live
  pairing/device/lab acceptance, wire-baseline comparison and step 7 docs.
  Verification of the terminal migration: desktop targeted checks (terminal
  lifecycle, tools, phone topics, endpoint terminal/session/desktop-method
  contracts and AgentService) 227 passed, 21 existing skips; runtime lease,
  dispatcher and topic-stream checks 35 passed; desktop node and runtime
  typechecks passed. The old-wire budget gate is still unresolved:
  `mermaid-latex` live is 19,456 bytes against 19,416, with the same 25
  frames and decoded-event digest. It reproduces with the HEAD baseline test
  and HEAD PhoneTopics in an isolated temporary copy. The immutable step-0
  budget has not been raised; investigate and verify it again through the
  actual protocol phone sender during cut-over. No live phone/device or
  two-machine acceptance has been performed for this migration.

## Open decisions

None.

- 2026-10-10: Step 6 session migration and local gateway wiring are in place.
  `SessionLease` uses the domain service, bound before controller adoption to
  every live/resumed Session. Legacy owner APIs now derive their view from
  the lease; their removal still belongs to the old phone dispatcher cut-over.
  Session mutations validate authenticated IPC/phone/RPC scopes. Exact proofs
  survive awaits; sends revalidate after admission waits and backend startup.
  Controller operations no longer claim/release a separate Session owner.
  LocalSessionHost serves fenced create/send/settings/metadata/lifetime and
  interaction operations. Local gateways use InProcessRpcClient and the same
  resource helpers and dispatcher as network clients. Phone endpoint contracts
  cover two phones and a window over LAN/relay policies, stolen proofs,
  delegation spoofing, renewal, expiry, takeover and initial create settings.
  Verified: session/core/agent/node protocol checks 443 passed, 21 existing skips;
  local/network gateway and endpoint checks 48 passed; runtime lease/dispatcher/
  topics checks 35 passed. Desktop node and runtime typechecks passed. These are
  automated contract checks; live phone switching, two-machine acceptance,
  protocol cut-over, version floor, release, wire budget and step 7 remain.

- 2026-10-10: Step 6 phone method coverage now includes fenced recap, Goal,
  queued dequeue/steer and durable Codex async answers. Queued phone operations
  use a common session queue and revalidate their admitted lease after waiting.
  The shared settings parser retains native mode, agent preset and directory
  selections; unsupported node settings fail before session creation or a
  partial defaults write. Permission responses retain reasons and suggestions;
  question responses retain dismissals and annotations; persisted Codex plan
  approvals use `session.respondPlan`. Composer open/input-request, cancel and
  outcome methods reuse the desktop form registry. Result collection is
  frontend-bound and replayable by an idempotency receipt. Extension file,
  template, settings and access writes require their corresponding write scopes.
  `RpcInbox` moved to the Metro-safe shared layer; `RpcConnection` uses it instead
  of a second pending-request map. The relay client temporarily re-exports it
  while its old application commands await cut-over. A removed worktree remains
  an internal host reaction, so it can stop a turn even when a different frontend
  holds the lease. Verified: desktop session/agent/phone regressions 440 passed,
  21 existing skips; later composer/input-request checks 35 passed; final phone,
  node-server, resend and in-process client checks 29 passed; runtime settings,
  dispatcher, interaction and queue checks 46 passed; shared RPC checks 9 passed;
  relay inbox/client checks 18 passed. Desktop node, runtime and relay-client
  typechecks passed. No live device or two-machine acceptance was performed.
  Still required before the phone client can switch: full send-option parity,
  fork and draft-control operations, restore/history facts, MCP Apps and the
  client-scoped composer push binding. The actual phone link/client cut-over,
  old dispatcher deletion, version floor/release ordering, immutable wire gate,
  live acceptance and final documentation cleanup remain in the original scope.

- 2026-10-10: Step 6 rich sends now retain priority, steering, agent/thread,
  Codex permission/service/effort/collaboration selections and InputRequest
  correlation. Unsupported selections fail before settings or history writes.
  Native fork revalidates the source grant across worktree activation and harness
  cloning, rolling back created worktrees on revocation. Draft open waits for the
  editor flush, and an expired open receipt cannot replay an invalid draft lease.
  `session.load` returns host restore facts, active-turn rows and reduced pending,
  queued, todo, Goal and usage state at one cursor; bounded anchor pages share one
  range parser. MCP Apps use `mcpApps.request`, authenticated target binding and
  the native send queue, with the exact grant rechecked after provider readiness,
  approval and queued waits. Desktop IPC queue, MCP App and provider actions carry
  the window actor; queue wait takeover cannot silently reacquire control.
  Verified: final desktop IPC/App/phone checks 210 passed, 21 existing skips;
  added queue takeover regression 156 passed, 21 existing skips; earlier restore/
  draft checks 184 passed, 21 existing skips; runtime restore checks 38 passed;
  provider checks 22 passed; CLI MCP cancel/state checks 6 passed. Desktop node,
  runtime and CLI typechecks passed. The actual phone transport/client cut-over,
  client-scoped composer pushes, old dispatcher deletion, version floor/release,
  immutable wire gate, live acceptance and final documentation cleanup remain.

- 2026-10-11: Step 6 phone reads and mutations now use native RPCs for chat,
  history/details, rich sends, questions/permissions/plans, settings, Goal,
  recap, composer/widgets, MCP Apps, files/mentions, Git, project management,
  diagnostics, usage and sidebar actions. Restore binds canonical project and
  environment identities, validates the project of every bounded history page,
  and seeds reduced state at the atomic cursor. A prepared session view has its
  own feed; cancellation preserves the source grant and commit retires it.
  Sidebar operations release temporary grants while a visible feed retains its
  own grant. Terminal commands use native RPC and exact proofs; the output feed
  subscribes before attaching, discards covered output, bounds pre-snapshot
  buffering and resnapshots sequence gaps. Native terminal list/create resolve
  the session checkout on the host; failed reads never create another PTY, kill
  failures retain the tab, interrupted creates reuse their receipt key, and tab
  disposal releases the grant and stream. The CLI terminal port now publishes
  native output/control/exit events and returns full attach metadata. Verified:
  latest native relay terminal/control checks 12 passed; mobile terminal/link
  checks 21 passed; shared RPC/desktop terminal checks 10 passed; runtime
  dispatch/topic checks 28 passed; encrypted session/terminal contracts 16
  passed; real CLI PTY checks 4 passed. Desktop node, mobile, runtime, CLI and
  relay-client typechecks passed at this checkpoint. Workspace background
  topics, native routed RPC, deletion of old command/owner/broadcast adapters,
  concrete version floor and upgrade UI, desktop-first release, the immutable
  wire gate, live phone/two-machine acceptance and documentation cleanup remain
  required. No live device or two-machine acceptance was performed.

- 2026-10-11: Workspace topic subscriptions now share the desktop's existing
  topic hub and bounded change logs. Native `topic` packets carry scoped
  snapshots and independent versions; retained cursors replay changes and old
  cursors receive fresh snapshots. Project/list/draft/environment subscriptions
  enforce their own permissions and environment identity. Subscription dispatch
  moved into a separate runtime module. The phone follows these topics outside
  transcript buffering, applies project and draft snapshots, and invalidates
  session pages. Draft snapshots preserve phone outbox edits and revoke missing
  or transferred grants; late list receipts cannot overwrite newer pushed state.
  Terminal list notices update matching tabs without feeding output twice.
  Main no longer starts the old automatic phone broadcaster; a native channel
  ignores old application events. The remaining mobile session-exit command
  now retires native subscriptions and control. Replacement feed cancellation
  cannot open a new stream after its owner left; session replacement retains
  the new use before releasing the old use of the same grant. Verified: native
  workspace/session/terminal feed checks 22 passed; encrypted workspace/session
  contracts 12 passed; desktop topic/terminal checks 12 passed; runtime
  dispatcher permission/cursor checks 28 passed; mobile draft/connection checks
  19 passed; mobile exit/terminal/draft checks 24 passed; draft hook check 1
  passed; upload transport matrix 6 passed. Mobile, desktop node, runtime, CLI
  and relay-client typechecks passed during this checkpoint. Native routed RPC,
  old dispatcher/owner/codec adapter deletion, the concrete version floor and
  upgrade UI, desktop-first release, immutable wire gate, live acceptance and
  final documentation cleanup remain in scope.

- 2026-10-11: Native phone RPC now runs end to end over encrypted LAN and Relay
  links, including routed node reads, streams and delegated control. Both
  transports reject retired application-command frames. The mobile SDK no longer
  exposes the old command API; it requires protocol 3, canonical environment
  identity and desktop version `0.73.0-alpha.1` before opening the native channel.
  The upgrade sheet has production stories and passing component tests; visual
  review and publication remain. `RpcInbox` now owns receipts only; native wire
  decoding owns bounded fragments. The immutable recordings gate passes through
  the production encrypted endpoint and Expo decoder without changing the
  baseline. A real native MCP App response also passes a 2 MiB fragmented-output
  round trip. The desktop's old application dispatcher, renderer forwarding,
  phone/terminal broadcasters and progressive bootstrap were deleted. File reads
  use a typed host service retaining path authorization and device-bound transfer.
  Local lease revocation now invalidates the SDK's exact proof immediately,
  including revocation before an acquire receipt arrives. Verified: AgentService
  and native session/Git contracts 97 passed with 4 existing skips; receipt checks
  11 passed; native LAN/Relay, pairing and shutdown checks 96 passed; native
  background interaction/workspace/composer checks 69 passed; SDK control/restore
  checks 25 passed; upgrade component checks 3 passed. Desktop node and mobile
  typechecks pass. The native codec benchmark completes. The routed command
  adapter and legacy Session owner/subscriber model still require deletion with
  native disconnect/takeover coverage. Remaining scope also includes dead codecs,
  affected UI checks, desktop-first release, physical phone/two-machine/lab
  acceptance and final documentation cleanup. The minimum desktop build has not
  been published, and no live device acceptance has been performed.

- 2026-10-11: The routed application-command adapter, legacy Session owner and
  subscriber APIs, retired payload codecs and phone command types are deleted.
  Native routed grants serialize admission and retirement at each resource;
  overlapping LAN/Relay links share the same actor proof, and only the final
  link retires it. Disconnect during admission releases the returned grant;
  desktop kicks push exact-proof loss to all active holders. Renderer presence
  and startup snapshots now derive from native control leases. A reconnecting
  local phone watches a reused native proof even when acquire emits no change.
  Real paired CLI acceptance now uses encrypted native phone links and SDK
  recovery across a terminated node socket. Verified: session/native phone
  contracts 450 passed; routed grants/router contracts 16 passed; AgentService,
  routed contracts and real CLI acceptance 83 passed, 4 existing skips; renderer
  control, encrypted link and frozen wire gate 320 passed. Native relay mailbox
  delivery and draft outbox checks pass. Desktop node, renderer, mobile, runtime
  and relay-client typechecks pass; corrected mobile Git fixtures pass (7 unit
  and 4 hook cases). Remaining: upstream revocation forwarding, routed renderer
  control projection, terminal adapter cleanup, affected UI/CI checks,
  desktop-first alpha publication, physical pairing/lab acceptance and final
  documentation cleanup. The minimum desktop build remains unpublished.

- 2026-10-11: Upstream native proof loss is now delivered privately through
  `ConnectionRpc`, the node client and routed-phone grant manager. Exact-proof
  admission, expiry and disconnect rules are shared by local and routed phones;
  a real paired CLI test revokes its authority and verifies SDK invalidation.
  Routed renderer presence resolves source metadata without transcript bodies
  and cannot apply stale async metadata over a newer grant. The terminal's
  legacy claim/subscriber adapters and the last legacy restore-snapshot helper
  are deleted. IPC responses and realtime/queue actions fence the addressed
  Session rather than another Session active in the same project.
- 2026-10-11: Full checks before the final draft-policy correction passed:
  desktop 14,060 tests with 35 existing skips; runtime 775; CLI 399; relay 56;
  mobile Vitest 1,070 plus native Jest 504; relay-client 156. Dependency-lock,
  lint, all workspace typechecks and generated-icon checks passed. Old restore
  and deferred-presenter test fixtures now use atomic native loads and scoped
  detail clients. Production upgrade-sheet UI was checked on iOS simulators at
  440 and 375 logical pixels, English/Chinese and dark/light, including dismiss,
  busy and long-name retry states. Both simulators and the preview server were
  released after checking. These are preview checks, not a live pairing.
- 2026-10-11: The final audit found that the desktop's versioned workspace
  notices bypassed relay draft-save throttling. Notice connections now receive
  their actual delivery policy. Relay saves compact by draft over five seconds
  and declare their `(afterVersion, cursor.version]` range; LAN is immediate,
  lease/delete changes flush prior versions, and removal/disposal cancels saves.
  Encrypted endpoint-to-SDK LAN/relay contracts and the frozen wire gate pass
  (16 tests); SDK version-span recovery checks pass (13 tests), and desktop node
  typechecking passes. Full release checks must be rerun on the committed tree.
- 2026-10-11: The absorbed mobile-desktop-compatibility plan is deleted, and
  long-term protocol, framing, restore, native control and transport manuals
  describe the implemented contract. The desktop version floor remains
  unpublished. Fresh EAS checks found build 35 already shipping the current
  runtime on Android/internal and iOS/production, so both mobile updates are OTA.
  Both isolated development desktops started from the current worktree, but
  Electron Computer Use permission was denied before UI pairing acceptance;
  their development services were then closed. A clarification is pending.
  Remaining: authorized live A/B pairing and contention acceptance, the
  desktop-first alpha release and subsequent mobile OTAs, published-artifact
  verification, and deletion of this plan and its accepted proposal after
  acceptance. This plan does not require two physical machines; its desktop
  lab uses two isolated development profiles on the same Mac.
- 2026-10-11: The native cut-over is committed as `fca0f22d7`. Final CI
  exposed two test-only defects: a fixed 50 ms wait for parallel MCP host
  actions and draft-change fixtures missing their required record. They are
  corrected in `6d08c5c13` and `40bd7975a`. All release checks pass on
  `40bd7975a`: dependency lock, lint, all workspace typechecks, desktop 14,062
  tests (35 existing skips), runtime 775, CLI 399, relay 56, mobile Vitest
  1,070 and native Jest 504, and generated icons. The additional relay-client
  suite passes 160 tests. The immutable step-0 wire fixture remains unchanged.
  The next alpha is `0.73.0-alpha.1`, with the same CLI version; Android and
  iOS both qualify for build-35 OTA. Release notes and the desktop-first
  publication sequence are drafted. No release was pushed or published.
  Live desktop pairing and contention remain pending the explicitly denied
  Electron Computer Use permission; the authorization clarification has no
  reply. Publication, artifact verification and final plan/proposal deletion
  remain pending that acceptance.

- 2026-10-11: The user authorized CDP for desktop acceptance. Playwright's
  Electron CDP launch works after clearing the inherited
  `ELECTRON_RUN_AS_NODE` shell flag; native Computer Use is not needed.
  `e2e/desktop-node-orchestration.spec.ts` passes all three tests on the
  current production build, including pairing, collaboration and recovery.
  The initial live protocol suite passes both LAN and the project Alpha
  Relay with two freshly paired SDK phone identities: catalogs, projects,
  Git and workspace reads, drafts, session lists/history/links, settings,
  native transcript pushes, session and real PTY contention, spoofed proofs,
  desktop takeover, exact SDK proof invalidation and a routed desktop
  descriptor. CDP also confirms both phones online in the real Remote
  Control settings. These are actual paired SDK actors, not physical-phone
  UI coverage. A fresh local run passes 85 endpoint, protocol and immutable
  wire-budget tests.

- 2026-10-11: The user authorized isolated Alpha Relay acceptance. All three
  expanded live cases pass, including forms and frontend isolation, upload,
  conditional file writes, project/Git edits, session lifetime, routed desktop
  session streams, source-desktop takeover and mid-turn LAN-to-relay switching.
  The source/controller desktops use a relay-only pairing profile. Fresh
  scripted profiles exposed startup pin alignment downloading real managed
  harnesses; the scripted gate now skips alignment and installation, with three
  regression tests and a live no-download assertion. Local release checks pass:
  dependency lock, lint, workspace typechecks, desktop/runtime/CLI/relay/SDK/
  mobile tests and mobile icons (17,029 tests passed, 35 existing skips).
  Desktop `0.73.0-alpha.1`, matching CLI, Alpha Relay and both mobile OTAs are
  prepared. Android/iOS fingerprints match shipped build 35. Publication must
  retain desktop-first ordering; artifact verification and final plan/proposal
  deletion remain pending publication.
