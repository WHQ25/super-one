# Tools Guide

Tools let the agent interact with your app — calling functions, passing data, and receiving results. This topic covers declaration, handling, return values, and display customization.

## Declaring Tools

Add tools to `manifest.json` with a `toolSlug` namespace prefix:

```json
{
  "toolSlug": "my_app",
  "tools": [
    {
      "name": "render_data",
      "description": "Display data in the app — be specific, the agent reads this",
      "inputSchema": {
        "type": "object",
        "properties": {
          "title": { "type": "string", "description": "Chart title" },
          "values": { "type": "array", "items": { "type": "number" } }
        },
        "required": ["title", "values"]
      }
    }
  ]
}
```

Tools are registered as `<toolSlug>__<name>` (e.g., `my_app__render_data`). Don't include the prefix in manifest.

**Tips:**
- Write clear descriptions — the agent decides when to use the tool based on this text
- Use `description` on each property to help the agent provide correct arguments
- Keep tools focused: one action per tool, not a Swiss-army-knife with a `mode` parameter

## Tool Handlers

Register handlers in your app code to respond to agent tool calls.

Vanilla:

```js
superone.tools.handle('render_data', (args) => {
  document.getElementById('output').textContent = JSON.stringify(args)
  return { success: true, message: 'Rendered' }
})
```

React (in `useEffect`):

```js
useEffect(() => {
  window.superone.tools.handle('render_data', (args) => {
    setData(args)
    return { success: true }
  })
}, [])
```

The return value is JSON-serialized and sent back to the agent as the MCP tool result. Return meaningful data — the agent uses it to decide next steps.

**Return value tips:**
- Must be JSON-serializable (no DOM elements, functions, or circular references)
- Include status info: `{ success: true, count: 42 }` is better than just `{ success: true }`
- For errors, throw or return `{ error: 'description' }` — the agent can then retry or explain to the user

### Timeout

Each tool call has a **60-second timeout**. If the handler doesn't return within this window, the agent receives a timeout error. For long-running operations, return immediately with a status and update the UI asynchronously.

## Display Customization

Control how tool calls appear in the chat UI.

### Display Name

```json
{
  "name": "analyze_data",
  "displayName": "Analyze Data"
}
```

Human-readable tool name shown in chat. Falls back to `name` with underscores replaced by spaces.

### Running Text & Summary

```json
{
  "name": "analyze_data",
  "displayName": "Analyze Data",
  "runningText": "Analyzing",
  "inputSummaryField": "filename",
  "resultSummaryField": "summary",
  "showResult": true,
  "inputSchema": {
    "type": "object",
    "properties": {
      "filename": { "type": "string" }
    }
  }
}
```

| Field | Description |
|-------|-------------|
| `runningText` | Text shown while tool is executing. Falls back to `displayName`. |
| `inputSummaryField` | Field name from tool input. Shown in the header while running. |
| `resultSummaryField` | Field name from tool result. Shown in the header after completion. |
| `showResult` | If `true`, the full result JSON is viewable via an expandable panel. Default `false`. |

Rendering:

```
Running:   [icon] MyApp · Analyzing · report.csv…
Complete:  [icon] MyApp · Analyze Data · Found 42 items  ▼
```

To populate `resultSummaryField`, include the field in your handler's return value:

```js
superone.tools.handle('analyze_data', (args) => {
  const rows = parseCSV(args.filename)
  return {
    summary: `Found ${rows.length} items`,
    data: rows
  }
})
```

**Choosing between inputSummaryField and resultSummaryField:**

- Use `inputSummaryField` when the result is generic or repetitive (e.g., `{ success: true }`). The agent fills in tool input when making the call, so it can write a context-aware summary tailored to the current task — e.g., a human-readable description, a filename, or a short label. Design the input field with this in mind: give it a clear `description` in `inputSchema` so the agent knows to write something meaningful for the user.
- Use `resultSummaryField` when the result carries semantic meaning that varies per call (e.g., `"3 errors found"`, `"deployed to staging"`).
- You can use both: `inputSummaryField` shows during execution, `resultSummaryField` replaces it on completion. If only `inputSummaryField` is set, it persists after completion too.

**Summary writing guidelines:**

Summaries are user-facing — concise and meaningful, ideally under 20 words:
- Convey the **outcome or context**, not just repeat what the tool does
- Keep it short (long summaries get truncated)
- Good: `"report.csv"`, `"3 errors found"`, `"deploy-v2.1"`
- Bad: `"Running analyze_data tool"`, `"The analysis has been completed successfully"`

### Groupable Tools

Add `groupable: true` to allow consecutive calls to collapse into a single group:

```json
{
  "name": "process_file",
  "displayName": "Process File",
  "groupable": true,
  "inputSummaryField": "path",
  "inputSchema": { "type": "object", "properties": { "path": { "type": "string" } } }
}
```

When the agent calls a groupable tool multiple times in a row, the UI collapses them:

```
[icon] MyApp · 5 tool calls  ▼
```

Behavior: groups of >1 call are collapsed by default; the currently streaming call is always visible.

## All Tool Definition Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string (required) | Tool identifier. Lowercase + underscores only. |
| `description` | string (required) | Agent-facing — when to use this tool. |
| `displayName` | string | Human-readable name in chat UI. |
| `runningText` | string | Loading text while executing. |
| `inputSummaryField` | string | Input field to show as summary while running. |
| `resultSummaryField` | string | Result field to show as summary when complete. |
| `showResult` | boolean | Allow expanding to view full result. |
| `groupable` | boolean | Allow consecutive calls to auto-group. |
| `inputSchema` | object (required) | JSON Schema for tool parameters. |
| `renderer.intercept` | object | Human-in-the-loop: render a template in the chat tool block before the call reaches the mini-app. See below. |

## Human-in-the-Loop Tool Calls (`renderer.intercept`)

When a tool call must be confirmed or completed by the user, declare a `renderer.intercept` on the tool. The chat tool block will expand an inline iframe using one of your `templates`, and the mini-app's `tools.handle` receives a **merged** input (agent input + user input) only after the user submits.

Lifecycle:

1. Agent streams input.
2. SuperOne detects `renderer.intercept` and pauses dispatch.
3. The chat tool block expands the template iframe. `superone.tool.data` holds the agent input.
4. User interacts and calls `superone.tool.submit(userInput)` or `superone.tool.cancel(reason)`.
5. SuperOne merges `agentInput` and `userInput` (per `inputMerge`) and finally dispatches to the mini-app's `tools.handle`.
6. The handler's return value becomes the tool result; the tool block collapses back to the running state until result arrives.

```json
{
  "name": "confirm_purchase",
  "description": "Propose a purchase; user must confirm qty and payment.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "item_id": { "type": "string" },
      "suggested_qty": { "type": "number" }
    },
    "required": ["item_id", "suggested_qty"]
  },
  "renderer": {
    "intercept": {
      "template": "confirm",
      "inputMerge": "shallow-merge",
      "onCancel": "resolve-empty",
      "height": 200
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `template` | string (required) | Key in `manifest.templates` pointing to the intercept HTML. |
| `inputMerge` | `'shallow-merge' \| 'replace'` | How to combine agent input with user input. Default `shallow-merge`. |
| `onCancel` | `'reject' \| 'resolve-empty'` | What the agent sees if the user cancels. `reject` surfaces an error; `resolve-empty` returns `{ cancelled: true, reason }`. Default `reject`. |
| `timeoutMs` | number | Maximum time to wait for user input before failing. Defaults to the global tool-call timeout (60s). Use `0` to disable (wait forever). |

Template height is controlled entirely by the template itself — the iframe auto-resizes to the body. Handle loading placeholders and skeleton UIs inside the template's HTML/CSS, not via manifest config.

### Intercept Template API

Inside an intercept template only `window.superone.tool` is exposed (plus the usual read-only APIs like `fs`, `theme`, `clipboard`). The template **must** call either `submit` or `cancel` exactly once:

```js
// popovers/confirm.html
var agentInput = superone.tool.data

document.getElementById('ok').onclick = function() {
  superone.tool.submit({ final_qty: 2, payment: 'alipay' })
}
document.getElementById('cancel').onclick = function() {
  superone.tool.cancel('user_rejected')
}
```

`superone.tool` fields:

| Field | Description |
|-------|-------------|
| `phase` | Always `'intercept'` in this mode. |
| `callId` | Internal identifier. |
| `toolName` | The tool name being intercepted. |
| `data` | The agent's input (the un-merged `agentInput`). |
| `submit(userInput)` | Finalise the call. The mini-app's `tools.handle` runs next. |
| `cancel(reason?)` | Abort. See `onCancel`. |

Notes:

- Templates are sandboxed iframes and cannot call `ui.showPopover` recursively.
- The same `templates` map is shared with `ui.showPopover`; a template may serve both use cases by inspecting URL parameters (`_toolIntercept`, `_toolResult`, `_popover`).
- Default timeout follows the global tool-call timeout (60s). Tune per-tool via `timeoutMs`, or set to `0` to wait indefinitely.
- When the agent is interrupted, all pending intercept prompts are rejected and collapsed automatically.

## Result Renderer (`renderer.result`)

Show a custom HTML view for the tool's result instead of (or in addition to) the raw JSON expand panel. The template is loaded inline in the chat tool block and receives the tool result as `superone.tool.data`.

Unlike `renderer.intercept`, this is purely presentational — the agent-visible tool result is already finalised by the time the template loads. The template cannot change it.

```json
{
  "name": "confirm_purchase",
  "description": "…",
  "inputSchema": { "type": "object", "properties": { /* … */ } },
  "renderer": {
    "result": {
      "template": "receipt",
      "autoExpand": true,
      "height": 180
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `template` | string (required) | Key in `manifest.templates` pointing to the result HTML. |
| `autoExpand` | boolean | If `true`, the renderer is expanded as soon as the result arrives. Defaults `false` — the user clicks the tool block to expand. Recommend `false` in production to keep the chat compact. |

### Result Template API

Inside a result template, `window.superone.tool` exposes:

| Field | Description |
|-------|-------------|
| `phase` | Always `'result'` in this mode. |
| `callId` | Internal identifier (equals the tool block's `toolUseId`). |
| `toolName` | The tool name that produced the result. |
| `data` | The tool's return value (already parsed from JSON). |
| `close()` | Collapse the renderer view. The result itself is unaffected. |

```js
// popovers/receipt.html
var r = superone.tool.data
document.getElementById('order').textContent = r.order_id
document.getElementById('close').onclick = () => superone.tool.close()
```

Tips:

- Keep result renderers **read-only** — buttons that would mutate state should trigger a new agent prompt via `superone.agent.sendPrompt()` rather than reusing the same tool call.
- `resultSummaryField` still works: pick a short string from the result and it will show in the collapsed header, making the tool block informative even before the user expands it.
- Combining `renderer.intercept` and `renderer.result` on the same tool gives you full control of both phase 2 (user input) and phase 5 (result display).
