# Unified remote protocol

Status: in progress · Updated: 2026-10-10
Goal: One backend serves its own window, controller desktops and phones through one topic/connection core, one per-connection delivery policy and one protocol; every existing phone feature runs on it.
Proposal: [unified-remote-protocol.md](../proposals/unified-remote-protocol.md)
Long-term docs affected: [mobile-remote-control.md](../architecture/mobile-remote-control.md), [remote-node-service.md](../architecture/remote-node-service.md), [chat-core.md](../architecture/chat-core.md), [relay-crypto.md](../architecture/relay-crypto.md) (framing), `apps/desktop/docs/agent-reference/architecture.md`, `apps/desktop/CLAUDE.md` (session control boundary), `apps/mobile/docs/agent-reference/transport.md`

Scope is proposal phases 1–4. Poll-to-push for terminals and watched
directories, Git/workspace parity on the desktop node, configuration families
and features the phone does not have today are phase 5 and get their own plan.
This plan absorbs [mobile-desktop-compatibility.md](mobile-desktop-compatibility.md)
(deleted in step 6).

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
- Phone client speaks the protocol, reusing `RpcInbox` pending and chunk
  handling. `RemoteCommand` phone commands, `environment_command` and
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
| `load_session_messages`, `get_session_history_index` | `session.load` (`before`), **`session.historyIndex`** | yes |
| `get_session_state` | `session.get` | yes |
| `get_attachment` | **`session.attachment`** | |
| `mod_ui_request` | `session.modUi` | |
| `mcp_app_request` | `mcpApps.*` | |
| `list_sessions`, `list_pinned_sessions`, `find_session`, `search_sessions`, `list_session_activity` | `session.list`, `session.listPinned`, `session.get`, **`session.search`**, `session.list` (activity in the record) | |
| `pin_session`, `archive_session`, `delete_session`, `fork_session` | `session.setUiFlags`, **`session.setArchived`**, `session.remove`, `session.fork` | |
| `session_link_identity`, `session_link_metadata`, `session_link_resolve` | `environment.descriptor`, `session.linkMetadata`, `session.get` | |
| `list_drafts`, `save_draft`, `delete_draft` | `draft.list`, `draft.upsert`, `draft.delete` | |
| `open_draft`, `close_draft` | **`draft.open`**, **`draft.close`** (draft lease, `expectedUpdatedAt`) | |
| `composer_open`, `composer_cancel`, `composer_outcome`, `open_widget_input_request` | **`composer.open`**, **`composer.cancel`**, **`composer.outcome`**, **`composer.openInputRequest`** | |
| `save_widget_template` | **`widget.saveTemplate`** | |
| `search_mcp_mentions`, `read_mcp_mentions`, `list_mcp_servers`, `get_mcp_icons` | **`mcp.searchMentions`**, **`mcp.readMentions`**, `mcp.list`, **`mcp.icons`** | |
| `list_directory`, `browse_host_directory`, `create_directory` | `workspace.listDir`, `fs.listDir`, `workspace.mkdir` | |
| `search_files`, `search_mentions`, `get_mention_icons` | `workspace.search`, **`workspace.searchMentions`**, **`workspace.mentionIcons`** | |
| `read_desktop_file`, `read_video_poster` | `workspace.readFile`, **`workspace.videoPoster`** | |
| `upload_file`, `upload_file_complete` | **`workspace.upload`**, **`workspace.uploadComplete`** | |
| `resolve_favicon` | **`environment.favicon`** | |
| `list_projects`, `add_project`, `add_project_additional_dir`, `remove_project_additional_dir` | `project.list`, `project.open`, `project.update` | list |
| `get_default_clone_path`, `set_default_clone_path` | `settings.get`, `settings.patch` (`expectedVersion`) | |
| `clone_repository`, `search_github_repos` | `git.clone`, **`git.searchGithub`** | |
| `get_git_info`, `get_git_file_status`, `get_git_branches`, `list_git_mention_refs` | `git.status`, `git.status` (`paths`), `git.branches`, `git.mentionRefs` | |
| `switch_git_branch`, `create_git_branch` | `git.switchBranch`, `git.createBranch` | |
| `get_worktree_info`, `get_checked_out_branches` | `git.worktrees`, `git.worktreeCheckedOutBranches` | |
| `list_harness_options`, `get_system_info`, `get_project_resources` | `harness.list`, `environment.systemInfo`, `harness.resources` | yes |
| `get_usage`, `consume_rate_limit_reset`, `list_media_providers` | `environment.usage`, `codex.consumeRateLimitReset`, **`media.listProviders`** | |
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
files keep `ifMatch`; `workspace.writeFile` keeps `expectedHash`;
`settings.patch` and `project.update` gain `expectedVersion`. Session and
terminal mutations are fenced by leases (step 6).

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
- Step 5 in progress. Coverage list above. Done: a host names the shared
  methods it refuses (`unservedMethods`), so descriptors list only served
  ones; one environment id per desktop (node identity canonical, local id an
  alias in `environmentAliases`, resolved by `isEnvironment`, the registry and
  the envelope check); `DesktopDomain` open apart from the controller
  listener. Next: phone handshake version and generation, phone-scoped
  session host and desktop ports, CLI handlers into runtime, phone channel
  adapter, conditional writes, contract suite.

## Open decisions

None.
