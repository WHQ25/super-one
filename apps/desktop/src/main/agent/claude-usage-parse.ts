import type { ClaudeRateLimits, ClaudeRateLimitWindow } from '@superone/shared/agent-types'

interface UsageWindow {
  utilization?: number
  resets_at?: string
}

/**
 * A row of the `limits` array. Anthropic moved the per-model weekly windows off the legacy
 * top-level `seven_day_<model>` keys (which now come back `null`) into this array, so a model
 * added after that move — Fable — is only ever reported here. Note the percentage field is
 * `percent`, not the `utilization` the top-level windows use.
 */
interface UsageLimitEntry {
  kind?: string
  group?: string
  percent?: number
  resets_at?: string
  scope?: { model?: { display_name?: string; id?: string | null } | null } | null
}

export interface UsageResponse {
  five_hour?: UsageWindow | null
  seven_day?: UsageWindow | null
  seven_day_opus?: UsageWindow | null
  seven_day_sonnet?: UsageWindow | null
  seven_day_omelette?: UsageWindow | null
  limits?: UsageLimitEntry[] | null
  extra_usage?: { is_enabled?: boolean; used_credits?: number; monthly_limit?: number }
}

/** Top-level windows emitted before the model-scoped ones from `limits`. */
const LEADING_WINDOW_LABELS: Array<[keyof UsageResponse, string]> = [
  ['five_hour', '5h'],
  ['seven_day', 'Weekly'],
]

/** Legacy per-model windows, superseded by a scoped row of the same label when both are present. */
const LEGACY_MODEL_WINDOW_LABELS: Array<[keyof UsageResponse, string]> = [
  ['seven_day_opus', 'Opus weekly'],
  ['seven_day_sonnet', 'Sonnet weekly'],
  ['seven_day_omelette', 'Claude Design'],
]

function isoToEpochSeconds(iso: string | undefined): number | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
}

function toWindow(data: UsageResponse, key: keyof UsageResponse, label: string): ClaudeRateLimitWindow | null {
  const win = data[key] as UsageWindow | null | undefined
  if (!win || typeof win.utilization !== 'number') return null
  return { label, usedPercent: win.utilization, resetsAt: isoToEpochSeconds(win.resets_at) }
}

/** Model-scoped weekly windows, labelled `<Model> weekly` to match the legacy per-model labels. */
function scopedWeeklyWindows(limits: UsageLimitEntry[] | null | undefined): ClaudeRateLimitWindow[] {
  if (!Array.isArray(limits)) return []
  const windows: ClaudeRateLimitWindow[] = []
  for (const entry of limits) {
    if (entry?.kind !== 'weekly_scoped' || typeof entry.percent !== 'number') continue
    const modelName = entry.scope?.model?.display_name?.trim()
    if (!modelName) continue
    const label = `${modelName} weekly`
    if (windows.some((w) => w.label === label)) continue
    windows.push({ label, usedPercent: entry.percent, resetsAt: isoToEpochSeconds(entry.resets_at) })
  }
  return windows
}

export function parseUsage(data: UsageResponse, planType: string | null): ClaudeRateLimits {
  const windows: ClaudeRateLimitWindow[] = []
  for (const [key, label] of LEADING_WINDOW_LABELS) {
    const win = toWindow(data, key, label)
    if (win) windows.push(win)
  }
  windows.push(...scopedWeeklyWindows(data.limits))
  for (const [key, label] of LEGACY_MODEL_WINDOW_LABELS) {
    if (windows.some((w) => w.label === label)) continue
    const win = toWindow(data, key, label)
    if (win) windows.push(win)
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
