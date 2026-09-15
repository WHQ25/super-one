# Shared UI translations

`en.ts` owns English text and the `Messages` type; `zh.ts` mirrors its key tree.
`index.ts` owns locale registration/resolution. Keep both languages structurally
in sync when adding or removing keys.

- UI labels, titles, tabs, buttons, menu items, and short status chips use English
  Title Case (`Detail Mode`, `Sync from Preset`).
- Descriptions, helper text, errors, toasts, and running-action copy use sentence
  case (`Generating image…`). Preserve the tool-row streaming/action/done forms
  when editing those labels; punctuation alone does not determine casing.
- Preserve product/acronym spelling: `macOS`, `SuperOne`, `MCP`, `API`, `Codex`.
- Write natural Chinese; Title Case does not apply to Chinese text.

These casing rules also apply to UI field labels exposed by the settings registry.
They do not turn full agent-facing tool descriptions into Title Case.
Check the relevant typed key usage and displayed copy; runtime translation changes
follow the root affected-check policy.
