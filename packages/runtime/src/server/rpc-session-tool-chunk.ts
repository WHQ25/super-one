import type { ChatMessage } from '@superone/shared/agent-types'
import { readableContent } from '@superone/shared/codex-content'
import { OPERATION_SCOPES } from '@superone/shared/environment'
import { contentDigest } from '@superone/shared/transcript-window/content-digest'
import { toolBodyText, toolBodyType, TOOL_CHUNK_CHARS } from '@superone/shared/transcript-window/tool-body'
import type { ConnectionDelivery } from '../stream/delivery/connection-delivery'
import { projectWindowMessage } from '../stream/delivery/window-projection'
import type { RpcContext, RpcResult } from './rpc-context'
import { asRecord, mapThrown, requireScopes } from './rpc-helpers'
import { readSessionTarget } from './rpc-session-reads'
import { unsupportedMethodError } from './unsupported'

const invalid = (message: string): RpcResult => ({ error: { code: 'invalid_argument', message } })

// A cold stored row can require a SQLite read, projection and digest. Keep one
// verified inline body per connection for the following pages of the same read.
const inlineReads = new WeakMap<ConnectionDelivery, { key: string; text: string }>()
const MAX_RETAINED_CHARS = 16 * 1024 * 1024

/** Read the version named by an inline row or an open detail subscription. */
export async function handleSessionToolChunk(payload: unknown, ctx: RpcContext): Promise<RpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readSession)
  if (denied) return denied
  const sessions = ctx.sessions
  if (!sessions) return mapThrown(unsupportedMethodError('session.toolChunk'))
  const p = asRecord(payload)
  const target = readSessionTarget(p, sessions)
  if ('error' in target) return target
  if (typeof p.messageId !== 'string' || typeof p.toolUseId !== 'string' || typeof p.digest !== 'string'
    || (p.type !== 'tool_use' && p.type !== 'tool_result' && p.type !== 'block' && p.type !== 'detail') || typeof p.offset !== 'number'
    || !Number.isSafeInteger(p.offset) || p.offset < 0) return invalid('Invalid tool body address')
  const { messageId, toolUseId, type, offset, digest } = p
  if (p.subscriptionId !== undefined) {
    if (typeof p.subscriptionId !== 'string') return invalid('Invalid detail subscription')
    const chunk = ctx.streams?.delivery?.views.initialChunk(target.sessionId, p.subscriptionId, { messageId, toolUseId, type, digest }, offset)
    return chunk === undefined ? { error: { code: 'not_found', message: 'Tool body subscription expired' } } : { result: chunk }
  }
  if (type === 'detail') return invalid('Detail bodies require a subscription')
  const connection = ctx.streams?.delivery
  const key = JSON.stringify([target.sessionId, messageId, toolUseId, type, digest])
  const slice = (text: string): RpcResult => {
    if (offset >= text.length) return invalid('Offset outside tool body')
    const end = offset + TOOL_CHUNK_CHARS
    if (connection) {
      if (end < text.length && text.length <= MAX_RETAINED_CHARS) inlineReads.set(connection, { key, text })
      else if (inlineReads.get(connection)?.key === key) inlineReads.delete(connection)
    }
    return { result: text.slice(offset, end) }
  }
  const previous = connection && offset > 0 ? inlineReads.get(connection) : undefined
  if (previous?.key === key) return slice(previous.text)
  const page = (message: ChatMessage | null | undefined): RpcResult => {
    const blocks = message ? readableContent(projectWindowMessage(message)) : []
    // Tool ids join calls to results. A serialized block must also match its version
    // because both halves of the call can carry a large envelope.
    for (const block of blocks) {
      if (!('toolUseId' in block) || block.toolUseId !== toolUseId) continue
      if (type !== 'block' && toolBodyType(block) !== type) continue
      let text = type === 'block' ? JSON.stringify(block) : toolBodyText(block)
      if (type === 'tool_result' && block.type === 'tool_result' && block.remoteBody?.digest === digest && message) {
        const original = readableContent(message).find(row => row.type === 'tool_result' && row.toolUseId === toolUseId)
        if (original?.type === 'tool_result') text = original.summary
      }
      if (contentDigest(text) !== digest) continue
      return slice(text)
    }
    return { error: { code: 'failed_precondition', message: 'Tool body changed or no longer exists' } }
  }
  try {
    if (sessions.readTranscriptWindow) {
      return await sessions.readTranscriptWindow({ sessionId: target.sessionId, includeState: false, read: ({ transcript }) => {
        const index = transcript.indexOf(messageId)
        return page(index < 0 ? null : transcript.messageAt(index))
      } })
    }
    return page(sessions.detailMessage ? sessions.detailMessage(target.sessionId, messageId)
      : sessions.messages(target.sessionId).find(row => row.id === messageId))
  } catch (error) {
    return mapThrown(error)
  }
}
