/**
 * What the session sync zone holds, as Settings shows it
 * (`docs/design/session-sync-zone.md` §9). There is no cap: a session's
 * artifacts are named by its transcript, and deleting them under pressure
 * is a decision for the person, so the numbers are shown and the sweep can
 * be run by hand.
 */
export interface SyncZoneUsage {
  /** `<userData>/sync` — where the numbers were taken. */
  root: string
  totalBytes: number
  /** Session directories, `adhoc` not counted. */
  sessionCount: number
  /** Captures taken with no session; pruned after seven days. */
  adhocBytes: number
  /** Desktop originals whose upload to their node has not finished. */
  pendingBytes: number
  /** What a reclaim sweep would remove right now: directories whose session is provably gone, plus stale adhoc captures. */
  reclaimable: { sessions: number; bytes: number }
  /**
   * Files that are complete and could not be written onto the transfer job
   * table at all — a busy database, a connection with no transfer service yet.
   * They are not `pendingBytes`: no job names them, so no worker will ever
   * pick them up, and they stay protected from the mirror until a retry
   * succeeds. Surfaced because the alternative is a zone that quietly stops
   * reclaiming with nothing to look at.
   */
  failedHandoffs: { files: number; bytes: number; lastError: string | null }
}

export interface SyncZoneReclaimResult {
  removed: string[]
  freedBytes: number
}
