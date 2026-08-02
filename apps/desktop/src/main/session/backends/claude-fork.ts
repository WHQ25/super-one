/**
 * Desktop adapter over shared `@superone/claude` SDK fork.
 * Resolves ChatMessage.metadata.forkAnchorId → upToMessageId for truncation.
 */
import { forkClaudeTranscript as coreForkClaudeTranscript } from '@superone/claude'
import type { ForkContext, ForkSource } from '../types'

function resolveUpToMessageId(ctx: ForkContext): string | undefined {
  if (!ctx.forkFromMessageId) return undefined
  const msg = ctx.messages.find((m) => m.id === ctx.forkFromMessageId)
  return msg?.metadata?.forkAnchorId
}

/**
 * Fork a Claude SDK transcript and relocate the new `.jsonl` into `targetCwd`'s
 * project directory, so a plain `resume` with `cwd=targetCwd` finds it.
 */
export async function forkClaudeTranscript(
  source: ForkSource,
  targetCwd: string,
  ctx: ForkContext,
): Promise<string> {
  return coreForkClaudeTranscript({
    providerSessionId: source.providerSessionId,
    targetCwd,
    upToMessageId: resolveUpToMessageId(ctx),
  })
}
