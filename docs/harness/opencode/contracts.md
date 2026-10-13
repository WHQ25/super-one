# OpenCode behavioral contracts

Upstream behavior SuperOne depends on that the published types do not state.

## Native V2 node ownership and persistence

- **Behavior:** native 2.x is a different protocol from the legacy SDK's `/v2`
  entrypoint. The exact 2.0.27 Promise package also calls `Promise.withResolvers`.
- **Observed:** published client types/implementation and isolated native 2.0.24
  process/RPC tests on 2026-10-13, with Node 24.13.0.
- **Depends on it:** the shared client fails with a Node 22-or-newer instruction
  when that Promise method is absent. Node dispatch chooses V1/V2 from authenticated
  `/api/info`; private children get generated passwords and only their owner stops
  them. Attached endpoints need no local binary and have no-op shutdown.
- **Persistence:** the native resume ID is saved before submission; agent selection
  uses existing SQLite `settings_json`. Cwd is canonical and resume rejects another
  location. Production resolves the current enabled catalog on each turn/probe;
  it never silently falls back to simulation.
  Desktop/phone selections reach native agents; queued turns capture their own
  agent choice independently of later session settings.
- **Permissions:** node durable waiters preserve native scopes. They expose once/
  reject, not native saved patterns; old generic presets/tool-name remembers must
  not bypass a native request. Unanswered waiters are cleared when the turn ends.
- **Completion:** an owned native terminal success wins over a lost HTTP receipt;
  unknown delivery remains accepted and errors without automatically resending.
  Terminal facts release the turn even while HTTP is pending; scoped transport
  cancellation cannot replay input or interrupt a subsequent execution. Native
  acceptance also releases Steer's original-input admission wait. Ambient inbox
  executions require the runner's interrupt port because no kernel abort owns them.
  Stop's bounded native interrupt is independent of the cancelled turn signal.
  Persistent V2 nodes retain the turn after bounded observation failure and
  expose the same manual Retry/Stop and native inbox controls as desktop.
- **Guard:** `packages/opencode/src/{launch,run-turn-v2}.test.ts`,
  `node-v2-live.test.ts`, runtime interaction/read-model tests, and production
  `apps/cli/src/session/opencode-v2.integration.test.ts` covering real RPC,
  deduplication, control rights, durable history and node/native-process restart.

## Promise client subscriptions must be warmed before sending

- **Behavior:** `OpenCode.make` and `event.subscribe` are network-free until the
  iterable is consumed. Native/RPC subscribers share one source per client;
  leaving an iterator cancels only that subscriber, and the last departure closes
  the connection. The published 2.0.27 implementation buffers up to 4,096 events
  per subscriber. There is no business-event replay or automatic reconnection.
- **Observed:** published `@opencode/client` 2.0.27; `server.connected` checked
  against an isolated 2.0.24 server on 2026-10-13.
- **Depends on it:** `opencode-v2-client.ts#eventStream` starts iteration and waits
  up to five seconds for `server.connected` before exposing the stream. Events
  arriving while the runtime loads pending interactions remain queued. Startup
  cancellation and timeout close the SDK subscriber. Bounded observation recovery
  is host-owned; reconnecting never resubmits a native business operation. The
  former disconnect-to-`runtime.error` contract was retired by the recovery batch.
- **Guard:** `opencode-v2-client.test.ts`, `opencode-v2-runtime-sdk.test.ts`, opt-in
  `opencode-v2-live.test.ts`.

## Promise client outputs are projected per endpoint

- **Behavior:** session, permission and form methods project the response's data
  directly. Catalog methods return `{ location, data }`; `message.list` returns
  `{ data, cursor }`. The HTTP form schema permits encoded non-finite numeric
  bounds that the live-event type expresses as numbers.
- **Observed:** published 2.0.27 declarations and implementation; session/catalog
  and shell-message outputs checked against an isolated 2.0.24 server.
- **Depends on it:** `opencode-v2-client.ts#OpenCodeV2Client` unwraps only envelopes
  retained by the SDK. `opencode-v2-types.ts` derives types from the Promise client
  and permits HTTP form snapshots in the local form-event envelope.
- **Guard:** Node typecheck; `opencode-v2-runtime-sdk.test.ts` and the opt-in live
  client smoke.

## Owned native services need separate databases and host configurations

- **Behavior:** the published `Service.ensure` may stop a registered service on a
  version mismatch or during unresponsive-service recovery. An endpoint does not
  identify ownership by the caller. SuperOne's host MCP credentials are derived
  per session and registered under the fixed, directory-scoped `superone` name.
- **Observed:** published 2.0.27 service implementation; current SuperOne host MCP
  configuration; isolated 2.0.24 concurrent-session tests on 2026-10-13.
  Starting a second process against the same database resumes a sibling's
  suspended execution, including a synthetic restart instruction. Separate
  endpoints and config files do not prevent that behavior.
- **Depends on it:** `owned-service.ts` uses `Service.discover/ensure/stop` only
  inside owned registration folders. A stable private `OPENCODE_DB` per SuperOne
  session prevents sibling executor recovery. Cold migration reads a consistent
  WAL snapshot, keeps the requested native conversation/children/credentials,
  deletes unrelated session records, and clears old executor claims in the copy.
  Schema guards reject incompatible storage. The original database is read-only.
  Configuration copies omit native `service*.json`, so private passwords cannot
  change a user's default service. Native config asset directories are linked.
  An explicitly attached endpoint still has no-op shutdown.
- **Recovery:** a database owner proof uses pid and nonce, independently of launch
  credential/version changes. Dead-owner replacement can stop only the recorded
  service below that owner's directory. A replaced process interrupts the host
  turn and never resubmits its input; pending inbox input remains controllable.
- **Guard:** `owned-service-live.test.ts`, `native-database.test.ts`,
  `managed-scope-live.test.ts` and the production RPC crash/credential cases.

## Native host MCP catalog settlement

- **Observed:** 2.0.24 registers MCP tool changes through a 100ms debounced native
  tool registry. Connected transport alone can precede provider-visible tools.
- **Depends on it:** owned servers include the authenticated `superone` config
  with `codemode: false` before location initialization. Initial registration
  does not reset it; a bounded connected-catalog settlement precedes input.
- **Guard:** two same-directory native model/MCP calls prove distinct direct tool
  schemas, credential headers and `ai.opencode/sessionID` correlation. Metadata
  alone grants no host authorization.

## Permission scope is independent of tool arguments

- **Behavior:** V2 `Permission.Request` carries `action`, `resources`, optional
  `save`, `metadata`, `source` and `message`. External-directory resources are
  canonical directory boundaries (normally `/*`); approving them does not bypass
  the subsequent read/edit check. Metadata may be empty. Tool input comes from
  `session.tool.called` under `source.id`, not from permission metadata. A pending
  request replay can have a source but no cached input; do not invent arguments.
- **Observed:** V2 permissions documentation and published OpenAPI, 2026-10-07.
- **Depends on it:** `opencode-v2-event-map.ts#OpenCodeV2TurnTranslator`, shared
  `PermissionRequest.permissionDetails` and `permission-details.ts`, desktop
  `PermissionDetails.tsx` and mobile `PermissionContent.tsx`.
- **Guard:** `opencode-v2-event-map.test.ts`, `PermissionPrompt.integration.test.tsx`,
  shared `permission-details.test.ts` / `node-session-event-map.test.ts`, mobile
  `PromptSheet.test.tsx`. Scope remains distinct from proposed saved patterns,
  and the existing once/always/reject reply behavior is unchanged.
- **GUI presentation:** match the 2.0.24 CLI's action-based title/icon and primary
  path, command or diff. Source identity and raw metadata live in collapsed
  technical details. Only a nonempty `save` plus `allowAlwaysAllow` offers
  project persistence; selecting it previews the exact proposed patterns before
  sending `always`. Cancelling that preview sends no permission reply. Preview
  state is bound to the request id, so it cannot approve the next request.
  Desktop and phone share `permission-presentation.ts`; the desktop keeps
  its existing high-risk keyboard guard. `permission-presentation.test.ts`,
  `PermissionPrompt.test.tsx`, `PermissionPrompt.integration.test.tsx`,
  `opencode-backend-v2.test.ts` and mobile `PromptSheet.test.tsx` guard this flow.
  Storybook: `Tool UI/General/Permission Prompt` (`OpenCode*` stories) and
  `Mobile/Permission Details`.

## Native agent and permission ownership

- **Behavior:** agent selection and permission rules are separate. Leaving an
  agent unspecified preserves the native session/default selection; selecting
  `plan` is an agent switch, not a wildcard permission override.
- **Observed:** OpenCode V2 agents/permissions documentation and 2.0.22 API.
- **Depends on it:** `apps/desktop/src/main/opencode/opencode-v2-runtime.ts`.
- **Guard:** `opencode-v2-runtime.test.ts`, `opencode-runtime.test.ts`, and
  `apps/desktop/src/renderer/src/components/chat/OpenCodeAgentSelector.test.tsx`.
- **Compatibility:** older SuperOne sessions used a leading wildcard rule and
  only exact host allows plus optional edit/question exceptions. The adapter
  recognizes that legacy shape and replaces it with host admission only. Other
  native session rules are preserved; global/project/agent configuration is
  never rewritten.

## 2.x serve always requires basic auth

- **Behavior:** `opencode serve` 2.x rejects `/api/*` without basic auth (user
  `opencode`) and prints a random password when `OPENCODE_SERVER_PASSWORD` is unset.
  1.x enables the same auth from the same variable. The ready line changed from
  `opencode server listening on <url>` to `server listening on <url>`, so a spawned
  server's version is read from its ready line.
- **Observed:** 2.0.22, live server.
- **Depends on it:** `apps/desktop/src/main/opencode/opencode-client.ts#startOpenCodeServer`
- **Guard:** `apps/desktop/src/main/opencode/opencode-server-protocol.test.ts`

## 2.x protocol detection through `/api/info`

- **Behavior:** 2.x answers `GET /api/info` with JSON `{ version }`; 1.x has no such route.
  A wrong or missing password gets `401` (2.x: JSON `UnauthorizedError`). Desktop
  uses this for attached endpoints; the node also probes private spawned servers.
- **Observed:** 2.0.22, live server.
- **Depends on it:** `apps/desktop/src/main/opencode/opencode-client.ts#detectOpenCodeProtocol`
- **Guard:** `apps/desktop/src/main/opencode/opencode-server-protocol.test.ts`

## 2.x catalogs load per location on first use

- **Behavior:** the first `GET /api/agent|command|model?location[directory]=…` for a
  directory answers an empty list; a later request returns the catalog. Models are
  also empty until providers settle after start.
- **Observed:** 2.0.22, live server.
- **Depends on it:** `packages/opencode/src/opencode-v2-client.ts#settledList`
- **Guard:** `apps/desktop/src/main/opencode/opencode-v2-client.test.ts`
- **Discovery:** desktop IPC and mobile catalog requests share the same lazy
  probe. Cache identity includes the directory; failures cannot substitute a
  different project's agents or commands. A partial models/agents result is not
  a fresh-cache hit, so initial settlement cannot freeze an empty picker for the
  24-hour TTL. Covered by `opencode-resources.test.ts`. Authenticated cold catalog
  discovery was also checked live against 2.0.24 on 2026-10-07 (no prompt/session
  creation).

## 2.x execution events also fire outside prompts

- **Behavior:** `session.execution.*` events carry no execution id and also wrap
  non-prompt work such as clearing a revert, so a `succeeded` can arrive right before
  the next prompt's own execution. Prompts, commands and manual compaction are inbox
  items: `session.inbox.enqueued` → `execution.started` → `session.inbox.delivered`
  (same `inboxID`) → … → terminal execution event; only that execution settles the
  turn. Interrupted turns emit `session.step.failed` (`aborted`) and
  `session.execution.interrupted`, and their `*.ended` events (and an interrupted
  shell's `session.shell.ended`) can arrive after the next prompt was sent. `!command`
  shells emit only `session.shell.started/ended`.
- **Observed:** 2.0.22, live event streams.
- **Depends on it:** `packages/opencode/src/opencode-v2-event-map.ts#OpenCodeV2TurnTranslator`
- **Guard:** `apps/desktop/src/main/opencode/opencode-v2-event-map.test.ts`

## 2.x MCP code mode hides tool calls

- **Behavior:** by default 2.x exposes MCP tools to the model through one `execute` tool
  whose input is a script; the permission ask for the MCP tool carries no arguments.
  With `codemode: false` the tool is called directly as `<server>_<tool>` and
  `session.tool.called` carries its input under the permission's `source.id`.
- **Observed:** 2.0.22, live MCP stdio server.
- **Depends on it:** `packages/opencode/src/opencode-v2-client.ts#toOpenCodeV2McpConfig`
- **Guard:** `apps/desktop/src/main/session/backends/opencode-backend-v2.test.ts`

## 2.x snapshots need a canonical directory

- **Behavior:** a session whose location is a symlinked path (for example `/var/…` on
  macOS) records no file snapshots: `diff` is empty and revert restores nothing. The
  resolved path works, so SuperOne resolves every 2.x location it sends.
- **Observed:** 2.0.22, live runs in a temporary git repository.
- **Depends on it:** `packages/opencode/src/opencode-v2-client.ts#canonicalDirectory`
- **Guard:** `apps/desktop/src/main/opencode/opencode-v2-client.test.ts`

## Tool calls need chat identity and input aliases

- **Behavior:** direct host calls are named `superone_<tool>`; chat expects
  `mcp__superone__<tool>` so hidden metadata and designed host rows can route.
  Native `read` uses `path` in V2 (older inputs use `filePath`); `skill` uses
  `id` (older inputs use `name`). The chat contract is `Read.file_path` and
  `Skill.skill`. Camel-case edit fields also need chat aliases.
- **Observed:** V2 tool schemas, skills/MCP documentation and the reported
  October 2026 transcript; older 1.x field shapes are retained for compatibility.
- **Depends on it:** `opencode-event-map.ts#openCodeToolName/openCodeToolInput`
  normalizes both live adapters. Shared `tool-ui.ts`, tool presenters and remote
  input sanitization accept historical wire-shaped turns without rewriting storage.
  Only exact known host names are recognized; arbitrary single-underscore MCP
  ids cannot be split safely. This is display recognition, not permission admission.
- **Guard:** `opencode-v2-event-map.test.ts`, shared `tool-ui.test.ts` and
  `remote-tool-input.test.ts`, desktop `ToolBlock.opencode.test.tsx` (also renders
  the portable phone row). Storybook: `Tool UI/General/OpenCode Integration`.

## Patch and Code Mode are not ordinary string-edit/shell calls

- **Behavior:** V1 exposes `apply_patch`, V2 exposes `patch`; both carry a
  marker-based `patchText` with multiple add/update/move/delete targets. V2's
  `execute` runs JavaScript Code Mode, orchestrating catalog tools rather than
  running a shell command. Standard V1 tools do not include this Code Mode tool.
- **Observed:** [V1 tools](https://opencode.ai/docs/tools/#apply_patch) and
  [V2 tools](https://opencode.ai/v2/docs/tools), October 2026.
- **Depends on it:** live OpenCode names become `Patch` / `CodeExecution` in
  `opencode-event-map.ts`. Shared `NativeCodeToolRow.tsx` accepts older wire names
  and feeds the same independent Edit/Write/Delete rows as Claude Bash's changed-file
  area (each diff starts collapsed and honors file-diff settings). The patch header
  shows file/line totals, and output has its own disclosure. Code and output stay
  behind expand. `execute`
  is never mapped through Grok's shell alias for OpenCode.
- **Remote:** collapsed patch inputs contain validated paths/kinds/counts only;
  per-file diff bodies arrive through `toolDetail` on expansion. JavaScript source
  stays stripped from completed tool inputs in the phone transport. Live input
  fragments feed transient previews on the paired controller and are discarded
  when authoritative input/completion arrives. A language marker preserves historical
  `execute` identity without disclosing its script. Nested calls remain subject
  to their upstream permissions; rendering does not execute anything.
- **Guard:** `patch-tool.test.ts`, `remote-tool-input.test.ts`,
  `opencode-v2-event-map.test.ts`, `progressive-tools.test.ts`,
  `turn-process-stats.test.ts`, and `ToolBlock.opencode.test.tsx`.
- **Statistics:** collapsed patch headers and compact-mode Detail use the same
  file/line summary contract. Targets are deduplicated by path; each patch is one
  tool call regardless of its number of UI-only file rows. Failed/denied mutations
  are excluded from Detail. `ChatMessage.test.tsx` verifies the actual disclosure
  and header together; Storybook `PatchDetailStatistics` exercises both production
  surfaces rather than supplying mock totals.

## V2 steering admission and execution ownership

- **Behavior:** `session.prompt` returns a native inbox ID. `delivery: steer`
  admits a prompt at the native safe point without calling interrupt. Enqueue
  events can arrive before the HTTP acknowledgement, and the original execution
  can settle while the new input is still being admitted/delivered.
- **Depends on it:** the backend holds completion across admission and pending
  delivery. It buffers checkpoints until `queued_message_consumed` appends the
  queued user bubble, retains the same assistant turn and blocks overlapping
  steering admissions. Shells/local/native commands remain separate queued turns.
- **Failure:** pre-submission failures and declared native 4xx rejection tags
  restore the original queue position. A timeout/disconnect after submission is
  uncertain: keep the accepted user bubble and never automatically resend it.
  Interrupt/close clears deferred state and never revives a cancelled queue.
- **Observed:** published 2.0.27 client schemas; native enqueue confirmation
  against isolated 2.0.24 with `resume: false`. Execution races use deterministic
  native-event regression fixtures; actual model steering is not live-verified.
- **Guard:** `opencode-steer.test.ts`, `opencode-v2-runtime-sdk.test.ts`, and LAN/
  relay `phone-contract/session-operations.contract.test.ts`.

## Native skills belong to the session location

- **Behavior:** `skill.list` returns stable IDs, names, descriptions, paths and
  content. The slash catalog exposes only ID/name/description; `/skill arguments`
  becomes a prompt with native `skills: [{ id }]`, preserving attachments and
  settings. Native commands and reserved local names win collisions. Unknown
  slash names remain prompt text.
- **Depends on it:** native catalogs and runtime capability overrides share the
  cached/replayed `session_agents` envelope. Desktop side chats and mobile use
  the current session catalog; V1 remains on its existing command dispatch.
  The versioned resource-cache key re-probes catalogs created before skill support.
- **Observed:** SDK 2.0.27; isolated 2.0.24 expanded a skill-only prompt into the
  native inbox payload without running a model. `resume: false` retains it in
  the inbox rather than adding a delivered user message to history.
- **Guard:** client/command/resource-cache tests, shared `session-agents.test.ts`,
  mobile composer suggestion tests and opt-in `opencode-v2-live.test.ts`.

## Native MCP OAuth attempts own credentials and cancellation

- **Behavior:** `mcp.list` identifies an MCP server's `integrationID`; its OAuth
  methods come from `integration.get`. An attempt has its own ID, URL, expiry and
  automatic-callback or code mode. Completion alone does not reconnect the MCP
  server. Credentials and callback validation remain owned by OpenCode.
- **Depends on it:** `opencode-oauth.ts` deduplicates attempts per server, opens
  only HTTP(S) URLs without URL credentials, reuses shared question forms, polls
  status and reconnects the exact server. Dismissal, expiry, failure and runtime
  close cancel the exact native attempt; cleanup has a bounded request timeout.
  Host waiting forms are replayed on attach and resolved on completion. Answers
  are consumed by OAuth, never sent as model prompts or persisted user bubbles.
  Each desktop/node authentication call captures its original mutation proof.
  Pass it through the backend/runtime to lazy native mutations and check it
  again after async discovery/browser waits; polling never substitutes a new lease.
- **Scope:** browser launch is on the local desktop. A paired controller can
  answer or cancel through the existing leased question RPC. Attached-server
  OAuth retains the existing local-only boundary. Unsupported external form
  fields fail explicitly rather than fabricating successful authentication.
- **Observed:** published client 2.0.27; real OpenCode 2.0.24 against an isolated
  OAuth MCP provider on 2026-10-13, including discovery, dynamic registration,
  callback, token exchange and MCP reconnection. No third-party account tested.
- **Guard:** `opencode-oauth.test.ts`, `opencode-v2-runtime-sdk.test.ts`, opt-in
  `opencode-oauth-live.test.ts`, shared desktop MCP/question controls and OAuth
  question stories. Physical phone/browser account acceptance remains unverified.

## Live catalogs have location and control ownership

- **Behavior:** `location.reload` rebuilds all loaded locations and cancels
  outstanding native permissions/forms. It returns before project agents have
  necessarily initialized; even a nonempty built-in list can be partial.
  `agent.updated`, `skill.updated` and `command.updated` carry their location.
- **Depends on it:** explicit refresh runs only on a managed private, idle server
  without pending permissions, forms or authentication. The host rechecks its
  control lease immediately before reload and later native mutations. Sends wait
  for the reload; the native session ID and event subscription stay in place.
  Host MCP registration is restored after reload. Agent initialization is awaited
  with a bounded timeout before replacing the catalog or falling back from a
  removed agent to Build/the first visible primary agent. First restore preserves
  the native selected agent. Read-only catalog notifications are scoped to the
  canonical directory, debounced, and rerun if another notification arrives while
  a read is pending; they do not reload or interrupt execution.
- **Transport:** optional mutating `session.refreshResources` uses the existing
  control-proof validation and request deduplication over LAN/relay. Updated
  catalogs reuse cached/replayed `session_agents` for desktop and phone. Drafts,
  V1 and older hosts retain cold discovery. Remote V2 nodes use native cold
  discovery and advertise the same idle native reload operation.
  Attached servers cannot safely perform the global reload.
- **Observed:** published client 2.0.27 and real private 2.0.24 on 2026-10-13.
  Isolated native-session reload loaded new project agents, commands and skills;
  repeated reload exposed and verified the asynchronous initialization boundary.
- **Guard:** `opencode-v2-runtime-sdk.test.ts`, `opencode-steer.test.ts`, LAN/relay
  `session-operations.contract.test.ts`, desktop `OpenCodeAgentSelector.test.tsx`,
  mobile `runtime-resources.test.ts`, and opt-in `opencode-v2-live.test.ts`.
  Storybook uses the production agent refresh and question components.


## Durable cursors need a projection fallback on native 2.0.24

- **Behavior:** subscribe before reading the exclusive aggregate log cursor;
  `log.synced` marks the captured head. Text/reasoning/tool-input fragments are
  ephemeral, and native tool IDs are unique within an assistant step.
- **Observed:** isolated native 2.0.24 on 2026-10-13 advanced the durable head but
  returned only `log.synced` for missed enqueue/cancel and shell-completion facts.
  Raw HTTP reproduced the gap; it is not a Promise-client decoder problem.
  Message pagination cursors carry order: sending both cursor and order fails
  with `Cursor cannot be combined with order`. Descending `cursor.next` walks
  older messages, including an eventual empty page.
- **Depends on it:** `opencode-recovery.ts` makes five bounded observation attempts,
  detects missing sequences, and uses only the current host turn's native message
  projection when a log is incomplete. The pre-dispatch boundary bounds history;
  a missing boundary fails explicitly. Snapshot reconciliation restores complete
  text/tool results, deduplicates usage and compaction, and clears resolved native
  interactions without inventing approval. Failure preserves the native execution
  and host turn for explicit Retry or Stop. Neither reconnect path resends input.
- **Overlap:** scoped tool IDs and stable text/reasoning IDs reconcile values rather
  than append duplicates. Buffered ephemeral fragments from a restored assistant
  are suppressed until authoritative full values arrive; new assistant steps still
  stream. Recovery cannot guarantee exactly-once effects or resurrect lost
  ephemeral plugin/Code Mode RPC traces.
- **Guard:** `opencode-recovery.test.ts`, `opencode-v2-projection.test.ts`,
  `opencode-v2-client.test.ts`, and opt-in `opencode-recovery-live.test.ts`.

## Native inbox controls preserve acceptance and frontend authority

- **Behavior:** only native pending user items are exposed; internal compaction and
  move items remain upstream. Update changes delivery, not text. Lists are read-only;
  cancel/update require a leased session operation and validate pending state again.
- **Depends on it:** desktop and paired phone share `SessionProviderState`. Idle
  Steer adopts the existing input into a host turn instead of submitting a prompt.
  User IDs from native metadata keep checkpoints on their original bubbles. For
  externally accepted inputs without host metadata, the host restores the text and
  native checkpoint; it does not reconstruct attachment bytes from an inbox count.
- **Authority:** backend work runs outside the frontend async control scope. Capture
  the exact lease/generation before crossing that boundary and check it at the SDK
  mutation after recovery and lazy loading. The SDK does not receive host control
  credentials. Already-admitted host follow-ups retain normal host queue semantics.
- **Receipts:** inbox mutations return `{ ok: true }` so the existing idempotency
  service can retain a distinguishable success receipt (`null` means no receipt).
  Read/reconnect never cold-create a session or submit model input. Reconnect
  restores observation; an existing owned service can be replaced, interrupting
  its old execution without resubmission.
- **Guard:** native inbox/client/backend tests, `session-lease.test.ts`, LAN/relay
  `phone-contract/session-operations.contract.test.ts`, mobile runtime/native-action
  tests, shared-component stories and `session-provider-state.spec.ts`.

## Cold catalog reads and external endpoints

- **Behavior:** desktop/node catalog probes use disposable credentials-only V2
  databases; source databases remain read-only and cannot start suspended siblings.
  V1 retains its ordinary probe. Attached endpoint catalogs perform reads only.
- **Ownership:** an attached endpoint/location must be dedicated to one SuperOne
  session. The same process refuses competing claims until all references close.
  External hosts must arrange equivalent isolation across their processes;
  SuperOne never stops a user-owned endpoint.
- **Guard:** `owned-service-live.test.ts` imports a real V2 conversation, leaves a
  suspended sibling unchanged, and continues only the imported conversation;
  `attached-service.test.ts` verifies reference release and conflicting claims.
