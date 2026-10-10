/**
 * `draft.*`: unsent composer input stored on this host, with a draft lease
 * for the composer editing it. `projectPath` is a soft reference on purpose:
 * a draft outlives the project being removed and renders as untargeted.
 *
 * A composer opens a draft (`draft.open`), writes under the lease it got
 * (`draft.upsert` with `leaseId`, or `open: true` for a draft it just minted)
 * and closes it; a plain `draft.upsert` (a controller's outbox) writes when
 * nobody holds the draft. Leases belong to the caller's client session.
 */

import {
  DRAFT_ATTACHMENTS_MAX_BYTES,
  OPERATION_SCOPES,
  type DraftAttachment,
  type DraftOpenResult,
  type DraftUpsertRequest,
} from '@superone/shared/environment'
import { withoutDraftAttachmentBytes } from '@superone/shared/environment/draft-content'
import type { HarnessId } from '@superone/shared/session-types'
import type { DraftControl } from '../drafts/index'
import type { RpcContext } from './rpc-context'
import { asRecord, mapThrown, optionalString, requireScopes, type RpcHandlerTable } from './rpc-helpers'

/** The host's drafts and their leases (`DraftControl` over its draft store). */
export type DraftsPort = Pick<DraftControl, 'list' | 'upsert' | 'save' | 'open' | 'close' | 'delete'> &
  Partial<Pick<DraftControl, 'watch' | 'assertControl'>>

type DraftRpcContext = RpcContext & { drafts: DraftsPort }

function parseAttachments(value: unknown): DraftAttachment[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw) => {
    const a = asRecord(raw)
    const name = typeof a.name === 'string' ? a.name : ''
    const mimeType = typeof a.mimeType === 'string' ? a.mimeType : ''
    const data = typeof a.data === 'string' ? a.data : ''
    return data ? [{ name, mimeType, data, ...(typeof a.id === 'string' ? { id: a.id } : {}) }] : []
  })
}

function parseUpsert(p: Record<string, unknown>): DraftUpsertRequest | string {
  const id = String(p.id ?? '').trim()
  if (!id) return 'id is required'
  if (typeof p.text !== 'string') return 'text is required'
  const settings = p.settings && typeof p.settings === 'object' ? (p.settings as DraftUpsertRequest['settings']) : undefined
  return {
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
}

const invalid = (message: string) => ({ error: { code: 'invalid_argument' as const, message } })

export const DRAFT_HANDLERS: RpcHandlerTable<DraftRpcContext> = {
  'draft.list': (payload, ctx) => {
    const denied = requireScopes(ctx.client, OPERATION_SCOPES.readSession)
    if (denied) return denied
    const p = asRecord(payload)
    try {
      const drafts = ctx.drafts.list(optionalString(p.projectPath) ?? undefined)
      return { result: { drafts: p.omitAttachmentData === true ? drafts.map(withoutDraftAttachmentBytes) : drafts } }
    } catch (err) {
      return mapThrown(err)
    }
  },
  'draft.upsert': (payload, ctx) => {
    const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
    if (denied) return denied
    const p = asRecord(payload)
    const input = parseUpsert(p)
    if (typeof input === 'string') return invalid(input)
    const leaseId = optionalString(p.leaseId) ?? undefined
    try {
      if (!leaseId && p.open !== true) return { result: { draft: ctx.drafts.upsert(input) } }
      if (!input.projectPath) return invalid('projectPath is required')
      const bytes = input.attachments?.reduce((size, a) => size + a.data.length, 0) ?? 0
      if (bytes > DRAFT_ATTACHMENTS_MAX_BYTES) {
        return invalid('Draft attachments exceed 8 MB. Remove an attachment to synchronize this draft.')
      }
      const saved = ctx.drafts.save(input, ctx.client.clientSessionId, leaseId)
      return { result: { ...saved, draft: withoutDraftAttachmentBytes(saved.draft) } }
    } catch (err) {
      return mapThrown(err)
    }
  },
  'draft.open': async (payload, ctx) => {
    const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
    if (denied) return denied
    const p = asRecord(payload)
    const draftId = optionalString(p.draftId)
    if (!draftId) return invalid('draftId is required')
    try {
      await ctx.beforeDraftOpen?.(draftId)
      const opened = ctx.drafts.open(draftId, ctx.client.clientSessionId, optionalString(p.expectedUpdatedAt) ?? undefined)
      // A composer about to send a draft already holds its attachments.
      return { result: p.omitContent === true ? { ...opened, draft: withoutDraftAttachmentBytes(opened.draft) } : opened }
    } catch (err) {
      return mapThrown(err)
    }
  },
  'draft.close': (payload, ctx) => {
    const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
    if (denied) return denied
    const p = asRecord(payload)
    const draftId = optionalString(p.draftId)
    const leaseId = optionalString(p.leaseId)
    if (!draftId || !leaseId) return invalid('draftId and leaseId are required')
    try {
      ctx.drafts.close(draftId, ctx.client.clientSessionId, leaseId)
      return { result: { ok: true } }
    } catch (err) {
      return mapThrown(err)
    }
  },
  'draft.delete': (payload, ctx) => {
    const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
    if (denied) return denied
    const p = asRecord(payload)
    const draftId = String(p.draftId ?? '').trim()
    if (!draftId) return invalid('draftId is required')
    const leaseId = optionalString(p.leaseId) ?? undefined
    try {
      ctx.drafts.delete(draftId, ctx.client.clientSessionId, leaseId)
      return { result: { ok: true } }
    } catch (err) {
      return mapThrown(err)
    }
  },
}

/** Replaying an open after disconnect must grant a live lease rather than a discarded token. */
export function isDraftOpenReceiptLive(ctx: RpcContext, receipt: unknown): boolean {
  const opened = receipt as Partial<DraftOpenResult> | null
  if (!opened?.leaseId || !opened.draft?.id) return false
  if (!ctx.drafts?.assertControl) return true
  try { ctx.drafts.assertControl(opened.draft.id, ctx.client.clientSessionId, opened.leaseId); return true }
  catch { return false }
}
