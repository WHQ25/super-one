# Desktop layout control

Agents and mini-apps can read and arrange the SuperOne desktop: open a file as a
tab, manage tabs, show or hide the activity panel and the bottom terminal,
collapse or resize the sidebar, resize the panel, dock or float the chat, switch the foreground session, and put another session in the split view.

## One implementation, two entry points

All layout state lives in the renderer (zustand stores plus the dockview dock), so
the shared layout engine is `apps/desktop/src/renderer/src/lib/layout-control.ts`.
The agent adapter `lib/layout-session.ts` resolves an explicit UI target separately
from the authenticated caller. `lib/layout-mosaic.ts` coordinates complete session
layouts, using the shared mosaic store and `mosaic-geometry.ts` for sizing. The contract types are in
`packages/shared/src/layout-control.ts`.

| Entry point | Path to the renderer | Caller |
|---|---|---|
| `layout_snapshot` / `layout_act` agent tools | `mcp/layout-control-tools.ts` → `browserAutomationCall` (ops `layoutSnapshot` / `layoutAct`) → `runBrowserOp` | Authenticated calling session plus an independently resolved UI target |
| Mini-app `context.layout.snapshot()` / `act()` | Node Host `requestAction('layout.*')` → host-action bridge → `miniapp-host-actions.ts` | The mini-app's holder session (see below) |

The renderer call bridge only targets the main window. Pop-out session windows
have no activity panel and are not controlled.

## Rules

**Explicit UI targets.** Both agent tools accept `target`: `caller` (the default),
`foreground`, or `{ environmentId, sessionId }`. IDs come from session list/search
or collaboration results. `localhost` means the invoking session's environment,
including node Host Actions; it never means the desktop merely executing the call.
References resolve through the existing verified environment/session-link gateway.
Missing, hidden, offline and changed-identity targets fail without local fallback.

Snapshots include `targetSession`, `focusedSession`, and `visibleSessions` as
qualified references. Mosaic's focused tile and visible tiles are reported
separately; chat visibility does not imply that the activity panel is on screen.

**Navigation is explicit.** `focus_session` requires an object target. It switches
the main window to that session. In single mode it waits for the App-owned
activity dock restore. In mosaic mode it focuses an existing tile, or replaces
the focused tile's session while preserving tile count, position and proportions.
It never implicitly maximizes. Session links use the same navigation path. It works while the invoking session is in the background. It does not
start an agent turn, move a voice call, or activate the OS window.

Preparation drops superseded navigation when the user changes sessions or a newer
link/layout navigation takes over. An aborted bridge call cancels renderer work.
Superseded actions return `status: skipped`, `reason: superseded`; a dock-readiness
timeout reports an actionable error instead of claiming the panel is ready.

**Non-navigation actions preserve the foreground.** Panels, tabs, file roots, queues, and
terminal visibility belong to the resolved target. Foreground resolves once per
call. Use an explicit object across a presentation sequence to keep operating on
the intended session when the user navigates between calls.

- A live target layout changes immediately: `status: applied`.
- A parked target's dock changes queue until its next restore: `status: queued`.
  Show/hide panel writes its parked view state directly.
- Window-wide changes apply only while the target's chat is on screen; otherwise
  `status: skipped`, `reason: not_visible`.
- `visible` also requires the app window to be visible.
- Remote layout/terminal keys include the client connection, so a node's session
  ID cannot share the local session's parked layout or dock queue.

**Files follow their target.** Relative paths use the target's effective cwd or
worktree. Remote roots retain their environment route and use the existing file
RPC. File panel parameters store that root, so later foreground/project changes
do not redirect an open file to another checkout or machine.

Example (replace the placeholder IDs with list/search results):

```js
const worker = { environmentId: 'worker-environment-id', sessionId: 'worker-session-id' }
layout_act({ action: 'focus_session', target: worker })
layout_act({ action: 'show_panel', target: worker })
layout_act({ action: 'open_file', target: worker, path: 'reports/result.md' })
layout_snapshot({ target: 'foreground' })
```

**Openers are reported, not enforced.** `dock-ownership.ts` records who opened
each tab, per session: `agent`, `miniapp:<appId>`, or nobody (the user), and the
snapshot reports it as `openedBy` so a caller can clean up after itself. Opening
a tab that already exists keeps it the user's. A closed tab or split pane is
cheap to reopen, so `close_tab` closes any tab and `close_split` any pane,
including its own; closing every tile retains the focused session.

Agent-opened tabs are:

- browser tabs from `browser_tabs` open;
- terminals with `agentSessionId`;
- files from `layout_act`.

Focus, split, maximize and close work on any tab.

**No duplicate entry points.** Browser and terminal tabs are opened with
`browser_tabs` / `terminal_tabs`. `layout_act` only focuses, splits or closes them by
id. Terminal tabs are named by the bare id `terminal_tabs` uses.

**No confirmation.** Every action is reversible and changes SuperOne's own
layout. The tools remain static host-owned with no executor confirm; subagents
may call them. Targeting a session grants no messaging or execution rights over it.

## Actions

| Area | Actions |
|---|---|
| Session navigation | `focus_session` (`target` object required) |
| Open tabs | `open_file` (`path`, `line`) |
| Manage tabs | `focus_tab`, `close_tab`, `move_tab` (`group`, `direction` right / down / left / up / into, `index`), by `tab` |
| Tab groups | `resize_group` (`group`, `width` / `height` px) |
| Activity panel | `show_panel`, `hide_panel`, `maximize_panel` (optional `tab`), `restore_panel`, `panel_side` |
| Window | `show_sidebar`, `hide_sidebar`, `window_mode` (`mode` mini / full), `resize_window` (`width` / `height`), `enter_fullscreen`, `exit_fullscreen` |
| Widths | `resize_sidebar`, `resize_panel` (`width` px) |
| Chat | `chat_mode` (`mode` docked / floating / icon, `position` one of 8 snap anchors) |
| Bottom terminal | `show_terminal`, `hide_terminal` |
| Split view | `split_session` (`sessionIds` complete list, or legacy `sessionId` + `direction`), `close_split` (`sessionIds`, `sessionId`, or `closeAll`) |
| Split presentation | `maximize_split` (`target` tile), `restore_splits`, `resize_splits` (`dividers: [{id, ratio}]`) |

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

**Native window mode.** `window_mode` converts the current app window in place to
`mini` or restores the complete app with `full` (not OS fullscreen). It reuses the
menu's fold/unfold flow, preserves the mounted chat and panel preferences, and
waits for the native animation before returning `applied`. Native failures and
timeouts return errors. The current mode is a no-op; overlapping transitions are
unavailable. Only an on-screen target in a visible window can change it; hidden
targets return `skipped` without switching sessions. Close the split view with
`close_split` before converting to mini. `snapshot.window.mode` reports the
destination mode, and `snapshot.window.transitioning` reports an ongoing animation.
This is independent of the chat's `docked` / `floating` / `icon` presentation.

```ts
layout_act({ action: 'window_mode', mode: 'mini', target: 'foreground' })
layout_act({ action: 'window_mode', mode: 'full', target: 'foreground' })
layout_act({ action: 'resize_window', width: 1280, height: 900, target: 'foreground' })
layout_act({ action: 'enter_fullscreen', target: 'foreground' })
layout_act({ action: 'exit_fullscreen', target: 'foreground' })
```

`resize_window` accepts either or both positive integer dimensions. Native outer
bounds and display work areas use device-independent pixels (DIP), while layout
columns/groups use viewport CSS pixels. The host clamps to the layout minimum
and the current display's work area and reports the actual applied `width` and
`height`. It restores a maximized window before resizing; exit fullscreen first.
Fullscreen actions set a state, so repeating one is a no-op. Restore a mini window
with `window_mode: full` before entering fullscreen. Native fullscreen actions
wait for the matching OS completion event; concurrent changes, timeouts and closed
windows fail explicitly. IPC uses the requesting renderer's window, including
state reads and minimum-size enforcement.

`snapshot.window.native` contains `bounds`, `minSize`, `workArea`, `fullscreen`,
`maximized` and `transitioning`. The small window reports its effective collapsed
sidebar and docked chat without changing the user's saved panel preferences.

## Action results and follow-up calls

Every normal `layout_act` result includes a `state` projection with the relevant
post-action values. Reuse these values and ids for the next action; a full
`layout_snapshot` is needed for missing information or after external UI changes.

| Actions | Returned `state` |
|---|---|
| `focus_session` | Target window, panel, terminal, chat, sizes, all tabs and groups |
| `split_session`, `close_split`, `maximize_split`, `restore_splits`, `resize_splits` | Window and sizes; full split tree/geometry/capacity in `layout` |
| `open_file`, `focus_tab`, `close_tab`, `move_tab` | Related and active tabs, fresh groups, panel; chat/sizes when affected |
| `resize_group` | Fresh group indices and geometry |
| `show_panel`, `hide_panel`, `panel_side`, `resize_panel` | Panel and sizes; chat/groups when affected |
| `maximize_panel`, `restore_panel` | Panel, chat mode/position, sizes, related/active tabs and groups |
| `show_sidebar`, `hide_sidebar`, `resize_sidebar` | Effective sidebar visibility and sizing ranges |
| `chat_mode` | Applied chat mode/position, panel and sizing ranges |
| `window_mode`, `resize_window`, `enter_fullscreen`, `exit_fullscreen` | Window including native bounds/constraints/fullscreen state, sizing ranges and groups |
| `show_terminal`, `hide_terminal` | Target terminal open state |

Viewport/sidebar changes also return updated session `layout` geometry and capacity.
Other actions no longer repeat unrelated session geometry. Tab results include
the requested/result tab and active tab; navigation returns all target tabs.
Use the returned `groups` after tab moves/merges because their indices may change.
Queued results describe saved/queued target state and omit on-screen sizes and
group geometry. Superseded navigation returns window state only, with the actual
session arrangement in `layout`; it does not claim the requested target is visible.
`skipped` reports the current state without implying that the requested change ran.
Mini-app layout calls use the same result projection.

```ts
const moved = await context.layout.act({ action: 'move_tab', tab, direction: 'down' })
const group = moved.state?.tabs?.find(item => item.tab === tab)?.group
if (group !== undefined && moved.status === 'applied') {
  await context.layout.act({ action: 'resize_group', group, height: 400 })
}
```

## Complete session layouts

`split_session({ sessionIds: [...] })` replaces the displayed session list in one
store commit. The current session stays only when listed. Omitted sessions leave
the presentation; their tasks continue. Focus stays on the same environment/session
identity if present; otherwise the **first listed session** receives focus.
One listed session returns to single mode and clears the saved mosaic.

Each entry is either a session ID or `{ environmentId, sessionId }`. Strings use
`sessionEnvironmentId` when supplied, otherwise the target's environment.
`localhost` always resolves to the invoking host. Every entry is resolved and
validated before application, including feature gates and remote availability.
Fallback focus activation also finishes before the tree commit; activation failure
leaves the old tree intact. Dimensions and navigation are checked again after it.
Duplicate qualified identities and conflicting `sessionIds` + `sessionId` or
batch `direction` arguments fail without changing the layout.

Without `layout`, automatic arrangement prefers as many horizontal columns as
fit, adding rows only when minimum width requires it. Sessions are distributed across balanced rows in
list order; rows have equal height and each row's columns have equal width.
A final uneven row fills its width. The existing minimum tile width/height and
fixed divider sizes govern capacity. The available card content box is measured
at execution and clipped to the current viewport, excluding actual sidebar, card
margins and borders. Mosaic replaces
the single-view header and activity panel, so those are not reserved from its area.
If the complete batch cannot fit, the existing layout is preserved and the error
reports current capacity plus recovery options.

For explicit structure, add `layout` to the same complete `sessionIds` batch.
A leaf is a **0-based index** into `sessionIds`; each index must appear exactly
once. A branch is `{ direction, first, second, ratio? }`: `row` splits left/right,
`column` splits top/bottom, and `ratio` is the first child's share excluding the
divider (default `0.5`, range `0.05–0.95`). Nest branches to choose the structure,
order and proportions independently of automatic arrangement. The first listed
session remains the fallback focus even when its index occurs elsewhere in the
tree. All existing session resolution, focus preservation and atomic validation
rules apply. An explicit layout is never automatically reshaped or clamped to fit.
Every tile must fit the current minimum dimensions, checked again after async
focus activation before committing.

For example, five sessions with a full-height left column and two right columns,
each split equally top/bottom:

```ts
layout_act({
  action: 'split_session',
  sessionIds: ['A', 'B', 'C', 'D', 'E'],
  layout: {
    direction: 'row', ratio: 1 / 3, first: 0,
    second: {
      direction: 'row',
      first: { direction: 'column', first: 1, second: 2 },
      second: { direction: 'column', first: 3, second: 4 },
    },
  },
})
```

Divider gaps count toward minimum size. A root ratio of `1 / 3` gives the
left tile approximately one third of the available width; the two right columns
divide the remaining width equally.

The legacy `split_session({ sessionId, direction })` still adds one peer beside
the target, without moving focus. It uses the same validated environment routes
and minimum-size geometry. The default direction is `right`.

`close_split({ sessionIds })` removes all named tiles together, including tiles
in the hidden saved tree while maximized. The legacy `sessionId` form remains.
All requested tiles must exist before any are removed. If focus is removed, the
first remaining tile in tree order is selected. If the list names every tile,
the currently focused session remains alone. At one remaining tile the workspace
returns to single mode and clears restore state. `closeAll: true` always retains
the focused session alone and clears restore state; it excludes explicit session
identities. Closing never deletes sessions or stops tasks.

`maximize_split` temporarily displays its target mosaic tile alone and saves
the tree and proportions. Repeating it for the same tile is a no-op; a plain
single workspace without a saved mosaic returns an actionable error. A saved
tile can also be maximized directly. `restore_splits` restores the saved tree,
keeping current focus and the saved proportions. Like the UI restore control,
single-view navigation owns the saved focused slot: an existing saved session is
focused, otherwise it replaces that slot. Restore is a no-op when already in
mosaic or when no saved layout exists. It revalidates all sessions, remote gates
and current space; insufficient space leaves the saved/single state intact.

`resize_splits({ dividers: [{ id, ratio }, ...] })` applies ratios to the visible
mosaic only. `row` dividers split left/right; `column` dividers split top/bottom.
A ratio is the first child's share of its parent's space **excluding** the divider.
IDs must be current and unique; ratios must be finite and within the existing
0.05–0.95 range. All parent/child changes are validated against the **final** tree
and minimum tile dimensions, then committed together or rejected together.
To change topology or reorder tiles, use `split_session({ sessionIds, layout })`.
Resizing preserves an explicit layout's structure; maximize/restore also preserves
its structure and proportions.

## Session geometry and results

Agent snapshots and action results share `layout: SessionLayoutSnapshot`:

- `mode`: `single`, `mosaic`, or `maximized` (single with a restorable tree).
- `area`: available mosaic box in viewport CSS pixels, origin at the viewport's
  top-left; `minTile`, `dividerSize`, and `maxSessions` describe current capacity.
  Capacity is the product of the minimum-sized column and row counts, including
  divider space. An unmounted workspace reports a zero area/capacity.
- `tiles`: displayed tile ID, environment/session identity, `x`, `y`, `width`, and
  `height`. Tile/divider boxes are relative to `area`'s top-left, including each
  mosaic tile's header. Single mode measures its actual chat content box.
- `focusedSession`: qualified foreground identity. Settings/hidden workspaces
  have no currently displayed tiles or dividers.
- `dividers`: opaque ID, direction, ratio, and actual box. IDs identify a subtree's
  topology in this renderer lifetime, remain stable through focus and resizing,
  and must be refreshed after topology changes. Only IDs present in the current
  snapshot are accepted; IDs are not portable between windows or app restarts.
- `saved`: hidden/restorable tile identities and divider proportions, with **no**
  visible boxes. Hidden saved geometry is never reported as on-screen geometry.

Relevant action results directly return this structure, including resulting sizes
and proportions; an extra snapshot is unnecessary.

## Background focus stability

Both coding layouts stay mounted to preserve voice output and session/draft state.
Exiting mosaic removes mount protection from its hidden tiles. A regression test
reproduces idle completion evicting a hidden background session, its scoped
selector falling back to the empty default view, and the harness picker then
attempting `switchToSession` on that old scope. Automatic harness selection now
runs only for a loaded selected foreground pane and never navigates. Hidden
project initialization is also fenced; explicit harness selection remains a user
navigation. Voice call state and streaming output do not own foreground focus.

## Tabs opened in the background

Agent openers never reveal the panel or take focus: `browser_tabs` open,
`terminal_tabs` run in a new tab, `miniapp_dev_preview` and
`device_request_control`. Their results add `shown` (`pip` or `background`) and a
`reveal` sentence naming the `layout_act` call that brings the tab forward
(`focus_tab`, or `show_panel` for a device, whose tab is created when the panel
opens). Nothing is added while the caller's panel is on screen. The renderer
answers from session state (`openedTabPresentation`, bridge op `tabPresentation`),
not from the tab, because terminal and device tabs are docked asynchronously;
the wording is `openedTabNote` in the shared contract.

## Surfaces

- **Remote node.** Both node callers (through Host Actions) and node targets are
  supported through the connected desktop main window. Remote targets require
  the Remote Nodes setting; a disabled feature returns an explicit error. There
  is no separate node-owned window. Pop-out windows are outside this API.
- **Chat.** Hidden on the desktop and the phone, like `session_rename`: the layout
  change on screen is the feedback. Both names sit in `HIDDEN_SUPERONE_MCP_TOOLS`
  (`packages/shared/src/tool-ui.ts`); dropping them there brings back the row,
  which stays implemented and routed (`packages/chat-view/src/presenters/LayoutControlToolRow.tsx`,
  one line per call: verb, subject, and the outcome when not a plain `applied`).
  The phone row reads the projected input (`layout_act` keeps `action`, `path`,
  `line`, `side`, `tab`, `width`, `height`, `mode`, `position`, `closeAll`, and
  batch session/divider counts without their opaque identities). Execution always
  targets the desktop.

## Mini-apps

`context.layout` uses the same engine but retains its holder scope: cross-session
`target` arguments and `focus_session` are rejected. It exposes the existing
snapshot and actions, scoped to the session
`miniAppSessionTarget()` resolves. That is the project's active session if it
holds the app, otherwise the first holder. This is the existing binding with its
known ambiguity when several sessions hold one app (`docs/proposals/miniapp-agent-api.md`).

The snapshot's `self` is the app's own tab, so the app can focus, maximize or
split itself. Tabs the app opens are recorded as `miniapp:<appId>`, and
only the app can close them. Author types are in
`packages/shared/src/miniapp-host-api.d.ts`; a type test keeps them equal to
the shared contract. The author guide is the `api-host` manual topic.
