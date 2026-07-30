# i18n copy conventions

Shared UI strings for SuperOne live here:

| File | Role |
|---|---|
| `en.ts` | English source of truth + `Messages` type |
| `zh.ts` | Chinese translations (same key tree as `en.ts`) |
| `index.ts` | Locale registry / system-locale resolve |

When adding or editing keys, keep `en.ts` and `zh.ts` structurally in sync (same nested keys). Types are inferred from `en.ts`.

## English casing

**Non-full-sentence English copy uses Title Case.** Full sentences use sentence case.

| Kind | Case | Examples |
|---|---|---|
| Labels, titles, tab names, section headers, button labels, menu items, short status chips | **Title Case** | `Detail Mode`, `Auto-Expand File Diffs`, `MCP Servers`, `Always Allow`, `Add App` |
| Descriptions, helper text, toasts, empty states, errors, multi-sentence body copy | **Sentence case** | `Show the full process for each completed turn…`, `Language updated` |

Rules of thumb:

- If the string is a **UI chrome label** (typically a `label` / `title` / short action), capitalize major words: `Agent Session Collaboration`, not `Agent session collaboration`.
- If the string is a **complete sentence** (ends with `.` / `…` / `?`, or reads as running prose), use sentence case: only the first word (and proper nouns) capitalized.
- Keep product / platform / acronym casing as-is: `macOS`, `MCP`, `API`, `CDP`, `SuperOne`, `Claude Code`, `Codex`.
- Short closed-class words mid-phrase may stay lowercase when that matches nearby copy (`Sync from Preset`, `Set as Default`); still Title-Case the content words.
- Chinese (`zh.ts`) has no Title Case requirement — write natural Chinese; do not force English casing rules onto it.

## Hard-coded English outside this folder

Agent-facing settings labels in `apps/desktop/src/main/mcp/settings-registry.ts` (and similar hard-coded English) should follow the same Title Case rule for non-sentence strings, so Settings UI and tool-exposed labels stay consistent.
