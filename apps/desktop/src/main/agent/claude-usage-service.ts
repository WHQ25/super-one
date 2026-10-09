import { createHash, randomUUID } from 'node:crypto'
import type { ClaudeRateLimits } from '@superone/shared/agent-types'
import { SubscriptionUsageTracker } from '@superone/shared/subscription-usage'
import { claudeCredentialFingerprint, claudePlanType, loadClaudeCredentials, readClaudeRateLimits } from '@superone/runtime/usage'
import log from '../logger'
import { claudeAccountStore } from './claude-account-store'
import { usageLog } from './usage-log'

/**
 * The desktop gauge's view of a Claude login: the runtime reading (throttle,
 * refresh, last-good value — shared with nodes) plus what only the desktop
 * knows. That is the account identity the meters are filed under (`quotaKey`),
 * so a forecast never mixes two accounts, and the per-quota history that the
 * forecasts are drawn from.
 */
interface DomainIdentity {
  fingerprint: string
  quotaKey: string
  decorated: { fetchedAt: number | null | undefined; value: ClaudeRateLimits } | null
}

const identities = new Map<string, DomainIdentity>()
const usageHistory = new SubscriptionUsageTracker()

async function identityFor(credentialDir: string | null, fingerprint: string): Promise<DomainIdentity | null> {
  const key = credentialDir ?? ''
  const known = identities.get(key)
  if (known?.fingerprint === fingerprint) return known
  // A CLI login may replace the default domain underneath us. Never serve the previous account's history.
  const { readAccount } = await import('./claude-account-service')
  const account = await readAccount(credentialDir)
  if (credentialDir && (!account.loggedIn || (!account.identityKey && claudeAccountStore().get(credentialDir)?.ownerIdentity))) return null
  const creds = loadClaudeCredentials(credentialDir, usageLog)
  if (!creds) return null
  const identity: DomainIdentity = {
    // Reading the profile may have refreshed the token; file the identity under the login as it is now.
    fingerprint: claudeCredentialFingerprint(creds),
    quotaKey: `claude:${account.identityKey
      ? createHash('sha256').update(JSON.stringify([account.identityKey, claudePlanType(creds.oauth)])).digest('hex')
      : randomUUID()}`,
    decorated: null,
  }
  identities.set(key, identity)
  return identity
}

export async function getClaudeRateLimits(force = false, credentialDir: string | null = null): Promise<ClaudeRateLimits | null> {
  try {
    const creds = loadClaudeCredentials(credentialDir, usageLog)
    if (!creds?.oauth.accessToken?.trim()) return null
    const identity = await identityFor(credentialDir, claudeCredentialFingerprint(creds))
    if (!identity) return null
    const { value } = await readClaudeRateLimits(credentialDir, { force, log: usageLog })
    if (!value) return null
    // Each upstream reading is sampled into the history once, however often the gauge polls.
    const previous = identity.decorated
    if (previous && previous.fetchedAt === value.fetchedAt) return previous.value
    const fetchedAt = value.fetchedAt ?? Date.now()
    const decorated: ClaudeRateLimits = { ...value, quotaKey: identity.quotaKey,
      windows: value.windows.map((window) => usageHistory.observe(identity.quotaKey, { ...window,
        windowDurationMins: window.id === 'five_hour' ? 300
          : window.id?.startsWith('seven_day') || window.id?.startsWith('weekly_scoped:') ? 7 * 24 * 60 : null,
      }, fetchedAt)) }
    identity.decorated = { fetchedAt: value.fetchedAt, value: decorated }
    return decorated
  } catch (e) {
    log.info('[claude-usage] getClaudeRateLimits failed: %s', String(e))
    return identities.get(credentialDir ?? '')?.decorated?.value ?? null
  }
}
