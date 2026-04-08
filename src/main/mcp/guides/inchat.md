# In-Chat App Guide

In-chat apps are data-driven rendering templates displayed inline in chat messages. The agent passes structured data via an MCP tool, and the app renders it.

## Manifest

Start with the scaffold from `setup_mini_app_dev` (use `type: "in-chat"`), then edit `manifest.json` to add the required in-chat fields.

### Required Fields

| Field | Description |
|-------|-------------|
| `appId` | Unique ID. `^[a-z0-9][a-z0-9_-]*$` |
| `name` | Display name |
| `inChatToolName` | MCP tool name. Lowercase + underscores. Registered as `inchat__<inChatToolName>`. |
| `inputSchema` | JSON Schema for the data the agent passes. Becomes the MCP tool's input schema. |

### Optional Fields

| Field | Description |
|-------|-------------|
| `version` | Semver (required for packaging) |
| `author` | `{ name, email?, url? }` |
| `icon` | Monochrome icon. See `icon` topic. |
| `logo` | Full-color brand image. See `icon` topic. |
| `description` | Short description — also used as tool description if `inChatToolDescription` is not set |
| `inChatToolDescription` | Description for the AI agent explaining when to use this tool |
| `runningText` | Text shown while the agent is streaming tool input. Default: "Loading..." |

**Important:** In-chat apps must NOT declare `tools[]`. Use standard apps for bidirectional tool calls.

### Example Manifest

```json
{
  "appId": "daily-report",
  "name": "Daily Report",
  "type": "in-chat",
  "description": "Render a daily work report with timeline and categories",
  "inChatToolName": "render_daily_report",
  "inChatToolDescription": "Render a daily work report. Use when the user asks to summarize work or create a report.",
  "runningText": "Generating report...",
  "inputSchema": {
    "type": "object",
    "properties": {
      "title": { "type": "string", "description": "Report title" },
      "sections": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "category": { "type": "string" },
            "items": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": { "content": { "type": "string" } },
                "required": ["content"]
              }
            }
          },
          "required": ["category", "items"]
        }
      }
    },
    "required": ["title", "sections"]
  }
}
```

## superone.onInit — Receive Data

The primary entry point. The agent calls the MCP tool with structured data, and the app receives it here.

```js
superone.onInit((data) => {
  // data matches the inputSchema defined in manifest
  document.getElementById('root').innerHTML = renderReport(data)
})
```

The callback fires once after the iframe is ready and data is injected. Late-subscriber safe — if registered after data arrives, it fires immediately.

## Layout

- Renders at chat panel width with auto-height (via ResizeObserver)
- Use `background: transparent` on `<body>` to blend with chat
- Keep content compact — this is inline in a conversation
- The iframe height adjusts automatically to content; avoid setting explicit height

## Related Topics

- `permissions` — network access for loading external resources
- `api-theme` — match host theme colors
- `packaging` — distribute as .s1app
- `icon` — visual assets
