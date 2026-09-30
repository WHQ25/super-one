# MCP Apps Host

Status: draft · Updated: 2026-10-01
Plan: [mcp-apps.md](../plans/mcp-apps.md) (pending acceptance)

Scope: render the interactive UI that third-party MCP servers ship through the
MCP Apps extension (`io.modelcontextprotocol/ui`), across harnesses, on
desktop, mobile and remote nodes, together with the MCP OAuth it depends on.
SuperOne's own UI surfaces (`widget_show`, mini-apps) keep their own
contracts; this proposal only reuses their hosting pieces.

References: [stable spec 2026-01-26](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx),
[draft spec](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx),
`examples/basic-host` in the same repo, [client matrix](https://modelcontextprotocol.io/extensions/client-matrix).
The contract we implement is the stable spec plus the pinned SDK's schema;
draft features are opt-in per feature. Where stable prose and SDK schema
disagree (`ui/message.content` is an array in the schema), the schema wins.

## 1. Decisions

| Question | Decision |
|---|---|
| Who hosts the UI | SuperOne, one shared host for every harness. |
| Where the MCP connection lives | **Capability-driven providers behind one contract** (§4). *Native* when the harness exposes what a host needs on a usable API; *gateway* (SuperOne is the MCP client) otherwise; *unsupported* (text result only) when neither is proven. |
| Per harness today | Codex: native. Claude: conditional, native only if the §8 spike passes, else gateway. dsh: plugin adapter or gateway, by cost. OpenCode, Cursor, Grok: gateway. |
| First release | Codex, desktop, public third-party server, inline display. |
| Tool-row correlation | Never guessed. Native providers use the harness item id. The gateway's own call record is authoritative; attaching it to a harness row is best effort and may fail. |
| Restored Views | Paint from stored data; backend actions (`tools/call`, `resources/read`, `ui/message`) stay disabled until the user activates the View. |
| OAuth | Native providers keep the harness's auth. The gateway owns auth for the servers it proxies. Both surface one auth-required state. |
| Relation to mini-apps / `widget_show` | Separate contract, shared hosting utilities. The earlier decision not to author mini-apps on ext-apps stands; it did not cover hosting third-party UI. |
| Compatibility | Standard `_meta.ui`; the deprecated flat `_meta["ui/resourceUri"]` as a read fallback. OpenAI `openai/outputTemplate` / `window.openai` out of scope. |

## 2. Current state

| Piece | Where | State |
|---|---|---|
| User MCP config | `packages/runtime/src/fs/mcp-config.ts`, `mcp-config-service.ts`, `codex-config-service.ts`, `mcp-config-dsh.ts` | No SuperOne registry. Claude and Codex load their own files; ACP, Cursor and OpenCode get Claude-shaped configs pushed by SuperOne; the node merges them (`mcp-merge.ts`). |
| SuperOne MCP client | `mcp-probe-service.ts`, `mcp-oauth.ts` | SDK `Client` over stdio / Streamable HTTP / SSE, probe only. `@modelcontextprotocol/sdk` ^1.29 (1.30 installed); ext-apps 2.x expects SDK 2.x peers. |
| SuperOne MCP server | `mcp/superone-mcp-server.ts`, `superone-mcp-stdio-ipc.ts` | Per-session; Claude in-process, others over loopback Streamable HTTP with a per-session HMAC bearer. Tools only. |
| OAuth | `mcp-oauth.ts`, Codex `mcpServer/oauth/login`, ACP `x.ai` auth, OpenCode `mcp.auth` | Generic flow writes a static `Authorization` header into harness config; the plaintext token cache is only read to merge writes, never to refresh. |
| Tool results | `packages/shared/src/agent-types.ts` `tool_result` | Text `summary` only; Claude and ACP mappers keep text. Codex keeps `content[]` / `structuredContent` / `meta` but drops `mcpAppUi`. |
| Codex Apps RPCs | `index.ts` `CODEX_MCP_RESOURCE_READ` / `CODEX_MCP_TOOL_CALL` | No callers; local-only IPC that rejects remote projects. Resource read has no thread binding; tool call passes `threadId`. |
| Inline HTML host | `WidgetBlock.tsx`, `PortableWidgetBlock.tsx`, `widget-srcdoc.ts` | `srcdoc` + `sandbox="allow-scripts"`, ad-hoc bridge, **no CSP**. |
| Isolated app host | `miniapp-protocol.ts`, `miniapp-service.ts` `generateCSP`, `miniapp-webview-guard.ts` | `superone-app://`, per-app origin/partition, header CSP. The CSP generator merges all network domains and allows same-origin connect/frame, so it is not reusable as is. |
| UI → conversation | `miniapp-host-actions.ts`, `send-message.ts` | Context card ≈ `update-model-context`, but bound to the active session and stringified; `sendPrompt` only prefills. |

## 3. Harness matrix

**Y** yes · **P** partial · **N** no · **?** needs wire verification. Versions
are what runs today, not only what `package.json` declares.

| Harness | Advertises UI ext. | Tool `_meta` + result to host | Host `resources/read` | Host `tools/call` | Hides app-only tools | OAuth trigger | Provider |
|---|---|---|---|---|---|---|---|
| Codex app-server 0.159 | Y, `InitializeCapabilities.extensions` (object settings) | Y: `McpServerStatus.tools` (name→Tool map); `mcpToolCall.mcpAppUi`, `appContext`, `result{content,structuredContent,_meta}` | Y `mcpServer/resource/read` (`threadId`; `originCallId` for hosted apps) | Y `mcpServer/tool/call` (`threadId`) | Y | Y | Native |
| Claude Agent SDK 0.3.285 | Y? `CLAUDE_CODE_MCP_APPS_HOST=true` (static evidence only) | P: `mcpServerStatus().tools[]._meta.ui`; `tool_use_result._meta` / `.structuredContent` at top level; subagent results keep a capped `_meta` only | P `readMcpResource()` alpha, `ui://` only, CLI-dialed servers, check `mcp_read_resource_v1` | P internal `mcp_call`: no public method, **no permission check**, rejects SDK servers, result is post-processed | Y | P runtime-only methods | Conditional |
| dsh 0.1.7 | N (Cordis plugin replaceable) | P: `content` + `structuredContent`, `_meta` dropped; tools hook exposes `callId` | P in-process | P in-process | N | N | Plugin adapter or gateway |
| OpenCode 1.18.18 (runtime, unpinned) | N (`roots` only) | N on public API | N on public API (internal only) | N | N | Y | Gateway |
| Cursor SDK 1.0.30 | N | P: text/image + `isError`, no `_meta` / `structuredContent` | N | N | N | P internal | Gateway |
| Grok 1.0.44 (ACP) | ? (binary contains the extension) | ? | N | N | ? | P `x.ai/mcp/auth_trigger` | Gateway |

ACP has no standard Apps projection. MCP-over-ACP (`mcp/connect`,
`mcp/message`) is an experimental SDK interface that would let the client own
connections; SuperOne's ACP integration does not offer it today, and Grok
support is unverified. If Grok really advertises
the extension, servers may expose functions reachable only through a UI the
ACP host never receives; the gateway, as the server Grok sees, avoids that.

## 4. Providers

### 4.1 Contract

```ts
interface McpAppsProvider {
  readonly binding: { node: string; session: string; server: string; account?: string; configGeneration: number }
  ready(signal: AbortSignal): Promise<McpAppsCapabilities>        // async readiness + what this provider supports
  tools(): Promise<Map<string, McpToolDescriptor>>                // full descriptor: _meta.ui, visibility, annotations
  readResource(req: { uri: string; origin?: McpAppOrigin }, signal: AbortSignal): Promise<ReadResourceResult>
  callTool(req: { tool: string; args: unknown; origin?: McpAppOrigin }, signal: AbortSignal): Promise<CallToolResult>
  dispose(): void
}
// origin carries what the harness needs to route: Codex threadId (+ originCallId for hosted resource reads).
// Errors are structured: auth_required (with challenge), denied, invalid, not_connected, timeout, cancelled,
// unknown_outcome. unknown_outcome is only for a dispatched call whose completion cannot be determined;
// a tool result with isError is a completed failure.
```

The host binds each View instance to one provider binding. A View's RPC
never names a server, account or node; the host supplies them.

### 4.2 Native

- **Codex**: pass the UI extension in `initialize`; map `mcpAppUi`,
  `appContext` (null for ordinary third-party servers) and the full result
  into the shared attachment; route `readResource` / `callTool` with the
  originating `threadId`. `originCallId` applies to hosted resource reads
  only. Move the RPCs from the ad-hoc IPC handlers into
  `CodexBackend` so remote projects work. Hosted `codex_apps` connectors and
  their `target{connectorId, linkId}` routing are out of the first release.
- **Claude** (only after the spike): set `CLAUDE_CODE_MCP_APPS_HOST=true`;
  tool UI meta from `mcpServerStatus()`; mapper keeps `tool_use_result._meta`
  / `structuredContent`; `readResource` via `readMcpResource()`; `callTool`
  via `mcp_call` behind one adapter with a version test. Because `mcp_call`
  performs no permission check, the host executor is the only gate (§6).

### 4.3 Gateway

SuperOne is the MCP client for an Apps server and exposes it to the harness
under the **original server name**, so tool names and per-server permission
rules are unchanged.

- **Routing** is a session config overlay (the pushed list for ACP, Cursor,
  OpenCode; the Cordis entry for dsh; `mcp-merge.ts` on the node). User config
  files are never rewritten.
- **Discovery** reuses the gateway connection: the first connect advertises
  the UI capability and records which tools carry `_meta.ui`. No separate
  probe connection, no duplicate stdio spawn or OAuth.
- **Scope**: per session × server, stdio included. No project-level sharing
  (roots, identity, server state and cancellation would leak across
  sessions).
- **Visibility** is enforced on both sides: `tools/list` to the harness drops
  tools whose visibility lacks `"model"`, and a harness `tools/call` to such a
  tool is rejected (names can be guessed). Missing visibility means
  `["model","app"]`.
- **Results** to the harness carry `content`, `isError` and
  `structuredContent` (required when the tool declares `outputSchema`); only
  the private result `_meta` stays in the host registry for the View.
- **Protocol duties**: pagination and `list_changed`, server instructions,
  roots, elicitation, progress and cancellation, transport/session expiry.
  Advertised capabilities are the intersection of upstream and downstream.
- **Call records**: each harness → upstream call gets a gateway call id and
  produces the App record. If a harness can pass its own call id in the MCP
  request `_meta` (to be proven per harness, e.g. via a plugin hook), the
  record attaches to that row; otherwise it renders as its own block next to
  the tool activity.
- **Codex timing** (if Codex ever uses the gateway): Codex snapshots tools
  at each `turn/start`, so the gateway endpoint must be ready before it;
  today's readiness wait only covers `superone`.

### 4.4 Shared contract

```ts
interface ToolAppAttachment {
  appInstanceId: string
  binding: McpAppsProvider['binding']
  harnessCallId?: string                 // native, or gateway when proven
  gatewayCallId?: string
  resourceUri: string
  resource?: { html: string; meta: McpUiResourceMeta; hash: string }
  toolInput?: Record<string, unknown>
  toolResult?: CallToolResult            // not re-sent automatically; private _meta never reaches the model
  status: 'pending' | 'result' | 'cancelled' | 'error'
}
```

Persistence stores the resource snapshot, the original input and result, and
the latest model context. It does **not** promise the View's last interactive
state or offline assets the HTML loads from its CSP domains. HTML and results
have size caps; stored snapshots follow the server's account lifecycle
(removed or unreadable after logout).

## 5. View host

| Concern | Desktop | Mobile chat WebView |
|---|---|---|
| Isolation | Privileged scheme `superone-mcp-app://<originKey>/`, `originKey` derived from persistent identities: node id, server config fingerprint, account, SuperOne session id (never a connection id, generation or rotating token), so a restored session keeps its storage. Storage is not shared across sessions. One cross-origin iframe, `sandbox="allow-scripts allow-same-origin allow-forms"`, no `allow-popups` / `allow-top-navigation`. This replaces ext-apps' web-host sandbox proxy with an equivalent native boundary, recorded as such. | `srcdoc`, `sandbox="allow-scripts allow-forms"`, opaque origin. Limited support: no persistent storage, restricted CORS and permissions. |
| Navigation | New-document navigations are blocked before the request is sent, except to its own origin; a new document revokes the bridge (the transport's `source` check alone survives navigation). Same-document hash/history routing is allowed. The scheme handler serves only registered snapshots; existing handlers (`local-file`, `superone-app`) are audited to refuse this origin. | The nested frame must not reach the RN bridge; the parent bridge checks source + instance generation, not `origin === "null"`. |
| CSP | Header built per directive from `_meta.ui.csp`: domains parsed to origins, https (or explicit ws/wss for `connectDomains`) only, no broad wildcards; spec default when absent; always `form-action 'none'`. Resource `_meta.ui` read from the list entry and the read content, content wins. | `<meta>` CSP first in `<head>`, including `form-action 'none'`. `sandbox` is covered by the iframe attribute; `frame-ancestors` has no equivalent and is bounded by the native container that loads the chat document. |
| Permissions | `permissions` → iframe `allow`; the granted set reported truthfully in `hostCapabilities.sandbox`. | Only what the device actually grants. |
| Protocol | `AppBridge` + `PostMessageTransport`, one per mounted View instance, torn down with `ui/resource-teardown`; StrictMode double mount covered by test. | Same bridge in `packages/chat-view`; server-bound calls go to the host over environment RPC. |
| Theme | SuperOne tokens → spec `--color-*` / `--font-*` / `--border-radius-*`, reusing `WIDGET_THEME_TOKEN_SOURCES`. | Same. |
| Display | `inline` first; `fullscreen` (dock panel) and `pip` later. Only modes the View declared. | `inline`, then `fullscreen` (sheet). |

## 6. View → host methods

All handled in the host executor, against the View's bound provider.

| Method | Handling |
|---|---|
| `tools/call` | Only tools whose visibility includes `"app"` on the bound server. Needs approval per server identity + account + tool, remembered on request. `readOnlyHint` skips the prompt only for servers the user marked trusted. No automatic retry after `unknown_outcome`. |
| `resources/read` | Bound server only. |
| `ui/message` | A real user turn in the View's original session, attributed to the app, through the normal queue / permission / receipt flow. First release: confirm every message. Never sent during restore or startup; rate-limited to stop self-triggered loops. |
| `ui/update-model-context` | Per-View context entry in the original session: keeps `content[]` / `structuredContent` and source, last write wins, injected on the next user turn. Built on the context-card UI, not on the mini-app active-session target. |
| `ui/open-link` | Consent-gated `openExternal`. |
| `ui/request-display-mode` | Answer with the resulting mode. |
| `ui/notifications/size-changed` | Resize inline frame, capped. |
| Draft: `ui/download-file`, request-teardown, sampling, app-provided tools | Not advertised in the first release. |

Host → View: `tool-input-partial` when streamed, `tool-input` once before the
result, `tool-result`, `tool-cancelled`, `host-context-changed`,
`ui/resource-teardown`. Nothing before `ui/notifications/initialized`.

## 7. OAuth

Native providers keep the harness's auth. For the gateway:

- PKCE, protected-resource and authorization-server discovery, dynamic client
  registration, or a pre-registered `client_id` / `client_secret`.
- Token key: node + resource/audience + issuer + client + account + scope.
  Access and refresh tokens encrypted at rest through a secret-store port
  (Electron `safeStorage` on desktop, a CLI implementation on nodes).
- Single-flight refresh; revoke on logout; remote callback and PKCE state
  routed to the node that started the flow.
- Automatic retry only after an auth rejection known to have not executed;
  timeouts and generic errors surface as `unknown_outcome`.
- Views never see tokens. Every path surfaces one `mcp_auth_required` state.

## 8. Phases

0. **Unblock.** Pin ext-apps + MCP SDK. One fixture server (model-only,
   app-only, default visibility, private `_meta`, `outputSchema`, `isError`,
   auth rejection, concurrent identical calls, retries, out-of-order
   results). Electron navigation /
   scheme security tests. Mobile child-frame bridge isolation. Claude
   capability + `mcp_call` spike. Gateway call-id propagation spike on one
   harness.
1. **Codex desktop, public server, inline** (first release).
2. **Second provider** chosen from phase 0: Claude native if every gate
   passed, otherwise a gateway pilot on one harness.
3. **OAuth-protected servers** (native and gateway), one remote-node round
   trip, account switch and expiry.
4. **Remaining harnesses**, mobile, fullscreen / PiP.
5. **Draft features** as they stabilize.

The remote, OAuth and mobile contracts are frozen in phase 1 even though they
ship later, so phase 1 uses environment RPC rather than local-only IPC.

## 9. Open questions

- ext-apps 2.x (MCP SDK 2.x peers) vs the last 1.x-compatible release; both
  speak the same wire format.
- MCP core 2026-07-28 stateless negotiation (per-request `_meta`,
  `server/discover`): when the gateway must speak it.
- Hosted `codex_apps` connectors and multi-account routing.
- Accepting this proposal reopens entries that record MCP Apps as paused
  (Claude backlog row 10).
