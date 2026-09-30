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
| 0.6 | Claude | `CLAUDE_CODE_MCP_APPS_HOST=true` changes the wire `initialize`; `readMcpResource` on the fixture; `mcp_call` round trip and its result shape; subagent result behavior. Verdict: native / gateway. |
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

## Later phases

Phases 2–5 follow the proposal §8 and get their own steps here once phase 0
verdicts are in.

## Log

- 2026-10-01: proposal drafted; reviewed with Codex (fact corrections on
  Claude `mcpMeta` path, Codex routing params, OpenCode runtime version;
  correlation, restore and consent rules tightened). Second round converged
  with precision fixes: gateway keeps `structuredContent` / `isError`, Codex
  snapshots per turn, `originCallId` is resource-read only, narrower
  `unknown_outcome`, `form-action 'none'`, persistent origin identities.
