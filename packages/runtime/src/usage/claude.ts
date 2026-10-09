/**
 * Claude subscription usage over the OAuth REST API, from the login the
 * Claude CLI keeps (macOS keychain, else `.credentials.json`). The SDK has no
 * usage query. Refreshing rotates the refresh token, so a refreshed login is
 * always written back where it came from — otherwise the CLI is signed out.
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import type { ClaudeRateLimits, ClaudeRateLimitWindow } from '@superone/shared/agent-types'
import { AsyncCoalescer } from '../async-coalescer'
import { fetchWithTimeout, isoToEpochSeconds, parseJson, retryAfterMs, silentLog, type UsageLog } from './http'
import { UsageThrottle, type UsageReading } from './throttle'

const KEYCHAIN_SERVICE = 'Claude Code-credentials'
const CRED_FILE_NAME = '.credentials.json'
const REFRESH_URL = 'https://platform.claude.com/v1/oauth/token'
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const SCOPES = 'user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload'
const REFRESH_BUFFER_MS = 5 * 60 * 1000
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const USAGE_USER_AGENT = 'claude-code/2.1.289'
const MIN_USAGE_FETCH_INTERVAL_MS = 5 * 60 * 1000

// ---------- credential store ----------

/** The Claude CLI's credential JSON: `claudeAiOauth`, `mcpOAuth`, and keys SuperOne does not read. */
export type ClaudeCredentialData = Record<string, unknown>

export interface ClaudeCredentialStore {
  source: 'keychain' | 'file'
  /** Keychain service and account the data came from; `null` for the file. */
  serviceName: string | null
  account: string | null
  data: ClaudeCredentialData
}

/**
 * The macOS keychain service names to try for a credential domain, mirroring how the CLI itself
 * builds the name: `CLAUDE_SECURESTORAGE_CONFIG_DIR` wins over `CLAUDE_CONFIG_DIR`, an empty (but
 * set) value means the default domain, and the suffix is the first 8 hex chars of the SHA-256 of
 * the NFC-normalized path.
 *
 * `credentialDir` names a specific domain. In that case the bare service is **not** offered as a
 * fallback: falling back would read a different account's credentials and silently report its
 * usage under the wrong identity.
 */
export function keychainServiceNames(credentialDir: string | null, env: NodeJS.ProcessEnv = process.env): string[] {
  const secure = credentialDir ?? env.CLAUDE_SECURESTORAGE_CONFIG_DIR
  const useDefaultDomain = secure !== undefined ? !secure : !env.CLAUDE_CONFIG_DIR
  if (useDefaultDomain) return [KEYCHAIN_SERVICE]

  const path = secure || env.CLAUDE_CONFIG_DIR || ''
  const hash = createHash('sha256').update(path.normalize('NFC')).digest('hex').slice(0, 8)
  const hashed = `${KEYCHAIN_SERVICE}-${hash}`
  return credentialDir ? [hashed] : [hashed, KEYCHAIN_SERVICE]
}

function configDir(): string {
  return process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude')
}

/** `.credentials.json` for one domain. The CLI keeps it inside the securestorage dir. */
export function claudeCredentialsPath(credentialDir: string | null): string {
  return join(credentialDir ?? configDir(), CRED_FILE_NAME)
}

function credentialObject(text: string): ClaudeCredentialData | null {
  const value = parseJson(text)
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ClaudeCredentialData : null
}

/** `security -w` hex-encodes values containing newlines. */
function parseCredentialJson(text: string | null): ClaudeCredentialData | null {
  if (!text) return null
  const direct = credentialObject(text)
  if (direct) return direct
  let hex = text.trim()
  if (hex.startsWith('0x') || hex.startsWith('0X')) hex = hex.slice(2)
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null
  return credentialObject(Buffer.from(hex, 'hex').toString('utf8'))
}

function readKeychain(service: string, account: string): string | null {
  if (process.platform !== 'darwin') return null
  for (const args of [
    ['find-generic-password', '-s', service, '-a', account, '-w'],
    ['find-generic-password', '-s', service, '-w'],
  ]) {
    try {
      const value = execFileSync('security', args, { encoding: 'utf8' }).trim()
      if (value) return value
    } catch {
      // item missing for these args; try next candidate
    }
  }
  return null
}

/**
 * The first store of a credential domain whose data `accept` takes, in the
 * CLI's own order: keychain services, then `.credentials.json`.
 */
export function findClaudeCredentialStore(credentialDir: string | null, accept: (data: ClaudeCredentialData) => boolean, log: UsageLog = silentLog): ClaudeCredentialStore | null {
  const account = userInfo().username
  for (const service of keychainServiceNames(credentialDir)) {
    const data = parseCredentialJson(readKeychain(service, account))
    if (data && accept(data)) return { source: 'keychain', serviceName: service, account, data }
  }
  const file = claudeCredentialsPath(credentialDir)
  if (!existsSync(file)) return null
  try {
    const data = parseCredentialJson(readFileSync(file, 'utf8'))
    if (data && accept(data)) return { source: 'file', serviceName: null, account: null, data }
  } catch (e) {
    log.warn('[claude-credentials] credentials file read failed: %s', String(e))
  }
  return null
}

// ---------- OAuth ----------

export interface OAuthCreds {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  scopes?: string[]
  subscriptionType?: string
  rateLimitTier?: string
}

interface CredentialFile {
  claudeAiOauth?: OAuthCreds
  [key: string]: unknown
}

export interface LoadedClaudeCreds {
  /** Domain these came from; `null` is the CLI's own default login. */
  credentialDir: string | null
  oauth: OAuthCreds
  source: 'keychain' | 'file'
  serviceName: string | null
  account: string | null
  fullData: CredentialFile
  inferenceOnly?: boolean
}

export function loadClaudeCredentials(credentialDir: string | null, log: UsageLog = silentLog): LoadedClaudeCreds | null {
  const found = findClaudeCredentialStore(credentialDir, (data) => !!(data as CredentialFile).claudeAiOauth?.accessToken, log)
  const stored: LoadedClaudeCreds | null = found && {
    credentialDir, oauth: (found.data as CredentialFile).claudeAiOauth!, source: found.source,
    serviceName: found.serviceName, account: found.account, fullData: found.data as CredentialFile,
  }
  // CLAUDE_CODE_OAUTH_TOKEN describes the ambient environment, not a specific account. Letting it
  // stand in for a named domain would report the env token's usage under that account's identity.
  const envToken = credentialDir ? undefined : process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()
  if (!envToken) return stored
  return {
    credentialDir,
    oauth: { ...(stored?.oauth ?? { accessToken: '' }), accessToken: envToken },
    source: stored?.source ?? 'file',
    serviceName: stored?.serviceName ?? null,
    account: stored?.account ?? null,
    fullData: stored?.fullData ?? {},
    inferenceOnly: true,
  }
}

export function hasProfileScope(creds: LoadedClaudeCreds): boolean {
  if (creds.inferenceOnly) return false
  const scopes = creds.oauth.scopes
  if (Array.isArray(scopes) && scopes.length > 0) return scopes.includes('user:profile')
  return true
}

function saveCredentials(creds: LoadedClaudeCreds, log: UsageLog): void {
  // Minified JSON is required: macOS `security -w` hex-encodes values containing
  // newlines, which Claude Code cannot read back (it then invalidates the session).
  const text = JSON.stringify(creds.fullData)
  if (creds.source === 'file') {
    try {
      writeFileSync(claudeCredentialsPath(creds.credentialDir), text, { mode: 0o600 })
    } catch (e) {
      log.warn('[claude-usage] write credentials file failed: %s', String(e))
    }
    return
  }
  if (process.platform !== 'darwin' || !creds.serviceName || !creds.account) return
  try {
    execFileSync('security', ['add-generic-password', '-U', '-s', creds.serviceName, '-a', creds.account, '-w', text])
  } catch (e) {
    log.warn('[claude-usage] write credentials keychain failed: %s', String(e))
  }
}

export function needsRefresh(oauth: OAuthCreds, nowMs: number): boolean {
  return typeof oauth.expiresAt === 'number' && oauth.expiresAt - nowMs < REFRESH_BUFFER_MS
}

async function performRefresh(creds: LoadedClaudeCreds, log: UsageLog): Promise<boolean> {
  const { oauth } = creds
  if (!oauth.refreshToken) {
    log.warn('[claude-usage] refresh skipped: no refresh token')
    return false
  }
  try {
    const resp = await fetchWithTimeout(REFRESH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: oauth.refreshToken, client_id: CLIENT_ID, scope: SCOPES }),
    }, 15000)
    if (!resp.ok) {
      log.warn('[claude-usage] refresh returned status=%d', resp.status)
      return false
    }
    const body = parseJson(await resp.text()) as { access_token?: string; refresh_token?: string; expires_in?: number } | null
    if (!body?.access_token) {
      log.warn('[claude-usage] refresh response missing access_token')
      return false
    }
    oauth.accessToken = body.access_token
    if (body.refresh_token) oauth.refreshToken = body.refresh_token
    if (typeof body.expires_in === 'number') oauth.expiresAt = Date.now() + body.expires_in * 1000
    creds.fullData.claudeAiOauth = oauth
    saveCredentials(creds, log)
    log.info('[claude-usage] token refreshed')
    return true
  } catch (e) {
    log.warn('[claude-usage] refresh exception: %s', String(e))
    return false
  }
}

const refreshes = new AsyncCoalescer<LoadedClaudeCreds | null>()

/** Refresh once per (domain, refresh token) even when several readers race; returns the new access token. */
export async function refreshClaudeToken(creds: LoadedClaudeCreds, log: UsageLog = silentLog): Promise<string | null> {
  const fingerprint = createHash('sha256').update(creds.oauth.refreshToken ?? '').digest('hex')
  const result = await refreshes.get(`${creds.credentialDir ?? '__cli__'}:${fingerprint}`, async () => await performRefresh(creds, log) ? creds : null)
  if (!result) return null
  Object.assign(creds.oauth, result.oauth)
  creds.fullData.claudeAiOauth = creds.oauth
  return creds.oauth.accessToken
}

// ---------- usage ----------

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
  scope?: { model?: { display_name?: string; id?: string | null } | null; surface?: unknown } | null
}

export interface ClaudeUsageResponse {
  five_hour?: UsageWindow | null
  seven_day?: UsageWindow | null
  seven_day_opus?: UsageWindow | null
  seven_day_sonnet?: UsageWindow | null
  seven_day_omelette?: UsageWindow | null
  limits?: UsageLimitEntry[] | null
  extra_usage?: { is_enabled?: boolean; used_credits?: number; monthly_limit?: number }
}

/** Top-level windows emitted before the model-scoped ones from `limits`. */
const LEADING_WINDOW_LABELS: Array<[keyof ClaudeUsageResponse, string]> = [
  ['five_hour', '5h'],
  ['seven_day', 'Weekly'],
]

/** Legacy per-model windows, superseded by a scoped row of the same label when both are present. */
const LEGACY_MODEL_WINDOW_LABELS: Array<[keyof ClaudeUsageResponse, string]> = [
  ['seven_day_opus', 'Opus weekly'],
  ['seven_day_sonnet', 'Sonnet weekly'],
  ['seven_day_omelette', 'Claude Design'],
]

function toWindow(data: ClaudeUsageResponse, key: keyof ClaudeUsageResponse, label: string): ClaudeRateLimitWindow | null {
  const win = data[key] as UsageWindow | null | undefined
  if (!win || typeof win.utilization !== 'number') return null
  const model = key === 'seven_day_opus' ? 'opus' : key === 'seven_day_sonnet' ? 'sonnet' : key === 'seven_day_omelette' ? 'design' : null
  return { id: key, ...(model ? { model } : {}), label, usedPercent: win.utilization, resetsAt: isoToEpochSeconds(win.resets_at) }
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
    const legacy = LEGACY_MODEL_WINDOW_LABELS.find(([, legacyLabel]) => legacyLabel === label)
    windows.push({ model: modelName.toLowerCase(), id: legacy?.[0] ?? `weekly_scoped:${entry.scope?.model?.id ?? modelName}`, label, usedPercent: entry.percent, resetsAt: isoToEpochSeconds(entry.resets_at) })
  }
  return windows
}

export function parseClaudeUsage(data: ClaudeUsageResponse, planType: string | null): ClaudeRateLimits {
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

export function claudePlanType(oauth: OAuthCreds): string | null {
  const sub = oauth.subscriptionType
  if (!sub) return null
  const base = sub.charAt(0).toUpperCase() + sub.slice(1)
  const tierMatch = String(oauth.rateLimitTier ?? '').match(/(\d+)x/)
  return tierMatch ? `${base} ${tierMatch[1]}x` : base
}

function fetchUsage(accessToken: string): Promise<Response> {
  return fetchWithTimeout(USAGE_URL, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken.trim()}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'anthropic-beta': 'oauth-2025-04-20',
      'User-Agent': USAGE_USER_AGENT,
    },
  }, 10000)
}

/** Fingerprint of a domain's current login; it changes when the CLI signs in as someone else. */
export function claudeCredentialFingerprint(creds: LoadedClaudeCreds): string {
  return createHash('sha256').update(creds.oauth.refreshToken ?? creds.oauth.accessToken).digest('hex')
}

const throttle = new UsageThrottle<ClaudeRateLimits>(MIN_USAGE_FETCH_INTERVAL_MS)

/**
 * The subscription windows of one credential domain (`null` = the CLI's default login),
 * at most one upstream read per five minutes. A domain without an OAuth login that can
 * read the profile (API key, inference-only token) reads `{ value: null }` with no error.
 */
export async function readClaudeRateLimits(credentialDir: string | null, opts: { force?: boolean; log?: UsageLog } = {}): Promise<UsageReading<ClaudeRateLimits>> {
  const log = opts.log ?? silentLog
  const creds = loadClaudeCredentials(credentialDir, log)
  if (!creds?.oauth.accessToken?.trim() || !hasProfileScope(creds)) return { value: null }
  return throttle.read(credentialDir ?? '', claudeCredentialFingerprint(creds), opts.force === true, async () => {
    let accessToken = creds.oauth.accessToken
    if (needsRefresh(creds.oauth, Date.now())) accessToken = await refreshClaudeToken(creds, log) ?? accessToken
    let resp = await fetchUsage(accessToken)
    if (resp.status === 401 || resp.status === 403) {
      const refreshed = await refreshClaudeToken(creds, log)
      if (!refreshed) return { error: 'Claude login expired. Sign in to Claude again.' }
      resp = await fetchUsage(refreshed)
    }
    if (resp.status === 429) {
      log.warn('[claude-usage] rate limited (429)')
      return { fingerprint: claudeCredentialFingerprint(creds), rateLimitedForMs: retryAfterMs(resp) ?? 0 }
    }
    const fingerprint = claudeCredentialFingerprint(creds)
    if (!resp.ok) return { fingerprint, error: `Claude usage request failed (HTTP ${resp.status}).` }
    const data = parseJson(await resp.text()) as ClaudeUsageResponse | null
    if (!data) return { fingerprint, error: 'Claude usage response changed.' }
    return { fingerprint, value: { ...parseClaudeUsage(data, claudePlanType(creds.oauth)), fetchedAt: Date.now() } }
  })
}
