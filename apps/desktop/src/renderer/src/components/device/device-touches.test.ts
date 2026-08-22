import { describe, expect, it } from 'vitest'
import { DeviceTouchTracker } from './device-touches'

describe('DeviceTouchTracker', () => {
  it('keeps two real pointers in one atomic contact snapshot', () => {
    const tracker = new DeviceTouchTracker()
    expect(tracker.begin({ pointerId: 10, pointerType: 'touch', altKey: false, xRatio: 0.2, yRatio: 0.3 })).toEqual([
      { id: 1, phase: 'began', xRatio: 0.2, yRatio: 0.3 },
    ])
    expect(tracker.begin({ pointerId: 11, pointerType: 'touch', altKey: false, xRatio: 0.8, yRatio: 0.7 })).toEqual([
      { id: 1, phase: 'moved', xRatio: 0.2, yRatio: 0.3 },
      { id: 2, phase: 'began', xRatio: 0.8, yRatio: 0.7 },
    ])
    expect(tracker.move({ pointerId: 10, pointerType: 'touch', altKey: false, xRatio: 0.1, yRatio: 0.2 })).toEqual([
      { id: 1, phase: 'moved', xRatio: 0.1, yRatio: 0.2 },
      { id: 2, phase: 'moved', xRatio: 0.8, yRatio: 0.7 },
    ])
  })

  it('ends one pointer without ending the remaining contact', () => {
    const tracker = new DeviceTouchTracker()
    tracker.begin({ pointerId: 10, pointerType: 'touch', altKey: false, xRatio: 0.2, yRatio: 0.3 })
    tracker.begin({ pointerId: 11, pointerType: 'touch', altKey: false, xRatio: 0.8, yRatio: 0.7 })

    expect(tracker.end(10, { xRatio: 0.1, yRatio: 0.2 }, 'ended')).toEqual([
      { id: 1, phase: 'ended', xRatio: 0.1, yRatio: 0.2 },
      { id: 2, phase: 'moved', xRatio: 0.8, yRatio: 0.7 },
    ])
    expect(tracker.contactCount).toBe(1)
  })

  it('creates a mirrored pair for Option-drag with a mouse', () => {
    const tracker = new DeviceTouchTracker()
    expect(tracker.begin({ pointerId: 1, pointerType: 'mouse', altKey: true, xRatio: 0.25, yRatio: 0.4 })).toEqual([
      { id: 1, phase: 'began', xRatio: 0.25, yRatio: 0.4 },
      { id: 2, phase: 'began', xRatio: 0.75, yRatio: 0.6 },
    ])
    expect(tracker.move({ pointerId: 1, pointerType: 'mouse', altKey: true, xRatio: 0.1, yRatio: 0.2 })).toEqual([
      { id: 1, phase: 'moved', xRatio: 0.1, yRatio: 0.2 },
      { id: 2, phase: 'moved', xRatio: 0.9, yRatio: 0.8 },
    ])
  })

  it('rejects contacts beyond the native two-contact limit', () => {
    const tracker = new DeviceTouchTracker()
    tracker.begin({ pointerId: 10, pointerType: 'touch', altKey: false, xRatio: 0.2, yRatio: 0.3 })
    tracker.begin({ pointerId: 11, pointerType: 'touch', altKey: false, xRatio: 0.8, yRatio: 0.7 })
    expect(tracker.begin({ pointerId: 12, pointerType: 'touch', altKey: false, xRatio: 0.5, yRatio: 0.5 })).toBeNull()
    expect(tracker.contactCount).toBe(2)
  })
})
