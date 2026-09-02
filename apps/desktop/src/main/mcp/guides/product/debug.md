# SuperOne — debug, logs, and local paths

Use this when the user is stuck, sees a crash, or wrong behavior and you need **logs + source layout** to diagnose — including when they @-mentioned Debug. Combine with product/contribute when they want to file an issue or open a fix PR.

For **issues and PRs** (bugs, features, improvements):  
`read_manual({ domain: "product", topic: "contribute" })`  
— issue first, then optional PR; bugfix PRs use strict red–green.

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
| **macOS** | `~/Library/Application Support/SuperOne/` |
| **Windows** | `%APPDATA%\SuperOne\` |
| **Linux** | `~/.config/SuperOne/` |

The directory name above is the **stable** variant. The alpha variant is a
separate app and uses `SuperOne Alpha` in the same parent, so the two never
share a profile.

Multi-instance: if `SUPERONE_INSTANCE` is set, userData nests one level deeper
(`…/SuperOne Alpha/instance-<name>/`, or `.dev-data/instance-<name>/` in dev).

### Useful files under userData

| File / dir | Purpose |
|------------|---------|
| `superone.db` | Sessions / chat SQLite DB |
| `app-settings.json` | App settings |
| `media-gen/` | Generated images & videos |
| `image-cache/` | Image cache |
| `remote-config.json` | Remote control config |

Dev registry (mini-app source pointers): `~/.superone/dev-registry.json`

## After you have a diagnosis

If the user may want to report or fix upstream, switch to product/contribute: ask about filing an issue first, then (only with an issue number) ask about a PR. Do not skip contribute and invent a one-off PR process here.

If they have **no GitHub account**, stay on local diagnosis and give them a complete issue draft they can paste later. Do not invent another report channel. Details: contribute → “If they have no GitHub account”.
