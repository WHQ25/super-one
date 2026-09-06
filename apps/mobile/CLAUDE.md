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
At widths below 768 px the shell is single-pane. At 768 px and above, chat,
terminal, settings, and files retain the project/session sidebar as a master pane.
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
bun --filter @superone/mobile test
```

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

Pairing: scan or paste a `superone://pair?…` QR (shows a 6-digit code to confirm on desktop) or paste JSON `{ "relayUrl", "secret" }`. Then projects → sessions → chat WebView. Device ID, pairings, and chat `viewState` persist in AES-256 MMKV; its encryption key lives in platform SecureStore.

The native shell also owns project Git/worktree status, remote file browsing,
provider/model selection, additional-directory RPCs, slash/mention overlays, and the
IME-safe composer. New Claude sessions may stay local, reuse an existing worktree, or
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
  the current session; on transition failure, dispose the incomplete runtime and return
  to the session list instead of leaving a stale chat detail active.
- Released buffers assign the runtime epoch. Live batches from older epochs are
  dropped, and overlapping restores may only commit their newest generation.
- Script-fatal errors and native iOS/Android WebView process exits reload and
  hydrate the chat document, bounded to two reloads per 10-second window.
- Only relay `event` envelopes advance or emit cumulative ACKs. LAN and terminal
  frames never produce relay ACKs.
- Development builds log only decrypted `AgentEvent.type` values, never event payloads
  or pairing secrets.
