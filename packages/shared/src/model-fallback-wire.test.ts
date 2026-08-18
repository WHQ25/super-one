import { describe, expect, it } from 'vitest'
import { mapModelFallbackWire } from './model-fallback-wire'

const NO_RETRACTION = () => []

function first(events: ReturnType<typeof mapModelFallbackWire>) {
  const event = events[0]
  if (event?.type !== 'model_fallback') throw new Error('expected a model_fallback event')
  return event
}

describe('mapModelFallbackWire', () => {
  it('ignores system messages that are not about a model swap', () => {
    expect(mapModelFallbackWire({ subtype: 'api_retry' }, NO_RETRACTION)).toEqual([])
  })

  it('reads the untyped general fallback defensively', () => {
    const event = first(mapModelFallbackWire({
      subtype: 'model_fallback',
      trigger: 'overloaded',
      original_model: 'claude-fable-5',
      fallback_model: 'claude-opus-5',
    }, NO_RETRACTION))

    expect(event).toMatchObject({
      trigger: 'overloaded',
      fromModel: 'claude-fable-5',
      toModel: 'claude-opus-5',
      outcome: 'swapped',
    })
  })

  it('accepts the from_model / to_model spelling too', () => {
    expect(first(mapModelFallbackWire({
      subtype: 'model_fallback',
      trigger: 'server_error',
      from_model: 'a',
      to_model: 'b',
    }, NO_RETRACTION))).toMatchObject({ fromModel: 'a', toModel: 'b' })
  })

  it('defaults a missing trigger rather than emitting undefined', () => {
    expect(first(mapModelFallbackWire({ subtype: 'model_fallback' }, NO_RETRACTION)).trigger).toBe('unknown')
  })

  it('treats an older CLI omitting scope as a session-wide swap', () => {
    expect(first(mapModelFallbackWire({
      subtype: 'model_refusal_fallback',
      trigger: 'refusal',
    }, NO_RETRACTION)).scope).toBe('session')
  })

  it('keeps a subagent-local swap local so the session model is not misreported', () => {
    expect(first(mapModelFallbackWire({
      subtype: 'model_refusal_fallback',
      trigger: 'refusal',
      scope: 'local',
      original_model: 'claude-fable-5',
      fallback_model: 'claude-opus-5',
    }, NO_RETRACTION)).scope).toBe('local')
  })

  it('carries the refusal category through, including an explicit null', () => {
    expect(first(mapModelFallbackWire({
      subtype: 'model_refusal_fallback',
      trigger: 'refusal',
      api_refusal_category: 'cyber',
    }, NO_RETRACTION)).refusalCategory).toBe('cyber')
    expect(first(mapModelFallbackWire({
      subtype: 'model_refusal_fallback',
      trigger: 'refusal',
      api_refusal_category: null,
    }, NO_RETRACTION)).refusalCategory).toBeNull()
  })

  it('reports a refusal with no retry as declined and names no target model', () => {
    const event = first(mapModelFallbackWire({
      subtype: 'model_refusal_no_fallback',
      original_model: 'claude-fable-5',
      // The wire may still carry a target here; nothing took over, so it is not one.
      fallback_model: 'claude-opus-5',
    }, NO_RETRACTION))

    expect(event.outcome).toBe('declined')
    expect(event.toModel).toBeUndefined()
    expect(event.trigger).toBe('refusal')
  })

  it('emits an eviction for retracted uuids the harness can place', () => {
    const events = mapModelFallbackWire(
      {
        subtype: 'model_refusal_fallback',
        trigger: 'refusal',
        retracted_message_uuids: ['uuid-a', 'uuid-b'],
      },
      (uuids) => uuids.filter((u) => u === 'uuid-a').map(() => 'msg_1'),
    )

    expect(events[1]).toEqual({ type: 'messages_retracted', messageIds: ['msg_1'] })
  })

  it('stays silent when no retracted uuid maps to a message we hold', () => {
    const events = mapModelFallbackWire(
      { subtype: 'model_refusal_fallback', trigger: 'refusal', retracted_message_uuids: ['unknown'] },
      () => [],
    )

    expect(events).toHaveLength(1)
  })
})
