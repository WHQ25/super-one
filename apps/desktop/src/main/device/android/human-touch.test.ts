import { describe, expect, it } from 'vitest'
import { gestureDurationMs, LONG_PRESS_MS, type TouchContact, type TouchStep } from '../gesture-synth'
import { humanDoubleTap, humanLongPress, humanSwipe, humanTap } from './human-touch'

const SCREEN = { width: 1080, height: 2400 }
const UNIT = Math.min(SCREEN.width, SCREEN.height)
/** Aim cap plus drift cap, in pixels — the furthest any press may land from its target. */
const LANDING_MAX_PX = (0.01 + 0.0015 * Math.SQRT2) * UNIT + 1e-9
/** Android's default touch slop is 8dp; ~20px at this density. Staying under it keeps a tap a tap. */
const TOUCH_SLOP_PX = 20
const SEEDS = Array.from({ length: 200 }, (_, index) => index + 1)

/** mulberry32: small, seedable, good enough to exercise every branch deterministically. */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function contactOf(step: TouchStep): TouchContact {
  if (step.kind !== 'contacts') throw new Error(`expected contacts, got ${step.kind}`)
  return step.contacts[0]!
}

function px(contact: TouchContact) {
  return { x: contact.xRatio * SCREEN.width, y: contact.yRatio * SCREEN.height }
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

describe('humanTap', () => {
  it('holds the press for as long as a finger does, reporting moves while it rests', () => {
    for (const seed of SEEDS) {
      const steps = humanTap(0.5, 0.5, { screen: SCREEN, random: seeded(seed) })
      const phases = steps.map((step) => contactOf(step).phase)
      expect(phases[0]).toBe('began')
      expect(phases.at(-1)).toBe('ended')
      expect(phases.slice(1, -1).length).toBeGreaterThan(0)
      expect(phases.slice(1, -1).every((phase) => phase === 'moved')).toBe(true)
      expect(gestureDurationMs(steps)).toBeGreaterThanOrEqual(55 - 1e-9)
      expect(gestureDurationMs(steps)).toBeLessThanOrEqual(115 + 1e-9)
    }
  })

  it('lands near the target and never rolls far enough to become a drag', () => {
    const target = { x: 0.5 * SCREEN.width, y: 0.5 * SCREEN.height }
    const offsets = new Set<string>()
    for (const seed of SEEDS) {
      const points = humanTap(0.5, 0.5, { screen: SCREEN, random: seeded(seed) }).map((step) => px(contactOf(step)))
      for (const point of points) {
        expect(distance(point, target)).toBeLessThanOrEqual(LANDING_MAX_PX)
        expect(distance(point, points[0]!)).toBeLessThan(TOUCH_SLOP_PX)
      }
      offsets.add(`${Math.round(points[0]!.x)},${Math.round(points[0]!.y)}`)
    }
    // Not the same pixel every time — that is the whole point.
    expect(offsets.size).toBeGreaterThan(SEEDS.length / 4)
  })

  it('presses with a pressure that varies, and lifts with none', () => {
    const pressures = new Set<number>()
    for (const seed of SEEDS.slice(0, 20)) {
      const contacts = humanTap(0.5, 0.5, { screen: SCREEN, random: seeded(seed) }).map(contactOf)
      for (const contact of contacts.slice(0, -1)) {
        expect(contact.pressure).toBeGreaterThan(0)
        expect(contact.pressure).toBeLessThanOrEqual(1)
        pressures.add(contact.pressure!)
      }
      expect(contacts.at(-1)!.pressure).toBe(0)
    }
    expect(pressures.size).toBeGreaterThan(20)
  })
})

describe('humanDoubleTap', () => {
  it('leaves a gap inside the double-tap window between release and second press', () => {
    for (const seed of SEEDS) {
      const steps = humanDoubleTap(0.5, 0.5, { screen: SCREEN, random: seeded(seed) })
      const phases = steps.map((step) => contactOf(step).phase)
      expect(phases.filter((phase) => phase === 'began')).toHaveLength(2)
      const firstUp = phases.indexOf('ended')
      // Android's GestureDetector accepts 40-300ms between the first UP and the second DOWN.
      expect(steps[firstUp]!.delayMs).toBeGreaterThanOrEqual(90)
      expect(steps[firstUp]!.delayMs).toBeLessThanOrEqual(160)
    }
  })
})

describe('humanLongPress', () => {
  it('holds at least as long as asked, without moving past the touch slop', () => {
    for (const seed of SEEDS) {
      const steps = humanLongPress(0.3, 0.7, { screen: SCREEN, random: seeded(seed) })
      expect(gestureDurationMs(steps)).toBeGreaterThanOrEqual(LONG_PRESS_MS - 1e-9)
      const points = steps.map((step) => px(contactOf(step)))
      for (const point of points) expect(distance(point, points[0]!)).toBeLessThan(TOUCH_SLOP_PX)
    }
  })

  it('honours a caller-chosen hold', () => {
    const steps = humanLongPress(0.5, 0.5, { screen: SCREEN, holdMs: 1500, random: seeded(1) })
    expect(gestureDurationMs(steps)).toBeGreaterThanOrEqual(1500 - 1e-9)
  })
})

describe('humanSwipe', () => {
  const from = { x: 0.5, y: 0.8 }
  const to = { x: 0.5, y: 0.2 }
  const targetFrom = { x: from.x * SCREEN.width, y: from.y * SCREEN.height }
  const targetTo = { x: to.x * SCREEN.width, y: to.y * SCREEN.height }

  function swipe(seed: number, durationMs: number) {
    const steps = humanSwipe(from.x, from.y, to.x, to.y, { screen: SCREEN, durationMs, random: seeded(seed) })
    return { steps, points: steps.map((step) => px(contactOf(step))) }
  }

  /** Speed over the last segment against the stroke's mean speed. */
  function releaseRatio(steps: TouchStep[], points: { x: number; y: number }[]): number {
    const mean = distance(points[0]!, points.at(-1)!) / gestureDurationMs(steps)
    const release = distance(points.at(-2)!, points.at(-1)!) / steps.at(-2)!.delayMs
    return release / mean
  }

  it('starts and ends near where it was aimed', () => {
    for (const seed of SEEDS) {
      const { points } = swipe(seed, 180)
      expect(distance(points[0]!, targetFrom)).toBeLessThanOrEqual(0.01 * UNIT + 1e-9)
      expect(distance(points.at(-1)!, targetTo)).toBeLessThanOrEqual(0.01 * UNIT + 1e-9)
    }
  })

  it('bows off the straight line instead of following a ruler', () => {
    let bowed = 0
    for (const seed of SEEDS) {
      const { points } = swipe(seed, 600)
      const start = points[0]!
      const end = points.at(-1)!
      const length = distance(start, end)
      const deviation = Math.max(...points.map((point) =>
        Math.abs((end.x - start.x) * (start.y - point.y) - (start.x - point.x) * (end.y - start.y)) / length))
      expect(deviation).toBeLessThanOrEqual(0.08 * length + 0.002 * UNIT)
      if (deviation > 3) bowed += 1
    }
    expect(bowed).toBeGreaterThan(SEEDS.length / 2)
  })

  it('is still accelerating at the release of a flick, so the list keeps coasting', () => {
    for (const seed of SEEDS) {
      const { steps, points } = swipe(seed, 180)
      expect(releaseRatio(steps, points)).toBeGreaterThan(1)
    }
  })

  it('arrives nearly at rest at the release of a drag, so the list stops there', () => {
    for (const seed of SEEDS) {
      const { steps, points } = swipe(seed, 600)
      expect(releaseRatio(steps, points)).toBeLessThan(0.3)
    }
  })

  it('keeps roughly the duration the caller asked for', () => {
    for (const seed of SEEDS) {
      const total = gestureDurationMs(swipe(seed, 600).steps)
      expect(total).toBeGreaterThanOrEqual(600 * 0.92 - 1e-9)
      expect(total).toBeLessThanOrEqual(600 * 1.08 + 1e-9)
    }
  })

  it('does not divide by zero on a stroke that goes nowhere', () => {
    const steps = humanSwipe(0.5, 0.5, 0.5, 0.5, { screen: SCREEN, random: seeded(3) })
    for (const step of steps) {
      const contact = contactOf(step)
      expect(Number.isFinite(contact.xRatio) && Number.isFinite(contact.yRatio)).toBe(true)
    }
  })
})
