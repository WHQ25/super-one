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

Three stores with clear responsibilities:

- **`useAppStore`** — App lifecycle, folder/project management, layout mode, sidebar state, auto-update status, worktree management
- **`useChatStore`** — Multi-project chat sessions (`projectSessions: Record<path, SessionState>`), message streaming, permission handling, background sessions (`_bgSessions`)
- **`useSettingsStore`** — Resource CRUD (agents, skills, MCP configs, plugins), lazy-loaded per settings view

Use `useActiveSession<T>(selector)` hook to read the active project's session state.

### IPC API

Two namespaces exposed via preload:

- **`window.agent`** — AI agent interaction, scoped by `projectPath`: `sendMessage()`, `interrupt()`, `respondToPermission()`, `resetSession()`, `parkSession()`, `activateSession()`, `onAgentEvent()`
- **`window.app`** — Global operations: folder management, git ops (including worktrees), session DB (CRUD), resource discovery, Claude setup/install, auto-update, Codex integration, plugin/skill/MCP/agent management, window state

All IPC channels are defined as constants in `AgentIpcChannels` (`src/shared/agent-types.ts`), grouped by namespace prefix (`app:`, `agent:`, `codex:`, `plugins:`, `skills:`, `mcp:`, `sessions:`, `updater:`).

### Component Structure

```
src/renderer/src/components/
├── ui/           — shadcn/ui primitives (New York style) + Lucide icons
├── chat/         — ChatPanel, ChatContent, ChatMessage, ChatInput, ToolBlock, SubagentBlock
│   ├── mention-node.ts     — Tiptap @mention extension
│   ├── slash-decoration.ts — Tiptap /command decoration
│   └── chat-shared.ts      — Streamdown plugins, formatting
├── coding/       — CodingLayout, ProjectSelector, StatusBar, TerminalPanel
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

**Source namespaces**: `agent.sdk` (raw SDK messages), `agent.emit` (translated AgentEvents), `agent.store` (Zustand store deltas). Extensible to `mcp.*`, `codex.*`, etc.

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

## Conventions

- **Package manager**: bun (not npm/pnpm), use bunx instead of npx 
- **Module system**: ES modules (`"type": "module"`)
- **Window style**: macOS hiddenInset titlebar with traffic lights at (16, 16)
- **Commit messages**: `<type>(<scope>): <description>` (e.g. `feat(mcp): add document tools`)
- **Sidebar styling**: Use sidebar-specific color tokens (`bg-sidebar`, `text-sidebar-foreground`, `bg-sidebar-accent`, `text-sidebar-accent-foreground`, `border-sidebar-border`, etc.) instead of generic tokens (`bg-muted`, `text-muted-foreground`, etc.) for all elements inside the sidebar
- **Animations**: Use `motion` library (`import from 'motion/react'`) for UI animations (expand/collapse, enter/exit, layout transitions). Prefer `AnimatePresence` + `motion.div` over CSS transitions for dynamic mount/unmount animations
