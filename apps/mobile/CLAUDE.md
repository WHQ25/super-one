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
`Loading…` is only for switching to an existing session: the
previous transcript must not stay on screen while restore runs. Keep the
WebView mounted at opacity 0 under that cover *and* under the new-session
landing (`opaque={false}`, themed background, pre-paint script) so the first
send and a session switch both reveal an already-themed document. Unmounting
it remounts onto WKWebView's white default and flashes in dark mode. Leaving
the landing injects `reset` so a previous transcript cannot leak into the
next first send. The first send itself has no "Starting session…" / loading
copy: the composer empties, and the user bubble and title are painted, before
the draft flush and the `create_session` round trip (`ChatRuntime.stageTurn`),
and a `pendingTurn` line ("Creating session…" → "Sending…") sits under the
bubble inside the WebView until the assistant's `message_start` lands. Every
live send paints its own bubble the same way, under the `clientMessageId` the
host echoes back. Create failures still surface on the status line from the
host `create_session` error, and hand the cleared draft back to the composer.
The conversation tick rail also lives in the chat WebView (`ChatScrollIndicator`),
where it can measure and navigate the transcript without round-tripping through RN.
Its turn outline and tick curve are shared with desktop. Touch scrubbing previews
questions and replies, then jumps on release; compact ticks expand/collapse history.
Navigation mounts a bounded neighborhood around the target, and paging moves in
both directions while retaining a visible anchor and the 40-message DOM ceiling.
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
stagger. Reduced motion skips both.
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

## Shell conventions (WP-26 onward)

- **Tokens, not hex.** Colours, spacing and type come from `src/theme/` (generated from
  `@superone/ui/styles/theme.css` OKLch values plus the per-harness hue from
  `@superone/shared/harness-brand`). No raw hex in components; `styles.ts` is being
  retired. The app **ships dark** (`DEFAULT_THEME_MODE` in `mobile-preferences.ts`);
  `system` is still offered in app settings but is an opt-in, so nothing may assume the
  shell follows the OS appearance. The same token module feeds `setTheme` for the chat
  and terminal WebViews. Language defaults the same way: `systemLocale()` resolves the
  device locale through `resolveSystemLocale`, which answers `en` for anything outside
  `supportedLocales`.
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
bun run rebuild:mobile:ios               # prebuild + UTF-8 locale + expo run
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
jest-expo reuses the transform Metro already applies. What it costs to use:

- **`render` is async** in React Native Testing Library 14 — React 19 renders
  concurrently and nothing is committed when the call returns. `await` it, or
  every query fails with `render function has not been called`.
- Mount through `renderWithTheme` (`src/test-render.tsx`); `useMobileTheme`
  throws outside its provider.
- **A tree holding `useSyncExternalStore` swallows a bare `fireEvent`.** React 19
  defers the discrete update, and RNTL's implicit synchronous act around
  `fireEvent` never flushes the follow-up pass — the component simply stays in
  its old state and every query below the press fails as though the handler were
  never wired. Wrap it: `await act(async () => { fireEvent.press(el) })`. This
  reaches further than it looks, because `useIconMotion` (the Reduce Motion gate
  behind `SpinningIcon` and every pulsing label) is one of those stores.
  Wrapping also lifts the one-press rule — each press gets its own settled scope.
- **A nested `<Text>` is one text node to RNTL.** `#3 Ship it` rendered as a muted
  `<Text>#3 </Text>` inside the sentence composes to `"#3 Ship it"`, so
  `getByText('Ship it')` finds nothing. Query the composed string.
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
Both release profiles use remote build-number increments. Keep `credentials.json`
local and ignored. `assert-release-config.ts` (static, cheap) stays in the test command.

**`runtimeVersion` is `fingerprint`, not `appVersion`.** Under `appVersion` the runtime
version was pinned to the hand-written `version` field, which `autoIncrement` never
touches — so a build carrying new native modules kept the runtime version of the build
before it, and `eas update` would happily serve JS calling native methods that binary
does not have. `fingerprint` derives it from everything shaping the native runtime
instead. **No `.fingerprintignore` is needed**: `@expo/fingerprint` asks the VCS whether
each workflow marker is ignored (`ProjectWorkflow.resolveProjectWorkflowAsync`), and
because `ios/` and `android/` are gitignored here it resolves to `managed` and hashes
neither tree — locally-built and EAS-built binaries land on the same runtime version.
Verify with `createFingerprintAsync(process.cwd())` and check `sources` for any
`ios/` or `android/` entry; there should be none. Do not surface
`Updates.runtimeVersion` in the UI — it is an opaque hash now.

Android's `UpdatesConfiguration.getRuntimeVersion()` opens `assets/fingerprint`
with no try/catch (iOS returns nil). The Gradle task that writes that asset does
not take `app.json` as an input, so a policy switch to `fingerprint` plus an
incremental `rebuild:android` ships a binary whose Application.onCreate dies
with `FileNotFoundException: fingerprint`. Debug/dev-client never loads an EAS
Update — Metro serves JS — so `plugins/with-dev-client-updates.js` sets
`expo.modules.updates.ENABLED=false` on the debug manifest (`getIsEnabled` is
checked before the file open) and makes `create*UpdatesResources` out of date
when the asset is missing, so a local release build cannot repeat the crash.

## Two app identities

The locally built dev client and the EAS `internal` APK have to sit on one phone
at once, and they cannot share a package name: one is signed with
`~/.android/debug.keystore`, the other with the EAS project keystore, and Android
refuses to install either over the other (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`).
So the development variant takes a `.dev` suffix and its own name and scheme.

`app-variant.js` is the only copy of that rule. `app.json` stays the base config
*and the release identity*, so every static assertion in
`assert-release-config.ts` keeps reading the JSON directly; `app.config.js` is a
thin overlay Expo hands `app.json` to, and it only rewrites the identity when
`APP_VARIANT=development`. Everything else — updates URL, permissions, plugins,
the runtime-version policy — is deliberately shared, so the dev client exercises
the same native surface the release build ships.

- Both entry points set the variable, and both are covered rather than trusted:
  `eas.json`'s `development` profile through `env`, and local rebuilds through
  `baseRebuildEnv()` in `scripts/rebuild-dev-client.ts`. Dropping either one
  rebuilds the *release* application id and the install fails with a signature
  error that reads like a broken build. `assert-release-config.ts` asserts the
  split still produces different ids and different schemes.
- **The scheme splits too.** Two installed builds both answering `superone://`
  raise an Android disambiguation chooser on every deep link, and the Maestro
  suite cannot answer a chooser. The dev variant answers `superone-dev://`;
  `parsePreviewRoute` accepts both, and `.maestro/helpers/open-scenario.yaml`
  uses the dev one. Pairing is unaffected — that path is the in-app camera and
  the paste field, not the OS deep link.
- `scripts/maestro.ts` always targets the dev identity, because that suite needs
  Metro and the dev launcher. It imports `devApplicationId` rather than
  re-appending the suffix; a second copy drifts, and the symptom is a UI suite
  silently driving the wrong app.
- Importing `app-variant.js` from TypeScript needs the **explicit `.js`
  extension**. Without it bun resolves the sibling `app-variant.d.ts` first and
  erases the import as type-only, leaving the binding `undefined` at runtime
  while `tsc` stays green.
- Changing the application id is a native change: rebuild with `--clean`. The
  previously installed build keeps the old id, so it has to be uninstalled once
  — after that the two coexist permanently.

## Native-binary updates

EAS Update swaps the JS bundle; anything touching the native runtime needs a new
binary, and neither store gives us a push. So the app polls a manifest published
beside the desktop releases and acts on it (`src/updates/`).

```
mobile/android/v<version>-<buildCode>/superone-<buildCode>.apk   immutable
mobile/android/latest.json    the ONLY mutable object — rollback is one re-point
mobile/ios/latest.json        numbers + a TestFlight link; iOS installs nothing itself
```

Key layout, parsing and the verdict rule live in `@superone/shared/mobile-updates` —
one copy, because `scripts/publish-mobile-update.ts` writes exactly what the app reads.
`.github/workflows/release-mobile.yml` drives an EAS build per platform (`android_profile`
`internal` → APK, `ios_profile` `production` → TestFlight; `platform=both` is one dispatch),
downloads the artifact and runs that script; it needs an `EXPO_TOKEN` secret and defaults
`dry_run` to true.

JS-only changes go out through `.github/workflows/update-mobile.yml` instead — `eas
update`, one publish per platform because the channels differ (Android APK on
`internal`, iOS on `production`). Its one job beyond the publish is the **runtime
guard**: `eas update` computes the fingerprint from the checkout and publishes even when
no shipped build has that runtime, so the workflow first asks
`eas build:list --fingerprint-hash <hash> --channel <channel> --status finished` per
platform and fails on a miss — that change needs `release-mobile.yml` first. The
default `dry_run: true` runs the guard and `expo export` without publishing. Installed
apps pick an update up on the next launch and apply it on the launch after that; there
is no in-app `checkForUpdateAsync`.

- **The floor (`minSupportedBuildCode`) is the one move with no client-side way back.**
  It is inherited unless a number is typed into the workflow, `<= buildCode` is enforced
  on both sides, and the *hard gate is checked before the dismissal* so saying "Later"
  once can never buy past it. Lowering it is deliberately still allowed — that is how a
  floor set too high gets undone.
- **An unparseable or future-`schemaVersion` manifest must read as "no update"**, never
  as an error and never as a gate. Publishing schema 2 must not brick schema-1 builds.
  Same for any non-200: `dl.super-one.dev` answers 404 for a prefix nothing has been
  published to yet.
- **`UpdateGate` mounts in `App.tsx`**, not `mobile-overlays.tsx`. `App.tsx` already
  holds `mobileKv` (so the "never import the encrypted store from a hook" rule costs no
  prop drilling), `mobile-app.tsx` is long enough, and the overlays render inside the
  shell's `SafeAreaView` — which would leave pairing and onboarding reachable underneath
  a gate meant to stop everything. Children stay mounted under it; unmounting would cost
  a full relay reconnect for a state only an install can leave.
- **`UpdateDownloadError` lives in `update-download-state.ts`, not beside the ports.**
  `use-update-check` imports `UpdatePorts` type-only; a value import would drag
  `expo-updates`, `expo-intent-launcher` and `expo-application` into every jest suite
  that mounts the gate, and a suite that cannot load reports as *missing* tests.
- **The install intent needs both `data` and `type`.** expo-intent-launcher calls
  `setDataAndType` when it has both; the documented `ACTION_VIEW` + URI-only recipe
  leans on the file provider returning a MIME type for `.apk`, which many devices do
  not, leaving the intent unresolvable. `expo-file-system` already registers a provider
  covering `Paths.cache`, so no `FileProvider` of our own and no `<queries>` entry
  (package visibility gates resolve/query, not launching).
- **The install result is meaningless.** `startActivityForResult` returns as soon as the
  installer appears, and a successful self-update kills this process. Treat "launched"
  as terminal; never gate UI on the promise's value.
- **`REQUEST_INSTALL_PACKAGES` is not enough** — Android 8+ also needs a per-source
  "install unknown apps" toggle that no API can query, so the failure path offers
  `MANAGE_UNKNOWN_APP_SOURCES`. And `android.permissions` is additive across *every*
  Android profile, so it rides along in the `production` AAB: fine while production is
  TestFlight-only, a Play policy problem before the first store submission.
- **A locally built dev client cannot be updated over.** `expo run:android` signs with
  `~/.android/debug.keystore` while EAS signs with the project keystore, so the R2 APK
  fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`. `canSelfInstall` is false there
  (`Updates.isEnabled` is false in a dev client), and the checker stays silent on
  Android rather than nagging a developer to install something that cannot install.
- **Progress needs the legacy download API.** The new `File.downloadFileAsync`'s
  `DownloadOptions` is `{ headers, idempotent }` — no callback. `expo-file-system/legacy`
  `createDownloadResumable` reports bytes and takes `md5: true`, which hashes natively
  during the download instead of blocking the JS thread on `File.md5` over 100 MB.
  `totalBytesExpectedToWrite` is `-1` without `Content-Length`; fall back to the
  manifest's size rather than dropping to an indeterminate bar.

Preview every state at `superone://native-preview?page=Update` — a hard gate, a failed
checksum and an installer Android refused to open are not states you can reach by hand
without publishing a broken manifest.

**`t()` has no interpolation, and the `en` map is not identity.** Any string carrying a
number needs a static translatable sentence plus its own `<Text>` (`update-format.ts`
holds those fragments). And `en` applies the desktop's Title Case — `t('Try again')`
renders `Try Again`, so component tests must assert the *rendered* string.

**Release acceptance (WP-29).** Shipping requires one release-mode smoke on one
physical iPhone and one physical Android (pair by camera QR, stream + stop, Pinyin IME,
one sheet of each kind, 10 s airplane-mode flap, terminal `pwd`, one image attach, one
received file, iPad rotation with a sheet open) plus a single RSS sanity run of the
200-turn corpus under 250 MB — tighten the 24/40 DOM window if it is over. Record the
result as a short Markdown note under gitignored `docs/temp/`. Screenshots and videos
never enter git.

Needs a **dev client** (`bun run rebuild:mobile:ios` / `rebuild:mobile:android`),
not Expo Go. That script builds chat-view, runs `expo prebuild`, then `expo run`
with `LANG=en_US.UTF-8`. After changing native dependencies or config plugins,
pass `--clean` so the ignored `ios/` / `android/` trees are not reused with stale
Info.plist entries or pods. `--no-bundler` skips Metro when `dev:mobile` is
already running.

CocoaPods crashes with `Encoding::CompatibilityError` under this repo's default
shell locale. The rebuild script sets `LANG` / `LC_ALL` for you. If you invoke
`pod install` or `expo run:ios` by hand, prefix both with
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
dev-client rebuild, not just a Metro restart. The same applies to
`expo-media-library` (Save to Photos in the file preview): its config plugin writes
the add-only photo-library usage string, and `app.json` blocks the read-side Android
media permissions it would otherwise request.

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
Chat WebView native requests route HTTPS links, clipboard copies, and stripped remote
file-tool metadata through RN. Every preview — file chip or picture — lands in the one
fullscreen `ui/file-preview.tsx` modal (`FilePreviewModal`, its own `MenuHost`) whose only
chrome is Close, the title, and a **More** menu with *Save to Photos* / *Save to Files* and
*Share*. `file-preview-state.ts` owns the state machine (`loading | image | text | transfer |
error`) and decides which menu rows are enabled; `media-ports.ts` (`MediaPorts`) is the
only place that touches `expo-file-system` / `expo-sharing` / `expo-media-library`, so
tests, stories, and the gallery inject `preview/fake-media-ports.ts` instead. Saving to
Photos asks for add-only library permission and surfaces a denied state with an Open
Settings button; saving to Files goes through `Directory.pickDirectoryAsync`.
`previewFile` is the file chip's primary action (with the cited `line` when there is one)
and is owned by `navigation/use-file-preview.ts`: it asks `read_desktop_file` with
`preferInline` + `statOnly` in one trip, shows small text/Markdown inline on every
transport and small binaries (≤512 KiB) inline over the relay (policy in
`@superone/shared/file-preview`), and otherwise enters the `transfer` state — downloading
on its own over LAN, after a Download confirmation over the relay when R2 staging is
required. Downloaded images swap into the image body; other files stay on a "Downloaded"
card so the menu can save or share them. `openFile` is the secondary action: resolve the path against the active project and
open the containing directory. The native file browser uses `previewFile` for file rows;
directory rows navigate only. Remote path helpers must preserve POSIX roots, Windows drive
roots, and UNC share roots. Coalesce concurrent reads of the same project/session/path
until the first request settles. Unsupported actions must return an error response, never
`{ ok: true }`. The text body's code listing is highlighted by `ui/code-highlight.ts`
(lowlight `common` grammars, GitHub palettes per scheme); grammar is chosen from the file
name only, and unknown or >128 KiB files render plain.
`loadImage` is how tool screenshots and generated images get onto the transcript: the
WebView's `PortableHostImage` asks for a path, `inline-images.ts` answers with a data URI
over LAN and for relay files small enough to ride the RPC (≤512 KiB). Larger relay files
answer `confirmRequired` (+ size from a `statOnly` read) until the request carries
`confirmed: true` — the row shows a Load button in between.
Decoded images are cached per project/path (48 MiB LRU) so re-mounted rows never re-fetch.
Tapping any picture the transcript *displays* — a loaded host image, a user attachment, a
markdown image — sends `previewImage` with the `src` already painted, and the shell opens
the same modal in its `image` state: a pinch/double-tap viewer over the same bytes, whose
menu saves to Photos or shares from the cache. It never re-downloads (remote `http(s)`
sources have both rows disabled). `previewFile` remains the path for a chip *without* a
picture yet, and for non-image files.
A *generated* image's tap also carries `generation` (`ImageGenerationInfo`: prompt, params,
timing, reference paths, warnings — the same shape for Codex-native ImageGen and
`media_generate_image`), which puts an Info button beside the rotate pair. Its panel
(`ui/image-info-panel.tsx`) mirrors the desktop viewer's popover and reaches the host only
through `ImageGenerationPorts` (`image-generation-ports.ts`, built in `use-file-preview`):
`list_media_providers` turns provider/model ids into catalogue names (asked once per
pairing) and `loadImage` fetches reference thumbs unconfirmed — over the relay a large
reference falls back to its file name rather than staging a transfer. Stories and the
`File preview` gallery inject `preview/fake-generation-ports.ts`.
Images and PDFs use the `ImageAttachment` message path. Project file upload uses inline
RPC through 512 KiB, raw LAN PUT when connected locally, or chunk-encrypted relay R2
PUT plus completion through 100 MiB. Picker-reported sizes are optional metadata, not a
security boundary: check `File.size` before reading a whole PDF or project file, then
enforce the exact decoded byte count for base64 image/PDF payloads. Reject missing or
malformed base64 instead of treating it as an empty attachment.
There is no desktop→phone "send file" push: the agent links the file in Markdown and the
chip opens the preview above. Encrypted relay downloads are size-checked, capped at
100 MiB, and written under sanitized cache names (`safeCacheFileName`) before save/share.

The device list discovers desktops over mDNS through the local `modules/lan-browser`
Expo module (`_superone._tcp`, matched to a pairing by the `roomId` TXT key) and probes
reachability without a raw socket: the relay's `/status` room endpoint for the cloud
route, and an HTTP GET against the desktop LAN server — which answers `426 Upgrade
Required` — for the local one. The native module is optional at import; a dev client
built before it existed degrades to relay-only discovery. Both the probe and the
LAN socket are plain `http://` / `ws://`, so the release Android build needs
`android:usesCleartextTraffic="true"` on the *main* manifest — Expo only writes it into
the debug variants, which is why LAN worked in the dev client and silently fell back to
relay in the `internal` APK. `expo-build-properties` in `app.json` owns that flag; iOS
already allows it through ATS `NSAllowsLocalNetworking`.
**The desktop's LAN port is ephemeral** (`port: 0`), so the address stored at pairing
time is dead after the next desktop launch and mDNS is the only way to the live one —
and neither platform re-resolves a Bonjour name it has already reported: Android's
`DiscoveryListener` fires `onServiceFound` once and a one-shot `resolveService` answers
from the system's mDNS cache (which can still hold the old SRV), `NWBrowser` on iOS
never revisits a result whose TXT is unchanged. So the Android module keeps a
`ServiceInfoCallback` per service (API 34+, `onServiceUpdated` carries the new port),
a `reset` refresh (mount, foreground, pull-to-refresh) **restarts** the browse rather
than reusing it, and `LanServiceCache` keeps *every* address a room is advertised at —
after an unclean desktop restart the dead port sits beside the live one (often under
`name (2)`) until its record expires — and discovery probes all of them. Terminal
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
  the new epoch only after rehydrate releases the buffer. **An open relay socket says
  nothing about the desktop** — the relay accepts a lone mobile as a mailbox — so a
  reopened *relay* socket asks `/status` before restoring; a desktop that is away parks
  the connection as `offline` (socket held, loop stopped, device row shows discovery's
  verdict) and the desktop's next `handshake` runs the restore. `peer_disconnected` is
  the same `offline`. Without the probe every retry burned three 15 s request timeouts
  and painted `Reconnecting…` for a desktop that was simply off. LAN never probes: there
  the desktop *is* the socket peer. Re-send the current connection
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
