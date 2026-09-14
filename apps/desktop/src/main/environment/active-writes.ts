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
 * ## A claim is owned
 *
 * The first version of this registry let anyone release anything, and every
 * caller that could plausibly be "the end" released in a `finally`. That is
 * wrong in both directions at once, and both were real defects:
 *
 * - A Host Action that returns while a download it started is still streaming
 *   (the tool went background on its deadline) would release a claim whose
 *   writer is still running — reopening the exact window this file exists to
 *   close.
 * - A `defer` that failed still released, so the only complete copy of a file
 *   became prunable with no job row naming it anywhere.
 *
 * So a claim names its **holder**, and only that holder can end it. Handing
 * responsibility on is an explicit `adoptWriteClaim`, which fails when the
 * file is still being written (there is nothing to take yet) or when someone
 * else already took it. "This path appeared in the reply" is not ownership.
 *
 * ## Two stages
 *
 * A file being *written* is incomplete: protected from every destructive step,
 * and refused as a tool input rather than handed over half-finished. A file
 * that is *sealed* and not yet enqueued is complete and is the newest copy
 * anywhere, so the mirror serves it exactly like a pending upload.
 *
 * The registry is in-process because the gap is in-process — the writer, the
 * mirror and the transfer service all live in the main process — and
 * synchronous because the mirror's guards deliberately have no `await` between
 * deciding to delete and deleting.
 *
 * Claims are only taken for paths inside a session zone: a local session's
 * download lands in the user's Downloads folder, which no mirror ever walks.
 */
import { basename, dirname, resolve } from 'node:path'
import { realOrSelf } from './sync-zone-paths'

/** Where a claimed path is in its life. */
export type ClaimStage = 'writing' | 'sealed'

/**
 * An opaque token identifying who holds a claim — not a role.
 *
 * A role label was not enough. Two concurrent Host Actions both called
 * themselves `push`, both recorded the same path as theirs, and cancelling
 * either one released the file the other was still delivering. A token is
 * minted per holder, so a release names an instance rather than a kind of
 * caller and cannot be satisfied by a different one.
 *
 * The producer that reserved a path uses `WRITER_TOKEN`: reservations are
 * exclusive (`wx`), so there is never more than one writer for a path.
 * Everything downstream gets a fresh token from the transfer instance that
 * owns delivery (`pending-handoffs.ts`).
 */
export type ClaimHolder = string

/** The producer that reserved the path; unique by construction. */
export const WRITER_TOKEN = 'writer'

interface Claim {
  stage: ClaimStage
  holder: ClaimHolder
}

const claims = new Map<string, Claim>()

/**
 * One spelling for a path, so the writer and the mirror agree.
 *
 * Only the directory is resolved. The file itself may not exist yet — a
 * reservation is an empty `wx` create that a stream then fills — and
 * `realpath` on a missing path throws.
 *
 * Exported because the pending-handoff table keys on the same path and the two
 * must agree: a handoff filed under one spelling and looked up under another
 * silently protects nothing.
 */
export function canonicalClaimPath(path: string): string {
  const abs = resolve(path)
  return resolve(realOrSelf(dirname(abs)), basename(abs))
}

function keyFor(sessionId: string, path: string): string {
  return `${sessionId}\t${canonicalClaimPath(path)}`
}

/**
 * Claim `path` as being written, from the moment it is reserved. The writer
 * holds it until it seals and someone adopts, or until it abandons.
 *
 * Reservations are exclusive (`wx`), so two writers never share a path and the
 * claim needs no reference count — an existing claim is left exactly as it is.
 */
export function beginActiveWrite(sessionId: string | null | undefined, path: string): void {
  if (!sessionId) return
  const key = keyFor(sessionId, path)
  if (claims.has(key)) return
  claims.set(key, { stage: 'writing', holder: WRITER_TOKEN })
}

/**
 * The bytes are all there, but nothing durable knows about the file yet. It
 * stays protected — and becomes servable — and the writer still holds it until
 * a handoff adopts it.
 */
export function sealActiveWrite(sessionId: string | null | undefined, path: string): void {
  if (!sessionId) return
  const claim = claims.get(keyFor(sessionId, path))
  if (claim) claim.stage = 'sealed'
}

/**
 * Take responsibility for a sealed file, so the taker is the one that ends the
 * claim once the file is durably accounted for.
 *
 * Returns false — meaning "not yours to end" — when there is no claim, when
 * the file is still being written, or when another holder already took it.
 * Both refusals matter: the first is a Host Action releasing a download that
 * is still streaming, the second is two handoffs racing to release one file.
 */
export function adoptWriteClaim(sessionId: string | null | undefined, path: string, holder: ClaimHolder): boolean {
  if (!sessionId) return false
  const claim = claims.get(keyFor(sessionId, path))
  if (!claim || claim.stage !== 'sealed' || claim.holder !== WRITER_TOKEN) return false
  claim.holder = holder
  return true
}

/**
 * Take a sealed claim for a file that must stay protected, creating one when
 * the producer never made a claim at all.
 *
 * This is the difference between recording a problem and doing something about
 * it. Only downloads reserve a path and therefore only downloads have a claim;
 * a screenshot or a generated image is simply written and registered. When one
 * of *those* cannot be filed as a transfer job, there was nothing to adopt —
 * so `adoptWriteClaim` answered false and the file was left unprotected with a
 * neat record of its own deletion.
 *
 * Refused while a writer is still filling the file — a handoff for a file that
 * is not finished is a contradiction, and taking it would let an incomplete
 * file be served as a complete original — and refused when another token
 * already holds it, so a second caller joins the first instead of taking over.
 */
export function takeSealedClaim(sessionId: string | null | undefined, path: string, holder: ClaimHolder): boolean {
  if (!sessionId) return false
  const key = keyFor(sessionId, path)
  const claim = claims.get(key)
  if (!claim) {
    claims.set(key, { stage: 'sealed', holder })
    return true
  }
  if (claim.stage === 'writing') return false
  if (claim.holder !== WRITER_TOKEN && claim.holder !== holder) return false
  claim.holder = holder
  return true
}

/**
 * End a claim. Only the current holder may: a release from anyone else is
 * refused, which is what stops a `finally` from freeing a file whose writer is
 * still running. Returns whether it released.
 *
 * Call it only once the file is durably accounted for — the push landed, or a
 * job row exists. A handoff that failed must NOT release: the alternative to
 * pinning a path is losing the only complete copy of the file.
 */
export function releaseWriteClaim(sessionId: string | null | undefined, path: string, holder: ClaimHolder): boolean {
  if (!sessionId) return false
  const key = keyFor(sessionId, path)
  const claim = claims.get(key)
  if (!claim || claim.holder !== holder) return false
  claims.delete(key)
  return true
}

/**
 * The writer gives up: the download was cancelled, or it threw before sealing.
 * There is nothing to hand on and nothing to protect, and holding the claim
 * would pin a stub the mirror could never prune. Refused once a handoff has
 * adopted the file — at that point it is not the writer's to abandon.
 */
export function abandonWriteClaim(sessionId: string | null | undefined, path: string): boolean {
  return releaseWriteClaim(sessionId, path, WRITER_TOKEN)
}

/** What this desktop is doing to `path` right now, if anything. */
export function activeWriteAt(sessionId: string, path: string): ClaimStage | null {
  return claims.get(keyFor(sessionId, path))?.stage ?? null
}

/**
 * The strongest claim held on `path` or anything under it.
 *
 * A directory is destroyed as a unit — by the prune or by type reconciliation
 * — and is handed to a tool as a unit, so it has to answer for its members.
 * `writing` wins over `sealed`: a directory holding one half-written file
 * cannot be pruned around *or* handed over whole.
 */
export function activeWriteUnder(sessionId: string, path: string): ClaimStage | null {
  const key = keyFor(sessionId, path)
  const prefix = `${key}/`
  let found: ClaimStage | null = null
  for (const [held, claim] of claims) {
    if (held !== key && !held.startsWith(prefix)) continue
    if (claim.stage === 'writing') return 'writing'
    found = 'sealed'
  }
  return found
}

/** Tests only. */
export function resetActiveWrites(): void {
  claims.clear()
}
