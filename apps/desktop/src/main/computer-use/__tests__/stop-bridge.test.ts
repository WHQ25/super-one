import { describe, it, expect, vi } from 'vitest'
import { isHelperEvent } from '../platform/helper-protocol'
import { handleHelperStopEvent } from '../stop-bridge'

describe('helper reverse channel', () => {
  it('treats a line carrying `event` and no `id` as a push, not a response', () => {
    expect(isHelperEvent({ event: 'computer_use_stop_requested', sessionIds: ['s1'] })).toBe(true)
  })

  it('does not mistake a response for an event', () => {
    // A response always carries an id; without this guard the client would
    // swallow replies instead of resolving the pending call.
    expect(isHelperEvent({ id: 'call-1', ok: true, result: {} })).toBe(false)
    expect(isHelperEvent({ id: 'call-1', ok: true, event: 'weird' })).toBe(false)
  })

  it('rejects malformed lines', () => {
    expect(isHelperEvent(null)).toBe(false)
    expect(isHelperEvent('computer_use_stop_requested')).toBe(false)
    expect(isHelperEvent({ sessionIds: ['s1'] })).toBe(false)
  })
})

describe('status-menu Stop routing', () => {
  it('interrupts every session listed in the event', () => {
    const interrupt = vi.fn()
    handleHelperStopEvent(
      { event: 'computer_use_stop_requested', scope: 'current_turn', sessionIds: ['s1', 's2'] },
      interrupt,
    )
    expect(interrupt.mock.calls).toEqual([['s1'], ['s2']])
  })

  it('interrupts a session only once when it appears twice', () => {
    // The helper keys targets by session+bundle, so one session driving two
    // apps reports its id twice — interrupting twice would be wrong.
    const interrupt = vi.fn()
    handleHelperStopEvent(
      { event: 'computer_use_stop_requested', scope: 'current_turn', sessionIds: ['s1', 's1'] },
      interrupt,
    )
    expect(interrupt).toHaveBeenCalledTimes(1)
  })

  it('ignores unrelated events and malformed payloads', () => {
    const interrupt = vi.fn()
    handleHelperStopEvent({ event: 'something_else', sessionIds: ['s1'] }, interrupt)
    handleHelperStopEvent({ event: 'computer_use_stop_requested' }, interrupt)
    handleHelperStopEvent(
      { event: 'computer_use_stop_requested', sessionIds: ['', 42, null] as unknown as string[] },
      interrupt,
    )
    expect(interrupt).not.toHaveBeenCalled()
  })
})
