import { sameUsageReset, usageRisk, type UsageWindow } from './subscription-usage'

export interface LiveUsageLimit {
  status: 'allowed_warning' | 'rejected'
  resetsAt?: number
  rateLimitType?: string
  utilization?: number
}

export interface SubscriptionAlert extends LiveUsageLimit {
  source: 'provider' | 'forecast'
  windowId: string
  label?: string
  severity: 1 | 2 | 3
  exhaustsAt?: number
}

function matchingWindow(windows: readonly UsageWindow[], info: LiveUsageLimit): UsageWindow | undefined {
  const exact = info.rateLimitType ? windows.find((window) => window.id === info.rateLimitType) : undefined
  if (exact && (info.resetsAt == null || sameUsageReset(exact.resetsAt, info.resetsAt))) return exact
  if (info.rateLimitType) return undefined
  // A reset shared by the global weekly pool and a model pool is ambiguous. Never suppress it.
  const byReset = info.resetsAt == null ? [] : windows.filter((window) => sameUsageReset(window.resetsAt, info.resetsAt!))
  return byReset.length === 1 ? byReset[0] : undefined
}

/** Only reliable, matching, current evidence can override a provider's early warning. */
export function relevantUsageLimit<T extends LiveUsageLimit>(info: T | null | undefined, windows: readonly UsageWindow[], now = Date.now()): T | null {
  if (!info || (info.resetsAt != null && info.resetsAt * 1000 <= now)) return null
  if (info.status === 'rejected') return info
  const window = matchingWindow(windows, info)
  const newerUsage = window && info.utilization != null && info.utilization * 100 > window.usedPercent + 0.5
  if (!newerUsage && window?.forecast?.confirmed && usageRisk(window, now) === 'safe') return null
  return info
}

/** One bubble: actual rejection first, otherwise the earliest quota forecast that interrupts work. */
export function selectSubscriptionAlert(windows: readonly UsageWindow[], info: LiveUsageLimit | null, now = Date.now(), model?: string): SubscriptionAlert | null {
  const live = relevantUsageLimit(info, windows, now)
  const matched = live ? matchingWindow(windows, live) : undefined
  const provider: SubscriptionAlert | null = live ? { ...live, source: 'provider',
    windowId: matched?.id ?? live.rateLimitType ?? matched?.label ?? 'provider',
    label: matched?.label, severity: live.status === 'rejected' ? 3 : 1 } : null
  if (provider?.severity === 3) return provider
  const forecasts = windows.flatMap((window): SubscriptionAlert[] => {
    if (window.model && !model?.toLowerCase().includes(window.model.toLowerCase())) return []
    const risk = usageRisk(window, now)
    if (!window.forecast?.confirmed || (risk !== 'risk' && risk !== 'critical' && risk !== 'exhausted')) return []
    return [{ source: 'forecast', status: 'allowed_warning', windowId: window.id ?? window.label,
      label: window.label, resetsAt: window.resetsAt ?? undefined,
      severity: risk === 'risk' ? 1 : 2, exhaustsAt: window.forecast.exhaustsAt ?? undefined }]
  }).sort((a, b) => (a.exhaustsAt ?? now) - (b.exhaustsAt ?? now))
  return forecasts[0] ?? provider
}

interface AlertRecord { reset: number | null; severity: number; lastSeen: number; safeSince?: number }

/** Per-account/window episodes, independent of projects or which session is selected. */
export class SubscriptionAlertLedger {
  private readonly records = new Map<string, AlertRecord>()

  endRejection(account: string, windowId: string): void {
    const key = JSON.stringify([account, windowId])
    if (this.records.get(key)?.severity === 3) this.records.delete(key)
  }

  recover(account: string, windows: readonly UsageWindow[], now: number): void {
    for (const window of windows) {
      const record = this.records.get(JSON.stringify([account, window.id ?? window.label]))
      if (!record) continue
      if (window.forecast?.confirmed && usageRisk(window, now) === 'safe') {
        record.safeSince ??= now
        if (now - record.safeSince >= 10 * 60_000) record.severity = 0
      } else {
        record.safeSince = undefined
      }
    }
  }

  claim(account: string, alert: SubscriptionAlert, now: number): boolean {
    const key = JSON.stringify([account, alert.windowId])
    let record = this.records.get(key)
    if (record && !sameUsageReset(record.reset, alert.resetsAt ?? null)) record = undefined
    if (record && record.severity >= alert.severity) return false
    this.records.set(key, { reset: alert.resetsAt ?? null, severity: alert.severity, lastSeen: now })
    for (const [id, value] of this.records) {
      if ((value.reset != null && value.reset * 1000 < now) || now - value.lastSeen > 8 * 86400_000 || this.records.size > 512) this.records.delete(id)
    }
    return true
  }

  clear(): void { this.records.clear() }
}
