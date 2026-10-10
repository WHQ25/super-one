import { describe, expect, it, vi } from 'vitest'
import { leaveMobileSession, sessionRemovalStatus } from './session-exit'

const makeRuntime = () => ({ sessionId: 'active', epoch: 3, dispose: vi.fn() })

describe('mobile session exit', () => {
  it('releases ownership and removes the runtime used by reconnect', async () => {
    const runtime = makeRuntime()
    const ref = { current: runtime as ReturnType<typeof makeRuntime> | null }
    const stopSession = vi.fn().mockResolvedValue(undefined)
    await leaveMobileSession({ stopSession }, ref)
    expect(stopSession).toHaveBeenCalledOnce()
    expect(runtime.dispose).toHaveBeenCalledOnce()
    expect(ref.current).toBeNull()
    await leaveMobileSession({ stopSession }, ref)
    expect(stopSession).toHaveBeenCalledOnce()
  })

  it('does not retain a restorable runtime when the socket is unavailable', async () => {
    const runtime = makeRuntime()
    const ref = { current: runtime as ReturnType<typeof makeRuntime> | null }
    const stopSession = vi.fn().mockRejectedValue(new Error('disconnected'))
    await expect(leaveMobileSession({ stopSession }, ref)).rejects.toThrow('disconnected')
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

  it('ignores a removal event for the same session ID on another host', () => {
    const runtime = { ...makeRuntime(), sourceEnvironmentId: 'node' }
    expect(sessionRemovalStatus([{ type: 'session_closed', sessionId: 'active', environmentId: 'desktop' }], runtime, 3)).toBeNull()
    expect(sessionRemovalStatus([{ type: 'session_closed', sessionId: 'active', environmentId: 'node' }], runtime, 3)).toBeTruthy()
  })
})
