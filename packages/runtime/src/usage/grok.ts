/**
 * Grok Build credits, read the way the Grok CLI reads them: its login in
 * `~/.grok/auth.json` (or `$GROK_HOME`) and `GET /v1/billing?format=credits`
 * on the CLI proxy. That is the coding-credits pool (`GetGrokCreditsConfig`)
 * that runs out mid-session — distinct from the developer `api.x.ai` limits an
 * `XAI_API_KEY` would report — and the same config `grok agent stdio` answers
 * the `_x.ai/billing` ACP extension with, so one parser serves both.
 *
 * The config is camelCase, and every money value is a `Cent` wrapper (`{ val }`)
 * that proto3 flattens to `{}` when zero. Reads accept snake_case too so a wire
 * tweak degrades to a missing row, not a crash.
 *
 * Refreshing rotates the refresh token, so a refreshed login is written back
 * into the same entry of `auth.json`; the other entries are kept as they are.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ClaudeRateLimitWindow, ProviderRateLimits } from '@superone/shared/agent-types'
import { asRecord, fetchWithTimeout, jwtExpiresAtMs, parseJson, retryAfterMs, silentLog, type UsageLog } from './http'
import { UsageThrottle, type UsageReading } from './throttle'

const TITLE = 'Grok Build'

function pick(source: Record<string, unknown> | null, ...keys: string[]): unknown {
  if (!source) return undefined
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key]
  }
  return undefined
}

function num(source: Record<string, unknown> | null, ...keys: string[]): number | null {
  const value = pick(source, ...keys)
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function str(source: Record<string, unknown> | null, ...keys: string[]): string | null {
  const value = pick(source, ...keys)
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** A `Cent` wrapper in USD cents. `{}` is a real zero (proto3 omits it), absent is unknown. */
function cents(source: Record<string, unknown> | null, ...keys: string[]): number | null {
  const wrapper = asRecord(pick(source, ...keys))
  if (!wrapper) return null
  return num(wrapper, 'val') ?? 0
}

function epochSeconds(iso: string | null): number | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
}

/** Mirrors Grok's own `CreditBalance::usage_label`. */
function periodLabel(periodType: string | null): string {
  if (periodType?.includes('WEEKLY')) return 'Weekly limit'
  if (periodType?.includes('MONTHLY')) return 'Monthly limit'
  return 'Usage'
}

export function parseGrokBilling(raw: unknown): ProviderRateLimits | null {
  const envelope = asRecord(raw)
  if (!envelope) return null
  // The agent may answer bare or wrapped; the Grok TUI unwraps the same way.
  const body = asRecord(envelope.result) ?? envelope
  const config = asRecord(pick(body, 'config'))
  if (!config) return null

  const period = asRecord(pick(config, 'currentPeriod', 'current_period'))
  const periodEnd = str(period, 'end')
    ?? str(config, 'billingPeriodEnd', 'billing_period_end')

  const limitCents = cents(config, 'monthlyLimit', 'monthly_limit')
  const usedCents = cents(config, 'used')
  const usedPercent = num(config, 'creditUsagePercent', 'credit_usage_percent')
    ?? (limitCents && limitCents > 0 && usedCents != null
      ? (usedCents / limitCents) * 100
      : null)
    // proto3 / grok agent omit a 0% `creditUsagePercent` at the start of a new
    // period. If we still have a period, that is occupancy 0, not "no data".
    ?? (period || periodEnd ? 0 : null)
  // No occupancy signal at all — an empty gauge is worse than no gauge.
  if (usedPercent == null) return null

  const windows: ClaudeRateLimitWindow[] = [{
    label: periodLabel(str(period, 'type', 'period_type')),
    usedPercent: Math.max(0, Math.min(100, usedPercent)),
    resetsAt: epochSeconds(periodEnd),
  }]

  // On-demand overflow only exists once the user set a cap; `extraUsage` renders
  // it as the same "$used / $limit" row Claude uses for its extra-usage spend.
  const onDemandCap = cents(config, 'onDemandCap', 'on_demand_cap')
  const onDemandUsed = cents(config, 'onDemandUsed', 'on_demand_used')
  const extraUsage = onDemandCap && onDemandCap > 0
    ? { usedDollars: (onDemandUsed ?? 0) / 100, limitDollars: onDemandCap / 100 }
    : null

  const prepaid = cents(config, 'prepaidBalance', 'prepaid_balance')

  return {
    title: TITLE,
    planType: str(body, 'subscription_tier', 'subscriptionTier'),
    windows,
    extraUsage,
    ...(prepaid && prepaid > 0 ? { creditBalanceDollars: prepaid / 100 } : {}),
    fetchedAt: Date.now(),
  }
}

// ---------- login ----------

const BILLING_URL = 'https://cli-chat-proxy.grok.com/v1/billing?format=credits'
const SETTINGS_URL = 'https://cli-chat-proxy.grok.com/v1/settings'
const REFRESH_URL = 'https://auth.x.ai/oauth2/token'
const DEFAULT_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828'
const REFRESH_BUFFER_MS = 5 * 60 * 1000
const MIN_FETCH_INTERVAL_MS = 60 * 1000

interface GrokAuthEntry {
  key?: string
  refresh_token?: string
  refresh?: string
  id_token?: string
  expires_at?: string
  expires?: string
  oidc_client_id?: string
}

export function grokAuthPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.GROK_HOME?.trim() || join(homedir(), '.grok'), 'auth.json')
}

function trimmed(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readAuth(path: string): Record<string, GrokAuthEntry> | null {
  if (!existsSync(path)) return null
  const value = parseJson(readFileSync(path, 'utf8'))
  return asRecord(value) as Record<string, GrokAuthEntry> | null
}

/** The first entry holding a token; the Grok CLI keeps one per login under `<issuer>::<client>` keys. */
function signedInEntry(auth: Record<string, GrokAuthEntry>): [string, GrokAuthEntry] | null {
  return Object.entries(auth).find(([, entry]) => trimmed(entry?.key)) ?? null
}

function entryExpiresAtMs(entry: GrokAuthEntry): number | null {
  const raw = trimmed(entry.expires_at) ?? trimmed(entry.expires)
  const ms = raw ? Date.parse(raw) : NaN
  return Number.isFinite(ms) ? ms : null
}

function clientId(entryKey: string, entry: GrokAuthEntry): string {
  return trimmed(entry.oidc_client_id) ?? (entryKey.includes('::') ? trimmed(entryKey.split('::').pop()) : null) ?? DEFAULT_CLIENT_ID
}

async function refresh(path: string, entryKey: string, entry: GrokAuthEntry, log: UsageLog): Promise<string | null> {
  const refreshToken = trimmed(entry.refresh_token) ?? trimmed(entry.refresh)
  if (!refreshToken) return null
  const resp = await fetchWithTimeout(REFRESH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId(entryKey, entry), refresh_token: refreshToken }).toString(),
  }, 15000)
  if (!resp.ok) {
    log.warn('[grok-usage] refresh returned status=%d', resp.status)
    return null
  }
  const body = parseJson(await resp.text()) as { access_token?: string; refresh_token?: string; id_token?: string; expires_in?: number } | null
  if (!body?.access_token) return null
  // Re-read so a write by the Grok CLI since our read is not undone; refuse to rebuild a file we cannot parse.
  const current = readAuth(path)
  if (!current) return body.access_token
  const next: GrokAuthEntry = { ...current[entryKey], key: body.access_token }
  if (body.refresh_token) next.refresh_token = body.refresh_token
  if (body.id_token) next.id_token = body.id_token
  if (typeof body.expires_in === 'number') next.expires_at = new Date(Date.now() + body.expires_in * 1000).toISOString()
  try {
    writeFileSync(path, JSON.stringify({ ...current, [entryKey]: next }, null, 2), { mode: 0o600 })
  } catch (e) {
    log.warn('[grok-usage] write auth.json failed: %s', String(e))
  }
  return body.access_token
}

function headers(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'X-XAI-Token-Auth': 'xai-grok-cli', Accept: 'application/json' }
}

function needsRefresh(entry: GrokAuthEntry, token: string): boolean {
  const expiresAt = jwtExpiresAtMs(token) ?? entryExpiresAtMs(entry)
  return expiresAt !== null && expiresAt - Date.now() <= REFRESH_BUFFER_MS
}

const throttle = new UsageThrottle<ProviderRateLimits>(MIN_FETCH_INTERVAL_MS, 5 * 60 * 1000)

/** Grok Build credits for the Grok CLI login on this machine; `{ value: null }` when nobody is signed in. */
export async function readGrokRateLimits(opts: { force?: boolean; log?: UsageLog; env?: NodeJS.ProcessEnv } = {}): Promise<UsageReading<ProviderRateLimits>> {
  const log = opts.log ?? silentLog
  const path = grokAuthPath(opts.env)
  const auth = readAuth(path)
  const signedIn = auth && signedInEntry(auth)
  if (!signedIn) return { value: null }
  const [entryKey, entry] = signedIn
  return throttle.read(path, entryKey, opts.force === true, async () => {
    let token = trimmed(entry.key)!
    if (needsRefresh(entry, token)) token = await refresh(path, entryKey, entry, log) ?? token
    let resp = await fetchWithTimeout(BILLING_URL, { headers: headers(token) }, 10000)
    if (resp.status === 401 || resp.status === 403) {
      const refreshed = await refresh(path, entryKey, entry, log)
      if (!refreshed) return { error: 'Grok login expired. Run `grok login` again.' }
      token = refreshed
      resp = await fetchWithTimeout(BILLING_URL, { headers: headers(token) }, 10000)
    }
    if (resp.status === 429) return { rateLimitedForMs: retryAfterMs(resp) ?? 0 }
    // Team and business logins have no personal credits pool.
    if (resp.status === 412) return { error: 'Grok reports no personal credits pool for this login.' }
    if (!resp.ok) return { error: `Grok billing request failed (HTTP ${resp.status}).` }
    const settings = await fetchWithTimeout(SETTINGS_URL, { headers: headers(token) }, 10000)
      .then(async (r) => r.ok ? asRecord(parseJson(await r.text())) : null)
      .catch(() => null)
    const limits = parseGrokBilling({ ...asRecord(parseJson(await resp.text())), subscription_tier: settings?.subscription_tier_display ?? settings?.subscription_tier })
    return limits ? { value: limits } : { error: 'Grok billing response changed.' }
  })
}
