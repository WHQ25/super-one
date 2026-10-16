import { OPERATION_SCOPES } from '@superone/shared/environment'
import { parseSuggestedTaskChoice } from '@superone/shared/suggested-task'
import { mapThrown, requireScopes } from '@superone/runtime/server/rpc-helpers'
import type { RpcResult } from '@superone/runtime/server'
import type { RpcContext } from './handlers'

export const SUGGESTED_TASK_RPC_METHODS = new Set(['session.suggestedTaskLaunchOptions', 'session.launchSuggestedTask'])

export async function dispatchSuggestedTaskRpc(method: string, payload: unknown, ctx: RpcContext): Promise<RpcResult | null> {
  if (!SUGGESTED_TASK_RPC_METHODS.has(method)) return null
  const reading = method === 'session.suggestedTaskLaunchOptions'
  const denied = requireScopes(ctx.client, reading ? OPERATION_SCOPES.readSession : OPERATION_SCOPES.operateSession)
  if (denied) return denied
  const input = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const text = (key: string) => {
    const value = input[key]
    if (typeof value !== 'string' || !value.trim()) throw Object.assign(new Error(`${key} required`), { code: 'invalid_argument' })
    return value
  }
  try {
    const sessionId = text('sessionId'), taskId = text('taskId')
    if (reading) return { result: await ctx.collaboration.suggestedTaskLaunchOptions(sessionId, taskId) }
    const leaseId = text('leaseId'), generation = text('generation')
    const assertControl = () => ctx.leases.assertValid({ resource: { environmentId: ctx.identity.environmentId, sessionId }, leaseId, generation, holderClientId: ctx.client.clientSessionId })
    assertControl()
    return { result: await ctx.collaboration.launchSuggestedTask(sessionId, taskId, parseSuggestedTaskChoice(input.choice), assertControl, ctx.client.clientSessionId) }
  } catch (error) { return mapThrown(error) }
}
