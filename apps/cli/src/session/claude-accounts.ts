import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveSuperoneHome } from '@superone/runtime/fs/superone-home'
import { collectClaudeAccounts } from '@superone/runtime/session/claude-account-list'
import { readClaudeAccount } from '@superone/runtime/session/claude-account-profile'
import { ClaudeAccountStore } from '@superone/runtime/session/claude-account-store'
import type { ClaudeAccount } from '@superone/shared/agent-types'

let store: ClaudeAccountStore | null = null

function accountStore(): ClaudeAccountStore {
  store ??= new ClaudeAccountStore(join(resolveSuperoneHome({ userHome: homedir() }), 'claude-accounts'))
  return store
}

/** Claude accounts signed in on this node. The controller reads them with `claude.listAccounts`. */
export function listNodeClaudeAccounts(force = false): Promise<ClaudeAccount[]> {
  const current = accountStore()
  return collectClaudeAccounts(current, (dir, next) => readClaudeAccount(dir, next, current), force)
}
