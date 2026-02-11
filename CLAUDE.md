# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SuperPM Desktop is an AI-powered product design tool built with Electron. It helps users articulate what their product is and what it roughly looks like, using MCP (Model Context Protocol) to let external AI agents (Claude Code, Codex, OpenCode) interact with the application content. Inspired by Pencil.dev's MCP Server pattern.

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

### Key Dependencies

| Package | Purpose |
|---------|---------|
| `zustand` | State management (renderer) |
| `react-router-dom` | Client-side routing (renderer) |
| `@modelcontextprotocol/sdk` | MCP Server for AI agent integration |
| `zod` | Schema validation (MCP tools, data models) |
| `tailwindcss` + `@tailwindcss/vite` | Styling (v4, import-based) |

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
