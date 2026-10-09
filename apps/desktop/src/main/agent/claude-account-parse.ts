import type { ClaudeAccount } from '@superone/shared/agent-types'

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
