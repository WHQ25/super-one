import { randomUUID } from 'node:crypto'
import { getDeepseekRuntime } from '../../deepseek/deepseek-runtime-host'
import type { ForkContext, ForkSource } from '../types'

/**
 * Resolve SuperOne's fork point to a dsh event seq.
 *
 * The mapper stamps each completed assistant message with the seq that closed
 * its turn (`metadata.forkAnchorId`), which is the inclusive boundary dsh forks
 * at. A user message carries no seq of its own, so the fork lands on the last
 * assistant message before it — the branch then continues from exactly where
 * the user was about to speak.
 */
function resolveBoundary(ctx: ForkContext): number | undefined {
  if (!ctx.forkFromMessageId) return undefined
  const index = ctx.messages.findIndex((message) => message.id === ctx.forkFromMessageId)
  if (index < 0) return undefined
  for (let cursor = index; cursor >= 0; cursor--) {
    const anchor = ctx.messages[cursor]?.metadata?.forkAnchorId
    if (anchor === undefined) continue
    const seq = Number(anchor)
    if (Number.isSafeInteger(seq) && seq >= 0) return seq
  }
  // Nothing completed before the fork point: fall through to a full-log fork
  // rather than refusing, since an empty prefix cannot be resumed anyway.
  return undefined
}

/**
 * Fork a dsh session by copying its log prefix into a new session id.
 *
 * `targetCwd` is deliberately unused: dsh sessions carry their cwd in the
 * session header, and SuperOne's new session record supplies the worktree path
 * the child agent starts in.
 */
export async function forkDeepseekTranscript(
  source: ForkSource,
  _targetCwd: string,
  ctx: ForkContext,
): Promise<string> {
  const runtime = await getDeepseekRuntime()
  return runtime.forkSession(source.providerSessionId, randomUUID(), resolveBoundary(ctx))
}
