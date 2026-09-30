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
| 0.5 | Mobile child frame | **Done 2026-10-01 — fails as shipped, passes with mitigations M1–M4.** Meta CSP works on both; the frame reaches RN directly on both. Findings in [Mobile track](#mobile-track). |
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
| Subagent results | Verified (C6): inside a subagent `tool_use_result` is only `{ _meta }`; `content` and `structuredContent` are gone. The View gets the `tool_result` block text as `content`. |

Verdict: **native**. `readMcpResource` and tool metadata are public alpha
APIs; `mcp_call` is internal and goes behind one adapter with a runtime and
version gate. If the gate fails, Claude Views render and receive tool input
and results but their `tools/call` is reported unsupported. Gateway fallback
is only reconsidered if that happens in a released SDK.

### Steps

Depends on phase 1 steps 1, 4 and 5 (contract, View host, executor). C1–C3
can start as soon as the contract is committed.

- **C1 Host env.** Done. A `packages/claude` helper adds `CLAUDE_CODE_MCP_APPS_HOST=true`
  to the spawn env, merging `process.env` when no env is set (SDK env is
  replace, not overlay). Apply it at every query construction:
  `apps/desktop/src/main/agent/claude-query.ts` (session + warmup),
  `packages/claude/src/run-sdk-turn.ts`, `packages/claude/src/claude-live-session.ts`.
  The constant key keeps `WarmupManager.keyOf` stable.
- **C2 Tool UI catalog.** Done. `ClaudeBackend` loads `mcpServerStatus()` on
  the first MCP tool call (and whenever the status list is read), not at
  start, so sessions without MCP tools pay nothing. It keeps server → tool →
  UI meta, maps `readOnly` → `readOnlyHint`, applies the flat-key fallback, and
  resolves the normalized server name in `mcp__<server>__<tool>` back to the
  raw name that `readMcpResource` needs (`packages/claude/src/mcp-apps.ts`).
- **C3 Mapper.** Done. The complete `tool_use` block and both tool-result paths
  in `claude-query.ts` (per-block and `tool_use_summary`) and
  `packages/claude/src/agent-event-mapper.ts` carry the shared attachment for
  UI tools: input from `tool_use.input`, result from `tool_use_result`
  (string `content` normalized to a text block, `structuredContent`, private
  `_meta`), keyed by the `tool_use` id. A call whose catalog entry arrives late
  is resolved again at its result. As on the Codex path, the resource HTML is
  not fetched by the mapper; the host reads it through the provider (C4).
- **C4 Provider.** Done. `ClaudeBackend.getMcpAppsProvider` returns
  `createClaudeMcpAppsProvider` (`packages/claude/src/mcp-apps.ts`), served by
  the shared `dispatchMcpAppsProviderRequest` like Codex. `readResource` →
  `readMcpResource` (abortable race, `ui://` only); `callTool` → internal
  `mcp_call` with the signal, result normalized as in C3, a rejected request
  returned as `{ isError: true }` with `outcome: 'unknown_outcome'`, and a
  cancel after dispatch reported as `unknown_outcome`. `ready()` reports
  `toolCall: false` when the runtime has no control request, and a test pins
  `CLAUDE_MCP_CALL_VERIFIED_SDK` to the SDK dependency so a bump reruns the
  live check. Visibility is enforced only by the shared dispatch gate.
  `apps/desktop/scripts/check-claude-mcp-apps.ts` runs the live check: all six
  verdicts pass on 0.3.285 (extension advertised, app-only call completed,
  model-only call denied before `mcp_call`, `isError` reported uncertain,
  attachments on both tool rows).
- **C5 Remote node.** Done. The node's Claude runner gives each live process
  its own catalog and `ClaudeToolApps` (binding names the node's environment
  id and fingerprints the merged server config), and implements
  `getMcpAppsProvider` with the same checks as Codex: session, Claude session
  id, account and server config. A View activated after the idle reaper
  released the process reopens it from the session record, as desktop revives
  its query. The catalog's single-flight refresh moved into
  `ClaudeMcpAppsCatalog.refresh` so desktop and node share it.
- **C6 Tests.** Done. Unit tests cover the env helper, catalog mapping, both
  mapper paths and the adapter. `claude-mcp-apps.sdk.json` records a live turn
  with a direct call and an async subagent call; the replay test drives it
  through `createSessionQuery`. The subagent row falls back to the
  `tool_result` block content, keeping `_meta` and no `structuredContent`.
- **C7 Docs.** Done. `api-surface.md` rows for the catalog,
  `readMcpResource`, `mcp_call` and the OAuth control requests; backlog row 10
  removed (now used); four MCP Apps entries in `contracts.md`.

Acceptance: the phase 1 acceptance run on Claude, plus a View `tools/call`
to a model-only tool rejected by the executor before `mcp_call`.

## OAuth for native providers: implemented

Native providers keep the harness's own token store; the host only opens the
authorization page and, for remote sessions, relays the redirect.

- Contract: optional `authenticate({ redirectUri? })` → `{ authUrl?, completion:
  'harness' | 'host-callback' | 'done' }` and `submitAuthCallback`, carried by
  the same provider RPC (`authenticate`, `submitAuthCallback` operations), so
  node leases and bindings apply.
- Claude: internal `mcpAuthenticate` / `mcpSubmitOAuthCallbackUrl`. Without a
  `redirectUri` the CLI listens on its own localhost and reconnects; with one
  it uses it (`redirectScheme: 'custom'`), and after the callback is submitted
  the server stays `needs-auth` until `reconnectMcpServer` (verified live).
  Status `needs-auth` → `auth_required` and any other non-connected status →
  `not_connected`, before dispatch.
- Codex: `mcpServer/oauth/login { name, threadId }`, redirect handled by Codex.
- Desktop: `authenticateMcpApp` (`apps/desktop/src/main/mcp-apps/auth.ts`)
  behind `window.environment.mcpAppsAuthenticate(connectionId, { binding,
  origin })`. Remote sessions get an RFC 8252 loopback listener whose URL is
  passed as `redirectUri`; only http(s) authorization URLs are opened; it
  resolves when `tools` stops reporting `auth_required`.
- Verified live with the fixture's `--oauth` server
  (`apps/desktop/scripts/check-mcp-apps-oauth.ts`, isolated credential
  stores): Claude local, Claude with the relayed redirect, and Codex each go
  `auth_required` → signed in → app-only call completed.
- Known limit: a Codex session on a remote node receives the redirect on the
  node's localhost; Codex's login takes no redirect override, so signing in
  from another machine needs a port forward.

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

### 0.3 — Codex 0.159 wire verdict: pass (fixture)

The isolated `apps/desktop/scripts/check-codex-mcp-apps.ts` run proves the
extension reaches the fixture's wire initialize, `appContext:null`, full
content/structuredContent/private `_meta`, originating-thread resource reads
and host app-only tool calls. The model's available tool catalog lists all six
model-visible fixture tools and excludes `fixture_next_page`. Actual item UI
is `mcpAppResourceUri` with `mcpAppUi:null`; mapper reads that schema-declared
compatibility field as a fallback. Modern `mcpAppUi` remains preferred.

The sandboxed model run failed with `workspace routing discovery failed`;
the same network-approved isolated check completed successfully. No user
configuration was changed. Remote actions route through authenticated node
RPC, control leases, native provider thread binding, and app visibility checks.
The generic RPC reconnect/resend is disabled for App requests: a lost result
must not dispatch the call twice. Hosted `codex_apps` remains explicitly off.

### Phase 1.2 — native Codex provider: implemented

Both initialize paths advertise the extension. Both item mappers retain native
UI/routing metadata and full private results. `CodexBackend` and the node's
long-lived runner implement the shared provider. Restored activation can reopen
and resume the original provider thread without creating a model turn.
`window.environment.mcpAppsProvider` routes local and remote requests; the old
resource/tool `CODEX_MCP_*` IPC and `window.app` methods are removed.

Checks: 105 desktop provider/backend/transport tests; 18 node runner/client
tests; desktop node and CLI typechecks pass. Real authenticated remote-project
RPC test reads fixture HTML, calls the app-only tool, preserves private meta,
and rejects model-only calls before dispatch (3 gateway scenarios passed).
The gateway test uses the real node, pairing, leases, WebSocket, SDK fixture and
native provider; only the external Codex protocol transport is substituted.
A separate live 0.159 run proves that boundary. Native modules loaded normally
in this worktree; the initial loopback failure was sandbox `listen EPERM`.

### Shared host core — implemented; desktop boundary still pending

The expanded desktop/mobile scope shares `packages/shared/src/mcp-apps-host/`:
per-directive header/meta CSP, granted-permission mapping, resolved theme and
hostContext mapping, document generations, a guarded PostMessageTransport,
and an AppBridge adapter with an injectable executor. The lightweight barrel
and CSP leaf contain no runtime SDK; View shells lazy-load `host`/`transport`.

Every iframe load must call `document.loaded()`: its second load permanently
revokes the same WindowProxy's bridge. Desktop additionally revokes at native
navigation-start before a new document executes. `createMcpAppHostSlot` closes
the prior transport before an immediate remount. The executor owns approvals,
original-session leases/routing and persistence. Restored Views paint persisted
input/results while every backend/context/message/link/display request stays
gated until explicit activation. Message requests are capped at three/minute;
unknown tool outcomes are surfaced to the host and never retried.

Checks: 16 focused shared tests pass using the real AppBridge/App protocol and
PostMessageTransport. Covered input-before-result, private View result data,
partial input/cancellation, restore gating, model-context source attribution,
message loops, unsafe links, auth errors, uncertain calls, source/origin/size
filtering, outgoing origin pinning, second-load revocation and replacement
slots. Actual Electron navigation/security and React StrictMode acceptance
remain pending in 0.4; these unit checks do not establish either boundary.

## Mobile track

### Spike 0.5 findings

react-native-webview 13.15.0 (Fabric), the production chat document, iOS 26.4
simulator and Android 16 emulator (API 36.1). The probe injects a `srcdoc`
iframe with `sandbox="allow-scripts allow-forms"` and a meta CSP first in
`<head>` (`default-src 'none'; script-src 'unsafe-inline'; style-src
'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'`), then
records what the frame reaches and what RN's `onMessage` receives. Probe page
kept uncommitted in `apps/mobile/src/preview/WebViewIsolationProbe.tsx`.

| Check | iOS | Android |
|---|---|---|
| `window.ReactNativeWebView` in the frame | undefined (main-frame-only user script) | **present**: `addWebMessageListener` with origin rule `*` injects it into every frame, opaque origins included |
| Frame posts straight to RN | **yes**: `window.webkit.messageHandlers.ReactNativeWebView` exists in every frame; `onMessage` fires with `url=about:srcdoc` | **yes**: `onMessage` fires with `url=null` |
| After the frame navigates itself (new document, no CSP) | still reaches RN | still reaches RN |
| `parent.__applyHost`, `top.*`, `localStorage` | SecurityError | SecurityError |
| Meta CSP before the first script | `fetch` → `connect-src` violation, image → `img-src`, `form.submit()` → `form-action`; all blocked | same |
| `window.open`, top navigation | `null`, SecurityError | same |
| Sub-frame navigation seen by `onShouldStartLoadWithRequest` | yes, `isTopFrame:false`, for `data:` and `https:`; returning `false` blocks it | `data:` only (no `isTopFrame` field); **`https:` sub-frame navigation never reaches it** and loads |
| Chat document listener (`installHostBridge`) | accepts `message` events from any source, so a child frame can inject `HostInbound` | same |
| Existing widget iframe (`PortableWidgetBlock`) | its handler checks `event.source` against its frame; no document-generation check | same |

One native crash on iOS, not reproduced in later runs: SIGABRT in
`RNCWebView.mm` building `std::string` from a nil `mainDocumentURL` while
emitting `onShouldStartLoadWithRequest` for a sub-frame navigation. The path
is shared with widget iframes.

Impact today: whatever the chat document may ask RN (`requestNative` actions
include `codexPlanApproval`, `codexAsyncQuestionAnswer`, `resendFailedMessage`,
`saveWidgetTemplate`, `openLink`, `openSession`) can be forged by any frame
in the document, including existing agent-authored widgets.

Verdict: **fails as shipped**. Mitigations:

| # | Mitigation | State |
|---|---|---|
| M1 | Channel token: RN issues a per-document secret after `ready` through `injectJavaScript` (main frame only); the document tags every message with it; RN drops the rest. | Done `bd1c6b317`. A frame's forged `codexPlanApproval` is dropped on both platforms; tagged requests still round-trip. |
| M2 | `installHostBridge` applies `message` events only from the embedding host. | Done `2104e6ac3`. |
| M3 | View bridge accepts `source === frame.contentWindow` for the current document generation only; a second `load` revokes it and leaves the frame inert. | Part of the View host (below). |
| M4 | `bun patch` of react-native-webview: nil `url` / `mainDocumentURL` no longer abort. Native: needs a dev-client rebuild. | Done `78264b001`. Not re-verified on device (the crash did not reproduce). |
| M5 | Chat document CSP `frame-src 'none'`: `srcdoc` frames load, but self-navigation to a new document is refused before the request. | Done `18ac8c984`. Blocked on both platforms (`ERR_BLOCKED_BY_CSP` on Android, `frame-src` violation on iOS). Closes the Android `https:` residual; no native patch needed. |

M5 is inherited by `srcdoc` documents, so a View's own nested frames
(`frameDomains`) cannot load on mobile; the mobile host must not advertise
them.

## Log

- 2026-10-01: proposal drafted; reviewed with Codex (fact corrections on
  Claude `mcpMeta` path, Codex routing params, OpenCode runtime version;
  correlation, restore and consent rules tightened). Second round converged
  with precision fixes: gateway keeps `structuredContent` / `isError`, Codex
  snapshots per turn, `originCallId` is resource-read only, narrower
  `unknown_outcome`, `form-action 'none'`, persistent origin identities.
