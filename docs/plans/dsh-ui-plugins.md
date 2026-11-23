# DeepSeek harness (`dsh`) UI plugins pilot

Status: completed · Updated: 2026-11-24
Goal: Land a capability-gated (`supportsUiPlugins`), Mosaic-safe UI plugin system piloted exclusively on `dsh` across three low-risk PRs before platform-wide rollout.
Proposal: [dsh-ui-plugins.md](../proposals/dsh-ui-plugins.md)
Long-term docs affected: `docs/harness/dsh/deepseek-harness-integration.md`, `apps/desktop/docs/agent-reference/architecture.md`, `apps/desktop/docs/agent-reference/performance.md`

## Overview

The work is split into three incremental PRs so every invariant (AST branch ratchet, Mosaic isolation, Dockview persistence safety, lazy `DeepseekRuntime` boot, `React.lazy` chunk boundaries, Storybook independence) is verified at each step:

- **PR #1**: Zero-dependency `packages/ui-slots` + `HARNESS_CAPABILITIES.supportsUiPlugins` + initial slot sites (no dynamic loading, zero behavior change).
- **PR #2**: Disk `superone.client` manifest discovery + `superone-plugin://pkg/...` asset protocol + `window.superonePlugin` preload tunnel + Cordis `pluginRpc` `Service`.
- **PR #3**: Workspace `packages/plugin-sdk` + `apps/desktop/src/renderer/src/harness-ui/dsh/` L2 dynamic loader (lazy `__SUPERONE_SHARED__`, CSS lifecycle, hot enable/disable) + end-to-end sample plugin + Mosaic side-by-side verification.

## PR #1 — Renderer `packages/ui-slots` & Pilot Slot Sites

### Steps
1. Create `packages/ui-slots` (`package.json`, `tsconfig.json`, `src/index.ts`, `src/react.tsx`, `src/index.test.ts`):
   - Implement `SlotRegistry` supporting `single`, `list`, `keyed`, `chain` (priority-ordered selector), and `hoc` (layered wrappers with optional key filter) + disposer cleanup and `useSyncExternalStore` subscription.
   - Implement `SlotScopeProvider` (`active: boolean`, `scope?: { projectPath?: string; sessionId?: string }`) so inactive scopes pass through default fallback renderers without consulting registered plugin entries.
   - Ensure hooks (`useSlot`, `useSlotList`, `useSlotKeyed`, `useSlotChain`, `useSlotHoc`) degrade safely to defaults when rendered outside a provider (for Storybook and isolated unit tests).
   - Add `"@superone/ui-slots": "workspace:*"` to `apps/desktop/package.json` (and verify `electron.vite.config.ts`, `tsconfig.web.json`, and Storybook resolution).
2. Add `supportsUiPlugins: boolean` to `HarnessCapabilities` in `packages/shared/src/harness/harness-capabilities.ts`:
   - Set `supportsUiPlugins: true` on `dsh` and `false` on all other harnesses (`claude`, `codex`, `cursor`, `opencode`, `acp-*`).
3. Wire pilot slot sites in `apps/desktop/src/renderer/src/`:
   - `components/chat/ChatContent.tsx`: compute `supportsUiPlugins` from `HARNESS_CAPABILITIES[resolveProvider(...)]` alongside `drawsMods`, and wrap pane content in `<SlotScopeProvider active={supportsUiPlugins}>`.
   - `components/activity/panels.tsx` & `stores/activity-view-state.ts`: register one permanent built-in `'plugin-panel'` (`PluginDockPanel`) entry in `activityPanelComponents` (preserving `api.fromJSON()` layout restore and `LazyReviewPanel` split boundaries), rendering `useSlotKeyed('activity.panel', params.panelKey)` inside an ErrorBoundary + fallback; add `closeGhostPluginPanels()` alongside `closeGhostMiniAppPanels` / `closeGhostSideChatPanel`.
   - `App.tsx`: wrap the single-view header action site (`mosaicMode !== 'mosaic'`) in its own `<SlotScopeProvider active={activeSessionSupportsUiPlugins}>` for `session.header.actions` (`list` slot). Keep `SessionMosaic.tsx` tile headers uniform and untouched; Mosaic tiles still receive `dsh` plugin rendering inside `<SessionPane>` / `<ChatContent>` (chat content, `ToolBlock`, `composer`).
   - `components/chat/ToolBlockPresenter.tsx`: wrap tool rendering with a `chain` / `hoc` slot hook that defaults directly to existing `@superone/chat-view` presenters when inactive or unmatched.

### PR #1 Verification
- `bunx vitest run` on `packages/ui-slots/src/index.test.ts` (covers all 5 slot kinds, disposer cascade, `active: false` bypass, no-provider fallback).
- Unit tests for `PluginDockPanel` fallback + `closeGhostPluginPanels()` on disabled/uninstalled plugin panel ids.
- From `apps/desktop`: `bunx vitest run src/renderer/src/harness-ui/harness-branch-ratchet.test.ts` (must pass with zero new `HarnessId` branch count).
- `bun run typecheck:web`.
- `bun run build` (verify `LazyReviewPanel` and heavy chunks do not leak into the main renderer entry chunk).
- Relevant Storybook stories render without crashing.

## PR #2 — Main & Preload Bridge (No Eager `DeepseekRuntime` Boot)

### Steps
1. Extend `packages/deepseek/src/plugin-host/registry.ts`:
   - Add disk-only `readClientPluginEntries(pluginRoot)` reading `registry.json` and installed package manifests (`superone.client`: `{ entry, styles?, apiVersion: 1 }`) without importing plugin code, reading `dsh.client`, or starting Cordis.
2. Add `pluginRpc` `Service` in `packages/deepseek/src/tree.ts`:
   - Extend Cordis `Service` and bind `handle(method, fn)` / event emitters to **`this.caller`** (not `this.ctx`), so disabling/uninstalling a single plugin immediately revokes its RPC handlers and subscriptions without restarting `DeepseekRuntime`.
3. Register `superone-plugin://` custom scheme in `apps/desktop/src/main/`:
   - Register scheme privileges (`standard`, `secure`, `supportFetchAPI`, `corsEnabled`, `codeCache`) before `app.whenReady()`.
   - Resolve `superone-plugin://pkg/<encodedId>/<relPath>` (handles scoped npm names cleanly) via `pkgRoot = realpathSync(pkgDir)` + `realpathSync(target).startsWith(pkgRoot + sep)` containment, renderer-only `Origin` / `Referer` check (`superone-renderer://app` or `ELECTRON_RENDERER_URL`), extension allowlist, explicit `readFile` with `text/javascript; charset=utf-8` / `text/css; charset=utf-8` + `Access-Control-Allow-Origin` + `Cache-Control: no-store`. Return `404` on traversal, disabled, or missing plugins.
4. Wire generic Preload tunnel in `apps/desktop/src/preload/index.ts` & `index.d.ts`:
   - Expose `window.superonePlugin`: `listClientPlugins()`, `invoke(pluginId, method, payload)`, `on(pluginId, event, cb)`, `onPluginsChanged(cb)`.
   - Use one multiplexed `ipcRenderer.on` listener per channel + `Map<key, Set<cb>>` (matching `deviceFrameListeners` in `preload/index.ts`) to avoid listener leaks across hot reloads.
   - Main handler for `invoke` uses `peekDeepseekRuntime()`; if `null`, return `{ ok: false, error: { code: 'runtime_not_running', message } }` without calling `getDeepseekRuntime()`, and return a structured `{ ok, data | error }` envelope with bounded timeout.
   - Broadcast `onPluginsChanged` to live business windows (excluding destroying windows and `DragPreview` / `ComputerUsePermissionFloat`) from `apps/desktop/src/main/deepseek/deepseek-plugins.ts` after install/enable/disable/uninstall reconciles.

### PR #2 Verification
- Unit tests for `readClientPluginEntries` (missing/malformed manifests, `apiVersion` mismatch, scoped ids, disabled rows).
- Unit tests for `superone-plugin://pkg/...` resolution (scoped package URLs, symlinked local dev dir containment, path traversal rejection, origin rejection, disabled plugin `404`).
- Unit tests for `pluginRpc` registration + single-plugin `dispose` cleanup via `this.caller` + `peekDeepseekRuntime() === null` fail-closed behavior.
- `bun run typecheck:node` and `bun run typecheck:web`.

## PR #3 — `@superone/plugin-sdk`, `dsh` L2 Dynamic Loader & Sample Plugin

### Steps
1. Create internal workspace package `packages/plugin-sdk` (`@superone/plugin-sdk`):
   - Expose versioned read-only session/theme hooks, `ui-slots` registration helpers, scoped `pluginRpc` client, and a lightweight `bun build` external-globals build helper (~40 lines) rewriting shared dependencies to `globalThis.__SUPERONE_SHARED__`. **Never** expose raw internal Zustand stores.
2. Implement the `dsh` renderer loader in `apps/desktop/src/renderer/src/harness-ui/dsh/`:
   - **Lazily** initialize frozen `globalThis.__SUPERONE_SHARED__` (via dynamic `import()`) only when `listClientPlugins()` returns `>= 1` enabled client plugin (`react`, `react-dom`, `react/jsx-runtime`, `zustand`, curated `@superone/ui` primitives, `@superone/plugin-sdk`; **omit `lucide-react`**).
   - Load enabled client entries via `import('superone-plugin://pkg/<encodedId>/<entry>?v=<rev>')`, inject/remove `<link rel="stylesheet" href="superone-plugin://pkg/<encodedId>/<css>?v=<rev>">` tied to the plugin's `Disposable` scope, and wrap rendered slot contributions in a React `ErrorBoundary`.
   - Subscribe to `window.superonePlugin.onPluginsChanged` to mount/dispose plugins live and run `closeGhostPluginPanels()` on disable/uninstall without restarting Electron.
3. Build one end-to-end sample `dsh` plugin fixture/package using `@superone/plugin-sdk` exercising:
   - Custom `chat.toolBlock` renderer (`chain`/`hoc`),
   - Custom `activity.panel` Dockview tab (`PluginDockPanel`),
   - Node-side `pluginRpc.handle(...)` ↔ renderer `invoke(...)` round-trip.

### PR #3 Verification
- Integration/component tests verifying:
  - Mosaic side-by-side `dsh` pane + `claude` pane: plugin UI renders inside `dsh` pane only; `claude` pane renders stock UI with zero leaks.
  - Faulty plugin throw is caught by `ErrorBoundary` without crashing `ChatPanel` or sibling panes.
  - Hot disable/uninstall immediately disposes slots, CSS `<link>`, ghost Dockview panels, and `pluginRpc` handlers.
- `bun run typecheck:node`, `bun run typecheck:web`, `bun run build` (cold-start chunk budget check), and affected Vitest suites in `apps/desktop` and `packages/deepseek`.

## Post-Pilot Rollout (PR #4+, Tracked Later)

- Decompose `apps/desktop/src/main/index.ts` domain IPCs into `ServiceContainer` + `DisposableStack`, then introduce an Electron-free `PluginHost` in `@superone/runtime`.
- Bridge L1 sandboxed Mini-Apps / MCP Apps / Widgets into `packages/ui-slots`.
- Open app-scoped `sidebar.left` slots and gradually enable `supportsUiPlugins: true` for additional harnesses as backend plugin bridges land.

## Validation Log

- 2026-11-24: [dsh-ui-plugins.md](../proposals/dsh-ui-plugins.md) accepted (with Mosaic tile headers kept unified; Mosaic tiles render `dsh` overrides inside `<SessionPane>` / `<ChatContent>`). Moving to execution in isolated worktree `feat/dsh-ui-plugins`.
- 2026-11-24 (PR #1): Created `packages/ui-slots` (`SlotRegistry`, 5 slot kinds, disposer cascade, `<SlotScopeProvider>`, safe no-provider fallback), added `HARNESS_CAPABILITIES.supportsUiPlugins` (`dsh: true`, others `false`), wired pilot slot sites (`ChatContent.tsx`, `PluginDockPanel` + `closeGhostPluginPanels` in `panels.tsx` / `activity-view-state.ts`, single-view `session.header.actions` in `App.tsx`, `ToolBlockPresenter.tsx`), and added `PluginDockPanel.stories.tsx` + tests. Verified `harness-branch-ratchet.test.ts` (0 new branches), `typecheck:web`, and lazy `ReviewPanel` chunk separation.
- 2026-11-24 (PR #2): Added disk-only `readClientPluginEntries` in `packages/deepseek/src/plugin-host/registry.ts` (`superone.client`, `apiVersion: 1`), `PluginRpcService` in `packages/deepseek/src/plugin-rpc.ts` mounted in `tree.ts` with caller-fiber cleanup, `superone-plugin://pkg/<encodedId>/<relPath>` protocol (`Origin`/`Referer` check, extension allowlist, CORS, `no-store`, symlink-safe containment), and multiplexed `window.superonePlugin` preload tunnel (`peekDeepseekRuntime()` fail-closed with `runtime_not_running`). Verified unit tests across `packages/deepseek` and `apps/desktop` plus `typecheck:node` and `typecheck:web`.
- 2026-11-24 (PR #3): Created `packages/plugin-sdk` + `bun build` external-globals helper (`superoneExternalsPlugin`, omitting `lucide-react`), `apps/desktop/src/renderer/src/harness-ui/dsh/` lazy L2 loader (`shared-runtime.ts`, `plugin-loader.ts`), and end-to-end sample plugin fixture `packages/deepseek/src/fixtures/sample-ui-plugin` exercising `chat.toolBlock`, `activity.panel`, and `pluginRpc`. Verified Mosaic `dsh`+`claude` pane isolation, `ErrorBoundary` fallback, hot disable/uninstall cleanup, `typecheck:node`, `typecheck:web`, and production build lazy chunks.
