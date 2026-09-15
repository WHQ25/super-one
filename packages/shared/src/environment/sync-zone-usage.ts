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
   * Complete files whose automatic delivery gave up but which a person CAN
   * retry: the upload failed every attempt, or the local file went missing and
   * came back. They are not `pendingBytes` — no worker is scheduled for them —
   * and stay protected from the mirror until Retry Upload succeeds.
   */
  failedHandoffs: { files: number; bytes: number; lastError: string | null }
  /**
   * Complete files whose final upload chunk was sent but never confirmed
   * (`committing`, §6): from this desktop the node's copy cannot be told apart
   * from committed-or-not, so retrying would risk overwriting a file the agent
   * changed. Retry does nothing for these; they need re-delivery under a new
   * path (re-running the action that produced them). Shown separately so the
   * page never offers a button that cannot help.
   */
  needsRedelivery: { files: number; bytes: number }
}

export interface SyncZoneReclaimResult {
  removed: string[]
  freedBytes: number
}
