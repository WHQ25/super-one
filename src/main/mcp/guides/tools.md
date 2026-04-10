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
