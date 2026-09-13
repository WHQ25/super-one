import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CodexAccountStore } from './account-store'
import { CodexAccountManager, type AccountConnection } from './account-manager'
import { codexAccountProviderId } from '@superone/shared/codex-accounts'

const roots: string[] = []
const managers: CodexAccountManager[] = []
afterEach(() => {
  for (const m of managers.splice(0)) m.dispose()
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'codex-login-test-'))
  roots.push(root)
  const cli = join(root, 'cli')
  mkdirSync(cli)
  const store = new CodexAccountStore(join(root, 'accounts'), cli)
  const loggedIn = new Map<string, string>()
  const connections: Array<{ provider: string; send: (n: { method: string; params: Record<string, unknown> } | null) => void; closed: boolean }> = []
  const changed = vi.fn()
  const manager = new CodexAccountManager(store, async (provider): Promise<AccountConnection> => {
    let waiter: ((n: { method: string; params: Record<string, unknown> } | null) => void) | undefined
    const state = { provider, send: (n: { method: string; params: Record<string, unknown> } | null) => waiter?.(n), closed: false }
    connections.push(state)
    return {
      request: async (method) => {
        if (method === 'account/login/start') return { type: 'chatgpt', loginId: provider, authUrl: 'https://auth.openai.com/test' }
        if (method === 'account/logout') loggedIn.delete(provider)
        return { account: loggedIn.has(provider) ? { type: 'chatgpt', email: loggedIn.get(provider), planType: 'plus' } : null, requiresOpenaiAuth: true }
      },
      nextNotification: () => new Promise((resolve) => { waiter = resolve }),
      close: async () => { state.closed = true; waiter?.(null) },
    }
  }, changed)
  managers.push(manager)
  const complete = async (loginId: string, email: string) => {
    loggedIn.set(loginId, email)
    connections.find((c) => c.provider === loginId && !c.closed)!.send({ method: 'account/login/completed', params: { loginId, success: true } })
    await vi.waitFor(() => expect(changed).toHaveBeenCalledWith(loginId))
  }
  return { store, manager, changed, complete }
}

describe('Codex login and account isolation', () => {
  it('adds two accounts, changes the default, and signs out only the selected account', async () => {
    const { store, manager, complete, changed } = fixture()
    const a = await manager.start('chatgpt')
    await complete(a.loginId, 'a@example.test')
    const b = await manager.start('chatgpt')
    await complete(b.loginId, 'b@example.test')
    expect(a.accountId).not.toBe(b.accountId)
    expect(store.defaultProviderId()).toBe(codexAccountProviderId(a.accountId))
    await manager.setDefault(b.accountId)
    expect(store.defaultProviderId()).toBe(codexAccountProviderId(b.accountId))
    changed.mockClear()
    await manager.logout(codexAccountProviderId(a.accountId))
    expect(changed.mock.calls).toEqual([[codexAccountProviderId(a.accountId)]])
    const accounts = await manager.list()
    expect(accounts.find((a) => a.id === b.accountId)).toMatchObject({ signedIn: true, isDefault: true, email: 'b@example.test' })
    expect(accounts.find((b) => b.id === a.accountId)).toMatchObject({ signedIn: false })
  })

  it('does not report the existing account as completion of a new login', async () => {
    const { manager, complete } = fixture()
    const first = await manager.start('chatgpt')
    await complete(first.loginId, 'first@example.test')
    const pending = await manager.start('chatgpt')
    const accounts = await manager.list()
    expect(accounts.find((a) => a.id === pending.accountId)).toMatchObject({ signedIn: false, loginState: 'pending' })
    await expect(manager.start('chatgpt')).rejects.toThrow(/Finish or cancel/)
    await manager.cancel(pending.loginId)
  })
})
