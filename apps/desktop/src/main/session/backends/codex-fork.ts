/**
 * Desktop adapter over shared `@superone/codex` thread fork.
 * Uses one disposable app-server so fork + optional rollback share a connection,
 * then releases Codex's writer for the new thread before the session can resume it.
 */
import { forkCodexThread as coreForkCodexThread } from '@superone/codex'
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
 * See packages/codex/src/fork-thread.ts for protocol details.
 */
export async function forkCodexThread(
  source: ForkSource,
  _targetCwd: string,
  ctx: ForkContext,
): Promise<string> {
  const lastTurnId = resolveLastTurnId(ctx)
  const dropTrailingTurns = lastTurnId ? 0 : resolveDropTrailingTurns(ctx)
  return getSharedCodexService().withEphemeralAppServerRequest(source.projectPath, async (request) =>
    coreForkCodexThread({
      request: (method, params) => request(method, params ?? {}),
      threadId: source.providerSessionId,
      lastTurnId,
      dropTrailingTurns,
    }),
  )
}
