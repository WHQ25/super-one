import type { ClaudeAccount } from '@superone/shared/agent-types'

/**
 * Collapse domains that resolve to the same account. A user who signs into the same account both
 * in the CLI's default domain and in a SuperOne-managed one would otherwise see it twice; the
 * default domain wins because it is the one the CLI keeps refreshing on its own.
 *
 * A signed-out domain merges only by the identity it was verified as (`ownerOf`): it hides behind
 * a signed-in card of that identity, or behind another signed-out one. Domains with no verified
 * owner are never merged — we don't know that they are the same.
 */
export function dedupeAccounts(accounts: readonly ClaudeAccount[], ownerOf: (account: ClaudeAccount) => string | null | undefined = () => null): ClaudeAccount[] {
  const byIdentity = new Map<string, ClaudeAccount>()
  for (const account of accounts) {
    if (!account.identityKey || !account.loggedIn || account.identityStatus === 'unavailable') continue
    const seen = byIdentity.get(account.identityKey)
    if (!seen || account.isDefault || (!seen.isDefault && seen.credentialDir !== null && account.credentialDir === null)) {
      byIdentity.set(account.identityKey, account)
    }
  }
  const kept = new Set(byIdentity.values())
  const signedOut = new Map<string, ClaudeAccount>()
  for (const account of accounts) {
    const owner = account.loggedIn ? null : ownerOf(account)
    if (!owner || byIdentity.has(owner)) continue
    const seen = signedOut.get(owner)
    if (!seen || (account.isDefault && !seen.isDefault)) signedOut.set(owner, account)
  }
  return accounts.filter((account) => {
    if (!account.loggedIn) { const owner = ownerOf(account); return !owner || signedOut.get(owner) === account }
    return !account.identityKey || account.identityStatus === 'unavailable' || kept.has(account)
  })
}
