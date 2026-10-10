# Desktop architecture

Repository paths below are relative to the repository root unless noted.

## Architecture

Three-process Electron architecture using **electron-vite**, all under `apps/desktop/`:

- **Main Process** (`apps/desktop/src/main/`) — Electron lifecycle, window management, IPC handlers, file system services. Compiled with Node.js target.
- **Preload** (`apps/desktop/src/preload/`) — Secure context bridge exposing `window.electron` API via `@electron-toolkit/preload`. Type declarations in `index.d.ts`.
- **Renderer** (`apps/desktop/src/renderer/`) — React 19 application. Entry point is `apps/desktop/src/renderer/index.html` → `apps/desktop/src/renderer/src/main.tsx`.

Build config: `apps/desktop/electron.vite.config.ts` with three sections (main, preload, renderer). Main uses `externalizeDeps` with `exclude: ['@superone/shared']` so the workspace package gets bundled inline (Node ESM can't load TS source at runtime); preload bundles all deps except `electron`; renderer uses React + Tailwind plugins.

### Path Alias (inside `apps/desktop`)

- `@/*` maps to `apps/desktop/src/renderer/src/*` (configured in `electron.vite.config.ts`, `tsconfig.web.json`, `vitest.config.ts`, `.storybook/main.ts`).
- Cross-package imports (`@superone/shared/*`, `@superone/ui/*`) and the full tsconfig topology are documented in `docs/development/repository.md` (repository root).

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

Session Markdown references use stable `SessionRef` identities and source-pane
ownership through `window.environment.sessionSource`, `sessionLinkMetadata` and
`sessionLinkTarget`. Header lookup never restores/connects/controls a session;
click preparation verifies the owning project before navigation. Environment
archive reads preserve the remote Host Action caller as `localhost`, and routed
phone events carry their execution environment. Shared contracts and lifecycle
details live in [session-links.md](../../../../docs/features/session-links.md).

**Direction:** product features should go through `EnvironmentHost` / `window.environment`. Local desktop is an `ExecutionEnvironment` (`connectionId: 'local'`), not a permanent special case beside remote.

| Area | Status |
|------|--------|
| Session **list** (always `limit`+`offset`) | ✅ Unified — `environment.listSessions` + renderer `lib/session-list-ops.ts` (no unpaginated dump; search pages until short) |
| Session create / send / rename / delete / pin / messages | ⏳ Still `app` / `agent` IPC for local; remote partially on environment |
| Workspace / git / terminals on remote | ✅ Environment gateway |
| Workspace / agent turns on local | ⏳ Still desktop SessionManager + raw IPC |

When adding or refactoring session (or project/workspace) product surfaces, extend the Environment gateway first and thin-wrap legacy IPC only if needed for back-compat. Do not add new permanent `if (remote) … else app…` branches in the renderer.

### Remote Control (Mobile) Architecture

Session and terminal control comes from the one `DesktopDomain` lease service.
`SessionLease` and `TerminalLease` derive their control hints from it; neither
keeps a separate owner authority. The remaining session owner/subscriber API
adapts legacy phone commands and delivery while the phone client is cut over.
Observers on protocol topics acquire no control.

IPC actors come from `event.sender.id` (`window:<id>`); phone actors come from
an authenticated pairing (`phone:<deviceId>`). Both delegate for this desktop's
canonical principal. Window grants yield to a phone; phones refuse competing
phones and windows until release, expiry or explicit reclaim. Every frontend
mutation checks its grant. A request retains its exact proof across asynchronous
admission and startup; takeover cannot silently give it a fresh grant. Trusted
host work uses a separate origin.

The local Environment gateway uses `InProcessRpcClient` to dispatch the same
resource methods as node and phone connections. Network and in-process clients
share `EnvironmentRpcClient` resource helpers and `RemoteEnvironmentGateway`.
The domain binds live and resumed sessions before controller adoption; terminal
IPC is in `terminal/terminal-ipc.ts`.

Main publishes every event through `SessionEventHub` (`src/main/stream/`). In-process consumers with their own state (bookkeeping, automations, notifications, collaboration, scheduled sends) subscribe by source. Frontends receive by topic: `publishHubEvent` (`stream/desktop-topics.ts`) publishes each event to its one topic (a session, the session list, projects, drafts, a terminal, the terminal list, environment notices) on the `TopicHub` from `@superone/runtime/stream`, and each frontend connection receives the topics it follows. The renderer connection follows the union of what the windows show (`stream/renderer-interest.ts`): every local session and terminal (the sidebar and terminal panel list them), plus the remote sessions a window shows (`setSessionForeground`, per window, released on window close) or the chat follows, and attached remote terminals. Delivery to windows stays a broadcast: a session window also follows its side chats and draft-to-session id changes, so a per-window filter would drop events it needs. Each online phone has its own connection (`remote/phone-topics.ts`); list, draft and recovery cursors for topics live in `stream/topic-recovery.ts`.

The paired phone endpoint (`node-host/phone-endpoint.ts`) uses the same
`createConnectionRpc` and native dispatcher as node sockets. `RemoteControlService`
and `LanServer` authenticate and seal per-link frames; they do not own session
control or application commands. The authenticated pairing yields the actor
`phone:<deviceId>` and its key fingerprint. Local IPC, phones and controller
mutations are fenced by the domain's single `ControlLeaseService`; `SessionLease`
and `TerminalLease` project the current writer for presentation and recheck
admitted proofs after async work. Backends have no frontend ownership branches.

`RoutedPhoneRpcRouter` forwards scoped RPCs to source environments. Its grant
manager shares a pairing's proof across overlapping links, retires it only after
the last link and forwards exact upstream loss notices. Renderer observation
state derives from native `control_changed` events and a startup lease snapshot.
`RoutedControlPresence` resolves source metadata and projects current routed
phone control into that same renderer state.

The relay can host multiple phones in one desktop room. It injects the sender's
`mobileDeviceId`, and addressed desktop protocol frames reach that device's slot.
Each link uses its own authenticated channel and connection state. Topic disposal
removes read interest; lease release removes mutation authority. These are separate
lifecycles, with no Session owner or subscriber table. The protocol, upgrade floor,
recovery, framing and routed contracts are in
[mobile-remote-control.md](../../../../docs/architecture/mobile-remote-control.md).

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
| `zustand` | State management |
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

Codex requests carry effort in `codex.reasoningEffort`. `sessionRequestSelection`
uses that field ahead of generic `effort` for both the backend and durable
session settings, so snapshots, settings replay and DB restoration retain the
effort sent by the picker, including configured defaults. Queued Codex turns
update those settings when consumed, before their user message is persisted;
a picker change made after enqueueing still takes precedence. Applying a request
also synchronizes Codex's backend defaults and UI aliases, and broadcasts the
updated selection, so later host sends without model/effort use the same values.

Codex voice transcripts are stored separately in `session_realtime_timelines`.
When rebuilding the backing thread, keep `chat_messages.sort_order` as the
message spine: it includes local compaction markers and the assistant segments
created by a mid-turn steer. Overlay matching provider turns and insert missing
provider history between shared anchors. Starting from the provider timeline
and appending local-only rows moves compaction markers after saved replies;
the transcript then hides those replies as earlier history. A steered user row
may have different local/provider ids, including `providerId: 'remote'` for phone
input; match its text one-to-one only between shared anchors, never globally.
This projection is handled by `codex-realtime-messages.ts` and does not rewrite
the stored transcript.

#### Schema changes (⚠️ read before touching `database-migrations.ts`)

**Migrations are additive-only.** A user can install any build at any time, and builds that already shipped contain no recovery code — they will read a newer database fine *as long as nothing they query was taken away*. That property, not the backup layer, is what makes "reinstall the previous version" work.

- **Never** `DROP TABLE` / `DROP COLUMN` / `RENAME COLUMN` / `RENAME TO` in a new migration. `database-migrations-policy.test.ts` freezes the grandfathered set and fails on anything new.
- One exception: a **constraint-only rebuild**, for a constraint SQLite cannot alter in place (a column `UNIQUE`). It keeps the table name and every column, so older builds read and write it unchanged. It must skip itself with a warning, not fail the migration, when the stored DDL is not what it expects, and its statements go in `CONSTRAINT_ONLY_REBUILDS`. See `ensureCollaborationGrantUniqueness` in `@superone/runtime/collaboration`.
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
