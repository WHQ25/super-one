/**
 * Zone files this desktop is producing but has not yet handed to the transfer
 * service (`docs/design/session-sync-zone.md` §4.1).
 *
 * The transfer job table is the durable record of "the node is owed these
 * bytes", and every destructive step of the mirror consults it. But a job only
 * exists once a file is finished *and* enqueued. `browser_download` reserves
 * its path, streams into it for however long the response takes, and is handed
 * on at the end — so for the whole of the transfer, plus the gap between
 * sealing and enqueueing, the file is real, is the only copy, and is invisible
 * to the table. A directory mirror running in that window sees a member the
 * node never listed and prunes it: the download's own bytes, deleted while
 * they are being written.
 *
 * This registry covers exactly that gap. Three properties shape it:
 *
 * - **In-process, because the gap is in-process.** The writer, the mirror and
 *   the transfer service all live in the main process. A synchronous Map is
 *   therefore both sufficient and necessary — the mirror's guards deliberately
 *   have no `await` between deciding to delete and deleting, so whatever they
 *   consult must answer without one.
 * - **Two stages, not one flag.** A file being *written* is incomplete: protect
 *   it, but never hand it to a caller as an input. A file that is *sealed* and
 *   waiting to be enqueued is complete and is the newest copy anywhere, so it
 *   is served exactly like a pending upload. Collapsing the two would either
 *   leak half a download to an agent or drop the protection at the seal.
 * - **Counted, so overlapping claims compose.** A path can be claimed twice (a
 *   reservation that is later adopted); releasing on the first `end` would
 *   unprotect it while the second writer is still going.
 *
 * Claims are only taken for paths inside a session zone. A local session's
 * download lands in the user's Downloads folder, which no mirror ever walks.
 */
import { basename, dirname, resolve } from 'node:path'
import { realOrSelf } from './sync-zone-paths'

/** Where a claimed path is in its life. `writing` wins over `sealed` if both are held. */
export type ActiveWriteStage = 'writing' | 'sealed'

interface Claim {
  writing: number
  sealed: number
}

const claims = new Map<string, Claim>()

/**
 * One spelling for a path, so the writer and the mirror agree.
 *
 * Only the directory is resolved. The file itself may not exist yet — a
 * reservation is an empty `wx` create that a stream then fills — and
 * `realpath` on a missing path throws.
 */
function keyFor(sessionId: string, path: string): string {
  const abs = resolve(path)
  return `${sessionId}\t${resolve(realOrSelf(dirname(abs)), basename(abs))}`
}

/**
 * Claim `path` as being written, from the moment it is reserved.
 *
 * The claim has to outlive the tool call: a page-started download finishes
 * long after the Host Action that opened the tab has returned, and releasing
 * at the call boundary would reopen the window for the rest of the transfer.
 */
export function beginActiveWrite(sessionId: string | null | undefined, path: string): void {
  if (!sessionId) return
  const key = keyFor(sessionId, path)
  const claim = claims.get(key) ?? { writing: 0, sealed: 0 }
  claim.writing += 1
  claims.set(key, claim)
}

/**
 * The bytes are all there, but nothing durable knows about the file yet.
 * It stays protected — and becomes servable — until `endActiveWrite`.
 */
export function sealActiveWrite(sessionId: string | null | undefined, path: string): void {
  if (!sessionId) return
  const claim = claims.get(keyFor(sessionId, path))
  if (!claim || claim.writing <= 0) return
  claim.writing -= 1
  claim.sealed += 1
}

/**
 * Release a claim. Call it only once the file is durably accounted for — the
 * eager push finished, or a transfer job row exists — or once the write has
 * failed and there is nothing left to protect. A sealed claim is released
 * first, so an abandoned write and a completed one both drain.
 */
export function endActiveWrite(sessionId: string | null | undefined, path: string): void {
  if (!sessionId) return
  const key = keyFor(sessionId, path)
  const claim = claims.get(key)
  if (!claim) return
  if (claim.sealed > 0) claim.sealed -= 1
  else if (claim.writing > 0) claim.writing -= 1
  if (claim.writing <= 0 && claim.sealed <= 0) claims.delete(key)
}

/** What this desktop is doing to `path` right now, if anything. */
export function activeWriteAt(sessionId: string, path: string): ActiveWriteStage | null {
  const claim = claims.get(keyFor(sessionId, path))
  if (!claim) return null
  return claim.writing > 0 ? 'writing' : 'sealed'
}

/**
 * The strongest claim held on `path` or anything under it.
 *
 * A directory is destroyed as a unit — by the prune or by type reconciliation
 * — so it has to answer for its members. `writing` wins over `sealed`: a
 * directory holding one half-written file cannot be handed over whole.
 */
export function activeWriteUnder(sessionId: string, path: string): ActiveWriteStage | null {
  const key = keyFor(sessionId, path)
  const prefix = `${key}/`
  let found: ActiveWriteStage | null = null
  for (const [held, claim] of claims) {
    if (held !== key && !held.startsWith(prefix)) continue
    if (claim.writing > 0) return 'writing'
    if (claim.sealed > 0) found = 'sealed'
  }
  return found
}

/** Run `write` with `path` claimed, releasing it however the work ends. */
export async function withActiveWrite<T>(sessionId: string | null | undefined, path: string, write: () => Promise<T>): Promise<T> {
  beginActiveWrite(sessionId, path)
  try {
    return await write()
  } finally {
    endActiveWrite(sessionId, path)
  }
}

/** Tests only. */
export function resetActiveWrites(): void {
  claims.clear()
}
