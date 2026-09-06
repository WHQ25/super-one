# Native UI tests with Maestro

These flows run the Expo **native preview**, using the production permission,
question, and plan components with offline fixtures. They do not call real tools,
create automations, spend money, or require a paired desktop.

## Local setup

From the repository root:

```bash
bun --filter @superone/mobile setup:ui
bun --filter @superone/mobile preview --port 8082
```

The setup command downloads Maestro CLI 2.10.0 from its official release, verifies
the pinned SHA-256, and extracts it into the ignored `apps/mobile/.tools/` directory.
No global shell configuration is changed. The runner uses `JAVA_HOME` when set,
then tries Android Studio's bundled Java or Homebrew OpenJDK on macOS. An existing
installation can be selected with `MAESTRO_BINARY`.

Install the Expo development client (`bun --filter @superone/mobile ios` or
`bun --filter @superone/mobile android`) if the chosen device does not already
have it. An internal/release APK is insufficient even if it registers the Expo
URL scheme: the offline preview requires a development build.
This is a local dev-client workflow;
Expo Go and production builds cannot open the offline preview. Metro must run with
the `preview` command, not the normal `dev` command.

## Share the device with SuperOne

1. Use SuperOne's built-in device tools to choose and boot a simulator.
2. Pass the same device ID to the test command. The `ios-sim:` prefix is accepted.
3. Let Maestro finish before sending further SuperOne taps, swipes, or rotations.
4. Read its report/screenshots and use SuperOne's device tools to investigate.

```bash
bun run test:mobile:ui --device ios-sim:<UDID> --theme all
```

When exactly one iOS simulator is booted, `--device` may be omitted. Otherwise the
runner requires an explicit selection. Maestro controls the same running Simulator,
with its own XCTest driver; it does not execute through SuperOne's tool API.

Useful focused runs:

```bash
bun run test:mobile:ui --flow config-edit --theme light
bun run test:mobile:ui --flow diff --theme dark --metro-port 8082
```

Use `--skip-launch` when the preview is already connected to Metro. Otherwise the
runner opens the development client against the chosen Metro port before testing.
The Android path accepts `--platform android --device emulator-5554`; its development
client uses `10.0.2.2` to reach host Metro. For example:

```bash
bun run test:mobile:ui --platform android --device emulator-5554 --theme all
```

## What is checked

| Flow | Assertion |
| --- | --- |
| permission | Feedback reaches the deny callback; reject stays visible while typing |
| config-edit | Selecting System submits `configJson.theme = system` |
| diff | Added/removed source is visible; expanding exposes the collapse control |
| question | Submit is disabled until an answer is chosen; the chosen answer is submitted |
| plan | Long-plan actions remain visible; approval sends the selected continuation mode |
| question-multiple | Submission requires every question; multi-select can be deselected; answers survive tab changes |
| question-custom | Whitespace cannot submit; custom text is submitted; reopening resets answers; dismiss has no answers |
| question-notes | Preview defaults are submittable; notes survive option changes and accompany the selected answer |
| plan-decisions | Rejection trims feedback; plain approval and Accept edits continuation send distinct callbacks |
| permission-elicitation | Required input gates submission; enum, boolean, and numeric answers retain their types |
| permission-grants | Computer, device, and WebMCP grants distinguish session approval from persistent approval |
| permission-structured | Video parameters, collaboration launch identities/modes, and automation config reach approval |
| permission-destructive | Session cleanup, provider deletion, and automation deletion support distinct deny/allow callbacks |
| composer-actions | Phone status controls remain above the input; send and streaming stop expose distinct states |

The 14 flows cover the phone composer actions plus at least one interaction for
each of the nine explicit permission kinds. This is scenario coverage, not exhaustive branch coverage:
video/collaboration/automation edit permutations, HTML preview interaction,
rotation, font scaling, and paired app navigation still need dedicated flows.
The shared `assert-action.yaml` helper checks that the sheet closed and that the
callback action and request ID match before each flow checks its payload.

Flows under `.maestro/flows/` use `.maestro/helpers/open-scenario.yaml` to wait
for the preview to load before opening a known fixture and handle iOS's first-link
confirmation. Waiting avoids losing the initial scene link during an Android
cold start. Deep links have this shape:

```text
superone://native-preview?scenario=permission/edit-diff&theme=dark&harness=codex
```

Application-page fixtures use a validated page name on the same entry point:

```text
superone://native-preview?page=New%20session&theme=dark&harness=claude
```

The preview validates the fixture, theme, and harness, clears previous action logs,
and remounts the component. `preview-last-action` exposes the actual callback JSON
so tests check behavior as well as visible labels. Production controls use stable
`prompt-title`, `prompt-approve`, `prompt-reject`, and `prompt-feedback` test IDs.

## Reports and visual review

Each run creates a timestamped folder under `.maestro/artifacts/`, split by theme.
It contains `report.xml` (JUnit), Maestro command logs, failure screenshots, and
named screenshots. The runner returns a nonzero exit code if a test fails.
Screenshots and downloaded binaries are ignored by Git.

Screenshots are **review artifacts**, not an approved visual regression baseline.
This suite does not claim pixel parity with Flutter or exercise the paired
desktop/relay/WebView integration. CI wiring and visual baseline approval are
separate from this local suite. Existing Vitest and chat-view Playwright tests
remain in place.

Keep the OS version, device model, font scale, keyboard setting, and orientation
consistent when comparing screenshots. For keyboard checks, detach the simulator's
hardware keyboard before running so the software keyboard is actually shown.

## Latest local validation

2026-09-05 · iPhone 17 Pro Max simulator · iOS 26.5:

- Light: 12/13 passed initially; elicitation tapped a label instead of its
  control. Stable `prompt-field-*` IDs fixed the selector ambiguity, and the
  focused rerun passed (1/1). The other 12 flows were not rerun in light.
- Dark: all 13 flows passed after the selector fix (about 6 minutes 18 seconds).
- Mobile TypeScript check and `git diff --check` passed.

Local JUnit evidence under `.maestro/artifacts/`:
`2026-09-05T06-48-45-776Z/light/report.xml`,
`2026-09-05T06-55-32-160Z/light/report.xml`, and
`2026-09-05T06-56-18-448Z/dark/report.xml`.
These reports are ignored local artifacts.

2026-09-05 · Medium Phone API 36.1 emulator · Android 16 · font scale 1.0:

- Light: 13/13 passed (6 minutes 57 seconds).
- Dark: 13/13 passed (6 minutes 55 seconds).
- A force-stop followed by a normal runner launch and `config-edit` passed
  (1/1), validating the preview-ready wait before opening the first scenario.
- Reviewed the light permission screenshot with Gboard open: both action
  buttons remain above the keyboard. The long-plan footer is also visible.
- Initial setup exposed an installed release APK and a scene link sent before
  preview initialization. Replacing it with the existing development APK and
  waiting for `native-preview-ready` resolved those failures without changing
  production UI behavior.

JUnit evidence: `2026-09-05T07-19-07-395Z/{light,dark}/report.xml` and
`2026-09-05T07-33-41-364Z/light/report.xml` under `.maestro/artifacts/`.
This validates the offline flows on an Android emulator; hardware Back,
rotation, large fonts, paired end-to-end interactions, and physical-device
release checks remain separate coverage gaps.


2026-09-05 · UI redesign regression · Android 16:

- Light 13/13 (7m 20s), dark 13/13 (7m 28s).
- Final primary/secondary approval button styling: focused dark permission flow
  1/1 (27s), including feedback with the software keyboard visible.
- Evidence: `2026-09-05T08-58-48-109Z/{light,dark}/report.xml` and
  `2026-09-05T09-14-59-025Z/dark/report.xml` under `.maestro/artifacts/`.
- iPad Pro 11-inch M5 / iOS 26.5: manually reviewed the landscape long-plan
  keyboard layout and offline master/detail and terminal pages. No full iPad
  Maestro run is claimed. The new **Preview app screens** catalog entry is for
  deterministic page review; the 13 flows above still cover prompt interactions.

2026-09-05 · Composer actions · Medium Phone API 36.1:

- Focused light flow passed 1/1 in 5 minutes 43 seconds. It verifies the phone
  status row, disabled send, draft-enabled send, local send transition and stop.
- Inspected `composer-send-light.png` and `composer-stop-light.png`; the software
  keyboard stays open and the plain arrow/outlined stop remain inside 44-point
  controls. Evidence: `2026-09-05T14-43-16-781Z/light/report.xml`.
- The helper enters through the in-app catalog so two installed development
  clients cannot trigger Android's ambiguous system app chooser. Scenario flows
  now close an open application-page preview before opening their fixture.
- Maestro spends most of this run waiting for native text-control hierarchy
  settlement. The flow is reliable but should not be treated as a fast smoke test.

See `../../docs/design/mobile-ui-redesign.md` for the page inventory,
implementation map, paired checks and remaining verification limits.
