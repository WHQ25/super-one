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
vi.mock('@/stores/chat', () => ({ useChatStore: (select: (state: { activeProject: string }) => unknown) => select({ activeProject: '/project' }) }))
Object.defineProperty(window, 'app', { configurable: true, value: { codexGetRateLimits: limits, codexGetAccountUsage: usage, codexListAccounts: list, codexStartAccountLogin: start, codexCancelAccountLogin: cancel, codexLogoutAccount: logout, codexSetDefaultAccount: setDefault } })
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
    expect(limits).toHaveBeenCalledWith('/project', codexAccountProviderId(a.id))
    expect(limits).toHaveBeenCalledWith('/project', codexAccountProviderId(b.id))
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
})
