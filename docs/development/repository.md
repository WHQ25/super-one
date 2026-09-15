# Repository structure and package resolution

Paths below are relative to the repository root.

## Monorepo Layout

This repo is a **bun workspaces monorepo** (no turborepo/nx). Linker is hoisted (`bunfig.toml`) so transitive deps remain reachable like a single-package install.

```
super-one/
  apps/
    desktop/         — Electron app (was the entire repo pre-monorepo)
    mobile/          — Expo dev-client Remote Control app (`@superone/mobile`; not Expo Go)
    cli/             — `superone` headless environment CLI / remote backend (no Electron)
    web/             — Next.js 16 marketing/docs/demos site (App Router + Turbopack)
    relay/           — Cloudflare Workers (Durable Objects) — mobile↔desktop relay protocol
  packages/
    shared/          — Neutral types, harness-brand, i18n, miniapp runtime (no Electron deps)
    relay-client/    — Pure-TS relay/LAN crypto, ACK, buffer-first, RPC
    chat-core/       — applyEventToSession re-export for Expo
    chat-view/       — WebView DOM chat renderer (pre-reduced patches)
    ui/              — shadcn primitives + OKLch theme CSS, shared by desktop + web
    runtime/         — @superone/runtime — session/fs/git/lease/spawn-env/crypto (always needed)
    claude/          — @superone/claude — Claude harness (opt-in)
    codex/           — @superone/codex — Codex harness (opt-in)
    acp/             — @superone/acp — ACP harness (opt-in)
    opencode/        — @superone/opencode — OpenCode harness (opt-in)
    cursor/          — Cursor harness
    deepseek/        — DeepSeek/Cordis harness
    desktop-mocks/   — shared desktop/chat previews
    video-compositions/ — Remotion scenes
    tsconfig/        — Shared base/react-library/electron-{node,renderer}/react-native/nextjs configs
```

The tree lists core workspaces; each workspace's `package.json` is authoritative
for its name, scripts, exports, and dependencies.

### Node package layout (enable harness = depend on package)

| Package | npm name | When to depend |
|---------|----------|----------------|
| Runtime (session/fs/git) | `@superone/runtime` | **Always** for CLI / remote node |
| Claude | `@superone/claude` | Harness `claude` enabled |
| Codex | `@superone/codex` | Harness `codex` enabled |
| ACP | `@superone/acp` | Harness `acp` enabled |
| OpenCode | `@superone/opencode` | Harness `opencode` enabled |

Subpaths: `@superone/runtime/session`, `@superone/runtime/fs`, `@superone/runtime/git`.

See `packages/runtime/README.md`. Inspect the relevant desktop backend and harness package for the current ownership boundary.

**Self-host relay**: `apps/relay/` contains the Worker and Wrangler configuration.
Consult its deployment documentation when preparing a self-hosted instance.

**Cross-package imports**: code uses `@superone/shared/agent-types`, `@superone/ui/components/ui/button`, etc. Each package's `exports` map governs resolution; Vite/TS pick up `.tsx`/`.ts` source directly (no build step).

Inside a package, prefer relative paths (`./X`, `../lib/utils`) over `@/` aliases to keep the package bundler-agnostic.


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
