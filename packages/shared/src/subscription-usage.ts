/** Subscription percentages are account readings, not estimates from session tokens. */
export const USAGE_POLL_MS = 5 * 60_000
export const USAGE_FRESH_MS = 10 * 60_000
export const USAGE_HISTORY_MS = 60 * 60_000
export const USAGE_RESET_TOLERANCE_MS = 60_000

export type UsageRisk = 'unknown' | 'safe' | 'watch' | 'risk' | 'critical' | 'exhausted'

export interface UsageForecast {
  basis?: 'cycle-average'
  /** Quota period length; only an exhaustion within the last tenth of it is treated as a risk. */
  periodMs?: number
  sampledAt: number
  status: 'learning' | 'ready' | 'idle'
  ratePerHour: number | null
  exhaustsAt: number | null
  /** Two independent readings agree; cached reads never confirm a forecast. */
  confirmed: boolean
}

export interface UsageWindow {
  windowDurationMins?: number | null
  model?: string
  id?: string
  label: string
  usedPercent: number
  /** Unix seconds, as supplied by the provider. */
  resetsAt: number | null
  forecast?: UsageForecast
}

export function sameUsageReset(a: number | null, b: number | null): boolean {
  return a === b || (a != null && b != null && Math.abs(a - b) * 1000 <= USAGE_RESET_TOLERANCE_MS)
}

export function usageRisk(window: Pick<UsageWindow, 'usedPercent' | 'resetsAt' | 'forecast'>, now = Date.now()): UsageRisk {
  const { forecast, resetsAt, usedPercent } = window
  if (resetsAt != null && resetsAt * 1000 <= now) return 'unknown'
  if (!forecast || now - forecast.sampledAt > USAGE_FRESH_MS || forecast.sampledAt > now + 60_000) return 'unknown'
  if (usedPercent >= 100) return 'exhausted'
  if (forecast.status !== 'ready' || forecast.exhaustsAt == null || resetsAt == null) return 'unknown'
  const untilEmpty = forecast.exhaustsAt - now
  if (untilEmpty <= 0) return 'critical'
  const projectedUsage = window.usedPercent + (100 - window.usedPercent)
    * (resetsAt * 1000 - forecast.sampledAt) / (forecast.exhaustsAt - forecast.sampledAt)
  if (projectedUsage <= 90) return 'safe'
  if (projectedUsage <= 100) return 'watch'
  if (untilEmpty <= 30 * 60_000) return 'critical'
  // Early-cycle pace is noisy; running out hours away stays a warning until it is imminent.
  return forecast.periodMs != null && untilEmpty <= forecast.periodMs * 0.1 ? 'risk' : 'watch'
}

export function usageWindowTone(window: Pick<UsageWindow, 'usedPercent' | 'resetsAt' | 'forecast'>, now = Date.now()): 'success' | 'warning' | 'error' {
  if (window.usedPercent <= 0) return 'success'
  const risk = usageRisk(window, now)
  if (risk === 'safe') return 'success'
  if (risk === 'watch') return 'warning'
  if (risk === 'risk' || risk === 'critical' || risk === 'exhausted') return 'error'
  return window.usedPercent >= 90 ? 'error' : window.usedPercent >= 70 ? 'warning' : 'success'
}

function cycleAverageForecast(window: UsageWindow, sampledAt: number): UsageForecast | null {
  const duration = window.windowDurationMins
  if (duration == null || !Number.isFinite(duration) || duration <= 0 || window.resetsAt == null || window.usedPercent <= 0) return null
  const elapsed = sampledAt - (window.resetsAt * 1000 - duration * 60_000)
  if (elapsed < Math.max(60_000, duration * 60_000 * 0.01) || elapsed >= duration * 60_000) return null
  const ratePerHour = window.usedPercent / (elapsed / 3_600_000)
  return { sampledAt, status: 'ready', basis: 'cycle-average', periodMs: duration * 60_000, ratePerHour,
    exhaustsAt: sampledAt + (100 - window.usedPercent) / ratePerHour * 3_600_000, confirmed: false }
}

interface WindowHistory {
  window: UsageWindow
  forecast: UsageForecast
  risk: UsageRisk
}

/** Latest independent readings, isolated by account and quota window. */
export class SubscriptionUsageTracker {
  private readonly history = new Map<string, WindowHistory>()

  observe(accountKey: string, window: UsageWindow, sampledAt: number): UsageWindow {
    const key = JSON.stringify([accountKey, window.id ?? window.label])
    let entry = this.history.get(key)
    const learning: UsageForecast = { sampledAt, status: 'learning', ratePerHour: null, exhaustsAt: null, confirmed: false }
    if (!Number.isFinite(sampledAt) || !Number.isFinite(window.usedPercent) || window.usedPercent < 0
      || window.usedPercent > 100 || (window.resetsAt != null && !Number.isFinite(window.resetsAt))) {
      this.history.delete(key)
      return { ...window, forecast: learning }
    }
    // Cached and out-of-order responses cannot advance or confirm a forecast.
    if (entry && sampledAt <= entry.forecast.sampledAt) return { ...entry.window, forecast: entry.forecast }
    if (entry && (!sameUsageReset(entry.window.resetsAt, window.resetsAt)
      || sampledAt - entry.forecast.sampledAt > 15 * 60_000 || window.usedPercent < entry.window.usedPercent)) entry = undefined
    const forecast = cycleAverageForecast(window, sampledAt) ?? learning
    const risk = usageRisk({ ...window, forecast }, sampledAt)
    if (entry && sampledAt - entry.forecast.sampledAt < 60_000) return { ...window, forecast }
    forecast.confirmed = risk !== 'unknown' && entry?.risk === risk
    this.history.delete(key)
    this.history.set(key, { window, forecast, risk })
    for (const [id, value] of this.history) {
      if (sampledAt - value.forecast.sampledAt > USAGE_HISTORY_MS || this.history.size > 256) this.history.delete(id)
    }
    return { ...window, forecast }
  }
}
