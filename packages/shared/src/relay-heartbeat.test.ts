import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRelayHeartbeat, RELAY_PING, RELAY_PONG } from './relay-heartbeat'

describe('createRelayHeartbeat', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function make() {
    const send = vi.fn()
    const onTimeout = vi.fn()
    const heartbeat = createRelayHeartbeat({ send, onTimeout, intervalMs: 100, timeoutMs: 30 })
    return { send, onTimeout, heartbeat }
  }

  it('pings on every interval and stays quiet while pongs arrive in time', () => {
    const { send, onTimeout, heartbeat } = make()
    heartbeat.start()
    vi.advanceTimersByTime(100)
    expect(send).toHaveBeenCalledWith(RELAY_PING)
    expect(heartbeat.onMessage(RELAY_PONG)).toBe(true)
    vi.advanceTimersByTime(100)
    expect(send).toHaveBeenCalledTimes(2)
    heartbeat.onMessage(RELAY_PONG)
    vi.advanceTimersByTime(50)
    expect(onTimeout).not.toHaveBeenCalled()
  })

  it('reports a dead link when a pong misses its deadline, then stops itself', () => {
    const { send, onTimeout, heartbeat } = make()
    heartbeat.start()
    vi.advanceTimersByTime(100)
    vi.advanceTimersByTime(30)
    expect(onTimeout).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(500)
    expect(send).toHaveBeenCalledTimes(1)
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  it('leaves non-pong frames to the caller', () => {
    const { heartbeat } = make()
    expect(heartbeat.onMessage('{"type":"event"}')).toBe(false)
  })

  it('stop() cancels a pending deadline', () => {
    const { onTimeout, heartbeat } = make()
    heartbeat.start()
    vi.advanceTimersByTime(100)
    heartbeat.stop()
    vi.advanceTimersByTime(1_000)
    expect(onTimeout).not.toHaveBeenCalled()
  })

  it('treats a send that throws as the socket already closing', () => {
    const onTimeout = vi.fn()
    const heartbeat = createRelayHeartbeat({
      send: () => { throw new Error('not open') },
      onTimeout,
      intervalMs: 100,
      timeoutMs: 30,
    })
    heartbeat.start()
    vi.advanceTimersByTime(130)
    expect(onTimeout).not.toHaveBeenCalled()
  })
})
