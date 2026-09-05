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

Install the Expo development client (`bun --filter @superone/mobile ios`) if the
chosen simulator does not already have it. This is a local dev-client workflow;
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
client uses `10.0.2.2` to reach host Metro. Android execution needs separate validation.

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

The 13 flows cover at least one interaction for each of the nine explicit
permission kinds. This is scenario coverage, not exhaustive branch coverage:
video/collaboration/automation edit permutations, HTML preview interaction,
rotation, font scaling, and paired app navigation still need dedicated flows.
The shared `assert-action.yaml` helper checks that the sheet closed and that the
callback action and request ID match before each flow checks its payload.

Flows under `.maestro/flows/` use `.maestro/helpers/open-scenario.yaml` to open a
known fixture and handle iOS's first-link confirmation. Deep links have this shape:

```text
superone://native-preview?scenario=permission/edit-diff&theme=dark&harness=codex
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
These reports are ignored local artifacts; Android remains unvalidated.
