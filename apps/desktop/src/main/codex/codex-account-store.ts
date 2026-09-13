import { join } from 'node:path'
import { CodexAccountStore } from '@superone/codex/account-store'
import { superoneHome } from '../superone-home'

/** Resolve lazily so app startup and test homes remain isolated. */
export function codexAccountStore(): CodexAccountStore {
  return new CodexAccountStore(join(superoneHome(), 'codex-accounts'))
}
