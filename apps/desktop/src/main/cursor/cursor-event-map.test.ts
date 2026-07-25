import { describe, expect, it } from 'vitest'
import { mapInteractionUpdate } from './cursor-event-map'

describe('mapInteractionUpdate', () => {
  it('maps text-delta to content_delta text', () => {
    const events = mapInteractionUpdate('m1', { type: 'text-delta', text: 'hi' } as never)
    expect(events).toEqual([
      { type: 'content_delta', messageId: 'm1', delta: { type: 'text', text: 'hi' } },
    ])
  })

  it('maps tool-call-completed to tool_use + tool_result', () => {
    const events = mapInteractionUpdate('m1', {
      type: 'tool-call-completed',
      callId: 'c1',
      name: 'shell',
      args: { command: 'ls' },
      result: 'ok',
    } as never)
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      type: 'content_delta',
      delta: { type: 'tool_use', toolUseId: 'c1', toolName: 'Bash', status: 'complete' },
    })
    expect(events[1]).toMatchObject({
      type: 'content_delta',
      delta: { type: 'tool_result', toolUseId: 'c1', summary: 'ok' },
    })
  })
})
