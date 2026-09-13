/**
 * `artifact.*` RPC handlers — session sync zone transfers
 * (`docs/design/session-sync-zone.md` §5.2).
 *
 * Authorisation is the Host Action controller binding: the caller's
 * `clientSessionId` must be the session's `controllerClientSessionId`.
 * `stat` / `get` stop there; `put` / `delete` also present the session lease.
 *
 * Deliberately absent from the idempotency table: `put` is idempotent by its
 * offset contract (a repeated chunk is acknowledged and dropped) and `delete`
 * of something already gone succeeds, so the desktop retries freely.
 */
import {
  ARTIFACT_RPC_METHODS,
  OPERATION_SCOPES,
  hasAllScopes,
  type ArtifactDeleteResult,
  type ArtifactGetRequest,
  type ArtifactPutRequest,
  type AuthScope,
  type RpcErrorCode,
} from '@superone/shared/environment'
import type { AuthenticatedClient } from '../auth/auth-service'
import type { ControlLeaseService } from '../session/control-lease'
import type { SessionRuntime } from '../session/session-runtime'
import type { ArtifactZoneService } from '../workspace/artifact-zone'

export interface ArtifactRpcResult {
  result?: unknown
  error?: { code: RpcErrorCode; message: string; details?: Record<string, unknown> }
}

export interface ArtifactRpcContext {
  client: AuthenticatedClient
  environmentId: string
  sessions: Pick<SessionRuntime, 'get'>
  leases: Pick<ControlLeaseService, 'assertValid'>
  artifacts: ArtifactZoneService
}

function asRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
}

function mapThrown(err: unknown): ArtifactRpcResult {
  const e = err as { code?: string; message?: string; details?: Record<string, unknown> }
  return {
    error: {
      code: (e.code as RpcErrorCode | undefined) ?? 'internal',
      message: e.message || 'internal error',
      ...(e.details ? { details: e.details } : {}),
    },
  }
}

function requireScopes(client: AuthenticatedClient, scopes: readonly AuthScope[]): ArtifactRpcResult | null {
  if (!hasAllScopes(client.scopes, scopes)) {
    return { error: { code: 'forbidden', message: `missing scopes: ${scopes.join(', ')}` } }
  }
  return null
}

/** The session must exist here and be bound to this controller — same rule as claiming a Host Action. */
function requireController(sessionId: string, ctx: ArtifactRpcContext): ArtifactRpcResult | null {
  if (!sessionId) return { error: { code: 'invalid_argument', message: 'sessionId required' } }
  const session = ctx.sessions.get(sessionId)
  if (!session) return { error: { code: 'not_found', message: 'session not found' } }
  if (session.controllerClientSessionId !== ctx.client.clientSessionId) {
    return { error: { code: 'forbidden', message: 'not the session controller' } }
  }
  return null
}

function requireLease(sessionId: string, p: Record<string, unknown>, ctx: ArtifactRpcContext): ArtifactRpcResult | null {
  try {
    ctx.leases.assertValid({
      resource: { environmentId: ctx.environmentId, sessionId },
      leaseId: String(p.leaseId ?? ''),
      generation: String(p.generation ?? ''),
      holderClientId: ctx.client.clientSessionId,
    })
    return null
  } catch (err) {
    return mapThrown(err)
  }
}

function handleStat(payload: unknown, ctx: ArtifactRpcContext): ArtifactRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readSession)
  if (denied) return denied
  const p = asRecord(payload)
  const sessionId = String(p.sessionId ?? '')
  const gate = requireController(sessionId, ctx)
  if (gate) return gate
  try {
    return { result: ctx.artifacts.stat(sessionId, String(p.relativePath ?? '')) }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleGet(payload: unknown, ctx: ArtifactRpcContext): ArtifactRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readSession)
  if (denied) return denied
  const p = asRecord(payload)
  const sessionId = String(p.sessionId ?? '')
  const gate = requireController(sessionId, ctx)
  if (gate) return gate
  const req: ArtifactGetRequest = {
    sessionId,
    relativePath: String(p.relativePath ?? ''),
    offset: typeof p.offset === 'number' ? p.offset : 0,
    maxBytes: typeof p.maxBytes === 'number' ? p.maxBytes : 0,
  }
  try {
    return { result: ctx.artifacts.get(req) }
  } catch (err) {
    return mapThrown(err)
  }
}

function handlePut(payload: unknown, ctx: ArtifactRpcContext): ArtifactRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
  if (denied) return denied
  const p = asRecord(payload)
  const sessionId = String(p.sessionId ?? '')
  const gate = requireController(sessionId, ctx) ?? requireLease(sessionId, p, ctx)
  if (gate) return gate
  const req: ArtifactPutRequest = {
    sessionId,
    relativePath: String(p.relativePath ?? ''),
    transferId: String(p.transferId ?? ''),
    offset: p.offset as number,
    total: p.total as number,
    sha256: String(p.sha256 ?? ''),
    chunk: typeof p.chunk === 'string' ? p.chunk : '',
    final: p.final === true,
  }
  try {
    return { result: ctx.artifacts.put(req) }
  } catch (err) {
    return mapThrown(err)
  }
}

async function handleDelete(payload: unknown, ctx: ArtifactRpcContext): Promise<ArtifactRpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
  if (denied) return denied
  const p = asRecord(payload)
  const sessionId = String(p.sessionId ?? '')
  const gate = requireController(sessionId, ctx) ?? requireLease(sessionId, p, ctx)
  if (gate) return gate
  try {
    await ctx.artifacts.delete(sessionId, typeof p.relativePath === 'string' ? p.relativePath : undefined)
    const result: ArtifactDeleteResult = { ok: true }
    return { result }
  } catch (err) {
    return mapThrown(err)
  }
}

/** Returns null for methods outside the `artifact.*` family. */
export function dispatchArtifactRpc(
  method: string,
  payload: unknown,
  ctx: ArtifactRpcContext,
): ArtifactRpcResult | Promise<ArtifactRpcResult> | null {
  switch (method) {
    case ARTIFACT_RPC_METHODS.stat:
      return handleStat(payload, ctx)
    case ARTIFACT_RPC_METHODS.get:
      return handleGet(payload, ctx)
    case ARTIFACT_RPC_METHODS.put:
      return handlePut(payload, ctx)
    case ARTIFACT_RPC_METHODS.delete:
      return handleDelete(payload, ctx)
    default:
      return null
  }
}
