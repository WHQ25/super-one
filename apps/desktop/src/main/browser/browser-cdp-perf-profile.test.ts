import { describe, it, expect } from 'vitest'
import { aggregateSelfTime, lastActiveTimestampUs, subtractBaseline, type CpuProfile } from './browser-cdp-perf-profile'

// Builds a profile whose samples are given as [functionName, deltaUs] pairs.
// startTimeUs anchors the absolute clock so window/trim assertions are readable.
function profileOf(pairs: Array<[string, number]>, startTimeUs = 1_000_000): CpuProfile {
  const ids = new Map<string, number>()
  const nodes: CpuProfile['nodes'] = []
  const samples: number[] = []
  const timeDeltas: number[] = []
  for (const [fn, delta] of pairs) {
    let id = ids.get(fn)
    if (id == null) {
      id = ids.size + 1
      ids.set(fn, id)
      nodes.push({ id, callFrame: { functionName: fn, url: `https://x.test/${fn}.js`, lineNumber: 10, columnNumber: 2 } })
    }
    samples.push(id)
    timeDeltas.push(delta)
  }
  const total = timeDeltas.reduce((a, b) => a + b, 0)
  return { nodes, samples, timeDeltas, startTime: startTimeUs, endTime: startTimeUs + total }
}

describe('cpu profile self-time aggregation', () => {
  it('folds samples into per-function self time in milliseconds', () => {
    const p = profileOf([
      ['render', 1000],
      ['render', 1000],
      ['layout', 500],
      ['render', 1000],
    ])
    const rows = aggregateSelfTime(p)
    expect(rows.map((r) => [r.functionName, r.selfMs])).toEqual([
      ['render', 3],
      ['layout', 0.5],
    ])
  })

  it('ranks hotter functions first regardless of sample order', () => {
    const p = profileOf([
      ['cheap', 1000],
      ['hot', 5000],
      ['cheap', 1000],
    ])
    expect(aggregateSelfTime(p)[0].functionName).toBe('hot')
  })

  it('keeps idle frames out of the ranking but reports them as idle time', () => {
    const p = profileOf([
      ['(idle)', 8000],
      ['work', 2000],
      ['(program)', 1000],
    ])
    const rows = aggregateSelfTime(p)
    expect(rows.map((r) => r.functionName)).toEqual(['work'])
  })

  it('counts garbage collection as real work, not idle', () => {
    const p = profileOf([
      ['(garbage collector)', 4000],
      ['work', 1000],
    ])
    expect(aggregateSelfTime(p).map((r) => r.functionName)).toEqual(['(garbage collector)', 'work'])
  })

  it('restricts aggregation to the requested window, dropping samples outside it', () => {
    // Absolute sample times: 1.001s, 1.002s, 1.012s (10ms gap before the last one).
    const p = profileOf([
      ['early', 1000],
      ['early', 1000],
      ['late', 10000],
    ])
    const rows = aggregateSelfTime(p, { fromUs: 1_000_000, toUs: 1_002_500 })
    expect(rows.map((r) => r.functionName)).toEqual(['early'])
  })

  it('attributes anonymous frames to their script location so they stay distinguishable', () => {
    const p: CpuProfile = {
      nodes: [
        { id: 1, callFrame: { functionName: '', url: 'https://x.test/a.js', lineNumber: 41, columnNumber: 6 } },
        { id: 2, callFrame: { functionName: '', url: 'https://x.test/b.js', lineNumber: 7, columnNumber: 1 } },
      ],
      samples: [1, 2, 1],
      timeDeltas: [1000, 1000, 1000],
      startTime: 0,
      endTime: 3000,
    }
    const rows = aggregateSelfTime(p)
    expect(rows).toHaveLength(2)
    expect(rows[0].url).toBe('https://x.test/a.js')
    expect(rows[0].line).toBe(42) // CDP line numbers are 0-based; reports are 1-based
  })

  it('keeps minified functions on the same line distinct by column', () => {
    const p: CpuProfile = {
      nodes: [
        { id: 1, callFrame: { functionName: '', url: 'https://x.test/app.min.js', lineNumber: 0, columnNumber: 10 } },
        { id: 2, callFrame: { functionName: '', url: 'https://x.test/app.min.js', lineNumber: 0, columnNumber: 80 } },
      ],
      samples: [1, 2],
      timeDeltas: [1000, 2000],
      startTime: 0,
      endTime: 3000,
    }

    const rows = aggregateSelfTime(p)
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.column).sort((a, b) => a - b)).toEqual([11, 81])
    expect(new Set(rows.map((row) => row.key)).size).toBe(2)
  })
})

describe('trailing idle trim', () => {
  it('returns the timestamp of the last non-idle sample so trailing idle can be cut', () => {
    const p = profileOf([
      ['work', 1000], // t = 1.001s
      ['work', 1000], // t = 1.002s
      ['(idle)', 5000], // t = 1.007s
      ['(idle)', 5000], // t = 1.012s
    ])
    expect(lastActiveTimestampUs(p)).toBe(1_002_000)
  })

  it('returns null when the whole profile is idle, so the caller can say so explicitly', () => {
    const p = profileOf([
      ['(idle)', 5000],
      ['(program)', 5000],
    ])
    expect(lastActiveTimestampUs(p)).toBeNull()
  })
})

describe('baseline subtraction', () => {
  it('scales the baseline to the action window before subtracting', () => {
    // Baseline: 100ms of `poll` over a 1000ms window → 10% duty cycle.
    // Action window is 500ms, so 50ms of `poll` is expected noise.
    const baseline = [{ key: 'poll', functionName: 'poll', url: 'u', line: 1, selfMs: 100, samples: 100 }]
    const action = [{ key: 'poll', functionName: 'poll', url: 'u', line: 1, selfMs: 80, samples: 80 }]
    const rows = subtractBaseline(action, baseline, { actionMs: 500, baselineMs: 1000 })
    expect(rows[0].selfMs).toBe(30)
    expect(rows[0].baselineAdjusted).toBe(true)
  })

  it('floors a frame at zero and drops it when the baseline fully explains it', () => {
    const baseline = [{ key: 'poll', functionName: 'poll', url: 'u', line: 1, selfMs: 100, samples: 100 }]
    const action = [{ key: 'poll', functionName: 'poll', url: 'u', line: 1, selfMs: 40, samples: 40 }]
    const rows = subtractBaseline(action, baseline, { actionMs: 1000, baselineMs: 1000 })
    expect(rows).toEqual([])
  })

  it('leaves frames absent from the baseline untouched and unflagged', () => {
    const baseline = [{ key: 'poll', functionName: 'poll', url: 'u', line: 1, selfMs: 100, samples: 100 }]
    const action = [{ key: 'handleClick', functionName: 'handleClick', url: 'u2', line: 9, selfMs: 60, samples: 60 }]
    const rows = subtractBaseline(action, baseline, { actionMs: 1000, baselineMs: 1000 })
    expect(rows[0].selfMs).toBe(60)
    expect(rows[0].baselineAdjusted).toBeUndefined()
  })

  it('re-ranks after subtraction so a noisy frame cannot hold the top spot', () => {
    const baseline = [{ key: 'animate', functionName: 'animate', url: 'u', line: 1, selfMs: 500, samples: 500 }]
    const action = [
      { key: 'animate', functionName: 'animate', url: 'u', line: 1, selfMs: 520, samples: 520 },
      { key: 'handleClick', functionName: 'handleClick', url: 'u2', line: 9, selfMs: 90, samples: 90 },
    ]
    const rows = subtractBaseline(action, baseline, { actionMs: 1000, baselineMs: 1000 })
    expect(rows.map((r) => r.functionName)).toEqual(['handleClick', 'animate'])
  })

  it('skips subtraction entirely when no baseline was captured', () => {
    const action = [{ key: 'a', functionName: 'a', url: 'u', line: 1, selfMs: 10, samples: 10 }]
    expect(subtractBaseline(action, null, { actionMs: 1000, baselineMs: 0 })).toEqual(action)
  })
})
