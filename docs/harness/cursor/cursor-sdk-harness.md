# Design: SuperOne × Cursor SDK Harness

| Field | Value |
|---|---|
| **Status** | **Decisions locked** (implementation planning) |
| **Date** | 2026-07-25 (updated same day) |
| **SDK version** | `@cursor/sdk@1.0.24` (local cache: `.cache/cursor-sdk/package`) |
| **Types entry** | `package/dist/esm/index.d.ts` / `public-api.d.ts` |
| **Engines** | Node `>=22.13` (Electron 41.5 embeds Node 24.15 — OK) |
| **include_cloud** | `true` (secondary; local-first) |
| **Integration path** | **Native `@cursor/sdk`** (not `cursor-agent` CLI, not ACP-primary) |
| **Auth** | **User API Key** (official Dashboard key → SuperOne vault) |
| **SuperOne baseline** | harnesses: `claude` \| `codex` \| `acp` \| `opencode` (no `cursor` yet) |
| **Related research** | `cursor-auth-local-login.md`, `cursor-all-in-one-competitors.md` |

## Locked decisions (2026-07-25)

Product + architecture choices after research, Codex review, and auth/market follow-ups.
Treat these as the source of truth for implementation.

| # | Decision | Choice |
|---|---|---|
| D1 | **Integration path** | First-class harness via **in-process / main-process `@cursor/sdk`**. Not CLI subprocess, not “wrap Cursor as ACP agent” for v1. (Helmor-class peer; ACP only if Cursor ships a stable ACP binary later.) |
| D2 | **Auth** | **User-supplied Cursor User API Key** from [Dashboard → API Keys](https://cursor.com/dashboard/api). Store in SuperOne credential vault; pass per-call `apiKey`. Optional env `CURSOR_API_KEY` for dev/CI only. **No** desktop session scrape, **no** SuperOne proxy of Cursor login. |
| D3 | **Runtime default** | **Local-first** dual runtime (`Agent.create({ local })` default; cloud `bc-*` secondary, gated UX). |
| D4 | **Host shape** | OpenCode-style package layout + **Claude-family** `AgentEvent` / `applyClaudeEventToRuntime` (join `claude\|acp\|opencode\|cursor`). |
| D5 | **Store ownership** | **Custom `LocalAgentStore` on SuperOne `better-sqlite3`** (same native stack as `superone.db`). Per-workspace / scoped DB under `{userData}/cursor-sdk/…`. Pass `local.store` explicitly on every relevant `Agent.*` call. Do **not** reconfigure process-wide `Cursor.configure({ local.store })` when sessions start. **Not** npm `sqlite3`, **not** default `@cursor/sdk/sqlite` (`node:sqlite`) for product path — implement the public store interface ourselves for one SQLite stack. Jsonl only as test/fallback. |
| D6 | **Stream sources** | **Mutually exclusive content:** live send → content only from `onDelta`; `Run.stream()` for lifecycle/metadata or reattach-only content; `Run.wait()` terminal usage/git. No dual content emission without a dedupe machine. |
| D7 | **Permission UX** | Expose only modes we can honor: **`plan`**, **`agent` (sandbox on, autoReview off)**, **`agent+autoReview`**. Do **not** claim Claude-equivalent ask / bypassPermissions. Changing sandbox/autoReview → **backend rebuild**. Host-owned `customTools` gated separately. |
| D8 | **Context usage** | `getContextUsage` → **`null`** until SDK exposes window size; show turn/cumulative **token counts** only (no fake %). |
| D9 | **PR order** | Skeleton → **SDK dep + packaging + license gate** → **auth/models minimum + local runtime** (combined shippable core) → stream/UI polish → cloud. See [PR plan](#pr-plan). |
| D10 | **License** | PR2 **Go/No-Go**: confirm `@cursor/sdk` + platform binaries may be redistributed inside Electron. If denied, stop packaging path and redesign (user-installed SDK / external). |
| D11 | **Coverage claims** | Capability matrix is **qualitative** until a machine-countable inventory exists; do not cite “92%” as a metric. |

Review notes from Codex (store, dual-stream, permission honesty, packaging bins, PR order, license, context usage) are **adopted** into D5–D11 above.

## Scope

- Integrate Cursor as a first-class SuperOne harness (`HarnessId = 'cursor'`) using **native `@cursor/sdk`**.
- Map public / documented `@cursor/sdk@1.0.24` capabilities into either:
  - **(a) shipped SuperOne UX** in an early PR slice,
  - **(b) host API** (SessionBackend / IPC / store) with UI later, or
  - **(c) explicit deferred** with rationale — **nothing silent**.
- Dual runtime: local agents + cloud agents (`bc-` id routing), local-first product path.
- Electron packaging: platform packages, `bin/**` asarUnpack, better-sqlite3-backed store, packaged smoke.

## Non-goals

- Replacing Claude / Codex / OpenCode / ACP harnesses.
- Forking or reimplementing Cursor’s local agent runtime outside the SDK.
- **Primary harness via `cursor-agent` CLI subprocess** (optional later escape hatch only).
- **ACP-wrapping Cursor** as the v1 integration path.
- Scraping Cursor desktop / Keychain / `state.vscdb` login tokens for auth.
- Direct use of non-exported internals (`CloudApiClient`, `createCloudExecutor`, `RunEventTailer`, conversion helpers) except as implementation reference.
- Remote/mobile protocol full expansion in PR1 (desktop-local first; remote widen is a later slice).
- Shipping Cursor IDE UI chrome; SuperOne owns chat/sidebar UX and maps SDK streams into existing `AgentEvent` / chat-store.

---

## Goals

### Primary

Integrate Cursor as `HarnessId = 'cursor'` through the existing host plug-in path:

```
HarnessResourcesMap key
  → HARNESS_CAPABILITIES / brand
  → seed cursor-base session provider
  → harnessRegistry entry (configSchema + createBackend + forkTranscript)
  → CursorBackend implements SessionBackend
  → Claude-family AgentEvent stream
  → SessionManager / Session / chat-store
```

Verified host contracts (re-read 2026-07-25):

- `apps/desktop/src/main/session/types.ts` — `SessionBackend`, `Harness`, `BackendStartOptions`
- `apps/desktop/src/main/session/harness-registry.ts` — Map keys `claude|codex|acp|opencode` only
- `packages/shared/src/harness/harness-capabilities.ts` — `Record<HarnessId, …>` completeness gate
- `packages/shared/src/agent-types.ts` — `HarnessId = keyof HarnessResourcesMap`
- `session.ts` `applyReducer`: `claude|acp|opencode` → `applyClaudeEventToRuntime`; **cursor must join this branch**

### Coverage goal

Every catalogued capability (agent lifecycle, run control, messages/events, models/auth, local runtime/store, cloud/Git/PR, MCP/tools/subagents, platform-advanced) is assigned **status + host mapping + priority**. Target: near-full **public** API coverage in host plan (P0–P2); only true internals / duplicate internal mirrors as P3 deferred.

### Success criteria

1. User can create a Cursor local session, send multimodal messages, stream text/thinking/tools, interrupt, resume by `agentId`.
2. Models list / API key auth / plan mode work in UI.
3. MCP attach + local custom tools host path exist.
4. Cloud create/list/archive/delete/artifacts/PR git outcome available on host (UI may lag).
5. Electron package runs without a second SQLite native (no npm `sqlite3`); Cursor agent state lives in **better-sqlite3** via custom `LocalAgentStore`.

---

## Architecture decision

### Chosen path: **Native `@cursor/sdk` + local-first dual runtime**

| Path | When | SDK surface |
|---|---|---|
| **Local (default)** | Desktop project cwd, interactive coding | `Agent.create({ apiKey, model, local: { cwd, store, … } })` + `send` + `onDelta` / `Run.wait` |
| **Cloud (secondary)** | Background agents, PR workflows, remote VMs | `Agent.create({ apiKey, cloud: { env, repos, … } })`, ids `bc-*` |

**Why native SDK (not CLI / ACP for v1):**

- Full harness (stream, models, MCP, local store, cloud) behind one TypeScript surface.
- Peers (e.g. Helmor) already ship `@cursor/sdk` in multi-agent desktops — validates packaging patterns.
- SuperOne already hosts Claude/Codex/OpenCode as first-class backends; SDK fits `SessionBackend` better than shelling `cursor-agent`.

**Why not cloud-only:** SuperOne’s core is local project chat.  
**Why not local-only:** Cloud PR/artifacts still planned under `include_cloud: true`.

### Comparison to existing harnesses

| Harness | Runtime model | SuperOne adapter style | Cursor analogy |
|---|---|---|---|
| **Claude** | Subprocess / Agent SDK query + MessageBridge | Richest permission/MCP/task | Closest **interaction** richness (partial — SDK has no ask-permission callback) |
| **Codex** | App-server RPC + item stream | Parallel reducer (`codex_*`) | **Avoid** — Cursor maps cleanly to content_delta |
| **OpenCode** | HTTP client + thin backend | Runtime + event-map + factory DI | **Best structural template** |
| **ACP** | stdio protocol multi-agent | Catalog side-channel `acp_*` | Deferred alternative, not v1 path |

**Layout (main process):**

```
apps/desktop/src/main/cursor/
  cursor-runtime.ts      # Agent.create/resume/send/close lease
  cursor-event-map.ts    # InteractionUpdate / SDKMessage → AgentEvent (exclusive content rules)
  cursor-client.ts       # Cursor.me / models.list / key validation
  cursor-store.ts        # BetterSqliteLocalAgentStore (implements LocalAgentStore)
  cursor-store-schema.ts # agents / runs / checkpoints / runEvents tables
  cursor-auth.ts         # resolve User API Key from vault / optional env
  cursor-errors.ts       # CursorSdkError → toast/AgentEvent.error
apps/desktop/src/main/session/backends/
  cursor-backend.ts
  cursor-fork.ts
```

> **Packaging note (peer lesson):** Helmor runs `@cursor/sdk` in a **Node worker** because Bun’s HTTP/2 client drops tool traffic. SuperOne Electron main uses Node 24 — in-process is viable; if main-process streaming regresses, fall back to a dedicated Node utility process (same isolation idea). Do not run the SDK under Bun.

### Local agent store (D5 — better-sqlite3)

SuperOne already ships **`better-sqlite3`** (electron-rebuild with `node-pty`). Cursor’s `@cursor/sdk/sqlite` uses **`node:sqlite`**, not our driver. npm `sqlite3` is a third native stack. Product path: **one native SQLite**.

| Piece | Decision |
|---|---|
| Driver | Existing `better-sqlite3` only |
| Implementation | `BetterSqliteLocalAgentStore` implements public `LocalAgentStore` (agents / runs / checkpoints / runEvents) |
| DB path | `{userData}/cursor-sdk/{workspaceHash}/agent-store.db` (per-workspace preferred for wipe/isolation) |
| Injection | Always pass `local.store` (or equivalent) on `Agent.create` / `resume` / list APIs — never flip process-wide `Cursor.configure` per session |
| Not product default | `JsonlLocalAgentStore` (tests/fallback only), `@cursor/sdk/sqlite`, npm `sqlite3` |
| Schema | Mirror SDK document shapes; version migrations colocated |
| Tests | Store contract: create agent → run → list → checkpoint → delete (no network) |
| Effort note | Interface is large (cursors, blobs, event offsets). MVP: agents+runs+checkpoints for create/send/resume; runEvents when reattach needs them |

### Electron packaging (verified from package.json + store types)

| Concern | Fact (SDK 1.0.24) | SuperOne decision |
|---|---|---|
| **Platform packages** | `optionalDependencies`: `@cursor/sdk-darwin-arm64\|x64`, `linux-arm64\|x64`, `win32-x64` | electron-builder: ship matching arch; strip wrong arch in `afterPack.cjs` |
| **Executables** | Platform packages include `bin/cursorsandbox`, `bin/rg` (not only `.node`) | Explicit `asarUnpack` for `node_modules/@cursor/sdk*/**` and `bin/**`; preserve +x |
| **Agent store** | SDK offers Jsonl / `@cursor/sdk/sqlite` (`node:sqlite`) | **D5:** custom **better-sqlite3** `LocalAgentStore` — no second SQLite native |
| **Store ownership** | `Cursor.configure` is process-wide mutable | Pass per-call `local.store`; do not reconfigure module default per session |
| **State root** | `getDefaultSdkStateRoot(workspaceRef)` | Our DB under `{userData}/cursor-sdk/{workspaceHash}/` |
| **Node engines** | `>=22.13` | Satisfied by Electron 41.5 / Node 24.15; keep soft assert + CTA if ever below |
| **HTTP/1.1** | `useHttp1ForAgent` | Setting for TLS middleboxes; note HTTP/1 can break local streaming (forum) |
| **License** | LICENSE “All rights reserved” + ToS | **PR2 Go/No-Go** before shipping bundled binaries |

### Identity & routing

- SuperOne `session.id` (UUID) ≠ Cursor `agentId`.
- Persist `providerSessionId = agentId` via `onProviderSessionId`.
- **Cloud:** `bc-` prefix → cloud ops (create/list/archive/delete as documented).
- **Local CRUD:** treat `Agent.get/archive/unarchive/delete` for non-`bc-` ids as **unresolved** until a live probe; do not implement local delete solely from `GetAgentOptions` comments.
- Auth: see [Auth](#auth) (User API Key).

### Event strategy (D6)

| Phase | Source | Emits content (text/thinking/tools)? |
|---|---|---|
| Live send | `SendOptions.onDelta` | **Yes** (primary) |
| Live send | `Run.stream()` | **No** — lifecycle / status / reattach helpers only |
| Reattach | `Run.stream()` | **Yes** (delta disabled) |
| Terminal | `Run.wait()` | usage / git / result / error |

**Do not** invent `cursor_*` AgentEvent variants unless a UI cannot map to generic blocks.

### Permission model mapping (D7 — honest modes)

Cursor has **no** Claude-style multi-button permission prompts in the public SDK. Map only what we can honor:

| SuperOne UI label | Cursor options | Notes |
|---|---|---|
| **Plan** | `mode: 'plan'` | Read-only planning; maps cleanly |
| **Agent (sandboxed)** | `sandboxOptions.enabled: true`, `autoReview: false` | Default; **not** “ask me every tool” |
| **Agent + Auto-review** | `autoReview: true` (+ sandbox per product default) | Classifier-backed; label as such |
| ~~Ask / default (Claude)~~ | — | **Not offered** for Cursor |
| ~~Bypass / YOLO~~ | — | **Not offered** as guaranteed bypass |

- Host-owned `customTools` / SuperOne MCP: separate allow/deny in SuperOne, independent of Cursor sandbox.
- `autoReview` / `sandboxOptions` are create-time options → **rebuild backend** on change (unless a later probe proves live mutation).

---

## Capability matrix

Legend for **SuperOne status** (today, pre-integration):

- `missing` — no Cursor harness code
- `host-ready` — SuperOne generic host already supports once backend maps
- `partial` — host has analogous surface for other harnesses
- `na` — not applicable to SuperOne product

**Priority:** P0 session chat core · P1 Claude/Codex parity · P2 advanced · P3 internal/defer-last

### 1. Agent lifecycle & account (`agent-lifecycle`)

| id | name | surface | SuperOne status | host mapping | gap | priority |
|---|---|---|---|---|---|---|
| agent-create | Agent.create | sdk-public | missing | CursorBackend.start → Agent.create | Implement + providerSessionId | P0 |
| agent-resume | Agent.resume | sdk-public | missing | rebuild/resume with providerSessionId | Resume path + store | P0 |
| agent-prompt | Agent.prompt | sdk-public | missing | Headless one-shot IPC (optional) | Not primary Session path | P2 |
| agent-send | SDKAgent.send | sdk-public | host-ready | SessionBackend.send | Event map + busy handling | P0 |
| agent-close | SDKAgent.close | sdk-public | host-ready | SessionBackend.close | Sync close | P0 |
| agent-async-dispose | Symbol.asyncDispose | sdk-public | missing | close() await dispose | Flush analytics | P0 |
| agent-reload | SDKAgent.reload | sdk-public | partial | reloadMcpServers / settings change | Wire reload | P1 |
| agent-list | Agent.list | sdk-public | partial | Session list / project picker | CONNECT or list IPC | P1 |
| agent-get | Agent.get | cloud-only | missing | Session snapshot metadata | Cloud-first; local followup | P1 |
| agent-archive | Agent.archive | cloud-only | missing | Session archive IPC | Cloud UI action | P1 |
| agent-unarchive | Agent.unarchive | cloud-only | missing | Session unarchive | Cloud UI | P2 |
| agent-delete | Agent.delete | cloud-only | partial | SessionManager remove + Agent.delete | Local store delete too | P1 |
| agent-messages-list | Agent.messages.list | sdk-public | host-ready | History hydrate optional | Prefer SuperOne DB + conversation() | P1 |
| agent-list-runs | Agent.listRuns | sdk-public | missing | Run history panel | Host API | P2 |
| agent-get-run | Agent.getRun | sdk-public | missing | Detached reattach | Host API | P2 |
| agent-cancel-run | Agent.cancelRun | sdk-public | host-ready | interrupt without agent handle | Detached cancel | P0 |
| agent-id-routing | bc- vs local | config | missing | providerSessionId scheme | Document + router | P0 |
| sdk-agent-info | SDKAgentInfo | sdk-public | partial | Session list row | Map status/archived | P1 |
| agent-options | AgentOptions | config | missing | BackendStartOptions + Zod config | Schema | P0 |
| local-agent-options | LocalAgentOptions | local-only | missing | cwd/store/sandbox/tools | Create options | P0 |
| cloud-agent-options | CloudAgentOptions | cloud-only | missing | Cloud create form | UI + config | P1 |
| send-options-local-cloud | Local/CloudSendOptions | config | missing | SendMessageRequest extras | force/envVars | P1 |
| sdk-agent-model-prop | SDKAgent.model | sdk-public | host-ready | setModel / snapshot | Sync after send | P1 |
| agent-list-artifacts | listArtifacts | cloud-only | missing | Artifacts panel IPC | Host methods | P2 |
| agent-download-artifact | downloadArtifact | cloud-only | missing | Save dialog IPC | Host methods | P2 |
| cursor-configure | Cursor.configure | config | missing | App boot bootstrap | Once per process | P0 |
| cursor-me | Cursor.me | cloud-only | missing | Settings identity | CONNECT_CURSOR | P1 |
| cursor-models-list | Cursor.models.list | cloud-only | missing | Model selector catalog | CONNECT + cache | P0 |
| cursor-repositories-list | Cursor.repositories.list | cloud-only | missing | Cloud repo picker | UI | P2 |
| cursor-request-options | apiKey options | config | partial | Credential vault | Secure inject | P0 |
| create-agent-platform | createAgentPlatform | platform-advanced | missing | Optional multi-workspace host | Prefer Agent facade first | P2 |
| agent-run-store | AgentRunStore | platform-advanced | missing | Custom persistence | Prefer LocalAgentStore | P2 |
| agent-checkpoint-store | AgentCheckpointStore | platform-advanced | missing | Rewind/checkpoint | Via LocalAgentStore | P2 |
| local-agent-store | LocalAgentStore iface | platform-advanced | missing | better-sqlite3 impl | Boot wire | P0 |
| local-agent-store-impls | Jsonl/sdk-sqlite/compose | platform-advanced | missing | **Default better-sqlite3** | Packaging | P0 |
| local-agent-store-filters | list filters | platform-advanced | missing | Scoped cleanup | Later | P3 |
| list-result-pagination | ListResult | sdk-public | partial | Infinite scroll lists | Cursor pagination | P2 |
| sdk-user-message | SDKUserMessage images | sdk-public | host-ready | Composer attachments | Map images | P1 |
| mcp-server-config-lifecycle | mcpServers create/send | config | partial | MCP manager → SDK | Convert configs | P1 |
| custom-subagents-definitions | AgentOptions.agents | config | missing | Subagent registry | Optional UI | P2 |
| cloud-api-client-agent-crud | CloudApiClient | internal | na | Do not call directly | Reference only | P3 |
| cloud-agent-module-exports | cloud-agent helpers | internal | na | Agent/Cursor facade | — | P3 |
| platform-default-helpers | createDefaultAgent family | internal | na | Agent statics | — | P3 |
| local-executor-cache | acquireLocalExecutor | platform-advanced | partial | prewarm pool | Optional | P2 |
| idempotency-keys | create/send keys | config | partial | clientMessageId → key | Retry safety | P2 |
| model-list-item-shape | ModelListItem | sdk-public | partial | Model picker variants | Map parameters | P1 |
| lifecycle-errors | Auth/Busy/… errors | sdk-public | host-ready | error AgentEvent | Map hierarchy | P1 |
| v1-agent-status | ACTIVE/ARCHIVED | cloud-only | missing | Archive badge | Map archived | P2 |

### 2. Run control & streaming (`run-control`)

| id | name | surface | SuperOne status | host mapping | gap | priority |
|---|---|---|---|---|---|---|
| sdk-agent-send | SDKAgent.send | sdk-public | host-ready | SessionBackend.send | Implement | P0 |
| agent-prompt-oneshot | Agent.prompt | sdk-public | missing | Automation IPC | Optional | P2 |
| send-options | SendOptions | config | host-ready | model/mode/mcp/onDelta | Wire | P0 |
| send-user-message-payload | images | sdk-public | host-ready | SendMessageRequest attachments | Map base64/url | P1 |
| send-mode-option | agent\|plan | config | partial | setPermissionMode / setSessionMode | plan toggle | P1 |
| local-send-options | force/customTools | local-only | missing | Recovery + tools | force on wedge | P1 |
| cloud-send-options | envVars | cloud-only | missing | Per-turn secrets | Host | P2 |
| send-on-step | onStep | sdk-public | host-ready | Finalize transcript steps | Map ConversationStep | P0 |
| send-on-delta | onDelta | sdk-public | host-ready | Live content_delta | Primary stream | P0 |
| interaction-update-types | InteractionUpdate union | stream-event | host-ready | cursor-event-map | Full variant map | P0 |
| run-stream | Run.stream | sdk-public | host-ready | Alternate/reattach stream | Dual consumer ok | P0 |
| run-wait | Run.wait | sdk-public | host-ready | Turn complete + usage/git | Await in send | P0 |
| run-cancel | Run.cancel | sdk-public | host-ready | interrupt | + cancelRun | P0 |
| run-conversation | Run.conversation | sdk-public | partial | History rebuild | Optional hydrate | P1 |
| run-supports | supports/unsupportedReason | sdk-public | missing | Feature-detect UI | Cloud resume | P1 |
| run-status-lifecycle | status + onDidChangeStatus | sdk-public | host-ready | status_change events | Map statuses | P0 |
| run-handle-fields | id/usage/git/… | sdk-public | partial | turn correlation | Persist run id meta | P0 |
| run-result | RunResult | sdk-public | host-ready | message_complete | usage/cost | P0 |
| run-error | RunError | sdk-public | host-ready | error event | codes → i18n | P0 |
| run-git-info | RunGitInfo | cloud-ish | missing | PR chip UI | From wait() | P2 |
| token-usage | TokenUsage | sdk-public | partial | ContextUsageInfo | Map fields | P1 |
| agent-list-runs | listRuns | sdk-public | missing | Run history | Host | P1 |
| agent-get-run | getRun | sdk-public | missing | Reattach | Host | P1 |
| sdk-message-union | SDKMessage | stream-event | host-ready | event-map | All variants | P0 |
| sdk-system-message | system/init | stream-event | host-ready | init_ready / tools | Emit | P0 |
| sdk-assistant-user-messages | assistant/user | stream-event | host-ready | message blocks | Emit | P0 |
| sdk-tool-call-message | tool_call | stream-event | host-ready | tool cards | Emit | P0 |
| sdk-thinking-message | thinking | stream-event | host-ready | thinking block | Emit | P0 |
| sdk-status-message | status lifecycle | stream-event | host-ready | SessionStatus | CREATING/EXPIRED | P0 |
| sdk-request-task-usage-messages | request/task/usage | stream-event | partial | telemetry / task UI | Map | P1 |
| local-run-stream-events | LocalRunStreamEvent | local-only | missing | Replay/tail | Advanced | P1 |
| conversation-step-types | ConversationStep | sdk-public | host-ready | onStep finalize | Map | P1 |
| conversation-turn-types | ConversationTurn | sdk-public | partial | History | Optional | P2 |
| agent-busy-error | AgentBusyError | sdk-public | host-ready | Queue/reject policy | force recovery | P0 |
| run-control-errors | Network/RateLimit/… | sdk-public | host-ready | error UI | wrapSdkError | P1 |
| run-event-notifier | RunEventNotifier | platform-advanced | missing | Multi-window tail | Optional | P2 |
| run-event-store | RunEventStore | platform-advanced | missing | Custom store | Optional | P2 |
| agent-run-store-lifecycle | markRun* | platform-advanced | missing | Custom platform | Prefer facade | P2 |
| send-idempotency-key | idempotencyKey | config | partial | clientMessageId | Wire | P1 |
| model-selection-on-send | model on send | config | host-ready | setModel mid-session | params/effort | P0 |
| mcp-servers-on-send | per-send MCP | config | partial | Session MCP merge | Wire | P1 |
| sdk-agent-info-run-status | list status | sdk-public | partial | Session badges | Map | P2 |
| turn-ended-usage-delta | turn-ended.usage | stream-event | host-ready | usage rollup | Map | P1 |
| nested-task-updates | NestedTaskUpdate | stream-event | partial | Subagent tree | task_* events | P2 |
| shell-output-delta | shell-output-delta | stream-event | partial | bash output panel | Live terminal | P1 |
| cursor-agent-platform-run-hooks | platform hooks | platform-advanced | missing | Embed stores | Later | P3 |

### 3. Message & event surface (`messages-events`)

| id | name | surface | SuperOne status | host mapping | gap | priority |
|---|---|---|---|---|---|---|
| sdk-message-union | SDKMessage | stream-event | host-ready | AgentEvent fanout | Map layer | P0 |
| text-block | TextBlock | sdk-public | host-ready | ContentBlock text | — | P0 |
| tool-use-block | ToolUseBlock | sdk-public | host-ready | tool_use block | — | P0 |
| sdk-system-message | system | stream-event | host-ready | init | — | P0 |
| sdk-user-message-event | user echo | stream-event | host-ready | user message | Dedupe vs composer | P0 |
| sdk-assistant-message | assistant | stream-event | host-ready | assistant aggregate | Prefer deltas | P0 |
| sdk-tool-use-message | tool_call lifecycle | stream-event | host-ready | tool_use/result | — | P0 |
| sdk-thinking-message | thinking | stream-event | host-ready | thinking | — | P0 |
| sdk-status-message | status | stream-event | host-ready | status_change | — | P0 |
| sdk-request-message | request_id | stream-event | missing | telemetry | Optional | P2 |
| sdk-task-message | task progress | stream-event | partial | task_* | — | P1 |
| sdk-usage-message | usage | stream-event | partial | context usage | — | P1 |
| local-run-stream-event | durable envelope | local-only | missing | replay | — | P1 |
| local-run-stream-codecs | encode/decode | local-only | missing | tailer | — | P1 |
| run-stream-api | Run.stream | sdk-public | host-ready | backend subscribe | — | P0 |
| run-conversation-api | Run.conversation | sdk-public | partial | hydrate | — | P0 |
| run-status-events | wait/status | sdk-public | host-ready | lifecycle | — | P0 |
| send-options-on-step | onStep | sdk-public | host-ready | step commit | — | P0 |
| send-options-on-delta | onDelta | sdk-public | host-ready | live UI | — | P0 |
| sdk-user-message-input | outbound SDKUserMessage | sdk-public | host-ready | composer | — | P0 |
| conversation-step-union | ConversationStep | sdk-public | host-ready | timeline | — | P0 |
| conversation-turn-union | ConversationTurn | sdk-public | partial | history | — | P1 |
| get-turn-type | getTurnType | sdk-public | missing | history branch | Optional util | P2 |
| interaction-update-union | InteractionUpdate | sdk-public | host-ready | primary mapper | Full schema | P0 |
| text-delta-update | text-delta | stream-event | host-ready | content_delta | — | P0 |
| thinking-delta-updates | thinking-* | stream-event | host-ready | thinking | — | P0 |
| tool-call-started-completed | tool-call-* | stream-event | host-ready | tools | — | P0 |
| tool-call-delta-nested-task | tool-call-delta | stream-event | partial | nested UI | — | P1 |
| partial-tool-call-update | partial-tool-call | stream-event | partial | args preview | streamingToolInput | P1 |
| user-message-appended-update | user-message-appended | stream-event | host-ready | confirm echo | — | P1 |
| token-delta-update | token-delta | stream-event | partial | live meter | — | P1 |
| summary-updates | summary* | stream-event | missing | compaction UI | Optional | P2 |
| shell-output-delta-update | shell-output-delta | stream-event | partial | bash panel | — | P1 |
| turn-ended-update | turn-ended | stream-event | host-ready | message_complete | — | P0 |
| step-started-completed-updates | step-* | stream-event | missing | telemetry | Not index-named | P2 |
| tool-call-typed-union | ToolCall kinds | sdk-public | host-ready | tool cards | 15 kinds | P0 |
| token-usage-helpers | toTokenUsage/sum | sdk-public | partial | usage panel | Import if exported | P1 |
| agent-messages-list | history list | sdk-public | partial | optional hydrate | SuperOne DB primary | P1 |
| append-run-message | platform inject | platform-advanced | missing | debug inject | Later | P2 |
| run-interaction-accumulator | accumulator class | internal | na | Reference for mapping | Not public export | P2 |
| wire-message-schemas | Message schemas | sdk-public | missing | validators optional | — | P2 |
| run-event-store-records | RunEventRecord | platform-advanced | missing | custom store | — | P2 |
| run-event-notifier | notifier API | platform-advanced | missing | multi-process | — | P2 |
| cloud-v1-run-stream-map | mapV1… | cloud-only | na | SDK-internal | — | P3 |
| core-to-sdk-update | coreToSdkUpdate | internal | na | — | — | P3 |
| sdk-schemas-for-conversation-deltas | Zod schemas | sdk-public | missing | validate before map | Optional | P2 |
| run-event-tailer-stream | RunEventTailer | local-only | na | Model for replay | Not public | P2 |
| conversation-step-assistant-thinking | assistant/thinking steps | sdk-public | host-ready | onStep | — | P0 |
| conversation-step-tool-call | toolCall step | sdk-public | host-ready | tools finalize | — | P0 |
| interaction-listener | InteractionListener | sdk-public | missing | custom sink | Prefer onDelta | P2 |

### 4. Models, auth, mode, options (`models-auth-config`)

| id | name | surface | SuperOne status | host mapping | gap | priority |
|---|---|---|---|---|---|---|
| model-selection | ModelSelection | sdk-public | host-ready | selectedModel + params | effort as param | P0 |
| model-parameter-value | ModelParameterValue | sdk-public | partial | selectedEffort | Map id/value | P0 |
| model-parameter-definition | catalog params | sdk-public | partial | picker dropdowns | From list | P1 |
| model-variant | ModelVariant | sdk-public | missing | preset chips | UI | P1 |
| model-list-item | ModelListItem/SDKModel | sdk-public | missing | CursorResources.models | CONNECT | P0 |
| cursor-models-list | Cursor.models.list | sdk-public | missing | discover models | Auth | P0 |
| resolve-local-model-selection | resolveLocal… | local-only | missing | pre-create validate | Optional | P1 |
| validate-cloud-model-availability | cloud preflight | cloud-only | missing | pre-create check | Optional | P2 |
| agent-mode-option | agent\|plan | sdk-public | partial | permission plan mode | Wire mode | P0 |
| agent-options | AgentOptions bag | sdk-public | missing | provider config | Zod | P0 |
| agent-options-model | model required local | sdk-public | host-ready | start model | Enforce local | P0 |
| agent-options-api-key | apiKey | sdk-public | partial | credentials | Vault | P0 |
| agent-options-name | name | sdk-public | host-ready | session title | Optional | P1 |
| agent-options-mode | initial mode | sdk-public | partial | create mode | — | P0 |
| send-options-model-mode | per-send | sdk-public | host-ready | mid-session | — | P0 |
| sdk-agent-model-property | live model | sdk-public | host-ready | snapshot | — | P0 |
| run-model-and-usage | Run model/usage | sdk-public | partial | turn meta | — | P1 |
| token-usage | TokenUsage | sdk-public | partial | meters | — | P1 |
| sdk-usage-message | usage event | stream-event | partial | stream handler | — | P1 |
| sdk-system-message-model | init model | stream-event | host-ready | banner | — | P1 |
| cursor-configure | configureCursorSdk | config | missing | boot | — | P0 |
| cursor-configure-options | store/http1 | config | missing | settings | — | P1 |
| cursor-request-options-api-key | apiKey | sdk-public | partial | vault | — | P0 |
| env-cursor-api-key-fallback | CURSOR_API_KEY | config | partial | avoid bare env | Prefer vault | P0 |
| cursor-me | Cursor.me | sdk-public | missing | account panel | — | P1 |
| sdk-user | SDKUser | sdk-public | missing | profile | — | P1 |
| operation-api-key-options | op apiKey | sdk-public | missing | per-request | — | P1 |
| sdk-user-message | outbound | sdk-public | host-ready | composer | — | P0 |
| sdk-image | SDKImage | sdk-public | host-ready | attachments | — | P1 |
| agent-definition-model | subagent model | sdk-public | missing | agents map | — | P2 |
| local-agent-options-auth-related | store/settings | local-only | missing | local config | — | P2 |
| cloud-agent-options | cloud create | cloud-only | missing | cloud form | — | P2 |
| create-local-executor-api-key | executor apiKey | local-only | na | via Agent.create | — | P2 |
| cursor-agent-platform-model | platform model APIs | platform-advanced | missing | optional host | — | P2 |
| stored-model-selection | store model | platform-advanced | partial | session DB model | — | P2 |
| cursor-sdk-error-base | CursorSdkError | sdk-public | host-ready | error map | — | P0 |
| authentication-error | AuthenticationError | sdk-public | host-ready | re-auth UI | — | P0 |
| rate-limit-error | RateLimitError | sdk-public | host-ready | backoff UX | — | P1 |
| configuration-error | ConfigurationError | sdk-public | host-ready | validation toast | — | P0 |
| agent-busy-error | AgentBusyError | sdk-public | host-ready | queue policy | — | P1 |
| integration-not-connected-error | SCM not connected | cloud-only | missing | GitHub CTA | helpUrl | P2 |
| network-error | NetworkError | sdk-public | host-ready | offline UI | — | P1 |
| unknown-and-not-found-errors | Unknown/NotFound | sdk-public | host-ready | resume missing | — | P1 |
| error-conversion-helpers | wrap/convert | sdk-public | missing | normalize | Optional | P2 |
| cursor-repositories-list | repos list | cloud-only | missing | picker | — | P2 |
| sdk-agent-info-name-status | list meta | sdk-public | partial | sidebar | — | P2 |
| run-error-shape | RunError | sdk-public | host-ready | terminal error | — | P2 |
| setting-source | SettingSource | local-only | missing | privacy policy | Default project|user | P2 |
| local-send-options-force | force | local-only | missing | recover wedge | — | P2 |
| task-tool-mode-plan-agent | internal task mode | internal | na | via public mode | — | P3 |

### 5. Local runtime & store (`local-runtime`)

| id | name | surface | SuperOne status | host mapping | gap | priority |
|---|---|---|---|---|---|---|
| local-agent-options | LocalAgentOptions | local-only | missing | create local block | — | P0 |
| local-cwd-multi-root | cwd string\|string[] | local-only | partial | projectPath + additionalDirs | Multi-root later | P0 |
| local-setting-sources | settingSources | local-only | missing | privacy default | product policy | P1 |
| local-sandbox-options | sandboxOptions | local-only | partial | setSandbox | Map | P1 |
| local-auto-review | autoReview | local-only | partial | permission auto | Map | P1 |
| local-custom-tools | customTools | local-only | missing | SuperOne tools bridge | Host tools | P1 |
| local-enable-agent-retries | enableAgentRetries | local-only | missing | default true | Setting | P1 |
| local-agent-store-option | store inject | local-only | missing | better-sqlite3 path | — | P0 |
| local-send-options | LocalSendOptions | local-only | missing | send nest | — | P0 |
| local-send-force | force | local-only | missing | recover | — | P1 |
| cursor-configure-local-store | configure store | config | missing | avoid process-wide default | Pass per call | P0 |
| cursor-configure-http1 | useHttp1ForAgent | config | missing | settings | — | P2 |
| sdk-state-root | getDefaultSdkStateRoot | platform-advanced | missing | userData layout | — | P0 |
| local-agent-store-interface | LocalAgentStore | platform-advanced | missing | better-sqlite3 impl | — | P0 |
| local-agent-store-agents | agents substore | platform-advanced | missing | agent index | Product store | P0 |
| local-agent-store-runs | runs substore | platform-advanced | missing | run history | Product store | P0 |
| local-agent-store-checkpoints | checkpoints | platform-advanced | missing | resume blobs | Product store | P0 |
| local-agent-store-run-events | runEvents | platform-advanced | missing | event log | As needed for reattach | P1 |
| compose-local-agent-store | compose | platform-advanced | missing | split backends | Later | P2 |
| jsonl-local-agent-store | JsonlLocalAgentStore | sdk-public | missing | tests/fallback only | Not product default | P3 |
| better-sqlite-local-agent-store | custom LocalAgentStore | platform-advanced | missing | **product default (D5)** | Ship | P0 |
| sqlite-local-agent-store | SqliteLocalAgentStore (`node:sqlite`) | sdk-public | missing | not product path | Prefer better-sqlite3 | P3 |
| open-default-local-agent-store | openDefault… | platform-advanced | missing | do not use product default | Inject our store | P3 |
| sqlite-storage-unavailable | load failure helpers | internal | na | fallback Jsonl only in tests | — | P3 |
| native-platform-packages | @cursor/sdk-* | config | missing | electron-builder | Ship natives | P0 |
| cursor-agent-platform | CursorAgentPlatform | platform-advanced | missing | advanced host | Later | P2 |
| cursor-agent-platform-options | platform options | platform-advanced | missing | isolation | — | P2 |
| agent-run-store-advanced | AgentRunStore | platform-advanced | missing | prefer LocalAgentStore | — | P3 |
| agent-checkpoint-store-advanced | checkpoint store | platform-advanced | missing | prefer LocalAgentStore | — | P3 |
| run-event-store-advanced | event store variants | platform-advanced | missing | advanced | — | P2 |
| run-event-notifier | notifiers | platform-advanced | missing | multi-process | — | P2 |
| local-run-stream-events | stream schema | stream-event | missing | map | — | P0 |
| sdk-message-stream-types | SDKMessage types | stream-event | host-ready | map | — | P0 |
| local-executor | createLocalExecutor | platform-advanced | na | via Agent.create | — | P2 |
| runtime-custom-subagents | RuntimeCustomSubagent | local-only | missing | subagents | — | P2 |
| local-model-validation | resolveLocalModelSelection | local-only | missing | validate | — | P1 |
| agent-create-resume-local | create/resume/prompt | sdk-public | missing | start/rebuild | — | P0 |
| agent-list-local-runtime | list local | local-only | missing | picker | — | P1 |
| agent-runs-local-ops | list/get/cancel local | local-only | host-ready | interrupt/history | — | P1 |
| agent-messages-local | messages.list local | local-only | partial | hydrate | — | P1 |
| agent-get-ops-store-routing | get/archive/delete routing | sdk-public | missing | router | — | P2 |
| run-handle-ops | stream/wait/cancel | sdk-public | host-ready | backend | — | P0 |
| send-options-shared | SendOptions | sdk-public | host-ready | send | — | P0 |
| sdk-user-message-images | images | sdk-public | host-ready | multimodal | — | P1 |
| store-list-pagination | list pagination | platform-advanced | missing | UI lists | — | P2 |
| local-agent-record-conversion | converters | internal | na | — | — | P3 |
| atomic-write-jsonl | writeFileAtomic | internal | na | — | — | P3 |
| custom-tools-mcp-bridge | custom-user-tools | local-only | missing | host tools | — | P2 |
| cloud-agent-options-adjacent | CloudAgentOptions | cloud-only | missing | contrast | — | P3 |
| token-usage-on-runs | usage on runs | sdk-public | partial | metering | — | P2 |

### 6. Cloud runtime & Git/PR (`cloud-runtime`)

| id | name | surface | SuperOne status | host mapping | gap | priority |
|---|---|---|---|---|---|---|
| cloud-agent-options | CloudAgentOptions | config | missing | cloud create form | — | P1 |
| cloud-env-type | cloud\|pool\|machine | config | missing | env picker | — | P1 |
| cloud-repos-config | repos[] | config | missing | repo binding | — | P1 |
| work-on-current-branch | workOnCurrentBranch | config | missing | Git toggle | — | P1 |
| auto-create-pr | autoCreatePR | config | missing | PR settings | — | P1 |
| skip-reviewer-request | skipReviewerRequest | config | missing | advanced | — | P2 |
| cloud-agent-env-vars | envVars session | config | missing | secrets | — | P2 |
| cloud-send-options | run envVars | config | missing | per-send | — | P2 |
| agent-create-cloud | Agent.create cloud | sdk-public | missing | start cloud | — | P1 |
| agent-resume-cloud | Agent.resume cloud | sdk-public | missing | resume bc- | — | P1 |
| agent-prompt-cloud | Agent.prompt cloud | sdk-public | missing | one-shot | — | P2 |
| list-agents-cloud-filters | list cloud filters | cloud-only | missing | list UI | prUrl/archived | P1 |
| sdk-agent-info-cloud | cloud info shape | cloud-only | missing | list rows | — | P1 |
| agent-get-cloud | Agent.get | cloud-only | missing | detail | — | P1 |
| agent-archive | archive | cloud-only | missing | action | — | P2 |
| agent-unarchive | unarchive | cloud-only | missing | action | — | P2 |
| agent-delete | delete | cloud-only | missing | hard delete | — | P2 |
| cloud-id-routing | bc- routing | sdk-public | missing | router | — | P1 |
| list-runs-cloud | listRuns cloud | cloud-only | missing | history | — | P1 |
| get-run-cloud | getRun cloud | cloud-only | missing | reattach | — | P1 |
| cancel-run-cloud | cancelRun cloud | cloud-only | host-ready | stop | — | P1 |
| run-git-info | Run.git | cloud-ish | missing | PR chip | wait() | P1 |
| sdk-agent-list-artifacts | listArtifacts | cloud-only | missing | panel | — | P2 |
| sdk-agent-download-artifact | downloadArtifact | cloud-only | missing | download | — | P2 |
| sdk-artifact-type | SDKArtifact | cloud-only | missing | row model | — | P2 |
| cursor-repositories-list | repositories.list | cloud-only | missing | picker | — | P1 |
| cursor-me | me | cloud-only | missing | account | — | P1 |
| cursor-models-list | models cloud | cloud-only | missing | selector | — | P1 |
| cursor-request-options | apiKey | config | partial | vault | — | P1 |
| integration-not-connected-error | SCM error | sdk-public | missing | CTA | — | P1 |
| cloud-mcp-on-create | MCP cloud | sdk-public | missing | MCP (no stdio cwd) | Strip cwd | P2 |
| cloud-custom-subagents | agents on cloud | config | missing | subagents | — | P2 |
| cloud-agent-mode | mode cloud | config | partial | plan/agent | — | P1 |
| cloud-idempotency-key | idempotency | config | partial | retries | — | P2 |
| v1-run-status-cloud | V1 statuses | internal | na | map via SDK | — | P2 |
| cloud-api-client | CloudApiClient | internal | na | facade only | — | P3 |
| create-cloud-executor | createCloudExecutor | internal | na | — | — | P3 |
| cloud-agent-module-helpers | cloud-agent.d.ts | internal | na | — | — | P3 |
| pr-opened-telemetry | maybeEmitSdkPrOpened | internal | na | optional analytics | — | P3 |
| list-result-pagination | ListResult | sdk-public | partial | scroll | — | P2 |
| sdk-agent-cloud-instance | SDKAgent cloud | sdk-public | missing | same backend iface | artifacts | P1 |
| run-wait-git-outcome | wait git | sdk-public | missing | PR button | — | P1 |
| cloud-working-location-type | CloudWorkingLocation | internal | na | — | — | P3 |
| v1-agent-record | V1Agent | internal | na | map via SDKAgentInfo | — | P3 |
| agent-busy-cloud | busy on cloud | sdk-public | host-ready | disable send | — | P2 |

### 7. MCP, custom tools, subagents, settings (`mcp-tools-subagents`)

| id | name | surface | SuperOne status | host mapping | gap | priority |
|---|---|---|---|---|---|---|
| mcp-server-config | McpServerConfig | config | partial | MCP registry → SDK | Converter | P0 |
| mcp-stdio-server | stdio fields | config | partial | desktop MCP | — | P0 |
| mcp-http-sse-server | http/sse | config | partial | remote MCP | — | P0 |
| mcp-oauth-auth | OAuth CLIENT_ID | config | partial | auth store | — | P1 |
| agent-options-mcp-servers | agent-level MCP | sdk-public | partial | create | — | P0 |
| send-options-mcp-servers | per-send MCP | sdk-public | partial | send | — | P0 |
| agent-definition | AgentDefinition | config | missing | subagent templates | — | P1 |
| agent-options-agents-map | agents map | sdk-public | missing | Task subagents | — | P1 |
| agent-definition-mcp-servers | subagent MCP typed | config | missing | inherit parent only | Doc limit | P2 |
| sdk-custom-subagent-definition | SDKCustomSubagent | internal | na | conversion | — | P2 |
| runtime-custom-subagent-definition | RuntimeCustomSubagent | local-only | missing | executor | — | P1 |
| subagent-conversion-helpers | convert* | internal | na | SDK-internal | — | P3 |
| v1-custom-subagent | cloud subagent | cloud-only | missing | cloud create | — | P2 |
| sdk-custom-tool | SDKCustomTool | local-only | missing | host callbacks | Miniapp/desktop | P0 |
| sdk-custom-tool-result | result shapes | local-only | missing | normalize | — | P1 |
| local-agent-custom-tools | local.customTools | local-only | missing | create | — | P0 |
| local-send-custom-tools | per-send tools | local-only | missing | send | — | P1 |
| custom-user-tools-mcp-server | custom-user-tools | local-only | missing | route MCP calls | Label host tools | P0 |
| setting-source | SettingSource | config | missing | policy | Privacy | P1 |
| local-setting-sources | settingSources[] | local-only | missing | create options | Default minimal | P1 |
| local-sandbox-options | sandbox | local-only | partial | setSandbox | — | P2 |
| local-auto-review | autoReview | local-only | partial | permission | — | P1 |
| create-local-executor-mcp-subagents | executor opts | local-only | na | via create | — | P2 |
| acquire-local-executor | lease cache | platform-advanced | missing | prewarm | — | P3 |
| run-executor-custom-tools-mcp | RunExecutorOptions | internal | na | — | — | P3 |
| cloud-executor-mcp | CloudExecutorConfig | cloud-only | na | via Agent | — | P2 |
| build-v1-mcp-servers | buildV1… | cloud-only | na | SDK | — | P2 |
| v1-mcp-server | V1McpServer | cloud-only | missing | no stdio cwd | Converter | P2 |
| cloud-api-create-agent-mcp-subagents | createAgent MCP | cloud-only | missing | facade | — | P2 |
| tool-call-mcp | McpToolCall | stream-event | host-ready | MCP tool UI | — | P0 |
| tool-call-task-subagent | TaskToolCall | stream-event | partial | task cards | — | P1 |
| stream-sdk-tool-use-message | tool_call stream | stream-event | host-ready | tools | — | P0 |
| stream-sdk-task-message | task stream | stream-event | partial | banner | — | P1 |
| stream-sdk-system-tools-list | tools[] init | stream-event | partial | inventory chip | — | P2 |
| stream-tool-call-lifecycle-deltas | tool deltas | stream-event | host-ready | streaming tools | — | P0 |
| stream-nested-task-update | NestedTaskUpdate | stream-event | partial | tree UI | — | P1 |
| send-options-on-delta-on-step | callbacks | sdk-public | host-ready | pipe | — | P0 |
| sdk-agent-reload | reload | sdk-public | partial | MCP refresh | — | P2 |
| agent-create-resume-with-mcp-agents | create/resume | sdk-public | missing | primary embed | — | P0 |
| local-send-force | force recovery | local-only | missing | wedge | — | P2 |
| assistant-tool-use-block | ToolUseBlock | stream-event | host-ready | transcript | — | P1 |
| cloud-stream-map-v1-tool-status | mapV1 tools | cloud-only | na | SDK | — | P2 |
| enable-agent-retries | retries | local-only | missing | long MCP | Default true | P3 |
| tool-payload-truncation | truncated flags | stream-event | partial | truncation badge | — | P2 |
| public-exports-mcp-tools-subagents | public types | sdk-public | missing | import surface | — | P1 |

### 8. Platform, stores, notifiers (`platform-advanced`)

| id | name | surface | SuperOne status | host mapping | gap | priority |
|---|---|---|---|---|---|---|
| create-agent-platform | createAgentPlatform | platform-advanced | missing | optional host | Prefer Agent.* | P2 |
| cursor-agent-platform-class | CursorAgentPlatform | platform-advanced | missing | multi-session | Later | P2 |
| platform-agent-lifecycle | platform CRUD | platform-advanced | missing | Session mirror | — | P1 |
| platform-run-lifecycle | list/get/cancel | platform-advanced | host-ready | turns | — | P1 |
| platform-get-agent-messages | getAgentMessages | platform-advanced | partial | history | — | P1 |
| platform-append-run-message | appendRunMessage | platform-advanced | missing | inject | — | P2 |
| platform-acquire-local-executor | executor cache | platform-advanced | missing | prewarm pool | Not public-api | P2 |
| platform-resolve-local-model | resolveLocalModelSelection | platform-advanced | missing | picker | — | P2 |
| default-agent-helpers | createDefault* | internal | na | Agent facade | — | P3 |
| agent-cursor-facade-vs-platform | Agent/Cursor statics | sdk-public | missing | **primary path** | Implement | P0 |
| cursor-configure-local-store | configure | config | missing | boot | — | P1 |
| local-agent-options-store | per-call store | config | missing | isolation | — | P1 |
| agent-run-store | AgentRunStore | platform-advanced | missing | custom DB | Prefer LocalAgentStore | P2 |
| agent-checkpoint-store | AgentCheckpointStore | platform-advanced | missing | blobs | — | P2 |
| run-event-store | RunEventStore | platform-advanced | missing | event log | — | P2 |
| run-event-stream-store | attachRunEvents | platform-advanced | missing | live attach | — | P2 |
| watchable-run-event-store | watchRunEvents | platform-advanced | missing | reactive | — | P2 |
| agent-run-record-types | Agent/RunRecord | platform-advanced | missing | schema map | — | P2 |
| run-terminal-patch | RunTerminalPatch | platform-advanced | missing | completion | — | P2 |
| run-event-notifier | RunEventNotifier | platform-advanced | missing | wakeup bus | — | P2 |
| in-memory-run-event-notifier | InMemory… | platform-advanced | missing | tests | — | P3 |
| local-run-event-notifier | Unix socket client | platform-advanced | missing | multi-process | — | P2 |
| local-run-event-notifier-server | Unix socket server | platform-advanced | missing | main daemon | — | P2 |
| local-agent-store | composite store | platform-advanced | missing | host-owned | better-sqlite3 | P0 |
| local-agent-store-agents | agents CRUD | platform-advanced | missing | session index | — | P1 |
| local-agent-store-runs | runs CRUD | platform-advanced | missing | turns | — | P1 |
| local-agent-store-checkpoints | checkpoints | platform-advanced | missing | resume | — | P2 |
| local-agent-store-run-events | run events | platform-advanced | missing | durable log | — | P1 |
| compose-local-agent-store | compose | platform-advanced | missing | split | — | P2 |
| jsonl-local-agent-store | Jsonl | platform-advanced | missing | test fallback | — | P3 |
| sqlite-local-agent-store | Sqlite | local-only | missing | experimental | ABI | P1 |
| get-default-sdk-state-root | state root | platform-advanced | missing | locate/migrate | — | P2 |
| create-local-agent-store-adapters | adapters | internal | na | platform wire | — | P2 |
| store-pagination-helpers | paginate* | platform-advanced | missing | custom store | — | P3 |
| in-memory-local-agent-store | in-memory | internal | na | unit tests | deep import | P3 |
| resolve-default-local-agent-store | resolve/setDefault | internal | na | vs configure | — | P3 |
| local-agent-record-conversion | converters | internal | na | — | — | P3 |
| run-event-tailer | RunEventTailer | internal | na | replay model | — | P2 |
| sqlite-storage-unavailable | SQLite errors | internal | na | surface error / test Jsonl | — | P3 |
| write-file-atomic | atomic write | internal | na | — | — | P3 |
| runtime-custom-subagent-definition | subagent runtime | platform-advanced | missing | inject | — | P2 |
| list-options-runtime-routing | local\|cloud options | sdk-public | missing | list filters | — | P1 |
| sdk-agent-info-runtime | SDKAgentInfo | sdk-public | partial | sidebar | — | P1 |
| filter-match-helpers | matches*Filter | internal | na | custom store | — | P3 |
| cloud-account-catalog-via-platform-defaults | me/models/repos | cloud-only | missing | settings | — | P3 |
| token-usage-on-run-records | usage persistence | platform-advanced | partial | meters | — | P2 |
| package-exports-sqlite-subpath | exports map | config | missing | bundler config | . / ./agent / ./sqlite | P2 |

### Matrix coverage note

Catalogued capabilities across source domains ≈ **379** (including cross-domain duplicates of the same public API). Unique public/actionable surfaces ≈ **220–250**. Above matrix lists **all distinct catalog ids** from the research dump without silent omission; internal-only rows are marked P3/`na`.

---

## Event mapping

### Design rules

1. Join **Claude-family** reducer: `session.ts` must treat `harnessId === 'cursor'` like `opencode|acp|claude`.
2. Prefer **`onDelta` → `content_delta` / tool lifecycle**; use `Run.stream` for coarse/system/status and reattach.
3. Leave `seq` unset — `Session.forwardEvent` owns sequencing.
4. No `cursor_*` AgentEvent types in v1 unless proven necessary.

### SDKMessage → AgentEvent

| SDKMessage | AgentEvent(s) | chat-store path |
|---|---|---|
| `system` subtype init | `init_ready` (optional skills empty), `session_init`, model banner via settings | `reduceLifecycle` |
| `user` | Ignore if SuperOne already inserted user msg; else `message_start` user | lifecycle |
| `assistant` | Coarse snapshot; usually superseded by deltas | content |
| `tool_call` running | `content_delta` tool_use start / tool card | `reduceTool` / content |
| `tool_call` completed/error | tool_result + status | tool |
| `thinking` | thinking ContentBlock / delta | content |
| `status` CREATING/RUNNING | `status_change` streaming | lifecycle |
| `status` FINISHED | handled by wait → `message_complete` | lifecycle |
| `status` ERROR/CANCELLED/EXPIRED | `message_error` / `message_interrupted` / status | lifecycle |
| `request` | optional metadata only | ignore or telemetry |
| `task` | `task_started` / progress / notification | tool |
| `usage` | usage on metadata / context | usage / message_complete |

### InteractionUpdate → AgentEvent

| InteractionUpdate | AgentEvent / ContentBlock | notes |
|---|---|---|
| `text-delta` | `content_delta` text | primary stream |
| `thinking-delta` | thinking delta | |
| `thinking-completed` | close thinking span | duration |
| `tool-call-started` | tool_use block + typed ToolCall | map ToolType → UI name |
| `tool-call-completed` | tool_result | success\|error |
| `tool-call-delta` + NestedTaskUpdate | nested task_* / nested content_delta | one-level nest |
| `partial-tool-call` | streaming tool input | `supportsStreamingToolInput: true` |
| `user-message-appended` | confirm user message | |
| `token-delta` | live context meter | optional |
| `summary` / started / completed | compaction UI | P2 |
| `shell-output-delta` | bash-output style | terminal panel |
| `turn-ended` | finalize turn; usage → message_complete | |
| `step-started` / `step-completed` | optional timing | P2 |

### ToolCall type → UI

| ToolType | SuperOne rendering |
|---|---|
| shell | terminal tool card + shell-output stream |
| write / edit / delete | file edit cards |
| read / glob / grep / ls / readLints | read/search cards |
| mcp | MCP tool banner (providerIdentifier + toolName) |
| task | subagent / Task card + nested stream |
| createPlan | plan mode card / plan_approval if needed |
| updateTodos | todo_write / todos UI (`supportsTodos`) |
| generateImage / recordScreen / semSearch | generic tool cards |

### Terminal RunResult

| Field | Mapping |
|---|---|
| status finished | `message_complete` + idle |
| status cancelled | `message_interrupted` |
| status error | `message_error` + RunError.message/code |
| usage | MessageMetadata.usage / contextTokens |
| git.branches[].prUrl | host event or settings patch for PR chip |
| model | selectedModel echo |

### Errors

| CursorSdkError | UX |
|---|---|
| AuthenticationError | re-enter API key |
| RateLimitError | backoff + usage message |
| ConfigurationError | validation toast (bad model) |
| AgentBusyError | disable send / offer interrupt / force |
| AgentNotFoundError | clear providerSessionId / recreate |
| IntegrationNotConnectedError | open helpUrl + connect GitHub |
| NetworkError | offline/retry |
| UnsupportedRunOperationError | disable unsupported op in UI |

---

## SessionBackend surface

### Proposed `CursorBackend` (implements `SessionBackend`)

| SessionBackend method | Cursor SDK mapping | Notes |
|---|---|---|
| `kind` | `'cursor'` | required |
| `start` | `Cursor.configure` once; `Agent.create` or `Agent.resume(providerSessionId)` | local default |
| `rebuild` | close + create/resume with new opts | cwd/model/MCP change |
| `prewarm` | ensure store + optional create idle agent / acquireLocalExecutor | OpenCode-style |
| `send` | `agent.send(msg, { model, mode, mcpServers, onDelta, onStep, local, cloud, idempotencyKey })` then drain stream/wait | single-active-turn guard |
| `interrupt` | `run.cancel()` and/or `Agent.cancelRun` | clear pending |
| `close` | `agent.close()` + `await agent[Symbol.asyncDispose]()` | release store handles |
| `setModel` | next send `{ model: { id, params } }` | SDK updates agent.model after success |
| `setSessionMode` | map to `mode: 'agent'\|'plan'` if modeId matches | else no-op |
| `setPermissionMode` | D7 honest modes only (plan / sandboxed / autoReview); rebuild backend | see architecture |
| `setSandbox` | `local.sandboxOptions.enabled` on rebuild | may need rebuild |
| `setTitle?` | optional Agent name if exposed | no-op ok |
| `respondToPermission` | if no native prompt: resolve host-side tool gate only | pending map may be empty |
| `respondToQuestion` / dismiss | no-op or future elicitation | |
| `respondToPlanApproval` | plan mode exit if product needs | |
| `getContextUsage` | last TokenUsage → ContextUsageInfo | approximate |
| `getMcpServerStatus` | SuperOne MCP manager view / reload state | SDK has no rich status API |
| `authenticateMcp?` | if remote MCP OAuth | optional |
| `rewindFiles` | unsupported result unless checkpoint API used | P2 |
| `reconnectMcp` / `toggleMcpServer` / `reloadMcpServers` | `agent.reload()` + rebuild MCP map | |
| `reloadPlugins` | `reload` if settingSources include plugins | boolean |
| `dequeueMessage` | false | no mid-turn queue unless built |
| `getPendingInteractions` | [] or host permissions | |
| `handleCommand?` | omit unless cursor.* commands appear | |
| `onEvent` / `onProviderSessionId` / `onPermissionModeApplied` | standard | |

### Context usage (D8)

Cursor `TokenUsage` has input/output/cache/reasoning totals but **no context-window limit**. `ModelListItem` also lacks `contextWindow`.  
**Decision:** `getContextUsage` returns **`null`**. UI shows turn / cumulative token counts only. **Do not** invent a percentage from `totalTokens`.

### Auth (D2 — User API Key)

**Official, supported, simple for users.** Not desktop login reuse.

| Item | Detail |
|---|---|
| **Credential** | Cursor **User API Key** (not Team Admin API key for Agent/SDK) |
| **Where users create it** | [cursor.com/dashboard/api](https://cursor.com/dashboard/api) (Dashboard → API Keys). Copy once at create. |
| **SuperOne storage** | Credential vault (`cursor-auth.ts` / provider secret store); never log the key |
| **Injection** | Per-call `AgentOptions.apiKey` / `CursorRequestOptions.apiKey` |
| **Env fallback** | `CURSOR_API_KEY` for dev/CI only — do not rely on process env as the product path |
| **Validate** | CONNECT: `Cursor.me({ apiKey })` + `Cursor.models.list({ apiKey })` |
| **UX CTA** | Settings: “Create a User API Key” deep-link to Dashboard; optional soft hint if Cursor.app is installed (email metadata only — **no token scrape**) |
| **Explicitly rejected** | Reading `cursorAuth/*` from `state.vscdb`, Keychain `cursor-access-token`, or `agent login` session for SDK auth (see `cursor-auth-local-login.md`) |

```
User creates key on Cursor Dashboard
  → paste into SuperOne Settings (Cursor harness)
  → vault encrypt
  → resolveCursorApiKey(session)
  → Agent.create / Cursor.models.list({ apiKey })
```

SDK wire: User API Key → (SDK) `exchange_user_api_key` → access token → agent traffic. SuperOne only holds the User API Key.

**Product copy (honest):**

> SuperOne uses the official Cursor SDK. Create a **User API Key** under Cursor Dashboard → API Keys and paste it here. Being signed into the Cursor desktop app alone is not enough.

### Model list

```
CONNECT_CURSOR → Cursor.models.list({ apiKey }) + Cursor.me({ apiKey })
  → CursorResources { models, user?, repositories? }
  → harness_resource_cache + harnessResources.cursor
  → CursorModelSelector (GroupedModelEffortSelector)
```

`ModelSelection.params` maps SuperOne effort / reasoning params via catalog `parameters[]`.  
Local create **requires** a model selection from this catalog (do not hard-code production models).

### Mode / plan

- Composer/status: agent vs plan → `AgentModeOption`.
- SuperOne plan mode → `mode: 'plan'` on create/send.
- Permission UI: only Plan / Agent (sandboxed) / Agent + Auto-review (D7).

### Resume

- Persist `providerSessionId = agentId`.
- `start` with existing id → `Agent.resume(agentId, { local: { cwd, store }, apiKey, model })`.
- Cloud: `bc-*` + apiKey.

### Artifacts (cloud)

Extend backend (optional methods or IPC):

- `listArtifacts(): Promise<SDKArtifact[]>`
- `downloadArtifact(path): Promise<Buffer>`

Not on `SessionBackend` today — add optional methods or session IPC `cursor:listArtifacts` without polluting the interface until needed.

### Fork

`forkTranscript`:

- If SDK lacks explicit fork API: **checkpoint resume strategy** — new SuperOne session with same `agentId` is wrong; prefer `Agent.create` + optional history inject, or document **no cold fork** (ACP-style UUID) until SDK supports fork.
- Recommended v1: **unsupported error** or weak clone (new agent) with truncated SuperOne transcript only; improve when Cursor exposes fork.

### Zod config (`cursorConfigSchema`)

```ts
z.object({
  apiKey: z.string().optional(), // prefer vault binding over stored key
  credentialId: z.string().optional(),
  model: z.string().optional(),
  mode: z.enum(['agent', 'plan']).optional(),
  runtime: z.enum(['local', 'cloud']).optional().default('local'),
  settingSources: z.array(z.enum(['project','user','team','mdm','plugins','all'])).optional(),
  sandboxEnabled: z.boolean().optional(),
  autoReview: z.boolean().optional(),
  enableAgentRetries: z.boolean().optional(),
  useHttp1ForAgent: z.boolean().optional(),
  // cloud
  cloudEnvType: z.enum(['cloud','pool','machine']).optional(),
  cloudEnvName: z.string().optional(),
  repos: z.array(z.object({
    url: z.string(),
    startingRef: z.string().optional(),
    prUrl: z.string().optional(),
  })).optional(),
  workOnCurrentBranch: z.boolean().optional(),
  autoCreatePR: z.boolean().optional(),
  skipReviewerRequest: z.boolean().optional(),
  // Product default is always better-sqlite3 LocalAgentStore (D5).
  // 'jsonl' reserved for tests / emergency fallback only.
  storeKind: z.enum(['better-sqlite3','jsonl']).optional().default('better-sqlite3'),
}).passthrough()
```

---

## HarnessCapabilities + brand

### Proposed `HARNESS_CAPABILITIES.cursor`

```ts
cursor: {
  supportsMcp: true,                 // mcpServers + custom-user-tools
  supportsPlanMode: true,            // AgentModeOption plan
  supportsTodos: true,               // updateTodos tool
  supportsSubagents: true,           // task tool + agents map
  supportsCompact: false,            // no public /compact; summary deltas only (revisit)
  supportsStreamingToolInput: true,  // partial-tool-call
  displayName: 'Cursor',
}
```

### Brand

```ts
HARNESS_DEFAULT_BRAND_HUE.cursor = 195 // cyan-teal, distinct from opencode(150)/claude(40)/codex(240)/acp(280)
```

Labels: `BrandColorPopover` / session icons — add Cursor label + icon (lobe or simple mark).

### Resources type

```ts
export interface CursorResources {
  models: ModelOption[]           // from Cursor.models.list (+ param metadata)
  user?: { apiKeyName: string; userEmail?: string }
  repositories?: { url: string }[]
  // optional later:
  // agents?: … from Agent.list local
}
```

Add to `HarnessResourcesMap` and `StartupData.cached.cursor`.

---

## IPC / preload deltas

### Required (P0–P1)

| Channel / API | Purpose |
|---|---|
| `AgentIpcChannels.CONNECT_CURSOR` | probe models + me; write harness_resource_cache |
| `preload.connectCursor()` / `AppAPI` | renderer harness handler |
| `StartupData.cached.cursor` | cold start hydrate |
| Widen `sessionProviders.*` harness types to `HarnessId` | listByHarness('cursor') |
| `baseProviderIdForHarness('cursor') → 'cursor-base'` | agent-service |
| Seed migration `cursor-base` | database-migrations |
| `harnessIdFromProviderId` startsWith('cursor') | session-repo |
| `inferProviderFromHarnessId` include cursor | chat-store routing |
| `sendMessage` provider whitelist | include cursor |
| Session reducer branch | add cursor to Claude family |

### Optional (P1–P2)

| Channel | Purpose |
|---|---|
| `cursor:listAgents` / listRuns | advanced session browser |
| `cursor:listArtifacts` / `downloadArtifact` | cloud artifacts |
| `cursor:listRepositories` | cloud create form |
| `cursor:setApiKey` / getAuthStatus | if not using generic credentials |
| `cursor:forceRecover` | LocalSendOptions.force |

### Prefer generic

- `window.agent.sendMessage({ provider: 'cursor', model, effort, … })`
- permission / interrupt / settings IPC already generic
- Avoid Codex-sized parallel `cursor:*` turn APIs

### Renderer

- `harnessHandlers.cursor` — connect/apply like opencode
- `CursorModelSelector` + `CursorPermissionSelector` (OpenCode filtered modes template)
- ChatSuggestions experimental menu entry
- `isExperimentalAgentProvider`: cursor true until GA

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **SDK redistribution / LICENSE** | High | **PR2 Go/No-Go**; legal record before release builds |
| **Native platform packages** missing/wrong arch / bin bits | High | per-arch deps; asarUnpack `bin/**`; afterPack strip; **packaged** smoke |
| **Second SQLite native / wrong driver** | High | Product store = **better-sqlite3 `LocalAgentStore` only**; never npm `sqlite3`; avoid `@cursor/sdk/sqlite` product default |
| **Wrong API key type (Admin vs User)** | Medium | Docs + error copy; only User API Key for Agent |
| **Cloud cost** | Medium | Cloud opt-in; token usage display; default local |
| **settingSources privacy** | Medium | Default `['project']` only; opt-in for user/team/mdm/plugins |
| **Rate limits** | Medium | Map RateLimitError; backoff UI |
| **SDK beta / 1.x churn** | Medium | Pin 1.0.24; thin adapter; fixture tests on .d.ts |
| **AgentBusyError / wedged local runs** | Medium | interrupt + `local.force`; recover UX |
| **No interactive permission prompts** | Medium | Honest mode labels (D7); SuperOne gates custom tools |
| **Fork unsupported** | Medium | Disable cold fork or “new agent” only |
| **HTTP/1 forced → broken streams** | Medium | Default HTTP/2; document middlebox setting risk |
| **Remote protocol lag** | Low | Desktop-first |
| **Transitive CVE / analytics (statsig)** | Medium | Audit; network allowlist |
| **Multi-root cwd** | Low | v1 single cwd = projectPath |

---

## PR plan

Ordered slices for **native `@cursor/sdk`** (D1) with **User API Key auth** (D2).  
Order fix (D9): auth/models are in the same shippable core as local runtime.

### PR1 — Harness skeleton (types + registry + empty backend)

- **Goal:** `HarnessId` includes `cursor`; app typechecks; experimental entry behind flag.
- **Files:** `agent-types.ts` (CursorResources, map, StartupData), `harness-capabilities.ts`, `harness-brand.ts`, `harness-registry.ts`, `database-migrations.ts` (cursor-base), `session-repo.ts` prefix, `agent-service.ts` baseProviderId, registry tests.
- **Tests:** harness-registry, capabilities/brand, session-repo prefix.
- **Deps:** none.
- **Out-of-scope:** real SDK calls.

### PR2 — SDK dependency + packaging + license gate + better-sqlite store skeleton

- **Go/No-Go:** written approval to redistribute `@cursor/sdk` + platform binaries in Electron (commercial use, updates, telemetry, sandbox/rg binaries). If no → stop and redesign (user-installed SDK path).
- **Goal:** Depend on `@cursor/sdk@1.0.24`; stage platform optionalDeps; asarUnpack natives + `bin/**`; afterPack strip wrong arch; **`BetterSqliteLocalAgentStore` skeleton** (open DB, migrations, agents substore MVP); packaged smoke checklist.
- **Files:** desktop package.json, electron-builder, `afterPack.cjs`, `cursor-store.ts`, `cursor-store-schema.ts`.
- **Tests:** store unit (agents create/list/delete); packaging smoke checklist.
- **Deps:** PR1 + legal sign-off for release packaging.
- **Out-of-scope:** chat UX; full runEvents parity can land with PR3 if needed for resume.

### PR3 — Auth + models + local CursorBackend core (shippable)

- **Goal:** User API Key in vault; CONNECT (`Cursor.me` + `models.list`); local create/send/interrupt/close with **text stream** (`onDelta` exclusive) using **better-sqlite3 store**; reducer joins Claude family.
- **Files:** `cursor-auth.ts`, `cursor-client.ts`, CONNECT_CURSOR, preload, `cursor-runtime.ts`, `cursor-backend.ts`, `cursor-event-map.ts` (text + status + turn-ended), complete store substores as required by resume, session reducer `cursor` branch, settings key UI (minimal), DI factory.
- **Tests:** auth resolve (no key / bad key); store contract for resume; backend unit with fake runtime; event-map fixtures; integration send with mock Agent.
- **Deps:** PR2.
- **Out-of-scope:** polished model picker (PR4), cloud, MCP, images, full tool cards.

### PR4 — Model selector UI + settings polish

- **Goal:** Grouped model/effort picker, CONNECT cache UX, clearer Settings CTA to Dashboard API Keys.
- **Files:** CursorModelSelector, harness handler polish, error → auth UI.
- **Tests:** selector unit; probe cache.
- **Deps:** PR3.
- **Out-of-scope:** cloud repos.

### PR5 — Full stream map (thinking, tools, shell-output, usage, partial tools)

- **Goal:** Tool cards + thinking + usage parity with OpenCode; enforce D6 exclusivity.
- **Files:** event-map expansion, tool type labels, truncation badges.
- **Tests:** fixture per InteractionUpdate variant + SDKMessage lifecycle-only path.
- **Deps:** PR3.
- **Out-of-scope:** nested task tree polish.

### PR6 — Plan mode + honest permission mapping + busy/force recovery

- **Goal:** plan \| agent (sandboxed) \| agent+autoReview only (D7); AgentBusyError + `local.force`.
- **Files:** Cursor mode selector, rebuild-on-sandbox-change, recovery action.
- **Tests:** mode mapping; busy policy; rebuild scheduling.
- **Deps:** PR3–4.
- **Out-of-scope:** Claude-style form permission.

### PR7 — MCP attach + reload

- **Goal:** Map SuperOne MCP configs → `mcpServers`; reload via `agent.reload`.
- **Files:** mcp converter, backend MCP methods, settings.
- **Tests:** stdio/http config conversion; cloud cwd strip unit.
- **Deps:** PR3.
- **Out-of-scope:** OAuth polish.

### PR8 — Multimodal images + idempotency + resume/rebuild

- **Goal:** images on send; resume by agentId; rebuild on cwd/config.
- **Files:** SDKUserMessage mapping, start resume path, session lifecycle.
- **Tests:** resume integration; image payload.
- **Deps:** PR3–4.
- **Out-of-scope:** fork perfection.

### PR9 — Custom tools (local) + todos/task subagent UI

- **Goal:** SuperOne host tools as `customTools`; task/nested updates; updateTodos → todos UI.
- **Files:** custom tool bridge, event-map task/nested, agents map config optional.
- **Tests:** custom tool execute; nested delta fixture.
- **Deps:** PR5, PR7.
- **Out-of-scope:** full subagent manager UI.

### PR10 — Cloud runtime (create/list/get/archive/delete/cancel) + git/PR outcome

- **Goal:** Dual runtime cloud path with `bc-` routing; PR URL from `Run.wait().git`.
- **Files:** cloud options UI/config, backend cloud branch, PR chip, IntegrationNotConnectedError CTA.
- **Tests:** routing unit; mock cloud facade.
- **Deps:** PR4, PR8.
- **Out-of-scope:** pool/machine advanced UX.

### PR11 — Cloud artifacts + repositories list

- **Goal:** list/download artifacts; repo picker for cloud create.
- **Files:** IPC artifacts/repos, simple panel.
- **Tests:** IPC handlers with mocks.
- **Deps:** PR10.
- **Out-of-scope:** full artifact browser polish.

### PR12 — Agent.list / listRuns / messages.list host APIs + session picker

- **Goal:** Browse local/cloud agents and runs; optional history hydrate.
- **Files:** IPC list*, UI drawer optional.
- **Tests:** pagination.
- **Deps:** PR3, PR10.
- **Out-of-scope:** replace SuperOne session DB.

### PR13 — Fork + rewind investigation

- **Goal:** Best-effort forkTranscript; document limits; optional checkpoint rewind.
- **Files:** cursor-fork.ts, rewindFiles unsupported or partial.
- **Tests:** fork session-manager path.
- **Deps:** PR8.
- **Out-of-scope:** perfect Claude-like fork.

### PR14 — Platform-advanced opt-in (createAgentPlatform / notifiers) + multi-window

- **Goal:** Host API for advanced embeds; Unix notifier optional.
- **Files:** cursor-platform.ts experimental.
- **Tests:** unit with InMemory notifier.
- **Deps:** PR2, PR12.
- **Out-of-scope:** default path change.

### PR15 — Remote/mobile + usage-stats + polish

- **Goal:** Widen RemoteCommand provider to HarnessId; usage-stats HarnessKind; icons/i18n/experimental GA flag.
- **Files:** agent-types remote unions, usage-stats-service, UI labels, i18n.
- **Tests:** remote protocol, usage writers.
- **Deps:** PR3–6 minimum.
- **Out-of-scope:** full mobile feature parity.

### P3 explicit deferrals (not required for “near-full public coverage”)

- Direct `CloudApiClient` / `createCloudExecutor` / `cloud-agent` free functions
- `RunEventTailer`, `writeFileAtomic`, record conversion helpers
- `createDefaultAgent` family deep imports
- In-memory store deep imports except tests
- Agent.prompt as primary UX
- SqliteLocalAgentStore / `node:sqlite` production default (we use better-sqlite3 instead)
- npm `sqlite3` dependency
- JsonlLocalAgentStore as product default (tests only)
- Full `createAgentPlatform` as default host (keep Agent facade)

**PR count:** 15

---

## Open questions

### Resolved

| # | Question | Resolution |
|---|---|---|
| Q1 | API key product model | **User Cursor User API Key** in SuperOne vault (D2). No SuperOne proxy; no desktop scrape. |
| Q3 | Permission UX honesty | **Yes** — only Plan / Agent sandboxed / Agent+Auto-review (D7). |
| Q6 | Electron Node ≥ 22.13? | **Yes** — Electron 41.5 / Node 24.15. Soft assert only. |
| Q9 | Cost/usage display | **Tokens only** (D8); no fake context %. |
| Q10 | License compliance | **PR2 Go/No-Go** (D10) — not optional research. |
| — | Integration path | **Native `@cursor/sdk`** (D1). |

### Still open (non-blocking for PR1–3)

1. **settingSources default:** `project` only (recommended) vs `project+user` for IDE parity?
2. **Fork:** disable / weak new agent / wait for SDK fork?
3. **Experimental vs GA:** hide behind experimental flag until which PR (suggest: after PR5–6)?
4. **Cloud default:** hidden until user enables “Cursor Cloud Agents”?
5. **Custom tools scope:** which SuperOne tools inject as `customTools` (browser, miniapp, …)?
6. **Utility process:** stay in Electron main vs Helmor-style Node worker if streaming regresses?

---

## Appendix A — Verified SuperOne extension checklist

When implementing, touch **all** of:

1. `HarnessResourcesMap` + `CursorResources`
2. `HARNESS_CAPABILITIES.cursor` + brand hue
3. `harness-registry` entry + tests
4. `seedBaseSessionProviders` → `cursor-base`
5. `harnessIdFromProviderId` / `deriveHarnessId`
6. `baseProviderIdForHarness`
7. `Session.applyReducer` Claude-family branch
8. CONNECT_CURSOR + StartupData + harness handler
9. `inferProviderFromHarnessId` + send whitelist + experimental menu
10. ModelSelector / StatusBarPermission branches
11. electron-builder native packages + better-sqlite3 LocalAgentStore

## Appendix B — SDK public facade quick reference (1.0.24)

```
Agent.create / resume / prompt / list / listRuns / getRun / cancelRun
Agent.get / archive / unarchive / delete / messages.list
SDKAgent.send / close / reload / asyncDispose / listArtifacts / downloadArtifact
Run.stream / wait / cancel / conversation / supports / onDidChangeStatus
Cursor.configure / me / models.list / repositories.list
createAgentPlatform / CursorAgentPlatform
LocalAgentStore interface / JsonlLocalAgentStore (fallback) / composeLocalAgentStore
@cursor/sdk/sqlite → node:sqlite (not product path)
SuperOne: BetterSqliteLocalAgentStore on better-sqlite3 (product path, D5)
configureCursorSdk
Run event notifiers (in-memory + local Unix)
Error hierarchy: CursorSdkError → …
```

Auth: User API Key via vault; optional env `CURSOR_API_KEY` for dev.  
Store: better-sqlite3 custom LocalAgentStore (D5).  
Routing: agentId `bc-*` → cloud; else local store (local CRUD still probe-gated).

## Appendix C — Coverage method (qualitative)

The capability tables in this doc are a **qualitative** host map for planning (D11).  
Catalog agents previously reported large raw lists (~379 lines); those are **not** a reproducible coverage percentage. Before claiming metrics:

1. Export stable capability ids from the matrix (or regenerate from `.cache/cursor-sdk` types).
2. Add a small script that counts `priority ∈ {P0,P1,P2}` vs deferred/na.
3. Only then publish a percentage.

Until then: “near-full public API **plan** with explicit P3 deferrals” — not a measured %.

## Appendix D — Related research notes

| Note | Topic |
|---|---|
| `docs/temp/research/cursor-auth-local-login.md` | Why desktop login ≠ SDK auth; User API Key path |
| `docs/temp/research/cursor-all-in-one-competitors.md` | Helmor/Paseo/etc. Cursor integration landscape |

---

*End of design. Decisions locked 2026-07-25. Types source of truth: `.cache/cursor-sdk/package` @ 1.0.24; SuperOne session harness files as of same date.*
