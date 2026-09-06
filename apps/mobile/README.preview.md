# Native preview

Run from the repository root on the Expo migration branch:

```bash
bun run preview:mobile
```

Open the existing Expo development client on iOS or Android (press `i` or `a`
in Metro for a simulator/emulator). Expo Go is not supported. For a separate port:

```bash
bun --filter @superone/mobile preview --port 8082
```

The command builds the existing chat assets before starting Metro, then selects
the native preview root with `EXPO_PUBLIC_NATIVE_PREVIEW=1`. The normal app root
is not initialized in this mode: no pairing, storage, transport, or agent is needed.
The entry switch also requires `__DEV__`; production builds use the normal app.
Stop this Metro process and run `bun run dev:mobile` to return to the app.

Browse or search the catalog, select a theme and harness, then open a scenario.
Approve, deny, submit, and dismiss close the sheet and append the exact callback
arguments to Actions. Reset and reopen remounts the sheet with the original data.
Only local callbacks run, including for delete/spend/agent-launch fixtures.

Coverage: ordinary approval plus all nine explicit permission kinds, configuration
and automation deletion, long content, elicitation fields, collaboration modes,
single/multiple questions, multi-select, Markdown/HTML option previews, annotations,
and plan approval with both continuation modes.

These are the production `PermissionSheet`, `QuestionSheet`, and `PlanSheet`.
The sheets share a keyboard-aware, rotatable native shell with fixed actions.
Commands, file diffs, selection chips, and native Markdown use the production
components. The preview retains the current English copy and does not claim
localization parity.
Rotate the device or change OS text size to inspect native layout behavior.

Application-page fixtures also accept deterministic deep links such as
`superone://native-preview?page=Chat&theme=dark&harness=codex`. Only names in
the page selector are accepted.

Add typed fixture data under `src/preview/`. The permission examples use an
exhaustive record keyed by the shared protocol kind. No new native dependencies
or Storybook packages are required for this first catalog.

Permission fixtures exercise editable video parameters, typed configuration fields, collaboration run tuning, and automation settings. Approval logs include the final edited payload. The diff fixture includes source-aligned syntax tokens and line numbers; long diffs support bounded scrolling, expansion, and incremental line loading.

Automated native interaction flows are documented in [README.maestro.md](./README.maestro.md). Run `bun run test:ui --theme all` from this workspace while the preview is running.
# Page and component review

Choose **Preview app screens** in the native catalog to inspect production
page states without a paired desktop: new session, chat, devices, pairing code,
projects, sessions, settings, files, empty folder, folder error, and terminal.
The workspace drawer, worktree sheet, model/effort selectors and PDF attachment
card are available from those pages. The preview keeps the tablet sidebar and
keyboard frame, and can switch between light and dark themes.

These are deterministic visual fixtures. Sending a message or terminal input in
this preview only changes local sample content; it never calls a real agent or
shell. Actual relay, file download and session restoration need separate paired
checks. Existing permission/question/plan deep links return to the prompt catalog.

File icons are generated from the installed desktop `@react-symbols/icons` package.
After upgrading that package, run `bun run generate:icons` from `apps/mobile`;
`bun run check:icons` detects stale assets. The native renderer uses only generated
SVG data, not the package's DOM components. The upstream MIT license is retained
in `src/ui/SYMBOLS-LICENSE.txt`.

The **Icons** page shows seven harness brands across idle, running, background,
unread and automation states, large landing marks, and file/folder identities.
Harness scene geometry and motion profiles are generated from desktop components
and `theme.css`; `generate:icons` and `check:icons` cover both icon families.
Native animations use the native driver, pause while the app is backgrounded,
and respect the OS Reduce Motion setting. Use that setting for static screenshot
comparison; it retains state artwork and freezes motion at its initial frame.

Permission selector names, descriptions, glyph names and tones are generated from
desktop selector definitions and English copy. The same icon generation/check
commands include this data. Model fixtures include a model with effort choices
and one without; changing models uses production effort-resolution helpers.

Native provider mention attachments use transparent 128px PNGs generated from
the shared desktop `AgentProfileIcon` DOM and compiled chat-view CSS. The icon
generation/check commands build chat-view first and require Playwright Chromium
(`bunx playwright install chromium` once). Browser rendering runs only during
asset generation, never in the native composer. The Chip editor's **Load provider
brands** fixture covers seven brands plus the neutral unknown-provider fallback.
The **Load app identities** fixture covers a host-supplied app logo, the exact
desktop default miniapp artwork, and the desktop-app pointer fallback.
After loading it, switch to **Chat** to verify the same identities in the
portable sent-message transcript.

For live text-size checks, change the simulator's system content-size category
while a page stays open, then restore it. Native labels use `src/ui/text.tsx` to
invalidate Fabric's cached paragraph measurements; import that wrapper instead
of RN Text in app components. The native composer handles its own font metrics
and preserves draft identities while resizing.

## LAN browser (live network)

**LAN browser** is the one catalog page that is not an offline fixture: it starts the
real Bonjour browse and lists every SuperOne desktop advertising `_superone._tcp` on
the current network, with the address resolved from the record and the room id taken
from its TXT. **Probe reachability** then runs the same HTTP check the device list
uses — the desktop's LAN server answers any unknown GET with `426 Upgrade Required`,
so a response of any kind proves it is listening.

Use it to tell three failures apart that otherwise look identical from the device list:
a development client without the native module linked (the heading reads *Native
browser missing*), a desktop that is not advertising, and one that is advertising at
an address the phone cannot reach.

It needs a development client built after `modules/lan-browser` was added — run
`bunx expo prebuild -p ios` then `bunx expo run:ios`. If `pod install` fails with
`Unicode Normalization not appropriate for ASCII-8BIT`, re-run it as
`LANG=en_US.UTF-8 pod install` from `ios/`; CocoaPods needs a UTF-8 locale and the
prebuild step does not set one.

### Verified 2026-09-06

Both native implementations were checked against a desktop advertising on the same
Wi-Fi (`dns-sd -B _superone._tcp` was used first to establish the ground truth:
`roomId=23e1bcf6…`, `hostName=…(Alpha)`, port 51549, host `25s-MacBook-Pro.local.`).

| | iPhone 17 Pro Max simulator, iOS 26.0 | Xiaomi 15 Pro, Android 16 |
| --- | --- | --- |
| Module linked | yes | yes |
| Desktops found | 1 | 1 |
| TXT roomId / hostName | matches `dns-sd` | matches `dns-sd` |
| Address resolved | 192.168.124.4:51549 | 192.168.124.4:51549 |
| Reachability probe | reachable · 19 ms | reachable · 41 ms |

Both platforms resolve the advertised `.local` name to an IPv4 address rather than
passing the hostname through — iOS through `NWConnection`'s resolved remote endpoint,
Android through `NsdServiceInfo.host`. That matters because React Native cannot
resolve a `.local` name itself.

Extra services can be faked onto the network with `dns-sd`, which is how the
remaining paths were covered without a second desktop:

```bash
dns-sd -R superone-fakeaaa1 _superone._tcp local 9101 \
  roomId=aaaaaaaa1111111122222222aaaaaaaa hostName=Fake\ Desk\ One variant=alpha
```

- **Android's serial resolve queue** — two fakes plus the real desktop resolved all
  three. The queue exists because `NsdManager.resolveService` handles one request at
  a time and fails the rest with `FAILURE_ALREADY_ACTIVE`; three concurrent
  `onServiceFound` callbacks produced three rows, none dropped.
- **Advertised but dead** — the fakes publish a port nothing listens on, and probing
  reported `no answer · 17ms` against the real desktop's `reachable · 29ms`. Worth
  keeping in mind: an mDNS record can outlive the process that published it, so
  discovery alone is never proof of reachability.
- **`onServiceLost`** — publishing a service while the page stayed open took it from
  1 to 2 desktops, and killing the `dns-sd` process took it back to 1 with the row
  removed, all without remounting.

The room id itself was checked against the desktop's own derivation: reading the
`masterSecret` out of `remote-config.json` and running it through the mobile
`roomIdForSecret` reproduced the advertised `23e1bcf6…` exactly. That match is
frozen as a regression test in `src/lan-discovery.integration.test.ts`, which runs
the real derivation over a desktop-shaped record rather than a stubbed room id.

Toolchain notes for repeating this: `expo prebuild` does not run `pod install`, and
CocoaPods needs `LANG=en_US.UTF-8`. `expo run:android` needs `JAVA_HOME` (Android
Studio's bundled JBR works) and rejects a wireless-adb serial passed to `--device`,
so omit the flag when one device is attached.
