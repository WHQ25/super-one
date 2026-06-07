import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import log from '../logger'
import type { ClaudeRateLimits } from '@superone/shared/agent-types'
import { parseUsage, type UsageResponse } from './claude-usage-parse'

const BASE_API_URL = 'https://api.anthropic.com'
const USAGE_URL = `${BASE_API_URL}/api/oauth/usage`
const REFRESH_URL = 'https://platform.claude.com/v1/oauth/token'
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const SCOPES = 'user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload'
const KEYCHAIN_SERVICE = 'Claude Code-credentials'
const CRED_FILE_NAME = '.credentials.json'
const USAGE_USER_AGENT = 'claude-code/2.1.69'
const REFRESH_BUFFER_MS = 5 * 60 * 1000
const MIN_USAGE_FETCH_INTERVAL_MS = 5 * 60 * 1000
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 5 * 60 * 1000

interface OAuthCreds {
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

interface LoadedCreds {
  oauth: OAuthCreds
  source: 'keychain' | 'file'
  serviceName: string | null
  account: string | null
  fullData: CredentialFile
  inferenceOnly?: boolean
}

let rateLimitedUntilMs = 0
let lastUsageFetchMs = 0
let cachedRateLimits: ClaudeRateLimits | null = null

function configDir(): string {
  return process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude')
}

function credentialsPath(): string {
  return join(configDir(), CRED_FILE_NAME)
}

function tryParseJson<T>(text: string | null | undefined): T | null {
  if (!text) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

function tryParseCredentialJSON(text: string | null): CredentialFile | null {
  if (!text) return null
  const direct = tryParseJson<CredentialFile>(text)
  if (direct) return direct
  let hex = text.trim()
  if (hex.startsWith('0x') || hex.startsWith('0X')) hex = hex.slice(2)
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null
  return tryParseJson<CredentialFile>(Buffer.from(hex, 'hex').toString('utf8'))
}

function keychainServiceCandidates(): string[] {
  const explicit = process.env.CLAUDE_CONFIG_DIR?.trim()
  if (!explicit) return [KEYCHAIN_SERVICE]
  const hash = createHash('sha256').update(explicit.normalize('NFC')).digest('hex').slice(0, 8)
  return [`${KEYCHAIN_SERVICE}-${hash}`, KEYCHAIN_SERVICE]
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

function loadKeychainCredentials(account: string): LoadedCreds | null {
  for (const service of keychainServiceCandidates()) {
    const parsed = tryParseCredentialJSON(readKeychain(service, account))
    const oauth = parsed?.claudeAiOauth
    if (parsed && oauth?.accessToken) {
      return { oauth, source: 'keychain', serviceName: service, account, fullData: parsed }
    }
  }
  return null
}

function loadFileCredentials(): LoadedCreds | null {
  const file = credentialsPath()
  if (!existsSync(file)) return null
  try {
    const parsed = tryParseCredentialJSON(readFileSync(file, 'utf8'))
    const oauth = parsed?.claudeAiOauth
    if (parsed && oauth?.accessToken) {
      return { oauth, source: 'file', serviceName: null, account: null, fullData: parsed }
    }
  } catch (e) {
    log.warn('[claude-usage] credentials file read failed: %s', String(e))
  }
  return null
}

function loadCredentials(): LoadedCreds | null {
  const account = userInfo().username
  const stored = loadKeychainCredentials(account) ?? loadFileCredentials()
  const envToken = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()
  if (!envToken) return stored
  return {
    oauth: { ...(stored?.oauth ?? { accessToken: '' }), accessToken: envToken },
    source: stored?.source ?? 'file',
    serviceName: stored?.serviceName ?? null,
    account: stored?.account ?? null,
    fullData: stored?.fullData ?? {},
    inferenceOnly: true,
  }
}

function hasProfileScope(creds: LoadedCreds): boolean {
  if (creds.inferenceOnly) return false
  const scopes = creds.oauth.scopes
  if (Array.isArray(scopes) && scopes.length > 0) return scopes.includes('user:profile')
  return true
}

function saveCredentials(creds: LoadedCreds): void {
  // Minified JSON is required: macOS `security -w` hex-encodes values containing
  // newlines, which Claude Code cannot read back (it then invalidates the session).
  const text = JSON.stringify(creds.fullData)
  if (creds.source === 'file') {
    try {
      writeFileSync(credentialsPath(), text, { mode: 0o600 })
    } catch (e) {
      log.error('[claude-usage] write credentials file failed: %s', String(e))
    }
    return
  }
  if (process.platform !== 'darwin' || !creds.serviceName || !creds.account) return
  try {
    execFileSync('security', ['add-generic-password', '-U', '-s', creds.serviceName, '-a', creds.account, '-w', text])
  } catch (e) {
    log.error('[claude-usage] write credentials keychain failed: %s', String(e))
  }
}

function needsRefresh(oauth: OAuthCreds, nowMs: number): boolean {
  return typeof oauth.expiresAt === 'number' && oauth.expiresAt - nowMs < REFRESH_BUFFER_MS
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function refreshToken(creds: LoadedCreds): Promise<string | null> {
  const { oauth } = creds
  if (!oauth.refreshToken) {
    log.warn('[claude-usage] refresh skipped: no refresh token')
    return null
  }
  try {
    const resp = await fetchWithTimeout(
      REFRESH_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: oauth.refreshToken,
          client_id: CLIENT_ID,
          scope: SCOPES,
        }),
      },
      15000,
    )
    if (!resp.ok) {
      log.warn('[claude-usage] refresh returned status=%d', resp.status)
      return null
    }
    const body = tryParseJson<{ access_token?: string; refresh_token?: string; expires_in?: number }>(await resp.text())
    if (!body?.access_token) {
      log.warn('[claude-usage] refresh response missing access_token')
      return null
    }
    oauth.accessToken = body.access_token
    if (body.refresh_token) oauth.refreshToken = body.refresh_token
    if (typeof body.expires_in === 'number') oauth.expiresAt = Date.now() + body.expires_in * 1000
    creds.fullData.claudeAiOauth = oauth
    saveCredentials(creds)
    log.info('[claude-usage] token refreshed')
    return body.access_token
  } catch (e) {
    log.error('[claude-usage] refresh exception: %s', String(e))
    return null
  }
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

export async function getClaudeRateLimits(): Promise<ClaudeRateLimits | null> {
  try {
    const creds = loadCredentials()
    if (!creds?.oauth.accessToken?.trim() || !hasProfileScope(creds)) return null

    const nowMs = Date.now()
    if (nowMs < rateLimitedUntilMs) return cachedRateLimits

    const wasRateLimited = rateLimitedUntilMs > 0
    rateLimitedUntilMs = 0
    if (!wasRateLimited && cachedRateLimits && nowMs - lastUsageFetchMs < MIN_USAGE_FETCH_INTERVAL_MS) {
      return cachedRateLimits
    }

    let accessToken = creds.oauth.accessToken
    if (needsRefresh(creds.oauth, nowMs)) {
      const refreshed = await refreshToken(creds)
      if (refreshed) accessToken = refreshed
    }

    lastUsageFetchMs = nowMs
    let resp = await fetchUsage(accessToken)
    if (resp.status === 401 || resp.status === 403) {
      const refreshed = await refreshToken(creds)
      if (refreshed) {
        accessToken = refreshed
        resp = await fetchUsage(accessToken)
      }
    }

    if (resp.status === 429) {
      const retry = parseRetryAfterSeconds(resp)
      rateLimitedUntilMs = nowMs + (retry !== null ? retry * 1000 : DEFAULT_RATE_LIMIT_BACKOFF_MS)
      log.warn('[claude-usage] rate limited (429)')
      return cachedRateLimits
    }
    if (!resp.ok) {
      log.info('[claude-usage] usage request failed status=%d', resp.status)
      return cachedRateLimits
    }

    const data = tryParseJson<UsageResponse>(await resp.text())
    if (!data) return cachedRateLimits
    cachedRateLimits = parseUsage(data, buildPlanType(creds.oauth))
    return cachedRateLimits
  } catch (e) {
    log.info('[claude-usage] getClaudeRateLimits failed: %s', String(e))
    return cachedRateLimits
  }
}
