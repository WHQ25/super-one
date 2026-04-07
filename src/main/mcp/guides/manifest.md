# Manifest Format

Every mini-app requires a `manifest.json` in its root directory.

## Example

```json
{
  "appId": "my-app",
  "name": "Display Name",
  "version": "1.0.0",
  "author": { "name": "Your Name", "email": "you@example.com", "url": "https://github.com/you" },
  "icon": "icon.svg",
  "logo": "logo.png",
  "type": "panel",
  "permissions": {
    "fs": [
      { "scope": "project", "path": ".", "access": "readwrite", "reason": "Manage project configuration files" },
      { "scope": "project", "path": "src", "access": "read", "reason": "Analyze source code for diagnostics" },
      { "scope": "user", "path": ".config/my-app", "access": "readwrite", "reason": "Store user preferences" },
      { "scope": "app", "reason": "Persist app data between sessions" }
    ],
    "network": [
      { "domain": "api.example.com", "reason": "Fetch data from the example API" }
    ]
  },
  "tools": [
    {
      "name": "tool_name",
      "description": "What this tool does — be specific, the agent reads this",
      "inputSchema": {
        "type": "object",
        "properties": {
          "param1": { "type": "string", "description": "Description for the agent" }
        },
        "required": ["param1"]
      }
    }
  ]
}
```

## Fields

| Field | Required | Description |
|-------|----------|-------------|
| `appId` | Yes | Unique identifier. Lowercase letters, numbers, hyphens, underscores. Must match `^[a-z0-9][a-z0-9_-]*$`. |
| `name` | Yes | Display name shown in the app catalog |
| `version` | For packaging | Semver version string (e.g., `"1.0.0"`). Required when packaging as `.s1app`. |
| `author` | No | `{ name, email?, url? }` — Author info for app catalog. |
| `icon` | No | Monochrome icon: SVG file path or `lucide:<name>`. Read `icon` topic for spec. |
| `logo` | No | Full-color brand image (PNG recommended). Read `icon` topic for spec. |
| `type` | No | Display type (see table below). Default: `"panel"`. |
| `permissions.fs` | No | Array of directory entries. Each entry has `scope`, `path` (for project/user), `access` (`"read"` or `"readwrite"`), and `reason` (required). See scopes below. |
| `permissions.network` | No | Array of `{ domain, reason }` objects. Whitelisted domains for `fetch`. Affects CSP headers. |
| `tools` | No | MCP tools the app handles. Each needs `name`, `description`, and `inputSchema` (JSON Schema format). |

## Display Types

| Type | Where | Width | Behavior |
|------|-------|-------|----------|
| `panel` | Activity Panel | 320–800px, resizable | Default type. Design for ~400px min width. |
| `sidebar` | Left sidebar | ~240–280px | Very narrow — use vertical layouts. |
| `in-chat` | Chat messages | Chat width | Inline rendering. Agent passes data, app renders it. See below. |
| `fullscreen` | Canvas (full area) | Full window | Most space available. |

Each app has exactly one type and runs in one location at a time. The iframe scrolls internally — wide content won't stretch the host panel. See the `api` guide for layout tips.

## In-Chat App Manifest

In-chat apps use `inChatToolName` + `inputSchema` instead of `tools[]`. The MCP tool is registered as `inchat__<inChatToolName>`.

```json
{
  "appId": "daily-report",
  "name": "Daily Report",
  "type": "in-chat",
  "description": "Render a daily work report with timeline and categories. Use when the user asks to summarize work or create a report.",
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
            "items": { "type": "array", "items": { "type": "object", "properties": { "content": { "type": "string" } }, "required": ["content"] } }
          },
          "required": ["category", "items"]
        }
      }
    },
    "required": ["title", "sections"]
  }
}
```

### In-Chat Specific Fields

| Field | Required | Description |
|-------|----------|-------------|
| `inChatToolName` | Yes (in-chat) | MCP tool name. Lowercase + underscores. Registered as `inchat__<inChatToolName>`. |
| `inChatToolDescription` | No | Description for the AI agent explaining when to use this tool. Falls back to `description` if not set. |
| `inputSchema` | Yes (in-chat) | JSON Schema for the data the agent passes. This becomes the MCP tool's input schema. |
| `runningText` | No | Text shown while the agent is streaming the tool call input. Defaults to "Loading...". |
| `tools` | Must NOT be set | In-chat apps do not declare tools. Use canvas apps if you need bidirectional tool calls. |

## File System Scopes

| Scope | Resolves to | Use case |
|-------|------------|----------|
| `project` | `<projectDir>/<path>` | Project files. Requires `path` and `access`. |
| `user` | `~/<path>` | User-level config or data. Requires `path` and `access`. |
| `app` | App's install directory | Persistent app storage. No `path` or `access` needed (always readwrite). |

Each entry requires a `reason` field explaining why the permission is needed — this is shown to the user during installation.

The `access` field controls enforcement: `"read"` allows only read operations (`readFile`, `readDir`, `exists`, `glob`), while `"readwrite"` also permits `writeFile`.

An app can declare multiple entries to access several directories. If no `fs` is declared, the app has no filesystem access.

## Tool Design Tips

- Tool names are auto-prefixed with `<appId>__` (e.g., `my-app__add_item`). Don't include the prefix in manifest.
- Write clear descriptions — the agent decides when to use the tool based on this text.
- Use JSON Schema's `description` field on each property to help the agent provide correct arguments.
- Keep tools focused: one action per tool rather than a Swiss-army-knife tool with a `mode` parameter.
