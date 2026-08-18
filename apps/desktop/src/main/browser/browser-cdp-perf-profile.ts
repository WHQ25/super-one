// Pure aggregation over a V8 CPU profile (`Profiler.stop`). Kept free of
// Electron/CDP imports so the tricky parts — window trimming and baseline
// subtraction — are unit-testable without a browser.
//
// Sample timing contract (CDP): `timeDeltas[i]` is the gap *preceding*
// `samples[i]`, the first one relative to `startTime`. So a sample's absolute
// timestamp is `startTime + sum(timeDeltas[0..i])`, and we attribute that
// sample's own delta to the frame it landed on — the same approximation
// DevTools makes.

export interface ProfileCallFrame {
  functionName: string
  url: string
  lineNumber: number
  columnNumber: number
}

export interface ProfileNode {
  id: number
  callFrame: ProfileCallFrame
  hitCount?: number
  children?: number[]
}

export interface CpuProfile {
  nodes: ProfileNode[]
  samples: number[]
  timeDeltas: number[]
  startTime: number
  endTime: number
}

export interface FrameCost {
  key: string
  functionName: string
  url: string
  line: number
  column?: number
  selfMs: number
  samples: number
  /** Set when baseline subtraction reduced this frame — its cost is partly ambient page noise. */
  baselineAdjusted?: boolean
}

export interface ProfileWindow {
  fromUs: number
  toUs: number
}

// V8 synthesises these frames for time the page was not running JS. They are
// what dilutes a hotspot ranking when a recording window is too wide, so they
// never enter the ranking. `(garbage collector)` is deliberately absent — GC is
// real work caused by real allocation.
const IDLE_FRAMES = new Set(['(idle)', '(program)', '(root)'])

function isIdle(frame: ProfileCallFrame): boolean {
  return IDLE_FRAMES.has(frame.functionName)
}

function frameKey(frame: ProfileCallFrame): string {
  return `${frame.functionName}@${frame.url}:${frame.lineNumber}:${frame.columnNumber}`
}

function roundMs(us: number): number {
  return Math.round(us) / 1000
}

/** Walks samples once, yielding each sample's frame and absolute end timestamp. */
function* walk(profile: CpuProfile): Generator<{ frame: ProfileCallFrame; atUs: number; deltaUs: number }> {
  const byId = new Map<number, ProfileNode>()
  for (const node of profile.nodes) byId.set(node.id, node)
  let atUs = profile.startTime
  for (let i = 0; i < profile.samples.length; i++) {
    const deltaUs = profile.timeDeltas[i] ?? 0
    atUs += deltaUs
    const node = byId.get(profile.samples[i])
    if (node) yield { frame: node.callFrame, atUs, deltaUs }
  }
}

/**
 * Folds samples into per-function self time, hottest first. Idle frames are
 * excluded. Pass a window to aggregate only the slice that matters — this is
 * what keeps agent-side latency and trailing idle out of the ranking.
 */
export function aggregateSelfTime(profile: CpuProfile, window?: ProfileWindow): FrameCost[] {
  const totals = new Map<string, { frame: ProfileCallFrame; us: number; samples: number }>()
  for (const { frame, atUs, deltaUs } of walk(profile)) {
    if (window && (atUs < window.fromUs || atUs > window.toUs)) continue
    if (isIdle(frame)) continue
    const key = frameKey(frame)
    const acc = totals.get(key)
    if (acc) {
      acc.us += deltaUs
      acc.samples += 1
    } else {
      totals.set(key, { frame, us: deltaUs, samples: 1 })
    }
  }
  return [...totals.entries()]
    .map(([key, { frame, us, samples }]) => ({
      key,
      functionName: frame.functionName,
      url: frame.url,
      line: frame.lineNumber + 1, // CDP is 0-based; reports are 1-based
      column: frame.columnNumber + 1,
      selfMs: roundMs(us),
      samples,
    }))
    .sort((a, b) => b.selfMs - a.selfMs)
}

/**
 * Absolute timestamp (µs) of the last sample that was doing real work, or null
 * if the profile is entirely idle. Everything after it is trailing idle and can
 * be cut, which is what makes an over-long recording window harmless.
 */
export function lastActiveTimestampUs(profile: CpuProfile): number | null {
  let last: number | null = null
  for (const { frame, atUs } of walk(profile)) {
    if (!isIdle(frame)) last = atUs
  }
  return last
}

/**
 * Subtracts the page's ambient cost from an action's ranking. The baseline was
 * captured over a different span, so it is scaled to the action window by duty
 * cycle before subtracting. Frames the baseline fully explains drop out; frames
 * it partly explains stay but are flagged, because a frame whose cost *grew*
 * under the action is still interesting and must not read as innocent.
 */
export function subtractBaseline(
  action: FrameCost[],
  baseline: FrameCost[] | null,
  spans: { actionMs: number; baselineMs: number },
): FrameCost[] {
  if (!baseline || baseline.length === 0 || spans.baselineMs <= 0) return action
  const scale = spans.actionMs / spans.baselineMs
  const noise = new Map<string, number>()
  for (const row of baseline) noise.set(row.key, row.selfMs * scale)

  const out: FrameCost[] = []
  for (const row of action) {
    const expected = noise.get(row.key)
    if (expected == null) {
      out.push(row)
      continue
    }
    const remaining = Math.round((row.selfMs - expected) * 1000) / 1000
    if (remaining <= 0) continue
    out.push({ ...row, selfMs: remaining, baselineAdjusted: true })
  }
  return out.sort((a, b) => b.selfMs - a.selfMs)
}
