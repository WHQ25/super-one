import { join } from 'node:path'
import { ClaudeAccountStore } from '@superone/runtime/session/claude-account-store'
import { superoneHome } from '../superone-home'

export { ClaudeAccountStore, type StoredClaudeAccount } from '@superone/runtime/session/claude-account-store'

export function claudeAccountStore(): ClaudeAccountStore {
  return new ClaudeAccountStore(join(superoneHome(), 'claude-accounts'))
}
