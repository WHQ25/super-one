import { createHash } from 'node:crypto'
import { UsageThrottle } from '@superone/runtime/usage'
import { USAGE_POLL_MS } from '@superone/shared/subscription-usage'
import type { CodexAppServerHandle } from './app-server-client'
import { safePublicError } from './app-server-client'

export { UsageThrottle, USAGE_POLL_MS }

/** Account/read is local to the app server; only the upstream usage read is throttled. */
export async function readCachedCodexUsage<T extends { error?: string }>(
  client: Pick<CodexAppServerHandle, 'request'>,
  throttle: UsageThrottle<T | null>,
  scope: string,
  force: boolean,
  fetchUsage: (account: Record<string, unknown> | null) => Promise<T | null>,
  preferCached = false,
): Promise<T | null> {
  const identity = await client.request('account/read', { refreshToken: false }).catch(() => null)
  if (identity && 'account' in identity && identity.account === null) return null
  const account = identity?.account && typeof identity.account === 'object'
    ? identity.account as Record<string, unknown> : null
  if (account?.type && account.type !== 'chatgpt' && account.type !== 'chatgptAuthTokens') return null
  // Older servers without identity remain usable, but must never reuse an unverified login's cache.
  if (!account || (!account.email && !account.id && !account.accountId)) return fetchUsage(account)
  const fingerprint = createHash('sha256').update(JSON.stringify([
    account.type, account.id ?? account.accountId, account.email, account.planType,
  ])).digest('hex')
  // Including identity in the request key fences an old in-flight read across a login change.
  const key = JSON.stringify([scope, fingerprint])
  const reading = await throttle.read(key, fingerprint, force, async () => {
    try { return { value: await fetchUsage(account) } }
    catch (error) {
      const message = safePublicError('Codex usage refresh failed', error).message
      // App Server exposes upstream HTTP failures in its JSON-RPC error message, not response headers.
      if (/\b(?:HTTP|status(?:\s+code)?)[\s:=]+429\b|\b429\s+Too Many Requests\b/i.test(message)) {
        return { rateLimitedForMs: USAGE_POLL_MS }
      }
      return { error: message }
    }
  }, preferCached)
  if (!reading.value && reading.error) throw new Error(reading.error)
  return reading.value && reading.error ? { ...reading.value, error: reading.error } : reading.value
}
