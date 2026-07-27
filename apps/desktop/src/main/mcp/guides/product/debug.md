# SuperOne — debug, logs, and filing issues

Use this when the user is stuck, sees a crash, wrong behavior, or wants to contribute a bug report. Combine **logs + source** so maintainers can act quickly.

## Source code

| Repo | URL |
|------|-----|
| Main app (desktop, web, packages) | https://github.com/WHQ25/super-one |
| Mobile↔desktop relay (Cloudflare Workers) | https://github.com/WHQ25/super-one-relay |

Monorepo layout (high signal for bugs):

| Path | What |
|------|------|
| `apps/desktop/` | Electron main / preload / renderer |
| `apps/desktop/src/main/` | Main process (sessions, MCP, media, browser) |
| `apps/desktop/src/renderer/` | UI (chat, settings, mosaic) |
| `apps/relay/` | Relay worker (if remote-control related) |
| `packages/shared/` | Shared types, miniapp runtime, i18n |
| `packages/ui/` | Shared UI primitives |

Open issues: https://github.com/WHQ25/super-one/issues/new

## Log files (by platform)

Main process logs use `electron-log`. File name is typically `main.log` (older rotated to `main.log.old`).

### Packaged / production install

`electron-log` keys off `app.getName()` (`SuperOne`). Folder name is **`SuperOne`** (capital S/O), not `super-one`.

| OS | Default log path |
|----|------------------|
| **macOS** | `~/Library/Logs/SuperOne/main.log` |
| **Windows** | `%USERPROFILE%\AppData\Roaming\SuperOne\logs\main.log` |
| **Linux** | `~/.config/SuperOne/logs/main.log` |

(Older installs may still have a leftover `super-one` logs folder; prefer `SuperOne` and the resolved path in **Runtime paths** below.)

### Development (`bun run dev` from the monorepo)

| What | Path |
|------|------|
| Main log | `apps/desktop/dev.log` (cwd when you start dev; wiped on each `bun run dev`) |
| Dev userData | `apps/desktop/.dev-data/` |
| Event trace DB (if enabled) | `apps/desktop/event-trace.db` |

Log line format: `[YYYY-MM-DD HH:mm:ss] [level] message`

## App data (settings, DB, cache)

### Packaged

| OS | userData root |
|----|----------------|
| **macOS** | `~/Library/Application Support/super-one/` |
| **Windows** | `%APPDATA%\super-one\` |
| **Linux** | `~/.config/super-one/` |

Multi-instance: if `SUPERONE_INSTANCE` is set, userData is `…/super-one/instance-<name>/`.

### Useful files under userData

| File / dir | Purpose |
|------------|---------|
| `superone.db` | Sessions / chat SQLite DB |
| `app-settings.json` | App settings |
| `media-gen/` | Generated images & videos |
| `image-cache/` | Image cache |
| `remote-config.json` | Remote control config |

Dev registry (mini-app source pointers): `~/.superone/dev-registry.json`

## How to help the user file a good issue

Paste this checklist into the issue body (fill in with them):

```markdown
### Summary
<!-- one line -->

### Environment
- SuperOne version:
- OS:
- Agent / harness (Claude, Codex, Grok, …):
- Install: packaged DMG/NSIS vs `bun run dev`

### Steps to reproduce
1.
2.

### Expected
### Actual

### Logs
<!-- paste the last ~50–100 lines from main.log / dev.log around the failure -->
<!-- redact API keys / tokens / absolute home paths if sensitive -->

### Related code (if known)
<!-- e.g. apps/desktop/src/main/... -->
```

Use the resolved paths in the runtime appendix when available. Summarize the relevant error window instead of copying an entire log, and redact credentials, tokens, and private home-directory segments before sharing it externally.
