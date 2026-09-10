import { describe, expect, it } from 'vitest'
import { createImageGesture, IMAGE_GESTURE_RESPONDER_POLICY, type GestureTouch } from './image-gesture'
import { DOUBLE_TAP_SCALE, IDENTITY_TRANSFORM, MIN_SCALE, type ImageTransform } from './image-preview-state'

const viewport = { width: 400, height: 800 }
/** A portrait picture filling the viewport, so scale 1 is the fit. */
const fitted = { width: 400, height: 800 }

function harness(start: ImageTransform = IDENTITY_TRANSFORM) {
  let transform = start
  let clock = 1_000
  const applied: ImageTransform[] = []
  const animated: ImageTransform[] = []
  let taps = 0
  const gesture = createImageGesture({
    layout: () => ({ viewport, fitted }),
    current: () => transform,
    apply: (next) => { transform = next; applied.push(next) },
    animateTo: (next) => { transform = next; animated.push(next) },
    onSingleTap: () => { taps += 1 },
    now: () => clock,
  })
  return {
    gesture,
    applied,
    animated,
    get transform() { return transform },
    get taps() { return taps },
    advance(ms: number) { clock += ms },
  }
}

/** Two fingers a given distance apart, centred on the viewport, at an angle. */
function spread(distance: number, degrees = 0): GestureTouch[] {
  const radians = (degrees * Math.PI) / 180
  const dx = (Math.cos(radians) * distance) / 2
  const dy = (Math.sin(radians) * distance) / 2
  const centre = { x: viewport.width / 2, y: viewport.height / 2 }
  return [
    { x: centre.x - dx, y: centre.y - dy },
    { x: centre.x + dx, y: centre.y + dy },
  ]
}

describe('image viewer responder policy', () => {
  it('refuses to hand the gesture over when the second finger lands', () => {
    // The default is to agree, which terminates the pinch before it starts.
    // Removing this line breaks every real two-finger gesture while leaving a
    // synthesised simulator pinch — both fingers at once — working.
    expect(IMAGE_GESTURE_RESPONDER_POLICY.onPanResponderTerminationRequest()).toBe(false)
    expect(IMAGE_GESTURE_RESPONDER_POLICY.onShouldBlockNativeResponder()).toBe(true)
  })
})

describe('image viewer gestures', () => {
  it('pinches when the fingers land one after the other, as a hand does', () => {
    const h = harness()
    // The sequence a real hand produces: one finger down (grant), the second
    // landing re-grants, and only then do both move. A synthesised pinch puts
    // both down at once and never exercises this path.
    h.gesture.grant([spread(100)[0]])
    h.gesture.grant(spread(100))
    h.gesture.move(spread(100))
    h.gesture.move(spread(300))
    expect(h.transform.scale).toBeCloseTo(3)
  })

  it('does not spring back when the second finger arrives', () => {
    const h = harness()
    h.gesture.grant([spread(100)[0]])
    h.gesture.grant(spread(100))
    // Nothing may settle before the gesture has run; that is what made a real
    // pinch look like it did nothing at all.
    expect(h.animated).toEqual([])
    h.gesture.move(spread(100))
    h.gesture.move(spread(200))
    expect(h.applied.at(-1)?.scale).toBeCloseTo(2)
  })

  it('turns the picture with two fingers and settles on a quarter', () => {
    const h = harness()
    h.gesture.grant([spread(200)[0]])
    h.gesture.grant(spread(200))
    h.gesture.move(spread(200, 0))
    h.gesture.move(spread(200, 80))
    expect(h.transform.rotation).toBeCloseTo(80)
    h.gesture.release(spread(200, 80)[1])
    expect(h.animated.at(-1)?.rotation).toBe(90)
  })

  it('holds a pinch that is released as a pinch, not read as a tap', () => {
    const h = harness()
    h.gesture.grant([spread(100)[0]])
    h.gesture.grant(spread(100))
    h.gesture.move(spread(100))
    h.gesture.move(spread(280))
    h.gesture.release(spread(280)[1])
    expect(h.taps).toBe(0)
    expect(h.animated.at(-1)?.scale).toBeCloseTo(2.8)
  })

  it('a single tap toggles the chrome and never zooms', () => {
    const h = harness()
    const point = { x: 200, y: 400 }
    h.gesture.grant([point])
    h.gesture.release(point)
    expect(h.taps).toBe(1)
    expect(h.transform.scale).toBe(MIN_SCALE)
  })

  it('a second tap inside the window zooms instead of toggling again', () => {
    const h = harness()
    const point = { x: 200, y: 300 }
    h.gesture.grant([point])
    h.gesture.release(point)
    h.advance(120)
    h.gesture.grant([point])
    h.gesture.release(point)
    expect(h.taps).toBe(1)
    expect(h.transform.scale).toBe(DOUBLE_TAP_SCALE)
  })

  it('two taps too far apart in time are two separate taps', () => {
    const h = harness()
    const point = { x: 200, y: 300 }
    h.gesture.grant([point])
    h.gesture.release(point)
    h.advance(900)
    h.gesture.grant([point])
    h.gesture.release(point)
    expect(h.taps).toBe(2)
    expect(h.transform.scale).toBe(MIN_SCALE)
  })

  it('a drag past the slop is not a tap', () => {
    const h = harness()
    h.gesture.grant([{ x: 200, y: 400 }])
    h.gesture.move([{ x: 200, y: 300 }])
    h.gesture.release({ x: 200, y: 300 })
    expect(h.taps).toBe(0)
  })

  it('pans only once zoomed, and stays inside the picture', () => {
    const fittedOnly = harness()
    fittedOnly.gesture.grant([{ x: 200, y: 400 }])
    fittedOnly.gesture.move([{ x: 260, y: 400 }])
    // A fitted picture has nowhere to go; the drag must not shift it.
    expect(fittedOnly.applied).toEqual([])

    const zoomed = harness({ scale: 2, translate: { x: 0, y: 0 }, rotation: 0 })
    zoomed.gesture.grant([{ x: 200, y: 400 }])
    zoomed.gesture.move([{ x: 260, y: 400 }])
    expect(zoomed.applied.at(-1)?.translate.x).toBe(60)
    zoomed.gesture.release({ x: 260, y: 400 })
    // Settling clamps it back against the picture's edge.
    expect(Math.abs(zoomed.transform.translate.x)).toBeLessThanOrEqual((fitted.width * 2 - viewport.width) / 2)
  })

  it('carries on as a pan when one finger of a pinch lifts', () => {
    const h = harness()
    h.gesture.grant([spread(100)[0]])
    h.gesture.grant(spread(100))
    h.gesture.move(spread(100))
    h.gesture.move(spread(300))
    const zoomed = h.transform.scale
    h.gesture.move([{ x: 200, y: 400 }])
    h.gesture.move([{ x: 240, y: 400 }])
    expect(h.transform.scale).toBeCloseTo(zoomed)
    expect(h.applied.at(-1)?.translate.x).toBeCloseTo(h.applied.at(-2)!.translate.x + 40)
  })

  it('a terminated gesture settles rather than being left mid-pinch', () => {
    const h = harness()
    h.gesture.grant([spread(100)[0]])
    h.gesture.grant(spread(100))
    h.gesture.move(spread(100))
    h.gesture.move(spread(900))
    h.gesture.terminate()
    // 9× overshot the ceiling; the settle brings it back inside.
    expect(h.animated.at(-1)?.scale).toBe(4)
  })
})
