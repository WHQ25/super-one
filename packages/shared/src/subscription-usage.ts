/** Subscription percentages are account readings, not estimates from session tokens. */
export const USAGE_POLL_MS = 5 * 60_000
export const USAGE_FRESH_MS = 10 * 60_000
export const USAGE_HISTORY_MS = 60 * 60_000
export const USAGE_RESET_TOLERANCE_MS = 60_000

export type UsageRisk = 'unknown' | 'safe' | 'watch' | 'risk' | 'critical' | 'exhausted'

export interface UsageForecast {
  sampledAt: number
  status: 'learning' | 'ready' | 'idle'
  ratePerHour: number | null
  exhaustsAt: number | null
  /** Two independent readings agree; cached reads never confirm a forecast. */
  confirmed: boolean
}

export interface UsageWindow {
  model?: string
  id?: string
  label: string
  usedPercent: number
  /** Unix seconds, as supplied by the provider. */
  resetsAt: number | null
  forecast?: UsageForecast
}

export interface UsageSample {
  at: number
  usedPercent: number
  resetsAt: number | null
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
  const untilReset = resetsAt * 1000 - now
  const untilEmpty = forecast.exhaustsAt - now
  // A margin around the reset boundary avoids claiming safety from a few rounded percentage points.
  if (untilEmpty >= untilReset * 1.2) return 'safe'
  if (untilEmpty >= untilReset * 0.8) return 'watch'
  return untilEmpty <= 30 * 60_000 ? 'critical' : 'risk'
}

export function usageWindowTone(window: Pick<UsageWindow, 'usedPercent' | 'resetsAt' | 'forecast'>, now = Date.now()): 'success' | 'warning' | 'error' | 'muted' {
  const risk = usageRisk(window, now)
  if (risk === 'safe') return 'success'
  if (risk === 'watch' || risk === 'risk') return 'warning'
  if (risk === 'critical' || risk === 'exhausted') return 'error'
  // Forecast-enabled meters never dress stale/insufficient evidence up as a warning or assurance.
  if (window.forecast) return 'muted'
  return window.usedPercent >= 90 ? 'error' : window.usedPercent >= 70 ? 'warning' : 'success'
}

/** Recent wall-clock rate. Flat intervals count; sleep/offline gaps and resets start a new series. */
export function forecastUsage(samples: readonly UsageSample[]): UsageForecast {
  const last = samples.at(-1)
  const learning: UsageForecast = { sampledAt: last?.at ?? 0, status: 'learning', ratePerHour: null, exhaustsAt: null, confirmed: false }
  if (!last || samples.length < 4 || last.at - samples[0].at < 15 * 60_000) return learning
  let weightedUsage = 0
  let weightedHours = 0
  let lastIncrease = samples[0].at
  for (let i = 1; i < samples.length; i++) {
    const previous = samples[i - 1]
    const sample = samples[i]
    const delta = sample.usedPercent - previous.usedPercent
    const hours = (sample.at - previous.at) / 3_600_000
    if (hours <= 0 || delta < 0) return learning
    if (delta > 0) lastIncrease = sample.at
    const weight = Math.pow(0.5, (last.at - sample.at) / (20 * 60_000))
    weightedUsage += delta * weight
    weightedHours += hours * weight
  }
  if (last.at - lastIncrease >= 20 * 60_000) return { ...learning, status: 'idle' }
  // Providers commonly round to whole percentages: a sub-point movement is not enough evidence.
  if (last.usedPercent - samples[0].usedPercent < 1 || weightedHours <= 0) return learning
  const ratePerHour = weightedUsage / weightedHours
  return { ...learning, status: 'ready', ratePerHour,
    exhaustsAt: last.at + Math.max(0, 100 - last.usedPercent) / ratePerHour * 3_600_000 }
}

interface WindowHistory {
  samples: UsageSample[]
  forecast: UsageForecast
  risk: UsageRisk
}

/** Host-owned, bounded history shared across projects, sessions, desktop windows and phones. */
export class SubscriptionUsageTracker {
  private readonly history = new Map<string, WindowHistory>()

  observe(accountKey: string, window: UsageWindow, sampledAt: number): UsageWindow {
    const key = JSON.stringify([accountKey, window.id ?? window.label])
    let entry = this.history.get(key)
    const last = entry?.samples.at(-1)
    if (!Number.isFinite(sampledAt) || !Number.isFinite(window.usedPercent) || window.usedPercent < 0
      || window.usedPercent > 100 || (window.resetsAt != null && !Number.isFinite(window.resetsAt))) {
      this.history.delete(key)
      return { ...window, forecast: { sampledAt, status: 'learning', ratePerHour: null, exhaustsAt: null, confirmed: false } }
    }
    // Ignore duplicate and out-of-order responses, including the provider's last-good cache.
    if (last && sampledAt <= last.at) return { ...window, usedPercent: last.usedPercent, resetsAt: last.resetsAt, forecast: entry!.forecast }
    const restarted = !last || !sameUsageReset(last.resetsAt, window.resetsAt)
      || sampledAt - last.at > 15 * 60_000 || window.usedPercent < last.usedPercent
    if (restarted) entry = undefined
    // Manual refresh/multiple clients must not turn one burst into four independent observations.
    if (entry && last && sampledAt - last.at < 60_000) return { ...window, forecast: window.usedPercent === last.usedPercent
      ? entry.forecast
      : { sampledAt, status: 'learning', ratePerHour: null, exhaustsAt: null, confirmed: false } }
    const samples = [...(entry?.samples ?? []), { at: sampledAt, usedPercent: window.usedPercent, resetsAt: window.resetsAt }]
      .filter((sample) => sampledAt - sample.at <= USAGE_HISTORY_MS).slice(-61)
    const forecast = forecastUsage(samples)
    const risk = usageRisk({ ...window, forecast }, sampledAt)
    forecast.confirmed = risk !== 'unknown' && entry?.risk === risk
    this.history.delete(key)
    this.history.set(key, { samples, forecast, risk })
    // Account removals do not leave unbounded history in a long-running host.
    for (const [id, value] of this.history) {
      if (sampledAt - value.forecast.sampledAt > USAGE_HISTORY_MS || this.history.size > 256) this.history.delete(id)
    }
    return { ...window, forecast }
  }
}
