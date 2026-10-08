import { describe, expect, it } from 'vitest'
import type { EnvironmentEventEnvelope } from './environment/events'
import { mapNodeSessionEvents } from './node-session-event-map'

const loggedAt = Date.parse('2026-10-08T05:00:00.000Z')

function envelope(eventType: string, payload: unknown): EnvironmentEventEnvelope {
  return {
    eventId: 'e1', sequence: '1', timestamp: loggedAt, aggregateType: 'session', aggregateId: 'sid-1',
    eventType, eventVersion: 1, payload, environmentId: 'env-1',
  }
}

const ctx = { sessionId: 'sid-1', providerId: 'codex', nowIso: () => '2030-01-01T00:00:00.000Z' }

describe('remote turn completion time', () => {
  it('takes the time the node logged the terminal event', () => {
    const events = mapNodeSessionEvents([
      envelope('session.agent_event', { event: { type: 'message_start', message: { id: 'a1', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'codex' } } }),
      envelope('session.agent_event', { event: { type: 'message_complete', messageId: 'a1' } }),
    ], ctx)
    expect(events.find((event) => event.type === 'message_complete')).toMatchObject({ metadata: { completedAt: '2026-10-08T05:00:00.000Z' } })
  })

  it('stamps the interrupt and error a durable turn ends with', () => {
    const interrupted = mapNodeSessionEvents([
      envelope('session.assistant_delta', { blockId: 'a1', delta: 'hi' }),
      envelope('session.turn_interrupted', { reason: 'client_interrupt' }),
    ], ctx)
    expect(interrupted.find((event) => event.type === 'message_interrupted')).toMatchObject({ metadata: { completedAt: '2026-10-08T05:00:00.000Z' } })
    const failed = mapNodeSessionEvents([envelope('session.turn_error', { message: 'boom' })], ctx)
    expect(failed.find((event) => event.type === 'message_error')).toMatchObject({ metadata: { completedAt: '2026-10-08T05:00:00.000Z' } })
  })
})
