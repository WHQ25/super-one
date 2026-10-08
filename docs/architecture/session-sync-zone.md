# Session sync zone

A per-session artifact directory that exists on **both** the controlling
desktop and a remote node, with a fixed layout and a prefix-mapping rule, so
that files a Host Action produces on the desktop are readable by the node's
agent, and files the node's agent produces are readable by the desktop and the
phone. Every desktop-produced file owed to a node is tracked by one durable
**delivery record** (§8).

Sibling docs: [inline-files-previewer.md](../features/inline-files-previewer.md)
(first consumer), [remote-node-service.md](remote-node-service.md) (the node and
its Host Action channel).

---

## 1. Problem

A remote-node session runs its GUI tools on the desktop through the Host
Action channel (`apps/desktop/src/main/environment/host-action-executor.ts`).
Without the zone, the artifacts those tools write stay on the desktop and the
agent is handed a desktop path:

- `browser_screenshot` / `browser_snapshot` return a capture path,
  `computer_snapshot` returns `image.path`, the iOS / Android / mirror device
  backends write their own captures, recordings and `media_generate_*` /
  `@native/image-gallery` write files too.
- The node forwards the desktop reply verbatim
  (`apps/cli/src/session/host-action-mcp-core.ts#terminalToMcpContent`).
- Tool descriptions tell the agent to `Read` `image.path`
  (`packages/shared/src/environment/host-action-superone-descriptors.ts`). On
  the node, `Read` is the harness's own file tool over the node's filesystem,
  where that path does not exist.

A remote agent is then blind to its own screenshots — fatal for any
observe → act loop — and every downstream consumer (Markdown images, the files
previewer, the phone) has to guess which machine a path belongs to.

The reverse direction is the same: a node path the agent hands to a desktop
tool (`@native/image-gallery` `path`, a media reference image, a browser
upload) would be opened with `existsSync` / `readFileSync` on the desktop and
fail.

## 2. Decision

One directory per session, mirrored on both machines, same relative layout:

```
desktop:  <userData>/sync/<sessionId>/<producer>/<file>
node:     <nodeHome>/sync/<sessionId>/<producer>/<file>
```

- `<nodeHome>` is whatever the CLI resolves as its home (`resolveNodeHome`,
  honouring `SUPERONE_HOME`, `SUPERONE_NODE_HOME` and the alpha/dev suffixes;
  `apps/cli/src/config.ts`). Never a hard-coded `~/.superone`.
- `producer` ∈ `browser | computer-use | ios-simulator | android | ios-mirror`
  (`CaptureProducer`) plus `recording`, `media-gen`, `download`, and `agent`
  (files the agent writes there on purpose); `ArtifactProducer` in
  `apps/desktop/src/main/media-output-paths.ts`. Captures taken with no
  session (manual UI) go under the reserved `adhoc` session id.
- A zone session id is exactly one path component (`assertZoneSessionId`);
  anything that could climb is refused, not sanitised.
- **Local sessions use the same layout.** Without a node there is nothing to
  sync; the zone is where session artifacts live, and session deletion has a
  directory to remove. A local session's files have no delivery record (§8.5).
- Each side learns the other's root once, at connection time (§5.1). Paths
  are translated by **prefix replacement on path components** — no lookup
  table, no round trip. Each side canonicalises only its *own* root
  (`realpath`; macOS `/var` → `/private/var`); a foreign path is compared
  textually against the foreign root as reported, using the foreign OS's
  separator (`descriptor.platform.os`, case-insensitive root compare for
  Windows), never `path.resolve`d locally
  (`apps/desktop/src/main/environment/sync-zone-paths.ts`).
- Files inside the zone are **owned by the session**: the desktop, the node's
  agent, the desktop renderer and the phone all treat them as their own. The
  zone is for artifacts, not for the checkout; project files never enter it.

Why a zone and not "push everything to the node": the desktop already holds
the bytes it produced. Keeping its copy means the renderer and the phone never
fetch a screenshot back from the node, and the phone never needs a
desktop-proxies-node path at all.

`media-output-paths.ts` is the single owner of the layout: `syncZoneRoot`,
`sessionZoneDir`, `producerDir`, `zoneRelativePath`, `zoneArtifactRef`,
`isUnderSyncZone`.

## 3. Artifact references are registered, not discovered

The executor sees `{ content: [{ type: 'text', text: '<JSON or TOON>' }] }`,
not an object; TOON outlines and prose are not JSON, and a global prefix
replace would touch page text and code samples. So nothing parses a reply
looking for paths. Every artifact-producing tool **registers** what it wrote
(`apps/desktop/src/main/mcp/artifact-registry.ts`):

```ts
export interface ArtifactRef { path: string; producer: ArtifactProducer; final: boolean; deliveryId?: string }
export function registerArtifact(sessionId: string, ref: ArtifactRef): void
export function takeArtifacts(sessionId: string, callId: string): ArtifactRef[]
```

- Producers do not call `registerArtifact` directly. They call
  `publishArtifact` (`environment/zone-delivery.ts`), which seals or publishes
  the file in the delivery record (§8.4) and then registers the ref carrying
  its `deliveryId`. A refusal from the record is the producer's failure and is
  never registered as a final ref.
- A path handed out before the file is complete (a recording returned at
  `start`) is registered `final: false` and re-registered when sealed.
  Non-final refs are neither pushed nor rewritten.
- Refs are scoped to a **call**, not a session: two Host Actions of one
  session run concurrently, and one's screenshot must not be pushed for the
  other. The scope rides on `AsyncLocalStorage` (`collectArtifacts`). A
  callback that lost its async context is not guessed onto another call's
  scope; such a call site binds its listener with `bindArtifactScope`.
  Outside any scope registration is a no-op.

`executeSuperoneMcpToolCollecting` (`mcp/superone-mcp-tool-surface.ts`)
returns the refs and the delivery handles the call still holds (E090-4). The
executor hands both to `syncHostActionOutputs`
(`environment/host-action-sync.ts`), which:

1. Pushes only refs the reply **names**. A registered file whose path appears
   in no `content[].text` block is not pushed: the agent has no path to
   `Read`, and the desktop, renderer and phone read the desktop copy. (This is
   what keeps `computer_snapshot` from shipping both the full PNG and the
   `.agent.jpg` when the reply cites only the latter.) The mention check is
   asked per block, on the same text and through the same traversal the
   rewrite uses, so the two cannot disagree.
2. Rewrites each pushed (or deferred) desktop path to its node twin
   (`sync-zone-paths.ts#rewriteArtifactPaths`). JSON text is rewritten value
   by value and re-serialised; a decoded string value that *is* a path is
   compared whole and never searched (a space or colon is a legal file-name
   character); prose is scanned for whole tokens bounded by delimiters on both
   sides, including CJK punctuation and corner brackets. Longest path first,
   so `shot.png` cannot eat `shot.png.agent.jpg`.
3. The `.agent.jpg` sibling is a separate registered ref, not inferred from a
   suffix.

### 3.1 Inputs get the reverse mapping

Args arrive as structured JSON, so a walk is sound there. Before executing,
`mapHostActionInputs` maps every string arg under the node zone to its desktop
mirror path and mirrors it first (§4.2). This is what makes an
`@native/image-gallery` call with a node path, a media reference image or a
browser upload work; it is not a per-tool special case.

- **Session-scoped.** A path under another session's node zone is refused
  with `forbidden`.
- **Argument roles** (`host-action-sync.ts#argRoles`, keyed by the name the
  node publishes and, for `browser_network`, its `action`):
  - *outputs* (`browser_download.dir`, mini-app `projectDir` / `outputDir` /
    `directory` for setup) may name a path that does not exist yet;
  - *directory sources* (`miniapp_dev_register.directory`,
    `miniapp_dev_pack.appDir`, `miniapp_dev_update_types.appDir`) are mirrored
    whole with `mirrorNodeDirectory` (§4.2);
  - *deferred* containers (`browser_perf.action`, `browser_action`'s `input` /
    `steps` / `parameters`, and the internal names the compact dispatcher
    re-issues them under) are left as written and mapped where the inner tool
    runs (`mapNestedToolInputs`, found through `withInputMapping`'s
    `AsyncLocalStorage`) by the inner tool's own roles. A saved flow's
    definition is resolved on each run, never frozen at save.
  - Everything else is a *source* and must exist on the node.
- A path named under several arguments carries every role and must satisfy
  all of them.
- Outcomes: a node refusal or a failed fetch is `unavailable` and fails the
  call; `missing` fails the call unless every role is an output. Running a
  tool on whatever copy happens to be at the desktop path would be running it
  on the wrong bytes.
- Mapping twice is mapping once: a desktop path does not parse as a node zone
  path.

## 4. Direction of sync — by who needs the file first

| Direction | When | Why |
|---|---|---|
| desktop → node | **eagerly**, before the Host Action result is returned, inside the claim budget (§4.1); what does not fit is carried by the transfer worker (§8.6) | the agent will `Read` the path in its next step |
| node → desktop | **lazily**, on first desktop read of a node-zone path | the user looks at it later; the agent on the node must not wait for the desktop |

There is no daemon, no watcher and no bidirectional reconciliation.

### 4.1 desktop → node: the eager push and the claim budget

The node holds a Host Action claim for 60 s inside a 120 s action deadline
(`packages/runtime/src/session/host-action-store.ts`,
`DEFAULT_HOST_ACTION_CLAIM_TTL_MS` / `DEFAULT_HOST_ACTION_DEADLINE_MS`); past
the TTL a `safe` action is re-queued and an `unsafe` one cancelled. The desktop
executor caps a tool at 120 s of its own.

`syncHostActionOutputs` reads each named ref's delivery row and lets the
record say what there is to do:

| Row | Action | Reply |
|---|---|---|
| `abandoned` | nothing; the tool's own reply says what happened | path not rewritten |
| `done`, `uploaded`, `notifying` | nothing; the node has the bytes | rewritten |
| `committing`, holder alive | its executor is finishing the final put | rewritten, *deferred* |
| `committing`, holder dead | final put sent and lost (§8.5) | rewritten, *stopped* |
| `gave_up_at` set, earlier phase | automatic retry stopped before the final put | rewritten, *retry required* |
| any other phase, or `sealed` under another live holder | another holder or the worker is delivering it | rewritten, *deferred* |
| `sealed`, held by this call or by no live holder | **push it** | rewritten |

Refs are pushed smallest first, so a screenshot never waits behind a
recording. The push, for each file:

- Takes the row under the handle the call kept (E090-4), or claims an unheld
  one **before any await**.
- Budget = `claimExpiresAt − now − CLAIM_BUDGET_MARGIN_MS` (10 s). If the
  size estimate (per-connection measured throughput) does not fit and the node
  supports it, asks `session.renewHostActionClaim` (§5.3) for more — capped by
  the node at the action's deadline, so renewal buys time inside the window the
  agent already agreed to wait. If it still does not fit, the row goes
  `sealed → queued`, is released, and is reported deferred.
- Otherwise `sealed → uploading`, uploads through the `committing` gate
  (§8.2) to `uploaded`, then `notifying → done`: for an eager push the reply
  itself is the wake.
- Every wait is raced against the time actually left (`within`), never a plain
  await — a node RPC does not return because we stopped wanting it, and
  aborting a signal it never observes is not a deadline. A work that already
  settled is honoured even if the deadline fires in the same tick, so a
  confirmed commit is never reported as lost. `within` rejects an
  already-aborted signal immediately.
- A failed push does not fail the action: the tool already did its work. The
  row records the failure at the phase it reached (§8.2) and the worker
  resumes it; a failure inside `committing` is *stopped* instead (§8.5).

A cancelled action is deliberately **not** short-circuited before the sync:
the sync throws on the aborted signal, and its `finally` releases what the call
still holds to the worker. Returning early would strand those rows.

The node's MCP server forwards `content` and nothing else of the envelope, so
each list is also appended as a text block, worded so the agent can tell
*on its way — you will be notified* (deferred), *stopped — re-run the action*
(stopped), and *retries exhausted — Settings → Retry Upload* (retry required)
apart. `sync: { deferred, stopped?, retryRequired? }` rides on the envelope
too. The agent's `Read` of a deferred path fails with `ENOENT` until the
worker's completion wake (§5.3) arrives.

The hard ceiling is the action deadline: a minutes-long video is deferred.

### 4.2 node → desktop: the lazy mirror

All desktop readers of a session file go through one resolver in the main
process (`environment/session-file-resolver.ts#resolveSessionFile`):

```
remote root + path under the node zone    → desktop mirror (fetched / refreshed via artifact.*)
remote root + path under the desktop zone → that path (a desktop-produced file)
remote root + anything else               → node project file (workspace.readFile)
local root                                → the path itself
```

An out-of-project absolute node path resolves to `missing`, never spliced into
the project. A phone that needs real bytes of a node *project* file gets a
transient copy under the OS temp directory (`materializeRemoteProjectFile`),
not a zone file.

The mirror (`environment/session-file-mirror.ts#mirrorNodeArtifact`) is
**cache-through, validated by size + mtime** from `artifact.stat`, not by an
immutability promise — the built-in writers rewrite `.agent.jpg` /
`.preview.jpg` in place. Both transfer directions stamp the local copy with
the node's `mtimeMs`, so the two sides agree on one stamp; the stamp is
skipped if the local file changed during the upload. Capture filenames are
unique (millisecond + short random suffix, `device/capture-path.ts`), so the
check is a safety net. A fetch goes to a `.part.*` file and is renamed; a
download that sees the node file's size or mtime change mid-stream starts
over. Concurrent readers of one path share one fetch.

Rules, in order:

- **The node is authoritative for existence**, except over a desktop copy the
  delivery record protects (R4, §8.3): a protected-readable original is served
  as is; a protected-unreadable one (being written, mid-commit, or the record
  unreadable) is never served and never overwritten.
- A node **refusal** (`forbidden`, `invalid_argument`, `failed_precondition`)
  or a failed fetch is `unavailable`, not `missing` — `missing` reads as
  "deleted" and lets a caller fall through to a stale copy. Only an
  unreachable node falls back to the local copy, through the same
  `serveLocal` gate.
- `.owner` and `.parts` are reserved metadata on both sides; a path naming
  either is never fetched, listed or overwritten.

Every destructive step (a file/directory type reconciliation, a prune) runs
behind three guards: the target resolves inside this session's zone (checked
per member, and again after every await; a link is removed as a link and
never followed), it is not protected by the record, and the action has not
been cancelled. The last word before a fetch's `rename` is a synchronous
`beforeCommit` that re-checks all three. The record is read synchronously
(`better-sqlite3`), so nothing is awaited between deciding and acting.

**Directory mirror** (`mirrorNodeDirectory`), for tool arguments that read a
whole tree: `artifact.list`, then every member through the per-file mirror
(four at a time), then the mirror is pruned of anything the node did not list
and that actually failed to mirror — never a protected file or an in-flight
`.part.*`. One directory mirror per session at a time, fully drained before the
next. A truncated listing, an unreadable subtree, a member that cannot be
placed, a cancel, or a node without `artifact.list` fails the whole mirror;
so does a tree that still holds a protected-unreadable member.

**Readers carry `root`.** Media URLs for node-zone files are
`remote-media://<connectionId>/<path>`; `read_desktop_file` and
`read_video_poster` carry `root`; the phone's `previewFile` always carries
`root`, local sessions included. `readProjectFile` answers a zone media file
with the `local-file://` URL of its desktop mirror (range requests, no size
cap; `?` and `#` are encoded) instead of a data URI; node *project* media
still arrives as a data URI under the 10 MiB cap
(`environment/remote-file-tree.ts`).

## 5. Node side

### 5.1 Root exchange

`ExecutionEnvironmentDescriptor.syncRoot` (absolute, in the node's own
separator) and `EnvironmentCapabilities.syncZone`
(`packages/shared/src/environment/descriptor.ts`, `capabilities.ts`).
`syncZone` goes through both the capability intersect and normalise steps — an
interface field alone is not negotiated. An older node reports neither; the
desktop then does no rewrite and no mirror, and consumers report desktop
artifacts as `missing` in that session. No shim.

### 5.2 Artifact RPCs

`workspace.*` is project-scoped by construction and stays that way; the zone
is outside every project. Five RPCs under `artifact.*`
(`packages/shared/src/environment/artifact-rpc.ts`,
`apps/cli/src/rpc/artifact-handlers.ts`,
`apps/cli/src/workspace/artifact-zone.ts`), scoped to
`<syncRoot>/<sessionId>` with the workspace `path-security` helpers:

| RPC | Direction | Shape |
|---|---|---|
| `artifact.stat` | either | `{ sessionId, relativePath }` → `{ exists, size, mtimeMs }` |
| `artifact.put` | desktop → node | `{ sessionId, relativePath, transferId, offset, total, sha256, chunk: base64, final }` → `{ ok, bytesWritten, mtimeMs? }` |
| `artifact.get` | node → desktop | `{ sessionId, relativePath, offset, maxBytes }` → `{ chunk: base64, total, mtimeMs, eof }` |
| `artifact.list` | node → desktop | `{ sessionId, relativePath }` → `{ exists, entries[{ relativePath, size, mtimeMs }], truncated }` |
| `artifact.delete` | desktop → node | `{ sessionId, relativePath? }` → `{ ok }` — whole session dir when `relativePath` is absent |

Boundary:

- Every path is keyed on one canonicalised absolute path, from the first chunk
  to the rename. The session directory must be a real directory (a link there
  would reach another session's files); traversal, cross-session and symlink
  escapes fail closed; the nearest existing ancestor is checked for a
  not-yet-created target.
- `.parts` (staging) and `.owner` (reclaim marker) are refused through
  `resolve` on the resolved path, so no RPC can reach them; the staging
  directory is refused when it is a link.
- `artifact.list` walks with `lstat`, neither follows nor names links, skips
  reserved names, caps at `ARTIFACT_LIST_MAX_ENTRIES` (2000) and reports
  `truncated`. A subtree it cannot read fails as `unavailable` rather than
  returning an empty, complete-looking listing.
- Authorisation is the Host Action controller binding (`clientSessionId`
  equals the session's controller). `stat` / `get` / `list` need no lease;
  `put` / `delete` present the session lease.

`put` contract:

- `transferId` names one upload. Chunks arrive in order (`offset` equals bytes
  written, else `conflict` with `expectedOffset`); a repeated chunk at an
  already-written offset is acknowledged and dropped; a second transfer for a
  path already being written gets `busy`. A `transferId` reopened for a
  different path, `total` or `sha256` is `conflict`.
- Bytes land in `<session>/.parts/<transferId>`; on `final` the sha256 of the
  whole file is verified and the part renamed into place (an unconditional
  `renameSync`), so a reader never sees a half file. The final reply carries
  the committed `mtimeMs`.
- The node keeps a bounded map of completion receipts
  (`COMPLETED_RECEIPTS` = 512), so a final chunk re-sent after its reply was
  lost is acknowledged rather than taken for a new upload. The map is
  in-memory and bounded, and `stat` carries no hash — which is why a lost
  final reply cannot be verified from the desktop (§8.2).
- A transfer idle for 10 minutes is presumed lost and its path freed; a resume
  then meets `unknown transfer` and restarts from 0 under the same id.
- Chunks are at most `ARTIFACT_CHUNK_BYTES` (4 MiB); an empty file is one
  `final` chunk of zero bytes.
- `delete` tombstones the session directory until it returns, so a transfer
  landing after a delete does not recreate it. `session.remove` on the node
  deletes the session's zone directory itself
  (`packages/runtime/src/server/rpc-dispatch.ts`), since the controller binding is gone
  afterwards.

### 5.3 Session RPCs: claim renewal and the completion wake

- **`session.renewHostActionClaim({ actionId, claimToken, ttlMs })`** extends
  a live claim. The claim token proves the holder; an expired claim is never
  revived, even before it is swept; the new expiry is capped at the action's
  own deadline. A node that refuses or does not know the method leaves the
  desktop deferring as before (§4.1).
- **`session.notifyArtifactCompleted({ sessionId, notificationId,
  relativePaths })`** tells a node session that a deferred file landed. The
  worker sends it after the upload, with `notificationId` = the delivery id
  (§8.6). Controller-bound and lease-free, checked **before** any filesystem
  access (otherwise the answer probes another zone). The node stats each path
  itself, names only files it holds, JSON-quoted as the node resolved them,
  at most 32 per wake — the desktop cannot inject arbitrary text. The wake is
  delivered with `source: 'task-notification'`, the path a collaboration
  mailbox wake uses (Claude live-injects, Codex steers, other harnesses queue
  it). Injection is once per `(session, notificationId)`, recorded in the
  host-action store's `artifact_notifications` table (pruned after 30 days),
  so a node restart between injecting and the desktop's retry does not inject
  twice. This is a retry guarantee, not end-to-end delivery: a wake the node
  acknowledged and then lost before the harness consumed it is not re-sent.

### 5.4 Agent-facing

- `imageNote` / `recordingNote` stay as they are: "call Read on image.path"
  is true for pushed refs.
- `read_manual product/show-your-work` tells the agent that deliverables the
  user should open from any device go under the session's `agent/` directory,
  exposed as `SUPERONE_SESSION_DIR`.
- One wrapper, `withSessionZone` (`apps/cli/src/session/session-zone-runner.ts`),
  in front of the production turn runner injects `SUPERONE_SESSION_DIR` and
  the write grant. Session start, cold resume and forked children all reach
  the runner through `SessionRuntime.runTurn`, so it is the single place.
- **Write permission is not implied by the variable.** The grant is the
  `agent/` subdirectory only, never the whole zone, carried on
  `additionalDirectories` (Claude honours it directly; Codex maps it to
  `writableRoots`). The directory is created first, because some sandboxes
  drop a grant on a directory that does not exist yet.

## 6. What lives in the zone

| Producer | Written by |
|---|---|
| `browser`, `computer-use` | `persistBase64Screenshot` (original and `.agent.jpg`), `persistTextArtifact` (spilled browser text results) |
| `ios-simulator`, `android`, `ios-mirror` | device captures, in the driving session's zone: the simulator from its bound owner, Android and iOS mirror from `buildBackend(deviceId, sessionId)`; registered once by `DeviceAgentSession` |
| `recording` | action and device recordings (`createActionRecordingPath`, the `computer_act` recorder, simulator `captureFor`); registered on persist and on adopt |
| `media-gen` | `media_generate_image/video`, `@native/*-gallery` base64 input, their previews |
| `download` | `browser_download` and page-started downloads **of a remote session** |
| `agent` | the agent, per §5.4 |
| `attachment` | the full-size original of a chat image attachment **of a remote session**, staged at attach time (`attachment-originals.ts`) |

Attachment originals (`apps/desktop/src/main/attachment-originals.ts`):

- The renderer sends the agent a downscaled copy (at most 2000 px) inline,
  and only keeps an original when it downscaled. The note names the original
  for file-path tools.
- A remote session's original is written and sealed here when the image is
  attached, with origin `attachment`. A draft gets its node session first
  (`prepareMediaTarget`), because `artifact.put` needs one.
- The composer holds Send until the row has landed. `session.send` carries
  the desktop path, `EnvironmentHost.sendSessionMessage` maps it to the node
  path, and the node accepts only an existing file in that session's zone.
- On failure the chip offers Retry (`retryGivenUp`). A give-up at
  `committing` cannot be retried (E090-3), so the user removes the attachment
  and adds it again. Send stays held in every failed state.
- A local session's original stays outside the zone: the user's own file, or
  a pasted image in the turn attachments directory. A local draft has no
  session row yet, and the sweep reclaims a `local` zone without one.

Downloads (`agent/browser-download-store.ts`, `browser/browser-downloads.ts`):

- A remote session's download with no `dir` lands in its zone's `download/`.
  A `dir` outside the session zone is refused with a message naming
  `$SUPERONE_SESSION_DIR` — a node path the agent asked for has already been
  mapped to its desktop mirror (§3.1), so it arrives inside the zone. The
  default and an explicit `dir` go through the same containment check; a
  session directory that is itself a link disqualifies itself.
- Local sessions are unchanged: explicit dir → user setting → OS Downloads →
  temp fallback.
- A download the **page** starts is filed at `will-download`, which cannot
  ask who owns a tab (renderer state behind an async call) but can ask who
  last **drove** it (`browser/browser-tab-drivers.ts`). Every browser action
  records its driver at target resolution, before it runs (`select`,
  `evaluate` and `open` included); `browser_open` creates the tab blank,
  requires the driver (`requireTabDriver`, waiting out the attach gap), then
  navigates, so an initial-load download is attributed. Consequence: a person
  who downloads from a tab a remote agent drove finds the file in the session
  directory, not in Downloads.
- A tab nothing drove yet: `browser_list_downloads` adopts the captured file
  into the zone under an exclusive path (`adoptCapturedDownload`), remembered
  so a second listing reuses and re-registers the same copy.

Not in the zone: project files; a local session's downloads.

The pre-zone temp roots (`CAPTURE_ROOT`, `RECORDING_ROOT`,
`BROWSER_DOWNLOAD_FALLBACK_DIR`) and the old `<userData>/media-gen/outputs`
root stay readable, so older transcripts render.

## 7. Durability, ownership and reclaim

The zone is under `userData`, not `tmpdir()`: an artifact the user saw in a
transcript should still open a week later.

- `media-readable-roots.ts` includes `syncZoneRoot()` and keeps the legacy
  roots, or every absolute link in an existing transcript 403s.
- Drag-out needs only a real local file; mobile download signing signs the
  resolved real path, so mirroring completes before signing.

**Session deletion.** Both delete paths — local deletion in the session store,
remote deletion in `EnvironmentHost.removeSession` — reclaim through
`environment/session-zone-reclaim.ts#removeSessionZone`, which drops the
session's deliveries (tombstone + abandon, §8.5) and cancels uploads in flight
before removing the directory. The `session_cleanup` MCP tool is one caller of
that path. A forked session reading its parent's files keeps reading them
until the parent is deleted; then they are `missing`.

**Owner marker.** `.owner` in each session directory
(`environment/zone-owner.ts`) records who owns it: a connection id, or
`local`. It is written at every entry that creates a zone directory —
producers (`ensureArtifactDir`, owner from the call scope), downloads and the
simulator (`ensureZoneDir`, owner named explicitly), the mirror
(`MirrorDeps.connectionId`, before the first `.part`), and the first tool call
of a session. It only moves towards certainty: a node id is written as given,
`local` only over an unmarked directory, and no call scope (`undefined`)
writes nothing. The local MCP dispatchers open an explicit local call scope
(`runInLocalCallScope`, bound once per `McpServer` by `bindLocalCallScope`,
which wraps `registerTool` / `tool` / `setRequestHandler`; a pass-through
inside an existing Host Action scope), so a local session's zone is marked
`local`. The marker also names the destination for producers running outside
any call (§8.4).

**Reclaim sweep** (`reclaimSyncZone`), evidence-based, not quota-based. It runs
30 s after launch, on every node connection (debounced; a request during a run
gets one more run), and from Settings. It removes only what it can prove dead:

- a session directory whose owner says the session is gone — `local` checked
  against this database (unreadable counts as present), a connection id
  against that node, an unreachable node meaning **keep**;
- `adhoc` files older than 7 days (the directory itself stays).

It keeps a directory touched in the last hour, one with a live delivery not
given up, and an **unmarked** directory however old — it may belong to a live
remote session with no row here, and age would only be a TTL. Walks use
`lstat`; a link is removed as a link and never descended into; a top-level
entry that is not a real directory is skipped. After the await on the node,
mtime, marker and pending deliveries are re-read before deleting, which also
makes a manual sweep overlapping the scheduled one safe without a lock.

**No size cap, by decision.** A cap would have to delete artifacts a live
transcript names; the sweep already removes everything provably dead.
Settings → General → Storage (`SessionStorageSection`,
`packages/shared/src/environment/sync-zone-usage.ts`) shows the zone total,
session count, bytes still owed to a node (live content-owning rows not given
up), what a dry-run sweep would free, the retryable give-ups (**Retry Upload**)
and the `committing` give-ups (*needs re-delivery*, no button; E090-3), with
**Reclaim Now** and **Show in Folder**.

## 8. The delivery record

One fact — *"this file is the newest copy anywhere, and somebody owes it to
the node"* — has one durable representation with one identity: a row per
delivery of one version of one zone file. The eager push (§4.1), the mirror
(§4.2), the worker (§8.6), reclaim and Settings all read and write only this.

### 8.1 The record

`apps/desktop/src/main/db-session-deliveries-schema.ts` (DDL, shared by the
migration and the test fixture `src/test/fixtures/delivery-db.ts`),
`apps/desktop/src/main/db-session-deliveries.ts` (primitives):

```sql
CREATE TABLE session_file_deliveries (
  delivery_id     TEXT PRIMARY KEY,   -- the only identity anything names
  session_id      TEXT NOT NULL,
  connection_id   TEXT NOT NULL,      -- the node this session belongs to
  local_path      TEXT NOT NULL,      -- canonicalClaimPath spelling
  relative_path   TEXT NOT NULL,
  transfer_id     TEXT NOT NULL,      -- artifact.put resume identity; = delivery_id
  origin          TEXT NOT NULL,      -- 'download' | 'page-download' | 'produced'
  phase           TEXT NOT NULL,      -- §8.2
  outcome         TEXT,               -- NULL while live; 'done' | 'abandoned'
  holder          TEXT,               -- '<incarnation>:<token>' or NULL (§8.5)
  epoch           INTEGER NOT NULL DEFAULT 0,
  offset, total, sha256,              -- sha256 and total fixed at seal
  attempts, next_attempt_at, last_error,
  gave_up_at      TEXT,               -- automatic retry stopped; a person may act
  created_at, updated_at
);
-- idx_deliveries_path     (session_id, local_path)
-- idx_deliveries_runnable (connection_id, phase, next_attempt_at) WHERE outcome IS NULL
-- idx_deliveries_content_slot UNIQUE (session_id, local_path)
--   WHERE outcome IS NULL AND phase IN ('writing','sealed','queued','uploading','committing')
CREATE TABLE session_zone_tombstones (session_id TEXT PRIMARY KEY, dropped_at TEXT NOT NULL);
```

Rows are created before the first byte we control is written (§8.4) and kept,
with their outcome, until the session's zone is reclaimed — so "was this path
ever delivered, and as what?" is answered by lookup, never inference. No FK to
`sessions`: a remote session's row is the node's. A developer database may
still carry an older `artifact_transfer_jobs` table; nothing reads it.

### 8.2 The phase machine

```
writing → sealed → queued → uploading → committing → uploaded → notifying → [outcome = done]
   any phase ─────────────────────────────────────────────────────────────→ [outcome = abandoned]
```

- `writing`: reserved, being filled. `sealed`: complete; size and hash fixed.
  `queued`: the eager push left it for the worker. `uploading`: bytes going
  out, final chunk not yet sent. `committing`: final chunk sent or about to
  be. `uploaded`: node confirmed the rename. `notifying`: only the wake is
  owed.
- **Phase is monotonic.** `advanceDelivery` refuses a backwards step as a
  programming error. **A failure never moves `phase`**: it sets `last_error`,
  `next_attempt_at`, `attempts`, or `gave_up_at`, and releases the holder
  (`recordDeliveryFailure`). The next attempt resumes from the phase actually
  reached; a delivered file can never be rewritten back to "upload again".
- **`committing` is written before the final `artifact.put` is sent** (the
  `beforeFinal` hook, idempotent across an offset resync), and left only when
  the reply confirms the rename. A gate that cannot be written sends nothing.
  It is the one phase whose truth on the node is unknowable from the desktop
  if the reply is lost: the node's receipts are a bounded in-memory map,
  `artifact.stat` carries no hash, and the commit is an unconditional rename
  (§5.2). Before `committing` the node has at most a `.parts` fragment; after
  it the node has the file. **A lost reply in `committing` cannot be verified,
  so there is no automatic retry** — even for a clean rejection of a
  single-chunk file, since the desktop cannot tell the two apart. Such a row
  gives up (`last_error = 'commit unverified'`) and `retryGivenUpDeliveries`
  excludes it.

### 8.3 Identity rules

#### R1 — one content owner per path

Enforced by `idx_deliveries_content_slot`, a partial unique index over the
phases that still own the bytes locally. A second writer for a path is a
constraint violation. Rows at `uploaded` and later leave the slot.

#### R2 — write once per session; a new version gets a new path

A reservation of a path that has **any** row — live, done or abandoned — is
refused `path-taken`, and the producer picks another name (downloads uniquify
on the `wx` collision; captures and generations use unique names). In-place
replacement would need a generation or conditional-commit protocol on the
node, which commits with a bare rename and reports `busy` by path; an
`AbortSignal` cannot retract a put already sent. No `superseded` state exists.

#### R3 — every event names a `delivery_id`

`advanceDelivery(handle, step)`, `abandonDelivery(handle)`, and the rest take a
handle `{ deliveryId, holder, epoch }`. A worker finishing delivery *T* has no
way to touch delivery *U*: it does not have *U*'s id, and nothing looks a live
row up by path except the producer's reservation (R2) and the mirror (R4).
One delivery's completion releasing another's protection is unrepresentable.

**R3a — producers carry the handle; observation reuses it.** Reservation
returns the id, the `ArtifactRef` carries it, the reply-selection receives it.
A later observation of the same file (a re-listing, a status boundary naming
it again, a mirror read) finds the row by `(session_id, local_path)` and
reuses it — never a second row, never a reset.

#### R4 — the mirror asks one table and reads the whole answer

`classifyDeliveryAt` / `classifyDeliveriesUnder`, one query, `outcome` read
before `phase`, strongest answer wins:

| Row at or under the path | `DeliveryProtection` | Mirror |
|---|---|---|
| table unreadable | `unavailable` | prune nothing, overwrite nothing, serve nothing (R5) |
| `outcome = abandoned` | `none` | not protected, whatever its phase |
| `outcome = done` | `node-authoritative` | node authoritative |
| `writing` | `protected-unreadable` | kept, never served |
| `sealed` / `queued` / `uploading` | `protected-readable` | kept and served — the newest copy anywhere |
| `committing` | `protected-unreadable` | kept, never served — neither copy is authoritative |
| `uploaded` / `notifying` | `node-authoritative` | fetch and overwrite |
| no row | `none` | ordinary mirror behaviour |

For a directory, `node-authoritative` is reported as `none`: a subtree of
delivered files has nothing to keep.

#### R5 — unreadable table means protected

A failed *read* of the record is `unavailable` and protects everything; it is
never collapsed into "nothing pending". Unwritable does not mean unreadable: a
failed *write* is handled by the phase it interrupted (§8.2). A desktop that
cannot write its database does not start a transfer — the reservation throws
and the producer fails — so nothing is promised to the agent on the strength
of a record that does not exist.

#### R6 — a sealed source is immutable

From `sealed` on, the producer never touches the file; the mirror may
overwrite it only where R4 says so. `total` and `sha256` are accepted on the
step into `sealed` and on no other, and every upload presents them as the
file's identity, so a source that changed under a retry is refused by the node
rather than stitched. With R2 there is no second writer.

#### R7 — every advance is a CAS on (id, phase, epoch)

Every owned write matches `delivery_id = ? AND holder = ? AND epoch = ? AND
outcome IS NULL` (plus `phase = ?` for an advance); every takeover
(`claimDelivery`) matches `(delivery_id, holder, epoch)` and is refused while
the old holder is alive. Both bump `epoch`, so a holder that lost the row
cannot act with the epoch it remembers. An advance keeps its holder; ownership
changes only in `claimDelivery`. Offset progress does not bump the epoch but
still requires the handle.

### 8.4 Producers, by how they write

The rule follows the write mode, because what matters is whether there is an
`await` between a file's first byte and its row
(`apps/desktop/src/main/environment/zone-delivery.ts`):

| Mode | Entries | Rule |
|---|---|---|
| **Reserved before the first byte** | `reserveDownloadPath` (both `browser_download` and a page download's `will-download`, before `item.setSavePath`), `createActionRecordingPath` (the `computer_act` recorder and the buffer persists that share it), the simulator's `captureFor` | `reserveZoneFile` inside the path factory, in the same synchronous sequence as the `wx` create, so the path never leaves without a `writing` row. `sealZoneFile` when the writer says the bytes are in; `abandonZoneFile` on every writer failure exit. |
| **Published complete in one synchronous sequence** | `persistBase64Screenshot`, `persistTextArtifact`, media-gen `persistFiles` and previews, the Android and mirror backends (`publishZoneFileAt`, `writeFileSync`) | `sealZoneFile` with `bytes` in the same tick as the write: a row created directly at `sealed`, hashed from the buffer the producer still holds. |
| **Observation at a later boundary** | `registerCapture` in the device executor, `media_video_status` re-registering a generated file, the recorder's registration when `service.act` returns, a re-listing | `publishArtifact` finds the row by path and reuses its id (R3a). |

- **A name is free only when both the filesystem and the record say so.** The
  `wx` create picks the name atomically on disk; the record must then accept
  it as never written in this session (R2). A vacancy on disk is not a free
  name — a delivered file the node since deleted leaves exactly that — so on
  `path-taken` the factory removes its empty stub and tries the next name.
- **Seal, publish and observe are told apart, not guessed.** A seal whose
  CAS fails is refused `reservation-lost`; a publish (`bytes` given) onto a
  path with any row is `path-taken`; an observation returns a row only if it
  is a delivery happening or done — never a `writing` row, never an abandoned
  one.
- **Destination comes from explicit context** (`zoneDestination`): an
  explicit connection (a page download's tab driver, the simulator's owner
  recorded at bind), else the call scope, else the zone's `.owner` marker. A
  zone file with no known destination is refused `unknown-destination` — a
  guessed `local` would be unprotected and undelivered. `session-dropped`,
  `path-taken`, `reservation-lost` and `unknown-destination` are all strict
  refusals: the producer fails.
- **Every writer exit closes its reservation.** A page download is sealed by
  the `DownloadItem`'s own `done` and then wakes the worker; a completion that
  cannot be sealed is reported `interrupted`. A backgrounded
  `browser_download` seals in its body writer and wakes the worker from the
  task's settle (`wakeDownloadDelivery`). A recording reservation is abandoned
  by every consumer failure (`abandonActionRecording`). A recording already
  in the session's zone is adopted in place (`adoptActionRecording`), not
  copied, so it keeps its one delivery. Nothing times out on its own: an open
  reservation with a live holder is a writer still working.
- **Local and adhoc sessions take no row.** `zoneDestination` returns `local`
  first for an empty or `adhoc` session id and for a local call, so
  `reserveZoneFile` / `sealZoneFile` return null before the database is
  touched. Nothing mirrors a local session. `connection_id` stays `NOT NULL`.

### 8.5 Holders and recovery

**Liveness is not `epoch`** (`environment/delivery-holders.ts`). `epoch` is a
concurrency version; a long download sits in `writing` with an unchanged
epoch. A holder is `'<incarnation>:<token>'`, where the incarnation is minted
once per process start. A holder is **alive** iff it is in the process-local
set of holders currently being worked: added by `mintHolder`, removed by
`retireHolder` at the attempt's real end (success, failure, handover or
abandon, in a `finally`) — **not** by a phase advance, since
`uploading → committing` is followed by an awaited final put the holder is
still working through. The set is liveness, like the worker's abort map; state
lives only in the row. No heartbeat, no idle timeout: within one process
liveness is exact, and after a restart every holder of another incarnation is
dead by definition.

**Any live row with a dead or absent holder can be taken over**, in every
phase, by `claimDelivery` (CAS on holder and epoch, R7). Takeover, abandon,
failure and session drop all invalidate the previous holder the same way.

What a worker pass does with a row it takes over:

| Found | Means | Action |
|---|---|---|
| `writing`, dead holder | producer crashed or reserved and never wrote | `abandoned`. **Never sent**: nothing records how far it got, and a half file is worse than none. The file stays, unprotected (R4). |
| `sealed` / `queued` | complete source waiting | → `uploading`, upload |
| `uploading`, dead holder | final put **not yet sent** | resume from `offset`. The node answers `expectedOffset`, or `unknown transfer` after its idle expiry and the upload restarts from 0 under the same `transfer_id` — safe because the source is immutable (R6) and never committed. |
| `committing`, dead holder | final put sent, reply lost | **cannot be verified** (§8.2): `gave_up_at = now`, `last_error = 'commit unverified'`, no automatic put ever. Settings shows *needs re-delivery*; the reply says *stopped* (E090-3). |
| `uploaded` / `notifying` | only the wake is owed | → `notifying` → wake → `done`. There is no path back to `uploading`. |
| `gave_up_at` set | automatic retry stopped | not listed; Settings' Retry Upload clears it (never for `committing`) and the row re-enters this table |

**Re-delivery of a `committing` row is manual and unlinked.** Re-running the
action that produced the file writes a new file under a new path and a new
`delivery_id`; it does not close or associate the old row, which stays until
reclaim, and it cannot restore an output that no longer exists (an ended
recording). Automatic recovery would need the node to expose a hash on `stat`
or accept a conditional final chunk — a node contract change.

**Session close.** `dropSessionDeliveries` is one transaction: insert the
tombstone, set `outcome = 'abandoned'` on every live row, return their ids so
the worker aborts uploads in flight. Callers: `removeSessionZone` (both delete
paths, §7) and the reclaim sweep for every directory it removed.
`reserveDelivery` checks the tombstone and `path-taken` in the same
transaction as its insert, so a late producer is refused `session-dropped`.

### 8.6 The transfer worker

`environment/artifact-transfer-service.ts#ArtifactTransferService`: one worker
per live remote connection, started next to the Host Action consumer and
stopped with it (`environment/environment-host.ts`).

- Each pass lists the connection's live, due, not-given-up rows
  (`listLiveDeliveries`), skips rows whose holder is alive, claims the rest
  under a fresh holder, and continues each from its phase (§8.5). Uploads go
  through the same `committing` gate as the eager push and feed the
  per-connection throughput meter the push budgets with.
- After the bytes land, `session.notifyArtifactCompleted` (§5.3) wakes the
  agent with `notificationId` = `delivery_id`, then `completeDelivery`. An
  `attachment` row completes without the wake: its message has not been sent,
  and will name the file itself. A node
  answering `not_found`, `forbidden`, `failed_precondition`,
  `unimplemented` or `method_not_found` ends the delivery (`abandoned`);
  anything else retries, because the agent was told the path would work.
- Failures back off exponentially (5 s base, 10 min cap). Upload attempts stop
  after 8, or at once when the local file is missing; a row whose bytes are on
  the node never gives up and never fails for want of a local copy.
- `wake(connectionId)` rescans now; `retryGivenUp` re-queues give-ups (not
  `committing`) and wakes every worker; `dropSession` is §8.5's session close.

### 8.7 Invariants

Each is covered by a regression test on the real SQLite fixture or the
Electron event boundary, and code comments cite them by label.

#### E090-1 — a DB fault on one row does not end the pass or the worker

`runDelivery` retires its holder and leaves the row untouched when the claim
write throws; `runOnce` wraps each row, so a fault deeper in the pass is the
same; a failure to even record a failure is logged, never rethrown; and
`start()` drops a registration whose loop ended for any reason, so no
registration outlives a dead worker.

#### E090-2 — a confirmed upload whose wake write fails stays retryable

Once the final put answered, the bytes are on the node. A later failure
(`notifying` or `done` cannot be written, the wake fails) leaves the row at
`uploaded`/`notifying`, retryable — never `committing`, never "commit
unverified". Both paths clear their `committing` flag at `uploaded`; the eager
push reports such a file *deferred*, not *stopped*. Likewise the upload does
not re-check the abort signal after a final put that answered.

#### E090-3 — a stopped file stays stopped, in Settings and in the reply

Three reply categories, classified by phase and holder liveness (§4.1):

- `committing` with a **live** holder: its executor is finishing the final put
  and will complete and wake the agent — *deferred*.
- `committing` with a **dead** holder: sent and lost, nothing will retry it —
  *stopped* (re-run the action), and still *stopped* when observed again.
- given up in an **earlier** phase: never a sent-but-unconfirmed put, and the
  worker skips given-up rows — *retry required* (Settings → Retry Upload),
  without waking a worker that would skip it.

Settings separates *needs re-delivery* (`committing`, no button) from
retryable give-ups (`failedHandoffs`, Retry Upload).

#### E090-4 — owner lifecycle: held handles survive scope end

A file a producer seals **inside** a call stays held by that call's live
holder (`holdSealedDelivery` into the scope's `heldDeliveries`) all the way to
the reply-selection, so a worker woken mid-call — or in the gap between the
scope's `finally` and `syncHostActionOutputs` — cannot deliver a file the agent
may never be told about. Scope end only sets `scope.ended`; held handles are
**not** released there. The executor drains them (`takeHeldDeliveries`) and
threads them into `syncHostActionOutputs(held)`, which pushes a mentioned file
under the same handle, abandons an unmentioned one by that handle, and
releases the rest to the worker in its `finally` (an abort part way leaves the
unreached files sealed and unheld). A thrown tool abandons its held rows
(`abandonHeldDeliveries`); a call with no selection releases them. After
`scope.ended`, `holdSealedDelivery` returns false, so a detached background
download that seals later is released for the worker at once.

Two properties the lifecycle depends on:

- the `finally` covers the **whole** function, from before the first DB read,
  and every retirement is itself in a `finally` — a throw in `getDelivery` or
  in an `abandon` still retires every handle the call took;
- **a call may abandon only a delivery it holds a handle for.** A ref with no
  held handle is an observation of someone else's delivery (a page or
  background download the worker has not carried yet is sealed and unheld
  too) and is skipped, never abandoned. There is no id-only abandon.

#### E090-5 — a wake that lands mid-pass triggers an immediate re-scan

A row sealed after a pass took its snapshot has `next_attempt_at NULL`, which
the next-due sleep ignores. The `woken` flag makes the loop `continue` instead
of sleeping, so the row is delivered now rather than after the 10-minute cap.

#### E090-6 — a refused `will-download` reservation cancels the item

Returning without a save path would hand the item to Electron's default flow
(a save dialog, or an untracked file a remote agent can never reach). A
refused reservation instead `item.cancel()`s, sets no save path, and records
an `interrupted` capture so `waitForDownloads` resolves rather than hanging.

#### FE99-1 — a seal that throws frees its holder

Both seal paths in `sealZoneFile` wrap "acquire or create holder → seal → hand
off" in `try/finally`: unless the row was handed to the call scope, the holder
is retired even if hashing, `advanceDelivery` or `reserveDelivery` threw.
Otherwise a live holder would be stranded on a `writing`/`sealed` row the
worker skips forever, and the mirror would refuse the file until restart. The
row keeps the phase it reached; a dead holder is what lets the worker take it
over.

## 9. Limits

- **No in-place replacement** of a delivered path (R2), and **no automatic
  recovery** of a `committing` row (§8.5); both need node contract changes.
- **Action deadline.** Renewal cannot extend past the 120 s action deadline; a
  file that does not fit is deferred to the worker.
- **Directories as tool inputs** are limited to what `artifact.list` returns in
  one listing (2000 entries).
- **Guards are proven by construction, not by racing.** The mirror's
  protection, cancel and boundary checks are placed so nothing is awaited
  between the decision and the act (synchronous prune, synchronous
  `beforeCommit`); tests drive each interleaving deterministically. A future
  `await` inside one of those stretches reopens the hole without failing a
  test — add the check after it. Placement also does not prove the check asks
  about the right files: a change to what the zone protects needs its own
  reasoning against R4.
- **Multiple controllers.** The zone is keyed by session and the node root is
  per node; a second desktop mirrors lazily like any reader. Untested.
- **Windows nodes.** Separator handling and the case-insensitive root compare
  are unit-tested (`sync-zone-paths.test.ts`); no Windows node has been tested
  end to end.
