import { OPERATION_SCOPES } from '@superone/shared/environment'
import {
  TRANSCRIPT_WINDOW_METHOD,
  TRANSCRIPT_WINDOW_SCHEMA,
  type TranscriptWindowAnchor,
  type TranscriptWindowBudget,
  type TranscriptWindowRequest,
  type TranscriptWindowResult,
} from '@superone/shared/environment/transcript-window'
import { windowBudget } from '@superone/shared/transcript-window/select-window'
import { WindowViews } from '../stream/delivery/window-views'
import { arrayTranscript } from '../stream/delivery/transcript-access'
import type { RpcContext, RpcResult, TranscriptWindowView } from './rpc-context'
import { asRecord, mapThrown, requireScopes } from './rpc-helpers'
import { readSessionTarget } from './rpc-session-reads'
import { deliverLoad } from './session-delivery'
import { unsupportedMethodError } from './unsupported'

const MAX_HOLDER_LENGTH = 128
type RpcFailure = Required<Pick<RpcResult, 'error'>>
const invalid = (message: string): RpcFailure => ({ error: { code: 'invalid_argument', message } })

/**
 * `session.transcriptWindow`: a bounded fragment window of a session, read at
 * the same position as its state and cursor. The connection records the
 * window so its live frames carry `transcript_window` patches for it.
 */
export async function handleSessionTranscriptWindow(payload: unknown, ctx: RpcContext): Promise<RpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readSession)
  if (denied) return denied
  const sessions = ctx.sessions
  if (!sessions) return mapThrown(unsupportedMethodError(TRANSCRIPT_WINDOW_METHOD))
  const p = asRecord(payload)
  const target = readSessionTarget(p, sessions)
  if ('error' in target) return target
  const parsed = parseWindowRequest(p)
  if ('error' in parsed) return parsed
  const { anchor, direction, viewport, budget, have, holder } = parsed
  const includeState = parsed.includeState ?? !anchor
  const request = { anchor, direction, have }
  const limits = windowBudget({ budget, viewport })
  try {
    if (sessions.readTranscriptWindow) {
      // The host reads rows inside `read`, after prepare and before this turn awaits again.
      return await sessions.readTranscriptWindow({
        sessionId: target.sessionId,
        includeState,
        read: (view) => windowResult(ctx, target.sessionId, holder, request, limits, view, includeState),
      })
    }
    const loaded = await sessions.load({ sessionId: target.sessionId, includeState, full: true })
    return windowResult(ctx, target.sessionId, holder, request, limits, {
      transcript: arrayTranscript(loaded.messages),
      state: loaded.state,
      restore: loaded.restore,
      cursor: loaded.cursor,
    }, includeState)
  } catch (err) {
    return mapThrown(err)
  }
}

function windowResult(
  ctx: RpcContext,
  sessionId: string,
  holder: string,
  request: Pick<TranscriptWindowRequest, 'anchor' | 'direction' | 'have'>,
  budget: TranscriptWindowBudget,
  view: TranscriptWindowView,
  includeState: boolean,
): RpcResult {
  const delivery = ctx.streams?.delivery
  const selected = (delivery?.windows ?? new WindowViews()).serve({
    sessionId,
    holder,
    transcript: view.transcript,
    request,
    budget,
  })
  const shaped = deliverLoad({
    sessionId,
    state: view.state,
    messages: [],
    ...(view.restore ? { restore: view.restore } : {}),
    cursor: view.cursor,
    before: null,
  }, delivery)
  const result: TranscriptWindowResult = {
    sessionId,
    schema: TRANSCRIPT_WINDOW_SCHEMA,
    messages: selected.messages,
    older: selected.older,
    newer: selected.newer,
    total: selected.total,
    ...(includeState ? { state: shaped.state, ...(shaped.restore ? { restore: shaped.restore } : {}) } : {}),
    cursor: view.cursor,
    ...(shaped.summarized ? { summarized: true as const } : {}),
  }
  return { result }
}

type ParsedWindowRequest = Pick<TranscriptWindowRequest, 'anchor' | 'direction' | 'viewport' | 'have' | 'includeState'> & {
  budget?: Partial<TranscriptWindowBudget>
  holder: string
}

function parseWindowRequest(p: Record<string, unknown>): ParsedWindowRequest | RpcFailure {
  let anchor: TranscriptWindowAnchor | undefined
  if (p.anchor !== undefined) {
    const a = asRecord(p.anchor)
    if (typeof a.messageId !== 'string' || !a.messageId) return invalid('anchor.messageId must be a non-empty string')
    if (a.key !== undefined && typeof a.key !== 'string') return invalid('anchor.key must be a string')
    anchor = { messageId: a.messageId, ...(typeof a.key === 'string' ? { key: a.key } : {}) }
  }
  if (p.direction !== undefined && p.direction !== 'before' && p.direction !== 'after' && p.direction !== 'around') {
    return invalid('direction must be before|after|around')
  }
  if (p.direction !== undefined && !anchor) return invalid('direction requires an anchor')
  let viewport: TranscriptWindowRequest['viewport']
  if (p.viewport !== undefined) {
    const v = asRecord(p.viewport)
    if (!isFiniteNumber(v.width) || !isFiniteNumber(v.height)) return invalid('viewport needs numeric width and height')
    viewport = { width: v.width, height: v.height }
  }
  let budget: Partial<TranscriptWindowBudget> | undefined
  if (p.budget !== undefined) {
    const b = asRecord(p.budget)
    for (const key of ['maxBytes', 'maxFragments', 'targetChars'] as const) {
      if (b[key] !== undefined && !isFiniteNumber(b[key])) return invalid(`budget.${key} must be a number`)
    }
    budget = { maxBytes: b.maxBytes as number | undefined, maxFragments: b.maxFragments as number | undefined, targetChars: b.targetChars as number | undefined }
  }
  if (p.have !== undefined && !Array.isArray(p.have)) return invalid('have must be a list')
  if (p.includeState !== undefined && typeof p.includeState !== 'boolean') return invalid('includeState must be boolean')
  if (p.holder !== undefined && (typeof p.holder !== 'string' || p.holder.length > MAX_HOLDER_LENGTH)) return invalid('holder must be a short string')
  return {
    anchor,
    direction: p.direction as ParsedWindowRequest['direction'],
    viewport,
    budget,
    have: p.have as TranscriptWindowRequest['have'],
    includeState: p.includeState as boolean | undefined,
    holder: typeof p.holder === 'string' ? p.holder : '',
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
