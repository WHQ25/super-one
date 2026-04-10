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
| `logo` | App icon (PNG). See `icon` topic. |
| `type` | `panel` (default), `sidebar`, or `fullscreen` |
| `description` | Short description shown in app catalog |

### Display Types

| Type | Where | Width | Notes |
|------|-------|-------|-------|
| `panel` | Activity Panel (right) | 320–800px, resizable | Default. Design for ~400px min width. |
| `sidebar` | Left sidebar | ~240–280px | Very narrow — use vertical layouts. |
| `fullscreen` | Full canvas area | Window width minus sidebar | Most space available. |

## Layout Guidelines

- The iframe scrolls internally — wide content won't stretch the host panel
- Use `width: 100%`, `max-width`, or Flexbox/Grid for responsive layouts
- **Sidebar apps**: very narrow (~240px) — prefer stacked/vertical layouts
- **Panel apps**: design for ~400px min width, user can resize up to 800px
- Wide content (tables, charts): use `overflow-x: auto` on container

## Related Topics

- `tools` — tool declaration, handlers, display customization, grouping
- `permissions` — file system and network access
- `api-fs`, `api-git`, `api-theme`, `api-agent` — bridge APIs
- `api-system` — open folders, external links, clipboard
- `api-ui` — toast, tooltip, context menu overlays
- `packaging` — distribute as .s1app
- `icon` — visual assets
