# Mini-App Manifest

Every mini-app has a `manifest.json` at its runtime root.

## Fields

| Field | Required | Description |
|---|---:|---|
| `appId` | yes | Unique lowercase ID: `^[a-z0-9][a-z0-9_-]*$`. |
| `name` | yes | Display name. |
| `main` | yes | Relative `.js`, `.mjs`, or `.cjs` Node MiniApp Host entry. |
| `version` | for packaging | Semver. |
| `author` | for packaging | `{ name, email?, url? }`. |
| `description` | no | Catalog description. |
| `logo` | no | Relative PNG icon. |
| `preferWidth` | no | Initial panel width, 400–2000 px. |
| `toolSlug` | with tools | MCP namespace slug. |
| `tools` | no | Agent-facing tool declarations. |
| `templates` | no | Template name to relative HTML path for popovers and tool renderers. |
| `permissions` | no | WebView filesystem, network, storage, and media grants. |

Minimal manifest:

```json
{
  "appId": "weather",
  "name": "Weather",
  "main": "node.js"
}
```

## Runtime entries

There are two entry classes:

| Entry | Runtime | Responsibility |
|---|---|---|
| `main` | Node.js utility process | Computation, tools, subprocesses, long-running work, WebView messaging. |
| `index.html` and `templates.*` | Electron WebView | Rendering and user interaction through `window.superone.*`. |

Each HTML path is an independent WebView document. It does not share JavaScript memory with other templates or with the MiniApp Host. Share data using `context.webview` / `window.superone.node`, or persistent SuperOne storage APIs.

## React / Vite entries

Vite builds the UI; Bun builds the Node entry:

```json
{
  "scripts": {
    "build": "vite build && bun build src/node.ts --target=node --format=esm --outfile=dist/node.js"
  }
}
```

Add every template HTML as a Vite Rollup input so it is emitted into `dist`:

```ts
import { resolve } from 'path'

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        confirm: resolve(__dirname, 'confirm.html'),
        result: resolve(__dirname, 'result.html'),
      },
    },
  },
})
```

`public/manifest.json` must point to built paths such as `node.js`, `confirm.html`, and `result.html`.

## Layout

The main WebView is resizable and may fill the Activity workspace. Use responsive widths, Flexbox/Grid, and local overflow containers. Design for roughly 400 px minimum width and allow wide layouts to expand.

## Related topics

- `api-host` — `activate(context)` API
- `tools` — tool schema and renderers
- `permissions` — WebView capability grants
- `packaging` — required metadata and validation
