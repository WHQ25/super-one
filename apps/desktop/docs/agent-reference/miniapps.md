# Mini-app integration

### Mini-App Platform

Mini-apps use a VS Code-style split architecture: a trusted Node.js MiniApp Host owns computation and agent tools, while full Electron WebViews own rendering.

**Key modules:**

| Module | Path | Purpose |
|--------|------|---------|
| MCP Server | `apps/desktop/src/main/mcp/superone-mcp-server.ts` | Built-in MCP tools (`read_manual`, `miniapp_dev_setup`, `miniapp_dev_register`, `miniapp_dev_pack`, `miniapp_dev_update_types`, `session_rename`, `config_read`, `config_apply`, media/browser/widget tools); mini-app tools use the fixed `miniapp_list` / `miniapp_call` dispatchers. Manuals via `read_manual` (domains: product/miniapp/media/widget; product/debug covers repo + log paths); guide markdown in `apps/desktop/src/main/mcp/guides/`. Live settings via `config_read` (not docs). Built-in tool entries live in `BUILT_IN_SUPERONE_TOOL_NAMES`; harness admission uses shared host-owned names; sensitive effects still require executor-side authorization |
| Service | `apps/desktop/src/main/miniapp/miniapp-service.ts` | App discovery, manifest parsing (Zod validated), filesystem operations |
| Schema | `apps/desktop/src/main/miniapp/miniapp-schema.ts` | Zod v4 manifest validation schema |
| Packager | `apps/desktop/src/main/miniapp/miniapp-packager.ts` | `.s1app` packaging (zip + integrity), install/uninstall, SHA-256 verification |
| MiniApp Host | `apps/desktop/src/main/miniapp/miniapp-host.ts` | One Electron utility process per project/app; lifecycle, tool RPC, WebView messages, status |
| Host Entry | `apps/desktop/src/main/miniapp/miniapp-host-entry.ts` | Loads `manifest.main`, constructs `activate(context)`, owns tool handlers and disposables |
| API Runtime | `packages/shared/src/miniapp-api-runtime.js` | Author-facing `window.superone.*` logic used by WebView preload |
| Preload | `apps/desktop/src/preload/miniapp-preload.ts` | Context-isolated WebView transport and mode-specific APIs |
| WebView | `apps/desktop/src/renderer/src/components/miniapp/MiniAppWebview.tsx` | Shared container for panel, tool renderer, standalone result, and popover HTML |
| Overlay | `apps/desktop/src/renderer/src/components/miniapp/MiniAppOverlayPortal.tsx` | Host-rendered toast/tooltip/context menu and WebView popovers |

**Installation flow:** `.s1app` file (zip) → extract to temp → validate manifest (Zod) → verify integrity (SHA-256) → copy to `~/.superone/apps/<appId>/` → write `install.json` metadata. Users can drag-and-drop `.s1app` files onto the Apps panel in the sidebar.

**Manifest** requires `appId`, `name`, and `main`; `version` and `author` are required for packaging. Schema is strict and rejects removed iframe/worker fields. All HTML surfaces use the same WebView/preload transport in development and production. Every app uses `persist:miniapp-<appId>` and may navigate only within its own `superone-app://` host.

**⚠️ `<webview>` has window-level prerequisites.** Mini-app HTML no longer renders in an iframe, so any `BrowserWindow` that can show mini-app content — including the detached session window, which renders the same chat and therefore the same standalone tool blocks — needs BOTH `webPreferences.webviewTag: true` and `attachMiniAppWebviewGuards(win)` (`miniapp-webview-guard.ts`). Without the tag the element silently renders nothing; without the guards the attach is unvalidated and `superone-app://` is never registered for the partition. When you add a window that renders chat, wire both.

Agent tools are declared in `manifest.tools` and implemented with `context.tools.handle()` from `manifest.main`. MCP calls route directly to the MiniApp Host and never wait for a mounted WebView. The WebView and MiniApp Host communicate through `context.webview` / `window.superone.node` structured messages.

**Capability split (VS Code-shaped):** host capabilities live Node-side on `context` — `agent.*` (prompt / context card), `host.toast / revealInFolder / openExternal / clipboard`, `locale`, `version` — so a background app can reach the user with no UI open. They execute in the renderer (`lib/miniapp-host-actions.ts`, mounted globally by `useMiniAppHostActions`), routed via `miniapp-host-action-bridge.ts`; main only addresses the request, so clipboard and external-link consent prompts are never bypassed. The WebView keeps only what needs DOM coordinates — `ui.showTooltip / showContextMenu / showPopover / startDrag` — plus theme, locale, and `superone.node`.

**Adding a new mini-app bridge API:**

1. `packages/shared/src/miniapp-api-runtime.js` — Add the method to `createSuperoneApi()`. Use `transport.send()` for fire-and-forget, `transport.request()` for request-response.
2. `packages/shared/src/miniapp-author-api.d.ts` — **single source of truth for author-facing types.** Add the signature to the `SuperOne` interface (use the `SuperOne*` named helper types). Both `miniapp-api-runtime.d.ts` (re-exports it as `SuperoneApi` for the runtime/preload) and the generated `src/superone.d.ts` derive from this one file — never hand-edit a second copy.
3. ~~Update `generateSuperoneDts()`~~ — **no longer manual.** `miniapp-templates.ts` reads `miniapp-author-api.d.ts` via `?raw`, strips `export`, and wraps it in `declare global { Window { superone } }`. Editing step 2 is enough; the React-template `superone.d.ts` updates automatically. The `miniapp-templates.test.ts` `covers ui API` assertions guard against silent drift.
4. `packages/shared/src/miniapp-types.ts` — If a new message type is added, append it to `MiniAppBridgeMessageType`.
5. If the API needs host-side handling: add a case in `apps/desktop/src/renderer/src/hooks/miniapp-message-handler.ts`.
6. If the API needs main process handling: add a handler in `apps/desktop/src/main/miniapp/miniapp-service.ts` or `apps/desktop/src/main/index.ts`.
7. Add response/push forwarding to `miniapp-preload.ts`, then forward the host event from `MiniAppWebview` consumers where applicable.
8. Update the relevant guide in `apps/desktop/src/main/mcp/guides/api/`.
9. Update `apps/desktop/examples/miniapp/hello/index.html` to demo the new API.

For MiniApp Host API changes, update `packages/shared/src/miniapp-host-api.d.ts`, `miniapp-host-entry.ts`, host RPC tests, templates, and `api-host.md` together.
