import { describe, expect, it, vi } from 'vitest'
import { OpenCodeSteeringGate } from './steering-gate'
import type { OpenCodeV2Event } from './opencode-v2-types'
const event = (type: string, data: Record<string, unknown>) => ({ id: type, type, data }) as OpenCodeV2Event
describe('native steering completion gate', () => {
  it('holds completion through a lost receipt until its observed inbox input is cancelled', () => {
    const complete = vi.fn(), gate = new OpenCodeSteeringGate(complete, () => {})
    gate.begin()
    gate.observe(event('session.inbox.enqueued', { inboxID: 'new', item: { type: 'user' } }))
    expect(gate.hold(false)).toBe(true)
    gate.end()
    expect(complete).not.toHaveBeenCalled()
    gate.observe(event('session.inbox.cancelled', { inboxID: 'new' }))
    expect(complete).toHaveBeenCalledOnce()
  })
  it('does not settle an old completion after the steered execution starts', () => {
    const complete = vi.fn(), gate = new OpenCodeSteeringGate(complete, () => {})
    gate.begin(); gate.hold(false); gate.admitted('new')
    gate.observe(event('session.execution.started', {}))
    gate.observe(event('session.inbox.delivered', { inboxID: 'new' }))
    gate.end()
    expect(complete).not.toHaveBeenCalled()
    expect(gate.hold(false)).toBe(false)
  })
  it('publishes checkpoints only after the caller has consumed its user bubble', () => {
    const emit = vi.fn(), gate = new OpenCodeSteeringGate(() => {}, emit)
    const checkpoint = { type: 'checkpoint_captured' as const, messageId: 'assistant', checkpointId: 'native', resumePointId: 'native', userMessageId: 'user' }
    gate.begin()
    expect(gate.buffer(checkpoint)).toBe(true)
    expect(emit).not.toHaveBeenCalled()
    gate.consumed()
    expect(emit).toHaveBeenCalledWith(checkpoint)
    gate.clear(); gate.end()
  })
  it('never revives deferred completion after interrupt', () => {
    const complete = vi.fn(), gate = new OpenCodeSteeringGate(complete, () => {})
    gate.begin(); gate.hold(false); gate.admitted('new')
    expect(gate.hold(true)).toBe(false)
    gate.end(); gate.observe(event('session.inbox.cancelled', { inboxID: 'new' }))
    expect(complete).not.toHaveBeenCalled()
  })
})
