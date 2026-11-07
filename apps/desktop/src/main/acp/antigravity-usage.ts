import { existsSync, readFileSync } from 'node:fs'
import * as electron from 'electron'
import type { ClaudeRateLimitWindow, ProviderRateLimits } from '@superone/shared/agent-types'
import {
  antigravityTokenFilePath,
  readAntigravityAuthConfig,
  writeAntigravityAuthEmail,
} from './antigravity-profile'
export * from './antigravity-db-usage'

export const ANTIGRAVITY_DAILY_ENDPOINT = 'https://daily-cloudcode-pa.googleapis.com'
export const ANTIGRAVITY_PROD_ENDPOINT = 'https://cloudcode-pa.googleapis.com'
const ENDPOINTS = [ANTIGRAVITY_DAILY_ENDPOINT, ANTIGRAVITY_PROD_ENDPOINT] as const
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'
const MIN_FETCH_INTERVAL_MS = 60_000
const REQUEST_TIMEOUT_MS = 10_000

interface TokenFile {
  client_id: string
  client_secret: string
  refresh_token: string
  project_id?: string
}

interface QuotaBucket {
  bucketId?: string
  window?: string
  displayName?: string
  disabled?: boolean
  remainingFraction?: number
  resetTime?: string
}

let cachedToken: {
  key: string
  accessToken: string
  expiresAt: number
} | null = null

let cachedReading: {
  at: number
  value: ProviderRateLimits | null
} | null = null

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

function readTokenFile(): TokenFile | null {
  const path = antigravityTokenFilePath()
  if (!existsSync(path)) return null
  try {
    const parsed = asRecord(JSON.parse(readFileSync(path, 'utf-8')))
    if (
      typeof parsed?.client_id !== 'string' ||
      typeof parsed?.client_secret !== 'string' ||
      typeof parsed?.refresh_token !== 'string'
    ) {
      return null
    }
    return {
      client_id: parsed.client_id,
      client_secret: parsed.client_secret,
      refresh_token: parsed.refresh_token,
      ...(typeof parsed.project_id === 'string' ? { project_id: parsed.project_id } : {}),
    }
  } catch {
    return null
  }
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const fetcher: typeof fetch =
    typeof electron.net?.fetch === 'function'
      ? (electron.net.fetch.bind(electron.net) as unknown as typeof fetch)
      : fetch
  try {
    const response = await fetcher(url, {
      ...init,
      redirect: 'manual',
      signal: controller.signal,
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function resolveAccessToken(token: TokenFile): Promise<string | null> {
  const key = `${token.client_id}:${token.refresh_token}`
  const now = Date.now()
  if (cachedToken && cachedToken.key === key && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.accessToken
  }
  const body = new URLSearchParams({
    client_id: token.client_id,
    client_secret: token.client_secret,
    refresh_token: token.refresh_token,
    grant_type: 'refresh_token',
  })
  const raw = asRecord(
    await fetchJson(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    }),
  )
  if (typeof raw?.access_token !== 'string' || typeof raw?.expires_in !== 'number') {
    return null
  }
  cachedToken = {
    key,
    accessToken: raw.access_token,
    expiresAt: now + raw.expires_in * 1000,
  }
  return raw.access_token
}

function mergeWindows(target: Map<string, ClaudeRateLimitWindow>, items: ClaudeRateLimitWindow[]): void {
  for (const win of items) {
    const key = win.id ?? win.label
    const prev = target.get(key)
    if (!prev || win.usedPercent > prev.usedPercent) {
      target.set(key, win)
    }
  }
}

function hasCompleteGeminiWindows(windows: Map<string, ClaudeRateLimitWindow>): boolean {
  return windows.has('gemini-5h') && windows.has('gemini-weekly')
}

function candidateProjectBodies(
  endpointProjectId: string | null | undefined,
  tokenProjectId: string | undefined,
): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const id of [endpointProjectId, tokenProjectId, null]) {
    const payload = JSON.stringify(id ? { project: id } : {})
    if (!seen.has(payload)) {
      seen.add(payload)
      result.push(payload)
    }
  }
  return result
}

export async function readAntigravityRateLimits(force = false): Promise<ProviderRateLimits | null> {
  const now = Date.now()
  if (!force && cachedReading && now - cachedReading.at < MIN_FETCH_INTERVAL_MS) {
    return cachedReading.value
  }
  const config = readAntigravityAuthConfig()
  if (config.authMethod !== 'oauth-personal' && config.authMethod !== 'oauth-business') {
    return null
  }
  const token = readTokenFile()
  if (!token) return null
  const accessToken = await resolveAccessToken(token)
  if (!accessToken) return null

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'User-Agent': `antigravity/hub/2.24.0 (aidev_client; os_type=${process.platform}; arch=${process.arch}; cl=963137146)`,
  }

  let planType: string | null = null
  let usesGcpTos: boolean | undefined
  let email: string | null = config.email ?? null
  const endpointProjects = new Map<string, string | null>()
  await Promise.all([
    fetchJson(USERINFO_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    }).then((json) => {
      const fetchedEmail = parseAntigravityUserEmail(json)
      if (fetchedEmail) {
        email = fetchedEmail
        writeAntigravityAuthEmail(fetchedEmail)
      }
    }),
    ...ENDPOINTS.map(async (endpoint) => {
      let json = await fetchJson(`${endpoint}/v1internal:loadCodeAssist`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...(token.project_id ? { cloudaicompanionProject: token.project_id } : {}),
          metadata: { ideType: 'ANTIGRAVITY' },
        }),
      })
      let parsed = parseAntigravityPlanType(json)
      if (!parsed.projectId && token.project_id) {
        json = await fetchJson(`${endpoint}/v1internal:loadCodeAssist`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } }),
        })
        const fallbackParsed = parseAntigravityPlanType(json)
        parsed = {
          planType: parsed.planType ?? fallbackParsed.planType,
          projectId: fallbackParsed.projectId,
          ...(parsed.usesGcpTos !== undefined
            ? { usesGcpTos: parsed.usesGcpTos }
            : fallbackParsed.usesGcpTos !== undefined
              ? { usesGcpTos: fallbackParsed.usesGcpTos }
              : {}),
        }
      }
      if (parsed.planType && (!planType || planType === 'Free' || planType === 'Standard')) {
        planType = parsed.planType
      }
      if (parsed.usesGcpTos !== undefined && usesGcpTos === undefined) {
        usesGcpTos = parsed.usesGcpTos
      }
      endpointProjects.set(endpoint, parsed.projectId)
    }),
  ])

  const merged = new Map<string, ClaudeRateLimitWindow>()
  for (const endpoint of resolveAntigravityQuotaEndpoints(usesGcpTos)) {
    const endpointWindows = new Map<string, ClaudeRateLimitWindow>()
    const bodies = candidateProjectBodies(endpointProjects.get(endpoint), token.project_id)
    for (const body of bodies) {
      const json = await fetchJson(`${endpoint}/v1internal:retrieveUserQuotaSummary`, {
        method: 'POST',
        headers,
        body,
      })
      if (!planType) {
        planType = parseAntigravityPlanType(json).planType
      }
      const wins = parseAntigravityQuotaSummary(json)
      mergeWindows(endpointWindows, wins)
      if (wins.some((w) => w.id === 'gemini-weekly')) {
        break
      }
    }

    if (!hasCompleteGeminiWindows(endpointWindows)) {
      for (const body of bodies) {
        const json = await fetchJson(`${endpoint}/v1internal:fetchAvailableModels`, {
          method: 'POST',
          headers,
          body,
        })
        if (!planType) {
          planType = parseAntigravityPlanType(json).planType
        }
        const modelWins = parseAntigravityModelQuotas(json)
        if (modelWins.length === 0) continue
        mergeWindows(
          endpointWindows,
          endpointWindows.size > 0
            ? modelWins.filter((w) => w.id?.startsWith('gemini') || w.label.startsWith('Gemini'))
            : modelWins,
        )
        if (hasCompleteGeminiWindows(endpointWindows)) {
          break
        }
      }
    }

    if (endpointWindows.size > 0) {
      for (const [k, v] of endpointWindows) {
        merged.set(k, v)
      }
      break
    }
  }

  const windows = [...merged.values()].sort((a, b) => {
    const aGemini = a.label.startsWith('Gemini') ? 0 : 1
    const bGemini = b.label.startsWith('Gemini') ? 0 : 1
    if (aGemini !== bGemini) return aGemini - bGemini
    const aWeekly = a.label.endsWith('Weekly') ? 1 : 0
    const bWeekly = b.label.endsWith('Weekly') ? 1 : 0
    return aWeekly - bWeekly
  })
  const value: ProviderRateLimits | null =
    windows.length > 0
      ? {
          title: 'Antigravity',
          ...(email ? { email } : {}),
          planType,
          windows,
          extraUsage: null,
          fetchedAt: Date.now(),
        }
      : null
  cachedReading = { at: Date.now(), value }
  return value
}
