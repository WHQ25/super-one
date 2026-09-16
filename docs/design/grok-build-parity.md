# Design: SuperOne × Grok Build Feature Parity

| Field | Value |
|-------|--------|
| Status | Draft |
| Date | 2026-07-25 |
| Verified | 2026-09-16 against SuperOne working tree + Grok Build HEAD `48271133` (`SOURCE_REV` `be7ce6e8cffe46d20bef9834b211616082ee866b`) |
| Scope | SuperOne as ACP **host client** for Grok Build (`grok agent stdio`) |
| SuperOne path | `/Users/wuhangqi25/Developer/Projects/super-one` |
| Grok Build source | `/Users/wuhangqi25/Developer/Projects/grok-build` (`origin` → `https://github.com/xai-org/grok-build.git`) |
| Related design | [`grok-acp-permissions.md`](./grok-acp-permissions.md) (permission subsystem), [`grok-xai-ext-notifications.md`](./grok-xai-ext-notifications.md) (ExtNotification bus) |
| Out of scope (summary) | Grok TUI chrome, leader/WS topology, OS sandbox kernel, agent-side deny/hook engine, spoofing `clientType: grok-desktop` |

This is the **living host-parity plan**. Prefer live code + tests over older matrix rows in this file’s 2026-07-25 draft; those rows are rewritten below.

---

## 0. Relationship to existing designs

### `grok-acp-permissions.md` — keep; partially superseded in narrative

That doc owns **permission correctness**: built-in MCP preapprove, `session/new` `_meta.yoloMode`/`autoMode`, mid-session `x.ai/yolo_mode_changed`, Generic `clientIdentifier=superone`, and the rule that plan ≠ yolo.

**Keep it.** Do not re-derive G1–G5 here. Remaining permission *product* polish (Always button, Auto honesty, settings labels) is tracked in this file.

| Permissions-doc claim | Live code (2026-09-16) |
|-----------------------|------------------------|
| Status header “Implemented (phase 1)” | Accurate |
| §1 historical “always UI-prompt / setPermissionMode no-op” | **Shipped.** Preapprove + `setPermissionMode` → yolo notify |
| §3.1 ASCII still shows those gaps | **Stale diagram** — update in PR0 |
| §4.2 “phase 1 only `allow_once`” | **Stale.** Built-ins now prefer `allow-always-mcp` / `allow_always` |
| §4.3 “hide plan until phase 2” | **Stale.** Host enter-plan via `session/set_mode` is live |
| §12 G1–G5 checkboxes | Code+units exist; boxes + live CLI still open (TD-03/TD-04) |
| Non-goal: spoof `grok_desktop` | Still correct. SuperOne stays Generic |
| Non-goal: re-enable Grok `terminal` | Still correct |

### `grok-xai-ext-notifications.md` — keep; bus is shipped

That doc correctly identified the **agent→client ExtNotification rail** (`x.ai/session_notification` and standalones). **Live code now registers the bus** (`acp-xai-session-notify.ts`, `packages/acp/src/xai-event-map.ts`) with tests. The draft’s §4 gap matrix (BUS/WF/SA/BG/US/FU missing) is **stale**. Remaining bus items: `x.ai/session/prompt_complete`, applying `x.ai/mcp/tools_changed`, Node missing ask/exit reverse RPCs.

### This document

Broader parity: ACP runtime, models/effort, plan chrome sync, MCP live ops, CLI/node host, tests/docs, and a deferred catalog of TUI-only / agent-owned surfaces.

---

## 1. Scope and non-goals

### In scope

- SuperOne **desktop** as ACP client (`grok agent stdio` JSON-RPC).
- SuperOne **CLI/node** (`packages/acp` `run-turn.ts`) as a thinner ACP host.
- Core ACP: initialize → authenticate → session/new\|load → prompt/cancel/update → request_permission.
- High-value x.ai reverse requests and host→agent ops SuperOne already partially wires.
- Host UX parity with Claude/Codex for: permissions, model/effort, MCP attach, plan enter/exit, slash, tool rows.
- Test + design-doc hygiene so living docs match code.

### Explicit non-goals

See §6. SuperOne must **not** emulate the Grok pager. Tools, sandbox, deny rules, hooks files, and folder-trust stores stay agent-owned unless the host must proxy a reverse RPC.

---

## 2. Architecture snapshot (verified)

```text
SuperOne renderer
  AcpPermissionSelector  AcpModelSelector  PlanApprovalPrompt
  PermissionPrompt       AskUserQuestionPrompt  McpSlashPopup
        │ IPC
        ▼
Session → AcpBackend
        │
        ▼
createAcpRuntime  ──spawn──►  `grok agent stdio`  (ACP JSON-RPC v1)
        │
        ├── initialize  (fs/terminal=false for grok-build; _meta askUserQuestion+exitPlanMode+clientIdentifier=superone)
        ├── authenticate  (non-interactive cached_token / api_key only)
        ├── session/new | session/load  (mcpServers=superone+user; _meta yolo/auto/reasoningEffort)
        ├── session/prompt | cancel | set_mode | set_model | set_config_option
        ├── notify  x.ai/yolo_mode_changed, x.ai/interject, x.ai/queue/* (not hosted)
        ├── reverse request  session/request_permission, x.ai/ask_user_question,
        │                    x.ai/exit_plan_mode, x.ai/mcp/elicit
        └── ExtNotification  x.ai/session_notification | x.ai/session/update | standalones
```

**Key SuperOne files**

| Area | Path |
|------|------|
| Runtime | `apps/desktop/src/main/acp/acp-runtime.ts` |
| Spawn / detect | `acp-process.ts`, `acp-detect.ts`, `agent-catalog.ts` |
| Config / models | `acp-config.ts` |
| Permission preapprove | `acp-permission-preapprove.ts` |
| Permission map | `acp-permission-map.ts` |
| x.ai reverse + ops | `acp-xai-extensions.ts`, `acp-xai-session-ops.ts`, `acp-xai-session-notify.ts` |
| MCP attach / status | `acp-mcp.ts`, `acp-xai-mcp-status.ts` |
| Event map | `acp-event-map.ts` |
| Backend | `apps/desktop/src/main/session/backends/acp-backend.ts` |
| Fork | `acp-fork.ts` |
| Node host | `packages/acp/src/run-turn.ts` |
| Caps | `packages/shared/src/harness/harness-capabilities.ts` |
| Permission UI | `AcpPermissionSelector.tsx`, `PermissionPrompt.tsx` |

**Grok wire facts (from grok-build)**

- Transport: `grok agent stdio` (optional `serve` WS — SuperOne non-goal).
- Protocol: ACP v1 (`agent-client-protocol` 0.10.x). FS/terminal reverse RPCs fire **only** if advertised on initialize. SuperOne advertises **false** for `grok-build` (local FS/PTY; avoids UTF-8 image corruption).
- Models: often `_meta.modelState` / `x.ai/sessionConfig` with **no** standard `configOptions` model id → `session/set_model` + `_meta.reasoningEffort`. `configOptions` category `mode` is **reasoning effort**, not plan/permission.
- Permission runtime: Ask / Auto / AlwaysApprove (yolo). Mid-session: `x.ai/yolo_mode_changed` (`ask\|auto\|always-approve`). `acceptEdits`/`dontAsk` are settings-layer synthetics, not that notification.
- Plan: ACP `session/set_mode` ids `default\|plan\|ask`. Prompt `_meta.mode=agent\|ask\|plan` is the **only prompt-carried** mode signal (`session_mode.rs`). Agent also emits `current_mode_update`. Reverse `x.ai/exit_plan_mode` for approval.
- Client identity: `clientIdentifier=superone` → `ClientType::Generic`. Only TUI/Pager/Desktop get `enable-always-approve`, `allow-edits-session`, bash word-scope Always rows. Generic **auto-denies** Auto-classifier blocks instead of prompting.
- MCP tool id: `server__tool`. SuperOne UI: `mcp__server__tool`. Model uses `search_tool` / `use_tool`.
- Progressive work (workflow, subagent, bg tasks, follow-ups) rides **ExtNotification**, not standard `session/update` tool rows.

---

## 3. Capability matrix

Status: `done` | `partial` | `missing` | `na` (deferred by policy).

Priority: **P0** broken host correctness · **P1** Claude/Codex host UX parity · **P2** valuable ACP extension · **P3** TUI-only / defer.

Evidence paths are under SuperOne unless noted.

### 3.1 ACP runtime & process (`acp-runtime`)

| id | name | surface | SuperOne status | evidence | gap | priority |
|----|------|---------|-----------------|----------|-----|----------|
| RT-01 | Spawn `grok agent stdio` + ndjson | runtime | done | `acp-process.ts`, `agent-catalog.ts` (`grok-build`) | — | — |
| RT-02 | Safe spawn env / Windows hide | runtime | done | `acp-process.ts`, `packages/runtime/src/spawn-env.ts` | — | — |
| RT-03 | Detect grok CLI (`~/.grok/bin` + PATH) | runtime | partial | `acp-detect.ts` splits PATH on `:` always | Windows `;` PATH likely misses installs | P2 |
| RT-04 | initialize PROTOCOL_VERSION + `clientInfo` superone | acp-host | done | `acp-runtime.ts`, `acp-client-info.ts` | no `_meta.clientType` (intentional Generic) | na |
| RT-05 | Grok: fs/terminal=false | acp-host | done | `useHostDelegation = agentId !== 'grok-build'` | intentional | na |
| RT-06 | Advertise askUserQuestion + exitPlanMode | acp-host | done | desktop + `packages/acp` initialize `_meta` | Node cancels immediately if no UI | — |
| RT-07 | Non-interactive authenticate | acp-host | partial | cached_token / api_key heuristics | interactive `x.ai/auth/*` missing; no unit test | P2 |
| RT-08 | session/new mcpServers (superone + user) | acp-host | done | `buildAcpSessionMcpServers`, runtime tests | load payload not asserted for mcpServers | P3 |
| RT-09 | session/new `_meta` yolo/auto + clientIdentifier | acp-host | done | `grokSessionPermissionMeta` | — | — |
| RT-10 | session/new\|load `_meta.reasoningEffort` | acp-host | done | `sessionRequestBase` | — | — |
| RT-11 | session/load resume + drain replay + fallback new | acp-host | done | `drainLoadReplay`, `acp-runtime.test.ts` | — | — |
| RT-12 | session/prompt + update pump | acp-host | done | `acp-runtime.ts` prompt/pump | stamps `_meta.mode` (SU-10) | — |
| RT-13 | session/cancel + 2s stop fallback | acp-host | done | `CANCEL_STOP_FALLBACK_MS` | no `_meta.cancelTrigger` / rewindIfNoOutput | P3 |
| RT-14 | Concurrent prompt isolation | acp-host | done | `AcpPromptTurn`, concurrent-turn tests | — | — |
| RT-15 | Rejected prompt (quota -32003) ends turn | acp-host | done | `acp-runtime-turn-failure.test.ts` | — | — |
| RT-16 | Agent auto-wake + x.ai turn_completed | acp-host | done | `isXaiTurnCompletedNotification` | `x.ai/session/prompt_complete` not registered | P3 |
| RT-17 | session/set_config_option | acp-host | partial | `setConfigOption`; Grok often `configId=null` | host uses set_model instead; no runtime unit | P3 |
| RT-18 | session/set_model + `_meta.reasoningEffort` | acp-host | done | `acp-config.ts` `buildSetModelParams` | — | — |
| RT-19 | session/set_mode plan\|default | acp-host | done | `setAcpSessionMode`, create-time plan | Grok `ask` session mode not a UI item | P3 |
| RT-20 | x.ai/yolo_mode_changed mid-session | acp-host | done | `setPermissionMode` | notify omits `clientIdentifier` by design | P3 |
| RT-21 | Coalesce model/effort catalogs | acp-host | done | `coalesceModelConfig` | — | — |
| RT-22 | FS/terminal reverse handlers | acp-host | na | implemented; not advertised for grok-build | — | na |
| RT-23 | AbortSignal kills initialize child | runtime | partial | `abortInitialization` | no unit that abort kills the process | P3 |
| RT-24 | Process kill SIGTERM→SIGKILL | runtime | done | `acp-process.ts` | — | — |
| RT-25 | `formatProcessExit` / stderr | runtime | partial | `acp-runtime.ts` | no dedicated unit | P3 |
| RT-26 | session/close on tab drop | acp-host | na | `close()` kills stdio process (no `session/close`) | OK for per-session stdio; needed if leader/serve | na |
| RT-27 | session/resume (no replay) | acp-host | missing | host uses session/load | prefer load; resume is optional reconnect | P3 |
| RT-28 | additionalDirectories gated | acp-host | partial | `supportsExtraRoots`; Grok usually `{}` | extra roots dropped; no mid-session set | P2 |
| RT-29 | Cold `x.ai/session/fork` initialize | acp-host | partial | `acp-fork.ts` empty `clientCapabilities` | fork path untested vs real grok; caps empty | P2 |
| RT-30 | Prompt images + @file resource blocks | acp-host | done | `acp-prompt.ts` | — | — |
| RT-31 | Host-context append (not systemPromptOverride) | acp-host | partial | first non-slash prompt append | no `_meta.rules` / `systemPromptOverride` / `pluginDirs` | P2 |
| RT-32 | GROK_CONFIG overlay on spawn | config | missing | no `GROK_CONFIG` / `GROK_CONFIG_PATH` | host mutates nothing; overlay is the safe inject | P2 |
| RT-33 | grok agent serve / leader | runtime | na | stdio only | explicit non-goal | na |

### 3.2 Permissions & mode UI (`permissions-ui`)

| id | name | surface | SuperOne status | evidence | gap | priority |
|----|------|---------|-----------------|----------|-----|----------|
| PM-01 | request_permission → PermissionPrompt | acp-host | done | `acp-permission-map.ts`, `PermissionPrompt.tsx` | ACP card is Allow/Deny only (see PM-12) | P1 |
| PM-02 | Built-in SuperOne MCP preapprove | acp-host | done | `shouldAutoAllowAcpPermission` | — | — |
| PM-03 | Mini-app preapprove only (never `superone__*` prefix) | acp-host | done | preapprove tests | — | — |
| PM-04 | Never auto-allow 3rd-party MCP / bash | acp-host | done | GitHub / `run_terminal_command` tests | — | — |
| PM-05 | allow-always-mcp for builtins; allow-once for main-thread-only | acp-host | done | `decideAcpPermission` | user-facing Always still missing | P1 |
| PM-06 | Deny main-thread-only tools on Grok subagents | acp-host | done | `looksLikeAcpSubagentCall` | — | — |
| PM-07 | AcpPermissionSelector Ask/Plan/Auto/Always | session-ui | partial | `acpPermissionModes.ts` | selector tests are constants-only; no render test | P3 |
| PM-08 | Status-bar permission vs effort split | session-ui | done | `StatusBarPermission.tsx`, `AcpModeSelector` null when configId null | — | — |
| PM-09 | plan ≠ yolo: setPermissionMode(plan) → set_mode | acp-host | done | `acp-runtime.ts` | — | — |
| PM-10 | cyclePermissionMode ACP subset | session-ui | partial | `cyclePermissionModeImpl` uses `ACP_PERMISSION_MODES` | chat-store tests still Claude-only | P3 |
| PM-11 | Shift+Tab togglePlanModeShortcut plan↔default | session-ui | done | `togglePlanModeShortcutImpl` | — | — |
| PM-12 | PermissionPrompt Always / `allow_always` for ACP | session-ui | done | `getPermissionPromptConfig` ACP + Codex 4-button when `allowAlwaysAllow` | maps to `allow-always-mcp` / `allow_always`, not yolo | — |
| PM-13 | Auto under Generic: classifier blocks auto-deny | acp-host | done | one-shot toast + fail-closed Auto copy | stay Generic; do not spoof Desktop | — |
| PM-14 | Settings SessionDefaults ACP labels | session-ui | done | `SessionDefaultsSection` uses `AcpPermissionModeList` (Ask / Always Approve) | — | — |
| PM-15 | enable-always-approve option id | acp-host | missing | Generic never receives it | ignore unless spoofing Desktop (non-goal) | P3 |
| PM-16 | acceptEdits / dontAsk mid-session | acp-host | missing | yolo notify cannot carry them | by wire; idle rebuild only | P3 |
| PM-17 | Hide `/always-approve` slash | session-ui | done | `acp-slash-filter.ts` | — | — |
| PM-18 | persist/resume permissionMode | session-ui | done | `session.ts` mergeUiSettings | — | — |
| PM-19 | Mobile ACP permission chip labels | session-ui | done | `apps/mobile/.../permission-modes.generated.json` acp | no dedicated mobile UI test | P3 |
| PM-20 | CLI `packages/acp` permission + yolo | acp-host | partial | Allow/Deny only; no setPermissionMode | CLI cannot change yolo mid-turn | P2 |
| PM-21 | allow-edits-session option | acp-host | missing | Generic option set | Desktop-only option; do not spoof | P3 |
| PM-22 | Design-doc accuracy (PM-11/TD-04) | tests-docs | done | permissions + ext-notifications reconciled 2026-09-16 | live G1–G5 still TD-03 | — |

### 3.3 x.ai extension handlers (`xai-ext-host`)

| id | name | surface | SuperOne status | evidence | gap | priority |
|----|------|---------|-----------------|----------|-----|----------|
| XAI-01 | ask_user_question reverse + UI | acp-host | done | desktop UI + Node registers dual ids (cancel if no UI) | no `AskUserQuestionPrompt.test.tsx` (PR6) | P2 |
| XAI-02 | ask plan outcomes `chat_about_this` / `skip_interview` | acp-host | missing | comments only in `formatGrokAskUserResponse` | host only `accepted\|cancelled` | P2 |
| XAI-03 | exit_plan_mode reverse + PlanApproval + line review | acp-host | done | `PlanApprovalPrompt.tsx`, `plan-feedback.ts` | `planFilePath` always `''` | P3 |
| XAI-04 | Dual `_x.ai/*` onRequest aliases | acp-host | done | desktop + Node ask/exit/elicit | underscore path untested e2e vs live grok | P3 |
| XAI-05 | Approve plan: skip forced permissionMode default | session-ui | done | ACP approve skips `setPermissionMode`; Claude toggle unchanged | — | — |
| XAI-06 | Hide Claude post-approve acceptEdits toggle | session-ui | done | `showPostApprovalModeToggle = claude` | — | — |
| XAI-07 | ExtNotification bus (session_notification / session/update) | acp-host | done | `acp-xai-session-notify.ts`, `xai-event-map.ts` | leftover: `prompt_complete`, apply `tools_changed`, Node ask/exit | — |
| XAI-08 | workflow_updated / subagent_* / goal_updated | acp-host | done | mapper + tests | `supportsSubagents: false` vs mapped events | P2 |
| XAI-09 | task_backgrounded / task_completed | acp-host | done | standalone + nested | no `_x.ai/task_*` alias | P3 |
| XAI-10 | monitor_event | acp-host | done | mapper | — | — |
| XAI-11 | follow_ups chips (drop `x.ai/replayed`) | acp-host | done | `PromptSuggestionChips` | — | — |
| XAI-12 | scheduled_task_* + inject_prompt | acp-host | done | `parseGrokScheduledTaskInject` | — | — |
| XAI-13 | session/interjection + skip self echo | acp-host | done | `handleSessionInterjection` | — | — |
| XAI-14 | x.ai/interject mid-turn steer | acp-host | done | `acp-backend.ts` `interjectRequest` | no send-now (`_meta.sendNow`) | P3 |
| XAI-15 | x.ai/recap auto/manual | acp-host | done | `/recap` intercept | — | — |
| XAI-16 | x.ai/compact_conversation | acp-host | done | `/compact` intercept | — | — |
| XAI-17 | x.ai/rewind/{points,execute} | acp-host | done | `session.ts` maps checkpoint → prompt index | — | — |
| XAI-18 | x.ai/session/fork + resume child | acp-host | done | `acp-fork.ts` | see RT-29 | P2 |
| XAI-19 | x.ai/billing credits gauge | acp-host | done | `acp-billing.ts` | — | — |
| XAI-20 | settings/update consent_gate | acp-host | partial | `handleConsentNotice` | non-consent remote settings ignored | P3 |
| XAI-21 | x.ai/models/update | acp-host | done | `handleMcpExt` extract models | — | — |
| XAI-22 | x.ai/mcp/elicit + elicit_complete | acp-host | done | parked as `mcp_elicitation` | — | — |
| XAI-23 | x.ai/mcp/sdk_call | acp-host | missing | SuperOne uses HTTP/stdio attach | zero-IPC SDK transport unused | P3 |
| XAI-24 | x.ai/session/prompt_complete | acp-host | missing | wake closed via nested turn_completed | legacy alias | P3 |
| XAI-25 | TUI-only: sessions/changed, queue/changed, announcements, git_head_changed, leader/version_mismatch | acp-host | na | omitted from `XAI_EXT_NOTIFICATION_METHODS` | — | na |
| XAI-26 | x.ai/fs\|git\|search\|terminal client ops | acp-host | na | pager chrome | — | na |
| XAI-27 | Client hooks `x.ai/hooks/run` | acp-host | missing | no `_meta.x.ai/hooks` | product decision | P2 |
| XAI-28 | Prompt queue `x.ai/queue/*` | acp-host | missing | host uses interject/queue locally | server-authoritative queue | P2 |

### 3.4 MCP host attach & tools (`mcp-host`)

| id | name | surface | SuperOne status | evidence | gap | priority |
|----|------|---------|-----------------|----------|-----|----------|
| MCP-01 | session/new SuperOne first (HTTP if caps.http else stdio) | mcp-host | done | `acp-mcp.ts` | HTTP path unit-covered, not e2e vs grok | P3 |
| MCP-02 | session/load re-attaches same mcpServers | mcp-host | partial | spread `sessionRequestBase` | load test does not assert mcpServers | P3 |
| MCP-03 | User MCP from Claude-shaped configs | mcp-host | done | `listMcpConfigs` → `toAcpMcpServer` | not `~/.grok/config.toml` | P2 |
| MCP-04 | Filter HTTP/SSE by agent mcpCapabilities | mcp-host | done | `mcpTransportCapsFromAgent` | — | — |
| MCP-05 | Mid-session `x.ai/session/update_mcp_servers` | mcp-host | done | `reloadMcpServers` passes cached `agentCapabilities` | — | — |
| MCP-06 | reconnectMcp | mcp-host | done | rebuilds list via `updateMcpServers` | — | — |
| MCP-07 | toggleMcpServer | mcp-host | done | rebuilds list after settings write `disabled` | — | — |
| MCP-08 | authenticateMcp / OAuth login RPC | mcp-host | done | `/mcp` LogIn hidden for ACP (OpenCode-only); elicit-URL still parks | `x.ai/mcp/auth_trigger` not wired | P2 |
| MCP-09 | server_status / init_progress / servers_updated → mcp_status | mcp-host | done | `acp-xai-mcp-status.ts` | — | — |
| MCP-10 | x.ai/mcp/tools_changed apply | mcp-host | partial | subscribed; `handleMcpExt` has no case | tool counts stale until servers_updated | P2 |
| MCP-11 | Host-only `/mcp` popup | session-ui | done | `McpSlashPopup.tsx` | Grok settings still open Claude MCP tab | P2 |
| MCP-12 | use_tool unwrap → `mcp__server__tool` | mcp-host | done | `unwrapMcpEnvelope` | — | — |
| MCP-13 | Sparse use_tool skipped (no fallback chip) | mcp-host | done | event-map tests | — | — |
| MCP-14 | search_tool → SearchTools chip | mcp-host | done | event-map | — | — |
| MCP-15 | SuperOne HTTP Bearer + session HMAC | mcp-host | done | `superone-mcp-auth.ts` | — | — |
| MCP-16 | Host context only when SuperOne MCP attached | mcp-host | done | `mcpAttached` | — | — |
| MCP-17 | CLI Host Action SuperOne MCP | mcp-host | done | `apps/cli/.../host-action-mcp-auth.ts` | no user MCP list on node | P2 |
| MCP-18 | Subagent inherits parent MCP | runtime | done | agent-side inherit; host child-guards main-thread tools | — | — |
| MCP-19 | sdk_call in-process MCP | acp-host | missing | same as XAI-23 | — | P3 |
| MCP-20 | `{{session_id}}` header interpolation | mcp-host | missing | headers copied verbatim | SuperOne uses explicit session header | P3 |
| MCP-21 | startup/tool timeout fields on descriptors | mcp-host | missing | name/command/url/headers only | Grok TOML timeouts not forwarded | P3 |
| MCP-22 | Manage `~/.grok/config.toml` [mcp_servers] | mcp-host | missing | SuperOne reads Claude-shaped configs | Grok still merges its own TOML | P2 |
| MCP-23 | pluginDirs trusted plugin MCP roots | acp-host | missing | no `_meta.pluginDirs` | — | P2 |

### 3.5 Session model, plan mode, composer (`session-ui`)

| id | name | surface | SuperOne status | evidence | gap | priority |
|----|------|---------|-----------------|----------|-----|----------|
| SU-01 | AcpModelSelector from modelState/sessionConfig | session-ui | done | `coalesceModelConfig` | — | — |
| SU-02 | set_model when configId null | acp-host | done | backend `applyModel` | — | — |
| SU-03 | Reasoning effort via set_model `_meta.reasoningEffort` | session-ui | done | `GroupedModelEffortSelector` | — | — |
| SU-04 | Host enter plan: setPermissionMode(plan) → set_mode | session-ui | done | runtime tests | prompt `_meta.mode` still missing | P1 |
| SU-05 | HARNESS_CAPABILITIES.acp plan/todo/mcp/compact/fork/steer | session-ui | done | `harness-capabilities.ts` | `supportsSubagents: false` | P2 |
| SU-06 | session/update plan → todos | session-ui | done | `mapPlanToTodoEvents` | — | — |
| SU-07 | Context occupancy bar | session-ui | done | `getContextUsage` from turn_completed / `_meta.totalTokens` | old parity row stale | — |
| SU-08 | x.ai/billing rate-limit gauge | session-ui | done | `getRateLimits` | — | — |
| SU-09 | Rewind / compact / fork host ops | acp-host | done | session maps prompt index; `/compact`; ForkButton | fork initialize caps empty | P2 |
| SU-10 | session/prompt `_meta.mode=agent\|ask\|plan` | acp-host | done | `prompt()` stamps `_meta.mode` from tracked ACP session mode | `ask` session mode still not a UI item | P3 |
| SU-11 | `current_mode_update` → host chrome | acp-host | done | `acp-event-map.ts` + yolo baseline restore | — | — |
| SU-12 | available_commands → slash palette | session-ui | done | `acp_commands` | — | — |
| SU-13 | `/recap` `/compact` `/goal` intercepts | session-ui | done | ChatInput + backend | — | — |
| SU-14 | follow_ups → PromptSuggestionChips | session-ui | done | chat-core grok-ux tests | — | — |
| SU-15 | Mid-turn queue → interject | session-ui | done | `supportsQueuedSteer` | no send-now | P3 |
| SU-16 | `/add-dir` when advertised | session-ui | done | gated on sessionCapabilities | Grok rarely advertises | P3 |
| SU-17 | provider_session_id persist | session-ui | done | session-repo Grok cold-resume | — | — |
| SU-18 | Mobile plan approval vs desktop line review | session-ui | partial | `PlanSheet` approve/reject+freeform | no line comments / review wrap | P2 |
| SU-19 | executePlan on prompt after approve | acp-host | missing | Grok `_meta.executePlan` starts implement | SuperOne relies on agent after approved outcome | P2 |
| SU-20 | Grok session mode `ask` (Q&A) | session-ui | missing | plan/default only | optional third chrome state | P3 |

### 3.6 Built-in tools & rendering (`tools-runtime`)

Host maps `_meta["x.ai/tool"]` and does not reimplement tools.

| id | name | surface | SuperOne status | evidence | gap | priority |
|----|------|---------|-----------------|----------|-----|----------|
| TR-01 | Canonical `x.ai/tool` envelope | acp-host | done | `nameFromGrokMeta`, `normalizeAcpTool` | — | — |
| TR-02 | Default GrokBuild tool rows (bash/read/edit/grep/…) | acp-host | done | `acp-event-map.test.ts` Grok fixtures | — | — |
| TR-03 | image_gen / video_gen media open | acp-host | partial | MCP media tools exist; Grok session-relative `images/N.jpg` | no dedicated Grok media-path presenter test | P2 |
| TR-04 | Background task / monitor UI | acp-host | done | task_* + monitor_event mappers | — | — |
| TR-05 | Subagent spawn/finish in transcript | acp-host | done | session_notification subagent_* | cap flag false; no nested child chrome | P2 |
| TR-06 | Reimplement Grok tools in SuperOne | runtime | na | agent-owned | — | na |

### 3.7 Skills, plugins, hooks, marketplace (`mcp-skills-plugins`)

| id | name | surface | SuperOne status | evidence | gap | priority |
|----|------|---------|-----------------|----------|-----|----------|
| SK-01 | ACP availableCommands / skills as slash | acp-host | done | `available_commands_update` | — | — |
| SK-02 | x.ai/skills/* management UI | tui-only | na | agent + grok CLI | optional Extensions modal later | P3 |
| SK-03 | x.ai/plugins/* + marketplace | tui-only | na | grok plugin CLI | — | P3 |
| SK-04 | session `_meta.pluginDirs` | acp-host | missing | — | host cannot pin extra plugin roots | P2 |
| SK-05 | Disk hooks (`.grok/hooks`) | config | na | agent-owned; folder-trust gated | — | na |
| SK-06 | Client/SDK hooks reverse `x.ai/hooks/run` | acp-host | missing | — | only if SuperOne hosts in-process hooks | P2 |

### 3.8 Sandbox, safety, config (`permissions-sandbox` / `session-memory-models`)

| id | name | surface | SuperOne status | evidence | gap | priority |
|----|------|---------|-----------------|----------|-----|----------|
| SB-01 | Observe GROK_SANDBOX / config.toml profile | runtime | done | `grok-sandbox.ts` | ACP stdio does not take `--sandbox`; host does not set it | na |
| SB-02 | Implement Landlock/Seatbelt in SuperOne | runtime | na | agent-owned | — | na |
| SB-03 | Folder-trust interactive reverse RPC | acp-host | missing | SuperOne does not advertise `x.ai/folderTrust.interactive` | TUI gates client-side; OK | P3 |
| SB-04 | Memory v1/v2 / flush/dream | acp-agent | na | agent-owned; host may call `x.ai/memory/flush` later | — | P3 |
| SB-05 | Custom models via `~/.grok/config.toml` | config | na | agent catalog; host reads modelState | — | na |
| SB-06 | AGENTS.md project rules | runtime | na | agent loads when folder-trusted | host does not inject | na |
| SB-07 | x.ai/session/list rich picker | acp-host | missing | SuperOne uses own session DB | Grok disk sessions not browsed | P3 |

### 3.9 Product surfaces beyond host (`product-surfaces`)

All **tui-only** pager chrome is `na` / P3: theming, voice, vim, dashboard, status-line, mouse, `@` picker, command palette, OSC notifications, wrap/doctor, welcome/login screens, slash TUI menu, Ctrl+B background, prompt-queue send-now chords.

Host-relevant rows:

| id | name | surface | SuperOne status | evidence | gap | priority |
|----|------|---------|-----------------|----------|-----|----------|
| PS-01 | Launch `grok agent stdio` | acp-agent | done | catalog | — | — |
| PS-02 | `grok -p` headless projector | cli-headless | na | not an ACP host path | — | na |
| PS-03 | Image paste as ACP image blocks | acp-host | done | `acp-prompt.ts` | — | — |
| PS-04 | File context as resource blocks (not TUI `@`) | acp-host | done | `buildAcpPromptContentAsync` | — | — |

### 3.10 Tests & design docs (`tests-docs`)

| id | name | surface | SuperOne status | evidence | gap | priority |
|----|------|---------|-----------------|----------|-----|----------|
| TD-01 | Unit: preapprove + yolo create/notify | tests-docs | done | `acp-permission-preapprove.test.ts`, runtime tests | — | — |
| TD-02 | Unit: exit_plan / ask_user wire + PlanApproval UI | tests-docs | done | backend + PlanApprovalPrompt + `AskUserQuestionPrompt.test.tsx` | — | — |
| TD-03 | Manual live grok CLI checklist | tests-docs | missing | deferred 2026-09-16 — no recorded macOS grok run in this session | owner: follow-up; Grok binary stays out of CI | **P1** |
| TD-04 | Permissions G1–G5 boxes | tests-docs | partial | code shipped; boxes empty | PR0 + TD-03 | **P1** |
| TD-05 | This parity matrix vs code | tests-docs | partial | this rewrite | keep living | — |
| TD-06 | ExtNotification design vs tests | tests-docs | done | PR0: bus marked shipped; leftover at MCP-10 / RT-06 / XAI-24 | — | — |
| TD-07 | authenticate unit | tests-docs | done | `acp-auth.test.ts` cached_token / api_key / grok.com | interactive path is PR7 | — |
| TD-08 | Live grok binary in CI | tests-docs | na | policy: mock-agent vitest | TD-03 is the substitute | na |
| TD-09 | Event-trace of preapprove / yolo | tests-docs | missing | optional | P3 |

---

## 4. Gap deep-dives (P0 / P1)

Shipped-and-done items (model `set_model`, session/load, user MCP on session/new, plan approval UI, host enter-plan `set_mode`, ExtNotification bus, compact/rewind/fork, `getContextUsage`, MCP status mapping, elicit, billing, recap) are **not** repeated here. Old §4.1–4.5 “P0 setModel / P1 user MCP / P1 session/load” are obsolete.

### 4.0 P0 — Node/CLI host cannot answer Grok reverse RPCs

**Problem.** Desktop registers `x.ai/ask_user_question`, `x.ai/exit_plan_mode`, and `x.ai/mcp/elicit` (plus `_x.ai/` aliases) and advertises `initialize._meta.askUserQuestion/exitPlanMode`. `packages/acp/src/run-turn.ts` initializes with **empty** `clientCapabilities`, **no** `_meta` caps, and `onRequest` only for `mcp/elicit` + `request_permission`. If Grok parks ask/plan reverse requests on a CLI/node turn, the turn **hangs** until timeout (ask default 30 min).

**Grok wire facts.**

- Reverse requests are first-answer-wins interactions; headless Grok `-p` auto-cancels ask.
- SuperOne node is an interactive-capable host (permissions already flow) but does not implement the other two Grok reverse methods.

**SuperOne touch files.**

- `packages/acp/src/run-turn.ts`
- `packages/acp/src/xai-elicit.ts` (pattern to copy)
- `apps/desktop/src/main/acp/acp-xai-extensions.ts` (share parse/format)
- `packages/acp/src/run-turn.test.ts`

**Proposed approach.**

1. Advertise the same `_meta.askUserQuestion` / `exitPlanMode` flags as desktop (or omit and accept cancel — **do not hang**).
2. Register dual method ids; map onto existing `onPermission` / a small pending-interaction callback.
3. Fail closed: if the runner has no UI, return `cancelled` immediately (headless policy), never leave the RPC unanswered.

### 4.1 P1 — ACP PermissionPrompt has no Always / session-grant

**Problem.** Grok `session/request_permission` often includes `allow_always` / `allow-always-mcp` / `allow-always-command`. SuperOne `mapPermissionRequest` sets `allowAlwaysAllow: true`. Desktop `getPermissionPromptConfig` only gives the 4-button Always row to **Codex**. ACP users can Allow (once) or Deny; they cannot persist a session grant from the card. Built-ins already short-circuit with always-mcp; **native bash/edit and third-party MCP re-prompt every call**.

**Grok wire facts.**

- Option kinds: `allow_once`, `allow_always`, `reject_once`, `reject_always`.
- Option ids include `allow-once`, `allow-always-command`, `allow-always-mcp`, `allow-edits-session`.
- Generic clients still receive allow_always for MCP/command; they do **not** get `enable-always-approve` (Desktop/TUI only). SuperOne must not treat a missing Desktop option as a reason to hide ordinary Always.

**SuperOne touch files.**

- `apps/desktop/src/renderer/src/components/chat/permission-prompt/permission-prompt-config.ts`
- `PermissionPrompt.tsx` (`handleAlwaysAllow` already exists)
- `packages/acp/src/permission-map.ts` / CLI (optional Always)
- tests: `PermissionPrompt` + `acp-permission-map.test.ts`

**Proposed approach.**

1. Treat ACP like Codex when `allowAlwaysAllow && !elicitation`: offer Always.
2. `mapPermissionDecision(..., alwaysAllow=true)` already prefers `allow-always-mcp`.
3. Do **not** map Always → `enable-always-approve` / `setPermissionMode(bypassPermissions)` (that is YOLO, a different control).
4. `allow-edits-session` can be a later P2 labeled “Allow edits this session”.

### 4.2 P1 — Plan chrome desync (`current_mode_update` + prompt `_meta.mode`)

**Problem.** SuperOne can **enter** plan via `session/set_mode` (status-bar / Shift+Tab). Two Grok signals are ignored:

1. Agent-driven `enter_plan_mode` / `exit_plan_mode` emits ACP `current_mode_update`. SuperOne does not map it, so the selector stays on Ask/Auto/Always while the agent is in plan.
2. `session/prompt` never stamps `_meta.mode`. Grok’s `reconcile_plan_mode_with_prompt` treats prompt meta as **the only prompt-carried mode signal**. A prompt without it will not enter/leave plan; it also will not **confirm** the host’s set_mode on the turn that lands in `updates.jsonl`.

**Grok wire facts.** (`session_mode.rs`)

- `session/set_mode` ids: `default` (agent), `plan`, `ask`.
- Prompt `_meta.mode`: `agent|ask|plan`.
- `enqueue_current_mode_update` after set_mode and after prompt reconcile.
- `_meta.executePlan` on a later prompt starts implementation after approve (optional).

**SuperOne touch files.**

- `acp-event-map.ts` (new `current_mode_update` case → `permission_mode_change` / agent_setting)
- `acp-runtime.ts` `prompt()` — attach `_meta.mode` from last host/agent mode
- `acp-backend.ts` — track ACP session mode separately from yolo baseline if needed
- tests: event-map + runtime prompt meta + selector update

**Proposed approach.**

1. Map `current_mode_update` `plan` → SuperOne `permissionMode: 'plan'`; `default` → restore last yolo baseline (ask/auto/always), not always `'default'`.
2. Stamp prompt `_meta.mode` from that tracked mode (`plan` → `plan`, `default`+ask yolo → `agent`).
3. Do not send `session/set_mode` for reasoning effort.

### 4.3 P1 — Plan approve forces permissionMode `default`

**Problem.** `respondToPlanApprovalImpl` on approve always `setPermissionMode(postApprovalMode ?? 'default')`. Claude uses that to leave plan into acceptEdits/auto. ACP hides the post-approve toggle, so approve **always** notifies Grok `permission_mode: ask` even if the user had Auto or Always Approve.

**Grok wire facts.** Plan exit outcome is `approved|cancelled|abandoned`. Permission baseline is independent (`yolo_mode_changed`).

**SuperOne touch files.**

- `apps/desktop/src/renderer/src/stores/chat-store/helpers/interaction.ts`
- `PlanApprovalPrompt.tsx` (already `showPostApprovalModeToggle = claude`)
- `interaction.test.ts` / `chat-store.test.ts`

**Proposed approach.** For `sessionProvider === 'acp'`, skip `setPermissionMode` on approve (plan already left via Grok after `outcome: approved` + host `set_mode default` if we send it). Keep Claude behavior.

### 4.4 P1 — MCP live reload/toggle/OAuth no-ops or wrong caps

**Problem.**

1. `reloadMcpServers` rebuilds descriptors **without** `agentCapabilities`, so HTTP/SSE user servers and SuperOne HTTP are dropped; Grok gets stdio SuperOne only.
2. `reconnectMcp` / `toggleMcpServer` are empty. Settings UI writes Claude-shaped config then calls a no-op.
3. `authenticateMcp` is absent. Session throws. Grok OAuth is `x.ai/mcp/auth_trigger` plus elicit URL — SuperOne already parks elicit, but `/mcp` LogIn does not start Grok OAuth.

**Grok wire facts.**

- Hot swap: `x.ai/session/update_mcp_servers { sessionId, mcpServers }`.
- OAuth: `x.ai/mcp/auth_trigger`; status `x.ai/mcp/auth_status`; needsAuth via `server_status`.
- Toggle/upsert/delete exist as agent RPCs (`x.ai/mcp/toggle|upsert|delete`) — TUI `/mcps`. SuperOne can either call those or rewrite client `mcpServers` via update_mcp_servers.

**SuperOne touch files.**

- `acp-backend.ts` `reloadMcpServers` / new toggle/reconnect/auth
- `acp-runtime.ts` `updateMcpServers` (already)
- `acp-mcp.ts` pass caps
- `McpSlashPopup.tsx` LogIn
- tests: reload keeps HTTP SuperOne; toggle calls update_mcp_servers

**Proposed approach.**

1. Cache `agentCapabilities` on the backend; always pass them into `buildAcpSessionMcpServers`.
2. Implement toggle/reconnect as `updateMcpServers` with the filtered list (do not require Grok’s TUI CRUD RPCs for v1).
3. LogIn for Grok: `x.ai/mcp/auth_trigger` if we add the RPC; else document that OAuth is elicit-URL only and hide the broken button.

### 4.5 P1 — Auto mode is offered but Generic auto-denies classifier blocks

**Problem.** SuperOne shows Auto and maps `_meta.autoMode` / `permission_mode: auto`. Grok Auto uses an LLM classifier; **Generic clients cannot present** those escalation prompts and **auto-deny**. Users see “Auto mode blocked this action …” with no SuperOne toast and no eligibility gate (Claude’s `auto-mode-eligibility.ts` is Claude-only).

**Grok wire facts.** (`prompter.rs` / auto_mode)

- ClientType from `clientIdentifier`. `superone` → Generic.
- Generic option set is reduced; Auto blocks do not prompt.
- Honest Generic is still the right identity (do not spoof `grok-desktop` without Desktop option UX: `enable-always-approve`, bash word-scope, `allow-edits-session`).

**SuperOne touch files.**

- `AcpPermissionSelector.tsx`
- `apps/desktop/src/renderer/src/lib/auto-mode-eligibility.ts` (or ACP-specific helper)
- i18n copy
- optional: hide Auto until we implement Desktop option set **or** document Auto as “classifier, fail-closed”

**Proposed approach (pick one in PR5).**

- **A (safer):** Keep Generic; when Auto is selected, toast once: classifier denials will not prompt. Optionally hide Auto.
- **B (parity):** Spoof `grok-pager`/`grok-desktop` **and** implement Desktop option ids (PM-12, PM-15, bash Always rows). That is a larger identity change — not this slice unless product explicitly wants it.

Recommend **A** unless product signs off on B.

### 4.6 P1 — Settings SessionDefaults uses Claude labels for ACP

**Problem.** `HARNESS_LAUNCH_OPTIONS.acp.permissionModes` is the right subset (`default/plan/auto/bypassPermissions`), but `SessionDefaultsSection` renders Claude `PermissionModeList` (Normal / Bypass) instead of `AcpPermissionModeList` (Ask / Always Approve). Composer draft popover is already correct.

**Touch files.** `SessionDefaultsSection.tsx`, preferences tests.

**Proposed approach.** Branch `harnessId === 'acp'` → `AcpPermissionModeList`, same as `HarnessPermissionPopover`.

### 4.7 P1 — Docs + live grok CLI checklist lag

**Problem.** Permissions §3.1/§12, ext-notifications bus matrix, and the previous revision of **this** file listed shipped work as missing (setModel no-op, user MCP, getContextUsage, host enter-plan, rewind/compact/fork). Agents and humans over-trust stale rows. There is **no recorded** live `grok agent stdio` acceptance run.

**Touch files.**

- `docs/design/grok-acp-permissions.md` (PR0: strike stale ASCII; tick G1–G4 after TD-03; leave G5 Auto until 4.5)
- `docs/design/grok-xai-ext-notifications.md` (reclassify bus as shipped)
- this file (already rewritten)
- `docs/design/agent-self-verify.md` (add later test suites)

**Manual checklist (TD-03)** — macOS, installed grok CLI:

1. Spawn grok-build session; model switch + effort apply (watch agent).
2. Ask: bash prompts Allow/Deny; Always (after 4.1) sticks for the session.
3. Built-in SuperOne MCP silent; third-party MCP prompts.
4. Auto: either toast (4.5) or document deny-closed.
5. Plan: host enter → agent plan.md → approve/reject + line comments; selector returns without wiping Always.
6. Agent-driven enter_plan_mode flips chrome (after 4.2).
7. User MCP on session/new; `/mcp` status; reload keeps HTTP SuperOne.
8. Resume via session/load; recap; compact; rewind; fork.
9. Workflow progress + follow-up chips.
10. Node/CLI: ask or plan reverse does not hang (after 4.0).

---

## 5. PR plan

Ordered slices. One logical change per PR. Titles are suggested commit subjects.

Shipped work (do **not** re-open as PRs): stdio lifecycle, yolo/auto meta + notify, builtin preapprove, `session/set_model`+effort, session/load, user MCP on session/new, plan approval UI, host `set_mode` plan, ExtNotification bus, compact/rewind/fork, occupancy, MCP status mapping, elicit, billing, recap, interject, follow-ups.

### PR0 — Docs: reconcile permissions + ExtNotification with shipped code  **(landed)**

| | |
|--|--|
| **Title** | `docs(acp): mark Grok permission phase-1 and ExtNotification bus as shipped` |
| **Goal** | Stop false “setPermissionMode no-op / always UI-prompt / bus missing / setModel no-op” narrative. Point remaining work at this parity doc. |
| **Files** | `docs/design/grok-acp-permissions.md`, `docs/design/grok-xai-ext-notifications.md`, `docs/design/agent-self-verify.md` (this file already rewritten) |
| **Test plan** | Doc review only |
| **Deps** | none |
| **Out of scope** | Code; ticking G1–G5 without TD-03 |

### PR1 — ACP PermissionPrompt Always / session grants  **(landed)**

| | |
|--|--|
| **Title** | `feat(acp): offer Always on Grok permission prompts when the agent provides allow_always` |
| **Goal** | Users can persist bash/MCP/domain grants from the card; map to `allow-always-mcp` / `allow_always` option ids. |
| **Files** | `permission-prompt-config.ts`, `PermissionPrompt.tsx`, optional `packages/acp` permission-map, tests |
| **Test plan** | ACP + `allowAlwaysAllow` → Always button; Always selects `allow-always-mcp` when present; Codex/Claude layouts unchanged; elicitation unchanged |
| **Deps** | none (parallel to PR0) |
| **Out of scope** | `enable-always-approve`; spoof Desktop; `allow-edits-session` |

### PR2 — Plan chrome sync: current_mode_update + prompt `_meta.mode` + skip post-approve default  **(landed)**

| | |
|--|--|
| **Title** | `feat(acp): sync Grok plan mode from current_mode_update and prompt _meta.mode` |
| **Goal** | Agent- and host-driven plan stay aligned; approving a plan does not reset Always/Auto to ask. |
| **Files** | `acp-event-map.ts`, `acp-runtime.ts` `prompt()`, `acp-backend.ts`, `interaction.ts` `respondToPlanApprovalImpl`, tests |
| **Test plan** | `current_mode_update` plan/default updates store; prompt RPC includes `_meta.mode`; ACP approve does not call `setPermissionMode('default')`; Claude post-approve toggle unchanged |
| **Deps** | none |
| **Out of scope** | `executePlan` prompt meta; Grok session mode `ask` chrome; `planFilePath` |

### PR3 — MCP live ops: reload caps, toggle/reconnect, OAuth entry  **(landed)**

| | |
|--|--|
| **Title** | `fix(acp): pass agent MCP caps on reload and implement ACP toggle/reconnect` |
| **Goal** | Mid-session MCP reload keeps HTTP SuperOne + user HTTP/SSE; settings toggle/reconnect no longer no-ops; hide or wire Grok OAuth LogIn. |
| **Files** | `acp-backend.ts`, `acp-mcp.ts`, `acp-runtime.ts`, `McpSlashPopup.tsx`, tests |
| **Test plan** | `reloadMcpServers` includes SuperOne HTTP when initialize advertised http; toggle rebuilds list; reconnect = update_mcp_servers; no Claude regression |
| **Deps** | none |
| **Out of scope** | `x.ai/mcp/sdk_call`; managing `~/.grok/config.toml`; `tools_changed` apply (small follow in same PR if cheap) |

### PR4 — Node/CLI reverse host (ask + exit_plan)  **(landed)**

| | |
|--|--|
| **Title** | `feat(acp): register Grok ask_user_question and exit_plan_mode on the node host` |
| **Goal** | CLI/node turns never hang on Grok reverse RPCs; advertise the same initialize `_meta` flags or cancel immediately. |
| **Files** | `packages/acp/src/run-turn.ts`, shared formatters, `run-turn.test.ts` |
| **Test plan** | initialize `_meta` flags; onRequest dual ids; missing UI → cancelled; elicit still works |
| **Deps** | none (can parallel PR1–PR3) |
| **Out of scope** | Full PlanLineReview on CLI; yolo mode UI on CLI |

### PR5 — Auto-mode honesty + SessionDefaults ACP labels  **(landed)**

| | |
|--|--|
| **Title** | `fix(acp): Ask/Always labels in settings and fail-closed Auto copy` |
| **Goal** | Settings match composer Ask/Always Approve vocabulary; Auto does not silently look like Claude Auto. |
| **Files** | `SessionDefaultsSection.tsx`, `AcpPermissionSelector.tsx`, i18n, optional eligibility helper, tests |
| **Test plan** | ACP preferences list uses Ask/Always Approve; Auto shows fail-closed hint; Claude list unchanged |
| **Deps** | none |
| **Out of scope** | Spoofing `grok-desktop`; implementing `enable-always-approve` |

### PR6 — Tests, missing units, live grok CLI checklist  **(landed; TD-03 still open)**

| | |
|--|--|
| **Title** | `test(acp): Grok host checklist plus AskUserQuestion and authenticate coverage` |
| **Landed** | `cyclePermissionMode` ACP cycle; `AskUserQuestionPrompt.test.tsx`; `acp-auth.test.ts` heuristics. |
| **Deferred** | **TD-03** live `grok agent stdio` run until the live-verify pass in this session (Grok binary stays out of CI). |

### PR7 — Interactive Grok auth (`x.ai/auth/*`)  **(follow-up)**

| | |
|--|--|
| **Title** | `feat(acp): host Grok login via x.ai/auth get_url / submit_code` |
| **Goal** | Users who only have interactive grok.com / device-code methods can log in from SuperOne instead of a dead session. |
| **Files** | `acp-runtime.ts` authenticate path, new auth UI/modal, `acp-xai-extensions.ts`, tests |
| **Test plan** | Skip interactive when cached_token works; when only grok.com/oidc advertised, surface URL/code; cancel path |
| **Deps** | none; after PR0 so docs do not still say “auth skipped” without a tracker |
| **Out of scope** | Spoofing pager login screens; writing `auth.json` from SuperOne |

### PR8 — Session spawn `_meta`: pluginDirs / rules / systemPromptOverride / GROK_CONFIG  **(follow-up)**

| | |
|--|--|
| **Title** | `feat(acp): stamp Grok session _meta for rules, prompt override, and plugin dirs` |
| **Goal** | SuperOne personas and extra plugin roots use the wire Grok already implements, instead of only appending host-context on the first prompt. |
| **Files** | `acp-runtime.ts` `sessionRequestBase`, spawn env `GROK_CONFIG`, tests |
| **Test plan** | session/new `_meta` includes fields only when advertised (`x.ai/pluginDirs`); overlay JSON allowlist only; no secrets in overlay |
| **Deps** | none |
| **Out of scope** | Full plugins/marketplace UI; client hooks SDK |

### PR9 — Polish: Windows PATH, fork initialize caps, ask plan outcomes, tools_changed, subagent cap  **(follow-up)**

| | |
|--|--|
| **Title** | `fix(acp): Windows grok detect, fork initialize caps, and leftover Grok host polish` |
| **Goal** | Close remaining P2 host bugs that are small once PR1–PR5 land. |
| **Files** | `acp-detect.ts`, `acp-fork.ts`, `formatGrokAskUserResponse` + AskUserQuestion UI, `handleMcpExt` tools_changed, `harness-capabilities.ts` `supportsSubagents` |
| **Test plan** | PATH split uses `path.delimiter`; fork initialize matches runtime `_meta`; tools_changed refreshes popup counts; plan-mode ask outcomes optional |
| **Deps** | PR1 (Always) and PR3 (MCP) preferred |
| **Out of scope** | Marketplace; hunk tracker; memory dream; worktree UI |

---

## 6. Explicit non-goals (expanded)

1. **Grok TUI product surface** — themes, voice STT, dashboard, OSC clipboard wrap, mouse reporting, welcome/home, pager-only slash, vim/simple input, status-line scripts, Ctrl+B background chord.
2. **Agent process topology** — `grok agent leader`, `grok agent serve` WebSocket, outbound headless relay. Stdio per SuperOne session is enough; `session/close` is implied by killing the child.
3. **OS sandbox kernel** — Landlock/Seatbelt/bwrap, `sandbox.toml` deny[], child-network seccomp. SuperOne may *observe* the profile (`grok-sandbox.ts`) but must not reimplement it.
4. **Agent-side policy** — deny/allow/ask rules, PreToolUse hooks files, folder-trust store, dangerous-command floor, WebFetch SSRF. Host only answers `request_permission` and optional client hooks.
5. **Spoofing `clientType: grok-desktop` / `grok-pager`** — wrong option set and telemetry until SuperOne implements Desktop option UX (PM-15/PM-21). Stay Generic/`superone`.
6. **Re-enable `clientCapabilities.terminal=true` or fs for grok-build** — local PTY/FS; ACP text FS would corrupt images.
7. **Reimplement Grok tools in SuperOne** — map `_meta["x.ai/tool"]` only.
8. **Writing project `.grok/config.toml` allowlists for SuperOne builtins** — client preapprove remains source of truth.
9. **Full x.ai surface** — hunk tracker, marketplace UI, memory dream, worktree create UI, fuzzy search, billing auto-topup, cloud envs, recap-as-TUI, prompt queue pane, code-nav, fs_notify.
10. **Changing the Grok agent source tree** — integration is host-side only.
11. **Grok binary in CI** — mock-agent vitest; live CLI is TD-03.

---

## 7. Open questions

1. **Auto under Generic (Q5 from permissions doc).** Ship toast + keep Auto (PR5-A), hide Auto, or spoof pager/desktop (PR5-B)? Default recommendation: **A**.
2. **Always vs YOLO.** PR1 Always is a *per-tool/server grant*. Status-bar Always Approve is yolo. Confirm copy so users do not confuse them.
3. **`executePlan`.** After approve, does product want SuperOne to send the next prompt with `_meta.executePlan`, or is Grok’s approved outcome enough?
4. **Node ask/plan UI.** PR4 cancel-if-no-UI vs a minimal CLI prompt. Headless should cancel; interactive CLI may want a tty form.
5. **OAuth.** Is `x.ai/mcp/auth_trigger` in scope for PR3, or hide LogIn for Grok until a dedicated auth PR?
6. **Subagent chrome.** Notifications already map; should `supportsSubagents` flip true and reuse Claude Task UI, or keep transcript-only?
7. **Identity.** Any future need for `permission_<client>.toml` isolation beyond `clientIdentifier=superone`?
8. **Who runs TD-03** (live grok CLI) and where are notes stored (this doc §4.7 vs `agent-self-verify.md`)?

---

## 8. Success criteria (this plan)

Desktop Ask-mode Grok session:

- [ ] Built-in SuperOne MCP: zero permission cards.
- [ ] Third-party MCP and bash still prompt; Always (PR1) persists the grant Grok offered.
- [ ] Model + effort switch via `session/set_model`.
- [ ] Plan enter (host or agent) updates chrome; approve/reject + line comments; Always/Auto baseline not wiped.
- [ ] User MCP attached on session/new; reload keeps HTTP SuperOne.
- [ ] Resume, recap, compact, rewind, fork work in one recorded grok CLI run (TD-03).
- [ ] Node/CLI does not hang on ask/exit_plan.
- [ ] Docs (permissions, ext-notifications, this file) no longer contradict tests.
