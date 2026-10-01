# MCP Apps: OpenAI extension compatibility — phase 1

Proposal: [mcp-apps-openai-extensions.md](../proposals/mcp-apps-openai-extensions.md).
Phase 1 is the View level: metadata, `openai/message`, model-context
attachments. Decisions already made: agent-invoked Views always start inline;
model context is state that stays attached until replaced or removed;
blocks are independently removable (last visible removal clears the View,
including assistant-only hidden blocks). Desktop `target: new` confirms,
creates a conversation in the same project/harness, switches, then sends;
phone supports `active` only. `openai/interactionCursor` is not advertised.

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
5. **UI resource caching** (user approved): content-addressed HTML storage and
   hash references on new attachments, with legacy inline snapshots readable.
   Bounded LRU read cache keys include the owning session/provider origin,
   binding identity and resource URI. New calls paint cached HTML immediately,
   then revalidate in the background; a changed hash only affects later calls.
   Phone fetches/caches each hash once. Optional cheap catalog prefetch.
   Verify dedupe, legacy reads, no live swap, origin isolation and phone fetch-once;
   measure Codex first-paint latency before/after.
6. Re-run the baseline on both harnesses and record the result here.

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

### OpenAI message slice

The shared host advertises `experimental["openai/message"]` and text, image,
resourceLink and embedded-resource modalities. Pinned ext-apps 1.7.5 omits
request metadata in its message schema; a shared schema preserves `_meta`
before interpreting the OpenAI target. `send: false` and unsupported targets
are explicitly refused. Phone supports `active` only in this slice;
`target: new` returns a structured `denied` result.

Messages use the normal session admission path. Desktop `new` uses a
confirmed, bounded, single-use handoff: create from authoritative source
project/provider/harness settings, switch in the renderer, then send. The
handoff survives the old View unmount but cannot be replayed or transferred
to another View/device. Model input receives plain content without block
metadata and real image/PDF attachments. Titled text and resources become
labeled chips; untitled text remains ordinary bubble text. Other binary
resources retain public URI/MIME/blob fields as text.

A generic `ContextAttachments` component supports previews and removal,
shared by confirmation cards and message bubbles and ready for the composer
model-context slice. Node transcript, live events and catalogs preserve the
rich display separately from model text and actual attachment input; a
host-originated message is echoed even while an optimistic send drain is
already active. Stories cover rich desktop/phone confirmations and generic
attachment loading/empty/error/long/narrow states. Live screenshots and real
Bits & Bolts/model validation remain in S1 after model context and caching.

Message verification: desktop/shared host, executor, document lease, rich
content, attachment chips, node event mapping and remote hydrate selections
passed (111 tests after the final handoff refusal coverage). Node restart/live
message and existing MCP state integration selections passed (4 tests, both
Claude and Codex simulated runners). Desktop node/web, CLI and standalone
chat-view typechecks passed. A parallel typecheck/test run caused existing
1-second lazy UI test windows to expire; the complete selection passed with
`--maxWorkers=2` after typechecks finished. No product timeout changed.
Package Vitest again needed sandbox escalation for localhost resolution.
No dev instance was started for this slice; no live screenshots yet.

### Open gap: phone new-conversation messages

Phone `target: new` remains deferred until after S1, unless model context
needs the same RN continuation work. Session creation is already shared
through the host and EnvironmentHost; node ownership is not the blocker.
The missing piece is the RN continuation across navigation: capture the
original session route, await the destination switch, then consume the
same-device handoff token through the original route. An ordinary request
after navigation uses the new session route, which cannot resolve the old
View, and navigation unmounts its WebView. The shared handoff can be reused
once the native shell owns that continuation. The current refusal is
explicit; it never silently drops the requested message. Implementation
order remains model context, UI resource caching, S1, then this phone gap.
