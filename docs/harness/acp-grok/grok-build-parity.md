# Design: SuperOne × Grok Build Feature Parity

| Field | Value |
|-------|--------|
| Status | Draft |
| Date | 2026-07-25 |
| Verified | 2026-09-22 from the interrupted `grok-build-parity` scratch (Source, Catalog, Inventory). Gap phase written in-session. P0/P1 wire claims re-read in SuperOne. |
| Scope | SuperOne as ACP **host client** for Grok Build (`grok agent stdio`) |
| SuperOne path | `/Users/wuhangqi25/Developer/Projects/super-one` |
| Grok Build source | `/Users/wuhangqi25/Developer/Projects/grok-build` at `48271133` (`SOURCE_REV` `be7ce6e8cffe46d20bef9834b211616082ee866b`). `origin/main` is `4247f661` (2 commits ahead; not fast-forwarded). |
| Related design | [`grok-acp-permissions.md`](./grok-acp-permissions.md), [`grok-xai-ext-notifications.md`](./grok-xai-ext-notifications.md) |
| Scratch | Session workflow scratch `01-source.md`, `02-catalog.md` (207 capabilities), `03-inventory.md` (193 host rows) |

Integration started against this plan: create-time `autoMode`/`yoloMode` booleans, plan `set_mode` failure no longer sticks, `x.ai/mcp/auth_trigger` plus the Grok Log In button, and `reconnectMcp` drop-then-reattach. Queue steer now is `session/prompt` `_meta.sendNow`; steer soon stays `x.ai/interject`. Exit-plan still has no file path field.

This revision **replaces** the 2026-09-16 capability matrix. That matrix is stale against the inventory: PATH splitting, prompt `_meta.mode`, node ask/exit ads, fork initialize caps, Always button, Auto toast, SessionDefaults labels, and `tools_changed` are shipped. Do not implement from old RT/PM/XAI rows without checking §3 below.

---

## 0. Relationship to existing designs

### `grok-acp-permissions.md`

Owns permission correctness. Phase-1 preapprove, yolo/auto notify, and host plan via `session/set_mode` are shipped. **Keep that file.** Do not re-derive G1–G5 here.

Still open there, and still open here:

| Item | State on 2026-09-22 |
|------|---------------------|
| G1 built-in preapprove | Shipped. Unit-tested. |
| G2 third-party MCP still prompts | Code denies auto-allow. No fresh live confirmation in this pass. |
| G3 create-time Ask must not inherit `~/.grok` `permission_mode=auto` | **Still broken.** See §4.1. |
| G4 effort catalog survives the first turn | Not re-tested live. |
| G5 Auto fail-closed toast | Shipped (`acp-auto-honesty.ts`). |
| Spoof `clientType: grok-desktop` | Still a non-goal. |

The permissions doc intro still says not to tick G1–G5 until a recorded live run, while the 2026-09-16 history already ticks G1/G4/G5. That sentence is stale. This plan does not edit that file.

### `grok-xai-ext-notifications.md`

The ExtNotification bus is shipped (`acp-xai-session-notify.ts`, `packages/acp/src/xai-event-map.ts`). Its early “everything missing” matrix is stale. Leftovers are in §3 (`prompt_complete` alias, `hooks/run`, `queue/*`, `sdk_call`).

### This document

Host parity that is not owned by those two files: create-time permission meta, plan-mode failure handling, MCP login, CLI/node thinness, and doc hygiene.

---

## 1. Scope and non-goals

### In scope

- Desktop ACP client (`grok agent stdio`).
- CLI/node host (`packages/acp/src/run-turn.ts`) where it disagrees with desktop on a correctness or permission boundary.
- Gaps the 2026-09-22 inventory marked `missing` or `partial` and that are not already explained as intentional Generic-client limits.

### Explicit non-goals

See §6. Do not emulate the Grok pager. Do not spoof `grok-desktop` to unlock `enable-always-approve` or `allow-edits-session`.

---

## 2. Source and coverage

| Item | Result |
|------|--------|
| Catalog | 207 Grok Build capabilities across ACP core, permissions, x.ai extensions, MCP, session/composer, TUI-only surfaces |
| Inventory | 193 SuperOne rows: **100 done**, **68 partial**, **14 missing**, **11 na** |
| Checkout | Existing clone. `git fetch` ran. Local `main` was **not** fast-forwarded. |
| Upstream delta | `48271133..origin/main` touches `xai-grok-shell` (about 153 files), including `util/config/mcp.rs` and `session/workflow/host_service.rs`. Re-read those before any MCP-config or workflow-host PR. |
| Working tree after inventory | Slash-launched workflows now synthesize a `Workflow` card (`packages/chat-core/src/host-workflow-card.ts`). The inventory predates that and still describes the card as absent. |

```text
SuperOne renderer
  AcpPermissionSelector  AcpModelSelector  PlanApprovalPrompt
  PermissionPrompt       AskUserQuestionPrompt  McpSlashPopup
        │ IPC
        ▼
Session → AcpBackend
        │
        ▼
createAcpRuntime  ──spawn──►  grok agent stdio
        ├── initialize   fs/terminal=false for grok-build; _meta ask + exit + clientIdentifier=superone
        ├── authenticate cached_token / api_key (interactive auth is a separate settings process)
        ├── session/new|load  mcpServers; _meta yolo/auto/reasoningEffort/clientIdentifier
        ├── session/prompt|cancel|set_mode|set_model
        ├── notify  x.ai/yolo_mode_changed, x.ai/interject
        ├── reverse  request_permission, x.ai/ask_user_question, x.ai/exit_plan_mode, x.ai/mcp/elicit
        └── ExtNotification  x.ai/session_notification and standalones
```

Node `run-turn.ts` sends the same ask/exit `_meta` flags. It still sends `clientCapabilities: {}` and `clientInfo.version` `0.0.0`.

---

## 3. Gap matrix

Columns match the workflow contract. `done` rows are omitted; they are the 100 inventory lines in the scratch file. Priority: **P0** broken host correctness, **P1** Claude/Codex-visible host UX, **P2** useful extension, **P3** defer or TUI-only.

| id | name | surface | status | evidence | gap | priority |
|----|------|---------|--------|----------|-----|----------|
| G3 | Create-time Ask omits `autoMode: false` | acp-host | partial | `grokSessionPermissionMeta` in `acp-permission-preapprove.ts` | Ask/default only set `clientIdentifier`. `autoMode` is set only when mode is `auto`. Grok then inherits `~/.grok/config.toml` `permission_mode=auto`. | **P0** |
| PL-1 | Enter plan sticks locally if `session/set_mode` fails | acp-host | partial | `setPermissionMode` in `acp-runtime.ts` | Sets `acpSessionMode = 'plan'` before the request, then logs and returns on failure. UI stays in plan; the agent does not. | **P1** |
| MCP-AUTH | `x.ai/mcp/auth_trigger` | acp-host | missing | `AcpBackend` has no `authenticateMcp`. OpenCode does. | `/mcp` Log In is hidden for grok-build. OAuth MCP servers cannot log in from SuperOne. | **P1** |
| PL-2 | Plan file name and review text | acp-host | partial | `handleExitPlanMode`, `PlanApprovalPrompt.tsx` | `planFilePath` is always `''`. Line comments go out as a later user turn. The approve RPC is `outcome=approved` only. | **P1** |
| MCP-RE | `reconnectMcp` ignores the server name | acp-host | partial | `acp-backend.ts` `reconnectMcp` → `pushMcpServers` | Resends the same descriptor list. A failed server with an unchanged config may not reconnect. | **P1** |
| Q-1 | Queued steer has no send-now | acp-host | partial | `queued-user-message-queue.ts`, `buildGrokInterjectParams` | Desktop steers with `x.ai/interject` and does not send `_meta.sendNow`. Node has no interject client. `supportsQueuedSteerSoon` is false. | **P1** |
| MOB-1 | Mobile plan sheet | acp-host | partial | `apps/mobile/src/prompts/PlanSheet.tsx` | Freeform approve/reject only. No line comments. Continue-after-approve is Claude-only. | **P1** |
| AUTO-1 | Generic Auto auto-denies classifier blocks | acp-agent | missing | `acp-auto-honesty.ts`; permissions doc client type | Toast is shipped. Escalation stays an agent deny because `clientIdentifier=superone` is Generic. | **P1** (do not spoof) |
| NODE-1 | Node self-echo on interjection | acp-host | partial | `packages/acp/src/xai-event-map.ts` | Desktop drops self-echo in `AcpBackend`. The shared mapper appends every interjection, including our own. | **P1** |
| NODE-2 | Node initialize shape | acp-host | partial | `packages/acp/src/run-turn.ts` | Ask/exit flags are present. `clientCapabilities` is `{}`, version is `0.0.0`, no yolo notify, no `set_mode`, no user MCP list, headless `exit_plan_mode` cancels immediately. | **P2** |
| WF-1 | Slash workflow card | acp-host | done in tree | `packages/chat-core/src/host-workflow-card.ts` | Inventory still says a host slash launch has no card. This tree synthesizes one from `workflow_updated` when no tool call exists. | — |
| XAI-PC | `x.ai/session/prompt_complete` | acp-host | missing | not in `XAI_EXT_NOTIFICATION_METHODS` | Grok still emits this fire-and-forget twin of durable `turn_completed` (`turn_completion.rs`). Wake already ends on `turn_completed`. | **P2** |
| XAI-HK | `x.ai/hooks/run` | acp-host | missing | no `_meta x.ai/hooks` handler | In-process hook reverse RPC is not implemented. `pluginDirs` on session/new is shipped. | **P2** |
| XAI-Q | `x.ai/queue/*` | acp-host | missing | no queue handlers | Host queue is local plus `x.ai/interject`, not Grok’s queue RPC. | **P2** |
| MCP-TOML | Read `~/.grok/config.toml` `[mcp_servers]` | acp-host | missing | `mcp-config-service.ts` is Claude JSON | Grok merges its own TOML beside SuperOne’s `session/new` list. SuperOne’s `/mcp` popup does not show those servers. Upstream `mcp.rs` changed after `48271133`. | **P2** |
| MCP-SID | `{{session_id}}` in user MCP headers | acp-host | missing | `acp-mcp.ts` copies headers verbatim | SuperOne’s own HTTP attach sets `X-SuperOne-Session-Id` explicitly. User servers do not get substitution. | **P2** |
| MCP-TO | Startup/tool timeouts on ACP MCP descriptors | acp-host | missing | `acp-mcp.ts` descriptor fields | Codex path sets `startup_timeout_sec`. ACP descriptors do not. | **P2** |
| MCP-SDK | `x.ai/mcp/sdk_call` | acp-host | missing | no references | In-process MCP transport. Host uses HTTP/stdio. | **P3** |
| RT-RESUME | `session/resume` | acp-agent | missing | resume is `session/load` or `session/new` | Unstable ACP resume. One process per session does not need it. | **P3** |
| MODE-ASK | Grok session mode `ask` as chrome | tui-only | missing | `grokPromptMetaMode` returns `plan` or `agent` | Host Ask is the yolo baseline, not prompt mode `ask`. | **P3** |
| MODE-EDIT | `acceptEdits` / `dontAsk` on Grok | acp-agent | missing | yolo notify maps other modes to `ask` | The notification cannot carry those modes. | **P3** |
| TD-09 | Checked-in JSON-RPC trace | test | missing | parity doc TD-09 | Optional. Mock-agent Vitest stays the gate. | **P3** |
| NA-* | Pager ops, leader/serve, host FS/terminal for grok-build, `enable-always-approve`, `allow-edits-session` | tui-only | na | inventory `na` rows (11) | Policy defer. | **P3** |

The other partials (about 50) are test or doc drift: unasserted Windows PATH, untested `drainLoadReplay`, stale sentences in this file’s previous revision, live TD-03 boxes. They are P2 hygiene, not new product slices. Row text is in the inventory scratch.

---

## 4. Gap deep-dives

### 4.1 P0 — Create-time Ask inherits Grok auto

**Problem.** A new SuperOne session whose permission mode is Ask can still run as Grok Auto if `~/.grok/config.toml` says `permission_mode=auto`. Mid-session Auto→Ask is fine: `x.ai/yolo_mode_changed` sends `auto_mode: false`. Create does not.

**Wire.** `session/new` and `session/load` `_meta.autoMode`. Grok treats omission as “use my config”. `grokSessionPermissionMeta` only writes `autoMode: true` when the host mode is `auto`, and `yoloMode: true` when it is `bypassPermissions`.

**Touch.** `apps/desktop/src/main/acp/acp-permission-preapprove.ts`, `acp-permission-preapprove.test.ts`, `acp-runtime.test.ts` session/new meta assertions.

**Approach.** For Ask (and any mode that is not auto), set `autoMode: false`. For any mode that is not bypass, set `yoloMode: false`. Keep `clientIdentifier: superone`. Do not send `clientIdentifier` on the mid-session notify (that filter drops updates for sessions whose origin does not match).

### 4.2 P1 — Plan mode lies when `set_mode` fails

**Problem.** `setPermissionMode('plan')` assigns `acpSessionMode = 'plan'` and then swallows `session/set_mode` errors. The status bar shows Plan. The agent is still in `default`. Prompt `_meta.mode` follows the local flag, so the next prompt can say `plan` while the session mode did not change. Those two signals are specified separately in Grok; they should not diverge by accident.

**Wire.** `session/set_mode` with `modeId` `plan` or `default`. Prompt `_meta.mode` is `plan` or `agent` only (`grokPromptMetaMode`).

**Touch.** `acp-runtime.ts` `setPermissionMode`. The renderer should see a failed mode change, not a silent success.

**Approach.** Set the local mode only after `set_mode` resolves. On failure, leave the previous mode and surface the error to `AcpBackend` so the selector rolls back.

### 4.3 P1 — MCP login

**Problem.** Claude/OpenCode can `authenticateMcp`. Grok’s login RPC is `x.ai/mcp/auth_trigger`. SuperOne hides Log In for grok-build, so an HTTP MCP server that needs OAuth cannot be signed in from the popup.

**Wire.** Confirm the method name and params against `origin/main` `xai-grok-shell` (MCP config moved after `48271133`) before coding.

**Touch.** `acp-xai-extensions.ts`, `acp-runtime.ts`, `acp-backend.ts` (`authenticateMcp`), `McpSlashPopup.tsx`.

**Approach.** Implement the RPC on the desktop backend only. Show Log In when the server row is Grok and the status says auth is required. Do not invent a TOML writer in this slice.

### 4.4 P1 — Plan approval chrome

**Problem.** Desktop line review works on `planContent`, but `planFilePath` is hard-coded to `''`, so the header has no filename. Comments are not part of the `x.ai/exit_plan_mode` result; they are a follow-up user message. Mobile has freeform feedback and no line comments.

**Wire.** `formatGrokExitPlanResponse` / cancelled variant in `acp-xai-extensions.ts`. Read Grok’s exit-plan schema before adding fields. If the result has no comment slot, keep the follow-up turn and only fix the filename from the plan body or the tool metadata.

**Touch.** `acp-backend.ts` `handleExitPlanMode`, `PlanApprovalPrompt.tsx`, `apps/mobile/src/prompts/PlanSheet.tsx`.

**Approach.** One desktop PR for the filename and for putting review text on the RPC if the schema allows it. Mobile line comments are a follow-up, not a blocker for desktop.

### 4.5 P1 — Reconnect one MCP server

**Problem.** `reconnectMcp(serverName)` ignores `serverName` and pushes the full list. Grok may treat an identical `update_mcp_servers` payload as a no-op, so a crashed server stays dead.

**Touch.** `acp-backend.ts`, `acp-runtime.ts` `updateMcpServers`.

**Approach.** Check whether Grok’s update method has a per-server restart. If it does not, drop and re-add that one server (rebuild the list without it, then with it) instead of sending an identical snapshot.

### 4.6 P1 — Send-now on an already queued steer

**Problem.** Claude can steer the in-flight turn immediately. Grok desktop only enqueues and later calls `x.ai/interject` without `_meta.sendNow`. Node cannot interject at all.

**Wire.** `buildGrokInterjectParams` in `acp-xai-session-ops.ts`. Confirm `sendNow` still exists on the pinned Grok and on `origin/main` before adding it.

**Touch.** `acp-xai-session-ops.ts`, `queued-user-message-queue.ts`, `packages/acp/src/run-turn.ts` only if CLI queued send is in the same PR.

**Approach.** Desktop first: pass send-now when the user steers the active turn, and keep the plain interject for a parked queue item. Set `supportsQueuedSteerSoon` only after that path is tested.

### 4.7 P1 — Auto under a Generic client

**Problem.** Auto in the status bar does not match Claude Auto. Grok auto-denies classifier blocks for `ClientType::Generic`. The host already shows a one-shot toast.

**Approach.** No code that pretends to be `grok-desktop`. Leave the toast. Document the limit next to the selector copy if a user can still read Auto as “edits go through”. This slice is copy and docs, not a new permission mode.

### 4.8 P1 — Node paints its own interjection

**Problem.** `packages/acp/src/xai-event-map.ts` turns every `x.ai/session/interjection` into `user_message_appended`. Desktop avoids that by handling the notification in `AcpBackend` and skipping `selfInterjectionIds`. A CLI host that uses the shared mapper will echo its own steer.

**Touch.** `xai-event-map.ts` and its test. Filter with the same self-id set the desktop backend uses, or stop emitting the user message from the shared mapper and let each host paint it.

---

## 5. PR plan

Ordered. Each slice is one commit-sized change. Later slices do not start until their dependency is in.

| PR | Title | Goal | Files | Tests | Depends on | Out of scope |
|----|-------|------|-------|-------|------------|----------------|
| 1 | `fix(acp): stamp autoMode false when creating an Ask session` | G3. Create and load send explicit `autoMode`/`yoloMode` booleans. | `acp-permission-preapprove.ts`, runtime meta call sites | `acp-permission-preapprove.test.ts`, session/new meta in `acp-runtime.test.ts` | — | Mid-session notify shape; spoofing client type |
| 2 | `fix(acp): roll back plan mode when set_mode fails` | Local plan flag follows a successful `session/set_mode` only. | `acp-runtime.ts`, `acp-backend.ts` if it assumes success | Runtime test: rejected `set_mode` leaves mode default | — | Prompt `_meta.mode` ask |
| 3 | `feat(acp): log in a Grok MCP server` | `authenticateMcp` calls `x.ai/mcp/auth_trigger`. Log In shows for grok-build. | extensions, runtime, `acp-backend.ts`, `McpSlashPopup.tsx` | Backend test with a fake agent method; popup test that Log In is not hidden | Re-read `mcp.rs` at `origin/main` | Writing `config.toml`; `sdk_call` |
| 4 | `fix(acp): show the plan filename on exit_plan_mode` | Stop forcing `planFilePath` to `''`. Put review text on the RPC only if Grok’s schema has a field. | `acp-backend.ts`, plan prompt, elicit formatter | `acp-backend.test.ts`, `PlanApprovalPrompt` test | — | Mobile line comments |
| 5 | `fix(acp): reconnect one MCP server` | `reconnectMcp(name)` changes that server’s attachment instead of resending an identical list. | `acp-backend.ts`, runtime update helper | Backend test: payload differs when one server is revived | PR 3’s method names if they share the MCP helper | User-header `{{session_id}}` |
| 6 | `feat(acp): send-now on Grok interject` | Active-turn steer sets `_meta.sendNow`. | `acp-xai-session-ops.ts`, queue | Ops test for the param; queued-send test | Confirm the field on current Grok | Node interject |
| 7 | `fix(acp): drop self interjections in the shared mapper` | CLI does not duplicate the steer as a user message. | `packages/acp/src/xai-event-map.ts` | `xai-event-map.test.ts` | — | Desktop backend filter (keep it) |
| 8 | `docs(acp): align permissions G-box intro with the 2026-09-16 CDP note` | Permissions doc stops saying every G box is empty. | `grok-acp-permissions.md` only | Doc link check | PR 1 if the G3 paragraph should say “fixed by PR 1” | Rewriting G1–G5 procedures |

P2 backlog, not scheduled: `prompt_complete` alias, `hooks/run`, `x.ai/queue/*`, grok TOML MCP visibility, header `{{session_id}}`, ACP MCP timeouts, node `clientInfo.version` and explicit `fs`/`terminal: false`. Do those only after PR 1–3, and only after fast-forwarding the Grok checkout or re-reading the touched crates at `4247f661`.

---

## 6. Explicit non-goals

- Grok TUI: theming, voice, fullscreen `/workflow runs`, pager overlays.
- `grok agent serve`, leader election, WebSocket transport.
- Advertising host filesystem or terminal to `grok-build` (UTF-8 image corruption). Handlers stay for other ACP agents.
- `session/close` / `session/resume` for a shared leader.
- Spoofing `clientType` / `clientIdentifier` to `grok-desktop` for Always-approve or allow-edits.
- Mapping host Ask onto Grok prompt mode `ask`.
- `acceptEdits` / `dontAsk` inside `x.ai/yolo_mode_changed`.
- `x.ai/mcp/sdk_call`.
- OS sandbox policy. Host only reads the profile (`grok-sandbox.ts`).
- A grok binary in CI. Mock-agent Vitest remains the gate. TD-09 traces stay optional.
- Fast-forwarding `/Users/wuhangqi25/Developer/Projects/grok-build` as part of a SuperOne PR.

---

## 7. Open questions

1. Does current Grok (`48271133` and `4247f661`) treat a missing `autoMode` as config inheritance, or only an explicit `autoMode: true`? PR 1 should lock this with a one-line fixture or a live Ask create against a config that sets `permission_mode=auto`.
2. Does `x.ai/exit_plan_mode`’s result schema accept review comments, or is the follow-up user turn the supported channel?
3. Does `x.ai/mcp/auth_trigger` still have that name after the `mcp.rs` rewrite on `origin/main`?
4. Does `x.ai/interject` still honor `_meta.sendNow`, or did queue RPC replace it?
5. Should `/mcp` show servers that exist only in `~/.grok/config.toml`, or is Grok’s own merge enough for behavior and the popup gap acceptable?

---

## 8. What this pass did not do

The workflow run was interrupted in the Gap phase (`workflow cleanup timed out`). Source, catalog, and inventory scratch files were complete. This document is the gap plan those notes were for. It does not implement PR 1–8. It does not fast-forward Grok Build. It does not close the permissions doc G2/G3 checkboxes.
