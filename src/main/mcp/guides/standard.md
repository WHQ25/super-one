# Standard App Guide (panel / sidebar / fullscreen)

Standard apps are persistent interactive apps opened by the user on the canvas. The agent communicates with them via MCP tool calls declared in `manifest.json`.

## Manifest

Start with the scaffold from `setup_mini_app_dev`, then edit `manifest.json` to add tools and other fields.

### Required Fields

| Field | Description |
|-------|-------------|
| `appId` | Unique ID. `^[a-z0-9][a-z0-9_-]*$` |
| `name` | Display name in app catalog |

### Optional Fields

| Field | Description |
|-------|-------------|
| `version` | Semver (required for packaging as `.s1app`) |
| `author` | `{ name, email?, url? }` |
| `icon` | Monochrome icon: SVG path or `lucide:<name>`. See `icon` topic. |
| `logo` | Full-color brand image (PNG). See `icon` topic. |
| `type` | `panel` (default), `sidebar`, or `fullscreen` |
| `description` | Short description shown in app catalog |

### Display Types

| Type | Where | Width | Notes |
|------|-------|-------|-------|
| `panel` | Activity Panel (right) | 320–800px, resizable | Default. Design for ~400px min width. |
| `sidebar` | Left sidebar | ~240–280px | Very narrow — use vertical layouts. |
| `fullscreen` | Full canvas area | Window width minus sidebar | Most space available. |

### Tools

Declare tools the agent can call. Requires `toolSlug` as namespace prefix.

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

The return value is JSON-serialized and sent back to the agent. Return meaningful data — the agent uses it to decide next steps.

## Layout Guidelines

- The iframe scrolls internally — wide content won't stretch the host panel
- Use `width: 100%`, `max-width`, or Flexbox/Grid for responsive layouts
- **Sidebar apps**: very narrow (~240px) — prefer stacked/vertical layouts
- **Panel apps**: design for ~400px min width, user can resize up to 800px
- Wide content (tables, charts): use `overflow-x: auto` on container

## Related Topics

- `permissions` — file system and network access
- `api-fs`, `api-git`, `api-theme`, `api-agent` — bridge APIs
- `api-system` — open folders, external links, clipboard
- `packaging` — distribute as .s1app
- `icon` — visual assets
