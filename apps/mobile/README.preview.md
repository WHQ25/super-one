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

Add typed fixture data under `src/preview/`. The permission examples use an
exhaustive record keyed by the shared protocol kind. No new native dependencies
or Storybook packages are required for this first catalog.

Permission fixtures exercise editable video parameters, typed configuration fields, collaboration run tuning, and automation settings. Approval logs include the final edited payload. The diff fixture includes source-aligned syntax tokens and line numbers; long diffs support bounded scrolling, expansion, and incremental line loading.

Automated native interaction flows are documented in [README.maestro.md](./README.maestro.md). Run `bun run test:ui --theme all` from this workspace while the preview is running.
