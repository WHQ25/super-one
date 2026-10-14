/**
 * `artifact.*` — session sync zone transfers
 * (`docs/architecture/session-sync-zone.md` §5.2).
 *
 * Authorisation is the Host Action controller binding: the caller's
 * `clientSessionId` must be the session's `controllerClientSessionId`.
 * `stat` / `list` / `get` stop there; `put` / `delete` also present the session lease.
 *
 * Deliberately absent from the idempotency table: `put` is idempotent by its
 * offset contract (a repeated chunk is acknowledged and dropped) and `delete`
 * of something already gone succeeds, so the desktop retries freely.
 */
import {
  ARTIFACT_RPC_METHODS,
  OPERATION_SCOPES,
  type ArtifactDeleteResult,
  type ArtifactGetRequest,
  type ArtifactPutRequest,
  type AuthScope,
} from '@superone/shared/environment'
import { asRecord, mapThrown, requireScopes, type RpcHandlerTable } from './rpc-helpers'
import type { RpcContext as HostRpcContext, RpcResult } from './rpc-context'

type RpcContext = HostRpcContext & Required<Pick<HostRpcContext, 'artifacts' | 'sessions'>>

/**
 * The caller's scopes, then the session must exist here and be bound to this
 * controller — same rule as claiming a Host Action — and, for writes, the lease.
 */
function admit(payload: unknown, ctx: RpcContext, scopes: readonly AuthScope[], lease: boolean): { sessionId: string; p: Record<string, unknown> } | RpcResult {
  const denied = requireScopes(ctx.client, scopes)
  if (denied) return denied
  const p = asRecord(payload)
  const sessionId = String(p.sessionId ?? '')
  if (!sessionId) return { error: { code: 'invalid_argument', message: 'sessionId required' } }
  const session = ctx.sessions.get(sessionId)
  if (!session) return { error: { code: 'not_found', message: 'session not found' } }
  if (session.controllerClientSessionId !== ctx.client.clientSessionId) {
    return { error: { code: 'forbidden', message: 'not the session controller' } }
  }
  if (lease) {
    try {
      ctx.leases.assertValid({
        resource: { environmentId: ctx.identity.environmentId, sessionId },
        leaseId: String(p.leaseId ?? ''),
        generation: String(p.generation ?? ''),
        holderClientId: ctx.client.clientSessionId,
      })
    } catch (err) {
      return mapThrown(err)
    }
  }
  return { sessionId, p }
}

/** Run one admitted artifact call, mapping a thrown `{ code }` to its RPC error. */
async function serve(
  payload: unknown,
  ctx: RpcContext,
  scopes: readonly AuthScope[],
  lease: boolean,
  run: (sessionId: string, p: Record<string, unknown>) => unknown,
): Promise<RpcResult> {
  const admitted = admit(payload, ctx, scopes, lease)
  if (!('sessionId' in admitted)) return admitted
  try {
    return { result: await run(admitted.sessionId, admitted.p) }
  } catch (err) {
    return mapThrown(err)
  }
}

export const ARTIFACT_HANDLERS: RpcHandlerTable<RpcContext> = {
  [ARTIFACT_RPC_METHODS.stat]: (payload, ctx) =>
    serve(payload, ctx, OPERATION_SCOPES.readSession, false, (sessionId, p) => ctx.artifacts.stat(sessionId, String(p.relativePath ?? ''))),
  [ARTIFACT_RPC_METHODS.list]: (payload, ctx) =>
    serve(payload, ctx, OPERATION_SCOPES.readSession, false, (sessionId, p) => ctx.artifacts.list(sessionId, String(p.relativePath ?? ''))),
  [ARTIFACT_RPC_METHODS.get]: (payload, ctx) =>
    serve(payload, ctx, OPERATION_SCOPES.readSession, false, (sessionId, p) => {
      const req: ArtifactGetRequest = {
        sessionId,
        relativePath: String(p.relativePath ?? ''),
        offset: typeof p.offset === 'number' ? p.offset : 0,
        maxBytes: typeof p.maxBytes === 'number' ? p.maxBytes : 0,
      }
      return ctx.artifacts.get(req)
    }),
  [ARTIFACT_RPC_METHODS.put]: (payload, ctx) =>
    serve(payload, ctx, OPERATION_SCOPES.operateSession, true, (sessionId, p) => {
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
      return ctx.artifacts.put(req)
    }),
  [ARTIFACT_RPC_METHODS.delete]: (payload, ctx) =>
    serve(payload, ctx, OPERATION_SCOPES.operateSession, true, async (sessionId, p) => {
      await ctx.artifacts.delete(sessionId, typeof p.relativePath === 'string' ? p.relativePath : undefined)
      return { ok: true } satisfies ArtifactDeleteResult
    }),
}
