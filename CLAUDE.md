# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. It is intentionally kept lean: it covers the **monorepo structure, cross-package resolution, and repo-wide conventions** only. Workspace-specific architecture lives in per-workspace `CLAUDE.md` files (loaded additively when you work in that directory — see **Per-Workspace Guidance** below).

## Project Overview

SuperOne is an meta desktop app built with Electron. It can be a IDE, it also provide a canavs for user to create their own app using coding agent as agentic engine. Inspired by Pencil.dev's MCP Server pattern.

## Monorepo Layout

This repo is a **bun workspaces monorepo** (no turborepo/nx). Linker is hoisted (`bunfig.toml`) so transitive deps remain reachable like a single-package install.

```
super-one/
  apps/
    desktop/         — Electron app (was the entire repo pre-monorepo)
    cli/             — `superone` headless environment CLI / remote backend (no Electron)
    web/             — Next.js 16 marketing/docs/demos site (App Router + Turbopack)
    relay/           — Cloudflare Workers (Durable Objects) — mobile↔desktop relay protocol
  packages/
    shared/          — Neutral types, harness-brand, i18n, miniapp runtime (no Electron deps)
    ui/              — shadcn primitives + OKLch theme CSS, shared by desktop + web
    runtime/         — @superone/runtime — session/fs/git/lease/spawn-env/crypto (always needed)
    claude/          — @superone/claude — Claude harness (opt-in)
    codex/           — @superone/codex — Codex harness (opt-in)
    acp/             — @superone/acp — ACP harness (opt-in)
    opencode/        — @superone/opencode — OpenCode harness (opt-in)
    tsconfig/        — Shared base/react-library/electron-{node,renderer}/nextjs configs
```

Workspace package names: `@superone/desktop`, `@superone/cli`, `@superone/web`,
`@superone/relay`, `@superone/ui`, `@superone/shared`, `@superone/runtime`,
`@superone/claude`, `@superone/codex`, `@superone/acp`, `@superone/opencode`,
`@superone/tsconfig`. All `private: true`.

### Node package layout (enable harness = depend on package)

| Package | npm name | When to depend |
|---------|----------|----------------|
| Runtime (session/fs/git) | `@superone/runtime` | **Always** for CLI / remote node |
| Claude | `@superone/claude` | Harness `claude` enabled |
| Codex | `@superone/codex` | Harness `codex` enabled |
| ACP | `@superone/acp` | Harness `acp` enabled |
| OpenCode | `@superone/opencode` | Harness `opencode` enabled |

Subpaths: `@superone/runtime/session`, `@superone/runtime/fs`, `@superone/runtime/git`.

See `packages/runtime/README.md`. Desktop thin-wrap onto harness packages is deferred.

**Self-host relay**: `apps/relay/` is intended to be self-hostable by users. Currently the repo is private; when going public the plan is to set up a `git subtree` mirror to a public repo via GitHub Action so self-hosters can clone just the relay subtree. Until then, distribute by sharing wrangler.toml + source bundle directly.

**Cross-package imports**: code uses `@superone/shared/agent-types`, `@superone/ui/components/ui/button`, etc. Each package's `exports` map governs resolution; Vite/TS pick up `.tsx`/`.ts` source directly (no build step).

Inside a package, prefer relative paths (`./X`, `../lib/utils`) over `@/` aliases to keep the package bundler-agnostic.

## Per-Workspace Guidance

Each workspace carries its own `CLAUDE.md` with architecture, conventions, and recurring footguns specific to that subsystem. When working inside a directory, that file is loaded **in addition to** this root file — read it for the detail this file deliberately omits.

| Workspace | `CLAUDE.md` | Covers |
|---|---|---|
| `apps/desktop/` | `apps/desktop/CLAUDE.md` | Electron 3-process architecture, Zustand stores, IPC API, Remote Control (mobile), Codex, auto-update, build/release, styling/brand theming, debugging (event-trace), testing (TDD), **Mini-App platform** (⚠️ recurring two-runtime footgun) |
| `apps/cli/` | `apps/cli/CLAUDE.md` | Headless node RPC, workspace/git, pairing; harness packages under `@superone/*`; **local lab UI test** (`dev:cli:lab` + Other Devices → Local lab); labs do not hot-reload |
| `apps/web/` | `apps/web/CLAUDE.md` | Next.js 16 marketing/docs/demos site |
| `apps/video/` | `apps/video/CLAUDE.md` | Remotion video compositions / offline render |

`apps/relay/` and most `packages/*` currently have no local `CLAUDE.md`; the relay protocol is summarized in `apps/desktop/CLAUDE.md` → "Remote Control (Mobile) Architecture".

## Commands

All root scripts proxy to a workspace via `bun --filter`. Run them from the repo root.

```bash
bun run dev              # Start Electron app with hot reload (→ @superone/desktop)
bun run dev:web          # Start Next.js dev server on :3000 (→ @superone/web)
bun run dev:cli          # Start superone CLI in foreground (→ @superone/cli)
bun run dev:cli:lab      # Local remote-node lab on :7789 (host process; prefer for harness/creds)
# Manual UI test: Terminal A `dev:cli:lab` + Terminal B `dev` → Remote Control →
# Control Other Devices → Local lab → Connect lab (see apps/cli/CLAUDE.md)
# Docker SSH lab: bun run dev:cli:docker* — Linux/SSH fidelity only
bun run test:cli         # Run CLI package tests
bun run test:runtime     # Run @superone/runtime unit tests (session/fs/git/host-action)
bun run dev:relay        # Start wrangler dev for Cloudflare Worker relay (→ @superone/relay)
bun run deploy:relay     # wrangler deploy the relay (→ @superone/relay)
bun run test:relay       # Run relay vitest suite
bun run build            # Production build (electron-vite only)
bun run preview          # Preview production build
bun run test             # Run desktop suite once (does not include cli/runtime/relay)
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

## Cross-Package Resolution & TypeScript

### Path Alias

- **Inside `apps/desktop`**: `@/*` maps to `apps/desktop/src/renderer/src/*` (configured in `electron.vite.config.ts`, `tsconfig.web.json`, `vitest.config.ts`, `.storybook/main.ts`).
- **Cross-package**: code imports via package names — `@superone/shared/agent-types`, `@superone/ui/components/ui/button`, etc. These resolve through `node_modules/@superone/*` workspace symlinks and each package's `exports` map.
- **Inside `packages/ui`** (and other packages): use relative paths only (`../lib/utils`, `./button`) — no `@/` alias.

### TypeScript Setup

Each workspace has its own tsconfig. `composite` is **not** used (apps are consumers, not library producers); cross-package imports resolve via `paths` mappings + `exports`.

- `packages/tsconfig/{base,react-library,electron-renderer,electron-node,nextjs}.json` — shared base configs
- `apps/desktop/tsconfig.node.json` — main + preload (extends `electron-node`)
- `apps/desktop/tsconfig.web.json` — renderer (extends `electron-renderer`, has `@/*` and `@superone/shared/*` paths)
- `apps/desktop/tsconfig.json` and root `tsconfig.json` — empty stubs (`files: []`, `include: []`) acting as IDE entry points only
- `apps/web/tsconfig.json` — extends `nextjs`
- `packages/{ui,shared}/tsconfig.json` — extend `react-library` / `base`

## Conventions

Repo-wide conventions. Workspace-specific conventions (sidebar tokens, animations, ProseMirror, window chrome, etc.) live in the relevant per-workspace `CLAUDE.md`.

- **Package manager**: bun (not npm/pnpm), use bunx instead of npx
- **Module system**: ES modules (`"type": "module"`)
- **Commit messages**: `<type>(<scope>): <description>` (e.g. `feat(mcp): add document tools`)
