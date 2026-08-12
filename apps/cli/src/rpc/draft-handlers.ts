/**
 * Draft CRUD RPC handlers — unsent composer input stored on this node.
 * Methods: draft.list|upsert|delete
 *
 * `projectPath` is a soft reference on purpose: a draft outlives the project
 * being removed from the registry, and simply renders as untargeted.
 */

import {
  OPERATION_SCOPES,
  hasAllScopes,
  type AuthScope,
  type DraftAttachment,
  type DraftUpsertRequest,
  type RpcErrorCode,
} from '@superone/shared/environment'
import type { HarnessId } from '@superone/shared/session-types'
import type { DraftStore } from '@superone/runtime/drafts'
import type { AuthenticatedClient } from '../auth/auth-service'

export interface DraftRpcResult {
  result?: unknown
  error?: { code: RpcErrorCode; message: string; details?: Record<string, unknown> }
}

export interface DraftRpcContext {
  client: AuthenticatedClient
  drafts: DraftStore
}

function requireScopes(client: AuthenticatedClient, scopes: readonly AuthScope[]): DraftRpcResult | null {
  if (!hasAllScopes(client.scopes, scopes)) {
    return { error: { code: 'forbidden', message: `missing scopes: ${scopes.join(', ')}` } }
  }
  return null
}

function asRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function parseAttachments(value: unknown): DraftAttachment[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw) => {
    const a = asRecord(raw)
    const name = typeof a.name === 'string' ? a.name : ''
    const mimeType = typeof a.mimeType === 'string' ? a.mimeType : ''
    const data = typeof a.data === 'string' ? a.data : ''
    return data ? [{ name, mimeType, data }] : []
  })
}

function mapThrown(err: unknown): DraftRpcResult {
  return { error: { code: 'internal', message: err instanceof Error ? err.message : String(err) } }
}

export function handleDraftList(payload: unknown, ctx: DraftRpcContext): DraftRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readSession)
  if (denied) return denied
  const p = asRecord(payload)
  const projectPath = optionalString(p.projectPath)
  try {
    return { result: { drafts: ctx.drafts.list(projectPath ?? undefined) } }
  } catch (err) {
    return mapThrown(err)
  }
}

export function handleDraftUpsert(payload: unknown, ctx: DraftRpcContext): DraftRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
  if (denied) return denied
  const p = asRecord(payload)
  const id = String(p.id ?? '').trim()
  if (!id) {
    return { error: { code: 'invalid_argument', message: 'id is required' } }
  }
  if (typeof p.text !== 'string') {
    return { error: { code: 'invalid_argument', message: 'text is required' } }
  }
  const settings =
    p.settings && typeof p.settings === 'object'
      ? (p.settings as DraftUpsertRequest['settings'])
      : undefined
  const input: DraftUpsertRequest = {
    id,
    text: p.text,
    docJson: p.docJson && typeof p.docJson === 'object' ? (p.docJson as object) : null,
    attachments: parseAttachments(p.attachments),
    projectPath: optionalString(p.projectPath),
    harness: (optionalString(p.harness) as HarnessId | null) ?? null,
    model: optionalString(p.model),
    permissionMode: optionalString(p.permissionMode),
    settings: settings ?? null,
    originSessionId: optionalString(p.originSessionId),
    ...(optionalString(p.createdAt) ? { createdAt: p.createdAt as string } : {}),
  }
  try {
    return { result: { draft: ctx.drafts.upsert(input) } }
  } catch (err) {
    return mapThrown(err)
  }
}

export function handleDraftDelete(payload: unknown, ctx: DraftRpcContext): DraftRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
  if (denied) return denied
  const p = asRecord(payload)
  const draftId = String(p.draftId ?? '').trim()
  if (!draftId) {
    return { error: { code: 'invalid_argument', message: 'draftId is required' } }
  }
  try {
    ctx.drafts.delete(draftId)
    return { result: { ok: true } }
  } catch (err) {
    return mapThrown(err)
  }
}

/** Route draft.* methods. Returns null if method is not a draft method. */
export function dispatchDraftRpc(
  method: string,
  payload: unknown,
  ctx: DraftRpcContext,
): DraftRpcResult | null {
  switch (method) {
    case 'draft.list':
      return handleDraftList(payload, ctx)
    case 'draft.upsert':
      return handleDraftUpsert(payload, ctx)
    case 'draft.delete':
      return handleDraftDelete(payload, ctx)
    default:
      return null
  }
}

export const DRAFT_MUTATING_METHODS = ['draft.upsert', 'draft.delete'] as const
