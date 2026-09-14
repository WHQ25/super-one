import { describe, expect, it } from 'vitest'
import { createRetractionLedger, mapModelFallbackWire } from './model-fallback-wire'

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

  it('appends whatever eviction the harness resolves for the retracted uuids', () => {
    const events = mapModelFallbackWire(
      {
        subtype: 'model_refusal_fallback',
        trigger: 'refusal',
        retracted_message_uuids: ['uuid-a', 'uuid-b'],
      },
      (uuids) => [{ type: 'content_retracted', messageId: 'msg_1', blocks: uuids.map((u) => ({ type: 'text', text: u })) }],
    )

    expect(events[1]).toEqual({
      type: 'content_retracted',
      messageId: 'msg_1',
      blocks: [{ type: 'text', text: 'uuid-a' }, { type: 'text', text: 'uuid-b' }],
    })
  })

  it('stays silent when no retracted uuid maps to a message we hold', () => {
    const events = mapModelFallbackWire(
      { subtype: 'model_refusal_fallback', trigger: 'refusal', retracted_message_uuids: ['unknown'] },
      () => [],
    )

    expect(events).toHaveLength(1)
  })
})

describe('createRetractionLedger', () => {
  const refusedFrame = [{ type: 'text', text: 'I can help with' }]
  const toolFrame = [{ type: 'tool_use', id: 'tu_1', name: 'Bash', input: {} }]

  it('resolves a retracted frame to the blocks it produced, not the whole message', () => {
    const ledger = createRetractionLedger()
    ledger.recordAssistantFrame('u-tool', 'msg_1', toolFrame)
    ledger.recordAssistantFrame('u-refused', 'msg_1', refusedFrame)

    expect(ledger.resolve(['u-refused'])).toEqual([
      { type: 'content_retracted', messageId: 'msg_1', blocks: [{ type: 'text', text: 'I can help with' }] },
    ])
  })

  it('groups several retracted frames of one message into a single eviction', () => {
    const ledger = createRetractionLedger()
    ledger.recordAssistantFrame('u-tool', 'msg_1', toolFrame)
    ledger.recordToolResultFrame('u-result', 'msg_1', [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'x' }])

    expect(ledger.resolve(['u-tool', 'u-result'])).toEqual([
      {
        type: 'content_retracted',
        messageId: 'msg_1',
        blocks: [{ type: 'tool_use', toolUseId: 'tu_1' }, { type: 'tool_result', toolUseId: 'tu_1' }],
      },
    ])
  })

  it('forgets a uuid once resolved so supersede + end-of-turn notice evict once', () => {
    const ledger = createRetractionLedger()
    ledger.recordAssistantFrame('u-refused', 'msg_1', refusedFrame)

    expect(ledger.resolve(['u-refused'])).toHaveLength(1)
    expect(ledger.resolve(['u-refused'])).toEqual([])
  })

  it('drops uuids it never saw and tolerates a malformed list', () => {
    const ledger = createRetractionLedger()
    ledger.recordAssistantFrame('u-1', 'msg_1', refusedFrame)

    expect(ledger.resolve(['nope', 42])).toEqual([])
    expect(ledger.resolve(undefined)).toEqual([])
    expect(ledger.resolve('u-1')).toEqual([])
  })

  it('only remembers the message currently streaming', () => {
    const ledger = createRetractionLedger()
    ledger.recordAssistantFrame('u-old', 'msg_1', refusedFrame)
    ledger.recordAssistantFrame('u-new', 'msg_2', refusedFrame)

    expect(ledger.resolve(['u-old'])).toEqual([])
    expect(ledger.resolve(['u-new'])).toHaveLength(1)
  })
})
