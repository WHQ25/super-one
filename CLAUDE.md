# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SuperOne is an meta desktop app built with Electron. It can be a IDE, it also provide a canavs for user to create their own app using coding agent as agentic engine. Inspired by Pencil.dev's MCP Server pattern.

## Commands

```bash
bun run dev              # Start Electron app with hot reload
bun run build            # Production build (electron-vite only)
bun run preview          # Preview production build
bun run test             # Run all tests once
bun run test:watch       # Run tests in watch mode
bun run typecheck        # Full type check (main + renderer)
bun run typecheck:node   # Type check main/preload only
bun run typecheck:web    # Type check renderer only
bun run build:app        # Full packaged build (electron-vite + electron-builder)
bun run build:mac        # macOS package (DMG + ZIP)
bun run build:win        # Windows package (NSIS)
bun run build:linux      # Linux package (AppImage)
```

To run a single test file: `bunx vitest run src/path/to/file.test.ts`

## Architecture

Three-process Electron architecture using **electron-vite**:

- **Main Process** (`src/main/`) — Electron lifecycle, window management, IPC handlers, file system services. Compiled with Node.js target.
- **Preload** (`src/preload/`) — Secure context bridge exposing `window.electron` API via `@electron-toolkit/preload`. Type declarations in `index.d.ts`.
- **Renderer** (`src/renderer/`) — React 19 application. Entry point is `src/renderer/index.html` → `src/renderer/src/main.tsx`.

Build config: `electron.vite.config.ts` with three sections (main, preload, renderer). Each uses `externalizeDepsPlugin()` for main/preload; renderer uses React + Tailwind plugins.

### Path Alias

`@/*` maps to `src/renderer/src/*` (configured in both `electron.vite.config.ts` and `tsconfig.web.json`).

### TypeScript Setup

- `tsconfig.node.json` — main process + preload (ESNext, no DOM)
- `tsconfig.web.json` — renderer (ESNext + DOM, has `@/*` path alias)
- `tsconfig.json` — composite root referencing both

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

All IPC channels are defined as constants in `AgentIpcChannels` (`src/shared/agent-types.ts`), grouped by namespace prefix (`app:`, `agent:`, `codex:`, `plugins:`, `skills:`, `mcp:`, `miniapp:`, `sessions:`, `updater:`).

### Component Structure

```
src/renderer/src/components/
├── ui/           — shadcn/ui primitives (New York style) + Lucide icons
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
| `@openai/codex-sdk` | Codex AI integration (experimental) |
| `electron-log` | Structured logging (`src/main/logger.ts`) |
| `diff` | Diff computation for file rewind |

### Persistence (SQLite)

Tables: `projects`, `sessions`, `chat_messages`. Messages stored as JSON blobs.

- Auto-saves on `message_complete` / `interrupt` / `error` via deferred `_saveSessionState()`
- Background sessions: streaming sessions parked to `_bgSessions` when switching projects, restored on `resumeSession()`
- `_historySessionId` tracks which DB session is loaded (enables resume from sidebar history)

### Shared Types

`src/shared/agent-types.ts` — IPC-safe types (no SDK imports):

- `ChatMessage`, `ContentBlock` (text | thinking | tool_use | tool_result | image)
- `AgentEvent` (20+ event union: message_start, content_delta, permission_request, etc.)
- `PermissionRequest`, `AskUserQuestionRequest`, `PlanApprovalRequest`
- `TodoItem`, `ModelOption`, `SlashCommandInfo`, `AgentInfo`
- `UpdateEvent` (checking | available | not-available | download-progress | downloaded | error)
- `PermissionMode`: `default` → `acceptEdits` → `plan` → `bypassPermissions` (cycles)
- Codex types: `CodexThreadItem`, `CodexTurnInfo`, `CodexRunResult`, `CodexAuthStatus`

### Auto-Update

`src/main/updater.ts` wraps `electron-updater` with an IPC push pattern:

- Guarded by `is.dev` — completely skipped in development unless `TEST_UPDATER=1`
- Private repo auth: `UPDATER_TOKEN` → Vite `define` → `process.env.GH_TOKEN` at runtime (`PrivateGitHubProvider` reads this)
- Prerelease behavior: version with `-alpha`/`-beta` suffix auto-enables `allowPrerelease`, which prefers releases with `prerelease: true` flag on GitHub. **All alpha/beta releases MUST be marked prerelease on GitHub.**
- Events flow: `autoUpdater` → `webContents.send(UPDATER_EVENT)` → `useAppStore.handleUpdateEvent()` → `<UpdateNotification />`

Dev testing: `TEST_UPDATER=1 UPDATER_TOKEN=<token> bun run dev` (requires `dev-app-update.yml` in project root)

### Codex Integration (Experimental)

`src/main/codex/codex-experiment-service.ts` provides an alternative AI provider alongside Claude:

- Scoped per project like Claude sessions
- Supports `run`, `review`, `compact`, `steer`, `interrupt`
- Auth modes: `auto`, `chatgpt`, `apiKey` — managed via `codex:get-auth-status` / `codex:set-auth`
- Permission presets: `default` (sandboxed) and `full-access`
- Thread items stream via `codex_item_delta` agent events

### Build & Packaging

Configured via `electron-builder.yml` (electron-vite natively supports this file):

- Output: `dist/` directory
- `asarUnpack: "**/*.node"` — required for `better-sqlite3` native module
- `publish.provider: github` — electron-updater reads from GitHub Releases
- macOS: DMG + ZIP (universal). ZIP target required for auto-update. Code signing env vars commented out for now
- Windows: NSIS (x64 + arm64)
- Linux: AppImage (x64 + arm64)

### CI/CD & Release

`.github/workflows/release.yml` — triggered on `push tags: v*`:

- Three parallel jobs: macOS / Windows / Linux
- Flow: checkout → setup-bun → `bun install --frozen-lockfile` → `bun run build:{platform} -- --publish always`

Versioning: prerelease iterations use `-alpha.N` suffix (e.g. `0.1.0-alpha.1` → `0.1.0-alpha.2`). Patch number is reserved for stable releases (`0.1.0` → `0.1.1`).

Release steps:

```bash
# 1. Bump version in package.json
# 2. Commit and tag
git commit -am "chore(release): bump version to 0.1.0-alpha.3"
git tag v0.1.0-alpha.3
git push origin main --tags
# 3. Wait for CI, then publish
gh release edit v0.1.0-alpha.3 --draft=false --prerelease  # alpha/beta must use --prerelease
```

## Styling

- **Theme**: Hermès-inspired warm cream + orange. Colors defined in OKLch color space (not hex/hsl) in `src/renderer/src/styles/index.css`
- **Dark mode**: `.dark` class toggle on `<html>`, CSS variables auto-switch
- **Tailwind v4**: Import-based (`@import "tailwindcss"`), no config file, `@theme inline` block for design tokens
- **Component library**: shadcn/ui (New York style, `components.json`), Radix UI primitives
- **Chat markdown**: Scoped to `.chat-md` class, uses Streamdown's `data-streamdown` attributes
- **Responsive**: `@container` queries for chat panel width breakpoints (512px, 672px)

## Debugging

To show raw input/output for specific tool calls in the chat UI, set the `RENDERER_VITE_DEBUG_TOOL_NAMES` environment variable before running dev:

```bash
RENDERER_VITE_DEBUG_TOOL_NAMES=TodoWrite,TaskCreate bun run dev
```

- Comma-separated list of tool names (case-insensitive, partial match)
- Only works in development mode (`import.meta.env.DEV`)
- Matching tool blocks render a debug view with prettified JSON input and raw output instead of the normal UI

### Event Trace (SQLite)

`src/main/agent/event-trace.ts` — dev-only SQLite trace for debugging data flow across layers. Auto-creates `event-trace.db` in project root (cleaned on each `bun run dev`).

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
./scripts/save-recording.sh claude-todos    # → recordings/claude-todos.db

# Convert agent.emit → remote.out (offline, re-runnable after changing strip logic)
bun run scripts/convert-trace.ts recordings/claude-todos.db
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

In development mode, `electron-log` writes to `dev.log` in the project root (configured in `src/main/logger.ts`). The dev script auto-deletes the previous `dev.log` on each run to keep it small. When debugging main process issues, read this file to inspect logs instead of guessing. The log format is `[date time] [level] text`.

For packaged builds (`build:mac-dev`), logs are written to `~/Library/Logs/super-one/main.log` (macOS default `electron-log` location).

## Testing (TDD)

Follow **Test-Driven Development** — write tests before implementation.

### TDD Workflow

1. **Red**: Write a failing test that describes the desired behavior
2. **Green**: Write the minimum code to make the test pass
3. **Refactor**: Clean up the code while keeping tests green

### Setup

- **Framework**: Vitest with globals enabled
- **Environment**: `node` by default, `jsdom` for `.test.tsx` files (auto-matched)
- **Setup file**: `vitest.setup.ts` (imports `@testing-library/jest-dom/vitest`)
- **Co-location**: Test files live next to source files as `*.test.ts` / `*.test.tsx`

### Rules

- **Tests first**: For new features and bug fixes, write the test before writing the implementation. For bug fixes, the test should reproduce the bug (fail), then the fix makes it pass.
- **Run tests after changes**: Always run `bun run test` after implementing to verify all tests pass.
- **Scope**: Test pure logic, utilities, store actions, and IPC handlers. Do not test trivial UI wiring or third-party library internals.
- **Naming**: Use descriptive `describe` / `it` blocks: `describe('functionName', () => { it('should return X when given Y', ...) })`.
- **No mocking by default**: Prefer testing real logic. Only mock external boundaries (IPC, filesystem, network).
- **Regression tests for bug fixes**: Every bug fix must include a test that reproduces the bug scenario. This prevents the same bug from reappearing in the future.

### Mini-App Platform

Mini-apps are sandboxed web apps (HTML/CSS/JS) that run in iframes and are controlled by AI agents through MCP tools.

**Key modules:**

| Module | Path | Purpose |
|--------|------|---------|
| MCP Server | `src/main/mcp/superone-mcp-server.ts` | Built-in MCP tools (`read_miniapp_guide`, `list_apps`, `setup_mini_app_dev`, `pack_mini_app`) + dynamic tool registration per app. Guide content in `src/main/mcp/guides/` |
| Service | `src/main/miniapp/miniapp-service.ts` | App discovery, manifest parsing (Zod validated), filesystem operations |
| Schema | `src/main/miniapp/miniapp-schema.ts` | Zod v4 manifest validation schema |
| Packager | `src/main/miniapp/miniapp-packager.ts` | `.s1app` packaging (zip + integrity), install/uninstall, SHA-256 verification |
| API Runtime | `src/shared/miniapp-api-runtime.js` | Shared `window.superone.*` API logic (transport-agnostic). Single source of truth for both bridge and preload |
| Bridge | `src/main/miniapp/miniapp-bridge.ts` | Inlines API runtime (`?raw`) + postMessage transport → `<script>` tag for iframe |
| Preload | `src/preload/miniapp-preload.ts` | Imports API runtime + ipcRenderer transport → `contextBridge` for webview |
| Overlay | `src/renderer/src/components/miniapp/MiniAppOverlayPortal.tsx` | Host-rendered toast/tooltip/context menu for sandboxed mini-apps |

**Installation flow:** `.s1app` file (zip) → extract to temp → validate manifest (Zod) → verify integrity (SHA-256) → copy to `~/.superone/apps/<appId>/` → write `install.json` metadata. Users can drag-and-drop `.s1app` files onto the Apps panel in the sidebar.

**Manifest** requires `appId` and `name`; `version` and `author` are required for packaging. Schema enforces `appId` format (`^[a-z0-9][a-z0-9_-]*$`) and tool name format (`^[a-z0-9_]+$`).

**Adding a new mini-app bridge API:**

1. `src/shared/miniapp-api-runtime.js` — Add the method to `createSuperoneApi()`. Use `transport.send()` for fire-and-forget, `transport.request()` for request-response.
2. `src/shared/miniapp-api-runtime.d.ts` — Add TypeScript signature to `SuperoneApi` interface.
3. `src/main/miniapp/miniapp-templates.ts` — Update `generateSuperoneDts()` to include the new API in the React template's type declarations.
4. `src/shared/miniapp-types.ts` — If a new message type is added, append it to `MiniAppBridgeMessageType`.
5. If the API needs host-side handling: add a case in `src/renderer/src/hooks/miniapp-message-handler.ts`.
6. If the API needs main process handling: add a handler in `src/main/miniapp/miniapp-service.ts` or `src/main/index.ts`.
7. If the API needs a new IPC response channel: add `ipcRenderer.on(channel, dispatchResponse)` in `src/preload/miniapp-preload.ts`.
8. Update the relevant guide in `src/main/mcp/guides/api/`.
9. Update `examples/miniapp/hello/index.html` to demo the new API.

Bridge and preload share the same runtime — **no need to update API logic in two places**.

## Conventions

- **Package manager**: bun (not npm/pnpm), use bunx instead of npx 
- **Module system**: ES modules (`"type": "module"`)
- **Window style**: macOS hiddenInset titlebar with traffic lights at (16, 16)
- **Commit messages**: `<type>(<scope>): <description>` (e.g. `feat(mcp): add document tools`)
- **Sidebar styling**: Use sidebar-specific color tokens (`bg-sidebar`, `text-sidebar-foreground`, `bg-sidebar-accent`, `text-sidebar-accent-foreground`, `border-sidebar-border`, etc.) instead of generic tokens (`bg-muted`, `text-muted-foreground`, etc.) for all elements inside the sidebar
- **Animations**: Use `motion` library (`import from 'motion/react'`) for UI animations (expand/collapse, enter/exit, layout transitions). Prefer `AnimatePresence` + `motion.div` over CSS transitions for dynamic mount/unmount animations
