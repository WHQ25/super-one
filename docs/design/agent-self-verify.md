# Agent self-verification (SuperOne desktop)

How an AI coding agent (or human) verifies SuperOne UI and ACP features against a **dev build of current HEAD**, not the installed `/Applications/SuperOne.app`.

## 1. Launch with CDP

```bash
# from repo root
bun run dev:cdp
```

What this does:

| Flag / env | Purpose |
|------------|---------|
| `electron-vite dev --remoteDebuggingPort 9222` | Opens Chromium CDP for agent-browser |
| `SUPERONE_E2E=1` | Suppresses auto-opened DevTools (avoids extra CDP targets) |
| dev `userData` | `apps/desktop/.dev-data` (electron-vite cwd) — not the production app profile |

Default CDP port: **9222**. Override:

```bash
SUPERONE_CDP_PORT=9333 bun run dev:cdp
```

(requires the script to pass the port through — see `apps/desktop/package.json`.)

**Quit any previous SuperOne / Electron instance on that port** before launching. The flag must be present at process start.

## 2. Connect agent-browser

```bash
bunx agent-browser connect 9222
bunx agent-browser tab          # pick main renderer if multiple
bunx agent-browser snapshot -i
```

Skill for Electron workflows: `bunx agent-browser skills get electron --full`.

## 3. Verification matrix (recent ACP / Grok work)

### A. Wire / main process (always run; authoritative for protocol)

```bash
bunx vitest run \
  apps/desktop/src/main/acp/ \
  apps/desktop/src/main/session/backends/acp-backend.test.ts \
  packages/shared/src/harness/harness-capabilities.test.ts
```

| Feature | What the tests prove |
|---------|----------------------|
| `session/set_model` + effort | set_model params, backend branches when configId null |
| User MCP attach | mapping + session/new mcpServers list |
| `session/load` | load success + fallback to new |
| Plan enter | setPermissionMode(plan) → set_mode, no yolo |
| allow-always-mcp | auto-allow selects allow-always-mcp for builtins |
| clientInfo.version | non-placeholder version string |
| mobile_share stdio | list/execute when session enabled |
| harness caps | acp supportsMcp/plan/todos |

### B. UI via agent-browser (dev:cdp instance)

Manual / agent steps after connect:

1. **App boots** — snapshot shows main chrome (sidebar / empty state / project).
2. **Open a project** (or create one) so chat composer is visible.
3. **Start or select a Grok / ACP session** (agent id grok-build).
4. **Plan mode host enter**
   - Open permission / mode control in status bar.
   - Confirm **Plan** option exists.
   - Click Plan → placeholder should switch to plan copy (`acpPlan` i18n).
   - Toggle again / Ask → leave plan.
5. **Permission modes** — Ask / Auto / Always Approve still listed.
6. **Model selector** (if catalog loaded) — picker visible; full switch needs live Grok CLI.
7. **Plan approval** — only when agent calls exit_plan_mode (needs live turn).

Features that **cannot** be fully proven from UI alone (need vitest or live Grok):

- MCP server list on `session/new`
- `session/load` resume
- set_model wire when configId is null
- allow-always option id on permission response

## 4. Layering (do not skip unit tests)

```text
vitest (protocol)  →  required gate
dev:cdp + agent-browser (UI)  →  host chrome / plan entry
live grok agent turn  →  optional manual / long-running
```

## 5. Security

`remote-debugging-port` exposes UI control on localhost. Use only for local agent verification; do not ship enabled in production builds.
