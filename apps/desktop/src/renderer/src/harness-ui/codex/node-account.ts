import type { SubscriptionUsage } from '@superone/shared/environment'

/**
 * A Codex session that omits its account id spends the node's default login.
 * That login is still reported as `codex-account:…`, so the hub key alone misses it
 * and the list draws a second OpenAI card with no email.
 * An older node omits `isDefault`; the only Codex row is that login.
 */
export function codexRowMatchesOmittedAccount(
  row: SubscriptionUsage,
  accounts: readonly SubscriptionUsage[],
  activeAccountOmitsCodexId: boolean,
): boolean {
  if (row.harness !== 'codex' || !activeAccountOmitsCodexId) return false
  if (row.isDefault) return true
  const codex = accounts.filter((item) => item.harness === 'codex')
  return codex.length === 1 && row.isDefault == null && codex[0] === row
}
