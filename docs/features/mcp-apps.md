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
Draft features (sampling, app-provided tools) are not advertised, except
`ui/download-file` (below). The deprecated flat `_meta["ui/resourceUri"]` is read as a
fallback; OpenAI's `openai/outputTemplate` is out of scope. SuperOne's own UI
surfaces (`widget_show`, mini-apps) keep their own contracts.

## Harness support

| Harness | Provider | How |
|---|---|---|
| Codex app-server (0.159) | Native | UI extension in `initialize`; item `mcpAppUi` (or `mcpAppResourceUri`) plus full result; `mcpServer/resource/read` and `mcpServer/tool/call` routed by `threadId`; `mcpServer/oauth/login`. Hosted `codex_apps` connectors are not supported. |
| Claude Agent SDK (0.3.287) | Native | `CLAUDE_CODE_MCP_APPS_HOST=true` in the spawn env; tool UI metadata from `mcpServerStatus()`; result from `tool_use_result`; `readMcpResource()`; View tool calls through the internal `mcp_call` control request. |
| Cursor (desktop local stdio pilot) | Compatibility (user opt-in, off by default) | Enable in Settings → Harnesses → Cursor → Preferences. Session discovery then omits connected App servers from Cursor's MCP list and exposes their model-visible tools via `miniapp_list` / `miniapp_call`; a bounded host record carries the result to the same View/executor and CAS store. Sandbox requests stay native. The opt-in discloses the bypass of Cursor team MCP/network controls, which its SDK cannot expose for detection (see [Cursor contracts](../harness/cursor/contracts.md)). Source configs stay untouched; cloud, remote nodes, HTTP and OAuth are not included. |
| Others | Unsupported | The tool row shows the text result. Broader rerouting is planned in [proposals/mcp-apps-compat-layer.md](../proposals/mcp-apps-compat-layer.md). |

Upstream behavior we rely on is recorded per harness: Claude
[api-surface](../harness/claude/api-surface.md) and
[contracts](../harness/claude/contracts.md) ("MCP Apps"), Codex
[api-surface](../harness/codex/api-surface.md) and
[contracts](../harness/codex/contracts.md).

### Extension routing rule

Each MCP Apps or [OpenAI MCP extension](https://github.com/openai/mcp-extensions)
feature takes the first path that works, and is not built otherwise:

1. **Native**: the harness speaks it (Codex `mcpServer/tool/call` with request
   `_meta`, full `Tool._meta`, client extensions in `initialize`).
2. **Host to server**: the host reaches the server itself. View ↔ host
   features (`openai/message`, `openai/modelContext`, display modes) need no
   server; host-initiated calls (`mentions/search`, file entrypoints) use the
   harness's channel, or SuperOne's direct client (`hostClient`) where the
   native one lacks the data, as on Claude.
3. **Neither**: unsupported. Server → harness features that require the
   harness to declare a capability in MCP `initialize` (`openai/elicitation`
   forms) exist only where the harness can declare it, today Codex.

Codex desktop and remote nodes advertise the same form extensions. Native
`form` / `openaiForm` / `openai/form` requests use the shared declarative schema
and permission UI. Node prompts are durable, restore through snapshots and event
replay, and accept answers only from the control-lease holder. Form input waits
even in full-access sessions and is never remembered as an allowed tool. Waiting
for input does not block ordered notifications or consume RPC/turn timeout
budgets; interrupt, close, or connection loss cancels the pending form.

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
  binding, the harness call id, the resource URI, the resource reference
  (`{ hash, meta }`; legacy `{ html, meta, hash }` snapshots remain readable),
  the original input, the bounded initial result (including the
  private `_meta`) and the latest model context. Caps are 2 MiB for HTML and
  for the initial tool input plus result (`MCP_APP_RESULT_MAX_BYTES`, see
  [Initial result size](#initial-result-size)), and 1 MiB for the input alone,
  model context and View requests. Transient
  results (never persisted) have a cap of 32 MiB minus 64 KiB for envelope room
  (`MCP_APP_OUTPUT_MAX_BYTES`) across provider RPC, executor, host and the
  corresponding host-to-View reply; other bridge traffic keeps the 1 MiB cap. Initial
  resource reads allow the 2 MiB HTML plus 1 MiB metadata envelope on both
  providers. Presentation is separate: only a resolved safe image per theme
  is saved, icons over 32 KiB are dropped, and presentation has a 70 KiB
  budget. A large icon never makes otherwise valid tool data fail.
- **`mcp_app_updated`** is the harness-neutral host event that patches an
  attachment by `appInstanceId` (snapshot, model context), wherever it lives:
  Claude blocks, Codex items or rows reconstructed from a remote node.
- **Host state survives provider completion**: streaming and final item snapshots
  merge the resource, presentation and model context from the same App origin.
  Native lifecycle fields still advance normally.
- **Correlation** uses native harness item ids, or a host-authored random record
  id carried in the compatibility result's first text block and claimed once
  by that session's actual `miniapp_call` row. It is never guessed from tool
  names or arguments.

`packages/runtime/src/mcp-apps/provider-rpc.ts`
(`dispatchMcpAppsProviderRequest`) is the single provider dispatch gate for
desktop IPC and remote-node RPC. It enforces **app visibility**: a View may
call only tools whose `_meta.ui.visibility` includes `"app"` (missing means
`["model","app"]`). This gate is the only one for Claude, because `mcp_call`
runs any tool without a permission check.

Codex tool discovery uses `mcpServerStatus/list` with `toolsAndAuthOnly` and
a catalog scoped to the connection, thread and configuration. Reload,
reconnect and sign-in invalidate it; a missing tool gets one refresh, at most
once per thread every 10 seconds. Live App attachment events start discovery
in the background alongside HTML loading; ordinary sessions do not prewarm.
View tool calls still await the catalog's visibility check.
Resource reads prefer content `_meta.ui`.
Servers with list-only UI metadata use a separate full-inventory fallback,
awaited before the document's security policy is built. This avoids listing
unrelated hosted connector resources on ordinary View requests.
Tool/server titles and icons hydrate after the HTML snapshot becomes ready;
the host re-checks the attachment binding before applying a late update.

## UI resource storage and cache

Desktop and headless Node hosts each own a `mcp-app-resources` directory beside
session storage. New attachment updates write UTF-8 HTML under its SHA-256 hash,
using a temporary file and atomic rename, and persist only `{ hash, meta }`.
Disk reads validate a lowercase 64-character hash filename, the HTML cap and its
digest; corrupt or missing blobs never become a served document. Old inline
snapshots need no migration. A missing historical blob may be refetched after
Activate only if the original hash still matches, retaining its original metadata.
A changed server version never silently replaces an existing View.

A bounded LRU (32 entries, 16 MiB of UTF-8 serialized snapshots) single-flights
cold reads. New Views in the same owning node/session/provider thread, server,
account and configuration share a resource-URI cache. A hit paints immediately
and revalidates in the background for later calls; live Views and history keep
fixed snapshots. Startup and session/project deletion schedule reference GC,
retaining blobs used by any persisted attachment and allowing five minutes for
in-flight writes. A failed reference scan skips collection.

Phone loads use trusted attachment references, fetching HTML once per bounded
cache entry and retaining per-View metadata. Remote reads use `mcpApps.resource`
and phone requests use `load`; both resolve session/App identity on the host,
never a caller-supplied hash. The Node owns its authoritative blobs; desktop
may cache a copy after an authorized Node fetch. Phone WebView remounts also
use a bounded cache rather than retaining every completed HTML promise.

### Initial result size

The initial tool input and result share one cap, `MCP_APP_RESULT_MAX_BYTES`
(2 MiB), for the live View, the transcript and other devices. Attachments are
bounded where they are created (desktop's Claude and Codex backends, remote
nodes, the compatibility path), so SQLite rows and phone events carry the same
copy the live View gets. Users see no size warning: keeping results small is the
server developer's responsibility. Codex itself replaces a result over 1 MiB
in the item it sends clients with a middle-truncated text preview without
`structuredContent` or `_meta` (`truncate_mcp_tool_result_for_event`; the
model path is not affected). `attachCodexMcpApp` recognizes that preview and
records the result as omitted instead of passing it to the View.

Over the cap, the shared helper drops `toolResult` and keeps `status: result`
plus `toolResultOmitted: { bytes, reason: "size_limit" }`. Oversized inputs
remain errors. The resource, presentation and model context stay intact. No
initial `ui/notifications/tool-result` is sent for an omitted result, and no
replacement result is fabricated. The omission marker wins over any raw-result
fallback. Desktop, phone and the shared host re-check the same cap before a
View gets its input; size failures cannot escape into React.

A failed call (`status: error`) or an error result (`isError: true`) is shown
as the harness's standard tool row, with its error, not as a View
(`mcpAppToolFailed`). An omitted initial result keeps the App's header and
details toggle and shows the over-limit message with the original size in the
state card (`mcpAppOmittedMessage`). In both cases no document is registered or
loaded, so the App's default page never takes transcript space. The host never
automatically reruns that tool.

**The host does not adapt to servers that send View data in the wrong layer.**
MCP itself only defines a result's `content`, `structuredContent` and `_meta`;
it does not say which the model sees. The two App conventions disagree on
`structuredContent`: MCP Apps treats it as View data kept out of model context,
while OpenAI's Apps SDK treats it as concise data the model can inspect, with
`_meta` hidden from the model. A server that works under both keeps `content`
a short summary, `structuredContent` small, View-only data in `_meta`, and lets
the View load catalogs, previews and geometry with `tools/call` or
`resources/read`. The caps above are not raised to fit a server that returns
megabytes per call (Bits & Bolts returns its whole catalog with inline
previews, about 1 MB per call:
[openai/mcp-extensions#32](https://github.com/openai/mcp-extensions/issues/32)).
Such a server fails visibly instead: harnesses truncate or file away the model
copy, Codex drops the View copy, and the host shows the omitted state. Making it work through larger caps or host-side reconstruction would
hide the problem from the server's developer and make every harness, the
transcript and the phone pay for it.

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
  A View restored from history starts as a collapsed tool row with no document;
  expanding it paints the snapshot without contacting the provider.
  View-originated outbound operations return `inactive` until the user presses
  Activate, which also re-checks the original provider, session and account.
  Successful activation reloads the desktop/phone View from the same pinned HTML
  and binding. Its new initialize receives persisted tool input/result and
  model context; the App can make its own startup requests.
  The host does not rerun the originating tool or replace the HTML with the
  server's current version. Failed activation keeps the current View and shows
  the error without reloading. Host restore actions sit outside the View content.
- **Remote first turn**: until the durable resume token is written, a node
  validates the live runtime's own Claude session id or Codex thread id.

| View request | Handling |
|---|---|
| `tools/call` | App-visible tools on the bound server only. No host approval: the person operating the View has consented. Agent-initiated calls keep the harness's own approvals. An ambiguous dispatched call returns `unknown_outcome` and is never retried. |
| `resources/read` | Bound server only. |
| `ui/message` | Confirmed every time (host card with labeled attachments, single-use challenge bound to requester, View, message and binding). `openai/message` defaults to `target: active`, which uses the View's original session and normal queue/receipt. On desktop, `target: new` creates a conversation in the same project and harness, switches to it, then sends through that path. Phone supports `active` only and explicitly refuses `new`. Three messages per View per minute. |
| `ui/update-model-context` | Per-View context entry in the original session, last write wins. It keeps `content` / `structuredContent` with source attribution and accompanies every model request until replaced or removed. Each visible block is a removable composer attachment on desktop and phone; background-only state has one removable App context chip. The update result and `hostContext["openai/modelContext"]` carry `updateId`; cleared state is `null`. |
| `openai/files/open` | Desktop local sessions only (`experimental["openai/files"]`); remote sessions and the phone do not advertise it. Main resolves the absolute path to an existing regular file's real path; inside the session's project it opens in the file preview directly, outside it needs a confirmation that shows the real path. The approval is bound to that real path, so a link changed after the prompt is refused. The provider is never contacted. |
| `ui/download-file` | Advertised on desktop and phone for every session; files land on the device showing the View. Phone: the chat document resolves each item (embedded bytes and http(s) links as is, a link to the View's own server read through the host), the shell writes or fetches it into its cache and opens it in the file preview, whose menu saves or shares it. Desktop: each item (at most 8) opens the native save dialog, which names the App and is the confirmation; the first cancel stops the rest and answers `isError`. Downloads have no size cap: they cross only this desktop's IPC to a file the user chose. Embedded text/blob is written as sent; an http(s) link without credentials is fetched by main without cookies and streamed to disk; any other link is a transient `resources/read` on the View's own server. Bytes are fetched only after a path is chosen. |
| `ui/open-link` | The shared host accepts credential-free http(s) only. Desktop opens it through the standard external-link prompt (built-in or external browser); the phone uses the transcript link path. |
| `ui/request-display-mode` | Allowed when the host offers the mode and, if the View declared `availableDisplayModes`, the View declared it too. An undeclared View's request counts as intent. Otherwise the answer is `inline`. |

`experimental["openai/message"]` and message text/image/resourceLink/resource
modalities are advertised by the shared host on both shells. The pinned
ext-apps message schema omits request `_meta`, so the host registers a schema
that retains MCP request metadata before dispatching the OpenAI extension.
Only immediate `send: true` is supported. Titled text/resources appear as
labeled chips in confirmation cards and persisted user bubbles; untitled text
is ordinary message text. Images and image/PDF resource blobs use actual turn
attachments. Other resource blobs contribute only public URI, MIME type and byte size as
model text; raw base64 is omitted. Block `_meta` never enters model input. Remote node transcript,
live events and message catalogs preserve the same display override and
attachments, including a host-originated bubble while another turn is draining.

`experimental["openai/modelContext"]` and text/image/resourceLink/resource plus
structured content are advertised by the shared host. Context images use actual
model image input on every send; block `_meta` remains only in UI/View state.
`openai/title` and safe `openai/thumbnail` shape the generic composer attachments.
Assistant-only blocks and structured content stay in the background while visible
blocks exist. Removing the last visible block clears all state for that View.
With background-only state, one `<App title> context` chip offers a bounded
preview and clears the whole View when removed. Trusted composer removal works
without provider activation and emits `host-context-changed` with `null`.
Stale chip revisions cannot remove a newer update. The host maintains the same
state before initialize, after remount, and across SQLite/history restore.

Phone restore includes a thin context snapshot independent of transcript pages,
so context from an unloaded old View remains removable. Cached/history pages are
reconciled against that snapshot to prevent a cleared context from reappearing.
Native composer SVG data icons use capped (32 KiB) `SvgXml` vector rendering;
scripts, event handlers and external image/reference/paint resources are omitted.
Malformed icons fall back to the generic attachment icon. PNG/JPEG and HTTPS
images use native `Image`; the composer creates no WebView per icon.

Phone new-conversation messages remain an open compatibility gap. The native
shell must retain the original route across navigation and complete the
device-bound handoff after switching; session creation itself is already
shared. The current `target: new` refusal is a structured error.

Host to View: `tool-input-partial` while streaming, `tool-input` once before
the result, `tool-result` (a synthetic `isError` result when the call failed
without one), `tool-cancelled`, `host-context-changed`, `ui/resource-teardown`.
Nothing is sent before `ui/notifications/initialized`. A subagent's Claude
result has no `structuredContent` (the SDK keeps only `_meta`), so the View
gets the `tool_result` block text as `content`.

Codex child calls inside `collab_tool_call.childItems` keep their own thread
binding and full private result. Attachment indexing, host updates, completion
merges, resource GC and phone projection traverse those child trees. Desktop
and phone collaboration cards render App calls with the same View host as a
root call. A restored child View requires Activate; before native resource or
tool requests the backend reads provider ancestry and resumes that child on the
current connection. An unrelated thread cannot reuse the parent's session
binding. Child `thread/started` notifications never select a new root thread.

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
  borderless frame as widgets (`EmbeddedToolView`), with the header pinned
  instead of revealed on hover. Inline Views have no host height cap. The
  header shows the server icon (`ToolBrandIcon`, tool icons then server icons
  then the MCP fallback),
  `server title · tool title` (tool title → annotations.title → name) and a
  `CodeXml` toggle for the tool details. Loading, auth, error, failed-call,
  unknown-outcome, revoked and snapshot-less restored Views show the header
  title alone, without actions or the collapse toggle, above one card holding
  the message and its action (Sign In, Retry, Restart or Activate). Loading
  shows a spinner instead; an unknown outcome has no action.
  Restored snapshots start as a collapsed tool row whose chevron mounts the
  snapshot. Until activation the header ends with an Activate button that
  pulses when a blocked operation is attempted. Its tooltip explains
  reconnecting; an activation error shows as a note under the header.
- **Display modes**: `inline`, `fullscreen` and `pip`. Fullscreen is a
  transient standard activity-panel tab; the View sees `fullscreen` whether or
  not the tab is maximized. A View request maximizes the tab. For Views that
  declare fullscreen, the inline header adds Open in Panel (unmaximized) and
  Full Screen (maximized); the tab's own maximize/restore action switches
  between the two. Closing the tab, Esc or a View request for inline return the
  View to the chat and restore the panel's previous state. The inline header's
  title and trailing chevron collapse the View to its header by zeroing the
  inline height, so the document stays connected. The controller owns
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
- Modes are `inline` and `fullscreen`. Fullscreen covers the chat WebView with
  the frameless View in the same document, so the View never reloads; RN swaps
  the chat header for the View's (back exits, a toggle shows the composer,
  which starts hidden and hides again after a send) and Android back and the
  iOS edge swipe exit it. A restored View stays inline until activated.
  Presentation mirrors desktop, with an
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
