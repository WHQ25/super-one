# DeepSeek harness (`dsh`) UI plugins and full-client extensibility pilot

Status: accepted · Updated: 2026-11-24
Plan: [dsh-ui-plugins.md](../plans/dsh-ui-plugins.md)

## Problem

SuperOne embeds `dsh` in the desktop main process (`packages/deepseek`), including a Cordis plugin host (`packages/deepseek/src/plugin-host/`) that installs, enables, and live-syncs Node-side plugins. However, SuperOne's desktop UI (`apps/desktop/src/renderer`) is statically composed in `App.tsx`, `panels.tsx`, `ChatContent.tsx`, and `ToolBlockPresenter.tsx`. Installed `dsh` plugins cannot contribute UI surfaces, wrap existing components, or exchange RPC/events with the renderer.

Meanwhile, expanding pluginization across all six harnesses, `apps/cli` remote nodes, and `apps/mobile` simultaneously would require decomposing `apps/desktop/src/main/index.ts` and `apps/desktop/src/preload/index.ts` upfront, creating high regression risk before the UI slot ABI and dynamic loading model are proven.

## Goals

1. **Full-extensibility UI substrate**: Introduce a zero-dependency typed slot registry (`packages/ui-slots`) supporting `single`, `list`, `keyed`, `chain`, and `hoc` composition, plus scoped activation (`<SlotScopeProvider>`) and automatic disposer cleanup.
2. **Harness-isolated pilot on `dsh`**: Activate dynamic UI plugins **only** for `dsh` via capability gating (`supportsUiPlugins`), keeping Claude, Codex, Cursor, OpenCode, and ACP untouched until the ABI stabilizes.
3. **Mosaic multi-pane isolation**: Guarantee side-by-side `dsh` and non-`dsh` `SessionPane` tiles never leak UI overrides across panes, and saved Dockview layouts survive plugin disable/uninstall.
4. **Preserve SuperOne invariants**: Protect the cold-start budget (do not eagerly boot `DeepseekRuntime` or eagerly bundle `lucide-react` / `@superone/ui` into the entry chunk), preserve `React.lazy` chunk boundaries, pass `harness-branch-ratchet.test.ts`, keep core SQLite migrations untouched, and enforce explicit user trust for privileged (L2) code.

## Non-goals (for this pilot)

- Moving `apps/desktop` onto `@deepseek-ai/cordis` or `dsh-host-webserver` combo bundles.
- Extending L2 dynamic renderer plugins to `apps/mobile` or remote `apps/cli` nodes during the pilot.
- Opening app-scoped `sidebar.left` slots before PR #4 (avoids pressure to eagerly boot `DeepseekRuntime` on startup).
- Decomposing all of `apps/desktop/src/main/index.ts` or replacing `MiniAppHostLayer` / `Mosaic` / mini-window fold state machines.

## Decisions

### 1. Keep Cordis inside `@superone/deepseek`; build lightweight zero-dependency `packages/ui-slots`

SuperOne will not promote `@deepseek-ai/cordis` to a global main/renderer kernel:
- Cordis missing-`inject` hangs silently (`packages/deepseek/src/tree.ts`), dynamic string-named imports obscure bundler static analysis, and dual-package identity requires global `module.registerHooks` (`packages/deepseek/src/plugin-host/resolver.ts`).
- Even upstream `deepseek-harness` implements its slot registry (`packages/client/ui-slots`) as a zero-dependency TypeScript core.

`packages/ui-slots` provides:
- Five slot kinds: `single`, `list`, `keyed`, `chain`, `hoc`.
- Module augmentation (`declare module '@superone/ui-slots'`) for typed `SlotMap` registration and props inference.
- `SlotScopeProvider` (`active: boolean`, `scope` metadata) so per-session panes cleanly fall back to built-in default renderers when `active === false`.
- Safe fallback rendering when no provider/contributions exist (preserving standalone Storybook stories).

### 2. Capability-gated `dsh` isolation and 3-tier slot scoping

Per `CLAUDE.md` and `apps/desktop/src/renderer/src/harness-ui/harness-branch-ratchet.test.ts`, renderer code outside exempted per-harness directories must not compare against literal `HarnessId` strings (`=== 'dsh'`).

- Add `supportsUiPlugins: boolean` to `HarnessCapabilities` in `packages/shared/src/harness/harness-capabilities.ts` (initially `true` only for `dsh`, matching the `modUi` pattern).
- Place all `dsh`-specific UI plugin loading, manifest bridging, and RPC subscriptions inside `apps/desktop/src/renderer/src/harness-ui/dsh/`.
- Enforce three distinct slot scopes matching SuperOne's actual layout tree:
  1. **Pane / Session scope** (`session.providers` `hoc`, `chat.toolBlock`, `chat.composer`, `chat.message`): mounted inside `<SlotScopeProvider active={supportsUiPlugins}>` in `ChatContent.tsx`. Inactive panes render stock built-in components with zero cross-pane leakage.
  2. **Header action scope (`session.header.actions`)**: `App.tsx`'s top bar sits *outside* `ChatContent.tsx` and hides in Mosaic mode, while Mosaic tiles render a unified tile header in `SessionMosaic.tsx`. During the pilot, `session.header.actions` mounts with its own `<SlotScopeProvider active={activeSessionSupportsUiPlugins}>` at the single-view header site in `App.tsx` only; `SessionMosaic.tsx` tile headers stay uniform and untouched (Mosaic tiles still render `dsh` overrides inside `<SessionPane>` / `<ChatContent>`, such as chat content, `ToolBlock`, and `composer`).
  3. **Panel instance scope (`activity.panel`)**: `ActivityPanel.tsx` passes a static `activityPanelComponents` map to `<DockviewReact>` and persists/restores layouts via `api.fromJSON()` in `activity-view-state.ts`. Registering dynamic keys directly into `activityPanelComponents` would break `fromJSON()` after a plugin is disabled/uninstalled. Instead:
     - Register one permanent built-in wrapper `'plugin-panel'` (`PluginDockPanel`) in `apps/desktop/src/renderer/src/components/activity/panels.tsx`, which resolves `useSlotKeyed('activity.panel', params.panelKey)` inside an ErrorBoundary and safe fallback.
     - Add `closeGhostPluginPanels()` in `activity-view-state.ts` (alongside `closeGhostMiniAppPanels` / `closeGhostSideChatPanel`) to clean up closed/uninstalled plugin tabs on snapshot restore and disable/uninstall.
  4. **App scope (`root.providers`, `sidebar.left`, `settings`)**: During the pilot, `root.providers` `hoc` wrappers are forbidden (they would wrap non-`dsh` `SessionPane` instances), and `sidebar.left` stays closed until PR #4 so app startup never needs `DeepseekRuntime` alive.

### 3. Preserve `peekDeepseekRuntime()` lazy boot via `superone.client` disk metadata

`apps/desktop/src/main/deepseek/deepseek-runtime-host.ts` forbids booting `DeepseekRuntime` on app startup or when opening settings (`peekDeepseekRuntime()` stays `null` until a `dsh` session runs).

- Read **only** `"superone": { "client": { "entry", "styles"?, "apiVersion": 1 } }` from `<userData>/dsh-plugins/node_modules/<pkg>/package.json` alongside `<userData>/dsh-plugins/registry.json` in `packages/deepseek/src/plugin-host/registry.ts` purely from disk, without booting Cordis.
- **Do not** read upstream `dsh.client` bundles: upstream `0.2.3-alpha.2` `dsh.client` outputs target `window.__ModuleLoader__` and `@deepseek-ai/dsh-client-store`, which are binary-incompatible with SuperOne's `__SUPERONE_SHARED__` and `packages/ui-slots`. Requiring `apiVersion: 1` fails fast on ABI mismatch.
- Reconcile and notify renderer windows when plugins are installed, enabled, disabled, or uninstalled via `apps/desktop/src/main/deepseek/deepseek-plugins.ts`.

### 4. Minimal Main ↔ Renderer bridge (`superone-plugin://`, Preload tunnel, `pluginRpc`)

Instead of adding per-plugin IPC channels to the 2,757-line `apps/desktop/src/preload/index.ts` or embedding `dsh-host-webserver`:

1. **Asset protocol (`superone-plugin://pkg/<encodedId>/<relPath>`)**:
   - Use a fixed hostname (`pkg`) and URL-encoded `pluginId` (`encodeURIComponent(pluginId)`) instead of `superone-plugin://<id>/...`, because scoped npm packages like `@acme/dsh-plugin` break standard-scheme hostname parsing.
   - Register scheme privileges (`standard`, `secure`, `supportFetchAPI`, `corsEnabled`, `codeCache`) before `app.whenReady()`, modeled on `apps/desktop/src/main/renderer-protocol.ts`.
   - Enforce renderer-only `Origin` / `Referer` checks (matching `miniapp-protocol.ts`: allow only `superone-renderer://app` in production or `ELECTRON_RENDERER_URL` in dev) so sandboxed Mini-App or MCP App frames cannot read L2 plugin assets.
   - Serve files via explicit `fs/promises.readFile` (not raw `net.fetch`) with strict extension allowlist, exact MIME types (`text/javascript; charset=utf-8`, `text/css; charset=utf-8`), matching `Access-Control-Allow-Origin` for cross-origin `<script>`/`import()`, `Cache-Control: no-store` (paired with `?v=<version>-<mtimeMs>` cache busting), and symlink-safe containment (`pkgRoot = realpathSync(pkgDir)`, verify `realpathSync(target).startsWith(pkgRoot + sep)` so local directory installs work).
   - Note: `apps/desktop/src/renderer/index.html` currently has no restrictive CSP; if a renderer CSP is added later, `script-src` and `style-src` must allow `superone-plugin:`.
2. **Generic Preload tunnel (`window.superonePlugin`)**:
   - Expose a single namespaced interface (`listClientPlugins`, `invoke`, `on`, `onPluginsChanged`) in `preload/index.ts` and `preload/index.d.ts`.
   - Use one multiplexed `ipcRenderer.on` listener per channel backed by `Map<key, Set<cb>>` (matching `deviceFrameListeners` in `preload/index.ts`) to prevent `MaxListenersExceededWarning` across hot reloads.
   - Main-process broadcasts target live business windows (excluding destroying windows and auxiliary `DragPreview` / `ComputerUsePermissionFloat` windows). `invoke` returns a structured `{ ok: true, data } | { ok: false, error: { code, message } }` envelope with a bounded timeout.
3. **Cordis `pluginRpc` `Service` bound to `this.caller`**:
   - Register a thin `pluginRpc` `Service` in `packages/deepseek/src/tree.ts` allowing Node-side `dsh` plugins to register `handle(method, handler)` and `emit(event, payload)`.
   - Bind cleanup to **`this.caller`** (the calling plugin's Cordis context), **not** the service's own `this.ctx`, so disabling or uninstalling a single plugin immediately revokes its handlers and subscriptions without restarting `DeepseekRuntime`.
4. **Fail-closed & lease discipline**:
   - `invoke` checks `peekDeepseekRuntime()` in main; if `null`, return `{ ok: false, error: { code: 'runtime_not_running', message } }` without cold-booting `dsh`.
   - Pilot `pluginRpc` does not expose raw `SessionManager` mutations; any future session-mutating methods must route through `DesktopDomain` + `ControlLeaseService` verified by `event.sender.id`.

### 5. L2 dynamic bundle ABI, SDK & L1 coexistence

- **Lazy shared singleton runtime**: Populate frozen `globalThis.__SUPERONE_SHARED__` **lazily** (via dynamic `import()`, only when `listClientPlugins()` returns at least one enabled client plugin) so cold start pays zero cost when no UI plugins are enabled.
  - Include: `react`, `react-dom`, `react/jsx-runtime`, `zustand`, `@superone/plugin-sdk`, and a small curated subset of `@superone/ui` primitives.
  - **Omit `lucide-react`**: exposing the full icon barrel would bundle 1,500+ icons into the entry/shared chunk; plugins bundle the specific icons they import (~1 KB each).
  - **Never** expose internal Zustand stores (`useChatStore`, etc.); expose versioned read-only selector hooks and actions via `@superone/plugin-sdk` (`packages/plugin-sdk`, internal workspace package in PR #3 with a lightweight `bun build` external-globals preset).
- **Styles**: SuperOne compiles Tailwind CSS v4 at build time; L2 plugins ship pre-built CSS referencing SuperOne's OKLch semantic CSS variables (`--background`, `--card`, `--border`, etc.), injected via `<link>` on mount and removed on disposer cleanup.
- **Storage & native addons**: L2 plugins store state under `<userData>/plugins/<id>/` (never touching core SQLite migrations). macOS `hardenedRuntime` blocks unsigned native `.node` binaries.
- **Trust & L1 future**: L2 plugins reuse the existing `InstallOptions.trust: 'granted'` gate in `deepseek-plugins.ts` and render inside a React `ErrorBoundary`. Later phases bridge L1 sandboxed Mini-Apps / MCP Apps / Widgets into the same `packages/ui-slots` surface without changing the slot contract.

## Relationship to existing UI extension surfaces

- **`ModUi` (`packages/shared/src/mod-ui.ts`)**: Remains Claude's remote mod surface; `ChatContent.tsx` continues mounting `<DesktopModUi>` alongside `<SlotScopeProvider>`.
- **`@superone/chat-view`**: Shared desktop/mobile transcript presenters remain the default fallback inside `chat.toolBlock` when no `chain`/`hoc` plugin intercepts a tool call.
- **L1 Mini-Apps / MCP Apps / Widgets**: Untouched in the pilot; bridged into `packages/ui-slots` in Phase 4 once the slot contract stabilizes.

## Phases

1. **Phase 1 (PR #1 — Renderer slot substrate)**: Build `packages/ui-slots` with `<SlotScopeProvider>`, wire `@superone/ui-slots` into `apps/desktop/package.json`, add `HARNESS_CAPABILITIES.supportsUiPlugins`, and wire pilot slots (`PluginDockPanel` + `closeGhostPluginPanels`, single-view `session.header.actions` in `App.tsx` with Mosaic tile headers kept unified, and `chat.toolBlock`). Zero behavior change.
2. **Phase 2 (PR #2 — Main/Preload bridge)**: Add disk `superone.client` manifest reading in `packages/deepseek/src/plugin-host/registry.ts`, `pluginRpc` `Service` (`this.caller` lifecycle) in `packages/deepseek/src/tree.ts`, `superone-plugin://pkg/...` protocol, and multiplexed `window.superonePlugin` preload tunnel.
3. **Phase 3 (PR #3 — `@superone/plugin-sdk`, `dsh` L2 loader & end-to-end sample)**: Add workspace `packages/plugin-sdk` + `bun build` external-globals helper, implement `apps/desktop/src/renderer/src/harness-ui/dsh/` loader (lazy `__SUPERONE_SHARED__`, CSS lifecycle, hot reload/dispose, ErrorBoundary), and verify an end-to-end `dsh` plugin with side-by-side Mosaic `dsh` + `claude` panes.
4. **Phase 4 (Platform rollout, post-pilot)**: Extract `main/index.ts` domain IPCs into `ServiceContainer` + `@superone/runtime` Electron-free `PluginHost`, bridge L1 Mini-Apps/MCP Apps/Widgets into `ui-slots`, open app-scoped `sidebar.left`, and flip `supportsUiPlugins: true` for additional harnesses.
