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
