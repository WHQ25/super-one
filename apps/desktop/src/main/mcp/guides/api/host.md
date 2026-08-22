# Node.js MiniApp Host

Every mini-app has two independent parts:

- A full Electron `<webview>` for HTML/CSS/JS UI.
- A dedicated Node.js MiniApp Host for computation and agent-facing tools.

The MiniApp Host starts from the required `manifest.main` JavaScript entry. It runs in an Electron utility process, stays alive when the UI tab is closed, and is isolated per `(projectDir, appId)`. Mini-app installation explicitly asks the user to trust this entry with full local Node.js access.

## Entry module

```js
export async function activate(context) {
  const tool = context.tools.handle('calculate', async ({ value }) => {
    return { result: Number(value) * 2 }
  })
  context.subscriptions.push(tool)

  const messages = context.webview.onMessage((message) => {
    if (message?.type === 'refresh') {
      context.webview.postMessage({ type: 'data', value: computeData() })
    }
  })
  context.subscriptions.push(messages)
}

export async function deactivate() {
  // Optional final cleanup.
}
```

The entry must export `activate(context)`. `deactivate()` is optional.

## Context

| Member | Purpose |
|---|---|
| `appId` | Current manifest app ID. |
| `appPath` | Installed or development mini-app root. |
| `workspace.rootPath` | Current workspace root. |
| `workspace.storagePath` | Private workspace-scoped data directory, shared by repository worktrees. Created on demand — `mkdir({ recursive: true })` before writing your own files. |
| `globalStoragePath` | Private machine-wide data directory for this mini-app. |
| `workspaceState` | Small JSON-serializable state tied to the workspace. |
| `globalState` | Small JSON-serializable state shared across workspaces. |
| `tools.handle(name, handler)` | Register the implementation of a tool declared in `manifest.tools`. Returns a disposable. |
| `webview.postMessage(value)` | Send structured-cloneable data to every mounted WebView for this app/project. Queued until the WebView is ready; dropped when no WebView is open, so treat it as notification, not state transfer. |
| `webview.onMessage(handler)` | Receive `window.superone.node.postMessage(...)` from the WebView. Returns a disposable. |
| `subscriptions` | Push disposables here for automatic reverse-order cleanup. |
| `agent.sendPrompt / setContext / clearContext / onContextConsumed` | Reach the chat without a WebView. See `api-agent`. |
| `host.toast / revealInFolder / openExternal / clipboard` | Host actions that need no DOM coordinates. See `api-system`. |
| `locale.get / onChange` | Current SuperOne language. |
| `version` | SuperOne version running this mini-app. |
| `setStatus(text)` | Show a short runtime status in the sidebar. A host with a status set also counts as a background task, so quitting SuperOne asks for confirmation — pass `''` when the work is done. |

## WebView side

```js
const dispose = window.superone.node.onMessage((message) => {
  render(message)
})

window.superone.node.postMessage({ type: 'refresh' })
```

WebView messages sent during activation are queued until `activate()` completes. Tool execution never depends on a WebView being mounted.

## State and storage

Use the state stores for small settings and checkpoints:

```js
const count = (await context.workspaceState.get('count')) ?? 0
await context.workspaceState.update('count', count + 1)
await context.globalState.update('preferredModel', 'fast')
```

`update(key, undefined)` deletes a value. `keys()` lists stored keys.

For larger or queryable data, create files or a database under `workspace.storagePath` or `globalStoragePath` (create the directory first — SuperOne does not pre-create it). The MiniApp Host owns the format and may use SQLite, LevelDB, JSON, or any other Node-compatible library.

## Node access and WebView APIs

The MiniApp Host is a trusted Node.js environment. It may import Node built-ins and installed dependencies, access workspace files through `context.workspace.rootPath`, execute Git, create databases, run subprocesses, and use network clients directly.

WebViews expose no host capabilities of their own. No filesystem, Git, database, key-value, or peer APIs — and no agent, clipboard, toast, reveal, or external-link APIs either: those are `context.agent` / `context.host` on this side. What is left in the WebView is rendering, theme and locale, the anchored surfaces that need DOM coordinates (tooltip, context menu, popover, drag), and `window.superone.node` to reach back here.

Keep privileged computation in `main`; keep rendering and user interaction in WebViews; exchange structured messages across `context.webview` / `window.superone.node`.

## Lifecycle

- The host starts when the app is opened or authorized for a session.
- `activate()` must finish before tool calls or WebView messages are delivered.
- Closing a panel does not stop its host.
- Stopping/uninstalling the app, closing its final session, or quitting SuperOne deactivates the host.
- An activation failure or process exit rejects pending tool calls and is surfaced as a MiniApp Host error.
