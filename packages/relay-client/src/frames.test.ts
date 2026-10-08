import { describe, expect, it } from 'vitest'
import { handleInboundFrame, type FrameDecrypt } from './frames'

/** The frame layer is crypto-agnostic; sealing is covered by client and phone-link tests. */
const plain = (payload: unknown) => JSON.stringify(payload)
const plainDecrypt: FrameDecrypt = (data) => JSON.parse(data)

describe('handleInboundFrame', () => {
  it('decrypts object and array envelopes without stamping envelope seq', () => {
    const a = handleInboundFrame({ type: 'event', seq: 1, data: plain({ type: 'status_change', status: 'idle' }) }, plainDecrypt)
    expect(a).toEqual({ kind: 'events', events: [{ type: 'status_change', status: 'idle' }] })
    const b = handleInboundFrame({ type: 'event', seq: 2, data: plain([{ type: 'a' }, { type: 'b' }]) }, plainDecrypt)
    expect(b).toEqual({ kind: 'events', events: [{ type: 'a' }, { type: 'b' }] })
  })

  it('preserves event-owned seq values in mixed envelopes', () => {
    const effect = handleInboundFrame({ type: 'event', seq: 1, data: plain([{ type: 'a', seq: 77 }, { type: 'b' }]) }, plainDecrypt)
    expect(effect).toEqual({ kind: 'events', events: [{ type: 'a', seq: 77 }, { type: 'b' }] })
  })

  it('leaves ordering to the channel: any envelope seq, or none, is delivered', () => {
    for (const seq of [5, 2, 2, undefined]) {
      expect(handleInboundFrame({ type: 'event', seq, data: plain({ type: 'x' }) }, plainDecrypt).kind).toBe('events')
    }
  })

  it('drops an event that does not open', () => {
    const effect = handleInboundFrame({ type: 'event', seq: 1, data: 'sealed-elsewhere' }, () => { throw new Error('decrypt') })
    expect(effect).toEqual({ kind: 'drop' })
  })

  it('decodes terminal frames and desktop_shutdown', () => {
    const effect = handleInboundFrame({ type: 'terminal', data: plain({ type: 'terminal_data', terminalId: 't1' }) }, plainDecrypt)
    expect(effect).toEqual({ kind: 'terminal', payload: { type: 'terminal_data', terminalId: 't1' } })
    expect(handleInboundFrame({ type: 'desktop_shutdown' }, plainDecrypt)).toEqual({ kind: 'desktop_shutdown' })
  })

  it('surfaces desktop lifecycle control frames and ignores a cleartext handshake', () => {
    expect(handleInboundFrame({ type: 'peer_disconnected' }, plainDecrypt)).toEqual({
      kind: 'control',
      frame: { type: 'peer_disconnected' },
    })
    // The host's handshake is sealed inside the channel; a cleartext one is ignored.
    expect(handleInboundFrame({ type: 'handshake', hostName: 'desktop' }, plainDecrypt)).toEqual({ kind: 'drop' })
    // Nothing is replayed, so a relay `reset` has no meaning to this client.
    expect(handleInboundFrame({ type: 'reset' }, plainDecrypt)).toEqual({ kind: 'drop' })
  })
})
