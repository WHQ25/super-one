/**
 * Codex App Server thread fork — shared by desktop and node CLI.
 *
 * Preferred path: `thread/fork { lastTurnId }` (0.143+).
 * Fallback: `thread/fork` + `thread/rollback { numTurns }` on the same connection.
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
   * When set, trailing-turn rollback is skipped.
   */
  lastTurnId?: string
  /**
   * Number of trailing assistant turns to drop via thread/rollback when
   * lastTurnId is unavailable (legacy path).
   */
  dropTrailingTurns?: number
}

/**
 * Fork a Codex thread; returns the new thread id.
 */
export async function forkCodexThread(input: ForkCodexThreadInput): Promise<string> {
  const threadId = input.threadId?.trim()
  if (!threadId) {
    throw new Error('Codex thread id is required to fork')
  }

  const forked = await input.request('thread/fork', {
    threadId,
    ...(input.lastTurnId ? { lastTurnId: input.lastTurnId } : {}),
  })
  const thread = forked.thread as { id?: unknown } | undefined
  const newThreadId = typeof thread?.id === 'string' ? thread.id : null
  if (!newThreadId) {
    throw new Error('Codex thread/fork did not return a thread id')
  }

  const drop = input.lastTurnId ? 0 : Math.max(0, input.dropTrailingTurns ?? 0)
  if (drop > 0) {
    await input.request('thread/rollback', { threadId: newThreadId, numTurns: drop })
  }
  return newThreadId
}
