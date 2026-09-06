import { describe, expect, it, vi } from 'vitest'
import { leaveMobileSession, sessionRemovalStatus } from './session-exit'

const makeRuntime = () => ({ sessionId: 'active', epoch: 3, dispose: vi.fn() })

describe('mobile session exit', () => {
  it('releases ownership and removes the runtime used by reconnect', () => {
    const runtime = makeRuntime()
    const ref = { current: runtime as ReturnType<typeof makeRuntime> | null }
    const send = vi.fn()
    leaveMobileSession({ send }, ref)
    expect(send).toHaveBeenCalledWith({ type: 'leave_session', sessionId: 'active' })
    expect(runtime.dispose).toHaveBeenCalledOnce()
    expect(ref.current).toBeNull()
    leaveMobileSession({ send }, ref)
    expect(send).toHaveBeenCalledOnce()
  })

  it('does not retain a restorable runtime when the socket is unavailable', () => {
    const runtime = makeRuntime()
    const ref = { current: runtime as ReturnType<typeof makeRuntime> | null }
    const send = vi.fn(() => { throw new Error('disconnected') })
    expect(() => leaveMobileSession({ send }, ref)).toThrow('disconnected')
    expect(ref.current).toBeNull()
    expect(runtime.dispose).toHaveBeenCalledOnce()
  })

  it.each(['session_kicked', 'session_closed'])('recognizes %s for the active session', (type) => {
    expect(sessionRemovalStatus([{ type, sessionId: 'active' }], makeRuntime(), 3)).toBeTruthy()
  })

  it('ignores other sessions, stale epochs, and malformed events', () => {
    const event = { type: 'session_kicked', sessionId: 'active' }
    expect(sessionRemovalStatus([event], makeRuntime(), 2)).toBeNull()
    expect(sessionRemovalStatus([event], null, 3)).toBeNull()
    expect(sessionRemovalStatus([null, {}, { ...event, sessionId: 'other' }], makeRuntime(), 3)).toBeNull()
  })
})
