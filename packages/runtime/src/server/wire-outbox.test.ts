import { describe, expect, it, vi } from 'vitest'
import { WireOutbox } from './wire-outbox'

describe('WireOutbox', () => {
  it('writes control before queued stream frames and holds frames while the socket is full', () => {
    vi.useFakeTimers()
    let buffered = 0
    const written: string[] = []
    const outbox = new WireOutbox({ write: (frame) => { written.push(String(frame)); buffered += frame.length }, buffered: () => buffered, highWaterBytes: 4 })
    outbox.send(['s1', 's2', 's3'], 'stream')
    expect(written).toEqual(['s1', 's2', 's3'])
    expect(outbox.congested()).toBe(true)
    outbox.send(['s4'], 'stream')
    outbox.send(['c1'], 'control')
    expect(written).toEqual(['s1', 's2', 's3'])
    const drained = vi.fn()
    outbox.onDrain(drained)
    buffered = 0
    vi.advanceTimersByTime(20)
    expect(written).toEqual(['s1', 's2', 's3', 'c1', 's4'])
    buffered = 0
    vi.advanceTimersByTime(20)
    expect(outbox.congested()).toBe(false)
    expect(drained).toHaveBeenCalled()
    vi.useRealTimers()
  })
})
