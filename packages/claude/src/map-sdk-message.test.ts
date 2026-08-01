import { describe, expect, it } from 'vitest'
import { applySdkMessage, createSdkMapState } from './map-sdk-message'
import type { SessionTurnEvent } from '@superone/shared/environment'

describe('applySdkMessage', () => {
  it('maps text deltas from stream_event', () => {
    const state = createSdkMapState('b1')
    const events: SessionTurnEvent[] = []
    const r = applySdkMessage(
      {
        type: 'stream_event',
        session_id: 's1',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'hi' },
        },
      },
      state,
      (e) => events.push(e),
    )
    expect(r.textDelta).toBe('hi')
    expect(r.sessionId).toBe('s1')
    expect(events).toEqual([])
  })

  it('emits tool started + input_delta + completed', () => {
    const state = createSdkMapState('b1')
    const events: SessionTurnEvent[] = []
    applySdkMessage(
      {
        type: 'stream_event',
        session_id: 's1',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'tu1', name: 'Bash' },
        },
      },
      state,
      (e) => events.push(e),
    )
    applySdkMessage(
      {
        type: 'stream_event',
        session_id: 's1',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"c":' },
        },
      },
      state,
      (e) => events.push(e),
    )
    applySdkMessage(
      {
        type: 'user',
        session_id: 's1',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }],
        },
      },
      state,
      (e) => events.push(e),
    )
    expect(events.map((e) => (e.kind === 'tool' ? e.phase : e.kind))).toEqual([
      'started',
      'input_delta',
      'completed',
    ])
  })

  it('result success closes open tools and returns final text', () => {
    const state = createSdkMapState('b1')
    const events: SessionTurnEvent[] = []
    applySdkMessage(
      {
        type: 'assistant',
        session_id: 's1',
        message: {
          content: [{ type: 'tool_use', id: 'tu2', name: 'Read', input: { path: 'a' } }],
        },
      },
      state,
      (e) => events.push(e),
    )
    const r = applySdkMessage(
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        session_id: 's1',
        result: 'done',
      },
      state,
      (e) => events.push(e),
    )
    expect(r.isResult).toBe(true)
    expect(r.resultIsError).toBe(false)
    expect(r.resultText).toBe('done')
    expect(events.some((e) => e.kind === 'tool' && e.phase === 'completed')).toBe(true)
  })
})
