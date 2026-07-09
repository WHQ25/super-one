import { getSharedCodexService } from '../../codex/codex-experiment-service'
import type { ForkContext, ForkSource } from '../types'

/** Codex turn id of the message to fork through (inclusive), if persisted on it. */
function resolveLastTurnId(ctx: ForkContext): string | undefined {
  if (!ctx.forkFromMessageId) return undefined
  const msg = ctx.messages.find((m) => m.id === ctx.forkFromMessageId)
  return msg?.metadata?.codex?.turnId
}

function resolveDropTrailingTurns(ctx: ForkContext): number {
  if (!ctx.forkFromMessageId) return 0
  const index = ctx.messages.findIndex((m) => m.id === ctx.forkFromMessageId)
  if (index < 0) return 0
  return ctx.messages.slice(index + 1).filter((m) => m.role === 'assistant').length
}

/**
 * Fork a Codex thread through `forkFromMessageId` (inclusive).
 *
 * Preferred path (0.143+): a single `thread/fork { lastTurnId }` — turns after
 * the anchor turn are omitted from the fork. Requires the anchor message to
 * carry a persisted `metadata.codex.turnId`.
 *
 * Fallback: messages persisted before turnId plumbing (or a non-assistant
 * anchor) have no turnId, so drop back to the deprecated `thread/fork` +
 * `thread/rollback { numTurns }` two-step. Both calls run on one connection so
 * `thread/rollback` sees the freshly-forked thread.
 *
 * Unlike Claude, no rollout file is relocated: `thread/resume` finds a thread by
 * id and takes `cwd` as a request param, so a worktree fork just resumes the new
 * id with the worktree path later — `targetCwd` is unused here.
 */
export async function forkCodexThread(
  source: ForkSource,
  _targetCwd: string,
  ctx: ForkContext,
): Promise<string> {
  const lastTurnId = resolveLastTurnId(ctx)
  const dropTrailingTurns = lastTurnId ? 0 : resolveDropTrailingTurns(ctx)
  return getSharedCodexService().withAppServerRequest(source.projectPath, async (request) => {
    const forked = await request('thread/fork', {
      threadId: source.providerSessionId,
      ...(lastTurnId ? { lastTurnId } : {}),
    })
    const thread = forked.thread as { id?: unknown } | undefined
    const newThreadId = typeof thread?.id === 'string' ? thread.id : null
    if (!newThreadId) throw new Error('Codex thread/fork did not return a thread id')
    if (dropTrailingTurns > 0) {
      await request('thread/rollback', { threadId: newThreadId, numTurns: dropTrailingTurns })
    }
    return newThreadId
  })
}
