import type { ClaudeRateLimits, ClaudeRateLimitWindow } from '@superone/shared/agent-types'

interface UsageWindow {
  utilization?: number
  resets_at?: string
}

export interface UsageResponse {
  five_hour?: UsageWindow
  seven_day?: UsageWindow
  seven_day_opus?: UsageWindow
  seven_day_sonnet?: UsageWindow
  seven_day_omelette?: UsageWindow
  extra_usage?: { is_enabled?: boolean; used_credits?: number; monthly_limit?: number }
}

const WINDOW_LABELS: Array<[keyof UsageResponse, string]> = [
  ['five_hour', '5h'],
  ['seven_day', 'Weekly'],
  ['seven_day_opus', 'Opus weekly'],
  ['seven_day_sonnet', 'Sonnet weekly'],
  ['seven_day_omelette', 'Claude Design'],
]

function isoToEpochSeconds(iso: string | undefined): number | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
}

export function parseUsage(data: UsageResponse, planType: string | null): ClaudeRateLimits {
  const windows: ClaudeRateLimitWindow[] = []
  for (const [key, label] of WINDOW_LABELS) {
    const win = data[key] as UsageWindow | undefined
    if (win && typeof win.utilization === 'number') {
      windows.push({ label, usedPercent: win.utilization, resetsAt: isoToEpochSeconds(win.resets_at) })
    }
  }
  let extraUsage: ClaudeRateLimits['extraUsage'] = null
  const extra = data.extra_usage
  if (extra?.is_enabled && typeof extra.used_credits === 'number') {
    extraUsage = {
      usedDollars: extra.used_credits / 100,
      limitDollars: typeof extra.monthly_limit === 'number' && extra.monthly_limit > 0 ? extra.monthly_limit / 100 : null,
    }
  }
  return { windows, extraUsage, planType }
}
