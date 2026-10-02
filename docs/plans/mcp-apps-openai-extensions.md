# MCP Apps: OpenAI extension compatibility

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

## Live baseline (S1, 2026-10-01)

Same built Bits & Bolts fixture, test project and isolated acceptance profile as
S0. Native Claude and Codex only; the compatibility path is off. Main changes
were tested after full process restarts on fresh CDP ports (9373–9378), and all
instances started for S1 were stopped. Captures, protocol/latency records and
helpers are together in `/private/tmp/claude-501/s1/`.

| Area | Claude | Codex |
|---|---|---|
| View appears for `cad.library` | Works; library populates through the View's own `cad.listParts` | Works; library populates through the View's own `cad.listParts` |
| Data cap | Works without raising persisted limits: initial App result is omitted at 1,100,750 bytes; pinned HTML remains available; full View-only reads succeed | Works: initial App result is omitted at 1,050,824 bytes; pinned HTML remains available; full View-only reads succeed |
| Latency | Host placeholder → initialized: first sample 829 ms, repeat 151 ms; `cad.readPart` request → reply: first 1,215 ms, repeat 948 ms | Host placeholder → initialized: first sample 928 ms, repeat 170 ms; `cad.readPart` request → reply: first 4,299 ms, repeat 43 ms |
| Inline, 3D viewer, View tool calls | Works; Bug keycap renders 12,544 triangles, no host tool confirmation | Same |
| Expand → fullscreen tab | Works; maximized activity tab, loaded server SVG icon, no host mode/restore control | Same |
| App's own settings page | Viewer settings opens inside the View | Same |
| Native `ui/message` with image | Confirmation on every call; PNG is real model input and the model describes the keycap correctly. Fixture's untitled JSON still appears in the card | Same; untitled JSON in the bubble uses the existing collapsed code block |
| Titled message content | Same-iframe protocol probe: titled text, image, resource link and embedded text resource appear as labeled items in confirmation and bubble; no raw JSON for those titled items, source `Bits & Bolts` | Same |
| `ui/update-model-context` | Visible text/image chips; independent removal, final removal → `No view attached`; restored initialization gets saved context, no `Context state unavailable` | Same; full restart preserves the image block and chips, then removal clears state and notifies the View |
| `ui/download-file` | Still not advertised: explicit `This host does not support file downloads.` | Same |
| Row header | `Bits & Bolts · cad.library`, safe loaded server SVG. Claude SDK drops tool titles and supplies no `annotations.title`, so name fallback is used | `Bits & Bolts` once: server and tool titles are equal; safe loaded server SVG |
| Desktop `target: new` | Confirm → one new host session → adopt/switch → send. Sonnet 5.5 / High / Auto / On and actual image input verified in main, renderer and visible pane | Same; GPT6.1 Sol / Low / Approve for Me / On retained; real image answer and titled chips verified |
| History restore → Activate | Full restart restores omitted-result notice and context. Activate remounts the same document URL, initializes again, and View calls `cad.listParts`; host never replays `cad.library` | Same; saved HTML hash and text/image context survive the restart |
| Forms | `pickFile`, `reviewForm`, implicit `pickReferences` each return the expected MCP tool error: client does not support OpenAI form requests; no fallback/crash | New threads: thumbnail `pickFile` → selected part/View; review required/pattern/maximum errors then valid accept; implicit selection → unsupported/Dismiss → server `cancel` |

Timing boundary: “first” means the first measured View after process restart,
with the CAS already on disk; it is not an empty-cache benchmark. Placeholder →
initialized excludes model reasoning, native tool execution and MCP startup.
Repeat uses the same process, session and server binding. Full send → initialized
samples were Claude 8,136 / 1,928 ms and Codex 17,763 / 6,721 ms; Codex's first
sample used its native default model, while later calls explicitly selected
GPT6.1 Sol / Low. These end-to-end samples are not a controlled model-latency
comparison. The initial omitted result is only the host's durable App snapshot;
this run does not establish model-side truncation or alter the native tool result.

The fixture does not emit `openai/title` itself. Titled-content and `target: new`
coverage therefore uses captured fixture payloads with those protocol fields,
sent from the actual trusted View iframe through the production host, permission,
normal session admission and real model/image paths. Native Ask is separately
verified. Binding identity remains the server id; display source titles use the
shared presentation resolver.

Representative evidence (all under the capture directory):

- `claude-part-ready-probe.png`, `codex-first-part.png`: actual 3D preview.
- `claude-expand.png`, `codex-expand.png`: fullscreen tab with loaded icon.
- `claude-settings.png`, `codex-settings.png`: the View's settings page.
- `claude-attach.png`, `codex-attach.png`, `codex-restored-remove.png`: visible
  context blocks and removal notification.
- `claude-verified-titled-new-{confirm,bubble}.png` and
  `codex-verified-titled-{active,new}-{confirm,bubble}.png`: confirmed rich
  content, new-session UI and actual model answers.
- `claude-verified-handoff-trace.json`, `claude-verified-new-settings.json`,
  `codex-verified-new-settings.json`:
  authoritative source/adoption/settings and visible-pane identity.
- `claude-traced-{restored,activated}.png`, `codex-{restored,activated}.png`,
  corresponding `*-restore.json`, and `codex-restored-context.json`: full
  restart, pinned-document remount, own View tool call and saved image context.
- `codex-pickFile-thumbnail.png`, `codex-reviewForm-{required,invalid,valid}.png`,
  `codex-implicit-unsupported.png`, `codex-{review,implicit}-server-result.json`:
  actual form UI and server accept/cancel results.
- `claude-{cold,warm}-library.json`, `codex-{first,warm}-library-log.json`,
  `claude-part.json`, `codex-{first,warm-read}-part.json`: bounded timing records.

Remaining work identified in S1 (recorded, not implemented in this pass):

- Collapse untitled long text/JSON in the confirmation and bubble with an
  expandable full-text preview, shared by desktop and phone.
- Add standard MCP Apps `ui/download-file`, native desktop save flow with
  payload limits, and the existing phone download/share path.
- Tell the model when an interactive View actually renders through a
  harness-provided tool hook. Claude CLI still spills its large tool result
  and can say no View rendered while the host View works.
- Phone `target: new` remains explicitly refused pending the shell-owned
  continuation described below. Mosaic target navigation, physical-phone
  smoke and a live remote-node smoke are not covered by this single-pane
  desktop baseline; shared/portable and authenticated node integration
  coverage remains the evidence for those code paths.
- An unchosen Codex UI default label can differ from the native effective
  default (initial sample: displayed GPT6.1 Sol, native GPT6 Luna). Explicit
  source selection was synchronized before inherited-model acceptance.

S1 fixes and checks: `ebfa8950a` inherits/adopts the host-created session,
`ddc7e8629` resolves attachment source titles, and `7fce42ad6` protects native
host receipt without an init event. Targeted desktop selections passed 113,
68 and 75 tests respectively (overlapping selections); portable View/lifecycle
passed 5 tests. Desktop `typecheck:node` / `typecheck:web`, portable standalone
TypeScript and the portable production build passed. The build retains its
existing chunk-size warning. Vitest needed unsandboxed localhost resolution;
that initialization error is separate from test results. No debug instrumentation
was added to repository code; temporary window wrappers were cleared by restart.

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
6. **Completed:** re-run the native desktop baseline on both harnesses; S1
   results, timing boundaries, captures and remaining gaps are recorded above.

## Implementation progress

### Data cap decision

Selected option 2 (implemented): transient View-initiated tool/read output
has one cap across provider, executor, host and host-to-View transport:
32 MiB minus 64 KiB, so a reply plus its RPC envelope fits one remote payload
(raised from 8 MiB on 2026-10-02 for App assets such as a 7.6 MB CAD wasm). View-to-host
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

View-only tool/read output is bounded by the transient cap in native providers, the
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
resources contribute public URI/MIME/byte-size fields as text, without raw base64.

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

### Model context slice

The shared host advertises `experimental["openai/modelContext"]` and all requested
content kinds plus structured content. Durable per-View revisions are returned
in `_meta["openai/modelContext"].updateId` and exposed in host context on initialize,
remount and changes. Empty updates and user removal persist explicit `null`, so
late provider attachment deltas cannot resurrect cleared state. Per-View context
writes are serialized with bounded queues; stale chip revisions are refused.
Trusted composer removal does not require a provider connection or activation.

Context remains attached on every desktop/node model send until replaced or
removed. Images use the existing real image input; block `_meta` is excluded from
model input. Opaque binary resource blocks now contribute only URI, MIME type and
byte size, retaining the labeled attachment without flooding the prompt with
base64. SQLite restart tests cover two successive sends with actual images,
metadata exclusion, removal and a second restart with no remaining context.

Desktop and native phone composers use the generic attachment contract. Each
visible block has its own chip and bounded preview. Assistant-only blocks and
structured content stay in the background while visible blocks exist; removing
the last visible chip clears them too. Background-only state produces one
`<App title> context` chip per View, with an App icon and a bounded payload preview.
The phone restores a thin authoritative context snapshot independently of its
history pages, and reconciles cached and newly loaded pages against it. Removal
keeps state visible until the durable host event arrives and exposes failures.

Native SVG icons use the installed `react-native-svg` renderer (no per-icon
WebView), with a 32 KiB URI limit, vector-only nodes and stripped external
references. Tests use the actual Bits & Bolts SVG and cover base64, malformed,
oversized and external-reference cases. Stories cover restored View state and
generic/native composer loading, empty, error, removing, long and narrow states.

Verification: the desktop/shared/executor/composer/remote selection passed
169 tests across 13 files; an additional passive-history snapshot test passed in
the 3-test remote restore file (170 tests total for the selection). Phone state,
history and runtime selections passed 36 tests; native composer/attachment
components passed 30 tests. CLI SQLite/image/clear/restart integration passed
4 tests with both simulated harness runners. Desktop `typecheck:node` and
`typecheck:web`, mobile `tsc --noEmit -p tsconfig.json`, CLI typecheck and standalone
chat-view typecheck passed. Vitest in mobile/CLI needed sandbox escalation after
localhost DNS failed before initialization. These are component and integration
checks, not a real harness, WebView or device smoke.
No live dev instance or screenshot has been produced; Bits & Bolts/model and
physical-phone validation remain in S1 after the approved UI resource cache.
Phone `target: new` remains deferred; model context does not require its navigation
continuation.

### Codex per-request latency (2026-10-01)

Measured the same Bits & Bolts server and copied project in an isolated
`mcp-apps-latency` dev profile, pinned Codex 0.159.0. Temporary timestamp
logs covered renderer registration/requests, IPC, executor, provider gate,
catalog and app-server request/response; View JSON-RPC messages established
initialization and the usable library/part. Logs and probe scripts were
removed after measurement. No HTML cache or Codex configuration change.

| Hop | Initial View before | Initial View after | Idle `cad.readPart` before | Idle `cad.readPart` after |
|---|---:|---:|---:|---:|
| Renderer to IPC | 1–4 ms | 0–4 ms | about 1 ms | 0–1 ms |
| Provider acquire / ready | 0–1 ms | 0–1 ms | 0–1 ms | 0–1 ms |
| Blocking inventory discovery | full: 7,621 ms | none; light runs in background | full: 9,153 ms | none; cached tools |
| Resource / tool RPC | HTML: 16 / 56 ms | HTML: 18 / 50 ms | 12 ms | 13 ms |
| Renderer registration round trip | 7,703 / 7,736 ms | 61 / 93 ms | — | — |
| Host tool-request round trip (IPC to IPC) | — | — | 9,179 ms | 17 ms (18 ms at renderer) |
| Host loading to View initialized | 8,352 ms | 724 ms | — | — |

The two HTML readings/registrations come from development StrictMode and
share one single-flight catalog; production code was not changed to hide
that development behavior. Initialization means the View rendered its
shell, not that all CAD data or 3D work was complete. On the final cold run,
the View's automatic `cad.listParts` shared the pending background catalog
and took 4,152 ms; the library entries appeared 5,266 ms after registration.
Subsequent part requests completed in 18 ms at the renderer and rendered
the 12,544-triangle Bug keycap. Model-turn latency is outside these timings.

Root cause and controls:

- Direct MCP SDK over stdio: connect 86–158 ms, tools/list 20–34 ms,
  resources/list 2–6 ms, 831,524-byte UI read 5–9 ms,
  737,652-byte `cad.readPart` result 4–11 ms. Large result copies and
  thread routing contributed milliseconds, not the multi-second delay.
- Codex full status discovery creates a fresh connection set and lists
  resources/templates for every server. An isolated credential copy with
  only Bits configured still automatically included `codex_apps`:
  full 4,824–6,694 ms, light 102–151 ms after warming. A light-first run
  measured 3,952 ms cold, 93 ms warm, then full 4,258–4,880 ms.
- A measurement-only control disabled hosted apps in that isolated thread:
  Bits-only full 100–128 ms, light 103–107 ms. User global servers were
  absent in both controls. The fix preserves hosted apps and user config.
- Protocol 0.159 has `full` / `toolsAndAuthOnly`, `threadId` and pagination,
  but no per-server filter or resource-list RPC. Thread-scoped status
  still does discovery; resource read/tool call reuse the live thread.

Fix: use light discovery for tool admission/presentation; retain a
connection/thread/configuration catalog until reload, reconnect or sign-in;
refresh a missing tool once with single-flight and a 10-second per-thread
throttle; do not retain `notLoggedIn` snapshots. The provider gate performs
the visibility check once. Prefer resource-read content `_meta.ui`, which
Bits and the fixture supply, and await a separate full-inventory fallback
for list-only security metadata. Optional presentation hydrates after the
HTML snapshot returns, with a binding check before the late update.

Regression coverage includes idle calls, concurrent discovery/refresh,
new and unknown tools, model-only denial, configuration/reconnect isolation,
OAuth polling, list-only CSP in the served document, and slow/failed/stale
presentation updates. Desktop live validation was local; no new physical
phone smoke was run for this latency slice.

Final verification after removing probes: desktop executor/provider/document
and connection selections 50 passed; Codex catalog selection 12 passed;
authenticated remote-node App fixture 1 passed (2 unrelated cases skipped);
`typecheck:node` and `git diff --check` passed.

Attachment-time prewarm follow-up: desktop and headless live native App
events start the same single-flight light catalog before forwarding the
attachment, overlapping discovery with HTML loading. Ordinary session
startup does not prewarm. View calls continue to await actual tool visibility;
failed prewarms are evicted and retried by a real request. The cold hosted
connector cost remains once per connection/thread/binding configuration
until invalidation or eviction. The timing table above was measured before
this follow-up; it does not claim a new cold-data latency measurement.
Prewarm verification: Codex catalog 14 passed, desktop backend 88 passed,
headless Codex runner 12 passed; `typecheck:node` and `git diff --check` passed.

### UI resource cache and durable host state

Implemented shared bounded single-flight/LRU caches and content-addressed HTML
storage on desktop and Node. New durable attachments carry hash/meta; legacy
inline HTML remains readable on desktop, Node and phone. Phone's trusted shell
loader caches HTML by owning origin and hash; the host resolves session/App
identity rather than accepting a raw hash. Disk storage validates SHA-256 names,
writes via temp/atomic rename, verifies read digests and treats corruption as a
missing resource. Reference GC runs at startup and after deletion with a
five-minute write grace; unique deleted-session blobs are collected while
shared blobs remain. Existing Views keep their snapshot across revalidation.

Live uncovered a separate completion overwrite: desktop native Codex item upsert
and finalization replaced host state, as did chat-core completion snapshots.
All now reuse the shared attachment merge, including final native item snapshots
that omit the extension. Claude input/result paths use the same attachment merge.
Replay tests cover host writes before result/completion for both dialects.

The current library result is 1,050,849 bytes at the native Codex boundary;
normalizing away null gives a 1,050,824-byte App result, above the 1,048,576-byte
persisted budget. Approved degradation keeps a working View in `result`, omits
its initial `toolResult` and stores `toolResultOmitted` byte size/reason. Desktop
and phone expose this on restore. Only tool-input is notified; no initial result
or fabricated error is sent. Bits & Bolts loads its data via `cad.listParts`.
Do not raise the cap. **Follow-up after this slice:** extend CAS to oversized
initial results up to the transient bound, then fetch by authorized identity
on demand, preserving fidelity without repeated relay/bridge event payloads.

Codex shell measurements use the same test project/profile and loading placeholder
insertion → `ui/notifications/initialized`, excluding model-turn latency:

| Condition | Before resource cache | After resource cache |
|---|---:|---:|
| Frontend warm, new Codex thread | 312 ms | 225 ms |
| Same thread/frontend warm, fresh View | 192 ms | 166 ms |
| First View after dev restart | Not sampled in this comparison | 904 ms; 1,125 ms after completion fix restart |

Blake's isolated cold shell baseline was 724 ms (see preceding latency table).
It differs in cold frontend/process state; these single samples establish no
cold-start speedup. Catalog prewarm and HTML caching do not remove cold App data
loading or model latency. The main observed benefit is durable deduplication and
fetch-once behavior. Live completion persists `{hash,meta}`, status `result`, an
omitted marker and no error; identical Views share one 821,045-byte HTML blob.

Cache live evidence: `/private/tmp/claude-501/s0/cache-codex-after.png` and
`cache-codex-merged-live.png`.
No physical-phone or live remote-node smoke was performed for this slice;
authenticated SQLite/RPC tests cover Node ownership, restart, fetch authorization
and deletion GC. Full S1 remains after the other approved extension branches.

Restore smoke also found legacy S0 inline attachments carrying a 1,050,824-byte
initial result without an omission marker. Updating a retained old View threw a
synchronous host size assertion into React. Desktop/phone View boundaries and the
shared host now use the same bound helper; marker wins over raw fallbacks, and
host update rejects security checks asynchronously. Tests feed oversized legacy
results directly into both View components and ensure usable omitted state.
Codex raw `item.result` is still persisted separately in `metadata.codex`, so the
~1 MiB native result exists in SQLite once regardless of the attachment cap.
This is a constraint for the result-CAS follow-up, not fixed by HTML deduplication.

User chose activation **reload**: successful activation remounts each restored
desktop/phone View from its same pinned HTML and binding. New initialize gets
the persisted input/result or omitted state, plus persisted model context.
Failure keeps the original View and shows an error. The host does not replay
the originating tool. Both locales describe reconnect/reload, and Activate
lives in host chrome outside the View; it no longer obscures top-right View
controls. Desktop stories include a narrow restored/omitted View with its own
top-right Expand button. Shared header formatting also shows identical resolved
server/tool titles once on desktop and phone.

After a full process restart on port 9372, restored session
`2ab2106e-b37a-45fc-9816-58552024e94c` loaded its hash/meta snapshot without
React errors, showed the omission notice and waited for Activate. Activate
created a new iframe at the **same document URL**, emitted a new initialize,
and Bits & Bolts itself called `cad.listParts`; the library then populated
automatically. Evidence: `cache-codex-restored-strip.png` (unobscured Expand)
and `cache-codex-activated-reloaded.png` in `/private/tmp/claude-501/s0/`.

Omission only affects the host App attachment/initial View notification.
`attachCodexMcpApp` retains the native `item.result` object unchanged; a
regression test asserts identity and the original item's serialized bytes.
No harness/model tool-response path was changed. The model's live “no displayable
content” sentence is its interpretation; this slice does not establish model-side
truncation or claim that S0 produced the same sentence.

Final focused verification (overlapping selections, not a full suite):

- Desktop: `bunx vitest run` executor/cache/document IPC/completion/View and
  shared resource/metadata/host selections: 11 files, 114 tests passed.
- `packages/chat-view`: Frame lifecycle/SSR, document cache and executor:
  4 files, 31 tests passed. Lifecycle tests use the real App SDK/shared host
  for reinitialize, context/input/result preservation, and failed activation.
- `packages/runtime`: CAS/integrity/GC: 2 files, 6 tests passed.
- `apps/cli`: real SQLite/resource RPC/state restore: 2 files, 3 tests passed.
- Codex catalog/output identity: 15 passed; Claude attachments: 19 passed;
  chat-core completion replay: 2 passed; mobile relay/cache: 7 passed.
- Desktop `bun run typecheck:node` / `typecheck:web`, mobile `bun run typecheck`
  (including portable build), and portable `bunx tsc --noEmit -p tsconfig.json`
  passed. Node/runtime/core typechecks passed earlier in the slice.
- `git diff --check` passed. Package Vitest commands needed unsandboxed
  execution because the sandbox failed localhost DNS resolution; no test failed
  after rerunning in the authorized environment. Portable build retains its
  existing chunk-size warning.

Startup GC follow-up: desktop document-host registration explicitly schedules
a sweep for an existing CAS directory even if no View is opened in that run;
the store's lazy first-access sweep alone was insufficient. IPC startup coverage
verifies this occurs before attachment resolution or loading.

### S1 new-conversation regression

Live Claude testing found that a `target: new` conversation inherited the
harness but lost model/effort/access settings, and DB-only renderer navigation
could paint the default harness before its first message. The shared executor
now clones authoritative source settings and cwd, and renderer navigation
adopts the already-created local/node session before switching. Adoption pins
the inherited selection in that same state update. Automatic draft defaults
also refuse to reset any host-owned live/adopted session; an explicit user
harness choice remains available. Both scoped `init_ready` and host
`message_start` establish ownership, including a native first turn without
an initialization event. Remote creation finishes settings under the
existing control lease, and `session.patchSettings` has a mutation idempotency
key.

Verification: 113 tests across executor, authenticated node integration/RPC,
live restore, remote hydrate, handoff and draft-default policy passed;
`typecheck:node`, `typecheck:web` and `git diff --check` passed. Live Claude
`target: new` preserved Sonnet 5.5 / High / Auto / On: main, renderer and the
actual single-pane session scope agreed on the new ID, and the model described
the real PNG. Temporary action/state/scope logging was confined to the isolated
acceptance window, with no debug code added to the repository. Evidence is in
`/private/tmp/claude-501/s1/claude-verified-handoff-trace.json` and the
`claude-verified-titled-new` captures. Mosaic mode is not covered by this
single-pane proof and remains a navigation coverage gap.

S1 label follow-up: one shared server-title resolver now supplies message and
model-context chip sources, confirmation labels, and desktop/phone View headers.
It prefers the resolved presentation title and falls back to the server id.
The display label does not alter binding identity or model text. Desktop/shared
selection: 68 tests passed; portable View/lifecycle selection: 5 passed;
desktop node/web and portable typechecks passed.
Native-receipt guard follow-up: live Codex starts can omit `init_ready`; a scoped
host `message_start` now establishes the same ownership before automatic defaults
can run. The lifecycle/live-sync/default-policy selection passed 75 tests and
`typecheck:web` passed.

### Pre-merge review: provider binding identity

Desktop Claude, desktop Codex and the node Claude runner now use one shared
binding-identity assertion for session, native thread, account and server config.
Identity changes fail with `inactive` / `not_connected`, rather than initiating
sign-in for a different account. Desktop Claude strictly reloads server status
when obtaining a provider and after idle revive, without the old catalog throttle;
failed identity refresh is closed. Providers recheck after asynchronous catalog
refresh and immediately before native read/call/auth dispatch. Claude catalogs
retain configs even while a needs-auth server exposes no tools.

Regression coverage: same-name server changes across idle release/resume,
account changes after obtaining a provider, tool-discovery config changes, node
runtime replacement, and node project-config reload. Desktop binding/provider
selection: 104 tests passed; Codex backend: 88; node Claude: 7; Claude package: 20;
Codex provider package: 15. Desktop `typecheck:node` and `git diff --check` passed.
Package/CLI Vitest required an unrestricted rerun after sandbox localhost DNS
blocked initialization. No live acceptance rerun was performed for this fix.

A follow-up also ignores server-status/catalog responses belonging to a released
Claude query and marks a runtime checked only after its identity passes. This
prevents a delayed old status response from overwriting the revived server's
identity. The desktop binding/provider selection passed 105 tests with this
out-of-order response scenario, and `typecheck:node` passed.

### Pre-merge review: phone consent cancellation

The portable executor now carries the View lifetime's AbortSignal through every
operation and its confirmation step. It checks before dispatch, after replies,
and before consuming an approval challenge. Reload/revoke/unmount immediately
settles pending consent as cancelled; stale confirmation callbacks cannot resend.
Calls already dispatched retain unknown-outcome/no-retry handling.

Portable executor/frame coverage: 20 tests passed, including real App SDK/bridge
reload and unmount while consent is pending. Portable `tsc --noEmit` and desktop
`typecheck:web` passed. Physical phone acceptance was not rerun.

### Pre-merge review: executor scope cleanup

Session close/delete and complete requester disconnect release scoped View
activation, pending approvals and message handoffs; in-flight operations are
aborted so a late ready reply cannot recreate activation. Local runtime disposal
and all DB delete paths share lifecycle notifications. Remote node removal and
closed/removed durable events use the connection-scoped identity. The remote
start/completion tracker also drops a closed session's outstanding starts.

Idle message-rate keys expire after their existing 60-second window; an unref'ed
host timer also reclaims idle approval/handoff state without requiring traffic.
Live activations have no TTL or count eviction. Rate limiting remains shared
across a View's requesters.

Executor/lifecycle/DB/authenticated Node selection: 166 tests passed, including
100 session/device churn cycles returning all retained maps to baseline, requester
isolation, quiet live activation retention, late activation replies, prepared
message source/destination teardown, and real Node removal notifications.
Desktop node/web and portable typechecks passed; portable production build passed
with the existing chunk-size warning. No live desktop/phone smoke was rerun.

## Phase 2: forms

Branch `feat/mcp-apps-forms`. One schema model
(`packages/shared/src/schema-form.ts`) for standard MCP elicitation and
OpenAI's extended forms. Codex, Claude, ACP and the remote-node ACP path all
use it. The renderers are `SchemaFormComposer` (desktop), mounted in the
existing elicitation card, and `SchemaFormFields` (phone `PermissionSheet`).

### Decisions

- A form with any input SuperOne cannot render is reported as unsupported,
  never partially shown. The only action left is Dismiss, which answers
  `cancel` (`decline` on the phone, which has no cancel channel).
- No user-added files or directories (`userOptions`). They are ignored on
  single and explicit selection, as on ChatGPT web. Implicit selection always
  offers them, so it is unsupported.
- A form with more than 100 fields, or a schema over a fixed size, is
  unsupported; the check is cheap and runs before any field is parsed.
- Answers are checked in main against the form before they reach the server.
  Unknown keys are dropped, invalid answers keep the request pending, and
  resource fields only return URIs the server offered. These checks are
  structural (types, required, options, length and number bounds); `format`
  and `pattern` are advisory and left to the server.
- Main never runs a server's `pattern`. The renderer and phone show it as an
  inline hint through `linear-regex.ts`, a linear-time NFA simulation with a
  compile budget (source length, nesting, repetition counts, node visits) and a
  step budget per pattern. One budget per form validation pays for compiling
  and matching alike, so distinct costly patterns cannot add up. A pattern
  that is invalid, oversized, needs backreferences or lookaround, or exceeds a
  budget gets no hint; the form stays supported and the native engine is never
  a fallback. Compiled patterns live in an LRU bounded by count and total
  instructions; oversized sources are never cached.
- Forms never offer "Always Allow". Codex reads `_meta.persist` only on its
  own tool-approval elicitations, which have no fields.
- Older phones get the flat `elicitationForm` only for forms it can express.
  Otherwise they show allow/deny with no fields, and the server rejects an
  empty accept.

### Codex 0.159

- The desktop connection declares `openai/elicitation: { form: {} }`. Codex
  forwards it to MCP servers and relays `openai/elicitation/create` as
  mode `openaiForm`. The legacy `openai/form` key is not declared: servers
  answer it with an older `openai/imagePicker` field type.
- Full access (`approvalPolicy: never`) declines every form with fields unless
  the client also declares the Codex-only `openai/standard-form-input` and the
  thread was started with `threadSource: "user"`. `thread/start` now passes
  it, and resume restores it. **Threads created before this change keep
  declining forms in full access**; a new thread fixes it.
- `threadSource: "user"` otherwise only labels telemetry: Responses request
  metadata, the realtime turn header, and analytics events. Thread listing
  filters on `SessionSource`, not on it. Subagent/guardian handling,
  auto-review routing and memory selection do not branch on `User`.
  Checked in the Codex source at the 0.156 line, whose protocol matches
  the bindings generated by the 0.159 binary.
- Auto-review (the default preset) does not answer forms; they reach the
  user.

Live check on Bits & Bolts (dev instance, Codex 0.159):

| Tool | Preset | Server-side result |
|---|---|---|
| `cad.reviewForm` | auto-review | Pattern error shown; accepted `{reference, priority, approved, tolerance}` passes the SDK's content validation |
| `cad.pickFile` | auto-review | Thumbnail grid; the chosen part comes back with its View |
| `cad.pickReferences` explicit | auto-review | Default preselected; two URIs returned |
| `cad.pickReferences` implicit | auto-review | Unsupported notice; Dismiss → `cancel` |
| `cad.reviewForm` | full access | Form shown after the `threadSource` change (declined before); Cancel → `cancel` |

### Gaps and follow-ups

- **Claude**: Claude does not advertise `openai/elicitation`, and Bits & Bolts
  does not fall back to standard forms. `createElicitInput` throws, so
  `cad.pickFile`, `cad.pickReferences` and `cad.reviewForm` fail with a tool
  error. This is for the compat layer.
- **Remote node**: `packages/codex/src/app-server-client.ts` answers every
  server request itself (elicitations are declined), so it does not advertise
  forms. The node's ACP path accepts without returning content
  (`formatGrokElicitOutcome`).
- **Previews** (`_meta["openai/preview"]`): parsed but not shown, and the option
  stays selectable. Planned path: main checks the URI against the pending
  elicitation's `resource_link` preview targets and reads it from the server
  that sent the elicitation, with the transient View output cap. Transient
  provider reads accept any URI of the server; only documents need `ui://`. `mcp_app_tool`
  previews wait for hosting a View without a tool call (proposal §5).
- **User-added resources**: need a security review first. Native main-process
  dialog only, `file://` URIs, `accept` enforced, local stdio servers only.
- **URL-mode** Codex elicitations still show a plain approval without a link.

## Remaining gaps (audit, 2026-10-02)

Checked against `openai/mcp-extensions` `docs/spec.md`. Phases 1–2 cover
model context, `openai/message` and most form features. Still missing:

| Area | State |
|---|---|
| File entrypoint, host resources (`read` / `subscribe` / `openai/resources/write`), path injection | Codex sessions on local projects: done. Claude needs step 1; remote projects and phone later |
| `openai/files/open` | Not supported — Phase 3 |
| Composer at-mentions (`mentions/search`) | Codex sessions on local projects: done. Claude needs step 1; remote projects and phone later |
| Form previews (`openai/preview`) | Parsed, not shown — Phase 3 host follow-ups |
| Form `userOptions`, implicit selection | Ignored / refused — Phase 3 host follow-ups |
| `ui/download-file`, collapsed untitled long text | S1 leftovers — Phase 3 host follow-ups |
| Form capability on Claude and on the remote-node Codex client | Not advertised — after Phase 3 |
| Global and thread entrypoints, deep links | Not supported — later; need the host-origin binding from Phase 3 |
| Structured settings (`openai/settings`) | Not supported — later; needs server capabilities, which Claude withholds |
| Plugin onboarding | Out of scope until SuperOne has plugin packages |
| Display modes | Supported, except `preferredDisplayMode` on first render (deliberate) and phone PiP |

## Phase 3: files and mentions

Ordered ahead of proposal phase 3 (entrypoints, settings) by user decision.

### Decisions (2026-10-02)

- **Default viewer**: SuperOne's own preview opens any format it supports. An
  App that declares a file entrypoint for the extension is an alternative the
  user picks, never a silent replacement. Formats SuperOne cannot preview
  show the existing placeholder with one "Open with <App>" action per App, so
  every App launch (a tool call on the server) is an explicit user action.
- **Entry points**: an "Open With" submenu in the file-chip context menu
  (`useFileChipContextMenu`) and the file-tree context menu (`TreeRow`), an
  "Open With" control in the open file preview's header, and the
  unpreviewable placeholder. All list SuperOne Preview first, then each App.
- **Host session**: the App belongs to the session of the pane where the
  action happens (a chip uses its message's session). It lives in memory only:
  no transcript row, no `ui/message`, no model context, gone on restart or
  when its tab closes. Menus look Apps up when they open (this may start the
  harness); an open preview only asks a running harness and otherwise shows
  no App control.
- **Claude**: SDK 0.3.285 withholds every tool `_meta` key except `ui` and
  `ui/resourceUri`, and `mcp_call` takes no `_meta`. In Claude sessions
  SuperOne connects to the server itself — stdio and HTTP, with SuperOne's
  own OAuth — for discovery and for every call of a host-originated App.
  Server configs come from Claude's `mcpServerStatus()`. The model's own tool
  calls stay on Claude's connection.
- **Codex**: stays on app-server. Protocol 0.159 (`generate-json-schema`)
  carries full `Tool._meta` in `mcpServerStatus/list` and accepts `_meta` on
  `mcpServer/tool/call`.

### Risks

- A stdio server reached directly runs as a second process. Servers that keep
  state in memory can disagree with what the model sees through Claude.
- Direct HTTP connections hold their own OAuth tokens, separate from Claude
  CLI's; signing in once per server per tool is visible to the user.

### Steps

1. **Direct client for Claude sessions**: resolve server configs from
   `mcpServerStatus()`, connect over stdio or HTTP, `tools/list` with full
   `_meta`, cached by config fingerprint; idle teardown; OAuth sign-in and
   token storage. Security review before shipping (spawned commands, token
   storage, which configs are eligible). Builds on `compat-session.ts`.
2. **Host-origin binding** (proposal §5): host-originated `ToolAppAttachment`
   records per session, outside transcript rows, found by executor
   `resolve`, document registration and the node's App index; restored with
   the session. Visibility is ignored only for the entrypoint tool itself.
3. **Catalog API**: per session, the file-entrypoint Apps for an extension and
   the `mentions/search` tools (`visibility` includes `app`), with title and
   icon; Codex from its catalog, Claude from step 1.
4. **Open a file with an App**: call the entrypoint tool with
   `{ file: { name, resourceUri } }` (opaque `host-resource://` URI), create
   the attachment, open it as an activity tab next to the file tab, send the
   same arguments as `ui/notifications/tool-input`. Advertise
   `experimental["openai/resource"]` only to Views opened this way.
5. **Host resources**: `resources/read` for the opened URI (`representation`
   text/blob, size cap, `etag`, `writable`); `resources/subscribe` /
   `unsubscribe` backed by a file watcher (`notifications/resources/updated`);
   `openai/resources/write` for that URI only, after a `writable` read, with
   `ifMatch`, inside the workspace, under a size cap (`saved` / `conflict` /
   `too-large`). Remote-project files go through the existing remote file API.
6. **Path injection**: `_meta["openai/resource"].path` on tool calls from a
   file-entrypoint View — Codex `mcpServer/tool/call` `_meta`, Claude through
   the direct client. Views never receive the path.
7. **UI**: the four entry points from the decisions, with stories for loading,
   no App, several Apps, disabled (no harness) and narrow layouts.
8. **`openai/files/open`**: advertise `experimental["openai/files"]`; open the
   path in the file preview; paths outside the session's workspace need
   confirmation.
9. **Mentions**: a server section in `MentionPopup` per `mentions/search`
   tool, debounced `{ query }` calls, inserting a resource-link mention kind
   (`MentionNodeAttrs`, `ChatInput` serialization, user-bubble chip). The
   model receives the link with its server and URI.
10. **Host follow-ups**: form previews (`resource_link` read from the
    eliciting server under the transient cap; `mcp_app_tool` previews through
    step 2), `userOptions` (security review first: main-process dialog,
    `file://`, `accept` enforced, local servers only), `ui/download-file`,
    and collapsed untitled long text in confirmations and bubbles.

### Progress

**Codex file open (steps 3–7, local projects): done.** Shared contracts in
`packages/shared/src/mcp-app-files.ts`; main in `mcp-apps/host-files.ts` and
`file-apps-ipc.ts`; renderer in `components/mcp-apps/file-apps.ts`,
`open-with-menu.ts` and `McpAppOpenWith.tsx` (story `MCP Apps/Open With`).
Lookups ask every server in parallel; a server that does not answer within
15 s marks the answer `incomplete`, which the renderer does not cache.
File reads and writes share one size cap derived from the transient cap.

Found while testing Bits & Bolts and changed for every View (user decisions):
transient reads may use any URI of the View's own server; the transient cap
is 32 MiB (above); the View CSP allows `'unsafe-eval'` and
`worker-src 'self' blob: data:` (Emscripten glue and its worker), still with
no new origins.

Verified live (Codex 0.159, Bits & Bolts, CDP): cold and warm lookups; Open
With from the preview header; STL and a CAx-IF STEP assembly render; save
writes the file without a self-notification; an external change reloads the
View; closing the tab releases the watcher. Native context menus (chip, tree)
share the tested hook but were not driven live.

**Codex mentions (step 9, local projects): done.** Shared contracts, item
parsing and the `<superone-mcp-resource>` tag in
`packages/shared/src/mcp-app-mentions.ts`; main in `mcp-apps/mention-search-ipc.ts`,
which shares discovery with file entrypoints through `mcp-apps/host-tools.ts`;
renderer in `components/mcp-apps/mention-search.ts` and
`components/chat/McpMentionRows.tsx` (stories `Chat/MentionPopup` `Mcp*`,
`Chat/MentionChip`). Typing `@` may start the harness. Each server tool is a
popup section before files; items are resource links or OpenAI resources,
capped at 50 per server. A picked item becomes an `mcp-resource` chip whose
tag carries server, title and URI: Codex's `mention` input only takes `app://`
and `plugin://` paths, so the model gets the self-describing tag and reads the
resource with its own MCP tools. Claude sessions show no section until step 1.

Verified live (Codex 0.159, Bits & Bolts, CDP): cold lookup about 10 s, warm
5 ms; `@keycap` lists the server's parts; the chip survives send; the model
read the mentioned resource and answered from it.

Out of this phase: phone parity (file preview "more" menu is the natural
place), remote-node direct clients, global/thread entrypoints, settings.
