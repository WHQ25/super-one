# MCP Apps

SuperOne hosts the interactive UI that third-party MCP servers ship through the
MCP Apps extension (`io.modelcontextprotocol/ui`). A tool declares a `ui://`
resource in `_meta.ui.resourceUri`; when the agent calls that tool, SuperOne
renders the resource as a **View** bound to that one tool call, on desktop, on
the phone and for sessions running on a remote node.

We implement the [stable spec 2026-01-26](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)
with `@modelcontextprotocol/ext-apps` **1.7.5** and `@modelcontextprotocol/sdk`
**1.30.0** (the last SDK-1.x-compatible release). Where spec prose and the
pinned SDK schema disagree, the schema wins (`ui/message.content` is an array).
Draft features (`ui/download-file`, sampling, app-provided tools) are not
advertised. The deprecated flat `_meta["ui/resourceUri"]` is read as a
fallback; OpenAI's `openai/outputTemplate` is out of scope. SuperOne's own UI
surfaces (`widget_show`, mini-apps) keep their own contracts.

## Harness support

| Harness | Provider | How |
|---|---|---|
| Codex app-server (0.159) | Native | UI extension in `initialize`; item `mcpAppUi` (or `mcpAppResourceUri`) plus full result; `mcpServer/resource/read` and `mcpServer/tool/call` routed by `threadId`; `mcpServer/oauth/login`. Hosted `codex_apps` connectors are not supported. |
| Claude Agent SDK (0.3.285) | Native | `CLAUDE_CODE_MCP_APPS_HOST=true` in the spawn env; tool UI metadata from `mcpServerStatus()`; result from `tool_use_result`; `readMcpResource()`; View tool calls through the internal `mcp_call` control request. |
| Others | Unsupported | The tool row shows the text result. A compatibility layer through mini-apps is proposed in [proposals/mcp-apps-compat-layer.md](../proposals/mcp-apps-compat-layer.md). |

Upstream behavior we rely on is recorded per harness: Claude
[api-surface](../harness/claude/api-surface.md) and
[contracts](../harness/claude/contracts.md) ("MCP Apps"), Codex
[api-surface](../harness/codex/api-surface.md) and
[contracts](../harness/codex/contracts.md).

## Shared contract

`packages/shared/src/mcp-apps.ts` owns the SDK-free types.

- **`McpAppsProvider`**: `ready()`, `tools()`, `readResource()`, `callTool()`
  and optional `authenticate()` / `submitAuthCallback()`, bound to one
  `{ node, session, server, account?, configGeneration, configFingerprint }`.
  `callTool` returns `{ result, outcome: 'completed' | 'unknown_outcome' }`;
  only `result` reaches the View. Errors are structured `McpAppsError` codes:
  `auth_required`, `denied`, `invalid`, `not_connected`, `timeout`,
  `cancelled`, `unknown_outcome`, `inactive`.
- **`ToolAppAttachment`** rides on the Claude `tool_use` / `tool_result`
  content blocks and on native Codex items, so the existing `AgentEvent`,
  reducer, JSON/SQLite persistence and mobile projection carry it. It holds the
  binding, the harness call id, the resource URI, the resource snapshot
  (`{ html, meta, hash }`), the original input, the full result (including the
  private `_meta`) and the latest model context. Caps are 2 MiB for HTML and
  1 MiB for data, enforced before persistence and RPC.
- **`mcp_app_updated`** is the harness-neutral host event that patches an
  attachment by `appInstanceId` (snapshot, model context), wherever it lives:
  Claude blocks, Codex items or rows reconstructed from a remote node.
- **Correlation** is by the harness item id only, never guessed from the tool
  name or arguments.

`packages/runtime/src/mcp-apps/provider-rpc.ts`
(`dispatchMcpAppsProviderRequest`) is the single provider dispatch gate for
desktop IPC and remote-node RPC. It enforces **app visibility**: a View may
call only tools whose `_meta.ui.visibility` includes `"app"` (missing means
`["model","app"]`). This gate is the only one for Claude, because `mcp_call`
runs any tool without a permission check.

## Host executor

`apps/desktop/src/main/mcp-apps/executor.ts` (`executeMcpAppHostRequest`) is
the only View-to-host entry, used by desktop IPC and by the phone's
`mcp_app_request` command.

- Requests carry only a scoped session key, the View's `appInstanceId`, the
  operation and an optional approval challenge. The session key is
  `sessionKey(sessionRef(connectionId, sessionId))`, with `local` for local
  sessions. The host resolves the attachment itself; a View never names a
  server, account or node. Remote attachments resolve through one node RPC,
  `mcpApps.resolveAttachment`, which is served from a node-side index.
- **Activation** is keyed by requester (`desktop` or `mobile:<deviceId>`).
  A View that arrives live activates automatically on the device showing it.
  A View restored from history paints from its snapshot without contacting the
  provider. Any outbound operation returns `inactive` until the user presses
  Activate, which also re-checks the original provider, session and account.
- **Remote first turn**: until the durable resume token is written, a node
  validates the live runtime's own Claude session id or Codex thread id.

| View request | Handling |
|---|---|
| `tools/call` | App-visible tools on the bound server only. No host approval: the person operating the View has consented. Agent-initiated calls keep the harness's own approvals. An ambiguous dispatched call returns `unknown_outcome` and is never retried. |
| `resources/read` | Bound server only. |
| `ui/message` | Confirmed every time (plain-text card, single-use challenge bound to requester, View, message and binding). Sent as a user turn in the View's original session through its normal queue and receipt; on the phone, through the phone send path. Three messages per View per minute. |
| `ui/update-model-context` | Per-View context entry in the original session, last write wins. It keeps `content` / `structuredContent` with source attribution and is added to the next model request. It never includes the tool result's private `_meta`. |
| `ui/open-link` | The shared host accepts credential-free http(s) only. Desktop opens it through the standard external-link prompt (built-in or external browser); the phone uses the transcript link path. |
| `ui/request-display-mode` | Allowed when the host offers the mode and, if the View declared `availableDisplayModes`, the View declared it too. An undeclared View's request counts as intent. Otherwise the answer is `inline`. |

Host to View: `tool-input-partial` while streaming, `tool-input` once before
the result, `tool-result` (a synthetic `isError` result when the call failed
without one), `tool-cancelled`, `host-context-changed`, `ui/resource-teardown`.
Nothing is sent before `ui/notifications/initialized`. A subagent's Claude
result has no `structuredContent` (the SDK keeps only `_meta`), so the View
gets the `tool_result` block text as `content`.

## View host

`packages/shared/src/mcp-apps-host/` is shared by desktop and phone: the
per-directive CSP builder, theme to `hostContext` mapping, document
generations, a guarded `PostMessageTransport` and the `AppBridge` adapter.
The barrel has no runtime SDK; shells lazy-load `host` and `transport`.
Every iframe `load` calls `document.loaded()`; a second load permanently
revokes the bridge (the View shows Restart).

### Desktop

- **Isolation**: the privileged scheme `superone-mcp-app://<originKey>/`
  (`main/mcp-apps/protocol.ts`) serves only registered snapshots. The
  `originKey` hashes node, session, server, account and config fingerprint, so
  storage persists across restarts and is not shared across sessions. Views of
  the same server and account in one session share an origin and are one trust
  boundary; the transport's exact source-window check still stops one from
  impersonating another.
- **Headers**: CSP from `_meta.ui.csp` (origins only, https or explicit ws/wss
  for `connectDomains`, strict `https://*.host` wildcards), always
  `form-action 'none'`, `frame-ancestors` the renderer, `sandbox allow-scripts
  allow-same-origin allow-forms` (no popups or top navigation) and a denying
  `Permissions-Policy`. The iframe's `allow` holds host grants only (none
  today); resource-declared permissions are requests, not grants.
- **Navigation** (`main/mcp-apps/frame-security.ts`): new-document
  navigations away from the View's origin are cancelled before the request,
  and a new document revokes the bridge. Same-document routing is allowed.
  The `local-file` and `superone-app` handlers also reject this origin, as
  defense in depth; the header CSP is the boundary.
- **Leases** (`main/mcp-apps/document-ipc.ts`): each document and request has
  a main-registered handle. Navigation, release and window close abort its
  pending work.
- **Presentation**: an available View replaces its tool row, in the same
  borderless frame and hover header as widgets (`EmbeddedToolView`): server
  icon (`ToolBrandIcon`, same fallback as MCP rows), `server · tool` and a
  `CodeXml` toggle for the tool details. Pending, auth, error, revoked and
  snapshot-less restored Views keep the ordinary MCP row with their state and
  one action in its trailing slot. Restored snapshots show a persistent
  Activate chip that pulses when a blocked operation is attempted.
- **Display modes**: `inline`, `fullscreen` and `pip`, entered only on the
  View's request. Fullscreen opens a transient standard activity-panel tab and
  maximizes it. The tab has no maximize/restore button; closing it, Esc,
  un-maximizing the panel or a View request for inline return the View to the
  chat and restore the panel's previous state. The controller owns
  the iframe outside React and moves it with `moveBefore()`, which keeps the
  document alive. Moves go through a connected parking container and never
  run from an unmount; a move that cannot be made revokes the View instead of
  throwing. Inline goes to a visible transcript row, preferring the main chat.

### Phone

- The chat WebView renders the View in a `srcdoc` iframe, `sandbox=
  "allow-scripts allow-forms"` (opaque origin, no persistent storage), with the
  CSP as the first `<meta>`. A `srcdoc` document inherits the chat document's
  CSP, which includes `frame-src 'none'`, so a View's own nested frames
  (`frameDomains`) cannot load and are not advertised.
- Bridge integrity: the RN channel token drops messages not tagged by the chat
  document, `installHostBridge` accepts only the embedding host, and a
  `react-native-webview` patch keeps iframe loads from resetting the channel
  on iOS and tolerates a nil `mainDocumentURL`.
- Requests go RN → relay `mcp_app_request` → `canAccessSession` → the host
  executor. They are never coalesced or resent. A `callTool` lost after
  sending becomes `unknown_outcome`; other lost requests become `timeout`.
- Modes are `inline` and `fullscreen` (an overlay of the chat area; Android
  back and the iOS edge swipe exit it). Presentation mirrors desktop, with an
  always-visible muted header (`PortableBlockHeader`) and the row's `trailing`
  slot.

## Sign-in

Native providers keep the harness's own token store; the host only opens the
authorization page (http(s) only) and waits until `tools` stops reporting
`auth_required` (`main/mcp-apps/auth.ts`).

- **Claude** uses `mcpAuthenticate` / `mcpSubmitOAuthCallbackUrl`. Locally,
  the CLI receives the redirect on its own listener. For a remote node, the
  desktop runs an RFC 8252 loopback listener, relays the callback and asks the
  node to reconnect the server.
- **Codex** uses `mcpServer/oauth/login`, and Codex receives the redirect. A
  Codex session on a remote node receives it on the node's localhost, so
  signing in from another machine needs a port forward.

## Verification

- **Fixture server**: `apps/desktop/src/test/fixtures/mcp-apps/fixture-server.ts`
  (stdio or `--http [--token | --oauth]`). It provides model-only, app-only,
  default and legacy-key tools, private `_meta`, `outputSchema`, `isError`
  and a cancellable slow tool.
- **Live harness checks** (isolated credential stores):
  `apps/desktop/scripts/check-claude-mcp-apps.ts`, `check-codex-mcp-apps.ts`
  and `check-mcp-apps-oauth.ts`. Rerun the Claude check whenever the SDK
  changes; `CLAUDE_MCP_CALL_VERIFIED_SDK` is pinned by test.
- **Electron security and display modes**:
  `bunx playwright test e2e/mcp-apps-security.spec.ts` from `apps/desktop`
  (needs sandbox escalation).
- **Stories**: `McpAppView.stories.tsx` (desktop, `Chat/MCP Apps`), checked by
  `e2e/mcp-apps-stories.spec.ts` against a running Storybook, and
  `PortableMcpAppView.stories.tsx` (phone).
- **Replay**: `claude-mcp-apps.sdk.json` covers a direct call and a subagent
  call.
