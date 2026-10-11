import { OPERATION_SCOPES } from '@superone/shared/environment'
import { SESSION_OPERATION_METHODS, SESSION_OPERATION_READS, SESSION_LIST_OPERATION_METHODS } from '@superone/shared/environment/session-operations'
import { asRecord, mapThrown, requireScopes } from './rpc-helpers'
import type { RpcContext, RpcResult } from './rpc-context'

function requiredText(input: Record<string, unknown>, field: string): string {
  const value = input[field]
  if (typeof value !== 'string' || !value.trim()) throw Object.assign(new Error(`${field} required`), { code: 'invalid_argument' })
  return value
}

async function callOperation(payload: unknown, ctx: RpcContext, method: string): Promise<RpcResult> {
  const denied = requireScopes(ctx.client, SESSION_OPERATION_READS.has(method) ? OPERATION_SCOPES.readSession : OPERATION_SCOPES.operateSession)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    const sessionId = requiredText(p, 'sessionId')
    if (method === 'session.rewind' || method === 'session.previewRewind' || method === 'session.truncateAtCheckpoint') requiredText(p, 'checkpointId')
    if (method === 'session.mcpAuthenticate') requiredText(p, 'serverName')
    if (method === 'session.stopTask') requiredText(p, 'taskId')
    if (method === 'session.forceRecover' && p.message !== undefined && typeof p.message !== 'string') throw Object.assign(new Error('message must be a string'), { code: 'invalid_argument' })
    if (method === 'session.scheduledSend.set') {
      const patch = asRecord(p.patch)
      if (p.patch === null || typeof p.patch !== 'object' || Array.isArray(p.patch)
        || (patch.sendAt !== undefined && (typeof patch.sendAt !== 'number' || !Number.isFinite(patch.sendAt)))
        || (patch.message !== undefined && patch.message !== null && typeof patch.message !== 'string')
        || (patch.armed !== undefined && typeof patch.armed !== 'boolean')
        || (patch.attachments !== undefined && patch.attachments !== null && !Array.isArray(patch.attachments))
        || (patch.source !== undefined && !['manual', 'rate_limit'].includes(String(patch.source)))) {
        throw Object.assign(new Error('invalid scheduled send patch'), { code: 'invalid_argument' })
      }
    }
    if (method === 'session.reset' && p.newSessionId !== undefined) {
      requiredText(p, 'newSessionId')
      if (p.newSessionId === sessionId) throw Object.assign(new Error('reset needs a new session id'), { code: 'invalid_argument' })
    }
    if (method === 'session.rewind' && !['files', 'conversation', 'code+chat'].includes(String(p.mode))) {
      throw Object.assign(new Error('invalid rewind mode'), { code: 'invalid_argument' })
    }
    if (!ctx.sessions?.get(sessionId)) throw Object.assign(new Error('session not found'), { code: 'not_found' })
    if (!SESSION_OPERATION_READS.has(method)) {
      ctx.leases.assertValid({ resource: { environmentId: ctx.identity.environmentId, sessionId },
        leaseId: requiredText(p, 'leaseId'), generation: requiredText(p, 'generation'), holderClientId: ctx.client.clientSessionId })
    }
    const result = await ctx.sessions!.callOperation!(sessionId, method, p)
    return { result: result ?? null }
  } catch (error) { return mapThrown(error) }
}

async function callListOperation(payload: unknown, ctx: RpcContext, method: string): Promise<RpcResult> {
  const denied = requireScopes(ctx.client, method === 'sessionList.deleteOlderThan' ? OPERATION_SCOPES.operateSession : OPERATION_SCOPES.readSession)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    if (method === 'sessionList.deleteOlderThan') {
      requiredText(p, 'projectId')
      if (!Number.isFinite(Date.parse(requiredText(p, 'cutoffDate')))) throw Object.assign(new Error('invalid cutoff date'), { code: 'invalid_argument' })
      if (!Array.isArray(p.controls)) throw Object.assign(new Error('session controls required'), { code: 'invalid_argument' })
      for (const input of p.controls) {
        const control = asRecord(input)
        ctx.leases.assertValid({ resource: { environmentId: ctx.identity.environmentId, sessionId: requiredText(control, 'sessionId') },
          leaseId: requiredText(control, 'leaseId'), generation: requiredText(control, 'generation'), holderClientId: ctx.client.clientSessionId })
      }
    }
    return { result: await ctx.sessions!.callListOperation!(method, p, ctx.client.clientSessionId) }
  } catch (error) { return mapThrown(error) }
}

export const SESSION_OPERATION_HANDLERS = Object.fromEntries([
  ...[...SESSION_OPERATION_METHODS].map(method => [method, callOperation]),
  ...[...SESSION_LIST_OPERATION_METHODS].map(method => [method, callListOperation]),
])
