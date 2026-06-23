import type { ClaudeRateLimitWindow, ProviderRateLimits } from '@superone/shared/agent-types'

export type ProviderBrand = 'glm' | 'minimax'
export type ProviderRegion = 'cn' | 'global'

export interface DetectedProvider {
  brand: ProviderBrand
  region: ProviderRegion
  origin: string
  title: string
}

const HOST_MATCHERS: Array<{ test: (host: string) => boolean; brand: ProviderBrand; region: ProviderRegion; title: string }> = [
  { test: (h) => h.includes('bigmodel.cn'), brand: 'glm', region: 'cn', title: 'GLM' },
  { test: (h) => h.includes('z.ai'), brand: 'glm', region: 'global', title: 'GLM' },
  { test: (h) => h.includes('minimaxi.com'), brand: 'minimax', region: 'cn', title: 'MiniMax' },
  { test: (h) => h.includes('minimax.io'), brand: 'minimax', region: 'global', title: 'MiniMax' },
]

export function detectProvider(baseUrl: string | null | undefined): DetectedProvider | null {
  if (!baseUrl) return null
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase()
  const match = HOST_MATCHERS.find((m) => m.test(host))
  if (!match) return null
  return { brand: match.brand, region: match.region, origin: url.origin, title: match.title }
}

function readNumber(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value.trim()) : (value as number)
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

function epochSeconds(value: unknown): number | null {
  const n = readNumber(value)
  if (n === null || n <= 0) return null
  return Math.floor(n >= 1e12 ? n / 1000 : n)
}

interface GlmLimit {
  type?: string
  name?: string
  unit?: number
  percentage?: number
  currentValue?: number
  usage?: number
  nextResetTime?: number
}

export interface GlmSubscription {
  productName?: string | null
  nextRenewTime?: number | null
}

function planLabel(value: string | null | undefined): string | null {
  const text = String(value ?? '').trim()
  if (!text) return null
  return text.replace(/(^|\s)([a-z])/g, (_m, space: string, letter: string) => space + letter.toUpperCase())
}

function findGlmLimit(limits: GlmLimit[], type: string, unit?: number): GlmLimit | null {
  let fallback: GlmLimit | null = null
  for (const item of limits) {
    if (item.type === type || item.name === type) {
      if (unit === undefined) return item
      if (item.unit === unit) return item
      if (fallback === null && item.unit === undefined) fallback = item
    }
  }
  return fallback
}

export function parseGlmUsage(subscription: GlmSubscription | null, quota: unknown, title: string): ProviderRateLimits {
  const planType = planLabel(subscription?.productName ?? null)
  const windows: ClaudeRateLimitWindow[] = []

  const container = (quota as { data?: unknown })?.data ?? quota
  const rawLimits = (container as { limits?: unknown })?.limits ?? container
  const limits = Array.isArray(rawLimits) ? (rawLimits as GlmLimit[]) : []

  const session = findGlmLimit(limits, 'TOKENS_LIMIT', 3)
  if (session && typeof session.percentage === 'number') {
    windows.push({ label: 'Session', usedPercent: session.percentage, resetsAt: epochSeconds(session.nextResetTime) })
  }

  const weekly = findGlmLimit(limits, 'TOKENS_LIMIT', 6)
  if (weekly && typeof weekly.percentage === 'number') {
    windows.push({ label: 'Weekly', usedPercent: weekly.percentage, resetsAt: epochSeconds(weekly.nextResetTime) })
  }

  const web = findGlmLimit(limits, 'TIME_LIMIT')
  if (web && typeof web.currentValue === 'number' && typeof web.usage === 'number' && web.usage > 0) {
    windows.push({
      label: 'Web Searches',
      usedPercent: (web.currentValue / web.usage) * 100,
      resetsAt: epochSeconds(web.nextResetTime),
    })
  }

  return { windows, extraUsage: null, planType, title }
}

const MODEL_CALLS_PER_PROMPT = 15
const GLOBAL_PROMPT_LIMIT_TO_PLAN: Record<number, string> = { 100: 'Starter', 300: 'Plus', 1000: 'Max', 2000: 'Ultra' }
const CN_PROMPT_LIMIT_TO_PLAN: Record<number, string> = { 600: 'Starter', 1500: 'Plus', 4500: 'Max' }

function pick(...values: unknown[]): unknown {
  for (const v of values) if (v !== undefined && v !== null) return v
  return undefined
}

function inferMinimaxPlan(total: number | null, region: ProviderRegion): string | null {
  if (total === null || total <= 0) return null
  const n = Math.round(total)
  if (region === 'cn') return CN_PROMPT_LIMIT_TO_PLAN[n] ?? null
  if (GLOBAL_PROMPT_LIMIT_TO_PLAN[n]) return GLOBAL_PROMPT_LIMIT_TO_PLAN[n]
  if (n % MODEL_CALLS_PER_PROMPT !== 0) return null
  return GLOBAL_PROMPT_LIMIT_TO_PLAN[n / MODEL_CALLS_PER_PROMPT] ?? null
}

export function parseMinimaxUsage(payload: unknown, region: ProviderRegion, title: string): ProviderRateLimits {
  const empty: ProviderRateLimits = { windows: [], extraUsage: null, planType: null, title }
  if (!payload || typeof payload !== 'object') return empty

  const root = payload as Record<string, unknown>
  const data = (root.data && typeof root.data === 'object' ? root.data : root) as Record<string, unknown>
  const modelRemains = (Array.isArray(data.model_remains) && data.model_remains) || (Array.isArray(root.model_remains) && root.model_remains) || null
  if (!modelRemains || modelRemains.length === 0) return empty

  let chosen: Record<string, unknown> | null = null
  let percentFallback: Record<string, unknown> | null = null
  for (const raw of modelRemains as Record<string, unknown>[]) {
    if (!raw || typeof raw !== 'object') continue
    const total = readNumber(pick(raw.current_interval_total_count, raw.currentIntervalTotalCount))
    if (total !== null && total > 0) {
      chosen = raw
      break
    }
    const percent = readNumber(pick(raw.current_interval_remaining_percent, raw.currentIntervalRemainingPercent))
    if (percent !== null && percent >= 0 && percent <= 100 && !percentFallback) percentFallback = raw
  }
  if (!chosen) chosen = percentFallback
  if (!chosen) return empty

  const startSec = epochSeconds(pick(chosen.start_time, chosen.startTime))
  const endSec = epochSeconds(pick(chosen.end_time, chosen.endTime))
  const total = readNumber(pick(chosen.current_interval_total_count, chosen.currentIntervalTotalCount))
  const remainingPercent = readNumber(pick(chosen.current_interval_remaining_percent, chosen.currentIntervalRemainingPercent))

  let usedPercent: number | null = null
  let planType: string | null = null

  if (total !== null && total > 0) {
    const remainingCount = readNumber(
      pick(
        chosen.current_interval_remaining_count,
        chosen.currentIntervalRemainingCount,
        chosen.current_interval_usage_count,
        chosen.currentIntervalUsageCount,
      ),
    )
    if (remainingCount !== null) {
      const used = Math.max(0, Math.min(total, total - remainingCount))
      usedPercent = (used / total) * 100
    }
    planType = inferMinimaxPlan(total, region)
  } else if (remainingPercent !== null) {
    usedPercent = 100 - remainingPercent
  }

  if (usedPercent === null) return { ...empty, planType }

  return {
    windows: [{ label: 'Session', usedPercent, resetsAt: endSec ?? startSec }],
    extraUsage: null,
    planType,
    title,
  }
}
