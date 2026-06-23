import log from '../logger'
import type { ProviderRateLimits } from '@superone/shared/agent-types'
import { getProviderByIdRaw } from '../database'
import {
  detectProvider,
  parseGlmUsage,
  parseMinimaxUsage,
  type DetectedProvider,
  type GlmSubscription,
} from './provider-usage-parse'

const MIN_FETCH_INTERVAL_MS = 5 * 60 * 1000
const RATE_LIMIT_BACKOFF_MS = 5 * 60 * 1000

interface CacheEntry {
  data: ProviderRateLimits | null
  lastFetchMs: number
  rateLimitedUntilMs: number
}

const cache = new Map<string, CacheEntry>()

function tryParseJson<T>(text: string | null | undefined): T | null {
  if (!text) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

function resolveBaseUrl(agentConfigs: string | null | undefined): string | null {
  const configs = tryParseJson<{ claude?: { base_url?: string } }>(agentConfigs || '{}')
  return configs?.claude?.base_url?.trim() || null
}

async function fetchWithTimeout(url: string, apiKey: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

async function getJson<T>(url: string, apiKey: string): Promise<{ status: number; data: T | null }> {
  const resp = await fetchWithTimeout(url, apiKey, 10000)
  const data = resp.ok ? tryParseJson<T>(await resp.text()) : null
  return { status: resp.status, data }
}

async function fetchGlm(detected: DetectedProvider, apiKey: string): Promise<{ result: ProviderRateLimits | null; rateLimited: boolean }> {
  const quota = await getJson<unknown>(`${detected.origin}/api/monitor/usage/quota/limit`, apiKey)
  if (quota.status === 429) return { result: null, rateLimited: true }
  if (!quota.data) return { result: null, rateLimited: false }
  const sub = await getJson<{ data?: GlmSubscription[] }>(`${detected.origin}/api/biz/subscription/list`, apiKey)
  const subscription = Array.isArray(sub.data?.data) && sub.data.data.length > 0 ? sub.data.data[0] : null
  return { result: parseGlmUsage(subscription, quota.data, detected.title), rateLimited: false }
}

async function fetchMinimax(detected: DetectedProvider, apiKey: string): Promise<{ result: ProviderRateLimits | null; rateLimited: boolean }> {
  const usage = await getJson<unknown>(`${detected.origin}/v1/token_plan/remains`, apiKey)
  if (usage.status === 429) return { result: null, rateLimited: true }
  if (!usage.data) return { result: null, rateLimited: false }
  return { result: parseMinimaxUsage(usage.data, detected.region, detected.title), rateLimited: false }
}

export async function getProviderRateLimits(apiProviderId: string, force = false): Promise<ProviderRateLimits | null> {
  try {
    const provider = getProviderByIdRaw(apiProviderId)
    if (!provider?.api_key) return null

    const detected = detectProvider(resolveBaseUrl(provider.agent_configs))
    if (!detected) return null

    const nowMs = Date.now()
    const entry = cache.get(apiProviderId)
    if (entry && nowMs < entry.rateLimitedUntilMs) return entry.data
    if (!force && entry?.data && nowMs - entry.lastFetchMs < MIN_FETCH_INTERVAL_MS) return entry.data

    const fetcher = detected.brand === 'glm' ? fetchGlm : fetchMinimax
    const { result, rateLimited } = await fetcher(detected, provider.api_key)

    const next: CacheEntry = {
      data: result ? { ...result, fetchedAt: nowMs } : entry?.data ?? null,
      lastFetchMs: nowMs,
      rateLimitedUntilMs: rateLimited ? nowMs + RATE_LIMIT_BACKOFF_MS : 0,
    }
    cache.set(apiProviderId, next)
    return next.data
  } catch (e) {
    log.info('[provider-usage] getProviderRateLimits failed: %s', String(e))
    return cache.get(apiProviderId)?.data ?? null
  }
}
