import { describe, expect, it } from 'vitest'
import type { IosSimulatorTouchContact } from '@superone/shared/ios-simulator'
import {
  gestureDurationMs,
  LONG_PRESS_MS,
  synthesizeDoubleTap,
  synthesizeLongPress,
  synthesizePinch,
  synthesizeSwipe,
  type GestureStep,
} from './gesture-synth'

function contacts(step: GestureStep): IosSimulatorTouchContact[] {
  const input = step.input
  if (input.type !== 'touch.update') throw new Error(`expected touch.update, got ${input.type}`)
  return input.contacts
}

function phases(steps: GestureStep[]): string[] {
  return steps.map((step) => contacts(step)[0]!.phase)
}

describe('synthesizeLongPress', () => {
  it('holds past the guest threshold before releasing', () => {
    const steps = synthesizeLongPress(0.5, 0.5)
    expect(steps[0]!.delayMs).toBeGreaterThanOrEqual(500)
    expect(gestureDurationMs(steps)).toBeGreaterThanOrEqual(LONG_PRESS_MS)
  })

  it('sends a stationary move so it is not mistaken for a tap', () => {
    expect(phases(synthesizeLongPress(0.5, 0.5))).toEqual(['began', 'moved', 'ended'])
  })

  it('never moves the contact', () => {
    const points = synthesizeLongPress(0.25, 0.75).map((step) => {
      const contact = contacts(step)[0]!
      return [contact.xRatio, contact.yRatio]
    })
    expect(new Set(points.map((point) => point.join(',')))).toHaveProperty('size', 1)
  })
})

describe('synthesizeSwipe', () => {
  it('begins at the source and ends at the destination', () => {
    const steps = synthesizeSwipe(0.2, 0.8, 0.2, 0.2)
    const first = contacts(steps[0]!)[0]!
    const last = contacts(steps.at(-1)!)[0]!
    expect([first.xRatio, first.yRatio]).toEqual([0.2, 0.8])
    expect([last.xRatio, last.yRatio]).toEqual([0.2, 0.2])
    expect(first.phase).toBe('began')
    expect(last.phase).toBe('ended')
  })

  it('emits enough intermediate samples for the guest to measure velocity', () => {
    // A began/ended pair with nothing between reads as a tap, not a swipe.
    const steps = synthesizeSwipe(0, 0, 1, 1, 180)
    expect(steps.length).toBeGreaterThan(5)
    expect(phases(steps).slice(1, -1).every((phase) => phase === 'moved')).toBe(true)
  })

  it('moves monotonically toward the destination', () => {
    const ys = synthesizeSwipe(0.5, 0.9, 0.5, 0.1).map((step) => contacts(step)[0]!.yRatio)
    for (let index = 1; index < ys.length; index++) {
      expect(ys[index]!).toBeLessThanOrEqual(ys[index - 1]!)
    }
  })

  it('spends the duration it was given', () => {
    expect(gestureDurationMs(synthesizeSwipe(0, 0, 1, 0, 240))).toBeCloseTo(240, 6)
  })

  it('clamps a destination past the screen edge', () => {
    const last = contacts(synthesizeSwipe(0.5, 0.5, 2, -1).at(-1)!)[0]!
    expect(last.xRatio).toBe(1)
    expect(last.yRatio).toBe(0)
  })

  it('still produces a real gesture at an absurdly short duration', () => {
    const steps = synthesizeSwipe(0, 0, 1, 1, 1)
    expect(steps).toHaveLength(2)
    expect(phases(steps)).toEqual(['began', 'ended'])
  })
})

describe('synthesizeDoubleTap', () => {
  it('taps twice within the guest double-tap window', () => {
    const steps = synthesizeDoubleTap(0.4, 0.6)
    expect(steps.map((step) => step.input.type)).toEqual(['tap', 'tap'])
    expect(gestureDurationMs(steps)).toBeLessThan(300)
  })
})

describe('synthesizePinch', () => {
  it('uses exactly two contacts with distinct ids throughout', () => {
    for (const step of synthesizePinch(0.5, 0.5, 2)) {
      const pair = contacts(step)
      expect(pair).toHaveLength(2)
      expect(pair[0]!.id).not.toBe(pair[1]!.id)
    }
  })

  it('narrows the separation when pinching in', () => {
    const steps = synthesizePinch(0.5, 0.5, 0.5)
    const span = (step: GestureStep) => {
      const [a, b] = contacts(step)
      return Math.abs(b!.xRatio - a!.xRatio)
    }
    expect(span(steps.at(-1)!)).toBeLessThan(span(steps[0]!))
  })

  it('widens the separation when spreading out', () => {
    const steps = synthesizePinch(0.5, 0.5, 2)
    const span = (step: GestureStep) => {
      const [a, b] = contacts(step)
      return Math.abs(b!.xRatio - a!.xRatio)
    }
    expect(span(steps.at(-1)!)).toBeGreaterThan(span(steps[0]!))
  })

  it('keeps both contacts on screen near an edge', () => {
    for (const step of synthesizePinch(0.02, 0.5, 3)) {
      for (const contact of contacts(step)) {
        expect(contact.xRatio).toBeGreaterThanOrEqual(0)
        expect(contact.xRatio).toBeLessThanOrEqual(1)
      }
    }
  })

  it('lifts both contacts together at the end', () => {
    const steps = synthesizePinch(0.5, 0.5, 1.5)
    expect(contacts(steps.at(-1)!).every((contact) => contact.phase === 'ended')).toBe(true)
  })
})
