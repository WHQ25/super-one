/**
 * Who is working on a delivery right now
 * (`docs/design/session-sync-zone-delivery-record.md` §6).
 *
 * A holder is `'<incarnation>:<token>'`. The incarnation is minted once per
 * process start, so after a restart every holder written by the previous
 * process is dead by definition — no heartbeat, no idle timeout, and no
 * guessing from how long a row has sat in a phase: a download can sit in
 * `writing` for as long as the response takes.
 *
 * Within one process, liveness is exact: a holder is alive while its attempt
 * is running, from the moment it is minted until the attempt's real end —
 * success, failure, handover or abandon, in a `finally`. It is NOT retired by
 * a phase advance: `uploading → committing` is followed by an awaited final
 * put, and the holder is still working through it.
 *
 * This set is process-local liveness, like the transfer worker's abort map.
 * It is not delivery state; that lives only in the row.
 */
import { randomUUID } from 'node:crypto'

let incarnation = randomUUID()
const live = new Set<string>()

/** A fresh holder for one attempt, alive until `retireHolder`. */
export function mintHolder(): string {
  const holder = `${incarnation}:${randomUUID()}`
  live.add(holder)
  return holder
}

/** The attempt is over, however it ended. Idempotent. */
export function retireHolder(holder: string | null | undefined): void {
  if (holder) live.delete(holder)
}

/**
 * Alive means: this process minted it and the attempt has not ended. Anything
 * else — another incarnation, a retired token, no holder at all — is dead and
 * may be taken over.
 */
export function isHolderAlive(holder: string | null | undefined): boolean {
  return !!holder && live.has(holder)
}

/** Tests only: a new process, as far as holders are concerned. */
export function _resetHoldersForTests(): void {
  incarnation = randomUUID()
  live.clear()
}
