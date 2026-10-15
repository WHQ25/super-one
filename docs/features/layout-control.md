# Desktop layout control

Agents and mini-apps can read and arrange the SuperOne desktop: open a file as a
tab, manage tabs, show or hide the activity panel and the bottom terminal,
collapse or resize the sidebar, resize the panel, dock or float the chat, and put a child session beside the caller in the split view.

## One implementation, two entry points

All layout state lives in the renderer (zustand stores plus the dockview dock), so
the single implementation is `apps/desktop/src/renderer/src/lib/layout-control.ts`:
`layoutSnapshot(caller)` and `layoutAct(caller, request)`. The contract types are in
`packages/shared/src/layout-control.ts`.

| Entry point | Path to the renderer | Caller |
|---|---|---|
| `layout_snapshot` / `layout_act` agent tools | `mcp/layout-control-tools.ts` → `browserAutomationCall` (ops `layoutSnapshot` / `layoutAct`) → `runBrowserOp` | The calling session; `root` is its working directory |
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
- Window-wide state (sidebar, panel side, column widths, chat mode, split view) changes only while the
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
- files from `layout_act`.

Focus, split and maximize work on any tab.

**No duplicate entry points.** Browser and terminal tabs are opened with
`browser_tabs` / `terminal_tabs`. `layout_act` only focuses, splits or closes them by
id. Terminal tabs are named by the bare id `terminal_tabs` uses.

**No confirmation.** Every action is reversible and changes only SuperOne's own
layout, so the tools are static host-owned with no executor confirm. Subagents
may call them.

## Actions

| Area | Actions |
|---|---|
| Open tabs | `open_file` (`path`, `line`) |
| Manage tabs | `focus_tab`, `close_tab`, `move_tab` (`group`, `direction` right / down / left / up / into, `index`), by `tab` |
| Tab groups | `resize_group` (`group`, `width` / `height` px) |
| Activity panel | `show_panel`, `hide_panel`, `maximize_panel` (optional `tab`), `restore_panel`, `panel_side` |
| Window | `show_sidebar`, `hide_sidebar` |
| Widths | `resize_sidebar`, `resize_panel` (`width` px) |
| Chat | `chat_mode` (`mode` docked / floating / icon, `position` one of 8 snap anchors) |
| Bottom terminal | `show_terminal`, `hide_terminal` |
| Split view | `split_session` (`sessionId`, `direction` any side), `close_split` (`sessionId`) |

**Tab groups.** `snapshot.groups` lists the panel's groups in on-screen order (the
grid depth-first; floating groups are disabled) with a px box inside the panel, computed
from the serialized grid so parked layouts report it too; a tab's `group` indexes
this list. `move_tab` is dockview's own `moveTo`: beside a group (`right` / `down` /
`left` / `up`, a new group on that side) or `into` it at `index`, which also
merges a split back or reorders. `group` defaults to the tab's own. A tab alone
in its group is placed against the group before it (else after it) instead —
moving it beside its own group would make dockview drop that group first and
lose the tab. `resize_group` is the group's `setSize`; neighbours' minimums
clamp it, and the result reports the size it got.

**Widths.** The window is sidebar | chat | activity panel; the chat is the flex
remainder, so narrowing it means widening a neighbour. `snapshot.sizes` reports
each column's width and the `min`/`max` it can take while the others stay put —
the same bounds the resize sashes and the window-resize clamp in `App.tsx` use
(`lib/layout-constants.ts`). A resize clamps to that range and returns the applied
`width`. `resize_panel` counts as the user's own sizing (`userResized`), so the
next open keeps that width instead of filling the window.

**Chat mode.** The chat is a column beside the panel (`docked`) until the panel
fills the window (`selectPanelFillsWindow`): a maximized tab, or the person
floating the chat (`chatFloating`, the chat header's Float Chat menu item, next
to Convert to Mini Window). Then it is the floating `ChatPanel`, expanded
(`floating`) or collapsed to an icon (`icon`, chat store `isOpen`). `chat_mode`
goes through the same `setChatFloating` as the menu: floating keeps every group
as laid out, and `docked` also leaves a maximized tab. Hiding the panel docks the
chat. The split view refuses it as `unavailable`. `position` names the floating
chat's snap anchors (chat store `corner`: corners and edge midpoints); given
alone it moves the chat without changing the mode.

`split_session` accepts only a session the caller spawned. Main checks the spawn
grant (`SPAWNED_SESSION_PROJECT` IPC), and the same check serves agents and
mini-apps. The pane is added beside the caller with `addTile(…, { focus: false })`,
so focus stays where the user had it.

## Surfaces

- **Remote node.** The tools are advertised as Host Actions. The desktop executor
  answers `{ status: 'unsupported', reason: 'remote_node' }`, because a node
  agent has no SuperOne window of its own.
- **Phone.** Execution always targets the desktop. The phone renders the same row
  (`packages/chat-view/src/presenters/LayoutControlToolRow.tsx`) from the projected
  input (`layout_act` keeps `action`, `path`, `line`, `side`, `tab`, `width`,
  `height`, `mode`, `position`).
- **Chat row.** One line per call: the action verb, its subject (file, side, size
  or chat mode), and the outcome when it is not a plain `applied`.

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
