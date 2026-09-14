# One delivery record — replacing the claim/handoff/job triple

Status: **design, revision 2, not implemented.** Revision 1 was reviewed and
returned with five design corrections (P1–P5 below, each marked where it
landed). Supersedes §4.1 and §5.3 of `session-sync-zone.md` once implemented.

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

One row per delivery. Created before the first byte a producer controls is
written (§5), kept — with its outcome — until the session's zone is reclaimed,
so "was this path ever delivered, and as what?" is always answerable by lookup
rather than by inference (P3).

```sql
CREATE TABLE session_file_deliveries (
  delivery_id     TEXT PRIMARY KEY,   -- minted at creation; the only identity anything names
  session_id      TEXT NOT NULL,
  connection_id   TEXT NOT NULL,      -- the node this session belongs to; survives disconnects
  local_path      TEXT NOT NULL,      -- canonicalClaimPath spelling
  relative_path   TEXT NOT NULL,
  transfer_id     TEXT NOT NULL,      -- artifact.put resume identity; = delivery_id for new rows
  origin          TEXT NOT NULL,      -- 'download' | 'page-download' | 'produced'

  -- Content phase: monotonic, never rewritten by a failure (P2).
  phase           TEXT NOT NULL,      -- writing | sealed | queued | uploading | uploaded | notifying
  outcome         TEXT,               -- NULL while live; 'done' | 'abandoned'

  -- Ownership, for compare-and-set (P4).
  holder          TEXT,               -- token of whoever may advance the phase; NULL if nobody
  epoch           INTEGER NOT NULL DEFAULT 0,

  -- Scheduling: orthogonal to phase. "Failed" is a value of these, not of phase.
  offset          INTEGER NOT NULL DEFAULT 0,
  total           INTEGER NOT NULL DEFAULT 0,
  sha256          TEXT,               -- fixed at seal; the node rejects a put whose sha changed
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error      TEXT,
  gave_up_at      TEXT,               -- terminal for automatic retry; a person can still retry

  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX idx_deliveries_path     ON session_file_deliveries(session_id, local_path);
CREATE INDEX idx_deliveries_runnable ON session_file_deliveries(connection_id, phase, next_attempt_at)
  WHERE outcome IS NULL;

-- The content slot (P1): one writer/owner of the bytes at a path at a time.
-- Rows past `uploading` no longer own content and do not occupy the slot.
CREATE UNIQUE INDEX idx_deliveries_content_slot ON session_file_deliveries(session_id, local_path)
  WHERE outcome IS NULL AND phase IN ('writing', 'sealed', 'queued', 'uploading');

-- Session-close admission (P4): a durable tombstone, written in the same
-- transaction that abandons the session's rows.
CREATE TABLE session_zone_tombstones (
  session_id TEXT PRIMARY KEY,
  dropped_at TEXT NOT NULL
);
```

One phase machine, monotonic:

```
writing → sealed → queued → uploading → uploaded → notifying → [outcome = done]
   any phase ──────────────────────────────────────────────→ [outcome = abandoned]
```

A failure at any phase sets `last_error` / `next_attempt_at` / `attempts`, or
`gave_up_at` once automatic retry stops. **It never moves `phase`.** AJ2 —
"the retry limit turned an owed wake into a pending upload" — has no
representation: there is no `failed` value to overwrite `uploaded` with, and
the worker's next pass reads the phase it actually reached (P2).

No `superseded`. V1 does not replace content at a path in place (§3, R2).

## 3. Identity rules

**R1 — one content owner per path.** Enforced by `idx_deliveries_content_slot`,
not by code remembering to check. Rows at `uploaded`/`notifying`/`done` do not
occupy the slot: their bytes are on the node and they own nothing locally.
(Revision 1's index counted them as live, so the "new row beside the old wake"
case it described was a UNIQUE violation — P1.)

**R2 — a path is written once per session; a new version is a new path.**
A producer asking to write a path that has *any* row — live or done — is
refused and must choose another name. Producers already do: downloads reserve
with `wx` and uniquify on collision; captures and generations use timestamped
names. This is what makes R6 possible and removes every "which version is this
row about?" question. In-place replacement would need either strict serial
commit or a generation/CAS protocol on the node — the node today commits with a
bare `renameSync` and reports `busy` by path (`apps/cli/src/workspace/artifact-zone.ts:262`,
`:311`), and an `AbortSignal` cannot retract an `artifact.put` already sent.
That protocol is not in scope; if it is ever wanted it is a node contract
change first (P3).

**R3 — every event names a record.** `advance(deliveryId, from, to, holder)`,
`noteDelivered(deliveryId)`, `abandon(deliveryId, holder)`. A worker finishing
delivery *T* has no way to touch delivery *U*: it does not have *U*'s id and
nothing looks a live row up by path except the producer's own reservation
(R2) and the mirror (R4). AK1 is unrepresentable, and "the thing advanced must
be the same delivery" is a signature rather than a convention.

**R3a — producers carry the handle; observation reuses it.** The reservation
returns `deliveryId`; the `ArtifactRef` the tool registers carries it; the
Host Action reply's `sync` block carries it. A later *observation* of the same
file — `browser_list_downloads` re-reporting a ref, a second listing, a mirror
reading it back — finds the row by `(session_id, local_path)` and reuses it,
whatever its phase or outcome. It never creates a second delivery and never
guesses from the path alone, because the row is still there to answer (P3).

**R4 — the mirror asks one table, and still has to read the answer.** A
single classification, used by every destructive step, with four outcomes
(P2):

| Row at or under the path | The mirror's view |
|---|---|
| `writing` | protected, **not readable** — a caller wanting bytes gets `unavailable` |
| `sealed` / `queued` / `uploading` | protected, readable — the desktop copy is the newest anywhere |
| `uploaded` / `notifying` / `done` | **not** protected — the node is authoritative; fetch and overwrite the desktop copy |
| no row | not protected — ordinary mirror behaviour |
| table unreadable | `unavailable`: prune nothing, overwrite nothing, serve nothing (R5) |

`OWES_UPLOAD`, `OWED_TO_NODE`, `stageOf`, `PendingSnapshot` and the
four-valued lookup all go. `better-sqlite3` is synchronous, so the
classification still runs with no `await` between deciding and acting.

**R5 — unreadable means protected; unwritable does not mean unreadable.**
A failed read makes every destructive step refuse. A failed *write* is a
different event and is handled by the phase it interrupted (§6) — a read-only
volume or a full disk keeps reads working, so "the mirror can't see it either"
is never a basis for anything (P4).

**R6 — a sealed source is immutable.** From `sealed` onward the producer never
touches the file, and the mirror may overwrite it only once `phase ≥ uploaded`
(R4). `sha256` and `total` are fixed at seal. This is what makes resume safe:
`artifact.put` re-reads the source on every chunk, and the node already
abandons a transfer whose sha or total changed mid-stream
(`artifact-zone.ts` "Same id, different file"). With R2 there is no second
writer to change it (P3).

**R7 — every advance is a compare-and-set.**
`UPDATE … SET phase = ?, holder = ?, epoch = epoch + 1 WHERE delivery_id = ? AND phase = ? AND epoch = ?`,
`changes === 1` or the caller has lost the row to someone else and stops. A
holder is a token minted per attempt; a restart mints a new one, so a worker
that died mid-claim cannot be impersonated by its own ghost (P4).

## 4. The producers

Eight call sites register artifacts today, all *after* writing
(`agent/action-recording-store`, `agent/browser-artifact-store`,
`agent/browser-download-store`, `agent/screenshot-artifact`,
`computer-use/tools`, `device-agent/execute`, `media-gen/zone-artifact`,
`mcp/artifact-registry`). They fall into three kinds, and the rule differs
because the side-effect they cannot undo differs:

| Kind | Entry | Rule |
|---|---|---|
| **Streaming download** | `browser_download` → `registerDownload` | Reserve the row **before** the `wx` create. Insert fails ⇒ no file is ever created; the tool reports the failure. |
| **Passive page download** | `will-download` | The file is already being written by Chromium when we learn of it. Insert the row on `will-download`; insert fails ⇒ `item.cancel()`, which removes the partial. The external side-effect (a page triggered a download) has happened and is reported as such. |
| **Produced file** | screenshot, recording, generation, capture, spilled text | The capture/render has happened; the file is the tool's own output. `registerArtifact` inserts the row at `sealed`; insert fails ⇒ the call fails and the file is left with no row, which the reclaim sweep treats as garbage. |

The product decision this encodes, stated once: **a desktop that cannot write
its database does not start a transfer.** Files already produced are not
pretended away, but nothing new is promised to the agent on the strength of a
record that does not exist. Reviewer's framing, adopted: "persisted
reservation before the first local write we control".

`connection_id` is `NOT NULL`. A zone file belongs to a remote session, and a
remote session has a node from the moment it exists; local sessions' downloads
go to the user's Downloads folder and never have a row. Disconnection does not
clear it — it is the node's identity, not a socket. There is no
produce-then-bind flow to support, so the smaller contract wins.

## 5. Availability

`blocked`, `unavailable`, the retry ladder, `retryFailedHandoffs` and the
tombstone set in `pending-handoffs.ts` exist because the in-memory half kept
working while the durable half was down and a flow could get halfway and then
not know. With one authority:

- **Cannot insert the row** → §4: refuse, cancel, or fail the call. Nothing is
  half-owned.
- **Row exists, later step fails** → the row records the phase it reached and
  the error. Recovery (§6) resumes from that phase. Durable, so it survives a
  restart — which is most of what §9 of the parent design gave up on.
- **Settings "could not be queued"** becomes `gave_up_at IS NOT NULL`; Retry
  Upload clears `gave_up_at` and `next_attempt_at`. Same UI, accurate across
  restarts.

## 6. Recovery

What a worker pass (and startup) finds, what it means, and what it does. Every
action below is a CAS (R7); a row whose `holder` is set and whose `epoch` has
moved since the pass read it belongs to someone else and is skipped (P4).

| Found | Means | Action |
|---|---|---|
| `writing`, holder dead (epoch unchanged for > `IDLE_HOLDER_MS`), file missing | reserved, never created | `abandoned` |
| `writing`, holder dead, file present | producer crashed mid-stream | `abandoned`; the file stays for the sweep. **Never sent** — there is no record of how far the producer got, and a half file is worse than none. |
| `sealed` / `queued`, no holder | complete source waiting | claim → `uploading` |
| `uploading`, holder dead | commit result unknown | **stat the node first.** Node has the file with our `sha256`/`total` ⇒ advance to `uploaded` with no put. Absent ⇒ resume: `artifact.put` from `offset`; the node answers from its receipt, or with `expectedOffset`, or `unknown transfer` — then restart from 0 under the same `transfer_id`, safe because the source is immutable (R6). |
| `uploaded` / `notifying`, no holder | only the wake is owed | claim → `notifying` → wake → `done`. Never a put, by construction: there is no path from here back to `uploading`. |
| any live phase, `gave_up_at` set | automatic retry stopped | shown in Settings; a manual retry clears it and re-enters this table |
| any row, session in `session_zone_tombstones` | late arrival after delete | `abandoned`; a *new* insert for that session is refused |

The stat-before-put rule is not only for crashes. The node's completion
receipts are a bounded in-memory map (`COMPLETED_RECEIPTS = 512`,
`artifact-zone.ts:72`), so after a node restart or eviction a re-sent final
chunk under an old `transfer_id` is a fresh upload that would overwrite
whatever the agent wrote since. Any resume whose commit state is unknown asks
the node what it has before sending a byte (P5).

**Session close.** `dropSession(sessionId)` is one transaction: insert the
tombstone, set `outcome = 'abandoned'` on every live row, delete the rows'
files' protection with them. `environment-host.ts:2112` and
`session-zone-reclaim.ts:23` are the two callers today and stay the two. The
admission check on insert is `NOT EXISTS (SELECT 1 FROM session_zone_tombstones …)`
in the same statement. This is a session-lifecycle fact, not a second delivery
authority; it is what the in-memory `dropped` set was standing in for.

## 7. Migration and downgrade

Additive-only, per `apps/desktop/CLAUDE.md`, and **not** a compatibility
break: `MIN_COMPATIBLE_SCHEMA_VERSION` stays; `SCHEMA_VERSION` → 7.

**One-time copy, gated.** `applyMigrations` runs every launch and is
idempotent; the copy must not resurrect rows a later launch has finished. So it
is gated on `fromVersion < 7` — `runDatabaseMigrations` already reads
`user_version` before the transaction and stamps it inside the same one
(`database-migrations.ts:75`, `:98`) — and is `INSERT OR IGNORE` with
`delivery_id = job_id`, so a crash between the copy and the stamp re-runs it
harmlessly. `job_id` is what `notificationId` has always been, so the node's
notification idempotency carries over unchanged (P5).

| Old `state` | New `phase` / scheduling |
|---|---|
| `pending` | `queued` |
| `running` | `uploading`, holder NULL — recovered by the stat-first rule (§6) |
| `uploaded` | `uploaded` |
| `notifying` | `notifying` |
| `failed` (terminal) | `sealed`, `gave_up_at = now`, `last_error` kept. Its real phase is unknown, so it is never resumed automatically; a manual retry goes through §6, which stats the node before any put. |
| `done` | not copied (the old code deletes these; none exist) |
| two rows, same path | newest by `created_at` takes the content slot; the rest are copied as `abandoned` so their ids still resolve |

`transfer_id`, `offset`, `total`, `attempts`, `last_error`, `created_at` copy
through. `sha256` is NULL for migrated rows and computed on first resume.

**Dual-write during the transition.** The new code keeps writing
`artifact_transfer_jobs` for the phases an older build understands
(`queued→pending`, `uploading→running`, `uploaded`, `notifying`; delete on
`done`/`abandoned`), and a `writing`/`sealed` row has no counterpart there.
This is what expand/contract step 1 asks for — revision 1 "left the old table
in place, unwritten", which is not the same thing and would have handed a
downgraded build a frozen snapshot to replay (P5). Step 2 — stop writing, drop
the table, `GRANDFATHERED` entry — is at least two releases later.

**What a downgraded build sees, stated rather than assumed.** The same jobs at
the same phases, so it does not re-upload a delivered file. It does not see
`writing`/`sealed` rows, so its mirror does not protect a file that was sealed
but not yet queued when the crash-then-downgrade happened; that window is one
synchronous step wide in the new code and is the same exposure such a file has
today. It does not see tombstones and keeps its own in-memory set. The
old-build replay hazard against the node's evicted receipts is therefore
closed for everything the old build can see; the `writing`/`sealed` residue is
the only thing it cannot, and that residue is never sent by anyone.

## 8. What this deletes

| File | Now | After |
|---|---|---|
| `active-writes.ts` | 249 | gone |
| `pending-handoffs.ts` | 500 | gone; the worker's runnable query is the scheduler |
| `artifact-transfer-service.ts` | 349 | ~220; no `setPendingJobLookup`, no `OWES_UPLOAD`, no `reviveArtifactTransfer`, no `noteHandoffDelivered` |
| `db-artifact-transfers.ts` | 228 | dual-write shim only, deleted at contract step 2 |
| `session-file-mirror.ts` | 549 | ~470; `stageOf`, `OWED_TO_NODE`, `PendingSource` replaced by one classification |
| `host-action-sync.ts` | 509 | ~400; `owned`/`joined`/`releaseUndelivered` become record ids on the plan |

Also gone: `ClaimHolder` / `WRITER_TOKEN` and the three-function
who-may-end-a-claim protocol; `JobLookupResult`; `HandoffState`; the
in-memory `dropped` set.

## 9. Acceptance

The existing reproductions stay as the architecture's acceptance tests, not as
regression tests for fixes that no longer exist:

- AJ1 (blocked lookup recovers after the worker finished), AJ2 (retry limit
  on an `uploaded` row), AK1 (older wake completing while a newer push holds
  the path), and the mirror-during-unreadable-table case from §1.
- Then the agreed matrix: **phase-advance point × concurrent actor**, with the
  advance's outcome (succeeded / failed before taking effect / took effect but
  the caller did not learn it) and the retry counter (first / at limit) as
  parameters, on one fixture — real `ArtifactTransferService`, real SQLite,
  real mirror, real `ArtifactZoneService` for the node.

Not claimed: random-schedule coverage, crash injection between filesystem and
SQLite, live end-to-end. Those stay in the parent design's §9 as accepted
boundaries.

## 10. Order of work

1. Schema + `db-session-deliveries.ts` with the CAS primitives (R7) and the
   classification (R4), tested against real SQLite.
2. Producers: reservation for downloads, `will-download` cancel-on-failure,
   `registerArtifact` insert-at-sealed (§4). `ArtifactRef` gains `deliveryId`.
3. Host Action sync and the worker over the record; delete the three old
   modules.
4. Mirror over the classification.
5. Migration + dual-write shim.
6. Acceptance suite (§9), then the matrix.

AK1 and AJ2 are not fixed separately; they are acceptance cases for step 6.
