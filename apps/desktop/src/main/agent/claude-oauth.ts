import { createHash } from 'node:crypto'
import { AsyncCoalescer } from '../async-cache'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import log from '../logger'
import { claudeCredentialsPath, findClaudeCredentialStore } from './claude-credential-store'

const REFRESH_URL = 'https://platform.claude.com/v1/oauth/token'
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const SCOPES = 'user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload'
const REFRESH_BUFFER_MS = 5 * 60 * 1000
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

interface LoadedCreds {
  /** Domain these came from; `null` is the CLI's own default login. */
  credentialDir: string | null
  oauth: OAuthCreds
  source: 'keychain' | 'file'
  serviceName: string | null
  account: string | null
  fullData: CredentialFile
  inferenceOnly?: boolean
}

export function tryParseJson<T>(text: string | null | undefined): T | null {
  if (!text) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

export function loadCredentials(credentialDir: string | null): LoadedCreds | null {
  const found = findClaudeCredentialStore(credentialDir, (data) => !!(data as CredentialFile).claudeAiOauth?.accessToken)
  const stored: LoadedCreds | null = found && {
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

export function hasProfileScope(creds: LoadedCreds): boolean {
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
      writeFileSync(claudeCredentialsPath(creds.credentialDir), text, { mode: 0o600 })
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

export function needsRefresh(oauth: OAuthCreds, nowMs: number): boolean {
  return typeof oauth.expiresAt === 'number' && oauth.expiresAt - nowMs < REFRESH_BUFFER_MS
}

export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function performRefresh(creds: LoadedCreds): Promise<string | null> {
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


const refreshes = new AsyncCoalescer<LoadedCreds | null>()
export async function refreshToken(creds: LoadedCreds): Promise<string | null> {
  const fingerprint = createHash('sha256').update(creds.oauth.refreshToken ?? '').digest('hex')
  const result = await refreshes.get(`${creds.credentialDir ?? '__cli__'}:${fingerprint}`, async () => await performRefresh(creds) ? creds : null)
  if (!result) return null
  Object.assign(creds.oauth, result.oauth)
  creds.fullData.claudeAiOauth = creds.oauth
  return creds.oauth.accessToken
}
