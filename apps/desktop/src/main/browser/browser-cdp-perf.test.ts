import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
}))
vi.mock('./browser-cdp', () => ({
  ensureAttachedById: vi.fn(),
  cdpSend: vi.fn(),
  acquireDomain: vi.fn(),
  releaseDomain: vi.fn(),
}))
vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn() } }))

const browserCdp = await import('./browser-cdp')
const { metricsDelta, resolveProfileWindow, samplePerf } = await import('./browser-cdp-perf')

const snap = (atMs: number, all: Record<string, number>): { atMs: number; taskDurationMs: number; all: Record<string, number> } => ({
  atMs,
  taskDurationMs: (all.TaskDuration ?? 0) * 1000,
  all,
})

// Performance counters are cumulative per document. A navigation inside the
// measured window resets them to zero, so after − before goes negative and a
// raw subtraction reports impossible values (e.g. TaskDurationMs: -412).
describe('performance metric deltas', () => {
  it('reports the difference in milliseconds for counters that only grew', () => {
    const out = metricsDelta(snap(0, { TaskDuration: 1.0, ScriptDuration: 0.4 }), snap(1000, { TaskDuration: 1.5, ScriptDuration: 0.6 }))
    expect(out.TaskDurationMs).toBe(500)
    expect(out.ScriptDurationMs).toBe(200)
  })

  it('floors a counter that went backwards instead of reporting a negative duration', () => {
    const out = metricsDelta(snap(0, { TaskDuration: 5.0 }), snap(1000, { TaskDuration: 0.2 }))
    expect(out.TaskDurationMs).toBe(0)
  })

  it('flags the whole set when any counter reset, so the numbers are not read as a measurement', () => {
    const out = metricsDelta(snap(0, { TaskDuration: 5.0, LayoutDuration: 1.0 }), snap(1000, { TaskDuration: 0.2, LayoutDuration: 1.4 }))
    expect(out.counterReset).toBe(1)
  })

  it('omits the reset flag when every counter grew normally', () => {
    const out = metricsDelta(snap(0, { TaskDuration: 1.0 }), snap(1000, { TaskDuration: 1.2 }))
    expect(out.counterReset).toBeUndefined()
  })

  // Heap legitimately shrinks (GC), so it must stay signed — flooring it would
  // hide a collection during the window.
  it('keeps a heap decrease signed rather than flooring it', () => {
    const out = metricsDelta(snap(0, { JSHeapUsedSize: 4 * 1024 * 1024 }), snap(1000, { JSHeapUsedSize: 3 * 1024 * 1024 }))
    expect(out.jsHeapDeltaKb).toBe(-1024)
  })

  it('keeps a node-count decrease signed so DOM teardown stays visible', () => {
    const out = metricsDelta(snap(0, { Nodes: 900 }), snap(1000, { Nodes: 400 }))
    expect(out.nodesDelta).toBe(-500)
  })
})

describe('action profile window', () => {
  const profile = {
    nodes: [
      { id: 1, callFrame: { functionName: 'handleClick', url: 'app.js', lineNumber: 0, columnNumber: 0 } },
      { id: 2, callFrame: { functionName: '(idle)', url: '', lineNumber: 0, columnNumber: 0 } },
    ],
    samples: [1, 2, 2],
    timeDeltas: [50_000, 300_000, 500_000],
    startTime: 1_000_000,
    endTime: 1_850_000,
  }

  it('keeps a non-JS render tail until main-thread activity becomes quiet', () => {
    const window = resolveProfileWindow(profile, {
      profileStartedAtMs: 10_000,
      actionStartedAtMs: 10_000,
      settledAtMs: 10_850,
      quietSinceMs: 10_350,
      settled: 'baseline',
    })

    // The last V8 work sample is at 50ms, but layout/paint kept the main thread
    // busy until 350ms. The window must follow TaskDuration, not V8 activity.
    expect(window.actionDurationMs).toBe(350)
    expect(window.toUs).toBe(1_350_000)
  })

  it('uses the full observed span when the measurement times out', () => {
    const window = resolveProfileWindow(profile, {
      profileStartedAtMs: 10_000,
      actionStartedAtMs: 10_000,
      settledAtMs: 10_850,
      quietSinceMs: null,
      settled: 'timeout',
    })
    expect(window.actionDurationMs).toBe(850)
    expect(window.toUs).toBe(profile.endTime)
  })
})

describe('domain acquisition rollback', () => {
  it('releases domains acquired before a later domain fails', async () => {
    const acquire = vi.mocked(browserCdp.acquireDomain)
    const release = vi.mocked(browserCdp.releaseDomain)
    acquire.mockImplementation(async (_webContentsId, domain) => {
      if (domain === 'Profiler') throw new Error('Profiler unavailable')
    })
    release.mockResolvedValue()

    await expect(samplePerf({ webContentsId: 42, durationMs: 200 })).rejects.toThrow('Profiler unavailable')
    expect(release).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalledWith(42, 'Performance')

    acquire.mockReset()
    release.mockReset()
  })
})
