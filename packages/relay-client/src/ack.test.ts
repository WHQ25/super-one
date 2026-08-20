import { describe, expect, it } from 'vitest'
import { PROCESSED_SEQ_CAP, SeqAckTracker, TransportAckRegistry } from './ack'
import { EventBuffer } from './buffer'
import { deriveKeys, encryptPayload } from './crypto'
import { handleInboundFrame, makeDecrypt } from './frames'

const MASTER = '0123456789abcdef'.repeat(8)

describe('SeqAckTracker', () => {
  it('adds seq before decrypt and ACKs on decrypt fail', () => {
    const t = new SeqAckTracker()
    expect(t.see(1)).toBe(true)
    const marked = t.markProcessed(1)
    expect(marked.lastAckedSeq).toBe(1)
    expect(t.see(1)).toBe(false)
  })

  it('cumulative ACK of max contiguous seq', () => {
    const t = new SeqAckTracker()
    t.see(1); t.markProcessed(1)
    t.see(3); t.markProcessed(3)
    expect(t.lastAckedSeq).toBe(1)
    t.see(2); const m = t.markProcessed(2)
    expect(m.lastAckedSeq).toBe(3)
    expect(m.advanced).toBe(2)
  })

  it('bounds processed set', () => {
    const t = new SeqAckTracker()
    for (let i = 1; i <= PROCESSED_SEQ_CAP + 50; i++) {
      t.see(i * 2)
    }
    t.trim()
    expect(t.processed.size).toBeLessThanOrEqual(PROCESSED_SEQ_CAP + 50)
    t.lastAckedSeq = 10_000
    t.trim()
    expect([...t.processed].every((s) => s > 10_000)).toBe(true)
  })

  it('isolates ACK namespaces per transport', () => {
    const reg = new TransportAckRegistry()
    const relay = reg.forTransport('relay')
    const lan = reg.forTransport('lan')
    relay.see(1); relay.markProcessed(1)
    expect(lan.lastAckedSeq).toBe(0)
    expect(relay.lastAckedSeq).toBe(1)
  })
})

describe('handleInboundFrame', () => {
  it('decrypts object and array envelopes without stamping envelope seq', async () => {
    const { aesKeyBytes } = deriveKeys(MASTER)
    const decrypt = makeDecrypt(aesKeyBytes)
    const tracker = new SeqAckTracker()
    const obj = encryptPayload(aesKeyBytes, { type: 'status_change', status: 'idle' })
    const a = handleInboundFrame({ type: 'event', seq: 1, data: obj }, tracker, decrypt)
    expect(a.kind).toBe('events')
    if (a.kind === 'events') {
      expect(a.events).toHaveLength(1)
      expect((a.events[0] as { seq?: number }).seq).toBeUndefined()
    }
    const batch = encryptPayload(aesKeyBytes, [{ type: 'a' }, { type: 'b' }])
    const b = handleInboundFrame({ type: 'event', seq: 2, data: batch }, tracker, decrypt)
    expect(b.kind).toBe('events')
    if (b.kind === 'events') expect(b.events).toHaveLength(2)
  })

  it('ACKs when decrypt fails', () => {
    const tracker = new SeqAckTracker()
    const effect = handleInboundFrame(
      { type: 'event', seq: 1, data: 'not-valid-base64!!!' },
      tracker,
      () => { throw new Error('decrypt') },
    )
    expect(effect.kind).toBe('ack')
    expect(tracker.lastAckedSeq).toBe(1)
  })

  it('ignores terminal frames for ACK', () => {
    const { aesKeyBytes } = deriveKeys(MASTER)
    const decrypt = makeDecrypt(aesKeyBytes)
    const tracker = new SeqAckTracker()
    const data = encryptPayload(aesKeyBytes, { type: 'terminal_data', terminalId: 't1' })
    const effect = handleInboundFrame({ type: 'terminal', seq: 9, data }, tracker, decrypt)
    expect(effect.kind).toBe('terminal')
    expect(tracker.lastAckedSeq).toBe(0)
    expect(tracker.processed.size).toBe(0)
  })

  it('reset and desktop_shutdown clear seq and do not invent forcedDropSeq', () => {
    const t = new SeqAckTracker()
    t.see(4); t.markProcessed(4)
    const reset = handleInboundFrame({ type: 'reset' }, t, () => ({}))
    expect(reset.kind).toBe('reset')
    expect(t.lastAckedSeq).toBe(0)
    t.see(2); t.markProcessed(2)
    const shut = handleInboundFrame({ type: 'desktop_shutdown' }, t, () => ({}))
    expect(shut.kind).toBe('desktop_shutdown')
    expect(t.lastAckedSeq).toBe(0)
  })

  it('drops duplicate envelope seq', () => {
    const { aesKeyBytes } = deriveKeys(MASTER)
    const decrypt = makeDecrypt(aesKeyBytes)
    const tracker = new SeqAckTracker()
    const data = encryptPayload(aesKeyBytes, { type: 'ping' })
    handleInboundFrame({ type: 'event', seq: 1, data }, tracker, decrypt)
    const dup = handleInboundFrame({ type: 'event', seq: 1, data }, tracker, decrypt)
    expect(dup.kind).toBe('drop')
  })
})

describe('EventBuffer buffer-first', () => {
  it('holds events until history+snapshot then bumps epoch', () => {
    const b = new EventBuffer()
    b.start()
    b.push([{ type: 'live' }])
    expect(b.isBuffering).toBe(true)
    const { epoch, batches } = b.release()
    expect(epoch).toBe(1)
    expect(batches).toEqual([[{ type: 'live' }]])
    expect(b.isBuffering).toBe(false)
  })
})
