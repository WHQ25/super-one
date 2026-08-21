# Per-Experience Touchpoints

Use this when a harness needs to catch up on **one** capability. Find the row, do every cell in it.
Paths are relative to repo root; `R/` = `apps/desktop/src/renderer/src/`, `M/` = `apps/desktop/src/main/`.

The completeness bar is **Claude / Codex / Grok** (`SKILL.md`). Matrix columns for those three
are the spec; OpenCode / Cursor / dsh are gap audits against that spec, not models to copy.

The support column reflects what was true when this was written — **verify before quoting it**, and
update this file when you change it. `HARNESS_CAPABILITIES` is the machine-readable version of the
same claim, and the two drift.

## Contents

- [Support matrix](#matrix)
- [1. Model / effort / mode selection](#models)
- [2. Permission modes & HITL](#permission)
- [3. Sandbox](#sandbox)
- [4. Plan mode](#plan)
- [5. Slash commands, skills, mentions](#slash)
- [6. Todos & subagents](#todos)
- [7. MCP](#mcp)
- [8. Context usage, rate limits, cost](#usage)
- [8b. Turn failure reporting](#errors)
- [9. Fork, rewind, checkpoints](#fork)
- [10. Identity: icon, hue, label, ordering](#identity)
- [11. Install catalog, auth, visibility](#install)
- [12. Automation & collaboration](#automation)
- [13. Remote node & mobile](#remote)

---

<a id="matrix"></a>
## Support matrix

| Experience | claude | codex | acp (grok) | opencode | cursor | dsh (DeepSeek) |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| MCP | ✅ | ✅ host-injected | ✅ host-injected | ✅ | ✅ | ❌ |
| Plan mode | ✅ host | ✅ | ✅ agent-driven | ✅ | ✅ | ❌ |
| Todos | ✅ | ❌ | ✅ via plan entries | ✅ | ✅ | ✅ |
| Subagents | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ |
| Compact | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Streaming tool input | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Sandbox toggle | ✅ off/on/auto | folded into presets | ❌ | ❌ | ✅ off/on | ❌ |
| Slash commands | ✅ | ✅ | ✅ | ✅ | host + `.cursor` FS | ❌ |
| Session recap | ❌ | ❌ | ✅ grok only | ❌ | ❌ | ❌ |
| Steer mid-turn | — | ✅ | ❌ queue only | — | — | — |
| Typed failure code | ✅ SDK enum | ⚠️ text + retry count | ⚠️ JSON-RPC code + status | ⚠️ SDK error name | ⚠️ text only | ⚠️ text only |

---

<a id="models"></a>
## 1. Model / effort / mode selection

The chat bar's model control is per-harness by construction: each harness has its own catalog source,
its own notion of "effort", and its own persistence.

| Cell | File |
|---|---|
| Selector dispatch | `R/components/chat/ModelSelector.tsx` |
| Your selector | `R/components/chat/model-selector/<Harness>ModelSelector.tsx` |
| Grouped model+effort UI (reusable) | `R/components/chat/model-selector/GroupedModelEffortSelector.tsx` |
| Provider list for the picker | `R/components/chat/model-selector/useSelectorProviders.ts` |
| Resource fetch + apply | `R/stores/chat-store/harness/<harness>-handler.ts` |
| Per-session model state | `R/stores/chat-store/types.ts` (`PerSessionState`), `defaults.ts` |
| Default on session create | `R/stores/chat-store/helpers/session-lifecycle.ts` (per-provider branch), `helpers/agent-defaults.ts` |
| Apply to a live session | `SessionBackend.setModel()` / `setSessionMode()` |
| Disk cache of the catalog | `M/harness/resource-cache.ts` |
| Enable/disable subset + prefs | `R/stores/chat-store/helpers/<harness>-model-prefs.ts` (Cursor pattern) |

Notes that bite:
- **"Effort" is not universal.** Claude/Codex have reasoning effort; ACP models it as a session config
  option; Cursor exposes model params. Don't force a shared effort enum onto a harness that lacks one —
  mapped third-party providers deliberately show no effort picker, and that is by design.
- **ACP derives models from `configOptions`**, with `extraModels`/`extraModes` for agents (Grok) that
  put them elsewhere. `acp-handler.ts` `sessionCatalogFromConfig()` is the whole story.
- A model id ending in `[1m]` means the 1M-context variant (a Claude Code convention), surfaced as an
  optional toggle only when the catalog says the model supports it.

---

<a id="permission"></a>
## 2. Permission modes & HITL

The shared `PermissionMode` enum (`default` / `acceptEdits` / `plan` / `bypassPermissions`) is a
lowest-common-denominator wire type. Each harness maps it onto its own vocabulary, and the mapping
must be declared in **three** places or the status bar and the popover will disagree.

| Cell | File |
|---|---|
| Mode vocabulary | `R/components/chat/<harness>PermissionModes.ts` |
| Mode list UI | `R/components/chat/<Harness>PermissionModeList.tsx` |
| Selector | `R/components/chat/<Harness>PermissionSelector.tsx` |
| **Popover dispatch** | `R/components/chat/HarnessPermissionPopover.tsx` |
| **Status bar label** | `R/components/chat/chat-status-bar/StatusBarPermission.tsx` |
| Available modes per provider | `R/stores/chat-store/helpers/interaction.ts` (~line 635) |
| Default mode on create | `R/stores/chat-store/helpers/session-lifecycle.ts` |
| Backend round-trip | `SessionBackend.setPermissionMode()` + `onPermissionModeApplied()` |

The request/response side (`permission_request` → `respondToPermission`) needs **no** new UI —
`PermissionPrompt.tsx` renders any harness's request once the event shape is right. Same for
`ask_user_question`. That's the payoff of the shared union; see `event-contract.md`.

`onPermissionModeApplied` exists because some harnesses can't honour a mode change immediately (or at
all). Emit it with what actually took effect, not what was requested — the UI trusts it.

---

<a id="sandbox"></a>
## 3. Sandbox

Sandbox is a **separate axis** from permission mode, and only some harnesses have one.

| Cell | File |
|---|---|
| Does this harness have a sandbox, and which modes | `R/components/chat/sandboxHarness.ts` |
| Selector | `R/components/chat/SandboxModeSelector.tsx` |
| Status bar | `R/components/chat/chat-status-bar/StatusBarSandbox.tsx` |
| Backend | `SessionBackend.setSandbox(SandboxInfo)`, `BackendStartOptions.sandboxInfo` |

`sandboxHarness.ts` carries three decisions: whether the control exists (`harnessSupportsSandbox`),
which modes (`harnessSandboxModes` — Cursor has no `auto`), and how to coerce a stored mode the
harness can't express (`coerceSandboxModeForHarness`). A harness that folds sandbox into permission
presets (Codex) returns `false` and offers nothing — that's the correct answer, not a gap.

Cursor's SDK locates `cursorsandbox` by walking from `argv[1]` / `execPath` and throws if
`sandboxOptions.enabled` is true but the helper is missing (Windows always throws — proxy-only).
SuperOne remaps `argv[1]` to the platform package during `Agent.create` / `resume`
(`packages/cursor/src/cursor-platform-binaries.ts`) and retries unsandboxed if the SDK still rejects.

---

<a id="plan"></a>
## 4. Plan mode

Two genuinely different protocols share one UI:

- **Host-driven** (Claude): the host sets `permissionMode: 'plan'`, the agent produces a plan, the
  host renders approval, approval flips the mode back.
- **Agent-driven** (Grok/ACP via `x.ai/exit_plan_mode`, Codex): the agent decides it's done planning
  and asks. The host only responds.

| Cell | File |
|---|---|
| Approval prompt | `R/components/chat/PlanApprovalPrompt.tsx` (shared) |
| Event | `plan_approval` → `SessionBackend.respondToPlanApproval()` |
| Codex-specific path | `codex_plan_approval` event + `BackendCommand{kind:'codex.plan_approval'}` |
| Mode flip after approval | `chat-store` `respondToPlanApproval` → `setPermissionMode` IPC |

Set `supportsPlanMode` only when approve **and** reject both change what the agent does next.

---

<a id="slash"></a>
## 5. Slash commands, skills, mentions

| Cell | File |
|---|---|
| Catalog dispatch | `R/components/chat/chat-input/resolveSlashCommandsForProvider.ts` |
| Popups | `R/components/chat/{ProviderSlashPopup,McpSlashPopup,WorkflowsSlashPopup}.tsx` |
| Placeholder text | `R/components/chat/chat-input/resolveChatInputPlaceholder.ts` |
| Localized placeholder keys | `packages/shared/src/i18n/{en,zh}.ts` — ask and plan copy for every harness |
| Mentions + capability gating | `R/components/chat/mention-capability-match.ts`, `MentionPopup.tsx` |
| Source of the catalog | `init_ready` event (`skills`, `projectCommands`, `projectAgents`) or the harness's own list (ACP `available_commands_update` cached in `AcpAgentConfigCatalog.slashCommands`) |
| Regression tests | `R/components/chat/chat-input/{resolveChatInputPlaceholder,resolveSlashCommandsForProvider}.test.ts` |

Both dispatches must be exhaustive over `ChatProvider`; do not add a `default` branch. A harness must
**never** fall through to Claude's placeholder or project-level skills. Cursor lists host `/mcp`
`/clear` plus scanned `.cursor/skills` and `.cursor/commands` — never Claude's catalog. A harness
without slash support still needs an explicit empty catalog. Otherwise the UI advertises commands
that will not run, and a new harness appears to speak Claude's vocabulary without any type error.

---

<a id="todos"></a>
## 6. Todos & subagents

Both are pure event-driven — no per-harness UI, only the capability flag and the events.

| Cell | Contract |
|---|---|
| Todos | emit `todos_updated`, set `supportsTodos` |
| Subagents | emit `task_started` + tool blocks carrying `parentToolUseId`, set `supportsSubagents` |

Subagent nesting is rebuilt from `parentToolUseId` **recursively** — a single-level grouping leaks
deep agents' output into the parent. Running-state is decided solely by
`taskProgress.completed !== true`; background tasks routinely have empty input and
`isStreaming === false`, so don't infer from those.

---

<a id="mcp"></a>
## 7. MCP

Host SuperOne tools are required at P2 for a complete harness. Injection recipes (Claude SDK
server / Codex HTTP `mcp_servers.superone` / Grok `session/new`) live in `SKILL.md` — do not
fork a fourth shape without a reason.

| Cell | File |
|---|---|
| Panel data | `SessionBackend.getMcpServerStatus()` |
| Controls | `reconnectMcp` / `toggleMcpServer` / `reloadMcpServers` / `authenticateMcp?` |
| Host MCP injection | `M/mcp/superone-mcp-server.ts`; Claude: `M/agent/claude-query.ts`; Codex: thread `mcp_servers`; Grok: `M/acp/acp-mcp.ts` `session/new` |
| Tool kind → existing ToolBlock | event mapper + `packages/shared/src/tool-ui.ts` (ACP: `M/acp/acp-event-map.ts`) |
| Settings registry | `M/mcp/settings-registry.ts` |

Two things that have burned time: Codex snapshots `tools/list` **once** and ignores
`list_changed`, so everything must be registered before its handshake; and Codex elicitation carries
no tool arguments, so the tool name is scraped from prompt text. A successful call that still
renders as generic `use tool` is not done.

---

<a id="usage"></a>
## 8. Context usage, rate limits, cost

| Cell | File |
|---|---|
| Context gauge | `R/components/chat/ContextUsage.tsx` + `SessionBackend.getContextUsage()` |
| Account limits gauge | `SessionBackend.getRateLimits?()` — optional, omit when the provider has none |
| Per-turn accounting | `message_usage` event (tokens, cost, contextWindow) |
| Usage page | `M/usage-stats-service.ts` (`HarnessKind`, provider→kind mapping), `R/components/UsagePage.tsx`, `R/components/usage-model-presentation.ts` |

`HarnessKind` in `usage-stats-service.ts` is **not** `HarnessId` — it splits ACP into `grok`. Adding a
harness id without adding a `HarnessKind` gives a permanently empty usage row with no error.

---

<a id="errors"></a>
## 8b. Turn failure reporting

A failed turn renders as a footer badge whose title is plain language ("Service Busy") and whose
popover explains the next step. The badge is **harness-neutral and already works everywhere** —
`reduceLifecycle` synthesizes `{ raw: event.error }` for any harness that sends only a string. What
varies per harness is how good the classification is, so the gap is never "no UI", it is always
"badge says Request Failed when it could say Sign-in Expired".

| Cell | File |
|---|---|
| Event payload | `message_error` carries `errorInfo?: AgentErrorInfo` (`packages/shared/src/agent-types.ts`) |
| Shared classifier | `packages/shared/src/agent-error.ts` — `buildAgentErrorInfo(raw, overrides)`; explicit overrides always beat the text regex |
| Renderer state | `R/stores/chat-store/event-reducer/lifecycle.ts` → `metadata.errorInfo` (no text block) |
| **Persistence** | `M/agent/claude-session-runtime.ts` (claude/acp/opencode/cursor) **and** the codex branch of `M/session/session.ts` (codex/dsh) — two reducers, both must store it |
| Presentation | `R/components/chat/agent-error-presentation.ts` (code→kind), `MessageErrorBadge.tsx`, i18n `chat.error.title.*` / `chat.error.hint.*` |
| Mobile | `stripMessagesForRemote` in `M/remote-control-service.ts` re-materializes the raw text — mobile has no badge |

Per-harness sources, all funnelled through `buildAgentErrorInfo`:

| Harness | Structured signal | Where |
|---|---|---|
| claude | `assistant.error` enum, `api_error_status`, `terminal_reason`, `system/api_retry` ladder | `M/agent/claude-query.ts` |
| codex | error text + `willRetry` flag counted into `retries.attempts` | `packages/codex/src/agent-event-mapper.ts` |
| acp | JSON-RPC code (`-32003` = rate limit) + the HTTP status inside `API error (status NNN)` | `M/acp/acp-request-error.ts` → `describeAcpRequestFailure()` |
| opencode | `error.name` (`ProviderAuthError`, `MessageOutputLengthError`) | `packages/opencode/src/agent-event-mapper.ts` |
| cursor / dsh / remote node | text only | their event maps + `packages/shared/src/node-session-event-map.ts` |

Traps:

- **Two persistence reducers.** The renderer reducer only feeds the UI; the DB is written by the
  main-process reducer, and `dsh` shares Codex's, not Claude's. Change one and the badge is right
  live but gone after reload — a class of bug no unit test catches. Assert on `session.snapshot`.
- **Never guess a label.** A wrong badge tells the user to do the wrong thing, so an unrecognized
  failure must fall through to `unknown`, which leads with the raw text. Do not map an abort or a
  cancel onto a request-rejected code.
- **Anchor status parsing.** A bare `\d{3}` matches version strings and byte counts; require a
  `status`/`http`/`code` keyword or a following status phrase.
- **`retries` must survive a harness with no delays.** Claude reports a backoff ladder, Codex only a
  count — hence `retries: { attempts, delaysMs?, max? }` rather than a bare array.

---

<a id="fork"></a>
## 9. Fork, rewind, checkpoints

| Cell | File |
|---|---|
| Fork | `M/session/backends/<harness>-fork.ts`, registered as `Harness.forkTranscript`, driven by `M/session/session-fork.ts` |
| File rewind | `SessionBackend.rewindFiles()` |
| Checkpoints | `checkpoint_captured` event |

Fork semantics differ sharply: Claude resume is cwd-scoped so forking into a worktree needs
`forkSession()` plus relocating the `.jsonl`; Codex uses `thread/fork` + `lastTurnId` from
`metadata.codex` with a `rollback` fallback for older sessions. Read the existing `*-fork.ts` before
designing yours — "copy the transcript" is almost never right.

`rewind_conversation` in the Claude SDK is still a placeholder; the current rewind is cosmetic.

---

<a id="identity"></a>
## 10. Identity: icon, hue, label, ordering

Cheap individually, and *always* the last thing anyone remembers.

| Cell | File |
|---|---|
| Icon component | `packages/ui/src/components/harness/<Harness>SessionIcon.tsx` |
| Official brand assets | `@lobehub/icons` first (`<Harness>`, `.Color`, `.Text`); add it to the importing package's dependency manifest rather than relying on workspace hoisting |
| Icon resolution (2 paths!) | `R/components/harness/resolve-session-icon.tsx` — both `resolveSessionIcon()` **and** `resolveSessionIconFromBrandKey()` |
| Brand hue + tokens | `packages/shared/src/harness/harness-brand.ts` |
| Hue picker label | `R/components/sidebar/BrandColorPopover.tsx` |
| Suggestion ordering | `R/lib/suggestion-harness-order.ts`, `R/components/chat/ChatSuggestions.tsx` |
| Order validation + persistence | `M/app-settings-service.ts` — `HARNESS_IDS`, `parseSuggestionHarnessKey`, `isHarnessOrderKey`, `readHarnessOrder`, default/secondary derivation |
| Harness settings catalog | `R/components/HarnessesSettingsPage.tsx` — exhaustive `CATALOG_HARNESS_META` over `NODE_HARNESS_IDS` |
| Session create menu | `R/lib/session-menu-items.ts` |
| Onboarding | `R/components/onboarding/OnboardingDiscover.tsx` |
| Strings | `packages/shared/src/i18n/{en,zh}.ts` — **both** |
| Regression tests | `M/app-settings-service.test.ts`, `R/lib/suggestion-harness-order.test.ts`, `R/components/HarnessesSettingsPage.test.tsx` |

Brand hue only applies in light mode by design; dark mode never reads it. Non-React consumers must
stamp the hue explicitly at their entry CSS (default 240).

The renderer's drag list and the main process do not share one validator. A new key can render and
move optimistically, then be removed by `readHarnessOrder()` during `saveAppSettings()`. The returned
settings and `APP_SETTINGS_CHANGED` broadcast immediately replace renderer state, so the row snaps
back with no error. Treat persistence as part of identity: test the new key in object form, string
form, and a full `harnessOrder` read/save round trip.

For session icons, reuse the official LobeHub mark when it exists. `HarnessIconFallback` supplies
running/background/unseen/automation chrome around a static mark; the glyph itself should not be a
generic Lucide placeholder. Use `.Color` when the product calls for the brand-colored mark and
`.Text` for settings detail headers.

---

<a id="install"></a>
## 11. Install catalog, auth, visibility

| Cell | File |
|---|---|
| Catalog identity | `packages/shared/src/environment/harness-installation.ts` (`NodeHarnessId`, `NODE_HARNESS_DEFINITIONS`) |
| Base SessionProvider identity | `packages/shared/src/session-provider-definitions.ts`; desktop `M/database-migrations.ts`; node `packages/runtime/src/{db/database.ts,session/session-provider-store.ts}` |
| Runtime resolution | `M/harness/{host,resolve-runtime,scan-cli,bundled-fallback,tarball-installer}.ts` |
| Enable / readiness | `packages/runtime/src/harness/{enable,runtime-ready}.ts` |
| Settings UI | `R/components/HarnessesSettingsPage.tsx` — add exhaustive catalog metadata and cover enabled/disabled rendering in its test |
| Auth UI | `R/components/<Harness>AuthSettings.tsx`, `AppSettingsPage.tsx` |
| **Visibility gate** | `R/lib/harness-visibility.ts` |

`NodeHarnessId` (`acp-grok`) and `HarnessId` (`acp`) are different id spaces — convert with
`normalizeSessionHarnessId` / `nodeHarnessIdToSessionHarnessId`, never compare directly.

Visibility fails closed: a null catalog means "not enabled". A harness absent from
`NODE_HARNESS_DEFINITIONS` is invisible in every picker with no error anywhere. This is the first
thing to check when a newly added harness "doesn't show up".

Diagnostics are allowlisted codes only (`HARNESS_DIAGNOSTIC_CODES`) — never surface raw provider
error text, it leaks credentials.

The install catalog and SessionProvider catalog are independent. A harness can be enabled, visible,
and constructible while its first send still fails because `<harness>-base` was never seeded. Test
the base row in both desktop and runtime databases. For id renames, migrate the provider catalog,
session rows, and installation rows together while keeping an explicit read alias for old data.

---

<a id="automation"></a>
## 12. Automation & collaboration

| Cell | File |
|---|---|
| Run config type | `packages/shared/src/agent-types.ts` (`ClaudeRunConfig` / `CodexRunConfig` / …) |
| Tool-side parse + defaults | `M/mcp/automation-tools.ts` |
| Dialog | `R/components/AutomationDialog.tsx`, `R/components/chat/AutomationConfirmPrompt.tsx` |
| Session collaboration | `M/session/session-collaboration.ts`, `R/components/chat/model-selector/useCollabLaunchModelSelector.tsx`, `SessionAgentsConfirmPrompt.tsx` |

HITL confirmation for host-owned tools must resolve at the **Session** layer to work across all
harnesses — an executor-level confirm only covers Claude and Codex.

---

<a id="remote"></a>
## 13. Remote node & mobile

| Cell | File |
|---|---|
| CLI harness surface | `apps/cli/src/session/{harness-cli,harness-enable,harness-host,harness-runners}.ts` |
| Real runner | `packages/<harness>/src/` (`create<Harness>TurnRunner`) |
| Capability advertisement | `packages/shared/src/environment/capabilities.ts`, `readySessionHarnessIds()` |
| Mobile | shared `AgentEvent` stream — mostly free |

Simulated runners exist so parity tests can run without provider CLIs. They must be unreachable in
production: `createAcpOpenCodeProductionRouter` requires an explicit `allowSimulatedFallback: true`,
and `undefined`/`false` both fail closed. Never relax that.

Mobile strips tool input and truncates results to ~200 chars; a harness emitting rich tool payloads
needs an explicit exemption or the mobile view degrades silently.
