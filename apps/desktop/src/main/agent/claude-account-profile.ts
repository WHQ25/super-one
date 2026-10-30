import { desktopNetFetch } from '../desktop-net-fetch'
import { readClaudeAccount as readShared, type ReadClaudeAccountOptions } from '@superone/runtime/session/claude-account-profile'
import type { ClaudeAccount } from '@superone/shared/agent-types'
import { usageLog } from './usage-log'
import { claudeAccountStore, type ClaudeAccountStore } from './claude-account-store'

export { parseClaudeProfile } from '@superone/runtime/session/claude-account-profile'

/** Desktop profile reads follow the system proxy. The registry defaults to this process. */
export function readClaudeAccount(dir: string | null, force = false, store: ClaudeAccountStore = claudeAccountStore(), options: ReadClaudeAccountOptions = {}): Promise<ClaudeAccount> {
  return readShared(dir, force, store, { fetchImpl: desktopNetFetch, log: usageLog, ...options })
}
