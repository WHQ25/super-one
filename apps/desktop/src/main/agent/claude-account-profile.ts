import { createHash } from 'node:crypto'
import type { ClaudeAccount } from '@superone/shared/agent-types'
import { fetchWithTimeout, hasProfileScope, loadClaudeCredentials, needsRefresh, refreshClaudeToken, type LoadedClaudeCreds } from '@superone/runtime/usage'
import { usageLog } from './usage-log'

const loadCredentials = (dir: string | null) => loadClaudeCredentials(dir, usageLog)
const refreshToken = (creds: LoadedClaudeCreds) => refreshClaudeToken(creds, usageLog)
import { AsyncCoalescer } from '@superone/runtime/async-coalescer'
import { claudeAccountStore, type ClaudeAccountStore } from './claude-account-store'

const PROFILE_TTL_MS = 60_000
const requests = new AsyncCoalescer<ClaudeAccount>()
function string(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null }
export function parseClaudeProfile(body: unknown): Partial<ClaudeAccount> | null {
  if (!body || typeof body !== 'object') return null
  const { account, organization } = body as { account?: Record<string, unknown>; organization?: Record<string, unknown> }
  const accountUuid = string(account?.uuid), email = string(account?.email), orgId = string(organization?.uuid)
  if (!accountUuid || !email || !orgId) return null
  return { accountUuid, email, orgId, orgName: string(organization?.name), identityKey: `${accountUuid.toLowerCase()}|${orgId.toLowerCase()}` }
}

/** Never infer identity from the shared CLI profile. Bind the cached profile to its token. */
export function readClaudeAccount(dir: string | null, force = false, store: ClaudeAccountStore = claudeAccountStore()): Promise<ClaudeAccount> {
  const creds = loadCredentials(dir)
  const requestKey = createHash('sha256').update(creds?.oauth.accessToken ?? '').digest('hex')
  return requests.get(`${store.root}:${dir ?? '__cli__'}:${requestKey}`, async () => {
    const previous = store.get(dir)
    let account: ClaudeAccount = {
      credentialDir: dir, loggedIn: !!creds?.oauth.accessToken, identityKey: null, accountUuid: null,
      email: previous?.account.email ?? null, orgId: null, orgName: previous?.account.orgName ?? null,
      subscriptionType: creds?.oauth.subscriptionType ?? previous?.account.subscriptionType ?? null,
      projectsDirectory: null, identityStatus: creds ? 'unavailable' : 'signedOut',
    }
    if (!creds || !hasProfileScope(creds)) {
      store.update(dir, { account })
      return { ...account, isDefault: store.isDefault(dir) }
    }
    if (needsRefresh(creds.oauth, Date.now())) await refreshToken(creds)
    const fingerprint = createHash('sha256').update(creds.oauth.accessToken).digest('hex')
    const sameToken = previous?.fingerprint === fingerprint
    if (sameToken) account = { ...previous.account, subscriptionType: account.subscriptionType }
    if (!force && sameToken && previous.account.identityStatus === 'verified' && previous.verifiedAt && Date.now() - previous.verifiedAt < PROFILE_TTL_MS) {
      return { ...account, isDefault: store.isDefault(dir) }
    }
    try {
      let response = await fetchProfile(creds.oauth.accessToken)
      if (response.status === 401 && creds.oauth.refreshToken) {
        const token = await refreshToken(creds)
        if (token) response = await fetchProfile(token)
      }
      if (response.status === 401) account = { ...account, loggedIn: false, identityKey: null, identityStatus: 'signedOut' }
      else if (response.ok) {
        const profile = parseClaudeProfile(await response.json())
        if (profile) {
          if (loadCredentials(dir)?.oauth.accessToken !== creds.oauth.accessToken) return readClaudeAccount(dir, true, store)
          if (dir && previous?.ownerIdentity && profile.identityKey !== previous.ownerIdentity) {
            account = { ...account, loggedIn: false, identityKey: null, identityStatus: 'signedOut' }
            store.update(dir, { account, identityMismatch: true })
            return { ...account, isDefault: store.isDefault(dir) }
          }
          account = { ...account, ...profile, loggedIn: true, identityStatus: 'verified' }
          store.update(dir, { account, fingerprint: createHash('sha256').update(creds.oauth.accessToken).digest('hex'), verifiedAt: Date.now() })
          return { ...account, isDefault: store.isDefault(dir) }
        }
      }
    } catch { /* Preserve a verified same-token identity during network outages. */ }
    if (loadCredentials(dir)?.oauth.accessToken !== creds.oauth.accessToken) return readClaudeAccount(dir, true, store)
    account.identityStatus = account.loggedIn ? 'unavailable' : 'signedOut'
    // Retain a last verified cache only for the same token, never bind it to replacement credentials.
    store.update(dir, { account, ...(sameToken ? { fingerprint, verifiedAt: previous?.verifiedAt } : {}) })
    return { ...account, isDefault: store.isDefault(dir) }
  })
}
function fetchProfile(token: string): Promise<Response> {
  return fetchWithTimeout('https://api.anthropic.com/api/oauth/profile', {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'claude-code/2.1.289', 'Cache-Control': 'no-cache' },
  }, 10_000)
}
