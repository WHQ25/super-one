# Mobile composer, todos, and additional directories

Pairing: scan or paste a `superone://pair?…` QR (shows a 6-digit code to confirm on desktop) or paste JSON `{ "relayUrl", "secret" }`. Connecting opens the first project's new-session landing directly; the workspace drawer is the way to any other project or session. Device ID, pairings, and chat `viewState` persist in AES-256 MMKV; its encryption key lives in platform SecureStore.

The native shell also owns project Git/worktree status, remote file browsing,
provider/model selection, slash/mention overlays, and the IME-safe composer.
**Composer surfaces are mutually exclusive, not stacked.** `ChatComposer` renders
exactly one overlay above the input: `overlay` when a command owns the slot,
otherwise the slash and mention lists. `MobileApp` picks it by priority from the
panels a command opened — slash output, `/mcp`, `/workflows` — which also close
each other, so the chain only settles ties. Stacking them is how a command list
came to be painted under the panel that command had just opened.

**The session's todos have exactly one surface**: `ui/todo-panel.tsx`, a strip
between the transcript and the composer, matching Flutter and the desktop's
`TodoPopup`. The chat WebView used to paint a second copy at the top of the
transcript; it was removed along with the `todos` field on `ReductionProjection`,
because the same `runtime.session.todos` fed both and a six-item plan was drawn
twice on a phone screen. Collapsed it is one line — `Todos (n/m)` beside a glyph
that breathes while a todo runs. The glyph, not the count: desktop pulses the
text, but at phone size a fading number reads as the number being unreliable.
Expanded it scrolls inside 140 pt rather than pushing the composer
off screen, and keeps the running row centred as the agent walks the list. Rows
carry `#id`, the active form while running, an owner, and a blocker badge built
from **both** directions of the dependency graph (`blockedBy` plus the inverted
`blocks` edges — reading one side drops half the gates). Row shaping is pure and
lives in `todo-panel-state.ts`; the component only paints. The phone gets a
full-bleed strip between two hairlines and a tablet gets the desktop's inset
card, off the same `shouldUseTabletComposer` gate the composer uses. Neither is
filled — see the rule below.

**Additional working directories are a page, not a composer panel.** `/add-dir`
and the status row's folder chip both open the `add-dir` route
(`screens/add-dir-screen.tsx`);
`/mcp`'s rule applies — the command clears its own line rather than being left in
the draft. It is a **route** and not a width branch on purpose: `add-dir` is in
`DETAIL_SCREENS`, so a tall tablet keeps the session list beside it and the page
reads as a detail panel, while a phone — portrait or landscape — gets a full
screen, the deal `worktree` and `branch` already have.

Two steps: the overview says what the session already has and ends in two
side-by-side buttons — Add to project / Add to session — and picking one opens
**Add Project's local-folder browser**, which is shared rather than
reimplemented. The scope is a pair of buttons rather than list rows because it
is the action the page exists for and must not be something to scroll past, and
**session is the accented one** — the folder being reached for is usually wanted
for the conversation in progress, while adding to the project is the deliberate,
durable choice.
`ui/browse-page.tsx` is that browser (field + grouped list + loading/empty/busy
chrome, extracted from `AddProjectScreen`, which now renders through it), over
`@superone/shared/path-browse`: the field *is* the path, everything before the
last separator is the directory to list and what follows fuzzy-filters it, so a
typed path, a tapped row and a pasted absolute path are one gesture. A **null
`placeholder` drops the field entirely**, which is how Add Project's source step
renders: three rows to tap is not something to type at, and a field there raised
the keyboard over most of the list. The version this replaced had breadcrumbs,
its own search box and `..` buttons — three worse
ways of saying the same thing. Both pages commit from the **header's confirm
slot**, and both resolve the target with `resolveBrowsePath`; the difference is
that Add Project may create a missing folder while `add-dir` gates its confirm
on `resolved.exists`, because the host only accepts a directory that is there.
Back walks out of browsing before it leaves the page (`additionalDirs.canGoBack`),
the way Add Project walks its own steps.

What the session already has is reported by `AdditionalDirsChip`, which sits on
the **outer right edge of the composer's status row** — a folder glyph and a
count, with the names and full paths one tap away in its popover, because that
row is already spending its width on a model name. Outermost because it is the
only chip in that group that comes and goes: anywhere else, its arrival shifts
the two beside it. It is a launch-time readout like the chip row it replaced: the
caller empties both lists once the session is running rather than the chip
learning what a session is, and it hides at zero, so `/add-dir` is the entry
point until there is one. It reports **both scopes** — its predecessor showed
only `workspaceDirs`, so a folder added to the *session* on the landing appeared
nowhere and read as a failed write.

**The chat column is one background; every boundary in it is a border.** Header,
transcript, todo strip, status row and the input all sit on `colors.background`,
and the input's edge is `borderWidth` + `colors.border` with **no fill** — the
same treatment desktop gives `ChatInput` and `TodoPopup`, both of which are
`border border-border` with no `bg-` class. Filling any one of them (a `surface`
input pill, a `surface` todo strip) turns the column into stacked planes and the
filled element reads as a panel dropped on top of the chat rather than part of
it. A Flutter token name like `surfaceContainerHighest` is not a licence to fill:
it says "raised surface", not "raised above *this* neighbour".

The transcript is the other half of that background and it is **not** brand
tinted, which is a mobile-only divergence from desktop. `--background` resolves
through `oklch(0.975 0.002 var(--brand-hue))`, so on desktop the whole window
shifts hue together and nothing seams. Here the RN shell paints from the two
precomputed neutral palettes in `theme/tokens.generated.ts` and cannot follow the
harness, so a tinted document background put a measurable edge where the WebView
met the header — `#f8f6f6` against `#f6f7f8` at Claude's hue. `chat-view`'s
`theme.css` pins `--background-h: 240` for that reason; `--brand-hue` still
drives every accent in the transcript, and dark mode is chroma 0 either way.
Check this with pixels, not eyes: 2/255 on one channel is invisible in isolation
and obvious as a seam.

**The status row is two anchored groups, not one line.** Left, scrolling: the
model / effort chip and the permission mode — what the next turn will *do*, read
from the same edge as the message above it. Right, fixed: context ring, sandbox,
additional folders — what the session currently *is*, against the side the send
button is on. `flex: 1` on the left group's `ScrollView` is what pins the right
group; it holds whether the left is one chip or three, and a 60-character model
name scrolls under a clipped permission chip rather than pushing a readout off
the screen. The tablet card gets the same split between its attach and send
buttons. Adding a chip means choosing a group, not appending to the row.

**The status chips have no disclosure arrows.** Model and permission dropped
theirs for the width; what says a chip opens a menu — and that its menu is the
one showing — is `chipTriggerBackground` in `ui/chip-metrics.ts`, which lights
the chip while `pressed || open`. Every menu chip in the row uses it, so a new
one inherits the affordance instead of reintroducing a chevron.

Both scopes are editable, matching the desktop popup's PROJECT / SESSION groups.
Project writes go to `setProjectExtraDirs` and reach a live session because
`resolveEffectiveDirs` recomputes the set every turn. Session writes go to
`set_session_additional_dirs` — except before the session exists, where the
landing holds them and hands them to `create_session`, the way the desktop's
draft session does. Nothing in the protocol asks for a session's own folders, so
they are read off the raw event batch (`additional-dirs-events.ts`): from
`additional_dirs_changed` when it names *this* session, and from `init_ready`'s
effective set minus the project's, which is the only moment the host volunteers
them. `/add-dir` is injected from a single capability gate
(`harnessSupportsAdditionalDirs`) rather than copied into each harness catalog —
the desktop's rule for `/side` and `/goal` too.
New Claude sessions may stay local, reuse an existing worktree, or
create branch/attach/detach worktrees; validate the selection before `create_session`.
Structured collaboration confirms must send `sessionAgentLaunchesJson` through
`respond_permission.formAnswers` so handoff launches retain their server-owned mode.
Route every user-triggered RPC or fire-and-forget transport command through
`runUiAction` unless the called function already catches and surfaces its own errors.
It must catch both synchronous `RelayClient.send` failures and rejected promises; never
discard either with a bare `void` from a press or submit handler.
