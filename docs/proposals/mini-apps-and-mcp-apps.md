# Mini-apps and MCP Apps

Status: draft · Updated: 2026-10-01

Scope: the long-term relation between SuperOne mini-apps and MCP Apps, and the
order in which we get there. Detailed proposals:
[mcp-apps-compat-layer.md](mcp-apps-compat-layer.md) (every harness),
[mcp-apps-gateway.md](mcp-apps-gateway.md) (parked: native tools, SuperOne-hosted Views),
[mcp-apps-openai-extensions.md](mcp-apps-openai-extensions.md) (OpenAI
extensions), [superone-mcp-extensions.md](superone-mcp-extensions.md)
(`superone/*`). The current host is
[features/mcp-apps.md](../features/mcp-apps.md).

## 1. The ladder

Each level adds capabilities on top of the one below, and an artifact built for
a lower level runs unchanged on a host that offers more.

| Level | Adds | Runs on |
|---|---|---|
| MCP server | Tools, resources, prompts | Every harness |
| MCP App | A View bound to a tool result (`io.modelcontextprotocol/ui`) | MCP Apps hosts |
| + OpenAI extensions | Entrypoints, settings, context attachments, messages, file handlers, mentions, forms | ChatGPT, Codex, SuperOne |
| + `superone/*` extensions | Overlays, clipboard, intercept, status, agent and event APIs | SuperOne |
| SuperOne mini-app | Packaging, a backend in the MiniApp Host, storage, background work | SuperOne |

## 2. Decisions

- **Compatibility is required.** SuperOne hosts every level up to OpenAI
  extensions on every harness: natively where the harness covers the server,
  through the compatibility layer otherwise.
- **Adoption is progressive.** Developers add extensions one at a time, and
  every step works on its own. An App at the OpenAI-extensions level already
  gets the full experience in SuperOne; `superone/*` and mini-app packaging
  are optional upgrades.
- **Long term, a mini-app is an MCP App with SuperOne extensions.** The View
  protocol is MCP Apps; what mini-apps have beyond it is expressed as
  `superone/*` extensions plus packaging.
- **One implementation per capability.** Each host capability (settings,
  context attachments, forms, entrypoints, overlays) is built once and exposed
  through `openai/*`, `superone/*` and `window.superone`. Building OpenAI
  compatibility on the shared surfaces therefore also gives mini-apps the
  capabilities they lack today: settings, removable context attachments, file
  handlers, mentions and rich forms.
- **Existing mini-apps keep working.** `manifest.json`, the MiniApp Host and
  `window.superone` stay supported throughout; migration is opt-in.

## 3. Mapping the mini-app model onto MCP Apps

| Mini-app today | MCP Apps form |
|---|---|
| `manifest.tools` + `context.tools.handle()` | An MCP server's `tools/list` and tool handlers, run by the MiniApp Host |
| Standalone tool renderer | A tool's `_meta.ui.resourceUri` View |
| Panel in the Apps sidebar | Global entrypoint |
| `agent.setContext` / `agent.sendPrompt` | `ui/update-model-context` / `ui/message` (+ `openai/*`) |
| `host.openExternal` | `ui/open-link` |
| Toast, tooltip, context menu, clipboard, status | `superone/overlay`, `superone/clipboard`, `superone/status` |
| Intercept renderer | `superone/intercept` |
| `window.superone.node` messages | View-to-server tool calls, or a `superone/*` channel |
| `.s1app` package, permissions, storage, background | Packaging and MiniApp Host features, outside the View protocol |

## 4. Converting an MCP App into a mini-app

A skill lets an agent turn an MCP App into a mini-app with the existing
`miniapp_dev_*` tools:

- **Server with JS/TS source**: port the tool handlers into the MiniApp Host
  and keep the View as is, adding `superone/*` calls where they improve it.
- **Closed or remote server**: generate a thin mini-app that keeps calling the
  original server.

The result is installed explicitly and declares its permissions, because a
mini-app runs with more trust than a sandboxed View.

## 5. Phases

1. **Compatibility**: the compatibility layer and OpenAI extensions on the
   shared surfaces. Mini-apps gain the same surfaces.
2. **`superone/*` v1**: overlay, clipboard, status, intercept.
3. **Convergence**: the mini-app View speaks MCP Apps plus `superone/*`, with
   `window.superone` as a layer over it; a mini-app backend can be an MCP
   server run by the MiniApp Host.
4. **Conversion skill**: MCP App to mini-app.

## 6. Open questions

- In convergence, is `window.superone` a permanent layer or deprecated after a
  migration window?
- Does a converged mini-app's backend run as an MCP server in the MiniApp Host
  process, or as a separate stdio process the host supervises?
- Is a converged mini-app also published as a plain MCP server + App, so the
  same artifact runs in ChatGPT and Codex at a lower level?
- How mini-app permissions map onto a converted App's CSP and declared
  capabilities.
