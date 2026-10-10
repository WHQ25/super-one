import { hasAllScopes, type AuthScope, type RpcErrorCode } from '@superone/shared/environment'
import type { AuthenticatedClient } from './auth-service'
import type { RpcResult } from './rpc-context'

/** Shared by the dispatcher and the method families it merges. */

export function requireScopes(client: AuthenticatedClient, scopes: readonly AuthScope[]): RpcResult | null {
  if (!hasAllScopes(client.scopes, scopes)) {
    return { error: { code: 'forbidden', message: `missing scopes: ${scopes.join(', ')}` } }
  }
  return null
}

export function asRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
}

/** A thrown `{ code, message, details }` (or any error) as an RPC error. */
export function mapThrown(err: unknown): RpcResult {
  const e = err as { code?: string; message?: string; details?: Record<string, unknown> }
  const code = (e.code as RpcErrorCode | undefined) ?? 'internal'
  return {
    error: { code, message: e.message || 'internal error', ...(e.details ? { details: e.details } : {}) },
  }
}

export function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** A method family merged into the dispatcher's table. */
export type RpcHandlerTable<C> = Readonly<Record<string, (payload: unknown, ctx: C, method: string) => RpcResult | Promise<RpcResult>>>
