/**
 * Codex App Server thread fork — shared by desktop and node CLI.
 *
 * Preferred path: `thread/fork { lastTurnId }` (0.143+).
 * Legacy transcripts: resolve the trailing-turn boundary, then fork before it.
 *
 * Unlike Claude, no rollout file is relocated — `thread/resume` finds threads by id
 * and takes `cwd` as a request param.
 */

export type CodexRpcRequest = (
  method: string,
  params?: Record<string, unknown>,
) => Promise<Record<string, unknown>>

export interface ForkCodexThreadInput {
  request: CodexRpcRequest
  /** Source Codex thread id. */
  threadId: string
  /**
   * Inclusive turn id for the fork anchor (preferred).
   * When set, trailing-turn boundary resolution is skipped.
   */
  lastTurnId?: string
  /**
   * Number of trailing assistant turns to exclude when
   * lastTurnId is unavailable (legacy path).
   */
  dropTrailingTurns?: number
}

/** Resolve the oldest excluded turn without loading its item payloads. */
async function resolveBeforeTurnId(request: CodexRpcRequest, threadId: string, drop: number): Promise<string> {
  let remaining = drop
  let beforeTurnId: string | undefined
  let cursor: string | undefined
  const seenCursors = new Set<string>()
  do {
    const page = await request('thread/turns/list', {
      threadId,
      sortDirection: 'desc',
      itemsView: 'notLoaded',
      limit: Math.min(remaining, 100),
      ...(cursor ? { cursor } : {}),
    })
    const turns = Array.isArray(page.data) ? page.data : []
    for (const turn of turns.slice(0, remaining)) {
      const id = (turn as { id?: unknown } | null)?.id
      if (typeof id !== 'string' || !id) throw new Error('Codex fork boundary has no turn id')
      beforeTurnId = id
      remaining -= 1
    }
    cursor = typeof page.nextCursor === 'string' && page.nextCursor ? page.nextCursor : undefined
    if (remaining > 0 && cursor) {
      if (!turns.length || seenCursors.has(cursor)) throw new Error('Codex fork boundary pagination did not advance')
      seenCursors.add(cursor)
    }
  } while (remaining > 0 && cursor)
  if (!beforeTurnId) throw new Error('Codex fork boundary could not be resolved from source history')
  return beforeTurnId
}

/**
 * Fork a Codex thread; returns the new thread id.
 */
export async function forkCodexThread(input: ForkCodexThreadInput): Promise<string> {
  const threadId = input.threadId?.trim()
  if (!threadId) {
    throw new Error('Codex thread id is required to fork')
  }

  const drop = input.lastTurnId ? 0 : Math.max(0, input.dropTrailingTurns ?? 0)
  if (!Number.isSafeInteger(drop)) throw new Error('Codex trailing-turn count must be a finite integer')
  const beforeTurnId = drop > 0 ? await resolveBeforeTurnId(input.request, threadId, drop) : undefined
  const forked = await input.request('thread/fork', {
    threadId,
    ...(input.lastTurnId ? { lastTurnId: input.lastTurnId } : {}),
    ...(beforeTurnId ? { beforeTurnId } : {}),
  })
  const thread = forked.thread as { id?: unknown } | undefined
  const newThreadId = typeof thread?.id === 'string' ? thread.id : null
  if (!newThreadId) {
    throw new Error('Codex thread/fork did not return a thread id')
  }

  return newThreadId
}
