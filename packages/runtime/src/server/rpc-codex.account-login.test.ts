import { describe, expect, it, vi } from 'vitest'
import type { CodexManagedLoginStart } from '@superone/shared/codex-accounts'
import { cancelCodexAccountLoginForClient, dispatchCodexRpc, type CodexAdminPort, type CodexRpcContext } from './rpc-codex'

function node() {
  let n = 0
  const starts: Array<(login: CodexManagedLoginStart) => void> = []
  const codex = {
    startAccountLogin: vi.fn(() => new Promise<CodexManagedLoginStart>((resolve) => { starts.push(resolve) })),
    cancelAccountLogin: vi.fn(async () => {}),
  }
  const settle = () => starts.shift()!({
    type: 'chatgptDeviceCode', loginId: `login-${++n}`, verificationUrl: 'https://auth.openai.com/device', userCode: 'ABCD-EFGH', accountId: 'acct-1',
  })
  const ctx = (clientSessionId: string): CodexRpcContext => ({
    client: { clientSessionId, scopes: ['environment:read', 'node:admin'] } as CodexRpcContext['client'],
    projects: { get: () => ({ path: '/p1' }) },
    codex: codex as unknown as CodexAdminPort,
  })
  const start = (clientSessionId: string) => dispatchCodexRpc('codex.accountLoginStart', { projectId: 'p1' }, ctx(clientSessionId))
  return { codex, settle, start }
}

describe('codex.accountLoginStart', () => {
  it("ends a client's earlier sign-in and the one it leaves when it goes", async () => {
    const { codex, settle, start } = node()
    const first = start('phone:a')
    await vi.waitFor(() => expect(codex.startAccountLogin).toHaveBeenCalledTimes(1))
    settle()
    await first
    const other = start('node:b')
    await vi.waitFor(() => expect(codex.startAccountLogin).toHaveBeenCalledTimes(2))
    settle()
    await other

    const second = start('phone:a')
    await vi.waitFor(() => expect(codex.startAccountLogin).toHaveBeenCalledTimes(3))
    expect(codex.cancelAccountLogin.mock.calls).toEqual([['login-1']])
    settle()
    await second
    await cancelCodexAccountLoginForClient('phone:a')
    expect(codex.cancelAccountLogin.mock.calls).toEqual([['login-1'], ['login-3']])
    // Another client's sign-in is its own.
    await cancelCodexAccountLoginForClient('node:b')
    expect(codex.cancelAccountLogin.mock.calls).toEqual([['login-1'], ['login-3'], ['login-2']])
  })

  it('cancels a sign-in whose client went away before it started', async () => {
    const { codex, settle, start } = node()
    const started = start('node:c')
    await vi.waitFor(() => expect(codex.startAccountLogin).toHaveBeenCalledTimes(1))
    const gone = cancelCodexAccountLoginForClient('node:c')
    settle()
    await Promise.all([started, gone])
    expect(codex.cancelAccountLogin).toHaveBeenCalledWith('login-1')
  })
})
