import log from '../logger'
import { claudeAccountStore } from './claude-account-store'
import type { ClaudeRateLimits } from '@superone/shared/agent-types'
import { parseUsage, type UsageResponse } from './claude-usage-parse'
import { loadCredentials, hasProfileScope, needsRefresh, fetchWithTimeout, refreshToken, tryParseJson, type OAuthCreds } from './claude-oauth'
import { createHash, randomUUID } from 'node:crypto'
import { SubscriptionUsageTracker } from '@superone/shared/subscription-usage'
import { AsyncCoalescer } from '../async-cache'

const BASE_API_URL = 'https://api.anthropic.com'
const USAGE_URL = `${BASE_API_URL}/api/oauth/usage`
const USAGE_USER_AGENT = 'claude-code/2.1.289'
const MIN_USAGE_FETCH_INTERVAL_MS = 5 * 60 * 1000
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 5 * 60 * 1000

/**
 * Throttle + backoff + last-good usage, kept **per credential domain**. These used to be three
 * module-level globals, which is correct only while there is exactly one account: with several,
 * one account's 429 backoff would suppress every other account's meters, and the 5-minute
 * throttle would hand account B the cached numbers belonging to account A.
 */
interface DomainUsageState {
  rateLimitedUntilMs: number
  lastUsageFetchMs: number
  cached: ClaudeRateLimits | null
  credentialFingerprint?: string
  quotaKey?: string
}

const domainUsage = new Map<string, DomainUsageState>()
const usageHistory = new SubscriptionUsageTracker()
const usageRequests = new AsyncCoalescer<ClaudeRateLimits | null>()

function usageStateFor(credentialDir: string | null): DomainUsageState {
  const key = credentialDir ?? ''
  let state = domainUsage.get(key)
  if (!state) {
    state = { rateLimitedUntilMs: 0, lastUsageFetchMs: 0, cached: null }
    domainUsage.set(key, state)
  }
  return state
}

function fetchUsage(accessToken: string): Promise<Response> {
  return fetchWithTimeout(
    USAGE_URL,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken.trim()}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': USAGE_USER_AGENT,
      },
    },
    10000,
  )
}

function parseRetryAfterSeconds(resp: Response): number | null {
  const raw = resp.headers.get('retry-after')
  if (!raw) return null
  const str = raw.trim()
  const seconds = parseInt(str, 10)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds
  const dateMs = Date.parse(str)
  if (Number.isFinite(dateMs)) {
    const delay = Math.ceil((dateMs - Date.now()) / 1000)
    return delay > 0 ? delay : 0
  }
  return null
}

function buildPlanType(oauth: OAuthCreds): string | null {
  const sub = oauth.subscriptionType
  if (!sub) return null
  const base = sub.charAt(0).toUpperCase() + sub.slice(1)
  const tierMatch = String(oauth.rateLimitTier ?? '').match(/(\d+)x/)
  return tierMatch ? `${base} ${tierMatch[1]}x` : base
}

export function getClaudeRateLimits(force = false, credentialDir: string | null = null): Promise<ClaudeRateLimits | null> {
  return usageRequests.get(credentialDir ?? '', () => fetchClaudeRateLimits(force, credentialDir))
}

async function fetchClaudeRateLimits(force: boolean, credentialDir: string | null): Promise<ClaudeRateLimits | null> {
  const state = usageStateFor(credentialDir)
  try {
    let creds = loadCredentials(credentialDir)
    if (!creds?.oauth.accessToken?.trim() || !hasProfileScope(creds)) return null

    const fingerprint = createHash('sha256').update(creds.oauth.accessToken).digest('hex')
    if (state.credentialFingerprint !== fingerprint) {
      // A CLI login may replace the default domain underneath us. Never serve the previous account's cache.
      state.cached = null
      state.rateLimitedUntilMs = 0
      const { readAccount } = await import('./claude-account-service')
      const account = await readAccount(credentialDir)
      if (credentialDir && (!account.loggedIn || (!account.identityKey && claudeAccountStore().get(credentialDir)?.ownerIdentity))) return null
      creds = loadCredentials(credentialDir) ?? creds
      state.quotaKey = `claude:${account?.identityKey
        ? createHash('sha256').update(JSON.stringify([account.identityKey, buildPlanType(creds.oauth)])).digest('hex')
        : randomUUID()}`
      state.credentialFingerprint = fingerprint
    }

    const nowMs = Date.now()
    if (nowMs < state.rateLimitedUntilMs) return state.cached

    const wasRateLimited = state.rateLimitedUntilMs > 0
    state.rateLimitedUntilMs = 0
    if (!force && !wasRateLimited && state.cached && nowMs - state.lastUsageFetchMs < MIN_USAGE_FETCH_INTERVAL_MS) {
      return state.cached
    }

    let accessToken = creds.oauth.accessToken
    if (needsRefresh(creds.oauth, nowMs)) {
      const refreshed = await refreshToken(creds)
      if (refreshed) accessToken = refreshed
    }
    state.credentialFingerprint = createHash('sha256').update(accessToken).digest('hex')

    state.lastUsageFetchMs = nowMs
    let resp = await fetchUsage(accessToken)
    if (resp.status === 401 || resp.status === 403) {
      const refreshed = await refreshToken(creds)
      if (refreshed) {
        accessToken = refreshed
        state.credentialFingerprint = createHash('sha256').update(accessToken).digest('hex')
        resp = await fetchUsage(accessToken)
      }
    }

    if (resp.status === 429) {
      const retry = parseRetryAfterSeconds(resp)
      state.rateLimitedUntilMs = nowMs + (retry !== null ? retry * 1000 : DEFAULT_RATE_LIMIT_BACKOFF_MS)
      log.warn('[claude-usage] rate limited (429)')
      return state.cached
    }
    if (!resp.ok) {
      log.info('[claude-usage] usage request failed status=%d', resp.status)
      return state.cached
    }

    const data = tryParseJson<UsageResponse>(await resp.text())
    if (!data) return state.cached
    const fetchedAt = Date.now()
    const limits = parseUsage(data, buildPlanType(creds.oauth))
    state.cached = { ...limits, quotaKey: state.quotaKey, fetchedAt,
      windows: limits.windows.map((window) => usageHistory.observe(state.quotaKey!, { ...window,
        windowDurationMins: window.id === 'five_hour' ? 300
          : window.id?.startsWith('seven_day') || window.id?.startsWith('weekly_scoped:') ? 7 * 24 * 60 : null,
      }, fetchedAt)) }
    return state.cached
  } catch (e) {
    log.info('[claude-usage] getClaudeRateLimits failed: %s', String(e))
    return state.cached
  }
}
