# CLAUDE.md — `apps/desktop` (`@superone/desktop`)

Desktop-specific guidance for the Electron app. For the monorepo layout, root commands, cross-package resolution, and shared conventions, see the **repo-root `CLAUDE.md`**. This file is loaded additively when you work inside `apps/desktop/`.

## Architecture

Three-process Electron architecture using **electron-vite**, all under `apps/desktop/`:

- **Main Process** (`apps/desktop/src/main/`) — Electron lifecycle, window management, IPC handlers, file system services. Compiled with Node.js target.
- **Preload** (`apps/desktop/src/preload/`) — Secure context bridge exposing `window.electron` API via `@electron-toolkit/preload`. Type declarations in `index.d.ts`.
- **Renderer** (`apps/desktop/src/renderer/`) — React 19 application. Entry point is `apps/desktop/src/renderer/index.html` → `apps/desktop/src/renderer/src/main.tsx`.

Build config: `apps/desktop/electron.vite.config.ts` with three sections (main, preload, renderer). Main uses `externalizeDeps` with `exclude: ['@superone/shared']` so the workspace package gets bundled inline (Node ESM can't load TS source at runtime); preload bundles all deps except `electron`; renderer uses React + Tailwind plugins.

### Path Alias (inside `apps/desktop`)

- `@/*` maps to `apps/desktop/src/renderer/src/*` (configured in `electron.vite.config.ts`, `tsconfig.web.json`, `vitest.config.ts`, `.storybook/main.ts`).
- Cross-package imports (`@superone/shared/*`, `@superone/ui/*`) and the full tsconfig topology are documented in the root `CLAUDE.md`.

### Navigation

No URL-based router — views are driven by `useAppStore.view` state machine:

`startup` → `setup` → `main` → `settings`

Navigation uses the `navigateTo()` action. The `main` view has one coding layout. Its Activity Dockview can maximize across the main area while the chat switches to a floating panel; the sidebar remains independently collapsible.

### State Management (Zustand)

Four stores with clear responsibilities:

- **`useAppStore`** — App lifecycle, folder/project management, sidebar state, auto-update status, worktree management
- **`useChatStore`** — Multi-project chat sessions (`projectSessions: Record<path, SessionState>`), message streaming, permission handling, background sessions (`_bgSessions`)
- **`useSettingsStore`** — Resource CRUD (agents, skills, MCP configs, plugins), lazy-loaded per settings view
- **`useMiniAppStore`** — Mini-app discovery, install/uninstall actions, app list caching

Use `useActiveSession<T>(selector)` hook to read the active project's session state.

### IPC API

Two namespaces exposed via preload:

- **`window.agent`** — AI agent interaction, scoped by `projectPath`: `sendMessage()`, `interrupt()`, `respondToPermission()`, `resetSession()`, `parkSession()`, `activateSession()`, `onAgentEvent()`
- **`window.app`** — Global operations: folder management, git ops (including worktrees), session DB (CRUD), resource discovery, Claude setup/install, auto-update, Codex integration, plugin/skill/MCP/agent management, window state
- **`window.environment`** — Multi-environment gateway (local + remote nodes): projects, session list, workspace, terminals, pairing. Prefer this over environment-specific `window.app` paths when both exist.
- **`window.miniapp`** — Mini-app lifecycle: `list()`, `open()`, `close()`, `install()`, `uninstall()`, `pack()`, `getInstallMeta()`, tool/fs bridging, dev app detection

All IPC channels are defined as constants in `AgentIpcChannels` (`packages/shared/src/agent-types.ts`), grouped by namespace prefix (`app:`, `agent:`, `codex:`, `plugins:`, `skills:`, `mcp:`, `miniapp:`, `sessions:`, `updater:`, `environment:`).

### Environment API migration (local = one environment)

**Direction:** product features should go through `EnvironmentHost` / `window.environment`. Local desktop is an `ExecutionEnvironment` (`connectionId: 'local'`), not a permanent special case beside remote.

| Area | Status |
|------|--------|
| Session **list** (always `limit`+`offset`) | ✅ Unified — `environment.listSessions` + renderer `lib/session-list-ops.ts` (no unpaginated dump; search pages until short) |
| Session create / send / rename / delete / pin / messages | ⏳ Still `app` / `agent` IPC for local; remote partially on environment |
| Workspace / git / terminals on remote | ✅ Environment gateway |
| Workspace / agent turns on local | ⏳ Still desktop SessionManager + raw IPC |

When adding or refactoring session (or project/workspace) product surfaces, extend the Environment gateway first and thin-wrap legacy IPC only if needed for back-compat. Do not add new permanent `if (remote) … else app…` branches in the renderer.

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
├── miniapp/      — MiniAppWebview, MiniAppView, MiniAppIcon, MiniAppOverlayPortal
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

#### Schema changes (⚠️ read before touching `database-migrations.ts`)

**Migrations are additive-only.** A user can install any build at any time, and builds that already shipped contain no recovery code — they will read a newer database fine *as long as nothing they query was taken away*. That property, not the backup layer, is what makes "reinstall the previous version" work.

- **Never** `DROP TABLE` / `DROP COLUMN` / `RENAME COLUMN` / `RENAME TO` in a new migration. `database-migrations-policy.test.ts` freezes the grandfathered set and fails on anything new.
- Removing a field is a two-step **expand/contract**: (1) this release adds the replacement, writes both, stops reading the old one; (2) at least two releases later, drop the old one, add it to `GRANDFATHERED`, and raise `MIN_COMPATIBLE_SCHEMA_VERSION`.
- Bump `SCHEMA_VERSION` whenever `applyMigrations` changes. It gates the pre-migration snapshot and lets a build recognise a database written by a newer one. The migration body itself stays idempotent and runs every launch, so forgetting the bump costs a snapshot, not a column.
- `MIN_COMPATIBLE_SCHEMA_VERSION` is the tripwire for a genuine compatibility break — raising it is what turns silent breakage on downgrade into a restore prompt. It should almost never move.
- `PRAGMA foreign_keys` is a **silent no-op inside a transaction**. `runDatabaseMigrations` toggles it outside; do not add a toggle inside `applyMigrations`.
- `VACUUM` cannot run inside a transaction. A migration needing one must be split out and run after the commit.

Startup flow lives in `db-open.ts` (verify → snapshot → migrate → recover) with the snapshot mechanics in `db-backup.ts`. Snapshots land in `userData/backups/superone-schema<N>-<stamp>.db`, newest one per schema version, three versions deep. Recovery never deletes: a database that is corrupt or from a newer build is renamed aside, never replaced in place.

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
- `autoDownload = false` — check may run automatically on launch / channel change, but the binary download starts only when the user clicks **Update** (sidebar / settings / app menu → `UPDATER_DOWNLOAD` → `downloadUpdate()`). Restart still uses `UPDATER_INSTALL`
- Distribution: artifacts hosted on Cloudflare R2, served via custom domain `https://dl.super-one.dev`. `electron-updater` uses the built-in `GenericProvider` (`publish.provider: generic` in `electron-builder.yml`); no auth tokens needed (bucket is public via custom domain)
- Channels: electron-builder auto-derives the **build** channel from `package.json` version — `0.1.0-alpha.3` → `alpha-mac.yml` / `alpha.yml` / `alpha-linux.yml`; `1.0.0` → `latest-*.yml`. The built channel is embedded in ASAR's `app-update.yml`, but users can **override it at runtime**: the `updateChannel` app-setting (`stable` | `beta` | `alpha`, default `null` = follow build) drives a selector in `AppSettingsPage`. `setUpdateChannel` maps it via `@superone/shared/update-channels` `UPDATE_CHANNEL_TO_YML` and sets `autoUpdater.channel`. Switching to a more-stable channel sets `autoUpdater.allowDowngrade = true` for that one check (reset in `.finally`) so the client can move down onto the stable line; periodic checks keep `allowDowngrade = false`
- Channel cascade: channels are **not** isolated. When a version is set as a channel's latest it is written into that channel's yml **and every less-stable one** (stable → `latest`+`beta`+`alpha`, beta → `beta`+`alpha`, alpha → `alpha`), guarded by semver so an older stable never clobbers a newer prerelease already on `alpha` (unless `force`). So alpha users still receive beta/stable builds. Logic lives in `scripts/lib/channels.ts` (`cascadeTargets` / `shouldPublish` / `compareVersions` / `prefixVersionPaths` / `fixedLinkName`, bun-tested in `scripts/lib/channels.test.ts`) and is applied by `scripts/set-latest.ts` — **not** by `promote`. The app-runtime module `@superone/shared/update-channels` deliberately keeps only the app-facing surface (`UPDATE_CHANNELS` / `UPDATE_CHANNEL_TO_YML` / `channelFromVersion`); CI-only logic stays out of the renderer/main bundle
- Events flow: `autoUpdater` → `webContents.send(UPDATER_EVENT)` → `useAppStore.handleUpdateEvent()` → `<UpdateNotification />`

Dev testing: `TEST_UPDATER=1 bun run dev` (uses `apps/desktop/dev-app-update.yml`, which points to the alpha channel on `dl.super-one.dev`)

Release flow — **two independent workflows** (they do not call each other):

1. **`promote.yml` (archive only)** — collects the per-platform CI artifacts, (a) uploads them **flat** (binaries + channel ymls) to a draft GitHub Release (changelog mirror + serves legacy GitHub-provider clients during the bridge period), then (b) moves the binaries into a `v${VERSION}/` subdir and **drops the ymls** (`rm staging/*.yml`), then (c) `aws s3 sync staging/ s3://super-one-releases/` so R2 gains only `v${VERSION}/{*.dmg,*.exe,*.AppImage,*.zip,*.blockmap}`. **Promote never touches a root channel yml** — a freshly promoted version is archived but not yet "latest" for anyone.

2. **`set-latest.yml` (manual, makes a version live)** — `workflow_dispatch` inputs `release_tag` + `channel` + `force`. It `gh release download <tag> -p '*.yml'` to get that version's flat manifests, then `bun scripts/set-latest.ts` (needs `bun install --frozen-lockfile --ignore-scripts` for the workspace symlink) which `prefixVersionPaths` → `v${VERSION}/`, computes the cascade target ymls (semver-guarded unless `force=true`), writes them to `out/`, and emits a `fixed-copies.json` plan. The workflow then `aws s3 cp out/ s3://…/` (root channel ymls) and server-side `aws s3 cp` each installer `v${VERSION}/… → ${channel}/latest/<version-less name>` (`--cache-control max-age=300`). **`force=true` enables rollback** — re-point a channel at an older version. R2 then has `bucket-root/{alpha,beta,latest}-*.yml` + `bucket-root/v0.1.0-alpha.4/{*.dmg,...}` + `bucket-root/{alpha,beta,stable}/latest/{SuperOne.dmg,SuperOne-arm64.dmg,SuperOne.AppImage,SuperOne Setup.exe}`.

Normal release = run `promote` then `set-latest <tag> <its-channel>`. Manifest source for set-latest is the **GitHub Release** (every promoted version archives its flat ymls there), so any historical version can be set/rolled-back without a rebuild.

Fixed download links: `https://dl.super-one.dev/{alpha,beta,stable}/latest/<file>` always resolve to that channel's newest installer (permanent, shareable — for README/QR/external use). These are human-download aliases only; electron-updater itself keeps reading the versioned `v${VERSION}/` paths from the channel yml.

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
- `asarUnpack: "**/*.node"` — required for `better-sqlite3` native module (Claude/Codex platform binaries are **not** unpacked; P5 installs them on demand under `~/.superone/harness`)
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

- **Theme**: "Inverted chrome" — a dark sidebar against near-neutral light content, with exactly one hue in two tones (vivid fill at L 0.68 carrying DARK text, ink at L 0.52 for icons/rules on light surfaces). Surfaces are deliberately near-achromatic: a tinted ground robs the one saturated colour of the contrast it needs. Colors defined in OKLch color space (not hex/hsl) in `packages/ui/src/styles/theme.css` (`:root` + `.dark` + `@theme inline`). Apps import via `@import "@superone/ui/styles/theme.css"` and `@import "@superone/ui/styles/base.css"`. Desktop's `apps/desktop/src/renderer/src/styles/index.css` adds Electron-specific extras (animations, scrollbar, chat-md, tiptap)
- **Dark mode**: `.dark` class toggle on `<html>`, CSS variables auto-switch
- **Tailwind v4**: Import-based (`@import "tailwindcss"`), no config file, `@theme inline` block for design tokens
- **Component library**: shadcn/ui (New York style, `components.json`), Radix UI primitives
- **Chat markdown**: Scoped to `.chat-md` class, uses Streamdown's `data-streamdown` attributes
- **Responsive**: `@container` queries for chat panel width breakpoints (512px, 672px)

### Per-Harness Brand Theming

Light-mode brand hue is user-customizable per harness (Claude default 40° / Codex default 240°) via the palette icon in `AppSidebar.tsx`. The whole app's color temperature shifts with the slider.

**Architecture**:

- **Single writer**: `apps/desktop/src/renderer/src/hooks/useHarnessTheme.ts` is the **only** place that writes brand CSS variables. Mounted once at `App.tsx` top level. Watches `<html>.classList` via MutationObserver (not `useTheme()`, to avoid duplicate listener mount when both call the hook).
- **Constants**: `packages/shared/src/harness-brand.ts` exports `HARNESS_DEFAULT_BRAND_HUE`, `clampBrandHue` (0-360 wrap, doubles as CSS-injection防御), `brandHueToOklch`. Always go through these — never hardcode an `oklch(...)` string with a user-supplied hue.
- **Persistence**: `agentPreference.{claude,codex}.brandHue: number | null` in `app-settings.json`. `null` = use harness default. Reflected in `useAppStore.brandHues` (loaded once at app boot via `loadBrandHues`).
- **Two halves of one palette, and they must agree.** `syncBrandProps` writes inline channel vars ONLY for tokens the user has explicitly customised (`tokenOverrides`), plus `--brand-hue`. With no customisation nothing is written inline, so **what actually paints is `theme.css`'s `:root` fallbacks resolved against `--brand-hue`**. Meanwhile `buildHarnessDefaults()` in `packages/shared/src/harness/harness-brand.ts` is what the palette editor renders as "default" and what Reset restores. Change a light-mode colour in BOTH or the editor will disagree with the app.
- **Chroma is a function of lightness, not a constant**: sRGB allows almost no chroma near white (≈0.005 at L 0.99) and its ceiling is hue-dependent (cyan ≈0.11 where orange reaches 0.20 at L 0.65). Every chroma goes through `maxChromaInSRGB(l, hue)` — asking for more makes the browser clip silently, which shifts hue AND lightness. Never reintroduce a single global chroma constant.
- **Token override scope**: 23 tokens in `DESIGN_TOKENS`. **Excluded** from hue control: `--primary-foreground` / `--sidebar-primary-foreground` (defined in `theme.css`; DARK in light mode, light in dark mode) and `--destructive-foreground` (semantic). The hook also sets `<html data-harness="claude|codex">` for scoped CSS hooks.
- **Every `--sidebar-*` token reads its own channels.** They used to alias `--background` / `--accent`, which silently discarded the inline per-channel values — harmless while the sidebar echoed the content surface, fatal now that it runs dark. If you add a sidebar token, give it the `oklch(var(--x-l, …) var(--x-c, …) var(--x-h, var(--brand-hue)) / var(--x-a, 1))` shape.
- **Dark-mode contract**: Dark mode **never** reads the user's `brandHue`. `useHarnessTheme` calls `removeProperty()` for every override token in dark mode, letting `:root.dark` defaults win. The palette icon also hides itself (`BrandColorPopover` returns `null` when `.dark`).

**Rules for adapting an element to brand color** (when extending coverage):

- **`--sidebar-accent` is SELECTED, `--sidebar-hover` is HOVER.** One token served both while the sidebar was a pale grey; it now carries the vivid fill, so a translucent copy of it reads as a second selection. Never write `hover:bg-sidebar-accent/NN`.
- **A row filled with `bg-sidebar-accent` also needs `sidebar-selected`** (see `apps/desktop/src/renderer/src/styles/index.css`) — descendants set their own `text-sidebar-foreground/NN`, which would otherwise sit light-on-vivid at ~1.9:1.
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

For packaged builds (`build:mac-dev`), logs are written to `~/Library/Logs/SuperOne/main.log` (macOS `electron-log` path from `app.setName('SuperOne')`). Packaged userData is `…/SuperOne/` (Computer Use helper lives in `…/SuperOne/Computer Use/`). A first-launch migration moves the historical `…/super-one/` tree into that folder; if the move fails the app keeps using `super-one` so sessions are not opened against an empty profile.

## Testing

Follow **Test-Driven Development** with an **integration-first** philosophy — the testing trophy, not the pyramid. Most bugs in this Electron app come from cross-layer wire-up (store → IPC → session → backend), not single-function logic errors. Integration tests catch these; unit tests don't.

### TDD Workflow (ORDER MATTERS)

1. **Red**: Write a failing test at the layer where the bug or feature lives
2. **Green**: Write the minimum code to make the test pass
3. **Refactor**: Clean up the code while keeping tests green

### Setup

- **Framework**: Vitest with globals enabled
- **Environment**: `node` by default. Component tests opt into `jsdom` with a `/** @vitest-environment jsdom */` docblock on the file's first line (required — vitest 4 removed `environmentMatchGlobs`, so it is not auto-matched by extension)
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
- **Run the smallest sufficient suite**: after implementing, run only what the change can affect — `bunx vitest run <file.test.ts>`, `bunx vitest related <changed-source.ts>`, or `bunx vitest run --changed HEAD` (all from `apps/desktop`). Full `bun run test` is the **pre-commit** gate, not a per-edit one — see the test-scope rules in the root `CLAUDE.md`.

### Good examples to follow

- `apps/desktop/src/main/session/session.test.ts` — `FakeBackend` + real `Session`; scenarios like "switch cwd during streaming defers rebuild to next send", "bypass mode boundary triggers backend rebuild"
- `apps/desktop/src/renderer/src/stores/chat-store.test.ts` — real Zustand store + mocked `window.agent`; scenarios like "respondToPlanApproval triggers setPermissionMode IPC when approved"
- `apps/desktop/src/main/session/isolation.integration.test.ts` — multi-session isolation scenarios with fake backends

### Device Platforms (iOS Simulator + Android)

Touch devices reach the app through **three seams**, each with a different audience.
Adding a platform means satisfying the three; nothing above them names a platform.

| Seam | File | Covers |
|---|---|---|
| `TouchDeviceBackend` | `main/device-agent/types.ts` | The AGENT driving a device it already holds — `observe` / `capture` / `perform` |
| `DevicePlatformPort` | `main/device/platform-port.ts` | Finding a device and being granted it — the catalog and the control prompt |
| `DeviceSurface` | `main/device/surface.ts` | A PERSON watching and touching — live frames and raw input |

They are separate because the audiences are: the agent takes one action and waits for
the screen to settle, while a person emits a hundred contact updates a second.

Platform-neutral code lives in `main/device/` (settle, tree reading, gesture synthesis,
perceptual hash, capture naming). Platform-specific code lives beside its backend —
`main/ios-simulator/` and `main/device/android/`. Anything only one platform can use
stays there: OCR fallback, DeviceKit artwork, runtime lists and simulator creation are
all iOS-only by nature, and giving Android an empty version would be a lie the UI then
has to check for.

`DeviceDescriptor` (`@superone/shared/device`) is the currency. Ids carry their
platform — `ios:<udid>`, `android:avd:<name>`, `android:<serial>` — so one string
routes to the right backend. Classification (`kind` / `model` / `versionRank` /
`kindRank`) is computed by the platform that owns the device and carried as data, which
is what lets one set of catalog tiers serve a model×runtime matrix and a list of AVDs
without either learning the other's vocabulary.

**Android registration is capability-gated, not flagged.** `detectAndroidToolchain()`
returns null when there is no SDK, the Android port is never constructed, and the
catalog output is byte-identical to before Android existed.

Two platform differences that are load-bearing rather than cosmetic:

- **Settling.** iOS samples tree + pixels together every 150ms. Android cannot:
  `uiautomator dump` costs 2.4–2.5s. It settles on `screencap` instead (170ms, and
  losslessly deterministic so equality needs no tolerance), then reads the tree once.
- **Rotation.** A simulator draws its rotated UI into a framebuffer that never changes
  shape, so the host turns the whole device as one rigid CSS rotation. Android
  re-shapes the framebuffer and scrcpy re-sends a session packet with the axes swapped
  — whatever draws it must RESIZE, not rotate.

The renderer consumes the neutral `device:*` IPC channels and `DeviceDescriptor`.
Shared panel, stream, input, PiP and catalog code lives under `components/device/`;
only simulator creation and DeviceKit artwork stay under `components/device/ios/`.
The stage uses `DEVICE_RIGID_ROTATION` to keep the iOS shell rotation model while
letting Android follow the dimensions published by scrcpy.

Live checks against a real device: `src/main/device/android/live.manual.test.ts`,
skipped unless `ANDROID_LIVE=1`. adb binds a daemon port, so it needs to run outside
the sandbox.

### Mini-App Platform

Mini-apps use a VS Code-style split architecture: a trusted Node.js MiniApp Host owns computation and agent tools, while full Electron WebViews own rendering.

**Key modules:**

| Module | Path | Purpose |
|--------|------|---------|
| MCP Server | `apps/desktop/src/main/mcp/superone-mcp-server.ts` | Built-in MCP tools (`read_manual`, `miniapp_dev_setup`, `miniapp_dev_register`, `miniapp_dev_pack`, `miniapp_dev_update_types`, `session_rename`, `config_read`, `config_apply`, media/browser/widget tools) + dynamic tool registration per app. Manuals via `read_manual` (domains: product/miniapp/media/widget; product/debug covers repo + log paths); guide markdown in `apps/desktop/src/main/mcp/guides/`. Live settings via `config_read` (not docs). Built-in tool entries live in `BUILT_IN_SUPERONE_TOOL_NAMES`; they auto-bypass permission prompts via `isBuiltInSuperoneTool` |
| Service | `apps/desktop/src/main/miniapp/miniapp-service.ts` | App discovery, manifest parsing (Zod validated), filesystem operations |
| Schema | `apps/desktop/src/main/miniapp/miniapp-schema.ts` | Zod v4 manifest validation schema |
| Packager | `apps/desktop/src/main/miniapp/miniapp-packager.ts` | `.s1app` packaging (zip + integrity), install/uninstall, SHA-256 verification |
| MiniApp Host | `apps/desktop/src/main/miniapp/miniapp-host.ts` | One Electron utility process per project/app; lifecycle, tool RPC, WebView messages, status |
| Host Entry | `apps/desktop/src/main/miniapp/miniapp-host-entry.ts` | Loads `manifest.main`, constructs `activate(context)`, owns tool handlers and disposables |
| API Runtime | `packages/shared/src/miniapp-api-runtime.js` | Author-facing `window.superone.*` logic used by WebView preload |
| Preload | `apps/desktop/src/preload/miniapp-preload.ts` | Context-isolated WebView transport and mode-specific APIs |
| WebView | `apps/desktop/src/renderer/src/components/miniapp/MiniAppWebview.tsx` | Shared container for panel, tool renderer, standalone result, and popover HTML |
| Overlay | `apps/desktop/src/renderer/src/components/miniapp/MiniAppOverlayPortal.tsx` | Host-rendered toast/tooltip/context menu and WebView popovers |

**Installation flow:** `.s1app` file (zip) → extract to temp → validate manifest (Zod) → verify integrity (SHA-256) → copy to `~/.superone/apps/<appId>/` → write `install.json` metadata. Users can drag-and-drop `.s1app` files onto the Apps panel in the sidebar.

**Manifest** requires `appId`, `name`, and `main`; `version` and `author` are required for packaging. Schema is strict and rejects removed iframe/worker fields. All HTML surfaces use the same WebView/preload transport in development and production. Every app uses `persist:miniapp-<appId>` and may navigate only within its own `superone-app://` host.

**⚠️ `<webview>` has window-level prerequisites.** Mini-app HTML no longer renders in an iframe, so any `BrowserWindow` that can show mini-app content — including the detached session window, which renders the same chat and therefore the same standalone tool blocks — needs BOTH `webPreferences.webviewTag: true` and `attachMiniAppWebviewGuards(win)` (`miniapp-webview-guard.ts`). Without the tag the element silently renders nothing; without the guards the attach is unvalidated and `superone-app://` is never registered for the partition. When you add a window that renders chat, wire both.

Agent tools are declared in `manifest.tools` and implemented with `context.tools.handle()` from `manifest.main`. MCP calls route directly to the MiniApp Host and never wait for a mounted WebView. The WebView and MiniApp Host communicate through `context.webview` / `window.superone.node` structured messages.

**Capability split (VS Code-shaped):** host capabilities live Node-side on `context` — `agent.*` (prompt / context card), `host.toast / revealInFolder / openExternal / clipboard`, `locale`, `version` — so a background app can reach the user with no UI open. They execute in the renderer (`lib/miniapp-host-actions.ts`, mounted globally by `useMiniAppHostActions`), routed via `miniapp-host-action-bridge.ts`; main only addresses the request, so clipboard and external-link consent prompts are never bypassed. The WebView keeps only what needs DOM coordinates — `ui.showTooltip / showContextMenu / showPopover / startDrag` — plus theme, locale, and `superone.node`.

**Adding a new mini-app bridge API:**

1. `packages/shared/src/miniapp-api-runtime.js` — Add the method to `createSuperoneApi()`. Use `transport.send()` for fire-and-forget, `transport.request()` for request-response.
2. `packages/shared/src/miniapp-author-api.d.ts` — **single source of truth for author-facing types.** Add the signature to the `SuperOne` interface (use the `SuperOne*` named helper types). Both `miniapp-api-runtime.d.ts` (re-exports it as `SuperoneApi` for the runtime/preload) and the generated `src/superone.d.ts` derive from this one file — never hand-edit a second copy.
3. ~~Update `generateSuperoneDts()`~~ — **no longer manual.** `miniapp-templates.ts` reads `miniapp-author-api.d.ts` via `?raw`, strips `export`, and wraps it in `declare global { Window { superone } }`. Editing step 2 is enough; the React-template `superone.d.ts` updates automatically. The `miniapp-templates.test.ts` `covers ui API` assertions guard against silent drift.
4. `packages/shared/src/miniapp-types.ts` — If a new message type is added, append it to `MiniAppBridgeMessageType`.
5. If the API needs host-side handling: add a case in `apps/desktop/src/renderer/src/hooks/miniapp-message-handler.ts`.
6. If the API needs main process handling: add a handler in `apps/desktop/src/main/miniapp/miniapp-service.ts` or `apps/desktop/src/main/index.ts`.
7. Add response/push forwarding to `miniapp-preload.ts`, then forward the host event from `MiniAppWebview` consumers where applicable.
8. Update the relevant guide in `apps/desktop/src/main/mcp/guides/api/`.
9. Update `apps/desktop/examples/miniapp/hello/index.html` to demo the new API.

For MiniApp Host API changes, update `packages/shared/src/miniapp-host-api.d.ts`, `miniapp-host-entry.ts`, host RPC tests, templates, and `api-host.md` together.

## Desktop Conventions

- **Window style**: macOS hiddenInset titlebar with traffic lights at (16, 16)
- **Sidebar styling**: Use sidebar-specific color tokens (`bg-sidebar`, `text-sidebar-foreground`, `bg-sidebar-accent`, `text-sidebar-accent-foreground`, `border-sidebar-border`, etc.) instead of generic tokens (`bg-muted`, `text-muted-foreground`, etc.) for all elements inside the sidebar. **Icon buttons need no special casing**: `IconButton` (`@superone/ui/components/ui/icon-button`) ships the light-surface palette, and a scoped rule in `styles/index.css` re-points it at `--sidebar-foreground` / `--sidebar-hover` for anything under `[data-sidebar-inner]`. Overlays that portal out to `<body>` (popovers, dialogs, context menus opened from the sidebar) fall outside that scope and keep the light palette, which is correct — they paint on `--popover`. Don't hand-set sidebar colors on an `IconButton`.
- **Icon buttons**: All compact icon-only buttons (sidebar actions, dialog close/zoom/copy, chat toolbar) use the shared `IconButton` primitive — never hand-roll a `<button>` with `hover:bg-*` + a lucide icon. It bundles size variants (`xs/sm/md/lg`), an integrated `tooltip` prop (self-contained `TooltipProvider`), and works as the `asChild` child of `DropdownMenu`/`Popover`/`Tooltip`/`DialogClose` triggers. Hover variants: `default` (neutral `bg-muted` fill — the standalone default), `ghost` (text-brighten only, no fill), `destructive` (muted fill + `text-destructive`), and **`nested`** (brightens the icon to `text-foreground` on hover but paints **no background fill** — for an icon button living inside a container that already has its own hover background, e.g. the reveal icons inside a `ProjectSidebarRow`/app row that hovers to `sidebar-accent`; the container's hover surface shows through while the icon still gets its own color feedback, instead of stacking a conflicting fill on top). Keep using `Button` only for **styled** buttons that aren't plain icons: bordered `outline` icon buttons (e.g. ProviderDialog's sync) and the image-viewer glass overlay controls (`markdown-image`/`codex-image-shared` — `rounded-full` + `bg-background/80` + backdrop-blur). The circular send/stop buttons in the chat input use `IconButton variant="ghost"` with a `rounded-full border` className override.
- **Animations**: Use `motion` library (`import from 'motion/react'`) for UI animations (expand/collapse, enter/exit, layout transitions). Prefer `AnimatePresence` + `motion.div` over CSS transitions for dynamic mount/unmount animations
- **ProseMirror plugins**: Never use `doc.textContent` for structural decisions (emptiness check, command detection, position calculation, argument counting). It silently skips atom nodes (`MentionNode` in this repo is `atom: true`), so any logic built on it breaks the moment a mention chip — or any future atom node — appears. Use structural API instead: `doc.childCount` / `firstChild.content.size` for emptiness; `paragraph.firstChild.text` for content sniffing; `1 + paragraph.content.size` for end-of-paragraph position; `paragraph.forEach((node, _offset, index) => ...)` for iterating inline children (treat atom nodes explicitly). `element.textContent = ...` on widget DOM nodes is unrelated and fine.
