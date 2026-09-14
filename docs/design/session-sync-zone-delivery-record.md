# One delivery record — replacing the claim/handoff/job triple

Status: **design, revision 3, approved to begin §10.1 with the constraints of
revisions 2–3 in the spec and the acceptance suite.** Supersedes §4.1 and
§5.3 of `session-sync-zone.md` once implemented. Review markers: P1–P5 from
the first review, Q1–Q4 from the second.

## 1. Why

One fact — *"this file is the newest copy anywhere, and somebody owes it to the
node"* — is represented three times, with three lifetimes and three
vocabularies:

| Where | Lifetime | States |
|---|---|---|
| `active-writes.ts` | in-memory | `writing \| sealed` |
| `pending-handoffs.ts` | in-memory | `pushing \| enqueueing \| failed \| queued \| blocked \| notifying` |
| `artifact_transfer_jobs` | durable | `pending \| running \| uploaded \| notifying \| done \| failed` |

They are joined by four hand-written set predicates, two of which are the same
set written twice:

```
session-file-mirror.ts:90       const OWED_TO_NODE = new Set(['pending', 'running', 'failed'])
artifact-transfer-service.ts:20 const OWES_UPLOAD  = new Set(['pending', 'running', 'failed'])
```

Both in-memory tables key on a **path**. The thing with a lifecycle is **one
version of a file, delivered once**. The last several findings are corollaries:

| Finding | Presented as | Actually |
|---|---|---|
| AJ1 | `absent` cannot tell "never existed" from "finished" | the predicate answers a different question; there is no delivery to ask about |
| AK1 | an old job's completion released a newer push's claim | two deliveries collided in one path-keyed entry |
| AJ2 | the retry limit rewrote "only the wake is owed" as `failed` | a phase was lost translating between two state machines |

And one nobody had reported: `session-file-mirror.ts:134` swallows a failed
read of the job table and falls through to "nothing pending", so during a
SQLite outage a file whose only protection is its job row is prunable. The
in-memory registry has been hiding it.

Twenty-three of this branch's thirty fixes are in one directory. A single
durable record with a single identity is the change that removes the class,
not the next member of it.

## 2. The record

One row per delivery. Created before the first byte we control is written
(§4), kept — with its outcome — until the session's zone is reclaimed, so "was
this path ever delivered, and as what?" is answered by lookup, never by
inference (P3).

```sql
CREATE TABLE session_file_deliveries (
  delivery_id     TEXT PRIMARY KEY,   -- minted at creation; the only identity anything names
  session_id      TEXT NOT NULL,
  connection_id   TEXT NOT NULL,      -- the node this session belongs to; survives disconnects
  local_path      TEXT NOT NULL,      -- canonicalClaimPath spelling
  relative_path   TEXT NOT NULL,
  transfer_id     TEXT NOT NULL,      -- artifact.put resume identity; = delivery_id
  origin          TEXT NOT NULL,      -- 'download' | 'page-download' | 'produced'

  -- Content phase: monotonic, never rewritten by a failure (P2).
  phase           TEXT NOT NULL,      -- writing | sealed | queued | uploading | committing | uploaded | notifying
  outcome         TEXT,               -- NULL while live; 'done' | 'abandoned'

  -- Ownership (Q3). holder = '<incarnation>:<token>'; NULL when nobody holds it.
  holder          TEXT,
  epoch           INTEGER NOT NULL DEFAULT 0,

  -- Scheduling: orthogonal to phase. "Failed" is a value of these, not of phase.
  offset          INTEGER NOT NULL DEFAULT 0,
  total           INTEGER NOT NULL DEFAULT 0,
  sha256          TEXT,               -- fixed at seal
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error      TEXT,
  gave_up_at      TEXT,               -- automatic retry stopped; a person may still act

  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX idx_deliveries_path     ON session_file_deliveries(session_id, local_path);
CREATE INDEX idx_deliveries_runnable ON session_file_deliveries(connection_id, phase, next_attempt_at)
  WHERE outcome IS NULL;

-- The content slot (P1): one owner of the bytes at a path at a time. Rows past
-- `committing` no longer own content locally and do not occupy the slot.
CREATE UNIQUE INDEX idx_deliveries_content_slot ON session_file_deliveries(session_id, local_path)
  WHERE outcome IS NULL AND phase IN ('writing', 'sealed', 'queued', 'uploading', 'committing');

-- Session-close admission (P4): durable, written in the transaction that abandons the rows.
CREATE TABLE session_zone_tombstones (
  session_id TEXT PRIMARY KEY,
  dropped_at TEXT NOT NULL
);
```

Verified against in-memory SQLite: an `uploaded` row and a `writing` row at
the same path coexist; two content owners are refused with
`SQLITE_CONSTRAINT_UNIQUE`; abandoning frees the slot; a compare-and-set with
a stale `epoch` returns `changes = 0`.

One phase machine, monotonic:

```
writing → sealed → queued → uploading → committing → uploaded → notifying → [outcome = done]
   any phase ─────────────────────────────────────────────────────────────→ [outcome = abandoned]
```

**`committing`** (Q1) is written **before** the final `artifact.put` is sent
and left only when its reply confirms the rename. It is the one phase whose
truth on the node is unknowable from the desktop side if the reply is lost:
the node's completion receipts are a bounded in-memory map
(`apps/cli/src/workspace/artifact-zone.ts:72`, `COMPLETED_RECEIPTS = 512`),
`artifact.stat` (`packages/shared/src/environment/artifact-rpc.ts:19`) returns
size and mtime but no hash, and the commit itself is an unconditional
`renameSync` (`artifact-zone.ts:311`). Every other phase is unambiguous:
before `committing` the node has at most a `.parts` fragment, after it the
node has the file. Confining the ambiguity to one named phase is the whole
point of having it.

A failure at any phase sets `last_error` / `next_attempt_at` / `attempts`, or
`gave_up_at`. **It never moves `phase`** (P2). AJ2 has no representation.

No `superseded` (§3, R2).

## 3. Identity rules

**R1 — one content owner per path**, enforced by `idx_deliveries_content_slot`
(P1). Rows at `uploaded` and later own nothing locally and leave the slot.

**R2 — a path is written once per session; a new version is a new path.** A
producer asking to write a path that has *any* row — live or done — is refused
and picks another name (downloads already uniquify on `wx` collision; captures
and generations use timestamped names). In-place replacement would need a
generation or conditional-commit protocol on the node, which today commits
with a bare `renameSync` and reports `busy` by path (`artifact-zone.ts:262`,
`:311`); an `AbortSignal` cannot retract a put already sent. Not in scope; it
is a node contract change first (P3).

**R3 — every event names a record.** `advance(deliveryId, from, to, holder)`,
`abandon(deliveryId, holder)`. A worker finishing delivery *T* has no way to
touch delivery *U*: it does not have *U*'s id, and nothing looks a live row up
by path except the producer's own reservation (R2) and the mirror (R4). AK1 is
unrepresentable.

**R3a — producers carry the handle; observation reuses it.** Reservation
returns `deliveryId`; the `ArtifactRef` carries it; the Host Action reply's
`sync` block carries it. A later *observation* of the same file —
`browser_list_downloads` re-reporting, a second listing, a mirror read — finds
the row by `(session_id, local_path)`, whatever its phase or outcome, and
reuses it. Rows are kept until session reclaim so there is always a row to
find (P3).

**R4 — the mirror asks one table and reads the whole answer.** One
classification, used by every destructive step, evaluated in this order (Q3):

| Row at or under the path | The mirror's view |
|---|---|
| table unreadable | `unavailable`: prune nothing, overwrite nothing, serve nothing (R5) |
| `outcome = abandoned` | not protected, whatever its phase — a half file is never served |
| `outcome = done` | not protected; node authoritative |
| `writing` | protected, **not readable** |
| `sealed` / `queued` / `uploading` | protected, readable — the desktop copy is the newest anywhere |
| `committing` | protected, **not readable** — neither copy can be called authoritative (Q1) |
| `uploaded` / `notifying` | **not** protected; node authoritative; fetch and overwrite |
| no row | ordinary mirror behaviour |

`OWES_UPLOAD`, `OWED_TO_NODE`, `stageOf`, `PendingSnapshot`, `JobLookupResult`
all go. `better-sqlite3` is synchronous, so the classification still runs with
no `await` between deciding and acting.

**R5 — unreadable means protected; unwritable does not mean unreadable** (P4).
A failed *write* is handled by the phase it interrupted (§6).

**R6 — a sealed source is immutable.** From `sealed` on, the producer never
touches the file; the mirror may overwrite it only in the R4 rows that say so.
`sha256` and `total` are fixed at seal; the node already abandons a transfer
whose sha or total changed mid-stream. With R2 there is no second writer.

**R7 — every advance is a compare-and-set on `(delivery_id, phase, epoch)`**,
and every takeover is a compare-and-set on `(delivery_id, holder)`. Either
bumps `epoch`, so the previous holder's next CAS fails (Q3).

## 4. The producers, by how they write (Q2)

The rule follows the write mode, not the tool, because what matters is
whether there is an `await` between a file's first byte and its registration.
Reading each entry rather than guessing at it left **two** modes, not the
three revision 3 listed — media generation writes synchronously from a buffer
(`media-gen/storage.ts` `persistFiles`: `writeFileSync` + `renameSync` +
register), so there is no "final path unknown until written" producer and no
staging directory.

| Mode | Entries | Rule |
|---|---|---|
| **Reserved before the first byte** | `reserveDownloadPath` — both `browser_download`'s fetch and a page download's `will-download`, which calls it before `item.setSavePath`; `createActionRecordingPath` — the `computer_act` recorder (`tools.ts:772`) and the two buffer persists that share the factory; `captureFor` on the simulator manager (§10.2 boundary, below) | `reserveZoneFile` **inside the path factory**, in the same synchronous sequence as the `wx` create, so the path never leaves with fewer than a row behind it. `sealZoneFile` when the writer says the bytes are in. The `wx` create comes first because it is what picks the unique name; a row reserved for a name that then collides would burn that name under R2. |
| **Published complete in one synchronous sequence** | `persistBase64Screenshot` (both files), `persistTextArtifact`, `persistFiles` and `image-preview`, the Android and mirror device backends (`writeFileSync` now, not `await writeFile`) | `sealZoneFile` in the same tick as the write, hashed from the buffer the producer still holds. Nothing can run between the write and the row. |
| **Re-registration at a later boundary** | `registerCapture` in the device executor, the video status call in `media-tools.ts`, the recorder's registration at `tools.ts:784` | `publishArtifact` finds the row by path and reuses its id (R3a). Never a second row, never a reset. |

`publishArtifact` replaces every direct `registerArtifact` call: it seals or
publishes in the record, then registers the ref with its `deliveryId`, so the
Host Action that pushes it goes straight to the row.

Two things this pass fixed on the way through: `reserveDownloadPath`'s
hundred-collision fallback handed back a path with no file created and no
claim taken — the one download the mirror could always prune — and the
recorder path was never claimed at all (the finding that opened Q2).

**§10.2 boundary.** The simulator manager's `captureFor` is shared by the
agent's screenshot and by the panel's recording, with the destination in
`zoneOwners` rather than a call scope; it and the Android panel recording are
wired in §10.3 with the worker, where their seal points (`screenshot()`,
`stopRecording()`) meet the consumer. Until then those captures are as
unprotected as they were before this work.

**A name is free only when both the filesystem and the record say so.** The
`wx` create picks a name atomically on disk; the record then has to accept it
as never written in this session (R2). A vacancy on disk is not a free name —
a delivered file the node has since deleted leaves exactly that — so on
`path-taken` the factory removes the empty stub it just created and tries the
next name. Sealing, publishing and observing are three intents told apart,
not guessed: a seal whose compare-and-set fails is refused as
`reservation-lost` and never registered; a publish (`bytes` given) onto a
path that has a row is refused; an observation returns a row only if it is a
delivery that is happening or has happened — never a `writing` row under
someone else, never an abandoned one.

**Every writer exit closes its reservation.** A page download is sealed by
the `DownloadItem`'s own completion, not by a later listing that may never
come; a recording reservation is abandoned by every consumer's failure exit
(`abandonActionRecording`) — the source missing, the action failing, the
helper producing none. Nothing times out on its own; an open reservation
with a live holder is, by design, a writer still working.

**Step 2 is dual-path.** Producers write the record beside the old
claim/handoff registries, and nothing consumes it until §10.3. Until then a
failure to *record* is logged, not raised (`recordTolerantly`), so the old
path behaves exactly as before. Two refusals are already strict, because they
are the record's verdict on the write itself and swallowing either reports a
file as delivered that is not: `path-taken` and `reservation-lost`. The two
about the session's context — `unknown-destination`, `session-dropped` —
are what the old fixtures cannot yet satisfy; §10.3 makes them strict with
those fixtures and deletes `recordTolerantly`.

**Local and adhoc sessions have no row.** `reserve()` takes the destination
from explicit context — the call scope's connection
(`currentHostActionConnection()`) for tool-driven producers, the session's
registered host for event-driven ones — and returns `{ deliveryId: null }` when
there is none. Nothing mirrors a local session, so nothing there needs a row;
their existing owner/reclaim semantics are unchanged. `connection_id` stays
`NOT NULL` (Q2).

The product decision, once: **a desktop that cannot write its database does
not start a transfer.** Files already produced are not pretended away; nothing
new is promised to the agent on the strength of a record that does not exist.

## 5. Availability

`blocked`, `unavailable`, the retry ladder, `retryFailedHandoffs` and the
in-memory tombstone set exist because the in-memory half kept working while
the durable half was down. With one authority:

- **Cannot insert the row** → §4: refuse, cancel, or fail the call.
- **Row exists, later step fails** → the row records the phase reached and the
  error; §6 resumes from that phase. Durable, so it survives a restart.
- **Settings "could not be queued"** becomes `gave_up_at IS NOT NULL`; Retry
  Upload clears it. `committing` rows that gave up are shown as *needs
  re-delivery*, not *retry* (§6).

## 6. Holders and recovery (Q1, Q3)

**Liveness is not `epoch`.** `epoch` is a concurrency version; a long
download sits in `writing` for as long as the response takes and its epoch
does not move. A holder is `'<incarnation>:<token>'`, where `incarnation` is
minted once per process start. A holder is **alive** iff its incarnation is
the current one *and* it is in the process-local set of holders currently
being worked (added on claim, removed on advance/abandon). That set is
process-local liveness, like the existing `inflight` abort map — not delivery
state, which lives only in the row. No heartbeat, no idle timeout: within one
process liveness is exact, and after a restart every holder of another
incarnation is dead by definition.

**Any live row with a dead holder can be taken over**, in every phase, by
`UPDATE … SET holder = ?, epoch = epoch + 1 WHERE delivery_id = ? AND holder = ?`.
The old holder's later CAS fails on `epoch`. Takeover, renewal, abandon and
session drop all invalidate the previous holder the same way.

What a worker pass (and startup) then does with what it finds:

| Found | Means | Action |
|---|---|---|
| `writing`, dead holder | producer crashed (or reserved and never created the file) | `abandoned`. **Never sent**: nothing records how far the producer got, and a half file is worse than none. The file stays for the sweep, unprotected (R4). |
| `sealed` / `queued`, dead or no holder | complete source waiting | take over → `uploading` |
| `uploading`, dead holder | final put **not yet sent** (or the row would be `committing`) | take over, resume from `offset`. The node has at most a `.parts` fragment: it answers `expectedOffset`, or `unknown transfer` after its idle expiry, and then the upload restarts from 0 under the same `transfer_id` — safe because the source is immutable (R6) and the target path was never committed. |
| `committing`, dead holder | final put sent, reply lost | **cannot be verified from here** (§2). `gave_up_at = now`, `last_error = 'commit unverified'`, no automatic put ever. Settings shows *needs re-delivery*; a person re-delivers under a **new path and a new `delivery_id`**, after which this row is `abandoned`. Automatic recovery would need the node to expose a hash on `stat` or accept a conditional final chunk; that is a node contract change and is named here as the boundary, not promised. |
| `uploaded` / `notifying`, dead or no holder | only the wake is owed | take over → `notifying` → wake → `done`. There is no path from here back to `uploading`. |
| any live phase, `gave_up_at` set | automatic retry stopped | shown in Settings; manual retry clears it and re-enters this table |
| any row, session tombstoned | late arrival after delete | `abandoned`; a new insert for that session is refused |

**Session close.** `dropSession(sessionId)` is one transaction: insert the
tombstone, `outcome = 'abandoned'` on every live row. The two callers today
(`environment-host.ts:2112`, `session-zone-reclaim.ts:23`) remain the two.
Insert admission is `NOT EXISTS (SELECT 1 FROM session_zone_tombstones …)` in
the same statement.

## 7. Migration and downgrade (Q4)

**Supported old-version range: none.** No released build contains any of this
feature: `main` is at `SCHEMA_VERSION = 5` and has no sync zone, no mirror, no
transfer table and no CLI artifact zone. `artifact_transfer_jobs` was created
by this branch's own unreleased migration 6 (`1c42c64a`).

So migration 6 is **rewritten before it ships** to create
`session_file_deliveries` and `session_zone_tombstones` instead. There is no
copy, no dual-write, and no bridge for a table that no user has. The
additive-only policy is honoured trivially — nothing is dropped or renamed —
and `MIN_COMPATIBLE_SCHEMA_VERSION` does not move.

Developer databases already on this branch keep an orphaned
`artifact_transfer_jobs` that nothing reads (the migration body is idempotent
and runs every launch, so the new tables appear beside it). In-flight jobs in
such a database are lost; their files stay on disk. That round trip is
explicitly outside the compatibility promise.

**Downgrade to `main`** is safe by absence: the feature does not exist there.
The tables are ignored, the zone directories sit untouched, nothing is
uploaded and nothing is pruned.

## 8. What this deletes

| File | Now | After |
|---|---|---|
| `active-writes.ts` | 249 | gone |
| `pending-handoffs.ts` | 500 | gone; the runnable query is the scheduler |
| `artifact-transfer-service.ts` | 349 | ~220 |
| `db-artifact-transfers.ts` | 228 | replaced by `db-session-deliveries.ts` |
| `session-file-mirror.ts` | 549 | ~470; one classification replaces three predicates |
| `host-action-sync.ts` | 509 | ~400; `owned`/`joined`/`releaseUndelivered` become record ids on the plan |

Also gone: `ClaimHolder` / `WRITER_TOKEN` and the who-may-end-a-claim protocol;
`JobLookupResult`; `HandoffState`; the in-memory `dropped` set; the
`revive`/`noteHandoffDelivered`/`setPendingJobLookup` seams.

## 9. Acceptance

Deterministic, on one fixture: real `ArtifactTransferService`, real SQLite,
real mirror, real `ArtifactZoneService` for the node, controllable clock and
process incarnation. No random scheduling, no new end-to-end.

- `keeps an uncertain final commit unavailable without replaying old bytes` —
  the node has committed; the desktop's `uploaded` write fails; the node's
  file is then modified and then deleted; recovery serves neither OLD nor a
  replayed final chunk, and Settings shows *needs re-delivery*.
- `protects a recorder before its asynchronous writer starts` — real DB and
  mirror, writer paused at the fake recorder boundary; a directory mirror
  prunes nothing; the same entry with a local session takes no row and needs
  no node.
- `keeps a live writer and reclaims dead holders in every phase` — a long
  `writing` holder is not reclaimed; a `notifying` holder from a previous
  incarnation is; a stale-epoch callback is refused; session drop invalidates
  the holder; no retry moves a phase backwards.
- `ignores the unreleased job table and starts empty` — a developer database
  carrying `artifact_transfer_jobs` opens with the new tables beside it and
  nothing imported; a `main` (schema 5) database upgrades with no rows.
- The existing AJ1 / AJ2 / AK1 reproductions and the unreadable-table mirror
  case, as acceptance of the architecture rather than regression tests for
  fixes that no longer exist.
- R4 classification on the same fixture: `committing`, `gave_up_at`,
  `abandoned`, and several rows under one directory.
- Then the agreed matrix: phase-advance point × concurrent actor, with the
  advance's outcome (succeeded / failed before taking effect / took effect but
  the caller did not learn it) and the retry counter as parameters.

## 10. Order of work

1. Schema + `db-session-deliveries.ts`: reserve / advance / takeover / abandon
   / dropSession as CAS primitives, the R4 classification, the holder set and
   incarnation. Tested against real SQLite.
2. Producers by write mode (§4). `ArtifactRef` gains `deliveryId`.
3. Host Action sync and the worker over the record, `committing` included.
   Delete the three old modules.
4. Mirror over the classification.
5. Rewrite migration 6.
6. Acceptance suite (§9), then the matrix.

AK1 and AJ2 are not fixed separately; they are acceptance cases for step 6.
