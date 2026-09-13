import { join } from 'node:path'
import { CodexAccountStore } from '@superone/codex/account-store'
import { CodexAccountManager } from '@superone/codex/account-manager'
import { openCodexAppServer } from '@superone/codex'
import { resolveNodeHome } from '../config'
import { resolveCodexBinaryPath } from './codex-turn-runner'
import type { CodexAdminServiceOptions } from './codex-admin-service'

export function nodeCodexAccountStore(nodeHome = resolveNodeHome()): CodexAccountStore {
  return new CodexAccountStore(join(nodeHome, 'codex-accounts'))
}

const managers = new Map<string, CodexAccountManager>()
export function nodeCodexAccounts(opts: CodexAdminServiceOptions): CodexAccountManager {
  const store = nodeCodexAccountStore(opts.nodeHome)
  let manager = managers.get(store.root)
  if (!manager) {
    manager = new CodexAccountManager(store, async (providerId) => {
      const binary = resolveCodexBinaryPath(opts)
      if (!binary) throw new Error('Codex binary not available')
      const client = await openCodexAppServer({
        binaryPath: binary,
        env: store.environment(providerId, { ...process.env, ...opts.env }, true),
        cliArgs: store.cliOverrides(providerId),
        spawnFn: opts.spawnFn,
      })
      return {
        request: (method, params) => client.request(method, params),
        nextNotification: () => client.nextNotification(15 * 60_000),
        close: () => client.close(),
      }
    })
    managers.set(store.root, manager)
  }
  return manager
}

export function clearNodeCodexAccountsForTest(): void {
  for (const manager of managers.values()) manager.dispose()
  managers.clear()
}
