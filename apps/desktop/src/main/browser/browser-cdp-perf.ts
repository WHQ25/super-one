import { BrowserWindow } from 'electron'
import { ensureAttachedById, cdpSend, acquireDomain, releaseDomain } from './browser-cdp'
import { aggregateSelfTime, subtractBaseline, type CpuProfile, type FrameCost } from './browser-cdp-perf-profile'
import { createSettleDetector } from './browser-cdp-perf-settle'
import { createInFlightLedger, isStreamingResponse, type InFlightLedger } from './browser-cdp-perf-inflight'
import log from '../logger'

// Measures one action end to end. The measurement window is opened and closed
// inside this module — never by the agent — so agent-side thinking latency
// cannot leak into the profile. See browser-cdp-perf-settle.ts for how the
// closing edge is decided.

const POLL_INTERVAL_MS = 100
const PRE_SETTLE_MAX_MS = 2000
const DEFAULT_QUIET_FOR_MS = 500
const HOTSPOT_LIMIT = 15

export interface PerfMeasureOptions {
  webContentsId: number
  runAction: () => Promise<unknown>
  /** Explicit completion signal; skips baseline-relative settling when it fires. */
  until?: { urlContains?: string; selector?: string }
  maxWaitMs?: number
  baselineMs?: number
}

export type SettleReason = 'until' | 'baseline' | 'quiet' | 'timeout' | 'sample'

export interface PerfMeasureResult {
  /** Time from action dispatch until main-thread and network work became quiet. */
  actionDurationMs: number
  settled: SettleReason
  /** True when the window was cut short by maxWait — durations are lower bounds. */
  truncated: boolean
  hotspots: FrameCost[]
  /**
   * RAW total self time the JS sampler accounted for — full profile, no trimming
   * and no baseline subtraction, so it covers the same span as `metrics`.
   * Compare with metrics.TaskDurationMs: the gap is
   * main-thread work that is not JS — layout, paint, style, GC, compositing. A
   * large gap means the bottleneck is not in script, and tuning JS will not help.
   */
  jsSelfMs: number
  baseline: { durationMs: number; rate: number; topFrames: FrameCost[] } | null
  metrics: Record<string, number>
  requests: number
  /**
   * Requests positively identified as streams/long-lived media and excluded
   * from the settle decision. Slow finite APIs are never excluded by age.
   */
  streamingRequests: number
}

type InFlightTracker = InFlightLedger & { dispose(): void }

function trackInFlight(webContentsId: number): InFlightTracker {
  const wc = ensureAttachedById(webContentsId)
  const ledger = createInFlightLedger()

  const onMessage = (_e: unknown, method: string, params: unknown): void => {
    if (method === 'Network.requestWillBeSent') {
      const p = params as { requestId: string; request: { url: string }; type?: string }
      ledger.started(p.requestId, Date.now(), p.request.url, p.type)
    } else if (method === 'Network.responseReceived') {
      const p = params as {
        requestId: string
        type?: string
        response?: { mimeType?: string; headers?: Record<string, string | number> }
      }
      if (isStreamingResponse(p.type, p.response?.mimeType, p.response?.headers)) {
        ledger.markStreaming(p.requestId)
      }
    } else if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') {
      ledger.settled((params as { requestId: string }).requestId)
    }
  }
  wc.debugger.on('message', onMessage)

  return { ...ledger, dispose: () => wc.debugger.off('message', onMessage) }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface MetricsSnapshot {
  atMs: number
  taskDurationMs: number
  all: Record<string, number>
}

async function readMetrics(webContentsId: number): Promise<MetricsSnapshot> {
  const res = await cdpSend<{ metrics: Array<{ name: string; value: number }> }>(webContentsId, 'Performance.getMetrics')
  const all: Record<string, number> = {}
  for (const m of res.metrics) all[m.name] = m.value
  // Duration metrics are reported in seconds.
  return { atMs: Date.now(), taskDurationMs: (all.TaskDuration ?? 0) * 1000, all }
}

async function selectorExists(webContentsId: number, selector: string): Promise<boolean> {
  const res = await cdpSend<{ result: { value?: boolean } }>(webContentsId, 'Runtime.evaluate', {
    expression: `!!document.querySelector(${JSON.stringify(selector)})`,
    returnByValue: true,
  })
  return res.result?.value === true
}

/** Waits until the page stops doing more than `baselineRate`, or the budget runs out. */
interface WaitForQuietResult {
  reason: SettleReason
  completedAtMs: number
  quietSinceMs: number | null
}

async function waitForQuiet(
  webContentsId: number,
  tracker: InFlightTracker,
  baselineRate: number | null,
  budgetMs: number,
  until?: PerfMeasureOptions['until'],
): Promise<WaitForQuietResult> {
  // A selector that already matched before the action would satisfy `until` on
  // the first poll, collapsing the window to zero. Only a selector that appears
  // as a result of the action is a completion signal.
  const detector = createSettleDetector({ baselineRate, quietForMs: DEFAULT_QUIET_FOR_MS })
  const deadline = Date.now() + budgetMs

  while (Date.now() < deadline) {
    const nowMs = Date.now()
    if (until?.urlContains && tracker.sawUrl(until.urlContains) && tracker.count(nowMs) === 0) {
      return { reason: 'until', completedAtMs: nowMs, quietSinceMs: null }
    }
    if (until?.selector && (await selectorExists(webContentsId, until.selector))) {
      return { reason: 'until', completedAtMs: Date.now(), quietSinceMs: null }
    }

    const snap = await readMetrics(webContentsId)
    if (detector.push({ atMs: snap.atMs, taskDurationMs: snap.taskDurationMs, inFlight: tracker.count(snap.atMs) })) {
      return {
        reason: baselineRate == null ? 'quiet' : 'baseline',
        completedAtMs: snap.atMs,
        quietSinceMs: detector.quietSinceMs(),
      }
    }
    await sleep(POLL_INTERVAL_MS)
  }
  return { reason: 'timeout', completedAtMs: Date.now(), quietSinceMs: null }
}

async function profileFor(webContentsId: number, durationMs: number): Promise<CpuProfile> {
  await cdpSend(webContentsId, 'Profiler.start')
  await sleep(durationMs)
  const res = await cdpSend<{ profile: CpuProfile }>(webContentsId, 'Profiler.stop')
  return res.profile
}

function totalSelfMs(frames: FrameCost[]): number {
  return Math.round(frames.reduce((sum, f) => sum + f.selfMs, 0) * 10) / 10
}

async function acquireDomains(webContentsId: number, domains: string[]): Promise<string[]> {
  const acquired: string[] = []
  try {
    for (const domain of domains) {
      await acquireDomain(webContentsId, domain)
      acquired.push(domain)
    }
    return acquired
  } catch (err) {
    await releaseDomains(webContentsId, acquired)
    throw err
  }
}

async function releaseDomains(webContentsId: number, domains: string[]): Promise<void> {
  for (const domain of [...domains].reverse()) {
    await releaseDomain(webContentsId, domain).catch(() => {})
  }
}

export interface ProfileWindowTiming {
  profileStartedAtMs: number
  actionStartedAtMs: number
  settledAtMs: number
  quietSinceMs: number | null
  settled: SettleReason
}

/**
 * Maps wall-clock settle signals onto V8's monotonic profile timeline. The end
 * follows Performance.TaskDuration's quiet boundary, so layout/paint work with
 * no V8 samples is retained while the trailing confirmation delay is removed.
 */
export function resolveProfileWindow(
  profile: CpuProfile,
  timing: ProfileWindowTiming,
): { fromUs: number; toUs: number; actionDurationMs: number } {
  const fromOffsetMs = Math.max(0, timing.actionStartedAtMs - timing.profileStartedAtMs)
  const quietEndMs =
    (timing.settled === 'baseline' || timing.settled === 'quiet') && timing.quietSinceMs != null
      ? timing.quietSinceMs
      : timing.settledAtMs
  const toOffsetMs = Math.max(fromOffsetMs, quietEndMs - timing.profileStartedAtMs)
  const fromUs = Math.min(profile.endTime, profile.startTime + fromOffsetMs * 1000)
  const toUs = Math.max(fromUs, Math.min(profile.endTime, profile.startTime + toOffsetMs * 1000))
  return { fromUs, toUs, actionDurationMs: Math.round((toUs - fromUs) / 1000) }
}

/**
 * Performance counters are cumulative per document, so a navigation during the
 * window resets them and a raw subtraction goes negative. Negative durations are
 * meaningless, so they are floored and the whole set is flagged rather than
 * silently reported as if it measured something.
 */
export function metricsDelta(before: MetricsSnapshot, after: MetricsSnapshot): Record<string, number> {
  const metrics: Record<string, number> = {}
  let counterReset = false
  for (const key of ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration']) {
    const delta = (after.all[key] ?? 0) - (before.all[key] ?? 0)
    if (delta < 0) counterReset = true
    metrics[`${key}Ms`] = Math.round(Math.max(0, delta) * 1000 * 10) / 10
  }
  const heapDelta = (after.all.JSHeapUsedSize ?? 0) - (before.all.JSHeapUsedSize ?? 0)
  metrics.jsHeapDeltaKb = Math.round(heapDelta / 1024)
  metrics.nodesDelta = (after.all.Nodes ?? 0) - (before.all.Nodes ?? 0)
  if (counterReset) metrics.counterReset = 1
  return metrics
}

/**
 * Profiles a fixed span with no action and no baseline subtraction — for steady
 * state load ("what is this page burning while idle", "what does the renderer do
 * while streaming"). Steady state is insensitive to window edges, which is why a
 * plain duration is correct here rather than a concession; subtracting a baseline
 * would cancel out exactly the load being measured.
 */
export async function samplePerf(opts: { webContentsId: number; durationMs: number }): Promise<PerfMeasureResult> {
  const { webContentsId, durationMs } = opts
  const domains = await acquireDomains(webContentsId, ['Performance', 'Profiler'])
  try {
    const before = await readMetrics(webContentsId)
    const profile = await profileFor(webContentsId, durationMs)
    const after = await readMetrics(webContentsId)
    const frames = aggregateSelfTime(profile)
    return {
      actionDurationMs: after.atMs - before.atMs,
      settled: 'sample',
      truncated: false,
      hotspots: frames.slice(0, HOTSPOT_LIMIT),
      jsSelfMs: totalSelfMs(frames),
      baseline: null,
      metrics: metricsDelta(before, after),
      requests: 0,
      streamingRequests: 0,
    }
  } finally {
    await releaseDomains(webContentsId, domains)
  }
}

export async function measurePerf(opts: PerfMeasureOptions): Promise<PerfMeasureResult> {
  const { webContentsId, runAction } = opts
  const maxWaitMs = opts.maxWaitMs ?? 10_000
  const baselineMs = opts.baselineMs ?? 1000

  const domains = await acquireDomains(webContentsId, ['Network', 'Performance', 'Profiler'])
  let tracker: InFlightTracker | null = null

  try {
    tracker = trackInFlight(webContentsId)
    // 1. Let the page finish whatever it is already doing, so the previous
    //    action's tail does not land in this action's profile.
    await waitForQuiet(webContentsId, tracker, null, PRE_SETTLE_MAX_MS)

    // 2. Characterise the page's ambient load — the reference frame everything
    //    below is judged against.
    let baseline: PerfMeasureResult['baseline'] = null
    let baselineRate: number | null = null
    let baselineFrames: FrameCost[] | null = null
    if (baselineMs > 0) {
      const before = await readMetrics(webContentsId)
      const profile = await profileFor(webContentsId, baselineMs)
      const after = await readMetrics(webContentsId)
      const spanMs = Math.max(1, after.atMs - before.atMs)
      baselineRate = Math.max(0, after.taskDurationMs - before.taskDurationMs) / spanMs
      baselineFrames = aggregateSelfTime(profile)
      baseline = {
        durationMs: spanMs,
        rate: Math.round(baselineRate * 1000) / 1000,
        topFrames: baselineFrames.slice(0, 5),
      }
    }

    // 3. The measured window: profiler on, action fired, wait for the page to
    //    fall back to its baseline.
    // A selector that already matches is not a completion signal — it would
    // satisfy `until` on the first poll and collapse the window to zero.
    let until = opts.until
    if (until?.selector && (await selectorExists(webContentsId, until.selector))) {
      log.info('[browser-perf] until.selector already present before the action; ignoring it wc=%d', webContentsId)
      until = { ...until, selector: undefined }
    }

    const metricsBefore = await readMetrics(webContentsId)
    await cdpSend(webContentsId, 'Profiler.start')
    const profileStartedAtMs = Date.now()
    const actionStartedAtMs = Date.now()
    tracker.mark(actionStartedAtMs)
    await runAction()
    const settle = await waitForQuiet(webContentsId, tracker, baselineRate, maxWaitMs, until)
    const { profile } = await cdpSend<{ profile: CpuProfile }>(webContentsId, 'Profiler.stop')
    const metricsAfter = await readMetrics(webContentsId)

    // 4. Trim only the quiet confirmation tail. Performance.TaskDuration sees
    //    layout/paint/style work that V8 samples do not, so it is the authority
    //    for the closing edge.
    const window = resolveProfileWindow(profile, {
      profileStartedAtMs,
      actionStartedAtMs,
      settledAtMs: settle.completedAtMs,
      quietSinceMs: settle.quietSinceMs,
      settled: settle.reason,
    })
    // Reported hotspots are trimmed + baseline-subtracted, but jsSelfMs is
    // deliberately RAW over the full profile: the tool description tells the
    // agent to compare it against metrics.TaskDurationMs, and that comparison is
    // only meaningful if both cover the same window with no subtraction.
    const rawFrames = aggregateSelfTime(profile)
    const windowed = aggregateSelfTime(profile, { fromUs: window.fromUs, toUs: window.toUs })
    const hotspots = subtractBaseline(windowed, baselineFrames, {
      actionMs: Math.max(1, window.actionDurationMs),
      baselineMs: baseline?.durationMs ?? 0,
    })

    const metrics = metricsDelta(metricsBefore, metricsAfter)

    return {
      actionDurationMs: window.actionDurationMs,
      settled: settle.reason,
      truncated: settle.reason === 'timeout',
      hotspots: hotspots.slice(0, HOTSPOT_LIMIT),
      jsSelfMs: totalSelfMs(rawFrames),
      baseline,
      metrics,
      requests: tracker.total(),
      streamingRequests: tracker.streamingCount(),
    }
  } finally {
    tracker?.dispose()
    await releaseDomains(webContentsId, domains)
    log.info('[browser-perf] measurement finished wc=%d', webContentsId)
  }
}

/**
 * webContents of the SuperOne window itself, for profiling the app rather than a
 * page it is driving. Prefers the focused window so a multi-window setup targets
 * the one the user is looking at.
 */
export function resolveAppTarget(): number {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) throw new Error('No SuperOne window is open to profile.')
  return win.webContents.id
}
