import { describe, it, expect } from 'vitest'
import { createSettleDetector } from './browser-cdp-perf-settle'

// Rates are CPU duty cycle: taskDuration growth ÷ wall time.
// 0.01 = idle-ish, 0.18 = a page running an animation, 0.80 = busy.
const QUIET_FOR = 500

function feed(
  detector: ReturnType<typeof createSettleDetector>,
  steps: Array<{ dtMs: number; rate: number; inFlight?: number }>,
  startMs = 10_000,
): boolean {
  let atMs = startMs
  let taskMs = 0
  let settled = false
  detector.push({ atMs, taskDurationMs: taskMs, inFlight: 0 })
  for (const step of steps) {
    atMs += step.dtMs
    taskMs += step.dtMs * step.rate
    settled = detector.push({ atMs, taskDurationMs: taskMs, inFlight: step.inFlight ?? 0 })
  }
  return settled
}

describe('settle detection without a baseline', () => {
  it('reports settled once the page is idle for the full quiet window', () => {
    const d = createSettleDetector({ baselineRate: null, quietForMs: QUIET_FOR })
    const settled = feed(d, Array.from({ length: 7 }, () => ({ dtMs: 100, rate: 0.01 })))
    expect(settled).toBe(true)
  })

  it('stays unsettled while the quiet window is still filling', () => {
    const d = createSettleDetector({ baselineRate: null, quietForMs: QUIET_FOR })
    const settled = feed(d, Array.from({ length: 3 }, () => ({ dtMs: 100, rate: 0.01 })))
    expect(settled).toBe(false)
  })

  it('stays unsettled while the main thread is busy', () => {
    const d = createSettleDetector({ baselineRate: null, quietForMs: QUIET_FOR })
    const settled = feed(d, Array.from({ length: 10 }, () => ({ dtMs: 100, rate: 0.8 })))
    expect(settled).toBe(false)
  })

  // The single most common shape: click → XHR in flight → render on response.
  // Judging on CPU alone would call it settled mid-flight and cut the render.
  it('stays unsettled while a request is in flight even though the CPU is idle', () => {
    const d = createSettleDetector({ baselineRate: null, quietForMs: QUIET_FOR })
    const settled = feed(
      d,
      Array.from({ length: 10 }, () => ({ dtMs: 100, rate: 0.01, inFlight: 1 })),
    )
    expect(settled).toBe(false)
  })

  it('restarts the quiet window when work resumes mid-way', () => {
    const d = createSettleDetector({ baselineRate: null, quietForMs: QUIET_FOR })
    const settled = feed(d, [
      { dtMs: 100, rate: 0.01 },
      { dtMs: 100, rate: 0.01 },
      { dtMs: 100, rate: 0.01 },
      { dtMs: 100, rate: 0.9 }, // burst resets it
      { dtMs: 100, rate: 0.01 },
      { dtMs: 100, rate: 0.01 },
    ])
    expect(settled).toBe(false)
  })

  it('settles after a reset once a fresh full window of quiet elapses', () => {
    const d = createSettleDetector({ baselineRate: null, quietForMs: QUIET_FOR })
    const settled = feed(d, [
      { dtMs: 100, rate: 0.01 },
      { dtMs: 100, rate: 0.9 },
      ...Array.from({ length: 7 }, () => ({ dtMs: 100, rate: 0.01 })),
    ])
    expect(settled).toBe(true)
  })
})

// A page with an animation, a poller or a video never reaches absolute idle.
// Judged against zero it would never settle; judged against its own baseline it
// settles as soon as it returns to its normal load.
describe('settle detection against a baseline', () => {
  it('settles when an always-busy page returns to its baseline rate', () => {
    const d = createSettleDetector({ baselineRate: 0.18, quietForMs: QUIET_FOR })
    const settled = feed(d, Array.from({ length: 7 }, () => ({ dtMs: 100, rate: 0.18 })))
    expect(settled).toBe(true)
  })

  it('would never settle on that same page without a baseline', () => {
    const d = createSettleDetector({ baselineRate: null, quietForMs: QUIET_FOR })
    const settled = feed(d, Array.from({ length: 20 }, () => ({ dtMs: 100, rate: 0.18 })))
    expect(settled).toBe(false)
  })

  it('tolerates jitter around the baseline instead of demanding an exact match', () => {
    const d = createSettleDetector({ baselineRate: 0.2, quietForMs: QUIET_FOR })
    const settled = feed(d, [
      { dtMs: 100, rate: 0.21 },
      { dtMs: 100, rate: 0.19 },
      { dtMs: 100, rate: 0.22 },
      { dtMs: 100, rate: 0.2 },
      { dtMs: 100, rate: 0.18 },
      { dtMs: 100, rate: 0.21 },
      { dtMs: 100, rate: 0.2 },
    ])
    expect(settled).toBe(true)
  })

  it('stays unsettled while load sits clearly above the baseline', () => {
    const d = createSettleDetector({ baselineRate: 0.18, quietForMs: QUIET_FOR })
    const settled = feed(d, Array.from({ length: 10 }, () => ({ dtMs: 100, rate: 0.6 })))
    expect(settled).toBe(false)
  })

  // A page quieter than when its baseline was taken must not be held hostage by
  // the baseline — dropping below it is settled by any reading.
  it('settles when the page falls below its baseline', () => {
    const d = createSettleDetector({ baselineRate: 0.5, quietForMs: QUIET_FOR })
    const settled = feed(d, Array.from({ length: 7 }, () => ({ dtMs: 100, rate: 0.02 })))
    expect(settled).toBe(true)
  })

  it('still refuses to settle on in-flight requests regardless of baseline', () => {
    const d = createSettleDetector({ baselineRate: 0.18, quietForMs: QUIET_FOR })
    const settled = feed(
      d,
      Array.from({ length: 10 }, () => ({ dtMs: 100, rate: 0.18, inFlight: 2 })),
    )
    expect(settled).toBe(false)
  })
})

describe('detector bookkeeping', () => {
  it('never settles on the very first sample, having no interval to rate', () => {
    const d = createSettleDetector({ baselineRate: null, quietForMs: 0 })
    expect(d.push({ atMs: 0, taskDurationMs: 0, inFlight: 0 })).toBe(false)
  })

  it('exposes when the quiet window began so the caller can trim to it', () => {
    const d = createSettleDetector({ baselineRate: null, quietForMs: QUIET_FOR })
    feed(d, Array.from({ length: 7 }, () => ({ dtMs: 100, rate: 0.01 })))
    // First sample is at 10_000; the first quiet interval ends at 10_100.
    expect(d.quietSinceMs()).toBe(10_100)
  })

  it('clears the quiet-window start after a reset', () => {
    const d = createSettleDetector({ baselineRate: null, quietForMs: QUIET_FOR })
    feed(d, [
      { dtMs: 100, rate: 0.01 },
      { dtMs: 100, rate: 0.9 },
    ])
    expect(d.quietSinceMs()).toBeNull()
  })
})
