import type { HarnessId } from '@superone/shared/agent-types'
import log from '../logger'
import { currentControlScope } from './control-context'
import type { SessionLease } from './session-lease'
import type { SessionBackend, SessionStatus } from './types'

export function supportsSessionRecapHarness(harnessId: HarnessId): boolean {
  return harnessId === 'acp-grok'
}

export async function runSessionRecapRequest(
  auto: boolean,
  ctx: {
    id: string
    harnessId: HarnessId
    status: SessionStatus
    messageCount: number
    lease: SessionLease
    backend: SessionBackend
  },
): Promise<boolean> {
  if (auto && !currentControlScope() && ctx.lease.isExternal) return false
  ctx.lease.assertMutation()
  if (ctx.status === 'disposed') return false
  if (!supportsSessionRecapHarness(ctx.harnessId)) return false
  if (ctx.messageCount === 0) return false
  if (ctx.status === 'streaming' || ctx.status === 'starting' || ctx.status === 'interrupting') {
    return false
  }
  if (ctx.backend.getPendingInteractions().length > 0) return false
  if (!ctx.backend.hasActiveRuntime()) return false
  try {
    return (await ctx.backend.requestSessionRecap?.(auto)) ?? false
  } catch (err) {
    log.debug(
      '[Session] requestSessionRecap failed sid=%s: %s',
      ctx.id,
      err instanceof Error ? err.message : String(err),
    )
    return false
  }
}
