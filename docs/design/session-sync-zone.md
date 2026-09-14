# Session sync zone

Status: **implemented (phases 1–4)** — designed 2026-09-13, revised the same
day after a Codex design review, built 2026-09-14. Deviations from the design
as written are listed in §8.
Scope: a per-session artifact directory that exists on **both** the controlling
desktop and a remote node, with a fixed layout and a prefix-mapping rule, so
that files a Host Action produces on the desktop are readable by the node's
agent, and files the node's agent produces are readable by the desktop and the
phone. Sibling docs: `inline-files-previewer.md` (first consumer),
`remote-node-service.md`, memory `project_remote_node_mcp_delegation`
(Host Action channel; this document is its "step 7 — artifact contract").

---

## 1. Problem

A remote-node session runs its GUI tools on the desktop through the Host
Action channel (`apps/desktop/src/main/environment/host-action-executor.ts`).
The artifacts those tools write stay on the desktop, and the agent gets a
desktop path:

- `browser_screenshot` persists the capture under
  `BROWSER_SCREENSHOT_DIR` = `tmpdir()/super-one-captures/browser` and returns
  `textReply({ path, width, height, imageNote })`
  (`apps/desktop/src/main/mcp/browser-mcp-tools.ts:848`; the compact
  `browser_snapshot` in `browser-mcp-compact.ts:331` returns
  `screenshot.path` when asked for one). `computer_snapshot` returns
  `image.path`; iOS / Android captures write their own files
  (`apps/desktop/src/main/ios-simulator/capture.ts:51`,
  `device-agent/android-backend.ts:182`, `mirror-backend.ts:132`);
  recordings use `RECORDING_ROOT`; `media_generate_*` and
  `@native/image-gallery` write under `mediaGenOutputRoot()/<sessionId>`.
- The node forwards the desktop reply verbatim
  (`terminalToMcpContent`, `apps/cli/src/session/host-action-mcp-core.ts:76`).
- The `computer_snapshot` description tells the agent to "call Read on
  image.path if you need to look at pixels"
  (`packages/shared/src/environment/host-action-superone-descriptors.ts:1987`).
  On the node, `Read` is the harness's own file tool over the node's
  filesystem. The path does not exist there. No Host Action reads a desktop
  file, and no reply carries an `image` content block (`imageReply` has zero
  callers in `apps/desktop/src/main`).

So a remote agent is blind to its own screenshots — fatal for any
observe → act loop — and every downstream consumer (Markdown images, the
files previewer, the phone) has to guess which machine a path belongs to.

The reverse direction is just as broken: a node path the agent hands back to
a desktop tool (`@native/image-gallery` `path`, a media reference image, a
browser upload) is opened with `existsSync` / `readFileSync` on the desktop
(`generative-ui/native-widget-payload.ts:111-115`, `mcp/media-tools.ts:86-87`,
`mcp/browser-mcp-tools.ts:1369-1371`) and fails.

## 2. Decision

One directory per session, mirrored on both machines, same relative layout:

```
desktop:  <userData>/sync/<sessionId>/<producer>/<file>
node:     <nodeHome>/sync/<sessionId>/<producer>/<file>
```

- `<nodeHome>` is whatever the CLI already resolves as its home
  (`resolveNodeHome` / `superone-home.ts:15-24`, honouring `SUPERONE_HOME`,
  `SUPERONE_NODE_HOME` and alpha/dev suffixes, `apps/cli/src/config.ts:6-20`).
  Never a hard-coded `~/.superone`.
- `producer` ∈ `browser | computer-use | ios-simulator | android | ios-mirror`
  (`CaptureProducer` today) plus `recording`, `media-gen`, `download`, and
  `agent` (files the agent writes there on purpose). Captures taken with no
  session (manual UI) go under a reserved `adhoc` session id.
- **Local sessions use the same layout.** Without a node there is nothing to
  sync; the zone is just where session artifacts live, and session deletion
  has a directory to remove.
- Each side learns the other's root once, at connection time (§5.1). Paths
  are translated by **prefix replacement on path components** — no lookup
  table, no round trip. Each side canonicalises only its *own* root
  (`realpath`; macOS `/var` → `/private/var`); a foreign path is compared
  textually against the foreign root as reported, using the foreign OS's
  separator (`descriptor.platform.os`), never `path.resolve`d locally.
- Files inside the zone are **owned by the session**: the desktop, the node's
  agent, the desktop renderer and the phone all treat them as their own
  files. Ownership of a project file does not change; the zone is for
  artifacts, not for the checkout.

Why a zone and not "push everything to the node": the desktop already holds
the bytes it produced. Keeping its copy means the renderer and the phone never
fetch a screenshot back from the node, and the phone never needs a
desktop-proxies-node path at all.

## 3. Artifact references are registered, not discovered

The first draft rewrote every string in the tool result that looked like a
zone path. That cannot work: the executor sees
`{ content: [{ type: 'text', text: '<serialised JSON or TOON>' }] }`
(`browser-mcp-replies.ts:9-14`), not the object; TOON outlines and prose
notifications are not JSON; and a global prefix replace would touch page text
and code samples.

Instead, every artifact-producing tool **registers** what it wrote:

```ts
// apps/desktop/src/main/mcp/artifact-registry.ts
export interface ArtifactRef { path: string; producer: Producer; final: boolean }
export function registerArtifact(sessionId: string, ref: ArtifactRef): void
export function takeArtifacts(sessionId: string, callId: string): ArtifactRef[]
```

`persistBase64Screenshot`, the recording finaliser, the media-gen writers,
the download store and the device capture writers call `registerArtifact` at
the moment the file is complete (`final: true`). A path handed out before
the file is complete — iOS recording returns its path at `start` and seals it
at `stop` (`ios-simulator-manager.ts:804-830`) — is registered `final:
false` and re-registered when sealed.

`executeSuperoneMcpTool` collects the refs registered during the call and
returns them next to the reply. The executor then:

1. Uploads each `final` ref to the node zone at the same relative path (§5).
2. Replaces **exact occurrences** of each registered desktop path inside
   every `content[].text` with its node twin. Exact string match only; a
   capture path is a long timestamped string that never appears in page text
   by accident. No parsing, no prefix scan, works for JSON and TOON alike.
3. The `.agent.jpg` sibling (`screenshot-artifact.ts:163-179`) is a separate
   registered ref, not inferred from a suffix.

Non-final refs are neither uploaded nor rewritten; the agent gets the
desktop path and the tool's own "not finished" wording, same as today.

### 3.1 Inputs get the reverse mapping

Args arrive as structured JSON (`ClaimHostActionResult.args`), so a walk is
sound there. Before executing, the executor maps every string arg under the
node zone root to the desktop mirror path, fetching it first if the mirror
does not have it yet (§4.2). This is what makes an `@native/image-gallery`
call with a node path, a media reference image or a browser upload work; it
is not a per-tool special case.

## 4. Direction of sync — by who needs the file first

| Direction | When | Why |
|---|---|---|
| desktop → node | **eagerly**, before the Host Action result is returned, within the claim budget (§4.1) | the agent will `Read` the path in its next step |
| node → desktop | **lazily**, on first desktop read of a node-zone path that is not mirrored yet | the user looks at it later; the agent on the node must not wait for the desktop |

There is no daemon, no watcher, no bidirectional reconciliation. Each
direction has exactly one trigger.

### 4.1 desktop → node, and the claim budget

The node holds a claim for **60 s** and the action deadline is **120 s**
(`packages/runtime/src/session/host-action-store.ts:24-25`); past the TTL a
`safe` action is re-queued and an `unsafe` one cancelled (`:795-833`). The
desktop executor races its own 120 s cap (`host-action-executor.ts:49`), and
the consumer aborts without responding when it sees a terminal state
(`remote-host-action-consumer.ts:181-191, 269`). A tool that ran 45 s
followed by a 20 s upload would lose the claim with the file half sent.

Rule: the upload gets `claimExpiresAt - now - 10 s` of budget. Refs that fit
(by size against measured throughput of the connection; captures and
generated images always do) are uploaded synchronously and the path is
rewritten. Refs that do not fit are handed to a **transfer job** (§5.3), the
path is still rewritten, and the reply gains a sibling field
`sync: { deferred: [<nodePath>…] }`. The agent's `Read` in the deferred
window fails with ENOENT — honest, and it tells the agent exactly one thing:
wait or ask the user to view it. There is **no completion notification to
the agent in v1**: the desktop has no channel to notify a node session
(download completion looks up the local `SessionManager`,
`apps/desktop/src/main/index.ts:5300-5307`, which has no node entry). A
notification is a follow-up once such a channel exists; until then, recordings
are evidence for the user (rendered from the desktop copy) rather than input
for the agent, which matches how they are used.

Every `await` in the executor path checks the abort signal afterwards; a
transfer job survives the action (it is keyed by `connectionId`, like the
consumer itself), but a cancelled action does not start one.

A claim-renewal RPC (`session.renewHostActionClaim`) would let large refs
finish synchronously. Not in v1 — the deferred path covers it and renewal
changes the store's cancel semantics.

### 4.2 node → desktop

All desktop readers of a session file go through one resolver in the main
process:

```
resolveSessionFile(root, path):
  if root is a remote key and path under nodeZoneRoot(connectionId):
      local = desktopZoneRoot + suffix
      if exists(local) and stat matches artifact.stat(size, mtimeMs) → local
      else artifact.get → write local (.part, rename) → local
  else if path under desktopZoneRoot → path
  else → project file: existing local / readRemoteProjectFile path
```

The desktop copy is a **cache-through mirror** validated by size + mtime from
`artifact.stat`, not by an immutability promise — the built-in writers
already break that promise (per-second capture filenames collide on
consecutive shots, `device/capture-path.ts:11-17`; `.agent.jpg` /
`.preview.jpg` are rewritten deterministically,
`screenshot-artifact.ts:105-106`, `media-gen/image-preview.ts:87-88`; a
video job can re-persist the same `generationId`,
`media-gen/video/history.ts:98-122`). Phase 1 also makes capture filenames
unique (millisecond + short random suffix) so the mirror check is a
safety net, not the primary mechanism.

The resolver needs `root`, not a bare path. Today `readProjectFile` has a
root (`index.ts:3235`) but the media server, the miniapp protocol and the
renderer's URL helpers only carry a path (`media-server.ts:25-27`,
`miniapp-protocol.ts:37-39`, `lib/path-utils.ts:3,29`), and
`lib/remote-media-url.ts:80-84` downgrades an out-of-project node path to a
local URL, losing the connection. The phone's file commands land in
`authorizeRemoteFile` (`agent/agent-service.ts:1995`) which also drops
context, and the poster path at `:2017` passes only a path. Phase 4 threads
`root` through all of them: media URLs become opaque
`remote-media://<connectionId>/<path>` for node-zone files (the scheme
exists; it just needs to accept the zone), and `read_desktop_file` /
`read_video_poster` carry `root` alongside `path`. Bare-path callers keep
working for local files.

## 5. Node side

### 5.1 Root exchange

`ExecutionEnvironmentDescriptor` (`packages/shared/src/environment/descriptor.ts`)
gains `syncRoot?: string` (absolute path on the node, in the node's own
separator) and `EnvironmentCapabilities` gains `syncZone: boolean`. The
desktop reads both from `environment.descriptor` at connect. `syncZone` is
added to the capability intersect and normalise steps
(`capabilities.ts:79`, `:107`) — an interface field alone is not negotiated.
An older node reports neither; the desktop then keeps today's behaviour (no
rewrite, no mirror), and consumers report desktop artifacts as `missing` in
that session.

### 5.2 RPCs

`workspace.writeFile` / `readFile` are project-scoped by construction
(`apps/cli/src/workspace/fs-service.ts:167-173`, `resolveProjectPath`) and
must stay that way — the zone is outside every project. No existing
desktop↔node transfer is reusable: `exportRemoteEntryToLocal` is one whole
read (`remote-file-tree.ts:572`), `workspace.watch*` carries change events
and bounded tails only, `fileTransfer` is `false` on nodes
(`capabilities.ts:66`), and the mobile relay download path decrypts a whole
envelope keyed to a pairing (`packages/relay-client/src/downloads.ts:130-165`).
Four new RPCs under `artifact.*`, scoped by the node to
`<syncRoot>/<sessionId>` with the existing `path-security.ts` helpers
(`sessionId` itself validated as a single component; traversal, cross-session
and symlink escape rejected; the nearest existing ancestor checked for a
not-yet-created target):

| RPC | Direction | Shape |
|---|---|---|
| `artifact.stat` | either | `{ sessionId, relativePath }` → `{ exists, size, mtimeMs }` |
| `artifact.put` | desktop → node | `{ sessionId, relativePath, transferId, offset, total, sha256, chunk: base64, final }` → `{ ok, bytesWritten }` |
| `artifact.get` | node → desktop | `{ sessionId, relativePath, offset, maxBytes }` → `{ chunk: base64, total, mtimeMs, eof }` |
| `artifact.delete` | desktop → node | `{ sessionId, relativePath? }` → `{ ok }` — whole session dir when `relativePath` is absent |

Transfer contract for `put`:

- `transferId` names one upload; chunks for one id must arrive in order
  (`offset` equals bytes written so far, else `conflict`); a repeated chunk
  at an already-written offset is acknowledged and ignored (idempotent
  retry); two concurrent ids for the same `relativePath` → the second gets
  `busy`.
- Data goes to `<file>.part.<transferId>`; on `final`, `sha256` is verified
  over the whole file and the part is renamed into place. A reader never
  sees a half file, and a crashed upload leaves a part file the next `put`
  for that path removes.
- Chunk size 4 MiB (existing `MAX_READ_BYTES` = 10 MiB, `fs-service.ts:62`,
  is a per-call cap, not a file-size cap; `fs-service.ts:137-155` already
  supports `offset/limit` bounded reads, whose helpers `get` reuses). Empty
  files are a single `final` chunk of zero bytes.
- `delete` writes a tombstone for the session dir until the RPC returns, so
  a transfer job completing after a delete does not recreate it.
- Authorisation: the same controller binding as Host Actions
  (`clientSessionId`), no lease required for `stat`/`get`, lease required
  for `put`/`delete`.

### 5.3 Transfer jobs

A desktop-side table keyed by `connectionId`, persisted in the desktop DB:
`{ jobId, connectionId, sessionId, localPath, relativePath, transferId,
offset, total, state }`. A job resumes from `offset` after disconnect or
desktop restart, retries with backoff, and is dropped when its session is
deleted. Throughput measured per connection feeds the §4.1 budget.

### 5.4 Agent-facing

- `imageNote` / `recordingNote` reminders stay as they are: "call Read on
  image.path" becomes true for eagerly-synced refs.
- `read_manual product/show-your-work` gains one paragraph: deliverables the
  user should be able to open from any device go under the session's
  `agent/` directory; the node exposes it to the agent as
  `SUPERONE_SESSION_DIR`, injected on session start, cold resume and into
  child sessions.
- **Write permission is not implied by the variable.** Each harness's
  sandbox / writable-roots policy (Codex: `packages/codex/src/sandbox-policy.ts:10-24`
  = cwd + `additionalDirectories`) gains the session's `agent/` directory —
  that subdirectory only, never the whole zone.

## 6. What lives in the zone

| Producer | Written by | Today |
|---|---|---|
| `browser`, `computer-use`, `ios-simulator`, `android`, `ios-mirror` | capture tools; `persistBase64Screenshot` for browser / computer-use, direct writes for the device backends | `super-one-captures/<producer>` (root fixed at backend construction) |
| `recording` | screen / device recordings | `RECORDING_ROOT` |
| `media-gen` | `media_generate_image/video`, `@native/*-gallery` base64 input | `mediaGenOutputRoot()/<sessionId>` (already per-session) |
| `download` | `browser_download` without `dir` **in a remote session** | today: explicit dir → user setting → OS Downloads → tmp fallback (`browser-download-store.ts:56-77`); local sessions keep that order |
| `agent` | the agent, per §5.4 | — |

Not in the zone: project files; `browser_download` with an explicit `dir`
(the agent asked for a specific place; a remote agent passing a node path
there gets a desktop write to that path today — a separate Host Action wart,
out of scope); local-session downloads that the user configured to land in
their Downloads folder.

`media-output-paths.ts` becomes the single place that knows the layout:
`syncZoneRoot()`, `sessionZoneDir(sessionId)`, `producerDir(sessionId,
producer)`, `isUnderSyncZone(path)`. The device backends receive the session
id at capture time instead of a root at construction.

## 7. Durability and readers

The zone is under `userData`, not `tmpdir()`: today's captures are explicitly
non-durable (`media-output-paths.ts:10`). That changes — an artifact the user
saw in a transcript should still open a week later. Consequences that must
land together:

- `media-readable-roots.ts:18-29` adds `syncZoneRoot()` and **keeps** the
  legacy capture / media-gen roots readable, or every absolute link in an
  existing transcript 403s.
- Drag-out needs only a real local file (`start-drag.ts:20`); mobile
  download signing signs the resolved real path
  (`remote-control-service.ts:152-157`), so mirroring must complete before
  signing.
- Reclaim is by session deletion only for v1, and the hook is the session
  delete path itself — local deletion in the session store, remote deletion
  in `EnvironmentHost.removeSession` (`:2004-2016`) — not the
  `session_cleanup` MCP tool, which is one caller of that path with its own
  confirm dialog. Deleting a session with an in-flight transfer job cancels
  the job first. A forked session that references its parent's files keeps
  reading them until the parent is deleted; then they are `missing`.
  `adhoc` is never auto-deleted.

## 8. Phases

All four landed on 2026-09-14, one commit each.

1. **Registry + zone for Host Action outputs** — implemented.
   `mcp/artifact-registry.ts` (AsyncLocalStorage-scoped per tool call, so two
   concurrent Host Actions of one session never take each other's refs),
   `media-output-paths.ts` owning `syncZoneRoot` / `sessionZoneDir` /
   `producerDir` / `zoneRelativePath` / `isUnderSyncZone`, `registerArtifact`
   in `persistBase64Screenshot` (browser + computer-use, the `.agent.jpg`
   sibling as its own ref), the media-gen writers and previews, unique capture
   filenames, readable roots updated. Local-only, no protocol change.
2. **Descriptor + RPCs** — implemented. `syncRoot` / `syncZone` negotiated
   through intersect *and* normalise; `apps/cli/src/workspace/artifact-zone.ts`
   + `rpc/artifact-handlers.ts` serve the §5.2 contract; tests cover traversal,
   cross-session, symlink escape, part atomicity, resume-from-offset,
   concurrent put, delete tombstone and the empty file.
3. **Eager push, rewrite, input mapping** — implemented.
   `environment/host-action-sync.ts` (§3, §3.1, §4.1),
   `artifact-transfer.ts` + `artifact-transfer-service.ts` + the
   `artifact_transfer_jobs` table (`SCHEMA_VERSION` 6),
   `session/session-zone-runner.ts` for `SUPERONE_SESSION_DIR` and the write
   grant, and the §5.4 paragraph in `product/show-your-work`.
4. **Lazy mirror + resource identity** — implemented.
   `session-file-mirror.ts` + `session-file-resolver.ts`, `readProjectFile`
   routed through it, media URLs keeping the connection for out-of-project
   node paths, `root` on `read_desktop_file` / `read_video_poster`, and
   `session-zone-reclaim.ts` on both delete paths.

### Deviations from the design as written

- **A code review by Codex on 2026-09-14 found and fixed twelve defects in
  the phases above** before they shipped: the node keyed its write-lock and
  authorisation on the relative path spelling and the realpath'd session
  directory (so `agent/./a` aliased `agent/a`, and a symlinked session dir
  escaped the zone) — both now key on one canonicalised absolute path and the
  session dir must be a real directory; `.part` files shared the artifact
  namespace and a re-sent final chunk could roll a file back — staging moved to
  a reserved `<session>/.parts/` and completed transfers keep a bounded receipt;
  a dropped eager push left the node holding a half-written transfer that a new
  job's fresh id met with `busy` — the job now inherits the eager `transferId`
  and idle transfers expire; the deferred list lived only on the reply
  envelope the node's MCP server drops — it is now a `content` block too; the
  worker's backoff query fed `Date` a value it cannot represent and silently
  fell back to the 10-minute cap; `dropSession` could not stop a job already
  taken into a pass — the job re-checks its row before uploading; a download
  stitched two versions of a file that changed mid-stream — it now restarts on
  a size/mtime change; the mirror served a node-deleted file from a stale local
  copy and swallowed a `forbidden` as offline — the node is authoritative for
  existence unless an upload is pending; the reply rewrite matched path
  substrings (so `shot.png` hit `shot.png.bak`) and could break JSON on a
  Windows twin — it now matches whole tokens, longest-first, and rewrites JSON
  values structurally; the artifact registry guessed a context-less
  registration onto "the latest open scope" and misfiled it under a concurrent
  call — it no longer guesses (a call site that needs it binds with
  `bindArtifactScope`); an out-of-project absolute node path was spliced into
  the project (`/etc/hosts` → `<project>/etc/hosts`) — it now resolves to
  `missing`; the previewer's Retry re-stat'd a remote file locally and the
  card's fallback chip and the phone's error state dropped `root` — all three
  now carry it; and `media_video_status` returning an already-generated file
  from the record did not re-register it — it does now, so a second poll's
  paths are pushed and rewritten. Each has a scenario-named regression test.


- **A second review of those five follow-up commits found sixteen more, all
  fixed before this branch was handed back.** Four could lose or expose data.
  Reclaim walked the zone with `stat`, so a symlink dropped into it was
  followed and *its target's* old files were deleted — every walk is `lstat`
  now, a link is removed as the link it is and never descended into, and a
  top-level entry that is not a real directory is skipped. The node's reserved
  `.parts` check compared the requested *spelling*, so `agent/../.parts/x`
  walked around it and `mkdir -p` through a linked `.parts` wrote outside the
  zone — the check now runs on the resolved absolute path and the staging
  directory itself is refused when it is a link. A tool call for one session
  could name another session's node zone path and be handed that session's
  mirror — input mapping is session-scoped and refuses a foreign zone with
  `forbidden`. And the sweep read "no ownership marker" as proof of death,
  deleting directories of sessions this database still names, then deleted
  after an `await` without looking again — the local database now gets the
  first word, and mtime, marker and pending transfers are all re-read after
  the await.

  The rest, in the same commit: the completion notification stat'd one
  spelling and reported another (and could carry newlines into the wake text)
  — it names the path the resolver returned, JSON-quoted, capped at 32; it
  checked the controller *after* the stat, which made it an existence probe
  across the binding — the check comes first; and it recorded delivery before
  the send, so a failed wake was never retried, while keying only on the
  notification id let one session's success answer another's — it records
  after the send, keyed on session and id. `renewClaim` could revive a claim
  that had expired but not yet been swept. The upload budget aborted a signal
  the RPC never observed, so the sync step waited for the node anyway — the
  upload is now *raced* against the budget and the hash stream is cancellable,
  because a signal is a notification and only a race is a deadline. The path
  rewrite still missed a path nested two JSON levels deep, and the separate
  mention check that decides whether to push at all disagreed with it — both
  questions now go through the one traversal, so they cannot drift again.
  `uploadArtifact` stamped the node's mtime onto a local file that had changed
  under it, which would make the mirror agree about two different files
  forever. The node appended to an in-flight `transferId` whose `total` /
  `sha256` had changed. A mirror fetch that failed reported `missing`, which
  reads as "deleted" — there is an `unavailable` outcome now, and mapped
  inputs refuse it instead of handing the tool a stale copy.
  `browser_download`'s `dir` accepted another session's zone and a directory
  linked out of it, and fell back to this machine's Downloads folder when the
  zone could not be created — a path the node's agent can never open.
  `read_desktop_file` read a whole remote file into memory before checking the
  10 MiB cap. Computer-use recordings were never registered, a page-triggered
  download never entered the zone, and a foreground download was queued twice
  — once eagerly and once by the background finalizer.

- **A third review found seven more.** Two were blockers. Reclaim still
  deleted an *unmarked* directory once this database did not name the session
  — but a live remote session has no row here and no marker either if it never
  ran a Host Action, so the sweep was deleting on a timer while claiming to
  delete on proof. An unmarked directory is now simply kept; age is a TTL, and
  this sweep does not have one. And `adoptCapturedDownload` joined the
  captured file's basename onto the zone directory, so a page download of
  `report.csv` overwrote a `download/report.csv` an earlier turn had already
  named — it reserves an exclusive path now and remembers the adoption, so a
  second `browser_list_downloads` returns the first copy instead of making
  another.

  The rest: a node *refusal* (`forbidden`, `invalid_argument`) was still
  reported as `missing`, and `missing` was allowed for every mapped argument —
  so a source file the node would not hand over still reached the tool as a
  stale desktop copy. `missing` is now refused for every argument except the
  ones a tool declares as destinations (`HOST_ACTION_OUTPUT_ARGS`), and a
  refusal is `unavailable`. `browser_download`'s *default* directory skipped
  the containment check the explicit one got, and a session directory that was
  itself a link moved the boundary to wherever it pointed — both paths now go
  through one check, and a linked session directory disqualifies itself. The
  mention check ran on every content block joined together while the rewrite
  ran per block, so a reply of one JSON block plus one prose block parsed as
  neither and its ref was never pushed — mention is asked per block, on the
  same text the rewrite will see. The path token still had no *left* boundary,
  so `/tmp/a.png` "occurred" inside `/other/tmp/a.png`. And the claim renewal
  — the RPC that exists to protect the claim — was itself awaited without a
  deadline; every wait in `host-action-sync.ts` now goes through one `within`
  helper that races the work against the time actually left.

- **A fourth review found five more, none blocking.** One path named twice in
  a call — as a destination and as a source — kept only the first role, so
  argument order decided whether a stale desktop copy reached the tool; a ref
  now carries every argument it appeared under and has to satisfy all of them.
  The path-token boundary was still a list of "path characters", which is
  always one script short: `a.png副本` and `a.png\child` both matched (the
  backslash had not even survived the string→regex escaping) — the boundary
  is now the set of delimiters that *can* surround a path, and a decoded
  value that is exactly the path is compared, not searched. The destination
  allowlist was keyed on `browser_download`, but the node publishes
  `browser_network` and the split happens after mapping — roles are keyed on
  the public name and its `action` now, and the mini-app tools' `projectDir`
  (where the dev pointer is written) counts as a destination. An adoption
  cache hit returned the copy without registering it, so the *second*
  `browser_list_downloads` handed the agent the desktop path again. And a
  directory argument under the zone (`miniapp_dev_register.directory`,
  `pack.appDir`, `update_types.appDir`) was reported `not_found` whether or
  not it existed, because `artifact.stat` only knows files — it is refused
  as `unsupported` with a message that says so, and §9 records the limit.
  Also from that review's notes: a transfer job that had failed for good was
  read as "still queued" and pinned its dead directory forever; the startup
  sweep now ignores terminal rows and drops them with the directory.

- **A fifth review found three more, none blocking, and settled the path
  rewrite's contract.** A decoded JSON string value that *is* a path is now
  compared whole and never searched — `/tmp/a.png copy.png` and
  `/other:/tmp/a.png` are other files, and a space or a colon is a legal
  file-name character — while a value that is prose is scanned for a token
  bounded by delimiters, which now include Chinese punctuation and corner
  brackets (`已保存到 <path>。` used to be judged unmentioned and the file
  was never pushed). Top-level text blocks are prose. And the argument roles
  were only applied at the outer boundary, so a download wrapped in
  `browser_perf` or expanded from a saved `browser_action` had its `dir`
  refused as a missing source: the wrapper's container argument is now
  `deferred` — left exactly as written — and every route to a browser tool
  (`runPrimitive`, `executeBrowserTool`) maps the inner call by the inner
  tool's own roles, finding the Host Action's mapping through
  `AsyncLocalStorage`. Mapping twice is mapping once, because a desktop path
  does not parse as a node zone path. A sixth review found that this was not
  yet true end to end: the compact dispatcher re-issues each wrapper under an
  internal name (`browser_perf_measure`, `browser_action_save` / `_do`) and
  the second mapping pass judged there what the first had deferred; and a
  saved flow's `parameters[].default` was mirrored at save time and stored as
  a desktop path, freezing a source file at the version the save happened to
  see. The internal names now defer the same arguments as their public
  wrappers, and `parameters` is definition data like `steps` — resolved on
  each run, never at save. The wiring test that had passed on a stale mock
  reading now clears the mock per entry and covers a real saved flow's save
  and run.

- **An eighth review, of the §9 follow-up work below, found fourteen more and
  all are fixed.** The directory mirror (`mirrorNodeDirectory`) carried most of
  them: its prune walked only the mirror root's children, so a root symlink out
  of the zone had the *target's* files deleted — the zone-boundary check is now
  shared with the download store (`sync-zone-paths.ts` `withinSessionZone`) and
  refuses a root or ancestor that resolves outside; prune deleted any desktop
  file the node had not listed, including a fresh capture still queued for
  upload, and now keeps a pending original; the keep-set was built from the
  listing rather than from members that actually mirrored, so a file the node
  dropped between list and fetch survived; two overlapping mirrors could
  interleave and let a stale listing prune a newer generation, so directory
  mirrors now serialise per session; a file/directory type swap on the node
  (`foo` file ↔ `foo/bar`) threw `EEXIST`/`EISDIR` forever and is now
  reconciled before the fetch; a cancel during listing still ran the prune, so
  the signal is checked after the list and before the prune; and the owner
  marker was written only *after* a download finished, so a crash mid-first-
  mirror left an unmarked directory the sweep keeps forever — it is written
  before any `.part` is opened. The node's `artifact.list` swallowed a
  `readdir`/`lstat` failure and returned an empty *complete* listing, which the
  desktop would prune its mirror to; it now fails such a subtree as
  `unavailable`, and lists the requested path as spelled (every component
  `lstat`-checked) so an in-zone directory symlink is refused rather than
  listed as its target. Ownership marking read "no call scope" as `local`,
  which is a deletion warrant against a remote session's zone: the panel's
  screenshot of a simulator a remote session holds rewrote `node-1` to `local`.
  A missing scope now marks nothing, a node marker is never taken back to
  `local`, and the simulator manager records the binding session's owner at
  `bind` and marks the capture directory itself. The tab-driver was recorded
  only on the plain resolve, so a CDP click (via `resolvePoint`) or a synthetic
  action on a tab handed from session A to B filed B's page-started download
  under A; the driver is now recorded at every action's target resolution and
  before the action runs. The dedupe stat that skips re-uploading a file the
  node already holds awaited with no deadline; it is now bounded by the same
  claim budget as every other wait. The Settings "waiting to upload" figure
  counted `uploaded`/`notifying` rows (bytes already on the node) and double-
  counted retries; it now sums only `pending`/`running` jobs, deduplicated by
  resolved path. And a `local-file://` URL left `?` unencoded, so a zone file
  named `report?draft.png` resolved to `report` — `?` now joins `#` as an
  encoded path terminator.

- **A ninth review, of those fixes, found nine more — combination scenarios
  the single-case fixes left open. All nine were fixed as filed; a tenth
  review then reopened four of them at narrower windows (below), so read
  this paragraph as "the case as reported", not "the guard is now total".**
  The pattern: a
  guard that held at the mirror root, or only in the prune, did not hold at
  every file operation. The boundary check is now enforced per member (an
  in-zone ancestor symlink pointing *out* of the zone had the root check pass
  and the fetch then overwrite the link's target); the pending-original and
  cancel checks now cover the destructive *type reconciliation* too, not just
  the prune — reconciling a `foo` file over a desktop `foo/` directory used to
  delete an original still queued for upload, and a cancel arriving during the
  member stat let the reconcile delete before the fetch threw. The prune is now
  fully synchronous over a pending set snapshotted before the walk, so nothing
  is `await`ed between deciding to delete and deleting, and it takes the signal
  so a cancel between the last fetch and the prune stops it. A failed batch no
  longer releases its per-session generation early: workers record their
  failure and return rather than throwing, the batch is cancelled as one, and
  every worker is awaited — a fetch a failed mirror abandoned used to outlive
  it and write into the tree a later mirror produced. `.owner` is now reserved
  metadata on *both* sides: the node refuses it through `resolve` (so
  `stat`/`get`/`put` cannot reach it, not only `list`), and the mirror refuses
  any path naming it — with the marker written before the first `.part`, a
  mirror of `.owner` itself would have moved a live directory's ownership to
  `local` and handed it to the sweep. The tab driver is recorded by `select`,
  `evaluate` and `open` as well (a select's change handler and an evaluate can
  both start a download; a new tab is attributed as soon as it exists). And the
  local MCP dispatchers — the stdio bridge and the in-process DeepSeek backend —
  now open an explicit local call scope (`runInLocalCallScope`): after "no scope
  means unknown owner", a local producer marked nothing at all, which left a
  local session's zone unmarked and therefore kept by the sweep forever. A UI
  call with no identity is still unknown and still marks nothing. Finally the
  Host Action dedupe stat checks cancellation unconditionally before acting on
  its answer, and `within` rejects an already-aborted signal instead of waiting
  out a budget for an abort event that has already fired.

- **A tenth review closed four of the nine and found five more, each the
  same guard failing inside a window narrower than the one it was fixed
  for.** Three were time-of-check/time-of-use: the prune walked a pending set
  captured *before* the fetches, so a file whose upload was queued while the
  batch ran was deleted as unknown — `PendingSource.snapshot()` is now taken
  synchronously at the moment of each destructive step rather than once per
  mirror; the boundary check ran after the local `stat`, and the post-`await`
  `local` returns (cache hit, offline fallback) did not re-check it at all, so
  a symlink swapped mid-mirror was served from outside the zone; and a cancel
  arriving after the pending source resolved was not seen until the first
  fetch, so the batch started work the caller had already abandoned. The
  fourth: a fetch that decided to overwrite could still `renameSync` over an
  original queued for upload in the milliseconds between the last check and
  the commit — `downloadArtifact` now takes a `beforeCommit` hook and the
  mirror re-checks pending, cancellation and the boundary *synchronously*
  between `close` and `rename`, which is the only point with no await left.
  The fifth was scope coverage, not timing: `runInLocalCallScope` had been
  wired into two dispatchers by hand, which misses the Claude SDK's in-process
  server, the HTTP transport and anything registered dynamically (a mini-app's
  tools). It is now bound once per `McpServer` instance
  (`bindLocalCallScope`), wrapping `registerTool`/`tool` so every handler runs
  inside the scope; inside an existing Host Action scope it is a pass-through,
  so a remote session's call is never refiled as local.

- **An eleventh review found the guards placed correctly and guarding the
  wrong set.** Round ten proved no `await` sits between a check and the act it
  guards. It did not prove the check asks about the right files, and three of
  the four findings here are that second question.

  The job table is the durable record of "the node is owed these bytes", but a
  job exists only once a file is finished *and* enqueued. `browser_download`
  reserves its path and streams into it; for the whole transfer, plus the gap
  between sealing and enqueueing, the file is real, is the only copy, and is
  invisible to the table — so a directory mirror pruned a download while it was
  being written. `active-writes.ts` covers exactly that gap: an in-process,
  synchronous registry (the gap is in-process, and the guards cannot `await`),
  claimed at the reservation and released only once the eager push has landed
  or a job row exists. It has two stages, because a file being *written* is
  incomplete — protected, but refused as a tool input rather than handed over
  half-finished — while a file that is *sealed and not yet enqueued* is
  complete and is served exactly like a pending upload.

  The mirrored mistake: `state !== 'done'` counted `uploaded` and `notifying`
  as "the node still owes us". Those states mean the bytes are already there
  and the row is waiting on the completion wake, so the desktop copy is *not*
  authoritative — the agent may have changed the file on the node since, and
  round ten's "serve the pending local copy" branch then handed back the
  version it replaced. The predicate now names the states it means
  (`pending`, `running`, `failed`) instead of excluding the one it does not.

  `bindLocalCallScope` was also still incomplete. Wrapping the registrars
  misses a call that never reaches a registered callback: the compact browser
  surface installs its own `tools/call` handler so an unlisted legacy
  `browser_*` alias from an old transcript still runs, and that branch calls
  the union executor directly. The binder now also wraps `setRequestHandler` —
  not the handler it finds there, which the fallback would simply replace.

  And the new-tab fix below was best-effort where it had to be a precondition:
  a cold-started view is registered before its `webContents` exists, so the
  first resolve can fail with "not attached yet" and the next succeed.
  `noteTabDriver` swallowed that and `open` navigated anyway, leaving the tab
  unattributed for its initial load. `requireTabDriver` waits out the attach
  gap and *reports*; `browser_open` refuses to navigate without it and names
  the blank tab it left behind so the caller can retry or close it.

- **A twelfth review found the registry right and its handoffs wrong: a
  claim now names its holder.** The first version let anyone release anything,
  and every caller that could plausibly be "the end" released in a `finally`.
  That is wrong in both directions at once, and both were real:

  - A Host Action that returned while a download it started was still
    streaming — the tool went background on its deadline — released a claim
    whose writer was still running, reopening the exact window the registry
    exists to close.
  - A `defer` that failed released anyway, so the only complete copy of a file
    became prunable with no job row naming it anywhere. The optional-chained
    "no transfer service at all" branch counted as a successful handoff too.

  So a claim records its `holder`, and only that holder can end it. Taking
  responsibility is an explicit `adoptWriteClaim`, which refuses a file still
  being written (there is nothing to take yet) and refuses one another holder
  already took (two handoffs cannot race to free one file). "This path
  appeared in the reply" is not ownership. The writer's own give-up path is
  `abandonWriteClaim`, refused once someone has adopted.

  Two smaller consequences of the same shape. The executor adopts *before* its
  cancellation check, because that check returns early and a sealed claim
  abandoned by an early return has no holder left to hand it on — it would pin
  its path for the life of the process. And `queueDownloadUpload` retries a
  transient `defer` failure and, when it finally gives up, keeps the claim and
  logs an error: pinning a path is the lesser failure, losing the only
  complete copy is the greater one.

  The fourth finding was a read, not a release. `writing` gated the online
  branches but not the offline fallback, and not the whole-directory answer —
  so an unreachable node served half a file, and a tree with a half-written
  member was handed to `miniapp_dev_pack` as a complete input. Every `local`
  answer now goes through one `serveLocal` that refuses both out-of-zone and
  incomplete, and a directory answer is `unavailable` while
  `activeWriteUnder` reports `writing`. Keeping a file through the prune and
  calling the tree complete are different questions; only the first had been
  answered.

  `download-claim-lifecycle.integration.test.ts` is where "a claim is released
  exactly once, by whoever took responsibility" stops being an argument: real
  `downloadUrl`, real reservation, real collecting tool surface, real
  executor, over the four endings — finishes inside the call, still streaming
  when the tool replies, cancelled as the tool completes, and the queue
  refusing it.

- **A thirteenth review found the foreground handoff still releasing on
  failure, and the fix is a table both paths share.** The background give-up
  had been taught to keep its claim; the *foreground* one had not.
  `syncHostActionOutputs` either pushes a file inside the claim budget or files
  a job for it, and when that `defer` threw, the executor's `finally` released
  the claim anyway — the file then had no node copy, no job row and no
  protection at once, and the next directory mirror pruned it.

  `pending-handoffs.ts` is where both paths now land. Two properties are
  load-bearing, and each came from getting it wrong first:

  - **The entry carries the claim's holder.** Recovery does not re-adopt:
    `adoptWriteClaim` only accepts a claim still held by `writer`, so a second
    adopt of a file the queue already took returns false and the release
    silently does nothing. Whoever recorded the failure stays responsible.
  - **The original `transferId` is kept.** A retry that invents a new id makes
    the node meet a second transfer for one file instead of resuming the
    partial it already holds.

  Recovery runs when a connection's transfer worker starts, and from a
  **Retry Upload** button in Settings → Storage. `dropSession` clears a deleted
  session's entries and the claims they were protecting.

  Worth being precise about what fails here, because the first guess was
  wrong: `defer` is purely local — `statSync`, a SQLite insert, a worker wake —
  so it fails for local reasons. A node that is merely unreachable never
  reaches this table; that is what the worker's backoff over persisted jobs is
  for.

  One unrelated leak surfaced on the way: the executor's deadline timer was
  cleared only when the *outer* signal aborted, so a Host Action that simply
  succeeded left a live timer for the rest of the timeout — holding the event
  loop open and eventually firing an abort on a controller nobody was
  listening to. It is cleared in the `finally` now.

- **`browser_open` creates the tab blank, records the driver, then
  navigates.** Opening with the URL in one call meant the page could start a
  direct download before the tab had an owner, and `will-download` had nobody
  to attribute it to. The two-step is why `open` now issues `open` with
  `readiness: 'none'` and a separate `navigate`; the reply is merged so the
  caller still sees one result with the final URL and title.

- **Only refs the reply names are pushed** (§3). A registered artifact whose
  path never appears in `content[].text` is not uploaded: the agent has no
  path to `Read`, and the desktop, the renderer and the phone all read the
  desktop copy. This is what keeps `computer_snapshot` from shipping both the
  full PNG and the `.agent.jpg` when the reply cites only the latter.
- **Smallest ref first** (§4.1), so a screenshot never waits behind a
  recording for the claim budget.
- **A failed eager push becomes a transfer job** rather than failing the
  action (§4.1). The tool already did its work; the reply still carries
  `sync.deferred`, so the agent's `ENOENT` stays honest.
- **`artifact.put` returns `mtimeMs` on the final chunk**, and both transfer
  directions stamp the local copy with it. The design had the mirror compare
  size + mtime (§4.2) without saying how the two sides come to agree on one.
- **`session.remove` on the node deletes the session's zone directory**, so a
  session removed from the node side does not leave artifacts behind even if
  the desktop never calls `artifact.delete`.
- **`SUPERONE_SESSION_DIR` is injected by one wrapper**
  (`withSessionZone`) in front of the production turn runner rather than per
  harness. Session start, cold resume and forked children all reach the runner
  through `SessionRuntime.runTurn`, so that is the single place; the `agent/`
  grant rides on `additionalDirectories`, which Claude honours directly and
  Codex maps to `writableRoots` (§5.4's requirement, one seam instead of two).
- **Spilled browser text results moved into the zone too** (not in §6's
  table). `persistTextArtifact` hands the agent a path the same way a
  screenshot does, so a remote agent could not read it either.
- **Device captures, recordings and downloads did not migrate** — as phase 1
  reserved. They still write under the temp roots, which stay readable; each
  is "pass sessionId, call `registerArtifact`" when its batch comes.
- **`media-gen` output moved** from `<userData>/media-gen/outputs/<sessionId>`
  to the zone. The legacy root stays readable so existing transcripts render.
- **The phone's `previewFile` always carries `root`**, local sessions
  included, rather than only remote ones — one shape for the command instead
  of two.
- **`authorizeRemoteFile`'s new resolution glue has no test at the
  agent-service layer.** It is thin delegation over `resolveSessionFile`,
  `mirrorNodeArtifact` and `materializeRemoteProjectFile`, which are each
  unit-tested; the agent-service suite's mock graph does not cover the
  dynamic imports it uses, and building that scaffolding was judged more
  fragile than the forwarding it would guard.

## 9. Out of scope / open

Still open after phases 1–4 (2026-09-14: five of the seven items below were
closed on the same day, in the commits following the Codex review; each is
marked and the residue is stated):

- ~~**Completion notification to the agent** for deferred transfers~~ —
  **implemented 2026-09-14.** `session.notifyArtifactCompleted` is a
  controller-bound, lease-free node RPC: the desktop names the session and the
  zone-relative paths, the node stats each one itself, builds the wording, and
  delivers it through `sendWithoutLease({ source: 'task-notification' })` —
  the same path a collaboration mailbox wake uses, so Claude live-injects,
  Codex steers and every other harness FIFO-queues it. The desktop cannot send
  arbitrary text through it, and a path the node does not hold is never named.
  A transfer job now survives its own upload in state `uploaded`/`notifying`
  and is only deleted once the node confirms the wake, so a lost reply retries
  the notification without re-uploading; `notificationId` is the job id, and
  the node injects once per id. A node that answers `not_found` / `forbidden`
  (session gone) or does not know the method ends the job.
  Since 2026-09-14 the node's "already injected this one" record is a row in
  the host-action store (`artifact_notifications`, pruned after 30 days),
  so a restart between the injection and the desktop's next retry no longer
  injects the wake twice; the integration test restarts the node runtime on
  the same home and retries. The desktop's transfer job is what makes the
  desktop *retry* an unacknowledged wake; what happens after the node
  acknowledges one and then dies before the harness consumes it has not been
  tested, so this remains a retry guarantee and not an end-to-end delivery
  guarantee.
- ~~**Claim renewal** as an alternative to deferral~~ — **implemented
  2026-09-14.** `session.renewHostActionClaim({ actionId, claimToken, ttlMs })`
  extends a live claim; the holder proves itself with the claim token, and the
  node caps the new expiry at the action's own deadline, so renewal buys time
  inside the window the agent already agreed to wait — it does not extend that
  window. `syncHostActionOutputs` asks before deferring a file that does not
  fit, and each upload runs under its own abort bound to the remaining budget
  — raced against it, not merely signalled, because aborting does not make a
  node RPC return. An estimate that turns out optimistic becomes a deferral
  rather than a claim the desktop has already lost, and the abandoned upload
  keeps its `transferId`, so the job resumes the partial transfer instead of
  starting over. A node that refuses (deadline
  reached, claim swept) or does not know the method defers as before.
  **Still open:** the action's 120 s deadline is the hard ceiling; a minutes-long
  video still defers.
- ~~**`browser_download` with `dir`** on a remote session~~ — **implemented
  2026-09-14.** On a remote session a download with no `dir` lands in the
  session zone's `download/` instead of this machine's Downloads folder, and a
  `dir` outside the zone is refused with a message naming
  `$SUPERONE_SESSION_DIR` — a node path the agent asks for arrives here already
  rewritten to its desktop mirror by the input mapping (§3.1), so it is inside
  the zone. A *background* download settles after its tool call has returned,
  with no scope left to register into, so its finalizer queues the transfer
  itself and the transfer's completion wake tells the agent the path works.
  Local sessions are unchanged: downloads stay user-visible in Downloads.
  A download the *page* starts (an export button the agent clicks) is filed
  at capture time too, since 2026-09-14: `will-download` cannot ask who
  *owns* the tab — that is renderer state behind an async call — but it can
  ask who last *drove* it, which every browser tool call records
  (`browser-tab-drivers.ts`) as it resolves its view. A tab a remote agent
  drove files its downloads into that session's zone and queues the transfer
  when the bytes land, so the agent finds the file without listing first;
  listing still works and registers the ref so the reply is rewritten. The
  consequence to know about: a person who downloads from a tab a remote
  agent has driven finds the file in the session directory, not in Downloads.
  The adoption path stays for a tab nothing drove yet. And an upload is now
  skipped when the node already holds the file at the same size and mtime —
  the stamp a finished transfer leaves — so a download that landed before
  the listing, or a recording named twice, is not sent twice.
- ~~**Device captures, recordings and downloads** are not in the zone yet~~ —
  **implemented 2026-09-14.** Recordings write to `producerDir(sessionId,
  'recording')/<target>` and register on persist and on adopt; device captures
  land in the driving session's zone for all three platforms (the simulator
  reads its own `owners` map, Android and iOS-mirror take the root from
  `buildBackend(deviceId, sessionId)`) and `DeviceAgentSession` registers each
  one in a single place, reading the producer back off the layout with
  `zoneArtifactRef`; downloads as above. The legacy temp roots stay readable so
  transcripts from before this change still render. Computer-use recordings
  register their sealed file when `service.act` returns, not when the path is
  reserved — a path is not an artifact until something is written to it.
  Page-triggered downloads: filed at capture, as above.
- **Reclaim** — **implemented 2026-09-14**, deliberately evidence-based rather
  than quota-based. `reclaimSyncZone` runs 30 s after launch and removes only
  what it can *prove* is dead: a session directory whose owner says it is gone,
  plus `adhoc` captures older than 7 days (the directory itself is never
  removed). Ownership is a `.owner` file written into the directory on the
  first tool call of a session — `local` is checked against this database,
  a connection id against that node, and an unreachable node means "keep",
  because offline is not deleted. A directory touched in the last hour is in
  use; a directory with a transfer still queued or retrying is not ours to
  drop (a job that has failed for good is not "queued", and is dropped with
  the directory); an unmarked directory is kept, however old — it may be a
  live remote session with no row here and no marker yet, and nothing in
  this sweep can prove otherwise.
  Since 2026-09-14 the marker is written at **every** entry that creates a
  zone directory, not only on a Host Action: producers go through
  `ensureArtifactDir` (owner from the tool call scope — a remote call carries
  its connection, a local call opens no scope), downloads and the lazy
  mirror name their connection explicitly (`ensureZoneDir`, `MirrorDeps.
  connectionId`), because they run outside any call and "no scope" there
  would misfile a remote directory as local. Directories from before this
  change stay unmarked and kept until something writes into them again. The
  sweep also runs on every node connection, debounced, not only 30 s after
  launch — a node offline at launch was one the launch sweep could only say
  "keep" about.
  **No size cap, by decision (2026-09-14).** A cap would have to delete
  artifacts a live transcript names, and the sweep above already removes
  everything that can be proved dead — so a cap could only ever delete on a
  guess. What a person can want instead is to *see* the number and to run
  that sweep now rather than at the next launch: Settings → General →
  Storage (`SessionStorageSection`) shows the zone total, the session count,
  what is still queued for upload (it is not going anywhere), and what a
  sweep would free — the same sweep run as a dry run — with **Reclaim Now**
  and **Show in Folder**. Nothing there deletes what the sweep would keep.
  A manual sweep landing during the scheduled one is safe without a lock:
  the post-await re-check (`readOwner`, `newestMtime`, pending transfer)
  makes the second walk skip a directory the first already removed, so the
  bytes are reported once.
- ~~**Directories under the zone cannot be tool inputs on a remote session.**~~
  — **implemented 2026-09-14.** `artifact.list` (controller-bound, `lstat`
  walk, links neither followed nor named, `.parts` and `.owner` skipped,
  capped at 2000 entries and reported `truncated` past that) returns every
  file under a zone directory with the size and mtime the mirror compares.
  A tool argument that names a directory it will *read* —
  `miniapp_dev_register.directory`, `miniapp_dev_pack.appDir`,
  `miniapp_dev_update_types.appDir` — is answered by `mirrorNodeDirectory`:
  list, then every member through the same per-file mirror (four at a time),
  then anything under the desktop mirror the node no longer has is removed,
  because the tool reads all of the directory and a stale file is part of
  "all of it". A truncated listing is refused as `unavailable` rather than
  handed over as a whole tree that is not; a node that predates `artifact.list`
  gets the same answer.
- ~~**Zone media larger than 10 MiB has no desktop preview path.**~~ —
  **implemented 2026-09-14.** `readProjectFile` answers a zone media file
  with the `local-file://` URL of its desktop mirror instead of a data URI;
  the local-file protocol already serves the zone with range requests, so a
  recording of any size plays in chat markdown, the file preview and the
  files previewer. Node *project* media (not in the zone) still arrives as a
  data URI under the 10 MiB cap — it has no desktop file to point at.
- **Older nodes** without `syncZone`: no rewrite, no mirror, consumers say
  `missing`. No shim.
- **Multiple controllers.** The zone is keyed by session, the node root is
  per node; a second desktop controlling the same node mirrors lazily like
  any other reader, and its own Host Action outputs land on the node and
  become visible to both. Untested.
- **Windows nodes** — separator handling is implemented and unit-tested in
  `sync-zone-paths.test.ts` (including the case-insensitive root compare), but
  no Windows node exists to test against end to end.
- **Live end-to-end run.** Every layer is covered by tests against a real node
  runtime (`artifact.integration.test.ts`, `remote-gateway-artifacts.test.ts`),
  but the full desktop↔lab loop — take a screenshot in a remote session, have
  the agent `Read` it, open the previewer on the phone — has not been driven
  by hand.
- **The mirror's timing guards are proven by construction, not by racing.**
  The pending / cancel / boundary checks are placed so that nothing is
  `await`ed between the decision and the act — the prune walk is synchronous,
  and the last word before `rename` is a synchronous `beforeCommit`. The tests
  drive each interleaving deterministically (a pending row inserted between
  two steps, a signal aborted at a named point) and each was verified red
  against the unfixed code. What is *not* tested is a real concurrent run
  where the interleaving is chosen by the scheduler; the argument that no
  other window exists rests on reading the await points, so a future edit that
  introduces an `await` inside one of those stretches reopens the hole without
  failing a test. If you add one, add the check after it.

  Note what that argument does *not* cover, which the eleventh review found the
  hard way: placement says a guard runs at the right moment, never that it asks
  about the right files. Both of that round's mirror defects were in the
  predicate — one set was missing producers that had no job row yet, the other
  included jobs whose bytes were already delivered. A correct check in a
  correct place is still wrong if its subject is wrong, so a change to what the
  zone protects needs its own reasoning, not this paragraph.
- **Protection for un-enqueued files does not survive a restart.** A file that
  is complete but could not be written onto the transfer job table is held by
  the in-memory `pending-handoffs` table, and that is all that keeps the mirror
  off it. Quit the desktop with entries in it and the file becomes an ordinary
  unreferenced zone file — the next directory mirror of its folder prunes it,
  and the node never gets it. Closing this properly means a small
  sealed-handoff journal in the zone's reserved metadata (session, connection,
  relative path, transfer id), scanned at startup to restore the protection and
  re-file the row, excluded from `list`/mirror/prune like `.owner` and
  `.parts`, and cleared on session delete. Not implemented; do not read the
  Settings figure as a durability guarantee.
