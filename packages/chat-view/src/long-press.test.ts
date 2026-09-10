import { describe, expect, it, vi } from 'vitest'
import { createLongPressTracker } from './long-press'

/** Manual timer so a test can advance the press without real waiting. */
function fakeTimers() {
  const pending = new Map<number, () => void>()
  let next = 1
  return {
    setTimer: (fn: () => void, _ms: number) => { const id = next++; pending.set(id, fn); return id },
    clearTimer: (handle: unknown) => { pending.delete(handle as number) },
    fire: () => { for (const [id, fn] of pending) { pending.delete(id); fn() } },
    armed: () => pending.size,
  }
}

describe('long-press tracker', () => {
  it('fires once the finger has rested for the delay', () => {
    const timers = fakeTimers()
    const onLongPress = vi.fn()
    const tracker = createLongPressTracker({ onLongPress, ...timers })
    tracker.down({ x: 10, y: 20 })
    expect(onLongPress).not.toHaveBeenCalled()
    timers.fire()
    expect(onLongPress).toHaveBeenCalledWith({ x: 10, y: 20 })
    expect(tracker.didFire()).toBe(true)
  })

  it('cancels when the finger lifts before the delay', () => {
    const timers = fakeTimers()
    const onLongPress = vi.fn()
    const tracker = createLongPressTracker({ onLongPress, ...timers })
    tracker.down({ x: 0, y: 0 })
    tracker.cancel()
    timers.fire()
    expect(onLongPress).not.toHaveBeenCalled()
    expect(tracker.didFire()).toBe(false)
  })

  it('treats a drag past the tolerance as a scroll, not a press', () => {
    const timers = fakeTimers()
    const onLongPress = vi.fn()
    const tracker = createLongPressTracker({ onLongPress, moveTolerancePx: 10, ...timers })
    tracker.down({ x: 0, y: 0 })
    tracker.move({ x: 4, y: 4 })
    expect(timers.armed()).toBe(1)
    tracker.move({ x: 0, y: 12 })
    expect(timers.armed()).toBe(0)
    timers.fire()
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('resets the fired flag on the next press', () => {
    const timers = fakeTimers()
    const tracker = createLongPressTracker({ onLongPress: () => {}, ...timers })
    tracker.down({ x: 0, y: 0 })
    timers.fire()
    expect(tracker.didFire()).toBe(true)
    tracker.down({ x: 0, y: 0 })
    expect(tracker.didFire()).toBe(false)
  })
})
