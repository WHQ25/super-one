import { beforeEach, describe, expect, it } from 'vitest'
import type { DeviceTouchContact, DeviceTouchPhase } from '@superone/shared/device'
import { MirrorTouchTrack } from './touch-track'

const contact = (
  phase: DeviceTouchPhase,
  xRatio: number,
  yRatio: number,
  id = 1,
): DeviceTouchContact => ({ id, xRatio, yRatio, phase })

describe('collecting a gesture for a mirrored iPhone', () => {
  let track: MirrorTouchTrack

  beforeEach(() => { track = new MirrorTouchTrack() })

  it('holds everything back until the finger lifts', () => {
    // The defining constraint: the helper only speaks whole gestures, so nothing can
    // be forwarded mid-drag however many samples have arrived.
    expect(track.absorb([contact('began', 0.5, 0.9)])).toBeNull()
    expect(track.absorb([contact('moved', 0.5, 0.6)])).toBeNull()
    expect(track.absorb([contact('moved', 0.5, 0.3)])).toBeNull()
    expect(track.absorb([contact('ended', 0.5, 0.1)])?.path).toHaveLength(4)
  })

  it('keeps the lift as the final point of a flick', () => {
    track.absorb([contact('began', 0.5, 0.9)])
    const gesture = track.absorb([contact('ended', 0.5, 0.2)])
    // Direction and speed come from where a swipe finished; dropping the last sample
    // shortens every flick and turns some of them into taps.
    expect(gesture?.path.at(-1)).toEqual({ xRatio: 0.5, yRatio: 0.2 })
  })

  it('reduces a press that never moved to a single point', () => {
    track.absorb([contact('began', 0.4, 0.4)])
    track.absorb([contact('moved', 0.4001, 0.4001)])
    const gesture = track.absorb([contact('ended', 0.4, 0.4)])
    // One point is how the surface knows to send a click rather than a zero-length
    // drag, which some iOS views ignore outright.
    expect(gesture?.path).toEqual([{ xRatio: 0.4, yRatio: 0.4 }])
  })

  it('thins samples denser than a phone can use, measuring from the last KEPT point', () => {
    track.absorb([contact('began', 0.5, 0.5)])
    for (let step = 1; step <= 20; step += 1) {
      track.absorb([contact('moved', 0.5, 0.5 + step * 0.0001)])
    }
    const gesture = track.absorb([contact('ended', 0.5, 0.9)])
    // Nineteen of the twenty samples are dropped, but the twentieth is kept: the
    // threshold accumulates against the last point that survived, not against the
    // previous sample. Comparing neighbours instead would swallow a slow drag whole,
    // however far it travelled.
    expect(gesture?.path).toEqual([
      { xRatio: 0.5, yRatio: 0.5 },
      { xRatio: 0.5, yRatio: 0.502 },
      { xRatio: 0.5, yRatio: 0.9 },
    ])
  })

  it('follows the first finger and ignores a second joining mid-gesture', () => {
    track.absorb([contact('began', 0.2, 0.2, 1)])
    // A pinch. There is one synthetic mouse to send it down, so letting the newest
    // contact win would drag from one finger to the other — a gesture nobody made.
    track.absorb([contact('moved', 0.3, 0.3, 1), contact('began', 0.8, 0.8, 2)])
    const gesture = track.absorb([contact('ended', 0.4, 0.4, 1)])
    expect(gesture?.path).toEqual([
      { xRatio: 0.2, yRatio: 0.2 },
      { xRatio: 0.3, yRatio: 0.3 },
      { xRatio: 0.4, yRatio: 0.4 },
    ])
  })

  it('throws a cancelled gesture away instead of sending it', () => {
    track.absorb([contact('began', 0.5, 0.5)])
    track.absorb([contact('moved', 0.5, 0.2)])
    expect(track.absorb([contact('cancelled', 0.5, 0.2)])).toBeNull()
    // And leaves nothing behind for the next one to inherit.
    track.absorb([contact('began', 0.1, 0.1)])
    expect(track.absorb([contact('ended', 0.1, 0.1)])?.path).toEqual([{ xRatio: 0.1, yRatio: 0.1 }])
  })

  it('starts over when a new contact id appears without the old one ending', () => {
    track.absorb([contact('began', 0.5, 0.5, 1)])
    const gesture = track.absorb([contact('ended', 0.9, 0.9, 7)])
    expect(gesture?.path).toEqual([{ xRatio: 0.9, yRatio: 0.9 }])
  })
})
