# Renderer session client

Status: in-progress · Updated: 2026-10-12
Goal: The desktop renderer drives local and remote-node sessions through one environment-addressed session client, so `window.agent` session IPC, `send-message-remote.ts`, the renderer Codex runner and the renderer's node-vs-local branches go away.
Long-term docs affected: `apps/desktop/docs/agent-reference/architecture.md` (IPC API, Environment API migration table), `apps/desktop/CLAUDE.md` (boundary line on `window.environment`), `docs/architecture/remote-node-service.md` (stale local-port claims), `docs/architecture/chat-core.md` (send/open flow)

## Why

The backend already treats the local desktop as one environment: `DesktopDomain`
serves `LocalSessionHost` through the shared dispatcher, phones drive local
sessions with `session.*` RPC, and the local gateway is bound to
`InProcessRpcClient` (`main/node-host/node-host-controller.ts:182`). The
renderer never moved. It has two implementations of most session operations:

- 47 `window.agent` methods and ~25 session-related `window.app` methods for
  local; `window.environment` for node sessions.
- `send-message.ts` (751 lines) and `send-message-remote.ts` (673 lines)
  duplicate host-slash intercepts, prompt suffixes, content blocks and draft
  consumption.
- ~120 branches on `parseRemoteProjectKey`/`remote:` keys across
  `session-lifecycle.ts`, `interaction.ts`, `claude-slice.ts`, sidebar menus
  and selectors.
- Rewind, dequeue, steer and start-queued have no node path; the UI hides them
  by key, not by capability.

The renderer ends with one client. Main keeps one difference that is real:
local events already reach the renderer through the desktop hub, node events
through a follower (see Design).

## Two meanings of "remote"

| Meaning | Detected by | In scope |
|---|---|---|
| Node environment | project key `remote:<connectionId>:<path>`, `parseRemoteProjectKey` | Yes: replaced by `connectionId` routing |
| Phone/lease control of a session | `isRemoteSession()` (`chat-store/index.ts:307`), `_controlLease`, `useIsRemoteLocked` | No: stays as lease presentation |

## Starting point (verified 2026-10-12)

| Piece | State |
|---|---|
| `EnvironmentHost` session methods (`main/environment/environment-host.ts`) | Each either branches `connectionId === 'local'` to legacy DB/IPC code or calls `resolveRemote()`, which throws `not_found` for `'local'` (`:402-416`). `createSession` (`:704`) and `forkSession` (`:2116`) throw "remote-only". Only drafts and `listProjects` use `registry.getLocal()`. `listSessions`/`listPinnedSessions` read local DB rows directly (`:526`, `:558`) and stay. |
| Node follow | `openRemoteSession` (`:1776-1783`) and `sendSessionMessage` (`:1903`) call `followRemoteSession`, which maps the domain log (`node-session-event-map.ts`) and republishes into the hub as `remote-node` (`main/index.ts:1868`). The drain policy treats a connection without a client/supervisor as removed (`:1674-1678`, `session-drain-policy.ts:28-30`). |
| Local delivery | `SessionManager` events → `SessionEventHub` → `publishHubEvent` → `RendererInterest` (`session:*` always followed, `stream/renderer-interest.ts:24-31`) → `window.agent.onAgentEvent`. Raw events carry process seq/epoch (`session/event-seq.ts`); mapped copies carry `sessionVersion` and no epoch, so the reducer cannot dedupe the two (a delta delivered both ways renders twice). |
| Local RPC host (`node-host/local-session-host.ts`, `desktop-session-mutations.ts`, `desktop-session-reads.ts`) | Serves create, send, patchSettings, interrupt, respond{Permission,Question,Plan}, rename/setTags/setUiFlags/close/remove, setCwd, fork, modUi, get/load/messages/snapshot/subscribeDetail, acquire/renew/releaseControl; phone extensions recap, setGoal, dequeue, steer, answerAsyncQuestion, composer.*, voice*. Every path calls `requireRow` (`:50-58`, `:125-133`, `:155`; reads `desktop-session-reads.ts:128-131, 186-204`). |
| Side chats | `ephemeral: true` live `Session`s with no DB row (`session/side-chat.ts:116-120, 163-169`); today's send finds them by id in `SessionManager`. |
| Cold reads | `get`/`load` do not resume a cold session; model/effort/apiProviderId come from a live `Session` (`desktop-session-reads.ts:165-167`); the local row read (`db-remote-controlled-sessions.ts:84-88`) lacks `selected_model`, `selected_effort`, `codex_service_tier`, `acp_agent_id`, `parent_session_id`. The renderer's `persistence.ts:97-124` restores all of these. |
| Environment request DTOs | Settings (`runtime/server/session-settings.ts:4-22`) lack `contextWindow`, `ultracode`. Send (`environment-host.ts:1833-1879, 1946-1975`) drops `priority`, `steer`, `sandboxMode`, `permissionPreset`, `serviceTier`, `threadId`, `inputRequest`, `agent`, `modelParams`. Create (`create-remote-session.ts:3-30`) drops `sessionId`, `draftId`, `draftLeaseId`, `acpAgentId`, `worktree*`, which `desktop-session-create.ts` supports. |
| Missing RPC | rewind files/conversation/code+chat, previewRewind, truncateAtCheckpoint, stopTask, startQueuedMessages, resetSession, contextUsage, MCP status/authenticate, sideChat start/close, scheduled sends, deleteOlderThan, Codex goal get/clear. Voice methods exist but refuse `ipc:` actors (`phone-voice-methods.ts:18-20`). |
| `ENVIRONMENT_*` IPC handlers (`main/index.ts:2062-2457`) | Plain `ipcMain.handle`; an in-process call would run as `ipc:0` (`in-process-rpc-client.ts:24`). |
| Leases | Window IPC auto-acquires (`acquire: true`); RPC requires a proof (`runRpcControl`, `acquire: false`), and `DesktopDomain.dispatchRpc` always enters `runRpcControl` (`desktop-domain.ts:240`). `EnvironmentHost.sessionLeases` is keyed `connectionId:sessionId` and acquires with `yields` but no delegate (`:926-930`); node requests share one controller principal. |
| Metadata ops | The node gateway sends `rename`/`setUiFlags` without a lease (`remote-environment-gateway.ts:1385-1420`); `LocalSessionHost` requires a proof and resumes a cold session for them. Legacy pin/hide never assert. |
| Active pointer | Legacy `resumeSession` also calls `mgr.setActiveSession` (`agent-service.ts:2447-2475`); dequeue, some settings and rewind address the project's active session (`:1116-1120`, `:1316-1318`). |
| Drafts | `ensureSessionImpl` makes a renderer-only UUID (`session-lifecycle.ts:221-238`); the host session exists only after the first send. Settings changes on a draft are UI state. |
| Local Codex sends | `codex/runner.ts` calls `window.app.codexRun`/`Review`/`Compact`/`Steer`; main runs them through `runCodexTurnViaSessionManager` (`main/index.ts:2642`). The runner also writes the assistant message, status, threadId and usage into the store. `send-message.ts:408-476` switches harness in place for an empty draft and creates a new session id for a non-empty non-Codex session. |
| Send preparation | Mini-app and desktop-app grants are applied to the final session id before dispatch; their reminders are appended only if the grant succeeds (`send-message.ts:663-695`). |
| Renderer identity | Store keyed `projectSessions[projectKey]._sessions[sessionId]`; connection id is re-derived from the key (`connectionIdForProjectKey`). |
| Runtime scope | Fixed alongside this plan: `Session` wraps its backend with `hostOwned` (`session/control-context.ts`), so a runtime started inside a frontend request no longer lends that request's grant to later agent work (it broke `session_collab_start` after a phone-sent turn). Test: `session/session-runtime-control-scope.test.ts`. |

Depends on `docs/plans/unified-remote-protocol.md` step 6 (local leases on
`ControlLeaseService`, `LocalSessionHost` fenced ops), which is on `main`.

## Design

```
component / store action
  └─ sessionClient(projectKey)            // renderer: lib/session-client.ts
       └─ window.environment.<op>(connectionId, …)
            └─ EnvironmentHost             // main
                 ├─ 'local' → LocalEnvironmentGateway → InProcessRpcClient → DesktopDomain
                 └─ node    → RemoteEnvironmentGateway → NodeRpcClient (+ RemoteSessionFeed)
```

- **One renderer seam.** `lib/session-client.ts` exposes session operations
  keyed by `{ projectKey, sessionId }`, derives `connectionId` from the key and
  calls `window.environment`. Store and components do not branch on node vs
  local for session operations. The store stays keyed by `projectKey`.
- **One main route for commands.** `EnvironmentHost` resolves `'local'` to the
  local gateway for every session method. The DB fast paths for listing stay.
- **Delivery stays per environment.** Local open/load uses the existing
  renderer topic delivery and never installs a mapped node follower; the local
  snapshot/event merge barrier stays in the process seq/epoch space. Node
  open/load keeps `RemoteSessionFeed`. The drain policy applies to node
  connections only.
- **Local resolver covers ephemeral sessions.** Get/load/control/send/respond/
  interrupt/close resolve a live ephemeral side chat without creating a DB row;
  lists and restart restoration still exclude it.
- **Window identity is real.** Session-touching `ENVIRONMENT_*` handlers run
  under the sender's window control scope, so in-process calls bind
  `window:<id>`. No scope on a mutation is an error, not `ipc:0`.
- **Leases: explicit grant, RPC stays `acquire: false`.** For local sessions
  `EnvironmentHost` acquires `session.acquireControl` through the local gateway
  per window (`window:<id>` delegate, `yields`) and passes the proof with each
  mutation, as it already does for node sessions. The local grant cache is
  keyed by window. After a takeover the operation fails; it is not retried with
  a new acquire. Node keeps its single controller principal. The `hostOwned`
  runtime boundary must stay: admission checks the caller's grant, including
  after awaits, and runtime work is host work.
- **Metadata is not control.** `rename`, `setUiFlags` and `setTags` on
  `LocalSessionHost` need no proof and do not resume a cold session, matching
  the node gateway and today's local IPC.
- **Contracts carry everything the local path consumes.** The environment
  IPC, preload and host DTOs carry the settings, per-turn selections and
  create choices listed in the starting point before any legacy caller is
  deleted.
- **Capabilities, not keys.** An operation an environment does not serve
  (`servedMethods`) is hidden through capabilities, not `startsWith('remote:')`.

## Operation inventory

| Operation | Today (local) | Moves in |
|---|---|---|
| open / restore (`resumeSession`, `loadSessionState`, Claude send readiness) | `window.app` | 2 |
| rename, pin, hide, delete, fork | `window.app` | 2 |
| interrupt, permission, question, plan, async question | `window.agent` | 3 |
| permission/sandbox mode, model/effort, API provider, context window, ultracode | `window.agent` | 3 |
| dequeue, steer queued | `window.agent` | 3 |
| recap (Grok `/recap`) | `window.agent` (also used by the node path) | 3 |
| Codex goal get/set/clear | `window.app` | 3 (get/clear RPC added) |
| send, resend, input-request send, queue while streaming | `window.agent` | 4a |
| Codex run/review/compact/steer | `window.app` + renderer runner | 4b |
| rewind family, truncate, stopTask, startQueued, reset | `window.agent` | 5 |
| contextUsage, MCP status/authenticate | `window.agent` | 5 |
| side chat start/close, scheduled sends, deleteOlderThan | `window.app` | 5 |
| composer open/await/cancel, widget input request | `window.agent` | 5 |
| park/activate/foreground, live snapshots, prewarm, `onAgentEvent` | `window.agent` | stays (window presence) |
| realtime voice signaling and timeline | `window.agent` | out of scope (own migration) |

## Steps

Each step lands on `main` on its own. The legacy path for an operation is
deleted in the step that moves it. New contract tests land with their
implementation; only baseline records land ahead.

### 0. Baseline

- Record the counts the exit criteria use (Verification section).
- Fix the stale local-port claims in `docs/architecture/remote-node-service.md:165`
  and `docs/plans/remote-node.md:85-100`.

### 1. Main: local routing and contracts

- `EnvironmentHost` resolves `'local'` to the local gateway; remove the
  "remote-only" throws in `createSession` and `forkSession`.
- Local open/load without a node follower; drain policy limited to node
  connections.
- Local resource resolver for live ephemeral side chats.
- Window control scope on session-touching `ENVIRONMENT_*` handlers; no
  `ipc:0` fallback for mutations; per-window explicit grants for local.
- `LocalSessionHost` metadata ops without proof or cold resume.
- Extend the environment IPC/preload/host DTOs: settings (`contextWindow`,
  `ultracode`), send (`priority`, `steer`, `sandboxMode`, `permissionPreset`,
  `serviceTier`, `threadId`, `inputRequest`, `agent`, `modelParams`), create
  (`sessionId`, `draftId`, `draftLeaseId`, `acpAgentId`, worktree fields).
- Exit:
  - Contract tests drive `EnvironmentHost` with `'local'` against a real
    `DesktopDomain` for get/load, create, fork, rename, setUiFlags, remove,
    interrupt, respond*, patchSettings and send, with populated fields
    (queued priority, Codex thread/Fast/permission preset, ACP context window,
    Cursor params, widget `inputRequest` correlation) checked at
    `LocalSessionHost`.
  - Opening and sending a local session delivers each delta once, including a
    delta racing snapshot hydration.
  - A side chat completes a send, a permission, an interrupt and a close
    through the environment route with no `sessions` row.
  - Two windows and window-vs-phone contention behave as today.
  - The renderer is unchanged.

### 2. Renderer: session client, open/restore, metadata

- Add `lib/session-client.ts`; fold `lib/remote-session-ops.ts` into it.
- One hydration adapter over `SessionLoadResult`: consumes `restore`,
  `activeTurn` and paging facts, keeps the persisted selection and identity
  fields `persistence.ts` restores today (provider thread, parent, Fast, ACP
  agent, model/effort) and message-derived state (usage, todos), and merges
  concurrent renderer edits and events. Extend the desktop read rows/load
  facts with the missing columns. A cold read needs no lease.
- Migrate every `resumeSession`/`loadSessionState` caller, including Claude
  send readiness (`helpers/lifecycle.ts:139-155`). Keep setting the
  project-active session in main while any operation still addresses it.
- Rename, pin, hide, delete, fork through the client; delete the
  else-branches in `RenameSessionDialog`, `use-sidebar-sessions`,
  `HeaderSessionMenu`, `ForkButton`, `useSessionMenuItems`,
  `session-menu-items`, and the matching `window.app` methods.
- Exit: restore tests (`chat-store-live-sync`, session restore) pass; with no
  live `Session` and an empty renderer cache, a Codex Fast session, an ACP
  session on a non-default model and a session whose worktree was removed
  restore today's fields and UI; CDP check on a dev build with local Claude,
  local Codex and a node-lab session.

### 3. Renderer: interactions, settings, queue, recap, goal

- Interactions (permission, question answer/dismiss, plan, async question)
  and interrupt through the client; delete the node branches in
  `interaction.ts` and `session-lifecycle.ts:380`.
- Settings go to `patchSettings` only for sessions that exist on the host.
  A draft keeps its selections in renderer/draft state and carries them into
  create/first send. This removes the "UI-only for remote" branches and most
  of `claude-slice.ts`'s node branches. `broadcastSessionSetting` becomes
  `patchSettings` where it carries session settings.
- Dequeue and steer → `session.dequeue` / `session.steer`.
- Recap → `session.recap`; Codex goal → `session.setGoal` plus new get/clear.
- Delete the matching `window.agent` / `window.app` methods.
- Exit: interaction tests pass (`AskUserQuestionPrompt`, `PermissionPrompt`,
  plan approval, Codex async question); a fresh draft's permission, model and
  ACP context-window choices reach its first turn; CDP permission prompt and
  plan approval on local Claude and Codex.

### 4. Renderer: one send pipeline

4a must be green before 4b.

- **4a, all harnesses except Codex.** Merge `send-message.ts` and
  `send-message-remote.ts`:
  1. intercept host slash commands,
  2. resolve or materialize the final session id (`session.create` in every
     environment, carrying the draft's selections, replacing local first-send
     creation and `prepareRemoteSendTarget`),
  3. apply the worktree selection, then the session-scoped mini-app and
     desktop-app grants on that id,
  4. build content and suffixes, adding grant reminders only for grants that
     succeeded,
  5. deliver through `session.send` with `clientMessageId`, priority and the
     per-turn options from one `sessionTurnOptions()`,
  6. apply the response snapshot.
  Queue while streaming uses `priority: 'next'`. One message-id scheme. Inline
  attachment ordering is kept for node sends. Resend and input-request sends
  use the same pipeline.
- **4b, Codex.** Local Codex turns use `session.send` with `turnKind`
  run/review/compact and `threadId`. Switching to Codex keeps today's rules:
  an empty draft switches harness in place; a non-empty session on another
  harness creates a new Codex session. Delete `codex/runner.ts` and
  `window.app.codexRun`/`Review`/`Compact`/`Steer`; the assistant message,
  status, thread id and usage then come only from events. Before deleting,
  compare an event trace of one Codex run, review and compact against what
  the runner writes.
- Delete `send-message-remote.ts` and `window.agent.sendMessage`.
- Exit: send tests (`chat-store-actions`, `send-failure`, scoped writes,
  draft promote) pass; CDP send, queue-while-streaming, steer, resend and an
  @-mentioned mini-app/desktop app on local Claude, Codex (run, `/review`,
  `/compact`, plan mode, switching from a Claude session), an ACP harness and
  a node-lab session; send admission time before vs after on a dev build.

### 5. Missing session RPC

Add runtime ports and `LocalSessionHost` implementations, move the renderer,
delete the IPC. One family per commit:

| Family | Methods |
|---|---|
| Rewind | `session.rewind` (files / conversation / code+chat), `session.previewRewind`, `session.truncateAtCheckpoint` |
| Turn control | `session.stopTask`, `session.startQueued`, `session.reset` |
| Introspection | `session.contextUsage`, `session.mcpStatus`, `session.mcpAuthenticate` |
| Side chat | `session.sideChatStart`, `session.sideChatClose` |
| Scheduled sends | `session.scheduledSend.get/set/clear` |
| Housekeeping | `sessionList.deleteOlderThan` |
| Composer | window use of `composer.*` and widget input requests, keeping per-window delivery and the outcome's lifetime (a human answer has no fixed deadline) |

The CLI node does not have to serve these here; it reports them unserved and
the UI hides them through capabilities.

- Exit: a contract test per family on the local endpoint; no
  `startsWith('remote:')` gate remains for these operations.

### 6. Cleanup and docs

- `window.agent` keeps window presence, `onAgentEvent` and the realtime voice
  family; every other session method is gone from preload, the
  `agent-service.ts` handlers and `AgentIpcChannels`, and so are the session
  methods on `window.app`.
- `parseRemoteProjectKey` remains in the session client, project/host
  selection and workspace helpers only.
- Update the architecture manual's IPC section and migration table, the
  `apps/desktop/CLAUDE.md` boundary line and the docs in the header. Delete
  this plan.

## Out of scope

- Re-keying the chat store by `SessionRef`.
- Harness-specific state in `PerSessionState`, per-harness selectors, the
  chat-store projection rework.
- Workspace, file, skills/MCP resource and terminal operations.
- Realtime voice signaling and timeline from the window.
- Phone protocol and mobile app changes; per-window lease separation on node
  connections; serving the step 5 families on the CLI node.

## Risks

| Risk | Mitigation |
|---|---|
| Lease behavior changes for local windows | Step 1 contention tests before any renderer change; explicit per-window grants; `yields` unchanged; `hostOwned` boundary kept. |
| Duplicate or missing events after moving open/send | Local never follows the mapped feed; step 1 single-delivery test including the hydration race. |
| Cold restore loses fields | Step 2 hydration adapter and cold-restore exit cases. |
| Drafts and side chats have no host row | Draft selections carried into create; ephemeral resolver in step 1. |
| Codex runner writes state the stream does not carry | Trace comparison in 4b before deletion. |
| In-process RPC adds send latency | Admission time measured in 4a. |
| `isRemoteSession` (phone control) confused with node routing | Separate rows above; every removed branch checked against them. |

## Verification

- Scoped Vitest per step (`bunx vitest related <changed files>` from
  `apps/desktop`) plus the step's contract tests; tests that bind local ports
  need the sandbox's local-binding permission.
- `bun run typecheck:node` and `bun run typecheck:web`.
- CDP self-verify on a dev build per `apps/desktop/docs/agent-reference/self-verify.md`;
  node sessions through `bun run dev:cli:lab`.
- Counts (step 0 and each exit):
  ```bash
  cd apps/desktop/src/renderer/src
  rg -c "window\.agent\." --glob '!*.test.*' --glob '!*.stories.*' . | awk -F: '{s+=$2} END {print "window.agent", s}'
  rg -c "parseRemoteProjectKey|startsWith\('remote:'\)" --glob '!*.test.*' --glob '!*.stories.*' . | awk -F: '{s+=$2} END {print "node branches", s}'
  ```
- Done when: `send-message-remote.ts` and `codex/runner.ts` are gone; the only
  `window.agent` methods left are the presence, event and voice ones in step 6;
  no session method remains on `window.app`; node branches remain only where
  step 6 lists them.

## Progress

- 2026-10-12: Step 5 composer. Windows now use `composer.open/await/cancel`
  through their environment, with widget requests on the session client.
  Admission checks the session lease; mini-app ownership still uses the app
  grants. Await has no deadline and needs no renewed lease. Navigation/close
  release the window's caller forms. Endpoint tests simulate a day of waiting
  and reject another window; seven scoped suites pass (58 tests), plus both
  typechecks. The legacy agent IPC was removed.

- 2026-10-12: Step 5 housekeeping. `sessionList.deleteOlderThan` obtains and
  checks proofs for the whole candidate set before deletion, preserves pinned
  and recent rows, and rechecks the current row before each removal. A phone
  owning any candidate rejects the batch before a delete. Endpoint tests and
  node/web checks pass; the unused legacy preload method and IPC are removed.

- 2026-10-12: Step 5 scheduled sends. Reads and fenced writes use the session
  host; a separate session-list operation loads sidebar schedules. New drafts
  materialize through the first-turn creation helper before arming, retaining
  their selections. The window change subscription moved to `environment`,
  unsupported hosts hide the control, and draft resume/deletion use the same
  route. Scheduler, endpoint and renderer tests and node/web checks pass.

- 2026-10-12: Step 5 side-chat family. Start/close are optional fenced RPCs.
  A fork rechecks the parent's control before creating its ephemeral child;
  the child's created-resource grant allows inherited settings. Renderer
  eligibility uses served capabilities and retains its environment project
  key. Endpoint, backend and renderer suites pass (50 tests), as do node/web
  typechecks; the legacy side-chat IPC is removed.

- 2026-10-12: Step 5 introspection family. Context usage and MCP status are
  lease-free reads on the named session; MCP authentication is fenced. No
  cold runtime is resumed just to read status. Renderer and endpoint tests
  (47) pass; the old IPC is removed, and MCP states have production stories.

- 2026-10-12: Step 5 turn-control family. Stop-task, durable-queue start and
  runtime reset use the environment route and explicit session identity.
  Reset rejects an already-active destination before disposing its source;
  the next draft keeps its defaults, and busy Codex turns keep running when
  the user opens a new draft. Node queue controls use served capabilities.
  Endpoint/store tests (407) and node/web typechecks pass.

- 2026-10-12: Step 5 rewind family. Optional runtime session-operation ports
  advertise implemented methods; local rewind/preview/truncate name a session
  rather than the project's active pointer. Renderer writes retain that scope
  across awaits; unsupported environments hide rewind by served methods.
  The old rewind IPC is removed. Endpoint and renderer scope tests pass.

- 2026-10-12: Step 4. All harnesses send through `session-turn.ts` and
  `session.send`, including Codex run/review/compact, plan answers and widget
  input answers. Draft creation, inline attachment order, grants and retries
  share one pipeline; successful grants alone append their reminders. Deleted
  the remote pipeline, Codex renderer runner and the old send/runner IPC.
  Scoped checks cover session isolation, queueing, configured selections and
  preserving drafts on plan answers. Live CDP verification is still pending
  for the completed Codex migration and admission timing.

- 2026-10-12: Step 0. Baseline counts: `window.agent` 76, node branches 184.
- 2026-10-12: Step 2. `lib/session-client.ts` renames, pins, hides, removes
  and forks in every environment, and restores a cold session from
  `session.load` with `full: true` and the stored settings block
  (`state.stored`). `window.agent.activateSession` resumes a stored local
  session and sets the project-active pointer; it replaces `resumeSession`.
  The matching `window.app` methods and IPC are gone. `remote-session-ops.ts`
  folds into the client with the step 3/4 node branches it still serves.
  Counts: `window.agent` 79, node branches 168. CDP: a cold Codex session
  restores provider, model and its whole transcript; rename and pin round-trip.
- 2026-10-12: Step 3. Permission, question, plan, interrupt and settings go
  through the session client in every environment; settings reach the host
  only for `hostSessionOwned` sessions (restored ones included), so a draft's
  choices wait for its first send (step 4a). Queue, steer, recap and Codex goal
  share one `environment:callSession` channel over the desktop's session
  methods (`session.getGoal` added as a read). A node refuses the settings it
  takes per turn (`unsupported`): pickers log it, the ACP context window
  reverts with an error. `broadcastSessionSetting` stays: it mirrors Codex and
  OpenCode picker state to other views rather than writing host settings.
  Counts: `window.agent` 57, node branches 156. CDP on local Claude: settings
  round-trip, a Bash permission answered (a second answer refused), a plan
  rejected with feedback.
- 2026-10-12: Step 1. `EnvironmentHost.resolveSession` routes `local` to the
  domain protocol; local open/send install no follower; local grants are keyed
  per window and a mutation without a window scope fails in `leaseKey`;
  `LocalSessionHost` serves live ephemeral sessions and edits metadata without
  a grant; DTOs carry the send selections, `contextWindow`/`ultracode`,
  create selections and answer details; `patchSessionSettings` added. Contract
  test: `environment/environment-host-local-session-route.test.ts`. Closing a
  side chat through `session.close` only disposes it; transcript cleanup moves
  with `sideChatClose` in step 5.
- 2026-10-12: Plan drafted from a main/renderer inventory; revised after a
  code review (local delivery, side chats, step dependencies, DTO gaps, cold
  restore, lease scope, operation inventory). Runtime control-scope fix
  implemented with a regression test.

## Open decisions

None.
