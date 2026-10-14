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
  return { store, manager, changed, complete, connections }
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

  it('lets a device-code sign-in left waiting block no other sign-in', async () => {
    const { manager, connections } = fixture()
    const remote = await manager.start('chatgptDeviceCode')
    const window = await manager.start('chatgpt')
    const another = await manager.start('chatgptDeviceCode')
    const accounts = await manager.list()
    for (const login of [remote, window, another]) {
      expect(accounts.find((a) => a.id === login.accountId)).toMatchObject({ loginState: 'pending' })
    }
    // The browser sign-in still owns the callback port.
    await expect(manager.start('chatgpt')).rejects.toThrow(/Finish or cancel/)
    expect(connections.filter((c) => !c.closed)).toHaveLength(3)
  })

  it('replaces a waiting sign-in when the same account signs in again', async () => {
    const { manager, connections, complete } = fixture()
    const abandoned = await manager.start('chatgptDeviceCode')
    const browser = await manager.start('chatgpt', abandoned.accountId)
    expect(browser.accountId).toBe(abandoned.accountId)
    expect(connections.map((c) => c.closed)).toEqual([true, false])
    await complete(browser.loginId, 'b@example.test')
    expect((await manager.list()).find((a) => a.id === abandoned.accountId)).toMatchObject({ signedIn: true, email: 'b@example.test' })
    expect((await manager.list()).find((a) => a.id === abandoned.accountId)?.loginState).toBeUndefined()
  })

  it('removes a signed-out profile without touching another account and keeps it removed after listing accounts', async () => {
    const { manager, store, complete, changed } = fixture()
    const a = await manager.start('chatgpt')
    await complete(a.loginId, 'remove-a@example.test')
    const b = await manager.start('chatgpt')
    await complete(b.loginId, 'keep-b@example.test')
    await expect(manager.remove(codexAccountProviderId(a.accountId))).rejects.toThrow(/Sign out/)
    await manager.logout(codexAccountProviderId(a.accountId))
    const profile = store.home(a.accountId)
    changed.mockClear()
    await manager.remove(codexAccountProviderId(a.accountId))
    expect(store.list().map((a) => a.id)).toEqual([b.accountId])
    expect(store.defaultProviderId()).toBe(codexAccountProviderId(b.accountId))
    expect(changed).toHaveBeenCalledWith(codexAccountProviderId(a.accountId))
    expect((await import('node:fs')).existsSync(profile)).toBe(true)
    expect((await manager.list()).map((a) => a.id)).toEqual([b.accountId])
  })

  it('does not let a delayed status response restore a removed profile', async () => {
    const { store } = fixture()
    const id = store.allocate()
    let finish!: (value: Record<string, unknown>) => void
    const manager = new CodexAccountManager(store, async () => ({
      request: async () => new Promise((resolve) => { finish = resolve }),
      nextNotification: async () => null, close: async () => {},
    }))
    managers.push(manager)
    const pending = manager.status(codexAccountProviderId(id))
    await vi.waitFor(() => expect(finish).toBeDefined())
    await manager.remove(codexAccountProviderId(id))
    finish({ account: null, requiresOpenaiAuth: true })
    await pending
    expect(store.list()).toEqual([])
  })
})
