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
| `@superone/runtime/spawn-env` | `buildSafeEnv` / `sanitizeEnv` (child process env safety) |
| `@superone/runtime/crypto` | sha256/hmac/ed25519 helpers |
| `@superone/runtime/sqlite` | Minimal `SqliteDatabase` type for host DB injection |

## Not in runtime (host / product)

HTTP/WS server, pairing auth product surface, RPC route table, systemd units,
Electron IPC, full git worktree product ops that log to desktop logger, harness
backends, desktop-only request coalescing (`AsyncCoalescer`), local disk crawl
(`fdir` + `.gitignore` in desktop `fuzzy-file-search`).

## Harness packages (opt-in)

| Enable | Package |
|--------|---------|
| Claude | `@superone/claude` |
| Codex | `@superone/codex` |
| ACP | `@superone/acp` |
| OpenCode | `@superone/opencode` |
