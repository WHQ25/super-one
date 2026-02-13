# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SuperOne is an meta desktop app built with Electron. It can be a IDE, it also provide a canavs for user to create their own app using coding agent as agentic engine. Inspired by Pencil.dev's MCP Server pattern.

## Commands

```bash
bun run dev              # Start Electron app with hot reload
bun run build            # Production build
bun run preview          # Preview production build
bun run typecheck        # Full type check (main + renderer)
bun run typecheck:node   # Type check main/preload only
bun run typecheck:web    # Type check renderer only
```

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

- **`useAppStore`** — App lifecycle, folder/project management, layout mode, sidebar state
- **`useChatStore`** — Multi-project chat sessions (`projectSessions: Record<path, SessionState>`), message streaming, permission handling, background sessions (`_bgSessions`)
- **`useSettingsStore`** — Resource CRUD (agents, skills, MCP configs, plugins), lazy-loaded per settings view

Use `useActiveSession<T>(selector)` hook to read the active project's session state.

### IPC API

Two namespaces exposed via preload:

- **`window.agent`** — AI agent interaction, scoped by `projectPath`: `sendMessage()`, `interrupt()`, `respondToPermission()`, `resetSession()`, `parkSession()`, `activateSession()`, `onAgentEvent()`
- **`window.app`** — Global operations: folder management, git ops, session DB (CRUD), resource discovery, Claude setup/install, window state

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
| `better-sqlite3` | Session & message persistence (WAL mode) |

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
- `PermissionMode`: `default` → `acceptEdits` → `plan` → `bypassPermissions` (cycles)

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

## Conventions

- **Package manager**: Bun (not npm/pnpm)
- **Module system**: ES modules (`"type": "module"`)
- **Window style**: macOS hiddenInset titlebar with traffic lights at (16, 16)
- **Commit messages**: `<type>(<scope>): <description>` (e.g. `feat(mcp): add document tools`)
- **Sidebar styling**: Use sidebar-specific color tokens (`bg-sidebar`, `text-sidebar-foreground`, `bg-sidebar-accent`, `text-sidebar-accent-foreground`, `border-sidebar-border`, etc.) instead of generic tokens (`bg-muted`, `text-muted-foreground`, etc.) for all elements inside the sidebar
