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
| `standalone` | boolean | Render the tool call as a self-contained iframe inside the chat tool block. The `renderer.result.template` HTML registers the handler **and** renders the UI, so the call works even when the app's main panel is closed. See "Standalone Tools" below. |
| `timeoutMs` | number | Per-tool timeout for the handler in milliseconds (positive integer). Falls back to the global 60s timeout when unset. |
| `renderer.intercept` | object | Human-in-the-loop: render a template in the chat tool block before the call reaches the handler. See below. |
| `renderer.result` | object | Custom inline result UI rendered after the handler returns. **Required** when `standalone: true` (the template doubles as the handler host). See "Result Renderer" below. |

> **React/Vite template:** every `templates.*` HTML below (`renderer.intercept`, `renderer.result`, `standalone`, and `ui.showPopover`) is a **separate Vite entry**, not part of your React SPA — each must be added to `rollupOptions.input` or the build emits no such HTML. Each is an independent React root. See the "React / Vite — Multi-Page Entries" section in the `manifest` topic. (Vanilla template: just author each `.html` directly — no build step.)

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
- `intercept` may be combined with `standalone: true`. The intercept template renders first (phase 1); on `submit`, the merged input is dispatched to the standalone result iframe's handler (phase 2). See "Standalone Tools" below for the full lifecycle.

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

## Standalone Tools (`standalone`)

Standalone tools turn the chat tool block itself into the runtime: one iframe per call, loaded from `renderer.result.template`, that **both registers the handler and renders the result UI**. The app's main panel does not need to be open — the chat-block iframe is the runtime.

Use standalone when:

- The tool produces a focused, visual result that belongs **inline in the chat** (a counter card, a chart, a receipt, a diff preview), not in a separate panel.
- The agent may call the tool while the panel is closed and you still want it to work without forcing the panel open.
- The tool's logic is small enough to live in a single self-contained template HTML (state lives in `superone.kv` or external storage, not in DOM held by the panel).

Use a panel-bound tool (no `standalone`) when the handler mutates UI state already living in the open panel, or when several tools share in-memory state held by the panel's main HTML.

### Declaring a Standalone Tool

```json
{
  "toolSlug": "demo",
  "templates": {
    "increment-result": "increment-result.html"
  },
  "tools": [
    {
      "name": "increment",
      "description": "Increment the counter and render a +N card.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "by": { "type": "number", "description": "Amount to add (default 1)" }
        }
      },
      "standalone": true,
      "renderer": { "result": { "template": "increment-result" } }
    }
  ]
}
```

Schema rules:

- `standalone: true` **requires** `renderer.result.template` — without it the call has nowhere to register a handler. The manifest fails to load otherwise.
- `standalone` is compatible with `renderer.intercept` (see lifecycle below).
- `renderer.result.autoExpand` is implied for standalone: the iframe is always visible (the tool block IS the iframe), there is no separate collapsed/expanded chrome.

### Standalone Template Contract

The result template registers the handler **and** renders the UI. Both halves live in the same HTML — when the iframe mounts, `tools.handle(...)` runs in time to receive the dispatched call:

```js
// increment-result.html
superone.tools.handle('increment', async ({ by }) => {
  const amount = typeof by === 'number' ? by : 1
  const current = (await superone.kv.get('counter')) ?? 0
  const next = current + amount
  await superone.kv.set('counter', next)
  return { ok: true, previous: current, value: next }
})

function render(detail) {
  if (detail.error) { /* show error */ return }
  const r = detail.result
  document.getElementById('card').textContent = `${r.previous} → ${r.value}`
}

// Live updates while the call is in flight:
window.addEventListener('superone:tool-result', (ev) => render(ev.detail))

// Replay path: if the iframe was unmounted and remounted (scrolled offscreen),
// the cached result is exposed synchronously on superone.tool.
const t = window.superone && window.superone.tool
if (t && (t.result !== null || t.error !== null)) render({ result: t.result, error: t.error })
```

Two ways to get the result into the UI:

1. **Live**: listen for `superone:tool-result`. Fired once when the handler returns (or throws). Use this for the freshly-dispatched call.
2. **Replay**: on remount, read `superone.tool.result` / `superone.tool.error` synchronously. SuperOne caches the result so scrolling back to an older tool block re-renders without re-running the handler.

The handler is dispatched exactly once per `toolUseId`. Remounting the iframe (e.g. after scrolling) does not re-dispatch — it only triggers the replay path.

Inside a standalone iframe, `window.superone.tool` exposes:

| Field | Description |
|-------|-------------|
| `phase` | Always `'standalone'`. |
| `callId` | Internal identifier. |
| `toolName` | The tool name being dispatched. |
| `args` | The merged input passed to the handler (set once dispatch begins). |
| `result` | The handler's return value, or `null` until it resolves. |
| `error` | Error message, or `null` if no error. |

Note: `superone.tool.data` and `superone.tool.close()` (from non-standalone result templates) are **not** exposed here. The iframe IS the tool block — there is no separate "closed" state.

### Lifecycle

| Phase | Without intercept | With `intercept` + `standalone` |
|-------|-------------------|----------------------------------|
| 1. Agent emits tool_use | — | Intercept iframe mounts in the chat block; user submits/cancels. |
| 2. Iframe mounts | Standalone result iframe mounts; `tools.handle` registers. | Intercept iframe collapses; standalone result iframe mounts; `tools.handle` registers. |
| 3. Dispatch | SuperOne dispatches the agent's input to the handler. | SuperOne dispatches the **merged** (agent + user) input to the handler. |
| 4. Render | Handler returns → `superone:tool-result` fires → UI updates. | Same as left. |
| 5. Replay | On remount, read `superone.tool.result` / `.error` synchronously. | Same as left. |

### Notes

- Standalone iframes share the same `templates` map as `ui.showPopover`, `renderer.intercept`, and (non-standalone) `renderer.result`. The runtime sets a URL flag per mode (`_standalone=1`, `_toolIntercept=1`, `_toolResult=1`, `_popover=<name>`) so a template can detect its mode if reused across surfaces.
- Multiple standalone calls in the same chat each get their own iframe instance — no shared module state. Persist with `superone.kv`, `superone.fs`, or the host system.
- The iframe is unmounted when its tool block scrolls far enough out of the viewport and re-mounted when it comes back. On remount the handler does **not** re-dispatch — only the replay path fires. Keep heavy work inside the handler, not at module top-level, so re-mounts stay cheap.
- Standalone tools still respect `timeoutMs` on the handler side; an unfinished handler past the timeout returns an error to the agent and triggers the error branch in your template.
