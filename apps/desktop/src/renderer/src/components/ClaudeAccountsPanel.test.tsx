/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor, act, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { claudeAccountProviderId, type ClaudeAccount } from '@superone/shared/agent-types'
import { ClaudeAuthSettings } from './ClaudeAccountsPanel'
import { useClaudeAccounts } from '@/hooks/useClaudeAccounts'
const a: ClaudeAccount = { credentialDir: '/accounts/a', loggedIn: true, email: 'a@example.test', identityKey: 'a|org', orgId: 'org', orgName: 'Personal', subscriptionType: 'max', projectsDirectory: null, isDefault: true }
const b: ClaudeAccount = { ...a, credentialDir: '/accounts/b', email: 'b@example.test', identityKey: 'b|org', isDefault: false }
function AccountObserver() {
  const accounts = useClaudeAccounts()
  return <output data-testid="selected">{claudeAccountProviderId(accounts.find((row) => row.isDefault)?.credentialDir ?? null)}</output>
}
beforeEach(() => {
  let accounts = [a, b]
  Object.assign(window.app, {
    claudeListAccounts: vi.fn(async () => accounts),
    claudeGetRateLimits: vi.fn(async (_force: boolean, dir: string) => ({ windows: [{ label: '5-hour', usedPercent: dir === a.credentialDir ? 20 : 80, resetsAt: null }], extraUsage: null, planType: 'max' })),
    claudeSetDefaultAccount: vi.fn(async (dir: string) => { accounts = accounts.map((row) => ({ ...row, isDefault: row.credentialDir === dir })) }),
    claudeSignOutAccount: vi.fn(async (dir: string) => { accounts = accounts.map((row) => row.credentialDir === dir ? { ...row, loggedIn: false } : row) }),
    claudeRemoveAccount: vi.fn(async (dir: string) => { accounts = accounts.filter((row) => row.credentialDir !== dir) }),
    claudeSignInAccount: vi.fn(async (_email: unknown, dir: string) => { accounts = accounts.map((row) => row.credentialDir === dir ? { ...row, loggedIn: true } : row); return accounts.find((row) => row.credentialDir === dir) }),
  })
})
describe('Claude account cards and selection updates', () => {
  it('shows independent meters and refreshes the selected account after setting a default', async () => {
    render(<><ClaudeAuthSettings /><AccountObserver /></>)
    expect(await screen.findByText('a@example.test')).toBeInTheDocument()
    expect(await screen.findByText('b@example.test')).toBeInTheDocument()
    expect(await screen.findByText(/80%/)).toBeInTheDocument()
    expect(await screen.findByText(/20%/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /set as default/i }))
    await waitFor(() => expect(screen.getByTestId('selected')).toHaveTextContent('claude-account:/accounts/b'))
    expect(window.app.claudeSetDefaultAccount).toHaveBeenCalledWith(b.credentialDir)
  })
  it('keeps a signed-out card and reauthenticates its existing domain', async () => {
    render(<ClaudeAuthSettings />)
    await screen.findByText('b@example.test')
    fireEvent.click(screen.getAllByRole('button', { name: /sign out/i })[1]!)
    const signIn = await screen.findByRole('button', { name: /sign in again/i })
    expect(screen.getByText('b@example.test')).toBeInTheDocument()
    fireEvent.click(signIn)
    await waitFor(() => expect(window.app.claudeSignInAccount).toHaveBeenCalledWith(undefined, b.credentialDir))
    await waitFor(() => expect(screen.queryByRole('button', { name: /sign in again/i })).not.toBeInTheDocument())
  })
  it('removes a signed-out card that cannot be reauthenticated', async () => {
    render(<ClaudeAuthSettings />)
    await screen.findByText('b@example.test')
    expect(screen.queryByRole('button', { name: /remove account/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: /sign out/i })[1]!)
    fireEvent.click(await screen.findByRole('button', { name: /remove account/i }))
    await waitFor(() => expect(screen.queryByText('b@example.test')).not.toBeInTheDocument())
    expect(window.app.claudeRemoveAccount).toHaveBeenCalledWith(b.credentialDir)
  })
  it('discards a stale meter response after a newer refresh has completed', async () => {
    let finish!: (value: unknown) => void
    vi.mocked(window.app.claudeGetRateLimits).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve as typeof finish }))
    render(<ClaudeAuthSettings />)
    await screen.findByText('a@example.test')
    fireEvent.click(screen.getByRole('button', { name: /refresh account status/i }))
    await screen.findByText(/80%/)
    await act(async () => { finish({ windows: [{ label: '5-hour', usedPercent: 99, resetsAt: null }], extraUsage: null, planType: 'max' }) })
    expect(screen.queryByText(/1%/)).not.toBeInTheDocument()
  })

  it('opens with cached readings and refreshes just one chosen account', async () => {
    render(<ClaudeAuthSettings />)
    await screen.findByText(/80%/)
    expect(window.app.claudeGetRateLimits).toHaveBeenCalledWith(false, a.credentialDir, true)
    expect(window.app.claudeGetRateLimits).toHaveBeenCalledWith(false, b.credentialDir, true)
    vi.mocked(window.app.claudeGetRateLimits).mockClear()
    vi.mocked(window.app.claudeListAccounts).mockClear()
    const row = screen.getByText(b.email!).closest('li')!
    fireEvent.click(within(row).getByRole('button', { name: 'Refresh Usage' }))
    await waitFor(() => expect(window.app.claudeGetRateLimits).toHaveBeenCalledWith(true, b.credentialDir, false))
    expect(window.app.claudeGetRateLimits).toHaveBeenCalledTimes(1)
    expect(window.app.claudeListAccounts).not.toHaveBeenCalled()
  })
})
