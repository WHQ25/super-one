import type { BrowserWindow, Rectangle } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MINI_WINDOW_SIZE, type WindowFoldStep } from '@superone/shared/agent-types'
import { applyFoldStep, cubicBezierEasing, foldWindow, unfoldWindow } from './window-fold'

function fakeWindow(bounds: Rectangle) {
  let current = { ...bounds }
  const seen: Rectangle[] = []
  return {
    win: {
      getBounds: () => ({ ...current }),
      setBounds: (next: Partial<Rectangle>) => {
        current = { ...current, ...next }
        seen.push({ ...current })
      },
      isDestroyed: () => false,
    } as unknown as BrowserWindow,
    now: () => ({ ...current }),
    seen,
  }
}

const START: Rectangle = { x: 100, y: 80, width: 1440, height: 900 }

// Every layout folds toward the window's top-left corner, so no beat touches its origin.
const STEPS: WindowFoldStep[] = [
  {
    durationMs: 320,
    widthDelta: MINI_WINDOW_SIZE.width - START.width,
    height: MINI_WINDOW_SIZE.height,
  },
]

const MINI: Rectangle = {
  x: START.x,
  y: START.y,
  width: MINI_WINDOW_SIZE.width,
  height: MINI_WINDOW_SIZE.height,
}

describe('fold easing', () => {
  // Must match the panels' own `cubic-bezier(0.4, 0, 0.2, 1)`: a near-miss curve puts
  // the window edge and the closing panel tens of pixels apart mid-beat, which is
  // exactly what makes the chat column appear to jitter.
  const ease = cubicBezierEasing(0.4, 0, 0.2, 1)

  it('pins the endpoints and rises monotonically between them', () => {
    expect(ease(0)).toBeCloseTo(0, 5)
    expect(ease(1)).toBeCloseTo(1, 5)
    let previous = 0
    for (let x = 0.05; x <= 1; x += 0.05) {
      const y = ease(x)
      expect(y).toBeGreaterThan(previous)
      previous = y
    }
  })

  it('front-loads the motion the way the CSS curve does', () => {
    // cubic-bezier(0.4, 0, 0.2, 1) is ~80% done at the halfway point.
    expect(ease(0.5)).toBeGreaterThan(0.75)
    expect(ease(0.5)).toBeLessThan(0.85)
  })
})

describe('window fold choreography', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  function walk(steps: WindowFoldStep[]): Rectangle[] {
    const path = [START]
    for (const step of steps) path.push(applyFoldStep(path[path.length - 1], step))
    return path
  }

  it('holds the left edge and top while changing the window size', () => {
    const path = walk(STEPS)
    expect(new Set(path.map((b) => b.x))).toEqual(new Set([100]))
    expect(new Set(path.map((b) => b.y))).toEqual(new Set([80]))
    expect(path.at(-1)).toMatchObject({
      width: MINI_WINDOW_SIZE.width,
      height: MINI_WINDOW_SIZE.height,
    })
  })

  it('pauses instead of jumping when the event loop is starved mid-move', async () => {
    const { win, seen } = fakeWindow(START)
    const done = foldWindow(win, STEPS, MINI)
    await vi.advanceTimersByTimeAsync(32)
    const before = seen.at(-1)!
    // A main-process stall (session boot IPC, a busy renderer holding the synchronized
    // resize) delays the next tick by hundreds of ms. Wall-clock easing would fast-forward
    // through the gap and leap; fixed-step easing advances a single frame.
    vi.setSystemTime(Date.now() + 250)
    await vi.advanceTimersByTimeAsync(16)
    const after = seen.at(-1)!
    expect(before.width - after.width).toBeLessThan(120)
    await vi.advanceTimersByTimeAsync(2000)
    await done
  })

  it('animates the move frame by frame and lands exactly on the mini window', async () => {
    const { win, now, seen } = fakeWindow(START)
    const done = foldWindow(win, STEPS, MINI)
    await vi.advanceTimersByTimeAsync(1000)
    const trail = await done

    expect(now()).toEqual(MINI)
    // Animated rather than jumped: ~20 frames for a 320ms move at 16ms a frame.
    expect(seen.length).toBeGreaterThan(10)
    // The trail is the geometry *before* each beat, oldest first.
    expect(trail[0]).toEqual(START)
    expect(trail).toHaveLength(STEPS.length + 1)
  })

  it('rewinds along the same path so the unfold retraces the fold', async () => {
    const { win, now } = fakeWindow(START)
    const folding = foldWindow(win, STEPS, MINI)
    await vi.advanceTimersByTimeAsync(1000)
    const trail = await folding

    const unfolding = unfoldWindow(win, trail, STEPS)
    await vi.advanceTimersByTimeAsync(1000)
    await unfolding

    expect(now()).toEqual(START)
  })

  it('restores a moved mini window position before enlarging it', async () => {
    const { win, now, seen } = fakeWindow(START)
    const folding = foldWindow(win, STEPS, MINI)
    await vi.advanceTimersByTimeAsync(1000)
    const trail = await folding

    win.setBounds({ ...MINI, x: 600, y: 420 })
    seen.length = 0
    const unfolding = unfoldWindow(win, trail, STEPS)

    expect(seen[0]).toEqual(MINI)
    expect(now()).toEqual(MINI)

    await vi.advanceTimersByTimeAsync(16)
    expect(now().x).toBe(START.x)
    expect(now().y).toBe(START.y)
    expect(now().width).toBeGreaterThan(MINI.width)

    await vi.advanceTimersByTimeAsync(1000)
    await unfolding
    expect(now()).toEqual(START)
  })

  it('falls back to a direct move when the renderer measured no beats', async () => {
    const { win, now } = fakeWindow(START)
    const done = foldWindow(win, [], MINI)
    await vi.advanceTimersByTimeAsync(100)
    await done
    expect(now()).toEqual(MINI)
  })
})
