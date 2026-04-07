# SuperOne Mini-App (Canvas) Architecture

## Overview

SuperOne mini-apps are lightweight, sandboxed web applications that run in iframe containers and are powered by any AI agent through a shared MCP proxy. Every mini-app is pure HTML/CSS/JS — all code executes inside the iframe sandbox. The AI agent interacts with mini-apps through standard MCP tools, routed by a single built-in MCP proxy.

```
Mini-App = Sandboxed iframe (UI + logic) + Declarative MCP tools (manifest.json)
```

## Core Design Principles

1. **Agent-agnostic**: Any agent that speaks MCP (Claude, Codex, Gemini, etc.) can operate mini-apps. No agent-specific code required.
2. **Sandbox-first**: All developer code runs in iframe sandboxes. The MCP layer is SuperOne's built-in code, not developer code.
3. **Minimal API surface**: `superone.*` provides filesystem, agent prompt, and tool handling. Everything else goes through standard web APIs + whitelisted network access.
4. **Web-standard**: Mini-apps are pure HTML/CSS/JS. Any framework (React, Vue, Svelte, etc.) can be used as long as the build output is static web assets.
5. **Single MCP Server**: All mini-apps share one MCP proxy. No per-app server processes.
6. **Declarative tools**: Tools are declared in `manifest.json`, not in code. The host registers/unregisters them dynamically.

## Architecture

### Agent ↔ Mini-App Communication

```
┌──────────────────────────────────────────────────────┐
│ SuperOne Host                                        │
│                                                      │
│  Agent (Claude / Codex / any MCP-compatible)         │
│    │                                                 │
│    │ MCP protocol (stdio)                            │
│    ▼                                                 │
│  ┌────────────────────────────────────┐              │
│  │ Canvas MCP Proxy (built-in, 单例)   │              │
│  │                                    │              │
│  │  tools = union of all open apps    │              │
│  │  tool call → route by namespace    │              │
│  └────┬──────────┬──────────┬─────────┘              │
│       │          │          │                        │
│    postMsg    postMsg    postMsg                     │
│       │          │          │                        │
│  ┌────▼───┐ ┌───▼────┐ ┌──▼─────┐                   │
│  │ iframe │ │ iframe  │ │ iframe │                   │
│  │ App A  │ │ App B   │ │ App C  │                   │
│  └────────┘ └────────┘ └────────┘                   │
└──────────────────────────────────────────────────────┘
```

- **Agent → Mini-app**: Agent calls MCP tool → Canvas MCP Proxy routes by namespace → postMessage to target iframe → iframe handler executes → result returns via same path.
- **Mini-app → Agent**: Mini-app calls `superone.agent.sendPrompt(text)` to pre-fill the chat input. The user decides whether to send it. The mini-app cannot silently instruct the agent.

### Canvas MCP Proxy

A single MCP Server instance running inside the Electron main process. It is SuperOne's built-in code — developers never write or modify it.

Responsibilities:
- Read `manifest.json` from each open app → register tools with namespace prefix
- Route incoming `tools/call` to the correct iframe via postMessage
- Wait for iframe response → return result to agent
- Send `tools/list_changed` notification when apps open/close
- Enforce permissions (fs scope, network whitelist)

The proxy does zero computation. It is purely a message router between MCP protocol and postMessage.

### Inter-App Communication

Mini-apps don't need a dedicated inter-app messaging protocol. The agent serves as a natural message bus:

```
Mini-app A  ──sendPrompt──►  Agent  ──MCP tool──►  Mini-app B
```

The user can simply say "sync the API tester results to the dashboard" and the agent coordinates both mini-apps.

### Tool Namespacing

Tools are namespaced by app ID to prevent collisions:

```
api-tester:show_response
dashboard:update_chart
todo:add_item
```

Developers declare tools without prefix in `manifest.json`. The host automatically adds the `<appId>:` prefix when registering with MCP.

## Directory Structure

All mini-apps are installed in a single centralized location:

```
~/.superone/apps/
├── todo/
│   ├── manifest.json
│   ├── index.html
│   ├── style.css
│   └── icon.svg
├── api-tester/
│   ├── manifest.json
│   ├── index.html
│   └── assets/
│       ├── index.js
│       └── style.css
└── dashboard/
    ├── manifest.json
    └── index.html
```

- **Install** = place a folder in `~/.superone/apps/`
- **Uninstall** = remove the folder
- **Discovery** = scan the directory

### Allowed Directories

The mini-app's code location and its accessible directories are decoupled:

- **Code**: always in `~/.superone/apps/<name>/`
- **Allowed directories**: resolved at runtime from `permissions.fs` entries. Each entry specifies a `scope` (`project`, `user`, or `app`) and an optional `path`.

For example, a Markdown editor with `permissions.fs: [{ scope: "project", path: "docs" }]` in a project at `~/my-project/` can access `~/my-project/docs/`.

Apps can declare multiple directories. All `superone.fs.*` calls are validated against the full list of allowed directories.

## Manifest

Each mini-app must have a `manifest.json`:

```json
{
  "name": "API Tester",
  "icon": "icon.svg",
  "permissions": {
    "fs": [
      { "scope": "project", "path": ".", "access": "readwrite", "reason": "Read and write project files" }
    ],
    "network": [
      { "domain": "api.github.com", "reason": "Fetch repository data" },
      { "domain": "localhost:8787", "reason": "Connect to local dev server" },
      { "domain": "kv.example.com", "reason": "Access key-value storage" }
    ]
  },
  "tools": [
    {
      "name": "show_response",
      "description": "Display an API response in the tester UI",
      "inputSchema": {
        "type": "object",
        "properties": {
          "status": { "type": "number" },
          "headers": { "type": "object" },
          "body": { "type": "string" }
        },
        "required": ["status", "body"]
      }
    }
  ]
}
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Display name |
| `icon` | No | Relative path to icon file (SVG/PNG) |
| `permissions.fs` | No | Array of directory entries: `{ scope: "project"\|"user", path: "..." }` or `{ scope: "app" }`. Controls which directories the app can access via `superone.fs.*`. |
| `permissions.network` | No | Whitelisted domains (local or remote). Controls CSP `connect-src` and `script-src`. Apps can `fetch` these freely — enables KV stores, databases, remote APIs. |
| `tools` | No | MCP tool definitions the mini-app handles. Declared statically; host registers them when app opens. |

### CSP Generation

The Content-Security-Policy header is generated per mini-app based on its manifest:

- No `permissions.network` → `connect-src 'self' superone-app:; script-src 'self' 'unsafe-inline'`
- With domains declared → those domains are added to `connect-src` and `script-src`
- `img-src` always includes `'self' superone-app: data: blob:`
- `style-src` always includes `'self' 'unsafe-inline'`

## API Reference

### superone.tools (Tool Handling)

Register handlers for MCP tools declared in `manifest.json`. When an agent calls a tool, the handler executes in the iframe.

```js
superone.tools.handle('show_response', async (args) => {
  document.getElementById('output').textContent = args.body
  return { success: true, summary: `Displayed ${args.status} response` }
})
```

Tool handlers:
- Receive the `arguments` object from the MCP tool call
- Must return a JSON-serializable result
- Run in the iframe's JS context — full access to DOM, web APIs, and other `superone.*` APIs

### superone.fs (File System)

Read/write access to declared directories (requires at least one entry in `permissions.fs`).

```js
superone.fs.readFile(relativePath)    // → Promise<string>
superone.fs.readDir(relativePath)     // → Promise<{name, isDir}[]>
superone.fs.writeFile(relativePath, content)  // → Promise<void>
superone.fs.exists(relativePath)      // → Promise<boolean>
superone.fs.glob(pattern)            // → Promise<string[]>
superone.fs.watch(callback)          // → unsubscribe function
```

### superone.agent (Agent Interaction)

```js
superone.agent.sendPrompt(text)      // Pre-fill chat input, user confirms to send
```

### superone.theme (Theme)

```js
superone.isDarkMode()                // → boolean
superone.onDarkModeChange(callback)  // → unsubscribe function
```

### Network Access

Mini-apps use standard `fetch` to access whitelisted domains declared in `permissions.network`. This enables:

- **Local services**: `localhost:8787` (Cloudflare Workers local), `localhost:6379` (Redis REST), etc.
- **Remote APIs**: `api.github.com`, `api.openai.com`, etc.
- **KV / Database**: `kv.cloudflare.com`, `api.turso.tech`, any database with HTTP API

No special SuperOne API needed — just `fetch` with CSP enforcement.

## Protocol

Mini-app assets are served via the `superone-app://` custom protocol:

```
superone-app://<appId>/index.html
superone-app://<appId>/style.css
superone-app://<appId>/assets/index.js
```

Each app gets a unique `appId` derived from its directory name. The protocol handler:

1. Looks up the app's base path from the registry
2. Resolves the requested file within that path
3. Validates the path stays within bounds
4. Injects the bridge script into HTML responses
5. Sets the CSP header based on the app's manifest

### Security

- **Single trust boundary**: All developer code runs in iframe sandbox. The MCP proxy is SuperOne's own code, not developer code.
- **Path validation**: All file access is validated to stay within the app directory (for app assets) or working directory (for fs API).
- **`local-file://` blocked**: The `local-file://` protocol rejects requests from `superone-app://` origin to prevent sandbox bypass.
- **postMessage origin**: Bridge communication uses specific origins instead of `'*'`.
- **No direct Node.js access**: The iframe sandbox prevents any direct access to Electron or Node.js APIs.
- **MCP proxy is read-only**: The proxy only routes messages. It cannot execute arbitrary code.

### Permission Model

Permissions are granted at install time and stored in a global registry at `~/.superone/app-permissions.json`:

```json
{
  "todo": {
    "permissions": {
      "network": [{ "domain": "api.example.com", "reason": "Fetch task data" }],
      "fs": [{ "scope": "project", "path": ".", "access": "readwrite", "reason": "Manage todo files" }]
    },
    "grantedAt": "2026-04-02T10:00:00Z"
  }
}
```

**Flow:**

1. **First open** — When user opens an app that has no entry in the permission registry, SuperOne reads `manifest.json` and shows a single permission dialog listing all requested permissions (filesystem scope, network domains, MCP tools).
2. **Grant** — User approves. All permissions are saved to `~/.superone/app-permissions.json`. App opens normally.
3. **Deny** — User declines. App does not open.
4. **Subsequent opens** — No dialog. Permissions are read from the registry.
5. **Manifest change** — If a new version of the app requests additional permissions not in the registry, the dialog re-appears showing only the new permissions.
6. **Runtime enforcement** — On each `superone.fs.*` call or `fetch`, the host checks the granted permissions. If an app requests something not granted, the call is rejected.
7. **Revoke** — User can revoke permissions from settings. Next open will re-trigger the dialog.

This applies equally to installed apps and apps under local development — any app in `~/.superone/apps/` that hasn't been granted permissions will trigger the dialog on first open.

**Design principles:**

- Permissions are app-level, not project-level — granting `fs: "project"` means the app can access the working directory in any project.
- The manifest declares what the app *requests*; the registry records what the user *granted*. They may differ if the manifest is updated.
- Uninstalling an app (removing its directory) does not automatically remove its permission entry, allowing re-install without re-authorization.

## Capability Boundaries

### What Mini-Apps CAN Do

| Capability | How |
|-----------|-----|
| Read/write project files | `superone.fs.*` API |
| Render any UI | HTML/CSS/JS, Canvas, WebGL, SVG |
| Call whitelisted APIs | `fetch` with manifest-declared domains |
| Use KV / databases | `fetch` to whitelisted local or remote services |
| Load CDN resources | Manifest-declared domains |
| Receive agent commands | `superone.tools.handle()` |
| Request agent actions | `superone.agent.sendPrompt()` (user confirms) |
| Play audio/video | Web Audio API, `<video>` with local files |
| Complex computation | Delegate to agent via `sendPrompt` |
| Persist data | Write to working directory or whitelisted remote storage |

### What Mini-Apps CANNOT Do

| Limitation | Reason |
|-----------|--------|
| Run Node.js code | Sandboxed iframe, no server-side process |
| Embed external websites | `X-Frame-Options` / iframe nesting restrictions |
| Access Electron native APIs | Sandboxed iframe |
| Run in background | iframe unloads when user navigates away |
| Access hardware (camera, USB) | Requires Electron webContents permissions |
| Create native OS windows | No access to Electron BrowserWindow |
| Access non-whitelisted domains | CSP enforcement |

Note: Many tasks that seem to require Node.js can be achieved indirectly through the agent. For example, running shell commands, complex file operations, or compute-intensive tasks can all be delegated to the agent via `sendPrompt`.

## App Lifecycle

1. **Discovery** — SuperOne scans `~/.superone/apps/*/manifest.json` on startup
2. **Selection** — User picks an app from the canvas app directory
3. **Launch** — iframe created with `superone-app://<appId>/index.html`, bridge script injected
4. **Tool registration** — App's `tools` from manifest registered to Canvas MCP Proxy with `<appId>:` namespace prefix → `tools/list_changed` sent to agent
5. **Interactive** — Bidirectional communication: agent ↔ MCP proxy ↔ postMessage ↔ iframe ↔ superone.* APIs
6. **Teardown** — User closes app → tools unregistered from MCP proxy → `tools/list_changed` → iframe destroyed

## Development

### Simple App (No Build Step)

```html
<!-- ~/.superone/apps/hello/index.html -->
<!DOCTYPE html>
<html>
<head><title>Hello</title></head>
<body>
  <h1>Hello</h1>
  <pre id="files"></pre>
  <button id="btn">Ask Agent to Analyze</button>
  <script>
    superone.tools.handle('show_analysis', (args) => {
      document.getElementById('files').textContent = args.result
      return { success: true }
    })

    const entries = await superone.fs.readDir('.')
    document.getElementById('files').textContent = entries.map(e => e.name).join('\n')

    document.getElementById('btn').onclick = () => {
      superone.agent.sendPrompt('Analyze the project structure and suggest improvements')
    }
  </script>
</body>
</html>
```

```json
// ~/.superone/apps/hello/manifest.json
{
  "name": "Hello",
  "tools": [
    {
      "name": "show_analysis",
      "description": "Display analysis result in the Hello app",
      "inputSchema": {
        "type": "object",
        "properties": {
          "result": { "type": "string" }
        },
        "required": ["result"]
      }
    }
  ],
  "permissions": {
    "fs": "project"
  }
}
```

### Framework App (With Build Step)

Develop with any framework, build to static assets:

```bash
# Develop with React/Vite
npm create vite@latest my-app -- --template react
cd my-app && npm install && npm run build

# Deploy to SuperOne
cp -r dist/ ~/.superone/apps/my-app/
# Add manifest.json to ~/.superone/apps/my-app/
```

### App with External Services

```json
{
  "name": "Data Dashboard",
  "permissions": {
    "network": [
      { "domain": "localhost:8787", "reason": "Connect to local Cloudflare Workers dev server" },
      { "domain": "api.turso.tech", "reason": "Query Turso database for dashboard data" }
    ],
    "fs": [{ "scope": "project", "path": ".", "access": "read", "reason": "Read project data files for visualization" }]
  },
  "tools": [
    {
      "name": "refresh",
      "description": "Refresh dashboard with latest data",
      "inputSchema": { "type": "object", "properties": {} }
    }
  ]
}
```

```js
// In iframe — fetch whitelisted services directly
const kv = await fetch('http://localhost:8787/api/get?key=dashboard-state')
const db = await fetch('https://api.turso.tech/v2/pipeline', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ...' },
  body: JSON.stringify({ statements: [{ q: 'SELECT * FROM metrics' }] })
})
```

## Implementation Layers

| Layer | File | Responsibility |
|-------|------|---------------|
| Types | `src/shared/canvas-types.ts` | Shared types (manifest, app registry, tool messages) |
| MCP Server | `src/main/mcp/superone-mcp-server.ts` | Single MCP Server: tool registration, routing, lifecycle |
| Service | `src/main/canvas-service.ts` | App discovery, registry, manifest parsing, fs operations |
| Bridge | `src/main/canvas-bridge.ts` | Inject `superone.*` bridge script into iframe HTML |
| Protocol | `src/main/index.ts` | `superone-app://` protocol handler + CSP enforcement |
| IPC | `src/main/index.ts` | Canvas IPC handlers (postMessage relay) |
| Preload | `src/preload/index.ts` | Expose canvas APIs to renderer |
| UI | `src/renderer/src/components/canvas/` | App catalog, canvas layout, bridge hook |
