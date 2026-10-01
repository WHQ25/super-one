# MCP Apps: OpenAI extension compatibility — phase 1

Proposal: [mcp-apps-openai-extensions.md](../proposals/mcp-apps-openai-extensions.md).
Phase 1 is the View level: metadata, `openai/message`, model-context
attachments. Decisions already made: agent-invoked Views always start inline;
model context is state that stays attached until replaced or removed;
`openai/interactionCursor` is not advertised.

## Baseline (S0, 2026-10-01)

Fixture: OpenAI's Bits & Bolts plugin (`openai/mcp-extensions` @ `900032d`,
`plugins/bits-and-bolts`), built with `node scripts/build.mjs --plugin-dir
<dir>`; run `node <dir>/dist/server.js` with `CAD_LIBRARY_HOME` pointing at a
writable directory (the default is `~/.codex/bits-and-bolts`). Live run in the
isolated `SUPERONE_INSTANCE=mcp-apps-acceptance` profile, project with
`.mcp.json` (Claude) and `.codex/config.toml` (Codex reads project config).

### What the server uses

- `serverInfo` has `title` and `icons` (SVG data URI). Claude's
  `mcpServerStatus()` returns them at run time, although the SDK type omits
  them. No tool carries `icons`; most tools carry `title`.
- `capabilities.extensions["openai/settings"]` (and the legacy `experimental`
  copy).
- Tool `_meta["openai/ui"].entrypoints`: `global` (with an undocumented
  `quickAction: { title, icons }`), `thread`, `file` (`.stl .3mf .step .stp`)
  and an undocumented `settings` type. Undocumented `_meta["openai/iconStyle"]`.
  A `search_mentions` tool with `openai/extensions["mentions/search"]`.
  `cad.pickFile`, `cad.pickReferences`, `cad.reviewForm` use OpenAI forms.
- The UI resource is 821 KB with `openai/ui` `preferredDisplayMode: inline`,
  `availableDisplayModes: [inline, fullscreen]`.
- The View speaks raw JSON-RPC (OpenAI's minimal transport, not the ext-apps
  `App`): `ui/request-display-mode`, `ui/open-link`, `ui/message`,
  `ui/update-model-context`, `ui/download-file`, `resources/read|subscribe|
  unsubscribe`, `openai/files/open`, `openai/resources/write`; it answers
  host `tools/list` / `tools/call` (View-provided tools, a draft feature). It
  checks `experimental` keys `openai/files`, `openai/resource`,
  `openai/modelContext`, `openai/message`, `openai/skillsDeepLinks`
  (undocumented) and `hostContext` keys `openai/deepLink`,
  `openai/interactionCursor`, `openai/modelContext`.

### Live results

| Area | Claude | Codex |
|---|---|---|
| View appears for `cad.library` | Fixed: tool names with `.` never resolved (Claude normalizes the tool part of `mcp__<server>__<tool>` too) | Fixed: Codex sends `structuredContent: null`, which the View schema rejects |
| Data cap | **Fails**: View tool results reach ~990 KiB, and `mcp_call` also returns the JSON as text content, exceeding `MCP_APP_DATA_MAX_BYTES` (1 MiB). Works with the cap raised locally | Same results; not over the cap once `null` is dropped |
| Latency | View ~4 s; `cad.readPart` ~4 s | View 10–20 s; `cad.readPart` ~10 s. Not investigated |
| Inline, 3D viewer, View tool calls | Works | Works |
| Expand → fullscreen tab | Works; tab icon blank | Not tested |
| App's own settings page | Works (inside the View) | Not tested |
| `ui/message` with image | Works; confirmation card and user bubble show the raw JSON text; titled items not rendered | Not tested |
| `ui/update-model-context` | Accepted silently; no visible attachment; App shows "Context state unavailable" | Same |
| `ui/download-file` | Not advertised; "Download STL" does nothing | Same |
| Row header | `server · tool` raw name; generic icon although server icons exist | Same |

Claude itself reports the 1 MB `cad.library` result as too large and saves it
to a file, so the model does not see the catalog; that is Claude CLI behavior.

## Steps

1. **Data cap** (blocker): decide the limits for View tool results and
   snapshots against persistence, relay and phone costs; Claude's text
   duplicate of `structuredContent` counts twice today.
2. **Metadata**: tool `title`, server `icons` (both harnesses), resource
   `openai/ui` display-mode metadata for the placeholder and allowed modes;
   fullscreen tab icon.
3. **`openai/message`**: advertise `experimental["openai/message"]`;
   `target: "new"`; titled items as chips in the confirmation card and the
   user bubble; image and resource content.
4. **Model context**: advertise `experimental["openai/modelContext"]` and the
   richer `updateModelContext` content kinds; `updateId` in the result `_meta`;
   `hostContext["openai/modelContext"]` on init and after removal; removable
   attachments on desktop and phone; hidden `audience: ["assistant"]` blocks;
   images through the real image input.
5. Re-run the baseline on both harnesses and record the result here.
