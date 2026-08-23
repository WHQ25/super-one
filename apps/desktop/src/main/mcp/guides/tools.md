# Agent-Facing Tools

Tools have two separate layers:

1. `manifest.tools` describes the MCP contract and optional UI.
2. `manifest.main` registers the computation handler in the Node.js MiniApp Host.

WebViews never implement tool computation.

## Declare a tool

```json
{
  "main": "node.js",
  "tools": [
    {
      "name": "create_task",
      "description": "Create a task in the current project",
      "inputSchema": {
        "type": "object",
        "properties": {
          "title": { "type": "string" },
          "priority": { "type": "string", "enum": ["low", "high"] }
        },
        "required": ["title"]
      }
    }
  ]
}
```

Tool names use lowercase letters, digits, and underscores. Agents call them through `miniapp_call` with `{ appId, tool, input }`.

## Implement it in the MiniApp Host

```js
export function activate(context) {
  context.subscriptions.push(
    context.tools.handle('create_task', async ({ title, priority = 'low' }) => {
      const task = await saveTask({ title, priority }, context.workspace.rootPath)
      context.webview.postMessage({ type: 'task-created', task })
      return task
    }),
  )
}
```

The handler name must exactly match the manifest declaration. It can use Node.js, installed packages, network clients, files, subprocesses, and `context.workspace.rootPath`. Its return value must be structured-cloneable.

Tool execution waits for `activate()` but never waits for a panel WebView. If the panel is open, `context.webview.postMessage` can update it; if no WebView is mounted, computation still completes.

## Display metadata

| Field | Purpose |
|---|---|
| `displayName` | Human-readable name in chat. |
| `runningText` | Text shown while running. |
| `inputSummaryField` | Input field used for a compact summary. |
| `resultSummaryField` | Result field used for a compact summary. |
| `showResult` | Show raw result content. |
| `groupable` | Allow adjacent calls to group. |
| `timeoutMs` | Tool timeout override. |

## User intercept

Use `renderer.intercept` when the user must confirm or supplement input before computation begins.

```json
{
  "templates": { "confirm": "confirm.html" },
  "tools": [{
    "name": "delete_task",
    "description": "Delete a task",
    "inputSchema": {
      "type": "object",
      "properties": { "id": { "type": "string" } },
      "required": ["id"]
    },
    "renderer": {
      "intercept": {
        "template": "confirm",
        "inputMerge": "shallow-merge",
        "onCancel": "reject"
      }
    }
  }]
}
```

In `confirm.html`:

```js
const tool = window.superone.tool
if (tool?.phase === 'intercept') {
  renderConfirmation(tool.data)
  confirmButton.onclick = () => tool.submit({ confirmed: true })
  cancelButton.onclick = () => tool.cancel('User cancelled')
}
```

- `inputMerge: "shallow-merge"` merges user input over agent input.
- `inputMerge: "replace"` uses only user input.
- `onCancel: "reject"` returns an error.
- `onCancel: "resolve-empty"` returns a cancelled result without calling the MiniApp Host.

The intercept is a full WebView and has the normal `window.superone` browser APIs.

## Result renderer

Attach `renderer.result` to render a tool result in chat:

```json
{
  "templates": { "task-card": "task-card.html" },
  "tools": [{
    "name": "create_task",
    "description": "Create a task",
    "inputSchema": { "type": "object" },
    "renderer": {
      "result": { "template": "task-card", "autoExpand": true }
    }
  }]
}
```

In the result WebView, `window.superone.tool.phase === "result"`, `tool.data` is the final tool result, and `tool.close()` collapses it.

## Standalone result UI

`standalone: true` means the result WebView is the visible tool block even when the main panel is closed. It does not move computation into the WebView; the handler still runs once in the MiniApp Host.

```json
{
  "templates": { "counter": "counter.html" },
  "tools": [{
    "name": "increment",
    "description": "Increment the counter",
    "standalone": true,
    "inputSchema": {
      "type": "object",
      "properties": { "by": { "type": "number" } }
    },
    "renderer": { "result": { "template": "counter" } }
  }]
}
```

The standalone WebView observes execution state:

```js
const tool = window.superone.tool
if (tool?.phase === 'standalone') {
  const render = ({ args, result, error }) => {
    output.textContent = error ?? JSON.stringify(result ?? { running: true, args })
  }
  render(tool.getState())
  const dispose = tool.onDidChange(render)
}
```

Remounting a chat result replays cached state but never re-executes the handler.

## Design rules

- Keep tool computation and mutable process state in `manifest.main`.
- Keep HTML entries focused on rendering and user input.
- Prefer a normal tool plus optional result renderer; use `standalone` only when the tool block itself should always be the UI.
- Return small structured results. Persist large data in files or a database and return references or summaries.
- Register every tool handler during `activate()` and push disposables to `context.subscriptions`.
- Use `context.webview.postMessage` only for UI synchronization, not as the tool result channel.
