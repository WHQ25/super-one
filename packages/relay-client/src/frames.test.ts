import { describe, expect, it } from 'vitest'
import { handleInboundFrame } from './frames'

describe('relay controls outside the native channel', () => {
  it('retains presence, shutdown, kick and heartbeat controls', () => {
    expect(handleInboundFrame({ type: 'peer_disconnected' })).toEqual({ kind: 'control', frame: { type: 'peer_disconnected' } })
    expect(handleInboundFrame({ type: 'kicked', mobileDeviceId: 'p' })).toEqual({ kind: 'control', frame: { type: 'kicked', mobileDeviceId: 'p' } })
    expect(handleInboundFrame({ type: 'desktop_shutdown' })).toEqual({ kind: 'desktop_shutdown' })
    expect(handleInboundFrame({ type: 'pong' })).toEqual({ kind: 'pong' })
  })
  it.each(['event', 'response', 'response_chunk', 'terminal', 'handshake', 'reset'])('never opens the legacy application envelope %s', type => {
    expect(handleInboundFrame({ type, data: 'legacy application payload' })).toEqual({ kind: 'drop' })
  })
})
