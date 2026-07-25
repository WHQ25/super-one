# Mini-App Manifest

Every mini-app is described by a `manifest.json` file at its root. This is where you declare its identity, tool surface, permissions, and UI behavior. Mini-apps open as tabs in the activity Dockview, which users can maximize without losing tabs or split groups.

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
| `preferWidth` | Preferred activity panel width in pixels (360–2000). Applied when the app is opened, if there's enough room; otherwise clamped to fit. The user can resize freely afterwards — preferWidth only sets the initial size. |
| `description` | Short description shown in app catalog |
| `toolSlug` | Namespace prefix for tools. Required when `tools[]` is non-empty. Lowercase alphanumeric + underscores. See `tools` topic. |
| `tools` | Array of agent-facing tool definitions. See `tools` topic. |
| `templates` | Map of template name → relative HTML path. Required for tools using `renderer.intercept`, `renderer.result`, or `standalone: true`; also referenced by `ui.showPopover`. Names: lowercase alphanumeric with hyphens/underscores. |
| `background` | `{ entry }` — relative path to a headless background-worker HTML file (`^[a-z0-9][a-z0-9_./-]*\.html$`). Requires `permissions.background`. See `api-worker` topic. |
| `permissions` | File system, network, media, storage, background permissions. See `permissions` topic. |

### Where the App Opens

- **Activity panel tab** (always available, default size 320–800px wide, resizable). Design for ~400px min width.
- **Maximized Activity workspace** (always available): occupies the full main area while preserving Dockview tabs and split groups. Chat moves into a floating panel, and the sidebar remains under user control.

For inline rendering of agent tool output inside the chat itself, declare a custom result renderer on the relevant tool — see the `tools` topic.

## Layout Guidelines

- The iframe scrolls internally — wide content won't stretch the host panel
- Use `width: 100%`, `max-width`, or Flexbox/Grid for responsive layouts
- Design for ~400px min width when running in the panel; the user can resize up to 800px
- Wide content (tables, charts): use `overflow-x: auto` on container
- At wider Activity workspace sizes, let the layout spread freely; still scroll internally rather than relying on browser scroll

## React / Vite — Multi-Page Entries

**Rule: every manifest path that points to an `.html` file is a separate document (its own iframe / process), not part of your React SPA.** The `react` template scaffolds a *single* entry (`index.html` → `src/main.tsx`). The moment you add a worker, a tool renderer, a standalone tool, or a popover, you must add a matching Vite entry — otherwise the build emits no such HTML and the app silently loads the wrong document (commonly: the whole React SPA boots inside a tool block or worker).

This **only applies to the `react`/Vite template**. The `vanilla` template needs no build step — just author each `.html` directly.

### Which manifest paths are separate documents

| Manifest field | Used by | Bridge injects | Needs React? |
|---|---|---|---|
| `background.entry` | background worker | `superone` + `superone.self` | No — pure logic, do **not** import React |
| `templates.*` referenced by `renderer.intercept` | chat-inline confirm/intercept UI | `superone` + `superone.tool` (phase `intercept`) | Yes — has UI |
| `templates.*` referenced by `renderer.result` | chat-inline result card | `superone` + `superone.tool` (phase `result`) | Yes — has UI |
| `templates.*` on a `standalone: true` tool | handler + UI in one chat-block iframe | `superone` + `superone.tool` + `superone.tools.handle` | Yes — has UI |
| `templates.*` used by `ui.showPopover` | panel popover | `superone` + `superone.popover` | Yes — has UI |

### Vite config

Add one input per HTML entry. Keep `base: './'` (the app is served from `superone-app://<host>/`, so asset URLs must be relative):

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),          // panel SPA
        background: resolve(__dirname, 'background.html'),  // worker — no React
        confirm: resolve(__dirname, 'confirm.html'),        // renderer.intercept
        receipt: resolve(__dirname, 'receipt.html'),        // renderer.result
        detail: resolve(__dirname, 'detail.html'),          // ui.showPopover
      },
    },
  },
})
```

Each input HTML at the project root builds to `dist/<name>.html`. `manifest.json` (in `public/`, copied to `dist/`) references the **built** path relative to `dist/`:

```json
{
  "background": { "entry": "background.html" },
  "templates": { "confirm": "confirm.html", "receipt": "receipt.html", "detail": "detail.html" }
}
```

A minimal non-panel entry HTML just loads its own script — no `<div id="root">` for the worker:

```html
<!-- background.html --> <body><script type="module" src="/src/worker.ts"></script></body>
<!-- detail.html (popover, has UI) --> <body><div id="root"></div><script type="module" src="/src/popover.tsx"></script></body>
```

### State & code sharing across entries

- Each document is **fresh** — no shared in-memory state with the panel or with each other (a `standalone` tool gets a brand-new iframe every call). Cross-boundary state goes through `superone.kv`, `superone.fs`, or the typed message channels (`superone.popover.postMessage`, `superone.tool.submit`, `superone.worker`/`superone.self` messaging).
- Share **code** (types, pure functions, fetch logic) via a `src/shared.ts` imported by each entry. Rollup splits it into a common chunk; the worker bundle stays React-free as long as `worker.ts` doesn't import React.
- UI entries (renderer/popover) each mount their own small React tree (`createRoot` on their own `#root`) — they are independent roots, not one SPA.

For the per-API contracts see `api-worker` (worker), `tools` (renderers, standalone), and `api-ui` (popover).

## Related Topics

- `tools` — tool declaration, handlers, display customization, grouping
- `permissions` — file system and network access
- `api-fs`, `api-git`, `api-theme`, `api-locale`, `api-agent` — bridge APIs
- `api-system` — open folders, external links, clipboard
- `api-ui` — toast, tooltip, context menu overlays
- `api-worker` — background worker that keeps running after the panel closes
- `packaging` — distribute as .s1app
- `icon` — visual assets
