# `@superone/runtime`

**Harness-agnostic host foundations** used (or intended to be used) by both
`apps/cli` and `apps/desktop`. Always install this package for the node CLI;
add harness packages only when that harness is enabled.

## Layout

| Export | Contents |
|--------|----------|
| `@superone/runtime` | Session + re-exports of common helpers |
| `@superone/runtime/session` | `SessionRuntime`, simulated turn runner, `EventLog`, `createSqliteSessionStore` |
| `@superone/runtime/fs` | Path security, listFiles, skill discovery, **fuzzy path match** (`searchMentionsInEntries` / `searchFilesInEntries`) |
| `@superone/runtime/git` | sanitize ref, shortstat, worktree porcelain/plan, **`gitRun`/`gitRunSync`**, status porcelain parse |
| `@superone/runtime/lease` | `ControlLeaseService` (SQLite-compatible) |
| `@superone/runtime/spawn-env` | `buildSafeEnv` / `sanitizeEnv` / `mergeLoopbackNoProxy` (child process env safety + loopback proxy bypass) |
| `@superone/runtime/crypto` | sha256/hmac/ed25519 helpers |
| `@superone/runtime/sqlite` | Minimal `SqliteDatabase` type for host DB injection |
| `@superone/runtime/workspace` | `ProjectRegistry` (node project catalog) |
| `@superone/runtime/db` | Node SQLite open + schema (`openNodeDatabase`) |
| `@superone/runtime/server` | Identity, pairing auth, HTTP/WS transport (`startNodeServer`) |

## Not in runtime (host / product)

RPC route table, systemd units, Electron IPC, full git worktree product ops
that log to desktop logger, harness backends, desktop-only request coalescing
(`AsyncCoalescer`), local disk crawl (`fdir` + `.gitignore` in desktop
`fuzzy-file-search`). Hosts inject `RpcHostHooks` into `startNodeServer`.

Session **state** fork (`SessionRuntime.fork`) lives here; **SDK/thread** fork
lives in harness packages (`forkClaudeTranscript`, `forkCodexThread`) so desktop
and the node CLI share one implementation.

## Harness packages (opt-in)

| Enable | Package | Shared fork |
|--------|---------|-------------|
| Claude | `@superone/claude` | `forkClaudeTranscript` |
| Codex | `@superone/codex` | `forkCodexThread` |
| ACP | `@superone/acp` | (not yet) |
| OpenCode | `@superone/opencode` | (not yet) |

## Variant-scoped storage

`fs/superone-home` resolves the personal root. Stable uses `~/.superone`,
alpha uses `~/.superone/alpha`, and dev uses `~/.superone/dev`.
`SUPERONE_HOME` overrides the exact personal root and must be absolute.
Project roots follow the same suffix under the project directory and never
inherit a personal override. No legacy alpha data is read or migrated.

Desktop uses its packaged variant identity, exports the resolved root to
children, and resolves every personal child path relative to it. CLI bundles
set their release channel before any module initializes; source/lab runs may
set `SUPERONE_VARIANT`. Remote roots use the remote user's home, never the
controlling desktop's filesystem path.

| Child path | Scope |
| --- | --- |
| `browser/memory`, `computer/memory`, `device/memory` | Personal |
| `harness` | Personal |
| `apps` (including app state) | Personal or project |
| `dev-registry.json` | Personal |
| `widget` | Personal or project |
| `mcpb`, `claude-accounts` | Personal |
| `node`, `npm`, `versions`, `current`, `downloads` | Remote node personal |

Electron's `userData` profiles already isolate stable/alpha/dev and retain
their existing OS-specific locations. External provider homes such as
`~/.claude` and `~/.codex` remain owned by those providers.

Remote alpha uses the `superone-alpha` command link, `superone-alpha.service`,
and port 7790; stable uses `superone`, `superone.service`, and port 7788.
Explicit node/harness overrides remain available for labs and tests.
