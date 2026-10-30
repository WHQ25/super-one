import type { ClaudeAccount } from '@superone/shared/agent-types'
import { dedupeAccounts } from './claude-account-parse'
import type { ClaudeAccountStore } from './claude-account-store'

const LIST_CACHE_TTL_MS = 60_000

interface ListSlot {
  generation: number
  cache: { accounts: ClaudeAccount[]; at: number } | null
}

const slots = new Map<string, ListSlot>()

function slot(root: string): ListSlot {
  let current = slots.get(root)
  if (!current) {
    current = { generation: 0, cache: null }
    slots.set(root, current)
  }
  return current
}

/** Drop a cached account list. The next read probes credentials again. */
export function invalidateClaudeAccountListCache(root: string): void {
  const current = slot(root)
  current.cache = null
  current.generation += 1
}

export type ReadClaudeAccount = (dir: string | null, force: boolean) => Promise<ClaudeAccount>

/**
 * Signed-in accounts for one registry. The external CLI login is read first so
 * an existing installation keeps it as the initial default. A signed-out CLI
 * login is omitted: this host can neither renew nor remove it.
 */
export async function collectClaudeAccounts(store: ClaudeAccountStore, read: ReadClaudeAccount, force = false): Promise<ClaudeAccount[]> {
  const current = slot(store.root)
  if (!force && current.cache && Date.now() - current.cache.at < LIST_CACHE_TTL_MS) return current.cache.accounts
  const generation = current.generation
  const cli = await read(null, force)
  const accounts = [...(cli.loggedIn ? [cli] : []), ...await Promise.all(store.dirs().map((dir) => read(dir, force)))]
  const resolved = dedupeAccounts(accounts, (account) => account.credentialDir && store.get(account.credentialDir)?.ownerIdentity)
    .map((account) => ({ ...account, isDefault: store.isDefault(account.credentialDir) }))
  if (generation === current.generation) current.cache = { accounts: resolved, at: Date.now() }
  return resolved
}

/**
 * Signed-in accounts as last recorded in the registry, without probing credentials.
 * `collectClaudeAccounts` refreshes the same records.
 */
export function knownClaudeAccounts(store: ClaudeAccountStore): ClaudeAccount[] {
  const accounts = [null, ...store.dirs()].flatMap((dir) => {
    const account = store.get(dir)?.account
    return account ? [{ ...account, isDefault: store.isDefault(dir) }] : []
  })
  return dedupeAccounts(accounts).filter((account) => account.loggedIn)
}
