/**
 * `sessionProviders.*`: the host's session-layer provider profiles
 * (`claude-base`, custom multi-profile entries, …) over its session provider store.
 */

import { OPERATION_SCOPES } from '@superone/shared/environment'
import type { SessionProviderStore } from '../session/session-provider-store'
import type { AuthenticatedClient } from './auth-service'
import type { RpcResult } from './rpc-context'
import { asRecord, mapThrown, requireScopes } from './rpc-helpers'

export interface SessionProviderRpcContext {
  client: AuthenticatedClient
  sessionProviders: SessionProviderStore
}

const SESSION_PROVIDER_HANDLERS: Readonly<Record<string, (payload: unknown, ctx: SessionProviderRpcContext) => RpcResult>> = {
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
): RpcResult | null {
  const handler = Object.hasOwn(SESSION_PROVIDER_HANDLERS, method) ? SESSION_PROVIDER_HANDLERS[method] : undefined
  return handler ? handler(payload, ctx) : null
}

function handleList(payload: unknown, ctx: SessionProviderRpcContext): RpcResult {
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

function handleGet(payload: unknown, ctx: SessionProviderRpcContext): RpcResult {
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

function handleGetBase(payload: unknown, ctx: SessionProviderRpcContext): RpcResult {
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

function handleCreate(payload: unknown, ctx: SessionProviderRpcContext): RpcResult {
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

function handleUpdate(payload: unknown, ctx: SessionProviderRpcContext): RpcResult {
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

function handleDelete(payload: unknown, ctx: SessionProviderRpcContext): RpcResult {
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
