# Design: SuperOne × Grok Build Feature Parity

| Field | Value |
|-------|--------|
| Status | Draft |
| Date | 2026-07-25 |
| Scope | SuperOne as ACP host client for Grok Build (`grok agent stdio`) |
| SuperOne path | `/Users/wuhangqi25/Developer/Projects/super-one` |
| Grok Build source | `/Users/wuhangqi25/Developer/Projects/grok-build` (HEAD `6e38642`, SOURCE_REV `9b8d35b…`) |
| Related design | [`docs/design/grok-acp-permissions.md`](./grok-acp-permissions.md) |
| Out of scope (summary) | Grok TUI-only UX, sandbox kernel profiles, agent-side deny/hook policy, full x.ai extension surface |

---

## 0. Relationship to existing designs

### `grok-acp-permissions.md` — partially superseded

That doc defined **permission correctness** (built-in MCP preapprove + yolo/auto mid-session). **Code has shipped the core of its PR1–PR3** (permissions) **and plan-approval is also live (working tree as of 2026-07-25)**:

| Design claim (still in permissions doc §1) | Live code (2026-07-25) |
|-----------------------------|------------------------|
| `AcpBackend.setPermissionMode` is a no-op | **Implemented** → `runtime.setPermissionMode` → `x.ai/yolo_mode_changed` |
| Host always UI-prompts ACP permissions | **Preapprove short-circuit** for built-ins + mini-app preapprovals |
| Phase 1 modes `{default, auto, bypassPermissions}` | **`ACP_PERMISSION_MODES` + AcpPermissionSelector** |
| `exit_plan_mode` out of scope | **Shipped** — reverse request + PlanApproval UI + line review + Grok wire outcomes (see §3.3 / §4.0) |

**Keep** `grok-acp-permissions.md` as the permission-subsystem design (wire mapping, security rules, non-goals for acceptEdits/dontAsk). **Do not re-implement** its G1–G3 goals here. Update that doc’s §1 status narrative in a docs PR (see PR0).

This document is the **broader parity plan**: models, remaining plan-mode host enter, MCP attach, session lifecycle, capability flags, and permission polish.

### Plan mode audit (2026-07-25)

Reviewed uncommitted + main ACP plan surface against Grok wire. **Verdict: agent-driven plan mode is implemented; host-driven enter is not required for “plan mode works”.**

| Layer | Status | Evidence |
|-------|--------|----------|
| Advertise `exitPlanMode` on initialize `_meta` | **done** | `acp-runtime.ts` |
| Reverse `x.ai/exit_plan_mode` (+ `_x.ai/…`) | **done** | `acp-runtime.ts` handlers |
| Wire parse / response `outcome` approved\|cancelled\|abandoned | **done** | `acp-xai-extensions.ts` + tests |
| Backend park → `plan_approval` event → `respondToPlanApproval` | **done** | `acp-backend.ts` + tests |
| Tool-call banners enter/exit plan | **done** | `acp-event-map.ts` name map |
| `session/update` plan → todo stream | **done** | `mapPlanToTodoEvents` |
| PlanApproval UI (markdown, approve/reject) | **done** | `PlanApprovalPrompt.tsx` |
| Line-range review comments (Grok `format_feedback` shape) | **done** | `PlanLineReview.tsx`, `plan-feedback.ts` |
| Reject feedback on Grok wire | **done** | cancel + `feedback` string |
| Approve-with-comments for ACP (follow-up user turn) | **done** | no wire feedback on approve; `sendMessage` review wrap |
| Hide Claude-only post-approve acceptEdits/auto toggle on ACP | **done** | `showPostApprovalModeToggle = sessionProvider === 'claude'` |
| Host chrome “enter plan” (`session/set_mode` plan / prompt `_meta.mode`) | **missing** | optional P2 — agent enters via tools; SuperOne does not need toggle for approval path |
| `HARNESS_CAPABILITIES.acp.supportsPlanMode` | **still false** | flags lag; fix in remaining PR (caps only) |

---

## 1. Scope and non-goals

### In scope

- SuperOne desktop as ACP **client** / host (stdio child: `grok agent stdio`).
- Core ACP methods SuperOne must implement correctly for Grok.
- High-value x.ai reverse requests already partially wired (`ask_user_question`, `exit_plan_mode`, `yolo_mode_changed`).
- Host UX parity with Claude/Codex for: permissions, model/effort pickers, MCP attach, slash commands, tool visibility.
- Plan approval is **in scope as shipped** (document, do not re-build). Host enter-plan is optional backlog only.
- Test + design-doc hygiene for shipped work.

### Explicit non-goals

| Area | Why defer |
|------|-----------|
| Grok TUI theming, voice, vim, minimal screen, command palette chords | Pager-only; SuperOne owns its own chrome |
| Leader/follower IPC, `grok agent serve` WS, outbound relay | Optional topology; stdio is primary |
| OS sandbox profiles (Landlock/Seatbelt), custom sandbox.toml | Agent-process concern; SuperOne does not reimplement |
| Agent-side deny/allow rules, PreToolUse hooks file engine | Agent-owned; host only registers client hooks if product asks |
| Full x.ai surface (hunk tracker, marketplace, billing, memory dream, worktree UI, queue pane, recap, fuzzy search) | P2/P3 product expansions after host correctness |
| Spoofing `clientType: grok-desktop` without Desktop option UX | Wrong permission option set / telemetry |
| Re-enabling `clientCapabilities.terminal=true` for Grok | Explicit product non-goal in permissions design; agent local PTY is fine |
| Changing Grok agent source tree | Integration is host-side only |

---

## 2. Architecture snapshot (verified)

```text
SuperOne renderer (chat, AcpPermissionSelector, PlanApprovalPrompt, AcpModelSelector)
        │ IPC
        ▼
Session → AcpBackend
        │
        ▼
createAcpRuntime  ──spawn──►  `grok agent stdio` (JSON-RPC ACP)
        │
        ├── session/new  (+ superone MCP stdio, yoloMode/autoMode _meta)
        ├── session/prompt | cancel | set_config_option
        ├── notify x.ai/yolo_mode_changed
        ├── reverse: request_permission, fs/*, terminal/* (off for grok-build)
        └── reverse: x.ai/ask_user_question, x.ai/exit_plan_mode
              └── PlanApprovalPrompt (line review → Grok outcome / follow-up turn)
```

**Key SuperOne files**

| Area | Path |
|------|------|
| Runtime | `apps/desktop/src/main/acp/acp-runtime.ts` |
| Config / models | `apps/desktop/src/main/acp/acp-config.ts` |
| Permission preapprove | `apps/desktop/src/main/acp/acp-permission-preapprove.ts` |
| x.ai extensions | `apps/desktop/src/main/acp/acp-xai-extensions.ts` |
| Event map | `apps/desktop/src/main/acp/acp-event-map.ts` |
| Backend | `apps/desktop/src/main/session/backends/acp-backend.ts` |
| SuperOne MCP | `apps/desktop/src/main/acp/acp-mcp.ts`, `apps/desktop/src/main/mcp/*` |
| Capability flags | `packages/shared/src/harness/harness-capabilities.ts` |
| Permission UI | `apps/desktop/src/renderer/src/components/chat/AcpPermissionSelector.tsx` |

**Grok wire facts (from grok-build)**

- Primary transport: `grok agent stdio`.
- Models often arrive via `_meta.modelState` / `x.ai/sessionConfig` with **no** standard `configOptions` model id → SuperOne sets `configId: null`.
- Model switch on Grok: **`session/set_model`** (+ optional `_meta.reasoningEffort`), not only `session/set_config_option`.
- SessionConfig `category=mode` options are **reasoning effort** (`minimal|low|medium|high|xhigh`), not plan/permission modes.
- Permission mid-session: `x.ai/yolo_mode_changed` (`ask|auto|always-approve`).
- Plan mode: `session/set_mode` id `plan|default|ask` + reverse `x.ai/exit_plan_mode`.
- MCP tool id: `server__tool`; SuperOne UI: `mcp__server__tool`.

---

## 3. Capability matrix

Status values: `done` | `partial` | `missing` | `na` (not applicable / deferred by policy).

Priority: **P0** broken host correctness · **P1** Claude/Codex host UX parity · **P2** valuable ACP extension · **P3** TUI-only / defer.

### 3.1 ACP runtime & process

| id | name | surface | SuperOne status | evidence | gap | priority |
|----|------|---------|-----------------|----------|-----|----------|
| RT-01 | Spawn `grok agent stdio` + ndjson stream | runtime | done | `acp-process.ts`, `agent-catalog.ts` (`grok-build`) | — | — |
| RT-02 | Safe spawn env / Windows shell | runtime | done | `acp-process.ts`, `spawn-env.ts` | — | — |
| RT-03 | Detect installed grok CLI | runtime | done | `acp-detect.ts`, `~/.grok/bin` PATH | — | — |
| RT-04 | initialize PROTOCOL_VERSION + fs caps | acp-host | partial | `acp-runtime.ts` | `clientInfo.version` hardcoded `0.0.0`; no `_meta.clientType` | P2 |
| RT-05 | Grok: `terminal: false` on initialize | acp-host | done | `launch.agentId !== 'grok-build'` | intentional non-goal to re-enable | na |
| RT-06 | Advertise askUserQuestion + exitPlanMode | acp-host | done | initialize `_meta` | — | — |
| RT-07 | Non-interactive authenticate | acp-host | partial | cached_token / api_key heuristics | Interactive auth skipped; weak tests | P2 |
| RT-08 | session/new + SuperOne MCP attach | acp-host | done | `acp-mcp.ts`, runtime tests | Only `superone`; no user MCPs | P1 |
| RT-09 | session/new yoloMode/autoMode | acp-host | done | `grokSessionPermissionMeta` | autoMode create path lightly integration-tested | P3 |
| RT-10 | session/load resume | acp-host | missing | `loadSession` parsed, never called | Always session/new; provider resume impossible | P1 |
| RT-11 | session/prompt + cancel + update pump | acp-host | done | `acp-runtime.ts` | Multi-message turn thin tests | P3 |
| RT-12 | session/set_config_option model/mode | acp-host | partial | `setConfigOption` | Grok often has `configId: null` → setModel no-ops | **P0** |
| RT-13 | session/set_model + reasoningEffort | acp-host | missing | no `methods.agent.session.set_model` usage | Required for Grok model/effort when no configOptions | **P0** |
| RT-14 | Mid-session yolo_mode_changed | acp-host | done | `setPermissionMode` | — | — |
| RT-15 | FS reverse read/write | acp-host | done | `acp-fs.ts` | — | — |
| RT-16 | Terminal reverse create/output/… | acp-host | partial | `acp-terminals.ts` implemented; not advertised for Grok | OK by policy | na |
| RT-17 | Process exit diagnostics | runtime | done | `formatProcessExit` | — | — |
| RT-18 | AcpBackend lifecycle / epoch | runtime | done | `acp-backend.ts` | — | — |

### 3.2 Permissions & mode UI

| id | name | surface | SuperOne status | evidence | gap | priority |
|----|------|---------|-----------------|----------|-----|----------|
| PM-01 | request_permission → UI map | acp-host | done | `acp-permission-map.ts` | — | — |
| PM-02 | Built-in SuperOne MCP preapprove | acp-host | done | `shouldAutoAllowAcpPermission` | respond allow_once only | P2 |
| PM-03 | Mini-app preapprove only | acp-host | done | `isToolPreapproved` | — | — |
| PM-04 | Never auto-allow 3rd-party MCP / bash | acp-host | done | preapprove tests | — | — |
| PM-05 | AcpPermissionSelector ask/auto/always | session-ui | done | `acpPermissionModes.ts` | — | — |
| PM-06 | enable-always-approve option id | acp-host | missing | Generic client; no special option handling | Desktop-style option ignored if agent ever sends it | P2 |
| PM-07 | acceptEdits / dontAsk mid-session | acp-host | missing | yolo notify only ask/auto/always-approve | By wire design; phase-2 rebuild only | P3 |
| PM-08 | allow-always-mcp server grant for builtins | acp-host | missing | always `allow_once` | Extra reverse-RPC noise | P2 |
| PM-09 | Hide /always-approve slash | session-ui | done | `acp-slash-filter.ts` | — | — |
| PM-10 | Plan ≠ permissionMode | session-ui | done | separate selectors; plan approval ≠ yolo | Host enter-plan still optional | P2 |
| PM-11 | Design doc accuracy | tests-docs | partial | `grok-acp-permissions.md` Draft | §1 still describes no-op setPermissionMode | P1 |

### 3.3 x.ai interactive extensions

| id | name | surface | SuperOne status | evidence | gap | priority |
|----|------|---------|-----------------|----------|-----|----------|
| XAI-01 | ask_user_question reverse + UI | acp-host | done | `acp-xai-extensions.ts`, AskUserQuestionPrompt | — | — |
| XAI-02 | exit_plan_mode reverse + UI + line review | acp-host | **done** | runtime gate, backend park, PlanApprovalPrompt, PlanLineReview, plan-feedback | planFilePath always `''` (agent rarely sends path) | P3 |
| XAI-03 | Host-driven enter plan (`set_mode` / prompt meta) | acp-host | missing | agent enter via tools only | Optional UX parity with Claude plan toggle | **P2** (demoted) |
| XAI-04 | yolo_mode_changed notify | acp-host | done | runtime + tests | — | — |
| XAI-05 | PlanApproval post-approve mode toggle | session-ui | **done** | Claude-only `showPostApprovalModeToggle`; ACP never offers acceptEdits | On ACP approve, store still forces `permissionMode: 'default'` via `respondToPlanApprovalImpl` — usually fine | P3 residual |
| XAI-06 | _x.ai/* alias registration | acp-host | done | dual onRequest | Underscore path untested e2e | P3 |
| XAI-07 | Approve-with-comments follow-up turn (ACP) | session-ui | **done** | `formatApprovedPlanReviewMessage` + `sendMessage` | Wire cannot carry approve feedback | — |

### 3.4 MCP host attach & tools

| id | name | surface | SuperOne status | evidence | gap | priority |
|----|------|---------|-----------------|----------|-----|----------|
| MCP-01 | Attach superone stdio MCP | mcp-host | done | `buildSuperoneAcpMcpServer` | — | — |
| MCP-02 | Bridge + builtins + browser tools | mcp-host | done | stdio bridge, tool surface | — | — |
| MCP-03 | use_tool → mcp__ unwrap for UI/preapprove | mcp-host | done | `acp-event-map.ts` | — | — |
| MCP-04 | User-configured MCP → session/new | mcp-host | missing | only superone or [] | Claude has user MCP; ACP does not | P1 |
| MCP-05 | Honor agent mcpCapabilities http/sse | mcp-host | missing | parsed, unused | Cannot attach HTTP/SSE servers to Grok session | P1 |
| MCP-06 | mobile_share_file on ACP stdio surface | mcp-host | missing | in-process Claude only | Preapprove list includes it; agent cannot call | P2 |
| MCP-07 | supportsMcp capability flag for acp | session-ui | missing | `HARNESS_CAPABILITIES.acp.supportsMcp: false` | UI may hide MCP-related chrome despite attach | P1 |
| MCP-08 | SDK MCP (x.ai/mcp/sdk_call) | acp-host | missing | — | Alternative to stdio superone; defer | P3 |
| MCP-09 | MCP status notifications UI | acp-host | missing | — | Agent-side catalog UI | P2 |

### 3.5 Session model, plan, composer

| id | name | surface | SuperOne status | evidence | gap | priority |
|----|------|---------|-----------------|----------|-----|----------|
| SU-01 | Model catalog from modelState / sessionConfig | session-ui | done | `coalesceModelConfig` | Switch broken without configId | **P0** |
| SU-02 | Reasoning effort picker (Grok category=mode) | session-ui | partial | AcpModeSelector may show effort as “mode” if configOptions present | No set_model + reasoningEffort path for pure x.ai meta | **P0** |
| SU-03 | available_commands → slash palette | session-ui | done | acp_commands events | — | — |
| SU-04 | Host-driven plan enter (set_mode plan) | session-ui | missing | no ACP plan shortcut / set_mode plan | Optional; agent-driven path is product-complete | **P2** |
| SU-05 | supportsPlanMode flag | session-ui | partial | still `false` while exit_plan fully wired | Flip to `true` — approval path is enough | **P1** (flags only) |
| SU-06 | Plan sessionUpdate → todos | session-ui | partial | `mapPlanToTodoEvents` | supportsTodos false may hide panel | P1 |
| SU-07 | Context usage bar | session-ui | missing | `getContextUsage` always null | No token meter for Grok | P2 |
| SU-08 | provider_session_id | session-ui | done | backend emit | — | — |
| SU-09 | Rewind / compact / fork | acp-host | missing | stubs return unsupported | Grok has x.ai/rewind/* etc. | P2 |
| SU-10 | Prompt _meta.mode agent\|ask\|plan | acp-host | missing | prompts have no mode meta | Only needed with host enter-plan | P2 (with SU-04) |

### 3.6 Tests & docs

| id | name | surface | SuperOne status | evidence | gap | priority |
|----|------|---------|-----------------|----------|-----|----------|
| TD-01 | Unit: preapprove + yolo notify | tests-docs | done | `acp-permission-preapprove.test.ts`, runtime tests | — | — |
| TD-02 | Unit: exit_plan / ask_user wire + PlanApproval UI | tests-docs | done | `acp-xai-extensions.test.ts`, backend tests, `PlanApprovalPrompt.test.tsx`, `plan-feedback.test.ts` | Manual Grok CLI still open | — |
| TD-03 | Manual Grok CLI acceptance checklist | tests-docs | missing | design §6 unchecked | No recorded run | P1 |
| TD-04 | Permissions design success criteria | tests-docs | partial | G1–G5 boxes unchecked | Mark done after reconcile | P1 |
| TD-05 | Parity design (this doc) | tests-docs | done | `docs/design/grok-build-parity.md` | Living document | — |

---

## 4. Gap deep-dives (P0 / P1)

### 4.1 P0 — Grok model / effort switch dead path

**Problem.**  
Grok often exposes models via initialize `_meta.modelState` and/or `session/new` `_meta["x.ai/sessionConfig"]` with `category: "model"`. SuperOne correctly **displays** these (`configId: null`), but `AcpBackend.setModel` returns early when `!this.modelConfigId`. Users pick a model and nothing changes on the agent.

Reasoning effort options (same sessionConfig, `category: "mode"`) need `session/set_model` + `_meta.reasoningEffort` on Grok — not SuperOne permission mode and not always standard `set_config_option`.

**Grok wire facts.**

- `session/set_model` with `modelId`; optional `_meta.reasoningEffort` (`minimal|low|medium|high|xhigh`).
- Rejects non-allowlisted models.
- Restored on `session/load` with persisted effort.
- Host should **not** invent options; render agent-advertised list.

**SuperOne touch files.**

- `apps/desktop/src/main/acp/acp-runtime.ts` — add `setModel(modelId, opts?)` using agent request for set_model when configId path unavailable.
- `apps/desktop/src/main/acp/acp-config.ts` — surface effort options from x.ai/sessionConfig category=mode; distinguish effort vs plan modes.
- `apps/desktop/src/main/session/backends/acp-backend.ts` — branch setModel; wire effort if UI needs it.
- Renderer: `AcpModelSelector` / status bar effort control if separate from AcpModeSelector.
- Tests: `acp-runtime.test.ts`, `acp-backend.test.ts`, `acp-config.test.ts`.

**Proposed approach.**

1. Detect Grok-style catalog (`configId == null` + models present).
2. Call ACP `session/set_model` (SDK method name per installed `@agentclientprotocol/sdk`; fall back to raw request if needed).
3. Parse effort options from sessionConfig; on select, `set_model` same modelId with `_meta.reasoningEffort`.
4. Keep standard `set_config_option` path for OpenCode/other agents that advertise configOptions.
5. On success, emit updated `acp_models` / effort selection events.

---

### 4.2 P1 — Harness capability flags lag real ACP features

**Problem.**  
`HARNESS_CAPABILITIES.acp` sets `supportsPlanMode: false`, `supportsTodos: false`, `supportsMcp: false` while SuperOne already:

- handles full `x.ai/exit_plan_mode` + PlanApprovalPrompt (line review, Grok outcomes),
- maps ACP `plan` updates to todo events,
- attaches SuperOne MCP on every ACP session with tools.

UI gates that trust these flags under-report Grok/ACP capabilities and may hide plan/todo/MCP chrome.

**Grok wire facts.**

- Plan mode + exit_plan_mode reverse request are first-class.
- `session/update` plan entries and todo_write tool stream exist.
- MCP attach via session/new mcpServers is core agent mode.

**SuperOne touch files.**

- `packages/shared/src/harness/harness-capabilities.ts`
- Call sites that branch on `supportsPlanMode` / `supportsTodos` / `supportsMcp` (renderer chat chrome, placeholders).
- Tests for capability consumers.

**Proposed approach.**

1. Set `supportsMcp: true` for acp (host injects MCP).
2. Set `supportsPlanMode: true` **now** — bar is agent-driven plan + exit approval (shipped); do **not** wait for host enter-plan.
3. Set `supportsTodos: true` if plan/todo_write mapping is considered enough for the TODO panel.
4. Prefer capability flags over `provider === 'acp'` string checks at remaining call sites.
5. Audit call sites: flipping `supportsPlanMode` must not surface a Claude-style “enter plan” control that is still a no-op for ACP (gate enter UI on a finer flag or provider if needed).

---

### 4.0 ✅ Shipped — Plan approval path (was P1 gaps XAI-02 / XAI-05 / part of old PR2–PR3)

**No longer a parity blocker.** Working tree implements:

1. **Runtime** — `exitPlanMode` gate; initialize `_meta.exitPlanMode: true`; dual method ids.
2. **Backend** — park single pending plan approval; approve → `{ outcome: "approved" }`; reject → `{ outcome: "cancelled", feedback? }`; abandon on cancel/teardown.
3. **UI** — shared PlanApprovalPrompt; line multi-select comments; freeform; Grok-shaped feedback serialization (`plan-feedback.ts` mirrors TUI `format_feedback`).
4. **ACP vs Claude semantics**
   - Reject: feedback on wire (both).
   - Approve + comments: ACP sends follow-up user message (`formatApprovedPlanReviewMessage`); Claude ignores freeform on approve.
   - Post-approve “switch to auto/acceptEdits” toggle: **Claude only** — removes the old acceptEdits-on-Grok footgun.

**Residual (P3, not a PR slice):**

- `planFilePath` always `''` in `buildPlanApprovalRequest` (Grok rarely sends a path; optional file link later).
- `respondToPlanApprovalImpl` on approve always sets SuperOne `permissionMode` to `postApprovalMode ?? 'default'`. For ACP that means yolo notify → ask baseline even if the user had previously selected auto/always-approve. Prefer: for `sessionProvider === 'acp'`, skip mode change unless user opted in (when host enter-plan exists).

---

### 4.3 P2 — Host-driven plan mode enter (optional)

**Problem.**  
Claude/Codex users can enter plan mode from SuperOne chrome. For Grok, SuperOne only **reacts** to agent-initiated enter tools + `exit_plan_mode`. There is no host action that calls `session/set_mode` with `plan` or sends prompt `_meta.mode=plan`.

**Why demoted from P1.**  
Product path “agent plans → user approves/rejects with line comments” is complete without host enter. Host enter is Claude/Codex **chrome parity**, not correctness.

**Grok wire facts.**

- Wire mode ids: `default | plan | ask`.
- Prompt `_meta.mode=agent|ask|plan` reconciles plan tracker without set_mode.
- Reverse `x.ai/exit_plan_mode` for approval UI (**done**).
- Plan-mode edits restricted to plan.md regardless of YOLO.

**If we build it later.**

1. If agent advertises session modes including `plan`, host toggle → set mode plan (not via permission yolo).
2. Attach `_meta.mode` on prompts when SuperOne tracks plan/ask/agent.
3. Do **not** map plan to `permissionMode` or yolo notification.
4. Keyboard shortcut `togglePlanModeShortcut` currently cycles **permission** modes for non-Codex — must not confuse plan with yolo for ACP.

---

### 4.4 P1 — User MCP servers not attached to ACP sessions

**Problem.**  
Claude sessions load user/project MCP configs. ACP runtime only attaches the built-in `superone` server (or none). Grok’s `search_tool` / `use_tool` never see the user’s GitHub/Linear/etc. servers unless configured inside Grok’s own `~/.grok/config.toml`.

**Grok wire facts.**

- session/new|load accept `mcpServers` list (stdio/HTTP/SSE per agent mcpCapabilities).
- Grok advertises `mcpCapabilities.http/sse` (and ACP SDK MCP optionally).
- Tools remain behind search_tool/use_tool for cache stability.

**SuperOne touch files.**

- `acp-runtime.ts` — build mcpServers array beyond superone.
- `mcp-config-service.ts` (or shared mapper) → ACP McpServer shapes.
- `acp-backend.ts` — pass cwd-scoped config; mid-session reload if product needs `x.ai/session/update_mcp_servers`.
- Tests for multi-server session/new.

**Proposed approach.**

1. Map SuperOne user MCP entries to ACP stdio/HTTP/SSE descriptors when agent capabilities allow.
2. Keep `superone` first; never auto-allow third-party permissions (existing preapprove rules).
3. Phase 1: attach on session/new only; phase 2: hot-update extension.

---

### 4.5 P1 — session/load resume

**Problem.**  
SuperOne always `session/new`. Grok advertises `loadSession: true` and persists under `~/.grok/sessions/…`. Host cannot resume a Grok provider session after restart/reconnect; only SuperOne’s own transcript DB remains.

**Grok wire facts.**

- session/load streams session/update (replay) before response.
- Meta: yolo/auto, cursor, restore_code, client fs/terminal overrides for multi-client.
- Host must tolerate pre-response updates (runtime pump already exists).

**SuperOne touch files.**

- `acp-runtime.ts` — load path when `provider_session_id` + loadSession capability.
- Session persistence: store agent session id (already emitted as provider_session_id).
- Replay policy: dedupe vs SuperOne DB messages (`isReplay` / eventId if present).

**Proposed approach.**

1. On session reopen with saved provider session id + same cwd, try session/load; fall back to new on failure.
2. During load, route updates carefully (mark replay / suppress duplicate user bubbles).
3. Keep SuperOne DB as source of truth for UI history if load replay is messy — still restore agent memory/grants.

---

### 4.6 P1 — Design/docs + manual acceptance lag

**Problem.**  
Permissions design still describes a broken world; success criteria unchecked; no recorded manual Grok checklist. Agents and humans over-trust the Draft narrative. Plan-approval is also easy to under-document (permissions doc still lists exit_plan as out of scope).

**Touch files.**

- `docs/design/grok-acp-permissions.md` — status → Implemented (phase 1); strike no-op claims; note exit_plan shipped separately (this parity doc §4.0).
- Manual checklist results (prefer updating success criteria boxes only).

---

## 5. PR plan

Ordered slices. Each is one logical change (Agents.md commit style). Titles are suggested commit subjects.

**Renumber after plan-mode audit (2026-07-25):** old “PR2 plan-approval modes” and “PR3 host enter-plan” are **not** blockers. Plan approval is shipped; host enter is Future/P2.

### PR0 — Docs: reconcile permissions + plan-approval with shipped code

| | |
|--|--|
| **Title** | `docs(acp): mark Grok permission phase-1 and plan approval as shipped` |
| **Goal** | Stop false “setPermissionMode no-op / always UI prompt / exit_plan out of scope” narrative; link to this parity doc for remaining work. |
| **Files** | `docs/design/grok-acp-permissions.md`, this file (status notes) |
| **Test plan** | Doc review only |
| **Deps** | none |
| **Out of scope** | Code changes |

### PR1 — Grok model + reasoning effort via session/set_model

| | |
|--|--|
| **Title** | `fix(acp): switch Grok models via session/set_model when configId missing` |
| **Goal** | Model picker actually changes the agent model; effort options apply via reasoningEffort meta. |
| **Files** | `acp-runtime.ts`, `acp-config.ts`, `acp-backend.ts`, model/effort UI if needed, tests |
| **Test plan** | Unit: extract effort options; mock agent receives set_model; backend setModel with configId null; no regression for configOption agents |
| **Deps** | none (can land parallel to PR0) |
| **Out of scope** | session/load; user MCP |

### PR2 — Harness capability flags (plan/todo/mcp) without fake enter-plan chrome

| | |
|--|--|
| **Title** | `fix(acp): set harness caps for plan/todo/mcp SuperOne already supports` |
| **Goal** | UI shows plan approval / todo / MCP affordances already implemented; flipping flags must not expose a no-op host “enter plan” for ACP. |
| **Files** | `harness-capabilities.ts`, capability call sites, tests |
| **Test plan** | Flag consumers; plan approval still works; no new ACP enter-plan button unless wired |
| **Deps** | ideally after PR0; independent of PR1 |
| **Out of scope** | Host enter-plan; permission mode changes |

### PR3 — Attach user MCP servers to ACP session/new

| | |
|--|--|
| **Title** | `feat(acp): pass user MCP servers into Grok session/new` |
| **Goal** | User’s configured MCP tools available to Grok via search_tool/use_tool with existing permission UI. |
| **Files** | `acp-runtime.ts`, MCP config mapper, `acp-backend.ts`, tests |
| **Test plan** | session/new mcpServers includes superone + user stdio/http; disabled servers omitted; preapprove still blocks third-party auto-allow |
| **Deps** | none strictly; after PR1 preferred so model path stable |
| **Out of scope** | MCP settings UI over x.ai/mcp/*; OAuth host chrome; SDK MCP |

### PR4 — session/load resume when loadSession advertised

| | |
|--|--|
| **Title** | `feat(acp): resume Grok sessions via session/load` |
| **Goal** | Restore agent-side session state using stored provider_session_id. |
| **Files** | `acp-runtime.ts`, `acp-backend.ts`, session start opts, tests with replay pump |
| **Test plan** | load with updates before response; fallback new on error; cwd mismatch handling |
| **Deps** | PR1 recommended (model restored on load); careful with PR3 MCP list on load |
| **Out of scope** | Multi-device import/export; worktree resume |

### PR5 — Permission polish (allow-always-mcp, client version, mobile_share)

| | |
|--|--|
| **Title** | `fix(acp): reduce builtin MCP permission round-trips and fix stdio tool parity` |
| **Goal** | Prefer allow-always-mcp for superone server when offered; honest clientInfo.version; mobile_share on stdio surface. |
| **Files** | `acp-permission-map.ts` / backend preapprove response, `acp-runtime.ts` clientInfo, `superone-mcp-tool-surface` / bridge, tests |
| **Test plan** | Preapprove selects allow-always-mcp when present; version from package/app; mobile_share list+execute |
| **Deps** | none |
| **Out of scope** | enable-always-approve clientType spoof; acceptEdits phase-2 |

### PR6 — Manual acceptance + optional context usage

| | |
|--|--|
| **Title** | `test(acp): Grok manual checklist and optional usage surface` |
| **Goal** | Document verified G1–G5 + model switch + plan approval + MCP; optionally map usage if agent emits usable events. |
| **Files** | design success criteria checkboxes; optional `getContextUsage` |
| **Test plan** | Manual run on macOS with installed grok CLI (include exit_plan approve/reject + line comments) |
| **Deps** | PR1–PR3 ideally |
| **Out of scope** | Full e2e automation of Grok binary in CI |

### Future (not scheduled as numbered PRs here)

| Slice | Priority | Notes |
|-------|----------|-------|
| Host-driven plan enter (`set_mode` + prompt `_meta.mode`) | P2 | Chrome parity only; see §4.3 |
| Skip ACP post-approve forced `permissionMode: default` | P3 | Residual in `respondToPlanApprovalImpl` |
| planFilePath / open plan file from approval UI | P3 | When agent sends path |
| Rewind / compact / fork UI over x.ai extensions | P2 | After resume |
| Client hooks registration (`x.ai/hooks`) | P2 | Product decision |
| Prompt queue / interject | P2 | Composer mid-turn |
| Hunk tracker | P3 | Diff review |
| Marketplace / plugins host UI | P3 | Agent CLI covers many ops |
| acceptEdits/dontAsk via rebuild | P3 | Verify CLI flags first |
| Terminal capability re-enable for Grok | na | Explicit non-goal |

---

## 6. Explicit non-goals (expanded)

1. **Grok TUI product surface** — themes, voice STT, dashboard, OSC clipboard wrap, mouse reporting, welcome home, pager-only slash commands.
2. **Agent process topology** — leader socket, WebSocket serve, outbound headless relay.
3. **Sandbox / folder-trust implementation inside SuperOne** — agent enforces; SuperOne may only surface folder_trust reverse request later (P2).
4. **Spoofing Desktop clientType** — stay Generic/`superone` until option UX matches.
5. **Reimplement Grok tools in SuperOne** — tools run in agent; host maps events and permissions only.
6. **Writing project `.grok/config.toml` allow rules for SuperOne builtins** — client preapprove remains source of truth.
7. **Full multi-client leader mode** — single SuperOne client per process is enough.

---

## 7. Open questions

| # | Question | Default if unanswered |
|---|----------|------------------------|
| Q1 | Exact `@agentclientprotocol/sdk` API for `session/set_model` (typed method vs raw request)? | Probe SDK in PR1; use raw request with correct method name if missing |
| Q2 | Does SuperOne AcpModeSelector today already show Grok **effort** options when only x.ai/sessionConfig is present (no standard configOptions)? | If no, PR1 must add effort extraction + UI |
| Q3 | Should session/load replace SuperOne transcript or only rehydrate agent memory while keeping SuperOne DB history? | Keep SuperOne history; apply agent grants/model from load; suppress duplicate replay bubbles |
| Q4 | Attach **all** user MCP servers or only enabled + non-conflicting with Grok-native config? | Enabled SuperOne-managed only; document double-config risk with ~/.grok |
| Q5 | Host enter-plan: still worth building given agent-driven path is complete? | Defer to P2 backlog; default **no** unless users request Claude-like toggle |
| Q6 | Is Grok auto mode feature-gated so UI should toast on silent failure? | Log + stay on selected mode; toast if product wants |
| Q7 | CI without grok binary: keep mock-agent tests only? | Yes; manual checklist on developer machines |
| Q8 | On ACP plan **approve**, should SuperOne preserve prior auto/always-approve instead of forcing `default`? | Yes — skip `setPermissionMode` when `postApprovalMode` is undefined and provider is acp |

---

## 8. Success criteria (parity phase)

Phase A (PR0–PR2) — **correctness**

- [x] Agent-driven plan mode: exit_plan reverse + PlanApproval UI + line comments + Grok outcomes (working tree).
- [x] Plan approval never offers acceptEdits toggle on ACP/Grok sessions.
- [ ] Grok model selection changes the running agent model (verified with mock + manual).
- [ ] Reasoning effort can be set when Grok advertises effort options.
- [ ] Permissions design doc matches shipped preapprove + yolo + plan-approval behavior.
- [ ] Capability flags no longer hide MCP/plan/todo that we already support (as decided in PR2).

Phase B (PR3–PR4) — **host UX parity**

- [ ] User MCP tools reachable in Grok turns (with permission prompts).
- [ ] Optional: session/load restores agent session for same cwd + provider id.
- [ ] ~~User can enter plan from SuperOne chrome~~ → **deferred** (Future / §4.3).

Phase C (PR5–PR6) — **polish**

- [ ] Built-in MCP reverse-requests reduced via allow-always-mcp when offered.
- [ ] Honest client version string.
- [ ] Manual Grok acceptance checklist signed off (include plan approve/reject + line comments).

---

## 9. References

### SuperOne (host)

- `apps/desktop/src/main/acp/*`
- `apps/desktop/src/main/session/backends/acp-backend.ts`
- `packages/shared/src/harness/harness-capabilities.ts`
- `docs/design/grok-acp-permissions.md`

### Grok Build (agent wire)

- `crates/codegen/xai-acp-lib` — gateway/message enums
- `crates/codegen/xai-grok-shell/src/agent/mvp_agent/acp_agent.rs` — Agent impl
- `crates/codegen/xai-grok-shell/src/agent/session_config.rs` — sessionConfig options
- `crates/codegen/xai-grok-workspace/src/permission/*` — permission pipeline / prompter
- User guide (when installed): agent mode, permissions, plan mode, sessions, MCP

### Catalog / inventory inputs (scratch)

- Grok capability catalog (~263 caps; host-relevant subset matrixed above)
- SuperOne ACP inventory (acp-runtime, permissions-ui, xai-ext, mcp-host, session-ui, tests-docs)

---

## 10. Summary for implementers

**Already good enough for interactive Grok coding:** process spawn, session/new, streaming, cancel, FS reverse, SuperOne MCP + preapprove, yolo/auto permission UI, ask_user_question, **full plan approval** (`exit_plan_mode` + line review + Grok outcomes), slash command catalog, tool card mapping (including use_tool).

**Broken / high-priority next:** Grok **model (and effort) switching** when catalogs arrive without standard configIds (**P0**); **capability flags** so plan/todo/MCP chrome is not under-reported (**P1**); **user MCP attach**; **session/load**; docs honesty.

**Not a blocker anymore:** plan mode approval path (shipped). Host enter-plan is optional P2.

**Defer:** host enter-plan chrome, TUI-only features, full x.ai admin surface, terminal re-enable for Grok, clientType spoofing, acceptEdits/dontAsk mid-session.
