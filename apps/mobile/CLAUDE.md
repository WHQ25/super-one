# CLAUDE.md — `apps/mobile` (`@superone/mobile`)

Expo **dev-client** Remote Control app. Not Expo Go.

Repo-wide layout: root `CLAUDE.md`. Migration plan: `docs/design/flutter-to-expo-migration-plan.md` —
read §1a and **Wave 8** (WP-25–29); that is the only live schedule. WP-23/24 are superseded.
Order: WP-25 (land on `main`) → WP-26 (design system + navigation) → WP-27 (shell parity)
∥ WP-28 (chat-view tool families) → WP-29 (lean release).

The Flutter app at `../../../super-one-flutter/lib/*.dart` (frozen 2026-06-20) is the
**behavioural and visual reference** for the shell; `integration_test/` there lists the
expected flows. It is not a code source: nothing is ported from Dart, and its
`claude|codex`-only harness gate must not be reproduced.

## Runtimes

| Runtime | Owns | Does not own |
|---------|------|----------------|
| **RN shell** | Pairing, nav, native `TextInput`, sheets, MMKV, chat-core reduce, host batching (≤1/33 ms) | Transcript paint |
| **Chat WebView** (`@superone/chat-view`) | DOM paint of reduction patches, scroll, expand | Re-reducing `AgentEvent`s |
| **Terminal WebView** | xterm frames | Event ACK / seq |

Never nest the chat WebView in an RN `ScrollView`. Input is native only.
The conversation tick rail also lives in the chat WebView (`ChatScrollIndicator`),
where it can measure and navigate the transcript without round-tripping through RN.
Its turn outline and tick curve are shared with desktop. Touch scrubbing previews
questions and replies, then jumps on release; compact ticks expand/collapse history.
Navigation mounts a bounded neighborhood around the target, and paging moves in
both directions while retaining a visible anchor and the 40-message DOM ceiling.
At widths below 768 px the shell is single-pane. At 768 px and above, chat,
terminal, settings, and files retain the project/session sidebar as a master pane.
**Projects and sessions are not screens.** `WorkspaceDrawer` owns both lists the way
the desktop sidebar does, so `routeHierarchy` stacks chat directly on `pair`; back
from a chat opens the drawer and must not end the session. New entry points for
project or session navigation belong in the drawer, not in a new route.
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
**Several projects stand open at once**, as on the desktop, so the session list is
owned per row (`WorkspaceProjectRow`) rather than per drawer — one shared list
state could only ever serve one project, which is what made this an accordion. A
row mounts its list the first time it is expanded and keeps it mounted after;
collapsing sets `display: 'none'`, which takes it out of the accessibility tree
without dropping the loaded rows. Opening the drawer adds the active project to
the expanded set without disturbing the rest.

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
and the device it is connected to sits at the *bottom*, reporting its connection
state with `ConnectionStatusIndicator` beside a disconnect and an app-settings
action. Reaching another desktop means disconnecting first, so that row is a
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
scope (the tablet sidebar) gets a no-op.

The line under the chat title is **two facts, not a subtitle**: how the phone is
reaching the desktop, and which checkout the session runs in.

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

Two things about running `test:ui` that cost real time to learn. **Maestro matches
a whole accessibility label, not a substring**, and a suggestion row composes its
name, argument hint and description into one element — so the assertion is
`"/clear, Clear the conversation and start over"`, never `"/clear"`. And **do not
edit source while a suite is running**: Metro's watcher fast-refreshes the app
mid-flow, which resets `native-preview-ready` and fails unrelated flows in ways
that read exactly like regressions. Conversely, starting the preview with `CI=1`
disables the watcher, and Maestro then verifies a stale bundle — the edit you are
testing is not in it.

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
a second app rather than a panel of this one. The drawer and the tablet sidebar
use the ordinary content neutrals (`surface` / `background` / `muted`), and
`SessionRowContent` takes `surface: 'panel' | 'page'` only so a swiped row can
swap to the opposite neutral while it covers its actions. Harness colour belongs
to the transcript, which gets it through `mobileWebViewTheme`'s `hue` — not to the
shell chrome.
The app root is wrapped in `SafeAreaProvider`; keep screen chrome inside the
`SafeAreaView`. Status-bar style follows the active theme (dark shell → light status
bar, light shell → dark). Do not replace the insets with fixed top/bottom padding:
Android edge-to-edge navigation will cover footer/composer content.

## Shell conventions (WP-26 onward)

- **Tokens, not hex.** Colours, spacing and type come from `src/theme/` (generated from
  `@superone/ui/styles/theme.css` OKLch values plus the per-harness hue from
  `@superone/shared/harness-brand`). No raw hex in components; `styles.ts` is being
  retired. Dark and light both follow system appearance; the same token module feeds
  `setTheme` for the chat and terminal WebViews.
- **Screens live under `src/screens/`**, navigation under `src/navigation/` (expo-router),
  primitives under `src/ui/`. `App.tsx` stays under 300 lines; state modules stay in
  `src/*-state.ts` with unit tests, as today.
- **Track desktop `main`, not v0.55.2.** Every `PermissionRequest.requestKind` (9 today,
  including `session_cleanup_confirm`, `automation_confirm`, `webmcp_trust_confirm`,
  `device_control_confirm`)
  gets a real sheet; create/send works for every `HarnessId` and reads
  `HARNESS_CAPABILITIES` instead of hard-coding harness names.
- Permission mode is a compact selector, never a chip row. Effort is hidden for mapped
  providers (desktop rule).
- Tool rows come from `@superone/chat-view` presenters. `PortableTool` is the fallback
  for tools without a presenter, not the target experience; see WP-28 for the port order.
  Mini-app iframes stay deferred (R6).

## Metro / shared

Import **leaf** `@superone/shared/*` only (`agent-types`, `event-seq-utils`, `agent-event-batcher`, `content-delta`, `tool-ui`, …).

Do **not** import `@superone/shared/attachment-store` or `@superone/shared/git-clone` (Node). Metro `blockList` rejects them.

## Commands

```bash
bun --filter @superone/chat-view build   # first: emits the chat + terminal documents
bun run dev:mobile                       # Expo dev-client Metro
bun --filter @superone/mobile typecheck
bun --filter @superone/mobile test              # vitest (state) + jest (components)
bun --filter @superone/mobile test:components   # jest only
```

**Two test runners, on purpose.** `*.test.ts` (pure state modules) runs on
**vitest**; `*.test.tsx` (React Native components) runs on **jest-expo**
(`jest.config.js`). This is not indecision — vitest cannot load React Native.
RN's `index.js` reaches its internals through lazy `require()` calls that escape
Vite's ESM pipeline and arrive at Node as unparsable Flow source; no combination
of `ssr.noExternal`, `server.deps.inline` or a babel plugin intercepts them.
jest-expo reuses the transform Metro already applies. Four things about it:

- **`render` is async** in React Native Testing Library 14 — React 19 renders
  concurrently and nothing is committed when the call returns. `await` it, or
  every query fails with `render function has not been called`.
- Mount through `renderWithTheme` (`src/test-render.tsx`); `useMobileTheme`
  throws outside its provider.
- **One `fireEvent.press` per test.** Two presses in a single test overlap
  React 19's `act()` scopes (it says so on stderr), and the corruption lands on
  the *next* test in the file, which then renders nothing and fails with
  "Unable to find an element". Split the walk into one press per test.
- **`rerender` after a `fireEvent` in the same test does not commit.** Same act
  overlap, different symptom: the press's scope is still open, so the rerender is
  queued and never applied — an unmount you are asserting on simply has not
  happened, and the test fails claiming the cleanup is broken when it is not.
  `await act(async () => {})` between them does not help. Drive the state change
  through a **prop** instead of a press when the test needs a rerender.
- `renderWithTheme`'s `rerender` re-wraps the provider. RNTL's own replaces the
  whole tree, so a bare `result.rerender` remounts into a tree with no
  `MobileThemeProvider` and every themed component throws.
- **A suite that cannot load reports as missing tests, not failing ones.**
  `jest` prints `Test suite failed to run` and the total simply drops — six
  tests once "disappeared" because a hook had grown an
  `import { mobileKv } from '../storage'`, and `storage.ts` takes a *value*
  from `@superone/relay-client`, dragging `@noble/ciphers` (pure ESM) into a
  CommonJS parse. Fix it by not reaching for the encrypted store from a hook —
  inject it, as `ComposerSuggestionSource.iconStore` does — rather than by
  widening `transformIgnorePatterns`. Check the total, not just the exit code.
- `jest.config.js` pins `^react$` to this workspace's copy. Bun leaves a nested
  `apps/mobile/node_modules/react` (pinned 19.1.0) beside the hoisted root one,
  and without the mapping `react-reconciler` and the components under test load
  different React instances — every hook then sees a null dispatcher.

Vitest itself resolves `localhost` at startup, so it fails under the default
tool sandbox; jest does not.

`packages/chat-view/src/generated-host-html.ts` and `generated-terminal-html.ts` are
**build artifacts** (6 MB) — gitignored, never committed, produced by the chat-view build
above. Mobile `dev` / `test` / `typecheck` must run that build first (WP-25 wires a
`build:chat-view` root script and `pre*` hooks); a missing artifact must fail with a
readable error, not deep inside Metro.

EAS files live in this app directory. Run EAS commands from `apps/mobile`, not the
monorepo root. `eas.json` pins the root Bun version, builds the `internal` profile as
an installable Android APK, and reserves `production` for TestFlight/store builds.
Both release profiles use remote build-number increments; the native app version is
the EAS Update runtime compatibility boundary. Keep `credentials.json` local and
ignored. `assert-release-config.ts` (static, cheap) stays in the test command.

**Release acceptance (WP-29).** Shipping requires one release-mode smoke on one
physical iPhone and one physical Android (pair by camera QR, stream + stop, Pinyin IME,
one sheet of each kind, 10 s airplane-mode flap, terminal `pwd`, one image attach, one
received file, iPad rotation with a sheet open) plus a single RSS sanity run of the
200-turn corpus under 250 MB — tighten the 24/40 DOM window if it is over. Record the
result as a short Markdown note under gitignored `docs/temp/`. Screenshots and videos
never enter git.

Needs a **dev client** (`expo run:ios` / `expo run:android`), not Expo Go.
After changing native dependencies or config plugins, run `expo prebuild` before the
local native build; an existing ignored `ios/` directory is otherwise intentionally
reused and may contain stale Info.plist entries or pods.

CocoaPods crashes with `Encoding::CompatibilityError` under this repo's default
shell locale. Prefix `pod install` **and** `expo run:ios` with
`LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8`; without it `expo run:ios` exits on its own
`pod install` before xcodebuild ever starts, which reads as a successful no-op.

**Drawing.** `react-native-svg` covers gradients and masks over measured text.
`@shopify/react-native-skia` (with `react-native-reanimated` and the
`react-native-worklets/plugin` babel plugin, which must stay last) covers
anything needing a real canvas — currently the `max` effort easter egg's particle
fire, which needs `BlendMode.Plus`. RN views composite with plain alpha, so
overlapping particles can only get muddier, never hotter; that is why the
easter egg is not pure `Animated`. Skia work belongs in immediate mode
(`Skia.PictureRecorder` inside `useDerivedValue`) with the expensive part
precomputed on the JS thread — see `src/fire-sim.ts` and `src/ui/fire-embers.tsx`.
Adding these was a native dependency change: pulling this commit requires a
dev-client rebuild, not just a Metro restart.

Pairing: scan or paste a `superone://pair?…` QR (shows a 6-digit code to confirm on desktop) or paste JSON `{ "relayUrl", "secret" }`. Connecting opens the first project's new-session landing directly; the workspace drawer is the way to any other project or session. Device ID, pairings, and chat `viewState` persist in AES-256 MMKV; its encryption key lives in platform SecureStore.

The native shell also owns project Git/worktree status, remote file browsing,
provider/model selection, slash/mention overlays, and the IME-safe composer.
**Composer surfaces are mutually exclusive, not stacked.** `ChatComposer` renders
exactly one overlay above the input: `overlay` when a command owns the slot,
otherwise the slash and mention lists. `MobileApp` picks it by priority from the
panels a command opened — slash output, `/mcp`, `/workflows` — which also close
each other, so the chain only settles ties. Stacking them is how a command list
came to be painted under the panel that command had just opened.

**Additional working directories are a page, not a composer panel.** `/add-dir`
and the folder chips both open the `add-dir` route (`screens/add-dir-screen.tsx`);
`/mcp`'s rule applies — the command clears its own line rather than being left in
the draft. It is a **route** and not a width branch on purpose: `add-dir` is in
`DETAIL_SCREENS`, so at 768 pt and up the shell keeps the session list beside it
and the page reads as a detail panel, while a phone gets a full screen — the deal
`worktree` and `branch` already have.

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
typed path, a tapped row and a pasted absolute path are one gesture. The version
this replaced had breadcrumbs, its own search box and `..` buttons — three worse
ways of saying the same thing. Both pages commit from the **header's confirm
slot**, and both resolve the target with `resolveBrowsePath`; the difference is
that Add Project may create a missing folder while `add-dir` gates its confirm
on `resolved.exists`, because the host only accepts a directory that is there.
Back walks out of browsing before it leaves the page (`additionalDirs.canGoBack`),
the way Add Project walks its own steps.

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
Chat WebView native requests route HTTPS links, clipboard copies, and stripped remote
file-tool metadata through RN. `openFile` resolves relative `toolFilePath` values against
the active project and opens the containing directory; `previewFile` requests a signed
desktop URL, verifies/decrypts the bytes for the active LAN/relay transport, and opens the
native receive/share sheet. The native file browser uses that same path for file rows;
directory rows navigate only. Remote path helpers must preserve POSIX roots, Windows
drive roots, and UNC share roots. Coalesce concurrent reads of the same project/session/path
until the first request settles. Unsupported actions must return an error response, never
`{ ok: true }`.
Images and PDFs use the `ImageAttachment` message path. Project file upload uses inline
RPC through 256 KiB, raw LAN PUT when connected locally, or chunk-encrypted relay R2
PUT plus completion through 100 MiB. Picker-reported sizes are optional metadata, not a
security boundary: check `File.size` before reading a whole PDF or project file, then
enforce the exact decoded byte count for base64 image/PDF payloads. Reject missing or
malformed base64 instead of treating it as an empty attachment.
Desktop `shared_file` events bypass chat reduction and enter the same native receive
sheet. Inline payloads and encrypted relay downloads are size-checked, capped at 100 MiB,
written under sanitized cache names, and deduplicated by `shareId` before preview/share.

The device list discovers desktops over mDNS through the local `modules/lan-browser`
Expo module (`_superone._tcp`, matched to a pairing by the `roomId` TXT key) and probes
reachability without a raw socket: the relay's `/status` room endpoint for the cloud
route, and an HTTP GET against the desktop LAN server — which answers `426 Upgrade
Required` — for the local one. The native module is optional at import; a dev client
built before it existed degrades to relay-only discovery. Terminal
frames use `RelayClient.send` / `onTerminal` and never ACK. The separate terminal
document embeds xterm.js, prefers the patched WebGL renderer, falls back to canvas,
and reports input and bounded resize messages to RN.

## Relay transport invariants

- `RelayClient` owns exactly one active socket. Connecting through LAN replaces relay,
  and connecting through relay replaces LAN.
- Open/reconnect starts event buffering before replay. Session restore then runs
  subscribe → history → snapshot → release; a server `reset` discards pre-reset
  batches and triggers the same restore path.
- Transport loss retries with bounded backoff until it succeeds or a manual connection
  cancels the loop. A reopened socket is still `reconnecting`: publish `connected` and
  the new epoch only after rehydrate releases the buffer. Re-send the current connection
  snapshot whenever the Chat WebView reports `ready` after a renderer reload.
- Opening and creating sessions are mutually exclusive because every restore uses the
  client's single event buffer. Validate new-session worktree input before unsubscribing
  the current session; on transition failure, dispose the incomplete runtime and reopen
  the workspace drawer instead of leaving a stale chat detail active.
- Released buffers assign the runtime epoch. Live batches from older epochs are
  dropped, and overlapping restores may only commit their newest generation.
- Script-fatal errors and native iOS/Android WebView process exits reload and
  hydrate the chat document, bounded to two reloads per 10-second window.
- Only relay `event` envelopes advance or emit cumulative ACKs. LAN and terminal
  frames never produce relay ACKs.
- Development builds log only decrypted `AgentEvent.type` values, never event payloads
  or pairing secrets.
