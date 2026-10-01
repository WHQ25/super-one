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

## Implementation progress

### Data cap decision

Selected option 2 (implemented): transient View-initiated tool/read output
has an 8 MiB
cap across provider, executor, host and host-to-View transport. View-to-host
requests, persisted tool input/result and model context remain 1 MiB; HTML
remains 2 MiB. Claude resource reads must use the same 2+1 MiB envelope as
Codex. Full content and structuredContent are retained. View-only calls do
not persist their results; remote payload framing separately caps the total
uncompressed payload at 32 MiB and chunks encrypted responses.

### Metadata slice

Shared presentation carries tool title and icons plus server title/icons
through persisted attachments, including history and phone projection.
Resource metadata keeps OpenAI sibling keys alongside stable UI fields.
Views always initialize inline, and resource mode declarations constrain
subsequent View requests. Headers and fullscreen tabs use safe image URIs
with tool-icon, server-icon and generic fallback order. Desktop/phone
stories use production presentation metadata. Live verification remains in
S1 after the cap and remaining extension slices.

Verification for this slice: desktop/shared host, executor, attachment, state
projection and View component selections: 78 tests passed; Claude MCP Apps
and event-mapper selections: 21 passed; Codex catalog selection: 5 passed.
`bun run typecheck:node` and `bun run typecheck:web` passed. Package Vitest
needed sandbox escalation after localhost DNS failed during initialization.
No dev instance or live screenshot was produced for this slice.

Metadata review follow-up: persisted presentation now stores only the resolved
safe icon per theme (deduplicating neutral icons). Icons over 32 KiB are
dropped, titles are bounded, and the independent 70 KiB presentation budget
cannot turn an otherwise valid tool result into an error.

### Transient output cap slice

View-only tool/read output is bounded at 8 MiB in native providers, the
shared provider RPC dispatch, executor and shared host. The postMessage
transport tracks View tool/read request ids so only the corresponding
host-to-View reply uses the larger cap (plus 1 KiB for its JSON-RPC envelope).
View requests and persisted tool-result notifications remain 1 MiB.
Claude initial HTML reads now use the same 2+1 MiB envelope as Codex; a
host-authored transient flag distinguishes View reads from snapshot reads.

A phone-path integration test sends a random 2 MiB result via
`mcp_app_request`, the real host encryption/framing and the existing
RpcInbox chunk reassembly/phone decryption. It also confirms that an
oversized result produces structured `invalid` without waiting for a
timeout, and an oversized inbound request never reaches the provider.
This is transport integration coverage, not a physical phone/relay smoke.

Cap verification: desktop/provider/executor/host/transport/phone integration
selection 61 passed; Codex catalog/cap selection 6 passed; node/web
typechecks passed. Boundary tests keep inbound 1 MiB, allow transient
output below 8 MiB, reject output above it, and preserve Claude full content
plus structuredContent. No live device capture in this slice.
