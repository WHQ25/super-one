/**
 * Where a trajectory read gets its runtime and its dsh session id.
 *
 * Shared by the window, paging, and payload channels so all three address the
 * same fold: reading the ledger from one id and its payloads from another would
 * answer with content from a different session's log.
 */

import { getSessionRecord } from '../session/session-repo'
import type { getDeepseekRuntime } from './deepseek-runtime-host'

/**
 * Resolve one SuperOne session to the dsh runtime and log id behind it.
 *
 * Callers address a SuperOne session; dsh keys its log — live map AND on-disk
 * transcript — by the harness-side id the backend minted for it. That id is
 * resolved from the DB rather than from the renderer's `_providerSessionId`,
 * which only the current run's event stream fills: a session reopened after a
 * restart has none until its next turn, and reading a session that already ran
 * is the whole point of the ledger.
 * @param sessionId - the SuperOne session id.
 * @returns the runtime and the dsh session id to address it with.
 */
export async function deepseekTrajectorySource(sessionId: string): Promise<{
  runtime: Awaited<ReturnType<typeof getDeepseekRuntime>>
  dshSessionId: string
}> {
  const dshSessionId = getSessionRecord(sessionId)?.providerSessionId ?? sessionId
  // Imported on demand: booting the dsh tree is the cost this module exists to
  // defer, and a session that never opens the panel should never pay it.
  const { getDeepseekRuntime } = await import('./deepseek-runtime-host')
  const runtime = await getDeepseekRuntime()
  return { runtime, dshSessionId }
}
