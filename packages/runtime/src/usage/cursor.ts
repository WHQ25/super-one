/**
 * Cursor plan usage for the current billing cycle, from the login the Cursor
 * app keeps in its state database (`cursorAuth/accessToken` in `state.vscdb`)
 * or the `cursor-access-token` keychain item `cursor-agent login` writes.
 * `DashboardService/GetCurrentPeriodUsage` is the dashboard's own call.
 *
 * macOS only: on other platforms where each of those logins lives is not
 * established, so a node there reports no Cursor row rather than guessing.
 * Read-only: Cursor refreshes its own token, and writing into a running app's
 * state database is not ours to do. An expired login reads as an error.
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ClaudeRateLimits, ClaudeRateLimitWindow } from '@superone/shared/agent-types'
import { asRecord, fetchWithTimeout, jwtExpiresAtMs, parseJson, retryAfterMs } from './http'
import { withDatabase, type OpenReadOnlyDatabase } from './sqlite-reader'
import { UsageThrottle, type UsageReading } from './throttle'

const USAGE_URL = 'https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage'
const MIN_FETCH_INTERVAL_MS = 60 * 1000

export function cursorStateDbPath(home = homedir()): string {
  return join(home, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb')
}

interface CursorLogin {
  accessToken: string
  membership: string | null
}

function stateValue(open: OpenReadOnlyDatabase, path: string, key: string): string | null {
  const row = withDatabase(open, path, (db) => db.prepare('SELECT value FROM ItemTable WHERE key = ? LIMIT 1').get(key)) as { value?: unknown } | undefined
  const value = typeof row?.value === 'string' ? row.value : row?.value instanceof Uint8Array ? Buffer.from(row.value).toString('utf8') : null
  return value?.trim() || null
}

function keychainToken(): string | null {
  try {
    return execFileSync('security', ['find-generic-password', '-s', 'cursor-access-token', '-w'], { encoding: 'utf8' }).trim() || null
  } catch {
    return null
  }
}

function readLogin(open: OpenReadOnlyDatabase, statePath: string): CursorLogin | null {
  if (process.platform !== 'darwin') return null
  const fromApp = existsSync(statePath) ? stateValue(open, statePath, 'cursorAuth/accessToken') : null
  const accessToken = fromApp ?? keychainToken()
  if (!accessToken) return null
  return { accessToken, membership: fromApp ? stateValue(open, statePath, 'cursorAuth/stripeMembershipType') : null }
}

/** Epoch milliseconds Cursor sends as a number or a numeric string. */
function epochMs(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

function num(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(n) ? n : null
}

export function parseCursorUsage(body: unknown, membership: string | null): ClaudeRateLimits | null {
  const usage = asRecord(body)
  const plan = asRecord(usage?.planUsage)
  if (!usage || !plan) return null
  const endMs = epochMs(usage.billingCycleEnd)
  const resetsAt = endMs ? Math.floor(endMs / 1000) : null
  const limit = num(plan.limit)
  const spent = num(plan.totalSpend) ?? (limit !== null && num(plan.remaining) !== null ? limit - num(plan.remaining)! : null)
  const total = num(plan.totalPercentUsed) ?? (limit && limit > 0 && spent !== null ? (spent / limit) * 100 : null)
  const windows: ClaudeRateLimitWindow[] = []
  if (total !== null) windows.push({ label: 'Total', usedPercent: total, resetsAt })
  const auto = num(plan.autoPercentUsed)
  if (auto !== null) windows.push({ label: 'Cursor models', usedPercent: auto, resetsAt })
  const api = num(plan.apiPercentUsed)
  if (api !== null) windows.push({ label: 'Other models', usedPercent: api, resetsAt })
  const planType = membership ? membership.charAt(0).toUpperCase() + membership.slice(1) : null
  return { windows, extraUsage: null, planType }
}

const throttle = new UsageThrottle<ClaudeRateLimits>(MIN_FETCH_INTERVAL_MS, 5 * 60 * 1000)

/** Cursor plan windows for this Mac's Cursor login; `{ value: null }` when signed out or off macOS. */
export async function readCursorRateLimits(open: OpenReadOnlyDatabase, opts: { statePath?: string; force?: boolean } = {}): Promise<UsageReading<ClaudeRateLimits>> {
  const statePath = opts.statePath ?? cursorStateDbPath()
  const login = readLogin(open, statePath)
  if (!login) return { value: null }
  const expiresAt = jwtExpiresAtMs(login.accessToken)
  if (expiresAt !== null && expiresAt <= Date.now()) return { value: null, error: 'Cursor login expired. Open Cursor or run `cursor-agent login`.' }
  const fingerprint = createHash('sha256').update(login.accessToken).digest('hex')
  return throttle.read(statePath, fingerprint, opts.force === true, async () => {
    const resp = await fetchWithTimeout(USAGE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${login.accessToken}`, 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1' },
      body: '{}',
    }, 10000)
    if (resp.status === 401 || resp.status === 403) return { error: 'Cursor login expired. Open Cursor or run `cursor-agent login`.' }
    if (resp.status === 429) return { rateLimitedForMs: retryAfterMs(resp) ?? 0 }
    if (!resp.ok) return { error: `Cursor usage request failed (HTTP ${resp.status}).` }
    const limits = parseCursorUsage(parseJson(await resp.text()), login.membership)
    return limits ? { value: { ...limits, fetchedAt: Date.now() } } : { error: 'Cursor usage response changed.' }
  })
}
