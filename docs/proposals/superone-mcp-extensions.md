# SuperOne MCP extensions (`superone/*`)

Status: draft · Updated: 2026-10-01

Part of [mini-apps-and-mcp-apps.md](mini-apps-and-mcp-apps.md).

Scope: publish a SuperOne extension set on MCP and MCP Apps, in the style of
[OpenAI's MCP extensions](https://github.com/openai/mcp-extensions), so any MCP
App can use the capabilities SuperOne mini-apps already have. OpenAI
compatibility is [mcp-apps-openai-extensions.md](mcp-apps-openai-extensions.md);
the host is [features/mcp-apps.md](../features/mcp-apps.md). Related:
[miniapp-agent-api.md](miniapp-agent-api.md),
[miniapp-event-api.md](miniapp-event-api.md).

## 1. Decisions

- **Same mechanics as OpenAI.** Each extension is advertised in
  `hostCapabilities.experimental["superone/<name>"]` (View side) or
  `capabilities.extensions["superone/<name>"]` (server side), with namespaced
  methods and `_meta` keys. An App sees an API only when the host advertises
  it, so the same App runs unchanged on ChatGPT, Claude or VS Code.
- **No duplicates.** Where OpenAI or the MCP Apps spec already defines a shape,
  we implement that one. `superone/*` covers only what they lack. Standard
  `hostContext` already carries `locale`, `theme`, `styles.variables`,
  `platform` and `timeZone`.
- **Mini-apps define the set.** Candidates are mini-app capabilities that an
  MCP App cannot express today. Each keeps the mini-app's semantics and
  consent path, so both run on one host implementation.
- **The top of the ladder.** Long term a mini-app is an MCP App with these
  extensions plus packaging ([mini-apps-and-mcp-apps.md](mini-apps-and-mcp-apps.md)).
  Existing mini-apps keep `manifest.json`, the MiniApp Host and
  `window.superone` meanwhile.

## 2. Candidate set

| Extension | Shape | Mini-app source | Notes |
|---|---|---|---|
| `superone/overlay` | `superone/overlay/toast`, `/tooltip`, `/context-menu` (returns the chosen id) | `host.toast`, `ui.showTooltip`, `ui.showContextMenu` | Host-rendered text only, coordinates in the View's viewport. No HTML popover in v1 |
| `superone/clipboard` | `superone/clipboard/write`; `read` behind the existing consent prompt | `host.clipboard` | Same consent path |
| `superone/intercept` | Tool `_meta["superone/ui"].intercept: true`: the View opens **before** the call runs and answers `superone/tool/submit { arguments }` or `superone/tool/cancel` | `renderer.intercept` | Needs a harness hold point: Claude's `canUseTool`; Codex unknown (§6) |
| `superone/status` | `superone/status/set { text }` while the View is mounted | `setStatus` | Sidebar status only; a View has no background lifetime |
| `superone/agent` | Methods from [miniapp-agent-api.md](miniapp-agent-api.md), scoped to the View's session | `agent.*` | After that proposal is accepted |
| `superone/events` | Subscriptions from [miniapp-event-api.md](miniapp-event-api.md) | Event API | After that proposal is accepted |

## 3. Publication

- A spec document in the same form as OpenAI's: capability advertisement,
  behavior, schema, examples and a platform support table (desktop, phone,
  remote node).
- A small App helper in the style of `@openai/mcp-extensions/app`:
  `new SuperOneExtensions(app)`, each API `undefined` until advertised.
- Versioning by key presence; a breaking change gets a new key.

## 4. Security

- Every method enters through `executeMcpAppHostRequest`, so activation,
  requester scope and binding checks apply unchanged.
- Overlays render text, never HTML, and are rate-limited per View.
- `intercept` submits arguments only for the call it was opened for; the
  harness's own approval still applies to the submitted call.
- Agent and event methods inherit the permission model of their mini-app
  proposals.

## 5. Phases

1. `superone/overlay`, `superone/clipboard`, `superone/status`, with the spec
   document and the App helper.
2. `superone/intercept` on harnesses with a hold point.
3. `superone/agent` and `superone/events` once the mini-app proposals are
   accepted.

## 6. Open questions

- Codex hold point for `superone/intercept`: is there a pre-call approval for
  MCP tools that can carry arguments back?
- Naming: `superone/*` versus a reverse-DNS prefix.
- Where the spec and helper live, and whether the helper is published to npm.
