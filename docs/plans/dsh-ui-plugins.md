# DeepSeek harness (`dsh`) microkernel and UI plugins pilot

Status: completed · Updated: 2026-11-24
Goal: Evolve the `dsh` UI plugins pilot (`9b98cec3c`) into a true client+main microkernel pilot (`ClientKernel` 5 buses, extensible shell/chat content boundaries, de-privileged `Trajectory` & `Review` built-in plugins, and updated `plugin-sdk` + sample plugin) while preserving Mosaic isolation, lazy boot, and chunk boundaries.
Proposal: [dsh-ui-plugins.md](../proposals/dsh-ui-plugins.md)
Long-term docs affected: `docs/harness/dsh/deepseek-harness-integration.md`, `apps/desktop/docs/agent-reference/architecture.md`, `apps/desktop/docs/agent-reference/performance.md`

## Phase A — Initial 4-Slot Pilot Substrate (Completed at `9b98cec3c`)

- **PR #1**: Zero-dependency `packages/ui-slots` (`SlotRegistry`, `<SlotScopeProvider>`, 5 slot kinds, disposer cascade), `HARNESS_CAPABILITIES.supportsUiPlugins` (`dsh: true`), and initial 4 slot sites (`session.providers`, `session.header.actions`, `activity.panel` via `PluginDockPanel` + `closeGhostPluginPanels`, `chat.toolBlock`).
- **PR #2**: Disk-only `readClientPluginEntries` (`superone.client`, `apiVersion: 1`), `PluginRpcService` bound to caller fiber in `packages/deepseek`, `superone-plugin://pkg/<encodedId>/<relPath>` protocol, and multiplexed `window.superonePlugin` preload tunnel (`peekDeepseekRuntime()` fail-closed).
- **PR #3**: Internal `packages/plugin-sdk` + `buildPluginClient`, lazy `globalThis.__SUPERONE_SHARED__` (omitting `lucide-react`), `DshClientPluginManager`, and `packages/deepseek/src/fixtures/sample-ui-plugin`.

## Phase B — Microkernel Base & De-Privileged Built-in Pilot

### Step 1 — `ClientKernel` 5 Buses + `MiniWindowApp` Support
1. Create `packages/client-kernel` (`package.json`, `tsconfig.json`, `src/index.ts`, `src/react.tsx`, `src/index.test.ts`), building on `@superone/ui-slots` with zero heavy runtime dependencies, and wire `"@superone/client-kernel": "workspace:*"` into `apps/desktop/package.json`.
2. Implement the 5 disposer-scoped buses inside `ClientKernel`:
   - `commands`: `registerCommand`, `executeCommand`, middleware/override support.
   - `keybindings`: `registerKeybinding` with `when` predicate evaluator accepting resolved context from `scopeFromEvent(e)` (`apps/desktop/src/renderer/src/hooks/useChatKeyboardShortcuts.ts`) and respecting `.xterm` / `<webview>` forwarding guards.
   - `menus`: declarative menu registries (`session.contextMenu`, `session.headerMenu`, `composer.plusMenu`, `activity.launcher`) integrated with `session-menu-items.ts`, `HeaderSessionMenu.tsx`, `ComposerActionsButton`, and `useActivityLaunchTypes`.
   - `layout`: thin facade over `layout-actions.ts`, `layout-control.ts`, `activity-panel-api.ts`, and `useMosaicStore`; add `'plugin-panel'` and `'review'` to `COMPONENT_KINDS` in `layout-control.ts`.
   - `theme`: layered OKLch token override source integrated into `useHarnessTheme.ts` (`syncBrandProps` / `usePaneHarnessTheme`), targeting `dsh` `SessionPane` `rootRef` for plugin overrides.
3. Wrap `MiniWindowApp.tsx` with `<SlotRegistryProvider>` / `<ClientKernelProvider>` (leaving `DragPreviewApp` and `ComputerUsePermissionFloat` unmounted) with explicit unsupported for `layout.openPanel`.

### Step 2 — Extensible Content Boundaries & `dsh` Predicate Isolation
1. Register built-in default content boundaries through `ClientKernel` while keeping `[data-activity-outer]`, `[data-main-area]`, `[data-sidebar-outer]`, resize clamp, FLIP anchors, and the 5 `<webview>` `*HostLayer`s as immutable Kernel Chrome:
   - **Session boundaries** (inside `<SlotScopeProvider active={supportsUiPlugins}>`): `workspace.view`, `chat.transcript`, `chat.composer`, `chat.statusBar` (`left`/`right`), `chat.emptyState`, `chat.message.row` (`hoc`), `chat.message.assistant.actions`, `chat.markdown.fence`, `chat.composer.dock.top`, `chat.composer.toolbar.left`/`right`, `activity.launcher`.
   - **App content boundaries**: `shell.titlebar.content`, `shell.sidebar.content`, `shell.activity.content`, `shell.settings.pages`, `shell.overlay.items`, plus incremental `DefaultAppSidebar` slots (`sidebar.tabs`, `sidebar.drawer`, `sidebar.footer.actions`, `sidebar.session.row.trailing`).
2. Enforce `dsh` L2 isolation policies in `DshClientPluginManager` / kernel facade and UI boundaries:
   - Auto-predicate `dsh` L2 `keybindings` (`AND pane.supportsUiPlugins`), `menus` (`ctx.supportsUiPlugins === true`), and `theme` (pane-scoped).
   - Wrap `shell.*` (`WindowsTitleBar`, `AppSidebar`, `ActivityPanel`, `shell.overlay.items`) in `<SlotScopeProvider active={activeSessionSupportsUiPlugins}>` and `sidebar.session.row.trailing` per row by each session's `supportsUiPlugins`, enabling both incremental and full sidebar/shell customization without any experimental setting.

### Step 3 — Minimal Symmetric Main Kernel + De-Privilege `Trajectory` & `Review`
1. Create `packages/runtime/src/plugin-kernel/` (`DisposableScope`, `ServiceRegistry` with fail-fast `require()`, `HookBus` supporting `waterfall`/`pipeline`/`broadcast` + `AbortSignal`), strictly Electron-free.
2. Create `apps/desktop/src/main/kernel/main-plugin-host.ts` (`scope.registerIpc`, `onAppShutdown`).
3. De-privilege **`Trajectory`** (`apps/desktop/src/renderer/src/components/trajectory/`): register via `ClientKernel` (`activity.panel`, `activity.launcher`, `commands`, `layout`) and remove the hardcoded `=== 'dsh'` branch in `activity-launch-types.ts`.
4. De-privilege **`Review`** (`apps/desktop/src/main/review/` + `apps/desktop/src/renderer/src/components/review/ReviewPanel.tsx`, leaving Codex inline `components/chat/ReviewPanel.tsx` untouched): convert into a symmetric `Main + Renderer` built-in plugin registered on `MainPluginHost` + `ClientKernel`, preserving the `React.lazy` `ReviewPanel` chunk split.

### Step 4 — Upgrade `@superone/plugin-sdk` & Full Microkernel `dsh` Sample Plugin
1. Expose `commands`, `keybindings`, `menus`, `layout`, and `theme` on `SuperoneClientPluginContext` in `packages/plugin-sdk` (all bound to `ctx.scope` disposers) and include `@superone/client-kernel` in `SUPERONE_SHARED_MODULES` + lazy `shared-runtime.ts`.
2. Upgrade `packages/deepseek/src/fixtures/sample-ui-plugin/` to exercise:
   - `commands` + `keybindings` (`dsh` pane-scoped shortcut),
   - `menus` (`session.contextMenu` / `activity.launcher`),
   - `theme` (pane-scoped OKLch token override in `dsh` Mosaic tile),
   - `chat.composer.toolbar.right` / `chat.markdown.fence` / `chat.toolBlock`,
   - `activity.panel` (`PluginDockPanel`) + `layout.openPanel`,
   - `pluginRpc` round-trip.

### Phase B Verification Gates
- Unit tests for `packages/client-kernel` (all 5 buses, `when` evaluation, middleware/override, disposer cleanup) and `packages/runtime/src/plugin-kernel` (`DisposableScope`, fail-fast `ServiceRegistry`, `HookBus`).
- Litmus test for `Review` & `Trajectory` built-in plugins: calling `dispose()` cleanly unregisters Main IPCs, services, Renderer panels, commands, keybindings, and menus with zero errors.
- Mosaic mixed-harness integration tests (`dsh` + `claude` side-by-side): `dsh` L2 keybinding, menu, pane theme, markdown fence, composer toolbar, and `chat.message.row` apply strictly inside `dsh` pane and never leak to `claude` pane; hot disable leaves zero residuals.
- `apps/desktop` `harness-branch-ratchet.test.ts` (strictly `<=` baseline, reduced by removing `activity-launch-types.ts` `=== 'dsh'`), `typecheck:node`, `typecheck:web`, affected Storybook story render tests, and `bun run build` confirming `ReviewPanel`, `plugin-loader`, and `shared-runtime` stay out of `out/renderer/index.html` `modulepreload`.

## Validation Log

- 2026-11-24: [dsh-ui-plugins.md](../proposals/dsh-ui-plugins.md) accepted (initial 4-slot pilot + Mosaic unified header).
- 2026-11-24 (Phase A / PR #1–#3, `9b98cec3c`): Landed `@superone/ui-slots`, `supportsUiPlugins`, 4 pilot slots, disk-only `superone.client`, `PluginRpcService`, `superone-plugin://pkg/...`, `window.superonePlugin`, `@superone/plugin-sdk`, lazy `shared-runtime`, and `sample-ui-plugin`. Verified typechecks, `packages/deepseek` (4 files / 31 tests), `apps/desktop` (12 files / 101 tests, `harness-branch-ratchet` 0 new branches), and production build lazy chunks.
- 2026-11-24: Proposal and plan expanded to Phase B (true microkernel base + `dsh`-isolated pilot) following architecture review.
- 2026-11-24 (Phase B / Step 1): Created `packages/client-kernel` (`commands`, `keybindings` + `scopeFromEvent` / `.xterm` / `<webview>` forwarding, `menus`, `layout` adapter + `'plugin-panel'` & `'review'` in `COMPONENT_KINDS` / `LayoutTabKind`, reactive OKLch `theme` bus), wired `App.tsx`, `useHarnessTheme.ts`, `useChatKeyboardShortcuts.ts`, `session-menu-items.ts`, `HeaderSessionMenu.tsx`, `ComposerActionsButton.tsx`, `activity-launch-types.ts`, and `MiniWindowApp.tsx` (explicit `unsupported` for `layout.openPanel`).
- 2026-11-24 (Phase B / Step 2): Preserved immutable Kernel Chrome (`[data-activity-outer]`, `[data-main-area]`, `[data-sidebar-outer]`, resize/FLIP anchors, 5 `<webview>` `*HostLayer`s) and avoided dynamic `hoc` on heavy stateful containers while wiring session (`workspace.view`, `chat.transcript`, `chat.composer`, `chat.statusBar`/`left`/`right`, `chat.emptyState`, `chat.message.row`, `chat.message.assistant.actions`, `chat.markdown.fence`, `chat.composer.dock.top`, `chat.composer.toolbar.left`/`right`) and app (`shell.titlebar.content`, `shell.sidebar.content`, `shell.activity.content`, `shell.settings.pages`, `shell.overlay.items`) content boundaries plus `dsh` L2 isolation (`supportsUiPlugins` auto-predicates, pane-scoped `theme`, and `experimental.dshGlobalShell` gate, default `false`).
- 2026-11-24 (Phase B / Step 3): Added Electron-free `packages/runtime/src/plugin-kernel/` (`DisposableScope`, fail-fast `ServiceRegistry`, `HookBus` `waterfall`/`pipeline`/`broadcast` + `AbortSignal`), thin `apps/desktop/src/main/kernel/main-plugin-host.ts` (`registerIpc`, `onAppShutdown`), de-privileged `Trajectory` (`components/trajectory/trajectory-plugin.tsx`, removing `=== 'dsh'` from `activity-launch-types.ts` and lowering `ratchet-allowlist.json`) and symmetric Main+Renderer `Review` (`main/review/review-plugin.ts` + `components/review/review-plugin.tsx`), preserving lazy `ReviewPanel` and `TrajectoryPanel` chunks.
- 2026-11-24 (Phase B / Step 4): Extended `packages/plugin-sdk` (`commands`, `keybindings`, `menus`, `layout`, `theme` bound to plugin scope) and `SUPERONE_SHARED_MODULES` / lazy `shared-runtime.ts` with `@superone/client-kernel`, upgraded `packages/deepseek/src/fixtures/sample-ui-plugin`, and verified all workspace typechecks, Vitest suites (`packages/deepseek` 4 files / 31 tests, `apps/desktop` + workspace kernel/SDK tests 35 files / 387 tests, `harness-branch-ratchet` lowered cleanly), and production build lazy chunks (`ReviewPanel-BEFR4_8Z.js` 705K, `TrajectoryPanel-BKpYWCJg.js` 130K, `plugin-loader-DA4Mbue5.js` 16K, `shared-runtime-iY-VDFLN.js` 5.4K excluded from `index.html` `modulepreload`).
