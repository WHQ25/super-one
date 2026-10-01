# MCP Apps gateway provider

Status: draft · Updated: 2026-10-01

Scope: bring MCP Apps to harnesses with no native support, with SuperOne acting
as the MCP client. The host, View, executor and shared contract are built and
described in [features/mcp-apps.md](../features/mcp-apps.md). A gateway is one
more `McpAppsProvider` behind the same dispatch gate. Codex and Claude stay
native.

## Harness facts

**Y** yes · **P** partial · **N** no · **?** needs wire verification.

| Harness | Advertises UI ext. | Tool `_meta` + result to host | Host `resources/read` | Host `tools/call` | Hides app-only tools | OAuth trigger | Candidate |
|---|---|---|---|---|---|---|---|
| dsh 0.1.7 | N (Cordis plugin replaceable) | P: `content` + `structuredContent`, `_meta` dropped; tools hook exposes `callId` | P in-process | P in-process | N | N | Plugin adapter or gateway |
| OpenCode 1.18.18 (runtime, unpinned) | N (`roots` only) | N on public API | N on public API | N | N | Y | Gateway |
| Cursor SDK 1.0.30 | N | P: text/image + `isError`, no `_meta` / `structuredContent` | N | N | N | P internal | Gateway |
| Grok 1.0.44 (ACP) | ? (binary contains the extension) | ? | N | N | ? | P `x.ai/mcp/auth_trigger` | Gateway |

ACP has no standard Apps projection. MCP-over-ACP (`mcp/connect`,
`mcp/message`) is an experimental SDK interface that SuperOne's ACP integration
does not offer. If Grok really advertises the extension, servers may expose
functions reachable only through a UI the ACP host never receives; the gateway,
as the server Grok sees, avoids that.

## Design

SuperOne is the MCP client for an Apps server and exposes it to the harness
under the **original server name**, so tool names and per-server permission
rules are unchanged.

- **Routing** is a session config overlay: the pushed list for ACP, Cursor
  and OpenCode, the Cordis entry for dsh, and `mcp-merge.ts` on the node. User
  config files are never rewritten.
- **Discovery** reuses the gateway connection. The first connect advertises
  the UI capability and records which tools carry `_meta.ui`. There is no
  separate probe connection and no duplicate stdio spawn or OAuth.
- **Scope**: per session × server, stdio included. No project-level sharing,
  because roots, identity, server state and cancellation would leak across
  sessions.
- **Visibility** is enforced on both sides. `tools/list` to the harness drops
  tools whose visibility lacks `"model"`, and a harness `tools/call` to such a
  tool is rejected, since names can be guessed.
- **Results** to the harness carry `content`, `isError` and
  `structuredContent` (required when the tool declares `outputSchema`). Only
  the private result `_meta` stays in the host registry for the View.
- **Protocol duties**: pagination and `list_changed`, server instructions,
  roots, elicitation, progress and cancellation, transport/session expiry.
  Advertised capabilities are the intersection of upstream and downstream.
- **Call records**: each harness → upstream call gets a gateway call id and
  produces the App record. If a harness can pass its own call id in the MCP
  request `_meta` (to be proven per harness, e.g. via a plugin hook), the
  record attaches to that row. Otherwise it renders as its own block next to
  the tool activity, because rows are never matched by name or arguments.
- **Codex timing**, should Codex ever use the gateway: Codex snapshots tools
  at each `turn/start`, so the gateway endpoint must be ready before then.

### OAuth

The gateway owns auth for the servers it proxies.

- PKCE, protected-resource and authorization-server discovery, dynamic client
  registration, or a pre-registered `client_id` / `client_secret`.
- Token key: node + resource/audience + issuer + client + account + scope.
  Access and refresh tokens are encrypted at rest through a secret-store port:
  Electron `safeStorage` on desktop, a CLI implementation on nodes.
- Single-flight refresh, revoke on logout, and remote callback plus PKCE state
  routed to the node that started the flow.
- Automatic retry only after an auth rejection known not to have executed;
  timeouts and generic errors surface as `unknown_outcome`.
- Views never see tokens. Every path surfaces the existing `auth_required`
  state.

## First steps

1. Call-id spike on one harness (OpenCode plugin hook or dsh `callId`): pass the
   harness call id into the upstream request `_meta`, and record a verdict of
   attached or adjacent block.
2. A gateway pilot on that harness with the existing fixture server and
   acceptance flow.

## Open questions

- When the gateway must speak MCP core 2026-07-28 stateless negotiation
  (per-request `_meta`, `server/discover`); the Claude CLI already probes it.
- Whether dsh gets a plugin adapter or the gateway, by cost.
