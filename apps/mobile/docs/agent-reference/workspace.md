# Mobile workspace and navigation

At widths below 768 px the shell is single-pane. At 768 px and above a tablet
keeps the workspace beside chat, terminal, settings, files, and the git pickers.
A landscape phone is wide enough for that pane but only ~390 pt tall, so it
keeps the sidebar on **chat only** — File Preview, Files, Terminal and the rest
take the full width (`shouldUseTabletMultiPane`). The composer follows the same
height gate (`shouldUseTabletComposer`): compact on a landscape phone, boxed
card on a tablet.
**Projects and sessions are not screens.** `WorkspaceList` owns both lists the way
the desktop sidebar does, so `routeHierarchy` stacks chat directly on `pair`; back
from a chat opens the drawer and must not end the session. New entry points for
project or session navigation belong in that list, not in a new route.
**`WorkspaceDrawer` and `WorkspaceSidebar` are two mounts of one surface**, not two
surfaces: the drawer adds a scrim, a slide and a close drag, the sidebar a 280 pt
pane, and both render the same `WorkspaceList` from the same props object
(`workspaceList` in `MobileApp`). **The drawer is an overlay in the shell's view
tree, not an RN `Modal`.** A `Modal` is a second UIKit presentation, and inside
one Reanimated's layout animations left a reordered session row stuck invisible
at its old frame on iOS (its touch target over the next project), while UIKit's
one-presentation-at-a-time rule turned every sheet opened during the drawer's
fade-out into a race. The overlay is mounted last in `MobileOverlays`, keeps
itself mounted through its own close animation, and owns Android back while open. The header lives in the detail column, so that
pane is full window height rather than sitting under the session title. That pane
used to be a *session* list for the active project alone, which meant a landscape
phone could only switch project by opening a modal drawer on top of the list
already on screen — so while the sidebar is up the header drops its
`WorkspaceButton` as well as its connection line; one `sidebarVisible` prop covers
both. Only the drawer passes `onLeave`, because only it has something to close.
Because `pair` is chat's stack root, the native back gesture there would show the
device list — so chat sets `gestureEnabled: false` and `EdgeSwipeArea` (a
`PanResponder` strip narrower than the transcript's own gutter, laid *over* the
WebView, because an ancestor `View` gets no say in a WebView's native gestures)
spends that edge on the drawer instead. Android's back button does the same. The
drawer's Disconnect button is then the only way back to the device list. The
drawer closes on the mirror gesture, a leftward drag anywhere on the panel — which
only reaches it because `SwipeRow` claims a drag *only* in the direction that row
can actually travel; a closed row that swallowed leftward drags would block the
close over most of the list.
The list itself is `SessionListBody` over `useProjectSessions` — 30-row paging and
swipe pin/hide/delete. **Reveal and paging are separate numbers.** A project shows
`SESSION_REVEAL_STEP` (6) session *groups* and grows by 6, matching the desktop
sidebar's `INITIAL_EXPAND_LEVEL` / `EXPAND_STEP`; `SESSION_PAGE_SIZE` (30) is the
network page behind it, because over a relay one request covering five reveals
beats five requests. Collapsing them into one number is how the phone ended up
rendering a whole fetch page at once. The count is groups, not rows, so an
expanded collaboration parent's children ride along instead of costing slots, and
the group holding the active session is appended past the limit rather than
promoted — switching sessions must not reshuffle the list under the finger.
Live work is the exception, matching the desktop sidebar: groups that are
running, unseen, or waiting on the user are partitioned to the top of the
project, and a collapsed project still renders those rows (plus the active
session) instead of hiding the whole list. `session_activity` /
`list_session_activity` supply the live status and pending copy; the header
menu shows a red attention dot only for pending/unseen work so a closed drawer
still says the user is needed.
**Several projects stand open at once**, as on the desktop, so the session list is
owned per row (`WorkspaceProjectRow`) rather than per drawer — one shared list
state could only ever serve one project, which is what made this an accordion. A
row mounts its list the first time it is expanded, or as soon as a session in it
is live, unseen, or pending, and keeps it mounted after; collapsing hides ordinary
rows without dropping the loaded list. Expanding unfolds the rows (height 240ms
+ staggered fade/slide) rather than snapping them in; collapse is 180ms with no
stagger. Reduced motion skips both, and so does any expansion the user did not
tap: the drawer remounts the list on every open with the active project already
in the expanded set (initial state, not an effect), and a row only animates
once its own header has been pressed. The first read's spinner takes over the
project row's folder glyph (same 18 pt slot, so nothing else on the row moves),
never inside the list, where it pushed the seeded rows down and back up on
every open.
Opening the drawer adds the active project to the expanded set without disturbing
the rest.

`ProjectSessions.loaded` is the "first read has settled" flag, and the empty state
is gated on it. Do **not** infer emptiness from `!busy`: `busy` only turns on
inside the effect, which runs after the first commit, so the list paints
"No sessions yet" for a frame before it has asked anyone.

The drawer keeps its loaded rows while it is closed:
nulling the project on hide cleared the list and made every open pay for a fresh
page-one fetch. **Re-reading is push-driven, not open-driven.** Every desktop
write that adds, removes or reorders a row emits `session_list_changed`
(projectPath, no rows — an invalidation, and no `sessionId`, which is what makes
`MobileBroadcaster` fan it out to every paired device). The shell reads it off the
raw event batch *before* `ChatRuntime`, because the drawer has to stay current
while no session is open at all, and bumps one counter; the drawer re-reads only
when that counter moves, which also covers the cross-project Pinned section. A
reconnect bumps it once — events sent while the socket was down were never
delivered. The re-read is `refresh()`: in place, no spinner, no wipe, and a
failure leaves the cached list alone.

The desktop half is wired at the **db layer** (`watchSessionList` in
`db-sessions.ts`), not at the callers: the same seven mutations are reached from
IPC, the session manager, automations and remote commands, so a notification hung
off each call site would be missed by whichever one is added next. `deleteSession`
resolves its project *before* the DELETE — afterwards there is no row to join
through. A command applies to the list only when it resolves `true`;
the shell reports the failure. Search is **not** in the list: it is global,
host-side (`search_sessions`), and owns the `session-search` screen, which draws
its own field plus Cancel and therefore gets no header bar. The drawer also
carries a cross-project **Pinned** section above Projects (`list_pinned_sessions`),
and search plus new session sit at the *top*. The device it is connected to
sits at the *bottom*, reporting its connection state with
`ConnectionStatusIndicator` beside a disconnect and an app-settings action.
Reaching another desktop means disconnecting first, so that row is a
readout, not a link. There is **no project-settings screen**: every control it
held is already on the chat surface (model, effort, permission mode, sandbox) or
the new-session landing (harness, branch, worktree); `settings` is now the
app-settings placeholder.
Pinned rows are additionally promoted inside a project's list, which the desktop
does not do — a pinned session below the loaded page will not surface until its
page arrives. They carry **no pin glyph**: the Pinned section states it once, and
a badge on the row would say it twice. The Pinned rows are full `SwipeSessionRow`s
themselves, so Unpin is reachable where the pin is visible rather than only in the
project the session happens to live in.

**A horizontal gesture on a container must stand down while a row inside it is
open.** `SwipeRevealScope` (`ui/swipe-reveal-scope.tsx`) is how: the drawer creates
one, provides it around the panel, and `SwipeRow` reports into it. With a row open
a leftward drag means "put this row back", not "close the drawer", and the drawer —
being the ancestor — can only tell by asking. It is ref-backed, not state: the sole
consumer is a gesture predicate and nothing paints it. A list mounted outside any
scope gets a no-op — which is why `WorkspaceSidebar` provides none: a permanent
pane has no competing gesture to stand down.

Connection feedback has exactly one shell location. On a phone it is the second
line under whichever native header is visible; in the workspace drawer and the
persistent workspace sidebar it is the line under the device at the bottom. It is
never copied into the page-level transient status row. Session headers keep two
facts on that second line: how the phone is reaching the desktop, and which
checkout the session runs in.

- Connection is the same `ConnectionStatusIndicator` / `DeviceStatus` vocabulary the
  device list uses, so the glyph names the *route* — Wi-Fi on the LAN, cloud through
  the relay — and reconnection spells out its backoff (`Reconnecting…`,
  `Retrying in Ns`, warning tone past 8s). It replaced a three-colour dot that could
  not say any of that. A status whose glyph **spins** takes the whole row: the
  project name and the checkout are both dropped, because a moving glyph beside
  static text reads as though the static text were loading too. The condition is
  `describeDeviceStatus(...).spin`, not a list of statuses, so a new animated
  status inherits the behaviour.
- The checkout comes from `describeSessionGit` (`session-git-status.ts`), which
  covers branch, detached HEAD, worktree-on-a-branch, detached worktree, and a
  worktree that was deleted under the session. Two rules there are load-bearing:
  a **local** session shows the *live* project branch (switching branches under a
  running session is allowed, so the snapshot goes stale), a **worktree** session
  shows the *snapshot* branch (the worktree is pinned for its lifetime); and dirty
  counts are local-only, because `get_git_info` counted the project checkout.
  Only the plain-branch chip is tappable — a worktree cannot switch branches.

`isWorktree` / `worktreePath` / `gitBranch` are host facts, read off the
`get_session_state` snapshot (`ChatRuntime.worktree`) rather than inferred from the
project path, so they survive a reconnect. `get_git_info` reports `branch: null` plus
a short `head` on a detached HEAD — never the literal string `HEAD`, which used to
reach the branch picker as a switchable name.

Both halves have an isolated gallery in the offline preview, because the states
worth reviewing are the ones a healthy session never reaches:
`superone://native-preview?page=Session%20status` walks every connection state and
every checkout state through the real `SessionMetaRow`, and
`page=Git%20indicators` does the same for the new-session chips. Add a state to
either union and add its row there — reproducing a deleted worktree or an 8s
reconnect backoff by hand means breaking the desktop on purpose.

Loading and failure states have the same treatment, because a healthy preview
settles in a frame: `page=Loading%20states` holds the native spinners and error
copy (terminal overlay, folder read, session-list paging, collaboration brief,
MCP status, model refresh, branch switch, busy icon button, running todo) through
the real components on slow or rejecting ports, and the Chat page's **Transcript**
selector (`src/preview/transcript-fixtures.ts`) drives the document's own states —
history paging held or failed, navigation index held or failed, `pendingTurn`,
API retry, compacting, compaction failure, recap — plus the native session-restore
cover. Two rules those states enforce. **The document has exactly two loading
surfaces**: a centred spinner while it has nothing mounted yet, and one
backgroundless `EdgeLoader` at each end of the transcript that every fetch
paints on — history paging, a tick-rail jump (top if the target lies above the
window, bottom if below), the legacy `loadEarlier` path — so two fetches can
never stack two indicators at one spot, which is what the old fixed pill over
the in-flow button did; a failed navigation index shows nothing and is simply
asked for again on the next reach for either edge. And the slash catalog's
loading / error strip is reported only while a `/` query is open, because the
catalog reloads on every new session and harness switch and used to flash above
an empty input.

The composer overlays follow the same rule:
`superone://native-preview?page=Composer%20suggestions` walks every slash and
mention state — searching, failed + retry, no matches, skill-only match, CJK and
truncating labels — through the real `SlashSuggestions` / `MentionSuggestions`
and the real `filterSlashCommands` — including the three directory-browse
states, where the breadcrumb is the only way back out of a nested folder. The
chat page itself carries an **Editor: native / Editor: fallback** toggle,
because the native chip editor and the plain `TextInput` fallback insert and
serialise differently; reviewing only
one of them is how a fallback-only regression ships.

**Do not port the desktop's `--sidebar-*` palette.** It was tried and reverted: in
light mode those tokens are a dark inverted chrome, which at phone width reads as
a second app rather than a panel of this one. The drawer and the workspace sidebar
use the ordinary content neutrals (`surface` / `background` / `muted`), and
`SessionRowContent` takes `surface: 'panel' | 'page'` only so a swiped row can
swap to the opposite neutral while it covers its actions. Harness colour belongs
to the transcript, which gets it through `mobileWebViewTheme`'s `hue` — not to the
shell chrome.
The app root is wrapped in `SafeAreaProvider`; keep screen chrome inside the
`SafeAreaView`. Status-bar style follows the active theme (dark shell → light status
bar, light shell → dark). Do not replace the insets with fixed top/bottom padding:
Android edge-to-edge navigation will cover footer/composer content.


## Shell conventions

- **Tokens, not hex.** Colours, spacing and type come from `src/theme/` (generated from
  `@superone/ui/styles/theme.css` OKLch values plus the per-harness hue from
  `@superone/shared/harness-brand`). No raw hex in components; `styles.ts` is being
  retired. The app **ships dark** (`DEFAULT_THEME_MODE` in `mobile-preferences.ts`);
  `system` is still offered in app settings but is an opt-in, so nothing may assume the
  shell follows the OS appearance. The same token module feeds `setTheme` for the chat
  and terminal WebViews. Language defaults the same way: `systemLocale()` resolves the
  device locale through `resolveSystemLocale`, which answers `en` for anything outside
  `supportedLocales`.
- **Screens live under `src/screens/`**, navigation under `src/navigation/` (React Navigation native stack),
  primitives under `src/ui/`. `App.tsx` stays under 300 lines; state modules stay in
  `src/*-state.ts` with unit tests, as today.
- **Track desktop `main`, not v0.55.2.** Every supported `PermissionRequest.requestKind` (including `session_cleanup_confirm`, `automation_confirm`, `webmcp_trust_confirm`,
  `device_control_confirm`)
  gets a real sheet; create/send works for every `HarnessId` and reads
  `HARNESS_CAPABILITIES` instead of hard-coding harness names.
- Permission mode is a compact selector, never a chip row. Effort is hidden for mapped
  providers (desktop rule).
- Tool rows come from `@superone/chat-view` presenters. `PortableTool` is the fallback
  for tools without a presenter, not the target experience; check the relevant presenter and native bridge before declaring a tool supported.
  Desktop mini-app WebViews are not automatically available in the mobile transcript.
