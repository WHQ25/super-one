# One delivery record — a proposal to replace the claim/handoff/job triple

Status: **proposal, not implemented.** Written after twenty review rounds on
`feat/session-sync-zone`, 23 of whose 30 fixes landed in `apps/desktop/src/main/environment/`.
Supersedes nothing yet; §4.1 and §5.3 of `session-sync-zone.md` are what it would rewrite.

## 1. Why

One fact — *"this file is the newest copy anywhere, and somebody owes it to the
node"* — is currently represented three times, with three lifetimes and three
vocabularies:

| Where | Lifetime | States |
|---|---|---|
| `active-writes.ts` | in-memory | `writing \| sealed` |
| `pending-handoffs.ts` | in-memory | `pushing \| enqueueing \| failed \| queued \| blocked \| notifying` |
| `artifact_transfer_jobs` | durable | `pending \| running \| uploaded \| notifying \| done \| failed` |

Nothing reconciles them. They are joined by four hand-written set predicates,
two of which are the same set written twice in two modules:

```
session-file-mirror.ts:90       const OWED_TO_NODE = new Set(['pending', 'running', 'failed'])
artifact-transfer-service.ts:20 const OWES_UPLOAD  = new Set(['pending', 'running', 'failed'])
```

And both in-memory tables key on a **path**:

```
pending-handoffs.ts:171  `${connectionId}\t${sessionId}\t${canonicalClaimPath(localPath)}`
active-writes.ts:97      `${sessionId}\t${canonicalClaimPath(path)}`
```

But the thing with a lifecycle is not a path. It is **one version of a file,
being delivered once**. Every defect of the last several rounds is a corollary
of not having that as a first-class identity:

| Finding | Presented as | Actually |
|---|---|---|
| AJ1 | `absent` cannot distinguish "never existed" from "finished" | the predicate answers a different question, because there is no delivery to ask about |
| AK1 | an old job's completion released a newer push's claim | two deliveries collided in one path-keyed map entry |
| AJ2 | the retry limit rewrote "only the wake is owed" as `failed` | a phase was lost translating between two state machines |

The product space is 2 × 6 × 6. Each round closes one cell. A fault matrix
finds the cells faster; it does not reduce them.

There is also a defect nobody has reported yet, which falls out of reading the
three tables side by side. `session-file-mirror.ts:134` swallows a failed read
of the job table and falls through to "nothing is pending":

```ts
try {
  for (const j of list?.(sessionId) ?? []) if (OWED_TO_NODE.has(j.state)) rels.add(j.relativePath)
} catch {
  /* unreadable table: fall through to "nothing pending" */
}
```

So during a SQLite outage a file whose only protection is its job row is
**prunable**. The in-memory registry is what has been hiding this. One
authority makes the two halves fail together instead.

## 2. The record

One row per delivery, created when the path is first spoken for and deleted
when the agent has been woken. New table — not a widening of
`artifact_transfer_jobs`, because `db-artifact-transfers.ts:68` maps an
unrecognised state to `pending`, so a downgraded build would read a row that
means "half-written" as "ready to upload" and push a partial file.

```sql
CREATE TABLE session_file_deliveries (
  delivery_id    TEXT PRIMARY KEY,   -- the identity; minted at creation
  session_id     TEXT NOT NULL,
  connection_id  TEXT,               -- NULL until the file has a destination
  local_path     TEXT NOT NULL,      -- canonicalClaimPath spelling
  relative_path  TEXT NOT NULL,
  transfer_id    TEXT NOT NULL,      -- resume identity for artifact.put
  stage          TEXT NOT NULL,
  origin         TEXT NOT NULL,      -- 'reservation' | 'produced'
  holder         TEXT,               -- token owning the current stage, NULL if none
  offset         INTEGER NOT NULL DEFAULT 0,
  total          INTEGER NOT NULL DEFAULT 0,
  attempts       INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX idx_deliveries_path ON session_file_deliveries(session_id, local_path);
CREATE INDEX idx_deliveries_runnable ON session_file_deliveries(connection_id, stage, next_attempt_at);
CREATE UNIQUE INDEX idx_deliveries_live ON session_file_deliveries(session_id, local_path)
  WHERE stage NOT IN ('done', 'superseded', 'abandoned');
```

One state machine, replacing all three:

```
writing ──seal──> sealed ──claim──> queued ──> uploading ──> uploaded ──> notifying ──> (row deleted)
   │                 │                 │           │              │            │
   └──abandon────────┴─────────────────┴───────────┴──────────────┴────────────┴──> failed
                                                                                     (retryable; stage
                                                                                      remembers phase)
```

`writing` and `sealed` are what `ClaimStage` was. `queued`/`uploading` are
`pending`/`running`. `uploaded`/`notifying` are unchanged. `pushing`,
`enqueueing`, `blocked` and `queued`-the-handoff-state disappear — see §5.

## 3. Identity rules

This is the part that matters, and the part I want reviewed hardest.

**R1 — at most one live record per `(session_id, local_path)`**, enforced by
the partial unique index rather than by code that remembers to check.

**R2 — a new version of a file is a new record.** When a producer speaks for a
path that already has a live record:

| Existing stage | What happens |
|---|---|
| `writing` | refused. Reservations are exclusive (`wx`); a second writer is a bug, not a race. Today `beginActiveWrite` silently returns early, which is how two writers can share one claim. |
| `sealed`, `queued`, `uploading` | the old record is marked `superseded` and its in-flight upload cancelled; a new record is created. Its bytes were never all on the node, so nothing is lost by dropping it. |
| `uploaded`, `notifying` | a new record is created beside it. The old one keeps its wake — it delivered a real version and a caller is waiting to hear about it. **This is the pair AK1 collapsed into one map entry.** |

**R3 — every event names a record, never a path.** `noteDelivered(deliveryId)`,
`release(deliveryId, holder)`, `fail(deliveryId, …)`. A worker finishing
delivery *T* cannot touch delivery *U* for the same path, because it does not
have *U*'s id and never looks one up by path. AK1 becomes unrepresentable, and
Casey's "推进的必须是同一次交付" becomes a type signature instead of a
convention.

**R4 — the mirror asks one question of one table.** "Is there a live record at
or under this path, and is it `writing`?" `OWES_UPLOAD`, `OWED_TO_NODE`,
`stageOf`, `PendingSnapshot` and the `delivered` lookup status all go away.
`better-sqlite3` is synchronous, so this still happens with no `await` between
deciding to delete and deleting — the property §4.2 depends on.

**R5 — unreadable means protected.** If the table cannot be read, the mirror
prunes nothing and overwrites nothing. Both halves of the decision now fail the
same way, which is the point of having one authority; §1's unreported defect
goes with it.

## 4. Availability: what replaces `blocked` / `unavailable`

Today's `blocked` state, the three-valued `JobLookupResult`, the retry ladder
in `pending-handoffs.ts` and `retryFailedHandoffs` all exist for one reason:
the in-memory half kept working while the durable half was down, so a flow
could get halfway and then have to survive not knowing.

With one authority that case does not arise. Creating the record *is* the first
step of every flow:

- **Cannot write the record** → the operation fails before any bytes move. The
  file (if any) stays on disk and the mirror, equally unable to read, deletes
  nothing. Nothing is half-owned.
- **Record written, later step fails** → the row is there, in `failed`, with
  the phase it reached. The worker retries from that phase. This is durable, so
  unlike today it survives a restart, which closes part of §9.
- **Settings "could not be queued"** reads `stage = 'failed'` instead of
  `failedHandoffs()`; Retry Upload clears `next_attempt_at`. Same UI, now
  accurate across restarts.

That is a real behaviour change and I want it stated plainly rather than
buried: **a SQLite failure during `browser_download` will fail the download
instead of completing it into an in-memory holding pen.** I believe that is
correct — a desktop that cannot write SQLite cannot record the session either —
but it is a product decision, not only an engineering one.

## 5. What this deletes

| File | Now | After |
|---|---|---|
| `active-writes.ts` | 249 lines | gone |
| `pending-handoffs.ts` | 500 lines | ~120, a retry scheduler over the table; no map, no ladder, no tombstones |
| `artifact-transfer-service.ts` | 349 lines | ~250; `setPendingJobLookup`, `OWES_UPLOAD`, `reviveArtifactTransfer` gone |
| `db-artifact-transfers.ts` | 228 lines | replaced by `db-session-deliveries.ts`; old file kept unread for one release |
| `session-file-mirror.ts` | 549 lines | ~480; `stageOf`, `OWED_TO_NODE`, `PendingSource` gone |
| `host-action-sync.ts` | 509 lines | ~430; `owned`/`joined`/`releaseUndelivered` collapse to record ids |

Also deleted: `ClaimHolder`/`WRITER_TOKEN`'s two-party protocol
(`takeSealedClaim` vs `adoptWriteClaim` vs `abandonWriteClaim` — three
functions distinguishing who may end a claim, replaced by `holder` on the row),
and `JobLookupResult`'s four statuses.

## 6. Migration

Additive-only, per `apps/desktop/CLAUDE.md`:

1. New migration creates `session_file_deliveries` and copies unfinished rows
   out of `artifact_transfer_jobs` (`INSERT … SELECT`, mapping
   `pending→queued`, `running→uploading`, others unchanged, `origin='produced'`,
   `holder=NULL`). No `DROP`, no `RENAME`.
2. `artifact_transfer_jobs` is left in place and stops being written. Removing
   it is a separate release plus a `GRANDFATHERED` entry — expand/contract
   step 2, at least two releases later.
3. Bump `SCHEMA_VERSION`. `MIN_COMPATIBLE_SCHEMA_VERSION` does **not** move.

**Downgrade behaviour**, stated rather than assumed: an older build sees the
old table with the rows it had at upgrade time and re-uploads them (harmless —
`artifact.put` resumes by `transfer_id`). Deliveries created by the new build
are invisible to it, so those files stay on disk un-uploaded until the new
build runs again. That is the same exposure as today, where they live in memory
and an older build cannot see them either.

## 7. Open questions for review

1. **R2's `superseded` branch** drops an upload that may be most of the way
   through. Cheaper alternative: let the old record finish and mark the new one
   as owing a second delivery. I chose supersede because the node would end up
   with the old version last-written otherwise — but if a resume is nearly
   complete this wastes real bandwidth. Worth a size/offset threshold?
2. **§4's product decision** — failing a download on a SQLite error rather than
   holding it in memory. If that is unacceptable, the alternative is a
   write-ahead buffer, which reintroduces the second authority this whole
   proposal removes; I would rather not.
3. **`connection_id` nullable.** A file produced before any node is attached
   has no destination yet. Today `acquireHandoff` requires one. Making it
   nullable is what lets the record start at reservation, but it means "live
   record with no connection" is a state the worker must skip rather than
   claim. Is that the right place for that nullability?
4. **Order of work.** The current branch has AK1 and AJ2 open. I would rather
   land them as part of this — R3 makes AK1 unrepresentable and R4/§3 makes
   AJ2's phase loss impossible — than fix them twice. But that means the
   branch carries two known defects until the refactor lands.
