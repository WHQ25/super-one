# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SuperOne is an meta desktop app built with Electron. It can be a IDE, it also provide a canavs for user to create their own app using coding agent as agentic engine. Inspired by Pencil.dev's MCP Server pattern.

## Monorepo Layout

This repo is a **bun workspaces monorepo** (no turborepo/nx). Linker is hoisted (`bunfig.toml`) so transitive deps remain reachable like a single-package install.

```
super-one/
  apps/
    desktop/         — Electron app (was the entire repo pre-monorepo)
    web/             — Next.js 16 marketing/docs/demos site (App Router + Turbopack)
    relay/           — Cloudflare Workers (Durable Objects) — mobile↔desktop relay protocol
  packages/
    ui/              — shadcn primitives + OKLch theme CSS, shared by desktop + web
    shared/          — Neutral types, harness-brand, i18n, miniapp runtime (no Electron deps)
    tsconfig/        — Shared base/react-library/electron-{node,renderer}/nextjs configs
```

Workspace package names: `@superone/desktop`, `@superone/web`, `@superone/relay`, `@superone/ui`, `@superone/shared`, `@superone/tsconfig`. All `private: true`.

**Self-host relay**: `apps/relay/` is intended to be self-hostable by users. Currently the repo is private; when going public the plan is to set up a `git subtree` mirror to a public repo via GitHub Action so self-hosters can clone just the relay subtree. Until then, distribute by sharing wrangler.toml + source bundle directly.

**Cross-package imports**: code uses `@superone/shared/agent-types`, `@superone/ui/components/ui/button`, etc. Each package's `exports` map governs resolution; Vite/TS pick up `.tsx`/`.ts` source directly (no build step).

Inside a package, prefer relative paths (`./X`, `../lib/utils`) over `@/` aliases to keep the package bundler-agnostic.

## Commands

All root scripts proxy to a workspace via `bun --filter`. Run them from the repo root.

```bash
bun run dev              # Start Electron app with hot reload (→ @superone/desktop)
bun run dev:web          # Start Next.js dev server on :3000 (→ @superone/web)
bun run dev:relay        # Start wrangler dev for Cloudflare Worker relay (→ @superone/relay)
bun run deploy:relay     # wrangler deploy the relay (→ @superone/relay)
bun run test:relay       # Run relay vitest suite
bun run build            # Production build (electron-vite only)
bun run preview          # Preview production build
bun run test             # Run all tests once (desktop + cross-workspace shared/ui tests)
bun run test:watch       # Run tests in watch mode
bun run typecheck        # Full type check across all workspaces
bun run typecheck:node   # Type check main/preload only (desktop)
bun run typecheck:web    # Type check renderer only (desktop)
bun run build:app        # Full packaged build (electron-vite + electron-builder)
bun run build:mac        # macOS package (DMG + ZIP)
bun run build:win        # Windows package (NSIS)
bun run build:linux      # Linux package (AppImage)
bun run storybook        # Start Storybook (collects stories from desktop + packages/ui)
```

To run a single test file: `bunx vitest run apps/desktop/src/path/to/file.test.ts` (vitest runs from `apps/desktop` cwd, so paths are relative to that workspace).

**Sandbox note**: `bun run test` (full suite) and any LAN/mDNS tests (`apps/desktop/src/main/lan-server.test.ts`, `apps/desktop/src/main/lan-advertiser.test.ts`) bind to `0.0.0.0:5353` / `127.0.0.1` and will fail with `EPERM` under the default sandbox. Run them with `dangerouslyDisableSandbox: true` (Bash tool) or outside the sandbox.

## Architecture

Three-process Electron architecture using **electron-vite**, all under `apps/desktop/`:

- **Main Process** (`apps/desktop/src/main/`) — Electron lifecycle, window management, IPC handlers, file system services. Compiled with Node.js target.
- **Preload** (`apps/desktop/src/preload/`) — Secure context bridge exposing `window.electron` API via `@electron-toolkit/preload`. Type declarations in `index.d.ts`.
- **Renderer** (`apps/desktop/src/renderer/`) — React 19 application. Entry point is `apps/desktop/src/renderer/index.html` → `apps/desktop/src/renderer/src/main.tsx`.

Build config: `apps/desktop/electron.vite.config.ts` with three sections (main, preload, renderer). Main uses `externalizeDeps` with `exclude: ['@superone/shared']` so the workspace package gets bundled inline (Node ESM can't load TS source at runtime); preload bundles all deps except `electron`; renderer uses React + Tailwind plugins.

### Path Alias

- **Inside `apps/desktop`**: `@/*` maps to `apps/desktop/src/renderer/src/*` (configured in `electron.vite.config.ts`, `tsconfig.web.json`, `vitest.config.ts`, `.storybook/main.ts`).
- **Cross-package**: code imports via package names — `@superone/shared/agent-types`, `@superone/ui/components/ui/button`, `@superone/ui/lib/utils`, etc. These resolve through `node_modules/@superone/*` workspace symlinks and each package's `exports` map.
- **Inside `packages/ui`** (and other packages): use relative paths only (`../lib/utils`, `./button`) — no `@/` alias.

### TypeScript Setup

Each workspace has its own tsconfig. `composite` is **not** used (apps are consumers, not library producers); cross-package imports resolve via `paths` mappings + `exports`.

- `packages/tsconfig/{base,react-library,electron-renderer,electron-node,nextjs}.json` — shared base configs
- `apps/desktop/tsconfig.node.json` — main + preload (extends `electron-node`)
- `apps/desktop/tsconfig.web.json` — renderer (extends `electron-renderer`, has `@/*` and `@superone/shared/*` paths)
- `apps/desktop/tsconfig.json` and root `tsconfig.json` — empty stubs (`files: []`, `include: []`) acting as IDE entry points only
- `apps/web/tsconfig.json` — extends `nextjs`
- `packages/{ui,shared}/tsconfig.json` — extend `react-library` / `base`

### Navigation

No URL-based router — views are driven by `useAppStore.view` state machine:

`startup` → `setup` → `main` → `settings`

Navigation via `navigateTo()` action. The `main` view has two layout modes: `canvas` and `coding`.

### State Management (Zustand)

Four stores with clear responsibilities:

- **`useAppStore`** — App lifecycle, folder/project management, layout mode, sidebar state, auto-update status, worktree management
- **`useChatStore`** — Multi-project chat sessions (`projectSessions: Record<path, SessionState>`), message streaming, permission handling, background sessions (`_bgSessions`)
- **`useSettingsStore`** — Resource CRUD (agents, skills, MCP configs, plugins), lazy-loaded per settings view
- **`useMiniAppStore`** — Mini-app discovery, install/uninstall actions, app list caching

Use `useActiveSession<T>(selector)` hook to read the active project's session state.

### IPC API

Two namespaces exposed via preload:

- **`window.agent`** — AI agent interaction, scoped by `projectPath`: `sendMessage()`, `interrupt()`, `respondToPermission()`, `resetSession()`, `parkSession()`, `activateSession()`, `onAgentEvent()`
- **`window.app`** — Global operations: folder management, git ops (including worktrees), session DB (CRUD), resource discovery, Claude setup/install, auto-update, Codex integration, plugin/skill/MCP/agent management, window state
- **`window.miniapp`** — Mini-app lifecycle: `list()`, `open()`, `close()`, `install()`, `uninstall()`, `pack()`, `getInstallMeta()`, tool/fs bridging, dev app detection

All IPC channels are defined as constants in `AgentIpcChannels` (`packages/shared/src/agent-types.ts`), grouped by namespace prefix (`app:`, `agent:`, `codex:`, `plugins:`, `skills:`, `mcp:`, `miniapp:`, `sessions:`, `updater:`).

### Remote Control (Mobile) Architecture

Session ownership is a **first-class property of the `Session` class itself**, not global service state. Each session carries:

- `owner: { kind: 'local' } | { kind: 'remote'; deviceId }` — who is currently driving turns
- `subscribers: Set<deviceId>` — which mobile devices are viewing
- `claim/release/subscribe/unsubscribe` API + `onLifecycle` event channel emitting `owner_changed` / `subscriber_added` / `subscriber_removed` / `closed`

`Session.send()` self-guards: when `providerOrigin === 'local'` and the session is owned remotely or has remote subscribers, it throws `SessionLockedError`. Lock checks live inside the session, not in IPC handler `if`-walls.

Modules under `apps/desktop/src/main/remote/`:

| Module | Responsibility |
|---|---|
| `device-registry.ts` | Single device-disconnect entry: `handleDeviceDisconnected(deviceId)` walks `sessionManager.forEachSession` and calls `release(deviceId) + unsubscribe(deviceId)`. Also `unsubscribeAll` / `releaseAll` for partial cleanups |
| `mobile-broadcaster.ts` | Routes agent events to mobile transport based on `session.subscribers` / `session.owner`. Filter decision lives here, not in transport |

`RemoteControlService` is a pure transport (relay + LAN, frame encoding, encryption). It no longer holds session-control state — `subscribedSession` and `remoteSessionFilter` were deleted; `subscribeSession/unsubscribeSession/setRemoteSessionFilter/clearRemoteSessionFilter/getSubscribedSession` were removed.

Codex and Claude remote turns share a single `ensureRemoteOwnership(deviceId, session, fn, opts?)` helper inside `AgentService`. The helper claims ownership and runs the turn but **does not auto-release** afterwards (mobile claim is persistent; release happens on `leave_session`, `unsubscribe_session`, device disconnect, or desktop kick). Provider backends (Claude, Codex) have zero awareness of ownership.

**Sender deviceId propagation**: `RemoteControlCallbacks.onCommand` carries `source: { deviceId, transport: 'lan' | 'relay' }`. `LanServer` reads it from the per-socket `ClientState`. **Relay** reads it from `frame.mobileDeviceId` injected by `RelaySession` Durable Object (relay protocol now supports `1 desktop : N mobile` per channel — sockets tagged `mobile:<deviceId>`). `AgentService.handleRemoteCommand(cmd, respond, source)` passes the real `source.deviceId` into `session.claim/release/subscribe/unsubscribe` — no placeholder strings, no inference.

**Multi-mobile per channel** (`super-one-relay`): one desktop's channel can host multiple mobile peers concurrently. Each mobile WS is tagged with its `mobileDeviceId` (passed via `?deviceId=` query). Mobile→desktop frames have `mobileDeviceId` injected by relay; desktop→mobile frames are broadcast to all mobile peers (except `kicked` which targets a specific deviceId). `peer_connected`/`peer_disconnected` carry `mobileDeviceId` so desktop only marks that specific device offline.

**`unsubscribe_session` protocol**: optional `sessionId` field. With sessionId → unsubscribe only that session. Without sessionId → unsubscribe all sessions the device is viewing (back-compat). Mobile (`remote_client.dart#unsubscribeSession`) passes the current sessionId from `chat_page.dart#_exitSessionMode`.

### Component Structure

shadcn/ui primitives live in `packages/ui` (shared by desktop + web). All other components are app-specific and live under `apps/desktop`:

```
packages/ui/src/components/ui/  — shadcn/ui primitives (New York style) + Lucide icons,
                                  consumed via `@superone/ui/components/ui/<name>`

apps/desktop/src/renderer/src/components/
├── chat/         — ChatPanel, ChatContent, ChatMessage, ChatInput, ToolBlock, SubagentBlock
│   ├── mention-node.ts     — Tiptap @mention extension
│   ├── slash-decoration.ts — Tiptap /command decoration
│   └── chat-shared.ts      — Streamdown plugins, formatting
├── coding/       — CodingLayout, ProjectSelector, StatusBar, TerminalPanel
├── miniapp/      — MiniAppFrame, MiniAppView, MiniAppIcon, MiniAppDevFrame, MiniAppOverlayPortal
├── sidebar/      — FileTree, ProjectSidebarRow, AppsPanel (drag-and-drop .s1app install)
├── AppSidebar    — Session list, folder tree, pending interaction badges
└── *Page.tsx     — Settings pages (Agents, Skills, MCP, Plugins), Startup, Setup
```

When adding a new shadcn primitive: run `bunx shadcn add <name>` from `packages/ui/` (its `components.json` is the single source of truth). Stories for primitives go alongside (e.g. `packages/ui/src/components/ui/button.stories.tsx`); Storybook's `stories` glob covers both packages/ui and apps/desktop.

### Key Dependencies

| Package | Purpose |
|---------|---------|
| `zustand` | State management (3 stores, see above) |
| `@modelcontextprotocol/sdk` | MCP Server for AI agent integration |
| `zod` | Schema validation (MCP tools, data models) |
| `tailwindcss` + `@tailwindcss/vite` | Styling (v4, import-based, OKLch colors) |
| `shadcn/ui` + `radix-ui` | Component primitives (New York style) |
| `lucide-react` | Icons |
| `@tiptap/react` | Rich text editor for chat input |
| `streamdown` | Markdown rendering in chat messages |
| `motion` | Animations (import from `motion/react`) |
| `better-sqlite3` | Session & message persistence (WAL mode) |
| `electron-updater` | Auto-update via GitHub Releases |
| `electron-builder` | App packaging (macOS/Windows/Linux) |
| `@openai/codex` | Codex CLI launcher + per-platform native binary (project drives it directly via app-server protocol; not the TS SDK) |
| `electron-log` | Structured logging (`apps/desktop/src/main/logger.ts`) |
| `diff` | Diff computation for file rewind |

### Persistence (SQLite)

Tables: `projects`, `sessions`, `chat_messages`. Messages stored as JSON blobs.

- Auto-saves on `message_complete` / `interrupt` / `error` via deferred `_saveSessionState()`
- Background sessions: streaming sessions parked to `_bgSessions` when switching projects, restored on `resumeSession()`
- `_historySessionId` tracks which DB session is loaded (enables resume from sidebar history)

### Shared Types

`packages/shared/src/agent-types.ts` — IPC-safe types (no SDK imports):

- `ChatMessage`, `ContentBlock` (text | thinking | tool_use | tool_result | image)
- `AgentEvent` (20+ event union: message_start, content_delta, permission_request, etc.)
- `PermissionRequest`, `AskUserQuestionRequest`, `PlanApprovalRequest`
- `TodoItem`, `ModelOption`, `SlashCommandInfo`, `AgentInfo`
- `UpdateEvent` (checking | available | not-available | download-progress | downloaded | error)
- `PermissionMode`: `default` → `acceptEdits` → `plan` → `bypassPermissions` (cycles)
- Codex types: `CodexThreadItem`, `CodexTurnInfo`, `CodexRunResult`, `CodexAuthStatus`

### Auto-Update

`apps/desktop/src/main/updater.ts` wraps `electron-updater` with an IPC push pattern:

- Guarded by `is.dev` — completely skipped in development unless `TEST_UPDATER=1`
- Distribution: artifacts hosted on Cloudflare R2, served via custom domain `https://dl.super-one.dev`. `electron-updater` uses the built-in `GenericProvider` (`publish.provider: generic` in `electron-builder.yml`); no auth tokens needed (bucket is public via custom domain)
- Channels: electron-builder auto-derives channel from `package.json` version — `0.1.0-alpha.3` → `alpha-mac.yml` / `alpha.yml` / `alpha-linux.yml`; future `1.0.0` → `latest-*.yml`. Channel is embedded in ASAR's `app-update.yml` at build time, so each installed client locks to the channel it was built for
- Events flow: `autoUpdater` → `webContents.send(UPDATER_EVENT)` → `useAppStore.handleUpdateEvent()` → `<UpdateNotification />`

Dev testing: `TEST_UPDATER=1 bun run dev` (uses `apps/desktop/dev-app-update.yml`, which points to the alpha channel on `dl.super-one.dev`)

Release flow: builds upload artifacts (dmg/exe/AppImage/blockmap + channel yml) to GitHub Actions artifacts, then `promote.yml` (a) creates a draft GitHub Release with **flat** asset layout (changelog mirror + serves the legacy GitHub-provider clients during the bridge period), then (b) restructures staging into `v${VERSION}/` subdirectory and rewrites `path` / `files[].url` in each yml via `yq`, then (c) `aws s3 sync staging/ s3://super-one-releases/` so R2 ends up as `bucket-root/{alpha,beta,latest}-*.yml` + `bucket-root/v0.1.0-alpha.4/{*.dmg,*.exe,*.AppImage,...}`.

R2 layout rationale: yml stays at bucket root because clients fetch it via fixed URL (can't include `${version}` macro since version is unknown until yml is read); binaries go under `v${VERSION}/` so the bucket root stays scannable as more releases accumulate. The `path:` and `files[].url:` fields in each yml carry the `v${VERSION}/` prefix so electron-updater resolves the correct URL automatically — zero client config.

Bridge mode: alpha clients built before the R2 switch have `provider: github` baked into ASAR's `app-update.yml` and embed `UPDATER_TOKEN` for private GitHub Release auth. They keep working because `promote.yml` still uploads to GitHub Release (flat layout). Once they auto-update to a post-switch build, that build's ASAR has `provider: generic` + `https://dl.super-one.dev`, so subsequent checks go to R2. Long-term policy: keep dual-publish indefinitely; **never** rotate `UPDATER_TOKEN` (legacy clients embed it).

### Codex Integration (Experimental)

`apps/desktop/src/main/codex/codex-experiment-service.ts` provides an alternative AI provider alongside Claude:

- Scoped per project like Claude sessions
- Supports `run`, `review`, `compact`, `steer`, `interrupt`
- Auth modes: `auto`, `chatgpt`, `apiKey` — managed via `codex:get-auth-status` / `codex:set-auth`
- Permission presets: `default` (sandboxed) and `full-access`
- Thread items stream via `codex_item_delta` agent events

### Build & Packaging

Configured via `apps/desktop/electron-builder.yml` (electron-vite natively supports this file):

- Output: `apps/desktop/dist/` directory
- `asarUnpack: "**/*.node"` — required for `better-sqlite3` native module
- `publish.provider: github` — electron-updater reads from GitHub Releases
- macOS: DMG + ZIP (universal). ZIP target required for auto-update. Code signing env vars commented out for now
- Windows: NSIS (x64 + arm64)
- Linux: AppImage (x64 + arm64)

### CI/CD & Release

`.github/workflows/build-{mac,win,linux}.yml` — manual `workflow_dispatch` per platform; `promote.yml` collects artifacts into a draft GitHub release:

- Three parallel jobs: macOS / Windows / Linux
- Flow: checkout → setup-bun → `bun install --frozen-lockfile` → `bun run build:{platform} -- --publish never` → `actions/upload-artifact@v4` from `apps/desktop/dist/*`
- Promote: `actions/download-artifact@v4` → `gh release create/upload`. The `upload-artifact` longest-common-prefix strip means downloaded files land flat at `staging/*` despite source paths under `apps/desktop/dist/`

Versioning: prerelease iterations use `-alpha.N` suffix (e.g. `0.1.0-alpha.1` → `0.1.0-alpha.2`). Patch number is reserved for stable releases (`0.1.0` → `0.1.1`).

Release steps:

```bash
# 1. Bump version in BOTH apps/desktop/package.json (the published app) and root package.json (kept in sync for visibility)
# 2. Commit and tag
git commit -am "chore(release): bump version to 0.1.0-alpha.3"
git tag v0.1.0-alpha.3
git push origin main --tags
# 3. Trigger build-{mac,win,linux}.yml workflow_dispatch, then promote.yml with the run IDs
gh release edit v0.1.0-alpha.3 --draft=false --prerelease  # alpha/beta must use --prerelease
```

## Styling

- **Theme**: Hermès-inspired warm cream + orange. Colors defined in OKLch color space (not hex/hsl) in `packages/ui/src/styles/theme.css` (`:root` + `.dark` + `@theme inline`). Apps import via `@import "@superone/ui/styles/theme.css"` and `@import "@superone/ui/styles/base.css"`. Desktop's `apps/desktop/src/renderer/src/styles/index.css` adds Electron-specific extras (animations, scrollbar, chat-md, tiptap)
- **Dark mode**: `.dark` class toggle on `<html>`, CSS variables auto-switch
- **Tailwind v4**: Import-based (`@import "tailwindcss"`), no config file, `@theme inline` block for design tokens
- **Component library**: shadcn/ui (New York style, `components.json`), Radix UI primitives
- **Chat markdown**: Scoped to `.chat-md` class, uses Streamdown's `data-streamdown` attributes
- **Responsive**: `@container` queries for chat panel width breakpoints (512px, 672px)

### Per-Harness Brand Theming

Light-mode brand hue is user-customizable per harness (Claude default 42° / Codex default 165°) via the palette icon in `AppSidebar.tsx`. The whole app's color temperature shifts with the slider.

**Architecture**:

- **Single writer**: `apps/desktop/src/renderer/src/hooks/useHarnessTheme.ts` is the **only** place that writes brand CSS variables. Mounted once at `App.tsx` top level. Watches `<html>.classList` via MutationObserver (not `useTheme()`, to avoid duplicate listener mount when both call the hook).
- **Constants**: `packages/shared/src/harness-brand.ts` exports `HARNESS_DEFAULT_BRAND_HUE`, `clampBrandHue` (0-360 wrap, doubles as CSS-injection防御), `brandHueToOklch`. Always go through these — never hardcode an `oklch(...)` string with a user-supplied hue.
- **Persistence**: `agentPreference.{claude,codex}.brandHue: number | null` in `app-settings.json`. `null` = use harness default. Reflected in `useAppStore.brandHues` (loaded once at app boot via `loadBrandHues`).
- **Token override scope**: 4 accent tokens (`--primary`, `--ring`, `--sidebar-primary`, `--sidebar-ring`) at high C (0.20), plus 11 surface tokens (`--background`, `--card`, `--popover`, `--secondary`, `--muted`, `--accent`, `--border`, `--input`, `--sidebar`, `--sidebar-accent`, `--sidebar-border`), plus 8 dark-text foreground tokens (`--foreground`, `--card-foreground`, `--popover-foreground`, `--secondary-foreground`, `--muted-foreground`, `--accent-foreground`, `--sidebar-foreground`, `--sidebar-accent-foreground`) — all at the L/C values from `packages/ui/src/styles/theme.css`. **Excluded** from hue control: `--primary-foreground` / `--sidebar-primary-foreground` (white text on brand button — must stay neutral for contrast) and `--destructive-foreground` (semantic). The hook also sets `<html data-harness="claude|codex">` for future scoped CSS hooks.
- **Dark-mode contract**: Dark mode **never** reads the user's `brandHue`. `useHarnessTheme` calls `removeProperty()` for every override token in dark mode, letting `:root.dark` defaults win. The palette icon also hides itself (`BrandColorPopover` returns `null` when `.dark`).

**Rules for adapting an element to brand color** (when extending coverage):

- **Dye existing elements, don't add new visual decorations**. Don't introduce `border-l-2`, color stripes, status badges, or extra DOM "to show brand". If a row uses `bg-sidebar-accent`, it's already following brand via surface tokens — extra decoration breaks super-one's克制 design language.
- **Color swap only, not interaction change**. Brand adaptation is a token swap. Don't promote `opacity-0` (hover-only) to `opacity-100` (always-on) under the guise of branding — that's an interaction change disguised as a color change.
- **Hardcoded colors → semantic tokens**: replace `text-purple-400`, `text-blue-400`, etc. with `text-primary` / `text-foreground` / `text-sidebar-foreground`. Sidebar elements stay in the `sidebar-*` namespace.
- **Semantic colors stay hardcoded**: red/green/yellow for error/success/warning, git status colors in `TreeRow.tsx`, `text-destructive` and any `variant="destructive"` — never replace these with brand color, they communicate state, not identity.
- **Trust existing token mappings**: don't add `style={{ color: 'var(--primary)' }}` to a component that already uses `text-primary` — it's redundant and harder to override.

## Debugging

To show raw input/output for specific tool calls in the chat UI, set the `RENDERER_VITE_DEBUG_TOOL_NAMES` environment variable before running dev:

```bash
RENDERER_VITE_DEBUG_TOOL_NAMES=TodoWrite,TaskCreate bun run dev
```

- Comma-separated list of tool names (case-insensitive, partial match)
- Only works in development mode (`import.meta.env.DEV`)
- Matching tool blocks render a debug view with prettified JSON input and raw output instead of the normal UI

### Event Trace (SQLite)

`apps/desktop/src/main/agent/event-trace.ts` — dev-only SQLite trace for debugging data flow across layers. Auto-creates `event-trace.db` in `apps/desktop/` (the `bun run dev` cwd; cleaned on each run).

**Writing traces** (main process, synchronous):
```typescript
import { trace } from './event-trace'
trace('agent.sdk', 'assistant', sdkMsg)              // SDK raw message
trace('agent.emit', 'content_delta', event, msgId)    // emitted AgentEvent
```

**Writing traces** (renderer process, via IPC):
```typescript
window.app.trace?.('agent.store', 'content_delta', data, messageId)
```

**Source namespaces**: `agent.sdk` (raw SDK messages, tagged with messageId), `agent.emit` (translated AgentEvents, tagged with messageId), `agent.store` (Zustand store deltas), `remote.out` (stripped mobile events, derived by convert-trace). Extensible to `mcp.*`, `codex.*`, etc.

**Saving & converting recordings:**
```bash
# Save current trace DB as a named recording
./scripts/save-recording.sh claude-todos    # → scripts/recordings/claude-todos.db

# Convert agent.emit → remote.out (offline, re-runnable after changing strip logic)
bun run scripts/convert-trace.ts scripts/recordings/claude-todos.db
```

**Querying** (from terminal while app is running):
```bash
# Event overview
sqlite3 event-trace.db "SELECT source, type, count(*) c FROM events GROUP BY source, type ORDER BY c DESC"

# Trace a message across all layers
sqlite3 event-trace.db "SELECT id, ts, source, type FROM events WHERE tag='<messageId>' ORDER BY id"

# Recent events from a specific layer
sqlite3 event-trace.db "SELECT ts, type, data FROM events WHERE source='agent.sdk' ORDER BY id DESC LIMIT 20"
```

### Log File

In development mode, `electron-log` writes to `apps/desktop/dev.log` (relative to the dev cwd; configured in `apps/desktop/src/main/logger.ts`). The dev script auto-deletes the previous `dev.log` on each run to keep it small. When debugging main process issues, read this file to inspect logs instead of guessing. The log format is `[date time] [level] text`.

For packaged builds (`build:mac-dev`), logs are written to `~/Library/Logs/super-one/main.log` (macOS default `electron-log` location).

## Testing

Follow **Test-Driven Development** with an **integration-first** philosophy — the testing trophy, not the pyramid. Most bugs in this Electron app come from cross-layer wire-up (store → IPC → session → backend), not single-function logic errors. Integration tests catch these; unit tests don't.

### TDD Workflow (ORDER MATTERS)

1. **Red**: Write a failing test at the layer where the bug or feature lives
2. **Green**: Write the minimum code to make the test pass
3. **Refactor**: Clean up the code while keeping tests green

### Setup

- **Framework**: Vitest with globals enabled
- **Environment**: `node` by default, `jsdom` for `.test.tsx` files (auto-matched)
- **Setup file**: `apps/desktop/vitest.setup.ts` (imports `@testing-library/jest-dom/vitest`, polyfills ResizeObserver, sets up mocked `window.app`/`window.agent` proxies)
- **Cross-workspace include**: `apps/desktop/vitest.config.ts` adds `../../packages/{shared,ui}/src/**/*.{test,spec}.*` so shared/ui tests run in the same suite
- **Directory layout**:
  - Unit + component-level integration: co-located as `*.test.ts` / `*.test.tsx` next to source (in any workspace)
  - Cross-layer / E2E integration: `apps/desktop/src/test/integration/`, named by scenario (e.g. `permission-flow.test.ts`)
  - Shared fixtures: `apps/desktop/src/test/fixtures/` (extract when used in 2+ files)

### Layers — prefer higher (more integration)

| Layer | What it tests | Mock only | When to use |
|---|---|---|---|
| **Integration (default)** | Multiple real modules collaborating across a user scenario | True external boundaries: Claude SDK subprocess, `window.agent` IPC, `fs`, `child_process`, network | **Most tests** — permission flow, session lifecycle, IPC wire-up, store reducers over multi-step scenarios |
| **Component** | Single React component + user events | `window.agent`, `window.app` | Keyboard shortcuts, focus management, visible UI state |
| **Unit** | Pure function / class in isolation | — | Complex branching logic in utilities (`tool-display.ts`, `claude-permissions.ts`, schema validators) |

### Rules

- **Default to integration**: when adding a feature or fixing a bug, write the test at the highest reasonable layer. Pick unit only when the logic under test is pure and complex (parsers, schema validators, reducers with many branches).
- **Scenario-style naming**: `describe` uses a noun phrase for the scenario (`describe('session cwd switching', ...)`); `it` combines behavior with condition/result (`it('defers rebuild until next send when cwd changes mid-stream', ...)`). Reading the `it` name should surface both trigger and outcome — no given/when/then template required. Prefer scenarios over function names — `it('switches session to acceptEdits after approving plan')` beats `it('setPermissionMode calls backend')`.
- **Mock only at true boundaries**: real `Session`, real Zustand stores, real reducers, real IPC-handler logic. Mock only the Claude SDK subprocess (via `FakeBackend`), `window.agent`/`window.app` in renderer, `fs`, `child_process`, and network. If you're reaching for `vi.mock` on an internal module, stop and re-scope the test one layer up.
- **Regression test = scenario test**: every bug fix gets an integration test that reproduces the bug scenario at the layer where it lived — not a narrow function test of the fix site.
- **Skip trivial forwarding**: don't test `foo.bar(x)` → `api.bar(x)` passthroughs. Test the scenario across the forwarding, not the forwarding itself.
- **Run tests after changes**: always `bun run test` after implementing.

### Good examples to follow

- `apps/desktop/src/main/session/session.test.ts` — `FakeBackend` + real `Session`; scenarios like "switch cwd during streaming defers rebuild to next send", "bypass mode boundary triggers backend rebuild"
- `apps/desktop/src/renderer/src/stores/chat-store.test.ts` — real Zustand store + mocked `window.agent`; scenarios like "respondToPlanApproval triggers setPermissionMode IPC when approved"
- `apps/desktop/src/main/session/isolation.integration.test.ts` — multi-session isolation scenarios with fake backends

### Mini-App Platform

Mini-apps are sandboxed web apps (HTML/CSS/JS) that run in iframes and are controlled by AI agents through MCP tools.

**Key modules:**

| Module | Path | Purpose |
|--------|------|---------|
| MCP Server | `apps/desktop/src/main/mcp/superone-mcp-server.ts` | Built-in MCP tools (`miniapp_dev_read_guide`, `miniapp_dev_setup`, `miniapp_dev_register`, `miniapp_dev_pack`, `miniapp_dev_update_types`, `session_rename`) + dynamic tool registration per app. Guide content in `apps/desktop/src/main/mcp/guides/`. Naming convention: `<category>_<subcategory>_<verb>` — `miniapp_dev_*` for mini-app development workflow, `session_*` for chat session management. Built-in tool entries live in `BUILT_IN_SUPERONE_TOOL_NAMES` (`superone-mcp-builtins.ts`); they auto-bypass permission prompts via `isBuiltInSuperoneTool` |
| Service | `apps/desktop/src/main/miniapp/miniapp-service.ts` | App discovery, manifest parsing (Zod validated), filesystem operations |
| Schema | `apps/desktop/src/main/miniapp/miniapp-schema.ts` | Zod v4 manifest validation schema |
| Packager | `apps/desktop/src/main/miniapp/miniapp-packager.ts` | `.s1app` packaging (zip + integrity), install/uninstall, SHA-256 verification |
| API Runtime | `packages/shared/src/miniapp-api-runtime.js` | Shared `window.superone.*` API logic (transport-agnostic). Single source of truth for both bridge and preload |
| Bridge | `apps/desktop/src/main/miniapp/miniapp-bridge.ts` | Inlines API runtime (`?raw`) + postMessage transport → `<script>` tag for iframe |
| Preload | `apps/desktop/src/preload/miniapp-preload.ts` | Imports API runtime + ipcRenderer transport → `contextBridge` for webview |
| Overlay | `apps/desktop/src/renderer/src/components/miniapp/MiniAppOverlayPortal.tsx` | Host-rendered toast/tooltip/context menu for sandboxed mini-apps |

**Installation flow:** `.s1app` file (zip) → extract to temp → validate manifest (Zod) → verify integrity (SHA-256) → copy to `~/.superone/apps/<appId>/` → write `install.json` metadata. Users can drag-and-drop `.s1app` files onto the Apps panel in the sidebar.

**Manifest** requires `appId` and `name`; `version` and `author` are required for packaging. Schema enforces `appId` format (`^[a-z0-9][a-z0-9_-]*$`) and tool name format (`^[a-z0-9_]+$`).

**⚠️ Two runtime paths — always wire BOTH (recurring footgun):**

A mini-app runs in **one of two transports depending on `manifest.isDev`**, and they do NOT share transport wiring (only the `createSuperoneApi` *logic* is shared):

| | Production (`isDev` falsy) | Dev (`isDev: true`) |
|---|---|---|
| Container | sandboxed `<iframe src="superone-app://…">` | `<webview>` |
| Bridge injected by | `miniapp-bridge.ts` (`?raw` runtime + `postMessage`) | `miniapp-preload.ts` (`ipcRenderer.sendToHost`) |
| Host side | `useMiniAppBridge` → `handleMiniAppMessage` | `MiniAppDevFrame` → `handleMiniAppMessage` |
| Request→response replies reach the app via | `postMessage` back into the iframe (works for any type) | **only** the explicit channel list in `miniapp-preload.ts` |
| Host→panel push events reach the app via | a `useMiniAppBridge` `useEffect` (`sendToFrame`) | a **separate** `MiniAppDevFrame` `useEffect` (`webview.send`) **+** `miniapp-preload.ts` `eventChannels` |

So for **any new request/response message type**: add its response channel to the `ipcRenderer.on(... dispatchResponse)` list in `miniapp-preload.ts`, or the dev (webview) path's `transport.request` promise **hangs forever** (the iframe path silently works, so this is easy to miss — `hello` is `isDev:true`, test with it).
For **any new host→panel push event**: forward it in **both** `useMiniAppBridge` *and* `MiniAppDevFrame`, and add the channel to `eventChannels` in `miniapp-preload.ts`.

**Adding a new mini-app bridge API:**

1. `packages/shared/src/miniapp-api-runtime.js` — Add the method to `createSuperoneApi()`. Use `transport.send()` for fire-and-forget, `transport.request()` for request-response.
2. `packages/shared/src/miniapp-api-runtime.d.ts` — Add TypeScript signature to `SuperoneApi` interface.
3. `apps/desktop/src/main/miniapp/miniapp-templates.ts` — Update `generateSuperoneDts()` to include the new API in the React template's type declarations.
4. `packages/shared/src/miniapp-types.ts` — If a new message type is added, append it to `MiniAppBridgeMessageType`.
5. If the API needs host-side handling: add a case in `apps/desktop/src/renderer/src/hooks/miniapp-message-handler.ts` (shared by both the iframe and webview host paths).
6. If the API needs main process handling: add a handler in `apps/desktop/src/main/miniapp/miniapp-service.ts` or `apps/desktop/src/main/index.ts`.
7. **Dev/webview path (do not skip):** for a request/response type, add `ipcRenderer.on('<resType>', (_e, d) => dispatchResponse(d))` to `miniapp-preload.ts`; for a host→panel push event, add the channel to `eventChannels` in `miniapp-preload.ts` **and** forward it in `MiniAppDevFrame` (mirror the existing `onGitHeadChangeEvent`/`onWorkerEvent` `useEffect`). The production iframe path needs the matching forward in `useMiniAppBridge`.
8. Update the relevant guide in `apps/desktop/src/main/mcp/guides/api/`.
9. Update `apps/desktop/examples/miniapp/hello/index.html` to demo the new API (`hello` is `isDev:true`, so it also exercises the webview path).

The `createSuperoneApi` **logic** is shared (don't reimplement it), but the **transport wiring is per-path** — see the "Two runtime paths" table above; missing the dev-path wiring is the most common mini-app bug.

## Conventions

- **Package manager**: bun (not npm/pnpm), use bunx instead of npx 
- **Module system**: ES modules (`"type": "module"`)
- **Window style**: macOS hiddenInset titlebar with traffic lights at (16, 16)
- **Commit messages**: `<type>(<scope>): <description>` (e.g. `feat(mcp): add document tools`)
- **Sidebar styling**: Use sidebar-specific color tokens (`bg-sidebar`, `text-sidebar-foreground`, `bg-sidebar-accent`, `text-sidebar-accent-foreground`, `border-sidebar-border`, etc.) instead of generic tokens (`bg-muted`, `text-muted-foreground`, etc.) for all elements inside the sidebar
- **Animations**: Use `motion` library (`import from 'motion/react'`) for UI animations (expand/collapse, enter/exit, layout transitions). Prefer `AnimatePresence` + `motion.div` over CSS transitions for dynamic mount/unmount animations
- **ProseMirror plugins**: Never use `doc.textContent` for structural decisions (emptiness check, command detection, position calculation, argument counting). It silently skips atom nodes (`MentionNode` in this repo is `atom: true`), so any logic built on it breaks the moment a mention chip — or any future atom node — appears. Use structural API instead: `doc.childCount` / `firstChild.content.size` for emptiness; `paragraph.firstChild.text` for content sniffing; `1 + paragraph.content.size` for end-of-paragraph position; `paragraph.forEach((node, _offset, index) => ...)` for iterating inline children (treat atom nodes explicitly). `element.textContent = ...` on widget DOM nodes is unrelated and fine.
