# SuperOne Mini-App (Canvas) Architecture

## Overview

SuperOne mini-apps are built on the [MCP Apps](https://github.com/modelcontextprotocol/ext-apps) standard (spec version 2026-01-26) with SuperOne-specific extensions. Every mini-app is fundamentally an **MCP Server with an interactive UI** — it can be driven by the AI agent through MCP tools, and it can request the agent's help via `sendPrompt`.

```
Mini-App = MCP App (standard) + superone.* extensions (desktop-enhanced)
```

## Core Design Principles

1. **MCP Apps compatible**: Any standard MCP App runs in SuperOne out of the box. SuperOne acts as a compliant MCP Apps host.
2. **Agentic-first**: Mini-apps are not just standalone tools — they are agent-powered. The agent can operate mini-apps via MCP tools, and mini-apps can request agent actions via `sendPrompt`.
3. **Desktop-enhanced**: SuperOne extends the standard with local filesystem access and a dedicated canvas panel (not just inline in chat).
4. **Web-standard**: Mini-apps are pure HTML/CSS/JS. Any framework (React, Vue, Svelte, etc.) can be used as long as the build output is static web assets.
5. **Minimal API surface**: The platform provides a small set of `superone.*` APIs. Most heavy-lifting is done by the agent through MCP.
6. **Sandboxed isolation**: Mini-apps run in iframe sandboxes, isolated from the host application and each other.

## Architecture

### Two-Way Agent Communication

```
┌─────────────┐    MCP Tools     ┌─────────────┐
│             │  ◄──────────────  │             │
│   Agent     │                  │   Mini-app   │
│             │  ──────────────► │             │
└─────────────┘   sendPrompt     └─────────────┘
                  (user confirms)
```

- **Agent → Mini-app**: Agent calls MCP tools defined in the mini-app's `manifest.json`. Tool calls are routed to the mini-app via postMessage. The agent can update UI, push data, trigger actions in the mini-app.
- **Mini-app → Agent**: Mini-app calls `superone.agent.sendPrompt(text)` to pre-fill the chat input. The user decides whether to send it. The mini-app cannot silently instruct the agent.

### Inter-App Communication

Mini-apps don't need a dedicated inter-app messaging protocol. The agent serves as a natural message bus:

```
Mini-app A  ──sendPrompt──►  Agent  ──MCP tool──►  Mini-app B
```

The user can simply say "sync the API tester results to the dashboard" and the agent coordinates both mini-apps.

### Runtime Architecture

```
┌──────────────────────────────────────────────────────────┐
│ SuperOne (Electron Host)                                 │
│                                                          │
│  ┌─────────────┐    MCP Protocol    ┌─────────────────┐  │
│  │   Agent      │◄────────────────►│   MCP Server     │  │
│  │  (Claude)    │   tools/call      │   (per app)      │  │
│  └──────┬───────┘                   └────────┬────────┘  │
│         │                                    │           │
│         │ IPC                     resources/read         │
│         │                                    │           │
│  ┌──────▼───────────────────────────────────▼────────┐  │
│  │ AppBridge (host-side)                              │  │
│  │  - JSON-RPC 2.0 over postMessage                   │  │
│  │  - CSP enforcement                                 │  │
│  │  - Tool input/result forwarding                    │  │
│  └──────────────────────┬────────────────────────────┘  │
│                         │ postMessage                    │
│  ┌──────────────────────▼────────────────────────────┐  │
│  │ iframe (sandboxed)                                 │  │
│  │  ┌─────────────────────────────────────────────┐   │  │
│  │  │ Mini-App (HTML/CSS/JS)                      │   │  │
│  │  │  - App class (@modelcontextprotocol/ext-apps)│  │  │
│  │  │  - superone.* extensions                    │   │  │
│  │  └─────────────────────────────────────────────┘   │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

All communication between the mini-app iframe and the host goes through JSON-RPC 2.0 over `postMessage` (MCP Apps standard protocol). The iframe has no direct access to Node.js, Electron APIs, or the host DOM.

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

### Working Directory

The mini-app's code location and its working directory are decoupled:

- **Code**: always in `~/.superone/apps/<name>/`
- **Working directory**: bound at runtime, defaults to the current project. The user can choose which project/folder the mini-app operates on.

All `superone.fs.*` calls use paths relative to the working directory.

## Manifest

Each mini-app must have a `manifest.json`:

```json
{
  "name": "API Tester",
  "icon": "icon.svg",
  "permissions": {
    "network": [
      "api.github.com",
      "cdn.jsdelivr.net"
    ],
    "fs": "project"
  },
  "mcpTools": [
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
| `permissions.network` | No | List of allowed external domains. Controls CSP `connect-src` and `script-src`. |
| `permissions.fs` | No | `"app"` (default, only own directory) or `"project"` (working directory access) |
| `mcpTools` | No | MCP tool definitions the mini-app handles. Declared statically; agent discovers them on mini-app load. |

### CSP Generation

The Content-Security-Policy header is generated per mini-app based on its manifest:

- No `permissions.network` → `connect-src 'self' superone-app:; script-src 'self' 'unsafe-inline'`
- With domains declared → those domains are added to `connect-src` and `script-src`
- `img-src` always includes `'self' superone-app: data: blob:`
- `style-src` always includes `'self' 'unsafe-inline'`

## MCP Apps Standard (Baseline)

SuperOne is a compliant [MCP Apps](https://github.com/modelcontextprotocol/ext-apps) host. The standard provides:

### How MCP Apps Works

1. MCP Server registers a **tool** with `_meta.ui.resourceUri` pointing to a `ui://` resource
2. When the agent calls that tool, the host fetches the HTML resource via `resources/read`
3. Host renders the HTML in a **sandboxed iframe**, injecting JSON-RPC communication
4. The iframe uses the `App` class to receive tool input/results and call server tools back

### Standard SDK Usage

**Server side** (`@modelcontextprotocol/ext-apps/server`):

```typescript
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'

const resourceUri = 'ui://my-app/view.html'

registerAppTool(server, 'show-dashboard', {
  description: 'Display interactive dashboard',
  _meta: { ui: { resourceUri } },
}, async (args) => {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] }
})

registerAppResource(server, 'Dashboard', resourceUri, {
  mimeType: RESOURCE_MIME_TYPE,
}, async () => ({
  contents: [{
    uri: resourceUri,
    mimeType: RESOURCE_MIME_TYPE,
    text: htmlContent,
    _meta: { ui: { csp: { connectDomains: ['https://api.example.com'] } } },
  }],
}))
```

**Client side** (`@modelcontextprotocol/ext-apps` in iframe):

```typescript
import { App } from '@modelcontextprotocol/ext-apps'

const app = new App({ name: 'My Dashboard', version: '1.0.0' })

app.ontoolinput = (params) => {
  // Tool arguments arrive (before result) — can show loading/preview
  showLoadingState(params.arguments)
}

app.ontoolresult = (result) => {
  // Tool execution result — update UI
  renderDashboard(result.content)
}

// UI can call server tools back
button.onclick = () => app.callServerTool({ name: 'refresh-data', arguments: {} })

// app.updateModelContext() informs the agent of UI state changes
await app.connect()
```

### Standard Capabilities

| Feature | Description |
|---------|-------------|
| `ui://` resources | URI scheme for UI HTML content |
| Tool ↔ Resource linking | `_meta.ui.resourceUri` associates tool with UI |
| JSON-RPC 2.0 over postMessage | Bidirectional iframe ↔ host communication |
| CSP | `csp.resourceDomains` / `csp.connectDomains` in resource metadata |
| Tool visibility | `["model"]`, `["app"]`, or `["model", "app"]` (default) |
| iframe permissions | `camera`, `microphone`, `geolocation`, `clipboard-write` |
| Host theme | Theme (light/dark) + CSS variables passed to app |
| Display modes | `inline`, `fullscreen`, `pip` |
| updateModelContext | App informs agent of UI state changes |
| openLink / downloadFile | App requests host to open URL or download file |
| Partial tool input | Streaming partial arguments for progressive rendering |
| Tool cancellation | Host notifies app when tool execution is cancelled |
| Extension negotiation | `io.modelcontextprotocol/ui` capability in `extensions` |

### Key Differences: MCP Apps Standard vs SuperOne

| Capability | MCP Apps Standard | SuperOne Extension |
|-----------|-------------------|-------------------|
| Rendering location | Inline in chat conversation | Dedicated canvas panel (persistent) |
| Local filesystem | ✗ | ✓ `superone.fs.*` (read/write) |
| Agent prompt | `updateModelContext` (indirect) | `sendPrompt` (pre-fills chat input) |
| App storage | Per MCP server (server-hosted) | Central `~/.superone/apps/` (local) |
| Working directory | N/A (server-scoped) | User-selectable project directory |
| Tool definition | Server-side code (runtime) | Declarative `manifest.json` (static) |
| CSP config | Server-side `_meta.ui.csp` | `manifest.json` `permissions.network` |

SuperOne's manifest-based tool declaration means mini-apps don't need a running MCP server process — the host reads `manifest.json` and registers tools when the app opens, unregisters when it closes.

## API Reference

### superone.fs (File System)

Read/write access to the working directory (requires `permissions.fs: "project"`).

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

### MCP Apps API (Standard)

Mini-apps use the MCP Apps `App` class for tool communication (standard, works in any MCP Apps host):

```js
import { App } from '@modelcontextprotocol/ext-apps'

const app = new App({ name: 'My App', version: '1.0.0' })

app.ontoolinput = (params) => { /* tool arguments arrive */ }
app.ontoolresult = (result) => { /* tool execution result */ }
app.ontoolinputpartial = (params) => { /* streaming partial args for preview */ }
app.ontoolcancelled = () => { /* tool execution was cancelled */ }
app.onhostcontextchanged = (ctx) => { /* theme/locale changes */ }

await app.callServerTool({ name: 'my-tool', arguments: {} })
app.updateModelContext({ resource: { ... } })
app.openLink({ uri: 'https://example.com' })

await app.connect()
```

### superone.theme (Theme)

```js
superone.isDarkMode()                // → boolean
superone.onDarkModeChange(callback)  // → unsubscribe function
```

Note: MCP Apps standard also provides theme via `app.getHostContext().theme` and CSS variables. `superone.isDarkMode()` is a convenience alias.

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

- **Path validation**: All file access is validated to stay within the app directory (for app assets) or working directory (for fs API).
- **`local-file://` blocked**: The `local-file://` protocol rejects requests from `superone-app://` origin to prevent sandbox bypass.
- **postMessage origin**: Bridge communication uses specific origins instead of `'*'`.
- **No direct Node.js access**: The iframe sandbox prevents any direct access to Electron or Node.js APIs.

## Capability Boundaries

### What Mini-Apps CAN Do

| Capability | How |
|-----------|-----|
| Read/write project files | `superone.fs.*` API |
| Render any UI | HTML/CSS/JS, Canvas, WebGL, SVG |
| Call external APIs | `fetch` with manifest-declared domains |
| Load CDN resources | Manifest-declared domains |
| Receive agent commands | MCP tool handlers |
| Request agent actions | `sendPrompt` (user confirms) |
| Play audio/video | Web Audio API, `<video>` with local files |
| Complex computation | Delegate to agent (calls CLI tools like ffmpeg, etc.) |
| Persist data | Write to working directory as JSON/files |

### What Mini-Apps CANNOT Do

| Limitation | Reason |
|-----------|--------|
| Embed external websites | `X-Frame-Options` / iframe nesting restrictions |
| Access Electron native APIs | Sandboxed iframe, no Node.js |
| Run in background | iframe unloads when user navigates away |
| Access hardware (camera, USB) | Requires Electron webContents permissions |
| Create native OS windows | No access to Electron BrowserWindow |
| Register OS-level integrations | No file associations, URL schemes, etc. |

Note: Many tasks that seem to require these capabilities can be achieved indirectly through the agent. For example, running shell commands, complex file operations, or compute-intensive tasks can all be delegated to the agent via `sendPrompt`.

## App Lifecycle

1. **Discovery** — SuperOne scans `~/.superone/apps/*/manifest.json` on startup
2. **Selection** — User picks an app from the canvas app directory
3. **Launch** — iframe created with `superone-app://<appId>/index.html`, bridge script injected
4. **Handshake** — MCP Apps `initialize` exchange: host sends capabilities/theme, app responds
5. **MCP registration** — App's `mcpTools` from manifest registered with the agent's tool list
6. **Interactive** — Bidirectional communication: agent ↔ MCP tools ↔ UI ↔ superone.* APIs
7. **Teardown** — User closes app → `teardownResource` sent → MCP tools unregistered → iframe destroyed

## Development

### Simple App (No Build Step)

A pure local tool using superone.fs + agent integration:

```html
<!-- ~/.superone/apps/hello/index.html -->
<!DOCTYPE html>
<html>
<head><title>Hello</title></head>
<body>
  <h1>Hello</h1>
  <pre id="files"></pre>
  <button id="btn">Ask Agent to Analyze</button>
  <script type="module">
    import { App } from '@modelcontextprotocol/ext-apps'

    const app = new App({ name: 'Hello', version: '1.0.0' })

    // Receive data from agent via MCP tool
    app.ontoolinput = (params) => {
      document.getElementById('files').textContent = JSON.stringify(params.arguments, null, 2)
    }

    // Load file list on startup using superone extension
    const entries = await superone.fs.readDir('.')
    document.getElementById('files').textContent = entries.map(e => e.name).join('\n')

    // Request agent help
    document.getElementById('btn').onclick = () => {
      superone.agent.sendPrompt('Analyze the project structure and suggest improvements')
    }

    await app.connect()
  </script>
</body>
</html>
```

Note: For simple apps that don't need MCP tool communication with the agent, the `App` class import and `connect()` can be omitted. The `superone.*` APIs work independently.

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

## Implementation Layers

| Layer | File | Responsibility |
|-------|------|---------------|
| Types | `src/shared/canvas-types.ts` | Shared types (manifest, app registry) |
| Service | `src/main/canvas-service.ts` | App discovery, registry, manifest parsing, fs operations |
| Bridge | `src/main/canvas-bridge.ts` | Inject `superone.*` bridge + MCP Apps `PostMessageTransport` |
| AppBridge | `src/main/canvas-app-bridge.ts` | Host-side MCP Apps bridge (tool input/result forwarding) |
| Protocol | `src/main/index.ts` | `superone-app://` protocol handler + CSP enforcement |
| IPC | `src/main/index.ts` | Canvas IPC handlers |
| Preload | `src/preload/index.ts` | Expose canvas APIs to renderer |
| UI | `src/renderer/src/components/canvas/` | App catalog, canvas layout, bridge hook |
