/**
 * Android gestures shaped like a finger's rather than a plotter's.
 *
 * `gesture-synth` produces the geometric ideal: a tap whose press and release are one
 * instant apart on the exact centre, a swipe along a ruled line at constant speed,
 * every contact at full pressure. Nothing a person does looks like that, and an app
 * reading `MotionEvent`s can tell. These produce the same gestures with the traits a
 * real touch has — a held press, an aim that lands near rather than on the target,
 * a path that bows, a speed that changes, a pressure that rises and wobbles.
 *
 * Every variation stays inside what the guest's gesture recognisers tolerate, since a
 * humanised tap that reads as a drag is worse than a robotic one that works:
 *   - aim error stays within ~1% of the short side (~4dp), well inside a 48dp target;
 *   - drift while pressed stays within ~0.15% (~1.5px), far below the 8dp touch slop;
 *   - a swipe keeps the release velocity the caller's duration asked for: a short one
 *     accelerates into release so it still flings, a long one decelerates so it lands.
 *
 * Coordinates are computed in pixels of the wire size and emitted as ratios, so the
 * jitter is round on any aspect ratio rather than stretched along the long side.
 */

import {
  clamp01,
  LONG_PRESS_MS,
  STEP_MS,
  SWIPE_MS,
  type TouchContact,
  type TouchPhase,
  type TouchStep,
} from '../gesture-synth'

export interface HumanTouchOptions {
  /** The wire size contacts are projected into; jitter is scaled to its short side. */
  screen: { width: number; height: number }
  /** Uniform [0, 1). Injectable so tests can seed it. */
  random?: () => number
}

/** Standard deviation of where a press lands relative to where it was aimed. */
const AIM_SIGMA = 0.004
/** Hard cap on aim error, so a small target is never missed. */
const AIM_MAX = 0.01
/** How far a resting finger rolls while pressed. */
const DRIFT_MAX = 0.0015
/** Sample noise along a moving path. */
const PATH_NOISE_SIGMA = 0.0008

/** A tap is held about as long as a person holds one. */
const TAP_HOLD_MS: Range = [55, 115]
/** Gap between the release of the first tap and the press of the second. */
const DOUBLE_TAP_GAP_MS: Range = [90, 160]
/** A long press is held a little past what was asked, never short of it. */
const LONG_PRESS_EXTRA_MS: Range = [0, 150]
/** A still finger reports a move this often. */
const HOLD_SAMPLE_MS: Range = [60, 120]

/**
 * Above this a swipe is a drag, below it a flick. Matches the split `gesture-synth`
 * draws with `SWIPE_MS` and `DRAG_MS`.
 */
const FLICK_MAX_MS = 300
/** Sideways bow of a swipe, as a fraction of its length. */
const BOW_SIGMA = 0.04
const BOW_MAX = 0.08

/** Peak pressure varies per gesture: people press differently each time. */
const PEAK_PRESSURE: Range = [0.45, 0.8]
const PRESSURE_NOISE = 0.03

type Range = readonly [min: number, max: number]
type Point = { x: number; y: number }

class Hand {
  private readonly random: () => number
  private readonly width: number
  private readonly height: number
  /** Pixels per unit of the scales above. */
  private readonly unit: number

  constructor(options: HumanTouchOptions) {
    this.random = options.random ?? Math.random
    this.width = Math.max(1, options.screen.width)
    this.height = Math.max(1, options.screen.height)
    this.unit = Math.min(this.width, this.height)
  }

  between([min, max]: Range): number {
    return min + (max - min) * this.random()
  }

  /** Box-Muller. `1 - random()` keeps the logarithm off zero. */
  gaussian(): number {
    const u = 1 - this.random()
    const v = this.random()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }

  /** A normal sample, clamped so a tail draw cannot cross a limit that matters. */
  bounded(sigma: number, max: number): number {
    return Math.max(-max, Math.min(max, this.gaussian() * sigma))
  }

  toPixels(xRatio: number, yRatio: number): Point {
    return { x: clamp01(xRatio) * this.width, y: clamp01(yRatio) * this.height }
  }

  /** Where a press aimed at `point` actually lands. */
  aim(point: Point): Point {
    const radius = Math.abs(this.bounded(AIM_SIGMA, AIM_MAX)) * this.unit
    const angle = this.random() * 2 * Math.PI
    return { x: point.x + radius * Math.cos(angle), y: point.y + radius * Math.sin(angle) }
  }

  /** A resting finger's small roll around `point`. */
  drift(point: Point): Point {
    const max = DRIFT_MAX * this.unit
    return {
      x: point.x + this.between([-max, max]),
      y: point.y + this.between([-max, max]),
    }
  }

  noise(point: Point): Point {
    const sigma = PATH_NOISE_SIGMA * this.unit
    return {
      x: point.x + this.bounded(sigma, sigma * 2.5),
      y: point.y + this.bounded(sigma, sigma * 2.5),
    }
  }

  /** A pressure near `level`, kept inside what the wire can say about a pressed finger. */
  pressure(level: number): number {
    return Math.min(1, Math.max(0.05, level + this.bounded(PRESSURE_NOISE, PRESSURE_NOISE * 2)))
  }

  /** Split `totalMs` into `count` uneven intervals that still add up to it. */
  intervals(totalMs: number, count: number): number[] {
    const weights = Array.from({ length: count }, () => this.between([0.75, 1.25]))
    const sum = weights.reduce((total, weight) => total + weight, 0)
    return weights.map((weight) => (totalMs * weight) / sum)
  }

  contact(point: Point, phase: TouchPhase, pressure: number): TouchContact {
    return {
      id: 1,
      xRatio: clamp01(point.x / this.width),
      yRatio: clamp01(point.y / this.height),
      phase,
      pressure,
    }
  }

  /**
   * A finger pressed at `point` for `holdMs`, reporting small moves while it rests.
   *
   * Pressure starts below its peak and rises into it, the way a fingertip flattens
   * against glass.
   */
  press(point: Point, holdMs: number, sampleMs: Range): TouchStep[] {
    const peak = this.between(PEAK_PRESSURE)
    const landed = this.aim(point)
    const moves = Math.max(1, Math.round(holdMs / this.between(sampleMs)))
    const delays = this.intervals(holdMs, moves + 1)
    const steps: TouchStep[] = [{
      kind: 'contacts',
      contacts: [this.contact(landed, 'began', this.pressure(peak * 0.6))],
      delayMs: delays[0]!,
    }]
    let at = landed
    for (let index = 1; index <= moves; index += 1) {
      at = this.drift(landed)
      const rise = Math.min(1, index / 2)
      steps.push({
        kind: 'contacts',
        contacts: [this.contact(at, 'moved', this.pressure(peak * (0.6 + 0.4 * rise)))],
        delayMs: delays[index]!,
      })
    }
    steps.push({ kind: 'contacts', contacts: [this.contact(at, 'ended', 0)], delayMs: 0 })
    return steps
  }
}

export function humanTap(xRatio: number, yRatio: number, options: HumanTouchOptions): TouchStep[] {
  const hand = new Hand(options)
  return hand.press(hand.toPixels(xRatio, yRatio), hand.between(TAP_HOLD_MS), [STEP_MS, STEP_MS * 2])
}

/** Two taps, each aimed afresh — a person does not land on the same pixel twice. */
export function humanDoubleTap(xRatio: number, yRatio: number, options: HumanTouchOptions): TouchStep[] {
  const hand = new Hand(options)
  const point = hand.toPixels(xRatio, yRatio)
  const first = hand.press(point, hand.between(TAP_HOLD_MS), [STEP_MS, STEP_MS * 2])
  const second = hand.press(point, hand.between(TAP_HOLD_MS), [STEP_MS, STEP_MS * 2])
  first[first.length - 1] = { ...first.at(-1)!, delayMs: hand.between(DOUBLE_TAP_GAP_MS) }
  return [...first, ...second]
}

export function humanLongPress(
  xRatio: number,
  yRatio: number,
  options: HumanTouchOptions & { holdMs?: number },
): TouchStep[] {
  const hand = new Hand(options)
  const holdMs = (options.holdMs ?? LONG_PRESS_MS) + hand.between(LONG_PRESS_EXTRA_MS)
  return hand.press(hand.toPixels(xRatio, yRatio), holdMs, HOLD_SAMPLE_MS)
}

/**
 * A one-finger stroke that bows sideways and changes speed along the way.
 *
 * The speed profile follows the caller's intent, read off the duration. A flick eases
 * IN: it is still accelerating at release, so the guest's velocity tracker sees at
 * least the speed a straight line would have had, and the list coasts. A drag eases in
 * AND out: it arrives at rest, so the list stops where it was let go.
 */
export function humanSwipe(
  fromXRatio: number,
  fromYRatio: number,
  toXRatio: number,
  toYRatio: number,
  options: HumanTouchOptions & { durationMs?: number },
): TouchStep[] {
  const hand = new Hand(options)
  const requestedMs = options.durationMs ?? SWIPE_MS
  const durationMs = requestedMs * hand.between([0.92, 1.08])
  const ease = requestedMs <= FLICK_MAX_MS ? easeIn : easeInOut

  const start = hand.aim(hand.toPixels(fromXRatio, fromYRatio))
  const end = hand.aim(hand.toPixels(toXRatio, toYRatio))
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  // Unit normal to the stroke; a zero-length stroke has no sideways to bow into.
  const normal = length > 0 ? { x: -dy / length, y: dx / length } : { x: 0, y: 0 }
  const bow = hand.bounded(BOW_SIGMA, BOW_MAX) * length

  const count = Math.max(2, Math.round(durationMs / STEP_MS))
  const delays = hand.intervals(durationMs, count - 1)
  const peak = hand.between(PEAK_PRESSURE)

  return Array.from({ length: count }, (_, index): TouchStep => {
    const first = index === 0
    const last = index === count - 1
    const phase: TouchPhase = first ? 'began' : last ? 'ended' : 'moved'
    const progress = ease(index / (count - 1))
    // sin(πp) is zero at both ends, so the bow never moves where the stroke starts
    // or where it is released.
    const sideways = Math.sin(Math.PI * progress) * bow
    const onPath = {
      x: start.x + dx * progress + normal.x * sideways,
      y: start.y + dy * progress + normal.y * sideways,
    }
    const point = first || last ? onPath : hand.noise(onPath)
    // Presses in, then eases off a little as the finger lifts away.
    const level = first ? 0.6 : Math.min(1, index / 3) * (1 - 0.2 * progress)
    return {
      kind: 'contacts',
      contacts: [hand.contact(point, phase, last ? 0 : hand.pressure(peak * Math.max(0.6, level)))],
      delayMs: last ? 0 : delays[index]!,
    }
  })
}

function easeIn(progress: number): number {
  return progress ** 1.6
}

/** Smoothstep: zero speed at both ends. */
function easeInOut(progress: number): number {
  return progress * progress * (3 - 2 * progress)
}
