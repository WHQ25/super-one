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
  "workingDir": { "scope": "project", "path": "." },
  "permissions": {
    "fs": "project",
    "network": ["api.example.com"]
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
| `workingDir` | No | `{ scope, path }`. `scope: "project"` resolves relative to project root. `scope: "user"` resolves relative to home directory. Default: `{ scope: "project", path: "." }` |
| `permissions.fs` | No | `"app"` (own directory only) or `"project"` (working directory access) |
| `permissions.network` | No | Whitelisted domains for `fetch`. Affects CSP headers. |
| `tools` | No | MCP tools the app handles. Each needs `name`, `description`, and `inputSchema` (JSON Schema format). |

## Display Types

| Type | Where | Behavior |
|------|-------|----------|
| `panel` | Activity Panel / Canvas | Resizable, supports tabs. Default type. |
| `sidebar` | Left sidebar | Narrow view, replaces sidebar content area. |
| `in-chat` | Chat messages | Inline in conversation (future). |
| `fullscreen` | Canvas (full area) | Auto-switches to canvas mode, takes the entire canvas area. |

Each app has exactly one type and runs in one location at a time.

## Tool Design Tips

- Tool names are auto-prefixed with `<appId>__` (e.g., `my-app__add_item`). Don't include the prefix in manifest.
- Write clear descriptions — the agent decides when to use the tool based on this text.
- Use JSON Schema's `description` field on each property to help the agent provide correct arguments.
- Keep tools focused: one action per tool rather than a Swiss-army-knife tool with a `mode` parameter.
