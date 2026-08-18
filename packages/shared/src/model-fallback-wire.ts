import type { AgentEvent } from './agent-types'

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
 * Map one model-fallback system message onto agent events.
 *
 * `resolveRetractedIds` turns SDK wire uuids into our own message ids; the
 * harness owns that mapping because only it sees the raw stream. Uuids it cannot
 * place are dropped, which matches the SDK contract that eviction is idempotent
 * and unknown uuids are a no-op.
 */
export function mapModelFallbackWire(
  sys: Record<string, unknown>,
  resolveRetractedIds: (uuids: string[]) => string[],
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
  if (uuids.length > 0) {
    const messageIds = resolveRetractedIds(uuids)
    if (messageIds.length > 0) events.push({ type: 'messages_retracted', messageIds })
  }

  return events
}
