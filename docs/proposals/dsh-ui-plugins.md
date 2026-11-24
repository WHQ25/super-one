# DeepSeek harness (`dsh`) microkernel and UI plugins pilot

Status: accepted · Updated: 2026-11-24
Plan: [dsh-ui-plugins.md](../plans/dsh-ui-plugins.md)

## Problem

PRs #1–#3 (`9b98cec3c`) proved `packages/ui-slots`, `superone-plugin://pkg/...`, `window.superonePlugin`, Cordis `PluginRpcService`, and lazy `dsh` L2 bundle loading. However, exposing only a few outer patch slots leaves SuperOne as a hardcoded monolith: plugins cannot register commands, context-aware keybindings, menus, programmatic layout actions, or pane-scoped theme overrides, and SuperOne's own built-in features remain privileged hardcoded wiring rather than equal citizens on the plugin kernel.

## Goals

1. **True microkernel substrate**: Upgrade the client substrate into `ClientKernel` (`slots`, `commands`, `keybindings`, `menus`, `layout`, `theme`) paired with a minimal Electron-free backend kernel (`packages/runtime/src/plugin-kernel/`) + thin desktop adapter (`apps/desktop/src/main/kernel/main-plugin-host.ts`).
2. **Replaceable/extensible content boundaries without breaking layout invariants**: Register SuperOne's core regions (`shell.*.content`, `workspace.view`, `chat.transcript`, `chat.composer`, `chat.statusBar`, `chat.emptyState`, `chat.message.row`, `chat.markdown.fence`) through the kernel while keeping DOM anchors, FLIP/resize math, and `<webview>` `*HostLayer` chrome immutable.
3. **De-privileged built-in plugin proof**: Extract `Trajectory` (renderer-only, `dsh`-native) and `Review` (`main/review` + `components/review/ReviewPanel.tsx` symmetric Main+Renderer, excluding Codex inline `/review`) into built-in plugins registered solely through the kernel.
4. **Harness-isolated `dsh` L2 pilot**: Keep external L2 customization scoped strictly to `dsh` (`HARNESS_CAPABILITIES.supportsUiPlugins`) across Mosaic mixed-harness split panes, multi-window modes (`RootApp` + `MiniWindowApp`), and lazy boot (`peekDeepseekRuntime()`).

## Non-goals (for this pilot)

- Moving `apps/desktop` onto `@deepseek-ai/cordis` or `dsh-host-webserver` combo bundles.
- Decomposing `Browser` (`BrowserHostLayer`, CDP, Chrome Bridge) or `Terminal` (`ControlLeaseService`, PTY, `terminal_tabs`) or refactoring all 6,356 lines of `apps/desktop/src/main/index.ts`.
- Extending L2 dynamic renderer plugins to `apps/mobile` or remote `apps/cli` nodes during the pilot.

## Decisions

### 1. Client microkernel (`ClientKernel`) wrapping existing authoritative controllers

Rather than duplicating layout, shortcut, or theme state, `ClientKernel` (`packages/client-kernel`, zero heavy runtime dependencies, built on `@superone/ui-slots`) provides five disposer-managed service buses integrated with SuperOne's existing authorities:

1. **`commands`**: Unified command registry (`register`, `execute`, middleware/override) bound to `DisposableScope` / `SlotScopeHandle`.
2. **`keybindings`**: Context-aware shortcut registry (`when` predicates, priority ordering) whose evaluator natively incorporates `scopeFromEvent(e)` from `apps/desktop/src/renderer/src/hooks/useChatKeyboardShortcuts.ts` (resolving `[data-scope-session]` across Radix `document.body` portals, validating live session ownership, excluding `.xterm`, and respecting `<webview>` guest shortcut forwarding).
3. **`menus`**: Declarative contribution registries for `session.contextMenu`, `session.headerMenu`, `composer.plusMenu`, and `activity.launcher`, cooperating with `session-menu-items.ts` and `native-context-menu.ts`.
4. **`layout`**: Thin facade over `apps/desktop/src/renderer/src/lib/layout-actions.ts`, `layout-control.ts`, `activity-panel-api.ts`, and `mosaic-store` (open/close/focus sidebar, Dockview tabs, main views, split tiles). Add `'plugin-panel'` and `'review'` to `COMPONENT_KINDS` in `layout-control.ts` so `layout_snapshot` / `layout_act` stay aware of plugin tabs.
5. **`theme`**: Layered OKLch CSS token override source wired into `useHarnessTheme.ts` (`syncBrandProps` / `usePaneHarnessTheme`) instead of mutating `document.documentElement.style` directly (which `useHarnessTheme`'s `rAF` diffing would overwrite).

### 2. Kernel Chrome vs extensible content boundaries & `hoc` stability

- **Immutable Kernel Chrome**: Outer geometric wrappers and DOM anchors queried by `layout-actions.ts` and `App.tsx` (`[data-activity-outer]`, `[data-activity-inner]`, `[data-sidebar-outer]`, `[data-main-area]`, `[data-miniapp-host]`, `[data-browser-host]`), `App.tsx` resize clamp, the 5 persistent `<webview>` `*HostLayer` mounts, and `RootApp` mini-window fold shell remain fixed Kernel Chrome so FLIP animations, `useSlotBounds`, and `<webview>` persistence never break.
- **Extensible inner content boundaries**:
  - **App content boundaries**: `shell.titlebar.content`, `shell.sidebar.content`, `shell.activity.content`, `shell.settings.pages` (`keyed`/`list`), `shell.overlay.items` (`list`), plus incremental sidebar boundaries (`sidebar.tabs`, `sidebar.drawer`, `sidebar.footer.actions`, `sidebar.session.row.trailing`).
  - **Session boundaries**: `workspace.view` (`list`+`keyed` / `single`), `chat.transcript`, `chat.composer`, `chat.statusBar` (plus `chat.statusBar.left` / `right`), `chat.emptyState` (`chain`), `chat.message.row` (`hoc`), `chat.message.assistant.actions` (`list`), `chat.markdown.fence` (`chain`), `chat.composer.dock.top` (`list`), `chat.composer.toolbar.left` / `right` (`list`), `activity.launcher` (`list`), alongside existing `session.providers`, `session.header.actions`, `chat.toolBlock`, and `activity.panel`.
- **No dynamic `hoc` on stateful heavy containers**: Stateful containers (`shell.sidebar.content`, `shell.activity.content`, `workspace.view`, `chat.transcript`, `chat.composer`) expose `single` / `chain` / `list` / `keyed` content boundaries rather than dynamic `hoc` chains, preventing Tiptap, Dockview, and xterm subtree remounts. Dynamic `hoc` stays restricted to lightweight row/scope boundaries (`chat.message.row`, `session.providers` with reference-stable composition caching).
- **Multi-window (`RootApp` + `MiniWindowApp`)**: Initialize `ClientKernel` in `RootApp` and `MiniWindowApp` only (exclude `DragPreviewApp` and `ComputerUsePermissionFloat`). `MiniWindowApp` wraps `SessionPane` in `<SlotRegistryProvider>` so `chat.*` slots and pane theme overrides work in detached windows, and returns explicit unsupported for `layout.openPanel`.

### 3. Harness-isolated scoping across session UI, buses, and app chrome

Under the `dsh`-first pilot (`HARNESS_CAPABILITIES[provider].supportsUiPlugins`, initially `true` only for `dsh`), apply a tiered isolation policy so non-`dsh` panes and Mosaic split windows never flicker or leak:

1. **Session / Pane UI (`chat.*`, `session.providers`, `workspace.view`)**: Scoped per pane via `<SlotScopeProvider active={supportsUiPlugins}>`.
2. **Global behavior buses (`keybindings`, `menus`, `commands`, `theme`)**:
   - Built-in plugins register without harness restriction.
   - `dsh` L2 plugins receive automatic capability predicates injected by the loader/SDK facade: `keybindings` automatically `AND` `pane.supportsUiPlugins` (via `scopeFromEvent(e)`), `menus` inject `ctx.supportsUiPlugins === true`, and `theme` token overrides target `dsh` `SessionPane` `rootRef` via `usePaneHarnessTheme` (never `documentElement` globally).
3. **App-level Chrome (`shell.*`, `sidebar.*`)**:
   - SuperOne's default chrome registers into these slots as built-in defaults (proving the microkernel), while `DefaultAppSidebar` also exposes incremental slots (`sidebar.tabs`, `sidebar.drawer`, `sidebar.footer.actions`, `sidebar.session.row.trailing`) alongside full `shell.sidebar.content` replacement.
   - `App.tsx` wraps `WindowsTitleBar`, `AppSidebar`, `ActivityPanel`, and `shell.overlay.items` in `<SlotScopeProvider active={activeSessionSupportsUiPlugins}>`, and `SessionRow` / `PinnedSessionRow` wrap `sidebar.session.row.trailing` in `<SlotScopeProvider active={HARNESS_CAPABILITIES[provider]?.supportsUiPlugins === true}>`. Thus `dsh` plugins can incrementally extend or fully replace `shell.*` / `sidebar.*` without any experimental flag whenever a `dsh` session is active, and revert automatically on switching to non-`dsh` harnesses. (`shell.settings.pages` remains globally accessible in Settings.)

### 4. First de-privileged built-in plugins: `Trajectory` and `Review`

- **`Trajectory` (`apps/desktop/src/renderer/src/components/trajectory/`)**: Already `dsh`-only in `activity-launch-types.ts`; extracting it into a built-in frontend plugin exercises `activity.panel`, `activity.launcher`, `commands`, and `layout`, and removes the hardcoded `=== 'dsh'` branch in `activity-launch-types.ts` (lowering the `harness-branch-ratchet` count).
- **`Review` (`apps/desktop/src/main/review/` + `apps/desktop/src/renderer/src/components/review/ReviewPanel.tsx`)**: Main wiring in `main/index.ts` is minimal (`TurnDiffTracker` + `registerReviewIpc`), and `ReviewPanel` is already `React.lazy`. Extracting it into a symmetric `Main + Renderer` built-in plugin proves that a single `dispose()` cleanly tears down Main IPC, services, Renderer panels, commands, and menus while preserving the lazy `ReviewPanel` chunk. (Leave Codex's inline `components/chat/ReviewPanel.tsx` untouched.)

### 5. Minimal symmetric Main microkernel (`@superone/runtime` + `apps/desktop/src/main/kernel/`)

- Add `packages/runtime/src/plugin-kernel/` (strictly Electron-free for future `apps/cli` reuse) providing `DisposableScope`, `ServiceRegistry` (`provide` / `get` / `require`, fail-fast on missing services), and `HookBus` (`waterfall` / `pipeline` / `broadcast` with priority and `AbortSignal`).
- Add `apps/desktop/src/main/kernel/main-plugin-host.ts` (~150 lines) providing `scope.registerIpc(channel, handler)` (auto-cleaned via `ipcMain.removeHandler` on dispose) and shutdown hooks.
- Third-party `dsh` Node plugins continue running in `packages/deepseek`'s Cordis tree via `PluginRpcService` (`9b98cec3c`), while built-in `Review` validates the symmetric `Main + Renderer` microkernel lifecycle.

### 6. L2 bundle ABI, preload tunnel, and storage invariants (preserved from PRs #1–#3)

- `superone.client` (`apiVersion: 1`) disk-only metadata in `packages/deepseek/src/plugin-host/registry.ts` (never boots `DeepseekRuntime` eagerly).
- `superone-plugin://pkg/<encodedId>/<relPath>` protocol (`Origin`/`Referer` guard, extension allowlist, CORS, `no-store`, `pkgRoot` containment).
- Multiplexed `window.superonePlugin` preload tunnel (`peekDeepseekRuntime()` fail-closed with `runtime_not_running`).
- Lazy frozen `globalThis.__SUPERONE_SHARED__` (omitting `lucide-react`, never exposing internal Zustand stores); isolated `<userData>/plugins/<id>/` storage; `InstallOptions.trust: 'granted'` + React `ErrorBoundary`.
