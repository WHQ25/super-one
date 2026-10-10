import { OPERATION_SCOPES } from '@superone/shared/environment'
import type { RpcContext, RpcResult } from './rpc-context'
import { asRecord, mapThrown, requireScopes } from './rpc-helpers'
import { deliverLoad, subscribeDetail } from './session-delivery'
import { unsupportedMethodError } from './unsupported'

/** Session metadata; presence reads can omit the transcript body. */
export function handleSessionGet(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readSession)
  if (denied) return denied
  const sessionId = String(asRecord(payload).sessionId ?? '')
  if (!ctx.sessions) return mapThrown(unsupportedMethodError('session.get'))
  const session = ctx.sessions.get(sessionId)
  const config = session?.harnessId === 'acp' ? ctx.sessionProviders?.get(session.providerId)?.config as { agentId?: string } | undefined : undefined
  if (!session) return { result: null }
  const { transcript, ...metadata } = session
  return { result: { ...metadata, ...(asRecord(payload).includeTranscript === false ? {} : { transcript }),
    ...(session.harnessId === 'acp' ? { acpAgentId: config?.agentId ?? null } : {}) } }
}

/** A session's reduced state and newest messages, with the version they reflect. */
export async function handleSessionLoad(payload: unknown, ctx: RpcContext): Promise<RpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readSession)
  if (denied) return denied
  const sessions = ctx.sessions
  if (!sessions) return mapThrown(unsupportedMethodError('session.load'))
  const p = asRecord(payload)
  const sessionId = String(p.sessionId ?? '').trim()
  if (!sessionId) return { error: { code: 'invalid_argument', message: 'sessionId required' } }
  if (p.projectId !== undefined) {
    if (typeof p.projectId !== 'string' || !p.projectId) return { error: { code: 'invalid_argument', message: 'projectId must be a non-empty string' } }
    if (sessions.get(sessionId)?.projectId !== p.projectId) return { error: { code: 'not_found', message: 'session not found in project' } }
  }
  if (p.before != null && typeof p.before !== 'number') return { error: { code: 'invalid_argument', message: 'before must be a non-negative integer' } }
  if (p.limit !== undefined && typeof p.limit !== 'number') return { error: { code: 'invalid_argument', message: 'limit must be a positive integer' } }
  if (p.includeState !== undefined && typeof p.includeState !== 'boolean') return { error: { code: 'invalid_argument', message: 'includeState must be boolean' } }
  if (p.anchorId !== undefined && typeof p.anchorId !== 'string') return { error: { code: 'invalid_argument', message: 'anchorId must be a string' } }
  if (p.direction !== undefined && p.direction !== 'around' && p.direction !== 'before' && p.direction !== 'after') return { error: { code: 'invalid_argument', message: 'direction must be around|before|after' } }
  try {
    const loaded = await sessions.load({
      sessionId,
      includeState: p.includeState as boolean | undefined,
      before: typeof p.before === 'number' ? p.before : null,
      limit: typeof p.limit === 'number' ? p.limit : undefined,
      anchorId: typeof p.anchorId === 'string' ? p.anchorId : undefined,
      direction: p.direction as 'around' | 'before' | 'after' | undefined,
    })
    return { result: deliverLoad(loaded, ctx.streams?.delivery) }
  } catch (err) {
    return mapThrown(err)
  }
}

/** Expand a row of a session this connection loaded summarized; packets follow as `detail` messages. */
export function handleSessionSubscribeDetail(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readSession)
  if (denied) return denied
  const sessions = ctx.sessions
  if (!sessions) return mapThrown(unsupportedMethodError('session.subscribeDetail'))
  const delivery = ctx.streams?.delivery
  if (!delivery) return { error: { code: 'failed_precondition', message: 'session.subscribeDetail needs a socket connection' } }
  const p = asRecord(payload)
  const sessionId = String(p.sessionId ?? '').trim()
  const detailRef = String(p.detailRef ?? '')
  const subscriptionId = String(p.subscriptionId ?? '').trim()
  if (!sessionId || !detailRef || !subscriptionId) return { error: { code: 'invalid_argument', message: 'sessionId, detailRef and subscriptionId required' } }
  try {
    return { result: subscribeDetail(delivery, sessions, { sessionId, detailRef, subscriptionId }) }
  } catch (err) {
    return mapThrown(err)
  }
}

export function handleSessionUnsubscribeDetail(payload: unknown, ctx: RpcContext): RpcResult {
  const p = asRecord(payload)
  ctx.streams?.delivery?.views.unsubscribe(String(p.sessionId ?? '').trim(), String(p.subscriptionId ?? '').trim())
  return { result: { ok: true } }
}
