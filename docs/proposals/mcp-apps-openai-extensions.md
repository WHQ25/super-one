# MCP Apps: OpenAI extension compatibility

Status: accepted · Updated: 2026-10-01
Plan: [plans/mcp-apps-openai-extensions.md](../plans/mcp-apps-openai-extensions.md)

Part of [mini-apps-and-mcp-apps.md](mini-apps-and-mcp-apps.md).

Scope: host MCP Apps built with [OpenAI's MCP extensions](https://github.com/openai/mcp-extensions)
so they get a sidebar entry, tab, settings, context attachments and forms in
SuperOne, with the same standing as mini-apps. Builds on
[features/mcp-apps.md](../features/mcp-apps.md). SuperOne's own extension set
is [superone-mcp-extensions.md](superone-mcp-extensions.md). Related:
[input-surfaces.md](input-surfaces.md).

## 1. Decisions

- **Implement OpenAI's shapes as specified.** Extensions are optional keys:
  tool and resource `_meta`, server `capabilities.extensions`, the View's
  `hostCapabilities.experimental` and `hostContext`, plus namespaced JSON-RPC
  methods. We advertise an `openai/*` key only once it is implemented; an App
  that finds no key falls back on its own, as OpenAI's App SDK does.
- **Shared surfaces with mini-apps.** An App's entrypoints, settings, context
  attachments and forms render in the same places and with the same components
  as a mini-app's. New host surfaces (settings renderer, schema form, context
  attachments) are built once for both.
- **Harness-neutral where possible.** Host-initiated work (entrypoints,
  settings, previews) goes through `McpAppsProvider.callTool`, so it works for
  every native provider. Extensions the harness itself speaks to the server
  (form elicitation) depend on the harness.

## 2. Current state

- The host implements MCP Apps 2026-01-26 with ext-apps 1.7.5, the same
  version OpenAI's App SDK builds on. It advertises `message: { text }` and
  `updateModelContext: { text }` and no `experimental` keys.
- Model context set by a View is a hidden per-View entry; the user cannot see
  or remove it.
- A View exists only as the result of one agent tool call.
- Codex 0.159 already speaks part of the set: it forwards
  `preferredModelDisplayMode` in `McpAppUi` (we store it, unused) and sends
  `openai/form` elicitations. Newer Codex reports
  `server_capabilities.extensions` (including `openai/settings`) in
  `mcpServerStatus/list`.

## 3. Harness coverage

View-side extensions live in the host and executor and work for every harness
that shows Views. What differs is what the MCP client in front of the server
passes through.

| Needs from the MCP client | Codex 0.159 | Claude SDK 0.3.285 | Compat layer |
|---|---|---|---|
| Tool `_meta` (entrypoints, display modes) | Yes | Yes | Yes |
| Tool `title`, `icons` | Yes | No | Yes |
| Server capabilities (`openai/settings`) | Yes (since 0.155) | No | Yes |
| Request `_meta` on View tool calls (`openai/resource` path) | Yes (`mcpServer/tool/call`) | No (`mcp_call` takes tool and arguments) | Yes |
| `openai/elicitation` advertised to the server | Yes (`openai/form`) | No | Yes |
| Host-initiated tool calls | Yes | Yes | Yes |

The compat layer is [mcp-apps-compat-layer.md](mcp-apps-compat-layer.md). This
table decides routing there: a server whose extensions a harness does not
carry is served through the layer in that harness's sessions. On Claude, a
missing title or icon only falls back to the name and server icon; a server
using settings or file entrypoints is rerouted.

## 4. Mapping

| Extension | SuperOne surface | Mini-app counterpart |
|---|---|---|
| Resource `_meta["openai/ui"]` `availableDisplayModes` / `preferredDisplayMode`; Codex `preferredModelDisplayMode` | Agent-invoked Views always start inline, as in ChatGPT; the metadata only shapes the placeholder before `initialize` and limits which modes a View may request. Fullscreen comes from the View's own request. We still offer `pip` | — |
| Tool `icons`, server icons (`server/discover`, `serverInfo`), tool `title` → `annotations.title` → `name` | Row header, sidebar entry, tab | `logo`, `displayName` |
| Global entrypoint, deep link | Apps sidebar entry; opens a session with the App as a pinned activity tab, and `ui/message` and model context target that session. `hostContext["openai/deepLink"]` once SuperOne has a URL scheme | Apps panel |
| Thread entrypoint | "Open app" in a session's activity panel; one instance per session | — |
| File entrypoint, host resources (`read`, `subscribe`, `openai/resources/write` with `etag`) | "Open with" in the file preview; host-handled opaque `host-resource://` URIs; `_meta["openai/resource"].path` injected into the App's server calls | — |
| `openai/settings` | Settings page for the server, native controls; a `tool` item that is an App opens it in a dialog | Mini-app settings use the same renderer |
| `openai/modelContext` | Removable context attachments in the composer (text, image, resource link, embedded resource), `openai/title`, `openai/thumbnail`, hidden `audience: ["assistant"]` blocks; `hostContext["openai/modelContext"]` with `updateId`, `null` after removal. Context is state: it stays attached and goes with every message until the View replaces it or the user removes it | `agent.setContext` becomes one attachment kind |
| `openai/message` | `target: "new"` starts a session in the same project and harness; titled items become removable composer chips; same confirmation card | `agent.sendPrompt` |
| `openai/files/open` | Opens the path in the file preview; paths outside the session's workspace need confirmation | `host.revealInFolder` |
| Composer at-mentions (`mentions/search`) | A server section in the existing `@` mention popup, inserting resource links | input-surfaces entry points |
| `openai/elicitation` forms | One schema-form composer: thumbnails, option descriptions, suggested values, `pattern`, resource picker with previews (an App tool or resource link) | Tool `intercept` forms; input-surfaces decision prompts |
| `openai/interactionCursor` | Not advertised: SuperOne has no cursor preference, and Apps default to `pointer` | — |
| Plugin onboarding | Out of scope until SuperOne has plugin packages | — |

## 5. Hosting without a tool call

Entrypoints, settings and previews break today's rule that a View is bound to
one agent tool call. The binding becomes **origin + session**: the origin is
either an agent tool call (as today) or a host action, recorded with its own id
and the same `ToolAppAttachment` snapshot, so history restore, activation and
the phone projection keep working. Host-initiated calls are not transcript
rows.

## 6. Security

- Every new View method enters through `executeMcpAppHostRequest`, so
  activation, requester scope and binding checks apply unchanged.
- Views never receive raw filesystem paths. A path goes only to the bound
  server (`openai/resource` injection) or to the host (`openai/files/open`).
- Resource writes accept only the entrypoint's own URI, after a read that set
  `writable`, with `ifMatch` checked, inside the workspace, under a size cap.
- Host-initiated calls stay on the bound server. Visibility is ignored only for
  entrypoint tools, as OpenAI specifies. Settings tools run only on an explicit
  user action.
- The phone and remote nodes do not advertise what they do not implement.

## 7. Phases

1. **View-level**, in slices:
   - Baseline: run the Bits & Bolts example plugin on the current host and
     record what degrades; add `openai/*` keys to the fixture server.
   - Metadata: tool `title` and `icons`, resource display-mode metadata.
   - `openai/message`: `target: "new"`, image and resource content, titled
     items.
   - Model context: content kinds, `updateId`, removable attachments on
     desktop and phone, host-context sync, images through the real image
     input.
2. **Forms**: the shared schema-form composer, used by Codex `openai/form` and
   standard elicitations.
3. **Entrypoints and settings**: the §5 binding, thread then global
   entrypoints, the shared settings renderer.
4. **Files and mentions**: file entrypoints, resource writes, `files/open`,
   `@` mentions.

## 8. Open questions

- Global entrypoints: which harness and project host the session when the
  server is configured in only one harness, or in several.
- Does Codex app-server expose entrypoints or plugin metadata itself? If it
  does, read them from Codex instead of re-deriving them from `tools/list`.
- Claude does not advertise `openai/elicitation` to servers; do they fall back
  to standard forms cleanly?
- Phone parity for entrypoints, settings and forms.
