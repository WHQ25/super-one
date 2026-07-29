import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import { forEachAgentEventPayload } from './agent-event-payload'

describe('forEachAgentEventPayload', () => {
  it('forwards every event from a batch in order', () => {
    const callback = vi.fn()
    const events = [
      { type: 'status_change', status: 'streaming' },
      { type: 'status_change', status: 'idle' },
    ] as AgentEvent[]

    forEachAgentEventPayload(events, callback)

    expect(callback.mock.calls.map(([event]) => event)).toEqual(events)
  })

  it('keeps compatibility with singleton event payloads', () => {
    const callback = vi.fn()
    const event = { type: 'status_change', status: 'idle' } as AgentEvent

    forEachAgentEventPayload(event, callback)

    expect(callback).toHaveBeenCalledWith(event)
  })
})
