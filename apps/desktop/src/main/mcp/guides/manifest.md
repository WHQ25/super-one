# Mini-App Manifest

Every mini-app is described by a `manifest.json` file at its root. This is where you declare its identity, tool surface, permissions, and UI behavior. Mini-apps open by default as a tab in the activity panel; set `fullscreen: true` to also expose a full-screen canvas entry.

Start with the scaffold from `miniapp_dev_setup` (or register an existing source directory with `miniapp_dev_register`), then edit `manifest.json` to add tools and other fields.

## Fields

### Required

| Field | Description |
|-------|-------------|
| `appId` | Unique ID. `^[a-z0-9][a-z0-9_-]*$` |
| `name` | Display name in app catalog |

### Optional

| Field | Description |
|-------|-------------|
| `version` | Semver (required for packaging as `.s1app`) |
| `author` | `{ name, email?, url? }` |
| `logo` | App icon (PNG). See `icon` topic. |
| `fullscreen` | `true` to also offer a canvas full-screen entry. Default `false` (panel only). |
| `preferWidth` | Preferred activity panel width in pixels (360–2000). Applied when the app is opened, if there's enough room; otherwise clamped to fit. The user can resize freely afterwards — preferWidth only sets the initial size. |
| `description` | Short description shown in app catalog |
| `toolSlug` | Namespace prefix for tools. Required when `tools[]` is non-empty. Lowercase alphanumeric + underscores. See `tools` topic. |
| `tools` | Array of agent-facing tool definitions. See `tools` topic. |
| `templates` | Map of template name → relative HTML path. Required for tools using `renderer.intercept`, `renderer.result`, or `standalone: true`; also referenced by `ui.showPopover`. Names: lowercase alphanumeric with hyphens/underscores. |
| `permissions` | File system, network, media, storage permissions. See `permissions` topic. |

### Where the App Opens

- **Activity panel tab** (always available, default size 320–800px wide, resizable). Design for ~400px min width.
- **Canvas full-screen** (only when `fullscreen: true`): occupies the full window minus the sidebar. Useful for dashboards, editors, and large visualizations.

For inline rendering of agent tool output inside the chat itself, declare a custom result renderer on the relevant tool — see the `tools` topic.

## Layout Guidelines

- The iframe scrolls internally — wide content won't stretch the host panel
- Use `width: 100%`, `max-width`, or Flexbox/Grid for responsive layouts
- Design for ~400px min width when running in the panel; the user can resize up to 800px
- Wide content (tables, charts): use `overflow-x: auto` on container
- For fullscreen apps, the layout can spread freely; still scroll internally rather than relying on browser scroll

## Related Topics

- `tools` — tool declaration, handlers, display customization, grouping
- `permissions` — file system and network access
- `api-fs`, `api-git`, `api-theme`, `api-locale`, `api-agent` — bridge APIs
- `api-system` — open folders, external links, clipboard
- `api-ui` — toast, tooltip, context menu overlays
- `packaging` — distribute as .s1app
- `icon` — visual assets
