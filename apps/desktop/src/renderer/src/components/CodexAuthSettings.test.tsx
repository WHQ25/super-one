/** @vitest-environment jsdom */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CodexAuthSettings } from './CodexAuthSettings'
import { codexAccountProviderId, type CodexAccount } from '@superone/shared/codex-accounts'

const limits = vi.fn()
const usage = vi.fn()
const list = vi.fn()
const start = vi.fn()
const cancel = vi.fn()
const logout = vi.fn()
const setDefault = vi.fn()
const remove = vi.fn()
vi.mock('@/stores/chat', () => ({ useChatStore: (select: (state: { activeProject: string }) => unknown) => select({ activeProject: '/project' }) }))
Object.defineProperty(window, 'app', { configurable: true, value: { codexGetRateLimits: limits, codexGetAccountUsage: usage, codexListAccounts: list, codexStartAccountLogin: start, codexCancelAccountLogin: cancel, codexLogoutAccount: logout, codexSetDefaultAccount: setDefault, codexRemoveAccount: remove } })
const a: CodexAccount = { id: '11111111-1111-4111-8111-111111111111', signedIn: true, isDefault: true, email: 'a@example.test', planType: 'plus', authMode: 'chatgpt', requiresOpenaiAuth: true }
const b: CodexAccount = { ...a, id: '22222222-2222-4222-8222-222222222222', email: 'b@example.test', isDefault: false }
beforeEach(() => { vi.clearAllMocks(); list.mockResolvedValue([]); limits.mockResolvedValue(null); usage.mockResolvedValue(null) })

describe('Codex account management', () => {
  it('keeps each account usage inside its own card and isolates failures', async () => {
    list.mockResolvedValue([a, b])
    limits.mockImplementation(async (_path, id) => {
      if (id === codexAccountProviderId(b.id)) throw new Error('Unavailable')
      return { primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: null }, secondary: null, planType: 'plus', resetCredits: null }
    })
    usage.mockImplementation(async (_path, id) => ({ lifetimeTokens: id === codexAccountProviderId(a.id) ? 12000 : 34000 }))
    render(<CodexAuthSettings />)
    const aRow = (await screen.findByText(a.email!)).closest('li')!
    const bRow = screen.getByText(b.email!).closest('li')!
    expect(await within(aRow).findByText('75% left')).toBeInTheDocument()
    expect(within(aRow).getByText('12.0K')).toBeInTheDocument()
    expect(await within(bRow).findByText('34.0K')).toBeInTheDocument()
    expect(within(bRow).queryByText('75% left')).not.toBeInTheDocument()
    expect(limits).toHaveBeenCalledWith('/project', codexAccountProviderId(a.id), false, true)
    expect(limits).toHaveBeenCalledWith('/project', codexAccountProviderId(b.id), false, true)
  })

  it('adds an account with device-code login even while another account is signed in', async () => {
    list.mockResolvedValue([a])
    start.mockResolvedValue({ type: 'chatgptDeviceCode', accountId: b.id, loginId: 'login-1', verificationUrl: 'https://auth.openai.com/device', userCode: 'ABCD-EFGH' })
    const user = userEvent.setup()
    render(<CodexAuthSettings />)
    await screen.findByText(a.email!)
    await user.click(screen.getByRole('button', { name: 'Add Account' }))
    expect(start).toHaveBeenCalledWith('/project', undefined)
    expect(await screen.findByText('ABCD-EFGH')).toBeInTheDocument()
    expect(screen.getByText(a.email!)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(cancel).toHaveBeenCalledWith('/project', 'login-1')
  })

  it('changes the default without logging out either account', async () => {
    let accounts = [a, b]
    list.mockImplementation(async () => accounts)
    setDefault.mockImplementation(async (_path, id) => { accounts = accounts.map((a) => ({ ...a, isDefault: a.id === id })) })
    const user = userEvent.setup()
    render(<CodexAuthSettings />)
    const bRow = (await screen.findByText(b.email!)).closest('li')!
    await user.click(within(bRow).getByRole('button', { name: 'Set as Default' }))
    expect(setDefault).toHaveBeenCalledWith('/project', b.id)
    await waitFor(() => expect(within(bRow).getByText('Default')).toBeInTheDocument())
    expect(logout).not.toHaveBeenCalled()
  })

  it('signs out only the selected account and keeps the other row', async () => {
    list.mockResolvedValue([a, b])
    logout.mockImplementation(async () => { list.mockResolvedValue([{ ...a, signedIn: false, isDefault: false }, { ...b, isDefault: true }]) })
    const user = userEvent.setup()
    render(<CodexAuthSettings />)
    const row = (await screen.findByText(a.email!)).closest('li')!
    await user.click(within(row).getByRole('button', { name: 'Sign Out' }))
    expect(logout).toHaveBeenCalledWith('/project', codexAccountProviderId(a.id))
    await waitFor(() => expect(within(row).getByText('Signed Out')).toBeInTheDocument())
    expect(screen.getByText(b.email!)).toBeInTheDocument()
  })

  it('shows refresh failures and recovers on retry', async () => {
    list.mockRejectedValueOnce(new Error('Node disconnected'))
    const user = userEvent.setup()
    render(<CodexAuthSettings />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Node disconnected')
    list.mockResolvedValue([a])
    await user.click(screen.getByRole('button', { name: 'Refresh account status' }))
    expect(await screen.findByText(a.email!)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('reports missing quota even when token statistics succeed and forces a manual retry', async () => {
    list.mockResolvedValue([a])
    usage.mockResolvedValue({ lifetimeTokens: 12000 })
    const user = userEvent.setup()
    render(<CodexAuthSettings />)
    expect(await screen.findByText('12.0K')).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Refresh Usage' }))
    expect(limits).toHaveBeenLastCalledWith('/project', codexAccountProviderId(a.id), true, false)
    expect(usage).toHaveBeenLastCalledWith('/project', codexAccountProviderId(a.id), null, true, false)
  })

  it('retains quota during a failed refresh and clears it when the login identity changes', async () => {
    list.mockResolvedValue([a])
    limits.mockResolvedValueOnce({ primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: null }, secondary: null })
    const user = userEvent.setup()
    render(<CodexAuthSettings />)
    expect(await screen.findByText('75% left')).toBeInTheDocument()
    let finish!: (value: null) => void
    limits.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    await user.click(screen.getByRole('button', { name: 'Refresh account status' }))
    expect(screen.getByText('75% left')).toBeInTheDocument()
    finish(null)
    expect(await screen.findByText('Usage is unavailable. Refresh to try again.')).toBeInTheDocument()
    expect(screen.getByText('75% left')).toBeInTheDocument()
    list.mockResolvedValue([{ ...a, email: 'changed@example.test' }])
    await user.click(screen.getByRole('button', { name: 'Refresh account status' }))
    expect(await screen.findByText('changed@example.test')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('75% left')).toBeNull())
  })

  it('refreshes only the chosen card and lets two cards finish independently', async () => {
    list.mockResolvedValue([a, b])
    limits.mockResolvedValue({ primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: null }, secondary: null })
    const user = userEvent.setup()
    render(<CodexAuthSettings />)
    await screen.findAllByText('75% left')
    const aRow = screen.getByText(a.email!).closest('li')!
    const bRow = screen.getByText(b.email!).closest('li')!
    const pending = new Map<string, (value: unknown) => void>()
    limits.mockImplementation((_path, id) => new Promise((resolve) => { pending.set(id, resolve) }))
    limits.mockClear(); usage.mockClear(); list.mockClear()
    await user.click(within(aRow).getByRole('button', { name: 'Refresh Usage' }))
    expect(limits).toHaveBeenCalledTimes(1)
    expect(limits).toHaveBeenCalledWith('/project', codexAccountProviderId(a.id), true, false)
    expect(list).not.toHaveBeenCalled()
    expect(within(bRow).getByRole('button', { name: 'Refresh Usage' })).toBeEnabled()
    await user.click(within(bRow).getByRole('button', { name: 'Refresh Usage' }))
    pending.get(codexAccountProviderId(b.id))!({ primary: { usedPercent: 50, windowDurationMins: 300, resetsAt: null }, secondary: null })
    expect(await within(bRow).findByText('50% left')).toBeInTheDocument()
    pending.get(codexAccountProviderId(a.id))!({ primary: { usedPercent: 80, windowDurationMins: 300, resetsAt: null }, secondary: null })
    expect(await within(aRow).findByText('20% left')).toBeInTheDocument()
  })

  it('removes a signed-out card while retaining its sign-in action until removed', async () => {
    list.mockResolvedValue([{ ...a, signedIn: false, isDefault: false }, b])
    remove.mockImplementation(async () => { list.mockResolvedValue([b]) })
    const user = userEvent.setup()
    render(<CodexAuthSettings />)
    const row = (await screen.findByText(a.email!)).closest('li')!
    expect(within(row).getByRole('button', { name: 'Sign In Again' })).toBeInTheDocument()
    await user.click(within(row).getByRole('button', { name: 'Remove Account' }))
    expect(remove).toHaveBeenCalledWith('/project', codexAccountProviderId(a.id))
    await waitFor(() => expect(screen.queryByText(a.email!)).toBeNull())
    expect(screen.getByText(b.email!)).toBeInTheDocument()
    expect(logout).not.toHaveBeenCalled()
  })
})
