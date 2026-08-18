// Decides when an action is "done" without asking the agent to guess a duration.
//
// Two signals, both required:
//   - CPU duty cycle (Performance.getMetrics TaskDuration growth ÷ wall time)
//     back at or below the page's own baseline
//   - zero requests in flight
//
// The baseline is what makes this work on pages that never go idle (video,
// animation, pollers, WebSocket feeds). Judged against absolute zero those pages
// never settle; judged against their own ambient load they settle as soon as the
// action's extra work drains away.

/** Duty cycle treated as idle when no baseline was captured. */
const ABSOLUTE_IDLE_RATE = 0.05
/** Headroom over the baseline, absorbing sampling jitter. */
const BASELINE_TOLERANCE = 1.2

export interface SettleSample {
  atMs: number
  /** Cumulative main-thread task time, monotonic within a document. */
  taskDurationMs: number
  inFlight: number
}

export interface SettleConfig {
  /** The page's ambient duty cycle, or null to require absolute idle. */
  baselineRate: number | null
  quietForMs: number
}

export interface SettleDetector {
  /** Feeds one sample; returns whether the page has been quiet for the full window. */
  push(sample: SettleSample): boolean
  /** Wall-clock ms at which the current quiet run began, or null if not quiet. */
  quietSinceMs(): number | null
}

export function createSettleDetector(config: SettleConfig): SettleDetector {
  const threshold =
    config.baselineRate == null ? ABSOLUTE_IDLE_RATE : Math.max(config.baselineRate * BASELINE_TOLERANCE, ABSOLUTE_IDLE_RATE)

  let prev: SettleSample | null = null
  let quietSince: number | null = null

  return {
    push(sample) {
      const last = prev
      prev = sample
      // The first sample spans no interval, so it carries no rate to judge.
      if (!last) return false

      const dtMs = sample.atMs - last.atMs
      if (dtMs <= 0) return quietSince != null && sample.atMs - quietSince >= config.quietForMs

      // A navigation resets the counter; clamping keeps the negative delta from
      // reading as deep idle. In-flight requests cover that window anyway.
      const busyMs = Math.max(0, sample.taskDurationMs - last.taskDurationMs)
      const rate = busyMs / dtMs

      if (sample.inFlight > 0 || rate > threshold) {
        quietSince = null
        return false
      }
      if (quietSince == null) quietSince = sample.atMs
      return sample.atMs - quietSince >= config.quietForMs
    },
    quietSinceMs: () => quietSince,
  }
}
