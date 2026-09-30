# MCP Apps Host

Status: planned · Updated: 2026-10-01
Goal: host third-party MCP Apps UI, first for Codex on desktop, on a contract that later carries every harness, the remote node and mobile.
Proposal: [mcp-apps.md](../proposals/mcp-apps.md)
Long-term docs affected: `docs/architecture/chat-core.md` (tool app attachment), `docs/harness/codex/{api-surface,backlog}.md`, `docs/harness/claude/backlog.md`, a new `docs/features/mcp-apps.md`

## Phase 0 — unblock (spikes; each ends in a written verdict here)

| # | Spike | Pass criteria |
|---|---|---|
| 0.1 | Pin versions | Choose ext-apps 2.x (+ MCP SDK 2.x for `app-bridge` only) or the last SDK-1.x-compatible release; `AppBridge` builds in the renderer and `packages/chat-view`. |
| 0.2 | Fixture server | Local HTTP MCP server with model-only / app-only / default-visibility tools, private `_meta`, `structuredContent` with `outputSchema`, an `isError` result, one auth-rejecting tool, a slow tool for cancel, identical concurrent calls, out-of-order results. Lives with desktop test fixtures. |
| 0.3 | Codex wire check | Against 0.159 with the fixture: extension reaches server `initialize`; app-only tool hidden from the model; `mcpAppUi` + full result on the item (`appContext` may be null); `resource/read` and `tool/call` with `threadId`. Confirm the node-side protocol path for remote projects; the RPC round trip itself is accepted in phase 1. |
| 0.4 | Desktop iframe security | `superone-mcp-app://` iframe: cannot reach `parent`, cannot navigate top or open popups, form submission blocked by `form-action 'none'`, cross-origin new-document navigation blocked before the request, same-document routing kept, a new document revokes the bridge, `local-file` / `superone-app` handlers refuse this origin, CSP header blocks undeclared origins, StrictMode double mount leaves one bridge. |
| 0.5 | Mobile child frame | iOS + Android: nested `srcdoc` frame cannot call the RN bridge directly; meta CSP (incl. `form-action 'none'`) applied before first script. |
| 0.6 | Claude | **Done 2026-10-01 — native, with a gated `mcp_call` adapter.** Findings in [Claude track](#claude-track-phase-2). |
| 0.7 | Gateway call id | On one gateway harness (OpenCode plugin hook or dsh `callId`), try to pass the harness call id into the upstream request `_meta`. Verdict per harness: attached / adjacent block. An adjacent verdict does not block phase 1. |

## Phase 1 — Codex, desktop, public server, inline

1. **Shared contract** (`packages/shared`): `ToolAppAttachment`, `McpAppsProvider`, structured errors; `AgentEvent` + persistence carry the attachment; mobile event stripping exempts it.
2. **Codex provider** (`packages/codex`, `CodexBackend`): send the UI extension at `initialize` (`app-server-connection.ts`, `app-server-client.ts`); map `mcpAppUi` / `appContext` in `agent-event-mapper.ts` and `codex-turn.ts`; implement `readResource` / `callTool` with thread routing; delete the unused `CODEX_MCP_RESOURCE_READ` / `CODEX_MCP_TOOL_CALL` IPC and `window.app` methods. Exposed through environment RPC, not local-only IPC; acceptance includes one remote-project round trip.
3. **Scheme + CSP** (`apps/desktop/src/main`): `superone-mcp-app://` handler serving registered snapshots only, per-directive CSP builder with origin parsing, handler audit from 0.4.
4. **View host** (renderer): `McpAppView` in the tool row with `AppBridge`, theme variable map, size, teardown; activation gate for restored Views; text fallback when no attachment.
5. **Executor**: `tools/call` visibility + approval, `resources/read`, `ui/message` (per-message confirm, queue, receipt, loop cap), `ui/update-model-context` (per-View context entry in the original session), `ui/open-link`.
6. **Docs**: harness docs and backlog rows; feature doc.

Acceptance: with the fixture and one real public Apps server — model calls the tool → View renders → click → View calls an app-only tool → View updates → `update-model-context` → next turn reflects the selection; after app restart the View paints and makes **no** backend call until activated; unsupported harnesses show the text result.

Tests: Vitest for the CSP builder, visibility/approval executor, mapper, attachment persistence; Storybook stories for `McpAppView` (loading, error, auth required, restored-inactive, long content, narrow, light/dark).

## Claude track (phase 2)

### Spike 0.6 findings

Claude Agent SDK 0.3.285 / Claude Code 2.1.285, stdio fixture, desktop, a
real Haiku turn. Script kept locally in `docs/temp/` (not committed).

| Question | Result |
|---|---|
| UI extension in `initialize` | Sent only when `CLAUDE_CODE_MCP_APPS_HOST=true` is in the **spawn env** (`Options.env`). The same key in SDK `settings.env` has no effect. The CLI also probes `server/discover` (MCP 2026-07-28) before `initialize`. |
| Tool UI metadata | `mcpServerStatus()` returns each tool's `_meta.ui` and the flat `ui/resourceUri`, with or without the flag. Annotations are reshaped: `readOnlyHint` arrives as `readOnly`. `system/init.capabilities` lists `mcp_read_resource_v1`, `mcp_tool_ui_meta_v1`; there is no capability for `mcp_call`. |
| App-only tools | Missing from `system/init.tools`, so hidden from the model, with or without the flag. |
| Model-turn result | `tool_use_result = { content, _meta, structuredContent }` at top level. When `structuredContent` exists, `content` (and what the model sees) is its JSON string, not the server's text content; the private `_meta` stays out of the model's `tool_result`. MCP tools are deferred behind ToolSearch. |
| `readMcpResource` | Works without a turn, `ui://` only (other schemes refused), returns content `_meta.ui` (csp, prefersBorder). |
| `mcp_call` | Works through the internal `Query.request({ subtype: 'mcp_call', tool: 'mcp__<server>__<tool>', arguments })`. **No visibility or permission check** (a model-only tool ran). Result is post-processed like a model call (`content` becomes a string). A result with `isError` rejects the control request (`errorClass: control_request_failed`, message = tool text), the same shape as "could not run". `AbortSignal` sends `control_cancel_request`; the server received `notifications/cancelled` within ~1 s. |
| Subagent results | Not exercised; static evidence says `_meta` is capped and `structuredContent` dropped. Verified in C6. |

Verdict: **native**. `readMcpResource` and tool metadata are public alpha
APIs; `mcp_call` is internal and goes behind one adapter with a runtime and
version gate. If the gate fails, Claude Views render and receive tool input
and results but their `tools/call` is reported unsupported. Gateway fallback
is only reconsidered if that happens in a released SDK.

### Steps

Depends on phase 1 steps 1, 4 and 5 (contract, View host, executor). C1–C3
can start as soon as the contract is committed.

- **C1 Host env.** A `packages/claude` helper adds `CLAUDE_CODE_MCP_APPS_HOST=true`
  to the spawn env, merging `process.env` when no env is set (SDK env is
  replace, not overlay). Apply it at every query construction:
  `apps/desktop/src/main/agent/claude-query.ts` (session + warmup),
  `packages/claude/src/run-sdk-turn.ts`, `packages/claude/src/claude-live-session.ts`.
  The constant key keeps `WarmupManager.keyOf` stable.
- **C2 Tool UI catalog.** `ClaudeBackend` reads `mcpServerStatus()` after init
  and on MCP status changes, when `system/init.capabilities` has
  `mcp_tool_ui_meta_v1`. It keeps server → tool → UI meta, maps `readOnly` →
  `readOnlyHint`, applies the flat-key fallback, and resolves the normalized
  server name in `mcp__<server>__<tool>` back to the raw name that
  `readMcpResource` needs.
- **C3 Mapper.** Both tool-result paths in `claude-query.ts` (streamed and
  assembled) and `packages/claude/src/agent-event-mapper.ts` emit the shared
  attachment for UI tools: input from `tool_use.input`, result from
  `tool_use_result` (string `content` normalized to a text block,
  `structuredContent`, private `_meta`), keyed by the `tool_use` id. The
  resource snapshot is fetched once per URI + server through
  `readMcpResource` and attached as an update.
- **C4 Provider.** `ClaudeBackend` implements `McpAppsProvider`:
  `readResource` → `readMcpResource` with a deadline; `callTool` → the
  `mcp_call` adapter (`typeof query.request === 'function'` + tested SDK
  version), result normalized as in C3, a rejected request mapped to
  `{ isError: true }` for the View and to `unknown_outcome` for retry policy,
  cancellation through the signal. Visibility and approval come only from the
  shared executor.
- **C5 Remote node.** The CLI live session exposes the same provider over the
  environment RPC that phase 1 adds for Codex.
- **C6 Tests.** Unit: env helper, catalog mapping (annotations, flat key,
  name normalization), both mapper paths, adapter (normalization, error,
  cancel). A recorded fixture session for replay tests (see
  `apps/desktop/docs/agent-reference/testing.md`), including one subagent
  call to settle the subagent row.
- **C7 Docs.** `docs/harness/claude/api-surface.md` (env flag, catalog,
  `readMcpResource`, `mcp_call` and its limits), reopen backlog row 10,
  `contracts.md` for the attachment.

Acceptance: the phase 1 acceptance run on Claude, plus a View `tools/call`
to a model-only tool rejected by the executor before `mcp_call`.

## Later phases

Phases 3–5 follow the proposal §8 and get their own steps here once their
spikes are in.

## Codex track

### 0.1 — version verdict: pass

Pin `@modelcontextprotocol/ext-apps` **1.7.5** (the last SDK-1.x-compatible
release) and `@modelcontextprotocol/sdk` **1.30.0** in desktop, CLI and
chat-view consumers. This follows the existing SDK 1.x path rather than
introducing the split SDK 2.x packages. Upstream's
[v1.7.5 manifest](https://github.com/modelcontextprotocol/ext-apps/blob/v1.7.5/package.json)
declares SDK `^1.29.0`; 2.0.3 uses `client`/`core` 2.x peers.

Verification: `bun build …/ext-apps/dist/src/app-bridge.js --target browser`
passes from **both** `apps/desktop` and `packages/chat-view` (142 modules,
0.62 MB before application minification). The renderer will load the bridge
behind a lazy component boundary, so the SDK does not enter the startup chunk.
The install's pre-existing desktop lockfile version correction (0.69→0.70)
is included alongside this dependency resolution.

### Phase 1.1 — shared contract: implemented

`packages/shared/src/mcp-apps.ts` owns SDK-free descriptors, binding, origin,
provider capabilities, structured errors and `ToolAppAttachment`. Provider
`callTool` returns `{ result, outcome }`: the View receives only the standard
result, while `unknown_outcome` suppresses automatic retry. This wrapper was
approved after the Claude spike proved that its control API conflates a
completed `isError` result with a control rejection.

Attachments travel on `tool_use` / `tool_result` ContentBlocks and native Codex
items, so existing AgentEvent, reducer and JSON transcript persistence retain
them. Both regular and progressive mobile projection explicitly preserve
the resource, original input, full private result and latest model context.
Caps are 2 MiB for HTML and 1 MiB for data, enforced before persistence/RPC.

Verification: `src/main/remote/mcp-app-attachment.test.ts` — 4 passed,
including delta reduction → JSON persistence → mobile projection, native
Codex progressive item projection, metadata/visibility fallbacks, UTF-8 caps
and structured error serialization. `bun run typecheck:node` passed.

## Log

- 2026-10-01: proposal drafted; reviewed with Codex (fact corrections on
  Claude `mcpMeta` path, Codex routing params, OpenCode runtime version;
  correlation, restore and consent rules tightened). Second round converged
  with precision fixes: gateway keeps `structuredContent` / `isError`, Codex
  snapshots per turn, `originCallId` is resource-read only, narrower
  `unknown_outcome`, `form-action 'none'`, persistent origin identities.
