import { getSharedCodexService } from '../../codex/codex-experiment-service'
import type { ForkContext, ForkSource } from '../types'

function resolveDropTrailingTurns(ctx: ForkContext): number {
  if (!ctx.forkFromMessageId) return 0
  const index = ctx.messages.findIndex((m) => m.id === ctx.forkFromMessageId)
  if (index < 0) return 0
  return ctx.messages.slice(index + 1).filter((m) => m.role === 'assistant').length
}

/**
 * Both calls run on one connection so `thread/rollback` sees the freshly-forked
 * thread. Unlike Claude, no rollout file is relocated: `thread/resume` finds a
 * thread by id and takes `cwd` as a request param, so a worktree fork just
 * resumes the new id with the worktree path later — `targetCwd` is unused here.
 */
export async function forkCodexThread(
  source: ForkSource,
  _targetCwd: string,
  ctx: ForkContext,
): Promise<string> {
  const dropTrailingTurns = resolveDropTrailingTurns(ctx)
  return getSharedCodexService().withAppServerRequest(source.projectPath, async (request) => {
    const forked = await request('thread/fork', { threadId: source.providerSessionId })
    const thread = forked.thread as { id?: unknown } | undefined
    const newThreadId = typeof thread?.id === 'string' ? thread.id : null
    if (!newThreadId) throw new Error('Codex thread/fork did not return a thread id')
    if (dropTrailingTurns > 0) {
      await request('thread/rollback', { threadId: newThreadId, numTurns: dropTrailingTurns })
    }
    return newThreadId
  })
}
