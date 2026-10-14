# Desktop layout control

Agents and mini-apps can read and arrange the SuperOne desktop: open a file or a
diff as a tab, manage tabs, show or hide the activity panel and the bottom
terminal, collapse the sidebar, and put a child session beside the caller in the
split view.

## One implementation, two entry points

All layout state lives in the renderer (zustand stores plus the dockview dock), so
the single implementation is `apps/desktop/src/renderer/src/lib/ui-control.ts`:
`uiSnapshot(caller)` and `uiAct(caller, request)`. The contract types are in
`packages/shared/src/ui-control.ts`.

| Entry point | Path to the renderer | Caller |
|---|---|---|
| `ui_snapshot` / `ui_act` agent tools | `mcp/ui-control-tools.ts` → `browserAutomationCall` (ops `uiSnapshot` / `uiAct`) → `runBrowserOp` | The calling session; `root` is its working directory |
| Mini-app `context.layout.snapshot()` / `act()` | Node Host `requestAction('layout.*')` → host-action bridge → `miniapp-host-actions.ts` | The mini-app's holder session (see below) |

The renderer call bridge only targets the main window. Pop-out session windows
have no activity panel and are not controlled.

## Rules

**Scoped to the caller.** A snapshot describes the caller's own layout and every
action changes it. `panel`, `tabs` and `terminal` are the caller's even when
another session is on screen.

**Never moves the user.** The dock shows one session's layout at a time; other
sessions' layouts are parked as JSON (`stores/activity-view-state.ts`).

- When the caller's layout is live, a change applies at once: `status: applied`.
- When it is parked (another session in front, the split view, Settings), dock
  changes are queued in `components/activity/dock-ownership.ts`. They replay when
  that layout is next restored (`showSession`), and the result is
  `status: queued`. Opening or hiding the panel is written into the parked view
  state instead.
- Window-wide state (sidebar, panel side, split view) changes only while the
  caller's chat is on screen. Otherwise the result is `status: skipped` with
  `reason: not_visible`.
- `visible` tells the caller whether the user can see the result now. It also
  requires the window itself to be visible.

**Close only what you opened.** `dock-ownership.ts` records who opened each tab
and split pane, per session: `agent`, `miniapp:<appId>`, or nobody (the user).
`close_tab` and `close_split` refuse anything the caller did not open. Opening a
tab that already exists keeps it the user's.

Agent-opened tabs are:

- browser tabs from `browser_tabs` open;
- terminals with `agentSessionId`;
- files and diffs from `ui_act`.

Focus, split and maximize work on any tab.

**No duplicate entry points.** Browser and terminal tabs are opened with
`browser_tabs` / `terminal_tabs`. `ui_act` only focuses, splits or closes them by
id. Terminal tabs are named by the bare id `terminal_tabs` uses.

**No confirmation.** Every action is reversible and changes only SuperOne's own
layout, so the tools are static host-owned with no executor confirm. Subagents
may call them.

## Actions

| Area | Actions |
|---|---|
| Open tabs | `open_file` (`path`, `line`), `open_diff` (`commit` or uncommitted, optional `path`) |
| Manage tabs | `focus_tab`, `close_tab`, `split_tab` (`direction` right / down), by `tab` |
| Activity panel | `show_panel`, `hide_panel`, `maximize_panel` (optional `tab`), `restore_panel`, `panel_side` |
| Window | `show_sidebar`, `hide_sidebar` |
| Bottom terminal | `show_terminal`, `hide_terminal` |
| Split view | `split_session`, `close_split` (`sessionId`) |

`open_diff` opens the read-only diff tab (`components/coding/source-control/DiffPanel.tsx`).
Uncommitted means the working tree against HEAD, untracked files included. A
commit is shown against its first parent. Both read through the `GIT_PATCH` IPC
(`main/git-patch.ts`); remote projects get an explicit `remote_project` error.

`split_session` accepts only a session the caller spawned. Main checks the spawn
grant (`SPAWNED_SESSION_PROJECT` IPC), and the same check serves agents and
mini-apps. The pane is added beside the caller with `addTile(…, { focus: false })`,
so focus stays where the user had it.

## Surfaces

- **Remote node.** The tools are advertised as Host Actions. The desktop executor
  answers `{ status: 'unsupported', reason: 'remote_node' }`, because a node
  agent has no SuperOne window of its own.
- **Phone.** Execution always targets the desktop. The phone renders the same row
  (`packages/chat-view/src/presenters/UiControlToolRow.tsx`) from the projected
  input (`ui_act` keeps `action`, `path`, `line`, `commit`, `side`, `tab`).
- **Chat row.** One line per call: the action verb, its subject (file, commit,
  side), and the outcome when it is not a plain `applied`.

## Mini-apps

`context.layout` exposes the same snapshot and actions, scoped to the session
`miniAppSessionTarget()` resolves. That is the project's active session if it
holds the app, otherwise the first holder. This is the existing binding with its
known ambiguity when several sessions hold one app (`docs/proposals/miniapp-agent-api.md`).

The snapshot's `self` is the app's own tab, so the app can focus, maximize or
split itself. Tabs and panes the app opens are recorded as `miniapp:<appId>`, and
only the app can close them. Author types are in
`packages/shared/src/miniapp-host-api.d.ts`; a type test keeps them equal to
the shared contract. The author guide is the `api-host` manual topic.
