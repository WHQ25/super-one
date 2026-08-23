# Mini-App Development Guide

A mini-app is a trusted Node.js module plus one or more full Electron WebViews. The MiniApp Host owns computation, agent-facing tools, and every host capability that needs no DOM coordinates; WebViews own rendering and the anchored surfaces (tooltip, context menu, popover, drag).

## Architecture

```text
AI agent → miniapp_call → Node.js MiniApp Host → tool result
                              ↕ structured messages
                         Electron WebView → window.superone.*
```

- `manifest.main` is required and exports `activate(context)`.
- One utility-process MiniApp Host runs per `(projectDir, appId)` and does not depend on an open UI.
- All mini-app HTML surfaces use `<webview>`: panel, popover, intercept, result, and standalone result.
- Every app has its own persistent WebView partition and `superone-app://<appId>.<projectId>` origin.
- `window.superone.*` is injected by a context-isolated preload; Node integration stays disabled in WebViews.
- The trusted MiniApp Host has full Node.js access. Installation always asks for explicit trust.
- Apps are packaged as `.s1app` archives with integrity checksums.

Read `api-host` for the Node context and WebView messaging, `manifest` for entries, and `tools` for agent tools and inline UI.

## Development workflow

Before coding, confirm the app requirements, source `directory`, `scope` (`project` or `user`), and whether agent-facing tools are actually needed. Then:

1. Call `miniapp_dev_setup` to scaffold a `vanilla` or `react` app, or `miniapp_dev_register` for an existing directory.
2. Implement `manifest.main` and the WebView entry.
3. Declare tools in `manifest.tools` and register matching handlers from `activate(context)`.
4. Add WebView permissions only for browser-side APIs that need them.
5. Build and test the app, then use `miniapp_dev_pack` for distribution.

## Choosing a template

Use `vanilla` for small or moderate interfaces and zero-build apps. Use `react` for component-heavy interfaces or npm-only UI dependencies. Both templates include:

```text
manifest.json / public/manifest.json
index.html                  # main WebView
node.js / src/node.ts  # Node MiniApp Host entry
```

The React build emits both `dist/index.html` and `dist/node.js`.

## Where the app lives

- `scope: "project"`: visible only for one project. The source directory must be inside `projectDir`.
- `scope: "user"`: visible across projects on this machine.

Development apps are resolved through `~/.superone/dev-registry.json`. A project or user app slot contains only a path-free `.s1-dev.json` enablement pointer, so local source paths are not committed.

## Do you need tools?

Add a tool only when the agent must trigger computation or push conversation-specific data. User-driven refresh, browsing, and filtering should call the MiniApp Host through `window.superone.node` rather than becoming agent tools.

Tool computation belongs in the MiniApp Host:

```js
export function activate(context) {
  context.subscriptions.push(
    context.tools.handle('set_data', async ({ rows }) => {
      const result = analyze(rows)
      context.webview.postMessage({ type: 'analysis', result })
      return result
    }),
  )
}
```

The WebView receives updates independently:

```js
window.superone.node.onMessage((message) => render(message))
```

Closing the WebView does not interrupt a tool call in flight. Once the last panel closes the host is released unless the manifest declares `background: true`; the next tool call starts it again.

## Related topics

- `manifest` — entries, tools, templates, layout
- `api-host` — Node lifecycle and WebView messaging
- `tools` — tool declarations and inline renderers
- `permissions` — WebView permissions
- `packaging` — validation and `.s1app` distribution
