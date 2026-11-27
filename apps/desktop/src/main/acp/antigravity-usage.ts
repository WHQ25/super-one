import type { ClaudeRateLimitWindow, ProviderRateLimits } from '@superone/shared/agent-types'
export * from './antigravity-db-usage'

export const ANTIGRAVITY_DAILY_ENDPOINT = 'https://daily-cloudcode-pa.googleapis.com'
export const ANTIGRAVITY_PROD_ENDPOINT = 'https://cloudcode-pa.googleapis.com'

interface QuotaBucket {
  bucketId?: string
  window?: string
  displayName?: string
  disabled?: boolean
  remainingFraction?: number
  resetTime?: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function epochSeconds(iso: unknown): number | null {
  if (typeof iso !== 'string' || !iso.trim()) return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
}

function toWindow(
  id: string,
  label: string,
  quota: Record<string, unknown>,
  windowDurationMins?: number,
): ClaudeRateLimitWindow | null {
  const remaining = quota.remainingFraction
  if (typeof remaining !== 'number' || !Number.isFinite(remaining)) return null
  const clamped = Math.max(0, Math.min(1, remaining))
  return {
    id,
    label,
    usedPercent: (1 - clamped) * 100,
    resetsAt: epochSeconds(quota.resetTime),
    ...(windowDurationMins !== undefined ? { windowDurationMins } : {}),
  }
}

export function parseAntigravityQuotaSummary(raw: unknown): ClaudeRateLimitWindow[] {
  const root = asRecord(raw)
  if (!root) return []
  const windows = new Map<string, ClaudeRateLimitWindow>()
  const rawGroups = Array.isArray(root.groups) ? root.groups : []
  const groups = [
    ...rawGroups,
    ...(Array.isArray(root.buckets) ? [{ buckets: root.buckets }] : []),
  ]

  for (const groupItem of groups) {
    const group = asRecord(groupItem)
    if (!group || !Array.isArray(group.buckets)) continue
    const groupName = typeof group.displayName === 'string' ? group.displayName.trim() : ''
    for (const bucketItem of group.buckets) {
      const bucket = asRecord(bucketItem) as (QuotaBucket & Record<string, unknown>) | null
      if (!bucket || bucket.disabled || typeof bucket.bucketId !== 'string' || !bucket.bucketId) continue
      const family = bucket.bucketId.startsWith('gemini-argon-')
        ? groupName || 'Gemini Argon'
        : bucket.bucketId.startsWith('gemini') || /gemini/i.test(groupName)
          ? 'Gemini'
          : bucket.bucketId.startsWith('3p-') || /claude|gpt/i.test(groupName)
            ? 'Claude & GPT'
            : groupName || bucket.bucketId
      const displayName = typeof bucket.displayName === 'string' ? bucket.displayName.trim() : ''
      const weekly =
        bucket.window === 'weekly' ||
        bucket.bucketId.endsWith('-weekly') ||
        /weekly/i.test(displayName)
      const session =
        bucket.window === '5h' ||
        bucket.bucketId.endsWith('-5h') ||
        /5h|5-hour|5 hours/i.test(displayName)
      const suffix = weekly ? 'Weekly' : session ? '5 Hours' : displayName || 'Quota'
      const duration = weekly ? 7 * 24 * 60 : session ? 5 * 60 : undefined
      const canonicalId =
        family === 'Gemini' && (weekly || session)
          ? `gemini-${weekly ? 'weekly' : '5h'}`
          : family === 'Claude & GPT' && (weekly || session)
            ? `3p-${weekly ? 'weekly' : '5h'}`
            : bucket.bucketId
      const win = toWindow(canonicalId, `${family} · ${suffix}`, bucket, duration)
      if (!win) continue
      const prev = windows.get(canonicalId)
      if (!prev || win.usedPercent > prev.usedPercent) {
        windows.set(canonicalId, win)
      }
    }
  }
  return [...windows.values()]
}

export function parseAntigravityModelQuotas(raw: unknown): ClaudeRateLimitWindow[] {
  const root = asRecord(raw)
  const models = asRecord(root?.models)
  if (!models) return []
  const windows = new Map<string, ClaudeRateLimitWindow>()
  for (const [modelId, modelValue] of Object.entries(models)) {
    const model = asRecord(modelValue)
    if (!model) continue
    const provider = typeof model.modelProvider === 'string' ? model.modelProvider : ''
    const family =
      provider === 'MODEL_PROVIDER_GOOGLE' || modelId.startsWith('gemini-')
        ? 'Gemini'
        : provider === 'MODEL_PROVIDER_ANTHROPIC' ||
            provider === 'MODEL_PROVIDER_OPENAI' ||
            modelId.startsWith('claude-') ||
            modelId.startsWith('gpt-')
          ? 'Claude & GPT'
          : null
    if (!family) continue
    const prefix = family === 'Gemini' ? 'gemini' : '3p'
    const entries: Array<[string, string, Record<string, unknown> | null, number]> = [
      [`${prefix}-5h`, `${family} · 5 Hours`, asRecord(model.quotaInfo), 5 * 60],
      [`${prefix}-weekly`, `${family} · Weekly`, asRecord(model.weeklyQuotaInfo), 7 * 24 * 60],
    ]
    for (const [id, label, quota, duration] of entries) {
      if (!quota) continue
      const win = toWindow(id, label, quota, duration)
      if (!win) continue
      const prev = windows.get(id)
      if (!prev || win.usedPercent > prev.usedPercent) {
        windows.set(id, win)
      }
    }
  }
  return [...windows.values()]
}

function formatTierCandidate(tier: unknown): string | null {
  if (typeof tier === 'string' && tier.trim()) {
    return formatTierCandidate({ id: tier.trim() })
  }
  const rec = asRecord(tier)
  if (!rec) return null
  const id = typeof rec.id === 'string' ? rec.id.trim().toLowerCase() : ''
  const name = typeof rec.name === 'string' ? rec.name.trim() : ''
  const combined = `${id} ${name}`
  if (/ultra/i.test(combined)) return 'AI Ultra'
  if (/\bpro\b/i.test(combined)) return 'AI Pro'
  if (/enterprise/i.test(combined)) return 'Enterprise'
  if (/standard/i.test(combined)) return 'Standard'
  if (/free|legacy/i.test(combined)) return 'Free'
  if (name && !/^antigravity$/i.test(name)) return name
  if (id) return id.replace(/-tier$/i, '')
  return null
}

export function parseAntigravityPlanType(raw: unknown): {
  planType: string | null
  projectId: string | null
  usesGcpTos?: boolean
} {
  const root = asRecord(raw)
  if (!root) return { planType: null, projectId: null }
  const paidTier = asRecord(root.paidTier)
  const currentTier = asRecord(root.currentTier)
  const planType =
    formatTierCandidate(root.paidTier) ??
    formatTierCandidate(root.currentTier) ??
    formatTierCandidate(root.userTier) ??
    formatTierCandidate(root.tier)
  const rawProject = root.cloudaicompanionProject
  const projectId =
    typeof rawProject === 'string' && rawProject.trim()
      ? rawProject.trim()
      : typeof asRecord(rawProject)?.id === 'string'
        ? (asRecord(rawProject)!.id as string).trim()
        : null
  const usesGcpTos =
    typeof paidTier?.usesGcpTos === 'boolean'
      ? paidTier.usesGcpTos
      : typeof currentTier?.usesGcpTos === 'boolean'
        ? currentTier.usesGcpTos
        : undefined
  return {
    planType,
    projectId,
    ...(usesGcpTos !== undefined ? { usesGcpTos } : {}),
  }
}

export function resolveAntigravityQuotaEndpoints(usesGcpTos?: boolean): readonly string[] {
  return usesGcpTos
    ? [ANTIGRAVITY_PROD_ENDPOINT, ANTIGRAVITY_DAILY_ENDPOINT]
    : [ANTIGRAVITY_DAILY_ENDPOINT, ANTIGRAVITY_PROD_ENDPOINT]
}

export function parseAntigravityUserEmail(raw: unknown): string | null {
  const root = asRecord(raw)
  if (!root) return null
  const email = typeof root.email === 'string' ? root.email.trim() : ''
  return email || null
}

export const ANTIGRAVITY_QUOTA_API_ENABLED: boolean = false

export async function readAntigravityRateLimits(_force = false): Promise<ProviderRateLimits | null> {
  return null
}
