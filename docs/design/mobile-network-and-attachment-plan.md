# Mobile network optimization and inline attachment plan

Status: **mandatory implementation landed in the worktree** — 2026-09-14.
§6, Phase 0, A, B1 and C1/C2 are implemented. C3–C5 and B2 remain conditional
on representative device measurements. Local validation and reproducible
benchmarks: [mobile-network-validation.md](./mobile-network-validation.md).
Live provider/image and linked-phone performance acceptance are still pending.
Reviewed: 2026-09-14. Development-stage policy: desktop and phone upgrade
together; old protocol compatibility and mixed-version operation are out of
scope. Derived caches use versioned formats; pairings and unsent draft outboxes
must remain intact. Relay envelopes and control messages stay unchanged, so
this work requires no relay code change or deployment.
Scope: `apps/mobile` ↔ `apps/desktop/src/main/remote*` traffic, plus the desktop
attachment hand-off to every harness. Sibling docs:
`mobile-progressive-session-loading.md` (restore + detail streaming, shipped),
`chat-core-contracts.md` (event/type contract).

Two goals, deliberately in one document because the second is a byte-count
change on the same wire:

1. Fewer round trips and fewer bytes between phone and desktop without changing
   what the user sees, and a cache policy that survives an app restart.
2. Attachments reach the agent as **path + inline bytes**, so a picture costs no
   `Read` tool call, while `reference_image_paths`-style tools still get a path.

Recent work that this plan builds on rather than repeats: `0ad7281a` (connect
path parallelised), `f089c968` (session lists survive drawer closes),
`3865ac85` (per-pairing preview + transcript cache), `89abc4bd` (thumbnails on
the wire), `0ce60333` (attachment bytes cross twice, native AES).

---

## 1. Baseline

Facts as of `main` at `9904c5bd`. Line numbers are approximate; symbol names are
the stable reference.

### 1.1 Transport

| Fact | Value | Where |
|---|---|---|
| Frame format | `JSON.stringify` → AES-256-GCM (12 B IV + 16 B tag) → base64 → JSON envelope | `packages/relay-client/src/crypto.ts` `encryptPayload`; `apps/desktop/src/main/remote-control-crypto.ts` |
| Compression | none, at any layer | grep clean |
| Event batching before encryption | none — `queueSend(events[])` supports arrays but all five call sites pass one event | `apps/desktop/src/main/remote-control-service.ts` `queueSend` |
| Request multiplexing | none — one WS frame per `request()`; `Promise.all` overlaps latency only | `packages/relay-client/src/rpc.ts` |
| RPC timeout | 15 s | `rpc.ts` `timeoutMs` |
| Response chunking | > 800 000 chars → `response_chunk` | `remote-control-service.ts` `WS_CHUNK_SIZE` |
| Heartbeat | 30 s ping, 10 s pong timeout (relay only) | `packages/shared/src/relay-heartbeat.ts` |
| Inline file cap | 512 KiB | `packages/shared/src/file-preview.ts` `INLINE_RPC_MAX_BYTES` |
| Phone crypto | OpenSSL via `react-native-quick-crypto`; `@noble/ciphers` fallback | `packages/relay-client/src/crypto-backend.ts` |

### 1.2 Requests per user moment

| Moment | Requests today | Notes |
|---|---|---|
| Connect → first project's new-session landing | **14–16** | `list_projects` ‖ `list_harness_options`; then `get_system_info` + `get_project_resources` + `get_mcp_icons` + `list_sessions` + `get_git_info`; then `loadShellDetails`: `get_git_info` + `get_project_resources` + `get_worktree_info` + `get_system_info(refresh)` + `get_git_branches` + `get_checked_out_branches` + one `get_git_info` per worktree; plus `list_session_activity`, `list_drafts`, and one `get_git_info` per project row in the background |
| Open an existing session (warm transcript cache) | **3** | `subscribe_session{progressive}` (8 newest messages + snapshot in one reply) + an uncached `get_system_info` + `get_git_info` |
| Open a session in another project | **8+** | `openProject` batch (5) then `openSession` (3) |
| App foreground | re-dial + **2N catalog refreshes** + MCP icons + every visible session list + drafts ×2 + activity + mDNS restart + `/status` per pairing | `reconnectController.force()` has no healthy-socket guard; `restore()` calls `refreshHarnessResources` over every cached key with `refresh=true` |
| File chip tap (paired) | **2** | `read_desktop_file{statOnly}` then `{preferInline}`; the single-trip shape exists and is used only on the unpaired branch |
| Drawer open | 0–1 | `list_pinned_sessions` only when its revision moved (good) |
| Composer keystroke | 0 | drafts flush 450 ms debounced; mentions 150 ms debounced with in-flight dedupe (good) |
| Send | 0 round trips | fire-and-forget (good) |

Duplicates inside one connect: the same project's `get_git_info` is issued three
times (`openProject`, `loadShellDetails`, background loop) and the selected
harness's `get_system_info` twice (warm, then `refresh=true` two calls later).
`ChatRuntime.loadSystemInfo` (`apps/mobile/src/runtime.ts`) is a second copy of
the `get_system_info` path that never consults `harness-resource-cache`.

### 1.3 Caches and what survives a restart

| Data | Store | Survives restart | Invalidation |
|---|---|---|---|
| pairings, device id, chat view state, theme, locale, update throttle | MMKV | yes | — |
| mention icons (`mention.icons.v1`) | MMKV, 200 entries, content-hash keys | yes | never needed |
| draft outbox | MMKV per pairing | yes | flush |
| projects, harness options | React state | **no** | connection life |
| session lists (30/page), pinned | `WorkspaceListCache` in memory | **no** | `session_list_changed` push, reconnect |
| `get_system_info`, `get_project_resources` | `harness-resource-cache` WeakMap per client, no TTL | **no** | `refresh=true`, new client |
| MCP icons | module map, no key | **no** | refetched every `openProject` and restore |
| session transcripts | in-memory blob inside `FilePreviewCache` (512 MB LRU shared with previews) | **no** | disconnect / forget |
| downloaded preview files | disk under `Paths.cache` | yes | LRU |
| git branches, checked-out, worktree info | React state | no, and no TTL | every `loadShellDetails` |
| activity | React state, push-updated | no | connect edge |
| WebView `PortableHostImage.loaded`, favicon map | unbounded Maps | no | document reload |

### 1.4 Host payload shape (what the phone pays for)

| RPC / event | Heavy part | Where |
|---|---|---|
| `list_drafts` | every row carries `text`, the whole Tiptap `docJson`, and ~30 `settings` fields; only bytes are stripped | `apps/desktop/src/main/remote/draft-control.ts` |
| `save_draft` reply | echoes the full record (incl. `docJson`) to the device that sent it | same |
| `list_session_activity` / `session_activity` | `pendingReason` in **both** locales per row | `packages/shared/src/session-activity.ts` |
| `get_session_history_index` | unbounded: one id per message + 160-char previews per turn; no `since` | `apps/desktop/src/main/session/history-navigation.ts` |
| `list_pinned_sessions` | no limit | `apps/desktop/src/main/db-sessions.ts` |
| `get_mcp_icons` | every icon as a data URI, no ids, no "have" list | `apps/desktop/src/main/mcp-server-icons.ts` |
| `permission_request` (Edit/Write) | full old+new body plus per-line highlight tokens, uncapped | `apps/desktop/src/main/remote-content.ts` `enrichPermissionRequest` |
| `list_sessions` refresh | phone re-requests `max(loaded, 30)` rows from offset 0 on every `session_list_changed` | `apps/mobile/src/navigation/use-project-sessions.ts` |
| `subscribe_session` | always returns the 8 newest messages even when the phone's cached tail already has them | `apps/desktop/src/main/agent/progressive-bootstrap.ts` |

Already good and not touched by this plan: tool results are emptied for
progressive devices and streamed on expand as prefix diffs; tool inputs are
allow-listed and dropped above 1 KB; attachments go out as 256 px thumbnails;
`session_activity` is pushed, not polled; `search_mentions` uses content-hash
icon ids.

---

## 2. Phase 0 — measurement ledger

Before network optimization, add a dev-only transport ledger on the phone:
logical RPC counts, actual frame counts, serialized envelope UTF-8 bytes in/out
(including encryption/base64 overhead and chunks), decoded JSON UTF-8 bytes,
RPC latency, and crypto/compression/decompression time. Include pushed events,
ACKs, heartbeat frames, retries, and both LAN and relay traffic. Distinguish
transport payload bytes from lower-level network overhead that is not measured.
Add per-moment markers (`connect`, `open-session`, `foreground`) and time to
cached paint / usable screen. Surface it in the
app-settings developer panel and in the `native-preview` gallery. `restoreSession`
already returns `metrics`; extend the same shape.

Every later phase states its expected effect in these units and is verified
against the ledger, not by feel. C1 is measured by wire bytes, not decoded JSON
size; C2 by event frames and wire bytes, not RPC counts. Compare the same
fixtures and cache state, and report foreground work separately from background
revalidation. Do not log attachment contents or decrypted payloads.

---

## 3. Phase A — client-side request elimination

No protocol change, no host change. Each row is independent.

| # | Change | Files | Expected effect |
|---|---|---|---|
| A1 | Per-client in-flight coalescer keyed by canonical command JSON (minus `requestId`): identical pending reads share a promise. Allow only `get_git_info`, `get_system_info`, `get_project_resources`, `list_sessions`, `list_drafts`, `list_pinned_sessions`; clear settled entries and discard old-connection results. | `packages/relay-client/src/rpc.ts` or a thin wrapper in `apps/mobile/src/` | Removes overlapping duplicates only; sequential repeats require A2/A3 or B TTLs. Measure savings without double-counting A7. |
| A2 | Drop the warm `get_system_info` in `openProject` when `startNewSession` follows with `refresh=true`, or drop the `refresh` and trust the warm copy plus C4. | `apps/mobile/src/navigation/mobile-app.tsx`, `shell-details.ts` | −1 catalog request per connect (this one can make the host launch an agent process) |
| A3 | Route `ChatRuntime.loadSystemInfo` through `requestHarnessResource` so `openSession` hits the cache warmed seconds earlier. | `apps/mobile/src/runtime.ts` | −1 per session open |
| A4 | Foreground: if the socket is open and the last pong is recent, send one ping and only re-dial on timeout. On a real reconnect, mark cached catalogs **stale** instead of refetching them all; a stale entry is served immediately and revalidated on next use. | `apps/mobile/src/reconnect-controller.ts`, `use-reconnect-on-foreground.ts`, `harness-resource-cache.ts`, `mobile-app.tsx` `restore()` | foreground on a healthy socket: from ~2N+8 requests to 0–1 |
| A5 | Paired file preview: one `read_desktop_file{preferInline, statOnly}` trip, as the unpaired branch already does. | `apps/mobile/src/navigation/use-file-preview.ts` | −1 per preview |
| A6 | `loadShellDetails`: issue per-worktree `get_git_info` only when the worktree picker opens. Remove connect-time per-project Git enrichment: current project rows do not render that field; branch information loads on branch-page entry. | `shell-details.ts`, `mobile-app.tsx` | bounded by visible rows instead of repo/worktree count |
| A7 | Remove the explicit `library.refresh()` after `library.reconnect()`. | `apps/mobile/src/navigation/use-remote-drafts.ts` | −1 `list_drafts` per reconnect |
| A8 | Bound the WebView-side `PortableHostImage.loaded` and favicon maps (LRU by count); they duplicate the RN-side 48 MiB image LRU. | `packages/chat-view/src/PortableHostImage.tsx`, `host-favicon.ts` | memory only |

UX invariants: no new spinners; A4 must keep the connection line's
`Reconnecting…` vocabulary for a real loss; A6 must not delay the worktree
picker (fetch on picker open, not on landing mount).

---

## 4. Phase B — persisted caches

Principle: **paint from the last known state, revalidate in the background, never
block on the network for data the phone has seen before.** All entries are keyed
by `pairingId` first, wiped on Forget, kept across disconnects and restarts.

Split delivery into **B1**, caches using today's protocol with normal background
fetches, and **B2**, content-hash MCP icon caching after C5 plus conditional
revalidation / transcript deltas after C4. B1 is client-only; B2 is not.
Persist a cache schema version, enforce byte budgets as well as entry counts,
and treat missing/corrupt/obsolete files as cache misses. Publish disk content
and its metadata atomically. A late response from an old connection or a
forgotten pairing must not repopulate its cache.

| Data | Store | Size guard | Revalidation |
|---|---|---|---|
| `list_projects`, `list_harness_options` | MMKV `workspace-cache.v1.<pairing>` | 128 entries / 2 MiB total; 1 MiB per entry | one background read on connect; C4 reduces unchanged response bytes, not request count or necessarily host computation |
| `list_sessions` first page per project, `list_pinned_sessions` | versioned per-pairing MMKV metadata | 30 rows each, within the 2 MiB metadata budget | existing `session_list_changed` push; one read on connect |
| `get_system_info`, `get_project_resources` | same versioned metadata, keyed by project and harness | same metadata budget | 60 s TTL; stale on foreground/reconnect, revalidate on use; active consumers receive refreshed values |
| MCP icons | MMKV `mcp.icons.v1` keyed by content hash, same mechanism as `mention.icons.v1` | 200 entries | needs C5 `iconsById` |
| session transcript newest page | disk blob + versioned manifest via `FilePreviewCacheDisk` | newest 200 complete messages / 8 MiB each, part of the 512 MiB pool; 1,024 manifest entries / 2 MiB per pairing | existing `after` merge in `packages/relay-client/src/restore.ts`; C4 `afterMessageId` |
| git branches, checked-out branches, worktree info | in-memory per project, TTL 30 s | — | branch switch, turn end (the existing `refreshGitInfo` hooks) |
| `get_git_info` | in-memory per project, TTL 5 s | — | same |

Not cached, on purpose: `list_mcp_servers` (deliberately live), `search_*`
results, activity (push-driven), drafts (lease semantics, own outbox).

Persistence rule for the transcript: exclude the unfinished tail, using
`dropIncompleteTail` as the starting point. Persist the newest contiguous
complete suffix, capped at 200 messages and the byte budget. The persisted
`cursor` / `hasMore` must describe the oldest retained message: recompute them
after trimming, marking discarded older messages as available for paging.
Never reuse the pre-trim cursor, which would skip discarded messages. If the
anchor cannot be established, fall back to a fresh host page. C4 must also
handle history replacement and invalid anchors explicitly.

---

## 5. Phase C — protocol changes

Desktop and phone ship together using one protocol contract. No feature
negotiation, legacy response branches, per-version broadcast groups, or
mixed-version tests are required during development. Update shared types,
producers, and consumers in the same change. Compression and batching happen
inside the existing encrypted relay envelope; relay continues forwarding opaque
payloads. No upgrade-time replay migration or startup reset control is added.
Reject obsolete derived-cache formats while preserving pairings and unsent
draft outboxes.

### C1 Compression (host → phone)

- Host: asynchronous Node `deflateRaw` on the worker pool before AES-GCM when
  plaintext exceeds 512 B. Use compression only when it reduces the encoded payload size.
  Prefix every host → phone application plaintext with a five-byte header:
  one flag byte (`0x00` raw, `0x01` deflate) and a big-endian uint32 original
  JSON byte length. Both fields are covered by the GCM tag.
- Phone: `decryptHostPayload` reads the authenticated header and inflates with
  direct dependency `fflate@0.8.2`, into a fixed buffer sized to the declared
  output plus one byte. Reject mismatched lengths. Pairing and file-encryption
  helpers remain separate. The ledger separates AES decrypt from inflate/JSON
  decode; measure Hermes on a linked phone before claiming latency gains.
- Bound compressed input and decompressed output before allocating unbounded
  memory: JSON is capped at 32 MiB, with the matching ciphertext/base64 bound.
  Response chunks are at most 800,000 characters and their aggregate is bounded.
  Reject unknown flags, corrupt streams, and oversized output predictably.
- Phone → host stays uncompressed initially. Base64 can compress even when the
  underlying image is compressed; defer this direction by measured benefit,
  not an assumption of zero savings.
- Expected hypothesis: 3–8× on JSON text payloads. Measure actual savings for
  images/icons too; hash caching avoids repeated transfers altogether.
- Apply the codec to both relay and LAN event/response paths. Chunk after
  compression and encryption; reassemble before decrypting and inflating.
- Golden tests: raw and deflated frames, small/incompressible payloads, size
  limits, malformed frames, chunk boundaries, and transport reset/reconnect.

### C2 Host-side event coalescing

`RemoteControlService.queueSend` accepts an array but is always called with one
event. Add a per-target 33 ms window (reuse `packages/shared/src/agent-event-batcher.ts`
`coalesceAgentEventBatch`) so N events can share one AES seal, one base64,
and one relay frame. ACKs remain cumulative per frame. Preserve event-level
sequence numbers: sequenced text deltas may share a frame but must not be folded
into one delta. Keep target sets separate and preserve event order across flushes.
Flush at terminal/control boundaries, cap batch bytes/count, and define disposal
on disconnect. The phone already reduces arrays; verify completion, permission,
interruption, and replay ordering as well as text throughput.

### C3 Generic `batch` command

`{ type: 'batch', requestId, commands: BatchReadCommand[] }` returns a result
array in input order, with each entry `{ ok: true, result }` or
`{ ok: false, error }`. Define `BatchReadCommand` as an explicit allowlist of
independent reads; reject writes, subscriptions, and nested batches at runtime.
Execute with bounded concurrency, not sequentially: replacing `Promise.all`
with serial work increases latency and can exceed the existing 15 s timeout.
Keep a per-batch cap of 16 and a request byte cap. Preserve each read's normal
validation and authorization. Isolate item errors; use a host batch deadline
shorter than the client timeout, returning timeout errors for unfinished items
and discarding late results. Responses still use normal chunking when needed.
Convert only measured groups where waiting for the slowest item does not delay
useful rendering. Compare both frame savings and time to usable screen.

### C4 Conditional fetch

- Catalog RPCs (`get_system_info`, `get_project_resources`, `list_harness_options`,
  `list_projects`, `get_mcp_icons`) return `revision` (a hash of the response).
  The phone sends `ifNoneMatch`; an unchanged host answers `{ unchanged: true }`.
  With B and A4 this reduces unchanged responses. Hashing a freshly generated
  response does not avoid expensive host resource discovery; reuse host cached
  revisions with explicit invalidation where that cost matters.
- `subscribe_session` gains `afterMessageId`: when the phone holds a cached tail,
  the host returns only rows after it (possibly none) instead of the 8 newest.
  Return an explicit `full | delta | reset` mode. An empty delta preserves
  cached history; an empty full/reset replaces it. The current `restore.ts`
  treats an empty page without `hasMore` as empty host history, so its merge
  must change. Include a history generation with the anchor; a missing anchor
  or changed generation returns reset with a fresh page and snapshot.
  Bound delta pages and distinguish forward continuation from older-history
  `cursor` / `hasMore`; never silently stop at the current after-walk cap.
  Preserve buffer-first ordering and merge overlapping live events by identity.
- Keep full `list_sessions` refresh initially. If the ledger justifies deltas,
  use a monotonic change revision covering rename, pin, tags, visibility,
  ordering and deletion, with retained tombstones and a full reset when the
  cursor expires. `lastActiveAt` is the last user-message timestamp, not a
  change revision; it cannot implement this contract. Define how updates
  reorder/backfill a partially loaded list before enabling the delta path.

### C5 Payload trims (coordinated host and client changes)

| RPC / event | Change |
|---|---|
| `list_drafts` | `summary: true` → rows without `docJson` / `settings` / `text` beyond a 120-char preview; the phone opens a draft through `open_draft` anyway |
| `save_draft` reply | `{ id, updatedAt, leaseId }` for the sender; update `remote-draft-library.ts` to reconcile the submitted snapshot and server metadata without `result.draft`, preserving newer pending edits and lease/conflict behavior |
| `session_activity`, `list_session_activity` | `pendingReason` for the active device locale only; update types/renderers and refresh reasons when locale changes |
| `get_session_history_index` | `since` cursor and a 400-turn window, with explicit continuation/reset and a UI path to older turns |
| `list_pinned_sessions` | `limit` (default 50) plus continuation and load-more UI; never silently hide pins beyond the first page |
| `get_mcp_icons` | `iconsById` + `get_mcp_icon_bytes { ids }`, same shape as mentions |
| `permission_request` Edit/Write | cap `toolDiff` / `toolDiffTokens` at 64 KB for progressive devices and expose the rest through `subscribe_detail` like tool results |
| `list_models` | drop `description` and `serviceTiers[].description` for progressive devices |

The permission detail endpoint and client expansion flow must land before
truncation is enabled; `progressive` alone does not implement that flow. Preserve
pending permission details until resolution and show truncation/loading/failure
explicitly. Update all affected consumers in the same change; no old response
shape is retained.

---

## 6. Inline attachments alongside paths

### 6.1 Today, per harness

| Harness | Agent receives | Where | Gap |
|---|---|---|---|
| Claude | text note with temp paths only; inline blocks only if a disk write fails | `apps/desktop/src/main/agent/claude-query.ts` `buildUserMessage` | one `Read` per picture; `persistAttachment` is called without `name`, so the file loses its user-facing name |
| Codex | text note with temp paths only | `apps/desktop/src/main/codex/codex-turn.ts` `buildCodexQueuedInput` | no image reaches Codex in any form; failed writes are silently dropped |
| ACP / Grok | inline `image` block, `uri: attachment://<name>` | `apps/desktop/src/main/acp/acp-event-map.ts` | no path; a PDF is sent as an `image` block |
| OpenCode | inline `file` part with data URL | `apps/desktop/src/main/opencode/opencode-client.ts` | no path |
| Cursor | inline `{ data, mimeType }` | `apps/desktop/src/main/session/backends/cursor-backend.ts` | no path |
| dsh | inline via its own content-addressed store | `packages/deepseek/src/images.ts` | no path; PDFs refused |
| CLI remote node | path note; inline **only** for attachments that failed to persist | `apps/cli/src/session/turn-attachments.ts` | the hybrid already exists, gated the wrong way |

Path-only delivery was introduced in `a7de3f2b` with two stated reasons: keep
bytes out of context until needed, and let file-path tools (image editing,
`reference_image_paths`) take the attachment. The second reason still holds; the
first does not pay off for user-attached pictures, because the model looks at
them in the same turn and a `Read` costs the same image tokens plus a tool round
trip.

The store (`packages/shared/src/attachment-store.ts`) writes to
`$TMPDIR/super-one-attachments/<uuid>-<safe-name>`, refuses buffers over 4 MB,
has no cleanup, and already exports `buildInlineAttachmentBlocks` — the desktop
shim (`apps/desktop/src/main/agent/attachment-store.ts`) just does not re-export
it.

Codex needs no bytes from us at all: its `UserInput::LocalImage { path }`
(`localImage` on the wire) is read by Codex at request time, inlined as a data
URL, and followed by its own `<local_image path=…>` text tag. That is exactly
"path + inline", natively.

### 6.2 Design

One shared preparation helper, with provider-specific input adapters. Preserve
attachment identity, MIME type, order, and failure information; saved paths
alone cannot distinguish images from PDFs or map partial failures safely.

```ts
// packages/shared/src/attachment-turn.ts
export function buildAttachmentTurn(
  attachments: AttachmentInput[],
  opts: { inlineImages: boolean; inlinePdf?: boolean; requirePaths?: boolean },
): {
  attachments: Array<{
    index: number
    name: string
    mimeType: string
    path: string | null
    inline: boolean
    error?: string
  }>
  inlineBlocks: InlineAttachmentBlock[] // image/document blocks for the inlined subset
  note: string                         // path note, see wording below
}
```

Note wording (replaces `buildAttachmentPathNote`):

> `[Attached N file(s). Images are shown inline above; do not Read them just to
> view them. Use the local path when a tool takes a file path (image editing,
> reference_image_paths, PDF pages):\n<name> → <path>]`

Generate the note from actual delivery outcomes: say images are inline only
when they are. A failed write may fall back to inline bytes only if that
provider supports the input and its limits are satisfied; mark the missing
local path and surface the degraded result to the user. Codex `localImage`
requires a readable file, so a failed image write blocks the send with a
retryable attachment error. With D1, a failed PDF write also blocks the send.
Keep the draft/attachments for retry; a failure note is not content delivery.
The first implementation requires readable paths at turn admission for all
production adapters, including Claude; the helper's inline-only fallback is not
used to hide write failures. Admission and adapters reuse the saved file within
the turn. Host validation runs before transcript insertion or queue dispatch.

| Consumer | Message shape |
|---|---|
| Claude (`buildUserMessage`) | `[...inlineBlocks, { type: 'text', text: content + '\n\n' + note }]`; never falls back to string content when attachments exist |
| Codex (`buildCodexQueuedInput`) | Text plus `localImage` items for successfully saved images only; PDFs stay in the path note. Validate files before normal and queued/steered sends. |
| CLI (`prepareTurnPrompt` and runners) | Preserve typed prepared attachments. Claude receives inline blocks; CLI Codex passes `localImage` items through `packages/codex` to turn/start and steer paths instead of choosing `textFallback`. |
| ACP / OpenCode / Cursor / dsh (optional parity) | Keep supported inline inputs; persist and append the note. Use `pathToFileURL` for ACP file URIs. Apply D1 to PDFs rather than labeling them as images; verify paths on the host where provider and file tools execute. |

Size policy implemented: **4,000,000 decoded bytes per file**, **8 files**,
**12,000,000 decoded bytes per turn**, and **20,000,000 bytes of serialized text
plus attachment input**. These are conservative application admission ceilings,
not a claim that every provider accepts the largest possible turn.
Existing 2000 px (desktop) / 2048 px (phone) normalization does not
bound encoded bytes, animated GIFs, or multiple attachments. Before enabling
unconditional image delivery, define shared limits for decoded bytes per file,
attachment count, and total serialized turn bytes using supported provider and
transport limits. Enforce them on the host for desktop, mobile, and CLI inputs,
with matching early composer validation. Sniff MIME, validate base64, and cover
GIFs and multi-image inputs explicitly. The current 4,000,000-byte store guard
must agree with accepted inputs that require paths; over-limit attachments are
validation errors, not accidental write-failure fallbacks. PDFs follow D1.
Retain the draft on validation failure.

### 6.3 Steps

1. `packages/shared`: add `buildAttachmentTurn`, retire `buildAttachmentPathNote`
   wording, make `persistAttachment` callers pass `name`; re-export from the
   desktop shim. Update `attachment-store.test.ts` (note wording assertion).
2. Claude backend: rewrite `buildUserMessage`; rewrite the assertion in
   `claude-query.test.ts` that bytes are absent into one that image blocks are
   present **and** the path is in the text block. Both call sites in
   `claude-backend.ts` (normal send, queued steer) go through the same function.
3. Codex: `buildCodexQueuedInput` emits image-only `localImage` items; preserve
   PDFs in the note and surface persistence failures before dispatch.
4. CLI: update `turn-attachments.ts`, `codex-turn-runner.ts`, and
   `packages/codex/src/app-server-client.ts` input types and construction.
   Changing the helper alone is insufficient: the runner currently selects
   `textFallback` and the package constructs text-only input. Cover both normal
   turns and queued/steered turns with typed attachments.
5. Parity for the other four harnesses (D2).
6. Attachment bytes keep the existing `send_message.images` shape. Attachment
   sends now include a `requestId` for a small admission receipt: the host
   confirms readable saved files before executing the turn. The phone keeps
   the draft until that receipt and removes a refused optimistic bubble.
   Text-only sends remain fire-and-forget. Desktop restores attachment drafts
   on admission failure and merges later typing instead of overwriting it.
   The receipt confirms session admission after ownership and input validation,
   not provider completion. Missing, locked, disposed or removed-worktree
   sessions return an error before the phone consumes its draft.

Out of scope: attachment-directory cleanup. A future retention policy must
protect queued/active turns and define what resumed sessions do when referenced
files have expired; a blind age-based sweep is not sufficient.

### 6.4 Cost note

When the model would otherwise read the same image, inline delivery avoids a
tool request/result and the associated latency. Exact image-token and billing
costs depend on provider, model, resizing, and caching; do not use a fixed
per-image token ceiling or claim unconditional savings. Validate token usage
and time to first useful response with matched image fixtures.

---

## 7. Decision record

| # | Question | Recommendation |
|---|---|---|
| D1 | Inline PDFs? | **No.** Claude document blocks are billed per page as text + image; a long PDF can consume the whole context in one turn. Keep PDFs path-only so the agent reads the pages it needs. Revisit with a page-count guard if users ask. |
| D2 | Add paths to ACP / OpenCode / Cursor / dsh? | **Yes**, with provider/PDF support and execution-host path accessibility verified per adapter. |
| D3 | Do Phase C at all? | **At least C1 and C2.** Choose C3–C5 by ledger evidence; B2 icon caching requires C5 and conditional revalidation requires C4. |
| D4 | Transcript cache on disk size | 200 messages per session inside the existing 512 MB pool; raise only if the ledger shows `after` walks on reopen. |

---

## 8. Order and verification

1. **§6 attachments** first: desktop-main + shared + CLI + provider input
   adapters, with composer validation where required. Verify input shape and
   path accessibility for every changed harness, including CLI Codex, normal
   sends and steer/queued sends. Cover image-only, PDF-only, mixed attachments,
   invalid/oversized data, multiple images, GIFs, partial/all write failures,
   and retry without losing the draft. Manually verify Claude, Codex and one
   ACP agent describe an image without a Read row. Estimate after tracing all
   adapters; this is not assumed to be a one-day helper change.
2. **Phase 0** ledger, then **A + B1** client work. Targets: warm connect ≤ 8
   logical requests, session open = 1 when catalogs and git TTLs are warm,
   healthy foreground = 0–1 immediate probes with background revalidation
   counted separately. Confirm cached paint precedes network results. Test
   restart, Forget, stale in-flight responses, corruption/eviction, transcript
   trimming and paging. Run scoped mobile/relay-client tests and connection
   native-preview galleries; changed UI also needs colocated stories.
3. **C1 + C2**, then measured **C3–C5 + B2** as coordinated desktop/phone
   upgrades. Verify crypto golden fixtures on LAN and relay, frame chunking,
   malformed/oversized payloads, event ordering, reconnect/replay, and rejecting
   obsolete derived-cache formats. No old-client or mixed-version compatibility run.
   Compare actual wire bytes, event frames, CPU time and usable-screen latency
   on the same fixtures. C4 tests must cover empty deltas, reset/invalid anchors,
   forward pagination and concurrent live events. C5 tests must cover draft
   save races, locale changes, >50 pins, older history and permission-detail
   expansion failures. Run scoped tests for each changed subsystem.
