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

Still open after phases 1–4:

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
- ~~**Claim renewal** as an alternative to deferral~~ — **implemented
  2026-09-14.** `session.renewHostActionClaim({ actionId, claimToken, ttlMs })`
  extends a live claim; the holder proves itself with the claim token, and the
  node caps the new expiry at the action's own deadline, so renewal buys time
  inside the window the agent already agreed to wait — it does not extend that
  window. `syncHostActionOutputs` asks before deferring a file that does not
  fit, and each upload now runs under its own abort bound to the remaining
  budget, so an estimate that turns out optimistic becomes a deferral rather
  than a claim the desktop has already lost. A node that refuses (deadline
  reached, claim swept) or does not know the method defers as before.
  **Still open:** the action's 120 s deadline is the hard ceiling; a minutes-long
  video still defers.
- **`browser_download` with `dir`** on a remote session.
- **Device captures, recordings and downloads** are not in the zone yet (see
  §8 deviations), so a remote agent still cannot `Read` a recording and the
  previewer reports one as `missing` unless the desktop produced it locally.
- **Quota.** No size cap on the zone; session deletion is the only reclaim,
  and `adhoc` is never reclaimed at all.
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
