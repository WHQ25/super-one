import type { BrowserWindow, Rectangle } from 'electron'
import type { WindowFoldStep } from '@superone/shared/agent-types'

/**
 * Step-by-step window geometry animation for the mini-window fold.
 *
 * `setBounds(bounds, true)` would be less code, but its duration is decided by AppKit
 * and it only exists on macOS — neither works here. The fold is *choreographed*: the
 * window edge has to move in lockstep with a panel collapsing inside the renderer, so
 * both sides need the same clock, the same easing and the same step boundaries.
 */

const FRAME_MS = 16

/**
 * The exact curve the panels animate on (`cubic-bezier(0.4, 0, 0.2, 1)`, see
 * `layout-constants.ts` and `SidebarFrame`). This has to be the *same* curve, not a
 * near-miss: an eased-quad approximation drifts ~10% mid-beat, which on a 400px panel
 * is 40px of disagreement between the window edge and the panel closing inside it —
 * seen as the chat column jittering while it should be standing still.
 */
export function cubicBezierEasing(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const sampleX = (t: number): number => ((ax * t + bx) * t + cx) * t
  const sampleY = (t: number): number => ((ay * t + by) * t + cy) * t
  const slopeX = (t: number): number => (3 * ax * t + 2 * bx) * t + cx
  return (x) => {
    let t = x
    for (let i = 0; i < 8; i++) {
      const error = sampleX(t) - x
      if (Math.abs(error) < 1e-5) break
      const slope = slopeX(t)
      if (Math.abs(slope) < 1e-6) break
      t -= error / slope
    }
    return sampleY(t)
  }
}

const ease = cubicBezierEasing(0.4, 0, 0.2, 1)

const lerp = (from: number, to: number, t: number): number => Math.round(from + (to - from) * t)

const running = new WeakMap<BrowserWindow, () => void>()
/** Bumped on every cancel so an abandoned beat sequence stops instead of running on. */
const generation = new WeakMap<BrowserWindow, number>()

/** A fold in progress is abandoned, not reversed — whoever calls next owns the geometry. */
export function cancelWindowFold(win: BrowserWindow): void {
  running.get(win)?.()
  running.delete(win)
  generation.set(win, (generation.get(win) ?? 0) + 1)
}

function animateTo(win: BrowserWindow, to: Rectangle, durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (win.isDestroyed()) { resolve(); return }
    const from = win.getBounds()
    if (durationMs <= 0) {
      win.setBounds(to)
      resolve()
      return
    }
    // Fixed-step, not wall-clock: `(Date.now() - startedAt) / duration` fast-forwards
    // through any stretch where the event loop was starved (session boot IPC, a busy
    // renderer holding the synchronized resize), so the window would leap hundreds of
    // pixels on the first tick after a stall. Advancing one frame per tick makes a
    // starved animation pause and resume instead — slower under load, never a jump.
    let elapsed = 0
    const timer = setInterval(() => {
      if (win.isDestroyed()) { stop(); return }
      elapsed += FRAME_MS
      const t = Math.min(1, elapsed / durationMs)
      const e = ease(t)
      // The top-left origin stays fixed throughout the fold; only the size changes.
      // This lets the compositor reuse the content layer without briefly shifting a
      // stale renderer frame as it can when x and width move together.
      const width = lerp(from.width, to.width, e)
      const height = lerp(from.height, to.height, e)
      win.setBounds({
        x: from.x,
        y: from.y,
        width,
        height,
      })
      if (t >= 1) stop()
    }, FRAME_MS)
    const stop = (): void => {
      clearInterval(timer)
      resolve()
    }
    running.set(win, stop)
  })
}

/** Apply one step's deltas to a rectangle. Absolute `height` wins over any delta. */
export function applyFoldStep(bounds: Rectangle, step: WindowFoldStep): Rectangle {
  return {
    x: bounds.x,
    y: bounds.y,
    width: Math.max(1, bounds.width + (step.widthDelta ?? 0)),
    height: step.height ?? bounds.height,
  }
}

/**
 * Play `steps` in order, then land exactly on `final` — the deltas are measured from a
 * live DOM and would otherwise drift a pixel or two off the mini window's real size.
 *
 * Returns the bounds the window passed through (oldest first), which is what
 * {@link unfoldWindow} rewinds along so the reverse animation retraces the same path.
 */
export async function foldWindow(
  win: BrowserWindow,
  steps: WindowFoldStep[],
  final: Rectangle,
): Promise<Rectangle[]> {
  cancelWindowFold(win)
  const mine = generation.get(win) ?? 0
  const trail: Rectangle[] = [win.getBounds()]
  let bounds = trail[0]
  for (const step of steps) {
    bounds = applyFoldStep(bounds, step)
    await animateTo(win, bounds, step.durationMs)
    // Cancelling only resolves the beat in flight; without this the loop would keep
    // playing the rest of the choreography against whoever took the geometry over.
    if (win.isDestroyed() || generation.get(win) !== mine) return trail
    trail.push(bounds)
  }
  if (!boundsEqual(bounds, final)) {
    await animateTo(win, final, steps.length ? 0 : FRAME_MS)
  }
  return trail
}

/**
 * Rewind a fold: first restore the mini window's original top-left anchor, then walk
 * `trail` backwards using the same per-step durations in reverse order. A user may
 * drag the mini window while it is collapsed; moving it before resizing avoids a large
 * window growing at the temporary location and jumping home only after the animation.
 */
export async function unfoldWindow(
  win: BrowserWindow,
  trail: Rectangle[],
  steps: WindowFoldStep[],
): Promise<void> {
  cancelWindowFold(win)
  const mine = generation.get(win) ?? 0
  if (trail.length && !win.isDestroyed()) {
    const current = win.getBounds()
    const origin = trail[0]
    if (current.x !== origin.x || current.y !== origin.y) {
      win.setBounds({ ...current, x: origin.x, y: origin.y })
    }
  }
  // trail[i] is the geometry *before* steps[i], so rewinding step i targets trail[i].
  for (let i = Math.min(steps.length, trail.length - 1) - 1; i >= 0; i--) {
    await animateTo(win, trail[i], steps[i].durationMs)
    if (win.isDestroyed() || generation.get(win) !== mine) return
  }
  if (trail.length && !win.isDestroyed()) win.setBounds(trail[0])
}

function boundsEqual(a: Rectangle, b: Rectangle): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}
