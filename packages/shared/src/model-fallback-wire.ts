import type { AgentEvent, RetractedBlockRef } from './agent-types'

/**
 * The three SDK system subtypes that announce a model swap.
 *
 * Only `model_refusal_fallback` / `model_refusal_no_fallback` are exported types
 * in `sdk.d.ts` (as of 0.3.232); the general `model_fallback` is untyped on the
 * wire, so every field is read defensively here rather than destructured.
 */
export const MODEL_FALLBACK_SUBTYPES = new Set([
  'model_fallback',
  'model_refusal_fallback',
  'model_refusal_no_fallback',
])

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

/**
 * Remembers which blocks of which of our messages each SDK wire frame produced,
 * so a retraction (`retracted_message_uuids` on the fallback notice, or
 * `supersedes` on the replacement frame) can be turned into block-level
 * `content_retracted` events.
 *
 * One SDK frame is one API step; our assistant message folds a whole turn's
 * steps into one flat content array. Mapping uuid → message id alone would make
 * a one-step retraction delete the entire turn.
 */
export interface RetractionLedger {
  /** Register a top-level assistant frame (`uuid`, `message.content`). */
  recordAssistantFrame(uuid: unknown, messageId: string, content: unknown): void
  /** Register a top-level user frame carrying tool_result blocks. */
  recordToolResultFrame(uuid: unknown, messageId: string, content: unknown): void
  /**
   * Resolve wire uuids into eviction events and forget them, so the same
   * retraction announced twice (supersede, then the end-of-turn notice) evicts
   * once. Uuids never recorded are dropped — eviction is idempotent by contract.
   */
  resolve(uuids: unknown): AgentEvent[]
}

function blockRefsOf(content: unknown): RetractedBlockRef[] {
  if (!Array.isArray(content)) return []
  const refs: RetractedBlockRef[] = []
  for (const block of content as Array<Record<string, unknown>>) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'tool_use' && str(block.id)) refs.push({ type: 'tool_use', toolUseId: block.id as string })
    else if (block.type === 'tool_result' && str(block.tool_use_id)) refs.push({ type: 'tool_result', toolUseId: block.tool_use_id as string })
    else if (block.type === 'text' && str(block.text)) refs.push({ type: 'text', text: block.text as string })
    else if (block.type === 'thinking' && str(block.thinking)) refs.push({ type: 'thinking', thinking: block.thinking as string })
  }
  return refs
}

export function createRetractionLedger(): RetractionLedger {
  const byUuid = new Map<string, { messageId: string; blocks: RetractedBlockRef[] }>()
  let currentMessageId = ''
  const record = (uuid: unknown, messageId: string, content: unknown): void => {
    const key = str(uuid)
    if (!key) return
    // A retraction only ever names frames of the turn being streamed; text refs
    // carry the full payload, so keeping older turns would shadow the transcript.
    if (messageId !== currentMessageId) {
      byUuid.clear()
      currentMessageId = messageId
    }
    const blocks = blockRefsOf(content)
    if (blocks.length > 0) byUuid.set(key, { messageId, blocks })
  }
  return {
    recordAssistantFrame: record,
    recordToolResultFrame: record,
    resolve(uuids) {
      if (!Array.isArray(uuids)) return []
      const byMessage = new Map<string, RetractedBlockRef[]>()
      for (const uuid of uuids) {
        const key = str(uuid)
        const hit = key ? byUuid.get(key) : undefined
        if (!key || !hit) continue
        byUuid.delete(key)
        byMessage.set(hit.messageId, [...(byMessage.get(hit.messageId) ?? []), ...hit.blocks])
      }
      return [...byMessage].map(([messageId, blocks]) => ({ type: 'content_retracted', messageId, blocks }))
    },
  }
}

/**
 * Map one model-fallback system message onto agent events.
 *
 * `resolveRetracted` turns the notice's SDK wire uuids into eviction events
 * (see {@link RetractionLedger}); the harness owns that because only it sees
 * the raw stream.
 */
export function mapModelFallbackWire(
  sys: Record<string, unknown>,
  resolveRetracted: (uuids: string[]) => AgentEvent[],
): AgentEvent[] {
  const subtype = str(sys.subtype)
  if (!subtype || !MODEL_FALLBACK_SUBTYPES.has(subtype)) return []

  const declined = subtype === 'model_refusal_no_fallback'
  const events: AgentEvent[] = [{
    type: 'model_fallback',
    trigger: str(sys.trigger) ?? (declined ? 'refusal' : 'unknown'),
    fromModel: str(sys.original_model) ?? str(sys.from_model),
    // A decline swapped nothing, so any target model on the wire is not a target.
    toModel: declined ? undefined : (str(sys.fallback_model) ?? str(sys.to_model)),
    outcome: declined ? 'declined' : 'swapped',
    // Older CLIs omit scope; the SDK documents that as session-wide.
    ...(str(sys.scope) === 'local' ? { scope: 'local' as const } : { scope: 'session' as const }),
    ...(sys.api_refusal_category === undefined
      ? {}
      : { refusalCategory: str(sys.api_refusal_category) ?? null }),
  }]

  const uuids = Array.isArray(sys.retracted_message_uuids)
    ? sys.retracted_message_uuids.filter((id): id is string => typeof id === 'string')
    : []
  if (uuids.length > 0) events.push(...resolveRetracted(uuids))

  return events
}
