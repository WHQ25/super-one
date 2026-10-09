/**
 * Codex (ChatGPT plan) usage from the Codex CLI's own login: `$CODEX_HOME/auth.json`
 * (`~/.codex`), or the macOS keychain item Codex uses when it keeps the login there.
 * `GET chatgpt.com/backend-api/wham/usage` is what Codex itself reads.
 *
 * Read-only on purpose: Codex refreshes and rotates its own tokens while it runs,
 * and a second refresher racing it would sign the CLI out. An expired login reads
 * as an error asking the user to run Codex again.
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ClaudeRateLimits, ClaudeRateLimitWindow } from '@superone/shared/agent-types'
import { asRecord, fetchWithTimeout, parseJson, retryAfterMs } from './http'
import { UsageThrottle, type UsageReading } from './throttle'

const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const KEYCHAIN_SERVICE = 'Codex Auth'
const MIN_FETCH_INTERVAL_MS = 60 * 1000

export function codexHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.CODEX_HOME?.trim() || join(homedir(), '.codex')
}

interface CodexLogin {
  accessToken: string
  accountId: string | null
}

function loginFrom(text: string | null): CodexLogin | null {
  let value = parseJson(text)
  // `security -w` hex-encodes values containing newlines.
  if (!value && text && /^[0-9a-fA-F]+$/.test(text.trim())) value = parseJson(Buffer.from(text.trim(), 'hex').toString('utf8'))
  const tokens = asRecord(asRecord(value)?.tokens)
  const accessToken = typeof tokens?.access_token === 'string' ? tokens.access_token.trim() : ''
  if (!accessToken) return null
  return { accessToken, accountId: typeof tokens?.account_id === 'string' && tokens.account_id ? tokens.account_id : null }
}

/** Codex names the keychain account after the canonical home: `cli|<first 8 bytes of its SHA-256>`. */
export function codexKeychainAccount(home: string): string {
  let canonical = home
  try {
    canonical = realpathSync(home)
  } catch {
    // a home that does not exist yet keeps its literal path
  }
  return `cli|${createHash('sha256').update(canonical).digest('hex').slice(0, 16)}`
}

function readLogin(home: string): CodexLogin | null {
  const file = join(home, 'auth.json')
  if (existsSync(file)) {
    const login = loginFrom(readFileSync(file, 'utf8'))
    if (login) return login
  }
  if (process.platform !== 'darwin') return null
  try {
    return loginFrom(execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', codexKeychainAccount(home), '-w'], { encoding: 'utf8' }).trim())
  } catch {
    return null
  }
}

/** Codex names a window by its length only. */
export function codexWindowLabel(minutes: number | null): string {
  if (!minutes || minutes <= 0) return 'Usage'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`
  return `${Math.round(minutes / 1440)}d`
}

function window(raw: unknown, nowSeconds: number): ClaudeRateLimitWindow | null {
  const value = asRecord(raw)
  const usedPercent = value?.used_percent
  if (typeof usedPercent !== 'number') return null
  const seconds = typeof value!.limit_window_seconds === 'number' ? value!.limit_window_seconds : null
  const resetsAt = typeof value!.reset_at === 'number' ? Math.floor(value!.reset_at)
    : typeof value!.reset_after_seconds === 'number' ? Math.floor(nowSeconds + value!.reset_after_seconds)
      : null
  return { label: codexWindowLabel(seconds ? Math.round(seconds / 60) : null), usedPercent, resetsAt }
}

const PLAN_NAMES: Record<string, string> = {
  prolite: 'Pro 100',
  pro: 'Pro 200',
  promax: 'Pro 500',
  self_serve_business_prolite: 'Business Premium',
}

/** ChatGPT plan ids as the plan is sold; others title-cased from snake_case. */
export function codexPlanName(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const id = raw.trim().toLowerCase()
  return PLAN_NAMES[id] ?? id.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

export function parseCodexUsage(body: unknown, nowSeconds = Math.floor(Date.now() / 1000)): ClaudeRateLimits | null {
  const value = asRecord(body)
  const rateLimit = asRecord(value?.rate_limit)
  if (!value || !rateLimit) return null
  const windows = [rateLimit.primary_window, rateLimit.secondary_window]
    .map((raw) => window(raw, nowSeconds))
    .filter((w): w is ClaudeRateLimitWindow => w !== null)
  return { windows, extraUsage: null, planType: codexPlanName(value.plan_type) }
}

const throttle = new UsageThrottle<ClaudeRateLimits>(MIN_FETCH_INTERVAL_MS, 5 * 60 * 1000)

/** ChatGPT-plan windows for the Codex login in `home`; `{ value: null }` when Codex is signed out or on an API key. */
export async function readCodexRateLimits(opts: { home?: string; force?: boolean } = {}): Promise<UsageReading<ClaudeRateLimits>> {
  const home = opts.home ?? codexHome()
  const login = readLogin(home)
  if (!login) return { value: null }
  const fingerprint = createHash('sha256').update(login.accessToken).digest('hex')
  return throttle.read(home, fingerprint, opts.force === true, async () => {
    const resp = await fetchWithTimeout(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${login.accessToken}`,
        Accept: 'application/json',
        ...(login.accountId ? { 'ChatGPT-Account-Id': login.accountId } : {}),
      },
    }, 10000)
    if (resp.status === 401 || resp.status === 403) return { error: 'Codex login expired. Run Codex to refresh it.' }
    if (resp.status === 429) return { rateLimitedForMs: retryAfterMs(resp) ?? 0 }
    if (!resp.ok) return { error: `Codex usage request failed (HTTP ${resp.status}).` }
    const limits = parseCodexUsage(parseJson(await resp.text()))
    return limits ? { value: { ...limits, fetchedAt: Date.now() } } : { error: 'Codex usage response changed.' }
  })
}
