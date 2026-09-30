import { usageRisk, USAGE_FRESH_MS, type UsageWindow } from './subscription-usage'

/** Copy inputs only; each surface supplies its normal translator. No provider or UI dependencies. */
export function usageForecastCopy(window: UsageWindow, now = Date.now()): { key: string; time?: string } | null {
  const forecast = window.forecast
  if (!forecast) return null
  if (forecast.status === 'learning') return null
  if (now - forecast.sampledAt > USAGE_FRESH_MS || (window.resetsAt != null && window.resetsAt * 1000 <= now)) return { key: 'stale' }
  if (window.usedPercent >= 100) return { key: 'exhausted' }
  if (forecast.status === 'idle') return { key: 'idle' }
  if (forecast.status !== 'ready' || forecast.exhaustsAt == null) return null
  if (usageRisk(window, now) === 'safe') return null
  return { key: forecast.basis === 'cycle-average' ? 'averageEta' : 'eta', time: formatUsageDuration(forecast.exhaustsAt - now) }
}

export function formatUsageDuration(milliseconds: number): string {
  const minutes = Math.max(1, Math.ceil(milliseconds / 300_000) * 5)
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`
  return `${Math.floor(minutes / 1440)}d${Math.floor(minutes % 1440 / 60) ? ` ${Math.floor(minutes % 1440 / 60)}h` : ''}`
}
