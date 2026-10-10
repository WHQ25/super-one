/**
 * sessionProviders.* RPC handlers (desktop session-provider-repo parity on node).
 * Methods: sessionProviders.list|get|getBase|create|update|delete
 */

import {
  OPERATION_SCOPES,
  hasAllScopes,
  type AuthScope,
  type RpcErrorCode,
} from '@superone/shared/environment'
import type { SessionProviderStore } from '@superone/runtime/session'
import type { AuthenticatedClient } from '../auth/auth-service'

export interface SessionProviderRpcResult {
  result?: unknown
  error?: { code: RpcErrorCode; message: string; details?: Record<string, unknown> }
}

export interface SessionProviderRpcContext {
  client: AuthenticatedClient
  sessionProviders: SessionProviderStore
}

function requireScopes(
  client: AuthenticatedClient,
  scopes: readonly AuthScope[],
): SessionProviderRpcResult | null {
  if (!hasAllScopes(client.scopes, scopes)) {
    return { error: { code: 'forbidden', message: `missing scopes: ${scopes.join(', ')}` } }
  }
  return null
}

function asRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
}

function mapThrown(err: unknown): SessionProviderRpcResult {
  const e = err as { code?: string; message?: string }
  const code = (e.code as RpcErrorCode | undefined) ?? 'internal'
  return { error: { code, message: e.message || 'internal error' } }
}

const SESSION_PROVIDER_HANDLERS: Readonly<Record<string, (payload: unknown, ctx: SessionProviderRpcContext, method: string) => SessionProviderRpcResult>> = {
  'sessionProviders.list': (payload, ctx) => handleList(payload, ctx),
  'sessionProviders.get': (payload, ctx) => handleGet(payload, ctx),
  'sessionProviders.getBase': (payload, ctx) => handleGetBase(payload, ctx),
  'sessionProviders.create': (payload, ctx) => handleCreate(payload, ctx),
  'sessionProviders.update': (payload, ctx) => handleUpdate(payload, ctx),
  'sessionProviders.delete': (payload, ctx) => handleDelete(payload, ctx),
}

/** Every method this table serves. */
export const SESSION_PROVIDER_RPC_METHODS: ReadonlySet<string> = new Set(Object.keys(SESSION_PROVIDER_HANDLERS))

/**
 * Dispatch sessionProviders.* methods. Returns null when method is not owned here.
 */
export function dispatchSessionProviderRpc(
  method: string,
  payload: unknown,
  ctx: SessionProviderRpcContext,
): SessionProviderRpcResult | null {
  const handler = Object.hasOwn(SESSION_PROVIDER_HANDLERS, method) ? SESSION_PROVIDER_HANDLERS[method] : undefined
  return handler ? handler(payload, ctx, method) : null
}

function handleList(payload: unknown, ctx: SessionProviderRpcContext): SessionProviderRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readEnvironment)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    const harnessId = typeof p.harnessId === 'string' && p.harnessId.trim() ? p.harnessId.trim() : null
    const providers = harnessId
      ? ctx.sessionProviders.listByHarness(harnessId)
      : ctx.sessionProviders.list()
    return { result: { providers } }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleGet(payload: unknown, ctx: SessionProviderRpcContext): SessionProviderRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readEnvironment)
  if (denied) return denied
  const p = asRecord(payload)
  const id = String(p.id ?? '')
  if (!id) return { error: { code: 'invalid_argument', message: 'id required' } }
  try {
    return { result: { provider: ctx.sessionProviders.get(id) } }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleGetBase(payload: unknown, ctx: SessionProviderRpcContext): SessionProviderRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readEnvironment)
  if (denied) return denied
  const p = asRecord(payload)
  const harnessId = String(p.harnessId ?? '')
  if (!harnessId) return { error: { code: 'invalid_argument', message: 'harnessId required' } }
  try {
    return { result: { provider: ctx.sessionProviders.getBase(harnessId) } }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleCreate(payload: unknown, ctx: SessionProviderRpcContext): SessionProviderRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    const provider = ctx.sessionProviders.create({
      harnessId: String(p.harnessId ?? ''),
      name: String(p.name ?? ''),
      config: p.config,
      id: typeof p.id === 'string' ? p.id : undefined,
    })
    return { result: { provider } }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleUpdate(payload: unknown, ctx: SessionProviderRpcContext): SessionProviderRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
  if (denied) return denied
  const p = asRecord(payload)
  const id = String(p.id ?? '')
  if (!id) return { error: { code: 'invalid_argument', message: 'id required' } }
  try {
    const provider = ctx.sessionProviders.update(id, {
      name: typeof p.name === 'string' ? p.name : undefined,
      config: p.config !== undefined ? p.config : undefined,
    })
    return { result: { provider } }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleDelete(payload: unknown, ctx: SessionProviderRpcContext): SessionProviderRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
  if (denied) return denied
  const p = asRecord(payload)
  const id = String(p.id ?? '')
  if (!id) return { error: { code: 'invalid_argument', message: 'id required' } }
  try {
    const ok = ctx.sessionProviders.delete(id)
    if (!ok) return { error: { code: 'not_found', message: 'provider not found' } }
    return { result: { ok: true as const } }
  } catch (err) {
    return mapThrown(err)
  }
}
