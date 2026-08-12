/**
 * One outbox item during reconnect flush. Re-checks the queue around the
 * network upsert so a user delete mid-flight cannot be resurrected.
 */

import type { DraftUpsertRequest } from '@superone/shared/environment'

export type FlushItemResult = 'skipped' | 'flushed' | 'failed' | 'undone'

export interface FlushItemDeps {
  isStillQueued: (draftId: string) => boolean
  upsert: (draft: DraftUpsertRequest) => Promise<void>
  /** Called when upsert finished but the user already deleted the pending row. */
  remoteDelete: (draftId: string) => Promise<void>
  dequeue: (draftId: string) => void
  recordFailure: (draftId: string, error: string) => void
}

export async function flushPendingDraftItem(
  draft: DraftUpsertRequest,
  deps: FlushItemDeps,
): Promise<FlushItemResult> {
  if (!deps.isStillQueued(draft.id)) return 'skipped'
  try {
    await deps.upsert(draft)
    if (!deps.isStillQueued(draft.id)) {
      await deps.remoteDelete(draft.id).catch(() => {})
      return 'undone'
    }
    deps.dequeue(draft.id)
    return 'flushed'
  } catch (err) {
    deps.recordFailure(draft.id, err instanceof Error ? err.message : String(err))
    return 'failed'
  }
}
