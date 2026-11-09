/**
 * Settling a parent also settles its spawn children. That must not run while
 * a child still has an open turn: the parent stays active and nothing is
 * settled. Idle and errored children do not block.
 */
export function runningChildSettleMessage(sessionId: string, runningChildIds: readonly string[]): string {
  return `Cannot settle ${sessionId} while a spawn child is running (${runningChildIds.join(', ')}).`
}

export function runningChildSettleError(sessionId: string, runningChildIds: readonly string[]): Error {
  const ids = [...runningChildIds]
  return Object.assign(new Error(runningChildSettleMessage(sessionId, ids)), {
    code: 'failed_precondition' as const,
    runningChildIds: ids,
    details: { runningChildIds: ids },
  })
}

/** Child ids from {@link runningChildSettleError}, or null for any other failure. */
export function runningChildIdsFromSettleError(err: unknown): string[] | null {
  if (!err || typeof err !== 'object') return null
  const ids = (err as { runningChildIds?: unknown }).runningChildIds
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== 'string')) return null
  return ids
}
