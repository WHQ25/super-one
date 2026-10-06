import { createHash } from 'node:crypto'
import type { ClaudeAccount } from '@superone/shared/agent-types'

const KEYCHAIN_SERVICE = 'Claude Code-credentials'

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
export function keychainServiceNames(
  credentialDir: string | null,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const secure = credentialDir ?? env.CLAUDE_SECURESTORAGE_CONFIG_DIR
  const useDefaultDomain = secure !== undefined ? !secure : !env.CLAUDE_CONFIG_DIR
  if (useDefaultDomain) return [KEYCHAIN_SERVICE]

  const path = secure || env.CLAUDE_CONFIG_DIR || ''
  const hash = createHash('sha256').update(path.normalize('NFC')).digest('hex').slice(0, 8)
  const hashed = `${KEYCHAIN_SERVICE}-${hash}`
  return credentialDir ? [hashed] : [hashed, KEYCHAIN_SERVICE]
}

/**
 * Collapse domains that resolve to the same account. A user who signs into the same account both
 * in the CLI's default domain and in a SuperOne-managed one would otherwise see it twice; the
 * default domain wins because it is the one the CLI keeps refreshing on its own.
 *
 * Unidentifiable accounts (signed out, or signed in without an org) are never merged — we don't
 * know that they are the same, and collapsing them would hide a domain the user has to fix.
 */
export function dedupeAccounts(accounts: readonly ClaudeAccount[]): ClaudeAccount[] {
  const byIdentity = new Map<string, ClaudeAccount>()
  for (const account of accounts) {
    if (!account.identityKey || !account.loggedIn || account.identityStatus === 'unavailable') continue
    const seen = byIdentity.get(account.identityKey)
    if (!seen || account.isDefault || (!seen.isDefault && seen.credentialDir !== null && account.credentialDir === null)) {
      byIdentity.set(account.identityKey, account)
    }
  }
  const kept = new Set(byIdentity.values())
  return accounts.filter((account) => !account.identityKey || !account.loggedIn || account.identityStatus === 'unavailable' || kept.has(account))
}
