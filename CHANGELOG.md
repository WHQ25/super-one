# Changelog

All notable changes to SuperOne are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [0.35.2-alpha] - 2026-05-18

### Added

- Terminal: clickable links, WebGL renderer, Unicode 11 support, and ⌘F in-terminal search
- ⌘W closes the active tab, falling back to closing the window when no tab is focused

### Fixed

- Pending interactions are now tagged with session/project so they survive a window reopen

### Tests

- Terminal instance teardown extracted into a pure function with a crash regression test
- ⌘W focus routing extracted into a pure function with regression tests

## [0.35.1-alpha] - 2026-05-18

### Fixed

- Codex: todo list now reaches mobile via the dedicated todo result channel
- Codex: chat todos no longer render the composite task id prefix
- Terminal: per-session open state, with per-project shared terminal instances

## [0.35.0-alpha] - 2026-05-17

### Added

- Integrated terminal: local PTY-backed terminal (node-pty + xterm) with a dedicated coding drawer, plus Phase 2 remote terminal over relay/LAN — inbound command execution with session ownership and snapshot chunking
- Remote: chat session rename titles are now forwarded to mobile as tool summaries
- Remote: richer Task fields forwarded to the mobile todo channel

### Fixed

- Codex: real turn interrupt, with correct per-bubble item attribution
- Chat: `resetSession` is now idempotent on pristine sessions
- Chat: todo "blocked-by" now renders from the inverse blocks edge
- Remote: streaming markdown tables stay intact across delta boundaries
- Sidebar: session pin icon width stays collapsed until row hover

### Changed

- Coding: session title max-width widened to 300px

## [0.34.1-alpha] - 2026-05-17

### Added

- **Provider dialog is now scoped to the entry harness** and remembers which section you last opened per harness, so reopening the dialog lands you where you left off for that harness.
- **Todo UI adapts to the new Task system fields**, keeping the in-chat task list aligned with the updated agent task model.
- **Upgraded to Claude Agent SDK 0.3.143.**

### Fixed

- **Custom Codex provider connectivity test hardened** so a misconfigured provider fails clearly instead of intermittently.
- **Queued-turn streaming status fixed.** A user-echo queued turn now emits `status_change:streaming`, so the UI no longer appears idle while the queued message is being processed.
- **File search no longer starves directories.** `collectFiles` now traverses round-robin, so large or deep folders can't crowd out results from other directories.

### Tests

- **AppSidebar test stabilized** by stubbing `window.app.getAppSettings` in the mock.

## [0.34.0-alpha] - 2026-05-16

### Added

- **Mini-app background worker API.** Mini-apps can declare a headless background worker that keeps running — downloads, long-lived tasks — independent of any visible window. Ships a dedicated worker-host shell process, IPC wiring with lifecycle enforcement and an app-quit gate, a per-project worker group in the sidebar with live status text, KV + peer type declarations in the generated `superone.d.ts`, and a dual-path (dev/webview) channel bridge. The `hello` example mini-app now includes a background download demo plus an external-URL download variant.
- **Per-project mini-app drawer order is now persisted** and restored on reopen.

### Fixed

- **Custom Codex provider now actually takes effect.** A selected custom Codex provider previously failed to propagate to the running session; it is now applied.
- **Queued-message handling.** Editing or deleting a queued message now honors the dequeue result; consuming a queued message no longer produces a duplicate transcript entry.
- **Streaming status no longer gets stuck.** A turn that completes now reliably settles the streaming state instead of leaving the UI spinning.
- **Stop button now interrupts immediately** on click instead of waiting for the next event.
- **Per-session title syncs on `session_title_changed`**, so a renamed session shows the correct title without a reload.

## [0.33.0-alpha] - 2026-05-15

### Added

- **Standalone mini-app tools render as iframes inside the chat tool block.** A mini-app can declare `standalone: true` tools that execute and render entirely inside an iframe placed in the chat message — no panel, no separate UI. The single `renderer.result.template` HTML both registers the handler via `window.superone.tools.handle(...)` and paints the result UI. Calls survive panel close, viewport-scroll unmount (cached replay on re-entry), and out-of-order `miniapp-ready` vs callEntry delivery. Dispatch flows through a new `miniapp.standalone` IPC path with event-trace coverage. Demo: `apps/desktop/examples/miniapp/standalone-demo` ships four tools (`increment`, `read_counter`, `reset`, `show_counter`) so the schema/runtime contract is exercisable out of the box.
- **Standalone tools can declare `renderer.intercept` for two-phase HITL flows.** Phase 1 renders the intercept iframe inside the chat block for user-refined inputs; once submitted (or cancelled with `onCancel: reject | resolve-empty`), phase 2 takes over as the standalone result iframe. The same `callId` carries through both phases. The `confirm_increment` demo tool walks the pattern end-to-end.
- **Mini-app mention chips in chat input.** `@`-mention any installed mini-app from the chat input; the chip survives copy/paste via invisible zero-width markers, and the message renderer round-trips it back to a chip on receipt.

### Fixed

- **`session_rename` is now always loaded so the model actually sees it.** The MCP server used the deprecated `server.tool()` helper, which the SDK deferred behind `ToolSearch`, so the model never saw the rename tool unless it explicitly searched for it. Switched to `server.registerTool()` with `_meta['anthropic/alwaysLoad']: true`; the agent system prompt was trimmed in tandem since the tool's own description now carries the trigger rules.
- **Standalone tool blocks render reliably on first paint after window reopen.** `ToolBlock` and `ChatMessage` read `useMiniAppStore.getState().apps` instead of subscribing, so when `AppSidebar`'s async `fetchApps` landed after the chat first rendered, both memoized components missed the apps list and fell back to the generic tool block. Switched to a Zustand selector subscription so the standalone branch picks up the apps load mid-mount; pinned with a regression test that flips the store between renders.
- **Panel-mode mini-apps no longer leak over a fullscreened canvas mini-app.** The activity panel collapsed to width 0 but its inner div kept `width: panelWidth`, so panel-mode apps still reported a valid `getBoundingClientRect` and `MiniAppHostLayer` rendered them on top of the fullscreened canvas app. Visibility now gates on matching `(layoutMode, presentation)`.

### Tests

- **Regression test for `StandaloneToolBlock` dispatch lifecycle.** Pins the contract that the iframe call resolves regardless of whether `miniapp-ready` or `callEntry` arrives first, and that the cached-result replay path runs when the block re-enters the viewport. Adds an `IntersectionObserver` mock to `vitest.setup.ts` so future viewport-observation tests can run under jsdom.

## [0.32.1-alpha] - 2026-05-13

### Added

- **Main-process crash diagnostics.** Process-level handlers now route uncaught exceptions and unhandled rejections through `electron-log` with the error's name/code/message/stack plus runtime metadata (appVersion, platform, arch, Electron version). Previously a main-process crash left no trace beyond the OS exit code; `unhandledRejection` coerces non-Error rejections via `String(reason)` so arbitrary thrown values still surface a readable line.

### Changed

- **Session-title rename animation switched to a per-character flip + shimmer.** The agent-driven rename animation now uses a CSS-native `rotateX` flip with an accent-color shimmer per character instead of motion's staggered fade. It fires only when the agent renames the *currently displayed* session; switching to a different session jumps straight to the new title without animating, so navigation no longer looks like a rename.

## [0.32.0-alpha] - 2026-05-13

### Added

- **AI can rename sessions to reflect the topic.** A new `session_rename` MCP tool lets the active model retitle the current chat as the topic clarifies. Sessions you've manually renamed are protected by an `is_user_renamed` SQLite flag (the tool returns `user_locked` so the model stops calling them). Title updates animate in across all six title surfaces (coding header, chat panel header, mini window, sidebar pinned, sidebar list, history dialog) via a per-char stagger tuned to a fixed 1s total.
- **Codex now respects SuperOne's system prompt.** Codex's app-server protocol has no system-prompt append interface, so SuperOne tool-usage rules (`widget_show`, `miniapp_dev_read_guide`, `session_rename`) are injected via `developer_instructions` on every thread/turn — Codex behavior now matches Claude.

### Fixed

- **Codex no longer prompts for permission on SuperOne built-in tools.** `extractSuperoneMiniAppToolName` required a `__` namespace separator that built-in tools (`miniapp_dev_*`, `session_rename`) don't have, so the pre-approve check missed and a permission prompt popped on every internal call. Built-in SuperOne tools are now pre-approved uniformly across Claude and Codex.
- **Mention chips no longer break slash hint / prompt suggestions in chat input.** ProseMirror's `doc.textContent` silently skipped `MentionNode` atoms, so a paragraph containing a mention chip plus a leading slash looked empty to the suggestion engine and the slash hint disappeared. The suggestion and slash-hint paths now use structural API (`paragraph.firstChild.text` / `childCount`) instead.

### Changed

- **PermissionPrompt drops the standalone Always Allow button.** When a permission request has no suggestions, the separate blue "Always Allow" button is gone; always-allow behavior is uniformly carried by the suggestion row.
- **Built-in SuperOne MCP tools renamed to `<category>_<subcategory>_<verb>`.** `read_miniapp_guide` → `miniapp_dev_read_guide`, `setup_mini_app_dev` → `miniapp_dev_setup`, `register_dev_miniapp` → `miniapp_dev_register`, `pack_mini_app` → `miniapp_dev_pack`, `update_superone_types` → `miniapp_dev_update_types`. The standalone `widget` MCP server is merged into `superone` with `show_widget` → `widget_show` and `read_guidelines` → `widget_read_guide`, so both Claude and Codex now share one server and pre-approval is uniform.

## [0.31.2-alpha] - 2026-05-12

### Fixed

- **Worktree sessions can load local assets again.** `local-file` protocol and the media-server only trusted recent-folder roots, so assets referenced from a session running inside a worktree (under `~/.worktrees/...`) were rejected with 403. A new session-repo helper returns distinct `worktree_path` values currently used by sessions and includes them in the allowed roots for both transports.
- **Chat status bar no longer renders both worktree and main-repo branch pills.** `ChatStatusBar` required `session._worktreeBaseBranch` *in addition to* the app-store worktree state, so when the two desynced both pills rendered side-by-side. The app-store is now the single source of truth via `computeIsInWorktree()`, with regression tests covering the desynced-session case.

### Changed

- **Activity panel uses a dedicated MessageSquare tab for session history** instead of folding it into the existing tabs, making it easier to spot.

## [0.31.1-alpha] - 2026-05-12

### Added

- **Dev App Library: a global registry for in-development mini-apps.** A new dev-registry at `~/.superone/dev-registry.json` tracks every dev mini-app on the machine, so a single panel can manage them and install them into any scope (user or current project). `.s1-dev.json` collapses to `{ enabled }` only — the `appId` now comes from the parent directory name and `sourceDir` / `distDir` are reverse-looked-up via the registry (strict schema, alpha-phase). A new `register_dev_miniapp` MCP tool registers existing sources without going through the scaffold flow, paired with 7 new `window.miniapp.devRegistry.*` IPC channels. The Apps settings page gains a "Dev Apps" toggle (renamed from "Library" to avoid clashing with MCP Library's marketplace semantics) opening a `DevAppLibraryView` modeled on the MCP `LibraryView`: multi-select rows, per-row scope chip, bulk install to user / current project, and an "unlinked" badge for registry entries whose source dir is gone. Mini-app developer guides (`overview.md`, `manifest.md`) document the new flow and flag the alpha-phase `appId` timestamp suffix as a cross-machine collab caveat.

## [0.31.0-alpha] - 2026-05-12

### Added

- **Claude plugin settings page is now scope-aware with a structured resource explorer.** You can add a marketplace from GitHub/URL/local path, see its scope (user/project/local from each `.claude/settings.json`'s `extraKnownMarketplaces`, with `claude-plugins-official` surfacing as "Built-in"), and remove it at the correct scope — the right settings file is edited and the CLI's marketplace remove runs only when no other scope still references it. Falls back to the GitHub owner's avatar as the marketplace logo. Plugin detail now parses `.mcp.json` and `hooks/hooks.json` so MCP servers and hook events become first-class entries in the left sidebar; a category list (commands/agents/skills/hooks/mcp) replaces the raw file tree, folder-shaped resources drill into a collapsible FileTree with a `← <icon> <name>` header, single-file resources preview in place, and selecting a hook event shows its JSON plus a "Referenced scripts" list with each `${CLAUDE_PLUGIN_ROOT}/...` path clickable and syntax-highlighted. Expanded plugin cards drawer-animate via motion. A root `postinstall` proxy now runs the desktop workspace's electron-rebuild, since bun does not run lifecycle scripts for child workspaces by default.
- **Worktree session indicator shows git dirty state.** Worktree sessions had no visible dirty signal once a session became "old" — the branch popover only renders when the user can still switch worktrees. The indicator now shows an amber/grey dot when there are uncommitted changes and turns into a click popover mirroring the git indicator's branch + uncommitted file/+ins/-del row.

### Fixed

- **Codex `in_progress` shimmer no longer sticks after streaming finishes.** Codex app-server occasionally omits `item/completed` for `mcp_tool_call` / `command_execution` items, so the item map kept their status as `in_progress` through `turn/completed` and the ToolBlock's shimmer highlight never cleared. The `turn/completed` handler now scans the item map and finalizes residual `in_progress` items to `completed`, emitting `onItemDelta('completed', …)` so the renderer clears the shimmer immediately.

### Changed

- **Slash command output is unified as an input-area popup; command failures surface in chat.** The fullscreen overlay path is dropped — all slash command output now renders in the input-area popup (max-h-96) with a command-aware view router for the context pie chart, release notes, markdown, and raw text. Codex utility command failures (`/auth-set`, `/reset`, `/auth-status`) push an in-chat assistant error message instead of populating the popup, matching the existing `message_error` visual treatment.
- **`@anthropic-ai/claude-agent-sdk` bumped to 0.2.139** (parity with Claude Code 2.1.137–139, no breaking changes). The `AccountApiProvider` union extends to include `'gateway'` matching the SDK's newly added `apiProvider` value.

### CI

- **`deploy-relay` workflow injects `relay.super-one.dev` as a route at deploy time.** The workflow prepends a routes block to `wrangler.toml` so the official deployment binds to `relay.super-one.dev`, while the mirrored public `wrangler.toml` stays self-host friendly (deploys to `workers.dev` out of the box).

## [0.30.6-alpha] - 2026-05-11

### Added

- **`/mcp` slash command shows per-session MCP status.** Settings only shows what's connectable per config; the new popup mirrors what the active session actually loaded (icons, status, tool count), falling back to probe-from-config when no session is attached. A read-only `mcp:meta-cache` IPC lets the popup render server icons without re-probing, and `saveMcpConfig` now nudges the active session to re-enable + reconnect the server on save so re-installs from the Library view take effect immediately instead of staying disabled.

### Fixed

- **Project-scope MCP servers from `.mcp.json` are authorized on save.** Writing the entry to `.mcp.json` alone left the Claude SDK treating it as unauthorized via the `enabledMcpjsonServers` allow-list in `~/.claude.json`, so the server showed "disabled" status right after a fresh install + new session. `saveMcpConfig` now also adds the name to `enabledMcpjsonServers` (and removes it from `disabledMcpjsonServers`) for project scope.
- **MCPB uninstall preserves the unpacked bundle so re-install from Library works.** Uninstall previously `rm -rf`'d the install dir and cleared secrets, leaving the library entry pointing at a missing path; re-installing via the Library view (which only writes mcp config, not bundle files) then produced a broken server that crashed with "connection closed". Uninstall is now a deconfigure — only the mcp config entry is removed; the unpacked bundle and encrypted secrets stay on disk. `installMcpbBundle` still GCs old versions on upgrade, so this doesn't grow unbounded.
- **Mini-app tool registration follows per-session holders instead of a project-wide instance.** Closing an app while another session still referenced its dock panel left the instance in the project-wide `openApps` map; the `useChatStore.subscribe` rekey block then re-opened it on any subsequent active-session switch, silently re-attaching tools the user had already closed. `OpenAppEntry` now carries `holderSessions: Set<sid>` and the iframe stays alive iff at least one session still holds it; `openAppInPanel` / `openFullscreenApp` add the active sid, `closeApp` removes it (destroying the instance only when the set empties), and the rekey segment in `useChatStore.subscribe` is removed so session switches no longer trigger any open/close IPC. Uninstall closes every holder session, not just the active one.

## [0.30.5-alpha] - 2026-05-11

### Added

- **Sandbox is now opt-in per platform with macOS defaulting on.** Seatbelt is built into macOS so the sandbox is enabled by default; Linux/WSL2 stay off until you opt in (a lazy probe checks `bwrap` + `socat` and surfaces install hints in Preferences if missing); Windows and WSL1 hide the On/Auto options entirely. Three independent guards (Session ctor, `buildClaudeOptions`, `setSandbox` runtime path) coerce unsupported platforms before reaching the SDK, and `failIfUnavailable` is now false so the runtime gracefully degrades instead of crashing the turn when the probe is over-optimistic. A new `SANDBOX_PROBE` IPC and `sandboxCapability` in the boot payload back the UI; the chat sandbox selector silently reverts to Off on probe failure with a "Enable in Settings first" link.
- **Mini-app manifests can declare `permissions.storage` to enable Web Storage APIs.** Mini-app iframes are `allow-scripts`-only by default (opaque origin), which silently breaks `localStorage`, `sessionStorage`, `indexedDB`, and the Cache API for any app or third-party library that depends on them. Apps that need storage opt in with `permissions.storage` (object with a required `reason`); granting it adds `allow-same-origin` to the sandbox. Each app stays isolated because mini-apps already load from per-(app, project) `superone-app://` origins. Install consent and the per-app settings page render a Storage row with a "Persistent" badge, and the `permissions` mini-app guide documents the contract.
- **Ctrl+Tab session switcher spans every open project.** The popup lists live sessions across all open projects, not just the active one. Cross-project commits route through `useAppStore.switchToProject` so the sidebar's `currentFolder` / `currentProjectId` stay in sync, and a global `_previousFocusedSession` (project, session) tuple drives bounce-back. Current and previous rows are pinned even when idle/unhydrated; outgoing sessions stub+async-hydrate on switch so they still render.
- **Auxiliary processes carry semantic names in Activity Monitor / `ps`.** Spawned CLIs (Claude SDK, Codex app-server, `dns-sd`, `caffeinate` / `systemd-inhibit`, install scripts) get distinct `argv0` values and renderer windows (main, mini, mini-app dev webview) set `process.title`, so you can tell helpers apart instead of staring at a wall of "SuperOne Helper".

### Fixed

- **Concurrent sessions in the same project no longer crash on tool call.** The cached MCP server per `projectDir` threw "Already connected to a transport" when a second session attached, since `Protocol.connect()` is one-shot. Each session now owns its own `McpServer` instance and mini-app tools register per `(sessionId, appId)`; `MINIAPP_OPEN` / `MINIAPP_CLOSE` carry the active `sessionId` and the main process ref-counts iframe lifetime per `(projectDir, appId)` so the iframe stays shared while tool routing is session-scoped. Interrupt only rejects pending tool calls for the interrupted session — no more cross-session bleed.
- **Mini-app tool calls no longer broadcast across projects.** The same mini-app opened in two projects used to receive every tool call in both iframes (executing side effects twice) and result-race on a shared `pendingCalls` map. MCP server instances and tool registrations are now keyed by `projectPath`, and `(projectDir, callerCwd)` threads through every `MiniAppToolCallRequest` / `InterceptOpenRequest` so the renderer routes to the correct iframe and the tool sees its caller's worktree cwd. Re-keying fs / git permissions by `(projectDir, appId)` also stops project B's `OPEN` from silently overwriting project A's allowed-directories.
- **Mini-app state survives main ↔ settings ↔ setup view transitions.** Switching away from the main view used to destroy the iframe DOM (losing in-app React state, scroll, timers) and the dockview tab registration, so coming back showed "No panels open". `MiniAppHostLayer` is now hoisted to the same fragment slot in every view branch so React keeps a single instance; the unmount path in `ActivityPanel` snapshots the dockview to `activity-view-state.perSession` and restores it on remount.
- **Mini-app dock visibility is per-session while the iframe stays per-project.** A single `(appId, projectId)` instance key replaces the old `appId`-only map, so cross-project switches stop reloading the iframe to a new origin; ref-counting across saved dock layouts (excluding the current session's stale snapshot) decides when `MINIAPP_CLOSE` actually fires. Dockview's `onDidRemovePanel` no longer routes back into `closeApp`, so session-switch `fromJSON` rebuilds can't tear down live mini-apps. Stale layout refs auto-heal via ghost-panel cleanup, and uninstall force-purges every instance regardless of references.
- **Usage page no longer shows 0 sessions / 0 messages.** The active save path `saveSessionStateBySid` never wrote to the `activity_daily` table — only the legacy `saveSessionState` (which has no production callers) did. Counting now happens in the active path; `BACKFILL_VERSION` bumps to v3 so existing installs replay the backfill once and recover today's missing rows.
- **Activity tab strip stays window-draggable when the sidebar is visible.** The drag region was scoped to `.activity-leftmost`, which is removed when the sidebar moves the panel away from the window edge — the tab strip then stopped acting as a window-drag handle even though it still sits at the top of the window. `-webkit-app-region: drag/no-drag` is now promoted to the unscoped `.dockview-theme-superone` selector and the `pointer-events: none` on `.dv-void-container` is dropped (drag regions need hit-testing to work).
- **Activity panel resize handle works again with a mini-app open.** The 4 px hit gutter was sitting at z-30 underneath `MiniAppHostLayer` and effectively unclickable whenever a fullscreen mini-app was showing. Lifted to z-40, and an explicit `isResizing` state keeps the hover guide visible during drag since the resize overlay's z-9999 capture was eating `:hover` the moment the drag started.
- **ChatPanel works over a fullscreen mini-app in canvas mode.** The panel's z-50 was being clamped by its parent `motion.div`'s z-10 stacking context, so the entire chat disappeared under the mini-app's z-30 host layer. Hoisted to root, switched drag/resize position to `useMotionValue` so the always-mounted message list isn't re-rendered every frame (visibly laggy drag with long sessions), and a transparent full-viewport capture overlay during drag/resize keeps the cursor from slipping into the iframe and stealing `mousemove` from the window listener.
- **Preload script no longer breaks the renderer when both entries share an import.** Both `index.ts` and `miniapp-preload.ts` imported from `../main/process-titles`, so Rollup hoisted a shared chunk under `out/preload/chunks/`. The sandboxed preload's restricted `require()` can't resolve relative chunk paths, the script failed to load, and `window.electron` came back undefined. Process titles are now inlined as literals in each preload entry to keep the sandboxed bundle self-contained.
- **Mini-app preapproved tool list is now honored when called from Codex.** Codex's app-server pushes `mcpServer/elicitation/request` for every MCP tool call, so SuperOne's preapprove list (only consulted inside Claude SDK's `canUseTool` callback) was silently ignored for mini-app invocations and every tool surfaced an "Allow the superone MCP server to run tool …?" elicitation banner with a generic style that didn't match Claude. `mapApprovalRequest` now detects `serverName === 'superone'` plain elicitations, extracts the namespaced tool name from the message, and rewrites the PermissionRequest with a full `mcp__superone__*` toolName (dropping `requestKind: 'mcp_elicitation'`), so `PermissionPrompt` renders the same `appName · toolText` label as the Claude path. `handleServerRequest` short-circuits when the rewritten toolName is preapproved, responding `action:'accept'` directly without surfacing any prompt.
- **Mini-app tools stay attached across session swaps in the same project.** Provider switches (Claude ↔ Codex), `resetSession`, and history loads change `_activeSessionId` but the mini-app's tool registration was still pinned to the old sid, so the new session lost access to every dynamic tool until you closed and reopened the app. `useMiniAppStore` now subscribes to `_activeSessionId` and re-registers each open app's tools onto the new sid in an open-new-then-close-old order that keeps fs/media permissions intact via ref-counting; opening an app before any session exists pre-seeds a draft sid via `ensureSession`. Codex turn view also groups consecutive groupable mini-app `mcp_tool_call` items into a collapsible `CodexAppToolGroup` mirroring the Claude side, and codex-side "Always allow" is forbidden for mini-app prompts — preapproval is owned by SuperOne's packager, so `persist:['always']` is stripped before forwarding the elicitation.

### Changed

- **ActivityPanel header folds into the dockview tab strip.** The dedicated 44 px header row is gone — `LayoutToggle` now renders through dockview's `prefixHeaderActionsComponent` slot when the panel is leftmost. Drag region moves to a CSS rule (`.dv-tabs-and-actions-container` drag, `.dv-tab` no-drag) so tab chip hover and the close button stay reliable, and the empty void container drags the window again in single-group mode.
- **MCP transport for Codex switched from HTTP loopback to a per-spawn stdio bridge.** The on-disk `~/.codex/config.toml` writer and the ~233 LOC HTTP server are replaced by inline `mcp_servers` config injected into `thread/start`; the bridge child connects back to the main process over a unix socket / named pipe (chmod 0600, token-authed). The superone MCP server module also splits into single-responsibility files (`builtins`, `tool-surface`, `json-schema-zod`, `stdio-bridge`, `stdio-ipc`, `stdio-state`, `stdio-env`, `types`). The previously unused `callerCwd` field is removed — worktree isolation lives at `projectDir`.

## [0.30.4-alpha] - 2026-05-11

### Added

- **Mini-app manifests can declare `preferWidth` for initial panel width.** Setting `preferWidth` (360–2000px) makes the activity panel open at that width when there's room beside the sidebar (clamped to fit, skipped if remaining width falls below `MIN_AP`). User resizes are preserved — `preferWidth` only sets the initial width and does not snap back, and re-opening an already-open app keeps the current width. `LAYOUT` constants moved out of `App.tsx` into `lib/layout-constants.ts` so the mini-app store can read `MIN_MAIN`/`MIN_AP` without a circular import.
- **Dev mini-apps can now be uninstalled from the settings detail page.** The uninstall section in `AppDetailPage` is no longer gated on production apps. Uninstalling a dev app only removes its install slot — for user-scope apps `~/.superone/apps/<appId>/`, for project-scope apps `<projectDir>/.superone/apps/<appId>/` (the renderer now plumbs the actual `installDir` through preload + IPC, falling back to user-scope when omitted, so project-scope apps no longer fail with "App not installed"). Only the dev pointer and `data/` directory are removed; your source tree outside the slot is untouched, and a dev-specific description spells out the scope. `uninstallApp` also closes a currently-mounted iframe (`MINIAPP_CLOSE` + remove from `openApps`) before deleting the install dir to avoid a ghost iframe pointing at an empty directory.

### Fixed

- **Mini-app iframe state survives panel↔canvas switches.** Iframes were previously torn down on every migration, blowing away JS state, subscriptions, and registered fs permissions — apps reading project files after a switch hit "no project context" because `allowedDirectories` had been cleared. All open mini-app iframes now live in a persistent host layer at the `App.tsx` root, positioned via fixed-layer absolute coordinates that follow a `MiniAppSlot` placeholder in either panel or canvas. `MINIAPP_OPEN`/`CLOSE` is decoupled from UI placement, with a `_migratingApps` set suppressing Dockview's `onDidRemovePanel` close path during migration. DOM node identity is preserved across panel→canvas→panel cycles.
- **`.s1app` / `.mcpb` install no longer silently loses trailing entries.** Streaming `unzipper.Extract` was dropping the last files on archives with 100+ entries (`close` fires before final writers flush) — a `.s1app` with `manifest.json` near the end would `ENOENT` on install. Switched to random-access `Open.file()` + per-entry `extract()` via a shared `extractZip` helper, plus zip-slip defense via `path.relative` (unzipper's upstream `indexOf` check is vulnerable to prefix confusion).

### Changed

- **Mini-app developer guide topic renamed `standard` → `manifest`.** After mini-apps unified into a single type with a `fullscreen` capability flag, the `standard` topic name lost its semantic distinction. The MCP `read_miniapp_guide` tool now exposes the topic as `manifest`, matching its content (manifest schema reference + panel layout guidance).

## [0.30.3-alpha] - 2026-05-10

### Added

- **ActivityPanel layout now persists per chat session.** Dockview layout + `showPanel` are snapshotted into a per-session map, parked on session switch-out, and restored on switch-in. Same-project new sessions (worktree switch, `/clear`, provider swap) seed from the current dockview; history-session clicks and cross-project switches start empty so they don't inherit unrelated state. Side and width stay app-global.
- **Mini-app web storage is isolated per project via origin partitioning.** The iframe host now encodes the active project's UUID (`superone-app://<appId>.<projectUuid>/`), so Chromium auto-partitions `localStorage`, `IndexedDB`, cookies, and Cache Storage per (app, project). No storage shim or proxy — purely browser-native origin isolation. A new `GET_PROJECT_ID` IPC exposes `projects.id` to the renderer, and `useAppStore.currentProjectId` is set atomically with `currentFolder` to avoid a `NO_PROJECT` origin race during project switches.

### Fixed

- **ActivityPanel visibility now survives project switches.** The `currentFolder` subscriber in `app.ts` was synchronously resetting `showPanel=false` on every project switch *before* the bridge effect parked the snapshot, so switch-back showed an empty panel even though the dockview layout was correct. Removing the reset lets `activity-view-state` own `showPanel` per session end-to-end; park/restore/flushPending also deep-clone layout via `structuredClone` so per-session entries stay isolated from dockview's live state.

### Changed

- **Mini-app type system unified into a `fullscreen?: boolean` capability flag.** The `MiniAppType` enum (`sidebar` / `panel` / `in-chat` / `fullscreen`) is removed in favor of a single `fullscreen?: boolean` capability. All apps default to panel; fullscreen-capable apps move bidirectionally between panel and canvas via `moveAppToCanvas` / `moveAppToPanel` while keeping a single iframe instance. In-chat apps now render through `tools[].renderer.result`. Dockview tab headers also get chip-style tabs (icon→close on hover, animated Maximize button on active fullscreen-capable tabs), and the canvas gains a header with app icon, return-to-panel, and close buttons.

## [0.30.2-alpha] - 2026-05-10

### Added

- **HTML file preview with sandboxed iframe.** `.html` / `.htm` files now show a Preview tab alongside the File tab, mirroring the existing markdown flow. Preview renders through the `local-file://` protocol so relative CSS / JS / image references resolve naturally, and the iframe runs in null origin with `allow-scripts` only — JS executes but cannot access same-origin storage and stays bounded by the existing project-folder path authorization. `LOCAL_FILE_MIME` is also extended with html / css / js / json / wasm / font entries for correct browser parsing.
- **Streaming Edit/Write/FileChange tool headers animate +M/-N counts with rolling digits.** A new anchor-truncated LCS (`computeStreamingEditDelta`) keeps partial line-add/remove counts monotonic and converging to the final diff during streaming, with trailing-newline normalization fixing jsdiff's half-line miscount. The result is cached per (oldStr, committedNew) so per-frame cost stays negligible at typical Edit sizes. `CanvasEditDiff` also switches to a sliding window around greedy progress and routes the cursor to the next pending row when not actively typewriting.

## [0.30.1-alpha] - 2026-05-09

### Added

- **Mobile can pick the per-session API provider remotely.** New `list_providers` and `set_session_api_provider_id` remote-control commands mirror the desktop `/provider` slash popup — mobile can list configured `ApiProvider`s and switch a session's pinned provider over relay or LAN. Both commands reuse the existing desktop logic and broadcast `agent_setting_change` so all peers stay in sync.
- **Default Claude and Codex rows now show official brand marks.** The `default-claude` / `default-codex` preset keys map to Claude / ChatGPT brand entries in the `/provider` popup, providers page, and chat hero hint. The Codex hero icon is rewritten around the official Codex cloud silhouette with layered radial gradients and staggered flow animations, and the "Default" tag is renamed to "Official" (en/zh) to match.

### Fixed

- **TaskCreate/TaskUpdate no longer render redundant cards next to the todo panel.** After the SDK started emitting `TaskCreate` / `TaskUpdate` instead of `TodoWrite`, both flows fed the same todo store but only `TodoWrite` was hidden in `ToolBlock`. The hide list now covers all three, and the trailing `"completed: "` colon is dropped when `TaskUpdate` has no subject.
- **Ctrl+Tab session switcher no longer reshuffles rows mid-flight.** The popup snapshots the session order on open and uses that frozen list for both rendering and commit, so a session whose `lastEventAt` advances while the popup is up can't slide under the highlighted row or cause Ctrl release to land on a different session than the one selected.

### Changed

- **Bundled Codex CLI upgraded to 0.130.0; dependency switched to direct `@openai/codex`.** The desktop drives the Codex Rust binary through its own app-server protocol implementation and never imports the `@openai/codex-sdk` TypeScript surface, so the indirect SDK dependency is replaced with the direct `@openai/codex` package.
- **`claude-agent-sdk` upgraded to 0.2.136.** 0.2.136 deprecates `TodoWrite` in favor of `TaskCreate` / `TaskGet` / `TaskUpdate` / `TaskList`. Display metadata (icon + verb + summary) is added for all four `Task*` tools, and the redundant `task_id` snake_case fallback in `TaskGet` is dropped — chat and remote-control already canonicalize on camelCase `taskId`.

## [0.30.0-alpha] - 2026-05-09

### Added

- **Per-session API provider override via `/provider` slash.** Each session can now pin a third-party `ApiProvider` independent of the global default — type `/provider` in the chat input to pick one. The choice is persisted in the session DB so it survives mini-windows, main-window close+reopen, and process restart. The pinned id snaps in on first send so a later default-provider switch can't silently re-route an in-flight session, and `agent_setting_change` broadcasts keep peer windows in sync. `ModelSelector` and the chat-input hint resolve through a shared `selectEffectiveApiProvider` helper so renderer and main agree without round-tripping.

### Fixed

- **Cmd+W close and dock activate work again with mini windows open.** A File submenu with `{ role: 'close' }` restores macOS Cmd+W on the focused window (main or mini), and `app.on('activate')` now checks `mainWindow` directly so clicking the dock icon recreates the main window even while mini session windows remain open.

## [0.29.3-alpha] - 2026-05-08

### Added

- **Ctrl+Tab session switcher in coding mode.** Hold Ctrl+Tab to cycle through active sessions (streaming, background, unseen, or pending) with a popup showing sidebar-style status icons and pending-reason chips. Release Ctrl to commit, Esc or window blur cancels. The popup waits 200ms before rendering so a quick tap-and-release commits silently without flashing the modal. The just-left session is slotted right after the current one, matching the macOS Cmd+Tab two-app ping-pong feel — one tap lands you back where you came from.

### Fixed

- **"Local changes" now include untracked files.** The dirty-status indicator and the worktree *carry local changes* option both treated untracked files as not-local, so newly created files surprised users by appearing absent. `GIT_INFO` now uses `status --porcelain -uall` and adds untracked line counts via `ls-files --others --exclude-standard` (skipping non-files and binaries via NUL-byte sniff); the worktree carry path uses `git stash create -u` so newly created files follow into the new worktree.
- **Additional-dirs hint no longer shifts the chat input around, and reappears after editing directories.** The hint is now an absolute popover above ChatInput instead of a sibling, so its mount/unmount doesn't push the input on project or agent switch. A per-session `additionalDirsDirty` flag also re-surfaces the hint in existing sessions after add/remove dir, then auto-clears on the next send.

## [0.29.2-alpha] - 2026-05-08

### Added

- **Explicit "Init Git" button replaces silent auto-init.** Adding a folder no longer secretly runs `git init` on it. Non-git projects now show a fixed "local" indicator plus a new "Init Git" button in the chat status bar; clicking it initializes the repo via a new `GIT_INIT` IPC and the status bar refreshes into its normal git UI.

### Fixed

- **Windows sidebar toggle no longer disappears into the sidebar header.** The dockview refactor had silently undone the macOS-only guard from a prior fix, so on Windows the toggle icon sat alone in the 44px header row that exists purely to clear macOS traffic lights. The sidebar-header toggle is now `isMac`-guarded again, and the main-area header always shows it on Windows regardless of sidebar state. macOS rendering is byte-for-byte unchanged.
- **Codex no longer flashes a console window on Windows.** The bundled-package spawn branch for `@openai/codex` was missing `windowsHide`, briefly opening a black console window when launching Codex. Both spawn paths now set `windowsHide: true` so Windows tags the children with `CREATE_NO_WINDOW` and skips the visible console.

## [0.29.1-alpha] - 2026-05-07

### Added

- **Mobile leaves chat cleanly when the desktop quits.** Quitting SuperOne now broadcasts a new `desktop_shutdown` frame over both relay and LAN before tearing down sockets. Mobile clients disconnect, pop back to the device list, and show a "Desktop has quit." snackbar — replacing the silent exponential-backoff reconnect loop that previously fired on every desktop quit. The relay durable object also resets its event buffer and ACK sequence state on this signal, so the next desktop boot starts a fresh session instead of trying to replay stale events.
- **Sidebar session spinner ages with the session.** The running-session spinner in the sidebar now mirrors the chat footer's stall indicator, fading from neutral → amber after 60s of no activity → red after 120s. Each session's `lastEventAt` is recorded on the backend `Session` and surfaced through `SessionSnapshot`, so a stalled session is visually obvious without opening its chat.

### Fixed

- **Coding panel no longer crashes when previewing binary or large files.** Previewing a `.tgz` (or any binary outside the image/pdf/video/audio allowlist) used to ship a multi-MB UTF-8-decoded string through IPC and OOM the renderer. The preview handler now sniffs for NUL bytes in the first 8 KB and short-circuits files larger than 5 MB; a placeholder card replaces the diff view in those cases. (Renamed `app:git-read-file` → `app:read-project-file` along the way — the handler never touched git, just read the working tree.)
- **Chat content no longer clips horizontally when the chat panel shrinks.** Long non-breaking elements (code blocks, URLs) were cut off because Radix `ScrollArea` wraps children in `display: table; min-width: 100%`, which sizes to children's max-content and refuses to shrink. The wrapper is now forced to block layout so it tracks the viewport width.
- **Resolving a prompt in the mini-window now updates the main window too.** The IPC handlers for permission, question, dismiss-question and plan-approval responses used to mutate only the calling renderer's store, leaving the other window's pending state stale. They now broadcast `interaction_resolved` to every `BrowserWindow` via `safeSend`, matching the mobile path.

## [0.29.0-alpha] - 2026-05-07

### Added

- **Mini-window: pop a session out into its own floating window.** Right-click a session in the sidebar → *Open in Mini Window* spawns a lightweight, optionally always-on-top BrowserWindow that runs the same chat content in real-time sync with the main window. Title pin/unpin lives in the window header. Built on a new multi-window broadcast layer (`safeSend` fans out to every BrowserWindow; harness-agnostic session resume; a generic `SessionSettingsPatch` channel that replaces per-setting IPC) — so future detached-chat or secondary-renderer features inherit the same plumbing.
- **Selection context menu in the coding markdown editor and preview**, matching the rest of the file-preview surfaces.
- **File tree distinguishes staged vs unstaged.** Git status splits into separate index (X) and worktree (Y) columns: staged files render in a saturated VS Code-style palette (amber/emerald/rose/cyan/orange), unstaged-only files dim to opacity-60, and partially-staged files (`MM`, `AM`) italicize so the divergence is visible at a glance. Untracked stays fully saturated. Per-depth indent halved from 16px to 8px so deep trees stay readable in the narrow sidebar.
- **Per-app SQLite database API for mini-apps.** Bridges the host's `better-sqlite3` to mini-apps via the existing fs/git IPC pattern so DB files live at `<install-slot>/data` under host ownership — backup/uninstall stay directory operations and AI agents can read mini-app state directly. Surface is intentionally minimal (`query` / `exec` / `batch` / `pragma`) with SQL-keyword + PRAGMA whitelisting and `trusted_schema=OFF`. The mini-app db guide gained concrete decision criteria (local vs remote), gotcha-aware type mapping (boolean/Date are not native), constraint-error recipes, indexing + `EXPLAIN QUERY PLAN`, persistence semantics across upgrades, and recipes for cursor pagination, FTS5, parent/child cascade, and state reset.

### Fixed

- **Phantom empty assistant message after a backend-initiated new turn.** `iterateMessages` was leaking `resultSeen` / `turnUserEchoSeen` across turns, so when the backend opened a fresh turn the queued-turn branch fired again and emitted a stray `message_start`. Turn-boundary state now resets, so no more empty bubble with a running-indicator footer above the real reply.
- **`message_start` reducers no longer clobber an existing message.** A duplicate `message_start` (e.g. a Codex backend reusing an externally supplied `assistantMessageId`) used to merge a stub `content=[]` over the accumulated message. It's now a pure create-if-missing upsert in both the main-runtime upsert path and the renderer reducer.
- **Brand-hue changes weren't reaching mini windows.** The main process now broadcasts `APP_SETTINGS_CHANGED` after every save (mirroring the dark-mode sync pattern); each window mirrors brand slices into its store so `useHarnessTheme` reacts live across all windows.

### Changed

- **Permission-mode cycle reordered to `default → plan → auto → acceptEdits`** so the most common steps come first.
- **Coding layout toggle icons** swapped to `PanelLeftOpen` / `PanelRightOpen` so the affordance reads as "push the chat toward this side" rather than a static panel silhouette.
- **Sidebar session menu**: *Open in Mini Window* moved below *Hide* as its own divider-separated group and uses the `PictureInPicture2` icon — the action spawns a floating window, not a navigation.

### CI

- **`build-{mac,win,linux}.yml` artifact retention shortened from 30 days to 1 day.** Stale `dist-*` artifacts from validation builds or unfinished promotes were accumulating fast enough to exhaust the GitHub Actions storage quota. `promote.yml` already deletes the three artifacts it consumes; the 1-day retention is a safety net for orphaned builds that never reached promote.

## [0.28.3-alpha] - 2026-05-07

### Fixed
- Black screen on startup (`require_react is not a function`) introduced by the
  monorepo conversion. Rollup's default chunk splitting assigned React's CJS
  wrapper to a chunk that had a mutual static import with the main app bundle,
  causing the wrapper to be called before it was assigned. Added `manualChunks`
  to the renderer Vite config to pin React, ReactDOM, and scheduler to a
  dedicated `react-vendor` chunk with no app-code dependencies, making the
  cycle structurally impossible regardless of how source modules are organized.

## [0.28.2-alpha] - 2026-05-06

### Fixed

- **Renderer no longer black-screens after the v0.28.1-alpha update.** The activity-panel store was reached via both a static import (from `App.tsx` and others) and a dynamic `import('./activity-panel')`, so Rollup carved it into its own chunk despite the `INEFFECTIVE_DYNAMIC_IMPORT` warning. The resulting cycle (main bundle ↔ activity-panel chunk) ran the chunk's top-level `create()(persist(...))` before zustand's `create` was assigned in the main bundle, leaving the binding undefined and crashing the renderer at startup. Both stores (`activity-panel`, `source-control`) are now statically imported, the chunk split point is gone, and the cycle is broken.
- **App menu and userData path restored.** After the monorepo conversion, `app.getName()` was inheriting `@superone/desktop` from the workspace-scoped package name, so the menu showed `About @superone/desktop` and userData drifted to `~/Library/Application Support/@superone/desktop/`. The runtime name is pinned to `SuperOne` and userData is locked to `~/Library/Application Support/super-one/`, so existing data is found in place.
- **Main process no longer dies on EPIPE during shutdown.** stdout/stderr writes that race the parent close are now swallowed.

### CI

- **promote.yml**: bypass `aws-actions/configure-aws-credentials` for the R2 sync step. The action's default credential validation hits AWS STS (`sts.auto.amazonaws.com`), which doesn't exist on Cloudflare R2; injecting `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_DEFAULT_REGION` directly avoids the NXDOMAIN failure.

## [0.28.1-alpha] - 2026-05-06

### Changed

- **Auto-update switched to Cloudflare R2** (`https://dl.super-one.dev`). Replaces the previous private GitHub Releases path; clients no longer carry an embedded `UPDATER_TOKEN`. Per-version binaries live under `v${VERSION}/`; channel pointer files (`alpha-mac.yml` / `beta-mac.yml` / `latest-mac.yml`) at bucket root. Existing alpha clients keep receiving updates via the legacy GitHub Releases path until they auto-upgrade once to this build, after which they follow R2 — no manual reinstall required.
- **Update channel preference scaffold**: app settings now persist `updateChannel` (`alpha` | `beta` | `stable` | `null` to follow build) and apply it to `autoUpdater.channel` at startup and on save. UI not yet exposed; set via devtools (`window.app.appSettings.save({ updateChannel: 'beta' })`) or by editing `app-settings.json`. Downgrade protection comes free from electron-updater's default `allowDowngrade=false` — switching to a more stable channel won't install an older version, you stay put until that channel catches up.

### Fixed

- **Sidebar: missing project folder can now be removed**. When a project folder's path no longer exists on disk, the right-click menu no longer disables itself — it now exposes just the Remove Project entry, giving you an exit path instead of a stuck row.

### CI

- **Monorepo conversion**: repo restructured to bun workspaces (`apps/desktop` + `apps/web` + `apps/relay` + `packages/{ui,shared,tsconfig}`). Cross-package imports use workspace package names. `apps/relay` is mirrored to a public `super-one-relay-public` repo via `git subtree` for self-hosters.
- **promote.yml dual-publishes**: GitHub Release (flat) for legacy clients + R2 (`v${VERSION}/` subdirectory) for current clients. Auto-derives `--prerelease` from the semver tag.
- **Workflows**: dropped `UPDATER_TOKEN` env from build steps; broadened upload-artifact yml glob to include channel-prefixed files (was hard-coded to `latest-*.yml`); set `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` on all workflows to silence Node 20 deprecation warnings.

## [0.28.0-alpha] - 2026-05-06

### Added

- **Canvas chat panel redesign**: collapsed state is now a 48px robot icon with three states (idle / running-breathing / task-done-check) and width-expansion when a permission or question is pending. The floating panel gains 4 edge-midpoint snap points alongside the 4 corners — midpoints expose three resize handles and re-center smoothly after release. Drag, resize, anchor switch and window-resize now share one motion-driven coordinate system.
- **Remote status at a glance**: the sidebar's Smartphone tooltip and the Remote settings page both show host name plus separate Relay (cloud) / LAN (wifi) reachability indicators, sourced from a single shared `useRemoteStatus` hook.

### Fixed

- **Mobile plan-approval outcome was dropped on the desktop**: when a mobile peer approved or rejected a plan, the desktop only cleared the prompt without recording the result. The `interaction_resolved` event now carries `approved` + `feedback` and the renderer stamps `planApprovalOutcome` on the remote session, matching the local-approval path.
- **Mobile missed the start of thinking blocks**: when a new thinking content block begins, an empty `content_delta` is now emitted upfront so the mobile renderer creates the block immediately instead of waiting for the first non-empty chunk.
- **mDNS goodbye lost on quit / OS signal**: `performQuit` now bounds remote-control shutdown at 1.5s and runs it in parallel with agent dispose; SIGTERM/SIGINT/SIGHUP each trigger the same shutdown so the LAN advertiser sends its TTL=0 goodbye records before the process exits.

### Changed

- **LAN advertiser stack**: replaced `bonjour-service` with `multicast-dns` (Linux/Windows) and `/usr/bin/dns-sd` (macOS — defers to the system mDNSResponder, avoiding a duplicate Bonjour stack on loopback). Advertiser `publish` / `unpublish` are now async and idempotent.

## [0.27.4-alpha] - 2026-05-05

### Added

- **End-to-end encryption for relay file transfers**: files uploaded through the relay R2 bucket are now wrapped in a chunked AES-GCM envelope (4MB chunks, AAD bound to `channelKey:r2Key:chunkIndex`). R2 never sees plaintext — desktop seals on upload, mobile decrypts on download. LAN transport is unchanged.
- **Drag files from the sidebar into other apps and mini-apps**: file-tree drag now uses Electron's native `webContents.startDrag()`, so dragged items flow through the OS as real `Files`. You can drop them into Finder, VS Code, sandboxed mini-app iframes, etc. Internal drops (within the tree, into the @-mention chat input, into the activity dock) still work as before.
- **Right-click selected code in file preview to quote into chat**: selection in the File/Changes tabs adds a file chip (icon + basename + line range) to the chat input. The popover renders via the same diff view as FilePreview, preserving syntax highlighting and red/green diff backgrounds; mixed selections produce a unified-diff body.

### Fixed

- **Codex tool labels squeezed when summary overflows**: header label spans in `CodexCommandBlock`, `CollabSendInputBlock`, and `CodexPlanBlock` now use `shrink-0 whitespace-nowrap`, so CJK labels like "执行中…" stay intact instead of being squeezed character-by-character when a long bash command fills the sibling span.

## [0.27.3-alpha] - 2026-05-05

### Added

- **Tool-group viewing**: collapsed-by-default tool-call groups now cap at 120px with scroll and auto-scroll to the newest tool call as it streams. The group auto-collapses once the segment is sealed (next segment isn't a collapsible tool — text reply, reasoning, non-collapsible tool, or message round done).
- **Unified Add Server panel**: replaced the separate "Add server" form and ".mcpb install" dialog with a single tabbed panel (default: Bundle). `.mcpb` preview now renders inline in the drop zone — no extra dialog. Scope toggle and Cancel/Install share one row across tabs. Install success shows a toast instead of an in-page banner.
- **Bundle icons**: `.mcpb` server icons (e.g. Blender) now render in the MCP list and detail page using the bundle's manifest icon.

### Fixed

- **`.mcpb` `uv` bundles failed to spawn**: `uv run <script>` ran in the harness's working directory and couldn't find the bundle's `pyproject.toml`, surfacing as `Failed to spawn: blender-mcp` (ENOENT). The installer now prepends `--directory <installDir>` to `uv` args so the bundled script entry point resolves regardless of harness cwd.
- **`/compact` slash command**: when triggered via slash command, the user's `/compact` message could be left in history alongside the compact summary; the boundary handler now drops the pending compact user message during both `slash_command_output` and `compact_boundary` events.

### Changed

- **Bundle uninstall vs library deletion**: uninstalling a `.mcpb` server no longer deletes its library entry. Users can re-install later without re-adding the entry; library deletion is now an explicit, separate action.

## [0.27.2-alpha] - 2026-05-05

### Added

- **MCP server bundles (`.mcpb`)**: drag-and-drop or pick a `.mcpb` file in MCP settings to install a bundled MCP server. Bundles are previewed before install, listed alongside manually configured servers with a version badge, and have a dedicated uninstall path that cleans up the extracted bundle directory.

### Fixed

- **Copy buttons in chat**: code-block, insight-block, and user / assistant message copy buttons now actually write to the clipboard. The mini-app media-permissions handler added in 0.27.0 was rejecting every non-media permission including `clipboard-sanitized-write`, so copies silently failed — the ✓ icon flashed but the clipboard stayed empty. The handler now only enforces strict checks against mini-app origins; the main renderer keeps Electron defaults. Copy paths with visible feedback also now `await` the write so any future regression won't fake a success.

## [0.27.1-alpha] - 2026-05-05

### Fixed

- **Usage stats**: Claude token counts no longer balloon as a session grows. The SDK reports cumulative usage per turn; the old code summed each turn's cumulative value, inflating totals quadratically. Now writes only the per-step delta.
- **Usage stats**: Sessions / messages counts no longer collapse when sessions are deleted. Counts are now recorded as events into a new `activity_daily` table at the moment a session/message is first saved, independent of whether the chat history is later removed.

### Changed

- **Usage stats backfill bumped to v2**: on next launch, `usage_daily` is cleared and recomputed from chat history (Claude as per-session per-model cumulative max, Codex as sum-of-step), and the new `activity_daily` table is filled from existing sessions and messages. Numbers in Settings → Usage will adjust on first open after this update.

## [0.27.0-alpha] - 2026-05-05

### Added

- **Mini-app microphone & camera permissions** — mini-apps can declare `permissions.media: [microphone | camera]` in the manifest and use standard `navigator.mediaDevices.getUserMedia`. Grants are gated by the manifest, dynamically applied to iframe sandbox/allow attrs, and surfaced in the install dialog, settings detail page, and a host-rendered recording indicator that clears deterministically when tracks end.
- **Per-day token usage stats** — new Settings → Usage tab shows token usage with Today / 7d / 30d / 90d / All presets and harness filter. Charts switch by preset (horizontal bars, grouped/stacked bars, stacked area, GitHub-style heatmap). Includes summary cards (Total Tokens / Sessions / Messages) and a by-model breakdown. First launch backfills from existing chat history.
- **Claude hooks settings UI** — new settings page for editing `settings.json#hooks` across user / project / local scopes. Supports all 5 SDK hook types (command, prompt, agent, http, mcp_tool) with type-specific fields and a shared advanced section. Writes take effect on the next session start. Codex tab is hidden since Codex has no hook system.
- **Shared Textarea primitive** — new component matching the Input visual language; consolidates ad-hoc `<textarea>` elements across dialogs.

### Fixed

- **Language switch toast now appears in the new locale** — the toast captured `t` via `useTranslation`, which bound it to the pre-switch language, so the success toast appeared in the previous language.
- **Removed double focus ring on project selector dropdown** — the global `:focus-visible` 3px ring overlapped with the accent highlight; only the bg-accent remains.

### Changed

- **Quieter input focus ring** — Input and Textarea focus-visible rings drop from 3px (with border tint) to a subtle 1px ring, matching older hand-rolled inputs. Less visual noise in form-dense dialogs.
- **Bumped `@anthropic-ai/claude-agent-sdk` to 0.2.126.**

### Tests

- Storybook coverage expanded: stories for all chat tool-call UIs, regrouped by harness ownership (Claude vs Codex vs shared), plus CopyableMarkdown stories for chat markdown rendering.

## [0.26.0-alpha] - 2026-05-04

### Added

- **Multi-color subagent indicators** — each Task subagent picks a color from a per-session 8-color pool (purple/blue/cyan/teal/green/amber/orange/rose) so concurrent subagents stay visually distinct. `SubagentBlock` dyes its bot icon, type tag, activity strip, and scroll-area border accordingly; the pool recycles once exhausted.
- **Codex generated images visible on mobile** — desktop converts Codex `image_generation` thread items into `codex_image_generation` content blocks and serves the underlying file to mobile via either an HMAC-signed LAN URL (60s TTL) or a relay R2 upload, depending on transport. New `read_desktop_file` remote command enforces auth + size limits.
- **Codex permission preset descriptions** — `CodexPermissionSelector` and `AutomationDialog` now show what each preset actually does (sandboxed run vs full machine access) via the existing `defaultDesc` / `fullAccessDesc` i18n keys.

### Fixed

- **Subagent color no longer reverts to purple after task completes** — completed subagents had their color released back to the pool, making the selector fall back to the default purple. Colors now persist for the lifetime of the session and apply to history-loaded tasks too.
- **Mobile no longer drops LAN-delivered remote events** — LAN frames now carry the same monotonically increasing `seq` field as relay frames, so mobile's seq filter no longer silently discards everything coming through LAN transport.
- **Mobile-driven Codex sessions correctly identified** — `remote_session_start` now propagates `harnessId`, so the renderer tags codex sessions instead of falling back to the default Claude harness.

### Tests

- Added LAN frame seq monotonicity / reset-on-stop tests, presence-coordinator `harnessId` propagation tests, chat-store `sessionProvider` derivation tests, and a Playwright e2e launch smoke test.

## [0.25.1-alpha] - 2026-05-03

### Fixed

- LAN device discovery no longer spawns the `dns-sd` CLI; uses an in-process bonjour client instead, improving reliability of mDNS advertisement and discovery on macOS.

### Changed

- Removed focus-visible ring on chat input fields and textareas for a cleaner appearance.

## [0.25.0-alpha] - 2026-05-03

### Added

- **Codex generated images render with fullscreen preview and download** — Codex `imageGeneration` thread items now render as a thumbnail; clicking opens a Dialog with pan/zoom, a download button, and prompt + dimension info. Two new IPC channels (`read-file-as-data-uri`, `save-file-as`) load and export the saved file. Path-security checks were also expanded to allow reading from `~/.cache/codex-runtimes/` so Codex bundle artifacts load correctly.
- **Codex computer-use approvals via MCP Elicitation** — Codex's macOS computer-use feature uses `mcpServer/elicitation/request` to ask "Allow Codex to use Google Chrome?"-style permissions. The previous code did not recognize this method, and the fallback empty response was interpreted by Codex as an implicit decline — every computer-use tool call failed silently. Requests are now wired through `PermissionPrompt` with risk icon, subtitle, Allow / Always allow / Decline / Cancel, and a minimal JSON Schema form renderer for string / number / boolean / enum fields. Responses serialize as `{ action, content, _meta }` with `_meta.persist: 'always'` for always-allow.
- **Keyboard shortcuts for image preview** — `=` / `+` zoom in, `-` / `_` zoom out, `0` reset, arrow keys pan. New `usePreventFocusSteal` hook stops pointer-induced focus retention on toolbar buttons so the focus ring no longer lingers after keyboard interaction.
- **One-click sync for legacy providers** — when a stored provider config has drifted from its preset (missing fields, stale model ids, etc.), `ProviderDialog` and the `ProvidersPage` row both surface a sync icon. Opening `PresetSyncDialog` shows per-field added/changed lists with checkboxes — added entries default ON, changed entries default OFF (you opt in to override your own values). `base_url` and changed fields are only touched when explicitly checked. DeepSeek preset bumped to V4 Pro / V4 Pro 1M / V4 Flash with subagent slot.

### Changed

- **Oversized image attachments downscale to 2000px max side** — images whose long side exceeds Claude's 2000px limit are now resized before being base64-encoded. PDFs keep the existing FileReader path; decode/encode failures fall back to the original file so attachments never disappear.
- **Window minWidth adapts to visible panels** — sidebar and activity panel each have their own min width; the previous hardcoded 1080 was the all-three-open sum, leaving the window stuck at that floor even when panels were collapsed. The renderer now computes the floor from current panel visibility, pushes it to main via IPC, and grows the window (clamped to display work area) when the new floor exceeds the current size.
- **Unified focus-visible ring on non-shadcn elements** — a single `:focus-visible` rule in `@layer base` produces a 3px ring at 50% `--ring` opacity. Tailwind utility specificity keeps shadcn's per-component focus styles winning, so the rule only paints over the gap (native button, `tabIndex` divs, Tiptap) without disturbing variant or aria-invalid overrides. The Tiptap editor is opted out via `.tiptap:focus-visible` so the chat input no longer gets a 3px brand ring as soon as you start typing.
- **Throwaway SDK probes no longer leave stub session files** — `CONNECT_CLAUDE`, `fetchModels`, and `PROVIDERS_TEST` spawn one-shot SDK queries solely for metadata or connectivity tests; they now pass `persistSession: false` so they no longer leave un-resumable jsonl stubs in `~/.claude/projects/`.

### Fixed

- **Provider connection-test env isolation and timeout** — the test SDK call now uses a 17-key system-env allowlist (PATH / HOME / TMPDIR / Windows essentials) instead of `{...process.env, ...env}`, so shell-leaked `ANTHROPIC_*` / `OPENAI_*` / `CLAUDE_*` no longer bleed into the test. The SDK query loop is wrapped in a `Promise.race` with a 15s timeout (raised from the initial 8s after some legitimately slow first-token responses), and the subprocess is always closed in `finally` so api_retry storms (e.g. provider 401/429) no longer hang the UI for 40+ seconds.

## [0.24.2-alpha] - 2026-05-02

### Changed

- **`/clear` now resets the session locally instead of forwarding to Claude** — typing `/clear` (or selecting it from the slash popup) starts a fresh session in the same panel, matching the "New Session" button. Previously the command was sent to the Claude SDK with no local effect. Strict match only — `/clear something` still goes to the SDK as before. Implemented as an extensible interception table, so future SDK commands (e.g. `/compact`) can be redirected to local actions with a one-line registration.
- **Mini-app dev workspace can now live anywhere** — `setup_mini_app_dev` takes a user-picked `directory` and a `scope` of `project` or `user` (replacing the old standalone mode); SuperOne's install slot under `~/.superone/apps/<id>/` keeps its source location via a new `.s1-dev.json` pointer. `.s1app` upgrades preserve `.s1-dev.json` and the app's `data/` folder so user storage survives dev rebuilds, and only the freshly-scaffolded app opens after setup (no more re-opening every existing dev app).

### Fixed

- **mDNS advertiser no longer outlives desktop quit** — `dns-sd` subprocess is now killed via two layers so mobile reliably sees the desktop go offline: `performQuit()` calls `remoteControlService.stop()` for the Cmd+Q path, and `lan-advertiser` registers process-level `exit`/`SIGINT`/`SIGTERM` hooks for the `bun run dev` Ctrl+C path and crashes where `before-quit` never fires. Previously an orphaned `dns-sd` child would keep broadcasting and pin the device as `onlineLan` on mobile.

## [0.24.1-alpha] - 2026-05-01

### Added

- **Mobile `/add-dir` parity** — full `additionalDirectories` management is now exposed to mobile via new RemoteCommands (`list_directory_for_add_dir`, `validate_add_dir`, `add/remove_project_additional_dir`, `set_session_additional_dirs`); `create_session` also carries `additionalDirectories` from the start. An `additional_dirs_changed` agent event broadcasts every change so renderer + all mobile peers stay in sync. The add-dir popup overview is reorganized into USER (conditional) / PROJECT / SESSION groups with folder chip ↔ path layout, and `BackendCommand` gains `claude.set_additional_dirs` so `Session` handles dir replacement + idle-rebuild uniformly.
- **Chat input focus auto-restored after prompts** — when a permission request, plan approval, or AskUserQuestion appears mid-typing, the prompt steals or absorbs key events and previously left ChatInput unfocused after dismissal. A new per-session `chatInputRestoreFocusNonce` (distinct from the existing focus nonce that jumps cursor to end) restores the editor's saved ProseMirror selection so the cursor returns exactly where typing was interrupted. Multi-prompt sequences only restore once at the end.

### Changed

- **`get_system_info` split into connection-only + `get_project_resources`** — skills, agents, and project slash-commands moved out of `get_system_info` into the new `get_project_resources`, which also returns `additionalDirsScoped` + `cwd` + `homedir` so mobile can render dir hints and shortened paths before `init_ready` arrives. `get_system_info` is now strictly connection metadata, giving mobile a clean separation between cheap connect-time fetch and per-project resource fetch.

### Fixed

- **Skills `argumentHint` reaches mobile** — `listSkills` (used by remote `system_info` / `project_resources`) only parsed `name` + `description` from frontmatter, so every skill row on mobile rendered with an empty argument hint even though the desktop sidebar showed it. `parseFrontmatter` now reads `arguments`/`argument-hint` and propagates `argumentHint` into `SkillInfo`, matching `scanSkillDir`.
- **`@` mention popup auto-hides on zero results** — popup previously stayed open until you typed a space, even if no matches existed for the query. It now closes the moment a search returns zero results and reappears on backspace as soon as the query matches again.

## [0.24.0-alpha] - 2026-05-01

### Added

- **`/add-dir` slash command with inline path completion** — typing `/add-dir [project|session] [path]` in chat input now opens an in-input popup that walks you through scope picker → path picker, supporting relative, absolute, and `~` paths. Candidates are validated server-side (rejects not-found, not-directory, same-as-project, and same-repo worktrees) with a sonner toast on rejection, replacing the modal-only `DirManagerPanel` trigger.
- **Additional directories follow Claude CLI scope conventions** — `additionalDirectories` is now read from all three Claude scopes (`~/.claude/settings.json`, `.claude/settings.json`, `.claude/settings.local.json`) at both top-level and `permissions.*` paths, then merged for the SDK option. Writes converge to `permissions.additionalDirectories` in `.claude/settings.local.json` to match Claude CLI's default `add-dir` target. New session screen also shows a hint row above the chat input listing every scoped dir as a basename chip with tooltip.
- **Codex chat slash menu shows user prompts + project skills** — `/` menu in Codex sessions now merges hardcoded utility commands with `~/.codex/prompts/*.md` (top-level only, per official docs) and per-project skills returned by `codexListSkills(cwd)`. Cached in a new `_codexSkills` map, refreshed on `switchProject` and `setPreferredProvider('codex')`.
- **Mobile slash menu also receives Codex user prompts** — desktop's `get_system_info` Codex branch now appends cached `CodexResources.prompts` to the slash-command list it sends mobile, so the iOS/Android slash menu lists the same `~/.codex/prompts/*.md` entries the desktop sees. No mobile-side change needed (existing payload field already accepted).

### Changed

- **Per-harness resource architecture with lazy init** — global resource cache is split into per-harness `ClaudeResources` / `CodexResources` types, backed by a new SQLite table `harness_resource_cache` (replacing the flat `global_resource_cache`, with migration). A new `initializeHarness(harness)` action runs once per app session via a `harnessHandlers` dispatch table and is triggered on `continueToMain` (Claude) or `setPreferredProvider` (Codex). New `CONNECT_CODEX` IPC mirrors `CONNECT_CLAUDE`. Renderer reads now go through selector helpers (`selectClaudeModels` / `selectCodexModels` / ...) instead of direct field access. Fixes a Codex per-session model-sync regression along the way.

### Fixed

- **Denied / errored tool blocks hover with status color, not gray** — hover state was unconditionally applying `bg-muted/70`, washing out the red/amber tint on denied or errored tool rows. Hover class is now bound to status (`red-500/20` for denied, `amber-500/20` for errored), matching the badge swatches already shown in the same row.
- **Insight blocks render even with heading-wrapped header or inline footer** — the `★ Title ───` parser is now tolerant of an optional markdown heading prefix (`## ★ Title ───`) and of footers fused with the final content line (`Last line ─────`). Both forms are common in real model output and were previously falling through as plain text. Fix applied identically to the main-process splitter and the renderer markdown splitter.

## [0.23.2-alpha] - 2026-04-30

### Added

- **Per-skill toggle to hide skills from Claude** — each skill row gains a switch that lets you disable specific skills from running Claude sessions without uninstalling them. State persists in `agentPreference.claude.disabledSkills` and is applied via Claude Agent SDK 0.2.122's `skills` option. Plugin-provided skills can also be toggled (deletion remains gated by plugin uninstall).
- **AskUserQuestion descriptions render inline** — option descriptions now appear in a fixed insight-style band below the "Other" input the moment you select an option, replacing the unreliable native `title` tooltip. Light-mode accents follow the per-harness brand hue; dark mode keeps the original blue via `dark:` variants.
- **Plan approval offers Auto Mode when supported** — the post-approval permission target swaps from "Switch to Accept Edits" to "Switch to Auto" when the active account + model are eligible for Auto Mode, with the approve button restyled (amber + Zap icon) to match.

### Changed

- **Unified Codex + Claude session-control IPC** — interrupt, reset, permission-response, answer-question, and dismiss-question now route through a single `agent:*` channel keyed by `sessionId`, dropping the parallel `codex:*` plane. `Session.interrupt()` returns boolean and runs an injected `onBeforeInterrupt` hook, so widget-gate + mini-app pending-call cleanup happens once inside the Session abstraction instead of being duplicated at the IPC layer for Claude only.
- **Mobile remote protocol splits `create_session` from `send_message`** — mobile clients now generate the session id and call `create_session` first (which owns worktree path/branch, gitBranch checkout, and session registration), then `send_message` carries only content to that existing session. Removes the previous `switch_worktree` RPC since worktree selection is now part of `create_session`. Adds `clearPendingWorktree` to drop incomplete pending state when the worktree popover is dismissed without naming a branch.
- **Codex SDK 0.124.0 → 0.125.0** — `codex-plugins-service` adapted to handle remote marketplace plugins that have no local `sourcePath` (only installed plugins read manifest/files from disk). Vitest `localStorage` stub hardened so 0.125's import-time `setItem` probe doesn't crash on bare `globalThis` stubs.
- **Dockview theme driven by design tokens** — dockview CSS variables now read SuperOne theme tokens directly, so harness brand hue and per-token LCH overrides flow into panel chrome.
- **Detached worktree chip drops `@` prefix** — desktop trigger label and mobile chip now render as `Worktree {hash}` instead of `Worktree @{hash}`. The leading commit icon already conveys the detached semantics.

## [0.23.1-alpha] - 2026-04-28

### Fixed

- **`border-{token}` utilities now apply token colors** — the global `* { border-color }` fallback was unlayered, so Tailwind utilities like `border-insight-border`, `border-sidebar-border`, `border-primary` were silently overridden into the default border gray (most visibly: chat insight blocks rendered with a gray left bar instead of purple). Wrapping the fallback in `@layer base` lets each utility's own color win. The New Session button is pinned to `--border` in dark mode to preserve its previous look.
- **Mini-apps follow live theme changes** — the iframe bridge previously only re-sent theme vars on dark/light toggle, so brand hue tweaks, per-token LCH overrides, and harness switches were not reflected in running mini-apps. The bridge now observes inline-style mutations on `<html>` and pushes a fresh theme snapshot whenever host CSS variables change.

## [0.23.0-alpha] - 2026-04-28

### Added

- **Three-mode worktree flow with semantic indicator** — `WorkDirIndicator` popover redesigned into Local / Existing worktrees / Create new from sections, with a segmented New branch / Attach / Detach control inside the pending panel. New branch mode requires a name with inline duplicate-branch detection (offers a "Switch to Attach" affordance); Attach hides itself when the base is already checked out elsewhere. Worktree directories now name as `~/.worktrees/<repo>/<base36-epoch>-<short-hash>` for chronological ordering. Indicator label is semantic with inline icons via `<Trans>`, so language reordering keeps icons in the right slot. New IPC: `GIT_SWITCH_WORKTREE` (one-click switch to existing), `GIT_CHECKED_OUT_BRANCHES` (attach availability check). "Carry local changes" is hidden when the main repo is clean.
- **Per-harness brand hue picker in light mode** — palette popover in the sidebar lets you shift the whole app's color temperature by hue. Each harness (Claude / Codex) persists its own hue in `app-settings.json`; dark mode is unaffected.
- **Per-token LCH override with advanced editor** — extend brand theming from a single hue to layered LCH+alpha overrides per design token. Basic mode keeps the hue slider; Advanced mode swaps in a 2D L×C area, hue strip, alpha strip, and L/C/H/A inputs. Default brand hue unified to 240° for both Claude and Codex harnesses. CSS tokens migrated to `var()` fallback chains so changes ripple via single `--brand-hue` or per-channel vars without JS-side `setProperty` fan-out.

### Fixed

- **Light-mode contrast for chat, sidebar, and diff surfaces** — Tailwind `text-X-400` shades are tuned for dark backgrounds and turn illegible on the warm cream palette. Migrated to the dark-aware pair `text-X-600 dark:text-X-400` across chat blocks, sidebar status icons, git status colors, drop-zone borders, diff markers, and the file dirty indicator. Also replaced hardcoded `text-white` / `border-white/N` / `bg-white/N` in chat message chips with semantic foreground tokens so they invert correctly on theme switch.
- **Worktree indicator locks to read-only on hydrated or active sessions** — the indicator now refuses to mutate the working directory once a session has loaded messages or the SDK session is up, preventing mid-stream cwd drift. The "is old session" heuristic also switched to messages count + SDK session, fixing edge cases where the lock fired or relaxed at the wrong moment.

### Changed

- **Worktree operations centralized into a dedicated module** — `src/main/git/worktree-ops.ts` is now the single home for worktree create/attach/detach/switch logic, replacing scattered call sites in `agent-service.ts` and `index.ts`. The remote protocol (`agent-types.ts`) gains the corresponding worktree commands so mobile clients can drive the same flows.
- **Pinned session row simplified to two-line text layout** — sidebar's pinned sessions drop the avatar/preview clutter for a cleaner two-line text presentation.

### Performance

- **Codex app-server connection cached for prewarm reuse** — the Codex prewarm path now reuses an existing app-server connection instead of dialing a fresh one each time, cutting cold-start latency on first message.

## [0.22.4-alpha] - 2026-04-27

### Added

- **Right-click selection to quote into prompt** — select any text in chat (markdown, user messages, tool blocks) and right-click to copy or "add to chat". Quoted selections accumulate as a chip in the input bar and are wrapped in `<quote>...</quote>` XML on send. Codex shares the same path via a unified `buildUserMessage`. Mini-app context chips also moved below the user bubble and adapt to dark mode.
- **Pasted-text chip rendering survives reloads** — `ContentBlock.text` gains an `isPaste` flag, so historical messages always render long pastes as `LongTextChip` regardless of length heuristics.
- **Recent folder list keeps a stable order** — sidebar's recent projects no longer reshuffle on every activity update; new entries prepend, existing ones hold position until the user toggles sort mode.
- **Project rows expand sessions incrementally** — initial render shows 5 sessions per project with a "Show more" / "Show less" toggle for the rest (up to 10), plus a shortcut to full history.
- **Mobile-connect toast** — desktop shows a top-center toast only on a mobile device's first connect, not on transport switches (LAN ↔ relay).
- **Diagnostic traces for mobile routing** — `remote.broadcast` and `session.lifecycle` are now recorded in `event-trace.db`, making it possible to query a single timeline of emit → route/drop → reached-transport alongside ownership/subscription churn.

### Fixed

- **Mobile reasoning no longer renders after the answer** — short thinking deltas were getting flushed after text on `message_complete`, displaying reasoning below the visible response on mobile. The broadcaster now flushes the opposing buffer when content type switches, preserving emit-time order.
- **Mobile gets session metadata on cold-subscribe** — `subscribe_session` against a freshly-constructed session was missing the synchronous `init_ready` event (skills, agents, permission mode, etc.) because it fired before subscribers were attached. Cached replay events are now forwarded to the new subscriber.

## [0.22.3-alpha] - 2026-04-26

### Fixed

- **Mobile viewers no longer get kicked when desktop hits Stop or +** — INTERRUPT and the "+" new-session button used to clear `subscribers`, ejecting any phone watching the session. Both now respect that mobile subscription is an independent viewer mode that should outlive a single streaming run; the mobile-subscribed session is parked instead of disposed when the user starts a new session.
- **Multiple mobiles no longer cross-talk** — agent events for session A used to fan out to every connected mobile regardless of which session each had subscribed. Events now route by per-subscriber/owner deviceId so phone B watching session Y never receives session X's stream.
- **Cross-mobile response leak** — when N mobiles shared a desktop, a `list_directory` (or any request) response broadcast to every mobile, exposing one device's command results to another. Desktop now tags responses with `mobileDeviceId` and the relay routes by it.
- **`subscribe_session` no longer hijacks desktop's active session** — when a mobile subscribed to a cold session in a project where desktop had a different active session, the resume path overwrote `activeByProject` and swapped desktop's view out from under the user. The subscription path now resumes passively without touching the active pointer.
- **`session_disconnected` no longer flashes when the user just switches sessions on mobile** — the previous heuristic ("device is elsewhere") fired during normal navigation and showed mobile a misleading "disconnected" state. Replaced with explicit reason-tagged lifecycle events (`self_leave` / `self_switch` / `desktop_kick` / `transport_disconnect` / `session_closed`) so each scenario gets the correct mobile UX.
- **Mobile re-subscribe to a cold session works** — `subscribe_session` was failing with `session_not_found` for sessions saved to DB but not in memory. The handler now resumes them on demand.
- **Desktop is read-only while mobile is subscribed, not just owning** — locking previously triggered only when a remote `owner` existed; mid-streaming of a mobile-viewing session, the desktop's input stayed enabled and would clobber the remote turn. Lock now also fires when `subscribers.size > 0`.
- **Empty subscribers during dispose no longer drops shutdown events** — `Session.dispose()` cleared subscribers before `backend.close()`, so any event the backend emitted during shutdown couldn't reach mobile viewers. Reordered: backend closes first, then subscribers/owner reset.

### Added

- **Persistent mobile claim** — once a mobile takes ownership of a session (by sending a message), the claim survives until that mobile explicitly leaves, unsubscribes, disconnects, or the desktop kicks it. Claim no longer auto-releases at the end of each turn; Codex and Claude paths share this contract.
- **Second-mobile attempts rejected at subscribe time** — previously a second phone could enter the session view and only fail when it tried to send. The subscribe handshake is now request/response so the second phone gets `session_locked` synchronously and never enters the session UI.
- **`subscribe_session` auto-releases the device from any other session** — switching a mobile to a different session no longer leaves its old subscription / ownership lingering.
- **`leave_session` protocol** — explicit mobile→desktop frame for "I'm leaving this specific session" without disconnecting the device, used when mobile navigates out of a session view.

### Changed

- **Session ownership API tightened** — `Session.claim()` is type-narrowed to remote ownership only; `LOCAL_OWNER` is the initial state and `release()` is the only path back. The previous "claim local" bypass that skipped conflict checks is gone.
- **Mobile lifecycle dispatch centralized in `PresenceCoordinator`** — owner_changed / subscriber_added/removed / closed events are mapped to the right mobile-facing frame (`session_kicked` / `session_closed` / `session_locked_by_other_device`) by reason, replacing scattered heuristics in the IPC handler walls.

### Tests

- **Regression coverage**: INTERRUPT does not unsubscribe subscribers; `subscribe_session` resume uses `{ passive: true }` so desktop's active session pointer isn't disturbed; `Session.dispose()` lifecycle events tagged with `reason: 'session_closed'`; multi-session ownership isolation; second-mobile rejection at subscribe time.

## [0.22.2-alpha] - 2026-04-25

### Fixed

- **Desktop sending no longer hangs after a mobile leaves a Claude session it created** — a mobile-initiated Claude turn left the desktop locked in a "controlled remotely" state after the turn finished (the Codex path had finally-cleanup; the Claude path did not). When the mobile later unsubscribed, desktop messages were rejected. Both paths now share a single ownership-lifecycle helper, and the lock releases the moment the remote turn ends.

### Changed

- **Session ownership is a first-class property of each Session** — `owner` (local / remote+deviceId), `subscribers` set, and lifecycle events live inside the Session itself; ownership locking is enforced inside `Session.send()` rather than by scattered IPC-handler guards. Transport (`RemoteControlService`) is reduced to a pure relay+LAN frame layer with no session-control state.
- **Multiple mobile devices can share one desktop** — paired with the upgraded relay, a single desktop channel now hosts an arbitrary number of mobile peers, each tagged with its own deviceId. Sessions are independently owned and viewed; one device disconnecting only affects the sessions it owned or subscribed to.
- **`unsubscribe_session` accepts an optional `sessionId`** — mobile targets a specific session instead of clearing every subscription this device holds; cleaner semantics for multi-session viewing.

## [0.22.1-alpha] - 2026-04-25

### Added

- **Sidebar tooltip lists online mobile devices with their transport** — hovering the remote indicator shows each connected device and whether it's joined via LAN or relay.
- **Permission mode, thinking effort, model, and active provider sync to mobile** — desktop now pushes the full session control surface so the mobile chat picker reflects the desktop state.
- **`get_system_info` returns user agent defaults** — mobile clients receive Claude/Codex default model and effort from desktop preferences on first connect.

### Fixed

- **Effort change mid-session now takes effect on next send** — switching thinking effort via `setSelectedSettings` previously updated the field but did not flag the backend for rebuild, so the next message reused the stale effort. The session now marks itself for rebuild and the new effort is applied on the very next send.
- **Remote-controlled turns broadcast session start and clean up ownership** — when a mobile client started a remote turn, the desktop UI did not receive a `remote_session_start` event and the remote-owned flag stayed set after the turn ended. Both are now emitted/cleared correctly, and the remote lock also covers the active remote-owned session even without an active subscription.
- **Device stays online while any transport is connected** — closing one of LAN/relay no longer flips a device offline when the other connection is still live; transport tracking is now per-connection rather than overwriting on each new join.
- **Session lock releases when mobile unsubscribes without disconnecting** — switching projects on the mobile side previously left the desktop session locked even though the subscription was gone.
- **Table and `★ Insight` blocks survive mid-stream flush** — chat content reducer no longer drops these block types when streaming events flush partial text.

### Changed

- **Model picker drops provider icon prefix** — both the model selector trigger and the picker list show the model name only, matching the cleaner mobile layout.

### Tests

- **i18next initialized in vitest setup** — tests pulling in modules that touch shared i18n resources no longer warn about uninitialized i18next.
- **Coverage for `provider-utils`, `get_system_info` defaults, and model lists** — locks down the desktop→mobile metadata surface.

## [0.22.0-alpha] - 2026-04-24

### Added

- **Host locale exposed to mini-apps via `superone.locale` API** — mini-apps can now call `superone.locale.get()` and subscribe to changes via `superone.locale.onChange()` to follow the user's UI language (en/zh). Initial value is baked into the bridge at load time (iframe: inlined at script generation; webview: read from `_locale` query param in preload) so there's no race window between app start and the first locale read. Listeners only fire on actual diffs.
- **Expanded zh/en coverage across chat UI** — tooltips, permission/plan/ask-user prompts, sidebar context menus, tool block and subagent status text, rewind and worktree popovers, Codex slash commands, and model/permission selectors are now fully translated.

### Fixed

- **Advanced env editor preserves reserved provider keys** — `parseEnvPairs` / `serializeEnvPairs` previously dropped `RESERVED_ENV_KEYS` (auth token, model buckets, base_url) both on read and write, so any preset with an `ANTHROPIC_AUTH_TOKEN` sentinel (Z.ai, DeepSeek, DMXAPI, …) lost the sentinel after you edited and saved advanced env vars, which broke auth because `buildProviderEnv` then couldn't copy `api_key` into `ANTHROPIC_AUTH_TOKEN`. The editor now splits state into visible + hidden pairs so reserved keys stay in the data layer but out of the UI, and serialize guards against user-typed collisions.
- **Automation/schedule dialog no longer shows raw i18n keys** — automation/schedule translation keys live under `resources.*` but the dialog was calling them with a `settings.*` prefix, so strings like `"settings.automation.createTitle"` rendered verbatim. Fixed by correcting the namespace.

### Changed

- **Structured `model_env` with bucket slots and display names** — provider model configuration moves from flat `ANTHROPIC_DEFAULT_*_MODEL` env strings to typed `ProviderModelEnv` keyed by stable buckets (`default` / `opus` / `sonnet` / `haiku` / `subagent`), each slot carrying `{id, name, description}`. ProviderDialog gains a dedicated Model Env editor for the 5 bucket slots. ModelSelector now shows the provider icon plus the bucket-derived display name, with dedup by `slot.id`, and hides the effort selector for non-official providers unless `CLAUDE_CODE_EFFORT_LEVEL` is set (then rendered as a read-only label). An idempotent DB migration hoists legacy flat env into the new structure on first launch.
- **Preset model versions bumped** — `kimi-k2` → `kimi-k2.6`, `MiniMax-M2.5` → `MiniMax-M2.7` (CN / Global / SiliconFlow), `mimo-v2-flash` → `mimo-v2-pro`.
- **`@openai/codex-sdk` updated to 0.124.0**.

## [0.21.11-alpha] - 2026-04-24

### Added

- **Language switching (zh/en) in Settings → Preferences** — full internationalization across settings and chat UI.
- **Streaming tool input previews for Edit/Write/FileChange/NotebookEdit** — tool arguments render progressively as they stream, so long Edit/Write calls show their target file and partial content immediately instead of waiting for the full JSON.
- **Error tool results auto-collapse** — tool blocks whose result is an error collapse by default, keeping chat scrollback clean while staying one click away.

### Fixed

- **Chat layout no longer overflows on narrow widths** — a missing `min-w-0` on the layout flex chain let long tool output push the chat column wider than its container. The chain now contains its content.

### Changed

- **Claude Agent SDK updated to 0.2.118** — brings parity with Claude Code CLI through v2.1.118 (rolls up v2.1.115–v2.1.118 upstream updates).
- **Settings preferences reuse chat list components** — internal refactor, no behavior change.

### Performance

- **Per-project syntax highlighter cache** — code highlighting in diffs reuses a cached shiki instance per project instead of rebuilding per tool block; caches are disposed when the project closes.
- **Incremental line-level highlighting for the streaming Edit diff** — CanvasEditDiff only re-highlights lines that actually changed, rather than the whole file, on each streaming delta.
- **Common languages preloaded at app boot** — TypeScript / JavaScript / Python / Markdown / JSON highlighters load during startup so the first Edit tool doesn't wait on highlighter init.
- **Streaming JSON parser rewrite** — `partial-json` string extractor replaces O(n²) character-by-character concat with an array accumulator plus a fast no-escape slice path.

## [0.21.10-alpha] - 2026-04-23

### Added

- **Direct LAN transport for mobile clients** — mobile devices on the same WiFi now connect directly to the desktop via a local WebSocket server with mDNS zero-config discovery, bypassing the Cloudflare relay for lower latency. The relay stays available as automatic fallback when off-WiFi. End-to-end encryption reuses the existing per-pair AES-GCM key, so existing pairings keep working without re-pairing.
- **Per-agent default preferences in Settings → Preferences** — Claude gains Default Model + Default Thinking Effort selectors alongside the existing Permission Mode and Sandbox defaults. Changes apply to every session that has not explicitly picked its own model, and the settings live in `app-settings.json` under `agentPreference.claude` so they survive across Claude CLI upgrades.
- **Live streaming diff for the Edit tool** — Edit tool calls now render a canvas-based diff that animates line-by-line as `old_string` → `new_string` arrives, with cursor tracking and a cross-fade from pre-edit to full diff when `new_string` begins streaming. This replaces the previous plain diff rendering during streaming.
- **Renderer resyncs with live main-process sessions after reload or crash** — reloading the renderer (or recovering from a renderer crash) mid-stream used to drop the in-flight session. The renderer now buffers incoming events while it pulls a live snapshot from the main process, replays the snapshot into the store, then flushes the buffer in order. Events carry a process-wide `(epoch, seq)` tuple so replays and reorderings are deduplicated at the reducer level.
- **Paste chips are editable and unfoldable** — each paste chip in the chat input now exposes an unfold action (expands the chip back into inline paragraphs) and its preview dialog became a lightweight textarea editor that writes edits back to the chip in-place.

### Fixed

- **Edit tool's `+N -N` line count now matches the real diff** — the counter used to sum `old_string` / `new_string` line counts naively, so a one-line change reported `+5 -5`. It now uses the same `diffLines` LCS that `FileChange` uses and returns `null` when the two sides are identical.
- **Codex turn/steer no longer hangs for 15 seconds** — a single-reader dispatcher on the app-server connection would silently drop the steer JSON-RPC response if a turn was parked in `nextNotification`, so `request()` waited for its 15s timeout. Responses and notifications now route through per-id waiters and a shared queue respectively.
- **Switching Codex auth providers rebuilds the connection with the new env** — `CodexBackend.rebuild()` previously left the cached app-server running with stale auth, so the next turn kept using the old API key / base URL. The connection is now torn down whenever auth rotates or the session needs a rebuild.
- **Codex permission Cancel is no longer collapsed into Decline** — the `decision='cancel'` flag was dropped between the IPC handler and the backend. The decision now threads through `SessionContract.respondToPermission` unchanged.
- **Codex interaction IPC handlers return their result** — `respondToPermission` / `answerQuestion` / `dismissQuestion` now propagate their ack back to the renderer instead of resolving as `undefined`, so stale-click protection works against Codex the same way it does against Claude.
- **Collapsed skill cards fill their row height** — skill cards now use a flex column layout so collapsed cards stretch to match the tallest card in the row.

### Performance

- **Codex reuses the app-server subprocess across turns of the same session** — `run` / `review` / `compact` used to spawn, initialize, and tear down a fresh `codex` subprocess on every message, adding roughly 1–2 seconds of overhead per turn. Each session now caches its `AppServerConnectionHandle` and only respawns on `reset()`, auth change, model/effort/thread reconfiguration, or child-process exit. `CodexBackend.prewarm()` also spawns the subprocess ahead of the first turn, mirroring the existing Claude warmup.

## [0.21.9-alpha] - 2026-04-22

### Fixed

- **Permission mode stays in sync after the "Switch to acceptEdits" suggestion is applied** — when the CLI applied the mode switch directly (bypassing our setPermissionMode IPC), the session's cached mode went stale, so switching back to `default` was treated as a no-op and the next edit would auto-approve. The backend now forwards session-scoped setMode suggestions from `canUseTool` so `Session.permissionMode` updates and the renderer receives a `permission_mode_change` event.
- **Context usage no longer bleeds between sessions that share a model** — the token count and category breakdown are now stored per-session and cleared on session switch instead of only on model change. `getContextUsage` is addressed by `sessionId` end-to-end, closing the reverse race where an in-flight fetch for session A could return session B's usage after a switch.
- **Mention chips insert with correct spacing** — a chip inserted directly after non-whitespace text was serialized without surrounding spaces (e.g. `abc@hello.py`), which the user-bubble parser's mention guard then rejected. The mention atom is now self-contained with leading/trailing spaces in both the serializer and rendered text.
- **Insight blocks wrapped in code fences render as insights** — models sometimes emit the star/divider insight block inside a ``` fence, which previously rendered as a raw code block. The splitter now detects and strips paired wrapping fences while leaving unmatched fences untouched so genuine code blocks are preserved.
- **Sidebar session menu "Open Folder" reveals the project in Finder** — the menu item was wired to an IPC that opens the project inside SuperOne (a no-op when already open). It now calls `showInFolder` with an empty relative path, which resolves to the project root and opens it in the system file manager.

### Performance

- **Project switch no longer shows a blank file tree on first open** — `fetchTree` is now triggered fire-and-forget from every `currentFolder` entry point (open folder, switch project, open tmp folder), so the `listDir` IPC overlaps the rest of the project switch instead of starting only when the FileTree component mounts. A root-dedupe field in the file-tree store makes the component's own fetch a no-op.

## [0.21.8-alpha] - 2026-04-21

### Added

- **Live-streaming diff for Edit/Write/FileChange tool calls** — tool blocks now auto-expand and pin their diff view to the bottom while tool input streams in, with syntax-highlighted tokens updating in place as partial JSON arrives. Manual scroll is suppressed during streaming and restored on completion.
- **Background status for tasks still running after the turn result arrives** — when the SDK emits its final result but background tasks are still active, the session stays in a new `background` status instead of flipping to `idle`. The sidebar shows a distinct pulse icon, and "New Session" / session-switch actions correctly park the session rather than killing the subprocess.

### Fixed

- **Adding a folder no longer fails when `git init` fails** — the auto `git init` on project add is now tolerant. Projects without a usable git executable (or with a folder that can't be initialized) still open successfully; the failure reason is written to the main process log.
- **Switching back to a session whose worktree was deleted externally now shows the read-only banner** — `switchSession` used to trust its cached worktree path and silently re-activated a removed worktree. It now probes the path before reuse and flips the session to read-only inline, matching DB-restored session behavior.

## [0.21.7-alpha] - 2026-04-21

### Fixed

- **Permission prompts stuck after switching sessions** — The shared `WarmupManager` let a warm SDK subprocess outlive the backend that created it. When one session disposed and another session's warm slot key matched, the second session consumed the first session's subprocess — whose `canUseTool` closure was still bound to the disposed backend. Permission requests emitted into an empty listener set and the prompt never reached the UI. Each `ClaudeBackend` now owns its own `WarmupManager` and disposes it on close, so warm slots die with the backend that owns them.
- **Permission prompt stays visible when the backend can't resolve it** — `respondToPermission` now returns an ack boolean through the backend → `Session` → IPC → store chain, so if the main process has no pending request for the given id (stale click, session already moved on), the renderer keeps the prompt instead of silently clearing it.
- **Mermaid diagrams render all nodes** — the SVG `foreignObject` coordinate bug that was dropping nodes from rendered Mermaid charts is resolved.

## [0.21.6-alpha] - 2026-04-20

### Added

- **Refresh shortcuts no longer reload the app** in packaged builds — Cmd/Ctrl+R, Cmd/Ctrl+Shift+R, and F5 are intercepted so streaming chat and in-memory state aren't lost. Dev mode is unchanged so HMR reload still works.

### Fixed

- **Sandbox toggle now propagates to the running session** — previously, turning Sandbox Off in the UI left the SDK subprocess on its startup sandbox config, so tool calls kept requesting sandbox permissions.
- **Plan approval now syncs permission mode to main** — approving a plan previously only flipped the UI to `acceptEdits`, while the backend session stayed on the old mode and Edit/Write kept prompting.
- **Resumed sessions honor user default permission and sandbox mode** instead of falling back to `default` + hardcoded sandbox. Main is now the authoritative source; the renderer reflects what main actually applied.
- **Switching in/out of `bypassPermissions` mode rebuilds the backend** — the SDK's `allowDangerouslySkipPermissions` flag is fixed at init, so the session now defers a rebuild to the next `send()`, mirroring the `switchCwd` pattern.

## [0.21.5-alpha] - 2026-04-19

### Added

- **Codex plugins management** — install, list, delete, and browse marketplace plugins per project.
- **Per-project Codex MCP config** — save, delete, and toggle MCP servers scoped to user or project.

### Changed

- **Claude Agent SDK upgraded to 0.2.114** (from 0.2.111), now using per-platform native binaries.

### Fixed

- **Codex child thread events** now route to the correct session instead of being dropped.
- **Packaged app failed to warm up with `spawn ENOTDIR`** — Electron's asar→unpacked path rewrite doesn't cover ESM `child_process.spawn` in this scenario, so the bundled Claude native binary was being spawned from inside `app.asar` and refused by the OS. Fixed by resolving the binary and forcing its `app.asar.unpacked` path at every SDK call site (chat query, prewarm, model list, auth bootstrap, provider test).

## [0.21.2-alpha] - 2026-04-19

### Changed

- **ESC hold-to-interrupt shortened to 600ms** (from 1000ms) for a snappier stop gesture in the chat composer.

### Fixed

- **Queued messages flush correctly after interrupt/cancel** in `ClaudeBackend`, so text typed while the agent was running no longer gets dropped.
- **Mini-app tools reach the SDK on resume** — `markAllNeedsRebuild` now forces a rebuild so dynamically-registered MCP tools are re-applied.
- **Removed-worktree sessions render READ-ONLY** instead of erroring, making it obvious the underlying worktree no longer exists on disk.
- **New sessions inherit user preferences** (model, permission mode, etc.) at creation time rather than only after the first turn.
- **Embedded JS/CSS inside HTML files** now gets proper syntax highlighting in the diff view.

## [0.21.1-alpha] - 2026-04-18

### Fixed

- **Session worktree persistence** — worktree path/base branch now round-trip through save/resume, and resume gracefully recovers when the worktree directory is missing on disk.
- **Prewarm respects permission handler** — the prewarmed Claude subprocess now binds the real `canUseTool`, so edits on the first tool call after warmup are no longer auto-denied.
- **Project-level resource discovery restored for Claude sessions** — per-project agents / skills / MCP configs load again.
- **Slash command palette refreshes on provider switch** — no more stale Claude entries after switching to Codex (and vice-versa).
- **File link targets normalized** before opening, so paths with `./` prefixes, URL-encoded characters, or fragment suffixes resolve correctly.
- **Codex completion metadata** (token counts, finish reason) normalized so post-turn UI doesn't render partial data.
- **Codex bash blocks** now collapse by default with a shimmer "running" state, matching the Claude bash UX.
- **@mention chips render for mid-text mentions** in the user bubble (previously only leading mentions became chips).
- "Accept edits" suggestion in the plan-approval UI is correctly aligned.

## [0.21.0-alpha] - 2026-04-18

### Refactored

- **Session management overhaul** — replaced the monolithic `agent-service.ts` (1600+ LOC) with a hexagonal architecture: `Session` (lifecycle aggregate root), `SessionBackend` (`ClaudeBackend` / `CodexBackend`), `SessionManager` (per-project tracking + event fan-out), `BackendCommand` (generic discriminated-union command bus). Removes ~450 LOC of legacy Codex runtime infrastructure. Stable `sessions.id` is now the primary key; `provider_session_id` is persisted when the harness resolves it.
- **Codex paths unified through SessionManager** — all Codex IPC handlers (`run`, `steer` with hot assistantId swap, `review`, `compact`, plan approval, collaboration mode, side-channel), plus automation service and remote control, now route through the same Session pipeline as Claude.
- **Pure-SQL migration module** — extracted `database-migrations.ts` with no Electron dependency so migrations can run from bare Node for CI / snapshot testing.

### Fixed

- `CODEX_RUN` receiving a Claude session id when the user switched provider to Codex after an empty Claude session — renderer now creates a fresh Codex session id.
- `switchCwd` now actually migrates the active session to the new cwd (previously a silent no-op).
- Live sessions rebuild when provider config changes (previously `markAllNeedsRebuild` fan-out was a no-op).
- Warmup subprocess isolation by resume / fork / session id so parallel projects don't share warm CLI state.
- Streaming reasoning block auto-expands when text arrives after an empty anchor (Brain animation no longer swallowed).
- Chat-md tolerates insight blocks emitted without wrapping backticks.

### Added

- `scripts/test-migration.ts` — copies the production DB, runs migrations against the copy, and asserts schema invariants (provider_session_id backfilled, claude_session_id dropped, session_providers seeded, no orphaned messages). Runs via `bun run test:migration`.

### Styling

- Tightened tool-group vertical margin in chat.

## [0.20.3-alpha] - 2026-04-17

### Added

- Auto Mode in the permission-mode cycle — gated by plan (Max/Team/Enterprise/API), first-party provider, and model support (`supportsAutoMode`); auto-downgrades to `default` when switching to an ineligible model. Don't Ask / Bypass are grouped below a divider and now require an explicit click.
- Pre-warm Claude CLI subprocess on typing / draft changes so the ~3.4s SDK init runs off the critical path. First-response latency on session rebuild drops from ~5.3s to ~1.9s (65% reduction).
- Default effort now uses the model's top tier — Opus 4.7 (and any future model exposing `xhigh`) defaults to `xhigh` instead of `medium`.

### Fixed

- "Thinking..." indicator no longer disappeared with the latest SDK default of `adaptive` + `omitted`. We now request `adaptive` + `summarized` and emit an empty thinking anchor so the Brain animation is always visible, matching the Codex reasoning UX.
- Stale streaming-token footer after interrupting a reply and sending again — the new assistant message briefly showed the previous turn's token count. Session-level `streamingTokens` now resets on `message_start`, freezes into the interrupted message on `message_interrupted`, and clears on `message_error`.

## [0.20.2-alpha] - 2026-04-17

### Fixed

- App crash on startup in packaged v0.20.1-alpha builds with `SyntaxError: Identifier 'require' has already been declared`. Root cause: `resolve-cli.ts` declared a local `require` via `createRequire`, which collided with rolldown's auto-injected CJS shim in the bundled main process output. Renamed to `moduleRequire` to avoid the conflict.
- `CONNECT_CLAUDE` handler no longer wipes `PATH` / `HOME` from the CLI subprocess environment in packaged mode (latent bug, auto-fixed by the SDK upgrade below changing `options.env` semantics from replace to overlay).

### Added

- Claude Opus 4.7 support via `@anthropic-ai/claude-agent-sdk` upgrade (`0.2.101` → `0.2.111`).
- New `xhigh` effort level (surfaced as "Extra High" in model and automation selectors).

## [0.20.1-alpha] - 2026-04-17

> Note: v0.20.0-alpha was tagged but its CI build failed due to a missing `ws` dependency. v0.20.1-alpha is the first shipped binary in the 0.20 line and includes everything originally planned for 0.20.0 plus the dependency fix.

### Added

- Mini-app human-in-the-loop tool calls — declare `renderer.intercept` to gate a tool behind a user-confirmation iframe
- Mini-app custom result rendering via `renderer.result` (manifest `popovers` renamed to `templates`, now shared across popovers / intercepts / result views)
- Mini-app permission prompt shows app icon and name instead of the raw MCP tool string
- Subagent icon pulses while its task is running
- Remote relay status indicator in the sidebar
- Opt-in PostHog usage analytics in settings
- Error state in chat for failed tool results
- Active provider hint in chat suggestions

### Fixed

- Paste chip ring clipped when the chip is selected
- Missing `ws` dependency caused v0.20.0-alpha CI to fail on all platforms; relay WebSocket import now resolves under frozen lockfile

### Refactored

- Centralized IPC string-literal channels and shared device config
- Replaced project row dropdown with a context menu

## [0.19.1-alpha] - 2026-04-15

### Added

- Context injection API for mini-apps
- Enabled toggle for automation edit dialog
- `get_session_state` command for mobile session sync

### Fixed

- Foreground bash showing in background bash panel
- Plan exit accept-edits toggle misaligned with suggestion style
- Event leak to mobile when no session filter is set

## [0.19.0-alpha] - 2026-04-15

### Added

- Scheduled task automation for agents (cron-based triggers)

### Fixed

- Delete-session dialog overflow with long session ids
- Activity panel width not clamped synchronously when shown
- New sessions ignoring user preference permissionMode

## [0.18.7-alpha] - 2026-04-14

### Added

- Template-based popover API for mini-app overlay rendering

### Fixed

- Chat horizontal overflow when activity panel is open
- Duplicated interrupted indicator in chat message footer
- Gap between user bubble and first agent reply block
- Mini-app packaging now non-destructive with cleaner dev appId

## [0.18.6-alpha] - 2026-04-13

### Added

- Terminal reason display (max turns, aborted, blocked) in chat message footer
- 8 new mini-app git bridge APIs: blame, diffSummary, getCommit, tags, remotes, branchDetail, stashList, logFile
- Built-in MCP tools exposed over HTTP for Codex integration

### Fixed

- Permission mode leaking across sessions on switch

### Changed

- Bump claude-agent-sdk to 0.2.101 and MCP SDK to 1.29.0
- Enforce requirement confirmation workflow before mini-app development

## [0.18.5-alpha] - 2026-04-13

### Added

- Cmd+/- content zoom shortcuts for chat and file preview

### Fixed

- Syntax highlighting losing context across chunk boundaries in file preview
- Content clipping on resize by replacing CSS zoom with transform scale
- Code block highlighting in markdown files with YAML front matter

## [0.18.4-alpha] - 2026-04-12

### Added

- Markdown editing with syntax highlighting and auto-save in file preview

### Fixed

- Isolate permissionMode across sessions and scroll after plan approval
- Hold queued messages until step boundary for cancellability

### Performance

- Chunked syntax highlighting and minimap rendering for large files

## [0.18.3-alpha] - 2026-04-11

### Added

- ⌘, keyboard shortcut to toggle settings
- API version and `update_superone_types` MCP tool for mini-apps
- Enhanced standard app tool call display and grouping

### Fixed

- Use SDK replay UUIDs for file checkpoints and simplify rewind flow
- Persist `preapproved.json` for React template dev apps

### Other

- Add BSL 1.1 license

## [0.18.2-alpha] - 2026-04-10

### Added

- Overlay UI APIs for mini-apps (toast, tooltip, context menu)
- System bridge APIs and refactored message handling for mini-apps
- Filesystem protocol, tool lifecycle rebuild, slug-based appId, DnD polish
- Show claude.ai MCP servers in settings with toggle support
- Recipes guide, examples, and binary fs support for mini-app docs

### Fixed

- Always show app drawer even when no apps installed
- Persist rate limit dismiss across session switches
- Horizontal overflow on panel resize
- Support absolute paths for media file preview
- Guard `/review` and `/plan` popup to codex provider only
- Sync guides and React template types with actual API
- Exclude `preapproved.json` and `install.json` from packed `.s1app`

### Refactored

- Extract shared API runtime for bridge and preload

## [0.18.1-alpha] - 2026-04-09

### Added

- Tool preapproval, `.superone` protection, and apps settings
- Simplified scaffold tool, split guides by type, enhanced tool display

### Fixed

- Merge mac build jobs to fix auto-update architecture mismatch

### Performance

- Optimize file preview rendering and reduce panel expand jank

## [0.18.0-alpha] - 2026-04-08

### Added

- Overhauled canvas layout, install target, and UI polish
- Enhanced scaffold with mode/template support and UI improvements
- Permission model with access control, reasons, and install dialog
- Theme, `fs.watch`, and git bridge APIs for mini-apps

### Fixed

- Prevent idle browsed sessions from leaking into session list
- Reset detailed usage when model changes
- Notify frontend immediately when queued message is consumed
- Prevent draft text leaking across sessions
- Serialize hardBreak nodes as newlines in user messages
- Align useChatScroll tests with ResizeObserver-based settle timer

## [0.17.0-alpha] - 2026-04-06

### Added

- Mini-app platform with packaging, installation, and built-in MCP server
- Cmd+W shortcut to close active tab when panel is focused
- Persist activity panel layout and default to left side

### Fixed

- Show argument hints for skills in slash command UI
- Panel resize, chat overflow, and minimap responsiveness
- Trigger clampPanels on sidebar toggle
- Diff background width calculation for correct font size
- Activity panel absorbs window resize, disable single-group drag
- Chat overflow when left activity panel opens

## [0.16.2-alpha] - 2026-04-04

### Fixed

- Panel resize, chat overflow, and minimap responsiveness

## [0.16.1-alpha] - 2026-04-04

### Added

- Long-press ESC interrupt with animated stop button
- Dockview-based ActivityPanel replacing FilePanel
- Dev app scaffold and auto-detection workflow for mini-apps

### Fixed

- Use SDK cumulative cost directly instead of additive accumulation
- Decode URL-encoded file paths in markdown FileLink chips
- Render link safety modal via portal to cover full viewport
- Upgrade Electron 40→41 to fix pdfjs-dist compatibility

### Styling

- Refine table styles and add context usage hover feedback

## [0.16.0-alpha] - 2026-04-02

### Added

- Webview dev mode with DevTools and reload for canvas
- Mini-app system with MCP proxy for canvas
- Dev examples and miniapp-builder skill
- Paste chip for large text pastes

### Fixed

- Cross-session event routing race condition

### CI

- Simplify mac build, add workflow_dispatch with platform selector

## [0.15.0-alpha] - 2026-04-01

### Added

- Upgrade SDK to 0.2.89 with api_retry indicator, slash command & context UI improvements
- Provider-aware context window in ContextUsage

### Fixed

- Consolidate asarUnpack patterns to fix macOS universal build

## [0.14.3-alpha] - 2026-04-01

### Added

- Unique draft session IDs to isolate concurrent drafts
- Copy Working Directory and Open Folder to session context menu
- Isolate dev userData into project-local `.dev-data` directory

### Fixed

- Stop forwarding background session permissions to active session
- PDF preview resize race condition and Codex chat overflow

### Tests

- 220+ unit tests across settings store, MCP library, bash output watcher, and chat store

## [0.14.2-alpha] - 2026-03-31

### Added

- `/plan` slash command for Codex with plan approval flow (approve/reject)

### Fixed

- Codex session title and running indicator for mobile

## [0.14.1-alpha] - 2026-03-31

### Added

- Pixel-accurate DiffView content width using pretext

### Fixed

- Prioritize tool result over live state in ExitPlanMode block
- Stop metadata events from fragmenting streamed text chunks
- Resolve ghost interrupted messages and queued message support for remote sessions
- Clamp sidebar first when FilePanel opens to prevent chat overflow
- Resolve context window from selected model name instead of stale state

## [0.14.0-alpha] - 2026-03-29

### Added

- Replace prefireMessage with SDK priority queue and precise queued turn detection
- Restore @mention directory drill-down with scoped fuzzy search
- Collapsible permission prompt with space toggle

### Fixed

- Convert Codex items to content blocks for mobile history
- Pass mobile permission mode as initialize override

### Performance

- Throttle drag/resize with rAF and optimize DiffView virtualizer

### Tests

- ClaudeAgent init unit tests

## [0.13.1-alpha] - 2026-03-29

### Fixed

- Use cached models for mobile and stabilize fetchModels

## [0.13.0-alpha] - 2026-03-29

### Added

- Support Codex session resume and show codex sessions in list

## [0.12.4-alpha] - 2026-03-28

### Fixed

- Fetch models on first install when no projects exist

## [0.12.3-alpha] - 2026-03-27

### Added

- Enhanced background subagent visibility and interaction routing

### Fixed

- Create proper remote session when mobile resumes old session
- Preserve renamed session title on subsequent task runs
- Chunk large WebSocket responses to avoid Cloudflare 1MB limit

## [0.12.2-alpha] - 2026-03-25

### Added

- Show bash description inline in tool header and permission prompt
- Support video and audio media in markdown rendering

### Fixed

- Remove redundant applyPreferences on session rebuild
- Repair broken tests and add preference coverage

## [0.12.1-alpha] - 2026-03-25

### Added

- Image preview in markdown via media server

### Fixed

- Subagent elapsed time formatting
- Prevent slash menu from reopening on programmatic text set

## [0.12.0-alpha] - 2026-03-25

### Added

- Local media server for video/audio playback in chat and FilePanel
- Phone icon for remote session in project sidebar
- `set_permission_mode` command and selectedSuggestions support for remote
- Broadcast `interaction_resolved` when mobile resolves permissions
- Copy session ID context menu item

### Fixed

- Hide phantom "New session" for unhydrated background sessions
- Rename userSettings permission label to "all projects"
- Test connection spawning CLI without PATH
- Mermaid blocks not auto-converting to preview after streaming ends
- Preserve paragraph breaks between text segments in convert-trace
- Skip truncation for Agent tool_result summary
- Extract insight blocks from text for mobile rendering

### Refactored

- Replace batch timer with promise queue for event sending
- Denormalize session timestamps, extract ProjectSidebarRow
- Extract session runtimes and persist codex turns
- Extract splitTextIntoBlocks and enrich permission in convert-trace

## [0.11.5-alpha] - 2026-03-18

### Added

- Preferences page with project-level output style
- Reasoning summary for Codex, command group expansion and item streaming

### Fixed

- Nested code fences, insight blocks, scroll tracking, and permission overflow
- Checkpoint handling, rewind logging, and test mocks

## [0.11.4-alpha] - 2026-03-17

### Added

- Iframe gate, CDN allowlist, scroll fixes, and guideline updates for widgets

### Fixed

- Canvas placeholder, header layout, and sendPrompt behavior
- Prevent tiny trackpad scrolls from disabling auto-scroll during streaming

### Refactored

- Move theme toggle from sidebar to header titlebar
- Remove click-to-copy on user messages and text segments

## [0.11.3-alpha] - 2026-03-17

### Added

- Updated generative UI guidelines and improved widget rendering

### Fixed

- Disable single-dollar LaTeX to prevent currency symbol misparse
- Guard webContents.send against destroyed window

## [0.11.2-alpha] - 2026-03-17

### Added

- Download button, auto-resize iframe, and improved tool descriptions for widgets

### Fixed

- Use messageStreaming prop instead of session status for completion detection
- Create new widget MCP server per session to prevent connection failure
- Refocus editor after model/effort selector closes

## [0.11.1-alpha] - 2026-03-17

### Fixed

- Use Electron Helper to prevent child process dock icons on macOS

## [0.11.0-alpha] - 2026-03-17

### Added

- Generative UI with streaming preview (widget system)
- Mermaid diagram viewer with fullscreen, zoom/pan, and minimap
- Smart SVG sizing with fit-then-overflow strategy
- Improved copy behavior and mermaid preview
- LaTeX math rendering support via Streamdown math plugin

### Fixed

- Inherit process.env in session query env
- Use Electron as Node runtime in packaged builds

### Performance

- Lazy load messages and reduce re-renders

## [0.10.3-alpha] - 2026-03-15

### Added

- Auto-focus input when creating or switching sessions
- Improved sidebar styling, file tree drop zone, and image preview with zoom

### Fixed

- Auto-expand input area to fit placeholder text on narrow widths

### Refactored

- Unify tool group style and add inline file chip for Codex

### Tests

- 220 unit tests for 12 core modules (crypto, diff-utils, plugins, tool-block-utils, chat-input-utils, stall-utils, MessageBridge, session-history, mcp-config, discover-resources, claude-permissions, and more)

## [0.10.2-alpha] - 2026-03-15

### Fixed

- Handle missing folders gracefully on startup
- Use raw SDK description instead of splitting at separator
- Derive model display names from SDK data instead of hardcoding

## [0.10.1-alpha] - 2026-03-14

### Fixed

- Resolve SDK cli.js by package dir instead of exports map

## [0.10.0-alpha] - 2026-03-14

### Added

- Model display name mapping and MAX effort easter egg
- Align ask-question types with SDK and add preview/notes support
- LaTeX math rendering support
- Input placeholder with provider name and usage hints
- SET_FAST_MODE IPC handler

### Fixed

- Timestamp-based scroll intent to fix trackpad auto-scroll race condition
- Encode local-file URLs to prevent unwanted decoding of percent characters
- Show subagent summary after task completion
- Improve SDK event handling for replay and subagent

## [0.9.0-alpha] - 2026-03-14

### Added

- Live bash output streaming, rate limit indicator, and git status refactor
- Edit/Write diff preview in permission prompt
- ULTRATHINK easter egg for high thinking effort
- Link safety modal for external URLs
- Cmd+N shortcut to create new session

### Fixed

- Eliminate startup flash and improve loading transitions
- Suppress overlay for /compact slash command output
- Convert streaming status to interrupted on session save
- Move sidebar toggle to main header on Windows
- Auto-hide scrollbars, only show while scrolling

### Performance

- Reduce store subscription overhead for typing and streaming

## [0.8.5-alpha] - 2026-03-14

### Fixed

- `local-file://` protocol URL for Windows drive letter paths

## [0.8.4-alpha] - 2026-03-14

### Fixed

- Include `cache_creation_input_tokens` in usage tracking
- Normalize path separators for Windows compatibility
- Update plan mode placeholder and fix option text truncation

## [0.8.3-alpha] - 2026-03-14

### Fixed

- Use platform separator in path validation and skill install

## [0.8.2-alpha] - 2026-03-14

### Fixed

- Use platform path separator in `isPathWithinAllowed` (security)

## [0.8.1-alpha] - 2026-03-13

### Added

- ReviewPanel for interactive code review and git log IPC
- Overhaul minimap scroll, optimize DiffView, fix external file preview

### Fixed

- Session isolation, restore, and reset for Codex sessions
- Remove unnecessary keyDown handler from ReviewPanel search input
- Allow hidden files in mention search, hide completed codex todos

### Refactored

- Expand EXCLUDED_DIRS with common build/cache directories

## [0.8.0-alpha] - 2026-03-13

### Added

- Codex integration: isolated sessions, worktree cwd support
- Plan item UI and collaboration mode
- Route tool/requestUserInput through ask_user_question flow
- Cancel decision in permission flow, upgrade codex-sdk to 0.114.0

### Refactored

- Extract TodoListPanel and unify codex todo display

### Tests

- Codex experiment service unit tests

## [0.7.4-alpha] - 2026-03-12

### Fixed

- Accumulate subagent input tokens instead of overwriting
- Defer session eviction until DB save completes

### Refactored

- Move cwd to per-session state and unify resume logic

## [0.7.3-alpha] - 2026-03-11

### Added

- Improved sandbox permission request UI

### Fixed

- Scrollable project list in ProjectSelector dropdown
- Isolate worktree path per session and detect removed worktrees
- Handle raw bash input parsing and preserve background task completed state
- Prevent programmatic scroll from disabling auto-scroll
- Make entire reasoning block header clickable for expand/collapse
- Clear pending worktree state when switching to local session

## [0.7.2-alpha] - 2026-03-11

### Added

- Move support for external drops and improved drag-drop UX in file tree
- rootPath support for multi-root workspaces in search

### Fixed

- Use inset ring for drag-over highlight to prevent clipping

### Tests

- Permission queue and deduplication tests

## [0.7.1-alpha] - 2026-03-11

### Fixed

- Use inset ring for drag-over highlight to prevent clipping

## [0.7.0-alpha] - 2026-03-11

### Added

- File operations with drag-and-drop support in file tree
- Fuzzy file search IPC for @mention popup
- Fuzzy search for slash commands

## [0.6.1-alpha] - 2026-03-10

### Fixed

- Queue concurrent permission requests instead of overwriting

## [0.6.0-alpha] - 2026-03-10

### Added

- Clickable FileChip in read tool and markdown file links for Codex
- Granular usage tracking, steer routing, and model caching for Codex
- Upgrade Codex SDK to 0.112.0 with commandActions parsing

### Fixed

- Prevent layout shifts from breaking auto-scroll during streaming
- Accumulate input tokens across multi-step turns

### Refactored

- Extract CopyableMarkdown and ReasoningBlock components

## [0.5.4-alpha] - 2026-03-09

### Fixed

- Pass SDK CLI path in CONNECT_CLAUDE query for Windows

## [0.5.3-alpha] - 2026-03-09

### Added

- Remote control settings page, store, and sonner toast
- Secure two-phase pairing with paired devices persistence
- Per-agent config and multi-agent activation support

### Fixed

- Skip session rename on Enter during IME composition
- Wrong OpenRouter icon for DMXAPI/PackyCode and remove redundant badge

### Refactored

- Remove typewriter animation from CodexTurnView

## [0.5.2-alpha] - 2026-03-05

### Fixed

- Pass SDK CLI path to query() for packaged app asar support

## [0.5.1-alpha] - 2026-03-05

### Fixed

- Use SDK bundled CLI instead of system Claude Code

## [0.5.0-alpha] - 2026-03-05

### Added

- Provider management with model mapping and preset configs

### Fixed

- Upgrade codex-sdk to 0.107.0 and fix IME/scroll issues

### Tests

- Provider env mapping, env injection, and maskApiKey tests

## [0.4.2-alpha] - 2026-03-04

### Fixed

- Tool block overflow and denied feedback layout
- Text overflow in user message bubbles

### Refactored

- Consolidate markdown rendering into MarkdownView component

## [0.4.1-alpha] - 2026-03-03

### Fixed

- Defer GH_TOKEN cleanup to avoid updater race condition

## [0.4.0-alpha] - 2026-03-03

### Added

- Inline activity panels, background task collapse, and async agent output
- Rebuild session when switching to/from bypassPermissions mode

### Fixed

- Validate HEAD before branch creation and case-insensitive branch name matching

## [0.3.2-alpha] - 2026-03-02

### Added

- Dismissible rate limit indicator with absolute reset time
- Deferred session resume with awaitingAssistantReply state
- Link safety modal for external URLs
- Click file chip to open file in panel
- Batch session cleanup by time period

### Fixed

- Error handling and startup diagnostics
- Cross-platform Codex runtime detection with system CLI fallback
- Guard disposed bridge and handle pre-ID session parking
- Long text overflow in user messages
- Scope GH_TOKEN to update check duration
- Respect upward scroll during streaming
- Use latest step input tokens instead of accumulating
- Prevent worktree state from polluting non-worktree sessions

## [0.3.0-alpha] - 2026-03-01

### Added

- Path-security module and hardened IPC handlers
- Improved subagent rendering, session history, and store event handling
- Session hide, paginated listing, and improved error logging
- Event trace infrastructure for debugging data flow
- Session context menu with hover icons replacing dropdown
- Prompt prefire to queue messages during streaming

### Fixed

- Sync turnMessageId for slash commands without assistant messages
- Route new-turn content to correct messageId during background tasks
- Auto-scroll input to cursor on new line insertion

## [0.2.2-alpha] - 2026-02-28

### Fixed

- Use strict NODE_ENV check for raw session logging

## [0.2.1-alpha] - 2026-02-28

### Fixed

- Handle local_command_output system messages and add raw session logging
- Preserve leading whitespace in git status output
- Improve denied tool border, minimap diff contrast, and file preview markdown

## [0.2.0-alpha] - 2026-02-28

### Added

- Cmd+N shortcut to create new session
- Live bash output streaming, rate limit indicator, and git status refactor
- Dedicated Kbd component replacing CommandShortcut

### Fixed

- Worktree indicator incorrectly shown on normal sessions
- Expand bash tool block during execution and improve tool UI
- Auto-clamp panels on window resize and fix diff view min-height
- Show preparing state during blockmap phase and allow dismiss

### Tests

- Unit tests for git-status-utils, ansi parser, and tool-block-utils

## [0.1.0-alpha.4] - 2026-02-27

### Added

- PDF zoom controls, URL source support, and responsive scaling
- File preview support for images, PDF, SVG, video, and audio

## [0.1.0-alpha.3] - 2026-02-27

Initial tagged release.

## [0.1.0-alpha.2] - 2026-02-27

### Fixed

- Theme-aware syntax highlighting in diff view
- Light mode support for subagent type badge
- Rename explorer to files and fix file tree race condition

### Refactored

- Use applyDefaultModel helper for session model init

## [0.1.0-alpha.1] - 2026-02-27

Initial alpha release of SuperOne.
