/**
 * OpenCode Go usage: the rolling, weekly and monthly windows of the Go
 * subscription, from `GET opencode.ai/zen/go/v1/usage` with the `opencode-go`
 * API key OpenCode already stores. OpenCode 2 keeps that key in each release
 * channel's database (`opencode*.db`, `credential` table); OpenCode 1 kept it in
 * `auth.json`, which OpenCode 2 leaves behind on upgrade — so once a database has
 * the table, the file is stale and a logout there must not be revived from it.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ClaudeRateLimits, ClaudeRateLimitWindow } from '@superone/shared/agent-types'
import { asRecord, fetchWithTimeout, isoToEpochSeconds, parseJson, retryAfterMs } from './http'
import { hasTable, withDatabase, type OpenReadOnlyDatabase } from './sqlite-reader'
import { UsageThrottle, type UsageReading } from './throttle'

const USAGE_URL = 'https://opencode.ai/zen/go/v1/usage'
const MIN_FETCH_INTERVAL_MS = 60 * 1000

export function openCodeDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.OPENCODE_DATA_DIR?.trim()
  if (override) return override
  const xdg = env.XDG_DATA_HOME?.trim()
  return join(xdg || join(homedir(), '.local', 'share'), 'opencode')
}

/** The `opencode-go` key, or null when OpenCode is not signed in to Go. */
export function readOpenCodeGoKey(dataDir: string, open: OpenReadOnlyDatabase): string | null {
  if (!existsSync(dataDir)) return null
  // Stable channel first, then the others in name order.
  const databases = readdirSync(dataDir).filter((name) => name.startsWith('opencode') && name.endsWith('.db')).sort((a, b) => (a === 'opencode.db' ? -1 : b === 'opencode.db' ? 1 : a.localeCompare(b)))
  let anyCredentialTable = false
  for (const name of databases) {
    const key = withDatabase(open, join(dataDir, name), (db) => {
      if (!hasTable(db, 'credential')) return null
      anyCredentialTable = true
      const row = db.prepare("SELECT json_extract(value, '$.key') AS key FROM credential WHERE integration_id = 'opencode-go' AND (active IS NULL OR active = 1) LIMIT 1").get() as { key?: unknown } | undefined
      return typeof row?.key === 'string' && row.key.trim() ? row.key.trim() : null
    })
    if (key) return key
  }
  if (anyCredentialTable) return null
  const file = join(dataDir, 'auth.json')
  if (!existsSync(file)) return null
  const key = asRecord(asRecord(parseJson(readFileSync(file, 'utf8')))?.['opencode-go'])?.key
  return typeof key === 'string' && key.trim() ? key.trim() : null
}

const WINDOWS: Array<[string, string]> = [['rolling', '5h'], ['weekly', 'Weekly'], ['monthly', 'Monthly']]

export function parseOpenCodeGoUsage(body: unknown): ClaudeRateLimits | null {
  const usage = asRecord(asRecord(body)?.usage)
  if (!usage) return null
  const windows: ClaudeRateLimitWindow[] = []
  for (const [key, label] of WINDOWS) {
    const value = asRecord(usage[key])
    if (typeof value?.percent !== 'number') continue
    windows.push({ label, usedPercent: value.percent, resetsAt: isoToEpochSeconds(value.resetsAt) })
  }
  return { windows, extraUsage: null, planType: 'Go' }
}

const throttle = new UsageThrottle<ClaudeRateLimits>(MIN_FETCH_INTERVAL_MS, 5 * 60 * 1000)

/** Go windows for this machine's OpenCode login; `{ value: null }` without a Go key or subscription. */
export async function readOpenCodeGoRateLimits(open: OpenReadOnlyDatabase, opts: { dataDir?: string; force?: boolean } = {}): Promise<UsageReading<ClaudeRateLimits>> {
  const dataDir = opts.dataDir ?? openCodeDataDir()
  const key = readOpenCodeGoKey(dataDir, open)
  if (!key) return { value: null }
  return throttle.read(dataDir, key, opts.force === true, async () => {
    const resp = await fetchWithTimeout(USAGE_URL, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } }, 10000)
    if (resp.status === 401) return { error: 'OpenCode rejected its Go key. Sign in to OpenCode Go again.' }
    // EntitlementError: a Zen-only account with no Go subscription.
    if (resp.status === 403) return { error: 'This OpenCode login has no Go subscription.' }
    if (resp.status === 429) return { rateLimitedForMs: retryAfterMs(resp) ?? 0 }
    if (!resp.ok) return { error: `OpenCode usage request failed (HTTP ${resp.status}).` }
    const limits = parseOpenCodeGoUsage(parseJson(await resp.text()))
    return limits ? { value: { ...limits, fetchedAt: Date.now() } } : { error: 'OpenCode usage response changed.' }
  })
}
